using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Workbench;

/// <summary>MCP JSON-RPC 处理，与 tools/mcp_server.py 保持同一套工具语义。</summary>
public static class JsonRpc
{
    private const string Protocol = "2025-06-18";
    private static readonly string[] Modalities = { "image" };

    private static JsonNode? _index;
    private static JsonNode? _skills;
    private static readonly object Gate = new();

    private static string Www => Path.Combine(AppContext.BaseDirectory, "www");

    private static JsonNode? Load(string name)
    {
        var path = Path.Combine(Www, "data", name);
        if (!File.Exists(path)) return null;
        return JsonNode.Parse(File.ReadAllText(path, Encoding.UTF8));
    }

    private static void EnsureData()
    {
        lock (Gate)
        {
            _index ??= Load("index.json");
            _skills ??= Load("skills.json");
        }
    }

    public static string Handle(string body, string baseUrl)
    {
        EnsureData();
        try
        {
            var node = JsonNode.Parse(body);
            if (node is JsonArray arr)
            {
                var outArr = new JsonArray();
                foreach (var item in arr)
                {
                    outArr.Add(HandleOne(item as JsonObject, baseUrl));
                }
                return outArr.ToJsonString();
            }
            return HandleOne(node as JsonObject, baseUrl).ToJsonString();
        }
        catch
        {
            return Error(null, -32700, "Parse error").ToJsonString();
        }
    }

    private static JsonObject HandleOne(JsonObject? req, string baseUrl)
    {
        if (req == null) return Error(null, -32600, "Invalid Request");

        var id = req["id"]?.DeepClone();
        var method = req["method"]?.GetValue<string>() ?? "";
        var paramsNode = req["params"] as JsonObject ?? new JsonObject();
        var args = paramsNode["arguments"] as JsonObject ?? new JsonObject();

        switch (method)
        {
            case "initialize":
                return Ok(id, new JsonObject
                {
                    ["protocolVersion"] = Protocol,
                    ["capabilities"] = new JsonObject
                    {
                        ["tools"] = new JsonObject { ["listChanged"] = false },
                    },
                    ["serverInfo"] = new JsonObject
                    {
                        ["name"] = "ai-reference-workbench",
                        ["version"] = "0.1.0",
                    },
                });

            case "notifications/initialized":
            case "initialized":
            case "ping":
                return Ok(id, new JsonObject());

            case "tools/list":
                return Ok(id, new JsonObject { ["tools"] = Tools() });

            case "tools/call":
            {
                var name = paramsNode["name"]?.GetValue<string>() ?? "";
                var toolArgs = args;
                JsonNode result;
                try
                {
                    result = CallTool(name, toolArgs, baseUrl);
                }
                catch (Exception ex)
                {
                    return Error(id, -32603, "工具执行失败: " + ex.Message);
                }
                return Ok(id, new JsonObject
                {
                    ["content"] = new JsonArray
                    {
                        new JsonObject
                        {
                            ["type"] = "text",
                            ["text"] = result.ToJsonString(),
                        },
                    },
                    ["isError"] = false,
                });
            }

            case "resources/list":
                return Ok(id, new JsonObject { ["resources"] = new JsonArray() });

            default:
                return Error(id, -32601, "Method not found: " + method);
        }
    }

