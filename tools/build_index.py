# -*- coding: utf-8 -*-
"""合并两个图库仓库的元数据，产出：
  public/data/index.json       统一索引（UI 唯一数据源）
  public/data/asset-plan.json  下载/转码计划（供 fetch_assets.py 执行）

路径一律 ASCII，避免 Android assets 与 Windows 打包的编码问题。
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sources import (  # noqa: E402
    COSTUME_REPO, POSE_REPO, DATA, COSTUME_MID_MAX, COSTUME_MID_Q,
    POSE_FULL_MAX, POSE_FULL_Q, COSTUME_REFERER, POSE_REFERER,
)

# 系列 / 视角 -> ASCII slug（顺序即 UI 顺序）
SERIES_SLUG = {
    "全身1人・セクシー系": "full-sexy",
    "全身1人・標準系": "full-std",
    "上半身1人": "upper",
    "2人絡み": "duo",
}
ANG_SLUG = {
    "正面": "front",
    "横": "side",
    "斜め": "diag",
    "上から": "high",
    "下から": "low",
}
# 分类 slug：按 meta 里的顺序固定编号，避免日文目录名
CAT_SLUG_OVERRIDE = {}


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def write_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))


def build_costume():
    rows = load(os.path.join(COSTUME_REPO, "data", "costume-zh.json"))
    meta = load(os.path.join(COSTUME_REPO, "data", "meta.json"))

    cat_order = [c["ja"] for c in meta["分类"]]
    cats = []
    for c in meta["分类"]:
        slug = CAT_SLUG_OVERRIDE.get(c["ja"]) or "c%02d" % (cat_order.index(c["ja"]) + 1)
        cats.append({"slug": slug, "ja": c["ja"], "zh": c["zh"], "count": c["items"]})

    items = []
    for r in rows:
        idx = cat_order.index(r["分类"]) if r["分类"] in cat_order else 99
        cat = cats[idx] if idx < len(cats) else {"slug": "other", "ja": r["分类"], "zh": r["分类_zh"]}
        items.append({
            "id": r["id"],
            "cat": cat["slug"],
            "tags": r["标签"],
            "thumb": "assets/costume/thumb/%s.webp" % r["id"],
            "mid": "assets/costume/mid/%s.webp" % r["id"],
            "full": "assets/costume/full/%s.png" % r["id"],
        })

    groups = []
    for g in meta["标签分组"]:
        groups.append({
            "key": g["key"],
            "zh": g["zh"],
            "ja": g["ja"],
            "tags": [t["en"] for t in g["tags"]],
        })

    tag_zh = {}
    tag_ja = {}
    for g in meta["标签分组"]:
        for t in g["tags"]:
            tag_zh[t["en"]] = t["zh"]
            tag_ja[t["en"]] = t["ja"]

    return {
        "cats": cats,
        "groups": groups,
        "items": items,
        "tagZh": tag_zh,
        "tagJa": tag_ja,
    }


def build_pose():
    rows = load(os.path.join(POSE_REPO, "data", "pose-zh.json"))
    meta = load(os.path.join(POSE_REPO, "data", "meta.json"))

    series_meta = meta["系列"]
    series = []
    for i, s in enumerate(series_meta):
        slug = SERIES_SLUG.get(s["ja"]) or "s%d" % (i + 1)
        series.append({"slug": slug, "ja": s["ja"], "zh": s["zh"], "count": s["poses"]})

    cat_meta = meta["分类"]
    cats = []
    for i, c in enumerate(cat_meta):
        cats.append({"slug": "c%02d" % (i + 1), "ja": c["ja"], "zh": c["zh"], "count": c["poses"]})

    series_by_ja = {s["ja"]: s for s in series}
    cat_by_ja = {c["ja"]: c for c in cats}

    # 视角顺序固定
    ang_order = ["正面", "横", "斜め", "上から", "下から"]
    poses = {}
    for r in rows:
        key = (r["系列"], r["姿势编号"])
        if key not in poses:
            s = series_by_ja.get(r["系列"])
            c = cat_by_ja.get(r["分类"])
            if s is None or c is None:
                raise SystemExit("未知系列/分类: %r %r" % (r["系列"], r["分类"]))
            poses[key] = {
                "id": "%s/%s" % (s["slug"], r["姿势编号"]),
                "series": s["slug"],
                "cat": c["slug"],
                "pid": r["姿势编号"],
                "name": r["姿势名"],
                "nameZh": r["姿势名_zh"],
                "views": [],
            }
        poses[key]["views"].append(r)

    out = []
    for p in poses.values():
        p["views"].sort(key=lambda v: ang_order.index(v["视角"]) if v["视角"] in ang_order else 99)
        views = []
        for v in p["views"]:
            ang = ANG_SLUG.get(v["视角"], "v")
            base = "assets/pose/%s/%s/%s/%s" % (p["series"], p["cat"], p["pid"], ang)
            views.append({
                "ang": ang,
                "name": v["视角"],
                "nameZh": v["视角_zh"],
                "thumb": base + "-t.webp",
                "full": base + "-f.webp",
            })
        p["views"] = views
        out.append(p)

    series_idx = {s["slug"]: i for i, s in enumerate(series)}
    out.sort(key=lambda p: (series_idx[p["series"]], p["pid"]))

    return {
        "series": series,
        "cats": cats,
        "poses": out,
        "angZh": {ANG_SLUG[k]: v for k, v in {
            "正面": "正面", "横": "侧面", "斜め": "斜角", "上から": "俯视", "下から": "仰视"
        }.items()},
        "angOrder": [ANG_SLUG[a] for a in ang_order],
    }


def build_plan(costume, pose):
    """生成逐文件计划：源 URL -> 目标路径 + 转码参数。"""
    plan = []

    crows = load(os.path.join(COSTUME_REPO, "manifest.json"))
    cby = {r["id"]: r for r in crows}
    for item in costume["items"]:
        r = cby[item["id"]]
        plan.append({
            "src": r["thumb_url"],
            "dst": item["thumb"],
            "referer": COSTUME_REFERER,
            "kind": "image",
            "max": 0,
            "quality": 82,
            "format": "webp",
        })
        plan.append({
            "src": r["img_url"],
            "dst": item["mid"],
            "referer": COSTUME_REFERER,
            "kind": "image",
            "max": COSTUME_MID_MAX,
            "quality": COSTUME_MID_Q,
            "format": "webp",
        })

    prows = load(os.path.join(POSE_REPO, "manifest.json"))
    # 以 (ASCII 系列, 编号, ASCII 视角) 建索引，避免逐条扫描
    pby = {}
    for r in prows:
        key = (SERIES_SLUG.get(r["系列"]), r["编号"], ANG_SLUG.get(r["视角"]))
        pby[key] = r

    for p in pose["poses"]:
        for v in p["views"]:
            src = pby.get((p["series"], p["pid"], v["ang"]))
            if src is None:
                raise SystemExit("找不到姿势源: %r %s" % (p["id"], v["ang"]))
            src_thumb, src_full = src["thumb_url"], src["full_url"]
            plan.append({
                "src": src_thumb,
                "dst": v["thumb"],
                "referer": POSE_REFERER,
                "kind": "image",
                "max": 0,
                "quality": 82,
                "format": "webp",
            })
            plan.append({
                "src": src_full,
                "dst": v["full"],
                "referer": POSE_REFERER,
                "kind": "image",
                "max": POSE_FULL_MAX,
                "quality": POSE_FULL_Q,
                "format": "webp",
            })

    return plan


def main():
    costume = build_costume()
    pose = build_pose()
    plan = build_plan(costume, pose)

    index = {
        "version": 1,
        "costume": costume,
        "pose": pose,
    }
    write_json(os.path.join(DATA, "index.json"), index)
    write_json(os.path.join(DATA, "asset-plan.json"), plan)

    print("costume items:", len(costume["items"]))
    print("pose poses:", len(pose["poses"]), "views:", sum(len(p["views"]) for p in pose["poses"]))
    print("asset plan entries:", len(plan))
    print("index.json bytes:", os.path.getsize(os.path.join(DATA, "index.json")))
    print("asset-plan.json bytes:", os.path.getsize(os.path.join(DATA, "asset-plan.json")))


if __name__ == "__main__":
    main()
