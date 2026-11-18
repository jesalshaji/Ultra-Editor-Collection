// Media helpers that run on this PC with ffmpeg: title/caption graphics (transparent PNG),
// colour looks, SRT files, the sound-effect kit (your own sounds), media probing.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { HOME } from './bridge-client.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const FONTS = path.join(ROOT, 'assets', 'fonts');
// Sound effects: drop your own licensed audio into assets/sfx/<kit>/ (or point ULTRA_SFX_DIR at a folder).
export const SFX = process.env.ULTRA_SFX_DIR || path.join(ROOT, 'assets', 'sfx');
export const OUT = process.env.ULTRA_PREMIERE_OUT || path.join(HOME, 'generated');
// text files for drawtext must be reachable by a path with no drive colon, so they live inside the project
const WORK = path.join(ROOT, '.work');

export function ensureDir(d) { fs.mkdirSync(d, { recursive: true }); return d; }

function run(bin, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { maxBuffer: 64 * 1024 * 1024, windowsHide: true, ...opts }, (err, stdout, stderr) => {
      if (err) reject(new Error(`${bin} failed: ${String(stderr || err.message).split('\n').filter((l) => !/Fontconfig/.test(l)).slice(-6).join('\n')}`));
      else resolve({ stdout, stderr });
    });
  });
}

let n = 0;
export function outFile(prefix, ext, dir) {
  ensureDir(dir || OUT);
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  return path.join(dir || OUT, `${prefix}-${stamp}-${(++n).toString().padStart(3, '0')}.${ext}`);
}

// ---------------- text styles (clean documentary look) ----------------
const STYLES = {
  title:       { font: 'seguibl.ttf', size: 120, color: 'FFFFFF', y: 'center', shadow: true },
  keyword:     { font: 'seguibl.ttf', size: 132, color: 'FFFFFF', y: 'center', shadow: true },
  caption:     { font: 'segoeuib.ttf', size: 62,  color: 'FFFFFF', y: 0.80, shadow: true },
  caption_box: { font: 'segoeuib.ttf', size: 56,  color: 'FFFFFF', y: 0.82, box: '000000@0.62', pad: 18 },
  shock:       { font: 'BOD_B.TTF', size: 176, color: 'F2030A', y: 'center', upper: true },
  mega:        { font: 'seguibl.ttf', size: 420, color: 'F2030A', y: 'center', upper: true },
  serif_title: { font: 'BOD_BI.TTF', size: 136, color: 'FFFFFF', y: 'center', shadow: true },
  tag:         { font: 'seguisb.ttf', size: 30,  color: 'FFFFFF', x: 0.045, y: 0.90, align: 'left', shadow: true },
  label:       { font: 'segoeuib.ttf', size: 44,  color: '121214', box: 'FFE04A@1.0', pad: 14, y: 'center' },
  mono:        { font: 'consola.ttf', size: 40, color: 'FFFFFF', y: 'center', box: '060607@0.75', pad: 16 },
};
export const STYLE_NAMES = Object.keys(STYLES);

