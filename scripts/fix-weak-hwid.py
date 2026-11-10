# -*- coding: utf-8 -*-
"""Sửa compute_weak_hwid cho khớp server: sha256('w1|' + parts)."""
import pathlib

f = pathlib.Path(__file__).resolve().parent.parent / 'tool' / 'src' / 'xa_nofog_pro.py'
s = f.read_text(encoding='utf-8')

old = ("    parts = _hwid_parts()[:3]      # MachineGuid + BIOS serial + CPU brand\n"
       "    return hashlib.sha256('|'.join(parts).encode('utf-8')).hexdigest()[:32]")
new = ("    parts = _hwid_parts()[:3]      # MachineGuid + BIOS serial + CPU brand\n"
       "    return hashlib.sha256(('w1|' + '|'.join(parts)).encode('utf-8')).hexdigest()[:32]")

if old in s:
    s = s.replace(old, new, 1)
    f.write_text(s, encoding='utf-8')
    print('✓ sửa weak hwid')
else:
    print('✗ không thấy khối weak hwid')

# Kiểm tra lại 2 công thức
import re
m = re.search(r"def compute_hwid\(\):.*?hexdigest\(\)\[:32\]", s, re.S)
print('\ncompute_hwid hiện tại:')
print(m.group(0)[-200:] if m else '?')
