# -*- coding: utf-8 -*-
"""只读 MCP 服务：把工作台索引暴露给外部 AI。

传输：HTTP + JSON-RPC 2.0（MCP Streamable HTTP 的最简子集）。
端点：POST /mcp     GET /mcp（SSE 通知，可选）
      GET  /assets/...  直接取图
      GET  /health

工具：
  search_references  按关键词 / 标签 / 分类检索
  get_reference      按引用取单条（含图片 URL）
  list_categories    列出分类与标签
  build_prompt       按技能规范拼装改写请求

用法：
  python tools/mcp_server.py --port 7801 --lan
"""
import argparse
import json
import os
import socket
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, unquote

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sources import PUBLIC  # noqa: E402

INDEX_PATH = os.path.join(PUBLIC, "data", "index.json")
SKILLS_PATH = os.path.join(PUBLIC, "data", "skills.json")

_state = {}
_lock = threading.Lock()

PROTOCOL_VERSION = "2025-06-18"


def load_data():
    with _lock:
        if "index" not in _state:
            with open(INDEX_PATH, encoding="utf-8") as f:
                _state["index"] = json.load(f)
            if os.path.exists(SKILLS_PATH):
                with open(SKILLS_PATH, encoding="utf-8") as f:
                    _state["skills"] = json.load(f)
            else:
                _state["skills"] = None
        return _state["index"], _state["skills"]


