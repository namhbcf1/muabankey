# -*- coding: utf-8 -*-
"""Xoá modal loading trước khi hiện kết quả."""
import pathlib

f = pathlib.Path(__file__).resolve().parent.parent / 'public' / 'assets' / 'pages' / 'home.js'
s = f.read_text(encoding='utf-8')

old = "function showTrialCommand(data, label) {\n  const cmd = data.command || '';"
new = ("function showTrialCommand(data, label) {\n"
       "  // Đóng modal loading trước khi hiện kết quả\n"
       "  document.querySelectorAll('.modal-overlay').forEach((el) => el.remove());\n"
       "  const cmd = data.command || '';")

if old in s:
    s = s.replace(old, new, 1)
    f.write_text(s, encoding='utf-8')
    print('✓ showTrialCommand')
else:
    print('✗ không thấy showTrialCommand')

# showTrialError cũng cần
old2 = "function showTrialError(msg) {"
new2 = ("function showTrialError(msg) {\n"
        "  document.querySelectorAll('.modal-overlay').forEach((el) => el.remove());")
if old2 in s:
    s = s.replace(old2, new2, 1)
    f.write_text(s, encoding='utf-8')
    print('✓ showTrialError')
else:
    print('✗ không thấy showTrialError')
