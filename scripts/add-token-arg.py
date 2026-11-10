# -*- coding: utf-8 -*-
"""Thêm --token cho client để installer --key cũng đổi máy được sau admin reset."""
import pathlib

f = pathlib.Path(__file__).resolve().parent.parent / 'tool' / 'src' / 'xa_nofog_pro.py'
s = f.read_text(encoding='utf-8')
n = 0

# 1. Thêm 'token': None vào dict khởi tạo parse_args
old1 = "'rebind': None}"
new1 = "'rebind': None, 'token': None}"
if old1 in s:
    s = s.replace(old1, new1, 1)
    n += 1
    print('✓ 1. thêm token vào dict parse_args')
else:
    print('· không thấy dict parse_args')

# 2. Thêm nhánh --token
old2 = """        elif a == '--rebind':
            if i + 2 >= len(argv):"""
new2 = """        elif a == '--token':
            i += 1
            if i >= len(argv):
                return None, '--token can gia tri'
            o['token'] = argv[i].strip()
        elif a == '--rebind':
            if i + 2 >= len(argv):"""
if old2 in s:
    s = s.replace(old2, new2, 1)
    n += 1
    print('✓ 2. thêm nhánh --token')
else:
    print('· không thấy nhánh --rebind')

# 3. Truyền token vào activate (nhánh --key)
old3 = "        ok, m = activate(opts['key'])"
new3 = "        ok, m = activate(opts['key'], token=opts.get('token'))"
if old3 in s:
    s = s.replace(old3, new3, 1)
    n += 1
    print('✓ 3. truyền token vào activate')

# 4. Cập nhật docstring
old4 = "    xa_nofog_pro.exe --rebind K T   # doi may bang token"
new4 = ("    xa_nofog_pro.exe --rebind K T   # doi may bang token\n"
        "    xa_nofog_pro.exe --key K --token T  # kich hoat sau khi admin reset")
if old4 in s:
    s = s.replace(old4, new4, 1)
    n += 1
    print('✓ 4. cập nhật docstring')

f.write_text(s, encoding='utf-8')
print(f'\nĐã sửa {n}/4')
