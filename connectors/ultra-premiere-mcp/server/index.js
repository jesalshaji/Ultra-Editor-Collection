#!/usr/bin/env node
// Ultra Premiere MCP: Claude <-> Adobe Premiere Pro.
// Timeline editing, silence removal, best-part selects, captions, graphics, colour looks and
// sound effects, frame previews and export. Talks to the "Ultra Premiere" panel inside Premiere.
import fs from 'node:fs';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { fileURLToPath } from 'node:url';
const SCRIPTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts');
import { call, health, HOME } from './bridge-client.js';
import * as M from './media.js';
import { registerAE } from './ae-link.js';

const server = new McpServer({ name: 'ultra-premiere', version: '1.0.0' });

// ---------- helpers ----------
const text = (obj) => ({ content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj, null, 1) }] });
function tool(name, description, shape, fn) {
  server.tool(name, description, shape, async (args) => {
    try { const r = await fn(args || {}); return r && r.content ? r : text(r); }
    catch (e) { return { isError: true, content: [{ type: 'text', text: String(e.message || e) }] }; }
  });
}
const seqArg = { sequence: z.string().optional().describe('Sequence name. Default: the active sequence.') };
const clipSel = {
  track: z.number().int().min(1).optional().describe('Track number, 1 = V1/A1'),
  kind: z.enum(['video', 'audio']).optional().describe('Track type, default video'),
  clipIndex: z.number().int().min(0).optional().describe('Clip position on the track (0 = first), from get_sequence'),
  at: z.number().optional().describe('Or: pick the clip under this time (seconds)'),
};
const keys = z.array(z.object({ t: z.number().describe('seconds from the clip start'), value: z.any() })).optional();

function premiereDir() {
  const base = 'C:/Program Files/Adobe';
  const dirs = fs.existsSync(base) ? fs.readdirSync(base).filter((d) => /^Adobe Premiere Pro/.test(d)).sort() : [];
  return dirs.length ? path.join(base, dirs[dirs.length - 1]) : null;
}
const PRESETS = {
  youtube_1080: 'MediaIO/systempresets/4E49434B_48323634/YouTube 1080p HD.epr',
  youtube_4k: 'MediaIO/systempresets/4E49434B_48323634/YouTube 2160p 4K.epr',
  h264_match: 'MediaIO/systempresets/3F3F3F3F_4D6F6F56/H264 Match Source - High bitrate.epr',
};
function presetPath(p) {
  if (!p) p = 'youtube_1080';
  if (PRESETS[p]) { const d = premiereDir(); if (!d) throw new Error('Premiere install not found'); return path.join(d, PRESETS[p]); }
  return p;
}

// sequence maps: which source seconds landed where, so captions follow the cut
const MAPS = M.ensureDir(path.join(HOME, 'sequences'));
const mapFile = (name) => path.join(MAPS, String(name).replace(/[^\w.-]+/g, '_') + '.json');
function saveMap(r, sourcePath) { fs.writeFileSync(mapFile(r.sequence), JSON.stringify({ source: sourcePath, ...r }, null, 1)); }
function loadMap(name) { try { return JSON.parse(fs.readFileSync(mapFile(name), 'utf8')); } catch { return null; } }
function remapWords(words, map) {
  if (!map) return words;
  const out = [];
  for (const w of words) {
    const p = map.map.find((m) => w.s >= m.srcStart - 0.03 && w.s < m.srcEnd);
    if (!p) continue;
    const s = p.seqStart + (w.s - p.srcStart), e = p.seqStart + (Math.min(w.e, p.srcEnd) - p.srcStart);
    out.push({ ...w, s: +s.toFixed(3), e: +Math.max(e, s + 0.05).toFixed(3) });
  }
  return out;
}
async function activeSeqInfo(sequence) { return call('get_sequence', { sequence }); }
function loadWords(a) {
  if (a.words) return a.words;
  if (a.transcriptPath) return JSON.parse(fs.readFileSync(a.transcriptPath, 'utf8')).words;
  throw new Error('Give transcriptPath (from transcribe_media) or words [{w,s,e}].');
}

// ---------- status / project ----------
tool('premiere_status', 'Check the connection to Premiere and show the open project and active sequence. Call this first.', {}, async () => {
  if (!(await health())) return 'NOT CONNECTED. Open Premiere Pro with a project, then Window > Extensions > Ultra Premiere (it should say Connected).';
  return call('ping');
});
tool('get_project', 'List the open project and all its sequences (size, fps, duration).', {}, () => call('get_project'));
tool('list_project_items', 'List clips/bins/sequences in the project panel.', {
  bin: z.string().optional(), filter: z.string().optional().describe('name contains'), limit: z.number().optional() },
  (a) => call('list_items', a));
tool('get_sequence', 'Read a sequence: tracks, every clip with start/end/in/out (seconds), playhead. Read this before editing.', seqArg,
  (a) => call('get_sequence', a));
tool('import_media', 'Import files (video, audio, images, .srt) into the project.', {
  paths: z.array(z.string()), bin: z.string().optional() }, (a) => call('import_files', a));
tool('create_sequence', 'Create a sequence. With fromPaths it matches the first clip (size + fps) and puts the clips on it.', {
  name: z.string(), fromPaths: z.array(z.string()).optional(), presetPath: z.string().optional().describe('.sqpreset, only when no fromPaths'),
  bin: z.string().optional() }, (a) => call('create_sequence', a));
tool('open_sequence', 'Make a sequence active and open it in the timeline.', { sequence: z.string() }, (a) => call('open_sequence', a));
tool('probe_media', 'Duration, size, fps and audio info of a file on disk.', { path: z.string() }, (a) => M.probe(a.path));

// ---------- timeline editing ----------
tool('add_clip', 'Put a clip on the timeline (overwrite by default, or insert = ripple). Imports the file if needed. Optional source in/out and duration.', {
  ...seqArg, path: z.string().optional(), itemName: z.string().optional(), itemId: z.string().optional(),
  at: z.number().optional().describe('timeline seconds, default = end of sequence'), track: z.number().int().min(1).optional(),
  audioOnly: z.boolean().optional().describe('place on an audio track (music, voice-over, sfx)'),
  sourceIn: z.number().optional(), sourceOut: z.number().optional(), duration: z.number().optional().describe('length on timeline (stills/graphics)'),
  mode: z.enum(['overwrite', 'insert']).optional(), bin: z.string().optional() }, (a) => call('add_clip', a));
tool('trim_clip', 'Change a timeline clip: new start/end on the timeline or new in/out in the source (seconds).', {
  ...seqArg, ...clipSel, start: z.number().optional(), end: z.number().optional(), inPoint: z.number().optional(), outPoint: z.number().optional() },
  (a) => call('trim_clip', a));
tool('move_clip', 'Move a clip to a new start time (to) or by an offset (by).', { ...seqArg, ...clipSel, to: z.number().optional(), by: z.number().optional() },
  (a) => call('move_clip', a));
tool('remove_clip', 'Delete a clip. ripple=true closes the gap.', { ...seqArg, ...clipSel, ripple: z.boolean().optional() }, (a) => call('remove_clip', a));
tool('razor', 'Cut clips at one or more times. Without track it cuts all tracks.', {
  ...seqArg, times: z.array(z.number()), track: z.number().int().optional(), kind: z.enum(['video', 'audio']).optional() }, (a) => call('razor', a));
tool('set_clip_properties', 'Rename, enable/disable, colour label (0-15) or change speed (1 = 100%, 2 = 200%).', {
  ...seqArg, ...clipSel, newName: z.string().optional(), enabled: z.boolean().optional(), label: z.number().int().optional(),
  speed: z.number().optional(), reverse: z.boolean().optional(), ripple: z.boolean().optional() }, (a) => call('set_clip_props', a));
tool('set_transform', 'Scale (%), position (pixels [x,y], centre = [w/2,h/2]), rotation (deg), opacity (0-100). Use keyframes for punch-ins and moves: {scale:[{t:0,value:100},{t:1.5,value:115}]}.', {
  ...seqArg, ...clipSel, scale: z.number().optional(), position: z.array(z.number()).length(2).optional(), rotation: z.number().optional(),
  opacity: z.number().optional(),
  keyframes: z.object({ scale: keys, position: keys, rotation: keys, opacity: keys }).optional() }, (a) => call('set_transform', a));
tool('set_volume', 'Set an audio clip volume in dB, or keyframe it ([{t, db}], t = seconds from clip start).', {
  ...seqArg, track: z.number().int().min(1), clipIndex: z.number().int().optional(), at: z.number().optional(), db: z.number().optional(),
  keyframes: z.array(z.object({ t: z.number(), db: z.number() })).optional() }, (a) => call('set_volume', a));

// ---------- effects / transitions / markers ----------
tool('list_effects', 'List Premiere video/audio effects and transitions by name (use filter).', { filter: z.string().optional() }, (a) => call('list_effects', a));
tool('apply_effect', 'Add a Premiere effect by its name (e.g. "Gaussian Blur", "Lumetri Color", "Ultra Key", "Crop").', {
  ...seqArg, ...clipSel, effect: z.string() }, (a) => call('apply_effect', a));
tool('get_effect_params', 'List all effects on a clip with their parameter names and values.', { ...seqArg, ...clipSel }, (a) => call('get_effect_params', a));
tool('set_effect_param', 'Set (or keyframe) a parameter of an effect on a clip.', {
  ...seqArg, ...clipSel, effect: z.string(), param: z.string(), value: z.any().optional(), keyframes: keys }, (a) => call('set_effect_param', a));
tool('add_transition', 'Add a transition (default Cross Dissolve / Constant Power) at the start or end of a clip.', {
  ...seqArg, ...clipSel, transition: z.string().optional(), where: z.enum(['start', 'end']).optional(), duration: z.number().optional() },
  (a) => call('add_transition', a));
tool('add_markers', 'Add sequence markers (notes for the edit: hooks, b-roll spots, best parts). color = 0-7.', {
  ...seqArg, markers: z.array(z.object({ at: z.number(), name: z.string().optional(), comment: z.string().optional(), duration: z.number().optional(), color: z.number().optional() })) },
  (a) => call('add_markers', a));
tool('get_markers', 'Read the sequence markers.', seqArg, (a) => call('get_markers', a));
tool('clear_markers', 'Delete all sequence markers.', seqArg, (a) => call('clear_markers', a));

// ---------- speech: transcribe, silence removal, best parts ----------
tool('transcribe_media', 'Transcribe a video/audio file locally (Whisper) with word timings. Returns the sentences with times and saves the words file (transcriptPath) for captions and selects. Takes about 0.2-1x the video length.', {
  path: z.string(), model: z.enum(['tiny', 'base', 'small', 'medium', 'large-v3']).optional().describe('default small'), language: z.string().optional() },
  async (a) => {
    const t = await M.transcribe(a.path, { model: a.model, language: a.language });
    return { transcriptPath: t.path, language: t.language, duration: t.duration, words: t.words.length,
      segments: t.segments.map((s) => `[${s.start.toFixed(2)}-${s.end.toFixed(2)}] ${s.text}`) };
  });
