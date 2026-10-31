package dev.workbench;

import android.content.res.AssetManager;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URLDecoder;
import java.nio.charset.Charset;
import java.util.HashMap;
import java.util.Iterator;
import java.util.Locale;
import java.util.Map;

/**
 * 极简只读 MCP 服务（HTTP + JSON-RPC 2.0）。
 * 与 tools/mcp_server.py 的工具集保持一致，直接读 APK 内 assets。
 */
public class McpServer {

    private static final String TAG = "WbMcp";
    private static final Charset UTF8 = Charset.forName("UTF-8");
    private static final String PROTOCOL = "2025-06-18";

    private final AssetManager assets;
    private final int port;
    private final boolean lan;
    /** 资源包目录提供者（由 MainActivity 注入） */
    public interface PackDirProvider {
        File get();
    }

    private PackDirProvider packDirProvider;
    private volatile boolean running;
    private ServerSocket server;
    private Thread acceptThread;

    private JSONObject index;
    private JSONObject skills;

    public void setPackDirProvider(PackDirProvider provider) {
        this.packDirProvider = provider;
    }

    public McpServer(AssetManager assets, int port, boolean lan) {
        this.assets = assets;
        this.port = port;
        this.lan = lan;
    }

    public synchronized boolean start() {
        if (running) return true;
        try {
            loadData();
            server = new ServerSocket();
            server.setReuseAddress(true);
            server.bind(new InetSocketAddress(
                    lan ? "0.0.0.0" : "127.0.0.1", port), 16);
            running = true;
            acceptThread = new Thread(this::acceptLoop, "wb-mcp-accept");
            acceptThread.setDaemon(true);
            acceptThread.start();
            Log.i(TAG, "started on " + (lan ? "0.0.0.0" : "127.0.0.1") + ":" + port);
            return true;
        } catch (Exception e) {
            Log.w(TAG, "start failed", e);
            closeQuietly();
            return false;
        }
    }

    public synchronized void stop() {
        running = false;
        closeQuietly();
    }

    public boolean isRunning() {
        return running;
    }

    private void closeQuietly() {
        try {
            if (server != null) server.close();
        } catch (IOException ignored) {
            // 关闭失败无需处理
        }
        server = null;
    }

    private void acceptLoop() {
        while (running) {
            try {
                Socket s = server.accept();
                Thread t = new Thread(() -> handle(s), "wb-mcp-conn");
                t.setDaemon(true);
                t.start();
            } catch (Exception e) {
                if (running) Log.w(TAG, "accept error", e);
                break;
            }
        }
    }

    /* ── HTTP ── */

