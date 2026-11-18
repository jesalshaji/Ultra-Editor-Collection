"""B-roll card templates (HyperFrames + GSAP). Colours come from a theme tokens.json (neutral by default).

Usage:
  python make.py article spec.json out.mp4 [--dur 4] [--accent #hex] [--theme tokens.json]
  python make.py concept spec.json out.mp4 [--dur 4]
  python make.py chapter '{"n":2,"total":5,"title":"Why *this*"}' out.mp4
  (spec may also be an inline JSON string)

article spec: {"site":"The Verge","url":"theverge.com/ai/claude-mcp","logo":"V",
               "headline":"...","byline":"optional","lines":["..","..",".."],"highlight":1}
               highlight = index into lines (or the exact line text)
concept spec: {"title":"optional tag/title","nodes":[{"label":"Claude","sub":"optional","icon":"spark"},...],
               "active": -1}  icons: spark plug film doc code user cloud bolt chat search gear folder ...
               A node can show a REAL logo instead of an icon: {"label":"Premiere","logo":"premiere"}
               -> templates/logos/premiere.svg (run fetch_logos.py once; add your own SVGs there too).
Theme: --theme path/to/tokens.json, else $ULTRA_THEME (folder name in connectors/ultra-premiere-mcp/styles
or a path), else the built-in neutral palette.
"""
import json, os, sys, shutil, subprocess, argparse, html

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(HERE, "..", "..", "..", ".."))
STYLES = os.path.join(REPO, "connectors", "ultra-premiere-mcp", "styles")
W, H, FPS = 1280, 720, 30

def theme_file(arg):
    t = arg or os.environ.get("ULTRA_THEME", "")
    if not t:
        return None
    if os.path.isfile(t):
        return t
    f = os.path.join(STYLES, t, "tokens.json")
    return f if os.path.isfile(f) else None

def colors(accent, theme=None):
    # built-in neutral palette; a theme tokens.json overrides it
    c = {"bg": "#0E0E10", "bg2": "#16161A", "panel": "#1C1C21", "edge": "#303036",
         "text": "#FFFFFF", "muted": "#A0A0A8", "deep": "#E0A800", "acc": "#FFD24D"}
    f = theme_file(theme)
    if f:
        t = json.load(open(f, encoding="utf-8"))["color"]
        c.update(bg=t["bg"], bg2=t["bg2"], panel=t["panel"], edge=t["panelEdge"], text=t["text"], muted=t["muted"],
                 deep=t.get("accentDeep", t.get("lavenderDeep", c["deep"])),
                 acc=t.get("accent", t.get("lavender", c["acc"])))
    if accent:
        c["acc"] = accent
    return c

LOGOS_DIR = os.path.join(HERE, "logos")
LOGOS_USED = set()

ICONS = {  # 24x24 stroke icons
 "spark": '<path d="M12 2v6M12 16v6M2 12h6M16 12h6M5 5l4 4M15 15l4 4M19 5l-4 4M9 15l-4 4"/>',
 "plug": '<path d="M9 2v6M15 2v6M6 8h12v4a6 6 0 0 1-12 0zM12 18v4"/>',
 "film": '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/>',
 "doc": '<path d="M6 2h9l5 5v15H6z"/><path d="M14 2v6h6M9 13h8M9 17h6"/>',
 "code": '<path d="M8 6l-6 6 6 6M16 6l6 6-6 6M14 4l-4 16"/>',
 "user": '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>',
 "cloud": '<path d="M7 18h10a4 4 0 0 0 .5-7.97A6 6 0 0 0 6 9a4.5 4.5 0 0 0 1 9z"/>',
 "bolt": '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
 "chat": '<path d="M4 4h16v12H9l-5 4z"/>',
 "check": '<circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/>',
 "download": '<path d="M12 3v12M7 10l5 5 5-5M4 20h16"/>',
 "link": '<path d="M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1"/>',
 "play": '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M10 9l5 3-5 3z"/>',
 "tag": '<path d="M3 12V3h9l9 9-9 9z"/><circle cx="8" cy="8" r="1.5"/>',
 "warn": '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/>',
 "gauge": '<path d="M3 17a9 9 0 0 1 18 0"/><path d="M12 17l5-6"/>',
 "layers": '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
 "clock": '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>',
 "x": '<circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/>',
 "zip": '<path d="M6 2h12v20H6z"/><path d="M12 2v2M12 6v2M12 10v2M10 14h4v4h-4z"/>',
 "list": '<path d="M9 6h12M9 12h12M9 18h12"/><path d="M4 6h.5M4 12h.5M4 18h.5"/>',
 "chip": '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
 "search": '<circle cx="11" cy="11" r="7"/><path d="M16 16l5 5"/>',
 "gear": '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>',
 "folder": '<path d="M3 6h6l2 2h10v11H3z"/>',
}

