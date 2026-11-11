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
    xa_nofog_pro.exe --trial 1h      # dung thu 1 GIO  (10 luot/tai khoan)
    xa_nofog_pro.exe --trial 3d      # dung thu 3 NGAY (10 luot/tai khoan)
    xa_nofog_pro.exe --trial         # mac dinh 3 ngay
    xa_nofog_pro.exe --trial-key TR-XXXX-XXXX-XXXX   # nhan ma do WEB cap
    xa_nofog_pro.exe --login         # dang nhap (hoi tai khoan + mat khau)
    xa_nofog_pro.exe --login tk mk   # dang nhap truc tiep
    xa_nofog_pro.exe --logout        # dang xuat (GIU key ban quyen)
    xa_nofog_pro.exe --buy           # mo trang mua key
    xa_nofog_pro.exe --rebind K T    # doi may bang token
    xa_nofog_pro.exe --key K --token T   # kich hoat sau khi admin reset
    xa_nofog_pro.exe --status        # xem trang thai + so luot con lai
    xa_nofog_pro.exe --deactivate    # xoa key khoi may nay
    xa_nofog_pro.exe --help          # huong dan

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
import re
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
TRIAL_REQUIRE_ACCOUNT = str(_c('TRIAL_REQUIRE_ACCOUNT', '1')) not in ('0', 'False', 'false', '')

# Goi 1 gio
TRIAL_1H_MINUTES = int(_c('TRIAL_1H_MINUTES', 60))
TRIAL_1H_LIMIT = int(_c('TRIAL_1H_LIMIT', 10))
TRIAL_1H_RECHECK = int(_c('TRIAL_1H_RECHECK', 120))

# Goi 3 ngay
TRIAL_3D_DAYS = int(_c('TRIAL_3D_DAYS', 3))
TRIAL_3D_LIMIT = int(_c('TRIAL_3D_LIMIT', 10))
TRIAL_3D_RECHECK = int(_c('TRIAL_3D_RECHECK', 900))

TRIAL_DEFAULT_KIND = str(_c('TRIAL_DEFAULT_KIND', '3d'))
TRIAL_WARN_SEC_1H = int(_c('TRIAL_WARN_SEC_1H', 600))
TRIAL_WARN_DAYS_3D = float(_c('TRIAL_WARN_DAYS_3D', 1))

# Tuong thich nguoc (code cu con tham chieu)
TRIAL_DAYS = TRIAL_3D_DAYS
TRIAL_WARN_DAYS = TRIAL_WARN_DAYS_3D

TRIAL_GRACE_HOURS = int(_c('TRIAL_GRACE_HOURS', 0))
TRIAL_RECHECK_SEC = int(_c('TRIAL_RECHECK_SEC', 300))
BUY_URL = str(_c('BUY_URL', 'https://xienhl.com/#/product/license-xarena-thang'))
LOGIN_URL = str(_c('LOGIN_URL', 'https://xienhl.com/#/login'))
REGISTER_URL = str(_c('REGISTER_URL', 'https://xienhl.com/#/register'))
FORGOT_URL = str(_c('FORGOT_URL', 'https://xienhl.com/#/login'))
EXIT_TRIAL_END = int(_c('EXIT_TRIAL_END', 6))
EXIT_TRIAL_QUOTA = int(_c('EXIT_TRIAL_QUOTA', 7))
CLIENT_VERSION = '1.4.0'

# Dinh nghia 2 goi dung thu
TRIAL_KINDS = {
    '1h': {'label': '1 GIO',  'sec': TRIAL_1H_MINUTES * 60, 'recheck': TRIAL_1H_RECHECK},
    '3d': {'label': '3 NGAY', 'sec': TRIAL_3D_DAYS * 86400, 'recheck': TRIAL_3D_RECHECK},
}
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


class HwidUnavailable(RuntimeError):
    """Khong doc duoc du thong tin phan cung de tinh HWID (FAIL CLOSED).

    Truoc day compute_hwid() VAN bam khi ca 4 manh deu rong, nen moi may
    khong doc duoc phan cung (WOW64 loi, winreg bi chan, may ao toi gian,
    GetVolumeInformationW tra '') deu ra CUNG mot HWID:
        bea408e2a8a8fa43220a6889cb502a3d   (weak: cc19d15b...)
    Server chap nhan HWID dai 8..128 ky tu nen gia tri do HOP LE -> chi can
    1 key bind 1 lan la dung duoc tren VO SO may loi, va farm trial vo han.
    Gio raise de khong bao gio gui HWID "toan rong" len server.
    """


# So manh phan cung toi thieu de coi la "doc duoc may". Xem _hwid_parts_check.
_HWID_MIN_PARTS = 2


def _hwid_parts_check(parts):
    """Bo manh phan cung nay co du manh de bam HWID khong? Tra (ok, ly_do).

    NGUONG: can it nhat 2 manh khac rong, HOAC rieng MachineGuid (parts[0]).

    Ly do chon nguong nay:
      - 0 manh (ca 4 deu rong): moi may loi ra CUNG 1 HWID -> guard bat buoc.
      - 1 manh khong phai MachineGuid: KHONG du doc nhat. CPU brand giong
        nhau tren hang trieu may; BIOS serial cua vai board OEM la gia tri
        trung ('Default string' da bi loc, nhung van con nhieu board trung
        serial); volume serial bi clone khi nhan ban dia/VM -> nhieu may
        khac nhau se ra cung HWID. Chan.
      - 1 manh la MachineGuid: MachineGuid la GUID ngau nhien Windows sinh
        rieng cho tung lan cai dat -> du doc nhat. Cho qua de KHONG chan nham
        may chi bi chan o nhanh winreg khac (thuc te doc duoc MachineGuid thi
        gan nhu luon doc duoc ca CPU brand -> se thanh >= 2 manh).
      - >= 2 manh: may binh thuong (du 3-4 manh); may thieu BIOS serial van
        con guid + cpu + vol = 3 manh -> khong bao gio bi chan oan.
    """
    vals = ['' if p is None else str(p).strip() for p in parts]
    n = len([v for v in vals if v])
    if n >= _HWID_MIN_PARTS:
        return True, ''
    if n == 1 and vals and vals[0]:
        return True, ''
    return False, 'chi doc duoc %d/%d manh phan cung' % (n, len(vals))


def _hwid_digest(prefix, parts):
    """sha256(prefix + '|' + '|'.join(parts))[:32] -- FAIL CLOSED.

    Gia tri bam KHONG doi so voi truoc khi them guard: parts van duoc noi
    NGUYEN BAN (khong strip) nen may binh thuong giu nguyen HWID cu.
    """
    ok, why = _hwid_parts_check(parts)
    if not ok:
        raise HwidUnavailable(why)
    return hashlib.sha256(
        (prefix + '|' + '|'.join(parts)).encode('utf-8')).hexdigest()[:32]


def _hwid_parts_checked():
    """Nhu _hwid_parts() nhung raise HwidUnavailable khi thieu manh."""
    parts = _hwid_parts()
    ok, why = _hwid_parts_check(parts)
    if not ok:
        raise HwidUnavailable(why)
    return parts


def _hwid_safe():
    """compute_hwid() khong bao gio raise. Tra '' khi khong doc duoc may."""
    try:
        return compute_hwid()
    except HwidUnavailable:
        return ''


