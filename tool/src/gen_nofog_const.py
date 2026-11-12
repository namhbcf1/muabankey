# -*- coding: utf-8 -*-
"""gen_nofog_const.py -- sinh xa_nofog_const.py (bang hang so da ma hoa).

Chay:
    python tool/src/gen_nofog_const.py

Doc PUBLIC KEY tu `secrets/xn-sign-jwk.json` (cung file da nap len worker
bang `wrangler secret put XN_SIGN_JWK`) nen hai ben luon khop.

Sau khi doi khoa hoac doi cau hinh nhung vao binary, PHAI chay lai script
nay roi build lai EXE.
"""
import base64
import json
import os
import sys

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import xa_nofog_sec as S                       # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
JWK_PATH = os.path.join(ROOT, 'secrets', 'xn-sign-jwk.json')

# Gia tri nhung vao binary. SUA O DAY, khong sua xa_nofog_const.py.
VALUES = {
    S.K_API_BASE: 'https://xienhl.com',
    S.K_APP_NAME: 'XARENA MAP SÁNG',
    S.K_UA: 'XArenaNoFog/1.5.0',
    S.K_MUTEX: r'Global\XArenaNoFogPro',
    S.K_REG_KEY: r'Software\Microsoft\Windows\CurrentVersion\XASupport',
    # Giu NGUYEN gia tri nay: doi no se lam moi moc thoi gian da ghi tren may
    # khach thanh khong doc duoc -> mat kha nang phat hien lui dong ho.
    S.K_ANCHOR_SALT: 'xanf-anchor-v1',
    S.K_PROCESS: 'EMPIRESX.EXE|EMPIRESX_HD.EXE|EMPIRESX_HDR.EXE',
    S.K_BUY_URL: 'https://xienhl.com/#/product/license-xarena-thang',
    S.K_REGISTER_URL: 'https://xienhl.com/#/register',
    S.K_INSTALL_ROOT: 'XArena',
}


def b64u_to_hex(s):
    s2 = s.replace('-', '+').replace('_', '/')
    s2 += '=' * (-len(s2) % 4)
    return base64.b64decode(s2).hex()


def read_pub():
    """Doc public key tu JWK cua server. Tra (x_hex, y_hex)."""
    if not os.path.exists(JWK_PATH):
        raise SystemExit(
            'Khong thay %s\nChay truoc:  python tool/src/gen_xn_key.py'
            % JWK_PATH)
    with open(JWK_PATH, 'r', encoding='utf-8') as f:
        jwk = json.load(f)
    for k in ('kty', 'crv', 'x', 'y'):
        if not jwk.get(k):
            raise SystemExit('JWK thieu truong %r' % k)
    if jwk['kty'] != 'EC' or jwk['crv'] != 'P-256':
        raise SystemExit('JWK khong phai EC P-256')
    px, py = b64u_to_hex(jwk['x']), b64u_to_hex(jwk['y'])
    if len(px) != 64 or len(py) != 64:
        raise SystemExit('public key phai 32 byte / toa do')
    return px, py


def main():
    px, py = read_pub()

    values = dict(VALUES)
    values[S.K_PUB_X] = px
    values[S.K_PUB_Y] = py

    blobs = {}
    for i, v in values.items():
        blobs[i] = S._obf(i, v)

    out = os.path.join(HERE, 'xa_nofog_const.py')
    lines = [
        '# -*- coding: utf-8 -*-',
        '"""Bang hang so da ma hoa. SINH TU DONG boi gen_nofog_const.py.',
        '',
        'KHONG SUA TAY. Chay lai:  python tool/src/gen_nofog_const.py',
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

    # ---- Tu kiem: giai ma lai phai ra dung gia tri goc ----
    import importlib
    if 'xa_nofog_const' in sys.modules:
        del sys.modules['xa_nofog_const']
    S._C.clear()
    S._BLOBS = {}
    import xa_nofog_const
    importlib.reload(xa_nofog_const)
    S._BLOBS = xa_nofog_const.BLOBS
    S._C.clear()

    for i, v in values.items():
        got = S.C(i)
        if got != v:
            raise SystemExit('giai ma sai hang so %d: %r != %r' % (i, got, v))
    if S.public_key() is None:
        raise SystemExit('public key giai ma ra KHONG nam tren duong cong')

    print('OK  -> %s' % out)
    print('    PUB_X = %s...' % px[:16])
    print('    PUB_Y = %s...' % py[:16])
    print('    %d hang so da ma hoa' % len(blobs))
    print('')
    print('BUOC TIEP: nap khoa ri len worker (neu chua):')
    print('  npx wrangler secret put XN_SIGN_JWK < secrets/xn-sign-jwk.json')
    return 0


if __name__ == '__main__':
    sys.exit(main())
