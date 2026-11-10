#!/usr/bin/env python3
"""xa_sync.py -- patch cho phep mot may tang tai nguyen ma khong bi drop.

BAI TOAN
========
Engine Genie chay lockstep: S(n+1) = F(S(n), A(n)). Tai nguyen nam trong
CksumNew. Ghi RAM mot may -> CksumNew lech dung bang luong ghi (do duoc:
+50000 -> lech 50000) -> engine drop sau ~5 giay.

CACH TIEP CAN
=============
Khong the lam checksum khop (hash(x)==hash(y) voi x!=y la khong kha thi
realtime). Nhung co the:

  1. Khong gui checksum lech len mang  -> may kia khong phat hien
  2. Khong tu drop                      -> may minh khong out

Patch 1: 0x42A2D0 (quyet dinh out-of-sync, 0xC0 byte)
    -> xor eax,eax ; ret 8      luon tra 0 = "khong out of sync"

Patch 2: 0x429D00 (ham so khop + ghi C:\\aoesync.txt, 0x5C9 byte)
    -> xor eax,eax ; ret 0x24   khong ghi log, khong bao mismatch

GIOI HAN -- PHAI DOC
====================
- May kia VAN mo phong tai nguyen cua ban o muc binh thuong. Khi ban
  TIÊU nhieu hon thu nhap -> mo phong lech -> cot Position lech -> drop.
- Tuc la: tai nguyen nam im thi song; spam linh hang loat thi van chet.
- Patch nay KHONG lam qua anti-cheat dsound.dll (no kiem nguong san xuat
  cuc bo: 0.01 / 0.5 / 1.0).
- Chi dung khi CA HAI may deu chap nhan. Day la patch client-side.

CACH DUNG
=========
    python xa_sync.py --apply     # va 2 diem
    python xa_sync.py --off       # tra goc
    python xa_sync.py --check     # xem trang thai
"""
import ctypes
import ctypes.wintypes as wt
import sys

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

PROCESS_NAMES = ('EMPIRESX.EXE', 'EMPIRESX_HD.EXE', 'EMPIRESX_HDR.EXE')
PREFERRED_BASE = 0x400000

# (key, VA, byte goc, byte va, mo ta)
#
# CANH BAO KY THUAT -- da sua mot loi trong ban dau:
#
# Ham 0x42A2D0 co prologue:
#     0x42A2D0  83 EC 28      sub esp,0x28
#     0x42A2D3  53            push ebx
#     0x42A2D4  55            push ebp
#     0x42A2D7  56            push esi
#     0x42A2D8  57            push edi
# Epilogue:
#     0x42A386  5F            pop edi
#     0x42A387  5E            pop esi
#     0x42A388  5D            pop ebp
#     0x42A389  5B            pop ebx
#     0x42A38A  83 C4 28      add esp,0x28
#     0x42A38D  C2 08 00      ret 8
#
# Neu patch thanh `xor eax,eax; ret 8` ngay dau ham (9 byte) thi:
#   - khong co `sub esp,0x28`, khong co 4 push
#   - `ret 8` chi don 8 byte tham so
#   => stack LECH 0x28+0x10 = 56 byte moi lan goi -> CRASH
#
# Ban dau toi viet patch do va NO SAI. Sua lai:
#   chi doi `xor eax,eax` vao cho `mov edx,ecx` (khong dung den stack),
#   va doi nhanh re de luon di ra epilogue sach.
#
# Cach an toan nhat: doi 2 byte dau cua vong so sanh de luon "khop".
# Vong so sanh bat dau 0x42A30D:
#     0x42A30D  8B C7         mov eax,edi
#     0x42A30F  8B 74 24 3C   mov esi,[esp+0x3c]
#     0x42A313  39 70 F8      cmp [eax-8],esi
#     0x42A316  75 08         jne 0x42a320     <- thoat vong khi khac
#
# Doi `75 08` -> `EB 08` (luon nhay) KHONG dung: nhay den 0x42a320 la
# nhanh "khac", se tang bo dem.
#
# Dung nhat: doi `74 0B` tai 0x42A31E (je 0x42a32b = nhanh "khop")
# thanh `EB 0B` (luon nhay vao nhanh khop) -- nhung can ca 2 dieu kien
# o 0x42A313 va 0x42A31C deu phai khop.
#
# => KHONG CO PATCH 1-DIEM AN TOAN cho ham nay.
#    Phai hook hoac patch ca vong lap. Tam thoi VO HIEU HOA muc nay.
SITES = [
    # Chi giu LOG: 0x429D00 cung co van de tuong tu (prologue 0x20C + 2 push).
    # KHONG patch.
]