    private static JsonArray Tools() => new()
    {
        new JsonObject
        {
            ["name"] = "search_references",
            ["description"] = "在服装与深度姿势参考库中检索，返回引用 ID 与图片 URL。",
            ["inputSchema"] = new JsonObject
            {
                ["type"] = "object",
                ["properties"] = new JsonObject
                {
                    ["library"] = new JsonObject { ["type"] = "string" },
                    ["query"] = new JsonObject { ["type"] = "string" },
                    ["category"] = new JsonObject { ["type"] = "string" },
                    ["tags"] = new JsonObject { ["type"] = "array" },
                    ["series"] = new JsonObject { ["type"] = "string" },
                    ["angle"] = new JsonObject { ["type"] = "string" },
                    ["limit"] = new JsonObject { ["type"] = "integer" },
                },
            },
        },
        new JsonObject
        {
            ["name"] = "get_reference",
            ["description"] = "按引用取单条记录，例如 costume:SPR-0001。",
            ["inputSchema"] = new JsonObject
            {
                ["type"] = "object",
                ["properties"] = new JsonObject { ["ref"] = new JsonObject { ["type"] = "string" } },
                ["required"] = new JsonArray("ref"),
            },
        },
        new JsonObject
        {
            ["name"] = "list_categories",
            ["description"] = "列出服装分类、标签分组、姿势系列与分类。",
            ["inputSchema"] = new JsonObject { ["type"] = "object" },
        },
        new JsonObject
        {
            ["name"] = "list_models",
            ["description"] = "列出服务商可用模型。",
            ["inputSchema"] = new JsonObject
            {
                ["type"] = "object",
                ["properties"] = new JsonObject
                {
                    ["base_url"] = new JsonObject { ["type"] = "string" },
                    ["api_key"] = new JsonObject { ["type"] = "string" },
                },
                ["required"] = new JsonArray("base_url"),
            },
        },
        new JsonObject
        {
            ["name"] = "generate_image",
            ["description"] = "调用 OpenAI 兼容接口生成图片，支持图生图。",
            ["inputSchema"] = new JsonObject
            {
                ["type"] = "object",
                ["properties"] = new JsonObject
                {
                    ["base_url"] = new JsonObject { ["type"] = "string" },
                    ["api_key"] = new JsonObject { ["type"] = "string" },
                    ["model"] = new JsonObject { ["type"] = "string" },
                    ["prompt"] = new JsonObject { ["type"] = "string" },
                    ["images"] = new JsonObject { ["type"] = "array" },
                    ["size"] = new JsonObject { ["type"] = "string" },
                },
                ["required"] = new JsonArray("base_url", "model", "prompt"),
            },
        },
        new JsonObject
        {
            ["name"] = "build_prompt",
            ["description"] = "按 MiniMax H3 或 Qwen-Image 规范拼装提示词改写请求。",
            ["inputSchema"] = new JsonObject
            {
                ["type"] = "object",
                ["properties"] = new JsonObject
                {
                    ["skill"] = new JsonObject { ["type"] = "string" },
                    ["mode"] = new JsonObject { ["type"] = "string" },
                    ["lang"] = new JsonObject { ["type"] = "string" },
                    ["text"] = new JsonObject { ["type"] = "string" },
                    ["refs"] = new JsonObject { ["type"] = "array" },
                },
                ["required"] = new JsonArray("skill", "text"),
            },
        },
    };

    private static JsonNode CallTool(string name, JsonObject args, string baseUrl)
    {
        var index = _index ?? throw new InvalidOperationException("index.json 未加载");
        switch (name)
        {
            case "search_references":
                return Search(args, index, baseUrl);
            case "get_reference":
                return Resolve(args["ref"]?.GetValue<string>() ?? "", index, baseUrl)
                       ?? new JsonObject { ["error"] = "未找到引用" };
            case "list_categories":
                return ListCategories(index);
            case "list_models":
                return ListModels(args);
            case "generate_image":
                return GenerateImageTool(args);
            case "build_prompt":
                return BuildPrompt(args, index, baseUrl);
            default:
                return new JsonObject { ["error"] = "未知工具: " + name };
        }
    }

