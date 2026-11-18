// After Effects <-> Premiere link: motion graphics built in After Effects (editable, frame-exact),
// delivered to the Premiere timeline as a live Dynamic Link comp, a .mogrt, or a transparent render.
// Every time is in FRAMES of the sequence's frame rate; comps match the sequence size + fps exactly.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { call, callAE, health, aeHealth, HOME } from './bridge-client.js';
import { TOKENS } from './media.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOK = TOKENS;   // the active theme (ULTRA_THEME, default neutral)
const REG = path.join(HOME, 'ae-link.json');

// ---------- registry: which comp sits where on which sequence ----------
function loadReg() { try { return JSON.parse(fs.readFileSync(REG, 'utf8')); } catch { return { graphics: [] }; } }
function saveReg(r) { fs.mkdirSync(HOME, { recursive: true }); fs.writeFileSync(REG, JSON.stringify(r, null, 1)); }
function findRec(name) {
  const r = loadReg(), rec = r.graphics.find((g) => g.comp === name) || r.graphics.find((g) => g.comp.toLowerCase().includes(String(name).toLowerCase()));
  if (!rec) throw new Error(`No After Effects graphic "${name}". ae_list_graphics shows them.`);
  return rec;
}
function putRec(rec) { const r = loadReg(); r.graphics = r.graphics.filter((g) => g.comp !== rec.comp); r.graphics.push(rec); saveReg(r); }

// ---------- colours ----------
const hex = (h) => { const s = h.replace('#', ''); return [0, 2, 4].map((i) => +(parseInt(s.slice(i, i + 2), 16) / 255).toFixed(4)); };
const NAMED = { accent: TOK.color.accent, accentdeep: TOK.color.accentDeep, accentsoft: TOK.color.accentSoft,
  lavender: TOK.color.lavender, lavenderdeep: TOK.color.lavenderDeep, lavendersoft: TOK.color.lavenderSoft, white: '#FFFFFF', black: '#000000' };