tool('find_silences', 'Analyse a file and report the speech ranges ffmpeg keeps and how much silence would be cut. Nothing changes in Premiere.', {
  path: z.string(), thresholdDb: z.number().optional().describe('quieter than this = silence, default -35'),
  minSilence: z.number().optional().describe('shortest pause to cut, seconds, default 0.45'), pad: z.number().optional().describe('breathing room kept around speech, default 0.12') },
  async (a) => { const r = await M.speechRanges(a.path, a); return { ...r, keep: r.keep.length > 60 ? `${r.keep.length} ranges` : r.keep }; });
tool('remove_silence', 'Build a NEW sequence from a recording with the silent pauses cut out (jump-cut edit). The original is untouched. Captions added later follow the cuts automatically.', {
  path: z.string().describe('the recording on disk'), name: z.string().optional(), thresholdDb: z.number().optional(), minSilence: z.number().optional(), pad: z.number().optional() },
  async (a) => {
    const r = await M.speechRanges(a.path, a);
    const name = a.name || `${path.basename(a.path, path.extname(a.path))} - no silence`;
    const res = await call('place_ranges', { path: a.path, ranges: r.keep, newSequence: name }, 600000);
    saveMap(res, a.path);
    return { sequence: res.sequence, pieces: res.pieces, before: r.duration, after: res.duration, removed: r.removedSeconds };
  });
tool('build_selects', 'Build a NEW sequence from chosen source ranges, in the order given: use it for "best parts", a hook-first reorder, or a short. Pick ranges from transcribe_media (word times).', {
  path: z.string(), name: z.string(), ranges: z.array(z.object({ start: z.number(), end: z.number(), label: z.string().optional() })),
  removeSilenceInside: z.boolean().optional().describe('also cut pauses inside each range') },
  async (a) => {
    let ranges = a.ranges;
    if (a.removeSilenceInside) {
      const sp = (await M.speechRanges(a.path)).keep;
      ranges = a.ranges.flatMap((r) => sp.filter((k) => k.end > r.start && k.start < r.end)
        .map((k) => ({ start: Math.max(k.start, r.start), end: Math.min(k.end, r.end), label: r.label })));
    }
    const res = await call('place_ranges', { path: a.path, ranges, newSequence: a.name }, 600000);
    saveMap(res, a.path);
    return { sequence: res.sequence, pieces: res.pieces, duration: res.duration, map: res.map };
  });

// ---------- captions ----------
tool('add_captions', 'Add a native Premiere caption track (editable, styleable in Premiere) from a transcript. Follows silence-removal/selects cuts automatically.', {
  ...seqArg, transcriptPath: z.string().optional(), words: z.array(z.object({ w: z.string(), s: z.number(), e: z.number() })).optional(),
  segments: z.array(z.object({ start: z.number(), end: z.number(), text: z.string() })).optional().describe('or ready caption lines'),
  maxWords: z.number().int().optional().describe('words per caption, default 4') },
  async (a) => {
    const seq = await activeSeqInfo(a.sequence);
    let segs = a.segments;
    if (!segs) segs = M.chunkWords(remapWords(loadWords(a), loadMap(seq.name)), a.maxWords || 4);
    const srt = M.writeSrt(segs, M.outFile(seq.name.replace(/[^\w-]+/g, '_') + '-captions', 'srt', path.join(M.OUT, 'captions')));
    const r = await call('add_captions_srt', { sequence: seq.name, srtPath: srt });
    return { ...r, captions: segs.length, srt };
  });
tool('add_styled_captions', 'CAPTIONS in the user\'s reference style (ref2): clean white sans, no box, soft shadow, lower-centre; each phrase is 1-2 lines that BUILD WORD BY WORD as they are spoken; highlightWords become an italic serif accent (pick 1 key phrase per sentence). Placed on the V7 CAPTIONS layer, one clip per word-step, named so they are easy to fix. Follows silence-removal/selects cuts.', {
  ...seqArg, transcriptPath: z.string().optional(), words: z.array(z.object({ w: z.string(), s: z.number(), e: z.number() })).optional(),
  highlightWords: z.array(z.string()).optional().describe('words/phrases shown in the accent italic, e.g. ["complete beginner\'s guide"]'),
  accent: z.string().optional().describe('accent colour, default theme accent'),
  maxWords: z.number().int().optional().describe('words per phrase, default 9 (2 lines)'), y: z.number().optional().describe('0-1, default 0.82'),
  size: z.number().optional().describe('text height 0-1 of frame, default 0.034'), track: z.number().int().optional().describe('default 7 (CAPTIONS layer)'),
  style: z.enum(['ref2', 'pill']).optional().describe('default ref2'),
  onlyRanges: z.array(z.array(z.number()).length(2)).optional().describe('captions ONLY inside these [from,to] ranges (main moments); default everywhere'),
  skipRanges: z.array(z.array(z.number()).length(2)).optional().describe('timeline [from,to] ranges with no captions (text b-roll already shows the words)'),
  transcriptOf: z.enum(['voice', 'video']).optional().describe('default: voice when add_voice was used (transcribe the CLEAN VOICE file so captions match it exactly)') },
  async (a) => {
    const seq = await activeSeqInfo(a.sequence);
    const smap = loadMap(seq.name);
    // a transcript of the CLEAN VOICE is in voice seconds: move it to video seconds with the same offset add_voice used
    const fromVoice = a.transcriptOf ? a.transcriptOf === 'voice' : !!smap?.voice;
    const shift = fromVoice && smap?.voice ? smap.voice.offset : 0;
    const words = remapWords(loadWords(a).map((w) => ({ ...w, s: w.s - shift, e: w.e - shift })), smap).map((w) => ({ ...w, w: String(w.w).trim() })).filter((w) => w.w);
    const skip = a.skipRanges || [];
    const only = a.onlyRanges;
    const kept = words.filter((w) => !skip.some(([f, t]) => w.s < t && w.e > f) && (!only || only.some(([f, t]) => w.s >= f - 0.05 && w.e <= t + 0.3)));
    const phrases = M.chunkWords(kept, a.maxWords || 9, 0.6).map((c) => ({ ...c, words: kept.filter((w) => w.s >= c.start - 1e-3 && w.e <= c.end + 1e-3) }));
    const hot = (a.highlightWords || []).map((h) => h.toLowerCase().split(/\s+/));
    const dir = M.ensureDir(path.join(M.OUT, 'captions', seq.name.replace(/[^\w-]+/g, '_') + '-' + Date.now()));
    const specs = [], items = [];
    phrases.forEach((p, pi) => {
      const ws = p.words.map((w) => w.w);
      const mark = ws.map(() => false);   // which words are accent
      for (const h of hot) for (let i = 0; i + h.length <= ws.length; i++)
        if (h.every((hw, k) => ws[i + k].toLowerCase().replace(/[^\w']/g, '') === hw.replace(/[^\w']/g, ''))) for (let k = 0; k < h.length; k++) mark[i + k] = true;
      const tok = ws.map((w, i) => (mark[i] ? `*${w}*` : w));
      const cut = ws.length > 5 ? Math.ceil(ws.length / 2) : ws.length;   // two balanced lines
      const lines = [tok.slice(0, cut).join(' '), tok.slice(cut).join(' ')].filter(Boolean).map((l) => l.replace(/\* \*/g, ' '));
      const next = phrases[pi + 1];
      p.words.forEach((w, k) => {
        const out = path.join(dir, `p${String(pi).padStart(3, '0')}_${String(k).padStart(2, '0')}.png`);
        specs.push({ kind: a.style === 'pill' ? 'caption' : 'caption_ref2', W: seq.width, H: seq.height, lines, show: k + 1, text: tok.slice(0, k + 1).join(' '),
          y: a.y ?? 0.82, size: a.size, accent: a.accent, out });
        const end = k + 1 < p.words.length ? p.words[k + 1].s : Math.min(next ? next.start : p.end + 0.5, p.end + 0.5);
        items.push({ path: out, at: +w.s.toFixed(3), duration: +Math.max(0.06, end - w.s).toFixed(3), track: a.track || LAYER.CAPTIONS,
          name: `CAPTION ${String(pi + 1).padStart(3, '0')}.${k + 1} ${ws.slice(0, k + 1).join(' ').slice(-28)}` });
      });
    });
    if (!specs.length) return 'No words in the transcript for this sequence.';
    await M.themeGraphics(specs);
    const placed = await call('place_many', { sequence: seq.name, items, bin: 'Captions' }, 900000);
    return { phrases: phrases.length, clips: items.length, track: a.track || LAYER.CAPTIONS, failed: placed.filter((p) => p.error).slice(0, 5), folder: dir };
  });

// ---------- graphics ----------
tool('create_text_graphic', `Make a clean transparent title/graphic PNG (sized to the sequence) and optionally place it. Styles: ${M.STYLE_NAMES.join(', ')}. title+sub = name + role lower line; shock = big red serif word; label = yellow highlighter box; tag = small location tag bottom-left.`, {
  ...seqArg, text: z.string(), style: z.string().optional(), sub: z.string().optional().describe('smaller second line'),
  color: z.string().optional(), size: z.number().optional(), font: z.string().optional().describe('font file in C:/Windows/Fonts or full path'),
  x: z.number().optional(), y: z.number().optional().describe('0-1 of the frame'), align: z.enum(['left', 'center', 'right']).optional(),
  box: z.string().optional().describe('background box "000000@0.6"'),
  place: z.object({ at: z.number(), duration: z.number(), track: z.number().int().optional() }).optional() },
  async (a) => {
    let W = 1920, H = 1080, seqName = a.sequence;
    if (a.place) { const s = await activeSeqInfo(a.sequence); W = s.width; H = s.height; seqName = s.name; }
    const png = await M.textGraphic({ ...a, width: W, height: H });
    if (!a.place) return { png };
    const r = await call('place_many', { sequence: seqName, bin: 'Graphics', items: [{ path: png, at: a.place.at, duration: a.place.duration, track: a.place.track || LAYER.GRAPHICS, name: `TITLE ${a.text.slice(0, 30)}` }] });
    return { png, placed: r[0] };
  });
tool('list_mogrts', "List Motion Graphics Templates (.mogrt) that ship with Premiere and in the user's Essential Graphics folders.", { filter: z.string().optional() }, (a) => {
  const roots = [premiereDir() && path.join(premiereDir(), 'Essential Graphics'),
    path.join(process.env.APPDATA || '', 'Adobe', 'Common', 'Motion Graphics Templates')].filter((d) => d && fs.existsSync(d));
  const out = [];
  const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else if (f.name.endsWith('.mogrt')) out.push(p); } };
  roots.forEach(walk);
  const f = (a.filter || '').toLowerCase();
  return out.filter((p) => !f || p.toLowerCase().includes(f));
});
tool('add_mogrt', 'Place a Motion Graphics Template (.mogrt: titles, lower thirds, social, credits) and set its text. texts fill the text fields in order; params sets fields by name. Returns its editable fields.', {
  ...seqArg, mogrtPath: z.string(), at: z.number(), duration: z.number().optional(), track: z.number().int().optional().describe('video track, default 2'),
  texts: z.array(z.string()).optional(), params: z.record(z.any()).optional() }, (a) => call('add_mogrt', a));
