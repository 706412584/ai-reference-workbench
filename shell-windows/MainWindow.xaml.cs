using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using Microsoft.Web.WebView2.Core;

namespace Workbench;

public partial class MainWindow : Window
{
    private const string Host = "app.local";
    private readonly McpApi _mcpApi = new McpApi();

    public MainWindow()
    {
        InitializeComponent();
        Loaded += OnLoaded;
        Closing += (_, _) => NativeApi.Dispose();
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        var userData = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "ReferenceWorkbench", "WebView2");

        try
        {
            var env = await CoreWebView2Environment.CreateAsync(null, userData);
            await Web.EnsureCoreWebView2Async(env);

            var www = Path.Combine(AppContext.BaseDirectory, "www");
            if (!Directory.Exists(www))
            {
                MessageBox.Show($"找不到页面目录：{www}\n请先运行 npm run build。", "参考工作台",
                    MessageBoxButton.OK, MessageBoxImage.Error);
                Close();
                return;
            }

            Web.CoreWebView2.SetVirtualHostNameToFolderMapping(
                Host, www, CoreWebView2HostResourceAccessKind.Allow);

            var settings = Web.CoreWebView2.Settings;
            settings.AreDevToolsEnabled = false;
            settings.AreDefaultContextMenusEnabled = false;
            settings.IsStatusBarEnabled = false;
            settings.AreBrowserAcceleratorKeysEnabled = false;
            settings.IsSwipeNavigationEnabled = false;

            Web.CoreWebView2.AddHostObjectToScript("wbNative", new NativeApi());
            Web.CoreWebView2.AddHostObjectToScript("wbMcp", _mcpApi);
            Web.CoreWebView2.AddHostObjectToScript("wbLanIpValue", new LanIpApi());

            // 前端只认 window.__wbNative / __wbMcp，这里把 hostObjects 映射过去
            Web.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(@"
(function(){
  function sync(){
    if (!window.chrome || !chrome.webview || !chrome.webview.hostObjects) return false;
    var h = chrome.webview.hostObjects;
    var api = {
      platform: 'windows',
      saveImage: function(p, n){ return h.wbNative.SaveImage(p, n); },
      toast: function(m){ }
    };
    var mcp = {
      start: function(port, lan){ return h.wbMcp.Start(port, lan); },
      stop: function(){ return h.wbMcp.Stop(); },
      running: function(){ return h.wbMcp.Running(); },
      lanIp: function(){ return h.wbMcp.LanIp(); }
    };
    window.__wbNative = api;
    window.__wbMcp = mcp;
    window.__wbLanIpValue = { get: function(){ return h.wbLanIpValue.Get(); } };
    return true;
  }
  if (!sync()) {
    document.addEventListener('DOMContentLoaded', sync, { once: true });
  }
})();
");

            // 默认启动内置服务：生成功能依赖 /proxy
            _mcpApi.Start(7801, false);
            NativeApi.Track(_mcpApi);

            // 窗口标题随主题变化
            Web.CoreWebView2.DocumentTitleChanged += (_, _) => { };

            Web.Source = new Uri($"https://{Host}/index.html");
        }
        catch (Exception ex)
        {
            MessageBox.Show($"WebView2 初始化失败：{ex.Message}\n\n" +
                            "请确认已安装 Microsoft Edge WebView2 Runtime。",
                "参考工作台", MessageBoxButton.OK, MessageBoxImage.Error);
            Close();
        }
    }
}

/// <summary>暴露给 JS 的原生能力（通过 chrome.webview.hostObjects.wbNative 调用）。</summary>
public class NativeApi
{
    private static readonly List<McpApi> Servers = new();

    public static void Track(McpApi s) => Servers.Add(s);

    /// <summary>把图片复制到用户选择的目录；无对话框时落到“图片/参考工作台”。</summary>
    public string SaveImage(string relativePath, string filename)
    {
        try
        {
            var www = Path.Combine(AppContext.BaseDirectory, "www");
            var src = Path.GetFullPath(Path.Combine(www, relativePath.Replace('/', Path.DirectorySeparatorChar)));
            if (!src.StartsWith(Path.GetFullPath(www), StringComparison.OrdinalIgnoreCase))
                return "";
            if (!File.Exists(src)) return "";

            var dir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.MyPictures), "参考工作台");
            Directory.CreateDirectory(dir);

