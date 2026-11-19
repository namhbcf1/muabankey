# -*- coding: utf-8 -*-
"""QA toan tuyen: WEB -> CAI DAT -> EXE.

Chay tat ca, in bang tong hop. Moi nhom ghi ro PASS/FAIL va bang chung.
"""
import io
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)

RESULTS = []


def group(name):
    print()
    print('=' * 70)
    print(name)
    print('=' * 70)


def run(label, cmd, timeout=600, shell=True):
    try:
        r = subprocess.run(cmd, capture_output=True, text=True,
                           timeout=timeout, shell=shell)
        out = (r.stdout or '') + (r.stderr or '')
        return r.returncode, out
    except Exception as e:
        return -1, str(e)


def record(area, item, ok, detail=''):
    RESULTS.append((area, item, ok, detail))
    print('  %s  %-52s %s' % ('PASS' if ok else 'FAIL', item, detail[:40]))


# =====================================================================
group('A. CU PHAP (syntax) TOAN BO')
# =====================================================================

# A1. JS server
bad = []
for root, dirs, files in os.walk('src'):
    for f in files:
        if f.endswith('.js'):
            p = os.path.join(root, f)
            rc, _ = run('', ['node', '--check', p], shell=False)
            if rc != 0:
                bad.append(p)
record('syntax', 'server JS (%d file)' % sum(
    1 for r, d, fs in os.walk('src') for f in fs if f.endswith('.js')),
    not bad, ','.join(bad[:3]))

# A2. JS web
bad2 = []
cnt = 0
for root, dirs, files in os.walk('public'):
    for f in files:
        if f.endswith('.js'):
            cnt += 1
            p = os.path.join(root, f)
            rc, _ = run('', ['node', '--check', p], shell=False)
            if rc != 0:
                bad2.append(p)
record('syntax', 'web JS (%d file)' % cnt, not bad2, ','.join(bad2[:3]))

# A3. Python tool
bad3 = []
cnt3 = 0
for d in ('tool/app', 'tool/src', 'tool/grant', 'tool/setup', 'tool/ui'):
    if not os.path.isdir(d):
        continue
    for f in os.listdir(d):
        if not f.endswith('.py'):
            continue
        cnt3 += 1
        p = os.path.join(d, f)
        try:
            compile(io.open(p, encoding='utf-8').read(), p, 'exec')
        except SyntaxError:
            bad3.append(f)
record('syntax', 'tool Python (%d file)' % cnt3, not bad3,
       ','.join(bad3[:3]))


# =====================================================================
group('B. WEB: khong con tan du 2 app cu')
# =====================================================================

def scan(paths, pattern, skip_comment=True):
    hits = []
    for base in paths:
        for root, dirs, files in os.walk(base):
            dirs[:] = [d for d in dirs if d not in
                       ('node_modules', '.wrangler', '__pycache__')]
            for f in files:
                if not f.endswith(('.js', '.html', '.css')):
                    continue
                p = os.path.join(root, f)
                try:
                    s = io.open(p, encoding='utf-8').read()
                except Exception:
                    continue
                for i, line in enumerate(s.splitlines(), 1):
                    t = line.strip()
                    if skip_comment and (t.startswith('*')
                                         or t.startswith('//')
                                         or t.startswith('/*')):
                        continue
                    if pattern in t:
                        hits.append('%s:%d' % (f, i))
    return hits


h = scan(['public'], 'xa_nofog_pro.exe')
record('web', 'khong nhac xa_nofog_pro.exe', not h, ','.join(h[:3]))
h = scan(['public'], 'xa_grant.exe')
record('web', 'khong nhac xa_grant.exe', not h, ','.join(h[:3]))
h = scan(['public'], 'XARENA MAP SÁNG')
record('web', 'khong con ten app cu', not h, ','.join(h[:3]))
h = scan(['public'], 'XA THÊM TÀI NGUYÊN')
record('web', 'khong con ten san pham cu', not h, ','.join(h[:3]))


# =====================================================================
group('C. SERVER: chi con 1 app tren API')
# =====================================================================

try:
    import json
    import urllib.request
    req = urllib.request.Request('https://xienhl.com/api/app/version',
                                 headers={'User-Agent': 'qa'})
    d = json.loads(urllib.request.urlopen(req, timeout=25).read())
    record('server', 'api/app/version tra ve duoc', bool(d.get('ok')),
           d.get('name') or '')
    record('server', 'cap goc la XA ARENA',
           d.get('filename') == 'xa_arena.exe', d.get('filename') or '')
    record('server', 'khong con field grant', 'grant' not in d,
           ','.join(k for k in d if k == 'grant'))
    record('server', 'co field arena', 'arena' in d, '')

    req2 = urllib.request.Request('https://xienhl.com/api/setup/version',
                                  headers={'User-Agent': 'qa'})
    s2 = json.loads(urllib.request.urlopen(req2, timeout=25).read())
    record('server', 'api/setup/version tra ve duoc', bool(s2.get('ok')),
           s2.get('version') or '')