function esc(v) { return String(v).replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'"); }

export function fontFor(font) {
  if (!font) return null;
  if (fs.existsSync(path.join(FONTS, font))) return font;               // vendored open-licence font
  const win = path.join(process.env.WINDIR || 'C:/Windows', 'Fonts', font);
  if (fs.existsSync(win)) { const copy = path.join(FONTS, font); fs.copyFileSync(win, copy); return font; }
  if (fs.existsSync(font)) { const copy = path.join(FONTS, path.basename(font)); fs.copyFileSync(font, copy); return path.basename(font); }
  throw new Error(`Font not found: ${font}. Use a file in C:/Windows/Fonts (e.g. arialbd.ttf) or a full path.`);
}

/**
 * Transparent PNG with text, sized to the sequence frame. Lines split on "\n".
 * opts: text, style, width, height, color (hex), size, font, x/y (0-1 or 'center'), align, box, sub (second line, smaller), out
 */
export async function textGraphic(opts) {
  const st = { ...(STYLES[opts.style || 'title'] || STYLES.title) };
  for (const k of ['color', 'size', 'x', 'y', 'align', 'box', 'pad']) if (opts[k] !== undefined && opts[k] !== null) st[k] = opts[k];
  const font = fontFor(opts.font || st.font);
  const W = opts.width || 1920, H = opts.height || 1080;
  const scale = H / 1080;
  const size = Math.round(st.size * scale);
  let text = String(opts.text || '');
  if (st.upper) text = text.toUpperCase();
  ensureDir(WORK);
  const tf = path.join(WORK, `t${Date.now()}${++n}.txt`);
  fs.writeFileSync(tf, text, 'utf8');
  const rel = path.relative(FONTS, tf).replace(/\\/g, '/');

  const xExpr = st.align === 'left' ? `${Math.round((st.x ?? 0.05) * W)}`
    : st.align === 'right' ? `w-text_w-${Math.round((1 - (st.x ?? 0.95)) * W)}`
    : (st.x !== undefined && st.x !== 'center') ? `${Math.round(st.x * W)}-text_w/2` : '(w-text_w)/2';
  const yExpr = (st.y === 'center' || st.y === undefined) ? '(h-text_h)/2' : `${Math.round(st.y * H)}-text_h/2`;

  const parts = [`textfile='${esc(rel)}'`, `fontfile='${esc(font)}'`, `fontsize=${size}`, `fontcolor=0x${st.color.replace('#', '')}`,
    `x=${xExpr}`, `y=${yExpr}`, `line_spacing=${Math.round(size * 0.12)}`, 'fix_bounds=1'];
  if (st.align === 'center' || !st.align) parts.push('text_align=C');
  if (st.shadow) parts.push(`shadowcolor=black@0.45`, `shadowx=0`, `shadowy=${Math.max(2, Math.round(4 * scale))}`);
  if (opts.outline) parts.push(`borderw=${Math.round(opts.outline * scale)}`, `bordercolor=0x${String(opts.outlineColor || '000000').replace('#', '')}`);
  if (st.box) {
    const [c, a] = String(st.box).split('@');
    parts.push('box=1', `boxcolor=0x${c.replace('#', '')}@${a || '0.6'}`, `boxborderw=${Math.round((st.pad || 16) * scale)}`);
  }
  let vf = `drawtext=${parts.join(':')}`;
  if (opts.sub) {
    const sf = path.join(WORK, `s${Date.now()}${++n}.txt`);
    fs.writeFileSync(sf, String(opts.sub), 'utf8');
    const srel = path.relative(FONTS, sf).replace(/\\/g, '/');
    const ssize = Math.round(size * 0.55);
    vf += `,drawtext=textfile='${esc(srel)}':fontfile='${esc(fontFor('seguisb.ttf'))}':fontsize=${ssize}:fontcolor=0x${st.color.replace('#', '')}@0.85:x=${xExpr.replace(/text_w/g, 'tw')}:y=${yExpr}+${Math.round(size * 1.25)}`;
    vf = vf.replace(/tw/g, 'text_w');
  }
  const out = opts.out || outFile(opts.style || 'title', 'png');
  ensureDir(path.dirname(out));
  try {
    await run('ffmpeg', ['-nostdin', '-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=black@0.0:s=${W}x${H},format=rgba`,
      '-frames:v', '1', '-vf', vf, out], { cwd: FONTS });
  } finally {
    try { fs.unlinkSync(tf); } catch {}
  }
  return out;
}

// ---------------- colour looks (ffmpeg colour treatments) ----------------
const LOOKS = {
  natural: 'eq=contrast=1.05:saturation=1.05',
  mono: 'hue=s=0,eq=contrast=1.35:brightness=-0.02',
  teal: 'colorbalance=rs=-0.25:gs=0.02:bs=0.22:rm=-0.08:bm=0.06:rh=0.10:gh=0.03:bh=-0.08,eq=contrast=1.15:saturation=0.85',
  warm: 'colorchannelmixer=.50:.62:.18:0:.38:.56:.14:0:.24:.40:.12,eq=contrast=1.18:brightness=0.02',
  invert: 'negate',
  deep: 'eq=contrast=1.35:brightness=-0.18:saturation=0.8',
  clean: 'eq=contrast=1.06:saturation=0.92:gamma=1.02,unsharp=5:5:0.4',
};
export const LOOK_NAMES = Object.keys(LOOKS);

export async function treat(input, look, out) {
  if (!LOOKS[look]) throw new Error(`Unknown look ${look}. Use one of: ${LOOK_NAMES.join(', ')}`);
  if (!fs.existsSync(input)) throw new Error(`File not found: ${input}`);
  const ext = path.extname(input).toLowerCase();
  const still = ['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.tif', '.tiff'].includes(ext);
  const o = out || outFile(`${path.basename(input, ext)}-${look}`, still ? (ext === '.png' ? 'png' : 'jpg') : 'mp4');
  ensureDir(path.dirname(o));
  const args = ['-nostdin', '-v', 'error', '-y', '-i', input, '-vf', LOOKS[look]];
  if (still) args.push('-frames:v', '1', '-q:v', '2');
  else args.push('-c:v', 'libx264', '-crf', '16', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-c:a', 'copy');
  args.push(o);
  await run('ffmpeg', args);
  return o;
}

// ---------------- captions ----------------
function srtTime(s) {
  const ms = Math.max(0, Math.round(s * 1000));
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), sec = Math.floor((ms % 60000) / 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
}

/** words [{w,s,e}] -> caption chunks of up to maxWords, breaking on punctuation and pauses */
export function chunkWords(words, maxWords = 3, gap = 0.45) {
  const out = []; let cur = [];
  const flush = () => { if (cur.length) out.push({ text: cur.map((x) => x.w).join(' '), start: cur[0].s, end: cur[cur.length - 1].e }); cur = []; };
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (cur.length && w.s - cur[cur.length - 1].e > gap) flush();
    cur.push(w);
    if (cur.length >= maxWords || /[.!?,;:]$/.test(w.w)) flush();
  }
  flush();
  return out;
}

export function writeSrt(segments, out) {
  const o = out || outFile('captions', 'srt');
  const body = segments.map((s, i) => `${i + 1}\n${srtTime(s.start)} --> ${srtTime(s.end)}\n${String(s.text).trim()}\n`).join('\n');
  fs.writeFileSync(o, body, 'utf8');
  return o;
}

// ---------------- sound effects (bring your own kit: assets/sfx/<kit>/*.wav, optional peaks.json) ----------------
const AUDIO_RE = /\.(wav|mp3|aif|aiff)$/i;
export function listSfx() {
  let peaks = {};
  try { peaks = JSON.parse(fs.readFileSync(path.join(SFX, 'peaks.json'), 'utf8')); } catch {}
  const out = [];
  if (!fs.existsSync(SFX)) return out;
  const dirs = fs.readdirSync(SFX, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  for (const dir of dirs) {
    for (const f of fs.readdirSync(path.join(SFX, dir)).filter((x) => AUDIO_RE.test(x))) {
      const name = `${dir}/${f.replace(AUDIO_RE, '')}`;
      out.push({ name, file: path.join(SFX, dir, f), lengthMs: peaks[name]?.len_ms ?? null, transientMs: peaks[name]?.peak_ms ?? 0 });
    }
  }
  return out;
}
export function findSfx(name) {
  const all = listSfx();
  const hit = all.find((s) => s.name === name) || all.find((s) => s.name.endsWith('/' + name));
  if (hit) return hit;
  if (fs.existsSync(name)) return { name: path.basename(name), file: path.resolve(name), transientMs: 0 };
  throw new Error(`Unknown sound ${name}. Options: ${all.map((s) => s.name).join(', ')} or a full path to an audio file.`);
}

// ---------------- probing ----------------
export async function probe(file) {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries',
    'format=duration:stream=codec_type,width,height,r_frame_rate,sample_rate,channels', '-of', 'json', file]);
  const j = JSON.parse(stdout);
  const v = j.streams?.find((s) => s.codec_type === 'video'), a = j.streams?.find((s) => s.codec_type === 'audio');
  const fr = v?.r_frame_rate?.split('/').map(Number);
  return { duration: Number(j.format?.duration || 0), video: v ? { width: v.width, height: v.height, fps: fr ? +(fr[0] / (fr[1] || 1)).toFixed(3) : null } : null,
    audio: a ? { sampleRate: Number(a.sample_rate), channels: a.channels } : null };
}

