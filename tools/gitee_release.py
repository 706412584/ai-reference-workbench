# -*- coding: utf-8 -*-
"""把 dist-release/ 里的包上传到 Gitee Release。

令牌读取顺序：--token → 环境变量 GITEE_TOKEN → %USERPROFILE%/.gitee_token

用法：
  python tools/gitee_release.py --owner wu-yongchengsvip_admin --repo android-code-studio \
      --tag v1.0.0 --name "资源包 1.0.0"
  python tools/gitee_release.py ... --dry-run
"""
import argparse
import json
import mimetypes
import os
import sys
import time
import uuid
import urllib.request
import urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT_DIR = os.path.join(ROOT, "dist-release")
API = "https://gitee.com/api/v5"
CHUNK = 4 * 1024 * 1024


def token_from_env():
    t = os.environ.get("GITEE_TOKEN")
    if t:
        return t.strip()
    p = os.path.join(os.path.expanduser("~"), ".gitee_token")
    if os.path.exists(p):
        with open(p, encoding="utf-8") as f:
            return f.read().strip()
    return ""


def request(url, method="GET", data=None, headers=None, timeout=60):
    req = urllib.request.Request(url, data=data, method=method)
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = r.read()
            return r.status, json.loads(body) if body else None
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")
        return e.code, body


def find_release(owner, repo, tag, token):
    url = "%s/repos/%s/%s/releases/tags/%s?access_token=%s" % (API, owner, repo, tag, token)
    status, body = request(url)
    if status == 200 and isinstance(body, dict):
        return body
    return None


def repo_default_branch(owner, repo, token):
    url = "%s/repos/%s/%s?access_token=%s" % (API, owner, repo, token)
    status, body = request(url)
    if status == 200 and isinstance(body, dict):
        return body.get("default_branch") or "master"
    return "master"


def create_release(owner, repo, tag, name, token):
    url = "%s/repos/%s/%s/releases" % (API, owner, repo)
    payload = json.dumps({
        "access_token": token,
        "tag_name": tag,
        "name": name,
        "body": "AI 参考工作台资源包",
        "target_commitish": repo_default_branch(owner, repo, token),
    }).encode("utf-8")
    status, body = request(url, "POST", payload,
                           {"Content-Type": "application/json"})
    if status in (200, 201) and isinstance(body, dict):
        return body
    print("创建 Release 失败:", status, body, file=sys.stderr)
    return None


def upload_asset(owner, repo, release_id, path, token):
    name = os.path.basename(path)
    size = os.path.getsize(path)
    url = "%s/repos/%s/%s/releases/%s/attach_files" % (API, owner, repo, release_id)
    boundary = "----wb" + uuid.uuid4().hex
    ctype = mimetypes.guess_type(name)[0] or "application/octet-stream"

    head = (
        "--%s\r\nContent-Disposition: form-data; name=\"access_token\"\r\n\r\n%s\r\n"
        "--%s\r\nContent-Disposition: form-data; name=\"file\"; filename=\"%s\"\r\n"
        "Content-Type: %s\r\n\r\n"
    ) % (boundary, token, boundary, name, ctype)
    tail = "\r\n--%s--\r\n" % boundary
    head_b = head.encode("utf-8")
    tail_b = tail.encode("utf-8")

    req = urllib.request.Request(url, method="POST")
    req.add_header("Content-Type", "multipart/form-data; boundary=" + boundary)
    req.add_header("Content-Length", str(len(head_b) + size + len(tail_b)))

    print("  上传 %s (%.1f MB)…" % (name, size / 1048576), flush=True)
    with open(path, "rb") as f:
        # http.client 需要可读的 body；用生成器分块写入
        import http.client
        from urllib.parse import urlparse

        u = urlparse(url)
        conn = http.client.HTTPSConnection(u.netloc, timeout=1800)
        conn.putrequest("POST", u.path)
        conn.putheader("Content-Type", "multipart/form-data; boundary=" + boundary)
        conn.putheader("Content-Length", str(len(head_b) + size + len(tail_b)))
        conn.endheaders()
        conn.send(head_b)
        sent = 0
        while True:
            chunk = f.read(CHUNK)
            if not chunk:
                break
            conn.send(chunk)
            sent += len(chunk)
            if sent % (16 * CHUNK) < CHUNK:
                print("    %.0f%%" % (sent * 100.0 / size), flush=True)
        conn.send(tail_b)
        resp = conn.getresponse()
        body = resp.read().decode("utf-8", "replace")
        conn.close()

    if resp.status in (200, 201):
        try:
            return json.loads(body)
        except json.JSONDecodeError:
            return {"raw": body}
    print("  失败:", resp.status, body[:300], file=sys.stderr)
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--owner", required=True)
    ap.add_argument("--repo", required=True)
    ap.add_argument("--tag", required=True)
    ap.add_argument("--name", default="")
    ap.add_argument("--token", default="")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    token = args.token or token_from_env()
    if not token:
        sys.exit("缺少 Gitee 令牌")

    manifest_path = os.path.join(OUT_DIR, "manifest.json")
    if not os.path.exists(manifest_path):
        sys.exit("缺少 dist-release/manifest.json，请先运行 tools/pack_release.py")
    with open(manifest_path, encoding="utf-8") as f:
        manifest = json.load(f)

    files = [os.path.join(OUT_DIR, p["file"]) for p in manifest["packs"]]
    for f in files:
        if not os.path.exists(f):
            sys.exit("缺少文件: " + f)
        if os.path.getsize(f) > 100 * 1024 * 1024:
            sys.exit("超过 Gitee 100MB 上限: " + f)

    print("仓库 %s/%s  标签 %s" % (args.owner, args.repo, args.tag))
    for f in files:
        print("  %-24s %6.1f MB" % (os.path.basename(f), os.path.getsize(f) / 1048576))

    if args.dry_run:
        print("dry-run，未上传")
        return

    rel = find_release(args.owner, args.repo, args.tag, token)
    if rel:
        print("Release 已存在，id=%s" % rel.get("id"))
    else:
        print("创建 Release…")
        rel = create_release(args.owner, args.repo, args.tag,
                             args.name or ("资源包 " + args.tag), token)
        if not rel:
            sys.exit(1)
        print("已创建 id=%s" % rel.get("id"))

    existing = {a.get("name"): a for a in (rel.get("assets") or [])}
    for f in files:
        base = os.path.basename(f)
        if base in existing:
            print("  已存在，跳过:", base)
            continue
        res = upload_asset(args.owner, args.repo, rel["id"], f, token)
        if res:
            print("  完成:", res.get("browser_download_url") or res.get("name"))
        else:
            sys.exit(1)

    print("\n下载地址前缀：")
    print("https://gitee.com/%s/%s/releases/download/%s/" % (args.owner, args.repo, args.tag))


if __name__ == "__main__":
    main()
