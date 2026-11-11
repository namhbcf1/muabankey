# -*- coding: utf-8 -*-
"""Sửa text khối trial trên trang chủ."""
import pathlib
import re

f = pathlib.Path(__file__).resolve().parent.parent / 'public' / 'assets' / 'pages' / 'home.js'
s = f.read_text(encoding='utf-8')

# Thay cả câu cảnh báo "cần tài khoản"
m = re.search(r"Cần <strong>tài khoản</strong>[^<]*(?:<[^>]+>[^<]*)*?không nhập gì thêm\.", s, re.S)
if m:
    s = s.replace(m.group(0),
                  "Không cần đăng ký, không nhập gì. Bấm nút → copy 1 dòng lệnh → "
                  "dán vào CMD → Enter.", 1)
    f.write_text(s, encoding='utf-8')
    print('✓ sửa text khối trial')
else:
    print('✗ không thấy')

# Cũng sửa text hero pill nếu còn "Cần tài khoản"
old2 = "Dùng thử miễn phí · 1 giờ hoặc 3 ngày · Không cần thẻ"
new2 = "Dùng thử miễn phí · 1 giờ hoặc 3 ngày · Không cần đăng ký"
if old2 in s:
    s = s.replace(old2, new2, 1)
    f.write_text(s, encoding='utf-8')
    print('✓ sửa hero pill')

# Kiểm tra
s = f.read_text(encoding='utf-8')
print('\nCòn "Cần tài khoản":', 'Cần <strong>tài khoản' in s)
print('Có "copy 1 dòng lệnh":', 'copy 1 dòng lệnh' in s)
