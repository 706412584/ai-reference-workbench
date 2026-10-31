# 参考工作台

个人用的 AI 绘画参考工作台：服装 / 深度姿势图库浏览 + 提示词管理 + 图片与视频生成。
同一套前端跑在浏览器、Android、Windows 三端。

## 目录

```
workbench/
├── src/                  React + TS 前端
├── public/
│   ├── data/index.json   统一索引（两库元数据）
│   ├── data/skills.json  MiniMax H3 / Qwen-Image 提示词规范
│   └── assets/           转码后的 WebP（不入 git）
├── tools/
│   ├── build_index.py    生成统一索引与下载计划
│   ├── fetch_assets.py   下载 + 转码
│   ├── pack_release.py   打包 zip（Gitee 单文件 <100MB）
│   ├── gitee_release.py  上传 Gitee Release
│   ├── build_android.py  组装 APK 内置资源（不含图片）
│   └── mcp_server.py     只读 MCP 服务 + 同源代理
├── shell-android/        Android WebView 外壳
└── shell-windows/        WPF + WebView2 外壳
```

## 首次准备

```bash
npm install
python tools/build_index.py          # 生成 public/data/index.json
python tools/fetch_assets.py         # 下载并转码，约 70MB
npm run build
```

## 发布资源包

```bash
python tools/pack_release.py --version 1.0.0 --with-data \
  --gitee <owner>/<repo>
python tools/gitee_release.py --owner <owner> --repo <repo> \
  --tag v1.0.0 --name "资源包 1.0.0"
python tools/build_android.py        # 把 release.json 打进 APK
```

## 构建

```bash
# Android
cd shell-android && ./gradlew :app:assembleDebug
# Windows
cd shell-windows && dotnet build -c Release
```

## MCP

```bash
python tools/mcp_server.py --port 7801 --lan
```

工具：`search_references` / `get_reference` / `list_categories` /
`list_models` / `generate_image` / `build_prompt`。

## 已知限制

- 目标设备 WebView 81：不能用 `gap`、`aspect-ratio`、`inset`、`color-mix()`、`:focus-visible`。
- 生成网关的图生图参考图必须是 base64；POST 响应缺 CORS 头，因此走同源 `/proxy`。
- 视频接口按 OpenAI 风格预留，当前网关未开放，提交会返回服务端错误原文。
- 明文 HTTP 只对 `127.0.0.1`、`localhost`、`192.168.1.3` 放行，换网段需改
  `shell-android/app/src/main/res/xml/network_security_config.xml`。
