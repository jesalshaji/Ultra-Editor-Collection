"""neon.py: ref-1 style b-roll + chapter scenes (dark grid, glow lines, 3D-tilted glowing frames, mono labels).

Used by broll.py. Accent = theme accent unless the spec gives one (e.g. "#3FD3FF" for ref-1 cyan).
scenes:
  chapter_nav  items:[{icon, label}], active: index, title?: "02  captions"   icon row, active cell lights up,
               camera tilts and pushes toward it (the chapter opener)
  neon_cards   image|video, labels:["captions","clip","animations"]          glowing tilted frame + floating mono labels
  framed_clip  image|video, tag?                                              media in a glowing frame on the grid, slow push
icons: download, text, folder, video, audio, cut, zoom, edit, idea, code, play, settings, mic, captions, image,
       chart, check, star, link, search, user, chat, magic, layers, clock, money, rocket, globe, lock, sparkle
"""
import math, os, subprocess
from PIL import Image, ImageDraw, ImageFilter
import ev_graphics as G

C = G.C
ICON_FONT = os.path.join(G.FONTDIR, 'segmdl2.ttf')
ICONS = {'download': '', 'text': '', 'folder': '', 'video': '', 'audio': '', 'cut': '',
         'zoom': '', 'edit': '', 'idea': '', 'code': '', 'play': '', 'settings': '',
         'mic': '', 'captions': '', 'image': '', 'chart': '', 'check': '', 'star': '',
         'link': '', 'search': '', 'user': '', 'chat': '', 'magic': '', 'layers': '',
         'clock': '', 'money': '', 'rocket': '', 'globe': '', 'lock': '', 'sparkle': ''}


def ease(u): u = min(1, max(0, u)); return 4 * u ** 3 if u < .5 else 1 - (-2 * u + 2) ** 3 / 2
def ease_out(u): u = min(1, max(0, u)); return 1 - (1 - u) ** 3