HEAD = """<!doctype html><html lang="en"><head><meta charset="UTF-8"/>
<meta name="viewport" content="width={W}, height={H}"/>
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<style>
*{{margin:0;padding:0;box-sizing:border-box}}
html,body{{width:{W}px;height:{H}px;overflow:hidden;background:{bg}}}
#root{{position:relative;width:{W}px;height:{H}px;overflow:hidden;font-family:"Segoe UI",system-ui,sans-serif;color:{text};
 background:radial-gradient(ellipse 70% 60% at 50% 45%, {bg2} 0%, {bg} 75%)}}
{css}
</style></head><body>
<div id="root" data-composition-id="main" data-start="0" data-duration="{dur}" data-width="{W}" data-height="{H}">
<div class="clip" data-start="0" data-duration="{dur}" data-track-index="0" style="position:absolute;inset:0">
{body}
</div></div>
<script>
const D={dur};
const tl=gsap.timeline({{paused:true}});
{js}
tl.to({{}}, {{duration:0.001}}, D-0.001);
window.__timelines["main"]=tl; tl.seek(0);
</script></body></html>"""

def e(s): return html.escape(str(s))

def article(spec, dur, c):
    lines = spec.get("lines", [])[:4]
    hl = spec.get("highlight", 0)
    if isinstance(hl, str):
        hl = lines.index(hl) if hl in lines else 0
    logo = spec.get("logo") or (spec.get("site", "?")[:1])
    css = f"""
#stage{{position:absolute;inset:0;perspective:1500px}}
#card{{position:absolute;left:150px;top:70px;width:980px;height:600px;border-radius:28px;background:{c['panel']};
 border:1px solid {c['edge']};box-shadow:0 40px 100px rgba(0,0,0,.6);overflow:hidden;transform-style:preserve-3d}}
#bar{{height:52px;background:{c['bg2']};border-bottom:1px solid {c['edge']};display:flex;align-items:center;padding:0 20px;gap:9px}}
.dot{{width:12px;height:12px;border-radius:50%;background:{c['edge']}}}
#url{{margin-left:22px;flex:1;height:32px;border-radius:16px;background:{c['panel']};border:1px solid {c['edge']};
 display:flex;align-items:center;padding:0 16px;font:15px Consolas,monospace;color:{c['muted']};gap:10px}}
#url b{{color:{c['text']};font-weight:400}}
#page{{padding:34px 64px}}
#site{{display:flex;align-items:center;gap:14px;font-weight:700;font-size:21px;letter-spacing:.02em;padding-bottom:22px;
 border-bottom:1px solid {c['edge']};margin-bottom:28px}}
#logo{{min-width:38px;height:38px;padding:0 8px;border-radius:10px;background:{c['acc']};color:{c['bg']};display:flex;
 align-items:center;justify-content:center;font-weight:900;font-size:18px}}
#site .tag{{margin-left:auto;font:13px Consolas,monospace;color:{c['muted']};text-transform:uppercase;letter-spacing:.12em}}
h1{{font-family:Georgia,serif;font-weight:400;font-size:54px;line-height:1.12;letter-spacing:-.01em;margin-bottom:14px}}
#by{{font-size:17px;color:{c['muted']};margin-bottom:26px}}
.ln{{position:relative;font-size:27px;line-height:1.45;color:{c['text']};opacity:.88;margin-bottom:14px;width:fit-content;max-width:880px}}
.ln span{{position:relative;z-index:1}}
.hl{{position:absolute;left:-8px;right:-8px;top:2px;bottom:2px;border-radius:6px;background:{c['acc']};transform-origin:0 50%;transform:scaleX(0);z-index:0}}
"""
    rows = []
    for i, t in enumerate(lines):
        mark = '<i class="hl"></i>' if i == hl else ""
        rows.append(f'<p class="ln" id="l{i}">{mark}<span>{e(t)}</span></p>')
    by = f'<div id="by">{e(spec["byline"])}</div>' if spec.get("byline") else '<div id="by"></div>'
    body = f"""<div id="stage"><div id="card">
<div id="bar"><i class="dot"></i><i class="dot"></i><i class="dot"></i>
<div id="url"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="{c['muted']}" stroke-width="2.5"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg><b>{e(spec.get('url',''))}</b></div></div>
<div id="page"><div id="site"><div id="logo">{e(logo)}</div>{e(spec.get('site',''))}<span class="tag">Article</span></div>
<h1>{e(spec.get('headline',''))}</h1>{by}{''.join(rows)}</div></div></div>"""
    others = ",".join(f"#l{i}" for i in range(len(lines)) if i != hl) or "#none"
    t_hl = max(0.9, dur * 0.42)
    js = f"""
gsap.set("#card",{{transformOrigin:"50% 65%"}});
tl.fromTo("#card",{{opacity:0,y:60,scale:.86,rotationX:16,rotationY:-14,filter:"blur(8px)"}},
  {{opacity:1,y:0,scale:.92,rotationX:9,rotationY:-8,filter:"blur(0px)",duration:.6,ease:"expo.out"}},0);
tl.to("#card",{{scale:1.06,rotationX:3,rotationY:-2,y:-10,duration:D-.6,ease:"power1.inOut"}},.6);
tl.from("#page > *",{{opacity:0,y:14,duration:.4,stagger:.06,ease:"power3.out"}},.15);
tl.to("#l{hl} .hl",{{scaleX:1,duration:.45,ease:"power2.inOut"}},{t_hl:.2f});
tl.to("#l{hl} span",{{color:"{c['bg']}",duration:.25}},{t_hl+0.12:.2f});
tl.to("{others}, h1, #by, #site",{{opacity:.28,filter:"blur(1.5px)",duration:.5,ease:"power2.out"}},{t_hl:.2f});
tl.to("#l{hl}",{{scale:1.04,transformOrigin:"0% 50%",duration:.6,ease:"power2.out"}},{t_hl:.2f});
"""
    return css, body, js

