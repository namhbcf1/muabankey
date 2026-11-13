"""Kiem chung lop bao ve token XAGrant: tan cong phai bi chan.

Chay: python tool/grant/verify_attacks.py <token-file>
"""
import base64
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import xa_grant_sec as S  # noqa: E402

try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
# PHAI dung khoa cua XAGrant, KHONG phai khoa No Fog.
# Truoc day file nay doc `xn-sign-jwk.json` -> token XAGrant ky bang
# `xg-sign-jwk.json` luon bi bao bad_sig. Da tach khoa rieng nen phai tro dung.
JWK = os.path.join(ROOT, 'secrets', 'xg-sign-jwk.json')


def b64u_int(s):
    b = s.replace('-', '+').replace('_', '/')
    b += '=' * (-len(b) % 4)
    return int.from_bytes(base64.b64decode(b), 'big')


def b64u_enc(b):
    return base64.urlsafe_b64encode(b).decode().rstrip('=')


def main():
    tokfile = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
        os.environ.get('TEMP', '/tmp'), 'xg-token.txt')
    token = open(tokfile, encoding='utf-8').read().strip()
    jwk = json.load(open(JWK, encoding='utf-8'))
    pub = (b64u_int(jwk['x']), b64u_int(jwk['y']))

    results = []

    def check(name, expect_ok, r):
        ok = bool(r.get('ok'))
        results.append((name, expect_ok, ok, r.get('code')))

    # 0. Token that -> phai OK
    check('token that', True, S.verify_token(token, pub))

    parts = token.split('.')

    # 1. Sua 1 ky tu trong payload -> chu ky hong
    p = bytearray(parts[1].encode())
    p[10] = ord('A') if p[10] != ord('A') else ord('B')
    bad1 = 'xg1.' + p.decode() + '.' + parts[2]
    check('sua payload', False, S.verify_token(bad1, pub))

    # 2. Sua chu ky
    s = bytearray(parts[2].encode())
    s[5] = ord('A') if s[5] != ord('A') else ord('B')
    bad2 = 'xg1.' + parts[1] + '.' + s.decode()
    check('sua chu ky', False, S.verify_token(bad2, pub))

    # 3. Doi prefix
    bad3 = 'xg2.' + parts[1] + '.' + parts[2]
    check('doi prefix', False, S.verify_token(bad3, pub))

    # 4. Token rac
    check('token rac', False, S.verify_token('xg1.abc.def', pub))
    check('chuoi rong', False, S.verify_token('', pub))
    check('chi 2 phan', False, S.verify_token('xg1.abc', pub))

    # 5. Token ky bang khoa KHAC -> phai bi chan
    alt = dict(jwk)
    # Dao bit trong x de tao khoa khac (khong nhat thiet tren duong cong,
    # nhung du de kiem tra rang khoa sai khong verify duoc)
    xb = bytearray(S.b64u_dec(jwk['x']))
    xb[0] ^= 0xFF
    alt_pub = (int.from_bytes(bytes(xb), 'big'), b64u_int(jwk['y']))
    check('khoa sai', False, S.verify_token(token, alt_pub))

    # 6. Its payload nhung giu chu ky (chinh la case sua payload co chu y)
    body_orig = parts[0] + '.' + parts[1]
    payload_obj = json.loads(S.b64u_dec(parts[1]))
    payload_obj['e'] = 1  # dat han vao qua khu
    new_p = b64u_enc(json.dumps(payload_obj, separators=(',', ':')).encode())
    forged = 'xg1.' + new_p + '.' + parts[2]
    check('sua han dung (payload+giu sig)', False, S.verify_token(forged, pub))

    # 7. Kiem tra han dung.
    #    LUU Y: 'e' = 0 nghia la VINH VIEN (khong phai het han). Test phai
    #    phan biet hai truong hop, neu khong se bao sai.
    exp = int(json.loads(S.b64u_dec(parts[1])).get('e') or 0)
    if exp == 0:
        print('  (token nay la VINH VIEN, e=0 -> bo qua test het han)')
        r_far = S.verify_token(token, pub, now=4102444800)  # nam 2100
        check('vinh vien van dung o nam 2100', True, r_far)
    else:
        r_exp = S.verify_token(token, pub, now=exp + 60)
        check('het han (now=exp+60)', False, r_exp)

    print('KIEM CHUNG TAN CONG')
    print('=' * 62)
    bad = 0
    for name, expect_ok, got_ok, code in results:
        good = (got_ok == expect_ok)
        if not good:
            bad += 1
        mark = 'PASS' if good else 'FAIL'
        print('  %s  %-30s mong=%-5s nhan=%-5s %s'
              % (mark, name, expect_ok, got_ok, code or ''))
    print('=' * 62)
    if bad == 0:
        print('TAT CA %d TRUONG HOP DUNG: token that qua, moi tan cong bi chan' % len(results))
        return 0
    print('CO %d TRUONG HOP SAI' % bad)
    return 1


if __name__ == '__main__':
    sys.exit(main())
