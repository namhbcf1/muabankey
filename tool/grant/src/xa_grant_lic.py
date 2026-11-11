# -*- coding: utf-8 -*-
"""xa_grant_lic.py -- tang license cua XAGrant.

- HWID (3 manh, kem nonce phan cung)
- State ma hoa DPAPI + HMAC (khong the sua tay lic.bin)
- Goi server: activate / check / heartbeat / violation
- Neo thoi gian vao server (chong chinh dong ho)
- Bat buoc chay tu CMD
"""
import hashlib
import json
import os
import struct
import sys
import time
import urllib.error
import urllib.request

import xa_sec

# ---------------------------------------------------------------------------
# Ma thoat
# ---------------------------------------------------------------------------
EXIT_OK = 0
EXIT_USAGE = 2
EXIT_NO_LICENSE = 3
EXIT_ALREADY_RUNNING = 4
EXIT_NOT_ADMIN = 5
EXIT_TAMPERED = 6
EXIT_NETWORK = 7

APP = 'xagrant'
VERSION = '1.0.0'

HTTP_TIMEOUT = 12
CLOCK_SKEW = 7200      # giay lech toi da truoc khi coi la chinh lui dong ho


def norm_key(k):
    """Chuan hoa ma license: bo khoang trang, chu hoa."""
    return ''.join(str(k or '').split()).upper()


# ===========================================================================
# 1. HWID
# ===========================================================================

def _machine_guid():
    try:
        import winreg
        k = winreg.OpenKey(
            winreg.HKEY_LOCAL_MACHINE,
            r'SOFTWARE\Microsoft\Cryptography', 0,
            winreg.KEY_READ | winreg.KEY_WOW64_64KEY)
        try:
            v, _ = winreg.QueryValueEx(k, 'MachineGuid')
        finally:
            winreg.CloseKey(k)
        return str(v).strip()
    except OSError:
        return ''


def _cpu_brand():
    try:
        import winreg
        k = winreg.OpenKey(
            winreg.HKEY_LOCAL_MACHINE,
            r'HARDWARE\DESCRIPTION\System\CentralProcessor\0')
        try:
            v, _ = winreg.QueryValueEx(k, 'ProcessorNameString')
        finally:
            winreg.CloseKey(k)
        return ' '.join(str(v).split())
    except OSError:
        return ''


def _volume_serial():
    try:
        import ctypes
        k32 = ctypes.WinDLL('kernel32', use_last_error=True)
        serial = ctypes.c_ulong(0)
        ok = k32.GetVolumeInformationW(
            ctypes.c_wchar_p('C:\\'), None, 0,
            ctypes.byref(serial), None, None, None, 0)
        return '%08X' % (serial.value & 0xFFFFFFFF) if ok else ''
    except Exception:
        return ''


def _bios_serial():
    """SMBIOS type 2 (baseboard) serial qua GetSystemFirmwareTable('RSMB')."""
    try:
        import ctypes
        k32 = ctypes.WinDLL('kernel32', use_last_error=True)
        k32.GetSystemFirmwareTable.restype = ctypes.c_ulong
        k32.GetSystemFirmwareTable.argtypes = [
            ctypes.c_ulong, ctypes.c_ulong, ctypes.c_void_p, ctypes.c_ulong]
        sig = struct.unpack('<I', b'RSMB')[0]
        size = k32.GetSystemFirmwareTable(sig, 0, None, 0)
        if not size or size > 4 * 1024 * 1024:
            return ''
        buf = ctypes.create_string_buffer(size)
        got = k32.GetSystemFirmwareTable(sig, 0, buf, size)
        if not got:
            return ''
        data = buf.raw[:got]
        i = 8                                   # bo header RawSMBIOSData
        while i + 4 <= len(data):
            rtype = data[i]
            rlen = data[i + 1]
            if rlen < 4 or i + rlen > len(data):
                break
            if rtype == 2:                       # Baseboard Information
                idx = data[i + 7] if rlen > 7 else 0
                if idx:
                    stab = data[i + rlen:]
                    strs = stab.split(b'\x00')
                    if 1 <= idx <= len(strs):
                        s = strs[idx - 1].decode('latin1', 'replace').strip()
                        if s and s.lower() not in (
                                'to be filled by o.e.m.', 'default string',
                                'system serial number', 'none', 'unknown',
                                'n/a', '0', '1234567890', 'not specified',
                                'not available', 'invalid'):
                            return s
                break
            # nhay qua string table
            j = i + rlen
            while j + 1 < len(data) and not (data[j] == 0 and data[j + 1] == 0):
                j += 1
            i = j + 2
    except Exception:
        return ''
    return ''


