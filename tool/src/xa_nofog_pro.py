#!/usr/bin/env python3
"""XArena No Fog Pro -- MOT FILE DUY NHAT: license + no-fog + thuong tru.

    xa_nofog_pro.exe                # thuong tru: doi game, va 1 lan/game
    xa_nofog_pro.exe --once         # va 1 lan neu game dang mo, roi thoat
    xa_nofog_pro.exe --off          # tra byte goc 17/17 (game phai dang mo)
    xa_nofog_pro.exe --dump         # in trang thai byte cua tung cong
    xa_nofog_pro.exe --list         # liet ke cong + byte goc/byte va
    xa_nofog_pro.exe --full         # them 7 cong legacy (F I J K L O T2)
    xa_nofog_pro.exe --watch        # va lai moi 0.5s -- CHI de debug
    xa_nofog_pro.exe --key XXXX     # kich hoat bang key, roi thoat
    xa_nofog_pro.exe --trial        # bat dung thu 3 ngay (tu dong neu chua co key)
    xa_nofog_pro.exe --buy          # mo trang mua key
    xa_nofog_pro.exe --rebind K T   # doi may bang token
    xa_nofog_pro.exe --status       # xem trang thai license
    xa_nofog_pro.exe --deactivate   # xoa key khoi may nay
    xa_nofog_pro.exe --help         # huong dan

Quyen admin:
  --list / --status / --help / --deactivate / --key  -> KHONG can admin
  cac lenh va game (mac dinh, --once, --off, --dump, --watch, --full)
                                                    -> CAN admin, tu xin UAC
  Thu tu: kiem license truoc, xin admin sau.

MAC DINH = THUONG TRU: script nam cho, moi 2 giay kiem game mot lan. Khi game
khoi dong -> va DUNG MOT LAN vao 10 dia chi render -> roi KHONG cham vao nua.
Game thoat thi quay lai cho. Mo game lai bao nhieu lan cung duoc.
Chi mot ban chay cung luc (named mutex Global\\XArenaNoFogPro).

Vi sao "va dung mot lan": moi lan ghi byte la mot lan engine co the doc code
dang bi sua giua vong ve. Va luc game vua khoi dong, chua vao tran, la thoi
diem an toan nhat -- chua co lockstep, chua co checksum nao chay.

Ctrl-C KHONG tra byte goc (tranh lam game out); dung --off de tra goc.

================================================================================
PHAN 1 -- LICENSE
================================================================================
- HWID tinh tu phan cung that: MachineGuid + BIOS serial (SMBIOS type 2)
  + CPU brand + volume serial o C:. Khong dung ten may / MAC (doi qua de).
- State ma hoa DPAPI (CryptProtectData), rang buoc user Windows. Chep file
  sang may khac = khong giai ma duoc.
- Kiem tra qua server Cloudflare (D1): server gan key voi MOT may. Copy
  chuoi key sang may khac se bi tu choi (hwid_mismatch).
- Phat hien chinh lui dong ho he thong (nhieu moc: file + registry).
- BAT BUOC ONLINE: moi lan chay phai xac minh duoc voi server.
  Khong co offline grace. Mat mang = khong chay duoc.
  (Tat bang REQUIRE_ONLINE=False trong xa_config.py neu can.)

================================================================================
PHAN 2 -- NO FOG
================================================================================
17 cong, chia 3 nhom: viewport (T1 V3 V6), minimap (A B C D E M N),
legacy (F I J K L O T2). Tat ca chi sua DUONG VE, khong sua LOGIC.

--- Ba cong toi thieu ---
T1  0x514E0F  nop je          -> terrain sang toan map
V3  0x514F58  je -> jmp       -> bo grid kim cuong mo
V6  0x516590  stub ham ve fog -> khong con gi de ve

--- Vi sao V4/V5 bi loai ---
Nhay qua ca `mov [esp+0x3C],eax` -> caller dung index cu -> AV doc 0x2103E1E.

--- Vi sao khong ghi mask ---
Byte 2 cua mask la chi so bang. Ghi vao lam engine tra pointer sai va crash.
"""
import base64
import ctypes
import ctypes.wintypes as wt
import hashlib
import hmac
import json
import os
import struct
import sys
import time
import urllib.error
import urllib.request

# Console Windows co the dung codepage cu (cp437/cp1258/cp1252) khong ma hoa
# duoc tieng Viet co dau -> print() nem UnicodeEncodeError va lam chet chuong
# trinh. Doi stdout/stderr sang UTF-8 va khoan dung loi truoc khi in bat cu thu.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

# =============================================================================
# CAU HINH
# -----------------------------------------------------------------------------
# Toan bo gia tri lay tu xa_config.py de de chinh sua ma khong dung vao code.
# Neu file do khong co, dung gia tri mac dinh ben duoi.
# =============================================================================
try:
    import xa_config as _cfg
except Exception:
    _cfg = None


def _c(name, default):
    """Doc gia tri cau hinh, uu tien bien moi truong roi den xa_config."""
    env = os.environ.get('XA_' + name)
    if env is not None:
        return env
    if _cfg is not None and hasattr(_cfg, name):
        return getattr(_cfg, name)
    return default


LICENSE_MODE = 'server'

# Server license (Cloudflare Worker + D1). Server la bo nho chung:
# no biet key da gan may nao, nen mot key khong dung duoc tren may thu hai.
API_BASE = str(_c('API_BASE', 'https://xienhl.com')).rstrip('/')
APP_NAME = str(_c('APP_NAME', 'XArena No Fog'))

# Han tinh tu LAN KICH HOAT DAU TIEN, server luu activated_at.
# Server da cong san 1 ngay bonus khi tao key (xem admin dashboard).
# Cac ten goi chi de tham khao -- client khong con tu quyet han.
TERMS = dict(_c('TERMS', {'TUAN': 7, 'THANG': 30, 'NAM': 365, 'VINHVIEN': 0}))

PROCESS_NAMES = tuple(_c('PROCESS_NAMES', ('EMPIRESX.EXE', 'EMPIRESX_HD.EXE', 'EMPIRESX_HDR.EXE')))
PREFERRED_BASE = int(_c('PREFERRED_BASE', 0x400000))
RESIDENT_POLL = float(_c('RESIDENT_POLL', 2.0))
HTTP_TIMEOUT = int(_c('HTTP_TIMEOUT', 10))
EXIT_NOT_ADMIN = int(_c('EXIT_NOT_ADMIN', 5))
EXIT_NO_LICENSE = int(_c('EXIT_NO_LICENSE', 3))
EXIT_ALREADY_RUNNING = int(_c('EXIT_ALREADY_RUNNING', 4))
MUTEX_NAME = str(_c('MUTEX_NAME', r'Global\XArenaNoFogPro'))
ERROR_ALREADY_EXISTS = 183
_mutex_handle = None
# Dong ho chay cham/lui trong khoang nay duoc coi la binh thuong
# (dong bo NTP, doi mui gio, DST). Vuot qua moi coi la chinh lui.
CLOCK_SKEW_TOLERANCE = int(_c('CLOCK_SKEW_TOLERANCE', 2 * 3600))
REG_KEY = str(_c('REG_KEY', r'Software\Microsoft\Windows\CurrentVersion\XASupport'))

# --- DUNG THU ---------------------------------------------------------------
TRIAL_ENABLED = str(_c('TRIAL_ENABLED', '1')) not in ('0', 'False', 'false', '')
TRIAL_DAYS = int(_c('TRIAL_DAYS', 3))
TRIAL_GRACE_HOURS = int(_c('TRIAL_GRACE_HOURS', 0))
TRIAL_WARN_DAYS = float(_c('TRIAL_WARN_DAYS', 1))
TRIAL_RECHECK_SEC = int(_c('TRIAL_RECHECK_SEC', 1800))
BUY_URL = str(_c('BUY_URL', 'https://xienhl.com/#/product/license-xarena-thang'))
EXIT_TRIAL_END = int(_c('EXIT_TRIAL_END', 6))
CLIENT_VERSION = '1.2.0'
# Bat buoc online: khong cho chay offline (grace = 0)
REQUIRE_ONLINE = str(_c('REQUIRE_ONLINE', '1')) not in ('0', 'False', 'false', '')

