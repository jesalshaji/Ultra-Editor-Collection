"""Word-by-word captions as one transparent HyperFrames composition (render it to ONE .mov/.webm with alpha,
instead of hundreds of caption PNGs - far lighter on the editor's RAM).

Style: clean white sans, words build in one by one with a soft blur-in, one accent phrase per line in an
italic serif + the accent colour, phrases break on pauses/punctuation, filler words dropped.

usage:
  python build.py words.json out_dir [--accent #hex] [--cx 640] [--fixes fixes.json] [--size 1280x720]
  then: npx hyperframes render out_dir -o captions.mov --fps 30   (transparent)

words.json : {"duration": 63.9, "words": [{"w": "Hello", "s": 0.12, "e": 0.40}, ...]}  (times in seconds,
             from a transcript of the SAME clean voice that is on the timeline)
fixes.json : optional {"fix": {"misheard": "Correct"}, "phrases": ["multi word accent", ...],
             "accent": ["single", "words"]}  - names, brands and terms for this video
"""
import json, re, sys, html, os, argparse

HERE = os.path.dirname(os.path.abspath(__file__))
W, H = 1280, 720
ACCENT = "#FFD24D"
CXV = 640
FILLERS = {"uh", "um", "umm", "mmm", "mm", "hmm", "uhh", "erm", "ah"}

# common speech-to-text slips for tech words; add your own names/brands with --fixes
WORD_FIX = {
    "fmpec": "FFmpeg", "ffmpeg": "FFmpeg", "github": "GitHub", "davinci": "DaVinci",
    "remotion": "Remotion", "sfx": "SFX", "powershell": "PowerShell", "linux": "Linux",
    "javascript": "JavaScript", "youtube": "YouTube",
}
# accent picks: first matching multi-word phrase, else a single key word, else a "good" word
MULTI = ["premiere pro", "after effects", "davinci resolve", "motion graphics", "claude code",
         "api key", "zip file", "free to use", "step by step", "behind the scenes", "subscribe"]
SINGLE = ["ffmpeg", "github", "davinci", "premiere", "remotion", "mcp", "free", "powershell",
          "terminal", "skill", "skills", "preset", "python", "node.js", "timestamps", "llm",
          "studio", "install", "resolve", "model", "tokens", "settings", "media"]
GOOD = ["styles", "editing", "motion", "system", "output", "subscription", "installation", "activation", "extension", "browser", "website", "automation", "freelance", "timestamps", "assets", "trained", "perfect", "accurate", "basic", "heavy", "requirements", "workflow", "rendered", "error", "fix", "reference", "download", "community", "channel", "notification", "researchers", "nothing", "everything", "upload", "project", "presets", "effects", "answer", "questions", "overwrite", "replace"]
STOP = set("the a an and or but with this that which what you your i am is are was were it its "
           "to of in on for from at by be can will just need like so if then there here have has "
           "do does done going gonna get got my me we our they them how all thing things using "
           "use video".split())


def core(w):
    return re.sub(r"^[^\w]+|[^\w.]+$", "", w).rstrip(".").lower()


def fix_tokens(words):
    out = []
    for wd in words:
        w, s, e = wd["w"].strip(), wd["s"], wd["e"]
        if not w:
            continue
        # attach ".5" / "-system" / ".js" fragments to previous token
        if out and (w[0] in ".-") and len(w) > 1:
            out[-1]["w"] += w
            out[-1]["e"] = e
            continue
        out.append({"w": w, "s": s, "e": e})
    res = []
    i = 0
    while i < len(out):
        t = dict(out[i])
        c = core(t["w"])
        nxt = core(out[i + 1]["w"]) if i + 1 < len(out) else ""
        if c in FILLERS:
            i += 1
            continue
        if c in WORD_FIX:
            t["w"] = re.sub(r"(?i)" + re.escape(c), WORD_FIX[c], t["w"], count=1)
        else:
            t["w"] = re.sub(r"(?i)\bfmpec\b", "FFmpeg", t["w"])
        res.append(t)
        i += 1
    # split tokens that became two words (e.g. "entire system") keep same timing
    final = []
    for t in res:
        parts = t["w"].split(" ")
        if len(parts) == 1:
            final.append(t)
        else:
            n = len(parts); d = (t["e"] - t["s"]) / n
            for k, p in enumerate(parts):
                final.append({"w": p, "s": round(t["s"] + k * d, 3), "e": round(t["s"] + (k + 1) * d, 3)})
    return final