    private static JsonObject Search(JsonObject args, JsonNode index, string baseUrl)
    {
        var lib = args["library"]?.GetValue<string>() ?? "all";
        var query = (args["query"]?.GetValue<string>() ?? "").ToLowerInvariant().Trim();
        var cat = args["category"]?.GetValue<string>() ?? "";
        var series = args["series"]?.GetValue<string>() ?? "";
        var angle = args["angle"]?.GetValue<string>() ?? "";
        var limit = args["limit"]?.GetValue<int>() ?? 20;

        var tags = new List<string>();
        if (args["tags"] is JsonArray tagArr)
        {
            foreach (var t in tagArr)
            {
                if (t != null) tags.Add(t.GetValue<string>());
            }
        }

        var results = new JsonArray();

        if (lib is "all" or "costume")
        {
            var items = index["costume"]?["items"] as JsonArray;
            if (items != null)
            {
                foreach (var node in items)
                {
                    if (results.Count >= limit) break;
                    if (node is not JsonObject it) continue;
                    if (cat.Length > 0 && (it["cat"]?.GetValue<string>() ?? "") != cat) continue;

                    var itemTags = new List<string>();
                    if (it["tags"] is JsonArray its)
                    {
                        foreach (var t in its) if (t != null) itemTags.Add(t.GetValue<string>());
                    }
                    if (tags.Exists(t => !itemTags.Contains(t))) continue;

                    if (query.Length > 0)
                    {
                        var hay = ((it["id"]?.GetValue<string>() ?? "") + " " +
                                   string.Join(" ", itemTags)).ToLowerInvariant();
                        if (!hay.Contains(query)) continue;
                    }
                    results.Add(CostumeRecord(it, index, baseUrl));
                }
            }
        }

        if (lib is "all" or "pose" && results.Count < limit)
        {
            var poses = index["pose"]?["poses"] as JsonArray;
            if (poses != null)
            {
                foreach (var node in poses)
                {
                    if (results.Count >= limit) break;
                    if (node is not JsonObject p) continue;
                    if (series.Length > 0 && (p["series"]?.GetValue<string>() ?? "") != series) continue;
                    if (cat.Length > 0 && (p["cat"]?.GetValue<string>() ?? "") != cat) continue;

                    if (query.Length > 0)
                    {
                        var hay = ((p["pid"]?.GetValue<string>() ?? "") + " " +
                                   (p["name"]?.GetValue<string>() ?? "") + " " +
                                   (p["nameZh"]?.GetValue<string>() ?? "")).ToLowerInvariant();
                        if (!hay.Contains(query)) continue;
                    }

                    if (p["views"] is JsonArray views)
                    {
                        foreach (var vn in views)
                        {
                            if (results.Count >= limit) break;
                            if (vn is not JsonObject v) continue;
                            if (angle.Length > 0 && (v["ang"]?.GetValue<string>() ?? "") != angle) continue;
                            results.Add(PoseRecord(p, v, index, baseUrl));
                        }
                    }
                }
            }
        }

        return new JsonObject { ["count"] = results.Count, ["results"] = results };
    }

    private static JsonObject CostumeRecord(JsonObject it, JsonNode index, string baseUrl)
    {
        var cat = it["cat"]?.GetValue<string>() ?? "";
        var zh = cat;
        if (index["costume"]?["cats"] is JsonArray cats)
        {
            foreach (var c in cats)
            {
                if (c?["slug"]?.GetValue<string>() == cat)
                {
                    zh = c["zh"]?.GetValue<string>() ?? cat;
                    break;
                }
            }
        }
        return new JsonObject
        {
            ["ref"] = "costume:" + (it["id"]?.GetValue<string>() ?? ""),
            ["kind"] = "costume",
            ["id"] = it["id"]?.GetValue<string>() ?? "",
            ["category"] = zh,
            ["tags"] = it["tags"]?.DeepClone(),
            ["thumb"] = baseUrl + "/" + (it["thumb"]?.GetValue<string>() ?? ""),
            ["image"] = baseUrl + "/" + (it["mid"]?.GetValue<string>() ?? ""),
        };
    }