tool('set_mogrt_text', 'Change the text/fields of a MOGRT already on the timeline.', {
  ...seqArg, ...clipSel, texts: z.array(z.string()).optional(), params: z.record(z.any()).optional() }, (a) => call('set_mogrt', a));

// ---------- house style: main-reference design on the dark theme ----------
async function placeOn(sequence, bin, items) { return call('place_many', { sequence, bin, items }, 600000); }
const placeArg = z.object({ at: z.number(), duration: z.number(), track: z.number().int().optional() }).optional();

tool('make_layout', 'HOUSE STYLE shot (main reference): "split" = screen recording in a big rounded panel with a slow zoom + your camera in a rounded card on the right; "screen" = screen alone in a rounded panel; "cam" = camera in a rounded panel on the dark canvas. Silent clip, put it on V2 above the talking head, at the same time as the camera so lips stay in sync (camIn = the camera source second shown at "at").', {
  ...seqArg, layout: z.enum(['split', 'screen', 'cam']).optional(), screen: z.string().optional(), screenIn: z.number().optional(),
  cam: z.string().optional(), camIn: z.number().optional(), duration: z.number(), zoom: z.number().optional().describe('zoom speed per second, default 0.025; 0 = still'),
  focus: z.array(z.number()).length(2).optional().describe('where the zoom goes [x,y] 0-1 of the screen'), accent: z.string().optional(),
  place: placeArg },
  async (a) => {
    const s = await activeSeqInfo(a.sequence);
    const out = await M.makeLayout({ ...a, W: s.width, H: s.height, fps: Math.round(s.fps) });
    if (!a.place) return { out };
    return { out, placed: (await placeOn(s.name, 'Layouts', [{ path: out, at: a.place.at, duration: a.place.duration || a.duration, track: a.place.track || LAYER.BROLL, name: `LAYOUT ${a.layout || 'split'}` }]))[0] };
  });
tool('theme_graphic', 'Theme graphic in the active theme (ULTRA_THEME, default neutral; accent from the theme, change with accent "#hex"). kinds: chapter {num,title}, name_tag {name,header?}, list {title, items:[{text, sub? ("*word*" = accent)}]} builds one line per step, highlight {rect:[x,y,w,h] 0-1, label?} outline around something on screen, keyword {text,x?,y?} big word beside the face, caption {text, "*words*" = italic accent}, label {text,x,y}, background. bg:true puts it on the dark canvas (full screen card).', {
  ...seqArg, kind: z.enum(['chapter', 'name_tag', 'list', 'highlight', 'keyword', 'caption', 'label', 'background']),
  args: z.record(z.any()).describe('the fields for that kind'), place: placeArg },
  async (a) => {
    const s = a.place ? await activeSeqInfo(a.sequence) : { width: 1920, height: 1080, name: a.sequence };
    const pngs = await M.themeGraphics({ kind: a.kind, W: s.width, H: s.height, ...a.args });
    if (!a.place) return { pngs };
    // a list builds up: its steps share the duration (step 0 = empty frame is skipped)
    const steps = a.kind === 'list' ? pngs.slice(1) : pngs;
    const each = a.place.duration / steps.length;
    const defTrack = ['highlight', 'focus'].includes(a.kind) ? LAYER.FOCUS : a.kind === 'caption' ? LAYER.CAPTIONS : LAYER.GRAPHICS;
    const label = String(a.args.title || a.args.text || a.args.value || a.args.name || a.args.label || '').slice(0, 30);
    const items = steps.map((p, i) => ({ path: p, at: +(a.place.at + i * each).toFixed(3), duration: +each.toFixed(3), track: a.place.track || defTrack, name: `${a.kind.toUpperCase()}${steps.length > 1 ? ' ' + (i + 1) : ''} ${label}` }));
    return { pngs: steps, placed: await placeOn(s.name, 'Graphics', items) };
  });

// ---------- the user's own Premiere presets ----------
tool('list_presets', "List the user's own Premiere effect presets (Effects panel > Presets) with the effects inside. Prefer these over building effects by hand.", {
  filter: z.string().optional() },
  async (a) => {
    const f = (a.filter || '').toLowerCase();
    return (await M.loadPresets()).filter((p) => !p.name.endsWith('_1') && (!f || (p.folder + ' ' + p.name).toLowerCase().includes(f)))
      .map((p) => `${p.folder ? p.folder + ' / ' : ''}${p.name}: ${p.effects.map((e) => e.displayName + (e.params.some((x) => x.keys) ? ' (animated)' : '')).join(' + ')}`);
  });
async function clipAt(sequence, kind, trackNo, sel) {
  const s = await activeSeqInfo(sequence);
  const tr = (kind === 'audio' ? s.audio : s.video)[(trackNo || 1) - 1];
  if (!tr) throw new Error('No such track');
  const c = sel.clipIndex !== undefined && sel.clipIndex !== null ? tr.clips[sel.clipIndex]
    : sel.at !== undefined && sel.at !== null ? tr.clips.find((x) => sel.at >= x.start - 1e-3 && sel.at < x.end) : tr.clips[0];
  if (!c) throw new Error('Clip not found on that track');
  return { seq: s, clip: c, index: tr.clips.indexOf(c) };
}
async function applyPresetTo(sequence, kind, track, index, preset, clipDur, tweak) {
  const effects = preset.effects.map((e) => M.fitEffect(e, clipDur)).map((e) => (tweak ? tweak(e) : e));
  return call('apply_effects', { sequence, kind, track, clipIndex: index, effects }, 300000);
}
tool('apply_preset', "Apply one of the user's Premiere presets (by name, e.g. '08. Slow Zoom in', 'round crop universal video', '05. Instant Scale (120)', 'text crop flow') to a clip. Keyframes are fitted to the clip like Premiere does.", {
  ...seqArg, ...clipSel, preset: z.string() },
  async (a) => {
    const p = await M.findPreset(a.preset);
    const { seq, clip, index } = await clipAt(a.sequence, a.kind, a.track, a);
    const r = await applyPresetTo(seq.name, a.kind || 'video', a.track || 1, index, p, clip.duration);
    return { preset: p.name, ...r };
  });
tool('screen_zoom', "The user's 2-layer SCREEN ZOOM (their presets '1st Layer: BLUR + EXPOSURE' + '2nd Layer CROP + TRANSFORM + SHADOW'): the screen recording behind blurs and darkens while a copy above crops to a region, scales up to centre it and gets a drop shadow, then everything eases back. Give the region of the screen to pop out [x,y,w,h] 0-1 (use render_frame to find it). from/to (timeline seconds) cut that part out first; without them the whole clip is used.", {
  ...seqArg, track: z.number().int().optional().describe('video track of the screen recording, default 1'), clipIndex: z.number().int().optional(), at: z.number().optional(),
  region: z.array(z.number()).length(4), from: z.number().optional(), to: z.number().optional(),
  maxScale: z.number().optional().describe('cap, default 200 (%)') },
  async (a) => {
    const track = a.track || 1;
    if (a.from !== undefined && a.to !== undefined) await call('razor', { sequence: a.sequence, times: [a.from, a.to], track });
    const target = a.from !== undefined ? { at: a.from + 0.01 } : { clipIndex: a.clipIndex, at: a.at };
    const { seq, clip, index } = await clipAt(a.sequence, 'video', track, target);
    const L1 = await M.findPreset('1st Layer: BLUR + EXPOSURE'), L2 = await M.findPreset('2nd Layer CROP + TRANSFORM + SHADOW');
    const bottom = await applyPresetTo(seq.name, 'video', track, index, L1, clip.duration);
    const dup = await call('duplicate_above', { sequence: seq.name, track, clipIndex: index });
    const [x, y, w, h] = a.region;
    const s = Math.min((a.maxScale || 200) / 100, 0.86 / w, 0.86 / h);
    const cx = x + w / 2, cy = y + h / 2, pos = [0.5 - s * (cx - 0.5), 0.5 - s * (cy - 0.5)];
    const crop = { Left: x * 100, Top: y * 100, Right: (1 - x - w) * 100, Bottom: (1 - y - h) * 100 };
    const tweak = (e) => ({ ...e, params: e.params.map((p) => {
      if (e.matchName === 'AE.ADBE AECrop' && crop[p.name] !== undefined) return { ...p, value: +crop[p.name].toFixed(3), keys: undefined };
      if (e.matchName === 'AE.ADBE Geometry2' && p.keys && (p.name === 'Scale Height' || p.name === 'Position')) {
        const hold = p.name === 'Scale Height' ? s * 100 : pos, rest = p.name === 'Scale Height' ? 100 : [0.5, 0.5];
        return { ...p, keys: p.keys.map(([t], i, arr) => [t, i === 0 || i === arr.length - 1 ? rest : hold]) };
      }
      return p;
    }) });
    const top = await applyPresetTo(seq.name, 'video', dup.track, dup.clipIndex, L2, clip.duration, tweak);
    return { range: [clip.start, clip.end], scale: Math.round(s * 100), position: pos.map((v) => +v.toFixed(3)), bottom: bottom.effects, top: { track: dup.track, effects: top.effects } };
  });

// ---------- layers: every kind of element on its own named track ----------
const LAYER = { MAIN: 1, BACKDROP: 2, ZOOM: 3, FACE: 4, BROLL: 5, FOCUS: 6, GRAPHICS: 7, CAPTIONS: 8, LABELS: 9, CAM: 10, VOICE: 1, MUSIC: 2, SFX: 3 };
const LAYER_NAMES = { video: ['MAIN', 'BACKDROP', 'ZOOM', 'FACE', 'B-ROLL', 'SPOTLIGHT', 'GRAPHICS', 'CAPTIONS', 'LABELS', 'CAM'], audio: ['VOICE', 'MUSIC', 'SFX'] };
async function setupLayers(sequence, mainName) { return call('setup_layers', { sequence, ...LAYER_NAMES, mainName }); }
tool('setup_layers', 'Name the tracks as layers so each kind of element can be switched off / fixed on its own: V1 MAIN (the cut video, no effects), V2 BACKDROP, V3 ZOOM, V4 FACE (full-screen face), V5 B-ROLL, V6 SPOTLIGHT (highlight crops), V7 GRAPHICS (outlines, cards, stats, callouts), V8 CAPTIONS, V9 LABELS, V10 CAM (face bubble); A1 VOICE, A2 MUSIC, A3 SFX. Tools put things on these by default.', seqArg,
  (a) => setupLayers(a.sequence, 'MAIN'));

// ---------- exact voice sync (never guess) ----------
async function measureOffset(ref, other, refStream = 0, otherStream = 0) {
  const { stdout } = await M.run(VENV_PY, [path.join(SCRIPTS, 'sync.py'), ref, other, '--ref-stream', String(refStream), '--other-stream', String(otherStream), '--max', '600'], { timeout: 20 * 60 * 1000 });
  return JSON.parse(stdout);
}
tool('sync_audio', 'Measure the EXACT offset between two recordings of the same speech (clean voice vs OBS mic track, mic file vs video file) by matching their sound. offset = seconds the second file starts after the first. Confidence below 0.3 = they do not share audio (do not use).', {
  reference: z.string(), other: z.string(), referenceStream: z.number().int().optional().describe('audio stream index in the reference (OBS mic is often 0)'), otherStream: z.number().int().optional() },
  (a) => measureOffset(a.reference, a.other, a.referenceStream || 0, a.otherStream || 0));