def _print_hwid_fail():
    """In huong dan khi khong doc duoc phan cung. Tra False."""
    print('  ============================================================')
    print('   KHONG DOC DUOC THONG TIN PHAN CUNG')
    print('  ------------------------------------------------------------')
    print('   Tool can doc thong tin phan cung (MachineGuid, serial BIOS,')
    print('   ten CPU, serial o dia C:) de tao ma dinh danh may.')
    print('   May cua ban khong doc duoc (hoac doc duoc qua it) nen khong')
    print('   the xac minh ban quyen.')
    print('')
    print('   Cach xu ly:')
    print('     1. Chuot phai exe -> "Run as administrator"')
    print('     2. Tat tam thoi phan mem diet virus / chan registry')
    print('     3. Neu dang chay trong may ao: chay tren may that')
    print('     4. Khoi dong lai Windows roi chay lai tool')
    print('')
    print('   Van khong duoc? Nhan ho tro: %s' % BUY_URL)
    print('  ============================================================')
    return False


def compute_hwid():
    """SHA-256 phan cung that. Khong dung ten may / MAC (doi qua de).

    PHẢI khớp server (src/lib/trial-quota.js deriveIds):
      hwid = sha256('v1|' + guid|bios|cpu|vol)[:32]
    Trước đây client dùng sha256(guid|bios|cpu|vol) -> LỆCH với server,
    nên --status báo "HWID khớp: KHÔNG" và trial chết vì hwid_mismatch.

    FAIL CLOSED: khong doc duoc du phan cung -> raise HwidUnavailable,
    TUYET DOI khong tra hash cua chuoi rong (xem _hwid_parts_check).
    """
    return _hwid_digest('v1', _hwid_parts())


def compute_weak_hwid():
    """HWID 'cung' -- BO volume serial.

    Volume serial doi duoc bang phan mem (va doi khi format o). Neu dung
    compute_hwid() lam dau vet chong reset trial thi chi can doi serial la
    xin duoc trial moi. Chuoi nay on dinh hon.

    Phải khớp server: weak = sha256('w1|' + guid|bios|cpu)[:32]

    FAIL CLOSED: nguong tinh tren DUNG 3 manh dua vao hash (guid/bios/cpu),
    vi du chi con 'cpu' thi weak HWID giong nhau tren hang trieu may.
    """
    parts = _hwid_parts()[:3]      # MachineGuid + BIOS serial + CPU brand
    return _hwid_digest('w1', parts)


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
def _post(path, payload, timeout=None, retries=0, cookie=None):
    """POST JSON toi server license.

    cookie: session token (64 hex) de xac thuc khi can (trial bat buoc dang nhap).

    retries>0 chi dung cho /api/trial/start: tao trial la thao tac GHI,
    mang chap chon giua chung se lam client khong biet server da tao hay
    chua. Endpoint do idempotent (tra lai trial cu) nen retry an toan.
    """
    url = API_BASE.rstrip('/') + path
    body = json.dumps(payload).encode('utf-8')
    last = {'ok': False, 'code': 'network', 'msg': 'chua gui duoc'}
    for attempt in range(retries + 1):
        headers = {'content-type': 'application/json',
                   'user-agent': '%s/%s' % (APP_NAME, CLIENT_VERSION)}
        if cookie:
            headers['cookie'] = 'mbk_session=%s' % cookie
        req = urllib.request.Request(url, data=body, method='POST', headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=timeout or HTTP_TIMEOUT) as r:
                out = json.loads(r.read().decode('utf-8'))
                # Doc Set-Cookie de lay session moi (dang nhap)
                sc = r.headers.get('Set-Cookie') or ''
                m = re.search(r'mbk_session=([0-9a-fA-F]{64})', sc)
                if m and isinstance(out, dict):
                    out['_set_cookie'] = m.group(1)
                return out
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


def _get(path, timeout=None, cookie=None):
    """GET JSON tu server (dung cho /api/auth/me, /api/trial/status)."""
    url = API_BASE.rstrip('/') + path
    headers = {'user-agent': '%s/%s' % (APP_NAME, CLIENT_VERSION)}
    if cookie:
        headers['cookie'] = 'mbk_session=%s' % cookie
    req = urllib.request.Request(url, method='GET', headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout or HTTP_TIMEOUT) as r:
            out = json.loads(r.read().decode('utf-8'))
            sc = r.headers.get('Set-Cookie') or ''
            m = re.search(r'mbk_session=([0-9a-fA-F]{64})', sc)
            if m and isinstance(out, dict):
                out['_set_cookie'] = m.group(1)
            return out
    except urllib.error.HTTPError as e:
        try:
            return json.loads(e.read().decode('utf-8'))
        except Exception:
            return {'ok': False, 'code': 'http_%d' % e.code}
    except Exception as e:
        return {'ok': False, 'code': 'network', 'msg': str(e)}


# --------------------------------------------------------------- login -------

def save_session(cookie, username=None):
    """Luu session vao lic.bin (DPAPI). Tra True/False."""
    if not cookie:
        return False
    st = load_state()
    st['acct_cookie'] = cookie
    if username:
        st['acct_user'] = username
    st['acct_at'] = int(time.time())
    return save_state(st)


def load_session():
    """Tra (cookie, username) hoac (None, None)."""
    st = load_state()
    ck = st.get('acct_cookie')
    if not ck or len(str(ck)) != 64:
        return None, st.get('acct_user')
    return str(ck), st.get('acct_user')


def drop_session():
    """Xoa session nhung GIU key (khong dong vao license)."""
    st = load_state()
    st.pop('acct_cookie', None)
    st.pop('acct_user', None)
    st.pop('acct_at', None)
    return save_state(st)


def login_to_server(username, password, verbose=True):
    """Dang nhap lay session. Tra (ok, msg, cookie)."""
    r = _post('/api/auth/login', {'username': username, 'password': password},
              timeout=HTTP_TIMEOUT, retries=0)
    if not r.get('ok'):
        code = str(r.get('code') or '')
        if code == 'INVALID_CREDENTIALS':
            return False, 'Sai tai khoan hoac mat khau', None
        if code == 'ACCOUNT_LOCKED':
            return False, 'Tai khoan bi khoa. Lien he ho tro.', None
        if code == 'RATE_LIMITED':
            return False, 'Thu qua nhanh, cho 1-2 phut roi thu lai', None
        return False, (r.get('msg') or code or 'khong dang nhap duoc'), None

    ck = r.get('_set_cookie')
    if not ck:
        return False, 'server khong tra session', None
    uname = (r.get('user') or {}).get('username') or username
    save_session(ck, uname)
    if verbose:
        print('  Dang nhap thanh cong: %s' % uname)
    return True, 'ok', ck


def ensure_session(verbose=True):
    """Lay session con hieu luc. Tra (cookie, username) hoac (None, None)."""
    ck, uname = load_session()
    if ck:
        # Kiem lai voi server
        r = _get('/api/auth/me', cookie=ck)
        if r.get('ok') and r.get('user'):
            return ck, r['user'].get('username') or uname
        # Session chet -> xoa nhung GIU key
        drop_session()
    return None, uname