def compute_hwid():
    """32 hex. Prefix 'xg1|' de tach khoi HWID cua No Fog."""
    parts = [_machine_guid(), _bios_serial(), _cpu_brand(), _volume_serial()]
    if not any(parts):
        raise RuntimeError('khong doc duoc thong tin phan cung')
    raw = 'xg1|' + '|'.join(parts)
    return hashlib.sha256(raw.encode('utf-8')).hexdigest()[:32]


def fingerprint():
    """Dau van tay moi truong, gui kem de server phat hien bat thuong."""
    bits = [
        sys.platform,
        str(struct.calcsize('P') * 8),
        os.environ.get('PROCESSOR_ARCHITECTURE', ''),
        os.environ.get('SESSIONNAME', ''),
    ]
    return hashlib.sha256('|'.join(bits).encode()).hexdigest()[:32]


# ===========================================================================
# 2. STATE (DPAPI + HMAC)
# ===========================================================================

def _state_dir():
    base = os.environ.get('LOCALAPPDATA') or os.path.expanduser('~')
    d = os.path.join(base, 'XArenaGrant')
    try:
        os.makedirs(d, exist_ok=True)
    except OSError:
        pass
    return d


def _state_file():
    return os.path.join(_state_dir(), 'lic.bin')


_MAGIC = b'XGR1'


def save_state(st):
    """Ghi state: HMAC truoc, roi DPAPI. Ghi nguyen tu."""
    try:
        gate = st.get('gate') or ''
        key = xa_sec.gate_key(gate)
        body = json.dumps(st, separators=(',', ':'), sort_keys=True).encode('utf-8')
        tag = xa_sec.mac(key, body)
        blob = _MAGIC + tag + body
        enc = xa_sec.dpapi(blob, protect=True)
        if not enc:
            return False
        path = _state_file()
        tmp = path + '.tmp'
        with open(tmp, 'wb') as f:
            f.write(enc)
        os.replace(tmp, path)
        try:
            import ctypes
            ctypes.windll.kernel32.SetFileAttributesW(path, 0x02)
        except Exception:
            pass
        return True
    except Exception:
        return False


def load_state():
    """Doc state. Tra {} neu khong co / hong / bi sua."""
    try:
        path = _state_file()
        if not os.path.exists(path):
            return {}
        with open(path, 'rb') as f:
            enc = f.read()
        raw = xa_sec.dpapi(enc, protect=False)
        if not raw or not raw.startswith(_MAGIC):
            return {}
        tag = raw[len(_MAGIC):len(_MAGIC) + 32]
        body = raw[len(_MAGIC) + 32:]
        st = json.loads(body.decode('utf-8'))
        if not isinstance(st, dict):
            return {}
        key = xa_sec.gate_key(st.get('gate') or '')
        if xa_sec.mac(key, body) != tag:
            return {}                       # bi sua -> coi nhu chua kich hoat
        return st
    except Exception:
        return {}


def clear_state():
    try:
        path = _state_file()
        try:
            import ctypes
            ctypes.windll.kernel32.SetFileAttributesW(path, 0x80)
        except Exception:
            pass
        os.remove(path)
        return True
    except Exception:
        return False


# ===========================================================================
# 3. DONG HO
# ===========================================================================

