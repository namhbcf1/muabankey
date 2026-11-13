# -*- coding: utf-8 -*-
"""xa_grant_guard.py -- Lop chong dich nguoc / chay sai moi truong.

MUC TIEU THUC TE (khong hua qua):
    Chan duoc phan lon kich ban pho bien:
      * Chay duoi debugger (x64dbg, OllyDbg, gdb, PyCharm debug...)
      * Chay trong may ao / sandbox phan tich
      * Sua bytecode / patch file EXE
      * Chep token.txt sang may khac
    KHONG chan duoc nguoi rat quyet tam: ho so huu file .exe va co the
    dich nguoc. Khong co ky thuat nao tren may khach chan 100% duoc.

TRIET LY THIET KE
    Moi kiem tra deu FAIL-OPEN (khong chan khach) tru KHI ro rang la dang
    bi phan tich. Ly do: bao nham tren may co phan mem diet virus con te
    hon la de mot vai nguoi vuot. Chi nhung dau hieu CHAC CHAN moi tinh.
"""

import ctypes
import ctypes.wintypes as wt
import hashlib
import os
import sys

# ---------------------------------------------------------------------------
# Ket qua kiem tra
# ---------------------------------------------------------------------------

OK = 'ok'
DEBUGGER = 'debugger'
VM = 'vm'
TAMPERED = 'tampered'

# Ma gui len server (khop cot xg_events.detail / xg_viol.code)
CODES = {
    DEBUGGER: 'debugger_detected',
    VM: 'vm_detected',
    TAMPERED: 'binary_tampered',
}

# ---------------------------------------------------------------------------
# 1. Debugger
# ---------------------------------------------------------------------------

def _is_debugger_present():
    """True neu co debugger dang attach tien trinh nay.

    Dung 3 API doc lap de giam false negative:
      * IsDebuggerPresent          -- co ban nhat, hook de vo hieu
      * CheckRemoteDebuggerPresent -- bat ca truong hop debug tu xa
      * PEB.BeingDebugged          -- doc truc tiep, khac duong goi API
    """
    try:
        k32 = ctypes.WinDLL('kernel32', use_last_error=True)
    except Exception:
        return False

    try:
        k32.IsDebuggerPresent.restype = wt.BOOL
        if k32.IsDebuggerPresent():
            return True
    except Exception:
        pass

    try:
        k32.CheckRemoteDebuggerPresent.argtypes = [wt.HANDLE,
                                                   ctypes.POINTER(wt.BOOL)]
        k32.CheckRemoteDebuggerPresent.restype = wt.BOOL
        present = wt.BOOL(False)
        if k32.CheckRemoteDebuggerPresent(
                k32.GetCurrentProcess(), ctypes.byref(present)) and present.value:
            return True
    except Exception:
        pass

    # Duong thu ba: doc PEB.BeingDebugged qua NtQueryInformationProcess.
    # Khac hai API tren o cho khong goi ham "IsDebuggerPresent" (nguoi hook
    # ham do se vo hieu duoc no, nhung khong vo hieu duong nay).
    try:
        ntdll = ctypes.WinDLL('ntdll', use_last_error=True)
        k32 = ctypes.WinDLL('kernel32', use_last_error=True)
        # ProcessBasicInformation = 0 -> tra PEB base o truong dau
        class _PBI(ctypes.Structure):
            _fields_ = [
                ('ExitStatus', ctypes.c_long),
                ('PebBaseAddress', ctypes.c_void_p),
                ('AffinityMask', ctypes.c_void_p),
                ('BasePriority', ctypes.c_long),
                ('UniqueProcessId', ctypes.c_void_p),
                ('InheritedFromUniqueProcessId', ctypes.c_void_p),
            ]
        ntdll.NtQueryInformationProcess.argtypes = [
            wt.HANDLE, wt.ULONG, ctypes.c_void_p, wt.ULONG,
            ctypes.POINTER(wt.ULONG)]
        ntdll.NtQueryInformationProcess.restype = ctypes.c_long
        pbi = _PBI()
        ret_len = wt.ULONG(0)
        st = ntdll.NtQueryInformationProcess(
            k32.GetCurrentProcess(), 0, ctypes.byref(pbi),
            ctypes.sizeof(pbi), ctypes.byref(ret_len))
        if st == 0 and pbi.PebBaseAddress:
            at = ctypes.cast(ctypes.c_void_p(pbi.PebBaseAddress + 2),
                             ctypes.POINTER(ctypes.c_ubyte))
            if at[0]:
                return True
    except Exception:
        pass

    return False


# ---------------------------------------------------------------------------
# 2. May ao / sandbox phan tich
# ---------------------------------------------------------------------------

# Dau hieu CHAC CHAN cua may ao phan tich. Chi liet ke thu khong the
# trung voi may that cua khach.
_VM_MARKS = (
    # (loai, gia tri)
    ('file', r'C:\Windows\System32\drivers\VBoxMouse.sys'),
    ('file', r'C:\Windows\System32\drivers\vmhgfs.sys'),
    ('file', r'C:\Windows\System32\drivers\vmmouse.sys'),
    ('file', r'C:\Windows\System32\drivers\vmrawdsk.sys'),
    ('file', r'C:\Windows\System32\drivers\VBoxGuest.sys'),
    ('reg',  r'SYSTEM\CurrentControlSet\Services\VBoxGuest'),
    ('reg',  r'SYSTEM\CurrentControlSet\Services\vmci'),
)