# =============================================================================
# PHAN 1 -- LICENSE
# =============================================================================
STATE_DIR = os.path.join(
    os.environ.get('LOCALAPPDATA', os.path.expanduser('~')),
    str(_c('STATE_SUBDIR', 'XArenaNoFog')),
)
STATE_FILE = os.path.join(STATE_DIR, 'lic.bin')

kernel32 = ctypes.WinDLL('kernel32', use_last_error=True)
shell32 = ctypes.WinDLL('shell32', use_last_error=True)
psapi = ctypes.WinDLL('psapi', use_last_error=True)
crypt32 = ctypes.WinDLL('crypt32', use_last_error=True)

kernel32.CreateMutexW.restype = wt.HANDLE
kernel32.CreateMutexW.argtypes = [ctypes.c_void_p, wt.BOOL, wt.LPCWSTR]
kernel32.GetLastError.restype = wt.DWORD
kernel32.GetExitCodeProcess.restype = wt.BOOL
kernel32.GetExitCodeProcess.argtypes = [wt.HANDLE, ctypes.POINTER(wt.DWORD)]
kernel32.SetConsoleTitleW.restype = wt.BOOL
kernel32.SetConsoleTitleW.argtypes = [wt.LPCWSTR]


class DATA_BLOB(ctypes.Structure):
    _fields_ = [('cbData', wt.DWORD), ('pbData', ctypes.POINTER(ctypes.c_char))]


crypt32.CryptProtectData.argtypes = [
    ctypes.POINTER(DATA_BLOB), wt.LPCWSTR, ctypes.POINTER(DATA_BLOB),
    ctypes.c_void_p, ctypes.c_void_p, wt.DWORD, ctypes.POINTER(DATA_BLOB)]
crypt32.CryptUnprotectData.argtypes = [
    ctypes.POINTER(DATA_BLOB), ctypes.POINTER(wt.LPWSTR), ctypes.POINTER(DATA_BLOB),
    ctypes.c_void_p, ctypes.c_void_p, wt.DWORD, ctypes.POINTER(DATA_BLOB)]


def _blob(data):
    buf = ctypes.create_string_buffer(data, len(data))
    return DATA_BLOB(len(data), ctypes.cast(buf, ctypes.POINTER(ctypes.c_char))), buf


def _dpapi_encrypt(data):
    """Ma hoa bang DPAPI (pot tuoi CurrentUser)."""
    bi, _keep = _blob(data)
    out = DATA_BLOB()
    if not crypt32.CryptProtectData(ctypes.byref(bi), None, None, None, None,
                                    0x01, ctypes.byref(out)):
        return None
    try:
        return ctypes.string_at(out.pbData, out.cbData)
    finally:
        kernel32.LocalFree(out.pbData)


def _dpapi_decrypt(data):
    bi, _keep = _blob(data)
    out = DATA_BLOB()
    if not crypt32.CryptUnprotectData(ctypes.byref(bi), None, None, None, None,
                                      0x01, ctypes.byref(out)):
        return None
    try:
        return ctypes.string_at(out.pbData, out.cbData)
    finally:
        kernel32.LocalFree(out.pbData)


# --------------------------------------------------------------- hwid -------
def _machine_guid():
    try:
        import winreg
        with winreg.OpenKey(
            winreg.HKEY_LOCAL_MACHINE, r'SOFTWARE\Microsoft\Cryptography', 0,
            winreg.KEY_READ | winreg.KEY_WOW64_64KEY,
        ) as k:
            return str(winreg.QueryValueEx(k, 'MachineGuid')[0]).strip()
    except Exception:
        return ''


def _volume_serial():
    try:
        serial = ctypes.c_ulong(0)
        maxlen = ctypes.c_ulong(0)
        flags = ctypes.c_ulong(0)
        ok = kernel32.GetVolumeInformationW(
            ctypes.c_wchar_p('C:\\'), None, 0,
            ctypes.byref(serial), ctypes.byref(maxlen), ctypes.byref(flags),
            None, 0)
        return '%08X' % serial.value if ok else ''
    except Exception:
        return ''


def _cpu_brand():
    try:
        import winreg
        with winreg.OpenKey(
            winreg.HKEY_LOCAL_MACHINE,
            r'HARDWARE\DESCRIPTION\System\CentralProcessor\0', 0,
            winreg.KEY_READ | winreg.KEY_WOW64_64KEY,
        ) as k:
            return ' '.join(str(winreg.QueryValueEx(k, 'ProcessorNameString')[0]).split())
    except Exception:
        return ''


def _bios_serial():
    """Serial mainboard tu SMBIOS type 2 (System Information), offset +0x07.

    Chuoi bat dau NGAY tai i+slen (khong phai sau mot byte 0), cac chuoi
    ngan bang '\\0' va ket thuc bang '\\0\\0'. Guard cu kiem data[i+slen]==0
    nen chi dung khi chuoi 1 rong -> tren may that luon tra ''.
    """
    try:
        fn = kernel32.GetSystemFirmwareTable
        fn.restype = ctypes.c_ulong
        fn.argtypes = [ctypes.c_ulong, ctypes.c_ulong, ctypes.c_void_p, ctypes.c_ulong]
        RSMB = 0x52534D42
        size = fn(RSMB, 0, None, 0)
        if not size:
            return ''
        buf = ctypes.create_string_buffer(size)
        if not fn(RSMB, 0, buf, size):
            return ''
        raw = buf.raw
        if len(raw) < 8:
            return ''
        length = struct.unpack_from('<I', raw, 4)[0]
        data = raw[8:8 + length]
        i = 0
        while i + 3 < len(data):
            stype = data[i]
            slen = data[i + 1]
            if slen < 4:
                break
            if stype == 127:
                break
            if stype == 2 and i + 7 < i + slen:
                # Chuoi bat dau tai i+slen; tach toi da 32 chuoi
                tbl = data[i + slen:i + slen + 256]
                strs = tbl.split(b'\x00')
                idx = data[i + 7]
                if 1 <= idx < len(strs):
                    s = strs[idx - 1].decode('latin1').strip()
                    # Loai gia tri rac / placeholder cua mot so firmware
                    if s and s.lower() not in (
                            'to be filled by o.e.m.', 'default string',
                            'system serial number', 'none', 'unknown', 'n/a',
                            '0', '1234567890'):
                        return s
            # nhay qua string table: tim 2 byte 0 lien tiep
            j = i + slen
            while j + 1 < len(data) and not (data[j] == 0 and data[j + 1] == 0):
                j += 1
            i = j + 2
        return ''
    except Exception:
        return ''


def _hwid_parts():
    """Bon manh phan cung tho (chua bam).

    Server can tung manh rieng (khong chi hash cuoi) de:
      - tu tinh HWID (khong tin hwid client gui len)
      - fuzzy match: doi 1 thanh phan van nhan ra cung may
      - phat hien may ao tu BIOS/CPU vendor string
    """
    return [_machine_guid(), _bios_serial(), _cpu_brand(), _volume_serial()]


def compute_hwid():
    """SHA-256 phan cung that. Khong dung ten may / MAC (doi qua de)."""
    parts = _hwid_parts()
    return hashlib.sha256('|'.join(parts).encode('utf-8')).hexdigest()[:32]


def compute_weak_hwid():
    """HWID 'cung' -- BO volume serial.

    Volume serial doi duoc bang phan mem (va doi khi format o). Neu dung
    compute_hwid() lam dau vet chong reset trial thi chi can doi serial la
    xin duoc trial moi. Chuoi nay on dinh hon.
    """
    parts = _hwid_parts()[:3]      # MachineGuid + BIOS serial + CPU brand
    return hashlib.sha256('|'.join(parts).encode('utf-8')).hexdigest()[:32]


# --------------------------------------------------------------- state ------
def load_state():
    """Doc state, giai ma DPAPI. LUON tra dict (rong neu chua co / hong)."""
    try:
        with open(STATE_FILE, 'rb') as f:
            raw = f.read()
    except Exception:
        return {}
    if raw[:4] != b'XANF':
        return {}
    pt = _dpapi_decrypt(raw[4:])
    if not pt:
        return {}
    try:
        obj = json.loads(pt.decode('utf-8'))
    except Exception:
        return {}
    if not isinstance(obj, dict):
        return {}
    return obj


