# -*- coding: utf-8 -*-
"""Sửa e2e.mjs dùng username thay email khi đăng ký."""
import pathlib
import re

f = pathlib.Path(__file__).resolve().parent.parent / 'scripts' / 'e2e.mjs'
s = f.read_text(encoding='utf-8')

# 1. Đổi đăng ký sang username
old_reg = "body: { email: userEmail, password: 'Test123456', fullName: 'Khách E2E', phone: '0987654321' },"
new_reg = "body: { username: `e2e${uniq.replace(/[^a-z0-9]/g, '').slice(0, 12)}`, password: 'Test123456' },"
if old_reg in s:
    s = s.replace(old_reg, new_reg, 1)
    print('✓ đổi đăng ký sang username')
else:
    print('· không thấy khối đăng ký')

# 2. Tìm chỗ dùng userEmail trong login để đổi
# Xem các dòng có userEmail
lines = s.split('\n')
for i, line in enumerate(lines, 1):
    if 'userEmail' in line:
        print(f'  dòng {i}: {line.strip()[:100]}')

f.write_text(s, encoding='utf-8')
print('\nĐã lưu. Cần sửa thêm các chỗ dùng userEmail.')
