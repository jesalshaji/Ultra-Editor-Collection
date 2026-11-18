"""sync.py: find the exact offset between two recordings of the same speech (e.g. the clean voice vs the
OBS mic track, or the mic file vs a screen file). Cross-correlates the loudness envelopes.

    python sync.py <reference> <other> [--ref-stream 0] [--other-stream 0] [--max 120]

Prints JSON {"offset": s, "confidence": 0-1}: offset = how many seconds <other> starts AFTER <reference>
(other_time = reference_time - offset). confidence < 0.3 means the two files probably do not share audio.
"""
import argparse, json, subprocess
import numpy as np

ap = argparse.ArgumentParser()
ap.add_argument('ref'); ap.add_argument('other')
ap.add_argument('--ref-stream', type=int, default=0); ap.add_argument('--other-stream', type=int, default=0)
ap.add_argument('--max', type=float, default=120.0, help='largest offset to search, seconds')
ap.add_argument('--video', action='store_true', help='match the PICTURE (screen changes) instead of the sound')
a = ap.parse_args()
SR = 1000  # envelope samples per second


def envelope(path, stream):
    pcm = subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-i', path, '-map', f'0:a:{stream}', '-ac', '1', '-ar', '8000', '-f', 'f32le', '-'],
                         capture_output=True, check=True).stdout
    x = np.frombuffer(pcm, np.float32)
    x = np.abs(x[: len(x) // 8 * 8]).reshape(-1, 8).mean(1)          # 1 kHz loudness envelope
    x = np.log1p(x * 50); x -= x.mean(); x /= (x.std() + 1e-9)
    return x


def vid_envelope(path):
    # how much the picture changes per frame (60 fps grid), same scale for both files
    raw = subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-i', path, '-vf', 'fps=60,scale=160:90,format=gray', '-f', 'rawvideo', '-'],
                         capture_output=True, check=True).stdout
    f = np.frombuffer(raw, np.uint8).reshape(-1, 90, 160).astype(np.float32)
    d = np.abs(np.diff(f, axis=0)).mean((1, 2)); d = np.log1p(d); d -= d.mean(); d /= (d.std() + 1e-9)
    return np.repeat(d, int(SR / 60))   # onto the 1 kHz grid


if a.video: r, o = vid_envelope(a.ref), vid_envelope(a.other)
else: r, o = envelope(a.ref, a.ref_stream), envelope(a.other, a.other_stream)
n = 1 << int(np.ceil(np.log2(len(r) + len(o))))
cc = np.fft.irfft(np.fft.rfft(r, n) * np.conj(np.fft.rfft(o, n)), n)
lags = np.concatenate([np.arange(0, len(r)), np.arange(-len(o) + 1, 0)])
vals = np.concatenate([cc[:len(r)], cc[n - len(o) + 1:]])
ok = np.abs(lags) <= a.max * SR
lags, vals = lags[ok], vals[ok]
best = int(np.argmax(vals))
overlap = max(1, min(len(r), len(o)) - 0)
conf = float(vals[best] / overlap)
second = np.sort(vals)[-int(SR * 0.5)] if len(vals) > SR else 0   # how clearly the peak stands out
print(json.dumps({'offset': round(lags[best] / SR, 3), 'confidence': round(max(0.0, min(1.0, conf)), 3),
                  'peakRatio': round(float(vals[best] / (abs(second) + 1e-9)), 2)}))
