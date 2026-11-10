# -*- coding: utf-8 -*-
"""Sửa test dùng hwid thật từ response."""
import pathlib

f = pathlib.Path(__file__).resolve().parent.parent / 'scripts' / 'e2e-trial-v2.mjs'
s = f.read_text(encoding='utf-8')

old = "  const hwid = t1.data.hwid || 'needs-hwid';"
new = "  const hwid = t1.data.hwid;"
if old in s:
    s = s.replace(old, new, 1)
    print('✓ dùng hwid từ response')
else:
    print('· không thấy khối hwid')

# Cũng sửa test check HWID mismatch sau khi biết hwid thật
old2 = "const wrongHwid = await apiCheck(t1.data.key, 'ffffffffffffffffffffffffffffffff');"
if old2 in s:
    print('✓ test HWID mismatch đã đúng')

f.write_text(s, encoding='utf-8')
