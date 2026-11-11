# -*- coding: utf-8 -*-
"""Sửa test CMD: chấp nhận resume (mã cũ còn hạn) thay vì luôn claimed."""
import pathlib

f = pathlib.Path(__file__).resolve().parent.parent / 'scripts' / 'e2e-cmd-real.mjs'
s = f.read_text(encoding='utf-8')

# 1. Chấp nhận cả 'active' (resume) lẫn 'claimed' (mới)
old = "    ok('Đã kích hoạt', cd.trial_kind_state === 'claimed', cd.trial_kind_state);"
new = ("    ok('Đã kích hoạt hoặc resume',\n"
       "      ['claimed', 'active'].includes(cd.trial_kind_state), cd.trial_kind_state);")
if old in s:
    s = s.replace(old, new, 1)
    print('✓ sửa điều kiện kích hoạt')
else:
    print('· không thấy điều kiện claimed')

# 2. Thời gian: chấp nhận <= 3600 (có thể đã trôi một phần nếu resume)
old2 = "    ok('Thời gian ~1 giờ', cd.time_left_sec > 3500 && cd.time_left_sec <= 3600, `${cd.time_left_sec}s`);"
new2 = ("    // Resume mã cũ -> thời gian còn lại có thể ít hơn 3600\n"
        "    ok('Thời gian hợp lệ (<= 1 giờ)', cd.time_left_sec > 0 && cd.time_left_sec <= 3600,\n"
        "      `${cd.time_left_sec}s`);")
if old2 in s:
    s = s.replace(old2, new2, 1)
    print('✓ sửa điều kiện thời gian')
else:
    print('· không thấy điều kiện thời gian')

f.write_text(s, encoding='utf-8')
