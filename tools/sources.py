# -*- coding: utf-8 -*-
"""共享路径与配置。"""
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GALLERY = os.path.dirname(ROOT)

COSTUME_REPO = os.path.join(GALLERY, "ai-costume-gallery-cn")
POSE_REPO = os.path.join(GALLERY, "ai-pose-depth-gallery-cn")

CACHE = os.path.join(ROOT, ".cache")
RAW_COSTUME = os.path.join(CACHE, "raw", "costume")
RAW_POSE = os.path.join(CACHE, "raw", "pose")

PUBLIC = os.path.join(ROOT, "public")
ASSETS = os.path.join(PUBLIC, "assets")
DATA = os.path.join(PUBLIC, "data")

# 输出规格
COSTUME_MID_MAX = 1200     # 长边
COSTUME_MID_Q = 80
POSE_FULL_MAX = 900        # 原图本来就是 900x1200
POSE_FULL_Q = 90

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0 Safari/537.36")

COSTUME_REFERER = "https://ai-costume-gallery.pages.dev/"
POSE_REFERER = "https://ai-pose-depth-gallery.pages.dev/"
