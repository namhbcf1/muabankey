import re, os, json

ROOT = r'C:\Users\ADMIN\Desktop\muabankey'
base = os.path.join(ROOT, 'src')
files = []
for dp, dn, fn in os.walk(base):
    for f in fn:
        if f.endswith('.js'):
            files.append(os.path.join(dp, f))

BUILTIN = set('''if for while switch catch function return typeof new class super this
console window document localStorage fetch setTimeout setInterval clearTimeout
Promise JSON Math Object Array String Number Boolean Date RegExp Error Map Set
Intl URL URLSearchParams FormData Headers Request Response AbortController
parseInt parseFloat isNaN encodeURIComponent decodeURIComponent btoa atob crypto
structuredClone TextEncoder TextDecoder Uint8Array Uint32Array Response Headers
decodeURIComponent encodeURI require'''.split())

results = []
for f in files:
    rel = os.path.relpath(f, ROOT)
    src = open(f, encoding='utf-8').read()
    s = re.sub(r'/\*.*?\*/', ' ', src, flags=re.S)
    s = re.sub(r'(?m)^\s*//.*$', ' ', s)
    s = re.sub(r'`(?:[^`\\]|\\.)*`', '`S`', s)
    s = re.sub(r"'(?:[^'\\\n]|\\.)*'", "''", s)
    s = re.sub(r'"(?:[^"\\\n]|\\.)*"', '""', s)

    local = set()
    for m in re.finditer(r'(?:function|const|let|var|class)\s+(\w+)', s):
        local.add(m.group(1))
    for m in re.finditer(r'import\s*\{([^}]+)\}', s, re.S):
        for n in m.group(1).split(','):
            n = n.strip().split(' as ')[-1].strip()
            if n: local.add(n)
    for m in re.finditer(r'import\s+\*\s+as\s+(\w+)', s):
        local.add(m.group(1))
    for m in re.finditer(r'(\w+)\s*=', s):
        local.add(m.group(1))
    for m in re.finditer(r'function[^(]*\(([^)]*)\)', s):
        for p in m.group(1).split(','):
            p = p.strip().split('=')[0].strip()
            if re.fullmatch(r'\w+', p or ''): local.add(p)
    for m in re.finditer(r'\(([^()]*)\)\s*=>', s):
        for p in m.group(1).split(','):
            p = p.strip().split('=')[0].strip()
            if re.fullmatch(r'\w+', p or ''): local.add(p)
    for m in re.finditer(r'(\w+)\s*=>', s):
        local.add(m.group(1))
    for m in re.finditer(r'catch\s*\(\s*(\w+)', s):
        local.add(m.group(1))
    for m in re.finditer(r'for\s*\(\s*(?:const|let|var)\s+(\w+)', s):
        local.add(m.group(1))

    for m in re.finditer(r'(?<![.\w$])([a-zA-Z_$][\w$]*)\s*\(', s):
        name = m.group(1)
        if name in BUILTIN or name in local: continue
        line = s[:m.start()].count('\n') + 1
        results.append({'file': rel, 'line': line, 'name': name})

print(json.dumps(results, ensure_ascii=False, indent=1))
