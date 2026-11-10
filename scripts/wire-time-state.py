# -*- coding: utf-8 -*-
"""Nối _time_state vào luồng, thêm clock_tampered vào hard-deny."""
from pathlib import Path

p = Path(__file__).resolve().parent.parent / 'tool' / 'src' / 'xa_nofog_pro.py'
s = p.read_text(encoding='utf-8')
report = []

# 1. Thêm clock_tampered vào hard-deny
old1 = "'rate_limit', 'bad_request'):"
new1 = "'rate_limit', 'bad_request', 'clock_tampered'):"
if old1 in s and 'clock_tampered' not in s.split('hard deny')[0]:
    s = s.replace(old1, new1, 1)
    report.append('✓ thêm clock_tampered vào hard-deny')
else:
    report.append('· hard-deny: ' + ('đã có' if 'clock_tampered' in s else 'không thấy'))

# 2. show_status: hiển thị giờ server + cảnh báo lùi đồng hồ
old2 = """    if trial:
        print('Offline   : KHONG (dung thu can mang moi lan chay)')"""
new2 = """    # Hiển thị giờ server + phát hiện lùi đồng hồ
    if _time_anchor['server_ts'] > 0:
        tampered, delta = detect_clock_rollback(st)
        print('Gio server: %s' % time.strftime('%Y-%m-%d %H:%M:%S',
                                               time.localtime(server_now())))
        if tampered:
            print('Dong ho   : CHINH LUI (%.1f gio so voi server)' % (abs(delta) / 3600.0))
        elif abs(delta) > 300:
            print('Dong ho   : lech %.0f phut so voi server' % (abs(delta) / 60.0))
        else:
            print('Dong ho   : dung')

    if trial:
        print('Offline   : KHONG (dung thu can mang moi lan chay)')"""
if old2 in s:
    s = s.replace(old2, new2, 1)
    report.append('✓ show_status hiển thị giờ server')
else:
    report.append('✗ không thấy anchor show_status')

p.write_text(s, encoding='utf-8')
for r in report:
    print(r)

final = p.read_text(encoding='utf-8')
print('')
print('clock_tampered trong hard-deny:', "'clock_tampered'):" in final)
print('show_status co Gio server     :', 'Gio server:' in final)
print('_time_state duoc goi          :', '_time_state(st)' in final)
