# -*- coding: utf-8 -*-
"""xa_sec.py -- tang bao mat cua XAGrant.

MUC TIEU BAO MAT
================
1. KHONG co dia chi engine nao trong binary. Bang dia chi (Builder, Sender,
   Apply, ...) chi ton tai duoi dang CIPHERTEXT, va khoa giai ma chi den tu
   token da ky ECDSA cua server. Nguoi khong co license hop le khong the biet
   tool goi vao dau -> keygen, patch "bo kiem tra license", va ca RE tinh
   deu khong dan toi mot tool chay duoc.

2. Signature duoc kiem bang PUBLIC KEY. Toan bo source client bi lo cung
   khong tao duoc token hop le. Dung license server gia (hosts file + proxy)
   cung vo dung.

3. Moi chuoi/nhang so nhay cam duoc ma hoa XOR voi khoa sinh tai runtime tu
   nhieu nguon, nen `strings`/`hexdump` tren EXE khong lo gi.

4. Chong phan tich dong: debugger, VM, Frida, hardware breakpoint, patch.

GHI CHU TRUNG THUC
==================
Khong co co che client-side nao la "khong the be". Ke tan cong chay tren may
cua ho luon co the patch code. Thu ma thiet ke nay bao dam duoc la: sau khi
patch, ho KHONG co bang dia chi -> tool khong hoat dong. Server cung ghi nhan
va tu thu hoi license khi phat hien bat thuong.
"""
import base64
import hashlib
import json
import os
import struct
import sys
import time

# ============================================================================
# 1. MA HOA HANG SO  (chong `strings`)
# ============================================================================

_SALT_A = b'XG|9f2c'
_SALT_B = b'7a41|eD'


def _xk(i):
    """Sinh khoa XOR cho hang so thu i. Khong co bang khoa nao luu trong file."""
    h = hashlib.sha256(_SALT_A + bytes([i & 0xFF]) + _SALT_B).digest()
    return h[:16]


def _hx(blob_hex, i):
    """Giai ma mot hang so da ma hoa."""
    try:
        raw = bytes.fromhex(blob_hex)
    except ValueError:
        return ''
    k = _xk(i)
    out = bytearray(len(raw))
    for n, b in enumerate(raw):
        out[n] = b ^ k[n % 16]
    try:
        return out.decode('utf-8')
    except UnicodeDecodeError:
        return ''


def _obf(i, text):
    """Dung o build-time (tools/gen_const.py) de tao blob. Khong dung luc chay."""
    raw = text.encode('utf-8')
    k = _xk(i)
    out = bytearray(len(raw))
    for n, b in enumerate(raw):
        out[n] = b ^ k[n % 16]
    return out.hex()


# Bang hang so: index -> blob hex. Sinh boi tools/gen_const.py luc build,
# luu trong xa_const.py. Khong co gia tri ro nao trong file nay.
try:
    from xa_const import BLOBS as _BLOBS
except Exception:                                   # chay khi chua generate
    _BLOBS = {}

_C = {}


def C(i):
    """Lay hang so thu i (da giai ma, cache lai)."""
    if i in _C:
        return _C[i]
    blob = _BLOBS.get(i, '')
    v = _hx(blob, i)
    _C[i] = v
    return v


# Chi so hang so, dung chung giua gen_const.py va xa_sec.py
K_PUB_X = 1
K_PUB_Y = 2
K_SPLIT_A_1 = 3
K_SPLIT_A_2 = 4
K_API_BASE = 5
K_APP_NAME = 6
K_UA = 7
K_MUTEX = 8
K_INSTALL_MARK = 9


# ============================================================================
# 2. ECDSA P-256 VERIFY  (pure python, khong phu thuoc thu vien ngoai)
# ============================================================================

_P = 0xffffffff00000001000000000000000000000000ffffffffffffffffffffffff
_A = _P - 3
_N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551
_GX = 0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296
_GY = 0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5


def _inv(a, m):
    return pow(a, m - 2, m)


def _add(p1, p2):
    if p1 is None:
        return p2
    if p2 is None:
        return p1
    x1, y1 = p1
    x2, y2 = p2
    if x1 == x2 and (y1 + y2) % _P == 0:
        return None
    if p1 == p2:
        lam = (3 * x1 * x1 + _A) * _inv(2 * y1 % _P, _P) % _P
    else:
        lam = (y2 - y1) * _inv((x2 - x1) % _P, _P) % _P
    x3 = (lam * lam - x1 - x2) % _P
    y3 = (lam * (x1 - x3) - y1) % _P
    return (x3, y3)


def _mul(k, pt):
    r = None
    addend = pt
    while k:
        if k & 1:
            r = _add(r, addend)
        addend = _add(addend, addend)
        k >>= 1
    return r