            var target = Path.Combine(dir, filename);
            File.Copy(src, target, true);
            return target;
        }
        catch
        {
            return "";
        }
    }

    public string Platform() => "windows";

    public void Toast(string message)
    {
        // 由前端 toast 呈现，这里保留接口
    }

    public static void Dispose()
    {
        foreach (var s in Servers) s.Stop();
        Servers.Clear();
    }
}

/// <summary>内置 MCP 服务（HttpListener）。</summary>
public class McpApi
{
    private HttpListener? _listener;
    private Thread? _thread;
    private int _port;

    public bool Start(int port, bool lan)
    {
        Stop();
        try
        {
            var prefix = lan ? $"http://+:{port}/" : $"http://127.0.0.1:{port}/";
            _listener = new HttpListener();
            _listener.Prefixes.Add(prefix);
            _listener.Start();
            _port = port;

            _thread = new Thread(() => Loop(_listener))
            {
                IsBackground = true,
                Name = "wb-mcp",
            };
            _thread.Start();
            return true;
        }
        catch
        {
            Stop();
            return false;
        }
    }

    public void Stop()
    {
        try { _listener?.Stop(); } catch { /* 忽略 */ }
        try { _listener?.Close(); } catch { /* 忽略 */ }
        _listener = null;
    }

    public bool Running() => _listener != null && _listener.IsListening;

    public string LanIp() => LanIpApi.Resolve();

    private void Loop(HttpListener listener)
    {
        while (listener.IsListening)
        {
            HttpListenerContext ctx;
            try
            {
                ctx = listener.GetContext();
            }
            catch
            {
                break;
            }
            ThreadPool.QueueUserWorkItem(_ => Handle(ctx, listener));
        }
    }

    private void Handle(HttpListenerContext ctx, HttpListener listener)
    {
        var req = ctx.Request;
        var res = ctx.Response;
        res.Headers["Access-Control-Allow-Origin"] = "*";
        res.Headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
        res.Headers["Access-Control-Allow-Headers"] = "Content-Type, Accept, Authorization, X-Target, X-Method";

        try
        {
            var path = req.Url?.AbsolutePath ?? "/";
            var host = req.Headers["Host"] ?? $"127.0.0.1:{_port}";
            var baseUrl = $"http://{host}";

            if (req.HttpMethod == "OPTIONS")
            {
                res.StatusCode = 204;
                res.Close();
                return;
            }

            if (req.HttpMethod == "GET" && (path == "/health" || path == "/"))
            {
                WriteJson(res, "{\"ok\":true,\"platform\":\"windows\",\"mcp\":\"/mcp\"}");
                return;
            }

            if (path == "/proxy")
            {
                Proxy(res, req, baseUrl);
                return;
            }

            if (req.HttpMethod == "GET" && path.StartsWith("/assets/"))
            {
                ServeAsset(res, path);
                return;
            }

            if (path == "/mcp" && req.HttpMethod == "GET")
            {
                WriteJson(res, "{\"protocolVersion\":\"2025-06-18\",\"note\":\"POST /mcp\"}");
                return;
            }

            if (path == "/mcp" && req.HttpMethod == "POST")
            {
                using var reader = new StreamReader(req.InputStream, Encoding.UTF8);
                var body = reader.ReadToEnd();
                var resp = JsonRpc.Handle(body, baseUrl);
                WriteJson(res, resp);
                return;
            }

            res.StatusCode = 404;
            WriteJson(res, "{\"error\":\"not found\"}");
        }
        catch (Exception ex)
        {
            try
            {
                WriteJson(res, "{\"error\":\"" + JsonRpc.Escape(ex.Message) + "\"}");
            }
            catch
            {
                // 连接已断开
            }
        }
    }

