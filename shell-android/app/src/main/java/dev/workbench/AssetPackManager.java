package dev.workbench;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * 资源包管理：首次运行检查本地是否已解压，否则从 Gitee Release 下载。
 *
 * 设计取舍：
 *  - 图片资源不打进 APK，APK 保持 ~10MB，方便更新；
 *  - 解压到 filesDir/packs/<version>/，用 SharedPreferences 记录已完成的版本；
 *  - 只下载缺失的包，已存在且大小一致的包跳过；
 *  - 下载过程可取消（stop()），失败保留 .part 供下次续传（简化为整包重下）。
 */
public class AssetPackManager {

    private static final String TAG = "WbPacks";
    private static final String PREFS = "wb_packs";
    private static final String KEY_VERSION = "installed_version";

    public interface Progress {
        void onProgress(String stage, int percent, long bytes, long total);

        void onDone(boolean ok, String message);
    }

    private final Context ctx;
    private volatile boolean cancelled;
    private final Object installLock = new Object();
    private boolean installing;

    public AssetPackManager(Context ctx) {
        this.ctx = ctx.getApplicationContext();
    }

    public File packsRoot() {
        return new File(ctx.getFilesDir(), "packs");
    }

    public File currentDir() {
        SharedPreferences sp = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String v = sp.getString(KEY_VERSION, "");
        return v.isEmpty() ? null : new File(packsRoot(), v);
    }

    public String installedVersion() {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .getString(KEY_VERSION, "");
    }

    public void cancel() {
        cancelled = true;
    }

    /**
     * 确保资源包就绪。manifest 由 APK 内置（assets/www/data/release.json），
     * 内含各包的大小、sha256 与下载地址。
     */
    public void ensure(final Progress cb) {
        synchronized (installLock) {
            if (installing) {
                cb.onDone(false, "正在安装中，请稍候");
                return;
            }
            installing = true;
        }
        new Thread(() -> {
            try {
                JSONObject manifest = readBundledManifest();
                String version = manifest.optString("version", "0");
                File cur = currentDir();
                // 目录存在且索引文件真实可用，才算安装完成
                if (version.equals(installedVersion()) && cur != null
                        && new File(cur, "www/data/index.json").isFile()
                        && new File(cur, "www/assets/costume/thumb").isDirectory()) {
                    cb.onDone(true, "资源已就绪");
                    return;
                }

                JSONArray packs = manifest.optJSONArray("packs");
                if (packs == null || packs.length() == 0) {
                    cb.onDone(false, "资源包清单为空");
                    return;
                }

                long sumBytes = 0;
                for (int i = 0; i < packs.length(); i++) {
                    sumBytes += packs.getJSONObject(i).optLong("bytes", 0);
                }
                final long totalBytes = sumBytes;

                // 解压到 <version>/www，与拦截器里的 "www" + path 对齐
                File versionDir = new File(packsRoot(), version);
                File stagingRoot = new File(packsRoot(), version + ".staging");
                File stage = new File(stagingRoot, "www");
                if (stagingRoot.exists()) deleteTree(stagingRoot);
                if (!stage.mkdirs()) {
                    cb.onDone(false, "无法创建目录");
                    return;
                }

                long doneBytes = 0;
                for (int i = 0; i < packs.length(); i++) {
                    if (cancelled) {
                        cb.onDone(false, "已取消");
                        return;
                    }
                    JSONObject pack = packs.getJSONObject(i);
                    String file = pack.optString("file");
                    String url = pack.optString("url");
                    long size = pack.optLong("bytes", 0);
                    String sha = pack.optString("sha256", "");

                    if (url.isEmpty()) {
                        cb.onDone(false, "缺少下载地址，请先发布 Release");
                        return;
                    }

                    File zip = new File(packsRoot(), file);
                    boolean need = !zip.exists() || zip.length() != size;
                    if (need) {
                        final long base = doneBytes;
                        boolean ok = download(url, zip, size, (got, all) ->
                                cb.onProgress("下载 " + file, (int) ((base + got) * 100 / Math.max(1, totalBytes)),
                                        base + got, totalBytes));
                        if (!ok) {
                            cb.onDone(false, "下载失败：" + file);
                            return;
                        }
                    }

                    if (!sha.isEmpty() && !sha.equalsIgnoreCase(sha256(zip))) {
                        zip.delete();
                        cb.onDone(false, "校验失败：" + file);
                        return;
                    }

                    cb.onProgress("解压 " + file, (int) (doneBytes * 100 / Math.max(1, totalBytes)),
                            doneBytes, totalBytes);
                    unzip(zip, stage);
                    doneBytes += size;
                }

                if (!stage.isDirectory()) {
                    cb.onDone(false, "解压目录缺失");
                    return;
                }

                // 全部成功后才替换旧版本，失败不影响已装资源
                if (versionDir.exists()) deleteTree(versionDir);
                if (!stagingRoot.renameTo(versionDir)) {
                    cb.onDone(false, "无法切换到新资源目录");
                    return;
                }

                ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                        .putString(KEY_VERSION, version).apply();
                cb.onDone(true, "资源包已安装");
            } catch (Exception e) {
                Log.w(TAG, "ensure failed", e);
                cb.onDone(false, "失败：" + e.getMessage());
            } finally {
                synchronized (installLock) {
                    installing = false;
                }
            }
        }, "wb-pack-install").start();
    }

