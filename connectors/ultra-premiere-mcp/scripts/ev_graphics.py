"""ev_graphics.py: theme graphics (Pillow), colours from the active theme (ULTRA_THEME). One JSON spec in, one or more PNGs out.

    python ev_graphics.py spec.json

kinds:
  background  {W,H,out, grid?:true, glow?:[x,y]}                     dark canvas, accent grid + soft glow
  panel_mask  {W,H,out, rect:[x,y,w,h] (0-1), radius?}                white rounded rect on transparent (for alphamerge)
  panel_frame {W,H,out, rects:[[x,y,w,h],...], radius?}               glowing accent borders + soft drop shadow
  highlight   {W,H,out, rect:[x,y,w,h], radius?, label?}              outlined accent box with glow (+ optional tag)
  chapter     {W,H,out, num:"01", title, bg?:true}                    "01  why does this really matter?" + underline
  name_tag    {W,H,out, header:"my name is", name}                    the name-tag card
  list        {W,H,outPrefix, title, items:[{text, sub?}], bg?}       numbered list, one PNG per build step
  keyword     {W,H,out, text, x?, y?, size?}                          big accent word with glow (pops beside the face)
  label       {W,H,out, text, x, y, size?}                            mono uppercase label in a glowing chip (ref 1)
  caption     {W,H,out, text, accent?, y?}                            small white caption; words in *stars* turn accent serif-italic
"""
import json, os, re, sys
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
# Theme: ULTRA_THEME = folder name in styles/ (default "neutral") or a path to a tokens.json
_THEME = os.environ.get('ULTRA_THEME', 'neutral')
_TOKFILE = _THEME if os.path.isfile(_THEME) else os.path.join(HERE, '..', 'styles', _THEME, 'tokens.json')
TOK = json.load(open(_TOKFILE, encoding='utf-8'))
C, F = TOK['color'], TOK['font']
for _a, _b in (('accent', 'lavender'), ('accentDeep', 'lavenderDeep'), ('accentSoft', 'lavenderSoft')):
    C.setdefault(_a, C.get(_b)); C.setdefault(_b, C.get(_a))
TOK.setdefault('accent', 'accent')
FX = TOK.get('effects', {})


def accent(s, key='accent'):
    # per-graphic accent: spec 'accent' as a hex or a token name; default = the theme accent
    a = s.get('accent') or TOK.get('accent', 'accent')
    return a if str(a).startswith('#') else C.get(a, C['accent'])
FONTDIR = os.path.join(os.environ.get('WINDIR', r'C:\Windows'), 'Fonts')


def hexc(h, a=255):
    h = h.lstrip('#'); return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), a)


def font(key, size):
    name = F.get(key, key)
    p = name if os.path.isabs(name) else os.path.join(FONTDIR, name)
    return ImageFont.truetype(p, int(size))


def canvas(W, H, bg=False):
    if bg: return background({'W': W, 'H': H}, save=False)
    return Image.new('RGBA', (W, H), (0, 0, 0, 0))


def px(r, W, H):
    return [int(r[0] * W), int(r[1] * H), int((r[0] + r[2]) * W), int((r[1] + r[3]) * H)]


def glow_layer(size, draw_fn, blur, strength=1.0):
    g = Image.new('RGBA', size, (0, 0, 0, 0)); draw_fn(ImageDraw.Draw(g))
    g = g.filter(ImageFilter.GaussianBlur(blur))
    if strength != 1.0:
        a = g.getchannel('A').point(lambda v: min(255, int(v * strength))); g.putalpha(a)
    return g


