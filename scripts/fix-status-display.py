# -*- coding: utf-8 -*-
"""Sửa show_status hiển thị đúng gói trial (1 giờ / 3 ngày) và đếm ngược."""
import pathlib

f = pathlib.Path(__file__).resolve().parent.parent / 'tool' / 'src' / 'xa_nofog_pro.py'
s = f.read_text(encoding='utf-8')
n = 0

# 1. Nhãn "DUNG THU %d NGAY" -> dùng state
old1 = "    print('Loai      : %s' % ('DUNG THU %d NGAY' % TRIAL_DAYS if trial else 'BAN QUYEN'))"
new1 = ("    _tl = st.get('trial_label') or ('1 GIO' if st.get('trial_kind') == '1h'\n"
        "                                     else '%d NGAY' % TRIAL_DAYS)\n"
        "    print('Loai      : %s' % ('DUNG THU ' + _tl if trial else 'BAN QUYEN'))")
if old1 in s:
    s = s.replace(old1, new1, 1)
    n += 1
    print('✓ 1. nhãn gói')

# 2. "Con lai : 0.0 ngay" -> dùng _fmt_left
import re
m = re.search(r"    print\('Con lai   : .*?\n", s)
if m:
    old2 = m.group(0)
    new2 = "    print('Con lai   : %s' % _fmt_left(st))\n"
    s = s.replace(old2, new2, 1)
    n += 1
    print('✓ 2. còn lại:', old2.strip()[:50])

# 3. Quota trong status
old3 = "    print('Gio server: %s' %"
new3 = ("    if st.get('quota') is not None and st.get('quota_used') is not None:\n"
        "        print('Luot      : con %d/%d' % (max(0, st['quota'] - st['quota_used']),\n"
        "                                         st['quota']))\n"
        "    print('Gio server: %s' %")
if old3 in s and "Luot      : con" not in s:
    s = s.replace(old3, new3, 1)
    n += 1
    print('✓ 3. quota')

# 4. Nhắc nhở dùng _fmt_left
old4 = re.search(r"    print\('Nhac nho  : con .*?\n", s)
if old4:
    s = s.replace(old4.group(0),
                  "    print('Nhac nho  : con %s, mua key tai %s' % (_fmt_left(st), BUY_URL))\n", 1)
    n += 1
    print('✓ 4. nhắc nhở')

f.write_text(s, encoding='utf-8')
print(f'\nĐã sửa {n}/4')
