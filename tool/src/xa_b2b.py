#!/usr/bin/env python3
"""xa_b2b.py -- B2b: loai tai nguyen khoi phan tinh gia tri (khac B2a).

KHAC BIET THEN CHOT VOI B2a
===========================
B2a:  NOP 3 lenh `add` TONG (0x41C2CC/DA/E5)
      -> ca 3 sum = 0 -> checksum = 0 -> GAME CHET

B2b:  NOP 3 lenh `add` trong ham LAY GIA TRI (0x45DDF0)
      -> sum van la so hop le, chi khong gom tai nguyen
      -> checksum khac 0 -> co the khong crash

BA DIEM PATCH
=============
  VA           goc           va                tac dung
  0x45DE42     03 D0        90 90              bo `add edx,eax` (tong mang float)
  0x45DE72     03 E8        90 90              bo `add ebp,eax` (term [esi+0x44])
  0x45DE7D     8D 1C 2A     89 D3 90           lea ebx,[edx+ebp] -> mov ebx,edx

Ham chua: 0x45DDF0 (verify bang descent tu entry, khong phai tu diem patch)

CACH DUNG
=========
    python xa_b2b.py --apply
    python xa_b2b.py --off
    python xa_b2b.py --check
"""
import ctypes
import ctypes.wintypes as wt
import sys

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

PROCESS_NAMES = ('EMPIRESX.EXE', 'EMPIRESX_HD.EXE', 'EMPIRESX_HDR.EXE')
PREFERRED_BASE = 0x400000

SITES = [
    ('D1', 0x45DE42, '03d0',   '9090',    'bo add edx,eax (mang float)'),
    ('D2', 0x45DE72, '03e8',   '9090',    'bo add ebp,eax ([esi+0x44])'),
    ('D3', 0x45DE7D, '8d1c2a', '89d390',  'lea -> mov (bo addend)'),
]

ACCESS = 0x0438
SYNC = 0x00100000
TH32CS_SNAPPROCESS = 0x2
PAGE_EXECUTE_READWRITE = 0x40
MAX_PATH = 260
INVALID_HANDLE_VALUE = ctypes.c_void_p(-1).value

k32 = ctypes.WinDLL('kernel32', use_last_error=True)
psapi = ctypes.WinDLL('psapi', use_last_error=True)
k32.OpenProcess.restype = wt.HANDLE
k32.OpenProcess.argtypes = [wt.DWORD, wt.BOOL, wt.DWORD]
k32.ReadProcessMemory.restype = wt.BOOL
k32.ReadProcessMemory.argtypes = [wt.HANDLE, wt.LPCVOID, wt.LPVOID,
                                  ctypes.c_size_t, ctypes.POINTER(ctypes.c_size_t)]
k32.WriteProcessMemory.restype = wt.BOOL
k32.WriteProcessMemory.argtypes = [wt.HANDLE, wt.LPVOID, ctypes.c_char_p,
                                   ctypes.c_size_t, ctypes.POINTER(ctypes.c_size_t)]
k32.VirtualProtectEx.restype = wt.BOOL
k32.VirtualProtectEx.argtypes = [wt.HANDLE, wt.LPVOID, ctypes.c_size_t,
                                 wt.DWORD, ctypes.POINTER(wt.DWORD)]
k32.FlushInstructionCache.restype = wt.BOOL
k32.FlushInstructionCache.argtypes = [wt.HANDLE, wt.LPCVOID, ctypes.c_size_t]
k32.CloseHandle.argtypes = [wt.HANDLE]
k32.CreateToolhelp32Snapshot.restype = wt.HANDLE
k32.CreateToolhelp32Snapshot.argtypes = [wt.DWORD, wt.DWORD]
k32.Process32First.restype = wt.BOOL
k32.Process32First.argtypes = [wt.HANDLE, ctypes.c_void_p]
k32.Process32Next.restype = wt.BOOL
k32.Process32Next.argtypes = [wt.HANDLE, ctypes.c_void_p]
psapi.EnumProcessModules.restype = wt.BOOL
psapi.EnumProcessModules.argtypes = [wt.HANDLE, ctypes.POINTER(wt.HMODULE),
                                     wt.DWORD, ctypes.POINTER(wt.DWORD)]


