# -*- coding: utf-8 -*-
"""check_versions.py — Kiểm tra version co KHOP giua code, server va R2.

CHAY TRUOC MOI LAN DEPLOY BAN MOI:

    python scripts/check_versions.py

Kiem tra:
  1. xa_nofog_pro.py CLIENT_VERSION  ==  installer.js EXE_VERSION
  2. xa_grant.py     APP_VERSION     ==  xa-grant-installer.js EXE_VERSION
  3. xa_setup.py     VERSION         ==  install-info.js SETUP_VERSION
  4. Version tren PRODUCTION (sau khi deploy) == version trong code

Tra ma 0 = khop het, 1 = co cho lech.
"""

import io
import json
import os
import re
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# (nhan, file_python, bien_python, file_js, bien_js)
# CHI HAI THU CON PHAT HANH.
#
# 2026-11-14: chu shop yeu cau "chỉ làm một cái, cài một cái thôi". Hai tool
# cũ (NoFog / Grant) đã gộp vào XA ARENA và bị bỏ khỏi /api/app/version,
# nên không kiểm version của chúng nữa — kiểm sẽ báo LECH vô nghĩa.
# File EXE cũ vẫn nằm trên R2 cho khách cũ tải lại.
PAIRS = [
    # App gộp: EXE duy nhất chứa cả map sáng + tài nguyên
    ('Arena', 'tool/app/xa_arena_app.py', 'APP_VERSION',
     'src/routes/arena-installer.js', 'EXE_VERSION'),
    ('Setup', 'tool/setup/xa_setup.py', 'VERSION',
     'src/routes/install-info.js', 'SETUP_VERSION'),
]


def read_var(path, name):
    """Doc gia tri chuoi cua bien. None neu khong thay."""
    try:
        p = os.path.join(ROOT, path)
        s = io.open(p, encoding='utf-8').read()
    except Exception:
        return None
    m = re.search(
        r"^\s*(?:export\s+)?(?:const|var|let)?\s*%s\s*[:=]\s*['\"]([^'\"]+)['\"]"
        % re.escape(name), s, re.M)
    return m.group(1) if m else None


def read_fallback(path, key):
    """Doc fallback trong download.js: { version: 'x' } tai khoa key."""
    try:
        p = os.path.join(ROOT, path)
        s = io.open(p, encoding='utf-8').read()
    except Exception:
        return None
    # Tim khoi co 'version:' gan nhat sau tu khoa
    idx = s.find(key)
    if idx < 0:
        return None
    seg = s[idx:idx + 900]
    m = re.search(r"version:\s*['\"]([^'\"]+)['\"]", seg)
    return m.group(1) if m else None


def fetch(url, timeout=15):
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'chk'})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode('utf-8'))
    except Exception as e:
        return {'_err': str(e)}


def main():
    verbose = '--quiet' not in sys.argv
    bad = 0

    print('=' * 68)
    print('KIEM TRA VERSION')
    print('=' * 68)
    print()
    print('%-8s %-14s %-14s %s' % ('ban', 'python', 'server-code', 'ket qua'))
    print('-' * 68)

    vals = {}
    for label, pyfile, pyvar, jsfile, jsvar in PAIRS:
        pv = read_var(pyfile, pyvar)
        jv = read_var(jsfile, jsvar)
        vals[label] = (pv, jv)
        if pv is None:
            ok = 'THIEU trong %s' % pyfile
            bad += 1
        elif jv is None:
            ok = 'THIEU trong %s' % jsfile
            bad += 1
        elif pv == jv:
            ok = 'KHOP'
        else:
            ok = 'LECH!'
            bad += 1
        print('%-8s %-14s %-14s %s' % (label, pv or '?', jv or '?', ok))

    # ---- Fallback trong download.js ----
    # Chi con 2 thu: arena (EXE gop) va setup (bo cai).
    print()
    print('Fallback hien thi (download.js):')
    fb_ar = read_fallback('public/assets/pages/download.js', 'FALLBACK')
    fb_st = read_fallback('public/assets/pages/download.js', 'SETUP_FALLBACK')
    ar_ok = (fb_ar == vals['Arena'][0]) if fb_ar else False
    st_ok = (fb_st == vals['Setup'][0]) if fb_st else False
    print('  arena : %-12s %s' % (fb_ar or '?', 'KHOP' if ar_ok else 'LECH'))
    print('  setup : %-12s %s' % (fb_st or '?', 'KHOP' if st_ok else 'LECH'))
    if fb_ar and not ar_ok:
        bad += 1
    if fb_st and not st_ok:
        bad += 1

    # ---- Production ----
    print()
    print('Tren PRODUCTION (xienhl.com):')
    d = fetch('https://xienhl.com/api/app/version')
    if '_err' in d:
        print('  khong hoi duoc:', d['_err'])
    else:
        # Cấp gốc GIỜ CHÍNH LÀ app gộp (name/filename/version/url), nên
        # `version` có mặt là ĐÚNG. Chỉ field 'grant' mới là dấu hiệu còn
        # sót app cũ trong response.
        if d.get('grant'):
            print('  CANH BAO: /api/app/version con tra field app cu (grant)')
            bad += 1
        if str(d.get('filename') or '') == 'xa_nofog_pro.exe':
            print('  CANH BAO: cấp gốc vẫn trỏ xa_nofog_pro.exe')
            bad += 1

    # Arena (app gộp) — kiểm cả version lẫn hash
    if '_err' not in d:
        prod_ar = str((d.get('arena') or {}).get('version') or '')
        code_ar = vals.get('Arena', (None, None))[0]
        st_ar = 'KHOP' if prod_ar == code_ar else 'LECH'
        if prod_ar != code_ar:
            bad += 1
        print('  %-8s prod=%-12s code=%-12s %s'
              % ('Arena', prod_ar or '?', code_ar or '?', st_ar))
        node_ar = d.get('arena') or {}
        sha_ar = (node_ar.get('sha256') or '').lower()
        lf = os.path.join(ROOT, 'tool/dist-arena/xa_arena.exe')
        if os.path.exists(lf) and sha_ar:
            import hashlib
            h = hashlib.sha256(open(lf, 'rb').read()).hexdigest()
            okh = (h == sha_ar
                   and os.path.getsize(lf) == int(node_ar.get('size') or 0))
            if not okh:
                bad += 1
            print('  %-8s hash %s' % ('Arena', 'KHOP' if okh else 'LECH!'))

    d2 = fetch('https://xienhl.com/api/setup/version')
    if '_err' not in d2:
        prod_su = str(d2.get('version') or '')
        st = 'KHOP' if prod_su == vals['Setup'][0] else 'LECH'
        if prod_su != vals['Setup'][0]:
            bad += 1
        print('  %-8s prod=%-12s code=%-12s %s'
              % ('Setup', prod_su or '?', vals['Setup'][0] or '?', st))

    print()
    print('=' * 68)
    if bad == 0:
        print('KET QUA: TAT CA KHOP')
        print()
        print('Neu vua build ban moi: da san sang deploy.')
        return 0
    print('KET QUA: %d cho LECH — SUA TRUOC KHI DEPLOY' % bad)
    print()
    print('Goi y: tang version o CA HAI file cua ban muon phat hanh:')
    for label, pyfile, pyvar, jsfile, jsvar in PAIRS:
        print('  %-8s %s:%s  VA  %s:%s'
              % (label, pyfile, pyvar, jsfile, jsvar))
    return 1


if __name__ == '__main__':
    sys.exit(main())
