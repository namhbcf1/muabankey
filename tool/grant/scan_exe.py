"""Quet EXE tim dia chi engine dang o dang plaintext.

So sanh HAI ban build de chung minh ban moi khong con lo dia chi:
  - tool/grant/xa_grant.exe        (ban CU, hardcode)
  - tool/dist-grant/xa_grant.exe   (ban MOI, nap tu token)

Chay: python tool/grant/scan_exe.py
"""
import os
import sys

try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass

HERE = os.path.dirname(os.path.abspath(__file__))

# Dia chi engine + hang so cau truc tung nam plaintext trong source.
NEEDLES = [
    b'42BDE0', b'42BA60', b'41F160', b'41F180', b'45F510',
    b'54EC90', b'54EE68', b'585E88', b'528450', b'4EA700',
    b'4F9040', b'422CC0', b'41F0A0', b'42BD90', b'428710',
    # va dang chu thuong
    b'42bde0', b'42ba60', b'41f160', b'54ec90', b'585e88',
]

# Ten module noi bo: neu lo ra la biet cau truc
NAMES = [b'xa_grant_sec', b'xa_grant_const', b'bind_token', b'xg-ks',
         b'open_engine', b'verify_sig']


def scan(path):
    if not os.path.exists(path):
        return None
    data = open(path, 'rb').read()
    hits = {}
    for n in NEEDLES + NAMES:
        c = data.count(n)
        if c:
            hits[n.decode('latin1')] = c
    return len(data), hits


def main():
    old = os.path.join(HERE, 'xa_grant.exe')
    new = os.path.join(HERE, '..', 'dist-grant', 'xa_grant.exe')

    for label, p in (('CU  (hardcode)', old), ('MOI (nap tu token)', new)):
        r = scan(p)
        print('=' * 62)
        print('%s: %s' % (label, os.path.abspath(p)))
        if r is None:
            print('  KHONG TON TAI')
            continue
        size, hits = r
        print('  kich thuoc: %d B' % size)
        if hits:
            print('  TIM THAY %d loai chuoi:' % len(hits))
            for k, v in sorted(hits.items()):
                print('    %-18s x%d' % (k, v))
        else:
            print('  KHONG tim thay dia chi / ten module nao (SACH)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
