# -*- coding: utf-8 -*-
"""Sửa test 'me trả user' — kiểm username thay email."""
import pathlib

f = pathlib.Path(__file__).resolve().parent.parent / 'scripts' / 'e2e.mjs'
s = f.read_text(encoding='utf-8')

old = """ok('me trả user', me.status === 200 && !!me.data?.user?.email,
    `status=${me.status} ${JSON.stringify(me.data || {}).slice(0, 80)}`);"""

new = """ok('me trả user', me.status === 200 && !!me.data?.user?.username,
    `status=${me.status} ${JSON.stringify(me.data || {}).slice(0, 80)}`);"""

if old in s:
    s = s.replace(old, new, 1)
    f.write_text(s, encoding='utf-8')
    print('✓ sửa me trả user -> kiểm username')
else:
    print('· không thấy khối me trả user')