export { run };

// ---------------- silence + speech ----------------
/** Find silences with ffmpeg and return the ranges to KEEP (speech), padded so words are not clipped. */
export async function speechRanges(file, { thresholdDb = -35, minSilence = 0.45, pad = 0.12, minKeep = 0.25 } = {}) {
  const { stderr } = await run('ffmpeg', ['-nostdin', '-hide_banner', '-i', file, '-vn', '-af',
    `silencedetect=noise=${thresholdDb}dB:d=${minSilence}`, '-f', 'null', '-']);
  const dur = (await probe(file)).duration;
  const sil = []; let cur = null;
  for (const line of stderr.split('\n')) {
    const s = line.match(/silence_start: (-?[\d.]+)/); if (s) cur = { start: Math.max(0, +s[1]) };
    const e = line.match(/silence_end: ([\d.]+)/); if (e && cur) { cur.end = +e[1]; sil.push(cur); cur = null; }
  }
  if (cur) { cur.end = dur; sil.push(cur); }
  const keep = []; let t = 0;
  for (const s of sil) { if (s.start > t) keep.push({ start: t, end: s.start }); t = s.end; }
  if (t < dur) keep.push({ start: t, end: dur });
  const padded = keep.map((k) => ({ start: Math.max(0, k.start - pad), end: Math.min(dur, k.end + pad) }))
    .filter((k) => k.end - k.start >= minKeep);
  // merge ranges that touch after padding
  const merged = [];
  for (const k of padded) {
    const last = merged[merged.length - 1];
    if (last && k.start <= last.end + 0.02) last.end = Math.max(last.end, k.end); else merged.push({ ...k });
  }
  const r = (x) => Math.round(x * 1000) / 1000;
  const kept = merged.reduce((a, k) => a + k.end - k.start, 0);
  return { duration: r(dur), keptSeconds: r(kept), removedSeconds: r(dur - kept), silences: sil.length,
    keep: merged.map((k) => ({ start: r(k.start), end: r(k.end) })) };
}

