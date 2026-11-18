"""backdrop.py: a clean studio wall plate for background replacement (numpy only, no AI, same every video).

    python backdrop.py <out.png> --size 1920x1080 [--style slats|plain|panels] [--wall #17141F]
                       [--light #B8A4FF] [--warm #E8B07A] [--subject 0.62,0.55] [--blur 3] [--seed 7]

Styles (from the flow reference, on the user's dark theme):
  slats   vertical fluted acoustic slats (the reference wall), soft light pool behind the subject, uplight from below
  plain   smooth painted wall with the same light pool (cleanest)
  panels  wide vertical panels with thin seams (calmer than slats)
The light pool sits behind the subject (--subject x,y as 0-1 of the frame) so the person reads as lit, not pasted.
"""
import argparse, subprocess
import numpy as np

ap = argparse.ArgumentParser()
ap.add_argument('out'); ap.add_argument('--size', default='1920x1080')
ap.add_argument('--style', default='slats', choices=['slats', 'plain', 'panels'])
ap.add_argument('--wall', default='#17141F'); ap.add_argument('--light', default='#B8A4FF'); ap.add_argument('--warm', default='#E8B07A')
ap.add_argument('--subject', default='0.62,0.55'); ap.add_argument('--blur', type=float, default=3.0)
ap.add_argument('--glow', type=float, default=1.0, help='strength of the light pool behind the subject')
ap.add_argument('--seed', type=int, default=7)
a = ap.parse_args()

W, H = map(int, a.size.lower().split('x'))
sx, sy = map(float, a.subject.split(','))
rgb = lambda h: np.array([int(h.lstrip('#')[i:i + 2], 16) / 255 for i in (0, 2, 4)], np.float32)
wall, light, warm = rgb(a.wall), rgb(a.light), rgb(a.warm)
rng = np.random.default_rng(a.seed)
x = (np.arange(W, dtype=np.float32) + 0.5) / W
y = (np.arange(H, dtype=np.float32) + 0.5) / H
X, Y = np.meshgrid(x, y)

# ---- surface relief (1.0 = flat), varies only across x ----
k = H / 1080
if a.style == 'slats':
    pitch = 34 * k                                   # one slat + groove, in px
    u = (np.arange(W) % pitch) / pitch
    groove = 0.16
    face = np.clip((u - groove) / (1 - groove), 0, 1)
    shade = np.where(u < groove, 0.38 + 0.25 * (u / groove), 0.86 + 0.22 * np.sin(np.pi * face) - 0.1 * face)
    shade *= 1 + rng.normal(0, 0.025, int(W / pitch) + 2)[(np.arange(W) // pitch).astype(int)]   # slight per-slat variation
elif a.style == 'panels':
    pitch = 240 * k
    u = (np.arange(W) % pitch)
    shade = np.where(u < 2 * k, 0.55, 1.0) * (0.97 + 0.03 * np.cos(2 * np.pi * u / pitch))
else:
    shade = np.ones(W, np.float32)
relief = np.broadcast_to(shade.astype(np.float32), (H, W))

# ---- lighting ----
asp = W / H
d = np.sqrt(((X - sx) * asp / 0.55) ** 2 + ((Y - sy) / 0.75) ** 2)
pool = np.exp(-d ** 2 * 1.6) * a.glow                       # soft light behind the subject
up = np.clip(1 - Y, 0, 1) ** 0.0 * np.exp(-((1 - Y) / 0.28) ** 2)   # warm uplight from the floor
vign = np.clip(1 - 0.55 * (((X - 0.5) * 1.15) ** 2 + ((Y - 0.48) * 1.25) ** 2) * 2.2, 0.25, 1)

base = wall[None, None, :] * (0.55 + 0.45 * vign[..., None])
img = base * relief[..., None]
img += (light[None, None, :] * 0.22 * pool[..., None]) * (0.6 + 0.4 * relief[..., None])
img += (warm[None, None, :] * 0.10 * up[..., None]) * relief[..., None]

# ---- soft focus like a real lens, then fine grain so it sits with camera footage ----
def box(im, r):
    if r < 1: return im
    r = int(r)
    for ax in (0, 1):
        c = np.cumsum(np.pad(im, [(r + 1, r) if i == ax else (0, 0) for i in range(im.ndim)], mode='edge'), axis=ax)
        im = (np.take(c, range(2 * r + 1, c.shape[ax]), axis=ax) - np.take(c, range(0, c.shape[ax] - 2 * r - 1), axis=ax)) / (2 * r + 1)
    return im
for _ in range(3): img = box(img, a.blur * k)
img += rng.normal(0, 0.006, img.shape).astype(np.float32)
img = np.clip(img, 0, 1) ** (1 / 1.0)

buf = (img * 255 + 0.5).astype(np.uint8).tobytes()
subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-i', '-', '-frames:v', '1', a.out],
               input=buf, check=True)
print(a.out)
