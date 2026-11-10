# -*- coding: utf-8 -*-
"""
Khối quản lý thời gian SERVER-AUTHORITATIVE cho client tool.

Vấn đề cũ:
  - Client dùng time.time() (đồng hồ hệ thống) để quyết định "còn hạn hay không".
  - Khách lùi đồng hồ → grace dài vô hạn, chạy offline mãi.
  - _time_state() chống lùi đồng hồ là DEAD CODE (không ai gọi).

Giải pháp:
  1. Giờ do SERVER quyết định: mọi response /api/check, /api/activate trả `now`.
  2. Client neo (now_server, monotonic_at_anchor) — dùng time.monotonic()
     là đồng hồ đơn điệu của hệ điều hành, KHÔNG chỉnh được bằng cách đổi
     ngày giờ trong Settings, cũng không nhảy khi NTP sync.
  3. Mọi phép tính hạn dùng dùng server_now(), không dùng time.time().
  4. Grace được đo bằng monotonic → lùi đồng hồ hệ thống không kéo dài được.
  5. Phát hiện lùi đồng hồ: nếu time.time() nhảy lùi đáng kể so với
     monotonic → đánh dấu clock_tampered.

Chèn script này vào xa_nofog_pro.py.
"""

CODE = '''

# =============================================================================
# PHAN 1a -- DONG HO SERVER-AUTHORITATIVE (chong lui dong ho)
# =============================================================================
# _time_anchor = {server_ts, mono_at}  -- neo giờ server vào monotonic clock
_time_anchor = {'server_ts': 0, 'mono_at': 0.0}


def _mono():
    """Dong ho don dieu. KHONG bi anh huong khi doi ngay gio he thong."""
    try:
        return time.monotonic()
    except Exception:
        return time.time()


def anchor_server_time(st, server_ts):
    """Neo gio server vao monotonic clock (goi moi khi server tra `now`)."""
    try:
        ts = int(server_ts)
    except Exception:
        return
    if ts <= 0:
        return
    _time_anchor['server_ts'] = ts
    _time_anchor['mono_at'] = _mono()
    try:
        st['srv_ts'] = ts
        st['mono_at'] = _time_anchor['mono_at']
    except Exception:
        pass


def load_anchor(st):
    """Khoi phuc neo tu state (sau khi mo lai tool)."""
    try:
        ts = int(st.get('srv_ts') or 0)
        ma = float(st.get('mono_at') or 0)
    except Exception:
        return
    if ts > 0 and ma > 0:
        _time_anchor['server_ts'] = ts
        _time_anchor['mono_at'] = ma


def server_now():
    """Gio server uoc tinh. Dung monotonic -> lui dong ho he thong vo dung.

    Neu chua tung lien lac server (chua co neo) -> tra time.time().
    """
    if _time_anchor['server_ts'] > 0:
        delta = _mono() - _time_anchor['mono_at']
        if delta < 0:
            # Monotonic khong the chay lui -> chi co the do khac process
            delta = 0
        return _time_anchor['server_ts'] + delta
    return time.time()


def detect_clock_rollback(st):
    """Phat hien lui dong ho he thong.

    So sanh time.time() (co the bi sua) voi server_now() (monotonic).
    Neu dong ho he thong lui qua CLOCK_SKEW_TOLERANCE so voi gio server
    uoc tinh -> co dau hieu chinh lui.

    Tra (tampered: bool, delta_seconds: float)
    """
    if _time_anchor['server_ts'] <= 0:
        return False, 0.0
    wall = time.time()
    srv = server_now()
    delta = wall - srv          # >0: dong ho may nhanh; <0: dong ho may cham/lui
    if delta < -CLOCK_SKEW_TOLERANCE:
        return True, delta
    return False, delta


def _time_state(st):
    """Kiem tra + ghi moc thoi gian. Goi moi lan check online.

    Tra (ok: bool, msg: str). ok=False nghia la phat hien chinh lui dong ho.
    """
    tampered, delta = detect_clock_rollback(st)
    if tampered:
        # Ghi nhan vao state de lan sau con biet
        try:
            st['clock_tampered'] = 1
            st['clock_delta'] = round(delta, 1)
            save_state(st)
        except Exception:
            pass
        return False, ('dong ho may cham hon %.1f gio so voi server'
                       % (abs(delta) / 3600.0))

    # Moc thoi gian cao nhat tung thay (chong lui don gian)
    try:
        prev = int(st.get('mono_high') or 0)
        cur = int(_mono())
        if cur > prev:
            st['mono_high'] = cur
    except Exception:
        pass
    return True, 'ok'
'''

