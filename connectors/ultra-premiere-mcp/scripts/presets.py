"""presets.py: read the user's Premiere effect presets (.prfpset) into JSON the bridge can re-apply.

    python presets.py <file.prfpset> <out.json>

Each preset -> {name, folder, effects:[{matchName, displayName, anchor, span, params:[{name, index, value, keys:[[sec, value]]}]}]}
anchor: 'in' | 'out' | 'scale' (how Premiere fits the preset's keyframes to a clip), span = preset length in seconds.
"""
import json, re, sys
import xml.etree.ElementTree as ET

TICKS = 254016000000
root = ET.parse(sys.argv[1]).getroot()
byid = {e.get('ObjectID'): e for e in root if e.get('ObjectID')}


def txt(e, path):
    n = e.find(path); return n.text if n is not None and n.text is not None else None


def val(s):
    if s is None: return None
    s = s.strip()
    if s in ('true', 'false'): return s == 'true'
    if ':' in s and all(re.fullmatch(r'-?[\d.e+-]+', p) for p in s.split(':')): return [float(p) for p in s.split(':')]
    if re.fullmatch(r'-?[\d.]+(e[+-]?\d+)?', s): return float(s)
    return s


def keys(s):
    out = []
    for k in (s or '').split(';'):
        f = k.split(',')
        if len(f) >= 2 and f[0].lstrip('-').isdigit():
            out.append([int(f[0]) / TICKS, val(f[1])])
    return out


def param(e, i):
    name = txt(e, 'Name') or ''
    tv = txt(e, 'IsTimeVarying') == 'true'
    cur = txt(e, 'CurrentValue')
    start = txt(e, 'StartKeyframe')
    # Premiere keeps a static value in CurrentValue for some params and in StartKeyframe for others:
    # a non-zero CurrentValue number wins, otherwise StartKeyframe (points use StartKeyframe's x:y form)
    sv = val(start.split(',')[1]) if start and ',' in start else None
    cv = val(cur) if cur is not None else None
    if isinstance(cv, float) and cv != 0: v = cv
    elif sv is not None: v = sv
    else: v = cv
    p = {'name': name, 'index': i, 'value': v}
    if tv: p['keys'] = keys(txt(e, 'Keyframes'))
    # values Premiere stores as blobs / colour longs are not re-applied
    if isinstance(v, str) and len(v) > 60: p['value'] = None
    return p


def effect(fp):
    comp = byid.get(fp.find('Component').get('ObjectRef')) if fp.find('Component') is not None else None
    if comp is None: return None
    c = comp.find('Component')
    params = []
    for pr in (c.find('Params') if c is not None and c.find('Params') is not None else []):
        pe = byid.get(pr.get('ObjectRef'))
        if pe is not None: params.append(param(pe, int(pr.get('Index'))))
    a_in = int(txt(fp, 'AnchorInPoint') or 0); a_out = int(txt(fp, 'AnchorOutPoint') or 0)
    ptype = txt(fp, 'Type')  # 0 scale, 1 anchor to in, 2 anchor to out
    return {'matchName': txt(fp, 'FilterMatchName') or txt(comp, 'MatchName'),
            'displayName': txt(c, 'DisplayName') if c is not None else None,
            'anchor': {'0': 'scale', '1': 'in', '2': 'out'}.get(ptype, 'in'),
            'span': (a_out - a_in) / TICKS, 'start': a_in / TICKS,
            'params': [p for p in params if p['name'].strip()]}


def preset(item, folder):
    base = item.find('TreeItemBase'); data = base.find('Data') if base is not None else None
    fpi = byid.get(data.get('ObjectRef')) if data is not None else None
    if fpi is None or fpi.tag != 'FilterPresetItem': return None
    effs = []
    fps = fpi.find('FilterPresets')
    for r in (fps if fps is not None else []):
        fp = byid.get(r.get('ObjectRef'))
        if fp is not None:
            e = effect(fp)
            if e: effs.append(e)
    return {'name': (txt(base, 'Name') or '').strip(), 'folder': folder, 'effects': effs}


out = []
def walk(bin_el, folder):
    items = bin_el.find('Items')
    for it in (items if items is not None else []):
        ch = byid.get(it.get('ObjectRef'))
        if ch is None: continue
        nm = (txt(ch, 'TreeItemBase/Name') or '').strip()
        if ch.tag == 'BinTreeItem': walk(ch, (folder + '/' if folder else '') + nm)
        else:
            p = preset(ch, folder)
            if p and p['effects']: out.append(p)

walk(byid['2'], '')
json.dump(out, open(sys.argv[2], 'w', encoding='utf-8'), indent=1)
print(len(out))
