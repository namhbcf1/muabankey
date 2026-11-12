"""
Chứng minh vá token binding: token cấp cho máy A KHÔNG dùng được trên máy B.

Trước khi vá: verify_token_local() chỉ kiểm chữ ký + 'a' -> token máy A
giải mã được bảng vá trên máy B (copy lic.bin = xong).
Sau khi vá: _load_sites() gọi bind_token_to_machine() so payload['h'] với
hwid máy hiện tại -> từ chối.

Chạy: python scripts/qa/prove-token-binding-fix.py
"""
import sys
import os

# Console Windows mac dinh la cp1252 -> khong in duoc tieng Viet.
# Ep UTF-8 cho stdout de khong chet giua chung.
try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'tool', 'src'))

import xa_nofog_sec as sec  # noqa: E402


def line(c='-', n=58):
    print(c * n)


def main():
    token_path = os.path.join(os.path.dirname(__file__), '..', '..', '_scratch', 'token.txt')
    if not os.path.exists(token_path):
        print('KHONG CO TOKEN. Tao bang: node _scratch/mint.mjs')
        return 2

    token = open(token_path, encoding='utf-8').read().strip()
    payload = sec.parse_token(token)
    hwid_in_token = str(payload.get('h') or '')
    exp = int(payload.get('e') or 0)

    print('TOKEN DUOC CAP CHO')
    print('  key   (k):', payload.get('k'))
    print('  hwid  (h):', hwid_in_token)
    print('  hạn   (e):', exp)
    line()

    results = []

    # --- Case 1: chinh may A (hwid khop) -> phai OK ---
    r = sec.verify_token_local(token, app='xa-nofog')
    r1 = sec.bind_token_to_machine(r, hwid=hwid_in_token)
    results.append(('máy A (hwid khớp)', True, r1.get('ok'), r1.get('code')))

    # --- Case 2: may B (hwid khac) -> phai TU CHOI ---
    r = sec.verify_token_local(token, app='xa-nofog')
    r2 = sec.bind_token_to_machine(r, hwid='b' * len(hwid_in_token or 'bbbb'))
    results.append(('máy B (hwid khác)', False, r2.get('ok'), r2.get('code')))

    # --- Case 3: token het han -> phai TU CHOI ---
    r = sec.verify_token_local(token, app='xa-nofog')
    r3 = sec.bind_token_to_machine(r, hwid=hwid_in_token, now=exp + 86400 if exp else 0)
    expect3 = False if exp else True
    results.append(('token hết hạn', expect3, r3.get('ok'), r3.get('code')))

    # --- Case 4: token con han -> phai OK ---
    r = sec.verify_token_local(token, app='xa-nofog')
    r4 = sec.bind_token_to_machine(r, hwid=hwid_in_token, now=exp - 86400 if exp else None)
    results.append(('token còn hạn', True, r4.get('ok'), r4.get('code')))

    print('KET QUA')
    bad = 0
    for name, expect, got, code in results:
        okmark = 'PASS' if got == expect else 'FAIL'
        if got != expect:
            bad += 1
        print('  %s  %-22s mong đợi=%-5s nhận=%-5s %s'
              % (okmark, name, expect, got, code or ''))
    line()

    if bad == 0:
        print('TAT CA DUNG: token bi rang buoc may + han.')
        print()
        print('Y nghia thuc te:')
        print('  - Copy lic.bin tu may A sang may B -> KHONG chay duoc')
        print('  - Token het han -> khong nap duoc bang va')
        print('  Nguoi sua binary van vuot duoc, nhung kich ban pho bien')
        print('  nhat (chep file license) da bi chan.')
        return 0
    print(f'CO {bad} TRUONG HOP SAI')
    return 1


if __name__ == '__main__':
    sys.exit(main())
