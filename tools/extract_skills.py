# -*- coding: utf-8 -*-
"""把官方提示词规范抽取为前端可用的 JSON。

来源（均为公开仓库）：
  MiniMax H3 · .agents/skills/h3-prompt-writing
  Qwen-Image · src/examples/tools/prompt_utils_2512.py

输出：public/data/skills.json
  {
    "minimax": { "title", "modes": [...], "guide": "<base-en.txt>" , "refGuide": ...},
    "qwen":    { "title", "variants": [{id,label,lang,prompt}] }
  }
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sources import DATA  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
SKILLS = os.path.join(os.path.dirname(HERE), "src", "skills")

MINIMAX_MODES = [
    {
        "id": "t2va",
        "label": "文生视频 T2VA",
        "desc": "仅凭文字构建完整视听时间线。",
    },
    {
        "id": "i2va",
        "label": "首帧生视频 I2VA",
        "desc": "以参考图为 0.00 秒首帧，向前发展。",
    },
    {
        "id": "fl2va",
        "label": "首尾帧 FL2VA",
        "desc": "描述首帧到尾帧之间的连续路径。",
    },
    {
        "id": "l2va",
        "label": "尾帧 L2VA",
        "desc": "从合理的前置状态收敛到尾帧。",
    },
    {
        "id": "ref2va",
        "label": "全参考 Ref2VA",
        "desc": "六段式重写：主体定义、摘要、保留分析、详细描述、环境声、配乐。",
    },
]


def read(name):
    with open(os.path.join(SKILLS, name), encoding="utf-8") as f:
        return f.read()


def extract_qwen():
    src = read("qwen-prompt-utils.py")
    blocks = re.findall(r"SYSTEM_PROMPT = '''(.*?)'''", src, re.S)
    if len(blocks) < 2:
        raise SystemExit("qwen 提示词块数量异常: %d" % len(blocks))
    return [
        {
            "id": "qwen-image-en",
            "label": "Qwen-Image · 英文改写",
            "lang": "en",
            "prompt": blocks[0].strip(),
        },
        {
            "id": "qwen-image-zh",
            "label": "Qwen-Image · 中文改写",
            "lang": "zh",
            "prompt": blocks[1].strip(),
        },
    ]


def main():
    out = {
        "version": 1,
        "sources": [
            {
                "name": "MiniMax H3 h3-prompt-writing",
                "url": "https://github.com/MiniMax-AI/MiniMax-H3/tree/main/.agents/skills/h3-prompt-writing",
                "license": "见原仓库",
            },
            {
                "name": "Qwen-Image prompt_utils_2512",
                "url": "https://github.com/QwenLM/Qwen-Image/blob/main/src/examples/tools/prompt_utils_2512.py",
                "license": "Apache-2.0",
            },
        ],
        "minimax": {
            "title": "MiniMax H3 提示词",
            "modes": MINIMAX_MODES,
            "skill": read("minimax-h3.md"),
            "guide": read("minimax-base-en.txt"),
            "refGuide": read("minimax-ref-en.txt"),
        },
        "qwen": {
            "title": "Qwen-Image 提示词",
            "variants": extract_qwen(),
        },
    }
    path = os.path.join(DATA, "skills.json")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print("skills.json bytes:", os.path.getsize(path))
    print("minimax guide:", len(out["minimax"]["guide"]))
    print("qwen variants:", [(v["id"], len(v["prompt"])) for v in out["qwen"]["variants"]])


if __name__ == "__main__":
    main()
