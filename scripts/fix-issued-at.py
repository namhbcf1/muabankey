# -*- coding: utf-8 -*-
"""Đổi issued_at -> created_at cho khớp schema trial_uses."""
import pathlib

root = pathlib.Path(__file__).resolve().parent.parent
files = [
    'src/lib/trial-quota.js',
    'src/routes/trial.js',
    'src/routes/trial-admin.js',
    'src/routes/license-server.js',
]

total = 0
for rel in files:
    f = root / rel
    s = f.read_text(encoding='utf-8')
    n = s.count('issued_at')
    if n:
        s = s.replace('issued_at', 'created_at')
        f.write_text(s, encoding='utf-8')
        total += n
        print(f'✓ {rel}: {n} chỗ')

print(f'\nTổng: {total}')

# Kiểm tra còn không
print('\nCòn issued_at:')
for rel in files:
    s = (root / rel).read_text(encoding='utf-8')
    if 'issued_at' in s:
        for i, l in enumerate(s.split('\n'), 1):
            if 'issued_at' in l:
                print(f'  {rel}:{i} {l.strip()[:70]}')
