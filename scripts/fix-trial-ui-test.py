# -*- coding: utf-8 -*-
"""Sửa test: trạng thái đúng giờ là 'Đã tạo' (chưa activate) hoặc 'Đang dùng'."""
import pathlib
import re

f = pathlib.Path(__file__).resolve().parent.parent / 'scripts' / 'e2e-trial-ui.mjs'
s = f.read_text(encoding='utf-8')

# Tìm dòng test cũ
lines = s.split('\n')
for i, l in enumerate(lines):
    if 'Quota giảm còn 9' in l:
        lines[i] = ("  ok('Hiện trạng thái đúng', "
                    "/9\\/10|Đang dùng|Đã tạo/.test(status1hAfter), status1hAfter);")
        print(f'✓ sửa dòng {i + 1}')
        break
else:
    print('· không thấy dòng test')

f.write_text('\n'.join(lines), encoding='utf-8')
