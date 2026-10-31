# -*- coding: utf-8 -*-
"""把图片资源打成 Gitee Release 可上传的 zip。

Gitee Release 单文件上限 100MB，因此按库拆分：
  dist-release/assets-costume.zip
  dist-release/assets-pose.zip
  dist-release/manifest.json   （版本、大小、sha256、下载地址）

用法：
  python tools/pack_release.py --version 1.0.0
  python tools/pack_release.py --version 1.0.0 --base-url https://gitee.com/<owner>/<repo>/releases/download/v1.0.0
"""
import argparse
import hashlib
import json
import os
import sys
import zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sources import ROOT, PUBLIC, DATA  # noqa: E402

OUT_DIR = os.path.join(ROOT, "dist-release")
LIMIT = 100 * 1024 * 1024


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def pack(name, paths, out):
    with zipfile.ZipFile(out, "w", zipfile.ZIP_STORED) as z:
        for p in paths:
            z.write(p, os.path.relpath(p, PUBLIC).replace(os.sep, "/"))
    size = os.path.getsize(out)
    return {
        "name": name,
        "file": os.path.basename(out),
        "bytes": size,
        "sha256": sha256(out),
    }


def collect(sub):
    base = os.path.join(PUBLIC, "assets", sub)
    out = []
    for dirpath, _, files in os.walk(base):
        for f in files:
            out.append(os.path.join(dirpath, f))
    out.sort()
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--version", required=True)
    ap.add_argument("--base-url", default="")
    ap.add_argument("--gitee", default="",
                    help="形如 owner/repo，自动拼 Release 下载地址")
    ap.add_argument("--with-data", action="store_true",
                    help="同时打包 data/（索引与技能）")
    args = ap.parse_args()

    os.makedirs(OUT_DIR, exist_ok=True)
    packs = []

    for sub in ("costume", "pose"):
        files = collect(sub)
        if not files:
            print("跳过（无文件）:", sub)
            continue
        out = os.path.join(OUT_DIR, "assets-%s.zip" % sub)
        info = pack(sub, files, out)
        packs.append(info)
        print("%-8s %6.1f MB  %s" % (sub, info["bytes"] / 1048576, info["file"]))
        if info["bytes"] > LIMIT:
            print("  !! 超过 Gitee 100MB 上限", file=sys.stderr)

    if args.with_data:
        files = []
        for dirpath, _, fs in os.walk(DATA):
            for f in fs:
                if f in ("asset-plan.json",):
                    continue
                files.append(os.path.join(dirpath, f))
        out = os.path.join(OUT_DIR, "data.zip")
        info = pack("data", sorted(files), out)
        packs.append(info)
        print("%-8s %6.1f MB  %s" % ("data", info["bytes"] / 1048576, info["file"]))

    manifest = {
        "version": args.version,
        "packs": packs,
    }
    if args.gitee:
        args.base_url = "https://gitee.com/%s/releases/download/v%s" % (
            args.gitee.strip("/"), args.version)
    if args.base_url:
        base = args.base_url.rstrip("/")
        for p in packs:
            p["url"] = base + "/" + p["file"]

    path = os.path.join(OUT_DIR, "manifest.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=1)

    # 同步一份到 public/data，供运行时读取
    with open(os.path.join(DATA, "release.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=1)

    total = sum(p["bytes"] for p in packs)
    print("\nmanifest: %s" % path)
    print("合计 %.1f MB，%d 个包" % (total / 1048576, len(packs)))
    for p in packs:
        if p["bytes"] > LIMIT:
            sys.exit(1)


if __name__ == "__main__":
    main()
