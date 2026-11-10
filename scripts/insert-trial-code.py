# -*- coding: utf-8 -*-
"""
Khối code trial — chèn vào xa_nofog_pro.py sau hàm _grace_left.
Chạy script này để tự động chèn.
"""
import re
from pathlib import Path

TOOL = Path(__file__).resolve().parent.parent / 'tool' / 'src' / 'xa_nofog_pro.py'

TRIAL_CODE = '''

# =============================================================================
# PHAN 1b -- DUNG THU 3 NGAY
# =============================================================================
def _days_left(st=None):
    """So ngay con lai (float) hoac None neu khong co han."""
    st = st if st is not None else load_state()
    exp = st.get('expires_at') or 0
    if not exp:
        return None
    return (exp - time.time()) / 86400.0


def _print_trial_banner(st):
    left = _days_left(st) or 0.0
    exp = st.get('expires_at') or 0
    print('')
    print('  ============================================================')
    print('   DUNG THU MIEN PHI %d NGAY  --  con %.1f ngay' % (TRIAL_DAYS, left))
    print('   Het han: %s' % time.strftime('%Y-%m-%d %H:%M', time.localtime(exp)))
    print('   Mua key: %s' % BUY_URL)
    print('  ============================================================')
    print('')


def _warn_trial(st):
    """Nhac 1 dong khi sap het han. Khong bao gio chan."""
    left = _days_left(st)
    if left is None:
        return
    if left <= 0:
        print('  [!] DUNG THU DA HET HAN. Mua key tai %s' % BUY_URL)
    elif left <= TRIAL_WARN_DAYS:
        print('  [!] Dung thu con %.1f ngay. Mua key tai %s' % (left, BUY_URL))


def _offer_buy():
    print('')
    print('  ============================================================')
    print('   DUNG THU %d NGAY DA KET THUC' % TRIAL_DAYS)
    print('  ------------------------------------------------------------')
    print('   Mua key tai : %s' % BUY_URL)
    print('   Nhap key    : chay lai tool va nhap khi duoc hoi,')
    print('                 hoac: xa_nofog_pro.exe --key AOE1-XXXX-XXXX-XXXX')
    print('   Key gan voi may nay (HWID), doi may duoc 1 lan.')
    print('  ============================================================')
    print('')


def open_buy_page():
    """Mo trang mua hang. Tra True/False, khong bao gio raise.

    Uu tien explorer.exe: EXE build bang --uac-admin nen tien trinh luon
    elevated; explorer chuyen tiep yeu cau sang phien nguoi dung -> browser
    mo KHONG co quyen admin.
    """
    try:
        import subprocess
        subprocess.Popen(['explorer.exe', BUY_URL], close_fds=True)
        return True
    except Exception:
        pass
    try:
        import webbrowser
        return bool(webbrowser.open(BUY_URL))
    except Exception:
        return False


def start_trial(verbose=True):
    """Xin trial tu server. Tra (ok, msg).

    msg dac biet:
      'expired'  -> may nay da tung dung thu va da het han
      'used'     -> het luot dung thu (IP / thiet bi)
      khac       -> loi mang / server

    Gui RAW parts (guid/bios/cpu/vol) chu khong gui hwid: server tu bam,
    nen khong the farm trial bang HWID tu bịa.
    """
    if not TRIAL_ENABLED:
        return False, 'ban nay khong co dung thu'

    parts = _hwid_parts()
    if verbose:
        print('  May chua kich hoat -> bat dung thu %d ngay.' % TRIAL_DAYS)
        print('  (gui ma may HWID toi %s de tao ban dung thu)' % API_BASE)

    r = _post('/api/trial/start', {
        'guid': parts[0], 'bios': parts[1], 'cpu': parts[2], 'vol': parts[3],
        'app': APP_NAME, 'ver': CLIENT_VERSION,
    }, timeout=HTTP_TIMEOUT, retries=1)

    if not r.get('ok'):
        code = str(r.get('code') or '')
        if code == 'trial_expired':
            return False, 'expired'
        if code in ('trial_denied_device',):
            return False, 'device'
        if code in ('trial_limit',):
            return False, 'used'
        if code == 'trial_disabled':
            return False, 'disabled'
        return False, r.get('msg') or code or 'khong bat duoc dung thu'

    key = str(r.get('key') or '').strip().upper()
    if not key:
        return False, 'server khong tra ma dung thu'

    st = load_state()
    st.update({
        'key': key,
        'hwid': compute_hwid(),
        'expires_at': r.get('expires_at', 0),
        'activated_at': r.get('activated_at', 0),
        'plan': 'trial',
        'is_trial': 1,
        'trial_started': int(time.time()),
        'grace_hours': r.get('grace_hours', TRIAL_GRACE_HOURS),
        'last_ok': time.time(),
        'mode': 'server',
    })
    if not save_state(st):
        return False, 'khong ghi duoc file license'

    if verbose:
        _print_trial_banner(st)
    return True, 'ok'


_trial_next_check = {'at': 0.0}


def trial_guard(verbose=True):
    """Goi trong vong lap thuong tru: het han giua phien thi dung han.

    Chi kiem toi da 1 lan / TRIAL_RECHECK_SEC. Ban tra phi luon True.
    """
    st = load_state()
    if not is_trial(st):
        return True

    now = time.time()
    exp = st.get('expires_at') or 0
    if exp and now > exp:
        if verbose:
            _offer_buy()
        return False

    if now < _trial_next_check['at']:
        return True
    _trial_next_check['at'] = now + TRIAL_RECHECK_SEC

    ok, msg = ensure_licensed(verbose=False)
    if not ok:
        if verbose:
            print('  Khong xac minh duoc dung thu: %s' % msg)
            _offer_buy()
        return False
    return True
'''


def main():
    src = TOOL.read_text(encoding='utf-8')

    if 'def start_trial(' in src:
        print('Đã có sẵn khối trial, bỏ qua')
        return

    # Chèn sau hàm _grace_left (kết thúc bằng "return st.get('grace_hours', 24) * 3600 - (time.time() - st.get('last_ok', 0))")
    anchor = "    return st.get('grace_hours', 24) * 3600 - (time.time() - st.get('last_ok', 0))\n"
    idx = src.find(anchor)
    if idx == -1:
        print('❌ Không tìm thấy anchor _grace_left')
        return

    insert_at = idx + len(anchor)
    new = src[:insert_at] + TRIAL_CODE + src[insert_at:]
    TOOL.write_text(new, encoding='utf-8')
    print('✓ Đã chèn khối trial (%d ký tự)' % len(TRIAL_CODE))
    print('  start_trial:', 'def start_trial(' in new)
    print('  trial_guard:', 'def trial_guard(' in new)
    print('  _offer_buy :', 'def _offer_buy(' in new)


if __name__ == '__main__':
    main()
