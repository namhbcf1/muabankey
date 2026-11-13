"""Kiem chung luong token 3 muc: tuoi / an han / het han.

Chay: python tool/grant/verify_flow.py
"""
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import xa_grant_sec as S  # noqa: E402
import xa_grant_const as kc  # noqa: E402

try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass

HWID = None


def main():
    tokfile = os.path.join(os.environ.get('TEMP', '/tmp'), 'xg-g.txt')
    if not os.path.exists(tokfile):
        print('Khong thay token:', tokfile)
        return 2
    tok = open(tokfile, encoding='utf-8').read().strip()

    try:
        HWID = S.compute_hwid()
        print('HWID may nay:', HWID)
    except Exception as e:
        print('Khong tinh duoc HWID:', e)
        HWID = None

    pub = kc.public_xy()
    base = S.verify_token(tok, pub, hwid=HWID)
    if not base.get('ok'):
        print('Token khong hop le:', base.get('code'), base.get('msg'))
        return 1

    n = base['issued_at']
    c = base['check_after']
    g = base['grace_hours']
    print()
    print('Tham so token: n=%d  c=%ds (%d phut)  g=%dh' % (n, c, c // 60, g))
    print()

    # LUU Y: token qua han cung VAN verify duoc (chu ky dung) — no chi bat co
    # `token_expired` de ben goi quyet dinh. Nho vay client con du thong tin
    # (key, sid) de goi lam moi, thay vi bo cuoc ngay.
    cases = [
        ('tươi (n+c-10)', n + c - 10, True, False, False),
        ('ngay sau cửa sổ (n+c+10)', n + c + 10, True, True, False),
        ('giữa ân hạn (n+c+g*1800)', n + c + g * 1800, True, True, False),
        ('sát hạn cứng (n+c+g*3600-10)', n + c + g * 3600 - 10, True, True, False),
        ('quá hạn cứng (n+c+g*3600+10)', n + c + g * 3600 + 10, True, False, True),
    ]

    print('%-32s %-8s %-8s %-8s %s' % ('Mốc thời gian', 'ok', 'fresh', 'stale', 'expired'))
    print('-' * 74)
    bad = 0
    for name, t, want_ok, want_stale, want_exp in cases:
        r = S.verify_token(tok, pub, hwid=HWID, now=t)
        ok = bool(r.get('ok'))
        st = bool(r.get('stale'))
        fr = bool(r.get('fresh'))
        ex = bool(r.get('token_expired'))
        good = (ok == want_ok) and (st == want_stale) and (ex == want_exp)
        if not good:
            bad += 1
        print('%-32s %-8s %-8s %-8s %s  %s'
              % (name, ok, fr, st, ex, '' if good else '<<< SAI'))

    print('-' * 74)
    if bad == 0:
        print('LUONG DUNG: tươi dùng ngay, ân hạn thử làm mới, quá hạn thì chặn')
        return 0
    print('CÓ %d MỐC SAI' % bad)
    return 1


if __name__ == '__main__':
    sys.exit(main())
