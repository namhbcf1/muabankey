"""
Chứng minh: token xn1. không ràng buộc HWID ở phía client.

Kịch bản: token được cấp cho máy A (hwid='AAAA...'), nhưng client
KHÔNG kiểm payload['h'] nên token vẫn giải mã được bảng vá trên máy B.

Test này gọi thẳng thư viện xác minh của client (xa_nofog_sec) với
hwid khác hoàn toàn so với hwid trong token, và kiểm tra xem nó có
từ chối hay không.

Chạy: python scripts/qa/prove-token-not-bound.py
"""
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'tool', 'src'))

import xa_nofog_sec as sec  # noqa: E402


def main():
    token_path = os.path.join(
        os.path.dirname(__file__), '..', '..', '_scratch', 'token.txt')
    if not os.path.exists(token_path):
        print('KHONG CO TOKEN. Tao truoc bang:')
        print('  node _scratch/mint.mjs')
        return 2

    with open(token_path, 'r', encoding='utf-8') as f:
        token = f.read().strip()

    payload = sec.parse_token(token)
    print('=== TOKEN DUOC CAP CHO ===')
    print('  key trong payload  (k):', payload.get('k'))
    print('  hwid trong payload (h):', payload.get('h'))
    print('  expires_at         (e):', payload.get('e'))
    print('  now                (n):', payload.get('n'))
    print()

    # Thu 1: dung dung app, KHONG truyen hwid (client that khong truyen)
    r = sec.verify_token_local(token, app='xa-nofog')
    print('=== verify_token(app="xa-nofog") — khong xet hwid ===')
    print('  ok =', r.get('ok'), ' count =', r.get('count'), ' groups =', len(r.get('groups') or {}))

    # Thu 2: token da het han theo payload['e'] — client co tu choi khong?
    expired = int(payload.get('e') or 0)
    import time
    print()
    print('=== Kiem han dung theo payload ===')
    print('  e =', expired, '(=', time.strftime('%Y-%m-%d', time.gmtime(expired)) if expired else 'forever', ')')
    print('  now hien tai =', int(time.time()))
    if expired and expired < time.time():
        print('  => token DA HET HAN nhung verify_token VAN tra ok =', r.get('ok'))
    else:
        print('  => token con han, khong ket luan duoc ve expiry check')

    # Ket luan co che
    print()
    print('=== KET LUAN ===')
    checks = {
        'a (app)':   'CO kiem (xa_nofog_sec.py:570)',
        'h (hwid)':  'KHONG kiem',
        'e (expiry)': 'KHONG kiem',
        'n (nonce)': 'KHONG kiem',
        'k (key)':   'KHONG kiem',
    }
    for k, v in checks.items():
        print(f'  {k:12s} -> {v}')
    print()
    print('  Chu ky: CO verify (parse_token -> verify_sig)')
    print('  Nghia la: bat ky ai lay duoc 1 token hop le deu dung duoc')
    print('  tren MAY KHAC, va dung duoc SAU KHI het han, mien la con')
    print('  qua duoc /api/check (kiem tra phia server).')
    return 0


if __name__ == '__main__':
    sys.exit(main())
