# -*- coding: utf-8 -*-
"""Thêm openModal vào import của licenses.js."""
import pathlib

f = pathlib.Path(__file__).resolve().parent.parent / 'public' / 'assets' / 'pages' / 'licenses.js'
s = f.read_text(encoding='utf-8')

old = "import { api, esc, fmtDate, timeAgo, toast, navigate, loadingBlock, copyText } from '../lib.js';"
new = "import { api, esc, fmtDate, timeAgo, toast, navigate, loadingBlock, copyText, openModal } from '../lib.js';"

if old in s:
    s = s.replace(old, new, 1)
    f.write_text(s, encoding='utf-8')
    print('✓ thêm openModal')
else:
    line0 = s.split('\n')[0]
    if 'openModal' in line0:
        print('· đã có openModal')
    else:
        print('· KHÔNG THẤY import, dòng 1:', line0[:100])
