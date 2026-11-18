"""transcribe.py: word-level transcript of a video/audio file with faster-whisper (local, free).

    python transcribe.py <media> <out.json> [--model small] [--language en]

Writes {"language", "duration", "segments":[{start,end,text}], "words":[{w,s,e,p}]}.
"""
import argparse, json, sys

ap = argparse.ArgumentParser()
ap.add_argument('media'); ap.add_argument('out')
ap.add_argument('--model', default='small')
ap.add_argument('--language', default=None)
a = ap.parse_args()

import subprocess
import numpy as np
from faster_whisper import WhisperModel

# decode with ffmpeg (16 kHz mono float), so any format Premiere uses works
pcm = subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-i', a.media, '-vn', '-ac', '1', '-ar', '16000', '-f', 'f32le', '-'],
                     check=True, capture_output=True).stdout
audio = np.frombuffer(pcm, dtype=np.float32)
import os
# CPU by default (works everywhere). Set ULTRA_PREMIERE_WHISPER_DEVICE=cuda if CUDA 12 + cuDNN are installed.
dev = os.environ.get('ULTRA_PREMIERE_WHISPER_DEVICE', 'cpu')
model = WhisperModel(a.model, device=dev, compute_type='int8' if dev == 'cpu' else 'float16')
segs, info = model.transcribe(audio, language=a.language, word_timestamps=True, vad_filter=True,
                              vad_parameters={'min_silence_duration_ms': 300})
out = {'language': info.language, 'duration': info.duration, 'segments': [], 'words': []}
for s in segs:
    out['segments'].append({'start': round(s.start, 3), 'end': round(s.end, 3), 'text': s.text.strip()})
    for w in (s.words or []):
        out['words'].append({'w': w.word.strip(), 's': round(w.start, 3), 'e': round(w.end, 3), 'p': round(w.probability, 3)})
    print(f'{s.end:7.1f}s  {s.text.strip()[:70]}', file=sys.stderr, flush=True)
with open(a.out, 'w', encoding='utf-8') as f:
    json.dump(out, f, ensure_ascii=False, indent=1)
print(a.out)