# BIOS/CPU chua ten hypervisor. Day la dau hieu manh nhat va KHONG bao nham
# tren may that (khong hang may that nao dat ten nhu vay).
_VM_CPU_TOKENS = ('virtualbox', 'vmware', 'qemu', 'virtual cpu',
                  'xen', 'kvm', 'hyper-v')


def _vm_signals():
    """Tra danh sach dau hieu may ao tim thay. Rong = may that."""
    found = []

    for kind, path in _VM_MARKS:
        try:
            if kind == 'file' and os.path.exists(path):
                found.append('file:' + os.path.basename(path))
            elif kind == 'reg':
                import winreg
                try:
                    k = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, path)
                    winreg.CloseKey(k)
                    found.append('reg:' + path.split('\\')[-1])
                except Exception:
                    pass
        except Exception:
            pass

    # CPU brand: doc tu registry (khong can admin, khong goi wmic)
    try:
        import winreg
        k = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE,
                           r'HARDWARE\DESCRIPTION\System\CentralProcessor\0')
        name, _ = winreg.QueryValueEx(k, 'ProcessorNameString')
        winreg.CloseKey(k)
        low = str(name).lower()
        for tok in _VM_CPU_TOKENS:
            if tok in low:
                found.append('cpu:' + tok)
                break
    except Exception:
        pass

    # BIOS nha san xuat
    try:
        import winreg
        k = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE,
                           r'HARDWARE\DESCRIPTION\System\BIOS')
        for field, label in (('SystemManufacturer', 'sysman'),
                             ('BIOSVendor', 'biosvendor')):
            try:
                v, _ = winreg.QueryValueEx(k, field)
                low = str(v).lower()
                for tok in ('vmware', 'virtualbox', 'innotek', 'qemu',
                            'xen', 'bochs', 'parallels'):
                    if tok in low:
                        found.append('bios:' + label + ':' + tok)
                        break
            except Exception:
                pass
        winreg.CloseKey(k)
    except Exception:
        pass

    return found


# ---------------------------------------------------------------------------
# 3. Toan ven ban than file thuc thi
# ---------------------------------------------------------------------------

_SELF_CACHE = {}


def _self_sha256():
    """SHA-256 cua chinh file .exe/.py dang chay."""
    key = 'v'
    if key in _SELF_CACHE:
        return _SELF_CACHE[key]
    paths = []
    # Nuitka onefile: sys.executable la file .exe that
    exe = getattr(sys, 'executable', '') or ''
    if exe:
        paths.append(exe)
    if getattr(sys, '__compiled__', False) is False:
        # Chay .py truc tiep -> bam file nguon
        src = globals().get('__file__')
        if src:
            paths.append(os.path.abspath(src))
    for p in paths:
        try:
            h = hashlib.sha256()
            with open(p, 'rb') as f:
                while True:
                    b = f.read(1024 * 1024)
                    if not b:
                        break
                    h.update(b)
            _SELF_CACHE[key] = h.hexdigest()
            return _SELF_CACHE[key]
        except Exception:
            continue
    _SELF_CACHE[key] = ''
    return ''


def self_fingerprint():
    """Van tay cua ban build dang chay.

    Dung de server doi chieu: moi ban phat hanh co mot van tay rieng.
    Nguoi sua bytecode de bo kiem tra se lam doi van tay -> server biet.

    LUU Y: day la SHA-256 cua CHINH file, nen no thay doi moi lan build.
    Server so voi gia tri da dang ky (XG_BUILD_FP), khong phai hardcode
    trong client (hardcode trong client thi sua client la qua).
    """
    return _self_sha256()


# ---------------------------------------------------------------------------
# 4. Kiem tra tong hop
# ---------------------------------------------------------------------------

def scan(verbose=False):
    """Chay toan bo kiem tra. Tra dict:
        {'ok': bool, 'code': str|'', 'detail': str, 'signals': [..]}

    Thu tu: debugger -> VM. Khong kiem integrity o day (can tham so rieng,
    xem verify_integrity).
    """
    signals = []

    if _is_debugger_present():
        if verbose:
            print('  [!] phat hien debugger')
        return {'ok': False, 'code': CODES[DEBUGGER],
                'detail': 'debugger attached', 'signals': ['debugger']}

    vm = _vm_signals()
    if vm:
        signals.extend(vm)
        if verbose:
            print('  [!] phat hien may ao: %s' % ', '.join(vm[:3]))
        return {'ok': False, 'code': CODES[VM],
                'detail': ','.join(vm[:4]), 'signals': signals}

    return {'ok': True, 'code': '', 'detail': '', 'signals': []}


def verify_integrity(expected_fp):
    """So van tay ban build hien tai voi gia tri server ky.

    Tra (ok: bool, actual_fp: str).

    expected_fp rong = bo qua (chua cau hinh).
    """
    actual = self_fingerprint()
    if not expected_fp:
        return True, actual
    if not actual:
        # Khong doc duoc file -> khong ket luan, khong chan oan
        return True, ''
    return (actual.lower() == str(expected_fp).lower()), actual
