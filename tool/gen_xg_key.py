# -*- coding: utf-8 -*-
"""gen_xg_key.py -- sinh cap khoa ky ECDSA P-256 RIENG cho XA THÊM TÀI NGUYÊN.

VI SAO KHOA RIENG, KHONG DUNG CHUNG VOI NO FOG:
    Dung chung mot khoa nghia la lo mot khoa -> mat ca hai san pham cung luc.
    Tach khoa thi su co o mot ben khong keo ben kia theo. Chi phi gan nhu
    bang 0 (them mot secret tren worker).

CHAY MOT LAN khi thiet lap. Sau do:

    secrets/xg-sign-jwk.json         <- KHOA RI (KHONG commit, KHONG vao EXE)
    tool/grant/xa_grant_const.py     <- chi chua PUBLIC KEY (da XOR ma hoa)

Nap khoa ri len worker:

    npx wrangler secret put XG_SIGN_JWK --name muabankey < secrets/xg-sign-jwk.json

TUYET DOI khong de khoa ri trong repo/binary. Neu lo `d`, ke tan cong mint
duoc token hop le -> giai ma duoc bang dia chi -> mat toan bo tac dung bao ve.
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
ROOT = os.path.abspath(os.path.join(HERE, '..'))
SECRETS = os.path.join(ROOT, 'secrets')
JWK_PATH = os.path.join(SECRETS, 'xg-sign-jwk.json')

# Duong cong secp256r1
P = 0xFFFFFFFF00000001000000000000000000000000FFFFFFFFFFFFFFFFFFFFFFFF
A = P - 3
B = 0x5AC635D8AA3A93E7B3EBBD55769886BC651D06B0CC53B0F63BCE3C3E27D2604B
N = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551
GX = 0x6B17D1F2E12C4247F8BCE6E563A440F277037D812DEB33A0F4A13945D898C296
GY = 0x4FE342E2FE1A7F9B8EE7EB4A7C0F9E162BCE33576B315ECECBB6406837BF51F5


def _add(p1, p2):
    if p1 is None:
        return p2
    if p2 is None:
        return p1
    x1, y1 = p1
    x2, y2 = p2
    if x1 == x2:
        if (y1 + y2) % P == 0:
            return None
        lam = (3 * x1 * x1 + A) * pow(2 * y1, P - 2, P) % P
    else:
        lam = (y2 - y1) * pow(x2 - x1, P - 2, P) % P
    x3 = (lam * lam - x1 - x2) % P
    y3 = (lam * (x1 - x3) - y1) % P
    return (x3, y3)


def _mul(k, pt):
    out = None
    addend = pt
    while k:
        if k & 1:
            out = _add(out, addend)
        addend = _add(addend, addend)
        k >>= 1
    return out


def _on_curve(pt):
    x, y = pt
    if not (0 <= x < P and 0 <= y < P):
        return False
    return (y * y - (x * x * x + A * x + B)) % P == 0


def _b64u(b):
    return base64.urlsafe_b64encode(b).decode().rstrip('=')


def main():
    if os.path.exists(JWK_PATH):
        print('DA CO: %s' % JWK_PATH)
        print('Khong ghi de (tranh lam hong ban dang phat hanh).')
        print('Muon tao lai thi xoa file do truoc — NHUNG se lam hong moi')
        print('license da cap token hien tai.')
        return 0

    andbytes = os.urandom(32)
    d = int.from_bytes(andbytes, 'big') % N
    if d == 0:
        raise SystemExit('so ngau nhien ra 0, chay lai')

    pub = _mul(d, (GX, GY))
    if pub is None or not _on_curve(pub):
        raise SystemExit('diem cong khong hop le, chay lai')

    x, y = pub
    jwk = {
        'kty': 'EC',
        'crv': 'P-256',
        'x': _b64u(x.to_bytes(32, 'big')),
        'y': _b64u(y.to_bytes(32, 'big')),
        'd': _b64u(d.to_bytes(32, 'big')),
        'key_ops': ['sign'],
        'ext': True,
    }

    os.makedirs(SECRETS, exist_ok=True)
    with open(JWK_PATH, 'w', encoding='utf-8') as f:
        json.dump(jwk, f, indent=2)
    try:
        os.chmod(JWK_PATH, 0o600)
    except Exception:
        pass

    print('OK  -> %s' % JWK_PATH)
    print('    PUB_X = %s...' % jwk['x'][:16])
    print('    PUB_Y = %s...' % jwk['y'][:16])
    print()
    print('BUOC TIEP THEO (bat buoc, neu khong /api/xg/activate se 503):')
    print('  1. python tool/grant/gen_grant_const.py      # nhung public key')
    print('  2. build lai EXE                              # xem build-grant.ps1')
    print('  3. npx wrangler secret put XG_SIGN_JWK --name muabankey '
          '< secrets/xg-sign-jwk.json')
    return 0


if __name__ == '__main__':
    sys.exit(main())
