# -*- coding: utf-8 -*-
"""按 asset-plan.json 下载并转码素材。

用法:
  python tools/fetch_assets.py                # 全部
  python tools/fetch_assets.py --only costume # 只服装
  python tools/fetch_assets.py --only pose    # 只姿势
  python tools/fetch_assets.py --workers 8
  python tools/fetch_assets.py --dry-run

特性：断点续传（已存在的目标跳过）、指数退避重试、原子写入、进度输出。
"""
import argparse
import io
import json
import os
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sources import PUBLIC, UA  # noqa: E402

PLAN = os.path.join(PUBLIC, "data", "asset-plan.json")
MIN_BYTES = 1024
ATTEMPTS = 5

lock = threading.Lock()
done = 0
failed = []
bytes_in = 0
bytes_out = 0
total = 0
start = 0.0


def transcode(blob, max_side, quality, fmt):
    im = Image.open(io.BytesIO(blob))
    im.load()
    if max_side and max(im.size) > max_side:
        scale = max_side / float(max(im.size))
        size = (max(1, round(im.size[0] * scale)), max(1, round(im.size[1] * scale)))
        im = im.resize(size, Image.LANCZOS)
    out = io.BytesIO()
    im.save(out, fmt.upper(), quality=quality, method=6)
    return out.getvalue()


def fetch_one(entry, session):
    dst = os.path.join(PUBLIC, entry["dst"])
    if os.path.exists(dst) and os.path.getsize(dst) >= MIN_BYTES:
        with lock:
            global done
            done += 1
        return
    os.makedirs(os.path.dirname(dst), exist_ok=True)

    last = None
    for attempt in range(ATTEMPTS):
        try:
            r = session.get(
                entry["src"],
                headers={"User-Agent": UA, "Referer": entry["referer"]},
                timeout=(15, 90),
            )
            r.raise_for_status()
            blob = r.content
            if len(blob) < 512:
                raise IOError("too small: %d" % len(blob))

            out = transcode(blob, entry["max"], entry["quality"], entry["format"])
            if len(out) < MIN_BYTES:
                raise IOError("transcoded too small: %d" % len(out))

            tmp = dst + ".part"
            with open(tmp, "wb") as f:
                f.write(out)
            os.replace(tmp, dst)

            with lock:
                global bytes_in, bytes_out
                bytes_in += len(blob)
                bytes_out += len(out)
                done += 1
                n = done
            if n % 100 == 0 or n == total:
                el = time.time() - start
                print("  %d/%d  in %.1f MB -> out %.1f MB  %.1f/s" % (
                    n, total, bytes_in / 1048576, bytes_out / 1048576, n / el), flush=True)
            return
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(min(20, 1.5 * (2 ** attempt)))

    with lock:
        failed.append((entry["dst"], str(last)))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", choices=["costume", "pose"])
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    global total, start
    with open(PLAN, encoding="utf-8") as f:
        plan = json.load(f)
    if args.only:
        plan = [p for p in plan if p["dst"].startswith("assets/" + args.only + "/")]
    total = len(plan)
    start = time.time()

    if args.dry_run:
        print("entries:", total)
        for p in plan[:5]:
            print(" ", p["src"], "->", p["dst"])
        return

    print("entries=%d workers=%d" % (total, args.workers), flush=True)
    with requests.Session() as session:
        with ThreadPoolExecutor(max_workers=args.workers) as ex:
            futs = [ex.submit(fetch_one, p, session) for p in plan]
            for _ in as_completed(futs):
                pass

    el = time.time() - start
    print("\n完成 %d/%d  in %.1f MB -> out %.1f MB  用时 %.0fs" % (
        done, total, bytes_in / 1048576, bytes_out / 1048576, el))
    if failed:
        print("失败 %d:" % len(failed))
        for d, e in failed[:30]:
            print("  ", d, e)
        with open(os.path.join(PUBLIC, "data", "failed-assets.json"), "w", encoding="utf-8") as f:
            json.dump(failed, f, ensure_ascii=False, indent=1)
        sys.exit(1)
    print("无失败")


if __name__ == "__main__":
    main()
