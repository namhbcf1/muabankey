# -*- coding: utf-8 -*-
"""
Chuyển sang chế độ BẮT BUỘC ONLINE.

Mỗi lần chạy tool phải xác minh được với server. Không có offline grace.

Lý do: chủ shop yêu cầu "bắt online mới được chạy". Đánh đổi: khách mất
mạng sẽ không dùng được tool (kể cả key trả phí). Bù lại: không thể
chặn hosts file / rút mạng để chạy lậu.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TOOL_PY = ROOT / 'tool' / 'src' / 'xa_nofog_pro.py'
TOOL_CFG = ROOT / 'tool' / 'src' / 'xa_config.py'
SERVER = ROOT / 'src' / 'routes' / 'license-server.js'

report = []

# ============================================================
# 1. SERVER: GRACE_HOURS = 0
# ============================================================
s = SERVER.read_text(encoding='utf-8')
if 'const GRACE_HOURS = 24;' in s:
    s = s.replace('const GRACE_HOURS = 24;',
                  '// Bắt buộc online: không có offline grace cho bất kỳ key nào.\n'
                  'const GRACE_HOURS = 0;')
    SERVER.write_text(s, encoding='utf-8')
    report.append('✓ server: GRACE_HOURS = 0')
elif 'const GRACE_HOURS = 0;' in s:
    report.append('· server: GRACE_HOURS đã = 0')
else:
    report.append('✗ server: không tìm thấy GRACE_HOURS')

# ============================================================
# 2. CONFIG: bật cờ require_online
# ============================================================
c = TOOL_CFG.read_text(encoding='utf-8')
if 'REQUIRE_ONLINE' not in c:
    c += '''

# ---------------------------------------------------------------------------
# 8. BAT BUOC ONLINE
# ---------------------------------------------------------------------------
# True  = moi lan chay phai xac minh duoc voi server (khong co offline grace)
# False = cho phep chay offline trong GRACE_HOURS
#
# Khach mat mang se KHONG dung duoc tool. Bui lai: khong the chan hosts
# file / rut mang de chay lau.
REQUIRE_ONLINE = True
'''
    TOOL_CFG.write_text(c, encoding='utf-8')
    report.append('✓ config: thêm REQUIRE_ONLINE = True')
else:
    report.append('· config: đã có REQUIRE_ONLINE')

# ============================================================
# 3. CLIENT: đọc cờ + _grace_left trả 0 khi bắt buộc online
# ============================================================
p = TOOL_PY.read_text(encoding='utf-8')

# 3a. Đọc cờ từ config
if 'REQUIRE_ONLINE = ' not in p.split('def is_trial')[0]:
    old_anchor = "CLIENT_VERSION = '1.2.0'"
    if old_anchor in p:
        p = p.replace(old_anchor,
                      old_anchor + "\n"
                      "# Bat buoc online: khong cho chay offline (grace = 0)\n"
                      "REQUIRE_ONLINE = str(_c('REQUIRE_ONLINE', '1')) not in ('0', 'False', 'false', '')",
                      1)
        report.append('✓ client: đọc REQUIRE_ONLINE')
    else:
        report.append('✗ client: không thấy CLIENT_VERSION')

# 3b. _grace_left: trả 0 khi REQUIRE_ONLINE
old_grace = """    # Ban dung thu KHONG co offline grace: rut mang la khong chay duoc.
    if is_trial(st):
        return 0"""
new_grace = """    # Bắt buộc online: không có offline grace cho BẤT KỲ key nào.
    # Lý do: chặn hosts file / rút mạng là cách chạy lậu phổ biến nhất.
    if REQUIRE_ONLINE:
        return 0
    # Ban dung thu KHONG co offline grace: rut mang la khong chay duoc.
    if is_trial(st):
        return 0"""
if old_grace in p:
    p = p.replace(old_grace, new_grace, 1)
    report.append('✓ client: _grace_left trả 0 khi REQUIRE_ONLINE')
elif 'if REQUIRE_ONLINE:\n        return 0' in p:
    report.append('· client: _grace_left đã có REQUIRE_ONLINE')
else:
    report.append('✗ client: không thấy anchor _grace_left')

# 3c. ensure_licensed: thông báo rõ khi mất mạng (thay vì im lặng)
old_msg = """    return False, 'khong ket noi duoc server va da het grace'"""
new_msg = """    if REQUIRE_ONLINE:
        return False, 'khong ket noi duoc server (bat buoc online)'
    return False, 'khong ket noi duoc server va da het grace'"""
if old_msg in p:
    p = p.replace(old_msg, new_msg, 1)
    report.append('✓ client: thông báo rõ khi mất mạng')

TOOL_PY.write_text(p, encoding='utf-8')

for r in report:
    print(r)

# Xác minh
final = TOOL_PY.read_text(encoding='utf-8')
fs = SERVER.read_text(encoding='utf-8')
print('')
print('server GRACE_HOURS=0 :', 'const GRACE_HOURS = 0;' in fs)
print('config REQUIRE_ONLINE:', 'REQUIRE_ONLINE = True' in TOOL_CFG.read_text(encoding='utf-8'))
print('client REQUIRE_ONLINE:', 'REQUIRE_ONLINE = str(' in final)
print('grace_left check     :', 'if REQUIRE_ONLINE:\n        return 0' in final)
