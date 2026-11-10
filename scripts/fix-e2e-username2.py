# -*- coding: utf-8 -*-
"""Sửa e2e.mjs: đổi hết userEmail sang userName (đăng ký bằng username)."""
import pathlib

f = pathlib.Path(__file__).resolve().parent.parent / 'scripts' / 'e2e.mjs'
s = f.read_text(encoding='utf-8')
n = 0

# Khai báo biến: userEmail -> userName (username hợp lệ)
old_decl = "const userEmail = `e2e${uniq}@test.vn`;"
new_decl = "const userName = `e2e${uniq.replace(/[^a-z0-9]/g, '').slice(0, 12)}`;"
if old_decl in s:
    s = s.replace(old_decl, new_decl, 1)
    n += 1
    print('✓ khai báo userName')

# Đổi hết userEmail -> userName trong body
repls = [
    ("body: { email: userEmail, password: 'Test123456', fullName: 'Trùng' },",
     "body: { username: userName, password: 'Test123456' },"),
    ("body: { email: userEmail, password: 'SaiMatKhau123' },",
     "body: { username: userName, password: 'SaiMatKhau123' },"),
    ("body: JSON.stringify({ email: userEmail, password: 'Test123456' })",
     "body: JSON.stringify({ username: userName, password: 'Test123456' })"),
    ("method: 'POST', body: { email: userEmail, password: 'Test123456' },",
     "method: 'POST', body: { username: userName, password: 'Test123456' },"),
    ("method: 'POST', body: { email: userEmail, password: 'NewPass123456' },",
     "method: 'POST', body: { username: userName, password: 'NewPass123456' },"),
]

for old, new in repls:
    if old in s:
        s = s.replace(old, new)
        n += 1
        print('✓ ' + old[:60])

# Đăng ký: bỏ uniq thừa (đã dùng userName)
old_reg = "body: { username: `e2e${uniq.replace(/[^a-z0-9]/g, '').slice(0, 12)}`, password: 'Test123456' },"
new_reg = "body: { username: userName, password: 'Test123456' },"
if old_reg in s:
    s = s.replace(old_reg, new_reg, 1)
    n += 1
    print('✓ đăng ký dùng userName')

# weakPw test: cần username hợp lệ
old_weak = "body: { email: `w${uniq}@test.vn`, password: 'abc', fullName: 'Yếu' },"
new_weak = "body: { username: `w${uniq.replace(/[^a-z0-9]/g, '').slice(0, 10)}`, password: 'abc' },"
if old_weak in s:
    s = s.replace(old_weak, new_weak, 1)
    n += 1
    print('✓ weak password test')

# XSS test
old_xss = "body: { email: `x${uniq}@test.vn`, password: 'Test123456', fullName: '<script>alert(1)</script>' },"
new_xss = "body: { username: `x${uniq.replace(/[^a-z0-9]/g, '').slice(0, 10)}`, password: 'Test123456', fullName: '<script>alert(1)</script>' },"
if old_xss in s:
    s = s.replace(old_xss, new_xss, 1)
    n += 1
    print('✓ XSS test')

f.write_text(s, encoding='utf-8')
print(f'\nĐã sửa {n} chỗ')

# Kiểm tra còn userEmail không
remaining = [i for i, l in enumerate(s.split('\n'), 1) if 'userEmail' in l]
if remaining:
    print('\n⚠️  Còn userEmail ở dòng:', remaining)
else:
    print('✓ Không còn userEmail')
