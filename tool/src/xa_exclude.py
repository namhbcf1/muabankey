#!/usr/bin/env python3
"""xa_exclude.py -- LOAI TAI NGUYEN KHOI CHECKSUM (patch ca hai may).

PHAT HIEN TUONG MINH
====================
Ham tinh checksum `0x41C270` chi co **3 lenh add** trong vong lap:

    0x41C2CC  03 C8     add ecx, eax     <- cong term 1
    0x41C2DA  03 D1     add edx, ecx     <- cong term 2
    0x41C2E5  03 CA     add ecx, edx     <- cong term 3

Va mot call tinh toan bo gia tri:

    0x41C2C1  call 0x45DDC0              <- lay gia tri tung player

`0x45DDC0` goi `0x45DDF0` khi [esi+0x20]==0. `0x45DDF0` cong don mang
float tai [esi+0x50] -- chinh la mang tai nguyen.

PATCH KHA THI
=============
NOP 3 lenh add trong 0x41C270:

    VA           goc      ->  va
    0x41C2CC     03 C8    ->  90 90      bo term 1
    0x41C2DA     03 D1    ->  90 90      bo term 2
    0x41C2E5     03 CA    ->  90 90      bo term 3

Ket qua: ca 3 sum = 0 -> checksum gui di = 0 tren MOI may.
Hai may cung patch -> khop -> khong MISMATCHED.

SO SANH VOI PATCH AGENT 2
=========================
Agent 2 de xuat NOP tai 0x45DE42/0x45DE72/0x45DE7D (trong 0x45DDF0).
Do la cach khac, cung y tuong. Patch o 0x41C2CC don gian hon va
bao gom ca 3 term.

DIEU KIEN
=========
CA HAI MAY phai cung patch. Day KHONG phai "chi mot may".

CAN KIEM
========
Sau khi patch, kiem tra:
  1. Game co crash khong? (checksum=0 co the lam engine chia 0 o dau do)
  2. Tran co chay khong?
  3. Tai nguyen ghi vao co bi phat hien khong?

CACH DUNG
=========
    python xa_exclude.py --apply     va 3 diem
    python xa_exclude.py --off       tra goc
    python xa_exclude.py --check     xem trang thai
"""
import ctypes
import ctypes.wintypes as wt
import sys

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

PROCESS_NAMES = ('EMPIRESX.EXE', 'EMPIRESX_HD.EXE', 'EMPIRESX_HDR.EXE')
PREFERRED_BASE = 0x400000

# (key, VA, byte goc, byte va, mo ta)
SITES = [
    ('T1', 0x41C2CC, '03c8', '9090', 'add ecx,eax -> bo'),
    ('T2', 0x41C2DA, '03d1', '9090', 'add edx,ecx -> bo'),
    ('T3', 0x41C2E5, '03ca', '9090', 'add ecx,edx -> bo'),
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
            print('  %-3s 0x%08X  da dung trang thai' % (key, va))
            continue
        if cur != other:
            print('  %-3s 0x%08X  *** byte la (co %s) -- bo qua' % (key, va, cur.hex()))
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
    if not check and not restore:
        print('LUU Y: CA HAI MAY phai cung patch.')
        print('Test: vao tran, ghi tai nguyen, xem co MISMATCHED khong.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