# Ghi chu: file nay GIU LAI de tham khao phan tich. Patch that su o
# xa_exclude.py va xa_b2b.py.

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
    base = mods[0]
    if not base:
        k32.CloseHandle(h)
        return None, None
    return h, base


def rd(h, a, n):
    buf = ctypes.create_string_buffer(n)
    g = ctypes.c_size_t(0)
    if not k32.ReadProcessMemory(h, ctypes.c_void_p(a), buf, n, ctypes.byref(g)):
        return b''
    return buf.raw[:g.value]


def write_at(h, addr, data):
    old = wt.DWORD()
    if not k32.VirtualProtectEx(h, ctypes.c_void_p(addr), len(data),
                                PAGE_EXECUTE_READWRITE, ctypes.byref(old)):
        return False
    ok = False
    try:
        w = ctypes.c_size_t(0)
        ok = bool(k32.WriteProcessMemory(h, ctypes.c_void_p(addr), data, len(data),
                                         ctypes.byref(w))) and w.value == len(data)
    finally:
        d = wt.DWORD()
        k32.VirtualProtectEx(h, ctypes.c_void_p(addr), len(data), old.value,
                             ctypes.byref(d))
    k32.FlushInstructionCache(h, ctypes.c_void_p(addr), len(data))
    return ok


def patch_one(h, base, site, restore):
    key, va, orig_s, pat_s, desc = site
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


def is_admin():
    try:
        import ctypes as c
        return bool(c.windll.shell32.IsUserAnAdmin())
    except Exception:
        return False


def main():
    args = sys.argv[1:]
    restore = '--off' in args
    check = '--check' in args

    if not args or '--help' in args or '-h' in args:
        print(__doc__)
        return 0

    if not is_admin():
        print('Can quyen Administrator. Chuot phai -> Run as administrator.')
        return 5

    procs = find_game()
    if not procs:
        print('Khong tim thay game. Mo EMPIRESX.EXE truoc.')
        return 1

    procs.sort(key=lambda p: 0 if p[1].lower() == 'empiresx.exe' else 99)
    pid, name = procs[0]
    h, base = attach(pid)
    if not h:
        print('Khong mo duoc pid %d' % pid)
        return 1

    print('%s pid %d base 0x%08X' % (name, pid, base))
    if base != PREFERRED_BASE:
        print('  base lech 0x%X, da bu tru' % (base - PREFERRED_BASE))

    ok_all = True
    for site in SITES:
        key, va, orig_s, pat_s, desc = site
        addr = base + (va - PREFERRED_BASE)
        cur = rd(h, addr, len(orig_s) // 2)
        orig = bytes.fromhex(orig_s)
        pat = bytes.fromhex(pat_s)
        if check:
            if cur == pat:
                st = 'DA VA'
            elif cur == orig:
                st = 'goc'
            else:
                st = 'KHAC (%s)' % cur.hex()
            print('  %-5s 0x%08X  %-14s %s' % (key, va, st, desc))
            continue
        r = patch_one(h, base, site, restore)
        print('  %-5s 0x%08X  %-10s %s' % (key, va, r, desc))
        if r not in ('ok', 'patched', 'restored'):
            ok_all = False

    k32.CloseHandle(h)
    if check:
        return 0
    print()
    print('Xong.' if ok_all else 'Co loi -- xem dong tren.')
    if not ok_all:
        return 1
    if restore:
        print('Da tra byte goc. Khoi dong lai game de chac chan.')
    else:
        print('Da va. LUU Y: khong spam linh hang loat -- may kia se thay')
        print('mo phong lech va drop. Tai nguyen nam im thi song.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