def concept(spec, dur, c):
    nodes = spec.get("nodes", [])[:4]
    n = len(nodes)
    active = spec.get("active", n - 1)
    nw, gap = (200, 96) if n == 4 else (230, 160)
    total = n * nw + (n - 1) * gap
    x0 = (W - total) / 2
    cy = 380 if spec.get("title") else 350
    css = f"""
#title{{position:absolute;left:0;right:0;top:120px;text-align:center;font-family:Georgia,serif;font-size:40px}}
#title em{{color:{c['acc']}}}
#tag{{position:absolute;left:64px;top:52px;font:14px Consolas,monospace;letter-spacing:.16em;text-transform:uppercase;color:{c['muted']}}}
.node{{position:absolute;width:{nw}px;height:200px;top:{cy-100}px;border-radius:28px;background:{c['panel']};border:1.5px solid {c['edge']};
 box-shadow:0 30px 80px rgba(0,0,0,.55);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px}}
.ic{{width:76px;height:76px;border-radius:20px;background:{c['bg2']};border:1px solid {c['edge']};display:flex;align-items:center;justify-content:center}}
.ic svg{{width:40px;height:40px;fill:none;stroke:{c['acc']};stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}}
.ic.logo{{background:transparent;border:none}}
.ic.logo img{{width:76px;height:76px;object-fit:contain;filter:drop-shadow(0 8px 18px rgba(0,0,0,.5))}}
.lab{{font-size:23px;font-weight:600;text-align:center;line-height:1.15;padding:0 12px}}
.sub{{font:12px Consolas,monospace;letter-spacing:.14em;text-transform:uppercase;color:{c['muted']};margin-top:-8px}}
.ring{{position:absolute;inset:-2px;border-radius:28px;border:2px solid {c['acc']};opacity:0}}
svg#wires{{position:absolute;inset:0}}
"""
    parts, wires, js = [], [], []
    title = spec.get("title", "")
    if title:
        # *word* -> accent italic
        t = e(title)
        import re
        t = re.sub(r"\*(.+?)\*", r"<em>\1</em>", t)
        parts.append(f'<div id="title">{t}</div>')
    if spec.get("tag"):
        parts.append(f'<div id="tag">{e(spec["tag"])}</div>')
    for i, nd in enumerate(nodes):
        x = x0 + i * (nw + gap)
        sub = f'<div class="sub">{e(nd["sub"])}</div>' if nd.get("sub") else ""
        if nd.get("logo"):  # real app logo from templates/logos/<name>.svg
            LOGOS_USED.add(nd["logo"])
            ich = f'<div class="ic logo"><img src="assets/{e(nd["logo"])}.svg" alt=""/></div>'
        else:
            ic = ICONS.get(nd.get("icon", "spark"), ICONS["spark"])
            ich = f'<div class="ic"><svg viewBox="0 0 24 24">{ic}</svg></div>'
        parts.append(f'<div class="node" id="n{i}" style="left:{x:.0f}px"><i class="ring"></i>'
                     f'{ich}<div class="lab">{e(nd.get("label",""))}</div>{sub}</div>')
        if i < n - 1:
            a, b = x + nw + 14, x + nw + gap - 14
            L = b - a
            wires.append(f'<line id="w{i}" x1="{a:.0f}" y1="{cy}" x2="{b:.0f}" y2="{cy}" stroke="{c["acc"]}" stroke-width="3" stroke-linecap="round" stroke-dasharray="{L:.0f}" stroke-dashoffset="{L:.0f}"/>'
                         f'<path id="h{i}" d="M{b-12:.0f} {cy-9} L{b:.0f} {cy} L{b-12:.0f} {cy+9}" fill="none" stroke="{c["acc"]}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" opacity="0"/>'
                         f'<circle id="p{i}" cx="{a:.0f}" cy="{cy}" r="6" fill="{c["text"]}" opacity="0"/>')
    parts.insert(0, f'<svg id="wires" viewBox="0 0 {W} {H}">{"".join(wires)}</svg>')
    build = min(dur * 0.6, 0.35 + n * 0.55)
    step = (build - 0.3) / max(n, 1)
    js.append('tl.fromTo("#root > .clip",{scale:1},{scale:1.035,duration:D,ease:"none"},0);')
    if title:
        js.append('tl.from("#title",{opacity:0,y:20,filter:"blur(6px)",duration:.5,ease:"expo.out"},0);')
    if spec.get("tag"):
        js.append('tl.from("#tag",{opacity:0,x:-20,duration:.4,ease:"power3.out"},0);')
    for i in range(n):
        t = 0.1 + i * step
        js.append(f'tl.from("#n{i}",{{opacity:0,scale:.8,y:24,filter:"blur(8px)",duration:.45,ease:"back.out(1.6)"}},{t:.2f});')
        if i < n - 1:
            tw = t + step * 0.45
            js.append(f'tl.to("#w{i}",{{strokeDashoffset:0,duration:{step*0.7:.2f},ease:"power2.inOut"}},{tw:.2f});')
            js.append(f'tl.to("#h{i}",{{opacity:1,duration:.15}},{tw+step*0.6:.2f});')
    # pulses travel along the chain after build
    tp = build
    seg = max(0.25, min(0.45, (dur - build - 0.4) / max(n - 1, 1)))
    for i in range(n - 1):
        L = gap - 28
        js.append(f'tl.set("#p{i}",{{opacity:1}},{tp:.2f});tl.to("#p{i}",{{attr:{{cx:"+={L}"}},duration:{seg:.2f},ease:"power1.inOut"}},{tp:.2f});tl.set("#p{i}",{{opacity:0}},{tp+seg:.2f});')
        js.append(f'tl.to("#n{i+1} .ring",{{opacity:.55,duration:.12,yoyo:true,repeat:1}},{tp+seg-0.05:.2f});')
        tp += seg
    if 0 <= active < n:
        js.append(f'tl.to("#n{active} .ring",{{opacity:1,duration:.3}},{tp:.2f});')
        js.append(f'tl.to("#n{active}",{{scale:1.06,duration:.4,ease:"back.out(2)"}},{tp:.2f});')
    return css, "\n".join(parts), "\n".join(js)

