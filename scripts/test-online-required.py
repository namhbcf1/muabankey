# -*- coding: utf-8 -*-
"""Kiểm thử chế độ bắt buộc online."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'tool' / 'src'))

import time as _t
import xa_nofog_pro as X

p = 0
f = 0
fails = []


def ok(name, cond, extra=''):
    global p, f
    if cond:
        p += 1
        print('  OK   ' + name)
    else:
        f += 1
        fails.append(name + (' - ' + extra if extra else ''))
        print('  FAIL ' + name + (' - ' + extra if extra else ''))


print('\n=== KIEM THU BAT BUOC ONLINE ===\n')

ok('REQUIRE_ONLINE = True', X.REQUIRE_ONLINE is True, str(X.REQUIRE_ONLINE))
ok('TRIAL_RECHECK_SEC hợp lý', 600 <= X.TRIAL_RECHECK_SEC <= 7200,
   '%ds' % X.TRIAL_RECHECK_SEC)

# _grace_left phải trả 0 khi REQUIRE_ONLINE, kể cả key trả phí
st_paid = {
    'key': 'AOE1-TEST',
    'plan': 'aoe1',
    'grace_hours': 24,
    'mono_last_ok': X._mono() - 100,   # mới check 100s trước
    'expires_at': int(_t.time()) + 86400,
}
g = X._grace_left(st_paid)
ok('key trả phí: grace = 0 (bắt buộc online)', g == 0, 'grace=%s' % g)

# Trial cũng 0
st_trial = dict(st_paid, plan='trial')
ok('trial: grace = 0', X._grace_left(st_trial) == 0)

# Lùi đồng hồ vẫn không kéo dài grace
orig = _t.time
try:
    fake = [orig() - 10 * 86400]
    _t.time = lambda: fake[0]
    X.time.time = _t.time
    g2 = X._grace_left(st_paid)
    ok('lùi đồng hồ 10 ngày -> grace vẫn 0', g2 == 0, 'grace=%s' % g2)
finally:
    _t.time = orig
    X.time.time = orig

# ensure_licensed: mất mạng -> trả "bat buoc online"
# Giả lập: _post trả network error
orig_post = X._post
try:
    X._post = lambda *a, **k: {'ok': False, 'code': 'network', 'msg': 'no net'}
    ok2, msg2 = X.ensure_licensed(verbose=False)
    ok('mất mạng -> không cho chạy', ok2 is False, 'ok=%s msg=%s' % (ok2, msg2))
    ok('thông báo có "bat buoc online"', 'bat buoc online' in msg2, msg2)
finally:
    X._post = orig_post

# trial_guard: mất mạng -> dừng
st = X.load_state()
if st.get('key'):
    orig_post2 = X._post
    try:
        X._post = lambda *a, **k: {'ok': False, 'code': 'network', 'msg': 'no net'}
        X._trial_next_check['at'] = 0.0   # buộc kiểm ngay
        guard = X.trial_guard(verbose=False)
        ok('trial_guard: mất mạng -> dừng', guard is False, 'guard=%s' % guard)
    finally:
        X._post = orig_post2
else:
    print('  (bỏ qua trial_guard: chưa có license)')

print('')
print('-' * 52)
print('Tong: %d  |  OK %d  |  FAIL %d' % (p + f, p, f))
if f:
    print('\nLoi:')
    for x in fails:
        print('  - ' + x)
    sys.exit(1)
print('TAT CA PASS\n')