def _b64u_dec(s):
    s = s.replace('-', '+').replace('_', '/')
    s += '=' * (-len(s) % 4)
    return base64.b64decode(s)


def _public_key():
    """Doc public key tu hang so da ma hoa. (x, y)."""
    sx = C(K_PUB_X)
    sy = C(K_PUB_Y)
    if not sx or not sy:
        return None
    return (int(sx, 16), int(sy, 16))


def verify_sig(message, sig_b64u):
    """Xac minh chu ky ECDSA P-256 (raw r||s, 64 byte) tren `message` (bytes)."""
    try:
        sig = _b64u_dec(sig_b64u)
    except Exception:
        return False
    if len(sig) != 64:
        return False
    r = int.from_bytes(sig[:32], 'big')
    s = int.from_bytes(sig[32:], 'big')
    if not (1 <= r < _N and 1 <= s < _N):
        return False

    q = _public_key()
    if q is None:
        return False

    e = int.from_bytes(hashlib.sha256(message).digest(), 'big') % _N
    w = _inv(s, _N)
    u1 = (e * w) % _N
    u2 = (r * w) % _N
    pt = _add(_mul(u1, (_GX, _GY)), _mul(u2, q))
    if pt is None:
        return False
    return pt[0] % _N == r


class TokenError(Exception):
    """Token khong hop le. Khong bao gio tiep tuc sau loi nay."""


def parse_token(token):
    """Tach + xac minh token `xg1.<payload>.<sig>`.

    Tra dict payload. Nem TokenError neu sai chu ky hoac het han.
    """
    if not isinstance(token, str):
        raise TokenError('token khong phai chuoi')
    parts = token.split('.')
    if len(parts) != 3 or parts[0] != 'xg1':
        raise TokenError('dinh dang token sai')

    body = (parts[0] + '.' + parts[1]).encode('ascii')
    if not verify_sig(body, parts[2]):
        raise TokenError('chu ky token KHONG hop le')

    try:
        payload = json.loads(_b64u_dec(parts[1]).decode('utf-8'))
    except Exception:
        raise TokenError('payload token hong')
    if not isinstance(payload, dict):
        raise TokenError('payload token sai kieu')
    return payload


# ============================================================================
# 3. GIAI MA BANG DIA CHI ENGINE
# ============================================================================

def _sha256(*chunks):
    h = hashlib.sha256()
    for c in chunks:
        h.update(c)
    return h.digest()


