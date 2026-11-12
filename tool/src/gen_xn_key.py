# -*- coding: utf-8 -*-
"""gen_xn_key.py -- sinh cap khoa ky ECDSA P-256 cho XARENA MAP SÁNG.

CHAY MOT LAN khi thiet lap. Sau do:

    secrets/xn-sign-jwk.json        <- KHOA RI (KHONG commit, KHONG vao EXE)
    tool/src/xa_nofog_const.py      <- chi chua PUBLIC KEY (da XOR ma hoa)

Nap khoa ri len worker:

    npx wrangler secret put XN_SIGN_JWK < secrets/xn-sign-jwk.json

TUYET DOI khong de khoa ri trong repo/binary. Neu lo `d`, ke tan cong mint
duoc token hop le -> giai ma duoc bang offset -> mat toan bo tac dung bao ve.
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
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
SECRETS = os.path.join(ROOT, 'secrets')
JWK_PATH = os.path.join(SECRETS, 'xn-sign-jwk.json')


def b64u(raw):
    return base64.urlsafe_b64encode(raw).decode('ascii').rstrip('=')


def i2b(v):
    return int(v).to_bytes(32, 'big')


def gen():
    """Sinh cap khoa P-256, tra (x_hex, y_hex)."""
    try:
        from cryptography.hazmat.primitives.asymmetric import ec
    except ImportError:
        raise SystemExit(
            'Thieu thu vien `cryptography`. Cai:  pip install cryptography')

    key = ec.generate_private_key(ec.SECP256R1())
    nums = key.private_numbers()
    pub = nums.public_numbers
    if os.path.exists(JWK_PATH):
        raise SystemExit(
            'DA CO %s\n'
            'Khong ghi de: doi khoa se lam MOI token dang luu tren may khach\n'
            'vo hieu (ho phai kich hoat lai). Neu that su muon doi, xoa file\n'
            'do truoc.' % JWK_PATH)

    os.makedirs(SECRETS, exist_ok=True)
    jwk = {
        'kty': 'EC', 'crv': 'P-256',
        'x': b64u(i2b(pub.x)), 'y': b64u(i2b(pub.y)),
        'd': b64u(i2b(nums.private_value)),
        'key_ops': ['sign'], 'ext': True,
    }
    with open(JWK_PATH, 'w', encoding='utf-8') as f:
        json.dump(jwk, f, indent=2)
    try:
        os.chmod(JWK_PATH, 0o600)
    except Exception:
        pass
    return i2b(pub.x).hex(), i2b(pub.y).hex()


def main():
    if os.path.exists(JWK_PATH):
        with open(JWK_PATH, 'r', encoding='utf-8') as f:
            jwk = json.load(f)
        pad = lambda s: s + '=' * (-len(s) % 4)
        px = base64.urlsafe_b64decode(pad(jwk['x'])).hex()
        py = base64.urlsafe_b64decode(pad(jwk['y'])).hex()
        print('Dung khoa da co: %s' % JWK_PATH)
    else:
        px, py = gen()
        print('Da sinh khoa moi: %s' % JWK_PATH)

    print('  PUB_X = %s' % px)
    print('  PUB_Y = %s' % py)
    print('')
    print('BUOC TIEP:')
    print('  1. npx wrangler secret put XN_SIGN_JWK < %s'
          % os.path.relpath(JWK_PATH, ROOT).replace('\\', '/'))
    print('  2. python tool/src/gen_nofog_const.py')
    print('  3. build lai EXE')
    return 0


if __name__ == '__main__':
    sys.exit(main())