    private void handle(Socket sock) {
        try {
            sock.setSoTimeout(20000);
            InputStream raw = new BufferedInputStream(sock.getInputStream());
            String requestLine = readLine(raw);
            if (requestLine == null) {
                sock.close();
                return;
            }
            String[] parts = requestLine.split(" ");
            if (parts.length < 2) {
                sock.close();
                return;
            }
            String method = parts[0];
            String path = parts[1];

            Map<String, String> headers = new HashMap<>();
            String line;
            int contentLength = 0;
            while ((line = readLine(raw)) != null && !line.isEmpty()) {
                int idx = line.indexOf(':');
                if (idx > 0) {
                    String k = line.substring(0, idx).trim().toLowerCase(Locale.US);
                    String v = line.substring(idx + 1).trim();
                    headers.put(k, v);
                    if ("content-length".equals(k)) {
                        try {
                            contentLength = Integer.parseInt(v);
                        } catch (NumberFormatException ignored) {
                            // 保持 0
                        }
                    }
                }
            }

            byte[] body = new byte[0];
            if (contentLength > 0) {
                body = new byte[contentLength];
                int off = 0;
                while (off < contentLength) {
                    int n = raw.read(body, off, contentLength - off);
                    if (n < 0) break;
                    off += n;
                }
            }

            if ("OPTIONS".equals(method)) {
                writeResponse(sock, 204, null, new byte[0]);
                return;
            }

            String pathOnly = path.split("\\?")[0];
            HOST_HEADER.set(headers.get("host"));
            CURRENT_HEADERS.set(headers);

            if ("GET".equals(method) && ("/health".equals(pathOnly) || "/".equals(pathOnly))) {
                JSONObject o = new JSONObject();
                o.put("ok", true);
                o.put("platform", "android");
                o.put("costume", index.optJSONObject("costume").optJSONArray("items").length());
                o.put("pose", index.optJSONObject("pose").optJSONArray("poses").length());
                o.put("mcp", "/mcp");
                writeResponse(sock, 200, "application/json; charset=utf-8", o.toString().getBytes(UTF8));
                return;
            }

            if ("POST".equals(method) && "/proxy".equals(pathOnly)) {
                proxy(sock, body);
                return;
            }

            if ("GET".equals(method) && pathOnly.startsWith("/assets/")) {
                serveAsset(sock, pathOnly.substring(1));
                return;
            }

            if ("GET".equals(method) && "/mcp".equals(pathOnly)) {
                JSONObject o = new JSONObject();
                o.put("protocolVersion", PROTOCOL);
                o.put("transport", "streamable-http");
                o.put("note", "请使用 POST /mcp 发送 JSON-RPC 请求");
                writeResponse(sock, 200, "application/json; charset=utf-8", o.toString().getBytes(UTF8));
                return;
            }

            if ("POST".equals(method) && "/mcp".equals(pathOnly)) {
                String text = new String(body, UTF8);
                Object resp;
                try {
                    Object parsed = parseJson(text);
                    if (parsed instanceof JSONArray) {
                        JSONArray arr = (JSONArray) parsed;
                        JSONArray out = new JSONArray();
                        for (int i = 0; i < arr.length(); i++) {
                            out.put(handleOne(arr.optJSONObject(i)));
                        }
                        resp = out;
                    } else {
                        resp = handleOne((JSONObject) parsed);
                    }
                } catch (Exception e) {
                    resp = rpcError(null, -32700, "Parse error");
                }
                String payload = resp instanceof JSONArray ? ((JSONArray) resp).toString() : resp.toString();
                writeResponse(sock, 200, "application/json; charset=utf-8", payload.getBytes(UTF8));
                return;
            }

            writeResponse(sock, 404, "application/json; charset=utf-8",
                    "{\"error\":\"not found\"}".getBytes(UTF8));
        } catch (Exception e) {
            Log.w(TAG, "handle error", e);
        } finally {
            HOST_HEADER.remove();
            CURRENT_HEADERS.remove();
            try {
                sock.close();
            } catch (IOException ignored) {
                // 已关闭
            }
        }
    }

    private static Object parseJson(String text) throws Exception {
        String t = text.trim();
        if (t.startsWith("[")) return new JSONArray(t);
        return new JSONObject(t);
    }

    /** 同源代理：转发到第三方 OpenAI 兼容网关，规避浏览器 CORS 限制。 */
    private void proxy(Socket sock, byte[] body) throws IOException {
        String target = getHeader("x-target");
        if (target == null || !(target.startsWith("http://") || target.startsWith("https://"))) {
            writeResponse(sock, 400, "application/json; charset=utf-8",
                    "{\"error\":\"bad target\"}".getBytes(UTF8));
            return;
        }
        String m = getHeader("x-method");
        if (m == null) m = body.length > 0 ? "POST" : "GET";

        try {
            java.net.HttpURLConnection c = (java.net.HttpURLConnection) new java.net.URL(target).openConnection();
            c.setRequestMethod(m);
            c.setConnectTimeout(20000);
            c.setReadTimeout(300000);
            String ct = getHeader("content-type");
            if (ct != null) c.setRequestProperty("Content-Type", ct);
            String auth = getHeader("authorization");
            if (auth != null) c.setRequestProperty("Authorization", auth);
            if (body.length > 0) {
                c.setDoOutput(true);
                c.getOutputStream().write(body);
            }
            int code = c.getResponseCode();
            InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            if (in != null) {
                byte[] tmp = new byte[16 * 1024];
                int n;
                while ((n = in.read(tmp)) > 0) buf.write(tmp, 0, n);
                in.close();
            }
            String respCt = c.getContentType();
            writeResponse(sock, code, respCt != null ? respCt : "application/json", buf.toByteArray());
        } catch (Exception e) {
            writeResponse(sock, 502, "application/json; charset=utf-8",
                    ("{\"error\":\"" + e.getMessage() + "\"}").getBytes(UTF8));
        }
    }

