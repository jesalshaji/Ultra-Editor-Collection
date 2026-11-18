"""stock.py: find free stock video for a phrase ("doing laundry", "walking in the city", "watching youtube").

    python stock.py search "<query>" <out.json> [--limit 8]      -> candidates + a thumbnail sheet
    python stock.py get <url> <out.mp4>                          -> download one

Sources (free, no account): Mixkit (Mixkit Free License, no credit needed) and Wikimedia Commons (CC licences:
credit noted in the result). Set PEXELS_API_KEY to also search Pexels (free key, best results).
"""
import json, os, re, subprocess, sys, urllib.parse, urllib.request

UA = {'User-Agent': 'Mozilla/5.0 (UltraPremiere b-roll finder)'}


def fetch(url, data=None, headers=None, timeout=30):
    req = urllib.request.Request(url, headers={**UA, **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout) as r: return r.read()


def mixkit(q, limit):
    slug = re.sub(r'[^a-z0-9]+', '-', q.lower()).strip('-')
    out = []
    for page in (f'https://mixkit.co/free-stock-video/{slug}/', f'https://mixkit.co/free-stock-video/discover/{slug}/'):
        try: h = fetch(page).decode('utf-8', 'ignore')
        except Exception: continue
        # each clip has a page /free-stock-video/<title-words>-<id>/ and a preview /videos/<id>/<id>-360.mp4
        for m in re.finditer(r'href="/free-stock-video/([a-z0-9-]+)-(\d{3,6})/"', h):
            title, vid = m.group(1).replace('-', ' '), m.group(2)
            if any(c['id'] == vid for c in out): continue
            out.append({'id': vid, 'source': 'mixkit', 'title': title, 'url': f'https://assets.mixkit.co/videos/{vid}/{vid}-720.mp4',
                        'preview': f'https://assets.mixkit.co/videos/{vid}/{vid}-360.mp4', 'page': f'https://mixkit.co/free-stock-video/{m.group(1)}-{vid}/',
                        'license': 'Mixkit Free License (no attribution required)'})
        if out: break
    return out[:limit]


def wikimedia(q, limit):
    api = 'https://commons.wikimedia.org/w/api.php?' + urllib.parse.urlencode({
        'action': 'query', 'generator': 'search', 'gsrsearch': f'{q} filetype:video', 'gsrnamespace': 6, 'gsrlimit': limit * 2,
        'prop': 'imageinfo', 'iiprop': 'url|size|mime|extmetadata', 'iiextmetadatafilter': 'LicenseShortName|Artist', 'format': 'json'})
    try: d = json.loads(fetch(api))
    except Exception: return []
    out = []
    for p in (d.get('query', {}).get('pages', {}) or {}).values():
        ii = p['imageinfo'][0]; dur = ii.get('duration') or 0
        if not (3 <= dur <= 240) or (ii.get('width') or 0) < 640: continue
        md = ii.get('extmetadata', {}); artist = re.sub('<[^>]+>', '', md.get('Artist', {}).get('value', ''))[:60]
        out.append({'id': 'wm' + str(p['pageid']), 'source': 'wikimedia', 'title': p['title'][5:].rsplit('.', 1)[0][:70], 'url': ii['url'], 'preview': ii['url'],
                    'page': ii.get('descriptionurl', ''), 'license': f"{md.get('LicenseShortName', {}).get('value', '?')} - credit: {artist or 'see page'}",
                    'duration': round(dur, 1), 'size': [ii.get('width'), ii.get('height')]})
    return out[:limit]


def pexels(q, limit):
    key = os.environ.get('PEXELS_API_KEY')
    if not key: return []
    try: d = json.loads(fetch('https://api.pexels.com/videos/search?' + urllib.parse.urlencode({'query': q, 'per_page': limit, 'orientation': 'landscape'}), headers={'Authorization': key}))
    except Exception: return []
    out = []
    for v in d.get('videos', []):
        files = sorted([f for f in v['video_files'] if f.get('width') and f['width'] <= 1920], key=lambda f: -f['width'])
        if not files: continue
        out.append({'id': 'px' + str(v['id']), 'source': 'pexels', 'title': v['url'].rstrip('/').split('/')[-1].rsplit('-', 1)[0].replace('-', ' '),
                    'url': files[0]['link'], 'preview': files[-1]['link'], 'page': v['url'], 'license': f"Pexels License - by {v['user']['name']}", 'duration': v['duration']})
    return out


def sheet(cands, out):
    """first frame of each preview, labelled with its number, in one image for Claude to look at"""
    d = os.path.dirname(out); thumbs = []
    for i, c in enumerate(cands):
        t = os.path.join(d, f'_thumb{i}.jpg')
        r = subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-y', '-ss', '1.5', '-i', c['preview'], '-frames:v', '1',
                            '-vf', f"scale=320:180:force_original_aspect_ratio=increase,crop=320:180", t], capture_output=True, timeout=60)
        if r.returncode == 0 and os.path.exists(t): thumbs.append((i, t))
    if not thumbs: return None
    ins = []; fc = []
    for k, (i, t) in enumerate(thumbs):
        ins += ['-i', t]; fc.append(f"[{k}:v]drawbox=x=0:y=0:w=34:h=30:color=black@0.7:t=fill,drawtext=fontfile=segoeuib.ttf:text='{i}':x=10:y=4:fontsize=22:fontcolor=white[v{k}]")
    n = len(thumbs); cols = 4; rows = (n + cols - 1) // cols
    lay = '|'.join(f'{(k % cols) * 320}_{(k // cols) * 180}' for k in range(n))
    fc.append(''.join(f'[v{k}]' for k in range(n)) + (f'xstack=inputs={n}:layout={lay}:fill=black' if n > 1 else 'null'))
    subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-y', *ins, '-filter_complex', ';'.join(fc), '-frames:v', '1', out], check=True,
                   cwd=os.path.join(os.environ.get('WINDIR', r'C:\Windows'), 'Fonts'))
    for _, t in thumbs: os.remove(t)
    return out


if __name__ == '__main__':
    if sys.argv[1] == 'search':
        q, out = sys.argv[2], sys.argv[3]; limit = int(sys.argv[sys.argv.index('--limit') + 1]) if '--limit' in sys.argv else 8
        cands = pexels(q, limit) + mixkit(q, limit)
        if len(cands) < 4: cands += wikimedia(q, 4)
        cands = cands[:limit]
        os.makedirs(os.path.dirname(out), exist_ok=True)
        sh = sheet(cands, out.replace('.json', '.jpg')) if cands else None
        json.dump({'query': q, 'candidates': cands, 'sheet': sh}, open(out, 'w', encoding='utf-8'), indent=1)
        print(out)
    elif sys.argv[1] == 'get':
        url, out = sys.argv[2], sys.argv[3]
        os.makedirs(os.path.dirname(out), exist_ok=True)
        open(out, 'wb').write(fetch(url, timeout=300)); print(out)