def ask_login(verbose=True):
    """Hoi dang nhap qua hop thoai. Tra (cookie, username) hoac (None, None)."""
    for attempt in (1, 2, 3):
        cred = _login_dialog(attempt)
        if not cred:
            return None, None

        # Khach chon "Dang ky" -> mo browser
        if cred.get('action') == 'register':
            print('  Dang mo trang dang ky...')
            try:
                import subprocess
                subprocess.Popen(['explorer.exe', REGISTER_URL], close_fds=True)
            except Exception:
                print('  Mo tay: %s' % REGISTER_URL)
            continue
        if cred.get('action') == 'forgot':
            print('  Mo trang quen mat khau: %s' % FORGOT_URL)
            continue

        ok, msg, ck = login_to_server(cred['username'], cred['password'], verbose)
        if ok:
            return ck, cred['username']
        print('  %s (lan %d/3)' % (msg, attempt))
        if 'khoa' in msg or 'qua nhanh' in msg:
            return None, None
    return None, None


def _login_dialog(attempt=1):
    """Hop thoai dang nhap. Tra dict {username, password} | {action} | None.

    Uu tien Tk (co timeout 180s), fallback getpass, cuoi cung tra None.
    """
    # --- Tang 1: Tk ---
    try:
        import tkinter as tk

        result = {'value': None}
        root = tk.Tk()
        root.title('%s - Dang nhap' % APP_NAME)
        root.resizable(False, False)

        # Icon + tieu de
        top = tk.Frame(root, padx=18, pady=14)
        top.pack(fill='both', expand=True)

        tk.Label(top, text='Dung thu mien phi can tai khoan',
                 font=('Segoe UI', 11, 'bold')).grid(row=0, column=0, columnspan=2,
                                                    sticky='w', pady=(0, 4))
        tk.Label(top, text='Mien phi, chi can ten + mat khau. Khong can the.',
                 font=('Segoe UI', 8), fg='#666').grid(row=1, column=0, columnspan=2,
                                                      sticky='w', pady=(0, 12))

        tk.Label(top, text='Tai khoan:', font=('Segoe UI', 9)).grid(row=2, column=0,
                                                                   sticky='e', padx=(0, 8))
        e_user = tk.Entry(top, width=28, font=('Segoe UI', 9))
        e_user.grid(row=2, column=1, sticky='w', pady=3)

        tk.Label(top, text='Mat khau:', font=('Segoe UI', 9)).grid(row=3, column=0,
                                                                   sticky='e', padx=(0, 8))
        e_pass = tk.Entry(top, width=28, show='\u2022', font=('Segoe UI', 9))
        e_pass.grid(row=3, column=1, sticky='w', pady=3)

        # Loi
        lbl_err = tk.Label(top, text='', font=('Segoe UI', 8), fg='#c00')
        lbl_err.grid(row=4, column=0, columnspan=2, sticky='w', pady=(6, 0))
        if attempt > 1:
            lbl_err.configure(text='Sai tai khoan hoac mat khau (lan %d/3)' % attempt)

        # Nut phu
        btn_row = tk.Frame(top, pady=10)
        btn_row.grid(row=5, column=0, columnspan=2, sticky='ew')

        def do_register():
            result['value'] = {'action': 'register'}
            root.destroy()

        def do_forgot():
            result['value'] = {'action': 'forgot'}
            root.destroy()

        tk.Button(btn_row, text='Dang ky mien phi', command=do_register,
                  relief='flat', fg='#0066cc', cursor='hand2').pack(side='left')
        tk.Button(btn_row, text='Quen mat khau?', command=do_forgot,
                  relief='flat', fg='#0066cc', cursor='hand2').pack(side='left', padx=(10, 0))

        # Timeout 180s
        state = {'deadline': time.time() + 180}
        lbl_timer = tk.Label(top, text='', font=('Segoe UI', 7), fg='#999')
        lbl_timer.grid(row=6, column=0, columnspan=2, sticky='w')

        def tick():
            left = int(state['deadline'] - time.time())
            if left <= 0:
                result['value'] = None
                root.destroy()
                return
            lbl_timer.configure(text='Tu dong dong sau %d giay.' % left)
            root.after(1000, tick)

        def do_login():
            u = e_user.get().strip()
            p = e_pass.get()
            if not u:
                lbl_err.configure(text='Nhap tai khoan')
                e_user.focus_set()
                return
            if not p:
                lbl_err.configure(text='Nhap mat khau')
                e_pass.focus_set()
                return
            result['value'] = {'username': u, 'password': p}
            root.destroy()

        def do_cancel():
            result['value'] = None
            root.destroy()

        tk.Button(top, text='Dang nhap', command=do_login, width=14,
                  default='active').grid(row=7, column=0, columnspan=2, pady=(4, 0))
        tk.Button(top, text='Huy', command=do_cancel, width=10).grid(row=8, column=0,
                                                                    columnspan=2, pady=(4, 0))

        root.bind('<Return>', lambda e: do_login())
        root.bind('<Escape>', lambda e: do_cancel())
        root.protocol('WM_DELETE_WINDOW', do_cancel)

        e_user.focus_set()
        root.after(1000, tick)
        root.lift()
        root.focus_force()
        root.mainloop()
        return result['value']
    except Exception:
        pass

    # --- Tang 2: console ---
    try:
        if not sys.stdin or not sys.stdin.isatty():
            raise OSError('no tty')
        import getpass
        print('')
        print('  Dang nhap (Enter trong = huy):')
        u = input('    Tai khoan: ').strip()
        if not u:
            return None
        p = getpass.getpass('    Mat khau : ')
        if not p:
            return None
        return {'username': u, 'password': p}
    except Exception:
        pass

    # --- Tang 3: khong co ban phim -> KHONG treo ---
    print('')
    print('  Khong mo duoc hop thoai dang nhap.')
    print('  Dang ky mien phi : %s' % REGISTER_URL)
    print('  Hoac dung        : xa_nofog_pro.exe --login <tai-khoan> <mat-khau>')
    return None


# --------------------------------------------------------------- flow -------
def rebind_key(key, token, verbose=True):
    """Doi may bang token do web cap. Tra (ok, msg).

    Luong:
      1. Web: khach bam "Doi may" -> server sinh token 1 lan, han 30 phut
      2. Khach chay: xa_nofog_pro.exe --rebind <KEY> <TOKEN> tren MAY MOI
      3. Client gui HWID may moi + token -> server doi HWID, tang rebinds
      4. Client luu state moi de dung ngay

    Truoc day client KHONG co ham nay -> --rebind bi bo qua im lang.
    """
    key = (key or '').strip().upper()
    token = (token or '').strip()
    if not key or not token:
        return False, 'can ca KEY va TOKEN'

    try:
        hwid = compute_hwid()
    except HwidUnavailable as e:
        # FAIL CLOSED: khong gui /api/rebind voi HWID rong.
        if verbose:
            _print_hwid_fail()
        return False, 'khong doc duoc thong tin phan cung (%s)' % e
    if verbose:
        print('  Dang doi may...')
        print('  HWID may moi: %s' % mask_key(hwid))

    r = _post('/api/rebind', {
        'key': key, 'hwid': hwid, 'token': token, 'app': APP_NAME,
    }, timeout=HTTP_TIMEOUT, retries=1)

    if not r.get('ok'):
        code = str(r.get('code') or '')
        msg = r.get('msg') or code or 'khong ro loi'
        if code == 'invalid_token':
            return False, 'Token khong dung hoac da het han. Lay token moi tren web.'
        if code == 'token_used':
            return False, 'Token da duoc dung roi. Lay token moi tren web.'
        if code == 'REBIND_LIMIT' or code == 'rebind_limit':
            return False, 'Da het so lan doi may. Lien he ho tro.'
        if code == 'forbidden':
            return False, 'Ban khong so huu ma nay.'
        if code == 'revoked':
            return False, 'Ma da bi thu hoi.'
        return False, msg

    # Luu state: HWID moi, han moi tu server
    st = load_state()
    anchor_server_time(st, r.get('now'))
    st.update({
        'key': key,
        'hwid': hwid,
        'expires_at': r.get('expires_at', st.get('expires_at', 0)),
        'activated_at': r.get('activated_at', st.get('activated_at', 0)),
        'plan': r.get('plan') or st.get('plan') or 'aoe1',
        'grace_hours': r.get('grace_hours', 0),   # BAT BUOC ONLINE: khong offline grace
        'last_ok': time.time(),
        'mono_last_ok': _mono(),
        'mode': 'server',
    })
    for _k in ('is_trial', 'trial_weak', 'trial_started', 'trial_days'):
        st.pop(_k, None)
    if not save_state(st):
        return False, 'doi may xong nhung khong ghi duoc file license'

    left = r.get('rebinds_left')
    if left is None:
        return True, 'Doi may thanh cong.'
    return True, 'Doi may thanh cong (con %s luot doi may).' % left


