# -*- coding: utf-8 -*-
"""check_sites_sync.py -- doi chieu bang cong No Fog giua SERVER va CLIENT.

Chay:
    python tool/src/check_sites_sync.py

Muc dich: bay loi "sua byte va o mot noi". Neu server va client lech nhau,
token se giai ma ra bang khac voi bang client dang dung -> tool va sai byte
vao game (co the crash game). Script nay bat loi do TRUOC khi build.

Kiem:
  1. Bang SITES trong src/routes/license-server.js
  2. Bang MINIMAP/CORE/LEGACY con lai trong tool/src/xa_nofog_pro.py (neu con)
  -> phai trung khop tung dong (key, nhom, dia chi, byte goc, byte va)
"""
import json
import os
import re
import subprocess
import sys

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
SERVER = os.path.join(ROOT, 'src', 'routes', 'license-server.js')
CLIENT = os.path.join(HERE, 'xa_nofog_pro.py')

GROUP_MAP = {'CORE': 'viewport', 'MINIMAP': 'minimap', 'LEGACY': 'legacy'}


def read_server_sites():
    """Doc SITES tu license-server.js: [(key, group, va, orig, pat)]."""
    import base64
    import urllib.parse
    with open(SERVER, 'r', encoding='utf-8') as f:
        src = f.read()

    m = re.search(r'const SITES = \[(.*?)\n\];', src, re.S)
    if not m:
        raise SystemExit('khong tim thay `const SITES = [` trong server')

    out = []
    for line in m.group(1).split('\n'):
        line = line.strip()
        mm = re.match(
            r"\[\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*0x([0-9a-fA-F]+)\s*,"
            r"\s*'([0-9a-fA-F]*)'\s*,\s*'([0-9a-fA-F]*)'\s*\]",
            line)
        if not mm:
            continue
        key, group, va, orig, pat = mm.groups()
        out.append((key, group, int(va, 16), orig.lower(), pat.lower()))
    if not out:
        raise SystemExit('khong parse duoc dong nao trong SITES')
    return out


def read_client_sites():
    """Doc MINIMAP/CORE/LEGACY tu xa_nofog_pro.py (co the da bi xoa -> [])."""
    if not os.path.exists(CLIENT):
        return []
    with open(CLIENT, 'r', encoding='utf-8') as f:
        src = f.read()

    out = []
    for name, group in GROUP_MAP.items():
        m = re.search(r'^%s = \[(.*?)^\]' % name, src, re.S | re.M)
        if not m:
            continue
        for line in m.group(1).split('\n'):
            mm = re.match(
                r"\s*\(\s*'([^']+)'\s*,\s*0x([0-9a-fA-F]+)\s*,"
                r"\s*'([0-9a-fA-F]*)'\s*,\s*'([0-9a-fA-F]*)'\s*\)\s*,?\s*$",
                line)
            if not mm:
                continue
            key, va, orig, pat = mm.groups()
            out.append((key, group, int(va, 16), orig.lower(), pat.lower()))
    return out


def main():
    if not os.path.exists(SERVER):
        raise SystemExit('khong thay %s' % SERVER)

    server = read_server_sites()
    client = read_client_sites()

    print('SERVER  (license-server.js): %d cong' % len(server))
    print('CLIENT  (xa_nofog_pro.py)  : %d cong%s'
          % (len(client), '' if client else '  -- KHONG CON (da chuyen vao token)'))
    print('')

    if not client:
        # Trang thai MONG DOI sau khi port: bang trong binary da bi xoa.
        print('OK -- bang cong khong con trong binary client.')
        print('     Day la trang thai dung: bang chi ton tai trong token da ky.')
        by = {}
        for key, group, va, o, p in server:
            by[group] = by.get(group, 0) + 1
        for g in ('viewport', 'minimap', 'legacy'):
            print('     %-9s %d' % (g, by.get(g, 0)))
        # Van phai kiem cau truc
        return verify_structure(server)

    sk = [s[0] for s in server]
    ck = [s[0] for s in client]
    bad = 0
    if sk != ck:
        print('LECH THU TU / TAP KEY:')
        print('  server: %s' % ' '.join(sk))
        print('  client: %s' % ' '.join(ck))
        bad += 1
    sd = {s[0]: s for s in server}
    cd = {s[0]: s for s in client}
    for k in sk:
        if k not in cd:
            print('THIEU o client: %s' % k)
            bad += 1
            continue
        if sd[k] != cd[k]:
            print('LECH dong %s:\n  server=%s\n  client=%s' % (k, sd[k], cd[k]))
            bad += 1
    for k in ck:
        if k not in sd:
            print('THUA o client (khong co trong server): %s' % k)
            bad += 1

    if bad:
        print('\nTHAT BAI: %d khac biet. Sua cho khop roi chay lai.' % bad)
        return 1
    print('OK -- hai ben khop 100%% (%d cong).' % len(server))
    return verify_structure(server)


def verify_structure(server):
    """Kiem cau truc co ban cua bang server."""
    bad = 0
    keys, addrs = set(), set()
    for key, group, va, o, p in server:
        if key in keys:
            print('TRUNG key %s' % key)
            bad += 1
        keys.add(key)
        if va in addrs:
            print('TRUNG dia chi %s 0x%X' % (key, va))
            bad += 1
        addrs.add(va)
        if len(o) != len(p):
            print('KHAC DO DAI %s' % key)
            bad += 1
        if o == p:
            print('BYTE GOC == BYTE VA %s (vo nghia)' % key)
            bad += 1
        if not (0x400000 <= va < 0x08000000):
            print('DIA CHI NGOAI MIEN %s 0x%X' % (key, va))
            bad += 1
        if group not in ('viewport', 'minimap', 'legacy'):
            print('NHOM LA %s %s' % (key, group))
            bad += 1
    if bad:
        print('\nCAU TRUC LOI: %d van de.' % bad)
        return 1
    print('Cau truc bang server: OK')
    return 0


if __name__ == '__main__':
    sys.exit(main())