def chapter(spec, dur, c):
    import re
    n, tot = int(spec.get("n", 1)), int(spec.get("total", 5))
    t = re.sub(r"\*(.+?)\*", r"<em>\1</em>", e(spec.get("title", "")))
    css = f"""
#wrap{{position:absolute;left:0;right:0;top:220px;text-align:center}}
#tag{{display:inline-block;font:15px Consolas,monospace;letter-spacing:.22em;text-transform:uppercase;color:{c['muted']};
 padding:8px 18px;border:1px solid {c['edge']};border-radius:18px;background:{c['panel']}}}
#title{{font-family:Georgia,serif;font-size:84px;line-height:1.1;margin-top:28px;letter-spacing:-.01em}}
#title em{{color:{c['acc']}}}
#rule{{width:120px;height:2px;background:{c['acc']};margin:30px auto 0;transform-origin:50% 50%}}
#dots{{display:flex;gap:16px;justify-content:center;margin-top:34px}}
.d{{width:10px;height:10px;border-radius:50%;background:{c['edge']}}}
.d.on{{background:{c['acc']}}}
"""
    dots = "".join(f'<i class="d{" on" if i+1==n else ""}" id="d{i}"></i>' for i in range(tot))
    body = f'<div id="wrap"><div id="tag">Chapter {n:02d}</div><div id="title">{t}</div><div id="rule"></div><div id="dots">{dots}</div></div>'
    js = f"""
tl.fromTo("#wrap",{{scale:1}},{{scale:1.03,duration:D,ease:"none"}},0);
tl.from("#tag",{{opacity:0,y:-12,duration:.35,ease:"power3.out"}},0.05);
tl.from("#title",{{opacity:0,y:26,filter:"blur(10px)",duration:.55,ease:"expo.out"}},0.12);
tl.from("#rule",{{scaleX:0,duration:.45,ease:"power2.inOut"}},0.35);
tl.from(".d",{{opacity:0,scale:0,duration:.25,stagger:.05,ease:"back.out(2)"}},0.45);
tl.fromTo("#d{n-1}",{{scale:1}},{{scale:1.6,duration:.3,ease:"back.out(3)"}},0.85);
"""
    return css, body, js

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("kind", choices=["article", "concept", "chapter"])
    ap.add_argument("spec")
    ap.add_argument("out")
    ap.add_argument("--dur", type=float, default=4.0)
    ap.add_argument("--accent", default=None, help="#hex; default = the theme accent")
    ap.add_argument("--theme", default=None, help="tokens.json path or theme name; default $ULTRA_THEME or neutral")
    ap.add_argument("--keep", action="store_true", help="keep build folder")
    a = ap.parse_args()
    spec = json.load(open(a.spec, encoding="utf-8")) if os.path.isfile(a.spec) else json.loads(a.spec)
    dur = max(2.0, min(6.0, a.dur))
    c = colors(a.accent, a.theme)
    css, body, js = {"article": article, "concept": concept, "chapter": chapter}[a.kind](spec, dur, c)
    page = HEAD.format(W=W, H=H, dur=dur, css=css, body=body, js=js, bg=c["bg"], bg2=c["bg2"], text=c["text"])
    name = os.path.splitext(os.path.basename(a.out))[0]
    proj = os.path.join(HERE, "_build", name)
    os.makedirs(proj, exist_ok=True)
    open(os.path.join(proj, "index.html"), "w", encoding="utf-8").write(page)
    if LOGOS_USED:
        os.makedirs(os.path.join(proj, "assets"), exist_ok=True)
        for lg in LOGOS_USED:
            src = os.path.join(LOGOS_DIR, lg + ".svg")
            if not os.path.isfile(src):
                sys.exit(f"Logo '{lg}' not found in {LOGOS_DIR}. Run fetch_logos.py, or save the official SVG there as {lg}.svg")
            shutil.copy(src, os.path.join(proj, "assets", lg + ".svg"))
    open(os.path.join(proj, "hyperframes.json"), "w").write('{"paths":{"assets":"assets"}}')
    open(os.path.join(proj, "package.json"), "w").write('{"name":"%s","private":true,"type":"module"}' % name.lower().replace(" ", "-"))
    out = os.path.abspath(a.out)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    cmd = f'npx -y hyperframes@0.8.216 render "{proj}" -o "{out}" --fps {FPS} --quality delivery --quiet'
    r = subprocess.run(cmd, shell=True)
    if r.returncode != 0:
        sys.exit(r.returncode)
    if not a.keep:
        shutil.rmtree(proj, ignore_errors=True)
    print(out)

if __name__ == "__main__":
    main()