except Exception as e:
    record('server', 'goi API production', False, str(e)[:40])


# =====================================================================
group('D. CAI DAT: install-info tra dung app gop')
# =====================================================================

env = {}
for line in io.open('.env', encoding='utf-8'):
    if '=' in line and not line.startswith('#'):
        k, v = line.split('=', 1)
        env[k.strip()] = v.strip()


def d1(q, timeout=180):
    r = subprocess.run(
        ['npx', 'wrangler@4', 'd1', 'execute', 'muabankey-db',
         '--remote', '--json', '--command', q],
        capture_output=True, text=True, timeout=timeout,
        env={**os.environ, 'CLOUDFLARE_API_TOKEN':
             env.get('CLOUDFLARE_API_TOKEN', ''),
             'CLOUDFLARE_ACCOUNT_ID': env.get('CLOUDFLARE_ACCOUNT_ID', '')},
        shell=True)
    try:
        return json.loads(r.stdout)[0].get('results') or []
    except Exception:
        return []


now = 0
import time as _t
now = int(_t.time())
hw = '775c3fd37c703a3e3a1069cb007ffb4e'
d1("DELETE FROM license_issues WHERE license_key='QA-FLOW-01'")
d1("DELETE FROM licenses WHERE key='QA-FLOW-01'")
d1("INSERT INTO licenses (key,plan,created_at,expires_at,pid,revoked,"
   "rebinds,max_rebind,hwid,activated_at) VALUES "
   "('QA-FLOW-01','aoe1',%d,%d,NULL,0,0,1,'%s',%d)"
   % (now, now + 2592000, hw, now))

try:
    req3 = urllib.request.Request(
        'https://xienhl.com/api/install-info?key=QA-FLOW-01',
        headers={'User-Agent': 'qa'})
    info = json.loads(urllib.request.urlopen(req3, timeout=25).read())
    record('install', 'install-info ok', bool(info.get('ok')), '')
    record('install', 'app = arena', info.get('app') == 'arena',
           info.get('app') or '')
    record('install', 'exeName = xa_arena.exe',
           info.get('exeName') == 'xa_arena.exe',
           info.get('exeName') or '')
    record('install', 'thu muc cai dung',
           '_re\\arena' in str(info.get('installDir') or ''),
           str(info.get('installDir') or '')[-24:])
    record('install', 'shortcut = XA ARENA',
           info.get('shortcutName') == 'XA ARENA',
           info.get('shortcutName') or '')
    record('install', 'co sha256', len(str(info.get('sha256') or '')) == 64, '')
except Exception as e:
    record('install', 'install-info', False, str(e)[:40])


# =====================================================================
group('E. EXE: hash khop + kich thuoc')
# =====================================================================

try:
    v = json.loads(urllib.request.urlopen(
        urllib.request.Request('https://xienhl.com/api/app/version',
                               headers={'User-Agent': 'qa'}),
        timeout=25).read()).get('arena') or {}
    lf = 'tool/dist-arena/xa_arena.exe'
    if os.path.exists(lf):
        import hashlib
        b = open(lf, 'rb').read()
        h = hashlib.sha256(b).hexdigest().upper()
        record('exe', 'hash local = server', h == (v.get('sha256') or '').upper(),
               h[:16])
        record('exe', 'size local = server',
               len(b) == int(v.get('size') or 0), str(len(b)))
    else:
        record('exe', 'co file build local', False, lf)
except Exception as e:
    record('exe', 'kiem hash EXE', False, str(e)[:40])


# =====================================================================
group('F. TAILIEU: khong nhac lenh 2 app cu')
# =====================================================================

for f in ('RELEASE.md', 'README.md'):
    if not os.path.exists(f):
        continue
    s = io.open(f, encoding='utf-8').read()
    n = s.count('xa_nofog_pro.exe') + s.count('xa_grant.exe')
    record('docs', '%s khong nhac 2 EXE cu' % f, n == 0, '%d lan' % n)


# =====================================================================
print()
print('=' * 70)
print('TONG HOP')
print('=' * 70)
by = {}
for area, item, ok, det in RESULTS:
    a = by.setdefault(area, [0, 0])
    if ok:
        a[0] += 1
    else:
        a[1] += 1
tot_ok = sum(a[0] for a in by.values())
tot_bad = sum(a[1] for a in by.values())
for area in sorted(by):
    okc, badc = by[area]
    print('  %-10s PASS %-3d FAIL %-3d' % (area, okc, badc))
print()
print('  TONG: %d | PASS %d | FAIL %d' % (tot_ok + tot_bad, tot_ok, tot_bad))
if tot_bad:
    print()
    print('  MUC LOI:')
    for area, item, ok, det in RESULTS:
        if not ok:
            print('    [%s] %s  (%s)' % (area, item, det))