def bound_flags(tokens):
    """bound[i] True -> token i continues a MULTI phrase started before it (no break allowed)."""
    lows = [core(t["w"]) for t in tokens]
    bound = [False] * len(tokens)
    for m in MULTI:
        mm = m.split(" ")
        if len(mm) < 2:
            continue
        for i in range(len(lows) - len(mm) + 1):
            if lows[i:i + len(mm)] == mm:
                for j in range(i + 1, i + len(mm)):
                    bound[j] = True
    return bound


def is_sentence(p):
    return bool(re.search(r"[.?!]$", p[-1]["w"])) and (p[0]["w"][:1].isupper())


def phrases(tokens, dur):
    bound = bound_flags(tokens)
    out, cur, chars = [], [], 0
    for i, t in enumerate(tokens):
        if cur:
            prev = cur[-1]
            gap = t["s"] - prev["e"]
            if bound[i] and gap < 1.0:
                brk = False
            else:
                brk = (len(cur) >= 8 or gap >= 0.5 or chars + len(t["w"]) + 1 > 44
                       or (re.search(r"[.?!]$", prev["w"]) and len(cur) >= 2)
                       or (prev["w"].endswith(",") and len(cur) >= 5))
            if (brk and gap < 0.5 and re.search(r"[.?!,]$", t["w"]) and len(cur) < 10
                    and chars + len(t["w"]) < 54 and not re.search(r"[.?!]$", prev["w"])):
                brk = False
            if brk:
                out.append(cur); cur, chars = [], 0
        cur.append(t); chars += len(t["w"]) + 1
    if cur:
        out.append(cur)
    # merge short fragments (1 word, or 2 words that aren't a sentence) into a neighbour
    changed = True
    while changed:
        changed = False
        for k, p in enumerate(out):
            short = (len(p) == 1 and not is_sentence(p)) or (len(p) == 2 and not is_sentence(p))
            if not short or len(out) == 1:
                continue
            gp = p[0]["s"] - out[k - 1][-1]["e"] if k > 0 else 99
            gn = out[k + 1][0]["s"] - p[-1]["e"] if k + 1 < len(out) else 99
            ends_sent = re.search(r"[.?!]$", out[k - 1][-1]["w"]) if k > 0 else True
            frag_ends = re.search(r"[.?!,]$", p[-1]["w"])
            if k > 0 and (frag_ends or ((gp <= gn or k + 1 >= len(out)) and not (ends_sent and gn < 99))):
                out[k - 1] = out[k - 1] + p
            elif k + 1 < len(out):
                out[k + 1] = p + out[k + 1]
            else:
                out[k - 1] = out[k - 1] + p
            del out[k]
            changed = True
            break
    merged = out
    res = []
    for k, p in enumerate(merged):
        start = max(0.0, p[0]["s"])
        end = p[-1]["e"] + 0.55
        if k + 1 < len(merged):
            end = min(end, max(merged[k + 1][0]["s"], start + 0.2))
        end = min(end, dur - 0.02)
        res.append({"words": p, "start": start, "end": end})
    return res


def pick_accent(p):
    lows = [core(w["w"]) for w in p]
    text = " ".join(lows)
    for m in MULTI:
        mm = m.split(" ")
        for i in range(len(lows) - len(mm) + 1):
            if lows[i:i + len(mm)] == mm:
                return list(range(i, i + len(mm)))
    for s in SINGLE:
        if s in lows:
            return [lows.index(s)]
    for s in GOOD:
        if s in lows:
            return [lows.index(s)]
    return []


def build(words_json, od, cx=None):
    d = json.load(open(words_json, encoding="utf-8"))
    dur = float(d["duration"])
    toks = fix_tokens(d["words"])
    ph = phrases(toks, dur)
    divs, js = [], []
    for k, p in enumerate(ph):
        acc = set(pick_accent(p["words"]))
        spans = []
        for i, w in enumerate(p["words"]):
            cls = "w acc" if i in acc else "w"
            spans.append(f'<span class="{cls}" id="w{k}_{i}">{html.escape(w["w"])}</span>')
        divs.append(f'<div class="ph" id="p{k}"><div class="tx">{"".join(spans)}</div></div>')
        js.append([round(p["start"], 3), round(p["end"], 3), [round(max(w["s"], p["start"]), 3) for w in p["words"]], sorted(acc)])
    page = TEMPLATE.replace("__DUR__", f"{dur:.3f}").replace("__DIVS__", "\n".join(divs)) \
        .replace("__DATA__", json.dumps(js)).replace("__ACC__", ACCENT).replace("__CX__", str(cx or CXV)) \
        .replace("1280px", f"{W}px").replace("720px", f"{H}px").replace('width=1280, height=720', f'width={W}, height={H}') \
        .replace('data-width="1280" data-height="720"', f'data-width="{W}" data-height="{H}"')
    os.makedirs(od, exist_ok=True)
    open(os.path.join(od, "index.html"), "w", encoding="utf-8").write(page)
    open(os.path.join(od, "hyperframes.json"), "w").write('{"paths":{"assets":"assets"}}')
    open(os.path.join(od, "package.json"), "w").write('{"name":"captions","private":true,"type":"module"}')
    print(od, f"{dur:.2f}s", len(toks), "words", len(ph), "phrases")
    return ph