    private String getHeader(String name) {
        Map<String, String> h = CURRENT_HEADERS.get();
        return h == null ? null : h.get(name);
    }

    private static final ThreadLocal<Map<String, String>> CURRENT_HEADERS = new ThreadLocal<>();

    private void serveAsset(Socket sock, String rel) throws IOException {
        String path = URLDecoder.decode(rel, "UTF-8");
        // APK 内资源根为 assets/www
        if (!path.startsWith("www/")) path = "www/" + path;

        // 已下载资源包优先
        File packDir = packDirProvider == null ? null : packDirProvider.get();
        if (packDir != null) {
            File f = new File(packDir, path);
            try {
                if (f.getCanonicalPath().startsWith(packDir.getCanonicalPath()) && f.isFile()) {
                    InputStream in = new java.io.FileInputStream(f);
                    ByteArrayOutputStream buf = new ByteArrayOutputStream();
                    byte[] tmp = new byte[16 * 1024];
                    int n;
                    while ((n = in.read(tmp)) > 0) buf.write(tmp, 0, n);
                    in.close();
                    writeResponse(sock, 200, mimeOf(path), buf.toByteArray(), true);
                    return;
                }
            } catch (IOException ignored) {
                // 回退到 assets
            }
        }

        try {
            InputStream in = assets.open(path);
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            byte[] tmp = new byte[16 * 1024];
            int n;
            while ((n = in.read(tmp)) > 0) buf.write(tmp, 0, n);
            in.close();
            byte[] data = buf.toByteArray();
            String mime = mimeOf(path);
            writeResponse(sock, 200, mime, data, true);
        } catch (IOException e) {
            writeResponse(sock, 404, "application/json; charset=utf-8",
                    "{\"error\":\"not found\"}".getBytes(UTF8));
        }
    }

    private static void writeResponse(Socket sock, int code, String mime, byte[] body) throws IOException {
        writeResponse(sock, code, mime, body, false);
    }

    private static void writeResponse(Socket sock, int code, String mime, byte[] body, boolean cache)
            throws IOException {
        StringBuilder head = new StringBuilder();
        head.append("HTTP/1.1 ").append(code).append(' ').append(reason(code)).append("\r\n");
        if (mime != null) head.append("Content-Type: ").append(mime).append("\r\n");
        head.append("Content-Length: ").append(body.length).append("\r\n");
        head.append("Access-Control-Allow-Origin: *\r\n");
        head.append("Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n");
        head.append("Access-Control-Allow-Headers: Content-Type, Accept, Authorization, X-Target, X-Method\r\n");
        if (cache) head.append("Cache-Control: public, max-age=31536000, immutable\r\n");
        head.append("Connection: close\r\n\r\n");

        OutputStream out = sock.getOutputStream();
        out.write(head.toString().getBytes(UTF8));
        out.write(body);
        out.flush();
    }

    private static String reason(int code) {
        switch (code) {
            case 200: return "OK";
            case 204: return "No Content";
            case 404: return "Not Found";
            default: return "OK";
        }
    }

    private static String mimeOf(String p) {
        String s = p.toLowerCase(Locale.US);
        if (s.endsWith(".webp")) return "image/webp";
        if (s.endsWith(".png")) return "image/png";
        if (s.endsWith(".jpg") || s.endsWith(".jpeg")) return "image/jpeg";
        if (s.endsWith(".json")) return "application/json";
        if (s.endsWith(".js")) return "application/javascript";
        if (s.endsWith(".css")) return "text/css";
        if (s.endsWith(".html")) return "text/html";
        return "application/octet-stream";
    }

    private static String readLine(InputStream in) throws IOException {
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        int c;
        boolean any = false;
        while ((c = in.read()) >= 0) {
            any = true;
            if (c == '\n') break;
            if (c != '\r') buf.write(c);
        }
        if (!any) return null;
        return new String(buf.toByteArray(), UTF8);
    }

    /* ── 数据 ── */

    private void loadData() throws Exception {
        index = new JSONObject(readAsset("www/data/index.json"));
        try {
            skills = new JSONObject(readAsset("www/data/skills.json"));
        } catch (Exception e) {
            skills = null;
        }
    }

    private String readAsset(String path) throws IOException {
        InputStream in = assets.open(path);
        BufferedReader r = new BufferedReader(new InputStreamReader(in, UTF8));
        StringBuilder sb = new StringBuilder();
        String line;
        while ((line = r.readLine()) != null) sb.append(line);
        r.close();
        return sb.toString();
    }