const VENV_PY = path.join(HOME, 'venv', 'Scripts', 'python.exe');
/** Local Whisper transcript with word timings. */
export async function transcribe(file, { model = 'small', language } = {}) {
  if (!fs.existsSync(VENV_PY)) throw new Error('Transcription is not installed yet. Run: node scripts/setup-whisper.js');
  const out = outFile(path.basename(file, path.extname(file)) + '-transcript', 'json', path.join(OUT, 'transcripts'));
  const args = [path.join(ROOT, 'scripts', 'transcribe.py'), file, out, '--model', model];
  if (language) args.push('--language', language);
  await run(VENV_PY, args, { timeout: 60 * 60 * 1000 });
  return { path: out, ...JSON.parse(fs.readFileSync(out, 'utf8')) };
}

// ---------------- dark theme: main-reference layouts + cards ----------------
// Theme: ULTRA_THEME = a folder name in styles/ (default "neutral") or a path to a tokens.json.
// Nothing is hard-coded to one creator's look; dark-lavender is just an optional preset.
export const THEME_NAME = process.env.ULTRA_THEME || 'neutral';
const TOKENS_FILE = fs.existsSync(THEME_NAME) ? THEME_NAME : path.join(ROOT, 'styles', THEME_NAME, 'tokens.json');
export const TOKENS = withAccentAliases(JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8')));
/** accent / accentDeep / accentSoft are the real keys; the old lavender* names stay as aliases. */
export function withAccentAliases(t) {
  const c = t.color;
  c.accent ??= c.lavender; c.accentDeep ??= c.lavenderDeep; c.accentSoft ??= c.lavenderSoft;
  c.lavender ??= c.accent; c.lavenderDeep ??= c.accentDeep; c.lavenderSoft ??= c.accentSoft;
  t.accent ??= 'accent';
  return t;
}
export const THEME_KINDS = ['background', 'chapter', 'name_tag', 'list', 'highlight', 'focus', 'stat', 'chapter_tag', 'keyword', 'label', 'caption'];

/** Render theme graphics with Pillow (scripts/ev_graphics.py). specs: one or many {kind, ...}. Returns PNG paths. */
export async function themeGraphics(specs) {
  const list = (Array.isArray(specs) ? specs : [specs]).map((s) => ({ W: 1920, H: 1080, ...s }));
  const dir = ensureDir(path.join(OUT, 'theme'));
  for (const s of list) {
    if (!s.out && !s.outPrefix) {
      if (s.kind === 'list') s.outPrefix = outFile('list', 'x', dir).replace(/\.x$/, '');
      else s.out = outFile(s.kind, 'png', dir);
    }
  }
  const spec = outFile('spec', 'json', path.join(WORK));
  fs.writeFileSync(spec, JSON.stringify(list));
  try {
    const { stdout } = await run(VENV_PY, [path.join(ROOT, 'scripts', 'ev_graphics.py'), spec]);
    return JSON.parse(stdout.trim().split('\n').pop()).map((p) => path.normalize(p));
  } finally { try { fs.unlinkSync(spec); } catch {} }
}

/** Find black bars in a recording (OBS letterboxing) -> crop {w,h,x,y} in pixels, or null. */
export async function detectCrop(file, at = 5) {
  const { stderr } = await run('ffmpeg', ['-nostdin', '-hide_banner', '-ss', String(at), '-t', '3', '-i', file, '-vf', 'cropdetect=limit=24:round=2:reset=0', '-an', '-f', 'null', '-']);
  const m = [...stderr.matchAll(/crop=(\d+):(\d+):(\d+):(\d+)/g)].pop();
  return m ? { w: +m[1], h: +m[2], x: +m[3], y: +m[4] } : null;
}

/**
 * Main-reference layout clip (silent, put it above the talking head):
 *  split       screen in a big rounded panel (slow zoom) + camera in a rounded card on the right
 *  screen      screen alone in a big rounded panel (slow zoom)
 *  cam         camera in a rounded panel on the dark canvas
 * opts: layout, screen, screenIn, cam, camIn, duration, W, H, fps, zoom (per second, e.g. 0.03), focus [x,y] 0-1 (zoom target), accent, out
 */
export async function makeLayout(o) {
  const W = o.W || 1920, H = o.H || 1080, fps = o.fps || 30, D = Number(o.duration || 4);
  const layout = o.layout || 'split';
  const L = TOKENS.layout;
  const rects = layout === 'split' ? { screen: L.split.screen, cam: L.split.cam }
    : layout === 'screen' ? { screen: [0.07, 0.08, 0.86, 0.84] }
    : { cam: [0.16, 0.09, 0.68, 0.82] };
  const dir = ensureDir(path.join(OUT, 'layouts'));
  const out = o.out || outFile(`layout-${layout}`, 'mp4', dir);
  const pxr = (r) => [Math.round(r[0] * W / 2) * 2, Math.round(r[1] * H / 2) * 2, Math.round(r[2] * W / 2) * 2, Math.round(r[3] * H / 2) * 2];
  const specs = [{ kind: 'background', W, H }, { kind: 'panel_frame', W, H, rects: Object.values(rects), accent: o.accent, out: path.join(dir, `frame-${Date.now()}.png`) }];
  for (const k of Object.keys(rects)) { const r = pxr(rects[k]); specs.push({ kind: 'panel_mask', W: r[2], H: r[3], rect: [0, 0, 1, 1], radius: TOKENS.radius * 1080 / H, out: path.join(dir, `mask-${k}-${Date.now()}.png`) }); }
  const pngs = await themeGraphics(specs);
  const [bg, frame, ...masks] = pngs;
  const args = ['-nostdin', '-v', 'error', '-y', '-loop', '1', '-framerate', String(fps), '-t', String(D), '-i', bg];
  const fc = []; let last = '[0:v]'; let idx = 1, mi = 0;
  const z = o.zoom ?? TOKENS.pace.zoomPerSecond, [fx, fy] = o.focus || [0.5, 0.5];
  for (const k of Object.keys(rects)) {
    const [x, y, w, h] = pxr(rects[k]);
    const src = k === 'screen' ? o.screen : o.cam;
    if (!src) throw new Error(`layout "${layout}" needs a ${k} file`);
    const crop = k === 'cam' ? await detectCrop(src, Number(o.camIn || 0) + 1) : null;
    args.push('-ss', String(k === 'screen' ? o.screenIn || 0 : o.camIn || 0), '-t', String(D), '-i', src);
    const vi = idx++;
    args.push('-loop', '1', '-framerate', String(fps), '-t', String(D), '-i', masks[mi++]);
    const mIdx = idx++;
    const zk = k === 'screen' ? z : (o.camZoom ?? 0);
    const cx = k === 'screen' ? fx : 0.5, cy = k === 'screen' ? fy : 0.4;
    fc.push(`[${vi}:v]fps=${fps},${crop ? `crop=${crop.w}:${crop.h}:${crop.x}:${crop.y},` : ''}scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},` +
      `scale=w='trunc(${w}*(1+${zk}*t)/2)*2':h='trunc(${h}*(1+${zk}*t)/2)*2':eval=frame,crop=${w}:${h}:'(iw-${w})*${cx}':'(ih-${h})*${cy}',format=rgba[v${k}]`);
    fc.push(`[${mIdx}:v]format=rgba,alphaextract[m${k}]`, `[v${k}][m${k}]alphamerge[p${k}]`);
    fc.push(`${last}[p${k}]overlay=${x}:${y}:shortest=1[o${k}]`); last = `[o${k}]`;
  }
  args.push('-loop', '1', '-framerate', String(fps), '-t', String(D), '-i', frame);
  fc.push(`${last}[${idx}:v]overlay=0:0:shortest=1,format=yuv420p[out]`);
  args.push('-filter_complex', fc.join(';'), '-map', '[out]', '-an', '-r', String(fps), '-c:v', 'libx264', '-crf', '17', '-preset', 'medium', out);
  await run('ffmpeg', args, { timeout: 30 * 60 * 1000 });
  for (const p of [bg, frame, ...masks]) { try { fs.unlinkSync(p); } catch {} }
  return out;
}

// ---------------- the user's own Premiere effect presets ----------------
export function findPresetFile() {
  const roots = [path.join(process.env.USERPROFILE || '', 'OneDrive', 'Documents'), path.join(process.env.USERPROFILE || '', 'Documents')];
  let best = null;
  for (const r of roots) {
    const base = path.join(r, 'Adobe', 'Premiere Pro');
    if (!fs.existsSync(base)) continue;
    for (const ver of fs.readdirSync(base)) {
      const vd = path.join(base, ver); if (!fs.statSync(vd).isDirectory()) continue;
      for (const prof of fs.readdirSync(vd).filter((d) => d.startsWith('Profile-'))) {
        const f = path.join(vd, prof, 'Effect Presets and Custom Items.prfpset');
        if (fs.existsSync(f) && (!best || fs.statSync(f).mtimeMs > fs.statSync(best).mtimeMs)) best = f;
      }
    }
  }
  return best;
}

/** Parsed presets, cached in ~/.ultra-premiere-mcp/presets.json and refreshed when Premiere's file changes. */
export async function loadPresets() {
  const src = process.env.ULTRA_PREMIERE_PRESETS || findPresetFile();
  if (!src) throw new Error('No Premiere effect presets file found (Documents/Adobe/Premiere Pro/<ver>/Profile-*/).');
  const cache = path.join(HOME, 'presets.json');
  if (!fs.existsSync(cache) || fs.statSync(cache).mtimeMs < fs.statSync(src).mtimeMs) {
    await run(fs.existsSync(VENV_PY) ? VENV_PY : 'python', [path.join(ROOT, 'scripts', 'presets.py'), src, cache], { timeout: 120000 });
  }
  return JSON.parse(fs.readFileSync(cache, 'utf8'));
}

export async function findPreset(name) {
  const all = await loadPresets();
  const n = String(name).toLowerCase().trim();
  return all.find((p) => p.name.toLowerCase() === n) || all.find((p) => p.name.toLowerCase().includes(n))
    || (() => { throw new Error(`Preset not found: ${name}. Use list_presets.`); })();
}

/** Fit a preset effect's keyframes to a clip the way Premiere does (anchor to in / out / scale). */
export function fitEffect(e, clipDur) {
  const span = e.span || clipDur;
  const fit = (t) => {
    const rel = t - (e.start || 0);
    if (e.anchor === 'out') return clipDur - (span - rel);
    if (e.anchor === 'scale') return (rel / span) * clipDur;
    return rel;
  };
  return { ...e, params: e.params.map((p) => (p.keys ? { ...p, keys: p.keys.map(([t, v]) => [+Math.max(0, Math.min(clipDur, fit(t))).toFixed(4), v]) } : p)) };
}