def activate(key, verbose=True, token=None):
    """Kich hoat qua server. Server gan HWID + bat dau tinh han TU BAY GIO.

    token: tuy chon. Cần khi admin đã reset HWID cho key này — lúc đó
    server trả 403 rebind_token_required nếu không có token.
    Đường installer (--key) sau khi admin reset cũng cần token.
    """
    try:
        hwid = compute_hwid()
    except HwidUnavailable as e:
        # FAIL CLOSED: khong gui /api/activate voi HWID rong.
        if verbose:
            _print_hwid_fail()
        return False, 'khong doc duoc thong tin phan cung (%s)' % e
    if verbose:
        print('  HWID: %s' % mask_key(hwid))

    payload = {'key': key, 'hwid': hwid, 'app': APP_NAME}
    if token:
        payload['token'] = token

    r = _post('/api/activate', payload)
    if not r.get('ok'):
        code = str(r.get('code') or '')
        msg = r.get('msg') or code or 'kich hoat that bai'
        if code == 'rebind_token_required':
            return False, ('Mã này đã được admin reset để đổi máy. '
                           'Vào xienhl.com/#/licenses bấm "Đổi máy" để lấy mã, '
                           'rồi chạy: xa_nofog_pro.exe --rebind <KEY> <TOKEN>')
        if code == 'invalid_token':
            return False, 'Mã đổi máy không đúng. Lấy mã mới trên web.'
        if code == 'token_used':
            return False, 'Mã đổi máy đã dùng rồi. Lấy mã mới trên web.'
        if code == 'token_expired':
            return False, 'Mã đổi máy đã hết hạn (30 phút). Lấy mã mới trên web.'
        return False, msg
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
        'grace_hours': r.get('grace_hours', 0),   # BAT BUOC ONLINE: khong offline grace
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
    # State cu da luu HWID -> dung lai, khong can doc phan cung lai.
    # Chua co -> phai tinh; that bai thi FAIL CLOSED, KHONG gui hwid rong.
    hwid = st.get('hwid')
    if not hwid:
        try:
            hwid = compute_hwid()
        except HwidUnavailable as e:
            if verbose:
                _print_hwid_fail()
            return False, 'code:hwid_unavailable|khong doc duoc thong tin phan cung (%s)' % e
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
        'grace_hours': r.get('grace_hours', 0),   # BAT BUOC ONLINE: khong offline grace
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
    return st.get('grace_hours', 0) * 3600 - elapsed   # 0 = bat buoc online


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
# PHAN 1b -- DUNG THU (1 GIO hoac 3 NGAY)
# =============================================================================
def _secs_left(st=None):
    """So GIAY con lai. None neu khong co han."""
    st = st if st is not None else load_state()
    exp = st.get('expires_at') or 0
    if not exp:
        return None
    return max(0, exp - server_now())


def _days_left(st=None):
    """So ngay con lai (float) hoac None neu khong co han."""
    s = _secs_left(st)
    return None if s is None else s / 86400.0