TOOLS = [
    {
        "name": "search_references",
        "description": "在服装与深度姿势参考库中检索。返回引用 ID、标题与可直接访问的图片 URL。",
        "inputSchema": {
            "type": "object",
            "properties": {
                "library": {"type": "string", "enum": ["costume", "pose", "all"], "default": "all"},
                "query": {"type": "string", "description": "编号 / 名称 / 标签关键词"},
                "category": {"type": "string", "description": "分类 slug，例如 c01"},
                "tags": {"type": "array", "items": {"type": "string"}, "description": "服装标签，AND 逻辑"},
                "series": {"type": "string", "description": "姿势系列 slug，例如 full-sexy"},
                "angle": {"type": "string", "description": "姿势视角：front/side/diag/high/low"},
                "limit": {"type": "integer", "default": 20, "minimum": 1, "maximum": 100},
            },
        },
    },
    {
        "name": "get_reference",
        "description": "按引用取单条记录。引用格式 costume:SPR-0001 或 pose:full-sexy/P001:front。",
        "inputSchema": {
            "type": "object",
            "properties": {"ref": {"type": "string"}},
            "required": ["ref"],
        },
    },
    {
        "name": "list_categories",
        "description": "列出服装分类、服装标签分组、姿势系列与姿势分类。",
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "list_models",
        "description": "列出已配置服务商可用的模型（文本 / 图片 / 视频）。",
        "inputSchema": {
            "type": "object",
            "properties": {
                "base_url": {"type": "string", "description": "OpenAI 兼容服务地址，例如 http://192.168.1.3:17990"},
                "api_key": {"type": "string", "description": "可选 API Key"},
            },
            "required": ["base_url"],
        },
    },
    {
        "name": "generate_image",
        "description": "调用 OpenAI 兼容 /v1/images/generations 生成图片。支持文生图与图生图（参考图可为 URL 或 base64）。返回图片 URL。",
        "inputSchema": {
            "type": "object",
            "properties": {
                "base_url": {"type": "string"},
                "api_key": {"type": "string"},
                "model": {"type": "string", "description": "图片模型，例如 doubao-seedream-5-lite"},
                "prompt": {"type": "string"},
                "negative_prompt": {"type": "string"},
                "images": {"type": "array", "items": {"type": "string"}, "description": "参考图 URL 或 data URL，最多 4 张"},
                "size": {"type": "string", "description": "例如 1024x1024"},
            },
            "required": ["base_url", "model", "prompt"],
        },
    },
    {
        "name": "build_prompt",
        "description": "按 MiniMax H3 或 Qwen-Image 规范拼装提示词改写请求。",
        "inputSchema": {
            "type": "object",
            "properties": {
                "skill": {"type": "string", "enum": ["minimax", "qwen"]},
                "mode": {"type": "string", "description": "MiniMax 模式：t2va/i2va/fl2va/l2va/ref2va"},
                "lang": {"type": "string", "enum": ["zh", "en"], "default": "zh"},
                "text": {"type": "string", "description": "用户原始描述"},
                "refs": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["skill", "text"],
        },
    },
]


def abs_url(path, base):
    return base.rstrip("/") + "/" + path.lstrip("./")


def resolve(ref, index):
    raw = (ref or "").strip()
    if raw.startswith("costume:"):
        cid = raw[8:]
        for it in index["costume"]["items"]:
            if it["id"] == cid:
                return costume_record(it, index)
        return None
    is_line = raw.startswith("pose-line:")
    if is_line or raw.startswith("pose:"):
        rest = raw[10:] if is_line else raw[5:]
        cut = rest.rfind(":")
        pid = rest[:cut] if cut > 0 else rest
        ang = rest[cut + 1:] if cut > 0 else ""
        # 线稿库缺 poseLine 时回退深度库（同 id 同姿势，仅图源不同）
        src = index.get("poseLine") or index["pose"] if is_line else index["pose"]
        for p in src["poses"]:
            if p["id"] == pid:
                v = next((x for x in p["views"] if x["ang"] == ang), p["views"][0])
                rec = pose_record(p, v, index)
                rec["variant"] = "line" if is_line else "depth"
                return rec
        return None
    return None


def costume_record(it, index, base=""):
    cat = next((c for c in index["costume"]["cats"] if c["slug"] == it["cat"]), None)
    return {
        "ref": "costume:" + it["id"],
        "kind": "costume",
        "id": it["id"],
        "category": cat["zh"] if cat else it["cat"],
        "tags": it["tags"],
        "thumb": abs_url(it["thumb"], base) if base else it["thumb"],
        "image": abs_url(it["mid"], base) if base else it["mid"],
    }


def pose_record(p, v, index, base=""):
    cat = next((c for c in index["pose"]["cats"] if c["slug"] == p["cat"]), None)
    ser = next((s for s in index["pose"]["series"] if s["slug"] == p["series"]), None)
    return {
        "ref": "pose:%s:%s" % (p["id"], v["ang"]),
        "kind": "pose",
        "id": p["id"],
        "pid": p["pid"],
        "angle": v["ang"],
        "angle_zh": v["nameZh"],
        "name": p["name"],
        "name_zh": p["nameZh"],
        "series": ser["zh"] if ser else p["series"],
        "category": cat["zh"] if cat else p["cat"],
        "thumb": abs_url(v["thumb"], base) if base else v["thumb"],
        "image": abs_url(v["full"], base) if base else v["full"],
    }


def tool_search(args, index, base):
    lib = args.get("library", "all")
    q = (args.get("query") or "").strip().lower()
    cat = args.get("category")
    tags = args.get("tags") or []
    series = args.get("series")
    angle = args.get("angle")
    limit = int(args.get("limit", 20))

    out = []
    if lib in ("costume", "all"):
        for it in index["costume"]["items"]:
            if cat and it["cat"] != cat:
                continue
            if tags and any(t not in it["tags"] for t in tags):
                continue
            if q:
                hay = " ".join([it["id"]] + it["tags"]).lower()
                if q not in hay:
                    continue
            out.append(costume_record(it, index, base))
            if len(out) >= limit:
                break

    if lib in ("pose", "all") and len(out) < limit:
        for p in index["pose"]["poses"]:
            if series and p["series"] != series:
                continue
            if cat and p["cat"] != cat:
                continue
            if q:
                hay = " ".join([p["pid"], p["name"], p["nameZh"]]).lower()
                if q not in hay:
                    continue
            views = p["views"]
            if angle:
                views = [v for v in views if v["ang"] == angle]
            for v in views:
                out.append(pose_record(p, v, index, base))
                if len(out) >= limit:
                    break
            if len(out) >= limit:
                break

    return {"count": len(out), "results": out}


def tool_categories(index):
    return {
        "costume": {
            "categories": index["costume"]["cats"],
            "tagGroups": index["costume"]["groups"],
            "tagZh": index["costume"]["tagZh"],
            "total": len(index["costume"]["items"]),
        },
        "pose": {
            "series": index["pose"]["series"],
            "categories": index["pose"]["cats"],
            "angles": index["pose"]["angOrder"],
            "total": len(index["pose"]["poses"]),
        },
    }


def tool_build_prompt(args, skills, index, base):
    if not skills:
        return {"error": "skills.json 未生成，请先运行 tools/extract_skills.py"}
    skill = args.get("skill")
    text = args.get("text", "")
    refs = args.get("refs") or []

    ref_lines = []
    for r in refs:
        rec = resolve(r, index)
        if rec:
            ref_lines.append("%s\t%s\t%s" % (rec["ref"], rec.get("id", ""), abs_url(rec["image"], base)))

    if skill == "minimax":
        mode = args.get("mode", "t2va")
        m = next((x for x in skills["minimax"]["modes"] if x["id"] == mode), None)
        guide = skills["minimax"]["refGuide"] if mode == "ref2va" else skills["minimax"]["guide"]
        body = "\n".join([
            "# 任务：按 MiniMax H3 规范改写提示词",
            "# 模式：%s%s" % (m["label"] if m else mode, (" — " + m["desc"]) if m else ""),
            "",
            "## 规范",
            guide,
            "",
            "## 参考素材",
            "\n".join(ref_lines) if ref_lines else "（无）",
            "",
            "## 用户输入",
            text,
            "",
            "## 输出要求",
            "- 严格使用规范中的字段名、段落顺序与时间记法。",
            "- 重写正文用英文；对白、歌词、画面文字保留原语言。",
        ])
        return {"prompt": body}

    lang = args.get("lang", "zh")
    variant = next((v for v in skills["qwen"]["variants"] if v["lang"] == lang),
                   skills["qwen"]["variants"][0])
    body = "\n".join([
        "# 任务：按 Qwen-Image 规范改写图像提示词",
        "",
        "## 规范",
        variant["prompt"],
        "",
        "## 参考素材",
        "\n".join(ref_lines) if ref_lines else "（无）",
        "",
        "## 用户输入",
        text,
    ])
    return {"prompt": body}


def _http_json(url, payload=None, api_key="", timeout=300):
    import urllib.request as _rq
    import urllib.error as _err

    data = json.dumps(payload, ensure_ascii=False).encode("utf-8") if payload is not None else None
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = "Bearer " + api_key
    req = _rq.Request(url, data=data, headers=headers,
                      method="POST" if data is not None else "GET")
    try:
        with _rq.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8"))
    except _err.HTTPError as e:
        body = e.read().decode("utf-8", "replace")
        raise RuntimeError("HTTP %d: %s" % (e.code, body[:400]))


def tool_list_models(args):
    base = (args.get("base_url") or "").rstrip("/")
    if not base:
        return {"error": "缺少 base_url"}
    raw = _http_json(base + "/v1/models", api_key=args.get("api_key") or "", timeout=30)
    items = raw if isinstance(raw, list) else raw.get("data") or []
    out = []
    for m in items:
        mid = str(m.get("id") or "")
        if not mid:
            continue
        caps = m.get("capabilities") or {}
        outs = caps.get("output_modalities") or []
        typ = str(m.get("type") or "").lower()
        if "video" in outs:
            kind = "video"
        elif "image" in outs:
            kind = "image"
        elif typ in ("image", "video"):
            kind = typ
        else:
            low = mid.lower()
            kind = "image" if any(k in low for k in ("seedream", "image", "flux", "imagen")) else (
                "video" if any(k in low for k in ("video", "veo", "kling", "sora")) else "chat")
        out.append({"id": mid, "name": m.get("name"), "kind": kind})
    return {"count": len(out), "models": out}


def tool_generate_image(args):
    base = (args.get("base_url") or "").rstrip("/")
    model = args.get("model")
    prompt = args.get("prompt")
    if not base or not model or not prompt:
        return {"error": "缺少 base_url / model / prompt"}

    payload = {
        "model": model,
        "prompt": prompt,
        "n": 1,
        "response_format": "url",
    }
    if args.get("negative_prompt"):
        payload["negative_prompt"] = args["negative_prompt"]
    if args.get("size"):
        payload["size"] = args["size"]
    imgs = args.get("images") or []
    if len(imgs) == 1:
        payload["image"] = imgs[0]
    elif len(imgs) > 1:
        payload["image"] = imgs[:4]

    try:
        raw = _http_json(base + "/v1/images/generations", payload, args.get("api_key") or "")
    except Exception as e:  # noqa: BLE001
        return {"error": str(e)}
    data = raw.get("data") or []
    urls = [d.get("url") or ("data:image/png;base64," + d["b64_json"] if d.get("b64_json") else "")
            for d in data]
    return {"count": len(urls), "images": [u for u in urls if u]}


def call_tool(name, args, base):
    index, skills = load_data()
    if name == "search_references":
        return tool_search(args, index, base)
    if name == "get_reference":
        rec = resolve(args.get("ref", ""), index)
        if not rec:
            return {"error": "未找到引用"}
        rec["thumb"] = abs_url(rec["thumb"], base)
        rec["image"] = abs_url(rec["image"], base)
        return rec
    if name == "list_categories":
        return tool_categories(index)
    if name == "list_models":
        return tool_list_models(args)
    if name == "generate_image":
        return tool_generate_image(args)
    if name == "build_prompt":
        return tool_build_prompt(args, skills, index, base)
    raise KeyError("未知工具: %s" % name)


class Handler(BaseHTTPRequestHandler):
    server_version = "WorkbenchMCP/1.0"

    def log_message(self, fmt, *args):  # 安静一点
        if os.environ.get("WB_MCP_VERBOSE"):
            sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    # ── CORS ──
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header(
            "Access-Control-Allow-Headers",
            "Content-Type, Accept, Mcp-Session-Id, Authorization, X-Target, X-Method",
        )

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("X-Proxy", "ok")
        self._cors()
        self.end_headers()

    def _json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def _base_url(self):
        host = self.headers.get("Host") or "127.0.0.1"
        return "http://" + host

    def do_GET(self):
        path = urlparse(self.path).path

        if path in ("/health", "/"):
            index, _ = load_data()
            self._json(200, {
                "ok": True,
                "costume": len(index["costume"]["items"]),
                "pose": len(index["pose"]["poses"]),
                "mcp": "/mcp",
            })
            return

        if path.startswith("/assets/"):
            rel = unquote(path.lstrip("/"))
            full = os.path.normpath(os.path.join(PUBLIC, rel))
            if not full.startswith(os.path.normpath(PUBLIC)) or not os.path.isfile(full):
                self._json(404, {"error": "not found"})
                return
            ext = os.path.splitext(full)[1].lower()
            mime = {
                ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg",
                ".json": "application/json", ".js": "application/javascript",
                ".css": "text/css", ".html": "text/html",
            }.get(ext, "application/octet-stream")
            with open(full, "rb") as f:
                data = f.read()
            self.send_response(200)
            self.send_header("Content-Type", mime)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "public, max-age=31536000, immutable")
            self._cors()
            self.end_headers()
            self.wfile.write(data)
            return

        if path == "/proxy":
            self._proxy()
            return

        if path == "/mcp":
            # 简化：GET 不建立 SSE 流，只回能力说明
            self._json(200, {
                "protocolVersion": PROTOCOL_VERSION,
                "transport": "streamable-http",
                "note": "请使用 POST /mcp 发送 JSON-RPC 请求",
                "tools": [t["name"] for t in TOOLS],
            })
            return

        self._json(404, {"error": "not found"})

    def _proxy(self):
        """同源代理：浏览器直连第三方网关会被缺 CORS 头拦截，
        这里由本机服务转发，保持与页面同源。"""
        import urllib.request as _rq
        import urllib.error as _err

        target = self.headers.get("X-Target")
        if not target:
            self._json(400, {"error": "missing X-Target"})
            return
        if not (target.startswith("http://") or target.startswith("https://")):
            self._json(400, {"error": "invalid target"})
            return

        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length else None
        method = self.headers.get("X-Method") or ("POST" if body else "GET")

        hdrs = {}
        for k in ("Content-Type", "Authorization"):
            v = self.headers.get(k)
            if v:
                hdrs[k] = v

        req = _rq.Request(target, data=body, headers=hdrs, method=method)
        try:
            with _rq.urlopen(req, timeout=180) as resp:
                data = resp.read()
                self.send_response(200)
                self.send_header("Content-Type", resp.headers.get("Content-Type", "application/json"))
                self.send_header("Content-Length", str(len(data)))
                self._cors()
                self.end_headers()
                self.wfile.write(data)
        except _err.HTTPError as e:
            data = e.read()
            self.send_response(e.code)
            self.send_header("Content-Type", e.headers.get("Content-Type", "application/json"))
            self.send_header("Content-Length", str(len(data)))
            self._cors()
            self.end_headers()
            self.wfile.write(data)
        except Exception as e:  # noqa: BLE001
            self._json(502, {"error": str(e)})

    def do_POST(self):
        path = urlparse(self.path).path
        if path == "/proxy":
            self._proxy()
            return
        if path != "/mcp":
            self._json(404, {"error": "not found"})
            return

        try:
            length = int(self.headers.get("Content-Length") or 0)
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
        except Exception:
            self._json(400, {"jsonrpc": "2.0", "id": None,
                             "error": {"code": -32700, "message": "Parse error"}})
            return

        base = self._base_url()
        is_batch = isinstance(payload, list)
        items = payload if is_batch else [payload]
        out = [self._handle_one(it, base) for it in items]
        self._json(200, out if is_batch else out[0])

    def _handle_one(self, req, base):
        rid = req.get("id")
        method = req.get("method")
        params = req.get("params") or {}

        def ok(result):
            return {"jsonrpc": "2.0", "id": rid, "result": result}

        def err(code, msg):
            return {"jsonrpc": "2.0", "id": rid, "error": {"code": code, "message": msg}}

        if method == "initialize":
            return ok({
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": {"tools": {"listChanged": False}},
                "serverInfo": {"name": "ai-reference-workbench", "version": "0.1.0"},
            })

        if method in ("notifications/initialized", "initialized"):
            return ok({})

        if method == "ping":
            return ok({})

        if method == "tools/list":
            return ok({"tools": TOOLS})

        if method == "tools/call":
            name = params.get("name")
            args = params.get("arguments") or {}
            try:
                result = call_tool(name, args, base)
            except KeyError as e:
                return err(-32601, str(e))
            except Exception as e:  # noqa: BLE001
                return err(-32603, "工具执行失败: %s" % e)
            return ok({
                "content": [{"type": "text", "text": json.dumps(result, ensure_ascii=False, indent=1)}],
                "isError": False,
            })

        if method == "resources/list":
            return ok({"resources": []})

        return err(-32601, "Method not found: %s" % method)


def lan_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return ""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=7801)
    ap.add_argument("--host", default=None)
    ap.add_argument("--lan", action="store_true", help="绑定 0.0.0.0，允许局域网访问")
    args = ap.parse_args()

    host = args.host or ("0.0.0.0" if args.lan else "127.0.0.1")
    load_data()

    httpd = ThreadingHTTPServer((host, args.port), Handler)
    ip = lan_ip() if host == "0.0.0.0" else "127.0.0.1"
    print("MCP 端点: http://%s:%d/mcp" % (ip, args.port), flush=True)
    print("健康检查: http://%s:%d/health" % (ip, args.port), flush=True)
    print("图片目录: %s" % os.path.join(PUBLIC, "assets"), flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