    private static JsonObject PoseRecord(JsonObject p, JsonObject v, JsonNode index, string baseUrl)
    {
        var cat = p["cat"]?.GetValue<string>() ?? "";
        var catZh = cat;
        if (index["pose"]?["cats"] is JsonArray cats)
        {
            foreach (var c in cats)
            {
                if (c?["slug"]?.GetValue<string>() == cat)
                {
                    catZh = c["zh"]?.GetValue<string>() ?? cat;
                    break;
                }
            }
        }
        var ser = p["series"]?.GetValue<string>() ?? "";
        var serZh = ser;
        if (index["pose"]?["series"] is JsonArray seriesArr)
        {
            foreach (var s in seriesArr)
            {
                if (s?["slug"]?.GetValue<string>() == ser)
                {
                    serZh = s["zh"]?.GetValue<string>() ?? ser;
                    break;
                }
            }
        }
        return new JsonObject
        {
            ["ref"] = "pose:" + (p["id"]?.GetValue<string>() ?? "") + ":" + (v["ang"]?.GetValue<string>() ?? ""),
            ["kind"] = "pose",
            ["id"] = p["id"]?.GetValue<string>() ?? "",
            ["pid"] = p["pid"]?.GetValue<string>() ?? "",
            ["angle"] = v["ang"]?.GetValue<string>() ?? "",
            ["angle_zh"] = v["nameZh"]?.GetValue<string>() ?? "",
            ["name"] = p["name"]?.GetValue<string>() ?? "",
            ["name_zh"] = p["nameZh"]?.GetValue<string>() ?? "",
            ["series"] = serZh,
            ["category"] = catZh,
            ["thumb"] = baseUrl + "/" + (v["thumb"]?.GetValue<string>() ?? ""),
            ["image"] = baseUrl + "/" + (v["full"]?.GetValue<string>() ?? ""),
        };
    }

    private static JsonObject? Resolve(string refText, JsonNode index, string baseUrl)
    {
        var raw = (refText ?? "").Trim();
        if (raw.StartsWith("costume:", StringComparison.Ordinal))
        {
            var id = raw[8..];
            if (index["costume"]?["items"] is JsonArray items)
            {
                foreach (var node in items)
                {
                    if (node is JsonObject it && it["id"]?.GetValue<string>() == id)
                        return CostumeRecord(it, index, baseUrl);
                }
            }
            return null;
        }
        var isLine = raw.StartsWith("pose-line:", StringComparison.Ordinal);
        if (isLine || raw.StartsWith("pose:", StringComparison.Ordinal))
        {
            var rest = isLine ? raw[10..] : raw[5..];
            var cut = rest.LastIndexOf(':');
            var id = cut > 0 ? rest[..cut] : rest;
            var ang = cut > 0 ? rest[(cut + 1)..] : "";
            var poseSrc = isLine && index["poseLine"] != null ? index["poseLine"] : index["pose"];
            if (poseSrc?["poses"] is JsonArray poses)
            {
                foreach (var node in poses)
                {
                    if (node is not JsonObject p || p["id"]?.GetValue<string>() != id) continue;
                    if (p["views"] is not JsonArray views || views.Count == 0) return null;
                    JsonObject v = (JsonObject)views[0]!;
                    foreach (var vn in views)
                    {
                        if (vn is JsonObject cand && cand["ang"]?.GetValue<string>() == ang)
                        {
                            v = cand;
                            break;
                        }
                    }
                    return PoseRecord(p, v, index, baseUrl);
                }
            }
        }
        return null;
    }

    private static string HttpJson(string url, JsonNode? payload, string apiKey, int timeoutMs)
    {
        var req = (HttpWebRequest)WebRequest.Create(url);
        req.Method = payload == null ? "GET" : "POST";
        req.ContentType = "application/json";
        req.Timeout = timeoutMs;
        req.ReadWriteTimeout = timeoutMs;
        if (!string.IsNullOrEmpty(apiKey)) req.Headers["Authorization"] = "Bearer " + apiKey;

        if (payload != null)
        {
            var bytes = Encoding.UTF8.GetBytes(payload.ToJsonString());
            req.ContentLength = bytes.Length;
            using var s = req.GetRequestStream();
            s.Write(bytes, 0, bytes.Length);
        }
        using var res = (HttpWebResponse)req.GetResponse();
        using var sr = new StreamReader(res.GetResponseStream(), Encoding.UTF8);
        return sr.ReadToEnd();
    }

