# -*- coding: utf-8 -*-
"""组装 Android 内置资源：页面 + 数据（不含图片）。

图片走 Gitee 资源包，APK 只保留 index.html / js / css / data。
  public/data/index.json    需要（不含图片时也要能列出条目）
  public/data/skills.json   需要
  public/data/release.json  需要（资源包清单）
  public/assets/**          不打包

用法：python tools/build_android.py
"""
import json
import os
import shutil
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sources import ROOT, PUBLIC  # noqa: E402

DIST = os.path.join(ROOT, "dist")
TARGET = os.path.join(ROOT, "shell-android", "app", "src", "main", "assets", "www")


def main():
    if not os.path.isdir(DIST):
        sys.exit("缺少 dist/，请先 npm run build")

    if os.path.isdir(TARGET):
        shutil.rmtree(TARGET)
    os.makedirs(TARGET)

    # 1) 页面与静态资源（不含 assets/ 图片目录）
    for name in os.listdir(DIST):
        if name == "assets":
            src = os.path.join(DIST, "assets")
            dst = os.path.join(TARGET, "assets")
            os.makedirs(dst, exist_ok=True)
            for f in os.listdir(src):
                if os.path.isdir(os.path.join(src, f)):
                    continue  # 跳过 costume / pose 图片目录
                shutil.copy2(os.path.join(src, f), os.path.join(dst, f))
            continue
        src = os.path.join(DIST, name)
        dst = os.path.join(TARGET, name)
        if os.path.isdir(src):
            shutil.copytree(src, dst)
        else:
            shutil.copy2(src, dst)

    # 2) 数据（索引 / 技能 / 资源包清单）
    data_src = os.path.join(PUBLIC, "data")
    data_dst = os.path.join(TARGET, "data")
    os.makedirs(data_dst, exist_ok=True)
    for f in ("index.json", "skills.json", "release.json"):
        p = os.path.join(data_src, f)
        if os.path.exists(p):
            shutil.copy2(p, os.path.join(data_dst, f))
        else:
            print("警告：缺少 data/%s" % f)

    # 3) 统计
    total = 0
    count = 0
    for dp, _, fs in os.walk(TARGET):
        for f in fs:
            total += os.path.getsize(os.path.join(dp, f))
            count += 1
    print("内置资源: %d 个文件，%.1f MB" % (count, total / 1048576))
    print("目标:", TARGET)


if __name__ == "__main__":
    main()
