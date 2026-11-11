# -*- coding: utf-8 -*-
"""Quét toàn bộ repo: mojibake + cú pháp."""
import pathlib
import re
import subprocess
import sys

root = pathlib.Path(__file__).resolve().parent.parent

# Các đuôi cần quét
EXTS = {'.js', '.mjs', '.py', '.toml', '.sql', '.html', '.css', '.md', '.json'}
SKIP_DIRS = {'node_modules', '.git', '.build', 'dist', '.wrangler', '.dryrun', '.dry2'}

mojibake_files = []
syntax_errors = []

for p in root.rglob('*'):
    if not p.is_file():
        continue
    if any(part in SKIP_DIRS for part in p.parts):
        continue
    if p.suffix not in EXTS:
        continue

    try:
        raw = p.read_bytes()
        s = raw.decode('utf-8')
    except UnicodeDecodeError:
        syntax_errors.append((str(p.relative_to(root)), 'không phải UTF-8 hợp lệ'))
        continue
    except Exception:
        continue

    # Tìm mojibake
    bad = re.findall(r'[ÃÂÄ][\x80-\xbf]', s)
    if len(bad) >= 2:
        # Đếm theo dòng
        lines = s.split('\n')
        bad_lines = [(i + 1, l.strip()[:70]) for i, l in enumerate(lines)
                     if re.search(r'[ÃÂÄ][\x80-\xbf]', l)]
        mojibake_files.append((str(p.relative_to(root)), len(bad), bad_lines[:3]))

print('=' * 60)
print('MOJIBAKE (lỗi encoding)')
print('=' * 60)
if mojibake_files:
    for f, n, lines in sorted(mojibake_files, key=lambda x: -x[1]):
        print(f'\n{f}  ({n} ký tự lỗi)')
        for ln, txt in lines:
            print(f'  dòng {ln}: {txt}')
else:
    print('✓ Không có file nào bị mojibake')

print()
print('=' * 60)
print('CÚ PHÁP')
print('=' * 60)

# Kiểm tra JS
js_files = [p for p in root.rglob('*.js')
            if not any(x in SKIP_DIRS for x in p.parts)
            and 'node_modules' not in str(p)]
js_err = 0
for p in js_files:
    r = subprocess.run(['node', '--check', str(p)], capture_output=True, text=True)
    if r.returncode != 0:
        js_err += 1
        err = (r.stderr or r.stdout).strip().split('\n')[0]
        print(f'  ✗ {p.relative_to(root)}: {err}')
print(f'  JS: {len(js_files)} file, {js_err} lỗi')

# Kiểm tra Python
py_files = [p for p in root.rglob('*.py')
            if not any(x in SKIP_DIRS for x in p.parts)]
py_err = 0
for p in py_files:
    r = subprocess.run([sys.executable, '-m', 'py_compile', str(p)],
                       capture_output=True, text=True)
    if r.returncode != 0:
        py_err += 1
        err = (r.stderr or r.stdout).strip().split('\n')[-1]
        print(f'  ✗ {p.relative_to(root)}: {err}')
print(f'  PY: {len(py_files)} file, {py_err} lỗi')

print()
print('=' * 60)
print('TỔNG KẾT')
print('=' * 60)
total = len(mojibake_files) + js_err + py_err
if total == 0:
    print('✓ SẠCH: không có lỗi encoding hay cú pháp')
else:
    print(f'✗ {total} vấn đề cần fix')
