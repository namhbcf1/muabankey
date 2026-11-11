# -*- coding: utf-8 -*-
"""Bỏ el.remove() trong showTrialCommand/Error (đã đóng qua close())."""
import pathlib

f = pathlib.Path(__file__).resolve().parent.parent / 'public' / 'assets' / 'pages' / 'home.js'
s = f.read_text(encoding='utf-8')

line = "  document.querySelectorAll('.modal-overlay').forEach((el) => el.remove());\n"
# Chỉ xoá 2 lần xuất hiện trong showTrialCommand và showTrialError
idx_cmd = s.find('function showTrialCommand')
idx_err = s.find('function showTrialError')

count = 0
out = []
i = 0
while True:
    j = s.find(line, i)
    if j < 0:
        out.append(s[i:])
        break
    # Chỉ xoá nếu nằm trong showTrialCommand hoặc showTrialError
    if (idx_cmd < j < idx_cmd + 3000) or (idx_err < j < idx_err + 3000):
        out.append(s[i:j])
        i = j + len(line)
        count += 1
    else:
        out.append(s[i:j + len(line)])
        i = j + len(line)

s2 = ''.join(out)
f.write_text(s2, encoding='utf-8')
print(f'Đã bỏ {count} dòng el.remove() trong show*')
print('Còn lại:', s2.count("querySelectorAll('.modal-overlay')"))