    /* ── JSON-RPC ── */

    private JSONObject handleOne(JSONObject req) {
        if (req == null) return rpcError(null, -32600, "Invalid Request");
        Object rid = req.opt("id");
        String method = req.optString("method", "");
        JSONObject params = req.optJSONObject("params");
        if (params == null) params = new JSONObject();

        try {
            switch (method) {
                case "initialize": {
                    JSONObject caps = new JSONObject();
                    caps.put("tools", new JSONObject().put("listChanged", false));
                    JSONObject info = new JSONObject()
                            .put("name", "ai-reference-workbench")
                            .put("version", "0.1.0");
                    return rpcOk(rid, new JSONObject()
                            .put("protocolVersion", PROTOCOL)
                            .put("capabilities", caps)
                            .put("serverInfo", info));
                }
                case "notifications/initialized":
                case "initialized":
                case "ping":
                    return rpcOk(rid, new JSONObject());
                case "tools/list":
                    return rpcOk(rid, new JSONObject().put("tools", tools()));
                case "tools/call": {
                    String name = params.optString("name", "");
                    JSONObject args = params.optJSONObject("arguments");
                    if (args == null) args = new JSONObject();
                    Object result = callTool(name, args);
                    JSONObject content = new JSONObject()
                            .put("type", "text")
                            .put("text", result instanceof String ? (String) result : result.toString());
                    return rpcOk(rid, new JSONObject()
                            .put("content", new JSONArray().put(content))
                            .put("isError", false));
                }
                case "resources/list":
                    return rpcOk(rid, new JSONObject().put("resources", new JSONArray()));
                default:
                    return rpcError(rid, -32601, "Method not found: " + method);
            }
        } catch (Exception e) {
            return rpcError(rid, -32603, "工具执行失败: " + e.getMessage());
        }
    }

    private static JSONObject rpcOk(Object id, JSONObject result) {
        JSONObject o = new JSONObject();
        try {
            o.put("jsonrpc", "2.0");
            o.put("id", id == null ? JSONObject.NULL : id);
            o.put("result", result);
        } catch (Exception ignored) {
            // 结构固定，不会失败
        }
        return o;
    }

    private static JSONObject rpcError(Object id, int code, String msg) {
        JSONObject o = new JSONObject();
        try {
            o.put("jsonrpc", "2.0");
            o.put("id", id == null ? JSONObject.NULL : id);
            o.put("error", new JSONObject().put("code", code).put("message", msg));
        } catch (Exception ignored) {
            // 结构固定，不会失败
        }
        return o;
    }

