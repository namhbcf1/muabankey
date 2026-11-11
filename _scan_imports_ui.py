import re, os, json

base = r'C:\Users\ADMIN\Desktop\muabankey\public\assets'
files = []
for dp, dn, fn in os.walk(base):
    for f in fn:
        if f.endswith('.js'):
            files.append(os.path.join(dp, f))

defined = {}
for f in files:
    rel = os.path.relpath(f, r'C:\Users\ADMIN\Desktop\muabankey')
    src = open(f, encoding='utf-8').read()
    for m in re.finditer(r'export\s+(?:async\s+)?function\s+(\w+)', src):
        defined.setdefault(m.group(1), []).append(rel)
    for m in re.finditer(r'export\s+(?:const|let|class)\s+(\w+)', src):
        defined.setdefault(m.group(1), []).append(rel)

# for each file, gather imports and check named imports exist
missing = []
for f in files:
    rel = os.path.relpath(f, r'C:\Users\ADMIN\Desktop\muabankey')
    src = open(f, encoding='utf-8').read()
    for m in re.finditer(r'import\s*\{([^}]+)\}\s*from\s*[\'"]([^\'"]+)[\'"]', src, re.S):
        names = [n.strip().split(' as ')[0].strip() for n in m.group(1).split(',') if n.strip()]
        spec = m.group(2)
        target = os.path.normpath(os.path.join(os.path.dirname(f), spec))
        if not os.path.exists(target):
            missing.append({'file': rel, 'import': spec, 'reason': 'file not found'})
            continue
        tsrc = open(target, encoding='utf-8').read()
        for n in names:
            if not re.search(r'export\s+(?:async\s+)?(?:function|const|let|class)\s+' + re.escape(n) + r'\b', tsrc):
                if not re.search(r'export\s*\{[^}]*\b' + re.escape(n) + r'\b', tsrc):
                    missing.append({'file': rel, 'import': spec, 'name': n, 'reason': 'not exported'})

print(json.dumps({'missing': missing, 'export_count': len(defined)}, ensure_ascii=False, indent=1))
