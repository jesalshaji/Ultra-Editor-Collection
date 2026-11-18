"""broll.py: animated b-roll scenes in the house style (zoom + b-roll reference, dark theme).

    python broll.py spec.json        -> prints the mp4 path

spec: {scene, out, W, H, fps, duration, accent?, ...scene fields}
scenes:
  kinetic_text  lines:["you *don't* have to", "run it *locally* yourself"], image?: png/jpg (icon or screenshot), words?: [t,...]
                words pop in one by one (serif headline + small sans line, *word* = italic accent), image pops in beside
  stat          value:"321B", label:"params", count?:true   big number card, counts up if numeric
  prompt_bar    text:"edit this video for me", chips?:["video.mp4", "and"], placeholder?  chat box that types + sends
  feature_list  title:"Editor V1", subtitle?, items:[{title, sub?}]   card on the left, items branch out one by one
  logo_row      items:[{text, icon?}]   pills slide in one after another
  quote_stamp   text:"That's the old", sub?:"back and forth"   a tilted stamp card slams onto a chip
"""
import json, math, os, re, subprocess, sys
from PIL import Image, ImageDraw, ImageFilter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ev_graphics as G   # tokens, fonts, cards, background

C = G.C


def ease_out(u): u = min(1, max(0, u)); return 1 - (1 - u) ** 3
def ease_in_out(u): u = min(1, max(0, u)); return 4 * u ** 3 if u < .5 else 1 - (-2 * u + 2) ** 3 / 2
def back_out(u, k=1.6):
    u = min(1, max(0, u)); return 1 + (k + 1) * (u - 1) ** 3 + k * (u - 1) ** 2


def layer(W, H): return Image.new('RGBA', (W, H), (0, 0, 0, 0))


def put(base, lay, alpha=1.0, dx=0, dy=0, scale=1.0, origin=None):
    """composite a full-frame layer with opacity, offset and scale (around origin)"""
    if alpha <= 0.002: return
    if scale != 1.0:
        W, H = lay.size; ox, oy = origin or (W / 2, H / 2)
        nw, nh = max(1, int(W * scale)), max(1, int(H * scale))
        lay = lay.resize((nw, nh), Image.BILINEAR)
        canvas = layer(W, H)
        canvas.paste(lay, (int(ox - ox * scale + dx), int(oy - oy * scale + dy)), lay)   # paste copes with negative offsets
        lay = canvas; dx = dy = 0
    if alpha < 1:
        a = lay.getchannel('A').point(lambda v: int(v * alpha)); lay = lay.copy(); lay.putalpha(a)
    if dx or dy:
        c2 = layer(*lay.size); c2.paste(lay, (int(dx), int(dy)), lay); lay = c2
    base.alpha_composite(lay)


def rich_words(text):
    """'you *don't* have' -> [('you',False),("don't",True),('have',False)]"""
    out = []
    for part in re.split(r'(\*[^*]+\*)', text):
        if not part: continue
        hot = part.startswith('*')
        for w in part.strip('*').split():
            out.append((w, hot))
    return out


def draw_words(d, x, y, words, f, fi, color, acc):
    pos = []
    for w, hot in words:
        ff = fi if hot else f
        pos.append((x, y, w, hot, ff)); x += d.textlength(w + ' ', font=ff)
    return pos


def load_img(p, maxw, maxh):
    im = Image.open(p).convert('RGBA'); im.thumbnail((int(maxw), int(maxh)), Image.LANCZOS); return im


# ---------------------------------------------------------------------------------------------
def scene_kinetic_text(s, t, W, H, bg):
    fr = bg.copy(); acc = G.accent(s)
    lines = s.get('lines', [])
    f1, fi1 = G.font('serif', H * 0.072), G.font('serifItalic', H * 0.076)
    f2, fi2 = G.font('semibold', H * 0.03), G.font('serifItalic', H * 0.034)
    has_img = bool(s.get('image'))
    x0 = W * (0.08 if has_img else 0.5); y0 = H * 0.36
    d0 = ImageDraw.Draw(fr)
    allw = []
    for li, line in enumerate(lines):
        words = rich_words(line); f, fi = (f1, fi1) if li == 0 else (f2, fi2)
        width = sum(d0.textlength(w + ' ', font=(fi if h else f)) for w, h in words)
        x = x0 if has_img else x0 - width / 2
        y = y0 + (0 if li == 0 else f1.size * 1.35 + (li - 1) * f2.size * 1.6)
        for p in draw_words(d0, x, y, words, f, fi, None, acc): allw.append(p)
    n = len(allw); times = s.get('words') or [0.15 + i * min(0.22, (s['duration'] * 0.55) / max(1, n)) for i in range(n)]
    for (x, y, w, hot, ff), tw in zip(allw, times):
        u = (t - tw) / 0.28
        if u <= 0: continue
        lay = layer(W, H); ImageDraw.Draw(lay).text((x, y), w, font=ff, fill=G.hexc(acc if hot else (C['text'] if ff in (f1, fi1) else C['muted'])))
        put(fr, lay, ease_out(u), dy=(1 - ease_out(u)) * H * 0.02)
    if has_img:
        img = load_img(s['image'], W * 0.38, H * 0.55)
        u = (t - 0.35) / 0.5
        if u > 0:
            lay = layer(W, H); cx, cy = W * 0.72, H * 0.5 + math.sin(t * 1.6) * H * 0.008
            lay.alpha_composite(G.glow_layer((W, H), lambda g: g.rounded_rectangle([cx - img.width / 2, cy - img.height / 2 + H * 0.02, cx + img.width / 2, cy + img.height / 2 + H * 0.02], H * 0.02, fill=(0, 0, 0, 150)), H * 0.03))
            lay.alpha_composite(img, (int(cx - img.width / 2), int(cy - img.height / 2)))
            put(fr, lay, ease_out(u), scale=0.85 + 0.15 * back_out(u), origin=(cx, cy))
    return fr


