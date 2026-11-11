# -*- coding: utf-8 -*-
"""gen_const.py -- sinh xa_const.py (bang hang so da ma hoa) luc build.

Chay:
    python tools/gen_const.py

Doc public key + SPLIT_A tu src/routes/xa-grant-server.js de hai ben luon
khop. Neu sua server thi phai chay lai script nay truoc khi build EXE.
"""
import os
import re
import sys

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import xa_sec  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
SERVER_JS = os.path.join(ROOT, 'src', 'routes', 'xa-grant-server.js')


def read_server():
    """Doc public key + SPLIT_A tu server. Key la nguon su that duy nhat."""
    with open(SERVER_JS, 'r', encoding='utf-8') as f:
        src = f.read()

    m = re.search(r"const SIGN_JWK_DEFAULT = \{(.*?)\};", src, re.S)
    if not m:
        raise SystemExit('khong tim thay SIGN_JWK_DEFAULT trong server')
    block = m.group(1)
    # \b bat buoc: tranh khop nham 'y:' ben trong 'kty:'
    mx = re.search(r"\bx:\s*'([^']+)'", block)
    my = re.search(r"\by:\s*'([^']+)'", block)
    if not mx or not my:
        raise SystemExit('khong doc duoc x/y trong SIGN_JWK_DEFAULT')
    x, y = mx.group(1), my.group(1)

    ms = re.search(r"const SPLIT_A_HEX =\s*'([0-9a-f]+)'", src, re.S)
    if not ms:
        raise SystemExit('khong tim thay SPLIT_A_HEX trong server')
    split = ms.group(1).strip()

    if len(split) != 64:
        raise SystemExit('SPLIT_A_HEX phai 64 hex, dang %d' % len(split))

    # Doi base64url (x, y) -> hex cho de nhung vao hang so
    import base64
    def b64u_hex(s):
        s2 = s.replace('-', '+').replace('_', '/')
        s2 += '=' * (-len(s2) % 4)
        return base64.b64decode(s2).hex()

    return b64u_hex(x), b64u_hex(y), split


def main():
    px, py, split = read_server()
    if len(px) != 64 or len(py) != 64:
        raise SystemExit('public key phai 32 byte / toa do')

    blobs = {
        xa_sec.K_PUB_X: xa_sec._obf(xa_sec.K_PUB_X, px),
        xa_sec.K_PUB_Y: xa_sec._obf(xa_sec.K_PUB_Y, py),
        xa_sec.K_SPLIT_A_1: xa_sec._obf(xa_sec.K_SPLIT_A_1, split[:32]),
        xa_sec.K_SPLIT_A_2: xa_sec._obf(xa_sec.K_SPLIT_A_2, split[32:]),
        xa_sec.K_API_BASE: xa_sec._obf(xa_sec.K_API_BASE, 'https://xienhl.com'),
        xa_sec.K_APP_NAME: xa_sec._obf(xa_sec.K_APP_NAME, 'XArena Grant'),
        xa_sec.K_UA: xa_sec._obf(xa_sec.K_UA, 'XArenaGrant/1.0.0'),
        xa_sec.K_MUTEX: xa_sec._obf(xa_sec.K_MUTEX, r'Global\XArenaGrantPro'),
        xa_sec.K_INSTALL_MARK:
            xa_sec._obf(xa_sec.K_INSTALL_MARK, r'C:\Program Files\XArena\_re\xagrant'),
    }

    out = os.path.join(HERE, 'xa_const.py')
    lines = [
        '# -*- coding: utf-8 -*-',
        '"""Bang hang so da ma hoa. SINH TU DONG boi gen_const.py.',
        '',
        'KHONG SUA TAY. Chay lai:  python tools/gen_const.py',
        '"""',
        '',
        'BLOBS = {',
    ]
    for k in sorted(blobs):
        lines.append('    %d: %r,' % (k, blobs[k]))
    lines.append('}')
    lines.append('')

    with open(out, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))

    # Tu kiem: giai ma lai phai ra dung gia tri goc
    import importlib
    if 'xa_const' in sys.modules:
        del sys.modules['xa_const']
    xa_sec._C.clear()
    xa_sec._BLOBS = {}
    import xa_const
    importlib.reload(xa_const)
    xa_sec._BLOBS = xa_const.BLOBS
    xa_sec._C.clear()

    assert xa_sec.C(xa_sec.K_PUB_X) == px, 'giải mã PUB_X sai'
    assert xa_sec.C(xa_sec.K_SPLIT_A_1) + xa_sec.C(xa_sec.K_SPLIT_A_2) == split, \
        'giải mã SPLIT_A sai'

    print('OK  -> %s' % out)
    print('    PUB_X   = %s...' % px[:16])
    print('    PUB_Y   = %s...' % py[:16])
    print('    SPLIT_A = %s...' % split[:16])
    print('    %d hằng số đã mã hoá' % len(blobs))
    return 0


if __name__ == '__main__':
    sys.exit(main())