    private static JsonNode ListModels(JsonObject args)
    {
        var baseUrl = (args["base_url"]?.GetValue<string>() ?? "").TrimEnd('/');
        if (baseUrl.Length == 0) return new JsonObject { ["error"] = "缺少 base_url" };
        try
        {
            var body = HttpJson(baseUrl + "/v1/models", null,
                args["api_key"]?.GetValue<string>() ?? "", 30000);
            var node = JsonNode.Parse(body);
            JsonArray items = node as JsonArray ?? (node?["data"] as JsonArray) ?? new JsonArray();

            var outArr = new JsonArray();
            foreach (var item in items)
            {
                if (item is not JsonObject m) continue;
                var id = m["id"]?.GetValue<string>() ?? "";
                if (id.Length == 0) continue;

                var outs = m["capabilities"]?["output_modalities"] as JsonArray;
                var type = m["type"]?.GetValue<string>() ?? "";
                string kind;
                if (outs != null && outs.ToJsonString().Contains("video")) kind = "video";
                else if (outs != null && outs.ToJsonString().Contains("image")) kind = "image";
                else if (type == "image" || type == "video") kind = type;
                else
                {
                    var low = id.ToLowerInvariant();
                    kind = low.Contains("seedream") || low.Contains("image") ? "image"
                        : low.Contains("video") ? "video" : "chat";
                }
                outArr.Add(new JsonObject
                {
                    ["id"] = id,
                    ["name"] = m["name"]?.GetValue<string>() ?? id,
                    ["kind"] = kind,
                });
            }
            return new JsonObject { ["count"] = outArr.Count, ["models"] = outArr };
        }
        catch (Exception e)
        {
            return new JsonObject { ["error"] = e.Message };
        }
    }

    private static JsonNode GenerateImageTool(JsonObject args)
    {
        var baseUrl = (args["base_url"]?.GetValue<string>() ?? "").TrimEnd('/');
        var model = args["model"]?.GetValue<string>() ?? "";
        var prompt = args["prompt"]?.GetValue<string>() ?? "";
        if (baseUrl.Length == 0 || model.Length == 0 || prompt.Length == 0)
            return new JsonObject { ["error"] = "缺少 base_url / model / prompt" };

        try
        {
            var payload = new JsonObject
            {
                ["model"] = model,
                ["prompt"] = prompt,
                ["n"] = 1,
                ["response_format"] = "url",
            };
            var size = args["size"]?.GetValue<string>() ?? "";
            if (size.Length > 0) payload["size"] = size;

            if (args["images"] is JsonArray imgs && imgs.Count > 0)
            {
                payload["image"] = imgs.Count == 1 ? imgs[0]?.DeepClone() : imgs.DeepClone();
            }

            var body = HttpJson(baseUrl + "/v1/images/generations", payload,
                args["api_key"]?.GetValue<string>() ?? "", 300000);
            var data = JsonNode.Parse(body)?["data"] as JsonArray ?? new JsonArray();
            var urls = new JsonArray();
            foreach (var d in data)
            {
                if (d is not JsonObject o) continue;
                var u = o["url"]?.GetValue<string>() ?? "";
                if (u.Length == 0)
                {
                    var b64 = o["b64_json"]?.GetValue<string>() ?? "";
                    if (b64.Length > 0) u = "data:image/png;base64," + b64;
                }
                if (u.Length > 0) urls.Add(u);
            }
            return new JsonObject { ["count"] = urls.Count, ["images"] = urls };
        }
        catch (Exception e)
        {
            return new JsonObject { ["error"] = e.Message };
        }
    }

