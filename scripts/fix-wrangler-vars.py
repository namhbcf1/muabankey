# -*- coding: utf-8 -*-
"""Sửa wrangler.toml: xoá khối [vars] trùng + sửa mojibake."""
import pathlib
import re

f = pathlib.Path(__file__).resolve().parent.parent / 'wrangler.toml'
raw = f.read_bytes()

# Sửa mojibake nếu có
try:
    s = raw.decode('utf-8')
except UnicodeDecodeError:
    s = raw.decode('utf-8', errors='replace')

# Nếu có mojibake (Ã, Â, Ä), thử sửa double-encode
if len(re.findall(r'[ÃÂÄ][\x80-\xbf]?', s)) > 3:
    try:
        s = s.encode('latin-1').decode('utf-8')
        print('✓ đã sửa mojibake')
    except Exception as e:
        print('· không sửa được mojibake:', e)

# Xoá khối [vars] THỨ HAI (khối ở cuối file)
lines = s.split('\n')
var_starts = [i for i, l in enumerate(lines) if l.strip() == '[vars]']
print(f'Tìm thấy {len(var_starts)} khối [vars] ở dòng: {[i+1 for i in var_starts]}')

if len(var_starts) > 1:
    # Giữ khối đầu, xoá từ khối thứ hai đến hết file (hoặc đến khối [..] tiếp theo)
    cut_from = var_starts[1]
    # Tìm khối tiếp theo sau cut_from
    cut_to = len(lines)
    for i in range(cut_from + 1, len(lines)):
        if lines[i].strip().startswith('['):
            cut_to = i
            break
    print(f'Xoá dòng {cut_from + 1} đến {cut_to}')
    lines = lines[:cut_from] + lines[cut_to:]

s = '\n'.join(lines).rstrip() + '\n'
f.write_text(s, encoding='utf-8')

# Kiểm tra
s2 = f.read_text(encoding='utf-8')
print(f'\nSau khi sửa:')
print(f'  Số khối [vars]: {s2.count("[vars]")}')
print(f'  Mojibake: {len(re.findall(r"[ÃÂÄ][\x80-\xbf]?", s2))}')
print('\n--- Nội dung cuối ---')
for i, l in enumerate(s2.split('\n'), 1):
    print(f'  {i}: {l}')