class Clock(object):
    """Neo vao gio server. Moi lan co `now` tu server thi cap nhat neo cu."""

    def __init__(self):
        self.srv = 0.0
        self.mono = 0.0
        self.tampered = False
        self.delta = 0.0

    def restore(self, st):
        try:
            self.srv = float(st.get('srv_ts') or 0)
            self.mono = float(st.get('mono_at') or 0)
            self.tampered = bool(st.get('clock_tampered') or False)
        except (TypeError, ValueError):
            self.srv = 0.0
            self.mono = 0.0

    def anchor(self, server_ts):
        try:
            ts = float(server_ts)
        except (TypeError, ValueError):
            return
        if ts <= 0:
            return
        self.srv = ts
        self.mono = time.monotonic()
        self.delta = time.time() - ts
        if self.delta < -CLOCK_SKEW:
            self.tampered = True

    def now(self):
        if not self.srv or not self.mono:
            return time.time()
        return self.srv + max(0.0, time.monotonic() - self.mono)

    def state(self):
        return {
            'srv_ts': self.srv,
            'mono_at': self.mono,
            'clock_tampered': self.tampered,
        }


# ===========================================================================
# 4. HTTP
# ===========================================================================

class NetError(Exception):
    """Loi mang / server khong tra loi."""


class DenyError(Exception):
    """Server tu choi co ma ly do."""

    def __init__(self, code, msg):
        Exception.__init__(self, msg or code)
        self.code = code
        self.msg = msg or code


def api_base():
    v = xa_sec.C(xa_sec.K_API_BASE) or 'https://xienhl.com'
    return v.rstrip('/')


def _post(path, body, timeout=HTTP_TIMEOUT):
    url = api_base() + path
    data = json.dumps(body, separators=(',', ':')).encode('utf-8')
    req = urllib.request.Request(url, data=data, method='POST')
    req.add_header('Content-Type', 'application/json')
    req.add_header('User-Agent', xa_sec.C(xa_sec.K_UA) or 'XArenaGrant/1.0.0')
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read(65536)
    except urllib.error.HTTPError as e:
        try:
            raw = e.read(65536)
        except Exception:
            raise NetError('http_%d' % e.code)
        try:
            v = json.loads(raw.decode('utf-8'))
        except Exception:
            raise NetError('http_%d' % e.code)
        if isinstance(v, dict) and v.get('ok') is False:
            raise DenyError(v.get('code') or 'deny', v.get('msg') or '')
        raise NetError('http_%d' % e.code)
    except (urllib.error.URLError, OSError, TimeoutError) as e:
        raise NetError(str(e))
    try:
        v = json.loads(raw.decode('utf-8'))
    except Exception:
        raise NetError('bad_json')
    if not isinstance(v, dict):
        raise NetError('bad_json')
    if not v.get('ok'):
        raise DenyError(v.get('code') or 'deny', v.get('msg') or '')
    return v


# ===========================================================================
# 5. DIEU KIEN CHAY: ADMIN + CMD
# ===========================================================================

def is_admin():
    try:
        import ctypes
        return bool(ctypes.windll.shell32.IsUserAnAdmin())
    except Exception:
        return False


def require_admin():
    """Tu xin quyen admin qua UAC. Tra True neu da co."""
    if is_admin():
        return True
    if os.name != 'nt':
        return False
    try:
        import ctypes
        params = ' '.join(
            ('"%s"' % a) if (' ' in a or '\t' in a) else a
            for a in sys.argv[1:])
        rc = ctypes.windll.shell32.ShellExecuteW(
            None, 'runas', sys.executable, params, None, 1)
        if rc > 32:
            print('  Da gui yeu cau quyen Administrator.')
            print('  Bam "Yes" o hop thoai UAC de tiep tuc.')
            return False
    except Exception:
        pass
    print('  KHONG CO QUYEN ADMINISTRATOR.')
    print('  Chuot phai Command Prompt -> Run as administrator.')
    return False


def cmd_line_of(pid):
    """Doc command line cua process qua WMI-free: dung PEB khong dang tin,
    nen doc tu GetCommandLineW cua LIEN QUAN. Don gian nhat: kiem tra ten
    process cha + co man hinh console hay khong."""
    try:
        import ctypes
        k32 = ctypes.WinDLL('kernel32', use_last_error=True)
        # GetConsoleWindow: co console thi tra != 0
        k32.GetConsoleWindow.restype = ctypes.c_void_p
        return k32.GetConsoleWindow()
    except Exception:
        return None


_SHELLS = frozenset((
    'cmd.exe', 'powershell.exe', 'pwsh.exe', 'conhost.exe',
    'windowsterminal.exe', 'wt.exe', 'openconsole.exe',
    'bash.exe', 'wsl.exe', 'mintty.exe', 'wezterm-gui.exe',
    'alacritty.exe', 'conemu64.exe', 'conemu.exe',
))