VARIABLE_FIXES = [
    # _grace_left: do bang monotonic, khong dung time.time()
    (
        """def _grace_left(st):
    \"\"\"So giay con duoc chay offline ke tu lan check thanh cong cuoi.\"\"\"
    # Ban dung thu KHONG co offline grace: neu cho phep, chi can rut mang
    # la 3 ngay thanh 4-5 ngay, va moi ma loi khong xac dinh deu bi day
    # vao nhanh grace (khong kiem tra duoc han that).
    if is_trial(st):
        return 0
    if not st.get('last_ok'):
        return 0
    return st.get('grace_hours', 24) * 3600 - (time.time() - st.get('last_ok', 0))""",
        """def _grace_left(st):
    \"\"\"So giay con duoc chay offline ke tu lan check thanh cong cuoi.

    DO BANG MONOTONIC, khong phai dong ho he thong: lui dong ho khong keo
    dai duoc grace.
    \"\"\"
    # Ban dung thu KHONG co offline grace: rut mang la khong chay duoc.
    if is_trial(st):
        return 0
    mono_ok = st.get('mono_last_ok')
    if mono_ok is None:
        return 0
    try:
        elapsed = _mono() - float(mono_ok)
    except Exception:
        return 0
    if elapsed < 0:
        elapsed = 0
    return st.get('grace_hours', 24) * 3600 - elapsed""",
    ),
    # _days_left: dung server_now()
    (
        """def _days_left(st=None):
    \"\"\"So ngay con lai (float) hoac None neu khong co han.\"\"\"
    st = st if st is not None else load_state()
    exp = st.get('expires_at') or 0
    if not exp:
        return None
    return (exp - time.time()) / 86400.0""",
        """def _days_left(st=None):
    \"\"\"So ngay con lai (float) hoac None neu khong co han.

    Dung server_now() (monotonic), KHONG dung time.time().
    \"\"\"
    st = st if st is not None else load_state()
    exp = st.get('expires_at') or 0
    if not exp:
        return None
    return (exp - server_now()) / 86400.0""",
    ),
]

ANCHOR_CALLS = [
    # check_online: neo server time + kiem dong ho
    (
        """    st.update({
        'expires_at': r.get('expires_at', 0),
        'activated_at': r.get('activated_at', 0),
        'plan': r.get('plan'),
        'grace_hours': r.get('grace_hours', 24),
        'last_ok': time.time(),
    })
    save_state(st)
    return True, 'ok'""",
        """    anchor_server_time(st, r.get('now'))
    st.update({
        'expires_at': r.get('expires_at', 0),
        'activated_at': r.get('activated_at', 0),
        'plan': r.get('plan'),
        'grace_hours': r.get('grace_hours', 24),
        'last_ok': time.time(),
        'mono_last_ok': _mono(),
    })
    save_state(st)
    return True, 'ok'""",
    ),
    # activate: neo server time
    (
        """    st = load_state()
    st.update({
        'key': key.strip().upper(),
        'hwid': hwid,
        'expires_at': r.get('expires_at', 0),""",
        """    st = load_state()
    anchor_server_time(st, r.get('now'))
    st.update({
        'key': key.strip().upper(),
        'hwid': hwid,
        'expires_at': r.get('expires_at', 0),""",
    ),
]

GUARD_FIX = (
    """    now = time.time()
    exp = st.get('expires_at') or 0
    if exp and now > exp:""",
    """    now = server_now()          # gio server, khong phai dong ho may
    exp = st.get('expires_at') or 0
    if exp and now > exp:""",
)


def main():
    from pathlib import Path
    TOOL = Path(__file__).resolve().parent.parent / 'tool' / 'src' / 'xa_nofog_pro.py'
    src = TOOL.read_text(encoding='utf-8')
    report = []

    if '_time_anchor' in src:
        print('Đã có khối server-time, bỏ qua chèn')
    else:
        # Chèn khối code trước "PHAN 1b -- DUNG THU"
        anchor_marker = '# =============================================================================\n# PHAN 1b -- DUNG THU 3 NGAY'
        idx = src.find(anchor_marker)
        if idx == -1:
            print('❌ Không tìm thấy marker PHAN 1b')
            return
        src = src[:idx] + CODE.strip() + '\n\n\n' + src[idx:]
        report.append('✓ chèn khối server-time')

    for old, new in VARIABLE_FIXES + ANCHOR_CALLS + [GUARD_FIX]:
        if old in src:
            src = src.replace(old, new, 1)
            report.append('✓ ' + old.strip().split('\n')[0][:56])
        else:
            report.append('✗ KHÔNG THẤY: ' + old.strip().split('\n')[0][:56])

    TOOL.write_text(src, encoding='utf-8')
    for r in report:
        print(r)

    # Xác minh
    final = TOOL.read_text(encoding='utf-8')
    print('')
    print('_time_anchor    :', '_time_anchor' in final)
    print('server_now()    :', 'def server_now(' in final)
    print('anchor_server_time:', 'def anchor_server_time(' in final)
    print('detect_rollback :', 'def detect_clock_rollback(' in final)
    print('mono_last_ok    :', 'mono_last_ok' in final)


if __name__ == '__main__':
    main()
