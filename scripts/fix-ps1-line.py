# -*- coding: utf-8 -*-
"""Sửa PS1 bằng cách thao tác trực tiếp trên dòng 532-533."""
import pathlib

f = pathlib.Path(__file__).resolve().parent.parent / 'src' / 'routes' / 'installer.js'
lines = f.read_text(encoding='utf-8').split('\n')

# Tìm dòng "Step 'Kich hoat license...'" trong template PS1 (sau dòng 500)
idx = None
for i, l in enumerate(lines):
    if i > 500 and 'Kich hoat license' in l and 'Step' in l:
        idx = i
        break

if idx is None:
    print('✗ không thấy')
    raise SystemExit(1)

print(f'Tìm thấy dòng {idx + 1}: {lines[idx].strip()}')
print(f'Dòng {idx + 2}: {lines[idx + 1].strip()}')

# Thay dòng & $Exe --key $Key
target = lines[idx + 1]
if '--key' in target:
    indent = target[:len(target) - len(target.lstrip())]
    new_lines = [
        indent + "# Ma TR- = dung thu -> --trial-key (khong hoi gi)",
        indent + "if ($Key -like 'TR-*') {",
        indent + "  & $Exe --trial-key $Key",
        indent + "} else {",
        indent + "  & $Exe --key $Key",
        indent + "}",
    ]
    lines[idx + 1:idx + 2] = new_lines
    f.write_text('\n'.join(lines), encoding='utf-8')
    print('✓ đã sửa PS1')
else:
    print('✗ dòng sau không có --key:', target)