tool('add_voice', "Put the CLEAN VOICE on A1 VOICE, exactly in sync with the MAIN video, cut into the same pieces as MAIN (follows silence removal / selects). Removes MAIN's own audio first (unless keepOriginal). Sync: offset (voice second = video second + offset) if known, otherwise measured from the sound against `reference` (a recording that shares the voice, e.g. the OBS mic file) with refOffset = how many seconds the reference started BEFORE the video (from the recording times). Refuses when the measured match is weak.", {
  ...seqArg, voicePath: z.string(), offset: z.number().optional(),
  reference: z.string().optional().describe('recording with the same speech; default the MAIN video itself'), referenceStream: z.number().int().optional(),
  refOffset: z.number().optional().describe('seconds the reference started before the MAIN video (0 if it is the video file)'),
  keepOriginal: z.boolean().optional(), db: z.number().optional().describe('voice level, default 0 dB') },
  async (a) => {
    const s = await activeSeqInfo(a.sequence);
    const map = loadMap(s.name);
    if (!map) throw new Error('This sequence was not built by build_selects/remove_silence, so the MAIN pieces are unknown. Build it with those first.');
    let offset = a.offset, how = 'given';
    if (offset === undefined) {
      const ref = a.reference || map.source;
      const m = await measureOffset(ref, a.voicePath, a.referenceStream || 0, 0);
      if (m.confidence < 0.3) throw new Error(`Could not match the voice to ${path.basename(ref)} (confidence ${m.confidence}). Give the offset, or a reference recording that has the same speech.`);
      // voice_time = ref_time - m.offset ; ref_time = video_time + refOffset
      offset = +((a.refOffset || 0) - m.offset).toFixed(3); how = `measured vs ${path.basename(ref)} (confidence ${m.confidence})`;
    }
    if (!a.keepOriginal) {   // MAIN's own audio would double the voice (or be silent): take it out
      for (const t of [...s.audio].reverse()) for (let i = t.clips.length - 1; i >= 0; i--)
        if (t.clips[i].mediaPath && path.normalize(t.clips[i].mediaPath).toLowerCase() === path.normalize(map.source).toLowerCase())
          await call('remove_clip', { sequence: s.name, kind: 'audio', track: t.track, clipIndex: i });
    }
    const dur = (await M.probe(a.voicePath)).duration;
    const ranges = map.map.map((p) => ({ start: +(p.srcStart + offset).toFixed(3), end: +(p.srcEnd + offset).toFixed(3) }));
    const bad = ranges.filter((r) => r.start < 0 || r.end > dur + 0.05);
    if (bad.length) throw new Error(`The voice file does not cover ${bad.length} piece(s) of the video at offset ${offset}s (voice is ${dur.toFixed(1)}s). Check the offset/reference.`);
    const res = await call('place_ranges', { sequence: s.name, path: a.voicePath, ranges, startAt: map.map[0].seqStart, audioOnly: true, track: LAYER.VOICE, bin: 'Voice' }, 600000);
    if (a.db !== undefined) {
      const q = await activeSeqInfo(s.name);
      for (let i = 0; i < q.audio[LAYER.VOICE - 1].clips.length; i++) await call('set_volume', { sequence: s.name, track: LAYER.VOICE, clipIndex: i, db: a.db }).catch(() => {});
    }
    const mp = loadMap(s.name); mp.voice = { path: a.voicePath, offset }; fs.writeFileSync(mapFile(s.name), JSON.stringify(mp, null, 1));
    await call('add_markers', { sequence: s.name, markers: [{ at: 0, color: 5, name: 'VOICE SYNC', comment: `${path.basename(a.voicePath)} on A${LAYER.VOICE}: voice second = video second + ${offset}s (${how}). ${res.pieces} pieces.` }] }).catch(() => {});
    return { offset, how, pieces: res.pieces, track: `A${LAYER.VOICE} VOICE` };
  });

// ---------- face camera as MAIN + screen sections + camera bubble ----------
/** screen second = MAIN source second + screenOffset. Measured through the OBS file (it has your voice AND the screen picture). */
async function screenOffsetVia(mainSrc, obs, screen) {
  const m1 = await measureOffset(mainSrc, obs);                  // sound: obs starts m1 after MAIN source
  if (m1.confidence < 0.3) throw new Error(`Could not match the OBS file's sound to the MAIN video (confidence ${m1.confidence}).`);
  const { stdout } = await M.run(VENV_PY, [path.join(SCRIPTS, 'sync.py'), obs, screen, '--video', '--max', '120'], { timeout: 30 * 60 * 1000 });
  const m2 = JSON.parse(stdout);                                  // picture: screen starts m2 after obs
  if (m2.confidence < 0.3) throw new Error(`Could not match the OBS picture to the screen recording (confidence ${m2.confidence}).`);
  return { offset: +(-m1.offset - m2.offset).toFixed(3), how: `sound MAIN->OBS ${m1.offset}s (conf ${m1.confidence}), picture OBS->screen ${m2.offset}s (conf ${m2.confidence})` };
}
function mainSrcAt(map, t) {
  // a time exactly on a cut belongs to the piece that STARTS there
  const end = (m) => m.seqStart + (m.srcEnd - m.srcStart);
  const p = map.map.find((m) => t >= m.seqStart - 1e-3 && t < end(m) - 1e-3) || map.map.find((m) => Math.abs(t - end(m)) < 1e-3);
  if (!p) throw new Error(`No MAIN piece at ${t}s.`);
  return { piece: p, src: p.srcStart + (t - p.seqStart), pieceEnd: p.seqStart + (p.srcEnd - p.srcStart) };
}
async function camBubble(seqName, from, to, o = {}) {
  const s = await activeSeqInfo(seqName);
  const { index } = await clipAt(seqName, 'video', LAYER.MAIN, { at: from + 0.01 });
  const nn = String((s.video[LAYER.CAM - 1]?.clips.length || 0) + 1).padStart(2, '0');
  const cp = await call('copy_range', { sequence: seqName, track: LAYER.MAIN, clipIndex: index, from, to, toTrack: LAYER.CAM, name: `CAM ${nn}` });
  const side = o.corner || 'bottom-right', size = o.size || 0.26;          // size = card height, 0-1 of frame
  const crop = { matchName: 'AE.Impact_Crop_FX', displayName: 'Rounded Crop', params: [
    { name: 'Left', value: o.cropSides ?? 22 }, { name: 'Right', value: o.cropSides ?? 22 }, { name: 'Top', value: 4 }, { name: 'Bottom', value: 4 }, { name: 'Roundness', value: o.roundness ?? 18 }] };
  let shadow = [];
  try { shadow = (await M.findPreset('2nd Layer CROP + TRANSFORM + SHADOW')).effects.filter((e) => e.matchName === 'AE.ADBE Drop Shadow').map((e) => ({ ...e, params: e.params.map((p) => ({ ...p, keys: undefined })) })); } catch {}
  await call('apply_effects', { sequence: seqName, track: LAYER.CAM, clipIndex: cp.clipIndex, effects: [crop, ...shadow] }, 300000);
  const scale = size / 0.92, W = s.width, H = s.height, m = 0.035;
  const cw = W * (1 - 2 * (o.cropSides ?? 22) / 100) * scale, chh = H * 0.92 * scale;
  const x = side.includes('right') ? W - W * m - cw / 2 : W * m + cw / 2, y = side.includes('bottom') ? H - H * m * 1.6 - chh / 2 : H * m * 1.6 + chh / 2;
  await call('set_transform', { sequence: seqName, track: LAYER.CAM, clipIndex: cp.clipIndex, scale: +(scale * 100).toFixed(2), position: [x, y] });
  return `V${LAYER.CAM} CAM ${nn}`;
}
tool('cam_bubble', 'Your FACE camera as a small rounded card in a corner (copy of MAIN on V10 CAM, Rounded Crop + your drop shadow, Motion scale/position = drag it to move). Use over screen sections and b-roll.', {
  ...seqArg, from: z.number(), to: z.number(), corner: z.enum(['bottom-right', 'bottom-left', 'top-right', 'top-left']).optional(), size: z.number().optional().describe('height 0-1 of frame, default 0.26') },
  async (a) => ({ cam: await camBubble(a.sequence || (await activeSeqInfo()).name, a.from, a.to, a) }));