def background(s, save=True):
    W, H = s['W'], s['H']
    im = Image.new('RGBA', (W, H), hexc(C['bg']))
    gx, gy = s.get('glowAt', [0.5, 0.42])
    glow = Image.new('RGBA', (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(glow)
    r = int(min(W, H) * 0.55)
    d.ellipse([gx * W - r * 1.4, gy * H - r, gx * W + r * 1.4, gy * H + r], fill=hexc(C['accentDeep'], 70))
    if s.get('glow', FX.get('glow', False)): im.alpha_composite(glow.filter(ImageFilter.GaussianBlur(r * 0.6)))
    if s.get('grid', FX.get('grid', False)):
        g = Image.new('RGBA', (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(g)
        step = int(H / 9); col = tuple(TOK['color']['grid'])
        for x in range(0, W, step): d.line([(x, 0), (x, H)], fill=col, width=1)
        for y in range(0, H, step): d.line([(0, y), (W, y)], fill=col, width=1)
        # fade the grid toward the edges
        m = Image.new('L', (W, H), 0); ImageDraw.Draw(m).ellipse([-W * 0.1, -H * 0.2, W * 1.1, H * 1.2], fill=255)
        g.putalpha(Image.composite(g.getchannel('A'), Image.new('L', (W, H), 0), m.filter(ImageFilter.GaussianBlur(H * 0.15))))
        im.alpha_composite(g)
    vig = Image.new('L', (W, H), 0); ImageDraw.Draw(vig).rectangle([0, 0, W, H], fill=0)
    edge = Image.new('RGBA', (W, H), (0, 0, 0, 0)); de = ImageDraw.Draw(edge)
    de.rectangle([0, 0, W, H], outline=(0, 0, 0, 170), width=int(H * 0.08))
    im.alpha_composite(edge.filter(ImageFilter.GaussianBlur(H * 0.08)))
    if save: im.convert('RGB').save(s['out']); return s['out']
    return im


def panel_mask(s):
    W, H = s['W'], s['H']; m = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(m).rounded_rectangle(px(s['rect'], W, H), radius=s.get('radius', TOK['radius']) * H // 1080, fill=(255, 255, 255, 255))
    m.save(s['out']); return s['out']


def panel_frame(s):
    W, H = s['W'], s['H']; im = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    rad = s.get('radius', TOK['radius']) * H // 1080; lw = max(2, H // 400)
    for r in s['rects']:
        b = px(r, W, H)
        sh = glow_layer((W, H), lambda d: d.rounded_rectangle([b[0], b[1] + H * 0.012, b[2], b[3] + H * 0.012], rad, fill=(0, 0, 0, 200)), H * 0.02)
        im.alpha_composite(sh)
        if s.get('glow', FX.get('glow', False)):
            im.alpha_composite(glow_layer((W, H), lambda d: d.rounded_rectangle(b, rad, outline=hexc(accent(s), 200), width=lw * 3), TOK['glow'] * H / 1080, 1.2))
        # cut the inside so the video shows through
        hole = Image.new('L', (W, H), 255); ImageDraw.Draw(hole).rounded_rectangle(b, rad, fill=0)
        im.putalpha(Image.composite(im.getchannel('A'), Image.new('L', (W, H), 0), hole))
        ImageDraw.Draw(im).rounded_rectangle(b, rad, outline=hexc(accent(s), 235) if s.get('accentEdge') else hexc(C['panelEdge'], 255), width=max(1, lw // 2))
    im.save(s['out']); return s['out']


def highlight(s):
    W, H = s['W'], s['H']; im = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    b = px(s['rect'], W, H); rad = s.get('radius', 14) * H // 1080; lw = max(3, H // 300)
    if s.get('glow', FX.get('glow', False)):
        im.alpha_composite(glow_layer((W, H), lambda d: d.rounded_rectangle(b, rad, outline=hexc(accent(s), 255), width=lw * 3), H * 0.012, 1.3))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle(b, rad, fill=hexc(accent(s), 18))
    d.rounded_rectangle(b, rad, outline=hexc(accent(s), 255), width=lw)
    if s.get('label'):
        f = font('bold', H * 0.026); t = s['label']; tw = d.textlength(t, font=f)
        x, y = b[0], b[1] - H * 0.05
        d.rounded_rectangle([x, y, x + tw + H * 0.03, y + H * 0.04], H * 0.01, fill=hexc(accent(s)))
        d.text((x + H * 0.015, y + H * 0.004), t, font=f, fill=hexc(C['bg']))
    im.save(s['out']); return s['out']


def chapter(s):
    W, H = s['W'], s['H']; im = canvas(W, H, s.get('bg', True)); d = ImageDraw.Draw(im)
    x = W * 0.08; y = H * s.get('y', 0.47)
    d.text((x, y - H * 0.075), s.get('num', '01'), font=font('semibold', H * 0.045), fill=hexc(accent(s)))
    ft = font('serif', H * 0.085)
    d.text((x, y), s['title'], font=ft, fill=hexc(C['text']))
    tw = d.textlength(s['title'], font=ft)
    uy = y + H * 0.125
    d.line([(x, uy), (x + min(tw, W * 0.28), uy)], fill=hexc(accent(s)), width=int(H * 0.005))
    im.save(s['out']); return s['out']


def card(im, b, rad):
    W, H = im.size
    im.alpha_composite(glow_layer((W, H), lambda d: d.rounded_rectangle([b[0], b[1] + H * 0.015, b[2], b[3] + H * 0.015], rad, fill=(0, 0, 0, 210)), H * 0.025))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle(b, rad, fill=hexc(C['panel']))
    d.rounded_rectangle(b, rad, outline=hexc(C['panelEdge']), width=max(1, H // 540))
    return d


def name_tag(s):
    W, H = s['W'], s['H']; im = canvas(W, H, s.get('bg', False))
    cw, ch = W * 0.30, H * 0.30; x0 = s.get('x', 0.79) * W - cw / 2; y0 = s.get('y', 0.5) * H - ch / 2
    b = [x0, y0, x0 + cw, y0 + ch]; rad = H * 0.022
    d = card(im, b, rad)
    hb = [b[0], b[1], b[2], b[1] + ch * 0.26]
    d.rounded_rectangle(hb, rad, fill=hexc(accent(s))); d.rectangle([hb[0], hb[3] - rad, hb[2], hb[3]], fill=hexc(accent(s)))
    fh = font('bold', ch * 0.11); t = s.get('header', 'my name is')
    d.text(((b[0] + b[2]) / 2 - d.textlength(t, font=fh) / 2, hb[1] + ch * 0.07), t, font=fh, fill=hexc(C['bg']))
    fn = font('serif', ch * 0.40); n = s['name']
    tw = d.textlength(n + '.', font=fn); tx = (b[0] + b[2]) / 2 - tw / 2; ty = b[1] + ch * 0.36
    d.text((tx, ty), n, font=fn, fill=hexc(C['text']))
    d.text((tx + d.textlength(n, font=fn), ty), '.', font=fn, fill=hexc(accent(s)))
    im.save(s['out']); return s['out']


def list_steps(s):
    W, H = s['W'], s['H']; items = s['items']; outs = []
    for step in range(0, len(items) + 1):
        im = canvas(W, H, s.get('bg', False)); d = ImageDraw.Draw(im)
        x0, y0, w = W * s.get('x', 0.06), H * s.get('y', 0.20), W * s.get('w', 0.56)
        d.text((x0, y0), s.get('title', ''), font=font('semibold', H * 0.032), fill=hexc(C['muted']))
        rowh = H * 0.125
        for i, it in enumerate(items):
            y = y0 + H * 0.07 + i * (rowh + H * 0.02)
            b = [x0, y, x0 + w, y + rowh]
            dd = card(im, b, H * 0.016)
            cx, cy, r = x0 + rowh * 0.45, y + rowh / 2, rowh * 0.27
            on = i < step
            dd.ellipse([cx - r, cy - r, cx + r, cy + r], outline=hexc(accent(s) if on else C['panelEdge']), width=max(2, H // 400))
            fnum = font('serif', rowh * 0.36); num = str(i + 1)
            dd.text((cx - dd.textlength(num, font=fnum) / 2, cy - rowh * 0.22), num, font=fnum, fill=hexc(accent(s) if on else C['muted']))
            if on:
                dd.text((x0 + rowh * 0.95, y + rowh * (0.16 if it.get('sub') else 0.28)), it['text'], font=font('serif', rowh * 0.34), fill=hexc(C['text']))
                if it.get('sub'):
                    sub = it['sub']; parts = re.split(r'(\*[^*]+\*)', sub); sx = x0 + rowh * 0.95; sy = y + rowh * 0.58
                    for p in parts:
                        if not p: continue
                        hot = p.startswith('*'); p = p.strip('*'); fs = font('semibold', rowh * 0.2)
                        dd.text((sx, sy), p, font=fs, fill=hexc(accent(s) if hot else C['muted'])); sx += dd.textlength(p, font=fs)
        o = f"{s['outPrefix']}_{step}.png"; im.save(o); outs.append(o)
    return outs


def keyword(s):
    W, H = s['W'], s['H']; im = canvas(W, H, False); d = ImageDraw.Draw(im)
    f = font('black', s.get('size', 0.13) * H); t = s['text']
    tw = d.textlength(t, font=f); x = s.get('x', 0.68) * W - tw / 2; y = s.get('y', 0.42) * H - f.size / 2
    if s.get('glow', FX.get('glow', False)):
        im.alpha_composite(glow_layer((W, H), lambda g: g.text((x, y), t, font=f, fill=hexc(C['accentDeep'], 255)), H * 0.02, 1.4))
    d.text((x, y + H * 0.006), t, font=f, fill=(0, 0, 0, 120))
    d.text((x, y), t, font=f, fill=hexc(accent(s)))
    im.save(s['out']); return s['out']


def label(s):
    W, H = s['W'], s['H']; im = canvas(W, H, False); d = ImageDraw.Draw(im)
    f = font('mono', s.get('size', 0.045) * H); t = s['text'].upper(); tw = d.textlength(t, font=f)
    x, y = s['x'] * W, s['y'] * H; pad = H * 0.014
    b = [x - pad, y - pad, x + tw + pad, y + f.size + pad * 1.4]
    if s.get('glow', FX.get('glow', False)):
        im.alpha_composite(glow_layer((W, H), lambda g: g.rectangle(b, outline=hexc(accent(s), 220), width=4), H * 0.01, 1.2))
    d.rectangle(b, fill=hexc(C['bg2'], 220), outline=hexc(accent(s), 200), width=max(1, H // 540))
    d.text((x, y), t, font=f, fill=hexc(C['accentSoft']))
    im.save(s['out']); return s['out']


def caption(s):
    W, H = s['W'], s['H']; im = canvas(W, H, False); d = ImageDraw.Draw(im)
    parts = [p for p in re.split(r'(\*[^*]+\*)', s['text']) if p]
    fs = font('bold', H * s.get('size', 0.042)); fi = font('serifItalic', H * s.get('size', 0.042) * 1.12)
    widths = [d.textlength(p.strip('*'), font=fi if p.startswith('*') else fs) for p in parts]
    x = W / 2 - sum(widths) / 2; y = s.get('y', 0.84) * H - fs.size / 2
    if s.get('pill', True):   # soft dark pill so captions read on bright screens too
        px_, py_ = fs.size * 0.55, fs.size * 0.32
        b = [x - px_, y - py_, x + sum(widths) + px_, y + fs.size * 1.18 + py_]
        im.alpha_composite(glow_layer((W, H), lambda g: g.rounded_rectangle([b[0], b[1] + H * 0.006, b[2], b[3] + H * 0.006], (b[3] - b[1]) / 2, fill=(0, 0, 0, 120)), H * 0.012))
        ImageDraw.Draw(im).rounded_rectangle(b, (b[3] - b[1]) / 2, fill=hexc(C['bg'], 205))
        d = ImageDraw.Draw(im)
    for p, w in zip(parts, widths):
        hot = p.startswith('*'); t = p.strip('*'); f = fi if hot else fs
        d.text((x, y + 2), t, font=f, fill=(0, 0, 0, 150))
        d.text((x, y - (fs.size * 0.06 if hot else 0)), t, font=f, fill=hexc(accent(s) if hot else C['text']))
        x += w
    im.save(s['out']); return s['out']


def focus(s):
    """highlight + dim: everything outside rect darkens, rect gets a clean outline (moves with the zoom)."""
    W, H = s['W'], s['H']; b = px(s['rect'], W, H); rad = s.get('radius', 14) * H // 1080; lw = max(3, H // 320)
    im = Image.new('RGBA', (W, H), (0, 0, 0, int(255 * s.get('dim', 0.65))))
    hole = Image.new('L', (W, H), 255); ImageDraw.Draw(hole).rounded_rectangle(b, rad, fill=0)
    im.putalpha(Image.composite(im.getchannel('A'), Image.new('L', (W, H), 0), hole.filter(ImageFilter.GaussianBlur(H * 0.004))))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle(b, rad, outline=hexc(accent(s), 255), width=lw)
    if s.get('label'):
        f = font('bold', H * 0.019); t = s['label']; tw = d.textlength(t, font=f)
        x, y = b[0], b[1] - H * 0.05
        d.rounded_rectangle([x, y + H * 0.012, x + tw + H * 0.024, y + H * 0.042], H * 0.008, fill=hexc(accent(s)))
        d.text((x + H * 0.012, y + H * 0.014), t, font=f, fill=hexc(C['bg']))
    im.save(s['out']); return s['out']


def stat(s):
    """the big number card ("321B params"), drawn on transparent so it pops over a zoom."""
    W, H = s['W'], s['H']; im = canvas(W, H, s.get('bg', False))
    fv = font('serif', H * s.get('size', 0.12)); fl = font('semibold', H * 0.03)
    d0 = ImageDraw.Draw(im); vw = d0.textlength(s['value'], font=fv); lw_ = d0.textlength(s.get('label', ''), font=fl)
    cw = max(vw, lw_) + H * 0.12; ch = fv.size * 1.1 + (fl.size * 1.6 if s.get('label') else 0) + H * 0.06
    cx, cy = s.get('x', 0.5) * W, s.get('y', 0.62) * H
    b = [cx - cw / 2, cy - ch / 2, cx + cw / 2, cy + ch / 2]
    d = card(im, b, H * 0.022)
    d.text((cx - vw / 2, b[1] + H * 0.025), s['value'], font=fv, fill=hexc(C['text']))
    if s.get('label'): d.text((cx - lw_ / 2, b[1] + H * 0.035 + fv.size * 1.05), s['label'], font=fl, fill=hexc(accent(s)))
    im.save(s['out']); return s['out']


def chapter_tag(s):
    """small pill pinned top-left for the whole chapter: "02  why this wasn't possible"."""
    W, H = s['W'], s['H']; im = canvas(W, H, False); d = ImageDraw.Draw(im)
    fn = font('semibold', H * 0.022); ft = font('serif', H * 0.026)
    num, t = s.get('num', '01'), s['title']
    x, y = W * 0.018, H * 0.03; pad = H * 0.012
    w = d.textlength(num, font=fn) + H * 0.014 + d.textlength(t, font=ft) + pad * 2
    d.rounded_rectangle([x, y, x + w, y + ft.size + pad * 1.6], (ft.size + pad * 1.6) / 2, fill=hexc(C['panel'], 235), outline=hexc(C['panelEdge']), width=1)
    d.text((x + pad, y + pad * 0.95), num, font=fn, fill=hexc(accent(s)))
    d.text((x + pad + d.textlength(num, font=fn) + H * 0.014, y + pad * 0.6), t, font=ft, fill=hexc(C['text']))
    im.save(s['out']); return s['out']


def caption_ref2(s):
    """ref2 captions: clean white sans, no box, soft shadow, up to 2 lines that build word by word;
    *words* are an italic serif accent. show = how many words are visible (the word-by-word build)."""
    W, H = s['W'], s['H']; im = canvas(W, H, False)
    lines = s['lines']; show = s.get('show', 10 ** 6)
    fs = font(s.get('font', 'semibold'), H * s.get('size', 0.034)); fi = font('serifItalic', H * s.get('size', 0.034) * 1.22)
    d = ImageDraw.Draw(im); lh = fs.size * 1.32
    y0 = s.get('y', 0.82) * H - (len(lines) - 1) * lh / 2
    txt = Image.new('RGBA', (W, H), (0, 0, 0, 0)); dt = ImageDraw.Draw(txt)
    k = 0
    for li, line in enumerate(lines):
        words = []
        for part in re.split(r'(\*[^*]+\*)', line):
            if part: words += [(w, part.startswith('*')) for w in part.strip('*').split()]
        full = sum(d.textlength(w + ' ', font=fi if hot else fs) for w, hot in words) - d.textlength(' ', font=fs)
        x = W / 2 - full / 2; y = y0 + li * lh
        for w, hot in words:
            if k >= show: break
            f = fi if hot else fs
            dt.text((x, y - (fs.size * 0.08 if hot else 0)), w, font=f, fill=hexc(accent(s) if hot else '#FFFFFF'))
            x += d.textlength(w + ' ', font=f); k += 1
    # soft dark haze behind the words (not a box) so white text reads on bright screens too
    if s.get('haze', True) and txt.getbbox():
        bx = txt.getbbox(); hz = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        ImageDraw.Draw(hz).rounded_rectangle([bx[0] - fs.size * 0.9, bx[1] - fs.size * 0.5, bx[2] + fs.size * 0.9, bx[3] + fs.size * 0.5], fs.size, fill=(0, 0, 0, int(255 * s.get('hazeOpacity', 0.42))))
        im.alpha_composite(hz.filter(ImageFilter.GaussianBlur(fs.size * 0.9)))
    # soft drop shadow (no outline): wide blur, low opacity, nudged down
    black = Image.new('RGBA', (W, H), (0, 0, 0, 255)); black.putalpha(txt.getchannel('A').point(lambda v: int(v * 0.6)))
    im.alpha_composite(black.filter(ImageFilter.GaussianBlur(H * 0.014)), (0, int(H * 0.004)))
    im.alpha_composite(txt)
    im.save(s['out']); return s['out']


def outline_box(s):
    """TIGHT rounded outline (just the box, transparent elsewhere) so it can be dragged/scaled in Premiere."""
    w, h = int(s['w']), int(s['h']); H = s.get('H', 1080); lw = max(3, H // 320); pad = lw * 4
    im = Image.new('RGBA', (w + pad * 2, h + pad * 2), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    b = [pad, pad, pad + w, pad + h]; rad = s.get('radius', 14) * H // 1080
    d.rounded_rectangle(b, rad, fill=hexc(accent(s), 22))
    d.rounded_rectangle(b, rad, outline=hexc(accent(s), 255), width=lw)
    im.save(s['out']); return s['out']


def chip(s):
    """TIGHT label chip ("ae-mcp-setup") for pointing at things; drag it anywhere in Premiere."""
    H = s.get('H', 1080); f = font('bold', H * s.get('size', 0.024)); t = s['text']
    tw = ImageDraw.Draw(Image.new('RGBA', (1, 1))).textlength(t, font=f); px_, py_ = H * 0.012, H * 0.007
    im = Image.new('RGBA', (int(tw + px_ * 2) + 2, int(f.size * 1.35 + py_ * 2)), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    d.rounded_rectangle([0, 0, im.width - 1, im.height - 1], H * 0.009, fill=hexc(accent(s)))
    d.text((px_, py_), t, font=f, fill=hexc(C['bg']))
    im.save(s['out']); return s['out']


KINDS = {'background': background, 'panel_mask': panel_mask, 'panel_frame': panel_frame, 'highlight': highlight,
         'chapter': chapter, 'name_tag': name_tag, 'list': list_steps, 'keyword': keyword, 'label': label, 'caption': caption,
         'focus': focus, 'stat': stat, 'chapter_tag': chapter_tag, 'caption_ref2': caption_ref2, 'outline_box': outline_box, 'chip': chip}

if __name__ == '__main__':
    spec = json.load(open(sys.argv[1], encoding='utf-8'))
    specs = spec if isinstance(spec, list) else [spec]
    out = []
    for sp in specs:
        os.makedirs(os.path.dirname(sp.get('out') or sp.get('outPrefix')), exist_ok=True)
        r = KINDS[sp['kind']](sp); out += r if isinstance(r, list) else [r]
    print(json.dumps(out))