# Chi nhung tien trinh nay moi bi coi la "mo bang cach bam dup / shortcut".
_BLOCKED = frozenset(('explorer.exe', 'userinit.exe', 'winlogon.exe'))


def _parent_name():
    """Ten file EXE cua tien trinh cha. '' neu khong doc duoc."""
    try:
        import ctypes
        import ctypes.wintypes as wt
        k32 = ctypes.WinDLL('kernel32', use_last_error=True)

        class PE32(ctypes.Structure):
            _fields_ = [
                ('dwSize', wt.DWORD), ('cntUsage', wt.DWORD),
                ('th32ProcessID', wt.DWORD),
                ('th32DefaultHeapID', ctypes.c_void_p),
                ('th32ModuleID', wt.DWORD), ('cntThreads', wt.DWORD),
                ('th32ParentProcessID', wt.DWORD),
                ('pcPriClassBase', ctypes.c_long), ('dwFlags', wt.DWORD),
                ('szExeFile', ctypes.c_char * 260),
            ]

        k32.CreateToolhelp32Snapshot.restype = wt.HANDLE
        k32.CreateToolhelp32Snapshot.argtypes = [wt.DWORD, wt.DWORD]
        k32.Process32First.argtypes = [wt.HANDLE, ctypes.c_void_p]
        k32.Process32Next.argtypes = [wt.HANDLE, ctypes.c_void_p]

        def scan(want_pid=None, want_ppid_of=None):
            """Tra (ppid_cua_want_pid, ten_cua_want_pid)."""
            snap = k32.CreateToolhelp32Snapshot(0x2, 0)
            if not snap or snap == ctypes.c_void_p(-1).value:
                return 0, ''
            ppid, name = 0, ''
            try:
                e = PE32()
                e.dwSize = ctypes.sizeof(PE32)
                if not k32.Process32First(snap, ctypes.byref(e)):
                    return 0, ''
                while True:
                    if want_ppid_of is not None and e.th32ProcessID == want_ppid_of:
                        ppid = e.th32ParentProcessID
                        break
                    if want_pid is not None and e.th32ProcessID == want_pid:
                        name = e.szExeFile.decode('latin1', 'replace')
                        break
                    if not k32.Process32Next(snap, ctypes.byref(e)):
                        break
            finally:
                k32.CloseHandle(snap)
            return ppid, name

        ppid, _ = scan(want_ppid_of=os.getpid())
        if not ppid:
            return ''
        _, nm = scan(want_pid=ppid)
        return nm.lower()
    except Exception:
        return ''


def launched_from_explorer():
    """True chi khi tien trinh duoc mo bang double-click hoac shortcut.

    Muc dich: buoc khach chay tool bang cua so CMD (dung yeu cau thiet ke).
    KHONG chan cmd / powershell / Windows Terminal / WSL, va KHONG chan khi
    khong xac dinh duoc tien trinh cha (tranh chan oan).

    Mot shortcut tro vao EXE se co tien trinh cha la explorer.exe -> bi chan.
    Mot shortcut mo cmd.exe /k xa.cmd thi cha la cmd.exe -> duoc phep, va do
    la cach cai dat dung.
    """
    name = _parent_name()
    if not name:
        return False                     # khong ro -> cho qua
    return name in _BLOCKED


# ===========================================================================
# 6. LICENSE
# ===========================================================================

