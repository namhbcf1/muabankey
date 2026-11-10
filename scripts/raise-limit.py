# -*- coding: utf-8 -*-
"""Tăng rate limit đăng ký và đăng nhập lên 100."""
import pathlib

f = pathlib.Path(__file__).resolve().parent.parent / 'src' / 'routes' / 'auth.js'
s = f.read_text(encoding='utf-8')
n = 0

# Đăng ký: 20 -> 100 (giữ window 1 giờ)
old = "rateLimit(env, `reg:${ip}`, 20, 3600)"
new = "rateLimit(env, `reg:${ip}`, 100, 3600)"
if old in s:
    s = s.replace(old, new, 1)
    n += 1
    print('✓ đăng ký: 20 → 100/giờ')

# Đăng nhập: 30 -> 100 (giữ window 15 phút)
old2 = "rateLimit(env, `login:${ip}`, 30, 900)"
new2 = "rateLimit(env, `login:${ip}`, 100, 900)"
if old2 in s:
    s = s.replace(old2, new2, 1)
    n += 1
    print('✓ đăng nhập: 30 → 100/15 phút')

# Cập nhật comment cho khớp
old3 = "// 20/giờ/IP: đủ thoáng cho hộ gia đình / NAT chung, vẫn chặn spam tạo acc hàng loạt"
new3 = "// 100/giờ/IP: thoáng cho quán net và NAT chung, vẫn chặn spam tự động hàng loạt"
if old3 in s:
    s = s.replace(old3, new3, 1)
    print('✓ cập nhật comment')

f.write_text(s, encoding='utf-8')
print(f'\nĐã sửa {n}/2')