    private JSONObject readBundledManifest() throws Exception {
        try (InputStream in = ctx.getAssets().open("www/data/release.json")) {
            byte[] buf = new byte[8192];
            StringBuilder sb = new StringBuilder();
            int n;
            while ((n = in.read(buf)) > 0) sb.append(new String(buf, 0, n, "UTF-8"));
            return new JSONObject(sb.toString());
        }
    }

    private interface ByteSink {
        void onBytes(long got, long all);
    }

    private boolean download(String url, File dst, long expect, ByteSink sink) {
        File tmp = new File(dst.getPath() + ".part");
        try {
            HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
            c.setConnectTimeout(20000);
            c.setReadTimeout(60000);
            c.setInstanceFollowRedirects(true);
            int code = c.getResponseCode();
            if (code >= 300 && code < 400) {
                String loc = c.getHeaderField("Location");
                if (loc != null) {
                    c = (HttpURLConnection) new URL(loc).openConnection();
                    c.setConnectTimeout(20000);
                    c.setReadTimeout(60000);
                    code = c.getResponseCode();
                }
            }
            if (code != 200) return false;

            long total = c.getContentLength() > 0 ? c.getContentLength() : expect;
            try (InputStream in = c.getInputStream();
                 FileOutputStream out = new FileOutputStream(tmp)) {
                byte[] buf = new byte[64 * 1024];
                long got = 0;
                int n;
                int lastPct = -1;
                while ((n = in.read(buf)) > 0) {
                    if (cancelled) return false;
                    out.write(buf, 0, n);
                    got += n;
                    int pct = (int) (got * 100 / Math.max(1, total));
                    if (pct != lastPct) {
                        lastPct = pct;
                        sink.onBytes(got, total);
                    }
                }
                out.flush();
            }
            return tmp.renameTo(dst);
        } catch (Exception e) {
            Log.w(TAG, "download failed", e);
            return false;
        }
    }

    private void unzip(File zip, File dir) throws IOException {
        try (ZipInputStream zin = new ZipInputStream(new java.io.BufferedInputStream(
                new java.io.FileInputStream(zip)))) {
            ZipEntry e;
            byte[] buf = new byte[64 * 1024];
            while ((e = zin.getNextEntry()) != null) {
                File out = new File(dir, e.getName());
                if (!out.getCanonicalPath().startsWith(dir.getCanonicalPath())) {
                    throw new IOException("非法路径: " + e.getName());
                }
                if (e.isDirectory()) {
                    out.mkdirs();
                    continue;
                }
                File parent = out.getParentFile();
                if (parent != null && !parent.exists()) parent.mkdirs();
                try (FileOutputStream fos = new FileOutputStream(out)) {
                    int n;
                    while ((n = zin.read(buf)) > 0) fos.write(buf, 0, n);
                }
            }
        }
    }

    private static String sha256(File f) throws Exception {
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        try (InputStream in = new java.io.FileInputStream(f)) {
            byte[] buf = new byte[1 << 20];
            int n;
            while ((n = in.read(buf)) > 0) md.update(buf, 0, n);
        }
        StringBuilder sb = new StringBuilder();
        for (byte b : md.digest()) sb.append(String.format("%02x", b));
        return sb.toString();
    }

    private static void deleteTree(File f) {
        if (f.isDirectory()) {
            File[] kids = f.listFiles();
            if (kids != null) for (File k : kids) deleteTree(k);
        }
        f.delete();
    }
}