tool('screen_section', 'SCREEN PART of a face-camera video: lays the screen recording (exactly synced) on V3 over the face MAIN for from..to, scaled to fit, with the follow-zoom + rounded crop (screen_follow look), a dark BACKDROP on V2, optional highlights (editable, like add_highlight) and the face as a CAM bubble on V9. Sync: screenOffset (screen second = MAIN source second + offset) or obs = the OBS recording that has both your voice and the screen picture (measured: sound + picture).', {
  ...seqArg, screen: z.string(), from: z.number(), to: z.number(),
  screenOffset: z.number().optional(), obs: z.string().optional(),
  auto: z.boolean().optional(), points: z.array(z.object({ at: z.number(), x: z.number(), y: z.number(), zoom: z.number().optional(), move: z.number().optional() })).optional(),
  maxZoom: z.number().optional(), highlights: z.array(z.object({ at: z.number(), duration: z.number(), rect: z.array(z.number()).length(4), label: z.string().optional(), dim: z.boolean().optional(), outline: z.boolean().optional() })).optional(),
  cam: z.boolean().optional().describe('face bubble, default true'), camCorner: z.enum(['bottom-right', 'bottom-left', 'top-right', 'top-left']).optional() },
  async (a) => {
    const s = await activeSeqInfo(a.sequence); const map = loadMap(s.name);
    if (!map) throw new Error('Build the face MAIN with build_selects/remove_silence first.');
    await setupLayers(s.name);
    const at = mainSrcAt(map, a.from);
    if (a.to > at.pieceEnd + 1e-3) throw new Error(`from..to crosses a cut in MAIN at ${at.pieceEnd.toFixed(2)}s; split it into one screen_section per piece.`);
    let off = a.screenOffset, how = 'given';
    if (off === undefined) {
      const key = `${a.screen}|${a.obs}`;
      if (map.screens?.[key]) ({ offset: off, how } = map.screens[key]);
      else {
        if (!a.obs) throw new Error('Give screenOffset, or obs (the OBS recording with your voice + the screen picture) to measure it.');
        ({ offset: off, how } = await screenOffsetVia(map.source, a.obs, a.screen));
        map.screens = { ...(map.screens || {}), [key]: { offset: off, how } }; fs.writeFileSync(mapFile(s.name), JSON.stringify(map, null, 1));
      }
    }
    const info = await M.probe(a.screen);
    const srcIn = +(at.src + off).toFixed(3), srcOut = +(srcIn + (a.to - a.from)).toFixed(3);
    if (srcIn < 0 || srcOut > info.duration + 0.05) throw new Error(`The screen recording does not cover ${srcIn.toFixed(2)}-${srcOut.toFixed(2)}s (it is ${info.duration.toFixed(1)}s).`);
    const nn = String((s.video[LAYER.ZOOM - 1]?.clips.length || 0) + 1).padStart(2, '0');
    const [bg] = await M.themeGraphics({ kind: 'background', W: s.width, H: s.height });
    await call('place_many', { sequence: s.name, bin: 'Layers', items: [{ path: bg, at: a.from, duration: a.to - a.from, track: LAYER.BACKDROP, name: `BACKDROP ${nn}` }] });
    const pl = await call('place_video', { sequence: s.name, path: a.screen, srcIn, srcOut, at: a.from, toTrack: LAYER.ZOOM, name: `ZOOM ${nn}`, fit: true, width: info.video.width, height: info.video.height, bin: 'Screens' });
    let pts;
    if (a.points && a.points.length) pts = a.points.map((p) => ({ t: p.at - a.from, x: p.x, y: p.y, zoom: p.zoom ?? 1.5, move: p.move }));
    else pts = JSON.parse((await M.run(VENV_PY, [path.join(SCRIPTS, 'follow.py'), a.screen, String(srcIn), String(srcOut), String(a.maxZoom || 1.8)], { timeout: 30 * 60 * 1000 })).stdout).points;
    const dur = a.to - a.from, cam = cameraKeys(pts, dur, 0.8);
    const transform = { matchName: 'AE.ADBE Geometry', displayName: 'Transform', params: [{ name: 'Uniform Scale', value: true }, { name: 'Scale Height', keys: cam.scale }, { name: 'Position', keys: cam.pos },
      { name: 'Use Composition’s Shutter Angle', value: false }, { name: "Use Composition's Shutter Angle", value: false }, { name: 'Shutter Angle', value: 180 }] };
    const roundFx = (await M.findPreset('round crop universal video')).effects.map((e) => M.fitEffect(e, dur));
    const fx = await call('apply_effects', { sequence: s.name, track: LAYER.ZOOM, clipIndex: pl.clipIndex, effects: [transform, ...roundFx] }, 600000);
    saveCam(s.name, `ZOOM ${nn}`, { clipStart: a.from, clipEnd: a.to, inPoint: srcIn, mediaPath: a.screen, track: LAYER.ZOOM, cam, roundFx, fit: pl.fit });
    const hl = [];
    for (const [i, h] of (a.highlights || []).entries()) hl.push(await addHighlight(s.name, `ZOOM ${nn}`, h, `${nn}.${i + 1}`));
    const camName = a.cam === false ? null : await camBubble(s.name, a.from, a.to, { corner: a.camCorner });
    await call('add_markers', { sequence: s.name, markers: [{ at: a.from, duration: dur, color: 2, name: `SCREEN ${nn}`, comment: `screen ${path.basename(a.screen)} ${srcIn}-${srcOut}s on V${LAYER.ZOOM} (sync ${off}s: ${how})${camName ? '; face bubble ' + camName : ''}` }] }).catch(() => {});
    return { zoom: `V${LAYER.ZOOM} ZOOM ${nn}`, screenRange: [srcIn, srcOut], sync: { offset: off, how }, fit: pl.fit, moves: pts.length - 1, effects: fx.effects.map((e) => e.error || e.effect), highlights: hl, cam: camName };
  });

// face camera from its OWN file (when MAIN is the screen): full-screen talking head (V4 FACE) or corner bubble (V10 CAM)
tool('face_layer', 'Put your FACE camera over the MAIN video, exactly synced: mode "full" = full-screen talking head on V4 FACE (fit + slow punch-in), "bubble" = rounded corner card on V10 CAM (drag to move). faceOffset = face second = MAIN source second + offset (measure with sync_audio against the OBS recording).', {
  ...seqArg, face: z.string(), faceOffset: z.number(), from: z.number(), to: z.number(), mode: z.enum(['full', 'bubble']).optional(),
  punchIn: z.number().optional().describe('full mode: end scale factor, default 1.08 (0 = none)'), corner: z.enum(['bottom-right', 'bottom-left', 'top-right', 'top-left']).optional(), size: z.number().optional() },
  async (a) => {
    const s = await activeSeqInfo(a.sequence); const map = loadMap(s.name);
    if (!map) throw new Error('Build MAIN with build_selects/remove_silence first.');
    await setupLayers(s.name);
    const at = mainSrcAt(map, a.from);
    if (a.to > at.pieceEnd + 1e-3) throw new Error(`from..to crosses a MAIN cut at ${at.pieceEnd.toFixed(2)}s; one call per piece.`);
    const info = await M.probe(a.face);
    const srcIn = +(at.src + a.faceOffset).toFixed(3), srcOut = +(srcIn + a.to - a.from).toFixed(3);
    if (srcIn < 0 || srcOut > info.duration + 0.05) throw new Error(`The face file does not cover ${srcIn.toFixed(2)}-${srcOut.toFixed(2)}s (it is ${info.duration.toFixed(1)}s long).`);
    const mode = a.mode || 'full', track = mode === 'full' ? LAYER.FACE : LAYER.CAM;
    const nn = String((s.video[track - 1]?.clips.length || 0) + 1).padStart(2, '0');
    const pl = await call('place_video', { sequence: s.name, path: a.face, srcIn, srcOut, at: a.from, toTrack: track, name: `${mode === 'full' ? 'FACE' : 'CAM'} ${nn}`, fit: true, width: info.video.width, height: info.video.height, bin: 'Face' });
    if (mode === 'full') {
      const k = pl.fit * 100, end = a.punchIn === 0 ? 1 : (a.punchIn || 1.08);
      // cover the frame (no bars) and push in slowly
      const cover = Math.max(s.width / info.video.width, s.height / info.video.height) * 100;
      await call('set_transform', { sequence: s.name, track, clipIndex: pl.clipIndex, keyframes: { scale: [{ t: 0, value: cover }, { t: a.to - a.from, value: +(cover * end).toFixed(2) }] } });
      return { face: `V${track} FACE ${nn}`, src: [srcIn, srcOut], scale: [Math.round(cover), Math.round(cover * end)] };
    }
    const crop = { matchName: 'AE.Impact_Crop_FX', displayName: 'Rounded Crop', params: [{ name: 'Left', value: 22 }, { name: 'Right', value: 22 }, { name: 'Top', value: 4 }, { name: 'Bottom', value: 4 }, { name: 'Roundness', value: 18 }] };
    let shadow = [];
    try { shadow = (await M.findPreset('2nd Layer CROP + TRANSFORM + SHADOW')).effects.filter((e) => e.matchName === 'AE.ADBE Drop Shadow').map((e) => ({ ...e, params: e.params.map((p) => ({ ...p, keys: undefined })) })); } catch {}
    await call('apply_effects', { sequence: s.name, track, clipIndex: pl.clipIndex, effects: [crop, ...shadow] }, 300000);
    const size = a.size || 0.3, sc = size / 0.92 * (s.height / info.video.height), W = s.width, H = s.height, m = 0.035;
    const cw = info.video.width * 0.56 * sc, ch = info.video.height * 0.92 * sc, side = a.corner || 'bottom-right';
    const x = side.includes('right') ? W - W * m - cw / 2 : W * m + cw / 2, y = side.includes('bottom') ? H - H * m * 1.6 - ch / 2 : H * m * 1.6 + ch / 2;
    await call('set_transform', { sequence: s.name, track, clipIndex: pl.clipIndex, scale: +(sc * 100).toFixed(2), position: [x, y] });
    return { cam: `V${track} CAM ${nn}`, src: [srcIn, srcOut] };
  });

// ---------- relatable stock b-roll (real footage of what is being said) ----------
const STOCK = path.join(M.OUT, 'stock');
const stockFile = (q) => path.join(STOCK, String(q).toLowerCase().replace(/[^\w]+/g, '_').replace(/^_|_$/g, '') + '.json');
tool('find_broll', 'Find REAL, relatable stock footage for what is being said ("doing laundry", "walking around town", "watching youtube on phone") from free libraries (Mixkit, Wikimedia; Pexels too if PEXELS_API_KEY is set). Returns the candidates AND a numbered thumbnail sheet: LOOK at it and pick the clip that matches the line, then use_broll. Prefer real footage over text b-roll for everyday actions.', {
  query: z.string().describe('what the shot should show, plain words') },
  async (a) => {
    const out = stockFile(a.query);
    await M.run(VENV_PY, [path.join(SCRIPTS, 'stock.py'), 'search', a.query, out, '--limit', '8'], { timeout: 10 * 60 * 1000 });
    const d = JSON.parse(fs.readFileSync(out, 'utf8'));
    const list = d.candidates.map((c, i) => `${i}: ${c.title} [${c.source}${c.duration ? ', ' + c.duration + 's' : ''}]`).join('\n');
    const content = [{ type: 'text', text: d.candidates.length ? `${a.query}:\n${list}` : `No stock found for "${a.query}". Try simpler words.` }];
    if (d.sheet && fs.existsSync(d.sheet)) content.push({ type: 'image', data: fs.readFileSync(d.sheet).toString('base64'), mimeType: 'image/jpeg' });
    return { content };
  });
tool('use_broll', 'Download a stock clip found by find_broll and put it on the V5 B-ROLL layer: style "framed" (ref 1 look: glowing frame on the dark grid, slow push) or "full" (full screen, slow push-in). Keeps a credit line when the licence needs one (CREDITS.txt next to the sequence files).', {
  ...seqArg, query: z.string(), pick: z.number().int(), at: z.number(), duration: z.number(),
  style: z.enum(['framed', 'full']).optional().describe('default framed'), clipStart: z.number().optional().describe('second inside the stock clip to start from, default 1'),
  tag: z.string().optional().describe('small label on the frame (framed style)') },
  async (a) => {
    const d = JSON.parse(fs.readFileSync(stockFile(a.query), 'utf8'));
    const c = d.candidates[a.pick]; if (!c) throw new Error(`No candidate ${a.pick} for "${a.query}" (run find_broll).`);
    const file = path.join(STOCK, 'clips', `${c.source}-${c.id}${path.extname(new URL(c.url).pathname) || '.mp4'}`);
    if (!fs.existsSync(file)) await M.run(VENV_PY, [path.join(SCRIPTS, 'stock.py'), 'get', c.url, file], { timeout: 10 * 60 * 1000 });
    const info = await M.probe(file);
    const startIn = Math.min(a.clipStart ?? 1, Math.max(0, info.duration - a.duration - 0.05));
    if (info.duration < a.duration + startIn - 0.05) throw new Error(`That clip is only ${info.duration.toFixed(1)}s; pick another or shorten the shot.`);
    const s = await activeSeqInfo(a.sequence); await setupLayers(s.name);
    const name = `BROLL ${c.title.slice(0, 28)}`;
    let placed;
    if ((a.style || 'framed') === 'framed') {
      const out = M.outFile('broll-stock', 'mp4', path.join(M.OUT, 'broll'));
      const spec = M.outFile('broll-spec', 'json', path.join(M.OUT, 'broll'));
      fs.writeFileSync(spec, JSON.stringify({ scene: 'framed_clip', video: file, in: startIn, tag: a.tag, out, W: s.width, H: s.height, fps: Math.round(s.fps), duration: a.duration }));
      await M.run(VENV_PY, [path.join(SCRIPTS, 'broll.py'), spec], { timeout: 20 * 60 * 1000 }); fs.unlinkSync(spec);
      placed = (await call('place_many', { sequence: s.name, bin: 'B-roll', items: [{ path: out, at: a.at, duration: a.duration, track: LAYER.BROLL, name }] }))[0];
    } else {
      const pl = await call('place_video', { sequence: s.name, path: file, srcIn: startIn, srcOut: startIn + a.duration, at: a.at, toTrack: LAYER.BROLL, name, bin: 'B-roll' });
      const cover = Math.max(s.width / info.video.width, s.height / info.video.height) * 100;
      await call('set_transform', { sequence: s.name, track: LAYER.BROLL, clipIndex: pl.clipIndex, keyframes: { scale: [{ t: 0, value: cover }, { t: a.duration, value: +(cover * 1.06).toFixed(2) }] } });
      placed = pl;
    }
    if (!/no attribution/i.test(c.license)) {
      fs.appendFileSync(path.join(MAPS, `${s.name.replace(/[^\w.-]+/g, '_')}__CREDITS.txt`), `${c.title} - ${c.license} - ${c.page}\n`);
    }
    return { name, style: a.style || 'framed', source: c.source, license: c.license, placed };
  });

