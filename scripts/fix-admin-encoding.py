# -*- coding: utf-8 -*-
"""Sửa mojibake trong admin.js."""
import pathlib
import re

f = pathlib.Path(__file__).resolve().parent.parent / 'public' / 'assets' / 'pages' / 'admin.js'
raw = f.read_bytes()

try:
    s = raw.decode('utf-8')
except UnicodeDecodeError as e:
    print('File có byte lỗi:', e)
    s = raw.decode('utf-8', errors='replace')

before = len(re.findall(r'[ÃÂÄ][\x80-\xbf]?', s))
print(f'Mojibake trước: {before}')

if before > 3:
    # Thử sửa double-encode toàn file
    try:
        fixed = s.encode('latin-1').decode('utf-8')
        f.write_text(fixed, encoding='utf-8')
        s = fixed
        print('✓ sửa toàn file')
    except Exception as e:
        print('✗ không sửa toàn file được:', e)
        # Sửa từng dòng
        lines = s.split('\n')
        out = []
        n = 0
        for line in lines:
            try:
                fixed = line.encode('latin-1').decode('utf-8')
                out.append(fixed)
                n += 1
            except Exception:
                out.append(line)
        s = '\n'.join(out)
        f.write_text(s, encoding='utf-8')
        print(f'✓ sửa từng dòng: {n}/{len(lines)}')

after = len(re.findall(r'[ÃÂÄ][\x80-\xbf]?', s))
print(f'Mojibake sau: {after}')
print('Có "Vô hạn":', 'Vô hạn' in s)
print('Có "Dùng thử":', 'Dùng thử' in s)