class PE32(ctypes.Structure):
    _fields_ = [('dwSize', wt.DWORD), ('cntUsage', wt.DWORD),
                ('th32ProcessID', wt.DWORD), ('th32DefaultHeapID', ctypes.c_void_p),
                ('th32ModuleID', wt.DWORD), ('cntThreads', wt.DWORD),
                ('th32ParentProcessID', wt.DWORD), ('pcPriClassBase', ctypes.c_long),
                ('dwFlags', wt.DWORD), ('szExeFile', ctypes.c_char * MAX_PATH)]


def is_admin():
    try:
        return bool(ctypes.windll.shell32.IsUserAnAdmin())
    except Exception:
        return False


def find_game():
    snap = k32.CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0)
    if snap in (None, 0, INVALID_HANDLE_VALUE):
        return []
    want = set(n.lower() for n in PROCESS_NAMES)
    out = []
    try:
        e = PE32()
        e.dwSize = ctypes.sizeof(PE32)
        if k32.Process32First(snap, ctypes.byref(e)):
            while True:
                nm = e.szExeFile.decode(errors='replace')
                if nm.lower() in want:
                    out.append((e.th32ProcessID, nm))
                if not k32.Process32Next(snap, ctypes.byref(e)):
                    break
    finally:
        k32.CloseHandle(snap)
    return out


def attach(pid):
    h = k32.OpenProcess(ACCESS | SYNC, False, pid)
    if not h:
        return None, None
    mods = (wt.HMODULE * 1024)()
    need = wt.DWORD()
    if not psapi.EnumProcessModules(h, mods, ctypes.sizeof(mods), ctypes.byref(need)):
        k32.CloseHandle(h)
        return None, None
    return h, mods[0]


def rd(h, a, n):
    buf = ctypes.create_string_buffer(n)
    g = ctypes.c_size_t(0)
    if not k32.ReadProcessMemory(h, ctypes.c_void_p(a), buf, n, ctypes.byref(g)):
        return b''
    return buf.raw[:g.value]


def wr(h, a, data):
    old = wt.DWORD()
    if not k32.VirtualProtectEx(h, ctypes.c_void_p(a), len(data),
                                PAGE_EXECUTE_READWRITE, ctypes.byref(old)):
        return False
    ok = False
    try:
        w = ctypes.c_size_t(0)
        ok = bool(k32.WriteProcessMemory(h, ctypes.c_void_p(a), data, len(data),
                                         ctypes.byref(w))) and w.value == len(data)
    finally:
        d = wt.DWORD()
        k32.VirtualProtectEx(h, ctypes.c_void_p(a), len(data), old.value,
                             ctypes.byref(d))
    k32.FlushInstructionCache(h, ctypes.c_void_p(a), len(data))
    return ok


def main():
    args = sys.argv[1:]
    if not args or '--help' in args or '-h' in args:
        print(__doc__)
        return 0
    restore = '--off' in args
    check = '--check' in args

    if not is_admin():
        print('CAN ADMIN.')
        return 5
    procs = find_game()
    if not procs:
        print('Khong thay game.')
        return 1
    pid = procs[0][0]
    h, base = attach(pid)
    if not h:
        print('Khong mo duoc pid %d' % pid)
        return 1
    delta = base - PREFERRED_BASE
    print('pid %d base 0x%08X' % (pid, base))

    ok_all = True
    for key, va, orig, pat, desc in SITES:
        a = va + delta
        cur = rd(h, a, len(orig) // 2)
        want = bytes.fromhex(orig if restore else pat)
        other = bytes.fromhex(pat if restore else orig)
        if check:
            st = 'DA VA' if cur == bytes.fromhex(pat) else (
                'goc' if cur == bytes.fromhex(orig) else 'KHAC ' + cur.hex())
            print('  %-3s 0x%08X  %-12s %s' % (key, va, st, desc))
            continue
        if cur == want:
            print('  %-3s 0x%08X  da dung' % (key, va))
            continue
        if cur != other:
            print('  %-3s 0x%08X  *** la (co %s) -- bo qua' % (key, va, cur.hex()))
            ok_all = False
            continue
        if wr(h, a, want):
            print('  %-3s 0x%08X  %s  %s'
                  % (key, va, 'tra goc' if restore else 'va', desc))
        else:
            print('  %-3s 0x%08X  GHI THAT BAI' % (key, va))
            ok_all = False
    k32.CloseHandle(h)
    print()
    print('Xong.' if ok_all else 'Co loi.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
