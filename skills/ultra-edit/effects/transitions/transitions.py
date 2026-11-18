"""Transition overlays as ProRes 4444 .mov files with alpha. Put one on the track ABOVE a cut (Normal blend),
with the cut on the overlay's full-white frame.

  white_bloom_12f.mov      exposure blows out from the centre, full white on frames 6-7 (cut at f6), clears from the edges
  light_ray_burst_14f.mov  thin god-rays radiate, full white on frame 7 (cut there), rays fade

usage: python transitions.py out_dir [--size 1280x720] [--fps 30] [--tint 246,244,255]
needs: numpy, pillow, ffmpeg on PATH
"""
import argparse, os, subprocess, numpy as np
from PIL import Image, ImageFilter
_ap = argparse.ArgumentParser()
_ap.add_argument("out_dir")
_ap.add_argument("--size", default="1280x720")
_ap.add_argument("--fps", type=int, default=30)
_ap.add_argument("--tint", default="246,244,255", help="r,g,b of the white (slightly cool by default)")
_args = _ap.parse_args()
OUT = _args.out_dir
os.makedirs(OUT, exist_ok=True)
W, H = (int(v) for v in _args.size.lower().split("x"))
FPS = _args.fps
WHITE = np.array([float(v) for v in _args.tint.split(",")], np.float32)
y, x = np.mgrid[0:H, 0:W].astype(np.float32)
R = np.sqrt(((x - W / 2) / (W / 2)) ** 2 + ((y - H / 2) / (W / 2)) ** 2)   # 0 centre .. ~1.15 corner
ANG = np.arctan2(y - H / 2, x - W / 2)


def ss(e0, e1, v):
    t = np.clip((v - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t)


def write(name, frames):
    p = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", f"{W}x{H}", "-r", str(FPS),
                          "-i", "-", "-c:v", "prores_ks", "-profile:v", "4444", "-pix_fmt", "yuva444p10le",
                          "-vendor", "apl0", f"{OUT}/{name}.mov"], stdin=subprocess.PIPE)
    for rgb, a in frames:
        p.stdin.write(np.dstack([np.clip(rgb, 0, 255), np.clip(a * 255, 0, 255)]).astype(np.uint8).tobytes())
    p.stdin.close(); p.wait()


def bloom():
    # 12 f: centre-first exposure blow-out (f0-5), full white f6-7 (put the CUT at f6), white clears from the edges in (f8-11)
    lvl = [0.10, 0.25, 0.45, 0.68, 0.86, 0.97, 1.0, 1.0, 0.80, 0.52, 0.25, 0.07]
    fr = []
    for v in lvl:
        a = np.clip(v * 1.25 - R * (1 - v) * 0.9, 0, 1) if v < 1 else np.ones_like(R)
        fr.append((np.broadcast_to(WHITE, (H, W, 3)), a))
    write("white_bloom_12f", fr)


def rays():
    # 14 f: thin god-rays radiate from centre, peak full white at f7 (CUT there), rays fade out f8-13
    rng = np.random.default_rng(7)
    n = 90; ang = rng.uniform(-np.pi, np.pi, n); wid = rng.uniform(0.004, 0.02, n); amp = rng.uniform(0.35, 1.0, n)
    ray = np.zeros((H, W), np.float32)
    for a0, w0, am in zip(ang, wid, amp):
        d = np.abs(np.angle(np.exp(1j * (ANG - a0))))
        ray = np.maximum(ray, am * np.exp(-(d / w0) ** 2))
    ray = np.asarray(Image.fromarray((ray * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2))).astype(np.float32) / 255
    fr = []
    for f in range(14):
        if f <= 7: g = f / 7.0          # grow
        else: g = 1 - (f - 7) / 6.0     # fade
        reach = 0.15 + 1.1 * (f / 7.0 if f <= 7 else 1.0)
        core = np.exp(-(R / (0.05 + 0.35 * g ** 2)) ** 2) * min(1, g * 1.6)
        r = ray * ss(reach, reach * 0.25, R) * g * (1.0 - 0.6 * R)
        a = np.clip(core + r * 1.4, 0, 1)
        if f == 7: a = np.ones_like(a)
        elif f == 6 or f == 8: a = np.clip(a + 0.55 * (1 - R * 0.6), 0, 1)
        fr.append((np.broadcast_to(WHITE, (H, W, 3)), a))
    write("light_ray_burst_14f", fr)


bloom(); rays()