class License(object):
    """Trang thai license dang dung trong bo nho."""

    # Token goc da ky (giu nguyen van de luu lai va xac minh lai khi nap)
    _token = ''

    def __init__(self):
        self.addr = None
        self.payload = None
        self.key = ''
        self.hwid = ''
        self.sid = ''
        self.ssec = ''
        self.expires_at = 0
        self.grace_h = 0
        self.check_after = 120
        self.clock = Clock()
        self.next_check = 0.0

    # -- nap tu state ----------------------------------------------------
    def load_local(self):
        st = load_state()
        if not st:
            return False
        tok = st.get('token') or ''
        if not tok:
            return False
        try:
            payload = xa_sec.parse_token(tok)
            self.addr = xa_sec.AddrTable(xa_sec.open_addr_table(payload))
        except xa_sec.TokenError:
            return False
        self._token = tok
        self.payload = payload
        self.key = payload.get('k') or ''
        self.hwid = payload.get('h') or ''
        self.sid = st.get('sid') or payload.get('s') or ''
        self.ssec = st.get('ssec') or ''
        self.expires_at = int(payload.get('e') or 0)
        self.grace_h = int(payload.get('g') or 0)
        self.check_after = int(payload.get('c') or 120)
        self.clock.restore(st)
        try:
            self.next_check = float(st.get('next_check') or 0)
        except (TypeError, ValueError):
            self.next_check = 0.0
        return True

    # -- luu -------------------------------------------------------------
    def _save(self):
        st = {
            'token': self._token,
            'sid': self.sid,
            'ssec': self.ssec,
            'gate': self.payload.get('gk') or '',
            'key': self.key,
            'hwid': self.hwid,
            'expires_at': self.expires_at,
            'grace_h': self.grace_h,
            'next_check': self.next_check,
            'saved_at': time.time(),
        }
        st.update(self.clock.state())
        return save_state(st)

    # -- ap token moi ----------------------------------------------------
    def apply(self, r, token_attr='token'):
        tok = r.get(token_attr) or ''
        if not tok:
            raise DenyError('no_token', 'server khong tra token')
        # Bat buoc: chu ky phai dung TRUOC khi dung bat cu truong nao
        payload = xa_sec.parse_token(tok)
        addr = xa_sec.AddrTable(xa_sec.open_addr_table(payload))

        # Token phai dung la license + may nay
        if payload.get('a') != APP:
            raise DenyError('wrong_app', 'token khong danh cho XAGrant')
        if self.key and payload.get('k') != self.key:
            raise DenyError('key_mismatch', 'token khong khop ma')
        if self.hwid and payload.get('h') != self.hwid:
            raise DenyError('hwid_mismatch', 'token khong khop may')

        self.payload = payload
        self.addr = addr
        self._token = tok
        self.key = payload.get('k') or self.key
        self.sid = r.get('sid') or payload.get('s') or ''
        self.ssec = r.get('ssec') or ''
        self.expires_at = int(payload.get('e') or 0)
        self.grace_h = int(payload.get('g') or 0)
        self.check_after = int(payload.get('c') or 120)
        self.clock.anchor(r.get('now') or payload.get('n'))
        self.next_check = time.monotonic() + max(30, self.check_after)
        self._save()

    # -- kiem han --------------------------------------------------------
    def secs_left(self):
        if self.expires_at <= 0:
            return None                      # vinh vien
        return self.expires_at - self.clock.now()

    def expired(self):
        s = self.secs_left()
        return s is not None and s <= 0

    # -- goi server ------------------------------------------------------
    def activate(self, key, token=None):
        self.key = norm_key(key)
        self.hwid = compute_hwid()
        body = {
            'key': self.key, 'hwid': self.hwid, 'app': APP,
            'ver': VERSION, 'fp': fingerprint(),
        }
        if token:
            body['token'] = token
        r = _post('/api/xg/activate', body)
        self.apply(r)
        return r

    def check(self):
        r = _post('/api/xg/check', {
            'key': self.key, 'hwid': self.hwid, 'sid': self.sid,
            'app': APP, 'ver': VERSION, 'fp': fingerprint(),
        })
        self.apply(r)
        return r

    def heartbeat(self):
        r = _post('/api/xg/heartbeat', {
            'key': self.key, 'hwid': self.hwid, 'sid': self.sid,
            'app': APP, 'ver': VERSION,
        })
        self.clock.anchor(r.get('now'))
        self._save()
        return r

    def report_violation(self, code):
        try:
            _post('/api/xg/violation', {
                'key': self.key, 'hwid': self.hwid, 'sid': self.sid,
                'code': code,
            }, timeout=6)
        except Exception:
            pass

    def rebind(self, key, token):
        self.key = key
        self.hwid = compute_hwid()
        r = _post('/api/xg/rebind', {
            'key': key, 'hwid': self.hwid, 'token': token, 'app': APP,
        })
        return r
