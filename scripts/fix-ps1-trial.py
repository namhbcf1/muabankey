# -*- coding: utf-8 -*-
"""Sửa PS1: mã TR- dùng --trial-key."""
import pathlib

f = pathlib.Path(__file__).resolve().parent.parent / 'src' / 'routes' / 'installer.js'
s = f.read_text(encoding='utf-8')

old = "  Step 'Kich hoat license...'\n  & $Exe --key $Key"
new = ("  Step 'Kich hoat license...'\n"
       "  # Ma TR- = dung thu -> --trial-key (khong hoi gi). Khac -> --key\n"
       "  if ($Key -like 'TR-*') {\n"
       "    & $Exe --trial-key $Key\n"
       "  } else {\n"
       "    & $Exe --key $Key\n"
       "  }")

if old in s:
    s = s.replace(old, new, 1)
    f.write_text(s, encoding='utf-8')
    print('✓ sửa PS1')
else:
    print('✗ không thấy')
    # Thử tìm
    idx = s.find('Kich hoat license')
    if idx > 0:
        print('Ngữ cảnh:', repr(s[idx-40:idx+120]))