// ---------- editable highlights ----------
// A highlight is NOT one baked image. It is: SPOTLIGHT (copy of the screen on V5, Crop to the spot = edit
// Left/Top/Right/Bottom or drag the handles) + DIM (Opacity dip on the ZOOM clip) + OUTLINE and LABEL (small images on V6, drag them).
const camFile = (seqName, zoomName) => path.join(MAPS, `${String(seqName).replace(/[^\w.-]+/g, '_')}__${zoomName.replace(/\s+/g, '_')}.json`);
function saveCam(seqName, zoomName, data) { fs.writeFileSync(camFile(seqName, zoomName), JSON.stringify(data)); }
function loadCam(seqName, zoomName) { try { return JSON.parse(fs.readFileSync(camFile(seqName, zoomName), 'utf8')); } catch { return null; } }
function camAt(cam, t) {   // camera (zoom, position) at t seconds from the zoom clip start
  const pick = (keys) => { let v = keys[0][1]; for (const [kt, kv] of keys) { if (kt <= t + 1e-4) v = kv; else break; } return v; };
  return { z: pick(cam.scale) / 100, pos: pick(cam.pos) };
}
async function addHighlight(seqName, zoomName, h, tag) {
  const zc = loadCam(seqName, zoomName);
  if (!zc) throw new Error(`No camera data for ${zoomName}; run screen_follow first.`);
  const s = await activeSeqInfo(seqName);
  const zt = s.video[zc.track - 1], zi = zt ? zt.clips.findIndex((c) => Math.abs(c.start - zc.clipStart) < 0.02) : -1;
  if (zi < 0) throw new Error(`${zoomName} is not on V${zc.track} any more.`);
  // a nested clip is the size of the sequence; a file is its own size
  const [cw, ch] = zc.size || await M.probe(zc.mediaPath).then((i) => [i.video.width, i.video.height]);
  const [x, y, w, hh] = h.rect, from = h.at, to = h.at + h.duration, off = from - zc.clipStart;
  const out = { name: `HIGHLIGHT ${tag}${h.label ? ' ' + h.label : ''}`, parts: [] };
  // SPOTLIGHT: the spot itself, bright, on V5 (Rounded Crop first so the crop sticks to the UI, then the same camera moves)
  if (h.dim !== false) {
    const sp = await call('copy_range', { sequence: seqName, track: zc.track, clipIndex: zi, from, to, toTrack: LAYER.FOCUS, name: `SPOTLIGHT ${tag}${h.label ? ' ' + h.label : ''}` });
    const shift = (keys) => { const at0 = keys.filter(([t]) => t <= off).pop(); return [[0, (at0 || keys[0])[1]], ...keys.filter(([t]) => t > off && t <= off + h.duration).map(([t, v]) => [+(t - off).toFixed(4), v])]; };
    // Premiere's own Crop (keeps the full frame, so the zoom after it lines up exactly; has drag handles in the Program Monitor)
    const crop = { matchName: 'AE.ADBE AECrop', displayName: 'Crop', params: [
      { name: 'Left', value: +(x * 100).toFixed(2) }, { name: 'Top', value: +(y * 100).toFixed(2) },
      { name: 'Right', value: +((1 - x - w) * 100).toFixed(2) }, { name: 'Bottom', value: +((1 - y - hh) * 100).toFixed(2) }] };
    const tf = { matchName: 'AE.ADBE Geometry', displayName: 'Transform', params: [{ name: 'Uniform Scale', value: true },
      { name: 'Scale Height', keys: shift(zc.cam.scale) }, { name: 'Position', keys: shift(zc.cam.pos) }] };
    // the user's own drop shadow (from their '2nd Layer CROP + TRANSFORM + SHADOW' preset), fitted to this highlight
    let shadow = [];
    if (h.shadow !== false) {
      try { shadow = (await M.findPreset('2nd Layer CROP + TRANSFORM + SHADOW')).effects.filter((e) => e.matchName === 'AE.ADBE Drop Shadow').map((e) => M.fitEffect(e, h.duration)); }
      catch { shadow = [{ matchName: 'AE.ADBE Drop Shadow', displayName: 'Drop Shadow', params: [{ name: 'Opacity', value: 200 }, { name: 'Softness', value: 100 }, { name: 'Distance', value: 0 }] }]; }
    }
    const fx = await call('apply_effects', { sequence: seqName, track: LAYER.FOCUS, clipIndex: sp.clipIndex, effects: [crop, tf, ...(zc.roundFx || []), ...shadow] }, 300000);
    if (zc.fit && zc.fit !== 1) await call('set_transform', { sequence: seqName, track: LAYER.FOCUS, clipIndex: sp.clipIndex, scale: zc.fit * 100 });
    out.parts.push({ spotlight: `V${LAYER.FOCUS}`, fx: fx.effects.map((e) => e.error || e.effect) });
    // DIM: fade the ZOOM clip down under the spotlight (over the dark backdrop), then back up
    const r0 = Math.max(0, off - 0.2), r1 = off + h.duration;
    await call('set_transform', { sequence: seqName, track: zc.track, clipIndex: zi, keyframes: { opacity: [
      { t: r0, value: 100 }, { t: off + 0.05, value: h.dimTo ?? 45 }, { t: r1 - 0.05, value: h.dimTo ?? 45 }, { t: r1 + 0.2, value: 100 }] } });
    out.parts.push({ dim: `${zoomName} Opacity keyframes` });
  }
  // OUTLINE + LABEL: small separate images on V6 at the spot's place on screen (at the camera hold)
  const c = camAt(zc.cam, off + 0.01), sw = s.width, sh = s.height, kf = zc.fit || 1;
  const toFrame = (qx, qy) => [sw / 2 + (c.pos[0] + c.z * (qx - 0.5) - 0.5) * cw * kf, sh / 2 + (c.pos[1] + c.z * (qy - 0.5) - 0.5) * ch * kf];
  const [fx0, fy0] = toFrame(x, y), [fx1, fy1] = toFrame(x + w, y + hh);
  if (h.outline !== false) {
    const [png] = await M.themeGraphics({ kind: 'outline_box', w: fx1 - fx0, h: fy1 - fy0, H: sh, accent: h.accent });
    await call('place_many', { sequence: seqName, bin: 'Graphics', items: [{ path: png, at: from, duration: h.duration, track: LAYER.GRAPHICS, name: `OUTLINE ${tag}` }] });
    const { index } = await clipAt(seqName, 'video', LAYER.GRAPHICS, { at: from + 0.01 });
    await call('set_transform', { sequence: seqName, track: LAYER.GRAPHICS, clipIndex: index, position: [(fx0 + fx1) / 2, (fy0 + fy1) / 2] });
    out.parts.push({ outline: `V${LAYER.GRAPHICS} OUTLINE ${tag}` });
  }
  if (h.label) {
    const [png] = await M.themeGraphics({ kind: 'chip', text: h.label, H: sh, accent: h.accent });
    const sz = (await M.probe(png)).video;
    const track = LAYER.LABELS;   // own layer above the captions, so it never collides with the outline
    await call('place_many', { sequence: seqName, bin: 'Graphics', items: [{ path: png, at: from, duration: h.duration, track, name: `LABEL ${tag} ${h.label}` }] });
    const { index } = await clipAt(seqName, 'video', track, { at: from + 0.01 });
    await call('set_transform', { sequence: seqName, track, clipIndex: index, position: [fx0 + sz.width / 2, fy0 - sz.height / 2 - sh * 0.008] });
    out.parts.push({ label: `V${track} LABEL ${tag}` });
  }
  // a marker that says exactly where each part lives, so it is easy to check and fix
  await call('add_markers', { sequence: seqName, markers: [{ at: from, duration: h.duration, color: 4, name: out.name,
    comment: `Spot: V${LAYER.FOCUS} SPOTLIGHT ${tag} > Effect Controls > Crop (Left/Top/Right/Bottom, or drag its handles). Shadow: same clip > Drop Shadow. Outline: V${LAYER.GRAPHICS} OUTLINE ${tag} (drag / Scale). Label: V${LAYER.LABELS} LABEL ${tag} (drag). Dim: ${zoomName} > Opacity keyframes.` }] }).catch(() => {});
  return out;
}
tool('add_highlight', 'Add (or redo) a highlight on a ZOOM section, built from parts that are easy to fix in Premiere: SPOTLIGHT on V5 (Crop: change Left/Top/Right/Bottom or drag its handles; drop shadow from the users own preset), DIM = Opacity keyframes on the ZOOM clip, OUTLINE (V6) and LABEL (V8) = small images you can drag. rect = [x,y,w,h] 0-1 of the SCREEN RECORDING (use render_frame first to find it). To redo a wrong one, delete its SPOTLIGHT/OUTLINE/LABEL clips and the ZOOM opacity keys, then call this again.', {
  ...seqArg, zoom: z.string().optional().describe('which zoom section, e.g. "ZOOM 01" (default: the one under at)'),
  at: z.number(), duration: z.number(), rect: z.array(z.number()).length(4), label: z.string().optional(),
  dim: z.boolean().optional().describe('default true'), dimTo: z.number().optional().describe('ZOOM opacity while dimmed, default 45'),
  outline: z.boolean().optional().describe('default true'), shadow: z.boolean().optional().describe("default true (the user's drop shadow preset)"), accent: z.string().optional() },
  async (a) => {
    const s = await activeSeqInfo(a.sequence);
    let zoomName = a.zoom;
    if (!zoomName) {
      const zc = s.video[LAYER.ZOOM - 1]?.clips.find((c) => a.at >= c.start - 1e-3 && a.at < c.end);
      if (!zc) throw new Error('No ZOOM clip at that time.');
      zoomName = zc.name;
    }
    const n = (s.video[LAYER.FOCUS - 1]?.clips.length || 0) + 1;
    return addHighlight(s.name, zoomName, a, `${zoomName.replace(/\D/g, '') || '01'}.${n}`);
  });