    /// <summary>同源代理：浏览器直连第三方网关会被 CORS 拦截，这里转发。</summary>
    private static void Proxy(HttpListenerResponse res, HttpListenerRequest req, string baseUrl)
    {
        var target = req.Headers["X-Target"];
        if (string.IsNullOrEmpty(target) ||
            !(target.StartsWith("http://") || target.StartsWith("https://")))
        {
            res.StatusCode = 400;
            WriteJson(res, "{\"error\":\"bad target\"}");
            return;
        }

        try
        {
            var method = req.Headers["X-Method"] ?? (req.HasEntityBody ? "POST" : "GET");
            var outReq = (HttpWebRequest)WebRequest.Create(target);
            outReq.Method = method;
            outReq.Timeout = 300000;
            outReq.ReadWriteTimeout = 300000;

            var ct = req.ContentType;
            if (!string.IsNullOrEmpty(ct)) outReq.ContentType = ct;
            var auth = req.Headers["Authorization"];
            if (!string.IsNullOrEmpty(auth)) outReq.Headers["Authorization"] = auth;

            if (req.HasEntityBody)
            {
                using var body = new MemoryStream();
                req.InputStream.CopyTo(body);
                var bytes = body.ToArray();
                outReq.ContentLength = bytes.Length;
                using var s = outReq.GetRequestStream();
                s.Write(bytes, 0, bytes.Length);
            }

            using var outRes = (HttpWebResponse)outReq.GetResponse();
            var data = ReadAll(outRes.GetResponseStream());
            res.StatusCode = (int)outRes.StatusCode;
            res.ContentType = outRes.ContentType ?? "application/json";
            res.ContentLength64 = data.Length;
            res.OutputStream.Write(data, 0, data.Length);
            res.Close();
        }
        catch (WebException we)
        {
            var data = we.Response != null ? ReadAll(we.Response.GetResponseStream()) : Array.Empty<byte>();
            res.StatusCode = we.Response is HttpWebResponse hr ? (int)hr.StatusCode : 502;
            res.ContentType = "application/json";
            res.ContentLength64 = data.Length;
            res.OutputStream.Write(data, 0, data.Length);
            res.Close();
        }
        catch (Exception ex)
        {
            res.StatusCode = 502;
            WriteJson(res, "{\"error\":\"" + JsonRpc.Escape(ex.Message) + "\"}");
        }
    }

    private static byte[] ReadAll(Stream s)
    {
        using var ms = new MemoryStream();
        s.CopyTo(ms);
        return ms.ToArray();
    }

    private static void ServeAsset(HttpListenerResponse res, string path)
    {
        var www = Path.Combine(AppContext.BaseDirectory, "www");
        var rel = Uri.UnescapeDataString(path.TrimStart('/'));
        var full = Path.GetFullPath(Path.Combine(www, rel.Replace('/', Path.DirectorySeparatorChar)));

        if (!full.StartsWith(Path.GetFullPath(www), StringComparison.OrdinalIgnoreCase) || !File.Exists(full))
        {
            res.StatusCode = 404;
            WriteJson(res, "{\"error\":\"not found\"}");
            return;
        }

        var ext = Path.GetExtension(full).ToLowerInvariant();
        res.ContentType = ext switch
        {
            ".webp" => "image/webp",
            ".png" => "image/png",
            ".jpg" or ".jpeg" => "image/jpeg",
            ".json" => "application/json",
            ".js" => "application/javascript",
            ".css" => "text/css",
            ".html" => "text/html",
            _ => "application/octet-stream",
        };
        res.Headers["Cache-Control"] = "public, max-age=31536000, immutable";

        var bytes = File.ReadAllBytes(full);
        res.ContentLength64 = bytes.Length;
        res.OutputStream.Write(bytes, 0, bytes.Length);
        res.Close();
    }

    private static void WriteJson(HttpListenerResponse res, string json)
    {
        var bytes = Encoding.UTF8.GetBytes(json);
        res.ContentType = "application/json; charset=utf-8";
        res.ContentLength64 = bytes.Length;
        res.OutputStream.Write(bytes, 0, bytes.Length);
        res.Close();
    }

}

public class LanIpApi
{
    public string Get() => Resolve();

    private static string _cached = "";
    public static string Resolve()
    {
        if (_cached.Length > 0) return _cached;
        try
        {
            using var s = new Socket(AddressFamily.InterNetwork, SocketType.Dgram, ProtocolType.Udp);
            s.Connect("8.8.8.8", 80);
            if (s.LocalEndPoint is IPEndPoint ep) _cached = ep.Address.ToString();
        }
        catch
        {
            // 忽略
        }
        return _cached;
    }
}