def scene_stat(s, t, W, H, bg):
    fr = bg.copy(); acc = G.accent(s)
    val = str(s['value']); m = re.match(r'^([^\d]*)([\d.,]+)(.*)$', val)
    u = ease_out((t - 0.1) / 0.6)
    if s.get('count', True) and m:
        num = float(m.group(2).replace(',', '')); cur = num * ease_out((t - 0.15) / 1.0)
        dec = len(m.group(2).split('.')[1]) if '.' in m.group(2) else 0
        txt = m.group(1) + (f'{cur:,.{dec}f}' if ',' in m.group(2) else f'{cur:.{dec}f}') + m.group(3)
    else: txt = val
    fv = G.font('serif', H * 0.15); fl = G.font('semibold', H * 0.034)
    d0 = ImageDraw.Draw(fr); vw = d0.textlength(val, font=fv); lw = d0.textlength(s.get('label', ''), font=fl)
    cw, ch = max(vw, lw) + H * 0.16, fv.size * 1.15 + fl.size * 1.8 + H * 0.08
    cx, cy = W / 2, H / 2
    lay = layer(W, H); b = [cx - cw / 2, cy - ch / 2, cx + cw / 2, cy + ch / 2]
    d = G.card(lay, b, H * 0.026)
    tw = d.textlength(txt, font=fv); d.text((cx - tw / 2, b[1] + H * 0.03), txt, font=fv, fill=G.hexc(C['text']))
    if s.get('label'):
        ul = ease_out((t - 0.6) / 0.4)
        d.text((cx - lw / 2, b[1] + H * 0.045 + fv.size * 1.08 + (1 - ul) * H * 0.01), s['label'], font=fl, fill=G.hexc(acc, int(255 * ul)))
    put(fr, lay, u, scale=0.92 + 0.08 * back_out((t - 0.1) / 0.6), origin=(cx, cy))
    return fr