def grid_bg(W, H, acc):
    im = Image.new('RGBA', (W, H), (7, 8, 11, 255)); d = ImageDraw.Draw(im)
    step = H // 6; col = G.hexc(acc, 22); dot = G.hexc(acc, 70)
    for x in range(step // 2, W, step): d.line([(x, 0), (x, H)], fill=col, width=1)
    for y in range(step // 2, H, step): d.line([(0, y), (W, y)], fill=col, width=1)
    for x in range(step // 2, W, step):
        for y in range(step // 2, H, step):
            r = max(2, H // 360); d.line([(x - r, y), (x + r, y)], fill=dot); d.line([(x, y - r), (x, y + r)], fill=dot)
    vig = Image.new('RGBA', (W, H), (0, 0, 0, 0)); dv = ImageDraw.Draw(vig)
    dv.rectangle([0, 0, W, H], outline=(0, 0, 0, 220), width=int(H * 0.16))
    im.alpha_composite(vig.filter(ImageFilter.GaussianBlur(H * 0.12)))
    return im


def glow(lay, blur, strength=1.6):
    """neon: a tight bright bloom + a wide soft halo under the crisp shape"""
    out = Image.new('RGBA', lay.size, (0, 0, 0, 0))
    for b, k in ((blur * 2.2, strength * 1.1), (blur * 0.6, strength * 1.8)):
        g = lay.filter(ImageFilter.GaussianBlur(b))
        g.putalpha(g.getchannel('A').point(lambda v, k=k: min(255, int(v * k))))
        out.alpha_composite(g)
    out.alpha_composite(lay); return out


def _coeffs(src, dst):
    # perspective coefficients mapping dst quad -> src quad (what PIL.transform wants)
    import numpy as np
    A, B = [], []
    for (x, y), (u, v) in zip(dst, src):
        A.append([x, y, 1, 0, 0, 0, -u * x, -u * y]); B.append(u)
        A.append([0, 0, 0, x, y, 1, -v * x, -v * y]); B.append(v)
    return np.linalg.solve(np.array(A, float), np.array(B, float)).tolist()


def tilt(lay, ry=0.0, rx=0.0, zoom=1.0, cx=0.5, cy=0.5, f=1.6):
    """fake 3D: rotate a full-frame layer around Y (ry) / X (rx) degrees, push in by zoom toward (cx, cy)"""
    W, H = lay.size
    if abs(ry) < 0.01 and abs(rx) < 0.01 and abs(zoom - 1) < 0.001: return lay
    a, b = math.radians(ry), math.radians(rx); fl = f * W
    pts = []
    for (x, y) in [(0, 0), (W, 0), (W, H), (0, H)]:
        X, Y, Z = x - W * cx, y - H * cy, 0.0
        X, Z = X * math.cos(a) + Z * math.sin(a), -X * math.sin(a) + Z * math.cos(a)
        Y, Z = Y * math.cos(b) - Z * math.sin(b), Y * math.sin(b) + Z * math.cos(b)
        s = fl / (fl + Z) * zoom
        pts.append((W / 2 + X * s, H / 2 + Y * s))
    c = _coeffs([(0, 0), (W, 0), (W, H), (0, H)], pts)
    return lay.transform((W, H), Image.PERSPECTIVE, c, Image.BICUBIC)


def media_frame(spec, t, maxw, maxh, cache={}):
    """an image, or the frame of a video at spec start + t, fitted into maxw x maxh"""
    src = spec.get('image') or spec.get('video')
    if not src: return None
    if spec.get('image'):
        key = (src, int(maxw), int(maxh))
        if key not in cache:
            im = Image.open(src).convert('RGBA'); im.thumbnail((int(maxw), int(maxh)), Image.LANCZOS); cache[key] = im
        return cache[key]
    key = ('v', src, int(maxw), int(maxh))
    if key not in cache:
        fps, D = spec.get('fps', 30), spec['duration']
        pr = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', src], capture_output=True, text=True).stdout.split(',')
        sw, sh = int(pr[0]), int(pr[1]); k = min(maxw / sw, maxh / sh); w, h = int(sw * k) // 2 * 2, int(sh * k) // 2 * 2
        raw = subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-ss', str(spec.get('in', 0)), '-t', str(D), '-i', src, '-vf', f'fps={fps},scale={w}:{h}',
                              '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], capture_output=True).stdout
        cache[key] = (w, h, raw, fps)
    w, h, raw, fps = cache[key]; n = len(raw) // (w * h * 4)
    i = min(n - 1, int(t * fps)); return Image.frombuffer('RGBA', (w, h), raw[i * w * h * 4:(i + 1) * w * h * 4], 'raw', 'RGBA', 0, 1)


def glow_frame(W, H, box, acc, img=None, width=None):
    lay = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    x0, y0, x1, y1 = [int(v) for v in box]
    if img is not None:
        im = img.resize((x1 - x0, y1 - y0), Image.BILINEAR) if img.size != (x1 - x0, y1 - y0) else img
        lay.alpha_composite(im, (x0, y0))
    line = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(line).rectangle(box, outline=G.hexc(acc, 255), width=width or max(3, H // 240))
    lay.alpha_composite(glow(line, H * 0.01, 2.6))
    return lay


def label_chip(W, H, text, x, y, acc, size=0.05):
    lay = Image.new('RGBA', (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(lay)
    f = G.font('mono', H * size); t = text.upper(); tw = d.textlength(t, font=f); pad = H * 0.014
    b = [x - pad, y - pad, x + tw + pad, y + f.size + pad * 1.3]
    d.rectangle(b, fill=(10, 14, 20, 225))
    d.line([(b[0], b[3]), (b[2], b[3])], fill=G.hexc(acc), width=max(2, H // 360))
    d.text((x, y), t, font=f, fill=(235, 240, 250, 255))
    return glow(lay, H * 0.006, 1.2)


# ---------------------------------------------------------------------------------------------
def scene_chapter_nav(s, t, W, H, _bg):
    acc = G.accent(s); bg = grid_bg(W, H, acc); D = s['duration']
    items = s.get('items') or [{'icon': 'download'}, {'icon': 'text'}, {'icon': 'folder'}, {'icon': 'video'}, {'icon': 'cut'}, {'icon': 'audio'}]
    act = int(s.get('active', 0)); n = len(items)
    lay = Image.new('RGBA', (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(lay)
    cw = W * 0.8 / n; ch = cw * 0.95; x0 = W / 2 - cw * n / 2; y0 = H * 0.5 - ch / 2
    fi = G.font(ICON_FONT, ch * 0.42); fl = G.font('mono', H * 0.026)
    on = ease_out((t - 0.5) / 0.6)
    for i, it in enumerate(items):
        x = x0 + i * cw; is_act = i == act
        a_in = ease_out((t - i * 0.06) / 0.4)
        base = 0.35 + 0.65 * (on if is_act else 0)
        col = (int(235 * (0.5 + 0.5 * base)),) * 3
        d.line([(x, y0), (x, y0 + ch)], fill=G.hexc(acc, int(70 * a_in)), width=1)
        g = ICONS.get(it.get('icon', 'star'), it.get('icon', ''))
        gw = d.textlength(g, font=fi)
        d.text((x + cw / 2 - gw / 2, y0 + ch * 0.26), g, font=fi, fill=(*col, int(255 * a_in * (0.55 + 0.45 * base))))
        if it.get('label'):
            lw = d.textlength(it['label'].upper(), font=fl)
            d.text((x + cw / 2 - lw / 2, y0 + ch * 0.74), it['label'].upper(), font=fl, fill=(200, 206, 220, int(255 * a_in * (0.35 + 0.65 * base))))
    d.line([(x0 + n * cw, y0), (x0 + n * cw, y0 + ch)], fill=G.hexc(acc, 70), width=1)
    d.line([(x0, y0 + ch), (x0 + n * cw, y0 + ch)], fill=G.hexc(acc, 90), width=max(1, H // 540))
    hl = Image.new('RGBA', (W, H), (0, 0, 0, 0)); dh = ImageDraw.Draw(hl)
    ax = x0 + act * cw
    if on > 0:
        lw_ = max(4, H // 150)
        dh.line([(ax, y0 + ch), (ax + cw * on, y0 + ch)], fill=G.hexc(acc), width=lw_)
        dh.line([(ax, y0 + ch * (1 - on)), (ax, y0 + ch)], fill=G.hexc(acc), width=lw_)
        dh.line([(ax + cw, y0 + ch * (1 - on)), (ax + cw, y0 + ch)], fill=G.hexc(acc), width=lw_)
        dh.rectangle([ax, y0, ax + cw, y0 + ch], fill=G.hexc(acc, int(22 * on)))
    lay.alpha_composite(glow(hl, H * 0.012, 2.6))
    # camera: flat -> tilt + push toward the active cell, like ref 1
    u = ease((t - 0.8) / max(0.8, D - 1.4))
    fx = (ax + cw / 2) / W
    cam = tilt(lay, ry=-16 * u * (1 if fx > 0.5 else -1), rx=8 * u, zoom=1 + 0.55 * u, cx=0.5 + (fx - 0.5) * u, cy=0.5)
    fr = bg.copy(); fr.alpha_composite(cam)
    if s.get('title'):
        ut = ease_out((t - 1.1) / 0.5)
        if ut > 0:
            chip = label_chip(W, H, s['title'], W * 0.06, H * 0.12, acc, 0.045)
            G_alpha(chip, ut); fr.alpha_composite(chip)
    return fr


def G_alpha(lay, k):
    a = lay.getchannel('A').point(lambda v: int(v * k)); lay.putalpha(a)


def scene_neon_cards(s, t, W, H, _bg):
    acc = G.accent(s); fr = grid_bg(W, H, acc); D = s['duration']
    lay = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    portrait = s.get('portrait', True)
    bw, bh = (H * 0.38, H * 0.66) if portrait else (W * 0.42, W * 0.42 * 9 / 16)
    box = [W / 2 - bw / 2, H * 0.5 - bh / 2, W / 2 + bw / 2, H * 0.5 + bh / 2]
    img = media_frame(s, t, bw, bh)
    if img is not None:
        # cover-fit into the frame
        k = max(bw / img.width, bh / img.height); im = img.resize((int(img.width * k) + 1, int(img.height * k) + 1), Image.BILINEAR)
        l, tp = (im.width - int(bw)) // 2, (im.height - int(bh)) // 2; img = im.crop((l, tp, l + int(bw), tp + int(bh)))
    lay.alpha_composite(glow_frame(W, H, box, acc, img))
    spots = [(0.1, 0.36), (0.66, 0.22), (0.64, 0.6), (0.12, 0.66)]
    for i, lab in enumerate(s.get('labels', [])[:4]):
        u = ease_out((t - 0.5 - i * 0.35) / 0.4)
        if u <= 0: continue
        chip = label_chip(W, H, lab, spots[i][0] * W, spots[i][1] * H + (1 - u) * H * 0.02, acc)
        G_alpha(chip, u); lay.alpha_composite(chip)
    u = ease(t / D)
    fr.alpha_composite(tilt(lay, ry=10 - 8 * u, rx=-6 + 4 * u, zoom=0.96 + 0.06 * u))
    return fr


def scene_framed_clip(s, t, W, H, _bg):
    acc = G.accent(s); fr = grid_bg(W, H, acc); D = s['duration']
    bw, bh = W * 0.56, W * 0.56 * 9 / 16
    box = [W / 2 - bw / 2, H * 0.5 - bh / 2, W / 2 + bw / 2, H * 0.5 + bh / 2]
    img = media_frame(s, t, bw, bh)
    if img is not None:
        k = max(bw / img.width, bh / img.height); im = img.resize((int(img.width * k) + 1, int(img.height * k) + 1), Image.BILINEAR)
        l, tp = (im.width - int(bw)) // 2, (im.height - int(bh)) // 2; img = im.crop((l, tp, l + int(bw), tp + int(bh)))
    lay = glow_frame(W, H, box, acc, img)
    if s.get('tag'):
        lay.alpha_composite(label_chip(W, H, s['tag'], box[0] + H * 0.02, box[3] - H * 0.07, acc, 0.026))
    u = ease(t / D); a = ease_out(t / 0.45)
    cam = tilt(lay, ry=-6 + 6 * u, rx=4 - 4 * u, zoom=0.92 + 0.1 * u)
    G_alpha(cam, a); fr.alpha_composite(cam)
    return fr


SCENES = {'chapter_nav': scene_chapter_nav, 'neon_cards': scene_neon_cards, 'framed_clip': scene_framed_clip}