const CTRL = { accent: 'Accent', text: 'Text', card: 'Card', muted: 'Muted', edge: 'Edge', bg: 'Background' };
function controls(accent) {
  const a = accent ? (NAMED[String(accent).toLowerCase()] || accent) : TOK.color.accent;
  return [
    { name: 'Accent', type: 'color', value: hex(a), essential: 'Accent colour' },
    { name: 'Text', type: 'color', value: hex(TOK.color.text), essential: 'Text colour' },
    { name: 'Card', type: 'color', value: hex(TOK.color.panel), essential: 'Card colour' },
    { name: 'Muted', type: 'color', value: hex(TOK.color.muted) },
    { name: 'Edge', type: 'color', value: hex(TOK.color.panelEdge) },
    { name: 'Background', type: 'color', value: hex(TOK.color.bg) },
  ];
}
// 'accent' -> linked to CONTROLS; '#hex' -> fixed colour; [r,g,b] (0-1) passes through
function col(c, ctl) {
  if (c == null) return c;
  if (Array.isArray(c) || typeof c === 'object') return c;
  const k = String(c).toLowerCase();
  if (CTRL[k]) { const ctrl = (ctl || controls()).find((x) => x.name === CTRL[k]); return { ctrl: CTRL[k], value: ctrl.value }; }
  if (NAMED[k]) return hex(NAMED[k]);
  if (/^#?[0-9a-f]{6}$/i.test(k)) return hex(k);
  throw new Error(`Unknown colour "${c}". Use accent/text/card/muted/edge/bg, a #hex, or [r,g,b] 0-1.`);
}
// colours written by Claude in custom specs / edits: convert every colour-ish field
const COLOR_KEYS = new Set(['color', 'fill', 'strokeColor']);
function convertColors(x, ctl, key) {
  if (Array.isArray(x)) return (key === 'v' || COLOR_KEYS.has(key)) && x.every((n) => typeof n === 'number') ? x : x.map((v) => convertColors(v, ctl, key));
  if (x && typeof x === 'object') {
    if (x.ctrl) return x;
    const o = {};
    for (const [k, v] of Object.entries(x)) o[k] = convertColors(v, ctl, k);
    return o;
  }
  if (typeof x === 'string' && (COLOR_KEYS.has(key) || (key === 'v' && /^#|^(accent|text|card|muted|edge|bg)$/i.test(x)))) return col(x, ctl);
  return x;
}

// ---------- animation helpers (frames) ----------
const kIn = (f, v) => ({ f, v, ease: 'smooth', easeOut: 25 });          // quick start
const kLand = (f, v) => ({ f, v, ease: 'smooth', easeIn: 85 });          // soft landing
const kHold = (f, v) => ({ f, v, ease: 'smooth' });
function enter(c, s, from, to, outF) {   // value from->to starting at frame s, and optionally back out at the end
  const keys = [kIn(s, from), kLand(s + c.inF, to)];
  if (outF) keys.push(kHold(c.N - 1 - c.outF, to), kLand(c.N - 1, outF === true ? from : outF));
  return keys;
}
const add = (p, d) => [p[0] + d[0], p[1] + d[1]];
const FONT = { black: 'SegoeUI-Black', bold: 'SegoeUI-Bold', semi: 'SegoeUI-Semibold', reg: 'SegoeUI', serif: 'Georgia', serifI: 'Georgia-Italic', mono: 'Consolas' };

function cardWithShadow(c, name, o) {   // flat rounded card + soft shadow (main reference), shadow follows the card
  const k = c.k;
  const card = { name, type: 'rect', size: o.size, radius: TOK.radius * k, fill: col('card', c.ctl), stroke: { color: col('edge', c.ctl), width: 2 * k },
    align: o.align, position: o.position, fit: o.fit, keys: o.keys, comment: 'Card: size follows the text (fit). Colours come from CONTROLS.' };
  const shadow = { name: name + ' Shadow', type: 'rect', size: o.size, radius: TOK.radius * k, fill: [0, 0, 0], align: o.align, opacity: 45,
    position: [0, 18 * k], parent: name, fit: o.fit,
    effects: [{ match: 'ADBE Gaussian Blur 2', name: 'Softness', props: { 'ADBE Gaussian Blur 2-0001': 48 * k } }] };   // edges NOT repeated, so the shadow fades out softly
  return [card, shadow];
}
function txt(c, name, text, o) {
  return { name, type: 'text', text, font: o.font || FONT.bold, fontSize: o.size * c.k, color: col(o.color || 'text', c.ctl),
    justify: o.justify || 'left', tracking: o.tracking, anchorAt: o.anchorAt || (o.justify === 'center' ? [0.5, 0.5] : [0, 0.5]),
    position: o.position, parent: o.parent, keys: o.keys, essential: o.essential, textExpr: o.textExpr, in: o.in, out: o.out, effects: o.effects };
}

// ---------- house-style presets (main reference design on the dark theme) ----------
const PRESETS = {
  title_card(o, c) {      // chapter opener: kicker + serif title + accent underline (+ subtitle) on a rounded card
    if (!o.title) throw new Error('title_card needs title');
    const k = c.k, C = [c.W / 2, c.H / 2];
    const rows = [];
    if (o.kicker) rows.push({ id: 'Kicker', h: 30 * k });
    rows.push({ id: 'Title', h: 92 * k }, { id: 'Underline', h: 6 * k });
    if (o.subtitle) rows.push({ id: 'Subtitle', h: 38 * k });
    const gap = 28 * k, total = rows.reduce((s, r) => s + r.h, 0) + gap * (rows.length - 1);
    let y = -total / 2; const Y = {};
    for (const r of rows) { Y[r.id] = y + r.h / 2; y += r.h + gap; }
    const s0 = c.fr(0.12), step = c.fr(0.08), up = 26 * k;
    const layers = [];
    let i = 0;
    const child = (L) => { const s = s0 + step * i++; L.keys = { opacity: enter(c, s, 0, 100), position: enter(c, s, [0, Y[L.slot] + up], [0, Y[L.slot]]) }; delete L.slot; return L; };
    if (o.kicker) layers.push(child({ ...txt(c, 'Kicker', String(o.kicker).toUpperCase(), { font: FONT.mono, size: 30, color: 'accent', justify: 'center', tracking: 200, parent: 'Card', essential: 'Kicker' }), slot: 'Kicker' }));
    layers.push(child({ ...txt(c, 'Title', o.title, { font: FONT.serif, size: 92, justify: 'center', parent: 'Card', essential: 'Title' }), slot: 'Title' }));
    const sb = s0 + step * i++ + c.fr(0.1);
    layers.push({ name: 'Underline', type: 'rect', size: [120 * k, 6 * k], radius: 3 * k, fill: col('accent', c.ctl), parent: 'Card', position: [0, Y.Underline],
      keys: { scale: [kIn(sb, [0, 100]), kLand(sb + c.fr(0.5), [100, 100])] } });
    if (o.subtitle) layers.push(child({ ...txt(c, 'Subtitle', o.subtitle, { font: FONT.reg, size: 38, color: 'muted', justify: 'center', parent: 'Card', essential: 'Subtitle' }), slot: 'Subtitle' }));
    const fit = { layers: layers.filter((l) => l.type === 'text').map((l) => l.name), padX: 90 * k, height: total + 140 * k, minWidth: c.W * 0.4 };
    layers.push(...cardWithShadow(c, 'Card', { size: [c.W * 0.5, total + 140 * k], fit, keys: {
      position: enter(c, 0, add(C, [0, 40 * k]), C, add(C, [0, 20 * k])), opacity: enter(c, 0, 0, 100, 0), scale: enter(c, 0, [96, 96], [100, 100], [98, 98]) } }));
    return { layers };
  },

  lower_third(o, c) {     // name + role on a rounded card, accent bar on the left, slides in from the left
    if (!o.title) throw new Error('lower_third needs title (the name)');
    const k = c.k, h = (o.subtitle ? 150 : 104) * k, x0 = c.W * TOK.margin, P = [x0, c.H * (o.y || 0.82)];
    const padY = 26 * k, nameY = o.subtitle ? -h / 2 + padY + 27 * k : 0;
    const layers = [
      { name: 'Accent Bar', type: 'rect', size: [6 * k, h - 44 * k], radius: 3 * k, fill: col('accent', c.ctl), parent: 'Card', position: [30 * k, 0],
        keys: { scale: [kIn(c.fr(0.15), [100, 0]), kLand(c.fr(0.15) + c.inF, [100, 100])] } },
      { ...txt(c, 'Name', o.title, { font: FONT.bold, size: 54, parent: 'Card', essential: 'Name' }),
        keys: { opacity: enter(c, c.fr(0.18), 0, 100), position: enter(c, c.fr(0.18), [76 * k, nameY], [58 * k, nameY]) } },
    ];
    if (o.subtitle) layers.push({ ...txt(c, 'Role', o.subtitle, { font: FONT.reg, size: 34, color: 'muted', parent: 'Card', essential: 'Role' }),
      keys: { opacity: enter(c, c.fr(0.26), 0, 100), position: enter(c, c.fr(0.26), [76 * k, nameY + 56 * k], [58 * k, nameY + 56 * k]) } });
    const fit = { layers: layers.filter((l) => l.type === 'text').map((l) => l.name), padX: 48 * k, height: h, minWidth: 320 * k };
    layers.push(...cardWithShadow(c, 'Card', { size: [500 * k, h], align: 'left', fit, keys: {
      position: enter(c, 0, add(P, [-50 * k, 0]), P, add(P, [-30 * k, 0])), opacity: enter(c, 0, 0, 100, 0) } }));
    return { layers };
  },

  callout(o, c) {         // thin accent outline that draws on around a spot + a label chip (highlight)
    if (!o.box) throw new Error('callout needs box [x,y,w,h] as 0-1 of the frame (read it from render_frame, never guess)');
    const k = c.k, [bx, by, bw, bh] = o.box, pad = 10 * k;
    const C = [(bx + bw / 2) * c.W, (by + bh / 2) * c.H], size = [bw * c.W + 2 * pad, bh * c.H + 2 * pad];
    const draw = c.fr(0.5);
    const layers = [{ name: 'Outline', type: 'rect', size, radius: 16 * k, stroke: { color: col('accent', c.ctl), width: 4 * k }, trim: true, position: C,
      keys: { trimEnd: [kIn(0, 0), kLand(draw, 100)], opacity: [kHold(c.N - 1 - c.outF, 100), kLand(c.N - 1, 0)] },
      comment: 'Move/resize: Contents > Box > Shape > Size, and Position.' }];
    if (o.label) {
      const chipH = 54 * k, below = by < 0.12;
      const P = [C[0] - size[0] / 2, below ? C[1] + size[1] / 2 + 14 * k + chipH / 2 : C[1] - size[1] / 2 - 14 * k - chipH / 2];
      layers.unshift({ ...txt(c, 'Label', o.label, { font: FONT.semi, size: 30, color: 'bg', parent: 'Chip', essential: 'Label' }), position: [22 * k, 0] });
      layers.push({ name: 'Chip', type: 'rect', size: [200 * k, chipH], radius: chipH / 2, fill: col('accent', c.ctl), align: 'left', position: P,
        fit: { layers: ['Label'], padX: 22 * k, height: chipH },
        keys: { scale: enter(c, c.fr(0.3), [85, 85], [100, 100]), opacity: [kIn(c.fr(0.3), 0), kLand(c.fr(0.3) + c.fr(0.2), 100), kHold(c.N - 1 - c.outF, 100), kLand(c.N - 1, 0)] } });
    }
    return { layers };
  },

  list_build(o, c) {      // numbered list that builds up item by item (main reference)
    const items = o.items || [];
    if (!items.length) throw new Error('list_build needs items');
    const k = c.k, rowH = 84 * k, padY = 50 * k, head = o.title ? 74 * k : 0;
    const h = padY * 2 + head + items.length * rowH - 20 * k, x0 = c.W * TOK.margin, P = [x0, c.H * (o.y || 0.5)];
    const top = -h / 2 + padY, layers = [];
    if (o.title) layers.push({ ...txt(c, 'Heading', o.title, { font: FONT.serif, size: 46, parent: 'Card', essential: 'Heading' }),
      keys: { opacity: enter(c, c.fr(0.12), 0, 100), position: enter(c, c.fr(0.12), [56 * k, top + 23 * k + 16 * k], [56 * k, top + 23 * k]) } });
    items.forEach((it, i) => {
      const s = o.times && o.times[i] != null ? c.fr(o.times[i]) : c.fr(0.35 + i * 0.7);
      const y = top + head + i * rowH + 26 * k, n = i + 1;
      layers.push(
        { ...txt(c, `Num ${n}`, String(n), { font: FONT.bold, size: 28, color: 'bg', justify: 'center', parent: `Dot ${n}` }), position: [0, 0] },
        { name: `Dot ${n}`, type: 'ellipse', size: [52 * k, 52 * k], fill: col('accent', c.ctl), parent: 'Card', position: [56 * k + 26 * k, y],
          keys: { scale: [kIn(s, [0, 0]), kLand(s + c.inF, [100, 100])] }, comment: `Item ${n} appears at frame ${s}` },
        { ...txt(c, `Item ${n}`, it, { font: FONT.semi, size: 40, parent: 'Card', essential: `Item ${n}` }),
          keys: { opacity: enter(c, s + 2, 0, 100), position: enter(c, s + 2, [56 * k + 76 * k + 24 * k, y], [56 * k + 76 * k, y]) } });
    });
    const fit = { layers: layers.filter((l) => l.type === 'text' && !/^Num /.test(l.name)).map((l) => l.name), padX: 56 * k, height: h, minWidth: c.W * 0.3 };
    layers.push(...cardWithShadow(c, 'Card', { size: [c.W * 0.4, h], align: 'left', fit, keys: {
      position: enter(c, 0, add(P, [-50 * k, 0]), P, add(P, [-30 * k, 0])), opacity: enter(c, 0, 0, 100, 0) } }));
    return { layers };
  },

  counter(o, c) {         // big number counting up (Progress keys = when it counts), label under it
    if (o.value == null) throw new Error('counter needs value');
    const k = c.k, from = o.from || 0, d = o.decimals || 0, C = [c.W * (o.x || 0.5), c.H * (o.y || 0.5)];
    const s = c.fr(0.2), e = s + c.fr(o.countSeconds || 1.2);
    const fmt = `var t=thisComp.layer("CONTROLS").effect("Number")(1), f=thisComp.layer("CONTROLS").effect("From")(1), p=thisComp.layer("CONTROLS").effect("Progress")(1)/100;\n` +
      `var v=f+(t-f)*p, s=Math.abs(v).toFixed(${d}).replace(/\\B(?=(\\d{3})+(?!\\d))/g, ",");\n` +
      // style.setText keeps the layer's font: AE 2026 resets the style when an expression returns a plain string
      `text.sourceText.style.setText((v<0?"-":"")+${JSON.stringify(o.prefix || '')}+s+${JSON.stringify(o.suffix || '')})`;
    const finalStr = `${o.prefix || ''}${Number(o.value).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}${o.suffix || ''}`;
    const layers = [{ ...txt(c, 'Number', '0', { font: FONT.black, size: 150, justify: 'center', parent: 'Card', textExpr: fmt }), position: [0, o.label ? -34 * k : 0] }];
    if (o.label) layers.push({ ...txt(c, 'Label', o.label, { font: FONT.semi, size: 38, color: 'muted', justify: 'center', parent: 'Card', essential: 'Label' }), position: [0, 82 * k] });
    const w = Math.max(c.W * 0.28, finalStr.length * 92 * k + 160 * k), h = (o.label ? 330 : 250) * k;
    layers.push(...cardWithShadow(c, 'Card', { size: [w, h], position: C, keys: {
      position: enter(c, 0, add(C, [0, 40 * k]), C, add(C, [0, 20 * k])), opacity: enter(c, 0, 0, 100, 0), scale: enter(c, 0, [96, 96], [100, 100], [98, 98]) } }));
    return { layers, controls: [
      { name: 'Number', type: 'slider', value: Number(o.value), essential: 'Number' },
      { name: 'From', type: 'slider', value: from },
      { name: 'Progress', type: 'slider', keys: [kIn(s, 0), kLand(e, 100)] }] };
  },

  kinetic_text(o, c) {    // words pop in one by one; *stars* mark accent words (serif italic, accent colour)
    const raw = o.words || String(o.text || '').split(/\s+/).filter(Boolean);
    if (!raw.length) throw new Error('kinetic_text needs text or words');
    const k = c.k, step = c.fr(o.step || 0.18), names = [], layers = [];
    raw.forEach((w0, i) => {
      const accent = /^\*.*\*$/.test(w0) || (o.accentWords || []).includes(w0.replace(/[^\w']/g, ''));
      const w = w0.replace(/^\*|\*$/g, ''), s = o.times && o.times[i] != null ? c.fr(o.times[i]) : c.fr(0.1) + i * step, name = `W${String(i + 1).padStart(2, '0')} ${w}`.slice(0, 30);
      names.push(name);
      layers.push({ ...txt(c, name, w, { font: accent ? FONT.serifI : FONT.bold, size: o.size || 84, color: accent ? 'accent' : 'text', justify: 'center',
        effects: [{ match: 'ADBE Drop Shadow', name: 'Shadow', props: { 'ADBE Drop Shadow-0004': 6 * k, 'ADBE Drop Shadow-0005': 24 * k } }] }),
        keys: { scale: [kIn(s, [80, 80]), kLand(s + c.fr(0.25), [100, 100])],
          opacity: [kIn(s, 0), kLand(s + c.fr(0.15), 100), kHold(c.N - 1 - c.outF, 100), kLand(c.N - 1, 0)] }, comment: `appears at frame ${s}` });
    });
    return { layers, rows: [{ layers: names, y: c.H * (o.y || 0.5), maxWidth: c.W * 0.8, gap: 22 * k, lineHeight: (o.size || 84) * 1.25 * k }] };
  },

  custom(o, c) {          // Claude-written spec: {layers, controls?, rows?} (colours: accent/text/card/... or #hex)
    if (!o.spec || !o.spec.layers) throw new Error('custom needs spec.layers');
    return { layers: convertColors(o.spec.layers, c.ctl), controls: convertColors(o.spec.controls || [], c.ctl), rows: o.spec.rows };
  },
};
export const STYLES = Object.keys(PRESETS);

// ---------- Premiere side ----------
async function aepFor() {
  const p = await call('get_project');
  if (p.path) {
    const dir = path.join(path.dirname(p.path), 'Ultra AE');
    return path.join(dir, path.basename(p.path).replace(/\.prproj$/i, '') + ' motion.aep');
  }
  return path.join(HOME, 'ae', 'ultra motion.aep');
}
function freeTrack(seq, want, s, e) {
  for (let n = want; ; n++) {
    const t = seq.video[n - 1];
    if (!t || !t.clips.some((c) => c.start < e - 0.01 && c.end > s + 0.01)) return n;
  }
}
const outDir = (aep, sub) => { const d = path.join(path.dirname(aep), sub); fs.mkdirSync(d, { recursive: true }); return d; };
const safe = (s) => String(s).replace(/[^\w .-]+/g, '_');

async function place(rec) {        // put the graphic on the timeline in its delivery mode
  const dur = rec.frames / rec.fps, base = { sequence: rec.sequence, at: rec.at, duration: dur, track: rec.track };
  if (rec.mode === 'link') {
    const r = await call('import_ae_comp', { ...base, aep: rec.aep, comp: rec.comp, name: rec.comp, bin: 'Ultra AE' }, 300000);
    return `live-linked (${r.imported ? 'imported' : 'reused'} ${r.item})`;
  }
  if (rec.mode === 'mogrt') {
    const out = path.join(outDir(rec.aep, 'mogrt'), safe(rec.comp) + '.mogrt');
    rec.file = (await callAE('export_mogrt', { comp: rec.comp, outPath: out, name: rec.comp }, 300000)).mogrt;
    const r = await call('add_mogrt', { ...base, mogrtPath: rec.file });
    return `.mogrt (${(r.params || []).length} editable fields in Essential Graphics)`;
  }
  const out = path.join(outDir(rec.aep, 'renders'), safe(rec.comp) + '.mov');
  rec.file = (await callAE('render_comp', { comp: rec.comp, outPath: out }, 30 * 60 * 1000)).file;
  await call('place_many', { sequence: rec.sequence, bin: 'Ultra AE', items: [{ path: rec.file, at: rec.at, duration: dur, track: rec.track, name: rec.comp }] }, 600000);
  return `rendered with alpha: ${rec.file}`;
}
async function unplace(rec) { try { await call('remove_clip', { sequence: rec.sequence, track: rec.track, at: rec.at + 0.5 / rec.fps }); } catch { /* already gone */ } }
async function marker(rec) {
  try {
    await call('add_markers', { sequence: rec.sequence, markers: [{ at: rec.at, duration: rec.frames / rec.fps, color: 5, name: `AE ${rec.comp}`,
      comment: `After Effects comp "${rec.comp}" on V${rec.track} (${rec.mode}). ${rec.frames} frames @ ${rec.fps} fps; comp frame 0 = ${rec.at}s here. ` +
        (rec.mode === 'link' ? 'Edit: right-click clip > Edit Original (or ask Claude: ae_edit_graphic), save in AE and Premiere updates.' :
          'Edit with ae_edit_graphic: it re-delivers to this spot.') }] });
  } catch { /* markers are a nicety */ }
}

// ---------- tools ----------
export function registerAE({ tool, z, seqArg, LAYER }) {
  const frameKeys = z.array(z.object({ f: z.number().int().describe('frame of the comp (0 = first frame)'), v: z.any(),
    ease: z.union([z.enum(['smooth', 'easy', 'snap', 'soft', 'linear', 'hold']), z.number()]).optional().describe('default smooth (70% influence)'),
    easeIn: z.number().optional(), easeOut: z.number().optional() }));

  tool('ae_status', 'After Effects link: are Premiere and After Effects both connected, which AE project holds the motion graphics, how many graphics are placed.', {}, async () => {
    const [p, a] = await Promise.all([health(), aeHealth()]);
    const out = { premiere: p ? 'connected' : 'NOT connected', afterEffects: a ? 'connected' : 'NOT connected (After Effects: Window > Extensions > Ultra Premiere)', graphics: loadReg().graphics.length };
    if (a) out.ae = await callAE('ping');
    if (p) { try { out.motionProject = await aepFor(); } catch { /* no project */ } }
    return out;
  });

  tool('ae_motion_graphic', 'Build a motion graphic IN AFTER EFFECTS (house style: main-reference rounded cards on the dark theme, accent colour) and put it on the Premiere timeline. ' +
    'The comp matches the sequence size and frame rate; every keyframe sits on a frame; layers are named, colours live on a CONTROLS layer, and each graphic gets a timeline marker. ' +
    'deliver: "link" (default) = Dynamic Link, edits saved in AE update Premiere live; "mogrt" = Essential Graphics template (edit text/colours in Premiere); "render" = transparent .mov (lightest on RAM). ' +
    `styles: ${STYLES.join(', ')}. custom takes spec.layers (type text|rect|ellipse|null|solid|adjustment|footage, name, position px, size, radius, fill/stroke/color = accent|text|card|muted|edge|bg|#hex, ` +
    'parent (child position is relative to the parent centre and it fades with it), keys:{position|scale|opacity|rotation|size|radius|fill|trimEnd|fx:Name|path: [{f,v,ease}]}, effects:[{match, props}], fit, in/out frames).', {
    ...seqArg,
    style: z.enum(STYLES), at: z.number().describe('timeline seconds where the graphic starts (snapped to a frame)'), duration: z.number().describe('seconds'),
    title: z.string().optional().describe('title_card title / lower_third name / list_build heading'), subtitle: z.string().optional(), kicker: z.string().optional(),
    label: z.string().optional().describe('callout chip / counter label'), box: z.array(z.number()).length(4).optional().describe('callout: [x,y,w,h] 0-1 of the frame'),
    items: z.array(z.string()).optional(), times: z.array(z.number()).optional().describe('list items / words: seconds from the graphic start when each appears (sync to the voice)'),
    text: z.string().optional().describe('kinetic_text: the line; *word* = accent word'), words: z.array(z.string()).optional(), accentWords: z.array(z.string()).optional(),
    value: z.number().optional(), from: z.number().optional(), prefix: z.string().optional(), suffix: z.string().optional(), decimals: z.number().int().optional(), countSeconds: z.number().optional(),
    x: z.number().optional(), y: z.number().optional().describe('vertical position 0-1 where the style allows it'), size: z.number().optional(), step: z.number().optional(),
    spec: z.any().optional().describe('custom: {layers, controls?, rows?}'),
    accent: z.string().optional().describe('accent colour: #hex, or the theme accent (default)'),
    deliver: z.enum(['link', 'mogrt', 'render']).optional(), track: z.number().int().optional().describe('video track, default V7 GRAPHICS (moves up if busy)'),
    name: z.string().optional().describe('comp name; an existing graphic with this name is rebuilt in place (its link survives)'),
    switchProject: z.boolean().optional().describe('allow switching After Effects away from another open project'),
  }, async (a) => {
    const seq = await call('get_sequence', { sequence: a.sequence });
    const fps = seq.fps, fr = (s) => Math.round(s * fps), N = Math.max(2, fr(a.duration));
    const at = Math.round(a.at * fps) / fps, k = Math.min(seq.width, seq.height) / 1080;
    const ctl = controls(a.accent);
    const c = { W: seq.width, H: seq.height, fps, N, k, fr, ctl, inF: fr(0.45), outF: fr(0.3) };
    const built = PRESETS[a.style](a, c);
    const aep = await aepFor(), reg = loadReg();
    const old = a.name ? reg.graphics.find((g) => g.comp === a.name) : null;
    const label = (a.title || a.label || a.text || (a.items || [])[0] || (a.words || []).join(' ') || a.style).replace(/\*/g, '').slice(0, 28).trim();
    const comp = a.name || `${a.style.toUpperCase()} ${String(reg.graphics.filter((g) => g.aep === aep).length + 1).padStart(2, '0')} - ${label}`;
    const r = await callAE('build_comp', { project: aep, switchProject: a.switchProject, mogrtName: comp,
      comp: { name: comp, width: seq.width, height: seq.height, fps, frames: N },
      controls: [...ctl, ...(built.controls || [])], layers: built.layers, rows: built.rows,
      comment: `Ultra Premiere: ${a.style} for "${seq.name}" at ${at}s` }, 300000);
    if (old) await unplace(old);
    const track = a.track || (old && old.at === at ? old.track : freeTrack(seq, LAYER.GRAPHICS, at, at + N / fps));
    const rec = { comp, aep: r.project, sequence: seq.name, style: a.style, mode: a.deliver || 'link', track, at, frames: N, fps };
    const how = await place(rec);
    putRec(rec); await marker(rec);
    return { graphic: comp, delivered: how, timeline: `V${track} ${at}s - ${(at + N / fps).toFixed(3)}s (${N} frames @ ${fps})`, aeProject: r.project,
      layers: r.comp.layers.map((l) => `${l.name} [${l.in}-${l.out}]`), edit: 'ae_get_graphic shows every keyframe by frame; ae_edit_graphic changes them.' };
  });

  tool('ae_get_graphic', 'Read an After Effects graphic: every layer, its values, and every keyframe as a FRAME number (plus the timeline second it lands on in Premiere). Read this before editing.', {
    graphic: z.string().describe('comp name (or part of it)') }, async (a) => {
    const rec = findRec(a.graphic), info = await callAE('get_comp', { comp: rec.comp, detail: true });
    for (const l of info.layers) for (const p of l.animated || []) for (const kf of p.keys || []) kf.timeline = +(rec.at + kf.f / rec.fps).toFixed(3);
    return { ...info, placed: { sequence: rec.sequence, track: rec.track, at: rec.at, mode: rec.mode } };
  });

  tool('ae_edit_graphic', 'Change an After Effects graphic exactly, by frame, and update Premiere (link: live; render: re-render + refresh; mogrt: re-export + replace). ' +
    'changes: [{layer, text?, set:{prop:value}, keys:{prop:[{f,v,ease}]} (replaces that property\'s keys), addKeys, removeKeys:{prop:[frames]}, shift (frames), in, out, enabled, name, remove}]. ' +
    'props: position, scale, opacity, rotation, anchor, size, radius, fill, strokeColor, strokeWidth, trimEnd, text, fx:<control>, or a path like "Effects/Softness/Blurriness". ' +
    'accent recolours everything linked to CONTROLS. at moves it on the timeline; deliver switches link/mogrt/render.', {
    graphic: z.string(),
    changes: z.array(z.object({ layer: z.union([z.string(), z.number()]), text: z.string().optional(), set: z.record(z.any()).optional(),
      keys: z.record(frameKeys).optional(), addKeys: z.record(frameKeys).optional(), removeKeys: z.record(z.array(z.number().int())).optional(),
      shift: z.number().int().optional(), in: z.number().int().optional(), out: z.number().int().optional(), enabled: z.boolean().optional(),
      name: z.string().optional(), remove: z.boolean().optional(), effects: z.array(z.any()).optional() })).optional(),
    controls: z.array(z.object({ name: z.string(), type: z.enum(['color', 'slider', 'checkbox', 'angle', 'point']).optional(), value: z.any().optional(), keys: frameKeys.optional() })).optional(),
    addLayers: z.array(z.any()).optional().describe('new layers, same spec as custom'),
    accent: z.string().optional(), frames: z.number().int().optional().describe('new length in frames'),
    at: z.number().optional().describe('move to this timeline second'), deliver: z.enum(['link', 'mogrt', 'render']).optional(),
  }, async (a) => {
    const rec = findRec(a.graphic), ctl = controls(a.accent);
    let ctrls = a.controls ? a.controls.map((x) => ({ ...x, value: (x.type || 'color') === 'color' && x.value != null ? col(x.value, ctl) : x.value })) : [];
    if (a.accent) ctrls.push({ name: 'Accent', type: 'color', value: col(a.accent.startsWith('#') ? a.accent : (NAMED[a.accent.toLowerCase()] || a.accent), ctl) });
    const r = await callAE('edit_comp', { comp: rec.comp, changes: convertColors(a.changes || [], ctl), controls: ctrls.length ? ctrls : undefined,
      addLayers: a.addLayers ? convertColors(a.addLayers, ctl) : undefined, frames: a.frames }, 300000);
    const moved = a.at != null && Math.abs(a.at - rec.at) > 1e-6, lengthChanged = a.frames && a.frames !== rec.frames;
    const modeChanged = a.deliver && a.deliver !== rec.mode;
    let how;
    if (moved || modeChanged || rec.mode !== 'link' || lengthChanged) {
      await unplace(rec);
      if (moved) rec.at = Math.round(a.at * rec.fps) / rec.fps;
      if (a.frames) rec.frames = a.frames;
      if (a.deliver) rec.mode = a.deliver;
      if (rec.mode === 'render' && rec.file && !modeChanged) { try { fs.unlinkSync(rec.file); } catch { /* re-rendered below */ } }
      how = await place(rec);
      if (rec.mode === 'render') { try { await call('refresh_media', { path: rec.file }); } catch { /* new file */ } }
      putRec(rec); await marker(rec);
    } else how = 'live link: Premiere picks up the saved After Effects project by itself';
    return { graphic: rec.comp, done: r.done, premiere: how };
  });

  tool('ae_open_graphic', 'Open a graphic\'s comp in the After Effects viewer at a frame (or at a timeline second from Premiere) so you can tweak it by hand.', {
    graphic: z.string(), frame: z.number().int().optional(), at: z.number().optional().describe('timeline seconds') }, async (a) => {
    const rec = findRec(a.graphic), frame = a.frame != null ? a.frame : a.at != null ? Math.round((a.at - rec.at) * rec.fps) : 0;
    return callAE('open_comp', { comp: rec.comp, frame });
  });

  tool('ae_list_graphics', 'List the After Effects graphics placed on Premiere sequences (comp, sequence, track, time, frames, delivery mode).', {
    sequence: z.string().optional() }, async (a) => loadReg().graphics.filter((g) => !a.sequence || g.sequence === a.sequence));

  tool('ae_run_script', 'Advanced: run raw After Effects ExtendScript (app, AEMCP helpers). Returns the last expression. Use only when no ae_ tool fits.', { code: z.string() },
    (a) => callAE('run_script', a, 300000));
}