    private JSONArray tools() {
        JSONArray arr = new JSONArray();
        try {
            arr.put(new JSONObject()
                    .put("name", "search_references")
                    .put("description", "在服装与深度姿势参考库中检索，返回引用 ID 与图片 URL。")
                    .put("inputSchema", new JSONObject()
                            .put("type", "object")
                            .put("properties", new JSONObject()
                                    .put("library", new JSONObject()
                                            .put("type", "string")
                                            .put("enum", new JSONArray().put("costume").put("pose").put("all")))
                                    .put("query", new JSONObject().put("type", "string"))
                                    .put("category", new JSONObject().put("type", "string"))
                                    .put("tags", new JSONObject()
                                            .put("type", "array")
                                            .put("items", new JSONObject().put("type", "string")))
                                    .put("series", new JSONObject().put("type", "string"))
                                    .put("angle", new JSONObject().put("type", "string"))
                                    .put("limit", new JSONObject().put("type", "integer")))));

            arr.put(new JSONObject()
                    .put("name", "get_reference")
                    .put("description", "按引用取单条记录，例如 costume:SPR-0001 或 pose:full-sexy/P001:front。")
                    .put("inputSchema", new JSONObject()
                            .put("type", "object")
                            .put("properties", new JSONObject()
                                    .put("ref", new JSONObject().put("type", "string")))
                            .put("required", new JSONArray().put("ref"))));

            arr.put(new JSONObject()
                    .put("name", "list_categories")
                    .put("description", "列出服装分类、标签分组、姿势系列与分类。")
                    .put("inputSchema", new JSONObject().put("type", "object").put("properties", new JSONObject())));

            arr.put(new JSONObject()
                    .put("name", "list_models")
                    .put("description", "列出服务商可用模型。")
                    .put("inputSchema", new JSONObject()
                            .put("type", "object")
                            .put("properties", new JSONObject()
                                    .put("base_url", new JSONObject().put("type", "string"))
                                    .put("api_key", new JSONObject().put("type", "string")))
                            .put("required", new JSONArray().put("base_url"))));

            arr.put(new JSONObject()
                    .put("name", "generate_image")
                    .put("description", "调用 OpenAI 兼容接口生成图片，支持图生图。")
                    .put("inputSchema", new JSONObject()
                            .put("type", "object")
                            .put("properties", new JSONObject()
                                    .put("base_url", new JSONObject().put("type", "string"))
                                    .put("api_key", new JSONObject().put("type", "string"))
                                    .put("model", new JSONObject().put("type", "string"))
                                    .put("prompt", new JSONObject().put("type", "string"))
                                    .put("images", new JSONObject()
                                            .put("type", "array")
                                            .put("items", new JSONObject().put("type", "string")))
                                    .put("size", new JSONObject().put("type", "string")))
                            .put("required", new JSONArray().put("base_url").put("model").put("prompt"))));

            arr.put(new JSONObject()
                    .put("name", "build_prompt")
                    .put("description", "按 MiniMax H3 或 Qwen-Image 规范拼装提示词改写请求。")
                    .put("inputSchema", new JSONObject()
                            .put("type", "object")
                            .put("properties", new JSONObject()
                                    .put("skill", new JSONObject()
                                            .put("type", "string")
                                            .put("enum", new JSONArray().put("minimax").put("qwen")))
                                    .put("mode", new JSONObject().put("type", "string"))
                                    .put("lang", new JSONObject().put("type", "string"))
                                    .put("text", new JSONObject().put("type", "string"))
                                    .put("refs", new JSONObject()
                                            .put("type", "array")
                                            .put("items", new JSONObject().put("type", "string"))))
                            .put("required", new JSONArray().put("skill").put("text"))));
        } catch (Exception ignored) {
            // 结构固定
        }
        return arr;
    }

    /** 由请求 Host 头决定，保证局域网访问时返回可用的绝对地址 */
    private static final ThreadLocal<String> HOST_HEADER = new ThreadLocal<>();

    private String baseUrl() {
        String host = HOST_HEADER.get();
        if (host != null && !host.isEmpty()) {
            return "http://" + host;
        }
        return "http://127.0.0.1:" + port;
    }

    private Object callTool(String name, JSONObject args) throws Exception {
        switch (name) {
            case "search_references":
                return search(args);
            case "get_reference": {
                JSONObject rec = resolve(args.optString("ref", ""));
                if (rec == null) return new JSONObject().put("error", "未找到引用");
                return rec;
            }
            case "list_categories":
                return listCategories();
            case "list_models":
                return listModels(args);
            case "generate_image":
                return generateImageTool(args);
            case "build_prompt":
                return buildPrompt(args);
            default:
                return new JSONObject().put("error", "未知工具: " + name);
        }
    }