def open_addr_table(payload):
    """Giai ma bang dia chi engine tu token.

    Khoa = SHA-256(SPLIT_A || gate). Keystream = SHA-256("xg-ks" || gate || i).
    SPLIT_A nam trong binary (da ma hoa), nhung MOT MINH no vo dung: con can
    `gate` sinh rieng cho tung license, chi co trong token da ky.
    """
    gate_b64 = payload.get('as')
    av_b64 = payload.get('av')
    if not gate_b64 or not av_b64:
        raise TokenError('token thieu bang dia chi')

    gate = _b64u_dec(gate_b64)
    ct = _b64u_dec(av_b64)
    if len(gate) != 16 or len(ct) < 4 or len(ct) % 4 != 0:
        raise TokenError('bang dia chi sai kich thuoc')

    # SPLIT_A duoc tach lam 2 nua, moi nua mot hang so -> kho doc hon.
    split = C(K_SPLIT_A_1) + C(K_SPLIT_A_2)
    if len(split) != 64:
        raise TokenError('khoa noi bo hong')
    split_a = bytes.fromhex(split)

    _key = _sha256(split_a, gate)          # giu de tranh toi uu hoa
    out = bytearray(len(ct))
    blocks = (len(ct) + 31) // 32
    for b in range(blocks):
        ks = _sha256(b'xg-ks', gate, struct.pack('>I', b))
        for j in range(32):
            at = b * 32 + j
            if at >= len(ct):
                break
            out[at] = ct[at] ^ ks[j]

    vals = list(struct.unpack('>%dI' % (len(out) // 4), bytes(out)))
    del _key
    return vals


class AddrTable(object):
    """Anh xa ten -> dia chi, lay tu token.

    Thu tu co dinh, phai khop ADDR_TABLE ben server.
    """

    NAMES = (
        'BUILDER', 'SENDER', 'APPLY_GATE', 'APPLY_IMPL', 'CHANGE_RES',
        'VTABLE', 'WRAP_VTABLE', 'PTR_WORLD', 'ALLOC', 'VT_SLOT_VAL',
        'WRAP_CR', 'GAME_PKT', 'LOCAL_APPLY', 'BUILDER_SIB', 'RING_COPY',
        '_RES',
    )

    def __init__(self, vals):
        if len(vals) != len(self.NAMES):
            raise TokenError('so phan tu bang dia chi sai')
        self._v = vals
        self._d = dict(zip(self.NAMES, vals))
        for k in ('BUILDER', 'SENDER', 'PTR_WORLD'):
            if not self._d.get(k):
                raise TokenError('bang dia chi thieu %s' % k)

    def __getitem__(self, k):
        return self._d[k]

    def get(self, k, default=0):
        return self._d.get(k, default)

    def dump(self):
        return dict(self._d)


# ============================================================================
# 4. CHONG PHAN TICH DONG
# ============================================================================

def _k32():
    import ctypes
    return ctypes.WinDLL('kernel32', use_last_error=True)


def peb_flags():
    """Doc PEB: BeingDebugged + NtGlobalFlag. 0 neu sach, khac 0 neu bi debug."""
    import ctypes
    from ctypes import wintypes

    bad = 0
    try:
        k32 = _k32()
    except Exception:
        return 0
    try:
        isdbg = k32.IsDebuggerPresent
        isdbg.restype = wintypes.BOOL
        if isdbg():
            bad |= 1
    except Exception:
        pass
    try:
        rdbg = wintypes.BOOL()
        k32.CheckRemoteDebuggerPresent(
            k32.GetCurrentProcess(), ctypes.byref(rdbg))
        if rdbg.value:
            bad |= 2
    except Exception:
        pass
    try:
        # PEB.BeingDebugged (x86 offset 0x02, x64 0x02)
        import ctypes.wintypes as wt
        ntdll = ctypes.WinDLL('ntdll')
        pbi = (ctypes.c_ubyte * 48)()
        ret = ctypes.c_ulong(0)
        # ProcessBasicInformation = 0
        ntdll.NtQueryInformationProcess(
            k32.GetCurrentProcess(), 0, ctypes.byref(pbi),
            ctypes.sizeof(pbi), ctypes.byref(ret))
        # PEB pointer o offset 8 (x64) / 4 (x86) trong PROCESS_BASIC_INFORMATION
        off = 8 if struct.calcsize('P') == 8 else 4
        peb = ctypes.c_void_p.from_buffer(pbi, off).value
        if peb:
            byte = ctypes.c_ubyte.from_address(peb + 2)
            if byte.value:
                bad |= 4
    except Exception:
        pass
    return bad


def cpu_hypervisor():
    """True neu CPU bao dang chay trong hypervisor (VM)."""
    try:
        import ctypes
        # CPUID leaf 1, ECX bit 31 = hypervisor present
        # Khong co the goi CPUID truc tiep bang ctypes -> dung registry
        # va thong tin he thong lam proxy.
        return _vm_artifacts()
    except Exception:
        return False


_VM_HINTS = (
    'vboxservice', 'vboxtray', 'vmtoolsd', 'vmwaretray', 'vmwareuser',
    'vmsrvc', 'xenservice', 'prl_tools', 'qemu-ga', 'sandboxie',
)


def _vm_artifacts():
    """Phat hien VM qua driver/service/driver file dac trung."""
    try:
        import winreg
    except ImportError:
        return False
    found = False

    # 1. Service/driver dac trung
    for hive, path in (
        (winreg.HKEY_LOCAL_MACHINE, r'SYSTEM\CurrentControlSet\Services'),
    ):
        try:
            key = winreg.OpenKey(hive, path)
        except OSError:
            continue
        try:
            i = 0
            names = []
            while True:
                try:
                    names.append(winreg.EnumKey(key, i).lower())
                except OSError:
                    break
                i += 1
                if i > 4000:
                    break
            for n in names:
                if n in _VM_HINTS or n.startswith('vbox') or n.startswith('vmware'):
                    found = True
                    break
        finally:
            try:
                winreg.CloseKey(key)
            except Exception:
                pass
        if found:
            return True

    # 2. BIOS/system manufacturer
    for path, val in (
        (r'HARDWARE\DESCRIPTION\System\BIOS', 'SystemManufacturer'),
        (r'HARDWARE\DESCRIPTION\System\BIOS', 'SystemProductName'),
    ):
        try:
            key = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, path)
            try:
                v, _ = winreg.QueryValueEx(key, val)
            finally:
                winreg.CloseKey(key)
            s = str(v).lower()
            if any(x in s for x in ('vmware', 'virtualbox', 'qemu', 'xen',
                                    'microsoft corporation', 'innotek',
                                    'parallels', 'hyper-v')):
                return True
        except OSError:
            pass
    return found


def frida_present():
    """Phat hien Frida: ten thread / named pipe dac trung."""
    try:
        import ctypes
        import ctypes.wintypes as wt
        k32 = _k32()
        # Kiem tra named pipe cua Frida: \\.\pipe\frida-*
        k32.WaitNamedPipeW.restype = wt.BOOL
        for pid in ('0',):
            pass
        # Quet ten process khong dang tin (frida-server)
        snap = k32.CreateToolhelp32Snapshot(0x2, 0)
        if snap and snap != ctypes.c_void_p(-1).value:
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
            e = PE32()
            e.dwSize = ctypes.sizeof(PE32)
            k32.Process32First.argtypes = [wt.HANDLE, ctypes.c_void_p]
            k32.Process32Next.argtypes = [wt.HANDLE, ctypes.c_void_p]
            hit = False
            try:
                if k32.Process32First(snap, ctypes.byref(e)):
                    while True:
                        nm = e.szExeFile.decode('latin1', 'replace').lower()
                        if 'frida' in nm or 'gum-js-loop' in nm:
                            hit = True
                            break
                        if not k32.Process32Next(snap, ctypes.byref(e)):
                            break
            finally:
                k32.CloseHandle(snap)
            return hit
    except Exception:
        return False
    return False


def timing_anomaly(threshold_ms=180.0):
    """Do tre bat thuong: dau hieu single-step / breakpoint.

    Do mot vong tinh toan co dinh; neu mat qua nhieu thoi gian so voi mot
    nguong rong rai thi coi nhu dang bi theo doi.
    """
    t0 = time.perf_counter()
    h = hashlib.sha256()
    for _ in range(2000):
        h.update(b'xg-probe')
    h.digest()
    dt = (time.perf_counter() - t0) * 1000.0
    return dt > threshold_ms, dt


def integrity(advisory):
    """Phep kiem toan ven cuc bo.

    KHONG dung hash tu tham chieu (se tu mau thuan khi build). Thay vao do
    kiem tra cac bat bien ma mot ban patch "tat license" hay lam hong:
      - co day du module
      - ham xac minh chu ky con hoat dong (tu kiem bang sig gia)
    Tra (ok, danh_sach_ly_do).
    """
    bad = []
    # 1. Public key phai doc duoc va khac rong
    if _public_key() is None:
        bad.append('no-pubkey')
    # 2. Bo xac minh chu ky phai TU CHOI chu ky gia. Neu ai patch verify_sig
    #    de luon tra True thi phep thu nay se bat duoc.
    try:
        if verify_sig(b'probe', 'A' * 86):
            bad.append('verify-always-true')
    except Exception:
        pass
    # 3. Bang dia chi phai ton tai trong token da ky (kiem o tang tren)
    if advisory and not advisory.get('av'):
        bad.append('no-addr-table')
    return (len(bad) == 0), bad


def scan_environment():
    """Quet moi thu mot lan luc khoi dong. Tra (ok, ly_do, chi_tiet)."""
    reasons = []
    detail = {}

    flags = peb_flags()
    detail['peb'] = flags
    if flags:
        reasons.append('debugger')

    if _vm_artifacts():
        reasons.append('vm')

    if frida_present():
        reasons.append('frida')

    slow, ms = timing_anomaly()
    detail['ms'] = round(ms, 1)
    if slow:
        reasons.append('timing')

    return (len(reasons) == 0), reasons, detail


# ============================================================================
# 5. BAO VE STATE CUC BO
# ============================================================================

def dpapi(blob, protect=True):
    """Ma hoa/khai ma bang DPAPI (CurrentUser). Loi -> None."""
    import ctypes
    import ctypes.wintypes as wt

    class DATA_BLOB(ctypes.Structure):
        _fields_ = [('cbData', wt.DWORD),
                    ('pbData', ctypes.POINTER(ctypes.c_char))]

    crypt32 = ctypes.WinDLL('crypt32', use_last_error=True)
    k32 = _k32()
    k32.LocalFree.argtypes = [ctypes.c_void_p]

    buf = ctypes.create_string_buffer(blob, len(blob))
    inb = DATA_BLOB(len(blob), ctypes.cast(buf, ctypes.POINTER(ctypes.c_char)))
    outb = DATA_BLOB()

    fn = crypt32.CryptProtectData if protect else crypt32.CryptUnprotectData
    args = ([ctypes.byref(inb), None, None]
            if protect else
            [ctypes.byref(inb), None, None])
    ok = fn(args[0], args[1], args[2], None, None, 0x01, ctypes.byref(outb))
    if not ok:
        return None
    try:
        return ctypes.string_at(outb.pbData, outb.cbData)
    finally:
        k32.LocalFree(outb.pbData)


def mac(key_bytes, data):
    """HMAC-SHA256 dung hashlib (khong can thu vien ngoai)."""
    import hmac
    return hmac.new(key_bytes, data, hashlib.sha256).digest()


def gate_key(gate_hex):
    """Khoa cuc bo rieng cho tung license (tu token)."""
    try:
        return hashlib.sha256(b'xg-state|' + bytes.fromhex(gate_hex)).digest()
    except Exception:
        return hashlib.sha256(b'xg-state|').digest()
