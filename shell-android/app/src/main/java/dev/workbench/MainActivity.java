package dev.workbench;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.HashMap;
import java.util.Map;

/**
 * 单 Activity WebView 外壳。
 * 资源走 assets/www，通过 https://app.local/ 虚拟源提供，
 * 让 localStorage / fetch / 相对路径行为与线上一致。
 */
public class MainActivity extends Activity {

    private static final String HOST = "app.local";
    private static final String START_URL = "https://" + HOST + "/index.html";
    private static final String ALBUM = "AI参考工作台";

    private WebView web;
    private String pendingBackAction;
    private McpServer mcp;
    private AssetPackManager packs;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            Window w = getWindow();
            w.clearFlags(WindowManager.LayoutParams.FLAG_TRANSLUCENT_STATUS);
            w.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
            w.setStatusBarColor(Color.TRANSPARENT);
            w.setNavigationBarColor(Color.TRANSPARENT);
        }

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#F7F7F5"));

        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#F7F7F5"));
        root.addView(web, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        setContentView(root);
        applyInsets(root);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setTextZoom(100);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        }

        boolean debuggable =
                (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        if (debuggable) {
            WebView.setWebContentsDebuggingEnabled(true);
        }

        web.addJavascriptInterface(new NativeBridge(), "__wbNative");

        // 局域网地址，供设置页展示 MCP 端点
        final String lanIp = localIpv4();
        web.addJavascriptInterface(new Object() {
            @JavascriptInterface
            public String get() {
                return lanIp;
            }
        }, "__wbLanIpValue");

        web.addJavascriptInterface(new McpBridge(), "__wbMcp");
        web.addJavascriptInterface(new PackBridge(), "__wbPacks");

        // 默认在 127.0.0.1:7801 启动内置服务：生成功能依赖它的 /proxy
        startMcpInternal(7801, false);
        web.setWebViewClient(new LocalClient());
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);

        // <a download> / blob 导出：用系统下载器落盘
        web.setDownloadListener((url, userAgent, contentDisposition, mimeType, len) -> {
            try {
                android.app.DownloadManager.Request req =
                        new android.app.DownloadManager.Request(android.net.Uri.parse(url));
                String name = android.webkit.URLUtil.guessFileName(url, contentDisposition, mimeType);
                req.setTitle(name);
                req.setNotificationVisibility(
                        android.app.DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                req.setDestinationInExternalPublicDir(
                        Environment.DIRECTORY_DOWNLOADS, name);
                android.app.DownloadManager dm =
                        (android.app.DownloadManager) getSystemService(DOWNLOAD_SERVICE);
                if (dm != null) dm.enqueue(req);
                Toast.makeText(this, "已开始下载", Toast.LENGTH_SHORT).show();
            } catch (Exception e) {
                Toast.makeText(this, "下载失败", Toast.LENGTH_SHORT).show();
            }
        });

        packs = new AssetPackManager(this);

        if (savedInstanceState != null) {
            web.restoreState(savedInstanceState);
        } else {
            boot();
        }
    }

    /** 先确认资源包，未就绪时显示安装页 */
    private void boot() {
        String installed = packs.installedVersion();
        File dir = packs.currentDir();
        boolean ready = !installed.isEmpty() && dir != null
                && new File(dir, "www/data/index.json").isFile()
                && new File(dir, "www/assets/costume/thumb").isDirectory();
        if (ready) {
            web.loadUrl(START_URL);
            return;
        }
        String html = packInstallerHtml();
        web.loadDataWithBaseURL("https://" + HOST + "/", html, "text/html", "utf-8", null);
    }

    /** 资源包安装页（纯内联，不依赖资源包）。深浅主题自适应，展示百分比 / 速度 / 下载源。 */
    private String packInstallerHtml() {
        return "<!doctype html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\">"
                + "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
                + "<style>"
                + ":root{--bg:#f7f7f5;--fg:#17181a;--muted:#5f6368;--faint:#8b8f94;"
                + "--line:#e2e2de;--sunken:#efefec;--chip:#ffffff}"
                + "@media (prefers-color-scheme: dark){"
                + ":root{--bg:#121315;--fg:#eceef0;--muted:#9ba1a7;--faint:#6f757b;"
                + "--line:#2a2d31;--sunken:#0e0f11;--chip:#1a1c1f}}"
                + "html,body{margin:0;height:100%;background:var(--bg);color:var(--fg);"
                + "font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif}"
                + ".w{max-width:420px;margin:0 auto;padding:0 28px;height:100%;"
                + "display:flex;flex-direction:column;justify-content:center;align-items:center;"
                + "text-align:center}"
                + "h1{font-size:20px;font-weight:650;margin:0 0 8px;letter-spacing:-.01em}"
                + ".sub{font-size:13px;line-height:1.7;color:var(--muted);margin:0 0 26px}"
                + ".pct{font-size:44px;font-weight:700;line-height:1;"
                + "font-variant-numeric:tabular-nums;letter-spacing:-.02em;margin-bottom:14px}"
                + ".pct small{font-size:18px;font-weight:600;color:var(--faint);margin-left:2px}"
                + ".bar{height:8px;border-radius:4px;background:var(--sunken);overflow:hidden;"
                + "width:100%}"
                + ".fill{height:100%;width:0;background:var(--fg);transition:width .3s ease}"
                + ".stats{display:flex;align-items:center;justify-content:center;"
                + "margin-top:12px;font-size:12px;color:var(--muted);"
                + "font-variant-numeric:tabular-nums}"
                + ".stats .speed{margin-right:18px}"
                + ".src{display:inline-flex;align-items:center;margin-top:20px;"
                + "height:24px;padding:0 10px;border-radius:999px;"
                + "background:var(--chip);border:1px solid var(--line);"
                + "font-size:11px;color:var(--muted)}"
                + ".src i{width:6px;height:6px;border-radius:50%;background:#1f7a4d;margin-right:6px}"
                + ".stage{font-size:12px;color:var(--faint);min-height:18px;margin-top:8px}"
                + "button{margin-top:26px;height:42px;padding:0 26px;border:0;border-radius:10px;"
                + "background:var(--fg);color:var(--bg);font-size:13px;font-weight:600}"
                + "button:disabled{opacity:.4}"
                + ".err{color:#a8641a}"
                + "</style></head><body><div class=\"w\">"
                + "<h1>安装资源包</h1>"
                + "<p class=\"sub\">图片素材较大，单独下载。<br>约 133 MB，请保持网络连接。</p>"
                + "<div class=\"pct\"><span id=\"p\">0</span><small>%</small></div>"
                + "<div class=\"bar\"><div class=\"fill\" id=\"f\"></div></div>"
                + "<div class=\"stats\">"
                + "<span class=\"speed\" id=\"v\">— MB/s</span>"
                + "<span class=\"bytes\" id=\"b\">0 / 133 MB</span>"
                + "</div>"
                + "<div class=\"src\" id=\"src\" hidden><i></i><span id=\"srcT\">Gitee</span></div>"
                + "<div class=\"stage\" id=\"s\">准备中…</div>"
                + "<button id=\"go\" disabled>开始安装</button>"
                + "</div><script>"
                + "var go=document.getElementById('go'),f=document.getElementById('f'),"
                + "s=document.getElementById('s'),p=document.getElementById('p'),"
                + "v=document.getElementById('v'),b=document.getElementById('b'),"
                + "src=document.getElementById('src'),srcT=document.getElementById('srcT');"
                + "function fmt(n){return n>=1048576?(n/1048576).toFixed(1)+' MB/s':"
                + "n>=1024?(n/1024).toFixed(0)+' KB/s':n+' B/s'}"
                + "function fmtT(n){return (n/1048576).toFixed(1)+' MB'}"
                + "window.__packProgress=function(pct,stage,bytes,total,speed,source){"
                + "p.textContent=pct;f.style.width=pct+'%';"
                + "s.textContent=stage;"
                + "s.className='stage';"
                + "v.textContent=speed>0?fmt(speed):'—';"
                + "b.textContent=fmtT(bytes)+' / '+fmtT(total);"
                + "if(source){src.hidden=false;srcT.textContent='下载源 · '+source;}"
                + "};"
                + "window.__packDone=function(ok,msg){"
                + "s.textContent=msg;s.className='stage'+(ok?'':' err');"
                + "if(!ok){v.textContent='—';}"
                + "if(ok){location.href='https://" + HOST + "/index.html';}"
                + "else{go.disabled=false;go.textContent='重试';}};"
                + "go.onclick=function(){go.disabled=true;go.textContent='正在安装…';"
                + "if(window.__wbPacks){window.__wbPacks.install();}};"
                + "setTimeout(function(){go.disabled=false;},600);"
                + "</script></body></html>";
    }

    /** 让内容延伸到状态栏/导航栏之下，并保留安全区内边距 */
    private void applyInsets(View root) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            root.setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        }
        root.setOnApplyWindowInsetsListener(new View.OnApplyWindowInsetsListener() {
            @Override
            public WindowInsets onApplyWindowInsets(View v, WindowInsets insets) {
                v.setPadding(0, insets.getSystemWindowInsetTop(), 0,
                        insets.getSystemWindowInsetBottom());
                return insets;
            }
        });
    }

    /** 拦截 app.local，从 assets 直接读，不解压 */
    private class LocalClient extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
            Uri u = req.getUrl();
            if (u == null || !HOST.equals(u.getHost())) return null;

            String path = u.getPath();
            if (path == null || path.isEmpty() || "/".equals(path)) path = "/index.html";

            String asset = "www" + path;

            // 1) 已下载的资源包优先（图片、索引）
            File dir = packs == null ? null : packs.currentDir();
            if (dir != null) {
                File f = new File(dir, asset);
                try {
                    String canonical = f.getCanonicalPath();
                    if (canonical.startsWith(dir.getCanonicalPath()) && f.isFile()) {
                        InputStream in = new java.io.FileInputStream(f);
                        WebResourceResponse res = new WebResourceResponse(mimeOf(path), null, in);
                        Map<String, String> h = new HashMap<>();
                        h.put("Cache-Control", "public, max-age=31536000");
                        res.setResponseHeaders(h);
                        return res;
                    }
                } catch (IOException ignored) {
                    // 落到 assets
                }
            }

            // 2) APK 内置（页面、JS、CSS、技能数据）
            try {
                InputStream in = getAssets().open(asset);
                WebResourceResponse res =
                        new WebResourceResponse(mimeOf(path), null, in);
                Map<String, String> h = new HashMap<>();
                h.put("Cache-Control", "public, max-age=31536000");
                res.setResponseHeaders(h);
                return res;
            } catch (IOException e) {
                return new WebResourceResponse("text/plain", "utf-8", 404,
                        "Not Found", new HashMap<String, String>(), null);
            }
        }
    }

    private static String mimeOf(String p) {
        if (p.endsWith(".html")) return "text/html";
        if (p.endsWith(".js")) return "application/javascript";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".json")) return "application/json";
        if (p.endsWith(".webp")) return "image/webp";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".woff2")) return "font/woff2";
        return "application/octet-stream";
    }

    /** 启停内置 MCP 服务 */
    private boolean startMcpInternal(int port, boolean lan) {
        stopMcpInternal();
        mcp = new McpServer(getAssets(), port, lan);
        mcp.setPackDirProvider(() -> packs == null ? null : packs.currentDir());
        if (!mcp.start()) {
            mcp = null;
            return false;
        }
        return true;
    }

    private boolean isMcpRunningInternal() {
        return mcp != null && mcp.isRunning();
    }

    private void stopMcpInternal() {
        if (mcp != null) {
            mcp.stop();
            mcp = null;
        }
    }

    private class PackBridge {
        @JavascriptInterface
        public void install() {
            packs.ensure(new AssetPackManager.Progress() {
                @Override
                public void onProgress(String stage, int percent, long bytes, long total,
                                       long speed, String source) {
                    // 高频回调做节流：UI 每 ~150ms 刷一次足够
                    long now = android.os.SystemClock.elapsedRealtime();
                    if (now - lastUiRefresh < 150 && percent < 100) {
                        return;
                    }
                    lastUiRefresh = now;
                    final String js = "window.__packProgress && window.__packProgress("
                            + percent + ",'" + jsEscape(stage) + "',"
                            + bytes + "," + total + "," + speed + ",'" + jsEscape(source) + "')";
                    web.post(() -> web.evaluateJavascript(js, null));
                }

                private long lastUiRefresh;

                @Override
                public void onDone(final boolean ok, final String message) {
                    final String js = "window.__packDone && window.__packDone("
                            + ok + ",'" + jsEscape(message) + "')";
                    web.post(() -> web.evaluateJavascript(js, null));
                }

                private String jsEscape(String s) {
                    return s == null ? "" : s.replace("\\", "\\\\").replace("'", "\\'");
                }
            });
        }

        @JavascriptInterface
        public String installed() {
            return packs.installedVersion();
        }
    }

    private class McpBridge {
        @JavascriptInterface
        public boolean start(int port, boolean lan) {
            return startMcpInternal(port, lan);
        }

        @JavascriptInterface
        public void stop() {
            stopMcpInternal();
        }

        @JavascriptInterface
        public boolean running() {
            return isMcpRunningInternal();
        }

        @JavascriptInterface
        public String lanIp() {
            return localIpv4();
        }
    }

    /** 返回键：先让网页处理（关灯箱/抽屉），再退出 */
    @Override
    public void onBackPressed() {
        if (pendingBackAction != null) {
            return;
        }
        pendingBackAction = "back";
        web.evaluateJavascript("(function(){try{return window.__onBack?window.__onBack():false}catch(e){return false}})()",
                value -> {
                    pendingBackAction = null;
                    if (!"true".equals(value)) {
                        MainActivity.super.onBackPressed();
                    }
                });
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        web.saveState(outState);
    }

    @Override
    protected void onDestroy() {
        stopMcpInternal();
        if (web != null) {
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }

    /* ── 原生桥 ── */

    private class NativeBridge {

        @JavascriptInterface
        public String platform() {
            return "android";
        }

        @JavascriptInterface
        public void toast(String msg) {
            runOnUiThread(() -> Toast.makeText(MainActivity.this, msg, Toast.LENGTH_SHORT).show());
        }

        /**
         * 保存 assets 中的图片到系统相册。
         * 返回可读路径（content:// 或文件路径），失败返回空串。
         */
        @JavascriptInterface
        public String saveImage(String relativePath, String filename) {
            String asset = "www/" + relativePath.replaceFirst("^/+", "");
            String name = (filename == null || filename.isEmpty())
                    ? asset.substring(asset.lastIndexOf('/') + 1)
                    : filename;

            // 资源包里的图片优先
            File dir = packs == null ? null : packs.currentDir();
            if (dir != null) {
                File f = new File(dir, asset);
                try {
                    if (f.getCanonicalPath().startsWith(dir.getCanonicalPath()) && f.isFile()) {
                        try (InputStream in = new java.io.FileInputStream(f)) {
                            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                                return saveViaMediaStore(in, name);
                            }
                            return saveToExternalFiles(in, name);
                        }
                    }
                } catch (Exception ignored) {
                    // 回退到 assets
                }
            }

            try (InputStream in = getAssets().open(asset)) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    return saveViaMediaStore(in, name);
                }
                return saveToExternalFiles(in, name);
            } catch (Exception e) {
                return "";
            }
        }

        @JavascriptInterface
        public void shareText(String text) {
            if (text == null || text.isEmpty()) return;
            runOnUiThread(() -> {
                Intent i = new Intent(Intent.ACTION_SEND);
                i.setType("text/plain");
                i.putExtra(Intent.EXTRA_TEXT, text);
                startActivity(Intent.createChooser(i, "分享"));
            });
        }
    }

    private String saveViaMediaStore(InputStream in, String name) throws IOException {
        ContentValues cv = new ContentValues();
        cv.put(MediaStore.Images.Media.DISPLAY_NAME, name);
        cv.put(MediaStore.Images.Media.MIME_TYPE, mimeOf(name));
        cv.put(MediaStore.Images.Media.RELATIVE_PATH,
                Environment.DIRECTORY_PICTURES + "/" + ALBUM);
        cv.put(MediaStore.Images.Media.IS_PENDING, 1);

        ContentResolver cr = getContentResolver();
        Uri uri = cr.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, cv);
        if (uri == null) throw new IOException("insert failed");

        try (OutputStream out = cr.openOutputStream(uri)) {
            if (out == null) throw new IOException("openOutputStream failed");
            copy(in, out);
        }

        cv.clear();
        cv.put(MediaStore.Images.Media.IS_PENDING, 0);
        cr.update(uri, cv, null, null);
        return uri.toString();
    }

    private String saveToExternalFiles(InputStream in, String name) throws IOException {
        File dir = new File(getExternalFilesDir(Environment.DIRECTORY_PICTURES), ALBUM);
        if (!dir.exists() && !dir.mkdirs()) throw new IOException("mkdirs failed");
        File f = new File(dir, name);
        try (OutputStream out = new FileOutputStream(f)) {
            copy(in, out);
        }
        return f.getAbsolutePath();
    }

    /** 取本机 IPv4（非回环） */
    private String localIpv4() {
        try {
            java.util.Enumeration<java.net.NetworkInterface> ifs =
                    java.net.NetworkInterface.getNetworkInterfaces();
            while (ifs != null && ifs.hasMoreElements()) {
                java.net.NetworkInterface ni = ifs.nextElement();
                if (!ni.isUp() || ni.isLoopback()) continue;
                java.util.Enumeration<java.net.InetAddress> addrs = ni.getInetAddresses();
                while (addrs.hasMoreElements()) {
                    java.net.InetAddress a = addrs.nextElement();
                    if (a instanceof java.net.Inet4Address && !a.isLoopbackAddress()) {
                        String ip = a.getHostAddress();
                        if (ip != null && (ip.startsWith("192.168.") || ip.startsWith("10.")
                                || ip.startsWith("172."))) {
                            return ip;
                        }
                    }
                }
            }
            // 退而求其次：任何非回环 IPv4
            ifs = java.net.NetworkInterface.getNetworkInterfaces();
            while (ifs != null && ifs.hasMoreElements()) {
                java.net.NetworkInterface ni = ifs.nextElement();
                if (!ni.isUp() || ni.isLoopback()) continue;
                java.util.Enumeration<java.net.InetAddress> addrs = ni.getInetAddresses();
                while (addrs.hasMoreElements()) {
                    java.net.InetAddress a = addrs.nextElement();
                    if (a instanceof java.net.Inet4Address && !a.isLoopbackAddress()) {
                        return a.getHostAddress();
                    }
                }
            }
        } catch (Exception ignored) {
            // 权限或环境限制时忽略
        }
        return "";
    }

    private static void copy(InputStream in, OutputStream out) throws IOException {
        byte[] buf = new byte[64 * 1024];
        int n;
        while ((n = in.read(buf)) > 0) {
            out.write(buf, 0, n);
        }
        out.flush();
    }
}