    private JSONObject search(JSONObject args) throws Exception {
        String lib = args.optString("library", "all");
        String q = args.optString("query", "").toLowerCase(Locale.US).trim();
        String cat = args.optString("category", "");
        String series = args.optString("series", "");
        String angle = args.optString("angle", "");
        int limit = args.optInt("limit", 20);

        JSONArray tagArr = args.optJSONArray("tags");
        String[] tags = new String[tagArr == null ? 0 : tagArr.length()];
        for (int i = 0; i < tags.length; i++) tags[i] = tagArr.optString(i);

        JSONArray results = new JSONArray();

        if (("all".equals(lib) || "costume".equals(lib))) {
            JSONArray items = index.getJSONObject("costume").getJSONArray("items");
            for (int i = 0; i < items.length() && results.length() < limit; i++) {
                JSONObject it = items.getJSONObject(i);
                if (!cat.isEmpty() && !cat.equals(it.optString("cat"))) continue;
                JSONArray itemTags = it.optJSONArray("tags");
                boolean hasAll = true;
                for (String t : tags) {
                    boolean found = false;
                    for (int j = 0; j < itemTags.length(); j++) {
                        if (t.equals(itemTags.optString(j))) {
                            found = true;
                            break;
                        }
                    }
                    if (!found) {
                        hasAll = false;
                        break;
                    }
                }
                if (!hasAll) continue;
                if (!q.isEmpty()) {
                    String hay = it.optString("id") + " " + itemTags.toString();
                    if (!hay.toLowerCase(Locale.US).contains(q)) continue;
                }
                results.put(costumeRecord(it));
            }
        }

        if (("all".equals(lib) || "pose".equals(lib)) && results.length() < limit) {
            JSONArray poses = index.getJSONObject("pose").getJSONArray("poses");
            for (int i = 0; i < poses.length() && results.length() < limit; i++) {
                JSONObject p = poses.getJSONObject(i);
                if (!series.isEmpty() && !series.equals(p.optString("series"))) continue;
                if (!cat.isEmpty() && !cat.equals(p.optString("cat"))) continue;
                if (!q.isEmpty()) {
                    String hay = (p.optString("pid") + " " + p.optString("name") + " "
                            + p.optString("nameZh")).toLowerCase(Locale.US);
                    if (!hay.contains(q)) continue;
                }
                JSONArray views = p.getJSONArray("views");
                for (int j = 0; j < views.length() && results.length() < limit; j++) {
                    JSONObject v = views.getJSONObject(j);
                    if (!angle.isEmpty() && !angle.equals(v.optString("ang"))) continue;
                    results.put(poseRecord(p, v));
                }
            }
        }

        return new JSONObject().put("count", results.length()).put("results", results);
    }

    private JSONObject costumeRecord(JSONObject it) throws Exception {
        String cat = it.optString("cat");
        String zh = cat;
        JSONArray cats = index.getJSONObject("costume").getJSONArray("cats");
        for (int i = 0; i < cats.length(); i++) {
            if (cat.equals(cats.getJSONObject(i).optString("slug"))) {
                zh = cats.getJSONObject(i).optString("zh");
                break;
            }
        }
        return new JSONObject()
                .put("ref", "costume:" + it.optString("id"))
                .put("kind", "costume")
                .put("id", it.optString("id"))
                .put("category", zh)
                .put("tags", it.optJSONArray("tags"))
                .put("thumb", baseUrl() + "/" + it.optString("thumb"))
                .put("image", baseUrl() + "/" + it.optString("mid"));
    }

    private JSONObject poseRecord(JSONObject p, JSONObject v) throws Exception {
        String cat = p.optString("cat");
        String catZh = cat;
        JSONArray cats = index.getJSONObject("pose").getJSONArray("cats");
        for (int i = 0; i < cats.length(); i++) {
            if (cat.equals(cats.getJSONObject(i).optString("slug"))) {
                catZh = cats.getJSONObject(i).optString("zh");
                break;
            }
        }
        String ser = p.optString("series");
        String serZh = ser;
        JSONArray seriesArr = index.getJSONObject("pose").getJSONArray("series");
        for (int i = 0; i < seriesArr.length(); i++) {
            if (ser.equals(seriesArr.getJSONObject(i).optString("slug"))) {
                serZh = seriesArr.getJSONObject(i).optString("zh");
                break;
            }
        }
        return new JSONObject()
                .put("ref", "pose:" + p.optString("id") + ":" + v.optString("ang"))
                .put("kind", "pose")
                .put("id", p.optString("id"))
                .put("pid", p.optString("pid"))
                .put("angle", v.optString("ang"))
                .put("angle_zh", v.optString("nameZh"))
                .put("name", p.optString("name"))
                .put("name_zh", p.optString("nameZh"))
                .put("series", serZh)
                .put("category", catZh)
                .put("thumb", baseUrl() + "/" + v.optString("thumb"))
                .put("image", baseUrl() + "/" + v.optString("full"));
    }

