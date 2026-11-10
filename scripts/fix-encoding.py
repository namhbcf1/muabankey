# -*- coding: utf-8 -*-
"""Sửa lỗi encoding UTF-8 trong home.js (bị PowerShell ghi sai bảng mã)."""
import pathlib
import re

f = pathlib.Path(__file__).resolve().parent.parent / 'public' / 'assets' / 'pages' / 'home.js'

# Đọc dạng bytes, giải mã là UTF-8 với thay thế
raw = f.read_bytes()

# Thử decode UTF-8
try:
    s = raw.decode('utf-8')
    print('File đọc được UTF-8')
except UnicodeDecodeError:
    s = raw.decode('utf-8', errors='replace')
    print('File có byte lỗi, đã thay thế')

# Kiểm tra có mojibake (Ã, Â, Ä xuất hiện nhiều)
mojibake_count = len(re.findall(r'[ÃÂÄ][\x80-\xbf]?', s))
print(f'Số ký tự mojibake: {mojibake_count}')

if mojibake_count > 5:
    # File đã bị double-encode: chuỗi gốc UTF-8 bị đọc như Latin-1 rồi ghi lại UTF-8
    # Cách sửa: encode latin-1 -> decode utf-8
    try:
        fixed = s.encode('latin-1').decode('utf-8')
        f.write_text(fixed, encoding='utf-8')
        print('✓ Đã sửa double-encode')
        s = fixed
    except Exception as e:
        print(f'✗ Không sửa được: {e}')
        # Thử sửa từng dòng
        lines = s.split('\n')
        fixed_lines = []
        ok = 0
        for line in lines:
            try:
                fixed_lines.append(line.encode('latin-1').decode('utf-8'))
                ok += 1
            except Exception:
                fixed_lines.append(line)
        f.write_text('\n'.join(fixed_lines), encoding='utf-8')
        print(f'✓ Sửa từng dòng: {ok}/{len(lines)}')

final = f.read_text(encoding='utf-8')
print(f'\nSau khi sửa:')
print(f'  Có "Đã tạo": {"Đã tạo" in final}')
print(f'  Có "Đang dùng": {"Đang dùng" in final}')
print(f'  Còn mojibake: {len(re.findall(r"[ÃÂÄ][\x80-\xbf]?", final))}')