def _fmt_left(st=None):
    """Chuoi thoi gian con lai, tu chon don vi theo goi."""
    st = st if st is not None else load_state()
    s = _secs_left(st)
    if s is None:
        return 'chua bat'
    kind = st.get('trial_kind') or ('1h' if s < 86400 and is_trial(st) else '3d')
    if kind == '1h' or (s < 86400 and is_trial(st)):
        # Hiện cả GIÂY để khách thấy đồng hồ chạy (trước chỉ MM:SS nên
        # chạy --status cách 20 giây vẫn "00:34", tưởng tool treo)
        return '%02d:%02d:%02d' % (s // 3600, (s % 3600) // 60, s % 60)
    return '%.1f ngay' % (s / 86400.0)


def _print_trial_banner(st):
    """Banner dung thu. Hien dung goi (1 GIO / 3 NGAY) va dem nguoc."""
    label = st.get('trial_label')
    kind = st.get('trial_kind')
    if not label:
        label = '1 GIO' if kind == '1h' else '%d NGAY' % TRIAL_DAYS
    exp = st.get('expires_at') or 0
    left_txt = _fmt_left(st)

    # Quota
    q = ''
    if st.get('quota') is not None:
        used = st.get('quota_used')
        total = st.get('quota')
        if used is not None:
            q = '   Luot: con %d/%d' % (max(0, total - used), total)

    print('')
    print('  ============================================================')
    print('   DUNG THU MIEN PHI %s  --  con %s' % (label, left_txt))
    if exp:
        print('   Het han: %s%s' % (
            time.strftime('%Y-%m-%d %H:%M', time.localtime(exp)), q))
    elif st.get('hold_until'):
        print('   Chua kich hoat - dong ho bat dau khi vao game.')
    print('  ------------------------------------------------------------')
    print('   Cua so nay phai mo trong khi choi.')
    print('   Mua key: %s' % BUY_URL)
    print('  ============================================================')
    print('')


def _warn_trial(st):
    """Nhac 1 dong khi sap het han. Khong bao gio chan."""
    s = _secs_left(st)
    if s is None:
        return
    kind = st.get('trial_kind') or '3d'
    if s <= 0:
        print('  [!] DUNG THU DA HET HAN. Mua key tai %s' % BUY_URL)
        return
    # Nguong theo goi: 1h nhac khi con 10 phut, 3d nhac khi con 1 ngay
    if kind == '1h':
        if s <= TRIAL_WARN_SEC_1H:
            print('  [!] Dung thu con %02d:%02d. Mua key tai %s'
                  % (s // 60, s % 60, BUY_URL))
    elif s <= TRIAL_WARN_DAYS_3D * 86400:
        print('  [!] Dung thu con %.1f ngay. Mua key tai %s'
              % (s / 86400.0, BUY_URL))


def _offer_buy(open_browser=False):
    """Bang gia + huong dan mua. open_browser=True -> tu mo trang mua."""
    print('')
    print('  ============================================================')
    print('   BAN QUYEN XARENA NO FOG')
    print('  ------------------------------------------------------------')
    print('   Goi        Thoi han      Gia')
    print('   Tuan       7 ngay        70.000d')
    print('   Thang      30 ngay       180.000d')
    print('   Nam        365 ngay      590.000d')
    print('   Vinh vien  khong het han 1.290.000d')
    print('  ------------------------------------------------------------')
    print('   Mua tai    : %s' % BUY_URL)
    print('   Nhap key   : xa_nofog_pro.exe --key AOE1-XXXX-XXXX-XXXX')
    print('   Dung thu   : xa_nofog_pro.exe --trial        (1 gio)')
    print('                xa_nofog_pro.exe --trial 3d     (3 ngay)')
    print('  ============================================================')
    if open_browser:
        print('   Dang mo trang mua trong trinh duyet...')
        if open_buy_page():
            print('   Neu khong mo, chep link tren vao Chrome/Edge.')
        else:
            print('   Khong mo duoc trinh duyet - chep link tren thu cong.')
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


def start_trial(kind=None, verbose=True):
    """Xin trial tu server. Tra dict {ok, code, msg, next, key}.

    next: 'run'  -> chay duoc
          'login'-> can dang nhap (hien hop thoai)
          'buy'  -> het luot / bi chan -> mo trang mua
          'retry'-> loi mang/server -> thu lai

    Gui RAW parts (guid/bios/cpu/vol) chu khong gui hwid: server tu bam,
    nen khong the farm trial bang HWID tu bia.
    """
    if not TRIAL_ENABLED:
        return {'ok': False, 'code': 'disabled',
                'msg': 'Ban nay khong co dung thu.', 'next': 'buy'}

    kind = (kind or TRIAL_DEFAULT_KIND).lower()
    if kind not in TRIAL_KINDS:
        return {'ok': False, 'code': 'bad_kind',
                'msg': 'Goi dung thu chi co: 1h | 3d', 'next': 'retry'}

    label = TRIAL_KINDS[kind]['label']

    # ---- 1. KHONG can dang nhap ----
    # Dung /api/trial/command: server tu bam HWID tu raw parts, khong doi
    # session. Truoc day goi /api/trial/start (bat buoc login) nen khach
    # phai tao tai khoan chi de dung thu -> ray ra, mat khach.
    ck = None
    uname = None

    # FAIL CLOSED: server tu bam parts -> parts rong se ra HWID "toan rong"
    # giong nhau tren moi may loi => 1 tai khoan farm duoc vo han.
    try:
        parts = _hwid_parts_checked()
    except HwidUnavailable as e:
        if verbose:
            _print_hwid_fail()
            print('  Khong bat duoc dung thu: khong doc duoc thong tin phan cung.')
        return {'ok': False, 'code': 'hwid_unavailable',
                'msg': 'Khong doc duoc thong tin phan cung cua may (%s).' % e,
                'next': 'retry'}
    if verbose:
        print('  Dang bat dung thu %s...' % label)

    # idem_key: retry mang khong tru 2 luot
    idem = hashlib.sha256(
        ('%s|%s|%d' % (parts[0] + parts[1] + parts[2], kind,
                       int(time.time() // 300))).encode('utf-8')
    ).hexdigest()[:32]

    payload = {
        'guid': parts[0], 'bios': parts[1], 'cpu': parts[2], 'vol': parts[3],
        'kind': kind, 'app': APP_NAME, 'ver': CLIENT_VERSION, 'idem_key': idem,
    }

    r = _post('/api/trial/command', payload, timeout=HTTP_TIMEOUT, retries=1, cookie=ck)

    if not r.get('ok'):
        code = str(r.get('code') or '')

        # /api/trial/command khong can session -> login_required la loi la
        if code == 'login_required':
            return {'ok': False, 'code': 'login_required',
                    'msg': 'Server doi dang nhap (loi cau hinh). Thu lai sau.',
                    'next': 'retry'}
            r = _post('/api/trial/start', payload, timeout=HTTP_TIMEOUT,
                      retries=1, cookie=ck2)
            if not r.get('ok'):
                code = str(r.get('code') or '')
            else:
                code = ''     # thanh cong, roi xuong phan duoi

        if code:
            # Bang anh xa DAY DU - moi ma co next-action
            table = {
                'trial_quota_exhausted': ('Da dung het %s luot dung thu %s.' % (
                    r.get('quota', '?'), label), 'buy'),
                'trial_ip_limit': ('Ket noi nay da het luot dung thu hom nay.', 'buy'),
                'trial_global_limit': ('He thong het luot dung thu hom nay, thu lai mai.', 'buy'),
                'trial_banned': ('Tai khoan bi chan dung thu. Lien he ho tro.', 'buy'),
                'trial_device_limit': ('May nay da dung thu cho nhieu tai khoan khac.', 'buy'),
                'trial_denied_device': ('Khong ho tro dung thu tren may ao.', 'buy'),
                'trial_expired': ('Luot dung thu nay da het han.', 'buy'),
                'trial_disabled': ('Dung thu dang tam dong.', 'buy'),
                'trial_kind_invalid': ('Goi "%s" khong kha dung.' % kind, 'retry'),
                'rate_limit': ('Thao tac qua nhanh, thu lai sau it phut.', 'retry'),
                'bad_request': ('Du lieu gui len khong hop le.', 'retry'),
                'server_error': ('Server gap loi, thu lai sau.', 'retry'),
                'network': ('Khong ket noi duoc may chu. Kiem tra mang.', 'retry'),
            }
            if code in table:
                msg, nxt = table[code]
                return {'ok': False, 'code': code, 'msg': msg, 'next': nxt}
            if code.startswith('http_5'):
                return {'ok': False, 'code': 'server_error',
                        'msg': 'Server gap loi (%s), thu lai sau.' % code, 'next': 'retry'}
            return {'ok': False, 'code': code or 'unknown',
                    'msg': r.get('msg') or 'Loi khong ro', 'next': 'retry'}

    key = str(r.get('key') or '').strip().upper()
    if not key:
        return {'ok': False, 'code': 'no_key',
                'msg': 'Server khong tra ma dung thu.', 'next': 'retry'}

    # ---- Doc DUNG cac truong server tra ----
    activated = bool(r.get('activated'))
    time_left = int(r.get('time_left_sec') or 0)
    expires_at = int(r.get('expires_at') or 0)
    kc = TRIAL_KINDS[kind]

    st = load_state()
    anchor_server_time(st, r.get('now'))
    st.update({
        'key': key,
        # HWID DO SERVER TINH - khong dung compute_hwid() (se lech -> hwid_mismatch)
        # Fallback _hwid_safe(): '' thay vi raise, va khong bao gio la hash rong.
        'hwid': str(r.get('hwid') or _hwid_safe()),
        'plan': 'trial',
        'is_trial': 1,
        'trial_kind': kind,
        'trial_label': kc['label'],
        'trial_started': int(r.get('started_at') or server_now()),
        'grace_hours': 0,
        'last_ok': time.time(),
        'mono_last_ok': _mono(),
        'mode': 'server',
        'recheck_sec': int(r.get('recheck_sec') or kc['recheck']),
    })
    # activated=False: expires_at la HOLD (7 ngay de kip cai) -> KHONG luu lam han
    if activated:
        st['expires_at'] = expires_at
        st['activated_at'] = int(r.get('activated_at') or server_now())
        st.pop('hold_until', None)
    else:
        st['hold_until'] = expires_at
        st['expires_at'] = 0
        st['activated_at'] = 0
    if r.get('quota') is not None:
        st['quota'] = r.get('quota')
        st['quota_used'] = r.get('used')
        st['quota_left'] = r.get('left')

    if not save_state(st):
        return {'ok': False, 'code': 'save_fail',
                'msg': 'Khong ghi duoc file license.', 'next': 'retry'}

    # ---- Kich hoat dong ho NGAY (server chi tinh tu /api/check dau tien) ----
    ok2, msg2 = ensure_licensed(verbose=False)
    if not ok2:
        return {'ok': False, 'code': 'activate_fail',
                'msg': 'Khong kich hoat duoc: %s' % msg2, 'next': 'retry'}

    if verbose:
        _print_trial_banner(load_state())

    return {'ok': True, 'code': 'ok', 'msg': 'ok', 'next': 'run', 'key': key,
            'kind': kind}


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
            elif 'khong doc duoc thong tin phan cung' in msg:
                # FAIL CLOSED giua phien: bao dung nguyen nhan, khong bao
                # "mat mang" (gay hieu sai cho khach).
                print('')
                _print_hwid_fail()
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
    # 'hwid_unavailable': client khong tao duoc HWID -> cung la tu choi dut
    # khoat, KHONG duoc roi xuong nhanh grace (truoc day se bao sai thanh
    # "khong ket noi duoc server").
    if code in ('revoked', 'expired', 'hwid_mismatch', 'not_found',
                'trial_expired', 'trial_only', 'trial_denied_device',
                'rate_limit', 'bad_request', 'clock_tampered',
                'hwid_unavailable'):
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
    # Thu muc rieng cua Windows: BO.
    # Truoc day ghi upd.dat vao thu muc khoa RSA cua Windows de nguy
    # trang moc thoi gian. Day la hanh vi giong malware -> Windows
    # Defender quarantine, antivirus bao nham, go cai dat co the xoa.
    # Moc thoi gian da du: %LOCALAPPDATA% ts + HKCU + server now.
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

    VAN DE da gap: 2 instance cung chay duoc. Nguyen nhan:
      - PyInstaller --onefile sinh 2 process (bootloader + tool that).
        Bootloader thoat ngay sau khi spawn -> mutex no tao bi giai phong
        truoc khi tool that kip tao mutex cua no.
      - Lay GetLastError() sau CreateMutexW nhung co the bi ghi de.

    GIAI PHAP: tao mutex SOM (ngay dau run()) va GIU handle den khi thoat.
    Kem theo: neu khong tao duoc Global thi thu Local, va ghi PID ra file
    de kiem tra cheo.
    """
    global _mutex_handle
    for name in (MUTEX_NAME, 'XArenaNoFogPro_Local'):
        try:
            ctypes.set_last_error(0)                     # reset truoc
            h = kernel32.CreateMutexW(None, False, name)
            err = ctypes.get_last_error()                # doc NGAY, truoc lenh khac
            if not h:
                continue
            if err == ERROR_ALREADY_EXISTS:
                # Da co ban khac -> dong handle vua mo, bao that bai
                try:
                    kernel32.CloseHandle(h)
                except Exception:
                    pass
                _mutex_handle = None
                return False
            _mutex_handle = h
            return True
        except Exception:
            continue
    # Khong tao duoc mutex nao -> khong the bao ve
    return True


# --------------------------------------------------------- instance lock ----
# Mutex mot minh khong du: PyInstaller --onefile sinh 2 process, bootloader
# thoat som nen mutex no tao bi giai phong truoc khi tool that kip giu.
# Them lock file chua PID + kiem tra process con song khong.

_LOCK_FILE = os.path.join(STATE_DIR, 'run.lock')


def _pid_alive(pid):
    """True neu process con song (Windows)."""
    try:
        import ctypes as _c
        k = _c.WinDLL('kernel32', use_last_error=True)
        PROCESS_QUERY_LIMITED = 0x1000
        h = k.OpenProcess(PROCESS_QUERY_LIMITED, False, int(pid))
        if not h:
            return False
        code = _c.c_ulong()
        ok = k.GetExitCodeProcess(h, _c.byref(code))
        k.CloseHandle(h)
        # 259 = STILL_ACTIVE
        return bool(ok) and code.value == 259
    except Exception:
        return False


def _read_lock_pid():
    try:
        with open(_LOCK_FILE, 'r', encoding='utf-8') as f:
            return int(f.read().strip() or 0)
    except Exception:
        return 0


def _write_lock_pid(pid):
    try:
        os.makedirs(STATE_DIR, exist_ok=True)
        tmp = _LOCK_FILE + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            f.write(str(int(pid)))
        os.replace(tmp, _LOCK_FILE)
    except Exception:
        pass


def _clear_lock_pid():
    try:
        if os.path.exists(_LOCK_FILE):
            os.remove(_LOCK_FILE)
    except Exception:
        pass


def acquire_instance_lock():
    """Lay ca mutex LAN lock file. Tra True neu doc quyen.

    Neu ban cu da chet nhung con lock file -> tu don va cho chay.
    """
    # 1. Mutex (nhanh, tu dong giai phong khi process chet)
    if not acquire_mutex():
        return False

    # 2. Lock file (chac chan hon, xu ly PyInstaller bootloader)
    old = _read_lock_pid()
    if old and old != os.getpid() and _pid_alive(old):
        # Con ban khac song that -> tu bo, dong mutex vua lay
        try:
            if _mutex_handle:
                kernel32.CloseHandle(_mutex_handle)
        except Exception:
            pass
        return False

    # Ban cu da chet hoac chua co -> ghi PID moi
    _write_lock_pid(os.getpid())

    # Dang ky don dep khi thoat
    try:
        import atexit
        atexit.register(_clear_lock_pid)
    except Exception:
        pass
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
         'rebind': None, 'token': None, 'trial_kind': None, 'trial_key': None, 'login': None, 'logout': False}
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
            # --trial 1h | --trial 3d  (khong bat buoc)
            if i + 1 < len(argv) and argv[i + 1].lower() in ('1h', '3d', '1g', '3n'):
                i += 1
                o['trial_kind'] = argv[i].lower()
        elif a == '--trial-key':
            i += 1
            if i >= len(argv):
                return None, '--trial-key can ma TR-XXXX-XXXX-XXXX'
            o['trial_key'] = argv[i].strip()
        elif a == '--login':
            # --login  hoac  --login <tk> <mk>
            if (i + 2 < len(argv) and not argv[i + 1].startswith('-')
                    and not argv[i + 2].startswith('-')):
                o['login'] = (argv[i + 1].strip(), argv[i + 2].strip())
                i += 2
            else:
                o['login'] = True
        elif a == '--logout':
            o['logout'] = True
        elif a == '--buy':
            o['buy'] = True
        elif a in ('-h', '--help'):
            o['help'] = True
        elif a == '--key':
            i += 1
            if i >= len(argv):
                return None, '--key can gia tri'
            o['key'] = argv[i].strip()
        elif a == '--token':
            i += 1
            if i >= len(argv):
                return None, '--token can gia tri'
            o['token'] = argv[i].strip()
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
    _tl = st.get('trial_label') or ('1 GIO' if st.get('trial_kind') == '1h'
                                     else '%d NGAY' % TRIAL_DAYS)
    print('Loai      : %s' % ('DUNG THU ' + _tl if trial else 'BAN QUYEN'))
    print('Key       : %s' % mask_key(key))

    # --status phai in duoc thong tin du khong doc duoc phan cung: khong raise.
    try:
        hwid = compute_hwid()
    except HwidUnavailable as e:
        hwid = ''
        stored = st.get('hwid') or ''
        print('HWID may  : (KHONG DOC DUOC phan cung - %s)' % e)
        print('HWID khop : KHONG (khong tao duoc HWID)')
        if stored:
            print('HWID luu  : %s' % mask_key(stored))
    else:
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
        print('Con lai   : %s' % _fmt_left(st))

    # Hiển thị giờ server + phát hiện lùi đồng hồ
    if _time_anchor['server_ts'] > 0:
        tampered, delta = detect_clock_rollback(st)
        if st.get('quota') is not None and st.get('quota_used') is not None:
            print('Luot      : con %d/%d' % (max(0, st['quota'] - st['quota_used']),
                                             st['quota']))
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
            print('Nhac nho  : con %s, mua key tai %s' % (_fmt_left(st), BUY_URL))
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
        ok, m = activate(opts['key'], token=opts.get('token'))
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
            res = start_trial(kind=opts.get('trial_kind'))
            if res['ok']:
                return True

            # KHONG roi thang xuong hop thoai nhap key nua.
            # Phan nhanh theo res['next'] - moi ma loi co buoc tiep theo ro rang.
            nxt = res.get('next')

            if nxt == 'retry':
                # Loi mang / server -> chi can thu lai, KHONG hoi key
                print('')
                print('  [!] %s' % res['msg'])
                print('      Thu lai: xa_nofog_pro.exe --trial')
                return False

            if res.get('code') == 'login_cancelled':
                print('')
                print('  Dung thu can TAI KHOAN mien phi (chi ten + mat khau).')
                print('')
                print('    Dang ky mien phi : %s' % REGISTER_URL)
                print('    Dang nhap        : xa_nofog_pro.exe --login <tai-khoan> <mat-khau>')
                print('    Da co key        : xa_nofog_pro.exe --key AOE1-XXXX-XXXX-XXXX')
                print('')
                if _ask_yes_no('  Nhap key mua ngay bay gio?', default=False):
                    return _ask_key_final()
                return False

            # nxt == 'buy' (het luot / bi chan / may ao)
            print('')
            print('  [!] %s' % res['msg'])
            _offer_buy(open_browser=True)
            return False
        else:
            print('Chua kich hoat. Ban nay khong co dung thu.')
    else:
        # --- 2. Co state -> kiem han -----------------------------------
        ok, msg = ensure_licensed(verbose=True)
        if ok:
            if is_trial(load_state()):
                _warn_trial(load_state())
            return True

        # FAIL CLOSED phai dung TRUOC nhanh is_trial: neu may khong doc duoc
        # phan cung thi nguyen nhan la HWID, khong phai "het han".
        if 'khong doc duoc thong tin phan cung' in msg:
            # Bao ro, KHONG hoi key (nhap key cung khong kich hoat duoc vi
            # thieu HWID de server gan).
            print('')
            _print_hwid_fail()
            return False
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

    # --- 4. Chi hoi key khi khach CHU DONG muon ------------------------
    # Truoc day: roi thang xuong ask_key_dialog() cho MOI truong hop
    # (ke ca het luot / mat mang / chua dang nhap) -> khach khong co key
    # bi dui vao hop thoai vo nghia, dung nhu anh chup khach gui.
    print('')
    if not _ask_yes_no('  Ban co ma ban quyen muon nhap ngay bay gio?', default=False):
        print('')
        print('  Ban co the:')
        print('    - Dung thu mien phi : xa_nofog_pro.exe --trial')
        print('    - Dang ky tai khoan : %s' % REGISTER_URL)
        print('    - Mua key           : %s' % BUY_URL)
        print('')
        return False

    return _ask_key_final()


def _ask_key_final():
    """Hoi key va kich hoat. Tra True/False. Dung chung cho moi duong."""
    k = ask_key_dialog()
    if not k:
        print('Da huy.', file=sys.stderr)
        return False

    ok, m = activate(k)
    print('  ' + m)
    if not ok:
        # Key dung thu nhap nham cho -> huong dan dung duong
        if 'dung thu' in m.lower() or 'trial' in m.lower():
            print('')
            print('  Day la ma DUNG THU, khong phai key mua.')
            print('  Chay: xa_nofog_pro.exe --trial            (tu dong dung thu)')
            print('  Hoac: xa_nofog_pro.exe --trial-key ' + k.strip().upper())
        return False
    ok2, m2 = ensure_licensed(verbose=False)
    if not ok2:
        print('  Van khong hop le: %s' % m2, file=sys.stderr)
        return False
    return True


def _ask_yes_no(prompt, default=False):
    """Hoi yes/no. Tra bool. Khong bao gio raise, khong treo."""
    try:
        if not sys.stdin or not sys.stdin.isatty():
            return default
        suffix = ' [Y/n] ' if default else ' [y/N] '
        ans = input(prompt + suffix).strip().lower()
        if not ans:
            return default
        return ans in ('y', 'yes', 'c', 'co', '1')
    except Exception:
        return default


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

    # --rebind <key> <token>: doi may bang token do web cap
    # Truoc day parse_args nhan --rebind nhung run() KHONG xu ly ->
    # tham so bi bo qua im lang, khach tuong da doi may nhung khong.
    if opts.get('rebind'):
        key, token = opts['rebind']
        ok, m = rebind_key(key, token)
        print('  ' + m)
        if ok:
            print('')
            print('Doi may thanh cong. Chay lai khong tham so de va game.')
            return 0
        print('')
        print('  ============================================================')
        print('   DOI MAY THAT BAI')
        print('  ------------------------------------------------------------')
        print('   Vao https://xienhl.com/#/licenses, bam "Doi may" de lay')
        print('   token moi (token chi dung 1 lan, het han sau 30 phut).')
        print('  ============================================================')
        return EXIT_NO_LICENSE

    # --logout: xoa phien dang nhap (GIU key)
    if opts.get('logout'):
        ck, uname = load_session()
        if not ck:
            print('  Chua dang nhap.')
            return 0
        drop_session()
        print('  Da dang xuat khoi %s.' % (uname or 'tai khoan'))
        print('  (Key ban quyen van giu nguyen)')
        return 0

    # --login [tk mk]: dang nhap de dung thu / quan ly
    if opts.get('login'):
        cred = opts['login']
        if isinstance(cred, tuple):
            ok, msg, ck = login_to_server(cred[0], cred[1])
            print('  ' + (msg if ok else msg))
            return 0 if ok else EXIT_NO_LICENSE
        # --login khong tham so -> hoi
        ck, uname = ensure_session()
        if ck:
            print('  Da dang nhap san: %s' % (uname or '?'))
            print('  Dang xuat: xa_nofog_pro.exe --logout')
            return 0
        ck, uname = ask_login(verbose=True)
        if not ck:
            print('  Khong dang nhap duoc.', file=sys.stderr)
            return EXIT_NO_LICENSE
        return 0

    # --trial-key TR-XXXX-XXXX-XXXX: nhan ma do WEB cap
    # (web cap ma roi bao "chay tool"; truoc day tool KHONG co duong nhan)
    if opts.get('trial_key'):
        tk = opts['trial_key'].strip().upper()
        # FAIL CLOSED: khong gui tam 4 manh rong len /api/trial/claim.
        try:
            parts = _hwid_parts_checked()
        except HwidUnavailable as e:
            print('')
            _print_hwid_fail()
            print('  Khong nhan duoc ma dung thu: khong doc duoc thong tin'
                  ' phan cung (%s).' % e, file=sys.stderr)
            return EXIT_NO_LICENSE
        r = _post('/api/trial/claim', {
            'key': tk,
            'guid': parts[0], 'bios': parts[1], 'cpu': parts[2], 'vol': parts[3],
            'app': APP_NAME, 'ver': CLIENT_VERSION,
        }, timeout=HTTP_TIMEOUT, retries=1)

        if not r.get('ok'):
            code = str(r.get('code') or '')
            msgs = {
                'not_found': 'Ma dung thu khong ton tai. Kiem tra lai ma.',
                'hwid_mismatch': 'Ma nay da gan voi may khac. Moi ma dung cho 1 may.',
                'trial_expired': 'Luot dung thu nay da het han.',
                'revoked': 'Ma dung thu da bi thu hoi.',
                'not_trial': 'Day la key tra phi, dung: --key ' + tk,
                'bad_request': 'Ma khong hop le (dang TR-XXXX-XXXX-XXXX).',
                'trial_denied_device': 'Khong ho tro dung thu tren may ao.',
            }
            print('')
            print('  [!] %s' % msgs.get(code, r.get('msg') or code or 'Loi khong ro'))
            if code in ('not_found', 'hwid_mismatch', 'revoked', 'trial_expired'):
                print('')
                print('  Lay ma moi tai: %s' % BUY_URL)
            return EXIT_NO_LICENSE

        # Luu state tu response
        activated = bool(r.get('activated'))
        st = load_state()
        anchor_server_time(st, r.get('now'))
        kind = str(r.get('trial_kind') or '3d')
        kc = TRIAL_KINDS.get(kind, TRIAL_KINDS['3d'])
        st.update({
            'key': tk,
            'hwid': str(r.get('hwid') or _hwid_safe()),
            'plan': 'trial',
            'is_trial': 1,
            'trial_kind': kind,
            'trial_label': kc['label'],
            'trial_started': int(r.get('activated_at') or server_now()),
            'grace_hours': 0,
            'last_ok': time.time(),
            'mono_last_ok': _mono(),
            'mode': 'server',
            'recheck_sec': int(r.get('recheck_sec') or kc['recheck']),
        })
        if activated:
            st['expires_at'] = int(r.get('expires_at') or 0)
            st['activated_at'] = int(r.get('activated_at') or server_now())
            st.pop('hold_until', None)
        else:
            st['hold_until'] = int(r.get('expires_at') or 0)
            st['expires_at'] = 0
            st['activated_at'] = 0
        save_state(st)

        ok2, msg2 = ensure_licensed(verbose=False)
        if not ok2:
            print('  Khong kich hoat duoc: %s' % msg2, file=sys.stderr)
            return EXIT_NO_LICENSE

        _print_trial_banner(load_state())
        print('  Dung thu san sang. Chay lai khong tham so de va game.')
        return 0

    # --trial: bat dung thu roi thoat
    if opts['trial']:
        st0 = load_state()
        if st0.get('key') and not is_trial(st0):
            print('May nay da co license %s. Khong can dung thu.'
                  % mask_key(st0.get('key')))
            show_status()
            return 0
        res = start_trial(kind=opts.get('trial_kind'))
        if not res['ok']:
            nxt = res.get('next')
            print('')
            print('  [!] %s' % res['msg'])
            if nxt == 'retry':
                print('      Thu lai: xa_nofog_pro.exe --trial')
                return EXIT_NO_LICENSE
            if res.get('code') == 'login_cancelled':
                print('')
                print('    Dang ky mien phi : %s' % REGISTER_URL)
                print('    Dang nhap        : xa_nofog_pro.exe --login <tk> <mk>')
                return EXIT_NO_LICENSE
            # het luot / bi chan
            if res.get('code') == 'trial_quota_exhausted':
                _offer_buy(open_browser=True)
                return EXIT_TRIAL_QUOTA
            _offer_buy(open_browser=True)
            return EXIT_NO_LICENSE
        print('')
        print('  Dung thu san sang. Chay lai khong tham so de va game.')
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
    # Dung 2 lop: mutex (nhanh) + lock file voi PID (chac chan, chong
    # PyInstaller bootloader giai phong mutex qua som).
    if resident_mode and not acquire_instance_lock():
        print('Da co ban khac dang chay. Khong mo them.')
        try:
            other = _read_lock_pid()
            if other:
                print('(ban dang chay: PID %s)' % other)
        except Exception:
            pass
        print('Tat ban cu truoc, hoac bam Ctrl-C o cua so do.')
        return EXIT_ALREADY_RUNNING

    if opts['restore']:
        print('XArena No Fog -- tra byte goc (%d cong)' % len(sites))
    elif opts['dump']:
        print('XArena No Fog -- dump trang thai')
    elif watch_mode:
        print('XArena No Fog -- watch 0.5s (%d cong)' % len(sites))
    elif resident_mode:
        _st0 = load_state()
        _fmt = '%H:%M:%S %d/%m/%Y'

        # Bắt đầu = lúc kích hoạt, hoặc lúc mở tool nếu server chưa có
        _act = _st0.get('activated_at') or 0
        _start_txt = (time.strftime(_fmt, time.localtime(_act))
                      if _act else 'chua kich hoat')

        _exp = _st0.get('expires_at')
        _trial = is_trial(_st0)

        if _exp == 0:
            # Vĩnh viễn: server trả expires_at = 0
            _han_txt = 'VINH VIEN'
            title('XA NoFog - Vinh vien')
        elif _exp:
            # Dùng _fmt_left: hiện MM:SS cho trial 1 giờ, X.Y ngày cho 3 ngày
            _left_txt = _fmt_left(_st0)
            _han_txt = '%s  (con %s)' % (
                time.strftime(_fmt, time.localtime(_exp)), _left_txt)
            title('XA NoFog - %s con %s'
                  % ('DUNG THU' if _trial else 'con', _left_txt))
        else:
            _han_txt = 'khong xac dinh'
            title('XA NoFog - dang cho game')

        print('')
        print('  ' + '-' * 58)
        if _trial:
            _tl = _st0.get('trial_label') or ('1 GIO' if _st0.get('trial_kind') == '1h'
                                              else '%d NGAY' % TRIAL_DAYS)
            print('   DANG DUNG THU %s' % _tl)
        else:
            print('   BAN QUYEN HOP LE')
        print('  ' + '-' * 58)
        print('   Bat dau : %s' % _start_txt)
        print('   Het han : %s' % _han_txt)
        print('  ' + '-' * 58)
        print('')
        print('DANG CHAY. Cho game bat...')
        print('(de cua so nay mo. Ctrl-C de dung)')
        print('(can mang: tool xac minh ban quyen moi %d phut)'
              % (TRIAL_RECHECK_SEC // 60))
        if REQUIRE_ONLINE:
            # BAT BUOC ONLINE (chu shop chot): khong co offline grace.
            # Mat mang = tool dung ngay, khong cho phep chay tiep.
            print('')
            print('  *** BAT BUOC CO MANG MOI LUC CHAY ***')
            print('  Khong co che do offline. Mat mang la tool dung.')
            print('  Kiem tra: mo https://xienhl.com xem vao duoc khong.')

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