    private JSONObject resolve(String ref) throws Exception {
        String raw = ref.trim();
        if (raw.startsWith("costume:")) {
            String id = raw.substring(8);
            JSONArray items = index.getJSONObject("costume").getJSONArray("items");
            for (int i = 0; i < items.length(); i++) {
                JSONObject it = items.getJSONObject(i);
                if (id.equals(it.optString("id"))) return costumeRecord(it);
            }
            return null;
        }
        boolean isLine = raw.startsWith("pose-line:");
        if (isLine || raw.startsWith("pose:")) {
            String rest = isLine ? raw.substring(10) : raw.substring(5);
            int cut = rest.lastIndexOf(':');
            String id = cut > 0 ? rest.substring(0, cut) : rest;
            String ang = cut > 0 ? rest.substring(cut + 1) : "";
            JSONObject poseSrc = isLine && index.has("poseLine")
                    ? index.getJSONObject("poseLine") : index.getJSONObject("pose");
            JSONArray poses = poseSrc.getJSONArray("poses");
            for (int i = 0; i < poses.length(); i++) {
                JSONObject p = poses.getJSONObject(i);
                if (!id.equals(p.optString("id"))) continue;
                JSONArray views = p.getJSONArray("views");
                JSONObject v = views.getJSONObject(0);
                for (int j = 0; j < views.length(); j++) {
                    if (ang.equals(views.getJSONObject(j).optString("ang"))) {
                        v = views.getJSONObject(j);
                        break;
                    }
                }
                return poseRecord(p, v);
            }
        }
        return null;
    }

    private static String httpJson(String url, JSONObject payload, String apiKey, int timeoutMs)
            throws IOException {
        java.net.HttpURLConnection c = (java.net.HttpURLConnection) new java.net.URL(url).openConnection();
        c.setConnectTimeout(15000);
        c.setReadTimeout(timeoutMs);
        c.setRequestProperty("Content-Type", "application/json");
        if (apiKey != null && !apiKey.isEmpty()) {
            c.setRequestProperty("Authorization", "Bearer " + apiKey);
        }
        if (payload != null) {
            c.setDoOutput(true);
            c.getOutputStream().write(payload.toString().getBytes(UTF8));
        }
        int code = c.getResponseCode();
        InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        if (in != null) {
            byte[] tmp = new byte[16 * 1024];
            int n;
            while ((n = in.read(tmp)) > 0) buf.write(tmp, 0, n);
            in.close();
        }
        String body = new String(buf.toByteArray(), UTF8);
        if (code >= 400) throw new IOException("HTTP " + code + ": " + body);
        return body;
    }

    private Object listModels(JSONObject args) throws Exception {
        String base = args.optString("base_url", "").replaceAll("/+$", "");
        if (base.isEmpty()) return errorObj("缺少 base_url");
        String body = httpJson(base + "/v1/models", null, args.optString("api_key", ""), 30000);
        JSONArray items;
        String t = body.trim();
        if (t.startsWith("[")) {
            items = new JSONArray(t);
        } else {
            items = new JSONObject(t).optJSONArray("data");
            if (items == null) items = new JSONArray();
        }
        JSONArray out = new JSONArray();
        for (int i = 0; i < items.length(); i++) {
            JSONObject m = items.optJSONObject(i);
            if (m == null) continue;
            String id = m.optString("id", "");
            if (id.isEmpty()) continue;
            JSONObject caps = m.optJSONObject("capabilities");
            JSONArray outs = caps == null ? null : caps.optJSONArray("output_modalities");
            String kind;
            if (outs != null && outs.toString().contains("video")) kind = "video";
            else if (outs != null && outs.toString().contains("image")) kind = "image";
            else if ("image".equals(m.optString("type")) || "video".equals(m.optString("type")))
                kind = m.optString("type");
            else {
                String low = id.toLowerCase(Locale.US);
                kind = low.contains("seedream") || low.contains("image") ? "image"
                        : low.contains("video") ? "video" : "chat";
            }
            out.put(new JSONObject().put("id", id).put("name", m.optString("name", id)).put("kind", kind));
        }
        return new JSONObject().put("count", out.length()).put("models", out);
    }

