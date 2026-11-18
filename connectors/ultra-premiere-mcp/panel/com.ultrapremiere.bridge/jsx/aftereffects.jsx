/* aftereffects.jsx: every After Effects command the Ultra AE Link can run (ExtendScript, ES3).
 * Entry point: AEMCP.run(cmdName, argsJsonString) -> JSON string {ok, result} or {ok:false, error}.
 * All times are FRAMES of the comp (0 = first frame), so every keyframe lands exactly on a frame.
 * Graphics are built editable: named layers, real keyframes, a CONTROLS null holding the colours,
 * and each command is one undo step (Ctrl+Z in After Effects). */

var AEMCP = (function () {
  // ---------- tiny JSON (ExtendScript has none) ----------
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
    if (v instanceof Array) { var a = []; for (var i = 0; i < v.length; i++) a.push(stringify(v[i])); return '[' + a.join(',') + ']'; }
    var o = [];
    for (var k in v) { if (v.hasOwnProperty(k) && typeof v[k] !== 'function') o.push(q(k) + ':' + stringify(v[k])); }
    return '{' + o.join(',') + '}';
  }
  function parse(s) { return eval('(' + s + ')'); }

  function fail(msg) { throw new Error(msg); }
  function r3(n) { return Math.round(n * 1000) / 1000; }
  function has(o, k) { return o && o.hasOwnProperty(k) && o[k] !== null && o[k] !== undefined; }
  function slash(p) { return String(p || '').replace(/\\/g, '/').toLowerCase(); }

  var FOLDER = 'Ultra Graphics';
  var CONTROLS = 'CONTROLS';

  // ---------- project ----------
  function projPath() { return app.project && app.project.file ? app.project.file.fsName : null; }
  // Make the AE project the one at `path` (one motion project per Premiere project).
  function ensureProject(path, switchProject) {
    if (!path) { if (!app.project) app.newProject(); return; }
    var want = new File(path);
    if (app.project && app.project.file && slash(app.project.file.fsName) === slash(want.fsName)) return;
    var empty = !app.project || (!app.project.file && app.project.numItems === 0);
    if (!empty && !switchProject) {
      fail('After Effects has another project open (' + (projPath() || 'unsaved') + '). Save/close it, or call again with switchProject=true ' +
        '(After Effects will ask whether to save it first).');
    }
    if (want.exists) { app.open(want); return; }
    if (!empty) { app.project.close(CloseOptions.PROMPT_TO_SAVE_CHANGES); app.newProject(); }
    if (!app.project) app.newProject();
    new Folder(want.parent.fsName).create();
    app.project.save(want);
  }
  function save() { if (app.project.file) app.project.save(); return projPath(); }

  function folder() {
    for (var i = 1; i <= app.project.numItems; i++) {
      var it = app.project.item(i); if (it instanceof FolderItem && it.name === FOLDER) return it;
    }
    return app.project.items.addFolder(FOLDER);
  }
  function findComp(name, quiet) {
    for (var i = 1; i <= app.project.numItems; i++) {
      var it = app.project.item(i); if (it instanceof CompItem && (it.name === name || String(it.id) === String(name))) return it;
    }
    if (!quiet) fail('Comp not found in After Effects: ' + name);
    return null;
  }
  function F(comp, f) { return Number(f) * comp.frameDuration; }           // frame -> seconds
  function toF(comp, t) { return Math.round(t / comp.frameDuration); }       // seconds -> frame

  // ---------- colours ----------
  // colour spec from Node: [r,g,b] 0-1 (literal) or {ctrl:"Accent", value:[r,g,b]} (linked to CONTROLS)
  function rgba(c) { var v = c.value || c; return [v[0], v[1], v[2], v.length > 3 ? v[3] : 1]; }
  function ctrlExpr(name) { return 'thisComp.layer("' + CONTROLS + '").effect("' + name + '")(1)'; }
  function setColor(prop, c) {
    if (!c) return;
    prop.setValue(rgba(c));
    try { prop.expression = c.ctrl ? ctrlExpr(c.ctrl) : ''; } catch (e) {}
  }

  // ---------- property lookup ----------
  var ALIAS = {
    position: ['ADBE Transform Group', 'ADBE Position'], scale: ['ADBE Transform Group', 'ADBE Scale'],
    opacity: ['ADBE Transform Group', 'ADBE Opacity'], rotation: ['ADBE Transform Group', 'ADBE Rotate Z'],
    anchor: ['ADBE Transform Group', 'ADBE Anchor Point'],
    size: ['ADBE Root Vectors Group', 'Box', 'ADBE Vectors Group', 'Shape', 'SIZE'],
    radius: ['ADBE Root Vectors Group', 'Box', 'ADBE Vectors Group', 'Shape', 'ROUND'],
    fill: ['ADBE Root Vectors Group', 'Box', 'ADBE Vectors Group', 'ADBE Vector Graphic - Fill', 'ADBE Vector Fill Color'],
    strokeWidth: ['ADBE Root Vectors Group', 'Box', 'ADBE Vectors Group', 'ADBE Vector Graphic - Stroke', 'ADBE Vector Stroke Width'],
    strokeColor: ['ADBE Root Vectors Group', 'Box', 'ADBE Vectors Group', 'ADBE Vector Graphic - Stroke', 'ADBE Vector Stroke Color'],
    trimStart: ['ADBE Root Vectors Group', 'Box', 'ADBE Vectors Group', 'ADBE Vector Filter - Trim', 'ADBE Vector Trim Start'],
    trimEnd: ['ADBE Root Vectors Group', 'Box', 'ADBE Vectors Group', 'ADBE Vector Filter - Trim', 'ADBE Vector Trim End'],
    text: ['ADBE Text Properties', 'ADBE Text Document']
  };
  function child(group, key) {
    if (key === 'SIZE' || key === 'ROUND') {
      var shape = group;                                     // the rect/ellipse named "Shape"
      if (key === 'SIZE') return shape.property('ADBE Vector Rect Size') || shape.property('ADBE Vector Ellipse Size');
      return shape.property('ADBE Vector Rect Roundness');
    }
    return group.property(key);
  }
  // prop = alias ("position"), effect control ("fx:Accent"), or a path of names/matchNames ("Effects/Blur/Blurriness")
  function getProp(layer, name) {
    var p = layer, parts, i;
    if (ALIAS[name]) parts = ALIAS[name];
    else if (/^fx:/.test(name)) { var e = layer.property('ADBE Effect Parade').property(name.slice(3)); if (!e) fail('No effect "' + name.slice(3) + '" on ' + layer.name); return e.property(1); }
    else parts = String(name).split('/');
    for (i = 0; i < parts.length; i++) {
      p = child(p, parts[i] === 'Effects' ? 'ADBE Effect Parade' : parts[i]);
      if (!p) fail('Layer "' + layer.name + '" has no property "' + name + '"');
    }
    return p;
  }
  function getLayer(comp, name) {
    if (typeof name === 'number') return comp.layer(name);
    for (var i = 1; i <= comp.numLayers; i++) if (comp.layer(i).name === name) return comp.layer(i);
    fail('No layer "' + name + '" in comp ' + comp.name);
  }

  // ---------- keyframes ----------
  // key: {f, v, ease:'smooth'|'easy'|'linear'|'hold'|number(influence %), easeIn, easeOut}
  function easeArr(prop, infl) {
    var out = [];
    var n = (prop.propertyValueType === PropertyValueType.TwoD ? 2 : prop.propertyValueType === PropertyValueType.ThreeD ? 3 : 1);
    for (var i = 0; i < n; i++) out.push(new KeyframeEase(0, Math.max(0.1, Math.min(100, infl))));
    return out;
  }
  function influence(e) {
    if (typeof e === 'number') return e;
    return { smooth: 70, easy: 33.33, snap: 90, soft: 50 }[e] || 70;
  }
  function applyEase(prop, k, key) {
    var e = key.ease || 'smooth';
    if (e === 'linear') { prop.setInterpolationTypeAtKey(k, KeyframeInterpolationType.LINEAR, KeyframeInterpolationType.LINEAR); return; }
    if (e === 'hold') { prop.setInterpolationTypeAtKey(k, KeyframeInterpolationType.HOLD, KeyframeInterpolationType.HOLD); return; }
    prop.setInterpolationTypeAtKey(k, KeyframeInterpolationType.BEZIER, KeyframeInterpolationType.BEZIER);
    var iIn = influence(has(key, 'easeIn') ? key.easeIn : e), iOut = influence(has(key, 'easeOut') ? key.easeOut : e);
    try { prop.setTemporalEaseAtKey(k, easeArr(prop, iIn), easeArr(prop, iOut)); } catch (x) {}
    if (prop.isSpatial) {   // straight moves, no auto-bezier overshoot
      try { prop.setSpatialAutoBezierAtKey(k, false); prop.setSpatialContinuousAtKey(k, false); } catch (x2) {}
      try { var z = prop.value.length === 3 ? [0, 0, 0] : [0, 0]; prop.setSpatialTangentsAtKey(k, z, z); } catch (x3) {}
    }
  }
  function textValue(prop, v) { var td = prop.value; td.text = String(v); return td; }
  function value(prop, v) {
    if (prop.propertyValueType === PropertyValueType.TEXT_DOCUMENT) return textValue(prop, v);
    if (prop.propertyValueType === PropertyValueType.COLOR) return rgba(v);
    return v;
  }
  function setKeys(comp, layer, propName, keys, keepOld) {
    var prop = getProp(layer, propName);
    if (!keepOld) while (prop.numKeys > 0) prop.removeKey(1);
    var i, idx = [];
    for (i = 0; i < keys.length; i++) prop.setValueAtTime(F(comp, keys[i].f), value(prop, keys[i].v));
    for (i = 0; i < keys.length; i++) { var k = prop.nearestKeyIndex(F(comp, keys[i].f)); applyEase(prop, k, keys[i]); idx.push(k); }
    return { prop: propName, keys: prop.numKeys };
  }
  function setStatic(layer, propName, v) {
    var prop = getProp(layer, propName);
    while (prop.numKeys > 0) prop.removeKey(1);
    if (propName === 'fill' || propName === 'strokeColor') { setColor(prop, v); return; }
    prop.setValue(value(prop, v));
  }

  // ---------- layer builders ----------
  function textDoc(layer, s) {
    var prop = layer.property('ADBE Text Properties').property('ADBE Text Document');
    var td = prop.value;
    try { td.resetCharStyle(); td.resetParagraphStyle(); } catch (e) {}
    if (has(s, 'text')) td.text = String(s.text);
    if (s.font) td.font = s.font;
    td.fontSize = s.fontSize || 64;
    td.applyFill = true; td.applyStroke = false;
    td.fillColor = s.color ? rgba(s.color).slice(0, 3) : [1, 1, 1];
    td.justification = s.justify === 'center' ? ParagraphJustification.CENTER_JUSTIFY
      : s.justify === 'right' ? ParagraphJustification.RIGHT_JUSTIFY : ParagraphJustification.LEFT_JUSTIFY;
    if (has(s, 'tracking')) td.tracking = s.tracking;
    if (has(s, 'leading')) { try { td.autoLeading = false; td.leading = s.leading; } catch (e2) {} }
    prop.setValue(td);
    // linked text colour: a Fill effect driven by CONTROLS (change the colour once, every text follows)
    if (s.color && s.color.ctrl) {
      var fx = layer.property('ADBE Effect Parade').addProperty('ADBE Fill');
      fx.name = 'Colour';
      setColor(fx.property('ADBE Fill-0002'), s.color);
    }
    if (s.textExpr) prop.expression = s.textExpr;
  }
  function anchorText(comp, layer, at) {   // at: [ax, ay] 0-1 of the text box (0.5,0.5 = centre)
    var r = layer.sourceRectAtTime(0, false);
    var p = layer.property('ADBE Transform Group').property('ADBE Anchor Point');
    p.setValue([r.left + r.width * at[0], r.top + r.height * at[1]]);
  }
  function shapeLayer(comp, s) {
    var L = comp.layers.addShape();
    var grp = L.property('ADBE Root Vectors Group').addProperty('ADBE Vector Group'); grp.name = 'Box';
    var vecs = grp.property('ADBE Vectors Group');
    var sh = vecs.addProperty(s.type === 'ellipse' ? 'ADBE Vector Shape - Ellipse' : 'ADBE Vector Shape - Rect'); sh.name = 'Shape';
    child(sh, 'SIZE').setValue(s.size || [400, 200]);
    if (s.type !== 'ellipse') sh.property('ADBE Vector Rect Roundness').setValue(has(s, 'radius') ? s.radius : 0);
    if (s.align === 'left') sh.property(s.type === 'ellipse' ? 'ADBE Vector Ellipse Position' : 'ADBE Vector Rect Position').setValue([(s.size || [400, 200])[0] / 2, 0]);
    if (s.trim) { var tr = vecs.addProperty('ADBE Vector Filter - Trim'); tr.name = 'Trim'; }
    if (s.stroke) {
      var st = vecs.addProperty('ADBE Vector Graphic - Stroke'); st.name = 'Stroke';
      setColor(st.property('ADBE Vector Stroke Color'), s.stroke.color || [1, 1, 1]);
      st.property('ADBE Vector Stroke Width').setValue(s.stroke.width || 3);
    }
    if (s.fill) { var fl = vecs.addProperty('ADBE Vector Graphic - Fill'); fl.name = 'Fill'; setColor(fl.property('ADBE Vector Fill Color'), s.fill); }
    return L;
  }
  function addEffects(layer, list) {
    for (var i = 0; i < (list || []).length; i++) {
      var e = list[i], fx = layer.property('ADBE Effect Parade').addProperty(e.match);
      if (e.name) fx.name = e.name;
      for (var k in (e.props || {})) if (e.props.hasOwnProperty(k)) {
        var p = fx.property(k); if (!p) fail('Effect ' + e.match + ' has no "' + k + '"');
        if (e.props[k] && e.props[k].ctrl) setColor(p, e.props[k]); else p.setValue(e.props[k]);
      }
    }
  }
  function buildLayer(comp, s) {
    var L, t = s.type || 'rect';
    if (t === 'text') {
      L = s.box ? comp.layers.addBoxText(s.box, String(s.text || ' ')) : comp.layers.addText(String(s.text || ' '));
      textDoc(L, s);
      if (s.anchorAt) anchorText(comp, L, s.anchorAt);
    } else if (t === 'rect' || t === 'ellipse') L = shapeLayer(comp, s);
    else if (t === 'null') L = comp.layers.addNull(comp.duration);
    else if (t === 'solid') L = comp.layers.addSolid(s.color ? rgba(s.color).slice(0, 3) : [0, 0, 0], s.name || 'Solid', s.size ? s.size[0] : comp.width, s.size ? s.size[1] : comp.height, 1);
    else if (t === 'adjustment') { L = comp.layers.addSolid([1, 1, 1], s.name || 'Adjustment', comp.width, comp.height, 1); L.adjustmentLayer = true; }
    else if (t === 'footage') {
      var f = new File(s.path); if (!f.exists) fail('File not found: ' + s.path);
      var item = app.project.importFile(new ImportOptions(f)); item.parentFolder = folder();
      L = comp.layers.add(item);
    } else fail('Unknown layer type: ' + t);
    if (s.name) L.name = s.name;
    var T = L.property('ADBE Transform Group');
    if (has(s, 'anchor')) T.property('ADBE Anchor Point').setValue(s.anchor);
    if (has(s, 'position')) T.property('ADBE Position').setValue(s.position);
    if (has(s, 'scale')) T.property('ADBE Scale').setValue(s.scale);
    if (has(s, 'rotation')) T.property('ADBE Rotate Z').setValue(s.rotation);
    if (has(s, 'opacity')) T.property('ADBE Opacity').setValue(s.opacity);
    addEffects(L, s.effects);
    if (has(s, 'in')) L.inPoint = F(comp, s['in']);
    if (has(s, 'out')) L.outPoint = F(comp, s.out);
    if (s.label !== undefined) { try { L.label = s.label; } catch (e) {} }
    if (s.comment) L.comment = s.comment;
    return L;
  }
  function finishLayer(comp, L, s) {   // things that need every layer to exist first
    if (s.parent) {
      // child position = offset from the parent's centre (no jump compensation), and it fades with the parent
      var P = getLayer(comp, s.parent);
      if (L.setParentWithJump) L.setParentWithJump(P); else L.parent = P;
      if (s.inheritOpacity !== false) getProp(L, 'opacity').expression = 'value * parent.transform.opacity / 100';
    }
    for (var p in (s.keys || {})) if (s.keys.hasOwnProperty(p)) setKeys(comp, L, p, s.keys[p]);
    for (var x in (s.expressions || {})) if (s.expressions.hasOwnProperty(x)) getProp(L, x).expression = s.expressions[x];
    if (s.essential) addEssential(comp, L, s.essentialProp || (s.type === 'text' ? 'text' : 'fill'), s.essential);
    if (s.blend === 'add') L.blendingMode = BlendingMode.ADD;
  }

  // Size a card to the real text inside it. s.fit = {layers:[names], padX, padY, minWidth, height}
  // Text layers are children of the card, so their extents are in the card's own space.
  function extents(comp, names) {
    var b = null;
    for (var i = 0; i < names.length; i++) {
      var L = getLayer(comp, names[i]), r = L.sourceRectAtTime(0, false), T = L.property('ADBE Transform Group');
      var p = T.property('ADBE Position').valueAtTime(0, true), a = T.property('ADBE Anchor Point').value, sc = T.property('ADBE Scale').value;
      var x0 = p[0] + (r.left - a[0]) * sc[0] / 100, y0 = p[1] + (r.top - a[1]) * sc[1] / 100;
      var x1 = x0 + r.width * sc[0] / 100, y1 = y0 + r.height * sc[1] / 100;
      if (!b) b = [x0, y0, x1, y1]; else b = [Math.min(b[0], x0), Math.min(b[1], y0), Math.max(b[2], x1), Math.max(b[3], y1)];
    }
    return b;
  }
  function fitBox(comp, L, s) {
    var f = s.fit, b = extents(comp, f.layers), px = f.padX || 40, py = f.padY || 30, w, h;
    if (s.align === 'left') w = b[2] + px; else w = 2 * Math.max(Math.abs(b[0]), Math.abs(b[2])) + 2 * px;
    h = f.height || 2 * Math.max(Math.abs(b[1]), Math.abs(b[3])) + 2 * py;
    w = Math.max(w, f.minWidth || 0);
    var sh = getProp(L, 'size'); while (sh.numKeys) sh.removeKey(1); sh.setValue([w, h]);
    if (s.align === 'left') { try { L.property('ADBE Root Vectors Group').property('Box').property('ADBE Vectors Group').property('Shape').property('ADBE Vector Rect Position').setValue([w / 2, 0]); } catch (e) {} }
    return [w, h];
  }
  // Lay word layers side by side (real widths), wrapping at maxWidth. row = {layers, y, x, maxWidth, gap, lineHeight}
  function layoutRow(comp, row) {
    var lines = [[]], widths = [0], gap = row.gap || 18, maxW = row.maxWidth || comp.width * 0.8, i;
    var info = [];
    for (i = 0; i < row.layers.length; i++) {
      var L = getLayer(comp, row.layers[i]), r = L.sourceRectAtTime(0, false);
      L.property('ADBE Transform Group').property('ADBE Anchor Point').setValue([r.left + r.width / 2, r.top + r.height / 2]);
      var w = r.width, cur = lines.length - 1;
      if (lines[cur].length && widths[cur] + gap + w > maxW) { lines.push([]); widths.push(0); cur++; }
      widths[cur] += (lines[cur].length ? gap : 0) + w; lines[cur].push({ L: L, w: w });
    }
    var lh = row.lineHeight || 90, y0 = (row.y || comp.height / 2) - (lines.length - 1) * lh / 2;
    for (var l = 0; l < lines.length; l++) {
      var x = (row.x || comp.width / 2) - widths[l] / 2;
      for (var j = 0; j < lines[l].length; j++) {
        var it = lines[l][j], pos = it.L.property('ADBE Transform Group').property('ADBE Position');
        var at = [x + it.w / 2, y0 + l * lh];
        if (pos.numKeys) {   // keep the move, end on the laid-out spot
          var last = pos.keyValue(pos.numKeys), dx = at[0] - last[0], dy = at[1] - last[1];
          for (var k = 1; k <= pos.numKeys; k++) { var v = pos.keyValue(k); pos.setValueAtKey(k, [v[0] + dx, v[1] + dy]); }
        } else pos.setValue(at);
        x += it.w + gap;
      }
    }
    return lines.length;
  }

  function addControls(comp, list) {
    if (!list || !list.length) return null;
    var L = null;
    for (var i = 1; i <= comp.numLayers; i++) if (comp.layer(i).name === CONTROLS) L = comp.layer(i);
    if (!L) { L = comp.layers.addNull(comp.duration); L.name = CONTROLS; L.label = 9; L.comment = 'Change colours and numbers here: every linked layer follows.'; }
    var fxs = L.property('ADBE Effect Parade');
    for (var j = 0; j < list.length; j++) {
      var c = list[j], m = { color: 'ADBE Color Control', slider: 'ADBE Slider Control', checkbox: 'ADBE Checkbox Control', angle: 'ADBE Angle Control', point: 'ADBE Point Control' }[c.type || 'color'];
      var fx = fxs.property(c.name) || fxs.addProperty(m); fx.name = c.name;
      var p = fx.property(1);
      if (c.keys) { while (p.numKeys) p.removeKey(1); setKeys(comp, L, 'fx:' + c.name, c.keys, true); }
      else if (has(c, 'value')) p.setValue(c.type === 'color' || !c.type ? rgba(c.value) : c.value);
      if (c.essential) addEssentialProp(comp, p, c.essential);
    }
    return L;
  }
  function addEssentialProp(comp, prop, name) {
    try {
      if (prop.canAddToMotionGraphicsTemplate && !prop.canAddToMotionGraphicsTemplate(comp)) return false;
      if (prop.addToMotionGraphicsTemplateAs) prop.addToMotionGraphicsTemplateAs(comp, name); else prop.addToMotionGraphicsTemplate(comp);
      return true;
    } catch (e) { return false; }
  }
  function addEssential(comp, L, propName, name) { return addEssentialProp(comp, getProp(L, propName), name); }

  // ---------- read back (everything in frames) ----------
  function round(v) {
    if (v instanceof Array) { var o = []; for (var i = 0; i < v.length; i++) o.push(r3(v[i])); return o; }
    if (typeof v === 'number') return r3(v);
    try { if (v && v.text !== undefined) return v.text; } catch (e) {}
    return v;
  }
  function interp(t) { return t === KeyframeInterpolationType.HOLD ? 'hold' : t === KeyframeInterpolationType.LINEAR ? 'linear' : 'bezier'; }
  function readAnimated(comp, group, path, out) {
    for (var i = 1; i <= group.numProperties; i++) {
      var p = group.property(i), nm = path ? path + '/' + p.name : p.name;
      if (p.propertyType === PropertyType.PROPERTY) {
        var keyed = p.numKeys > 0, ex = p.canSetExpression && p.expressionEnabled && p.expression;
        if (!keyed && !ex) continue;
        var o = { prop: nm };
        if (keyed) {
          o.keys = [];
          for (var k = 1; k <= p.numKeys; k++) {
            var kv = { f: toF(comp, p.keyTime(k)), v: round(p.keyValue(k)), ease: interp(p.keyOutInterpolationType(k)) };
            try { if (kv.ease === 'bezier') kv.influence = r3(p.keyOutTemporalEase(k)[0].influence); } catch (e) {}
            o.keys.push(kv);
          }
        }
        if (ex) o.expression = p.expression;
        out.push(o);
      } else if (p.numProperties) readAnimated(comp, p, nm, out);
    }
    return out;
  }
  function staticVals(L) {
    var T = L.property('ADBE Transform Group'), o = {};
    o.position = round(T.property('ADBE Position').value); o.scale = round(T.property('ADBE Scale').value);
    o.opacity = round(T.property('ADBE Opacity').value); o.rotation = round(T.property('ADBE Rotate Z').value);
    try { o.text = L.property('ADBE Text Properties').property('ADBE Text Document').value.text; } catch (e) {}
    try { o.size = round(getProp(L, 'size').value); o.radius = round(getProp(L, 'radius').value); } catch (e2) {}
    return o;
  }
  function compInfo(comp, detail) {
    var o = { name: comp.name, id: comp.id, width: comp.width, height: comp.height, fps: r3(comp.frameRate),
      frames: toF(comp, comp.duration), seconds: r3(comp.duration), layers: [] };
    for (var i = 1; i <= comp.numLayers; i++) {
      var L = comp.layer(i), l = { index: i, name: L.name, 'in': toF(comp, L.inPoint), out: toF(comp, L.outPoint), enabled: L.enabled };
      if (L.parent) l.parent = L.parent.name;
      if (detail) {
        l.values = staticVals(L);
        l.animated = readAnimated(comp, L, '', []);
        var fx = L.property('ADBE Effect Parade'); l.effects = [];
        for (var e = 1; e <= fx.numProperties; e++) {
          var ef = fx.property(e), eo = { name: ef.name, match: ef.matchName };
          if (L.name === CONTROLS) eo.value = round(ef.property(1).value);
          l.effects.push(eo);
        }
      }
      o.layers.push(l);
    }
    return o;
  }

  // ---------- commands ----------
  var C = {};
  C.ping = function () {
    return { app: 'After Effects', version: app.version, project: projPath(), comps: listComps().length,
      scriptsCanWriteFiles: (function () { try { return app.preferences.getPrefAsLong('Main Pref Section', 'Pref_SCRIPTING_FILE_NETWORK_SECURITY') === 1; } catch (e) { return null; } })() };
  };
  function listComps() {
    var out = [];
    if (!app.project) return out;
    for (var i = 1; i <= app.project.numItems; i++) {
      var it = app.project.item(i);
      if (it instanceof CompItem) out.push({ name: it.name, id: it.id, width: it.width, height: it.height, fps: r3(it.frameRate),
        frames: toF(it, it.duration), layers: it.numLayers, folder: it.parentFolder ? it.parentFolder.name : '' });
    }
    return out;
  }
  C.get_project = function () { return { project: projPath(), comps: listComps() }; };
  C.ensure_project = function (a) { ensureProject(a.project, a.switchProject); return { project: save() }; };

  // Build (or rebuild in place, keeping the Dynamic Link) a whole graphic from a spec.
  C.build_comp = function (a) {
    ensureProject(a.project, a.switchProject);
    var s = a.comp, comp = findComp(s.name, true), rebuilt = !!comp, i;
    var secs = Number(s.frames) / Number(s.fps);
    if (comp) {
      while (comp.numLayers > 0) comp.layer(1).remove();
      comp.width = s.width; comp.height = s.height; comp.frameRate = s.fps; comp.duration = secs;
    } else {
      comp = app.project.items.addComp(s.name, s.width, s.height, 1, secs, s.fps);
      comp.parentFolder = folder();
    }
    comp.bgColor = s.bg ? rgba(s.bg).slice(0, 3) : [0.04, 0.035, 0.06];
    comp.displayStartTime = 0;
    if (a.mogrtName) { try { comp.motionGraphicsTemplateName = a.mogrtName; } catch (e) {} }
    addControls(comp, a.controls);
    var layers = a.layers || [], made = [];
    for (i = layers.length - 1; i >= 0; i--) made[i] = buildLayer(comp, layers[i]);   // list[0] ends on top
    for (i = 0; i < layers.length; i++) finishLayer(comp, made[i], layers[i]);
    for (i = 0; i < layers.length; i++) if (layers[i].fit) fitBox(comp, made[i], layers[i]);
    for (i = 0; i < (a.rows || []).length; i++) layoutRow(comp, a.rows[i]);
    // CONTROLS stays on top so it is the first thing you see
    for (i = 1; i <= comp.numLayers; i++) if (comp.layer(i).name === CONTROLS) { comp.layer(i).moveToBeginning(); break; }
    if (a.comment) comp.comment = a.comment;
    save();
    return { rebuilt: rebuilt, project: projPath(), comp: compInfo(comp, false) };
  };

  C.get_comp = function (a) { return compInfo(findComp(a.comp), a.detail !== false); };

  // Frame-exact edits on an existing comp; the comp keeps its identity so Dynamic Link updates by itself.
  // a.changes: [{layer, set:{prop:value}, keys:{prop:[{f,v,ease}]}, addKeys:{prop:[...]}, removeKeys:{prop:[f,...]},
  //              shift:frames, in, out, name, text, enabled, remove:true}]
  // a.controls: [{name, type, value|keys}], a.addLayers: [layer spec], a.frames: new comp length
  C.edit_comp = function (a) {
    var comp = findComp(a.comp), log = [], i;
    if (has(a, 'frames')) { comp.duration = F(comp, a.frames); log.push('comp length ' + a.frames + ' frames'); }
    if (a.controls) { addControls(comp, a.controls); log.push('controls ' + a.controls.length); }
    var ch = a.changes || [];
    for (i = 0; i < ch.length; i++) {
      var c = ch[i], L = getLayer(comp, c.layer), k;
      if (c.remove) { L.remove(); log.push('removed ' + c.layer); continue; }
      if (has(c, 'text')) { setStatic(L, 'text', c.text); log.push(L.name + ' text'); }
      for (k in (c.set || {})) if (c.set.hasOwnProperty(k)) { setStatic(L, k, c.set[k]); log.push(L.name + ' ' + k); }
      for (k in (c.keys || {})) if (c.keys.hasOwnProperty(k)) { setKeys(comp, L, k, c.keys[k]); log.push(L.name + ' ' + k + ' keys'); }
      for (k in (c.addKeys || {})) if (c.addKeys.hasOwnProperty(k)) { setKeys(comp, L, k, c.addKeys[k], true); log.push(L.name + ' +' + k + ' keys'); }
      for (k in (c.removeKeys || {})) if (c.removeKeys.hasOwnProperty(k)) {
        var p = getProp(L, k), fr = c.removeKeys[k];
        for (var j = 0; j < fr.length; j++) { var t = F(comp, fr[j]); for (var n = p.numKeys; n >= 1; n--) if (Math.abs(p.keyTime(n) - t) < comp.frameDuration / 2) p.removeKey(n); }
        log.push(L.name + ' -' + k + ' keys');
      }
      if (has(c, 'shift')) { L.startTime += F(comp, c.shift); log.push(L.name + ' shifted ' + c.shift + 'f'); }
      if (has(c, 'in')) L.inPoint = F(comp, c['in']);
      if (has(c, 'out')) L.outPoint = F(comp, c.out);
      if (has(c, 'enabled')) L.enabled = !!c.enabled;
      if (c.effects) addEffects(L, c.effects);
      if (c.name) L.name = c.name;
    }
    var add = a.addLayers || [], made = [];
    for (i = add.length - 1; i >= 0; i--) made[i] = buildLayer(comp, add[i]);
    for (i = 0; i < add.length; i++) { finishLayer(comp, made[i], add[i]); log.push('added ' + made[i].name); }
    save();
    return { comp: comp.name, done: log, project: projPath() };
  };

  C.open_comp = function (a) {
    var comp = findComp(a.comp); comp.openInViewer();
    if (has(a, 'frame')) comp.time = F(comp, a.frame);
    return { opened: comp.name, frame: toF(comp, comp.time) };
  };

  C.export_mogrt = function (a) {
    var comp = findComp(a.comp);
    if (a.name) { try { comp.motionGraphicsTemplateName = a.name; } catch (e) {} }
    var f = new File(a.outPath); new Folder(f.parent.fsName).create();
    if (!comp.exportAsMotionGraphicsTemplate) fail('This After Effects version cannot export .mogrt from a script.');
    var ok = comp.exportAsMotionGraphicsTemplate(true, f.fsName);
    if (!ok) fail('After Effects did not export the .mogrt (does the comp have Essential Graphics properties?).');
    return { mogrt: f.fsName };
  };

  // Render the comp with transparency (ProRes 4444 / lossless with alpha).
  C.render_comp = function (a) {
    var comp = findComp(a.comp), rq = app.project.renderQueue, paused = [], i;
    for (i = 1; i <= rq.numItems; i++) if (rq.item(i).status === RQItemStatus.QUEUED) { rq.item(i).render = false; paused.push(i); }
    var item = rq.items.add(comp);
    try { item.applyTemplate('Best Settings'); } catch (e) {}
    var om = item.outputModule(1), tpl = null, ts = om.templates;
    var prefer = a.alpha === false ? [/high quality$/i, /lossless$/i] : [/high quality with alpha/i, /lossless with alpha/i, /alpha/i];
    for (var pI = 0; pI < prefer.length && !tpl; pI++) for (i = 0; i < ts.length; i++) if (prefer[pI].test(ts[i])) { tpl = ts[i]; break; }
    if (tpl) om.applyTemplate(tpl);
    var f = new File(a.outPath); new Folder(f.parent.fsName).create();
    om.file = f;
    try { rq.render(); }
    finally {
      for (i = 0; i < paused.length; i++) try { rq.item(paused[i]).render = true; } catch (e2) {}
    }
    var outFile = om.file.fsName;
    try { item.remove(); } catch (e3) {}
    return { file: outFile, template: tpl };
  };

  C.save_project = function (a) { if (a && a.path) app.project.save(new File(a.path)); else save(); return { project: projPath() }; };

  C.run_script = function (a) {
    var r = eval(a.code);
    try { return (r === undefined) ? null : parse(stringify(r)); } catch (e) { return String(r); }
  };

  var UNDO = { build_comp: 'Ultra: build graphic', edit_comp: 'Ultra: edit graphic', run_script: 'Ultra: script' };
  function run(cmd, argStr) {
    var undo = UNDO[cmd];
    try {
      if (!C.hasOwnProperty(cmd)) return stringify({ ok: false, error: 'Unknown command: ' + cmd });
      var args = argStr ? parse(argStr) : {};
      if (undo) app.beginUndoGroup(undo);
      var res = C[cmd](args);
      if (undo) app.endUndoGroup();
      return stringify({ ok: true, result: res });
    } catch (e) {
      if (undo) { try { app.endUndoGroup(); } catch (e2) {} }
      return stringify({ ok: false, error: String(e.message || e) + (e.line ? ' (line ' + e.line + ')' : '') });
    }
  }
  return { run: run, commands: C };
})();
