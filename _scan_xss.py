import re, os, json
from collections import Counter

root = r'C:\Users\ADMIN\Desktop\muabankey\public\assets'
SAFE = re.compile(r'^(esc|icon|fmtVnd|fmtNum|fmtDate|timeAgo|bold|decodeKey|skeletonCards|loadingBlock|emptyBlock)\b')
SAFE2 = re.compile(r'^(data|state|route|JSON|Math|Number|String|Array|Object|Date|location|window|document|crypto)\b')
bad = []
for dp, dn, fn in os.walk(root):
    for f in fn:
        if not f.endswith('.js'): continue
        p = os.path.join(dp, f)
        src = open(p, encoding='utf-8').read()
        for i, l in enumerate(src.split('\n'), 1):
            for m in re.finditer(r'\$\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}', l):
                e = m.group(1).strip()
                if SAFE.match(e) or SAFE2.match(e): continue
                if 'esc(' in e or 'icon(' in e: continue
                if re.search(r'(\.length|\.map|\.join|\.padStart|\.toLocaleString|\? )', e): continue
                if re.fullmatch(r'[\w.\[\]\'"$ ]+', e) and not re.search(r'[a-zA-Z_$]\w*(\.\w+)*', e):
                    continue
                bad.append({'file': os.path.relpath(p, r'C:\Users\ADMIN\Desktop\muabankey'), 'line': i, 'expr': e[:100]})

c = Counter(b['expr'] for b in bad)
out = [{'count': v, 'expr': k} for k, v in c.most_common(60)]
print(json.dumps(out, ensure_ascii=False, indent=1))
