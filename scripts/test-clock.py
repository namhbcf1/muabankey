# -*- coding: utf-8 -*-
"""Kiểm thử logic server-authoritative time (không cần mạng)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'tool' / 'src'))

import time as _t
import xa_nofog_pro as X

pass_n = 0
fail_n = 0
fails = []


def ok(name, cond, extra=''):
    global pass_n, fail_n
    if cond:
        pass_n += 1
        print('  OK   ' + name)
    else:
        fail_n += 1
        fails.append(name + (' - ' + extra if extra else ''))
        print('  FAIL ' + name + (' - ' + extra if extra else ''))


print('\n=== KIEM THU SERVER-AUTHORITATIVE TIME ===\n')

# 1. Chưa neo -> dùng time.time()
X._time_anchor['server_ts'] = 0
X._time_anchor['mono_at'] = 0.0
n1 = X.server_now()
w1 = _t.time()
ok('chưa neo -> dùng time.time()', abs(n1 - w1) < 2, f'delta={n1-w1:.1f}')

# 2. Neo giờ server
st = {}
server_ts = 1800000000
X.anchor_server_time(st, server_ts)
n2 = X.server_now()
ok('sau khi neo -> trả giờ server', abs(n2 - server_ts) < 2, f'{n2:.0f} vs {server_ts}')
ok('state lưu srv_ts', st.get('srv_ts') == server_ts)
ok('state lưu mono_at', st.get('mono_at', 0) > 0)

# 3. server_now tăng theo monotonic, KHÔNG theo wall clock
before = X.server_now()
_t.sleep(0.3)
after = X.server_now()
ok('server_now tiến theo thời gian thực', 0.2 < (after - before) < 1.0,
   f'delta={after-before:.2f}')

# 4. Mô phỏng lùi đồng hồ: wall clock lùi 2 ngày
#    server_now() vẫn tiến vì dựa vào monotonic
orig_time = _t.time
orig_mono = X._mono
try:
    # Giả lập: wall clock lùi 2 ngày, monotonic KHÔNG đổi
    fake_wall = [orig_time() - 2 * 86400]
    _t.time = lambda: fake_wall[0]
    X.time.time = _t.time

    # Neo lại để có mốc
    X.anchor_server_time(st, server_ts)
    srv_after_rollback = X.server_now()
    ok('lùi đồng hồ hệ thống KHÔNG ảnh hưởng server_now',
       abs(srv_after_rollback - server_ts) < 2,
       f'server_now={srv_after_rollback:.0f}')

    # detect_clock_rollback phải phát hiện
    tampered, delta = X.detect_clock_rollback(st)
    ok('phát hiện lùi đồng hồ', tampered is True, f'tampered={tampered} delta={delta:.0f}')
    ok('delta báo đúng chiều âm', delta < -3600, f'delta={delta:.0f}s')

    # _time_state trả False
    t_ok, t_msg = X._time_state(st)
    ok('_time_state chặn khi lùi đồng hồ', t_ok is False, t_msg)
finally:
    _t.time = orig_time
    X.time.time = orig_time

# 5. Đồng hồ đúng -> không báo
X.anchor_server_time(st, int(orig_time()))
tampered2, delta2 = X.detect_clock_rollback(st)
ok('đồng hồ đúng -> không báo lùi', tampered2 is False, f'delta={delta2:.1f}')

# 6. Đồng hồ lệch nhỏ (NTP/dst) -> không báo
X.anchor_server_time(st, int(orig_time()) - 600)   # lệch 10 phút
tampered3, delta3 = X.detect_clock_rollback(st)
ok('lệch 10 phút -> không báo (dưới tolerance)', tampered3 is False, f'delta={delta3:.0f}')

# 7. Đồng hồ máy CHẬM hơn server 4 giờ (bị lùi) -> phải báo
#    server_now = anchor + mono. Muốn wall < server - 4h thì neo server VỀ TƯƠNG LAI.
X.anchor_server_time(st, int(orig_time()) + 4 * 3600)
tampered4, delta4 = X.detect_clock_rollback(st)
ok('đồng hồ chậm 4 giờ -> báo lùi', tampered4 is True, f'delta={delta4:.0f}')

# 7b. Đồng hồ máy NHANH 4 giờ -> không phải lùi (không chặn oan)
X.anchor_server_time(st, int(orig_time()) - 4 * 3600)
tampered4b, delta4b = X.detect_clock_rollback(st)
ok('đồng hồ nhanh 4 giờ -> không báo lùi', tampered4b is False, f'delta={delta4b:.0f}')

# 8. _grace_left dùng monotonic
st2 = {}
X.anchor_server_time(st2, int(orig_time()))
st2['grace_hours'] = 24
st2['mono_last_ok'] = X._mono() - 3600   # vừa check 1 giờ trước
st2['expires_at'] = int(server_ts) + 86400
g = X._grace_left(st2)
ok('grace tính bằng monotonic (~23h còn)', 22.5 < g / 3600 < 23.5, f'{g/3600:.1f}h')

# 9. Lùi đồng hồ không kéo dài grace
try:
    fake_wall2 = [orig_time() - 5 * 86400]
    _t.time = lambda: fake_wall2[0]
    X.time.time = _t.time
    g2 = X._grace_left(st2)
    ok('lùi đồng hồ KHÔNG kéo dài grace', abs(g2 - g) < 5,
       f'trước={g/3600:.1f}h sau={g2/3600:.1f}h')
finally:
    _t.time = orig_time
    X.time.time = orig_time

# 10. Trial không có grace
st3 = dict(st2)
st3['plan'] = 'trial'
g3 = X._grace_left(st3)
ok('trial grace = 0', g3 == 0, f'{g3}')

print('')
print('-' * 52)
print(f'Tong: {pass_n + fail_n}  |  OK {pass_n}  |  FAIL {fail_n}')
if fail_n:
    print('\nLoi:')
    for f in fails:
        print('  - ' + f)
    sys.exit(1)
print('TAT CA PASS\n')