// ---------- smooth follow-zoom for screen recordings ----------
const ease = (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
function camState(p) {
  const z = Math.max(1, p.zoom || 1), half = 0.5 / z;
  const fx = Math.min(1 - half, Math.max(half, p.x)), fy = Math.min(1 - half, Math.max(half, p.y));
  return { z, pos: [0.5 - z * (fx - 0.5), 0.5 - z * (fy - 0.5)] };
}
/** points [{t (s from clip start), x, y, zoom}] -> eased Transform keyframes (sampled so every move is smooth) */
function cameraKeys(points, clipDur, move = 0.8, step = 1 / 15) {
  const pts = [...points].sort((a, b) => a.t - b.t);
  if (!pts.length || pts[0].t > 0) pts.unshift({ t: 0, x: 0.5, y: 0.5, zoom: 1 });
  const scale = [], pos = [];
  let cur = camState(pts[0]);
  const push = (t, s) => { if (t < 0 || t > clipDur) return; scale.push([+t.toFixed(4), +(s.z * 100).toFixed(3)]); pos.push([+t.toFixed(4), s.pos.map((v) => +v.toFixed(5))]); };
  push(0, cur);
  for (let i = 1; i < pts.length; i++) {
    const nxt = camState(pts[i]);
    const t0 = Math.max(pts[i].t, scale.length ? scale[scale.length - 1][0] + step : 0);
    const d = Math.min(pts[i].move || move, Math.max(0.25, (pts[i + 1] ? pts[i + 1].t : clipDur) - t0 - 0.1));
    push(t0, cur);
    for (let k = 1; k <= Math.ceil(d / step); k++) {
      const u = ease(Math.min(1, (k * step) / d));
      push(t0 + Math.min(d, k * step), { z: cur.z + (nxt.z - cur.z) * u, pos: [cur.pos[0] + (nxt.pos[0] - cur.pos[0]) * u, cur.pos[1] + (nxt.pos[1] - cur.pos[1]) * u] });
    }
    cur = nxt;
  }
  push(clipDur, cur);
  return { scale, pos };
}
const VENV_PY = path.join(HOME, 'venv', 'Scripts', 'python.exe');
tool('screen_follow', "SCREEN RECORDING ZOOM (the user's way): rounded-crop frame (their 'round crop universal video' preset) + the WHOLE screen scales up smoothly and glides to wherever the action is (clicks, typing, scrolling) - top of the page while they talk about it, then down to the button they click. auto=true finds the action itself; or give points [{at (timeline s), x, y (0-1 of the screen), zoom (1 = full screen, 1.3-2 = closer)}] from the transcript. Optional highlights [{at, duration, rect:[x,y,w,h] of the screen, label?}] draw a clean outline that moves with the zoom.", {
  ...seqArg, track: z.number().int().optional().describe('video track of the screen recording, default 1'), clipIndex: z.number().int().optional(), at: z.number().optional(),
  from: z.number().optional(), to: z.number().optional().describe('timeline range; cuts it out first'),
  auto: z.boolean().optional().describe('default true when no points given'),
  points: z.array(z.object({ at: z.number(), x: z.number(), y: z.number(), zoom: z.number().optional(), move: z.number().optional().describe('glide seconds for this move; 0.3 = fast whip') })).optional(),
  layered: z.boolean().optional().describe('default true: MAIN on V1 untouched, BACKDROP V2, ZOOM copy V3, highlights V5'),
  maxZoom: z.number().optional().describe('default 1.8'), move: z.number().optional().describe('seconds per glide, default 0.8'),
  motionBlur: z.boolean().optional().describe('default true'), rounded: z.boolean().optional().describe('default true'),
  roundedPreset: z.string().optional().describe("default 'round crop universal video'"),
  highlights: z.array(z.object({ at: z.number(), duration: z.number(), rect: z.array(z.number()).length(4), label: z.string().optional(), dim: z.boolean().optional().describe('dim the rest, default true'), outline: z.boolean().optional() })).optional() },
  async (a) => {
    const track = a.track || 1, layered = a.layered !== false;
    if (layered) await setupLayers(a.sequence);
    if (a.from !== undefined && a.to !== undefined) {   // cut the MAIN video (picture + its audio) at the range
      await call('razor', { sequence: a.sequence, times: [a.from, a.to], track });
      for (const at of [1, 2]) await call('razor', { sequence: a.sequence, times: [a.from, a.to], track: at, kind: 'audio' }).catch(() => {});
    }
    const target = a.from !== undefined ? { at: a.from + 0.01 } : { clipIndex: a.clipIndex, at: a.at };
    const { seq, clip, index } = await clipAt(a.sequence, 'video', track, target);
    let pts;
    if (a.points && a.points.length) pts = a.points.map((p) => ({ t: p.at - clip.start, x: p.x, y: p.y, zoom: p.zoom ?? 1.5, move: p.move }));
    else {
      const media = clip.mediaPath || loadMap(seq.name)?.source;   // nested MAIN: its proxy has the same timeline
      if (!media) throw new Error('No media to analyse for this clip; give points instead.');
      const { stdout } = await M.run(VENV_PY, [path.join(SCRIPTS, 'follow.py'),
        media, String(clip.inPoint), String(clip.outPoint), String(a.maxZoom || 1.8)], { timeout: 30 * 60 * 1000 });
      pts = JSON.parse(stdout).points;
    }
    const cam = cameraKeys(pts, clip.duration, a.move || 0.8);
    const blur = a.motionBlur !== false;
    const transform = { matchName: 'AE.ADBE Geometry', displayName: 'Transform', params: [
      { name: 'Uniform Scale', value: true }, { name: 'Scale Height', keys: cam.scale }, { name: 'Position', keys: cam.pos },
      ...(blur ? [{ name: 'Use Composition’s Shutter Angle', value: false }, { name: "Use Composition's Shutter Angle", value: false }, { name: 'Shutter Angle', value: 180 }] : [])] };
    const effects = [transform];
    let roundFx = null;
    if (a.rounded !== false) {
      roundFx = (await M.findPreset(a.roundedPreset || 'round crop universal video')).effects.map((e) => M.fitEffect(e, clip.duration));
      effects.push(...roundFx);
    }
    // layered: MAIN stays untouched on V1; a dark BACKDROP goes on V2 and the zoomed copy on V3 (switch V2+V3 off to see the raw cut)
    let fxTrack = track, fxIndex = index, nn = '01';
    if (layered) {
      const s0 = await activeSeqInfo(seq.name);
      nn = String((s0.video[LAYER.ZOOM - 1]?.clips.length || 0) + 1).padStart(2, '0');
      const [bg] = await M.themeGraphics({ kind: 'background', W: s0.width, H: s0.height });
      await call('place_many', { sequence: seq.name, bin: 'Layers', items: [{ path: bg, at: clip.start, duration: clip.duration, track: LAYER.BACKDROP, name: `BACKDROP ${nn}` }] });
      const dup = await call('duplicate_above', { sequence: seq.name, track, clipIndex: index, toTrack: LAYER.ZOOM, name: `ZOOM ${nn}` });
      fxTrack = dup.track; fxIndex = dup.clipIndex;
    }
    const res = await call('apply_effects', { sequence: seq.name, track: fxTrack, clipIndex: fxIndex, effects }, 600000);
    // remember this zoom's camera so highlights can be added or redone later (add_highlight)
    saveCam(seq.name, `ZOOM ${nn}`, { clipStart: clip.start, clipEnd: clip.end, inPoint: clip.inPoint, mediaPath: clip.mediaPath, size: clip.mediaPath ? null : [seq.width, seq.height], track: fxTrack, cam, roundFx });
    const hl = [];
    for (const [hi0, h] of (a.highlights || []).entries()) hl.push(await addHighlight(seq.name, `ZOOM ${nn}`, h, `${nn}.${hi0 + 1}`));
    return { clip: [clip.start, clip.end], layers: layered ? { main: 'V1 (untouched)', backdrop: `V${LAYER.BACKDROP}`, zoom: `V${fxTrack} ZOOM ${nn}`, spotlights: `V${LAYER.FOCUS}`, outlines: `V${LAYER.GRAPHICS}` } : undefined,
      moves: pts.length - 1, points: pts.slice(0, 20), effects: res.effects, highlights: hl };
  });

tool('make_broll', 'Animated B-ROLL scene, rendered to MP4 and placed on the V4 B-ROLL layer. MAIN B-ROLL STYLE = ref 1 (dark grid, neon glow, 3D-tilted glowing frames, mono labels): chapter_nav {items:[{icon, label}], active, title} = CHAPTER OPENER for every chapter (icon row, the chapter lights up, camera tilts in; icons: download text folder video audio cut zoom edit idea code play settings mic captions image chart check star link search user chat magic layers clock money rocket globe lock); neon_cards {video|image, in?, portrait?, labels:[...]} glowing tilted frame + floating labels; framed_clip {video|image, in?, tag?}. Also from the zoom reference: kinetic_text {lines:["you *don\'t* have to","run it *locally* yourself"], image?} words pop in (*word* = italic accent) + optional image/icon/screenshot; stat {value:"321B", label:"params"} number card that counts up; prompt_bar {text, chips?} chat box that types and sends; feature_list {title, subtitle?, file?, items:[{title, sub?}]} card with points branching out; logo_row {items:[{text, icon?}]}; quote_stamp {text, sub?} tilted stamp. Use the transcript to time it (at = when the line starts).', {
  ...seqArg, scene: z.enum(['chapter_nav', 'neon_cards', 'framed_clip', 'kinetic_text', 'stat', 'prompt_bar', 'feature_list', 'logo_row', 'quote_stamp']),
  args: z.record(z.any()), duration: z.number().optional().describe('seconds, default 3'), accent: z.string().optional(),
  place: z.object({ at: z.number(), track: z.number().int().optional() }).optional() },
  async (a) => {
    const s = await activeSeqInfo(a.sequence);
    const dur = a.duration || 3;
    const out = M.outFile(`broll-${a.scene}`, 'mp4', path.join(M.OUT, 'broll'));
    const spec = M.outFile('broll-spec', 'json', path.join(M.OUT, 'broll'));
    fs.writeFileSync(spec, JSON.stringify({ ...a.args, scene: a.scene, out, W: s.width, H: s.height, fps: Math.round(s.fps), duration: dur, accent: a.accent }));
    await M.run(VENV_PY, [path.join(SCRIPTS, 'broll.py'), spec], { timeout: 20 * 60 * 1000 });
    fs.unlinkSync(spec);
    if (!a.place) return { out };
    const label = String(a.args.value || a.args.title || a.args.text || (a.args.lines || [])[0] || '').replace(/\*/g, '').slice(0, 30);
    const placed = await call('place_many', { sequence: s.name, bin: 'B-roll', items: [{ path: out, at: a.place.at, duration: dur, track: a.place.track || LAYER.BROLL, name: `BROLL ${a.scene} ${label}` }] });
    return { out, placed: placed[0] };
  });

// ---------- looks (colour treatments) ----------
tool('treat_media', `Make a colour-treated copy of an image or video in a colour look: ${M.LOOK_NAMES.join(', ')} (teal split, hard B&W, amber, negative flash, crushed for text on top, clean). Optionally place it.`, {
  ...seqArg, path: z.string(), look: z.string(), place: z.object({ at: z.number(), duration: z.number().optional(), track: z.number().int().optional() }).optional() },
  async (a) => {
    const out = await M.treat(a.path, a.look);
    if (!a.place) return { out };
    const r = await call('place_many', { sequence: a.sequence, bin: 'B-roll', items: [{ path: out, at: a.place.at, duration: a.place.duration, track: a.place.track || LAYER.BROLL, name: `BROLL ${a.look} ${path.basename(a.path)}` }] });
    return { out, placed: r[0] };
  });
tool('place_broll', 'Place several b-roll clips/images/screen recordings at given times in one go (optionally with a look applied first).', {
  ...seqArg, items: z.array(z.object({ path: z.string(), at: z.number(), duration: z.number().optional(), track: z.number().int().optional(), look: z.string().optional() })) },
  async (a) => {
    const items = [];
    for (const it of a.items) items.push({ ...it, path: it.look ? await M.treat(it.path, it.look) : it.path, track: it.track || LAYER.BROLL, name: it.name || `BROLL ${path.basename(it.path)}` });
    return call('place_many', { sequence: a.sequence, bin: 'B-roll', items }, 600000);
  });

// ---------- sound ----------
tool('list_sound_effects', 'List the sound effects in assets/sfx/<kit>/ (or ULTRA_SFX_DIR). The repo ships none - add your own licensed clicks, whooshes, risers, impacts, sub booms.', {}, () =>
  M.listSfx().map((s) => ({ name: s.name, lengthMs: s.lengthMs })));
async function placeSfx(sequence, sounds, track, db) {
  const items = sounds.map((s) => { const f = M.findSfx(s.name); return { path: f.file, at: Math.max(0, +(s.at - f.transientMs / 1000).toFixed(3)), track, audio: true }; });
  const placed = await call('place_many', { sequence, bin: 'SFX', items }, 300000);
  const seq = await activeSeqInfo(sequence);
  const tr = seq.audio[track - 1];
  let leveled = 0;
  for (const it of items) {
    const idx = tr ? tr.clips.findIndex((c) => Math.abs(c.start - it.at) < 0.02) : -1;
    if (idx >= 0) { try { await call('set_volume', { sequence: seq.name, track, clipIndex: idx, db }); leveled++; } catch {} }
  }
  return { placed: placed.filter((p) => p.ok).length, leveled, failed: placed.filter((p) => p.error).slice(0, 5) };
}
tool('add_sound_effects', 'Place sound effects at times; each sound is shifted so its hit lands exactly on the time. name = a kit sound (list_sound_effects) or a full path to any audio file (your own sfx, a Qwen3 voice line).', {
  ...seqArg, sounds: z.array(z.object({ name: z.string(), at: z.number() })), track: z.number().int().optional().describe('audio track, default 3'),
  db: z.number().optional().describe('volume, default -6') },
  (a) => placeSfx(a.sequence, a.sounds, a.track || 3, a.db ?? -6));
tool('add_sfx_on_cuts', 'Put a click/whoosh on every cut of a video track ("a click on every change").', {
  ...seqArg, videoTrack: z.number().int().optional().describe('default 2 (b-roll)'), sound: z.string().optional().describe('default: rotate every kit sound whose name contains "click"'),
  audioTrack: z.number().int().optional().describe('default 3'), db: z.number().optional().describe('default -10') },
  async (a) => {
    const seq = await activeSeqInfo(a.sequence);
    const tr = seq.video[(a.videoTrack || 2) - 1]; if (!tr) throw new Error('No such video track');
    const cuts = [...new Set(tr.clips.map((c) => +c.start.toFixed(3)))];
    const clicks = a.sound ? [a.sound] : M.listSfx().filter((s) => /click/i.test(s.name) && !/train/i.test(s.name)).map((s) => s.name);
    if (!clicks.length) throw new Error('No click sounds found. Add audio files with "click" in the name to assets/sfx/<kit>/, or pass sound.');
    const sounds = cuts.map((t, i) => ({ name: clicks[i % clicks.length], at: t }));
    return { cuts: cuts.length, ...(await placeSfx(seq.name, sounds, a.audioTrack || 3, a.db ?? -10)) };
  });
tool('duck_music', 'Lower a music clip under speech: keyframes the music to duckDb while someone talks and baseDb in the gaps. Speech comes from the voice file (silence detection) and the sequence map.', {
  ...seqArg, musicTrack: z.number().int(), clipIndex: z.number().int().optional(), voicePath: z.string().describe('the recording on disk'),
  baseDb: z.number().optional().describe('default -12'), duckDb: z.number().optional().describe('default -24'), fade: z.number().optional().describe('ramp seconds, default 0.25') },
  async (a) => {
    const seq = await activeSeqInfo(a.sequence);
    const clip = seq.audio[a.musicTrack - 1]?.clips[a.clipIndex || 0]; if (!clip) throw new Error('Music clip not found');
    const map = loadMap(seq.name);
    let speech = (await M.speechRanges(a.voicePath, { minSilence: 0.6, pad: 0.2 })).keep;
    if (map) speech = speech.flatMap((r) => map.map.filter((m) => m.srcEnd > r.start && m.srcStart < r.end)
      .map((m) => ({ start: m.seqStart + Math.max(r.start, m.srcStart) - m.srcStart, end: m.seqStart + Math.min(r.end, m.srcEnd) - m.srcStart })));
    const base = a.baseDb ?? -12, duck = a.duckDb ?? -24, f = a.fade ?? 0.25, k = [{ t: 0, db: base }];
    for (const s of speech) {
      const ts = s.start - clip.start, te = s.end - clip.start;
      if (te < 0 || ts > clip.duration) continue;
      k.push({ t: Math.max(0, ts - f), db: base }, { t: Math.max(0, ts), db: duck }, { t: te, db: duck }, { t: te + f, db: base });
    }
    const keysSorted = k.sort((x, y) => x.t - y.t).filter((x, i, arr) => i === 0 || x.t - arr[i - 1].t > 0.01);
    await call('set_volume', { sequence: seq.name, track: a.musicTrack, clipIndex: a.clipIndex || 0, keyframes: keysSorted }, 300000);
    return { speechRanges: speech.length, keyframes: keysSorted.length };
  });

// ---------- review + export ----------
tool('render_frame', 'Render one frame of the sequence to PNG and show it, to check the edit visually.', { ...seqArg, at: z.number() }, async (a) => {
  const out = M.outFile('frame', 'png', path.join(M.OUT, 'frames'));
  await call('export_frame', { ...a, outPath: out });
  let f = out;
  for (let i = 0; i < 40 && !fs.existsSync(f); i++) { await new Promise((r) => setTimeout(r, 250)); if (fs.existsSync(out + '.png')) f = out + '.png'; }
  if (!fs.existsSync(f)) return `Premiere did not write the frame (${out}).`;
  return { content: [{ type: 'text', text: `frame at ${a.at}s: ${f}` }, { type: 'image', data: fs.readFileSync(f).toString('base64'), mimeType: 'image/png' }] };
});
tool('review_sequence', 'Look at the whole edit: renders frames spread across the sequence (or a range) into one contact sheet image with timestamps. Use after editing to check b-roll, captions, graphics.', {
  ...seqArg, frames: z.number().int().min(2).max(24).optional().describe('default 12'), from: z.number().optional(), to: z.number().optional() },
  async (a) => {
    const seq = await activeSeqInfo(a.sequence);
    const n = a.frames || 12, from = a.from ?? 0, to = Math.min(a.to ?? seq.duration, seq.duration - 0.05);
    if (to <= from) throw new Error('Sequence is empty.');
    const dir = M.ensureDir(path.join(M.OUT, 'frames', 'review-' + Date.now()));
    const shots = [];
    for (let i = 0; i < n; i++) {
      const t = +(from + ((to - from) * (i + 0.5)) / n).toFixed(2);
      const out = path.join(dir, `f${String(i).padStart(2, '0')}.png`);
      await call('export_frame', { sequence: seq.name, at: t, outPath: out });
      let f = out;
      for (let k = 0; k < 40 && !fs.existsSync(f); k++) { await new Promise((r) => setTimeout(r, 250)); if (fs.existsSync(out + '.png')) f = out + '.png'; }
      if (fs.existsSync(f)) shots.push({ f, t });
    }
    if (!shots.length) return 'Premiere did not write any frames.';
    const cols = 4, sheet = path.join(dir, 'sheet.jpg');
    const ins = shots.flatMap((s) => ['-i', s.f]);
    const lab = shots.map((s, i) => `[${i}:v]scale=480:-2,drawtext=fontfile=${M.fontFor('segoeuib.ttf')}:text='${s.t.toFixed(1)}s':x=8:y=8:fontsize=22:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=4[v${i}]`).join(';');
    const pad = (cols - (shots.length % cols)) % cols;
    const blanks = Array.from({ length: pad }, (_, i) => `color=c=black:s=480x${Math.round(480 * seq.height / seq.width / 2) * 2}:d=1[b${i}]`).join(';');
    const inputsList = shots.map((_, i) => `[v${i}]`).join('') + Array.from({ length: pad }, (_, i) => `[b${i}]`).join('');
    const total = shots.length + pad;
    const fc = [lab, blanks, `${inputsList}xstack=inputs=${total}:layout=${Array.from({ length: total }, (_, i) => `${(i % cols) ? Array.from({ length: i % cols }, () => 'w0').join('+') : '0'}_${Math.floor(i / cols) ? Array.from({ length: Math.floor(i / cols) }, () => 'h0').join('+') : '0'}`).join('|')}:fill=black`].filter(Boolean).join(';');
    await M.run('ffmpeg', ['-nostdin', '-v', 'error', '-y', ...ins, '-filter_complex', fc, '-frames:v', '1', '-q:v', '3', sheet], { cwd: M.FONTS });
    return { content: [{ type: 'text', text: `${shots.length} frames of "${seq.name}" (${seq.duration}s): ${sheet}` },
      { type: 'image', data: fs.readFileSync(sheet).toString('base64'), mimeType: 'image/jpeg' }] };
  });
tool('set_playhead','Move the playhead.', { ...seqArg, at: z.number() }, (a) => call('set_playhead', a));
// Exporting inside Premiere locks its UI for the whole render and Windows kills it as "not responding",
// so the default is Media Encoder (background render). queue=false forces the in-Premiere export.
tool('export_video', 'Export the sequence to MP4. preset: youtube_1080 (default), youtube_4k, h264_match, or a path to an .epr. Renders in Media Encoder by default so Premiere does not freeze; queue=false exports inside Premiere instead (short clips only).', {
  ...seqArg, outPath: z.string(), preset: z.string().optional(), workAreaOnly: z.boolean().optional(), queue: z.boolean().optional() },
  (a) => a.queue !== false
    ? call('queue_export', { ...a, presetPath: presetPath(a.preset), start: true }, 5 * 60 * 1000)
    : call('export_sequence', { ...a, presetPath: presetPath(a.preset) }, 3 * 60 * 60 * 1000));
tool('save_project', 'Save the Premiere project.', {}, () => call('save_project'));
tool('run_extendscript', 'Advanced: run raw Premiere ExtendScript (app, qe, PMCP helpers). Returns the last expression. Use only when no tool fits.', { code: z.string() },
  (a) => call('run_script', a, 300000));

// ---------- After Effects link (motion graphics built in AE, live in Premiere) ----------
registerAE({ tool, z, seqArg, LAYER });

await server.connect(new StdioServerTransport());