    private Object generateImageTool(JSONObject args) {
        String base = args.optString("base_url", "").replaceAll("/+$", "");
        String model = args.optString("model", "");
        String prompt = args.optString("prompt", "");
        if (base.isEmpty() || model.isEmpty() || prompt.isEmpty()) {
            return errorObj("缺少 base_url / model / prompt");
        }
        try {
            JSONObject payload = new JSONObject()
                    .put("model", model)
                    .put("prompt", prompt)
                    .put("n", 1)
                    .put("response_format", "url");
            if (!args.optString("size", "").isEmpty()) payload.put("size", args.optString("size"));
            JSONArray imgs = args.optJSONArray("images");
            if (imgs != null && imgs.length() == 1) payload.put("image", imgs.optString(0));
            else if (imgs != null && imgs.length() > 1) payload.put("image", imgs);

            String body = httpJson(base + "/v1/images/generations", payload,
                    args.optString("api_key", ""), 300000);
            JSONArray data = new JSONObject(body).optJSONArray("data");
            JSONArray urls = new JSONArray();
            if (data != null) {
                for (int i = 0; i < data.length(); i++) {
                    JSONObject d = data.optJSONObject(i);
                    if (d == null) continue;
                    String u = d.optString("url", "");
                    if (u.isEmpty() && !d.optString("b64_json", "").isEmpty()) {
                        u = "data:image/png;base64," + d.optString("b64_json");
                    }
                    if (!u.isEmpty()) urls.put(u);
                }
            }
            return new JSONObject().put("count", urls.length()).put("images", urls);
        } catch (Exception e) {
            return errorObj(String.valueOf(e.getMessage()));
        }
    }

    private static JSONObject errorObj(String msg) {
        JSONObject o = new JSONObject();
        try {
            o.put("error", msg);
        } catch (Exception ignored) {
            // 固定结构
        }
        return o;
    }

    private JSONObject listCategories() throws Exception {
        JSONObject costume = index.getJSONObject("costume");
        JSONObject pose = index.getJSONObject("pose");
        return new JSONObject()
                .put("costume", new JSONObject()
                        .put("categories", costume.getJSONArray("cats"))
                        .put("tagGroups", costume.getJSONArray("groups"))
                        .put("total", costume.getJSONArray("items").length()))
                .put("pose", new JSONObject()
                        .put("series", pose.getJSONArray("series"))
                        .put("categories", pose.getJSONArray("cats"))
                        .put("angles", pose.getJSONArray("angOrder"))
                        .put("total", pose.getJSONArray("poses").length()));
    }

    private String buildPrompt(JSONObject args) throws Exception {
        if (skills == null) return "{\"error\":\"skills.json 缺失\"}";

        String skill = args.optString("skill", "qwen");
        String text = args.optString("text", "");
        JSONArray refs = args.optJSONArray("refs");

        StringBuilder refLines = new StringBuilder();
        if (refs != null) {
            for (int i = 0; i < refs.length(); i++) {
                JSONObject rec = resolve(refs.optString(i));
                if (rec != null) {
                    refLines.append(rec.optString("ref")).append('\t')
                            .append(rec.optString("id")).append('\t')
                            .append(rec.optString("image")).append('\n');
                }
            }
        }
        String refBlock = refLines.length() == 0 ? "（无）" : refLines.toString();

        if ("minimax".equals(skill)) {
            JSONObject mm = skills.getJSONObject("minimax");
            String mode = args.optString("mode", "t2va");
            String guide = "ref2va".equals(mode) ? mm.optString("refGuide") : mm.optString("guide");
            String label = mode;
            JSONArray modes = mm.optJSONArray("modes");
            if (modes != null) {
                for (int i = 0; i < modes.length(); i++) {
                    if (mode.equals(modes.getJSONObject(i).optString("id"))) {
                        label = modes.getJSONObject(i).optString("label");
                        break;
                    }
                }
            }
            return "# 任务：按 MiniMax H3 规范改写提示词\n# 模式：" + label
                    + "\n\n## 规范\n" + guide
                    + "\n\n## 参考素材\n" + refBlock
                    + "\n\n## 用户输入\n" + text
                    + "\n\n## 输出要求\n- 严格使用规范中的字段名、段落顺序与时间记法。\n"
                    + "- 重写正文用英文；对白、歌词、画面文字保留原语言。";
        }

        String lang = args.optString("lang", "zh");
        JSONArray variants = skills.getJSONObject("qwen").getJSONArray("variants");
        String prompt = variants.getJSONObject(0).optString("prompt");
        for (int i = 0; i < variants.length(); i++) {
            if (lang.equals(variants.getJSONObject(i).optString("lang"))) {
                prompt = variants.getJSONObject(i).optString("prompt");
                break;
            }
        }
        return "# 任务：按 Qwen-Image 规范改写图像提示词\n\n## 规范\n" + prompt
                + "\n\n## 参考素材\n" + refBlock
                + "\n\n## 用户输入\n" + text;
    }
}
