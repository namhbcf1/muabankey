# -*- coding: utf-8 -*-
"""gen_grant_const.py -- Sinh xa_grant_const.py tu khoa ky RIENG cua XAGrant.

Doc PUBLIC KEY tu `secrets/xg-sign-jwk.json` (cung file da nap len worker bang
`wrangler secret put XG_SIGN_JWK --name muabankey`) nen hai ben luon khop.

KHONG dung chung khoa voi No Fog: lo mot khoa khong keo ca hai san pham theo.

Sau khi doi khoa, PHAI chay lai script nay roi build lai EXE:
    python tool/gen_xg_key.py             # chi lan dau
    python tool/grant/gen_grant_const.py
"""
import base64
import hashlib
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
JWK_PATH = os.path.join(ROOT, 'secrets', 'xg-sign-jwk.json')
OUT_PATH = os.path.join(HERE, 'xa_grant_const.py')

_SALT_A = b'XG|7a2e'
_SALT_B = b'4c81|mK'
K_PUB_X, K_PUB_Y = 1, 2


def xk(i):
    return hashlib.sha256(_SALT_A + bytes([i & 0xFF]) + _SALT_B).digest()[:16]


def enc(i, plain):
    """Ma hoa bytes -> blob hex (XOR voi keystream lap lai)."""
    k = xk(i)
    out = bytearray(len(plain))
    for n, b in enumerate(plain):
        out[n] = b ^ k[n % 16]
    return out.hex()


def b64u_to_bytes(s):
    t = s.replace('-', '+').replace('_', '/')
    t += '=' * (-len(t) % 4)
    return base64.b64decode(t)


def main():
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
        raise SystemExit('JWK khong phai EC P-256 (kty=%r crv=%r)'
                         % (jwk['kty'], jwk['crv']))

    px = b64u_to_bytes(jwk['x'])
    py = b64u_to_bytes(jwk['y'])
    if len(px) != 32 or len(py) != 32:
        raise SystemExit('toa do phai 32 byte: x=%d y=%d' % (len(px), len(py)))

    values = {
        K_PUB_X: px,
        K_PUB_Y: py,
    }
    blobs = {i: enc(i, v) for i, v in values.items()}

    # Kiem tra giai nguoc lai phai dung
    for i, want in values.items():
        got = bytes(b ^ xk(i)[n % 16] for n, b in enumerate(bytes.fromhex(blobs[i])))
        if got != want:
            raise SystemExit('tu kiem that bai voi hang so %d' % i)

    lines = [
        '# -*- coding: utf-8 -*-',
        '"""Bang hang so da ma hoa cho XA THÊM TÀI NGUYÊN. '
        'SINH TU DONG boi gen_grant_const.py.',
        '',
        'KHONG SUA TAY. Chay lai:  python tool/grant/gen_grant_const.py',
        '',
        'Vi sao phai ma hoa hang so:',
        '    Khoa CONG KHAI (public key) khong phai bi mat — nhung neu de dang hex',
        '    trong binary thi nguoi go EXE se thay ngay va thay no bang khoa cua minh',
        '    de tu ky token. Ma hoa nhe (XOR voi khoa sinh tu salt) lam viec "tim va',
        '    thay" kho kho hon nhieu ma khong ton chi phi.',
        '',
        '    Day KHONG phai bao ve tuyet doi. Nguoi doc duoc source van lam duoc.',
        '    Muc tieu la chan kich ban pho bien: go EXE bang pyinstxtractor roi sua',
        '    vai dong. Phan bao ve that nam o chu ky ECDSA + gate rieng tung license.',
        '"""',
        '',
        'BLOBS = {',
    ]
    for i in sorted(blobs):
        lines.append('    %d: %r,' % (i, blobs[i]))
    lines += [
        '}',
        '',
        '# Chi so hang so, dung chung giua gen_grant_const.py va xa_grant_sec.py',
        'K_PUB_X = 1',
        'K_PUB_Y = 2',
        '',
        "_SALT_A = b'XG|7a2e'",
        "_SALT_B = b'4c81|mK'",
        '',
        'import hashlib as _hl',
        '',
        '',
        'def _xk(i):',
        '    """Sinh khoa XOR cho hang so thu i. Khong co bang khoa nao luu trong file."""',
        '    return _hl.sha256(_SALT_A + bytes([i & 0xFF]) + _SALT_B).digest()[:16]',
        '',
        '',
        'def _dec(i):',
        '    """Giai ma hang so thu i thanh bytes. b\'\' neu hong."""',
        "    blob = BLOBS.get(i, '')",
        '    if not blob:',
        "        return b''",
        '    try:',
        '        raw = bytes.fromhex(blob)',
        '    except (ValueError, TypeError):',
        "        return b''",
        '    k = _xk(i)',
        '    out = bytearray(len(raw))',
        '    for n, b in enumerate(raw):',
        '        out[n] = b ^ k[n % 16]',
        '    return bytes(out)',
        '',
        '',
        'def blob_hex(i):',
        '    """Gia tri da giai ma, dang hex."""',
        '    return _dec(i).hex()',
        '',
        '',
        'def public_xy():',
        '    """Tra (x, y) la hai so nguyen cua khoa cong khai ECDSA P-256."""',
        '    hx = blob_hex(K_PUB_X)',
        '    hy = blob_hex(K_PUB_Y)',
        '    if not hx or not hy:',
        "        raise ValueError('thieu hang so khoa cong khai')",
        '    return (int(hx, 16), int(hy, 16))',
        '',
    ]

    with open(OUT_PATH, 'w', encoding='utf-8', newline='\n') as f:
        f.write('\n'.join(lines))

    print('OK  -> %s' % OUT_PATH)
    print('    PUB_X = %s...' % px.hex()[:16])
    print('    PUB_Y = %s...' % py.hex()[:16])

    # Kiem tra doc lai
    sys.path.insert(0, HERE)
    for m in ('xa_grant_const',):
        if m in sys.modules:
            del sys.modules[m]
    import xa_grant_const as kc
    gx, gy = kc.public_xy()
    if (gx, gy) != (int.from_bytes(px, 'big'), int.from_bytes(py, 'big')):
        raise SystemExit('doc lai KHONG khop')
    print('    doc lai: KHOP')
    return 0


if __name__ == '__main__':
    sys.exit(main())
