"""follow.py: find where the action is on a screen recording (clicks, typing, scrolling, cursor),
so the zoom can glide there.  python follow.py <video> <start> <end> [maxZoom] [minZoom]

Prints JSON {"points": [{"t", "x", "y", "zoom"}]}: t = seconds from <start>, x/y = 0-1 of the frame,
zoom = how far to scale in (1 = whole screen). A new point is made only when the action settles
somewhere clearly different, so the view moves calmly instead of chasing every pixel.
"""
import json, subprocess, sys
import numpy as np

src, t0, t1 = sys.argv[1], float(sys.argv[2]), float(sys.argv[3])
ZMAX = float(sys.argv[4]) if len(sys.argv) > 4 else 1.8
ZMIN = float(sys.argv[5]) if len(sys.argv) > 5 else 1.0
FPS, W = 6, 320

probe = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', src],
                       capture_output=True, text=True, check=True).stdout.strip().split(',')
sw, sh = int(probe[0]), int(probe[1]); H = int(round(W * sh / sw / 2) * 2)
raw = subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-ss', str(t0), '-t', str(t1 - t0), '-i', src,
                      '-vf', f'fps={FPS},scale={W}:{H},format=gray', '-f', 'rawvideo', '-'], capture_output=True, check=True).stdout
frames = np.frombuffer(raw, np.uint8).reshape(-1, H, W).astype(np.int16)

samples = []  # (t, cx, cy, w, h) of the change, or None when the screen is still
for i in range(1, len(frames)):
    d = np.abs(frames[i] - frames[i - 1]) > 22
    n = d.sum()
    if n < W * H * 0.0006:
        samples.append((i / FPS, None)); continue
    ys, xs = np.nonzero(d)
    x0, x1 = np.percentile(xs, [4, 96]); y0, y1 = np.percentile(ys, [4, 96])
    if n > W * H * 0.35:   # whole-screen change (page load / scroll): look at the whole page
        samples.append((i / FPS, (0.5, 0.5, 1.0, 1.0))); continue
    samples.append((i / FPS, ((x0 + x1) / 2 / W, (y0 + y1) / 2 / H, max(0.08, (x1 - x0) / W), max(0.08, (y1 - y0) / H))))


def zoom_for(w, h):
    return float(np.clip(0.62 / max(w, h * 0.9), ZMIN, ZMAX))


points = [{'t': 0.0, 'x': 0.5, 'y': 0.5, 'zoom': ZMIN}]
pending, still = [], 0.0
for t, s in samples:
    if s is None:
        still += 1 / FPS
        if still > 3.0 and points[-1]['zoom'] > ZMIN + 0.05:   # nothing happening for a while: ease back out
            points.append({'t': round(t, 2), 'x': 0.5, 'y': 0.5, 'zoom': ZMIN}); pending = []
        continue
    still = 0.0
    pending.append((t, s))
    if len(pending) < 3: continue                          # needs ~0.5 s of activity in one place
    xs = [p[1][0] for p in pending[-3:]]; ys = [p[1][1] for p in pending[-3:]]
    if max(xs) - min(xs) > 0.2 or max(ys) - min(ys) > 0.2:  # still wandering
        pending = pending[-2:]; continue
    cx, cy = float(np.mean(xs)), float(np.mean(ys))
    w = float(np.mean([p[1][2] for p in pending[-3:]])); h = float(np.mean([p[1][3] for p in pending[-3:]]))
    z = zoom_for(w, h); last = points[-1]
    if abs(cx - last['x']) > 0.14 or abs(cy - last['y']) > 0.14 or abs(z - last['zoom']) > 0.25:
        if t - last['t'] >= 1.2:                              # hold each spot at least 1.2 s
            points.append({'t': round(pending[-3][0], 2), 'x': round(cx, 3), 'y': round(cy, 3), 'zoom': round(z, 2)})
    pending = []

print(json.dumps({'points': points, 'size': [sw, sh]}))
