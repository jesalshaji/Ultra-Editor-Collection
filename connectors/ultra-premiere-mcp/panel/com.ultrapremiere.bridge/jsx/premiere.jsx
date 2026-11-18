/* premiere.jsx: every Premiere command the Ultra Premiere bridge can run (ExtendScript, ES3).
 * Entry point: PMCP.run(cmdName, argsJsonString) -> JSON string {ok, result} or {ok:false, error}.
 * Times are seconds on the sequence timeline. Track numbers are 1-based (V1, A1...). */

var PMCP = (function () {
  var TICKS = 254016000000;

  // ---------- tiny JSON (ExtendScript may not have one) ----------
  function q(s) {
    return '"' + String(s).replace(/[\\"\u0000-\u001f\u2028\u2029]/g, function (c) {
      var m = { '"': '\\"', '\\': '\\\\', '\n': '\\n', '\r': '\\r', '\t': '\\t' };
      if (m[c]) return m[c];
      var h = c.charCodeAt(0).toString(16); while (h.length < 4) h = '0' + h; return '\\u' + h;
    }) + '"';
  }
  function stringify(v) {
    if (v === null || v === undefined) return 'null';
    var t = typeof v;
    if (t === 'number') return isFinite(v) ? String(v) : 'null';
    if (t === 'boolean') return v ? 'true' : 'false';
    if (t === 'string') return q(v);
    if (t === 'function') return 'null';
    if (v instanceof Array) {
      var a = []; for (var i = 0; i < v.length; i++) a.push(stringify(v[i])); return '[' + a.join(',') + ']';
    }
    var o = [];
    for (var k in v) { if (v.hasOwnProperty(k) && typeof v[k] !== 'function') o.push(q(k) + ':' + stringify(v[k])); }
    return '{' + o.join(',') + '}';
  }
  function parse(s) { return eval('(' + s + ')'); }

  // ---------- helpers ----------
  function fail(msg) { throw new Error(msg); }
  function r3(n) { return Math.round(n * 1000) / 1000; }
  function T(seconds) { var t = new Time(); t.seconds = Number(seconds); return t; }
  function proj() { if (!app.project) fail('No project is open in Premiere.'); return app.project; }

  function getSeq(a) {
    var p = proj();
    if (a && (a.sequence || a.sequenceId)) {
      for (var i = 0; i < p.sequences.numSequences; i++) {
        var s = p.sequences[i];
        if (s.sequenceID === a.sequenceId || s.name === a.sequence) return s;
      }
      fail('Sequence not found: ' + (a.sequence || a.sequenceId));
    }
    if (!p.activeSequence) fail('No active sequence. Open a sequence or create one first.');
    return p.activeSequence;
  }
  function fps(seq) { return TICKS / Number(seq.timebase); }
  // tracks that don't exist yet are added (V4, A5...), so tools can always use the standard layout
  function addTracks(seq, kind, want) {
    if (want > 24) fail('Track ' + want + ' is too high.');
    var have = kind === 'audio' ? seq.audioTracks.numTracks : seq.videoTracks.numTracks;
    if (have >= want) return;
    var qs = qeSeq(seq), need = want - have;
    if (kind === 'audio') qs.addTracks(0, 0, need, 1, have, 0, 0, 0);
    else qs.addTracks(need, have, 0, 0, 0, 0, 0, 0);
  }
  function vTrack(seq, n) {
    n = n || 1;
    if (!seq.videoTracks[n - 1]) addTracks(seq, 'video', n);
    var t = seq.videoTracks[n - 1]; if (!t) fail('Video track V' + n + ' does not exist and could not be added.'); return t;
  }
  function aTrack(seq, n) {
    n = n || 1;
    if (!seq.audioTracks[n - 1]) addTracks(seq, 'audio', n);
    var t = seq.audioTracks[n - 1]; if (!t) fail('Audio track A' + n + ' does not exist and could not be added.'); return t;
  }
  function track(seq, kind, n) { return kind === 'audio' ? aTrack(seq, n) : vTrack(seq, n); }

  function timecode(seq, seconds) {
    var st = seq.getSettings();
    return T(seconds).getFormatted(st.videoFrameRate, st.videoDisplayFormat);
  }

  function clipInfo(c, idx) {
    var o = { index: idx, name: c.name, start: r3(c.start.seconds), end: r3(c.end.seconds),
      duration: r3(c.duration.seconds), inPoint: r3(c.inPoint.seconds), outPoint: r3(c.outPoint.seconds) };
    try { o.nodeId = c.nodeId; } catch (e) {}
    try { o.selected = c.isSelected(); } catch (e) {}
    try { if (c.projectItem) { o.mediaPath = c.projectItem.getMediaPath(); o.projectItemId = c.projectItem.nodeId; } } catch (e) {}
    try { o.isMogrt = !!c.isMGT(); } catch (e) {}
    return o;
  }

  function getClip(seq, a) {
    var tr = track(seq, a.kind || 'video', a.track || 1);
    var cl = tr.clips;
    if (a.clipIndex !== undefined && a.clipIndex !== null) {
      var c = cl[a.clipIndex]; if (!c) fail('No clip #' + a.clipIndex + ' on that track (' + cl.numItems + ' clips).'); return c;
    }
    if (a.at !== undefined && a.at !== null) {
      for (var i = 0; i < cl.numItems; i++) { if (cl[i].start.seconds <= a.at + 1e-4 && cl[i].end.seconds > a.at + 1e-4) return cl[i]; }
      fail('No clip at ' + a.at + 's on that track.');
    }
    if (a.name) { for (var j = 0; j < cl.numItems; j++) if (cl[j].name === a.name) return cl[j]; fail('No clip named ' + a.name); }
    fail('Say which clip: clipIndex, at (seconds) or name.');
  }

  function walk(item, path, out, filter) {
    for (var i = 0; i < item.children.numItems; i++) {
      var c = item.children[i];
      var p = path + '/' + c.name;
      if (!filter || filter(c)) out.push({ item: c, path: p });
      if (c.type === ProjectItemType.BIN) walk(c, p, out, filter);
    }
    return out;
  }
  function normPath(p) { return String(p || '').replace(/\\/g, '/').toLowerCase(); }
  function itemByMedia(path) {
    var want = normPath(path), all = walk(proj().rootItem, '', [], null);
    for (var i = all.length - 1; i >= 0; i--) {
      try { if (normPath(all[i].item.getMediaPath()) === want) return all[i].item; } catch (e) {}
    }
    return null;
  }
  function itemByAny(a) {
    var all = walk(proj().rootItem, '', [], null), i;
    if (a.itemId) for (i = 0; i < all.length; i++) if (all[i].item.nodeId === a.itemId) return all[i].item;
    if (a.path) { var m = itemByMedia(a.path); if (m) return m; }
    if (a.itemName) for (i = 0; i < all.length; i++) if (all[i].item.name === a.itemName) return all[i].item;
    return null;
  }
  function binByName(name, create) {
    if (!name) return proj().rootItem;
    var all = walk(proj().rootItem, '', [], function (c) { return c.type === ProjectItemType.BIN; });
    for (var i = 0; i < all.length; i++) if (all[i].item.name === name) return all[i].item;
    if (create) return proj().rootItem.createBin(name);
    fail('Bin not found: ' + name);
  }

  function importOne(path, binName) {
    var have = itemByMedia(path);
    if (have) return have;
    var f = new File(path); if (!f.exists) fail('File not found: ' + path);
    proj().importFiles([f.fsName], true, binByName(binName, true), false);
    var got = itemByMedia(path) || itemByMedia(f.fsName);
    if (!got) fail('Premiere did not import: ' + path);
    return got;
  }

  function clipsOnTrackAt(tr, seconds) {
    for (var i = 0; i < tr.clips.numItems; i++) {
      var c = tr.clips[i];
      if (Math.abs(c.start.seconds - seconds) < 0.02) return c;
    }
    return null;
  }

  function findComponent(clip, names) {
    for (var i = 0; i < clip.components.numItems; i++) {
      var c = clip.components[i];
      for (var j = 0; j < names.length; j++) if (c.displayName === names[j] || c.matchName === names[j]) return c;
    }
    return null;
  }
  function findProp(comp, names) {
    for (var i = 0; i < comp.properties.numItems; i++) {
      var p = comp.properties[i];
      for (var j = 0; j < names.length; j++) if (p.displayName === names[j]) return p;
    }
    return null;
  }
  // keyframe times in Premiere are in the clip's media time
  function keyTime(clip, tFromClipStart) { return T(clip.inPoint.seconds + Number(tFromClipStart)); }

  function setPropValue(clip, prop, value, keys) {
    if (keys && keys.length) {
      if (!prop.isTimeVarying()) prop.setTimeVarying(true);
      for (var k = 0; k < keys.length; k++) {
        var kt = keyTime(clip, keys[k].t);
        prop.addKey(kt);
        prop.setValueAtKey(kt, keys[k].value, true);
      }
      return 'keyed x' + keys.length;
    }
    if (prop.isTimeVarying()) prop.setTimeVarying(false);
    prop.setValue(value, true);
    return 'set';
  }

  function qeSeq(seq) {
    app.enableQE();
    var s = qe.project.getActiveSequence();
    if (!s) fail('QE: no active sequence');
    if (seq && s.name !== seq.name) {
      try { app.project.activeSequence = seq; } catch (e) {}
      try { seq.openInTimeline && seq.openInTimeline(); } catch (e2) {}
      s = qe.project.getActiveSequence();
      if (!s || s.name !== seq.name) fail('Could not switch Premiere to sequence "' + seq.name + '" (open it in the timeline and retry).');
    }
    return s;
  }
  function qeItem(seq, kind, trackNo, clip) {
    var qs = qeSeq(seq);
    var qt = kind === 'audio' ? qs.getAudioTrackAt(trackNo - 1) : qs.getVideoTrackAt(trackNo - 1);
    var want = clip.start.seconds;
    for (var i = 0; i < qt.numItems; i++) {
      var it = qt.getItemAt(i);
      if (!it || it.type === 'Empty') continue;
      var s = (it.start && it.start.secs !== undefined) ? it.start.secs : Number(it.start.ticks) / TICKS;
      if (Math.abs(s - want) < 0.02) return it;
    }
    fail('QE could not find the clip on the timeline.');
  }

  function dbToLevel(db) { return Math.pow(10, (Number(db) - 15) / 20); }

  // ---------- commands ----------
  var C = {};

  C.ping = function () {
    return { premiere: app.version, project: app.project ? app.project.name : null,
      activeSequence: (app.project && app.project.activeSequence) ? app.project.activeSequence.name : null };
  };

  C.get_project = function () {
    var p = proj(), seqs = [];
    for (var i = 0; i < p.sequences.numSequences; i++) {
      var s = p.sequences[i];
      seqs.push({ name: s.name, id: s.sequenceID, width: s.frameSizeHorizontal, height: s.frameSizeVertical,
        fps: r3(fps(s)), duration: r3(Number(s.end) / TICKS) });
    }
    return { name: p.name, path: p.path, activeSequence: p.activeSequence ? p.activeSequence.name : null, sequences: seqs };
  };

  C.list_items = function (a) {
    var root = a.bin ? binByName(a.bin) : proj().rootItem;
    var out = walk(root, '', [], null), res = [];
    var types = { 1: 'clip', 2: 'bin', 3: 'root', 4: 'file' };
    for (var i = 0; i < out.length && res.length < (a.limit || 300); i++) {
      var it = out[i].item, o = { name: it.name, path: out[i].path, type: types[it.type] || it.type, id: it.nodeId };
      try { var mp = it.getMediaPath(); if (mp) o.mediaPath = mp; } catch (e) {}
      try { if (it.isSequence && it.isSequence()) o.type = 'sequence'; } catch (e) {}
      if (!a.filter || String(o.name).toLowerCase().indexOf(String(a.filter).toLowerCase()) >= 0) res.push(o);
    }
    return res;
  };

  C.get_sequence = function (a) {
    var seq = getSeq(a), out = { name: seq.name, id: seq.sequenceID, width: seq.frameSizeHorizontal,
      height: seq.frameSizeVertical, fps: r3(fps(seq)), duration: r3(Number(seq.end) / TICKS),
      playhead: r3(seq.getPlayerPosition().seconds), video: [], audio: [] };
    var i, j;
    for (i = 0; i < seq.videoTracks.numTracks; i++) {
      var vt = seq.videoTracks[i], vc = [];
      for (j = 0; j < vt.clips.numItems; j++) vc.push(clipInfo(vt.clips[j], j));
      out.video.push({ track: i + 1, name: vt.name, muted: vt.isMuted(), clips: vc });
    }
    for (i = 0; i < seq.audioTracks.numTracks; i++) {
      var at = seq.audioTracks[i], ac = [];
      for (j = 0; j < at.clips.numItems; j++) ac.push(clipInfo(at.clips[j], j));
      out.audio.push({ track: i + 1, name: at.name, muted: at.isMuted(), clips: ac });
    }
    return out;
  };

  C.import_files = function (a) {
    var res = [];
    for (var i = 0; i < a.paths.length; i++) {
      try { var it = importOne(a.paths[i], a.bin); res.push({ path: a.paths[i], id: it.nodeId, name: it.name }); }
      catch (e) { res.push({ path: a.paths[i], error: e.message }); }
    }
    return res;
  };

  C.create_sequence = function (a) {
    var p = proj(), seq;
    if (a.fromPaths && a.fromPaths.length) {
      var items = [];
      for (var i = 0; i < a.fromPaths.length; i++) items.push(importOne(a.fromPaths[i], a.bin));
      seq = p.createNewSequenceFromClips(a.name, items, binByName(a.bin, true));
    } else {
      var preset = a.presetPath;
      if (!preset) fail('Give fromPaths (build the sequence from clips, matching their size and frame rate) or a presetPath (.sqpreset).');
      app.enableQE();
      qe.project.newSequence(a.name, preset);
      for (var k = 0; k < p.sequences.numSequences; k++) if (p.sequences[k].name === a.name) seq = p.sequences[k];
    }
    if (!seq) fail('Sequence was not created.');
    try { p.activeSequence = seq; } catch (e) {}
    try { seq.openInTimeline && seq.openInTimeline(); } catch (e) {}
    return { name: seq.name, id: seq.sequenceID, width: seq.frameSizeHorizontal, height: seq.frameSizeVertical, fps: r3(fps(seq)) };
  };

  C.open_sequence = function (a) {
    var seq = getSeq(a); proj().activeSequence = seq; try { seq.openInTimeline(); } catch (e) {}
    return { active: seq.name };
  };

  C.add_clip = function (a) {
    var seq = getSeq(a);
    var item = itemByAny(a);
    if (!item && a.path) item = importOne(a.path, a.bin);
    if (!item) fail('Clip not found. Give path, itemId or itemName.');
    var kind = a.audioOnly ? 'audio' : 'video';
    var tr = track(seq, kind, a.track || 1);
    var hadIn = (a.sourceIn !== undefined && a.sourceIn !== null), hadOut = (a.sourceOut !== undefined && a.sourceOut !== null);
    if (hadIn) { try { item.setInPoint(T(a.sourceIn).ticks, 4); } catch (e1) { item.setInPoint(a.sourceIn, 4); } }
    if (hadOut) { try { item.setOutPoint(T(a.sourceOut).ticks, 4); } catch (e2) { item.setOutPoint(a.sourceOut, 4); } }
    var at = (a.at === undefined || a.at === null) ? Number(seq.end) / TICKS : a.at;
    if (a.mode === 'insert') tr.insertClip(item, T(at).ticks); else tr.overwriteClip(item, T(at).ticks);
    if (hadIn) { try { item.clearInPoint(4); } catch (e3) {} }
    if (hadOut) { try { item.clearOutPoint(4); } catch (e4) {} }
    var placed = clipsOnTrackAt(tr, at);
    if (placed && a.duration) placed.end = T(at + Number(a.duration));
    if (placed && a.muteLinkedAudio === true) { /* left for the caller to remove via remove_clip on audio */ }
    return placed ? clipInfo(placed, -1) : { placedAt: at, note: 'placed, but could not re-read the clip' };
  };

  // Lay source ranges back to back: the core of silence removal and "best parts" selects.
  // a: {path|itemId, ranges:[{start,end}] in source seconds, startAt, track, newSequence:{name}}
  C.place_ranges = function (a) {
    var p = proj(), item = itemByAny(a);
    if (!item && a.path) item = importOne(a.path, a.bin);
    if (!item) fail('Source clip not found.');
    var seq;
    if (a.newSequence) {
      // never reuse a name: two sequences with the same name make every later edit ambiguous
      var base = a.newSequence, nm = base, nn = 2, taken = function (x) { for (var q = 0; q < p.sequences.numSequences; q++) if (p.sequences[q].name === x) return true; return false; };
      while (taken(nm)) nm = base + ' ' + (nn++);
      a.newSequence = nm;
      seq = p.createNewSequenceFromClips(a.newSequence, [item], binByName(a.bin, true));
      if (!seq) fail('Could not create sequence ' + a.newSequence);
      try { p.activeSequence = seq; } catch (e0) {}
      // the new sequence holds the whole clip: clear it, we lay only the ranges
      var k;
      for (k = 0; k < seq.videoTracks.numTracks; k++) { var vk = seq.videoTracks[k]; while (vk.clips.numItems) vk.clips[0].remove(false, true); }
      for (k = 0; k < seq.audioTracks.numTracks; k++) { var ak = seq.audioTracks[k]; while (ak.clips.numItems) ak.clips[0].remove(false, true); }
    } else seq = getSeq(a);
    var tr = a.audioOnly ? aTrack(seq, a.track || 1) : vTrack(seq, a.track || 1);
    var t = Number(a.startAt || 0), map = [];
    for (var i = 0; i < a.ranges.length; i++) {
      var r = a.ranges[i], len = Number(r.end) - Number(r.start);
      if (len <= 0.01) continue;
      try { item.setInPoint(T(r.start).ticks, 4); } catch (e2) { item.setInPoint(r.start, 4); }
      try { item.setOutPoint(T(r.end).ticks, 4); } catch (e3) { item.setOutPoint(r.end, 4); }
      tr.overwriteClip(item, T(t).ticks);
      map.push({ srcStart: r.start, srcEnd: r.end, seqStart: r3(t), label: r.label || '' });
      t += len;
    }
    try { item.clearInPoint(4); item.clearOutPoint(4); } catch (e4) {}
    try { seq.openInTimeline && seq.openInTimeline(); } catch (e5) {}
    return { sequence: seq.name, sequenceId: seq.sequenceID, pieces: map.length, duration: r3(t - Number(a.startAt || 0)), map: map,
      width: seq.frameSizeHorizontal, height: seq.frameSizeVertical, fps: r3(fps(seq)) };
  };

  // Place many already-imported or on-disk files at given times (graphics, b-roll, sfx) in one call.
  // a: {items:[{path, at, duration, track, audio}]}
  C.place_many = function (a) {
    var seq = getSeq(a), out = [];
    for (var i = 0; i < a.items.length; i++) {
      var it = a.items[i];
      try {
        var pi = importOne(it.path, it.bin || a.bin);
        var tr = it.audio ? aTrack(seq, it.track || 1) : vTrack(seq, it.track || 2);
        tr.overwriteClip(pi, T(it.at).ticks);
        var c = clipsOnTrackAt(tr, it.at);
        if (c && it.duration) c.end = T(Number(it.at) + Number(it.duration));
        if (c && it.name) { try { c.name = it.name; } catch (en) {} }
        out.push({ path: it.path, at: it.at, ok: !!c });
      } catch (e) { out.push({ path: it.path, at: it.at, error: e.message }); }
    }
    return out;
  };

  // Name the layer tracks (V1 MAIN, V2 BACKDROP ...), adding tracks that are missing.
  C.setup_layers = function (a) {
    var seq = getSeq(a), i;
    for (i = 0; i < a.video.length; i++) { var vt = vTrack(seq, i + 1); try { vt.name = a.video[i]; } catch (e) {} }
    for (i = 0; i < a.audio.length; i++) { var at = aTrack(seq, i + 1); try { at.name = a.audio[i]; } catch (e2) {} }
    if (a.mainName) {
      var v1 = seq.videoTracks[0];
      for (i = 0; i < v1.clips.numItems; i++) { try { var nm = a.mainName + ' ' + (i < 9 ? '0' : '') + (i + 1); v1.clips[i].name = nm; } catch (e3) {} }
    }
    return { video: a.video, audio: a.audio };
  };

  C.trim_clip = function (a) {
    var seq = getSeq(a), c = getClip(seq, a);
    if (a.inPoint !== undefined) c.inPoint = T(a.inPoint);
    if (a.outPoint !== undefined) c.outPoint = T(a.outPoint);
    if (a.start !== undefined) c.start = T(a.start);
    if (a.end !== undefined) c.end = T(a.end);
    return clipInfo(c, -1);
  };

  C.move_clip = function (a) {
    var seq = getSeq(a), c = getClip(seq, a);
    var delta = (a.to !== undefined ? Number(a.to) - c.start.seconds : Number(a.by || 0));
    c.move(T(delta));
    return clipInfo(c, -1);
  };

  C.remove_clip = function (a) {
    var seq = getSeq(a), c = getClip(seq, a), info = clipInfo(c, -1);
    c.remove(!!a.ripple, true);
    return { removed: info, ripple: !!a.ripple };
  };

  C.razor = function (a) {
    var seq = getSeq(a), qs = qeSeq(seq), done = [];
    var times = a.times || [a.at];
    for (var i = 0; i < times.length; i++) {
      var tc = timecode(seq, times[i]);
      if (a.track) {
        var qt = (a.kind === 'audio') ? qs.getAudioTrackAt(a.track - 1) : qs.getVideoTrackAt(a.track - 1);
        qt.razor(tc);
      } else {
        for (var v = 0; v < qs.numVideoTracks; v++) qs.getVideoTrackAt(v).razor(tc);
        for (var au = 0; au < qs.numAudioTracks; au++) qs.getAudioTrackAt(au).razor(tc);
      }
      done.push(times[i]);
    }
    return { cutAt: done };
  };

  C.set_clip_props = function (a) {
    var seq = getSeq(a), c = getClip(seq, a), did = {};
    if (a.label !== undefined) { c.projectItem && c.projectItem.setColorLabel && c.projectItem.setColorLabel(a.label); did.label = a.label; }
    if (a.name !== undefined && a.newName) { c.name = a.newName; did.name = a.newName; }
    if (a.enabled !== undefined) { c.disabled = !a.enabled; did.enabled = a.enabled; }
    if (a.speed !== undefined) {
      var it = qeItem(seq, a.kind || 'video', a.track || 1, c);
      it.setSpeed(Number(a.speed), '', !!a.reverse, false, !!a.ripple); did.speed = a.speed;
    }
    return did;
  };

  C.set_transform = function (a) {
    var seq = getSeq(a), c = getClip(seq, a), did = {};
    var motion = findComponent(c, ['AE.ADBE Motion', 'Motion']);
    var opac = findComponent(c, ['AE.ADBE Opacity', 'Opacity']);
    if (!motion) fail('This clip has no Motion component (is it an audio clip?).');
    var W = seq.frameSizeHorizontal, H = seq.frameSizeVertical;
    var k = a.keyframes || {};
    function px(v) { return [Number(v[0]) / W, Number(v[1]) / H]; }
    if (a.scale !== undefined || k.scale) did.scale = setPropValue(c, findProp(motion, ['Scale']), a.scale, k.scale);
    if (a.rotation !== undefined || k.rotation) did.rotation = setPropValue(c, findProp(motion, ['Rotation']), a.rotation, k.rotation);
    if (a.position !== undefined || k.position) {
      var pk = null;
      if (k.position) { pk = []; for (var i = 0; i < k.position.length; i++) pk.push({ t: k.position[i].t, value: px(k.position[i].value) }); }
      did.position = setPropValue(c, findProp(motion, ['Position']), a.position ? px(a.position) : null, pk);
    }
    if ((a.opacity !== undefined || k.opacity) && opac) did.opacity = setPropValue(c, findProp(opac, ['Opacity']), a.opacity, k.opacity);
    return did;
  };

  C.set_volume = function (a) {
    var seq = getSeq(a);
    a.kind = 'audio';
    var c = getClip(seq, a);
    var vol = findComponent(c, ['Volume', 'AE.ADBE Volume']);
    if (!vol) fail('No Volume component on that clip.');
    var lvl = findProp(vol, ['Level']);
    var keys = null;
    if (a.keyframes) { keys = []; for (var i = 0; i < a.keyframes.length; i++) keys.push({ t: a.keyframes[i].t, value: dbToLevel(a.keyframes[i].db) }); }
    return { level: setPropValue(c, lvl, a.db !== undefined ? dbToLevel(a.db) : null, keys) };
  };

  C.list_effects = function (a) {
    app.enableQE();
    var out = {}, f = String(a.filter || '').toLowerCase();
    function pick(list) {
      var r = []; if (!list) return r;
      for (var i = 0; i < list.length; i++) if (!f || String(list[i]).toLowerCase().indexOf(f) >= 0) r.push(String(list[i]));
      return r;
    }
    try { out.video = pick(qe.project.getVideoEffectList()); } catch (e) { out.video = 'unavailable'; }
    try { out.audio = pick(qe.project.getAudioEffectList()); } catch (e) { out.audio = 'unavailable'; }
    try { out.transitions = pick(qe.project.getVideoTransitionList()); } catch (e) { out.transitions = 'unavailable'; }
    return out;
  };

  C.apply_effect = function (a) {
    var seq = getSeq(a), kind = a.kind || 'video', c = getClip(seq, a);
    var it = qeItem(seq, kind, a.track || 1, c);
    if (kind === 'audio') {
      var ae = qe.project.getAudioEffectByName(a.effect); if (!ae) fail('Audio effect not found: ' + a.effect);
      it.addAudioEffect(ae);
    } else {
      var ve = qe.project.getVideoEffectByName(a.effect); if (!ve) fail('Video effect not found: ' + a.effect + ' (use list_effects).');
      it.addVideoEffect(ve);
    }
    return { applied: a.effect, clip: c.name };
  };

  C.get_effect_params = function (a) {
    var seq = getSeq(a), c = getClip(seq, a), out = [];
    for (var i = 0; i < c.components.numItems; i++) {
      var comp = c.components[i], ps = [];
      for (var j = 0; j < comp.properties.numItems; j++) {
        var p = comp.properties[j], v = null;
        try { v = p.getValue(); } catch (e) {}
        if (typeof v === 'string' && v.length > 200) v = v.slice(0, 200) + '…';
        ps.push({ name: p.displayName, value: v, keyed: (function () { try { return p.isTimeVarying(); } catch (e) { return null; } })() });
      }
      out.push({ index: i, name: comp.displayName, matchName: comp.matchName, params: ps });
    }
    return out;
  };

  C.set_effect_param = function (a) {
    var seq = getSeq(a), c = getClip(seq, a);
    var comp = null;
    for (var i = c.components.numItems - 1; i >= 0; i--) {
      var cc = c.components[i];
      if (cc.displayName === a.effect || cc.matchName === a.effect) { comp = cc; break; }
    }
    if (!comp) fail('Effect not on clip: ' + a.effect + ' (use get_effect_params).');
    var p = findProp(comp, [a.param]); if (!p) fail('Parameter not found: ' + a.param);
    return { result: setPropValue(c, p, a.value, a.keyframes) };
  };

  // Re-create effects (from a user preset or a spec): add each effect, then set values/keyframes.
  // a: {clip selector, effects:[{matchName, displayName, params:[{name, index, value, keys:[[tFromClipStart, v]]}]}]}
  var INTRINSIC = { 'AE.ADBE Motion': 1, 'AE.ADBE Opacity': 1, 'AE.ADBE Volume': 1 };
  function sameType(cur, v) {
    if (v === null || v === undefined) return false;
    if (v instanceof Array) return cur instanceof Array && cur.length === v.length;
    if (typeof v === 'boolean') return typeof cur === 'boolean';
    if (typeof v === 'number') return typeof cur === 'number' && Math.abs(v) < 1e9;
    return false;
  }
  C.apply_effects = function (a) {
    var seq = getSeq(a), kind = a.kind || 'video', c = getClip(seq, a), report = [];
    // effects are added in spec order (Premiere appends them; note the DOM lists components in reverse of the UI)
    var order = []; for (var oi = 0; oi < a.effects.length; oi++) order.push(oi);
    for (var ok = 0; ok < order.length; ok++) {
      var i = order[ok];
      var e = a.effects[i], comp = null, r = { effect: e.displayName || e.matchName, set: 0, keyed: 0, skipped: [] };
      try {
        if (!INTRINSIC[e.matchName]) {
          var names0 = []; for (var q0 = 0; q0 < c.components.numItems; q0++) names0.push(c.components[q0].matchName);
          var it = qeItem(seq, kind, a.track || 1, c);
          var fx = kind === 'audio' ? qe.project.getAudioEffectByName(e.displayName) : qe.project.getVideoEffectByName(e.displayName);
          if (!fx) fail('Effect not installed: ' + e.displayName);
          if (kind === 'audio') it.addAudioEffect(fx); else it.addVideoEffect(fx);
          c = getClip(seq, a);   // fresh object: the old one can miss the new effect
          // the new effect is where the stack first differs from before (same effect can be on the clip twice)
          var at0 = c.components.numItems - 1;
          for (var q1 = 0; q1 < c.components.numItems; q1++) { if (q1 >= names0.length || c.components[q1].matchName !== names0[q1]) { at0 = q1; break; } }
          comp = c.components[at0];
          r.position = at0;
        }
        // intrinsic (Motion/Opacity/Volume), or fallback: match by matchName, then by name (Transform -> AE.ADBE Geometry)
        if (!comp) for (var k = c.components.numItems - 1; k >= 0; k--) {
          if (c.components[k].matchName === e.matchName) { comp = c.components[k]; break; }
        }
        if (!comp) for (var k2 = c.components.numItems - 1; k2 >= 0; k2--) {
          if (c.components[k2].displayName === e.displayName) { comp = c.components[k2]; break; }
        }
        if (!comp) fail('Added, but could not find it on the clip: ' + e.matchName);
        for (var p = 0; p < e.params.length; p++) {
          var ps = e.params[p], prop = null;
          // same name can repeat inside an effect (e.g. Left/Right twice): use the n-th match
          var nth = 0, seen = 0;
          for (var q0 = 0; q0 < p; q0++) if (e.params[q0].name === ps.name) nth++;
          for (var q = 0; q < comp.properties.numItems; q++) {
            if (comp.properties[q].displayName === ps.name) { if (seen === nth) { prop = comp.properties[q]; break; } seen++; }
          }
          if (!prop) { r.skipped.push(ps.name); continue; }
          try {
            var cur = prop.getValue();
            if (ps.keys && ps.keys.length) {
              if (!sameType(cur, ps.keys[0][1])) { r.skipped.push(ps.name); continue; }
              if (!prop.isTimeVarying()) prop.setTimeVarying(true);
              for (var kk = 0; kk < ps.keys.length; kk++) {
                var kt = keyTime(c, ps.keys[kk][0]); prop.addKey(kt); prop.setValueAtKey(kt, ps.keys[kk][1], true);
              }
              r.keyed++;
            } else if (sameType(cur, ps.value)) {
              var differs = (cur instanceof Array) ? (Math.abs(cur[0] - ps.value[0]) > 1e-6 || Math.abs(cur[1] - ps.value[1]) > 1e-6) : (cur !== ps.value);
              if (differs) { prop.setValue(ps.value, true); r.set++; }
            }
          } catch (pe) { r.skipped.push(ps.name + ' (' + pe.message + ')'); }
        }
      } catch (ee) { r.error = ee.message; }
      if (r.skipped.length > 8) r.skipped = r.skipped.slice(0, 8).concat(['…']);
      report.push(r);
    }
    return { clip: c.name, effects: report };
  };

  function trackFree(tr, s, e) {
    if (!tr) return true;
    for (var i = 0; i < tr.clips.numItems; i++) { var c = tr.clips[i]; if (c.start.seconds < e - 0.01 && c.end.seconds > s + 0.01) return false; }
    return true;
  }
  // Copy a clip onto the first video track above it where V and A are both empty (adds tracks if needed),
  // then drop the copy's audio. Used for the 2-layer screen zoom.
  C.duplicate_above = function (a) {
    var seq = getSeq(a), c = getClip(seq, a), s = c.start.seconds, e = c.end.seconds, n = a.toTrack || (a.track || 1) + 1;
    if (a.toTrack) {
      if (!trackFree(seq.videoTracks[n - 1], s, e)) fail('Layer V' + n + ' already has a clip between ' + r3(s) + ' and ' + r3(e) + ' s.');
      // Premiere drops the copy's audio on A<n>: that range must be empty or it would overwrite sound there
      if (!trackFree(seq.audioTracks[n - 1], s, e)) fail('A' + n + ' has audio between ' + r3(s) + ' and ' + r3(e) + ' s; run the zoom layers before adding sound effects there.');
    }
    else while (!(trackFree(seq.videoTracks[n - 1], s, e) && trackFree(seq.audioTracks[n - 1], s, e))) n++;
    var vt = vTrack(seq, n); aTrack(seq, n);
    var item = c.projectItem;
    // remember every audio clip that exists now, so only the copy's new audio gets removed
    var before = {};
    for (var b0 = 0; b0 < seq.audioTracks.numTracks; b0++) {
      var bt = seq.audioTracks[b0];
      for (var b1 = 0; b1 < bt.clips.numItems; b1++) before[b0 + ':' + bt.clips[b1].nodeId] = 1;
    }
    try { item.setInPoint(c.inPoint.ticks, 4); item.setOutPoint(c.outPoint.ticks, 4); } catch (e1) { item.setInPoint(c.inPoint.seconds, 4); item.setOutPoint(c.outPoint.seconds, 4); }
    vt.overwriteClip(item, c.start.ticks);
    try { item.clearInPoint(4); item.clearOutPoint(4); } catch (e2) {}
    // drop the copy's own audio: clips that did not exist before the overwrite
    for (var ai = 0; ai < seq.audioTracks.numTracks; ai++) {
      var at = seq.audioTracks[ai];
      for (var i = at.clips.numItems - 1; i >= 0; i--) if (!before[ai + ':' + at.clips[i].nodeId]) at.clips[i].remove(false, true);
    }
    var copy = clipsOnTrackAt(seq.videoTracks[n - 1], s);
    if (copy) { copy.end = T(e); if (a.name) { try { copy.name = a.name; } catch (en) {} } }
    var idx = -1; for (var j = 0; j < vt.clips.numItems; j++) if (Math.abs(vt.clips[j].start.seconds - s) < 0.02) idx = j;
    return { track: n, clipIndex: idx, start: r3(s), end: r3(e) };
  };

  // Copy just a time range of a clip (picture only) onto another track: used for editable spotlights.
  // a: {track, clipIndex, from, to (timeline s), toTrack, name}
  C.copy_range = function (a) {
    var seq = getSeq(a), c = getClip(seq, a), s = Math.max(c.start.seconds, Number(a.from)), e = Math.min(c.end.seconds, Number(a.to));
    if (e <= s) fail('Range is outside the clip.');
    var n = a.toTrack, vt = vTrack(seq, n); aTrack(seq, n);
    if (!trackFree(seq.videoTracks[n - 1], s, e)) fail('V' + n + ' already has a clip between ' + r3(s) + ' and ' + r3(e) + ' s.');
    if (!trackFree(seq.audioTracks[n - 1], s, e)) fail('A' + n + ' has audio between ' + r3(s) + ' and ' + r3(e) + ' s.');
    var before = {};
    for (var b0 = 0; b0 < seq.audioTracks.numTracks; b0++) { var bt = seq.audioTracks[b0]; for (var b1 = 0; b1 < bt.clips.numItems; b1++) before[b0 + ':' + bt.clips[b1].nodeId] = 1; }
    var item = c.projectItem, srcIn = c.inPoint.seconds + (s - c.start.seconds), srcOut = srcIn + (e - s);
    try { item.setInPoint(T(srcIn).ticks, 4); item.setOutPoint(T(srcOut).ticks, 4); } catch (e1) { item.setInPoint(srcIn, 4); item.setOutPoint(srcOut, 4); }
    vt.overwriteClip(item, T(s).ticks);
    try { item.clearInPoint(4); item.clearOutPoint(4); } catch (e2) {}
    for (var ai = 0; ai < seq.audioTracks.numTracks; ai++) {
      var at = seq.audioTracks[ai];
      for (var i = at.clips.numItems - 1; i >= 0; i--) if (!before[ai + ':' + at.clips[i].nodeId]) at.clips[i].remove(false, true);
    }
    var copy = clipsOnTrackAt(vt, s), idx = -1;
    if (copy) { copy.end = T(e); if (a.name) { try { copy.name = a.name; } catch (en) {} } }
    for (var j = 0; j < vt.clips.numItems; j++) if (Math.abs(vt.clips[j].start.seconds - s) < 0.02) idx = j;
    return { track: n, clipIndex: idx, start: r3(s), end: r3(e) };
  };

  // Lay a range of ANY file (picture only) on a track at a timeline time, scaled to fit the frame if asked.
  // a: {path, srcIn, srcOut, at, toTrack, name, fit}
  C.place_video = function (a) {
    var seq = getSeq(a), n = a.toTrack, vt = vTrack(seq, n); aTrack(seq, n);
    var s = Number(a.at), e = s + (Number(a.srcOut) - Number(a.srcIn));
    if (!trackFree(seq.videoTracks[n - 1], s, e)) fail('V' + n + ' already has a clip between ' + r3(s) + ' and ' + r3(e) + ' s.');
    if (!trackFree(seq.audioTracks[n - 1], s, e)) fail('A' + n + ' has audio between ' + r3(s) + ' and ' + r3(e) + ' s.');
    var item = importOne(a.path, a.bin);
    var before = {};
    for (var b0 = 0; b0 < seq.audioTracks.numTracks; b0++) { var bt = seq.audioTracks[b0]; for (var b1 = 0; b1 < bt.clips.numItems; b1++) before[b0 + ':' + bt.clips[b1].nodeId] = 1; }
    try { item.setInPoint(T(a.srcIn).ticks, 4); item.setOutPoint(T(a.srcOut).ticks, 4); } catch (e1) { item.setInPoint(a.srcIn, 4); item.setOutPoint(a.srcOut, 4); }
    vt.overwriteClip(item, T(s).ticks);
    try { item.clearInPoint(4); item.clearOutPoint(4); } catch (e2) {}
    for (var ai = 0; ai < seq.audioTracks.numTracks; ai++) {
      var at = seq.audioTracks[ai];
      for (var i = at.clips.numItems - 1; i >= 0; i--) if (!before[ai + ':' + at.clips[i].nodeId]) at.clips[i].remove(false, true);
    }
    var c = clipsOnTrackAt(vt, s), idx = -1, k = 1;
    if (c) {
      c.end = T(e); if (a.name) { try { c.name = a.name; } catch (en) {} }
      if (a.fit && a.width && a.height) {
        k = Math.min(seq.frameSizeHorizontal / a.width, seq.frameSizeVertical / a.height);
        var mo = findComponent(c, ['AE.ADBE Motion', 'Motion']); if (mo) findProp(mo, ['Scale']).setValue(k * 100, true);
      }
    }
    for (var j = 0; j < vt.clips.numItems; j++) if (Math.abs(vt.clips[j].start.seconds - s) < 0.02) idx = j;
    return { track: n, clipIndex: idx, start: r3(s), end: r3(e), fit: k };
  };

  C.add_transition = function (a) {
    var seq = getSeq(a), kind = a.kind || 'video', c = getClip(seq, a);
    var it = qeItem(seq, kind, a.track || 1, c);
    var name = a.transition || (kind === 'audio' ? 'Constant Power' : 'Cross Dissolve');
    var tr = kind === 'audio' ? qe.project.getAudioTransitionByName(name) : qe.project.getVideoTransitionByName(name);
    if (!tr) fail('Transition not found: ' + name);
    var dur = timecode(seq, a.duration || 0.5);
    var atStart = a.where === 'start';
    it.addTransition(tr, atStart, dur, '00:00:00:00', 0.5, false, true);
    return { transition: name, clip: c.name, where: atStart ? 'start' : 'end', duration: a.duration || 0.5 };
  };

  C.add_markers = function (a) {
    var seq = getSeq(a), res = [];
    for (var i = 0; i < a.markers.length; i++) {
      var m = a.markers[i], mk = seq.markers.createMarker(Number(m.at));
      if (m.name) mk.name = m.name;
      if (m.comment) mk.comments = m.comment;
      if (m.duration) mk.end = T(Number(m.at) + Number(m.duration));
      if (m.color !== undefined) { try { mk.setColorByIndex(Number(m.color)); } catch (e) {} }
      res.push({ at: m.at, name: m.name || '', guid: mk.guid });
    }
    return res;
  };

  C.get_markers = function (a) {
    var seq = getSeq(a), out = [], m = seq.markers.getFirstMarker();
    while (m) {
      out.push({ at: r3(m.start.seconds), end: r3(m.end.seconds), name: m.name, comment: m.comments, type: m.type, guid: m.guid });
      m = seq.markers.getNextMarker(m);
    }
    return out;
  };

  C.clear_markers = function (a) {
    var seq = getSeq(a), n = 0, m = seq.markers.getFirstMarker(), list = [];
    while (m) { list.push(m); m = seq.markers.getNextMarker(m); }
    for (var i = 0; i < list.length; i++) { seq.markers.deleteMarker(list[i]); n++; }
    return { removed: n };
  };

  C.add_captions_srt = function (a) {
    var seq = getSeq(a), item = importOne(a.srtPath, a.bin || 'Captions');
    var fmt = Sequence.CAPTION_FORMAT_SUBTITLE;
    var ok = seq.createCaptionTrack(item, Number(a.startAt || 0), fmt);
    return { created: !!ok, srt: a.srtPath };
  };

  C.add_mogrt = function (a) {
    var seq = getSeq(a);
    var f = new File(a.mogrtPath); if (!f.exists) fail('MOGRT not found: ' + a.mogrtPath);
    vTrack(seq, a.track || 2); aTrack(seq, a.track || 2);
    var vt = (a.track || 2) - 1;
    var clip = seq.importMGT(f.fsName, T(a.at || 0).ticks, vt, vt);
    if (!clip) fail('Premiere did not place the MOGRT.');
    if (a.duration) clip.end = T(Number(a.at || 0) + Number(a.duration));
    if (!clip.getMGTComponent()) {
      return { clip: clipInfo(clip, -1), editable: false,
        note: 'Placed. This is a Premiere-made template: Premiere does not let scripts change its text. Edit it in the Essential Graphics panel, or use create_text_graphic / an [AE] template for scripted text.' };
    }
    var set = [];
    if (a.texts || a.params) set = setMogrt(clip, a.texts || [], a.params || {});
    return { clip: clipInfo(clip, -1), editable: true, set: set, params: mogrtParams(clip) };
  };

  function mogrtParams(clip) {
    var comp = clip.getMGTComponent(), out = [];
    if (!comp) return out;
    for (var i = 0; i < comp.properties.numItems; i++) {
      var p = comp.properties[i], v = null;
      try { v = p.getValue(); } catch (e) {}
      var isText = false;
      if (typeof v === 'string' && v.indexOf('textEditValue') >= 0) {
        isText = true; try { v = parse(v).textEditValue; } catch (e) {}
      }
      out.push({ index: i, name: p.displayName, value: v, isText: isText });
    }
    return out;
  }
  function setMogrt(clip, texts, params) {
    var comp = clip.getMGTComponent(); if (!comp) fail('Not a MOGRT clip.');
    var done = [], ti = 0;
    for (var i = 0; i < comp.properties.numItems; i++) {
      var p = comp.properties[i], v = null;
      try { v = p.getValue(); } catch (e) {}
      if (params.hasOwnProperty(p.displayName)) {
        var nv = params[p.displayName];
        if (typeof v === 'string' && v.indexOf('textEditValue') >= 0) { var o = parse(v); o.textEditValue = String(nv); p.setValue(stringify(o), true); }
        else p.setValue(nv, true);
        done.push(p.displayName); continue;
      }
      if (typeof v === 'string' && v.indexOf('textEditValue') >= 0 && ti < texts.length) {
        var obj = parse(v); obj.textEditValue = String(texts[ti]); p.setValue(stringify(obj), true);
        done.push(p.displayName + ' = ' + texts[ti]); ti++;
      }
    }
    return done;
  }
  C.mogrt_params = function (a) { var seq = getSeq(a), c = getClip(seq, a); return mogrtParams(c); };
  C.set_mogrt = function (a) { var seq = getSeq(a), c = getClip(seq, a); return setMogrt(c, a.texts || [], a.params || {}); };

  // ---------- After Effects link ----------
  // The Dynamic Link item for comp `comp` of the AE project `aep`, if Premiere already has it.
  function aeItem(aep, comp) {
    var all = walk(proj().rootItem, '', [], function (c) { return c.type !== ProjectItemType.BIN; }), want = normPath(aep);
    for (var i = all.length - 1; i >= 0; i--) {
      var it = all[i].item, nm = String(it.name), mp = '';
      if (nm !== comp && nm.indexOf(comp + '/') !== 0) continue;
      try { mp = normPath(it.getMediaPath()); } catch (e) {}
      if (!mp || mp === want) return it;
    }
    return null;
  }
  // a: {aep, comp, bin, at, duration, track, name}. Places the live-linked comp: edits saved in AE show up here.
  C.import_ae_comp = function (a) {
    var seq = getSeq(a), bin = binByName(a.bin || 'Ultra AE', true), item = aeItem(a.aep, a.comp), fresh = false;
    if (!item) {
      var before = {}, all = walk(proj().rootItem, '', [], null), i;
      for (i = 0; i < all.length; i++) before[all[i].item.nodeId] = 1;
      var f = new File(a.aep); if (!f.exists) fail('After Effects project not found: ' + a.aep);
      proj().importAEComps(f.fsName, [a.comp], bin);
      all = walk(proj().rootItem, '', [], function (c) { return c.type !== ProjectItemType.BIN; });
      for (i = all.length - 1; i >= 0 && !item; i--) if (!before[all[i].item.nodeId]) item = all[i].item;
      if (!item) item = aeItem(a.aep, a.comp);
      if (!item) fail('Premiere did not import comp "' + a.comp + '" from ' + a.aep + ' (is the AE project saved?).');
      fresh = true;
    }
    if (a.at === undefined || a.at === null) return { item: item.name, itemId: item.nodeId, imported: fresh };
    var n = a.track || 7, tr = vTrack(seq, n);
    tr.overwriteClip(item, T(a.at).ticks);
    var c = clipsOnTrackAt(tr, a.at);
    if (c && a.duration) c.end = T(Number(a.at) + Number(a.duration));
    if (c && a.name) { try { c.name = a.name; } catch (en) {} }
    return { item: item.name, itemId: item.nodeId, imported: fresh, track: n, clip: c ? clipInfo(c, -1) : null };
  };
  C.refresh_media = function (a) {
    var it = itemByMedia(a.path); if (!it) fail('Not in the project: ' + a.path);
    try { it.refreshMedia(); } catch (e) { fail('Premiere could not refresh ' + a.path + ': ' + e.message); }
    return { refreshed: a.path };
  };

  C.set_playhead = function (a) { var seq = getSeq(a); seq.setPlayerPosition(T(a.at).ticks); return { playhead: a.at }; };

  C.set_work_area = function (a) { var seq = getSeq(a); seq.setInPoint(T(a.from).ticks); seq.setOutPoint(T(a.to).ticks); return { from: a.from, to: a.to }; };

  C.export_frame = function (a) {
    var seq = getSeq(a), qs = qeSeq(seq);
    var out = new File(a.outPath).fsName;   // Premiere wants a clean native path
    qs.exportFramePNG(timecode(seq, a.at), out);
    return { path: out, at: a.at };
  };

  C.export_sequence = function (a) {
    var seq = getSeq(a);
    var f = new File(a.presetPath); if (!f.exists) fail('Export preset not found: ' + a.presetPath);
    var area = a.workAreaOnly ? 2 : 0; // 0 = entire sequence, 2 = work area
    var ok = seq.exportAsMediaDirect(a.outPath, f.fsName, area);
    return { exported: ok, path: a.outPath };
  };

  C.queue_export = function (a) {
    var seq = getSeq(a);
    app.encoder.launchEncoder();
    var job = app.encoder.encodeSequence(seq, a.outPath, a.presetPath, a.workAreaOnly ? 2 : 0, 1);
    if (a.start) app.encoder.startBatch();
    return { queued: job, path: a.outPath };
  };

  C.save_project = function () { proj().save(); return { saved: proj().path }; };

  C.run_script = function (a) {
    var r = eval(a.code);
    try { return (r === undefined) ? null : parse(stringify(r)); } catch (e) { return String(r); }
  };

  function run(cmd, argStr) {
    try {
      if (!C.hasOwnProperty(cmd)) return stringify({ ok: false, error: 'Unknown command: ' + cmd });
      var args = argStr ? parse(argStr) : {};
      return stringify({ ok: true, result: C[cmd](args) });
    } catch (e) {
      return stringify({ ok: false, error: String(e.message || e) + (e.line ? ' (line ' + e.line + ')' : '') });
    }
  }

  return { run: run, commands: C };
})();