    private static JsonObject ListCategories(JsonNode index)
    {
        var costume = index["costume"];
        var pose = index["pose"];
        return new JsonObject
        {
            ["costume"] = new JsonObject
            {
                ["categories"] = costume?["cats"]?.DeepClone(),
                ["tagGroups"] = costume?["groups"]?.DeepClone(),
                ["total"] = (costume?["items"] as JsonArray)?.Count ?? 0,
            },
            ["pose"] = new JsonObject
            {
                ["series"] = pose?["series"]?.DeepClone(),
                ["categories"] = pose?["cats"]?.DeepClone(),
                ["angles"] = pose?["angOrder"]?.DeepClone(),
                ["total"] = (pose?["poses"] as JsonArray)?.Count ?? 0,
            },
        };
    }

    private static JsonObject BuildPrompt(JsonObject args, JsonNode index, string baseUrl)
    {
        if (_skills == null) return new JsonObject { ["error"] = "skills.json 缺失" };

        var skill = args["skill"]?.GetValue<string>() ?? "qwen";
        var text = args["text"]?.GetValue<string>() ?? "";
        var refLines = new StringBuilder();

        if (args["refs"] is JsonArray refs)
        {
            foreach (var r in refs)
            {
                var raw = r?.GetValue<string>() ?? "";
                var rec = Resolve(raw, index, baseUrl);
                if (rec == null) continue;
                refLines.Append(rec["ref"]).Append('\t')
                        .Append(rec["id"]).Append('\t')
                        .Append(rec["image"]).Append('\n');
            }
        }
        var refBlock = refLines.Length == 0 ? "（无）" : refLines.ToString();

        if (skill == "minimax")
        {
            var mode = args["mode"]?.GetValue<string>() ?? "t2va";
            var guide = mode == "ref2va"
                ? _skills["minimax"]?["refGuide"]?.GetValue<string>() ?? ""
                : _skills["minimax"]?["guide"]?.GetValue<string>() ?? "";

            var label = mode;
            if (_skills["minimax"]?["modes"] is JsonArray modes)
            {
                foreach (var m in modes)
                {
                    if (m?["id"]?.GetValue<string>() == mode)
                    {
                        label = m["label"]?.GetValue<string>() ?? mode;
                        break;
                    }
                }
            }
            return new JsonObject
            {
                ["prompt"] = "# 任务：按 MiniMax H3 规范改写提示词\n# 模式：" + label +
                             "\n\n## 规范\n" + guide +
                             "\n\n## 参考素材\n" + refBlock +
                             "\n\n## 用户输入\n" + text +
                             "\n\n## 输出要求\n- 严格使用规范中的字段名、段落顺序与时间记法。\n" +
                             "- 重写正文用英文；对白、歌词、画面文字保留原语言。",
            };
        }

        var lang = args["lang"]?.GetValue<string>() ?? "zh";
        var prompt = "";
        if (_skills["qwen"]?["variants"] is JsonArray variants)
        {
            foreach (var v in variants)
            {
                if (v?["lang"]?.GetValue<string>() == lang)
                {
                    prompt = v["prompt"]?.GetValue<string>() ?? "";
                    break;
                }
            }
            if (prompt.Length == 0 && variants.Count > 0)
                prompt = variants[0]?["prompt"]?.GetValue<string>() ?? "";
        }
        return new JsonObject
        {
            ["prompt"] = "# 任务：按 Qwen-Image 规范改写图像提示词\n\n## 规范\n" + prompt +
                         "\n\n## 参考素材\n" + refBlock +
                         "\n\n## 用户输入\n" + text,
        };
    }

    private static JsonObject Ok(JsonNode? id, JsonNode result) => new()
    {
        ["jsonrpc"] = "2.0",
        ["id"] = id?.DeepClone() ?? JsonValue.Create((string?)null),
        ["result"] = result,
    };

    private static JsonObject Error(JsonNode? id, int code, string message) => new()
    {
        ["jsonrpc"] = "2.0",
        ["id"] = id?.DeepClone() ?? JsonValue.Create((string?)null),
        ["error"] = new JsonObject { ["code"] = code, ["message"] = message },
    };

    public static string Escape(string s) => JsonEncodedText.Encode(s).ToString();
}
