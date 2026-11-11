# -*- coding: utf-8 -*-
"""Thêm unlimited vào response của issueCommand."""
import pathlib

f = pathlib.Path(__file__).resolve().parent.parent / 'src' / 'routes' / 'trial-command.js'
lines = f.read_text(encoding='utf-8').split('\n')

# Tìm dòng "      used," trong khối return json cuối cùng
for i in range(len(lines) - 1, 0, -1):
    if lines[i].strip() == 'used,' and lines[i].startswith('      used,'):
        lines.insert(i + 1, '      unlimited: !!unlimited,')
        f.write_text('\n'.join(lines), encoding='utf-8')
        print(f'✓ thêm unlimited tại dòng {i + 2}')
        break
else:
    print('✗ không thấy dòng used,')