TEMPLATE = r"""<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=1280, height=720" />
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@500;600&family=Instrument+Serif:ital@1&display=block" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<style>
* { margin:0; padding:0; box-sizing:border-box; }
html, body { width:1280px; height:720px; overflow:hidden; background:transparent; }
#root { position:relative; width:1280px; height:720px; background:transparent; }
.ph { position:absolute; left:__CX__px; bottom:118px; width:760px; margin-left:-380px;
      text-align:center; visibility:hidden; }
.tx { position:relative; display:inline-block; max-width:760px; padding:6px 22px 8px;
      font-family:'Inter','Segoe UI',sans-serif; font-weight:600; font-size:34px;
      line-height:1.22; letter-spacing:-0.015em; color:#F7F6FB; text-wrap:balance;
      text-shadow:0 2px 6px rgba(0,0,0,.55), 0 0 18px rgba(0,0,0,.4); }
.tx::before { content:''; position:absolute; inset:-4px -10px; border-radius:26px; z-index:-1;
      background:radial-gradient(ellipse 70% 75% at 50% 50%, rgba(4,3,9,.5) 0%, rgba(4,3,9,.42) 55%, rgba(4,3,9,0) 100%);
      filter:blur(10px); }
.w { display:none; opacity:0; margin:0 0.13em; }
.w.acc { font-family:'Instrument Serif','Georgia',serif; font-style:italic; font-weight:400;
         font-size:1.2em; letter-spacing:0; color:__ACC__; line-height:1; margin:0 0.1em;
         text-shadow:0 1px 3px rgba(0,0,0,.75), 0 0 16px rgba(0,0,0,.55); }
</style>
</head>
<body>
<div id="root" data-composition-id="main" data-start="0" data-duration="__DUR__" data-width="1280" data-height="720">
__DIVS__
</div>
<script>
const DATA = __DATA__;
const DUR = __DUR__;
const tl = gsap.timeline({ paused: true });
DATA.forEach((p, k) => {
  const [st, en, ws, acc] = p;
  tl.set('#p' + k, { visibility: 'visible', opacity: 1 }, st);
  ws.forEach((t, i) => {
    const id = '#w' + k + '_' + i;
    tl.set(id, { display: 'inline-block' }, t);
    if (acc.includes(i)) {
      tl.set(id, { opacity: 1 }, t);
    } else {
      tl.fromTo(id, { opacity: 0, y: 7, filter: 'blur(5px)' },
        { opacity: 1, y: 0, filter: 'blur(0px)', duration: 0.12, ease: 'power2.out', immediateRender: false }, t);
    }
  });
  const fo = Math.max(st + 0.05, en - 0.14);
  tl.to('#p' + k, { opacity: 0, duration: Math.min(0.14, en - fo), ease: 'power1.in' }, fo);
  tl.set('#p' + k, { visibility: 'hidden' }, en);
});
tl.set({}, {}, DUR);
window.__timelines = window.__timelines || {};
window.__timelines["main"] = tl;
tl.seek(0);
</script>
</body>
</html>
"""

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("words")
    ap.add_argument("out_dir")
    ap.add_argument("--accent", default=None, help="#hex accent colour (default yellow #FFD24D)")
    ap.add_argument("--cx", type=int, default=None, help="caption centre x in px (default: middle)")
    ap.add_argument("--size", default="1280x720")
    ap.add_argument("--fixes", default=None, help="json with fix / phrases / accent lists for this video")
    a = ap.parse_args()
    W, H = (int(v) for v in a.size.lower().split("x"))
    CXV = W // 2
    if a.accent:
        ACCENT = a.accent
    if a.fixes:
        fx = json.load(open(a.fixes, encoding="utf-8"))
        WORD_FIX.update({k.lower(): v for k, v in fx.get("fix", {}).items()})
        MULTI[:0] = [m.lower() for m in fx.get("phrases", [])]
        SINGLE[:0] = [m.lower() for m in fx.get("accent", [])]
    if True:
        ph = build(a.words, a.out_dir, a.cx)
        if os.environ.get("SHOW"):
            for p in ph[:40]:
                acc = set(pick_accent(p["words"]))
                print(f'{p["start"]:7.2f}-{p["end"]:7.2f} ' + " ".join(("*" + w["w"] + "*") if i in acc else w["w"] for i, w in enumerate(p["words"])))