def save_state(st):
    """Ghi state da ma hoa DPAPI. Tra True/False, khong raise."""
    try:
        os.makedirs(STATE_DIR, exist_ok=True)
        pt = json.dumps(st, separators=(',', ':')).encode('utf-8')
        ct = _dpapi_encrypt(pt)
        if ct is None:
            return False
        tmp = STATE_FILE + '.tmp'
        with open(tmp, 'wb') as f:
            f.write(b'XANF' + ct)
        os.replace(tmp, STATE_FILE)
        try:
            kernel32.SetFileAttributesW(STATE_FILE, 0x02)  # hidden
        except Exception:
            pass
        return True
    except Exception:
        return False


# --------------------------------------------------------------- http -------
def _post(path, payload, timeout=None, retries=0):
    """POST JSON toi server license.

    retries>0 chi dung cho /api/trial/start: tao trial la thao tac GHI,
    mang chap chon giua chung se lam client khong biet server da tao hay
    chua. Endpoint do idempotent (tra lai trial cu) nen retry an toan.
    """
    url = API_BASE.rstrip('/') + path
    body = json.dumps(payload).encode('utf-8')
    last = {'ok': False, 'code': 'network', 'msg': 'chua gui duoc'}
    for attempt in range(retries + 1):
        req = urllib.request.Request(
            url, data=body, method='POST',
            headers={'content-type': 'application/json',
                     'user-agent': '%s/%s' % (APP_NAME, CLIENT_VERSION)})
        try:
            with urllib.request.urlopen(req, timeout=timeout or HTTP_TIMEOUT) as r:
                return json.loads(r.read().decode('utf-8'))
        except urllib.error.HTTPError as e:
            # HTTPError van co body JSON -> doc va tra ngay, KHONG retry
            try:
                return json.loads(e.read().decode('utf-8'))
            except Exception:
                return {'ok': False, 'code': 'http_%d' % e.code}
        except Exception as e:
            last = {'ok': False, 'code': 'network', 'msg': str(e)}
            if attempt < retries:
                time.sleep(0.8 * (attempt + 1))
    return last


# --------------------------------------------------------------- flow -------
def activate(key, verbose=True):
    """Kich hoat qua server. Server gan HWID + bat dau tinh han TU BAY GIO."""
    hwid = compute_hwid()
    if verbose:
        print('  HWID: %s' % mask_key(hwid))
    r = _post('/api/activate', {'key': key, 'hwid': hwid, 'app': APP_NAME})
    if not r.get('ok'):
        return False, r.get('msg') or r.get('code') or 'kich hoat that bai'
    st = load_state()
    anchor_server_time(st, r.get('now'))
    st.update({
        'key': key.strip().upper(),
        'hwid': hwid,
        'expires_at': r.get('expires_at', 0),
        'activated_at': r.get('activated_at', 0),
        # Xoa dau vet trial TRUOC: neu server khong tra 'plan', st['plan']
        # cu = 'trial' se song sot -> _grace_left() tra 0 vinh vien cho
        # khach DA TRA TIEN.
        'plan': r.get('plan') or 'aoe1',
        'grace_hours': r.get('grace_hours', 24),
        'last_ok': time.time(),
        'mode': 'server',
    })
    for _k in ('is_trial', 'trial_weak', 'trial_started', 'trial_days'):
        st.pop(_k, None)
    if not save_state(st):
        return False, 'khong ghi duoc file license'
    return True, 'kich hoat thanh cong'


def check_online(st=None, verbose=True):
    """Hoi server: key con han khong, may co dung la may da kich hoat khong."""
    st = st or load_state()
    key = st.get('key')
    if not key:
        return False, 'chua kich hoat'
    hwid = st.get('hwid') or compute_hwid()
    r = _post('/api/check', {'key': key, 'hwid': hwid, 'app': APP_NAME})
    if not r.get('ok'):
        code = r.get('code', '')
        msg = r.get('msg') or code
        if verbose:
            print('  server: %s' % msg)
        # Tra ve ca ma loi de phan biet "het han" va "loi mang"
        return False, 'code:%s|%s' % (code, msg)
    anchor_server_time(st, r.get('now'))
    st.update({
        'expires_at': r.get('expires_at', 0),
        'activated_at': r.get('activated_at', 0),
        'plan': r.get('plan'),
        'grace_hours': r.get('grace_hours', 24),
        'last_ok': time.time(),
        'mono_last_ok': _mono(),
    })
    save_state(st)
    return True, 'ok'


def is_trial(st=None):
    """True neu state hien tai la ban dung thu."""
    st = st if st is not None else load_state()
    return (st.get('plan') == 'trial') or bool(st.get('is_trial'))