def scene_prompt_bar(s, t, W, H, bg):
    fr = bg.copy(); acc = G.accent(s)
    bw, bh = W * 0.56, H * 0.11; cx, cy = W / 2, H * 0.46
    b = [cx - bw / 2, cy - bh / 2, cx + bw / 2, cy + bh / 2]
    lay = layer(W, H); d = G.card(lay, b, bh / 2)
    text = s.get('text', ''); f = G.font('regular', H * 0.032)
    t_type0, cps = 0.5, s.get('cps', 22)
    shown = text[:max(0, int((t - t_type0) * cps))]
    if shown: d.text((b[0] + bh * 0.45, cy - f.size * 0.62), shown, font=f, fill=G.hexc(C['text']))
    else: d.text((b[0] + bh * 0.45, cy - f.size * 0.62), s.get('placeholder', 'Ask anything…'), font=f, fill=G.hexc(C['muted']))
    if int(t * 2.2) % 2 == 0 or len(shown) < len(text):
        caret_x = b[0] + bh * 0.45 + d.textlength(shown, font=f) + 3
        d.line([(caret_x, cy - f.size * 0.5), (caret_x, cy + f.size * 0.55)], fill=G.hexc(acc), width=max(2, H // 400))
    done = t_type0 + len(text) / cps
    r = bh * 0.32; bx = b[2] - bh * 0.55
    pulse = 1 + 0.12 * max(0, math.sin((t - done) * 6)) * (1 if t > done + 0.3 else 0) * math.exp(-max(0, t - done - 0.3) * 1.5)
    d.ellipse([bx - r * pulse, cy - r * pulse, bx + r * pulse, cy + r * pulse], fill=G.hexc(acc))
    fa = G.font('black', r * 1.1); d.text((bx - d.textlength('↑', font=fa) / 2, cy - r * 0.78), '↑', font=fa, fill=G.hexc(C['bg']))
    put(fr, lay, ease_out(t / 0.4), dy=(1 - ease_out(t / 0.4)) * H * 0.02)
    chips = s.get('chips', []); fc = G.font('semibold', H * 0.024); x = b[0] + bh * 0.3
    for i, ch in enumerate(chips):
        u = (t - done - 0.25 - i * 0.18) / 0.35
        if u <= 0: continue
        cl = layer(W, H); dd = ImageDraw.Draw(cl); w = dd.textlength(ch, font=fc) + H * 0.05
        cb = [x, b[3] + H * 0.03, x + w, b[3] + H * 0.03 + fc.size * 2]
        dd.rounded_rectangle(cb, (cb[3] - cb[1]) / 2, fill=G.hexc(C['panel']), outline=G.hexc(C['panelEdge']), width=1)
        dd.ellipse([cb[0] + H * 0.012, (cb[1] + cb[3]) / 2 - H * 0.006, cb[0] + H * 0.024, (cb[1] + cb[3]) / 2 + H * 0.006], fill=G.hexc(acc))
        dd.text((cb[0] + H * 0.032, cb[1] + fc.size * 0.42), ch, font=fc, fill=G.hexc(C['text']))
        put(fr, cl, ease_out(u), scale=0.8 + 0.2 * back_out(u), origin=((cb[0] + cb[2]) / 2, (cb[1] + cb[3]) / 2))
        x += w + H * 0.02
    return fr


def scene_feature_list(s, t, W, H, bg):
    fr = bg.copy(); acc = G.accent(s)
    cb = [W * 0.08, H * 0.22, W * 0.36, H * 0.78]
    lay = layer(W, H); d = G.card(lay, cb, H * 0.024)
    fs = G.font('semibold', H * 0.022); d.text((cb[0] + H * 0.04, cb[1] + H * 0.04), s.get('file', 'notes.md'), font=fs, fill=G.hexc(C['muted']))
    ft = G.font('serif', H * 0.085); d.text((cb[0] + H * 0.04, cb[1] + H * 0.11), s.get('title', ''), font=ft, fill=G.hexc(C['text']))
    if s.get('subtitle'):
        d.text((cb[0] + H * 0.04, cb[1] + H * 0.11 + ft.size * 1.25), s['subtitle'], font=G.font('semibold', H * 0.026), fill=G.hexc(acc))
    put(fr, lay, ease_out(t / 0.5), scale=0.94 + 0.06 * ease_out(t / 0.5), origin=((cb[0] + cb[2]) / 2, (cb[1] + cb[3]) / 2))
    items = s.get('items', []); n = len(items); gap = H * 0.115
    y0 = H * 0.5 - (n - 1) * gap / 2
    step = min(0.55, (s['duration'] - 1.2) / max(1, n))
    fi, fsub = G.font('bold', H * 0.03), G.font('regular', H * 0.021)
    for i, it in enumerate(items):
        u = (t - 0.6 - i * step) / 0.45
        if u <= 0: continue
        y = y0 + i * gap; ib = [W * 0.47, y - H * 0.045, W * 0.92, y + H * 0.045]
        ll = layer(W, H); dd = ImageDraw.Draw(ll)
        sx, sy = cb[2], (cb[1] + cb[3]) / 2; ex = ib[0]
        k = ease_in_out(u)
        dd.line([(sx, sy), (sx + (ex - sx) * 0.5, sy), (sx + (ex - sx) * 0.5, y), (sx + (ex - sx) * k, y)], fill=G.hexc(acc, 170), width=max(2, H // 500))
        G.card(ll, ib, H * 0.016)
        dd = ImageDraw.Draw(ll)
        dd.rounded_rectangle([ib[0] + H * 0.02, y - H * 0.016, ib[0] + H * 0.052, y + H * 0.016], H * 0.006, outline=G.hexc(acc), width=max(2, H // 500))
        words = rich_words(it['title']); x = ib[0] + H * 0.07; ty = y - (fi.size * 0.85 if it.get('sub') else fi.size * 0.6)
        for w, hot in words:
            dd.text((x, ty), w, font=fi, fill=G.hexc(acc if hot else C['text'])); x += dd.textlength(w + ' ', font=fi)
        if it.get('sub'): dd.text((ib[0] + H * 0.07, y + H * 0.004), it['sub'], font=fsub, fill=G.hexc(C['muted']))
        put(fr, ll, ease_out(u), dx=(1 - ease_out(u)) * -W * 0.02)
    return fr


def scene_logo_row(s, t, W, H, bg):
    fr = bg.copy(); items = s.get('items', []); f = G.font('serif', H * 0.04)
    d0 = ImageDraw.Draw(fr); ph = H * 0.095; gap = H * 0.025
    widths = [d0.textlength(it['text'], font=f) + ph * (1.3 if it.get('icon') else 0.7) for it in items]
    x = W / 2 - (sum(widths) + gap * (len(items) - 1)) / 2; y = H * 0.5 - ph / 2
    for i, (it, w) in enumerate(zip(items, widths)):
        u = (t - 0.2 - i * 0.22) / 0.45
        if u > 0:
            lay = layer(W, H); b = [x, y, x + w, y + ph]; d = G.card(lay, b, H * 0.018)
            tx = x + ph * 0.35
            if it.get('icon'):
                ic = load_img(it['icon'], ph * 0.5, ph * 0.5); lay.alpha_composite(ic, (int(x + ph * 0.3), int(y + (ph - ic.height) / 2))); tx = x + ph * 0.95
            d.text((tx, y + ph / 2 - f.size * 0.62), it['text'], font=f, fill=G.hexc(C['text']))
            put(fr, lay, ease_out(u), dy=(1 - ease_out(u)) * H * 0.03)
        x += w + gap
    return fr


def scene_quote_stamp(s, t, W, H, bg):
    fr = bg.copy(); acc = G.accent(s)
    if s.get('sub'):
        f = G.font('semibold', H * 0.032); d0 = ImageDraw.Draw(fr); w = d0.textlength(s['sub'], font=f) + H * 0.08
        lay = layer(W, H); b = [W / 2 - w / 2, H * 0.34, W / 2 + w / 2, H * 0.34 + f.size * 2.1]
        dd = G.card(lay, b, (b[3] - b[1]) / 2); dd.text((b[0] + H * 0.04, b[1] + f.size * 0.5), s['sub'], font=f, fill=G.hexc(acc))
        put(fr, lay, ease_out(t / 0.4))
    u = (t - 0.55) / 0.35
    if u > 0:
        f = G.font('serifItalic', H * 0.09); dd0 = ImageDraw.Draw(fr); w = dd0.textlength(s['text'], font=f) + H * 0.12
        card = layer(int(w + H * 0.1), int(f.size * 1.9 + H * 0.1)); dc = ImageDraw.Draw(card)
        cb = [H * 0.05, H * 0.05, card.width - H * 0.05, card.height - H * 0.05]
        dc.rounded_rectangle(cb, H * 0.02, fill=G.hexc(C['panel']), outline=G.hexc(acc), width=max(3, H // 300))
        dc.text((cb[0] + H * 0.06, cb[1] + f.size * 0.35), s['text'], font=f, fill=G.hexc(C['text']))
        card = card.rotate(-6, resample=Image.BICUBIC, expand=True)
        sc = 1.35 - 0.35 * ease_out(u)
        lay = layer(W, H); lay.alpha_composite(card, (int(W / 2 - card.width / 2), int(H * 0.52 - card.height / 2)))
        shake = math.sin((t - 0.9) * 40) * H * 0.004 * math.exp(-max(0, t - 0.9) * 8) if t > 0.9 else 0
        put(fr, lay, min(1, u * 2), dx=shake, scale=sc, origin=(W / 2, H * 0.52))
    return fr


import neon
SCENES = {**neon.SCENES, 'kinetic_text': scene_kinetic_text, 'stat': scene_stat, 'prompt_bar': scene_prompt_bar,
          'feature_list': scene_feature_list, 'logo_row': scene_logo_row, 'quote_stamp': scene_quote_stamp}

if __name__ == '__main__':
    s = json.load(open(sys.argv[1], encoding='utf-8'))
    W, H, fps, D = s.get('W', 1920), s.get('H', 1080), s.get('fps', 30), float(s.get('duration', 3))
    s['duration'] = D
    bg = G.background({'W': W, 'H': H, 'grid': False}, save=False).convert('RGBA')
    s['fps'] = fps
    fn = SCENES[s['scene']]
    os.makedirs(os.path.dirname(s['out']), exist_ok=True)
    ff = subprocess.Popen(['ffmpeg', '-nostdin', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(fps), '-i', '-',
                           '-c:v', 'libx264', '-crf', '16', '-preset', 'medium', '-pix_fmt', 'yuv420p', s['out']], stdin=subprocess.PIPE)
    n = int(round(D * fps))
    for i in range(n):
        t = i / fps
        fr = fn(s, t, W, H, bg)
        if s.get('fadeOut', True) and t > D - 0.25:   # soft exit into the next shot
            k = (D - t) / 0.25; fr = Image.blend(bg, fr, max(0, k))
        ff.stdin.write(fr.convert('RGB').tobytes())
    ff.stdin.close(); ff.wait()
    print(s['out'])