def _grace_left(st):
    """So giay con duoc chay offline ke tu lan check thanh cong cuoi.

    DO BANG MONOTONIC, khong phai dong ho he thong: lui dong ho khong keo
    dai duoc grace.
    """
    # Bắt buộc online: không có offline grace cho BẤT KỲ key nào.
    # Lý do: chặn hosts file / rút mạng là cách chạy lậu phổ biến nhất.
    if REQUIRE_ONLINE:
        return 0
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
    return st.get('grace_hours', 24) * 3600 - elapsed


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

    HAI LOP:
      Lop 1 (chinh): so dong ho he thong voi gio server neo vao monotonic.
                     Khong the lua duoc vi monotonic khong chinh duoc.
      Lop 2 (bo tro): so dong ho voi moc cao nhat ghi ra file + registry.
                     Hoat dong ca khi khong co mang, nhung ke tan cong
                     chay admin co the xoa.

    Tra (ok: bool, msg: str). ok=False nghia la phat hien chinh lui dong ho.
    """
    # ---- Lop 1: doi chieu gio server (monotonic) ----
    tampered, delta = detect_clock_rollback(st)
    if tampered:
        try:
            st['clock_tampered'] = 1
            st['clock_delta'] = round(delta, 1)
            save_state(st)
        except Exception:
            pass
        return False, ('dong ho may cham hon %.1f gio so voi server'
                       % (abs(delta) / 3600.0))

    # ---- Lop 2: doi chieu moc da ghi (khong can mang) ----
    try:
        wall_now, anchor_tampered = _time_state_anchors()
        if anchor_tampered:
            try:
                st['clock_tampered'] = 1
                save_state(st)
            except Exception:
                pass
            return False, 'dong ho may bi chinh lui so voi moc da luu'
        # Ghim _time_anchor theo moc file khi chua co neo server
        if _time_anchor['server_ts'] <= 0 and wall_now > 0:
            _time_anchor['server_ts'] = wall_now
            _time_anchor['mono_at'] = _mono()
    except Exception:
        pass

    # Moc monotonic cao nhat tung thay
    try:
        prev = int(st.get('mono_high') or 0)
        cur = int(_mono())
        if cur > prev:
            st['mono_high'] = cur
    except Exception:
        pass
    return True, 'ok'


# =============================================================================
# PHAN 1b -- DUNG THU 3 NGAY
# =============================================================================
def _days_left(st=None):
    """So ngay con lai (float) hoac None neu khong co han.

    Dung server_now() (monotonic), KHONG dung time.time().
    """
    st = st if st is not None else load_state()
    exp = st.get('expires_at') or 0
    if not exp:
        return None
    return (exp - server_now()) / 86400.0


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
    anchor_server_time(st, r.get('now'))
    st.update({
        'key': key,
        'hwid': compute_hwid(),
        'expires_at': r.get('expires_at', 0),
        'activated_at': r.get('activated_at', 0),
        'plan': 'trial',
        'is_trial': 1,
        'trial_started': int(server_now()),
        'grace_hours': r.get('grace_hours', TRIAL_GRACE_HOURS),
        'last_ok': time.time(),
        'mono_last_ok': _mono(),
        'mode': 'server',
    })
    if not save_state(st):
        return False, 'khong ghi duoc file license'

    if verbose:
        _print_trial_banner(st)
    return True, 'ok'


_trial_next_check = {'at': 0.0}


def trial_guard(verbose=True):
    """Goi dinh ky trong vong lap thuong tru.

    TEN GIU NGUYEN cho tuong thich, nhung gio phuc vu CA HAI:
      - Trial: het han giua phien -> dung han
      - Key tra phi: bat buoc online -> mat mang la dung han
        (vi REQUIRE_ONLY khi bat thi grace = 0)

    Chi kiem toi da 1 lan / TRIAL_RECHECK_SEC de khong spam server.
    """
    st = load_state()
    if not st.get('key'):
        return True

    now = server_now()          # gio server, khong phai dong ho may
    exp = st.get('expires_at') or 0
    if exp and now > exp:
        if verbose:
            if is_trial(st):
                _offer_buy()
            else:
                print('')
                print('  ============================================================')
                print('   MA BAN QUYEN DA HET HAN')
                print('  ============================================================')
                print('   Mua key moi: %s' % BUY_URL)
                print('  ============================================================')
                print('')
        return False

    # Chua toi luot kiem -> cho chay tiep
    mono_now = _mono()
    if mono_now < _trial_next_check['at']:
        return True
    _trial_next_check['at'] = mono_now + TRIAL_RECHECK_SEC

    # Bat buoc online: moi lan kiem phai lien lac duoc server
    ok, msg = ensure_licensed(verbose=False)
    if not ok:
        if verbose:
            if 'bat buoc online' in msg or 'khong ket noi duoc' in msg:
                print('')
                print('  ============================================================')
                print('   MAT KET NOI TOI SERVER')
                print('  ============================================================')
                print('   Tool can mang de xac minh ban quyen moi lan chay.')
                print('   Kiem tra internet roi chay lai, hoac:')
                print('   mo https://xienhl.com de kiem tra trang thai.')
                print('  ============================================================')
                print('')
            elif 'clock_tampered' in msg:
                print('  [!] Dong ho may bi chinh lui -> dung.')
            elif is_trial(st):
                print('  Khong xac minh duoc dung thu: %s' % msg)
                _offer_buy()
            else:
                print('  Khong xac minh duoc ban quyen: %s' % msg)
        return False
    return True


def ensure_licensed(verbose=True):
    """Kiem tra license qua server, co grace offline khi mat mang."""
    st = load_state()
    key = st.get('key')
    if not key:
        return False, 'chua kich hoat'

    # Khoi phuc neo gio server tu state (sau khi mo lai tool)
    load_anchor(st)

    # Kiem lui dong ho TRUOC khi tin bat cu thu gi tren may.
    # _time_state() truoc day la dead code -> lui dong ho khong bi phat hien.
    clock_ok, clock_msg = _time_state(st)
    if not clock_ok:
        if verbose:
            print('  [!] %s' % clock_msg)
        # Bat buoc online: server quyet dinh han, client khong can dong ho.
        # Dong ho bi chinh lui = dau hieu gian lan -> chan tat ca.
        # (Neu tat REQUIRE_ONLINE: chi chan trial, tranh chan oan khach
        #  doi mui gio hoac pin CMOS chet.)
        if REQUIRE_ONLINE or is_trial(st):
            return False, 'clock_tampered'

    ok, msg = check_online(st, verbose=False)

    if ok:
        # Server xac nhan -> con han
        return True, 'ok'

    code = ''
    if msg.startswith('code:'):
        code = msg[5:].split('|')[0]

    # Server tu choi dut khoat -> khong cho chay, du con grace.
    # Phai co rate_limit/bad_request: truoc day hai ma nay roi vao nhanh
    # grace -> tu bam het rate limit la duoc chay mu them 24 gio.
    if code in ('revoked', 'expired', 'hwid_mismatch', 'not_found',
                'trial_expired', 'trial_only', 'trial_denied_device',
                'rate_limit', 'bad_request', 'clock_tampered'):
        return False, msg.split('|', 1)[-1]

    # Loi mang / server -> dung grace neu con han cuc bo
    left = _grace_left(st)
    if left > 0:
        if verbose:
            print('  khong ket noi duoc server, dung offline grace (con %.1f gio)'
                  % (left / 3600.0))
        # Van phai kiem han cuc bo — dung GIO SERVER (monotonic), khong
        # dung dong ho he thong (lui dong ho khong keo dai duoc).
        exp = st.get('expires_at') or 0
        if exp and exp > 0 and server_now() > exp:
            return False, 'ma da het han'
        return True, 'ok (offline)'
    if REQUIRE_ONLINE:
        return False, 'khong ket noi duoc server (bat buoc online)'
    return False, 'khong ket noi duoc server va da het grace'


# ----------------------------------------------------------- time anchors ----
# Chống lùi đồng hồ: ghi mốc thời gian cao nhất vào NHIỀU nơi. Kẻ tấn công
# phải sửa hết tất cả mới qua được. Không nơi nào là "nguồn duy nhất".

_ANCHOR_SALT = b'xanf-anchor-v1'


def _anchor_paths():
    """Cac noi luu moc thoi gian. Tra list (path, is_registry)."""
    out = []
    try:
        out.append((os.path.join(STATE_DIR, 'ts'), False))
    except Exception:
        pass
    # Thu muc rieng cua Windows, ten khong lien quan den app
    try:
        d = os.path.join(os.environ.get('PROGRAMDATA', r'C:\ProgramData'),
                         'Microsoft', 'Crypto', 'RSA')
        out.append((os.path.join(d, 'upd.dat'), False))
    except Exception:
        pass
    return out


def _anchor_read(path):
    try:
        with open(path, 'rb') as f:
            raw = f.read()
        n = len(_ANCHOR_SALT)
        if len(raw) < n + 32 or raw[:n] != _ANCHOR_SALT:
            return 0
        body = raw[n:]
        mac = hashlib.sha256(_ANCHOR_SALT + body[:-32]).digest()
        if not hmac.compare_digest(mac, body[-32:]):
            return 0
        return int(body[:-32].decode('ascii', 'ignore') or 0)
    except Exception:
        return 0


def _anchor_write(path, value):
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        body = str(int(value)).encode('ascii')
        mac = hashlib.sha256(_ANCHOR_SALT + body).digest()
        tmp = path + '.tmp'
        with open(tmp, 'wb') as f:
            f.write(_ANCHOR_SALT + body + mac)
        os.replace(tmp, path)
        return True
    except Exception:
        return False


def _reg_anchor():
    """Moc thoi gian trong registry. Tra (read_value, ok)."""
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, REG_KEY, 0,
                            winreg.KEY_READ) as k:
            v, _ = winreg.QueryValueEx(k, 'LastRun')
            return int(v), True
    except Exception:
        return 0, False


def _reg_anchor_write(value):
    try:
        import winreg
        with winreg.CreateKeyEx(winreg.HKEY_CURRENT_USER, REG_KEY, 0,
                                winreg.KEY_WRITE) as k:
            winreg.SetValueEx(k, 'LastRun', 0, winreg.REG_SZ, str(int(value)))
        return True
    except Exception:
        return False


def _time_state_anchors():
    """Lop phong thu THU HAI: moc thoi gian ghi ra file + registry.

    Khac voi server-authoritative (lop 1, dung monotonic + gio server),
    lop nay phat hien lui dong ho ngay ca khi KHONG co mang, bang cach
    so dong ho hien tai voi moc cao nhat da ghi o nhieu noi.

    Gioi han: tool chay admin nen ke tan cong xoa duoc cac moc nay. Vi vay
    day chi la lop bo tro — lop chinh la server (monotonic + `now`).

    Tra (now: int, tampered: bool)
    """
    now = int(time.time())
    highest = 0
    for path, _ in _anchor_paths():
        v = _anchor_read(path)
        if v > highest:
            highest = v
    rv, rok = _reg_anchor()
    if rok and rv > highest:
        highest = rv

    # Dong ho lui so voi moc da ghi -> nghi van
    tampered = (highest - now) > CLOCK_SKEW_TOLERANCE

    # Ghi moc moi khi dong ho tien len
    if not tampered and now > highest:
        for path, _ in _anchor_paths():
            _anchor_write(path, now)
        _reg_anchor_write(now)

    return now, tampered




# =============================================================================
# PHAN 2 -- NO FOG
# =============================================================================
ACCESS = 0x0438
SYNC = 0x00100000
TH32CS_SNAPPROCESS = 0x2
PAGE_EXECUTE_READWRITE = 0x40
MAX_PATH = 260
INVALID_HANDLE_VALUE = ctypes.c_void_p(-1).value
SW_SHOWNORMAL = 1

kernel32.OpenProcess.restype = wt.HANDLE
kernel32.OpenProcess.argtypes = [wt.DWORD, wt.BOOL, wt.DWORD]
kernel32.ReadProcessMemory.restype = wt.BOOL
kernel32.ReadProcessMemory.argtypes = [wt.HANDLE, wt.LPCVOID, wt.LPVOID,
                                       ctypes.c_size_t, ctypes.POINTER(ctypes.c_size_t)]
kernel32.WriteProcessMemory.restype = wt.BOOL
kernel32.WriteProcessMemory.argtypes = [wt.HANDLE, wt.LPVOID, ctypes.c_char_p,
                                        ctypes.c_size_t, ctypes.POINTER(ctypes.c_size_t)]
kernel32.VirtualProtectEx.restype = wt.BOOL
kernel32.VirtualProtectEx.argtypes = [wt.HANDLE, wt.LPVOID, ctypes.c_size_t,
                                      wt.DWORD, ctypes.POINTER(wt.DWORD)]
kernel32.FlushInstructionCache.restype = wt.BOOL
kernel32.FlushInstructionCache.argtypes = [wt.HANDLE, wt.LPCVOID, ctypes.c_size_t]
kernel32.CloseHandle.argtypes = [wt.HANDLE]
kernel32.CreateToolhelp32Snapshot.restype = wt.HANDLE
kernel32.CreateToolhelp32Snapshot.argtypes = [wt.DWORD, wt.DWORD]
kernel32.Process32First.restype = wt.BOOL
kernel32.Process32First.argtypes = [wt.HANDLE, ctypes.c_void_p]
kernel32.Process32Next.restype = wt.BOOL
kernel32.Process32Next.argtypes = [wt.HANDLE, ctypes.c_void_p]
psapi.EnumProcessModules.restype = wt.BOOL
psapi.EnumProcessModules.argtypes = [wt.HANDLE, ctypes.POINTER(wt.HMODULE),
                                     wt.DWORD, ctypes.POINTER(wt.DWORD)]
shell32.IsUserAnAdmin.restype = wt.BOOL
shell32.IsUserAnAdmin.argtypes = []
shell32.ShellExecuteW.restype = ctypes.c_void_p
shell32.ShellExecuteW.argtypes = [wt.HWND, wt.LPCWSTR, wt.LPCWSTR,
                                  wt.LPCWSTR, wt.LPCWSTR, ctypes.c_int]


class PE32(ctypes.Structure):
    _fields_ = [('dwSize', wt.DWORD), ('cntUsage', wt.DWORD),
                ('th32ProcessID', wt.DWORD), ('th32DefaultHeapID', ctypes.c_void_p),
                ('th32ModuleID', wt.DWORD), ('cntThreads', wt.DWORD),
                ('th32ParentProcessID', wt.DWORD), ('pcPriClassBase', ctypes.c_long),
                ('dwFlags', wt.DWORD), ('szExeFile', ctypes.c_char * MAX_PATH)]


# --- bang cong ---------------------------------------------------------------
MINIMAP = [
    ('A', 0x42D521, '8a83b88d0000', 'b00190909090'),
    ('B', 0x42D547, '0f84e2030000', '909090909090'),
    ('C', 0x42DC63, '8a85b88d0000', 'b00190909090'),
    ('D', 0x42DC6D, '8a95b98d0000', 'b20190909090'),
    ('E', 0x42DCA9, '8a85b98d0000', 'b00190909090'),
    ('M', 0x42DC93, 'b180',         'b10f'),
    ('N', 0x42DCA7, 'b180',         'b10f'),
]
CORE = [
    ('T1', 0x514E0F, '85d17407',   '90909090'),
    ('V3', 0x514F58, '7404',       'eb43'),
    ('V6', 0x516590, '518b442408', '33c0c21400'),
]
LEGACY = [
    ('F',  0x513DF8, '8a81b88d0000', 'b00190909090'),
    ('I',  0x51C631, '8a81b88d0000', 'b00190909090'),
    ('J',  0x51C6B8, '8a81b88d0000', 'b00190909090'),
    ('K',  0x51D28E, '8a82b88d0000', 'b00190909090'),
    ('L',  0x51D3D7, '8a82b88d0000', 'b00190909090'),
    # O: 0x51FC6F la GIUA LENH -- `b2 80` o do la 2 byte cuoi cua
    # `8b 04 b2  mov eax,[edx+esi*4]` tai 0x51FC6D (xac nhan bang recursive
    # descent tu prologue 0x51FA40: 0x51FC6F KHONG phai ranh gioi lenh).
    # Va vao do ghi de giua lenh -> vmread -> #UD.
    # Dia chi dung la 0x529BEA (entry ham 0x529BE0, co 2 call site:
    # 0x529BD1 va 0x52EB01). Do la `mov dl,0x80` that su.
    ('O',  0x529BEA, 'b280',         'b20f'),
    ('T2', 0x514EFF, '0f853c010000', '909090909090'),
]
BASE = CORE + MINIMAP
DEFAULT = BASE
ALL_SITES = CORE + MINIMAP + LEGACY
GROUPS = (('viewport', CORE), ('minimap', MINIMAP), ('legacy', LEGACY))


def _validate():
    keys = [s[0] for s in ALL_SITES]
    if len(keys) != len(set(keys)):
        raise SystemExit('trung key')
    addrs = [s[1] for s in ALL_SITES]
    if len(addrs) != len(set(addrs)):
        raise SystemExit('trung dia chi')
    for k, va, o, p in ALL_SITES:
        if len(bytes.fromhex(o)) != len(bytes.fromhex(p)):
            raise SystemExit('cong %s: do dai khac nhau' % k)


_validate()


# --- admin -------------------------------------------------------------------
# --- chong chay trung --------------------------------------------------------
def acquire_mutex():
    """Tra True neu day la ban duy nhat. Giu handle toi khi thoat.

    Neu tao mutex that bai (vd khong co quyen voi namespace Global), ta
    KHONG coi la duy nhat -- that bai roi xuong Local namespace, van bao
    ve trong phien dang nhap. Chi khi ca hai deu fail moi cho chay.
    """
    global _mutex_handle
    for name in (MUTEX_NAME, 'XArenaNoFogPro_Local'):
        try:
            h = kernel32.CreateMutexW(None, False, name)
            if not h:
                continue
            err = ctypes.get_last_error()
            _mutex_handle = h
            return err != ERROR_ALREADY_EXISTS
        except Exception:
            continue
    # Khong tao duoc mutex nao -> khong the bao ve. Cho chay nhung canh bao.
    return True


def set_title(text):
    """Doi tieu de cua so console. Loi thi bo qua.

    Windows dat lai tieu de tuong ung voi duong dan exe trong vai tram ms
    dau, nen goi lai vai lan de chac chan giu duoc.
    """
    try:
        kernel32.SetConsoleTitleW(text)
    except Exception:
        pass


class _TitleKeeper:
    """Giu tieu de khong bi Windows ghi de trong giay dau."""

    def __init__(self):
        self._text = None
        self._stop = False

    def set(self, text):
        self._text = text
        set_title(text)
        try:
            import threading
            if not getattr(self, '_started', False):
                self._started = True
                threading.Thread(target=self._run, daemon=True).start()
        except Exception:
            pass

    def _run(self):
        # 6 lan trong 3 giay dau la du; sau do chi dat khi doi trang thai
        for _ in range(6):
            if self._stop:
                return
            time.sleep(0.5)
            if self._text:
                set_title(self._text)


_titler = _TitleKeeper()


def title(text):
    _titler.set(text)


def is_admin():
    try:
        return bool(shell32.IsUserAnAdmin())
    except OSError:
        return False


def _args_str():
    a = sys.argv[1:]
    if not a:
        return ''
    return ' '.join('"%s"' % x if (' ' in x or '\t' in x) else x for x in a)


def require_admin(allow_view):
    """Bao dam co quyen admin truoc khi cham vao process game.

    Voi ban .exe: KHONG dung manifest requireAdministrator (no chan ca
    --status/--deactivate cua nguoi dung thuong). Thay vao do, khi can
    quyen that su thi Relaunch elevated bang ShellExecuteW 'runas'.

    Trinh tu quan trong: kiem tra license TRUOC khi xin admin, de nguoi
    dung khong bi hoi UAC chi de roi bi tu choi vi thieu key.
    """
    if is_admin():
        return
    if allow_view:
        return
    print('Can quyen Administrator de va game.')
    print('Dang yeu cau Windows cap quyen (UAC)...')
    args = _args_str()
    if getattr(sys, 'frozen', False):
        exe = sys.executable
        params = args
    else:
        exe = sys.executable
        params = '-ExecutionPolicy Bypass -NoProfile -File "%s"' % os.path.abspath(__file__)
        if args:
            params += ' ' + args
    rc = shell32.ShellExecuteW(None, 'runas', exe, params or None, None,
                               SW_SHOWNORMAL)
    if int(rc or 0) > 32:
        print('Da gui yeu cau. Bam "Yes" o hop thoai UAC de tiep tuc.')
        sys.exit(0)
    print('', file=sys.stderr)
    print('KHONG CO QUYEN ADMINISTRATOR.', file=sys.stderr)
    print('  Ban da bam "No", hoac tai khoan khong thuoc nhom Administrators.',
          file=sys.stderr)
    print('  Cach khac: chuot phai exe -> "Run as administrator".', file=sys.stderr)
    sys.exit(EXIT_NOT_ADMIN)


# --- process -----------------------------------------------------------------
def find_game():
    snap = kernel32.CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0)
    if snap in (None, 0, INVALID_HANDLE_VALUE):
        return []
    want = set(n.lower() for n in PROCESS_NAMES)
    out = []
    try:
        e = PE32()
        e.dwSize = ctypes.sizeof(PE32)
        if kernel32.Process32First(snap, ctypes.byref(e)):
            while True:
                nm = e.szExeFile.decode(errors='replace')
                if nm.lower() in want:
                    out.append((e.th32ProcessID, nm))
                if not kernel32.Process32Next(snap, ctypes.byref(e)):
                    break
    finally:
        kernel32.CloseHandle(snap)
    return out


def rd(h, a, n):
    buf = ctypes.create_string_buffer(n)
    g = ctypes.c_size_t(0)
    if not kernel32.ReadProcessMemory(h, ctypes.c_void_p(a), buf, n, ctypes.byref(g)):
        return b''
    return buf.raw[:g.value]


def wr(h, a, data):
    w = ctypes.c_size_t(0)
    if not kernel32.WriteProcessMemory(h, ctypes.c_void_p(a), data, len(data),
                                       ctypes.byref(w)):
        return False
    return w.value == len(data)


def write_at(h, addr, data):
    old = wt.DWORD()
    if not kernel32.VirtualProtectEx(h, ctypes.c_void_p(addr), len(data),
                                     PAGE_EXECUTE_READWRITE, ctypes.byref(old)):
        return False
    ok = False
    try:
        ok = wr(h, addr, data)
    finally:
        d = wt.DWORD()
        kernel32.VirtualProtectEx(h, ctypes.c_void_p(addr), len(data), old.value,
                                  ctypes.byref(d))
    kernel32.FlushInstructionCache(h, ctypes.c_void_p(addr), len(data))
    return ok


def patch(h, base, site, restore=False):
    key, va, orig_s, pat_s = site
    orig = bytes.fromhex(orig_s)
    pat = bytes.fromhex(pat_s)
    addr = base + (va - PREFERRED_BASE)
    want = orig if restore else pat
    other = pat if restore else orig
    cur = rd(h, addr, len(want))
    if len(cur) != len(want):
        return 'unreadable'
    if cur == want:
        return 'ok'
    if cur != other:
        return 'other:' + cur.hex(' ')
    if not write_at(h, addr, want):
        return 'write-fail'
    return 'restored' if restore else 'patched'


def _alive(h):
    """Tra True neu process cua handle con song (exit code STILL_ACTIVE=259)."""
    try:
        code = wt.DWORD()
        if not kernel32.GetExitCodeProcess(h, ctypes.byref(code)):
            return False
        return code.value == 259
    except Exception:
        return False


def attach(pid):
    h = kernel32.OpenProcess(ACCESS | SYNC, False, pid)
    if not h:
        return None, None
    mods = (wt.HMODULE * 1024)()
    need = wt.DWORD()
    if not psapi.EnumProcessModules(h, mods, ctypes.sizeof(mods), ctypes.byref(need)):
        kernel32.CloseHandle(h)
        return None, None
    base = mods[0]
    if not base:
        kernel32.CloseHandle(h)
        return None, None
    return h, base


def apply_set(h, base, sites, restore, label, quiet=False):
    changed, bad = [], []
    for site in sites:
        st = patch(h, base, site, restore=restore)
        if st in ('patched', 'restored'):
            changed.append(site[0])
        elif st != 'ok':
            bad.append('%s(%s)' % (site[0], st))
    if quiet:
        if bad:
            print('  loi: %s' % ' '.join(bad))
        return changed, bad
    if changed:
        print('  %s %d cong: %s' % ('tra goc' if restore else 'va',
                                    len(changed), ' '.join(changed)))
    if bad:
        print('  loi: %s' % ' '.join(bad))
    return changed, bad


def dump_state(h, base, sites):
    for key, va, orig_s, pat_s in sites:
        addr = base + (va - PREFERRED_BASE)
        cur = rd(h, addr, len(orig_s) // 2)
        orig = bytes.fromhex(orig_s)
        pat = bytes.fromhex(pat_s)
        if len(cur) != len(orig):
            s = 'UNREADABLE'
        elif cur == pat:
            s = 'PATCHED'
        elif cur == orig:
            s = 'orig'
        else:
            s = 'OTHER'
        print('  %-3s 0x%08X  %-10s %s' % (key, va, s, cur.hex()))


def list_sites():
    for name, group in GROUPS:
        print('[%s]' % name)
        for key, va, o, p in group:
            print('  %-3s 0x%08X  %s -> %s' % (key, va, o, p))


# --- cli ---------------------------------------------------------------------
def parse_args(argv):
    o = {'restore': False, 'full': False, 'watch': False, 'once': False,
         'dump': False, 'list': False, 'help': False, 'status': False,
         'deactivate': False, 'key': None, 'trial': False, 'buy': False,
         'rebind': None}
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == '--off':
            o['restore'] = True
        elif a == '--full':
            o['full'] = True
        elif a == '--watch':
            o['watch'] = True
        elif a == '--once':
            o['once'] = True
            o['watch'] = False
        elif a == '--dump':
            o['dump'] = True
        elif a == '--list':
            o['list'] = True
        elif a == '--status':
            o['status'] = True
        elif a == '--deactivate':
            o['deactivate'] = True
        elif a == '--trial':
            o['trial'] = True
        elif a == '--buy':
            o['buy'] = True
        elif a in ('-h', '--help'):
            o['help'] = True
        elif a == '--key':
            i += 1
            if i >= len(argv):
                return None, '--key can gia tri'
            o['key'] = argv[i].strip()
        elif a == '--rebind':
            if i + 2 >= len(argv):
                return None, '--rebind can <key> <token>'
            o['rebind'] = (argv[i + 1].strip(), argv[i + 2].strip())
            i += 2
        else:
            return None, 'tham so khong hop le: %s' % a
        i += 1
    return o, None


def pick_sites(opts):
    if opts['full']:
        return BASE + LEGACY, 'viewport+minimap+legacy'
    return DEFAULT, 'viewport+minimap'


def _gui_label():
    """Nhan hien thi ky tu 'nhu la' khi go key. Cang lech cang tot.

    Keylogger ghi nhan phim vat ly; neu nhan hien thi khong khop phim thi
    ke doc log van biet phim, nhung nguoi nhin man hinh khong biet.
    """
    return 'Nhap ma ban quyen (khong hien):'


def _secure_dialog():
    """Hop thoai nhap key: che tung ky tu, chong chup man hinh co ban.

    - Hien '*' thay vi ky tu that (show='*').
    - Tu xoa clipboard de khong lo key qua clipboard.
    - Tat menu chuot phai / copy-paste bang cach bind <<Paste>> tra 'break'.
    - Khong ghi key ra bat ky file log nao.
    """
    import tkinter as tk
    from tkinter import ttk

    result = {'key': None}
    root = tk.Tk()
    root.title('XArena No Fog')
    root.attributes('-topmost', True)
    root.resizable(False, False)
    try:
        root.eval('tk::PlaceWindow . center')
    except Exception:
        pass

    frm = ttk.Frame(root, padding=16)
    frm.grid()

    ttk.Label(frm, text=_gui_label(),
              font=('Segoe UI', 10)).grid(column=0, row=0, columnspan=2,
                                          sticky='w', pady=(0, 8))
    var = tk.StringVar()
    ent = ttk.Entry(frm, textvariable=var, show='\u2022', width=34,
                    font=('Consolas', 12))
    ent.grid(column=0, row=1, sticky='we')
    ent.focus_set()

    def nopaste(_e=None):
        return 'break'

    ent.bind('<<Paste>>', nopaste)
    ent.bind('<<Cut>>', nopaste)
    ent.bind('<<Copy>>', nopaste)

    status = ttk.Label(frm, text='', foreground='#b00')
    status.grid(column=0, row=2, columnspan=2, sticky='w', pady=(6, 0))

    def ok(_e=None):
        k = var.get().strip().upper()
        if len(k) < 4:
            status.configure(text='Ma qua ngan.')
            return
        result['key'] = k
        root.destroy()

    def cancel(_e=None):
        result['key'] = None
        root.destroy()

    btns = ttk.Frame(frm)
    btns.grid(column=0, row=3, columnspan=2, sticky='e', pady=(12, 0))
    ttk.Button(btns, text='Kich hoat', command=ok).grid(column=0, row=0,
                                                         padx=(0, 6))
    ttk.Button(btns, text='Huy', command=cancel).grid(column=1, row=0)

    root.bind('<Return>', ok)
    root.bind('<Escape>', cancel)
    root.protocol('WM_DELETE_WINDOW', cancel)
    root.mainloop()

    # Xoa clipboard (phong truong hop nguoi dung da copy key tu dau)
    try:
        root2 = tk.Tk()
        root2.withdraw()
        root2.clipboard_clear()
        root2.clipboard_append('')
        root2.destroy()
    except Exception:
        pass

    return result['key']


def ask_key_dialog():
    """Hoi key. Uu tien hop thoai do hoa che ky tu; console la phuong an cuoi."""
    try:
        return _secure_dialog()
    except Exception:
        pass
    # Fallback console: getpass che ky tu, khong echo
    try:
        import getpass
        k = getpass.getpass('Nhap ma ban quyen (khong hien): ')
        return k.strip().upper() if k else None
    except Exception:
        try:
            print('Nhap ma ban quyen: ', end='', flush=True)
            k = sys.stdin.readline().strip()
            return k.upper() if k else None
        except Exception:
            return None


def mask_key(key):
    """Che key khi hien thi: AOE1****VIEN. Giu 4 ky tu dau va cuoi."""
    if not key:
        return '(khong co)'
    k = str(key)
    if len(k) <= 8:
        return k[:2] + '*' * max(1, len(k) - 2)
    return k[:4] + '*' * (len(k) - 8) + k[-4:]


def show_status():
    st = load_state()
    print('Che do    : %s' % LICENSE_MODE)

    if not st.get('key'):
        print('Trang thai: CHUA KICH HOAT')
        if TRIAL_ENABLED:
            print('Dung thu  : con %d ngay, tu bat khi chay tool' % TRIAL_DAYS)
        print('Mua key   : %s' % BUY_URL)
        return

    trial = is_trial(st)
    key = (st.get('key') or '').upper()
    print('Loai      : %s' % ('DUNG THU %d NGAY' % TRIAL_DAYS if trial else 'BAN QUYEN'))
    print('Key       : %s' % mask_key(key))

    hwid = compute_hwid()
    stored = st.get('hwid') or ''
    print('HWID may  : %s' % mask_key(hwid))
    print('HWID khop : %s' % ('CO' if stored == hwid else 'KHONG'))

    ok, msg = ensure_licensed(verbose=False)
    print('Trang thai: %s' % ('HOAT DONG' if ok else 'KHONG (%s)' % msg))

    exp = st.get('expires_at') or 0
    started = st.get('activated_at') or 0
    if started:
        print('Bat dau   : %s' % time.strftime('%Y-%m-%d %H:%M:%S',
                                               time.localtime(started)))
    if exp == 0:
        print('Het han   : VINH VIEN')
    elif exp:
        print('Het han   : %s' % time.strftime('%Y-%m-%d %H:%M:%S',
                                               time.localtime(exp)))
        left = (exp - time.time()) / 86400.0
        print('Con lai   : %s' % ('%.1f ngay' % left if left > 0
                                  else 'DA HET HAN'))

    # Hiển thị giờ server + phát hiện lùi đồng hồ
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
        print('Offline   : KHONG (dung thu can mang moi lan chay)')
        dl = _days_left(st) or 0
        if dl <= 0:
            print('Mua key   : %s' % BUY_URL)
        elif dl <= TRIAL_WARN_DAYS:
            print('Nhac nho  : con %.1f ngay, mua key tai %s' % (dl, BUY_URL))
    else:
        left_g = _grace_left(st)
        if left_g > 0:
            print('Offline   : con %.1f gio' % (left_g / 3600.0))
        else:
            print('Offline   : het (can mang)')


def require_license(opts):
    """Kiem tra license qua server. Con han -> im lang, khong hoi key.

    Thu tu:
      1. --key           -> kich hoat key tra phi
      2. da co state     -> kiem han (trial hay paid)
      3. chua co state   -> TU DONG bat dung thu 3 ngay
      4. khong bat duoc  -> hoi key
    """
    if opts.get('key'):
        ok, m = activate(opts['key'])
        print('  ' + m)
        if not ok:
            return False
        ok2, m2 = ensure_licensed(verbose=False)
        if not ok2:
            print('  Van khong hop le: %s' % m2, file=sys.stderr)
            return False
        return True

    st = load_state()

    # --- 3. Chua co gi -> dung thu -------------------------------------
    if not st.get('key'):
        if TRIAL_ENABLED:
            ok, m = start_trial()
            if ok:
                return True
            if m == 'expired':
                print('May nay da dung het %d ngay dung thu.' % TRIAL_DAYS)
                _offer_buy()
            elif m == 'device':
                print('May nay khong duoc dung thu (may ao hoac bi chan).')
                _offer_buy()
            elif m == 'used':
                print('May / ket noi nay da dung het luot dung thu.')
                _offer_buy()
            elif m == 'disabled':
                print('Chua kich hoat. Dung thu dang tam dong.')
            else:
                print('  khong bat duoc dung thu: %s' % m, file=sys.stderr)
                print('  (kiem tra mang roi chay lai, hoac nhap key)')
        else:
            print('Chua kich hoat.')
    else:
        # --- 2. Co state -> kiem han -----------------------------------
        ok, msg = ensure_licensed(verbose=True)
        if ok:
            if is_trial(load_state()):
                _warn_trial(load_state())
            return True

        if is_trial(st):
            print('Ban dung thu da het han.')
            _offer_buy()
        elif msg == 'chua kich hoat':
            print('Chua kich hoat.')
        elif 'het han' in msg:
            print('Ma ban quyen da het han.')
            _offer_buy()
        elif 'clock_tampered' in msg:
            print('')
            print('  ============================================================')
            print('   DONG HO MAY BI CHINH LUI')
            print('  ------------------------------------------------------------')
            print('   Tool bat buoc xac minh voi server moi lan chay. Dong ho')
            print('   he thong cua ban dang cham hon nhieu so voi gio that.')
            print('')
            print('   Cach xu ly:')
            print('     1. Mo Settings > Time & Language > Date & time')
            print('     2. Bat "Set time automatically"')
            print('     3. Bam "Sync now"')
            print('     4. Chay lai tool')
            print('  ============================================================')
            print('')
            return False
        elif 'bat buoc online' in msg or 'khong ket noi duoc' in msg:
            print('')
            print('  ============================================================')
            print('   KHONG KET NOI DUOC SERVER')
            print('  ------------------------------------------------------------')
            print('   Tool can mang moi lan chay de xac minh ban quyen.')
            print('')
            print('   Kiem tra:')
            print('     1. May co dang ket noi internet khong?')
            print('     2. Thu mo trinh duyet vao https://xienhl.com')
            print('     3. Neu dung VPN/proxy, thu tat tam thoi')
            print('     4. Neu bi chan hosts file, xoa dong chua xienhl.com')
            print('        trong C:\\Windows\\System32\\drivers\\etc\\hosts')
            print('')
            print('   Van khong duoc? Nhan ho tro: %s' % BUY_URL)
            print('  ============================================================')
            print('')
            return False
        else:
            print('Khong dung duoc: %s' % msg)

    # --- 4. Hoi key cho moi truong hop tren ---------------------------
    k = ask_key_dialog()
    if not k:
        print('Da huy.', file=sys.stderr)
        return False

    ok, m = activate(k)
    print('  ' + m)
    if not ok:
        return False
    ok2, m2 = ensure_licensed(verbose=False)
    if not ok2:
        print('  Van khong hop le: %s' % m2, file=sys.stderr)
        return False
    return True


def run():
    opts, err = parse_args(sys.argv[1:])
    if err:
        print(err, file=sys.stderr)
        return 2
    if opts['help']:
        print(__doc__)
        return 0

    # --buy: mo trang mua hang (khong can admin)
    if opts['buy']:
        print(BUY_URL)
        return 0 if open_buy_page() else 1

    # --trial: bat dung thu roi thoat
    if opts['trial']:
        st0 = load_state()
        if st0.get('key') and not is_trial(st0):
            print('May nay da co license %s. Khong can dung thu.'
                  % mask_key(st0.get('key')))
            show_status()
            return 0
        ok, m = start_trial()
        if not ok:
            if m == 'expired':
                print('May nay da dung het %d ngay dung thu.' % TRIAL_DAYS)
            elif m == 'device':
                print('May nay khong duoc dung thu (may ao hoac bi chan).')
            elif m == 'used':
                print('May / ket noi nay da dung het luot dung thu.')
            else:
                print('Khong bat duoc dung thu: %s' % m, file=sys.stderr)
            _offer_buy()
            return EXIT_NO_LICENSE
        print('Dung thu san sang. Chay lai khong tham so de va game.')
        return 0

    if opts['list']:
        list_sites()
        return 0
    if opts['status']:
        show_status()
        return 0
    if opts['deactivate']:
        # Khong xoa neu dang co ban chay: no van va tiep va se loi.
        if not acquire_mutex():
            print('Dang co ban khac chay. Tat no truoc roi hay xoa key.',
                  file=sys.stderr)
            return EXIT_ALREADY_RUNNING
        try:
            existed = os.path.exists(STATE_FILE)
            if existed:
                kernel32.SetFileAttributesW(STATE_FILE, 0x80)
                os.remove(STATE_FILE)
            print('Da xoa key khoi may nay.' if existed
                  else 'May nay chua kich hoat, khong co gi de xoa.')
        except Exception as e:
            print('Loi: %s' % e, file=sys.stderr)
            return 1
        return 0

    # Kich hoat bang --key: KHONG can admin, chi ghi state + thoat.
    if opts.get('key'):
        # --key di cung co khac: chi kich hoat roi thoat, khong va game.
        ok = require_license(opts)
        if ok:
            print('Kich hoat xong. Chay lai khong tham so de va game.')
        return 0 if ok else EXIT_NO_LICENSE

    # THU TU: license TRUOC, admin SAU.
    # Ly do: khong bat nguoi dung bam UAC chi de roi bi tu choi vi thieu key.
    # --off khong can license: tra goc phai luon lam duoc.
    if not opts['restore']:
        if not require_license(opts):
            return EXIT_NO_LICENSE

    require_admin(allow_view=False)

    if opts['restore']:
        sites, label = ALL_SITES, 'all'
    else:
        sites, label = pick_sites(opts)

    once_mode = opts['once'] or opts['dump'] or opts['restore']
    watch_mode = opts['watch'] and not once_mode
    resident_mode = not once_mode and not watch_mode

    # Chi mot ban chay o che do thuong tru. --once/--off/--dump thi khong can.
    if resident_mode and not acquire_mutex():
        print('Da co ban khac dang chay. Khong mo them.')
        return EXIT_ALREADY_RUNNING

    if opts['restore']:
        print('XArena No Fog -- tra byte goc (%d cong)' % len(sites))
    elif opts['dump']:
        print('XArena No Fog -- dump trang thai')
    elif watch_mode:
        print('XArena No Fog -- watch 0.5s (%d cong)' % len(sites))
    elif resident_mode:
        _st0 = load_state()
        if is_trial(_st0):
            left = _days_left(_st0) or 0
            title('XA NoFog - DUNG THU con %.0f ngay' % left)
            print('DANG CHAY (dung thu con %.1f ngay). Cho game bat...' % left)
        else:
            left = _days_left(_st0)
            if left is not None and left > 0:
                title('XA NoFog - con %.0f ngay' % left)
                print('DANG CHAY (con %.1f ngay). Cho game bat...' % left)
            else:
                title('XA NoFog - dang cho game')
                print('DANG CHAY. Cho game bat...')
        print('(de cua so nay mo. Ctrl-C de dung)')
        print('(can mang: tool xac minh ban quyen moi %d phut)' % (TRIAL_RECHECK_SEC // 60))

    cur_pid = 0
    h = None
    base = 0
    had_error = False
    patched_pid = 0
    try:
        while True:
            # Kiem license dinh ky (moi TRIAL_RECHECK_SEC):
            #   - Bat buoc online: mat mang = dung han
            #   - Trial/paid het han giua phien = dung han
            if resident_mode and not trial_guard():
                if h:
                    kernel32.CloseHandle(h)
                return EXIT_TRIAL_END

            procs = find_game()
            if not procs:
                if h:
                    print('ĐÃ ĐÓNG GAME HÃY MỞ LẠI')
                    if resident_mode:
                        title('XA NoFog - da dong game, cho mo lai')
                    kernel32.CloseHandle(h)
                    h, base, cur_pid, patched_pid = None, 0, 0, 0
                if once_mode:
                    if opts['restore']:
                        print('Game khong chay -- khong co gi de tra goc.')
                        print('(byte goc chi ton tai trong bo nho process game)')
                    else:
                        print('Khong tim thay game.')
                    return 1
                time.sleep(RESIDENT_POLL if resident_mode else 1.0)
                continue

            procs.sort(key=lambda p: 0 if p[1].lower() == 'empiresx.exe' else 99)
            pid, name = procs[0]

            if resident_mode and pid == patched_pid:
                # Kiểm tra process còn sống thật không. Nếu Windows đã tái
                # dùng PID cho process khác, patched_pid trỏ sai -> phải vá lại.
                if h and _alive(h):
                    time.sleep(RESIDENT_POLL)
                    continue
                # Handle đã chết -> dọn và vá lại
                if h:
                    kernel32.CloseHandle(h)
                h, base, cur_pid, patched_pid = None, 0, 0, 0

            if pid != cur_pid:
                if h:
                    kernel32.CloseHandle(h)
                h, base = attach(pid)
                if not h:
                    if once_mode:
                        print('khong mo duoc pid %d' % pid, file=sys.stderr)
                        return 1
                    time.sleep(2.0)
                    continue
                cur_pid = pid
                if base - PREFERRED_BASE and not resident_mode:
                    print('canh bao: base lech 0x%x' % (base - PREFERRED_BASE))

            if opts['dump']:
                for gname, group in GROUPS:
                    print(' [%s]' % gname)
                    dump_state(h, base, group)
                kernel32.CloseHandle(h)
                return 0

            _, bad = apply_set(h, base, sites, opts['restore'], label,
                               quiet=resident_mode)
            if bad:
                had_error = True

            if once_mode:
                kernel32.CloseHandle(h)
                if had_error:
                    print('', file=sys.stderr)
                    print('CO CONG KHONG VA DUOC.', file=sys.stderr)
                    return 1
                if opts['restore']:
                    print('da tra byte goc')
                elif opts['dump']:
                    pass
                else:
                    print('Da va %d cong.' % len(sites))
                return 0

            if resident_mode:
                if bad:
                    # KHONG dat patched_pid: de lan poll sau thu lai.
                    # (truoc day dat truoc khi kiem bad -> loi vinh vien)
                    patched_pid = 0
                    print('LỖI MỞ MAP: ' + ' '.join(bad))
                    title('XA NoFog - LOI, xem log')
                else:
                    patched_pid = pid
                    print('GAME BẬT - ĐANG MỞ FULL MAP')
                    title('XA NoFog - DANG BAT FULL MAP')
                time.sleep(RESIDENT_POLL)
                continue

            time.sleep(0.5)
    except KeyboardInterrupt:
        print('\nNhan Ctrl-C: dung, KHONG ghi tra goc.')
        print('  Muon tra goc: chay lai voi --off')
        if h:
            kernel32.CloseHandle(h)
        return 130
    return 0


if __name__ == '__main__':
    sys.exit(run())
