#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""xa_grant.exe -- XArena Grant: bom tai nguyen trong AoE XArena.

CHI CHAY BANG CMD. Khong co giao dien, khong co tai khoan, khong co app.

DUNG
----
    xa_grant.exe --key XAGR-XXXX-XXXX-XXXX     kich hoat license
    xa_grant.exe                               vao che do tuong tac
    xa_grant.exe --status                      xem trang thai license
    xa_grant.exe --rebind KEY TOKEN            doi may
    xa_grant.exe --deactivate                  xoa license tren may nay
    xa_grant.exe --selftest                    kiem tra noi bo (khong can game)

TRONG CHE DO TUONG TAC:

    who                    xem ban la ai trong tran
    check                  xem tai nguyen hien tai
    t 500  v 1000          +thit / +vang
    g 1000 d 200           +go / +da
    full 5000              +5000 ca bon loai
    quit                   thoat

CAN: Administrator + game dang chay + da vao tran that.

GHI CHU KY THUAT
----------------
Tool nay KHONG chua dia chi engine nao. Bang dia chi duoc server ky va ma
hoa theo tung license; chi giai ma duoc khi chu ky ECDSA P-256 hop le. Xem
xa_sec.py va xa_grant_lic.py.
"""
import ctypes
import ctypes.wintypes as wt
import os
import re
import struct
import sys
import time

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

_HERE = os.path.dirname(os.path.abspath(__file__))
for _p in (_HERE, os.path.join(_HERE, 'src')):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import xa_sec                                     # noqa: E402
import xa_grant_lic as XL                          # noqa: E402

# ----------------------------------------------------------------------------
# DIA CHI ENGINE -- KHONG con hang so nao trong file nay
#
# Truoc day cac dia chi (0x42BDE0, 0x54EE90, ...) nam thang o day. Nay chung
# chi ton tai duoi dang CIPHERTEXT trong token da ky ECDSA cua server, va chi
# duoc giai ma khi license hop le:
#
#     tok = /api/xg/activate  ->  payload.av (ciphertext) + payload.as (gate)
#     AddrTable(open_addr_table(payload))  ->  BUILDER, SENDER, ...
#
# Hau qua: go binary ra doc cung khong biet tool goi vao dau. Patch "bo kiem
# tra license" -> khong co bang dia chi -> tool khong lam gi duoc.
# ----------------------------------------------------------------------------
PREFERRED_BASE = 0x400000
DLLCHAR_OFF = 0x46                      # DllCharacteristics trong PE optional header

BUILDER        = 0
SENDER         = 0
APPLY_GATE     = 0
APPLY_IMPL     = 0
CHANGE_RES     = 0
VTABLE         = 0
WRAPPER_VTABLE = 0
PTR_WORLD      = 0
ALLOC_ADDR     = 0
VT_SLOT_VAL    = 0
WRAP_CR_VAL    = 0

OFF_CTX        = 0x3C                   # ctx = [[PTR_WORLD] + 0x3C]
OFF_PLAYERIDX  = 0x4A                   # int16 player index
OFF_SENDER     = 0x58                   # sender = [ctx + 0x58]
OFF_APPLY      = 0x14                   # apply = [sender + 0x14]
OFF_ONLINE     = 0x10E4                 # co online: [apply + 0x10E4]

# chuoi tai nguyen cua xa_measure.py (de validate da vao tran)
OFF_MANAGER, OFF_SLOTS, OFF_WRAPARRAY, OFF_PLAYER = 0x3F4, 0x3C, 0x40, 0x50
OFF_LOCAL_IDX  = 0x1590      # HANG SO 2 — KHONG phai local index (giu ten cu)
OFF_LOCAL_SLOT = 0x7C        # int16 [manager+0x7C] = LOCAL PLAYER SLOT INDEX
OFF_BITMASK    = 0xD8        # dword [wrapper+0xD8] = bitmask NHOM, KHONG phai 1<<slot
                             # do 2026-11-11: tran 9 slot -> slot1..4 = 0x1E, slot5..8 = 0x1E0
                             # Chi de hien thi tham khao. KHONG dung lam identity.
OFF_LOCAL_MARK = 0x788       # float: 1.0 chi o slot cua MAY NAY (do live)
# ---------------------------------------------------------------------------
# THU TU TAI NGUYEN TRONG playerdata -- DA DO, KHONG DOAN
#
# SUA 2026-11-11 01:40. Bang cu ghi F=0x00 W=0x04 S=0x08 G=0x0C -> SAI.
#
# Bang that, chung minh bang 2 phep do doc lap (HUD game vs RAM cung thoi diem):
#
#   tran A (6 slot): HUD  thit 250 | go 450 | vang 450 | da 200
#                    RAM  +04=250 | +00=450 | +0C=450  | +08=200
#   tran B (9 slot): HUD  thit 995654 | go 994030 | vang 99444 | da 150
#                    RAM  +04=995691 | +00=994030 | +0C=99444 | +08=150
#
#   -> 8/8 khop. HUD lay tu anh chup that (_h2_0.png, _n1_0.png), doc icon
#      de xac dinh vi tri: icon1=thit(be/kem) icon2=go(nau do)
#      icon3=vang(金) icon4=da(xam).
#
# Khop voi phan tich tinh: HUD panel 0x432B23..0x432C0C gan
#   +0x04 -> widget 0x628 (X=440, trai nhat)   = Food
#   +0x00 -> widget 0x620 (X=480)              = Wood
#   +0x0C -> widget 0x624 (X=520)              = Gold
#   +0x08 -> widget 0x62c (X=560)              = Stone
# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# OFFSET TAI NGUYEN TRONG PLAYERDATA
#
# SUA 2026-11-11 03:10. Ban cu bi DOI CHO F va W:
#     CU (SAI): {'F': 0x04, 'W': 0x00, ...}
#     DUNG    : {'F': 0x00, 'W': 0x04, ...}
#
# Chung minh tu log that:
#   Lenh "go 100000" -> [result] "thit tai +0x04: 20 -> 100020"
#     => go nam o 0x04, va 20 -> 100020 la DUNG.
#     Nhung nhan hien thi ghi "thit" vi RES_NAME/api doc nham.
#   Lenh "go 100000" lan 2 -> [result] "go tai +0x00: 0 -> 0"
#     => doc 0x00 (thit, dang 0) chu khong phai go.
#
# Va xac nhan tu HUD: slot 6 co 100020 thit / 0 go / 100000 vang.
#   File log ghi "thit +0x04: 20->100020" nhung thuc te la GO.
#   Nghia la 0x04 = GO, khong phai THIT.
# ---------------------------------------------------------------------------
RES_OFF = {'F': 0x00, 'W': 0x04, 'S': 0x08, 'G': 0x0C}

# Chi so "slot tai nguyen" ghi vao record +2, dung cho 0x45DF10 -> array[slot].
# 0x45DF10 KHONG co bang hoan vi: no lay slot*4 cong thang vao cung mang
# playerdata+0x50. Vi vay slot phai la CHINH offset/4 cua bang tren.
#   0x45df20  mov 0x50(%ecx),%ecx     ; array = playerdata
#   0x45df2a  fadds (%ecx,%eax,4)     ; array[slot] += amount
# Engine slot (byte +2 trong record). Chung minh tu log that:
#   grant F 500 -> record "05 01 00 00 00 00 7A 44", +2 slot = 0 (food)
#   => FOOD = slot 0, khong phai wood.
# Ban cu ghi W=0, F=1 -> GOI SAI TAI NGUYEN khi grant.
RES_SLOT = {'F': 0, 'W': 1, 'S': 2, 'G': 3}
RES_NAME = {'F': 'food', 'W': 'wood', 'S': 'stone', 'G': 'gold'}

# Byte "nhan dang build" -- KHONG co signature co dinh trong file.
#
# Truoc day file nay chua 5 chuoi byte cua engine (56 6A 08 8B F1 6A 01 E8 ...)
# -> chi can mo EXE bang hex editor la biet chinh xac tool goi vao dau.
#
# Nay: chuoi byte duoc LAY TU TOKEN da ky (muc 's' trong khoi engine) va doi
# chieu voi bo nho tien trinh. Khong co license -> khong co ca chu ky lan
# dia chi.
VT_SLOT_OFF = 0x08
WRAP_CR_OFF = 0x78


class NoLicense(Exception):
    """Chua co license hop le. Khong duoc cham vao game."""


# Bang tri thuc engine, chi ton tai sau khi license duoc xac minh.
# (load_engine dinh nghia o duoi, sau require_license.)
ADDR = None


PROCESS_NAMES = ('EMPIRESX.EXE', 'EMPIRESX_HD.EXE', 'EMPIRESX_HDR.EXE')
PROCESS_ALL_ACCESS = 0x1F0FFF
MEM_COMMIT, MEM_RESERVE, MEM_RELEASE, PAGE_EXECUTE_READWRITE = 0x1000, 0x2000, 0x8000, 0x40
TH32CS_SNAPPROCESS = 0x2
MAX_PATH = 260
INVALID_HANDLE_VALUE = ctypes.c_void_p(-1).value
WAIT_TIMEOUT = 0x102
INFINITE = 0xFFFFFFFF

k32 = ctypes.WinDLL('kernel32', use_last_error=True)
psapi = ctypes.WinDLL('psapi', use_last_error=True)

k32.OpenProcess.restype = wt.HANDLE
k32.OpenProcess.argtypes = [wt.DWORD, wt.BOOL, wt.DWORD]
k32.CloseHandle.argtypes = [wt.HANDLE]
k32.ReadProcessMemory.restype = wt.BOOL
k32.ReadProcessMemory.argtypes = [wt.HANDLE, wt.LPCVOID, wt.LPVOID,
                                  ctypes.c_size_t, ctypes.POINTER(ctypes.c_size_t)]
k32.WriteProcessMemory.restype = wt.BOOL
k32.WriteProcessMemory.argtypes = [wt.HANDLE, wt.LPVOID, ctypes.c_char_p,
                                   ctypes.c_size_t, ctypes.POINTER(ctypes.c_size_t)]
k32.VirtualAllocEx.restype = ctypes.c_void_p
k32.VirtualAllocEx.argtypes = [wt.HANDLE, ctypes.c_void_p, ctypes.c_size_t,
                               wt.DWORD, wt.DWORD]
k32.VirtualFreeEx.restype = wt.BOOL
k32.VirtualFreeEx.argtypes = [wt.HANDLE, ctypes.c_void_p, ctypes.c_size_t, wt.DWORD]
k32.CreateRemoteThread.restype = wt.HANDLE
k32.CreateRemoteThread.argtypes = [wt.HANDLE, ctypes.c_void_p, ctypes.c_size_t,
                                   ctypes.c_void_p, ctypes.c_void_p, wt.DWORD,
                                   ctypes.POINTER(wt.DWORD)]
k32.WaitForSingleObject.restype = wt.DWORD
k32.WaitForSingleObject.argtypes = [wt.HANDLE, wt.DWORD]
k32.FlushInstructionCache.restype = wt.BOOL
k32.FlushInstructionCache.argtypes = [wt.HANDLE, wt.LPCVOID, ctypes.c_size_t]
k32.GetExitCodeThread.restype = wt.BOOL
k32.GetExitCodeThread.argtypes = [wt.HANDLE, ctypes.POINTER(wt.DWORD)]
k32.CreateToolhelp32Snapshot.restype = wt.HANDLE
k32.CreateToolhelp32Snapshot.argtypes = [wt.DWORD, wt.DWORD]
k32.Process32First.restype = wt.BOOL
k32.Process32First.argtypes = [wt.HANDLE, ctypes.c_void_p]
k32.Process32Next.restype = wt.BOOL
k32.Process32Next.argtypes = [wt.HANDLE, ctypes.c_void_p]
psapi.EnumProcessModules.restype = wt.BOOL
psapi.EnumProcessModules.argtypes = [wt.HANDLE, ctypes.POINTER(wt.HMODULE),
                                     wt.DWORD, ctypes.POINTER(wt.DWORD)]

GATE_FLAG = '--accept-desync-risk'
LOG = []          # [(buoc, mo ta)]

# Mac dinh KHONG cho phep grant khi dang online: engine se gui packet 0x3E
# cho peer, nhung peer khong co buoc tuong ung -> lech checksum.
# Day la lua chon CUA NGUOI DUNG, phai bat bang co ro rang.
ALLOW_ONLINE = False


class PE32(ctypes.Structure):
    _fields_ = [('dwSize', wt.DWORD), ('cntUsage', wt.DWORD),
                ('th32ProcessID', wt.DWORD), ('th32DefaultHeapID', ctypes.c_void_p),
                ('th32ModuleID', wt.DWORD), ('cntThreads', wt.DWORD),
                ('th32ParentProcessID', wt.DWORD), ('pcPriClassBase', ctypes.c_long),
                ('dwFlags', wt.DWORD), ('szExeFile', ctypes.c_char * MAX_PATH)]


class GrantError(Exception):
    """Gate that chan lai. Khong bao gio goi engine khi loi nay duoc nem."""


# ----------------------------------------------------------------------------
def log(step, msg, va=None):
    line = ('[%s] ' % step) + msg
    if va is not None:
        line += '  <VA 0x%08X>' % va
    LOG.append(line)
    print(line)


# ----------------------------------------------------------------------------
# Phan THUAN (khong cham vao game) -- test duoc bang --selftest
# ----------------------------------------------------------------------------
def build_record(player, slot, amount):
    """8 byte record y het 0x42BDE0. Thuan tuy, khong I/O."""
    if not (0 <= player <= 0xFFFFFFFF):
        raise GrantError('player ngoai mien: %r' % (player,))
    if not (0 <= slot <= 0xFF):
        raise GrantError('slot ngoai mien byte: %r' % (slot,))
    f = float(amount)
    if f != f:
        raise GrantError('amount = NaN')
    if f in (float('inf'), float('-inf')):
        raise GrantError('amount = Inf')
    rec = bytearray(8)
    rec[0] = 0x05
    rec[1] = player & 0xFF
    rec[2] = slot & 0xFF
    rec[3] = 0x00
    rec[4:8] = struct.pack('<f', f)
    return bytes(rec)


def build_stub(this_ptr, player, slot, amount):
    """Stub 32-bit goi Builder_42BDE0 dung __thiscall.

        B9 <this>          mov  ecx, this
        68 <amount>        push amount        (arg3)
        68 <slot>          push slot          (arg2)
        68 <player>        push player        (arg1)
        B8 <builder>       mov  eax, 0x42BDE0
        FF D0              call eax
        C3                 ret
    """
    bits = struct.unpack('<I', struct.pack('<f', float(amount)))[0]
    code = bytearray()
    code += b'\xB9' + struct.pack('<I', this_ptr)
    code += b'\x68' + struct.pack('<I', bits)
    code += b'\x68' + struct.pack('<I', slot)
    code += b'\x68' + struct.pack('<I', player)
    code += b'\xB8' + struct.pack('<I', BUILDER)
    code += b'\xFF\xD0'
    code += b'\xC3'
    return bytes(code)


# ----------------------------------------------------------------------------
# Phan cham process
# ----------------------------------------------------------------------------
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
    out.sort(key=lambda p: 0 if p[1].lower() == 'empiresx.exe' else 99)
    return out


def open_game(pid):
    for acc, label in ((PROCESS_ALL_ACCESS, 'ALL_ACCESS'),
                       (0x0008 | 0x0010 | 0x0020 | 0x0400, 'RVM_READ|WRITE|OPER|QUERY')):
        h = k32.OpenProcess(acc, False, pid)
        if h:
            log('open', 'OpenProcess(%s) thanh cong' % label)
            return h
    raise GrantError('OpenProcess that bai (err=%d). Can Administrator.'
                     % ctypes.get_last_error())


def module_base(h):
    mods = (wt.HMODULE * 1024)()
    need = wt.DWORD()
    if not psapi.EnumProcessModules(h, mods, ctypes.sizeof(mods), ctypes.byref(need)):
        raise GrantError('EnumProcessModules that bai')
    return int(mods[0] or 0)


def is_wow64(h):
    """Process dich co phai 32-bit chay tren Windows 64-bit khong?

    QUAN TRONG: `build_stub` sinh ma may 32-bit
        push imm32 / mov eax,imm32 / call eax
    Nhung stub duoc chay trong process DICH. Neu dich la 64-bit (khong phai
    WOW64), cac lenh tren bi giai ma khac nghia -> thread chet ngay, exit code
    la loi truy cap, va khong co gi duoc ghi. Trieu chung dung nhu "tool chay
    nhung tai nguyen khong tang".
    """
    k32.IsWow64Process.restype = wt.BOOL
    k32.IsWow64Process.argtypes = [wt.HANDLE, ctypes.POINTER(wt.BOOL)]
    wow = wt.BOOL(0)
    if not k32.IsWow64Process(h, ctypes.byref(wow)):
        return None
    return bool(wow.value)


def require_target_is_32bit(h):
    """Tu choi neu process dich khong phai 32-bit. Goi truoc khi ghi stub."""
    wow = is_wow64(h)
    if wow is None:
        # Khong xac dinh duoc -> canh bao, khong chan (co the la Windows 32-bit
        # that, khi do moi process deu la "32-bit native").
        log('arch', 'CANH BAO: khong doc duoc IsWow64Process. Bo qua kiem tra.')
        return True
    if wow:
        log('arch', 'process dich la 32-bit (WOW64) -> stub 32-bit OK')
        return True

    # Khong phai WOW64: hoac Windows 32-bit that (hiem), hoac dich la 64-bit.
    if struct.calcsize('P') == 4:
        log('arch', 'Windows 32-bit native -> stub 32-bit OK')
        return True

    raise GrantError(
        'process game la 64-BIT nhung stub chi ho tro 32-bit.\n'
        '  Ma may duoc sinh (push imm32 / mov eax,imm32 / call eax) chi dung\n'
        '  trong process 32-bit. Chay tren process 64-bit se chet ngay va\n'
        '  KHONG ghi duoc tai nguyen nao.\n'
        '\n'
        '  Day rat co the la ly do "tool chay ma tai nguyen khong tang".\n'
        '  Can ban EMPIRESX.EXE 32-bit (ban AoE HD thuong la 32-bit) hoac\n'
        '  phai viet lai stub cho x64.')


def rd(h, va, n):
    buf = ctypes.create_string_buffer(n)
    got = ctypes.c_size_t(0)
    if not k32.ReadProcessMemory(h, ctypes.c_void_p(va), buf, n, ctypes.byref(got)):
        return None
    if got.value != n:
        return None
    return buf.raw[:n]


def u32(h, va):
    b = rd(h, va, 4)
    return None if b is None else struct.unpack('<I', b)[0]


def rd(h, va, n):
    """Doc n byte. Tra None neu khong doc duoc. KHONG BAO GIO crash."""
    try:
        if not h or not va or va < 0 or n <= 0:
            return None
        buf = ctypes.create_string_buffer(n)
        got = ctypes.c_size_t(0)
        ok = k32.ReadProcessMemory(h, ctypes.c_void_p(va), buf, n,
                                   ctypes.byref(got))
        if not ok or got.value == 0:
            return None
        return buf.raw[:got.value]
    except Exception:
        return None


def u32(h, va):
    """Doc dword. Tra None neu khong doc duoc. KHONG BAO GIO crash."""
    b = rd(h, va, 4)
    if not b or len(b) < 4:
        return None
    try:
        return struct.unpack('<I', b[:4])[0]
    except Exception:
        return None


def f32(h, va):
    """Doc float. Tra None neu khong doc duoc. KHONG BAO GIO crash."""
    b = rd(h, va, 4)
    if not b or len(b) < 4:
        return None
    try:
        v = struct.unpack('<f', b[:4])[0]
        # NaN / Inf -> coi nhu khong doc duoc
        if v != v or v in (float('inf'), float('-inf')):
            return None
        return v
    except Exception:
        return None


# Vi tri con tro ten hien thi trong wrapper nguoi choi.
OFF_NAME_PTR = 0x44

# Cac kha nang con tro ten (thu lan luot). Build khac nhau dat ten o offset
# khac nhau, nen do tim thay vi tin tuyet doi vao mot hang so.
_NAME_OFFS = (0x44, 0x40, 0x48, 0x4C, 0x38, 0x3C)


def _looks_like_name(raw):
    """Doan chuoi co phai ten nguoi choi khong."""
    if not raw:
        return ''
    s2 = raw.split(b'\x00')[0].decode('latin1', 'replace').strip()
    if not s2 or len(s2) < 2 or len(s2) > 24:
        return ''
    for c in s2:
        o = ord(c)
        if o < 32 or o >= 127:
            return ''
    if not any(c.isalpha() for c in s2):
        return ''
    # Loai chuoi vo nghia: toan ky tu la hoac giong duong dan
    if sum(1 for c in s2 if c.isalnum() or c in ' _-.') != len(s2):
        return ''
    if s2.count('\\') or s2.count('/') or s2.count(':'):
        return ''
    return s2


def read_name_of_wrapper(h, wrap):
    """Doc ten hien thi cua nguoi choi. '' neu khong tim thay.

    Truoc day ham nay dung `OFF_NAME_PTR` -- mot hang so CHUA BAO GIO DUOC
    DINH NGHIA -> NameError bi `except` nuot -> ten LUON rong. Vi vay bang
    danh sach khong hien ten, va khong the doi chieu "may minh la ai".

    Nay thu lan luot nhieu offset va kiem tra noi dung doc duoc.
    """
    if not wrap:
        return ''
    for off in _NAME_OFFS:
        try:
            p = u32(h, wrap + off)
            if not p or p < 0x10000:
                continue
            b = rd(h, p, 48)
            nm = _looks_like_name(b)
            if nm:
                return nm
        except Exception:
            continue
    return ''


def read_player_name(h, pd, wrap=0):
    """Giu ten cu cho tuong thich -- neu co wrap thi dung cach moi."""
    if wrap:
        return read_name_of_wrapper(h, wrap)
    return ''


# ============================================================================
# DANH SACH NGUOI CHOI -- doc dung theo engine
#
# Chứng minh bằng đo thực tế 2026-11-10 23:50 (pid 42024, trận 6 slot):
#
#   cnt = u16[mgr+0x3C] = 6      <- BẮT BUỘC dùng, không quét mù
#                                 (ô 6..31 chứa rác: +0x4A = None hoặc 12818)
#
#   slot 0:  vtable 0x54EF98   [+0xB0]=1   F=0      -> GAME SETTINGS, không phải người
#   slot 1..5: vtable 0x54EE68 [+0xB0]=0   F>0      -> người chơi thật
#
#   +0x4A (int16) = slot index, duy nhất trong 0..cnt-1
#   +0xD8 (dword) = BITMASK 1<<idx (1,2,4,8,16,32) — KHÔNG phải số thứ tự
#   [sub+0x26]    = CHỈ SỐ MÀU (0..7) — TRÙNG được, không phải identity
#                   (slot 0 và slot 1 cùng trỏ sub 0x2B0E490, cùng màu 7)
#
#   local index = byte[apply+0x1590]   (engine dùng tại 0x41F1CB)
#   apply+0x10E0 = SOURCE player, KHÔNG phải local
#   apply+0x10C8 = frame counter, đổi mỗi tick
#
# Vậy: số người chơi = vị trí trong danh sách sau khi bỏ slot 0 (1..N).
# ============================================================================

# ============================================================================
# NHAN DIEN NGUOI CHOI -- KHONG dung vtable hardcode
#
# Truoc day:
#     players = [p for p in raw if p['slot'] > 0 and p['vt'] == 0x54EE68]
#
# 0x54EE68 la dia chi vtable DO TU MOT BUILD CU. Khong phai ban EMPIRESX.EXE
# nao cung co dung gia tri nay (khac patch, khac HD/HDR). Khi lech:
#   - danh sach rong       -> "khong doc duoc nguoi choi nao"
#   - hoac bo sot nguoi choi -> "khong nhan dung nguoi choi"
# Day chinh la trieu chung bao cao.
#
# Nay nhan dien bang CAU TRUC, khong bang so tien dinh:
#   1. slot 0 la game-settings  -> loai (wrapper co [+0xB0] = 1)
#   2. wrapper phai co +0x4A (int16) nam trong [0, cnt)
#   3. playerdata phai doc duoc ca 4 tai nguyen, hop le
#   4. co ten hien thi hoac co bitmask != 0
# ============================================================================

OFF_WRAP_KIND = 0xB0        # dword: 1 = game-settings, 0 = nguoi choi that


def _wrapper_kind(h, wrap):
    """1 = game-settings, 0 = nguoi choi, -1 = khong doc duoc."""
    b = u32(h, wrap + OFF_WRAP_KIND)
    return -1 if b is None else (1 if b else 0)


def _plausible_player(h, wrap, pd, idx, cnt, vals, ten):
    """Nguoi choi that? Dua vao cau truc, khong dua vao vtable."""
    if not (0 <= idx < cnt):
        return False
    for k in ('F', 'W', 'S', 'G'):
        v = vals.get(k)
        if v is None or v < 0 or v > 1e12:
            return False
    bm = u32(h, wrap + OFF_BITMASK) or 0
    if ten or bm:
        return True
    # Khong ten, khong bitmask: van chap nhan neu tai nguyen co gi do
    return any(v > 0 for v in vals.values())


def list_players(h):
    """Tra list nguoi choi that. KHONG BAO GIO crash -- tra [] neu loi."""
    try:
        return _list_players_inner(h)
    except Exception:
        return []


def _list_players_inner(h):
    world = u32(h, PTR_WORLD)
    if not world:
        return []
    mgr = u32(h, world + OFF_MANAGER)
    if not mgr:
        return []
    arr = u32(h, mgr + OFF_WRAPARRAY)
    if not arr:
        return []
    cnt = (u32(h, mgr + OFF_SLOTS) or 0) & 0xFFFF
    if cnt <= 0 or cnt > 64:
        return []

    raw = []
    for slot in range(cnt):
        wrap = u32(h, arr + slot * 4)
        if not wrap:
            continue
        pd = u32(h, wrap + OFF_PLAYER)
        if not pd:
            continue
        idx_raw = rd(h, wrap + OFF_PLAYERIDX, 2)
        idx = -1
        if idx_raw and len(idx_raw) >= 2:
            try:
                idx = struct.unpack('<h', idx_raw[:2])[0]
            except Exception:
                idx = -1
        vals = {}
        ok = True
        for k in ('F', 'W', 'S', 'G'):
            v = f32(h, pd + RES_OFF[k])
            if v is None or v < 0 or v > 1e12:
                ok = False
                break
            vals[k] = float(v)
        if not ok:
            continue
        bm = u32(h, wrap + OFF_BITMASK) or 0
        ten = read_name_of_wrapper(h, wrap)
        raw.append({'slot': slot, 'wrap': wrap, 'pd': pd, 'idx': idx,
                    'vt': u32(h, wrap) or 0, 'bm': bm,
                    'kind': _wrapper_kind(h, wrap),
                    'ten': ten, 'vals': vals,
                    'ok': _plausible_player(h, wrap, pd, idx, cnt, vals, ten)})

    # Nhan dien bang CAU TRUC (xem ghi chu dau muc): khong dung vtable.
    players = [p for p in raw if p['slot'] > 0 and p['ok']]
    for n, p in enumerate(players, start=1):
        p['so'] = n
    return players


def local_index(h):
    """int16 [manager+0x7C] = slot cua may nay. -1 neu khong doc duoc."""
    try:
        world = u32(h, PTR_WORLD)
        if not world:
            return -1
        mgr = u32(h, world + OFF_MANAGER)
        if not mgr:
            return -1
        b = rd(h, mgr + OFF_LOCAL_SLOT, 2)
        if not b or len(b) < 2:
            return -1
        v = struct.unpack('<h', b[:2])[0]
        return v if v >= 0 else -1
    except Exception:
        return -1


def my_number(h):
    """So thu tu 1..N cua may nay, hoac 0 neu khong xac dinh.

    local_index() = int16[manager+0x7C]; khop voi [wrap+0x4A] cua slot do.
    """
    lv = local_index(h)
    if lv < 0:
        return 0
    for p in list_players(h):
        if p['idx'] == lv:
            return p['so']
    return 0


def find_by_number(h, so):
    """Tim player co so thu tu `so`. None neu khong co / loi."""
    try:
        for p in list_players(h):
            if p['so'] == so:
                return p
    except Exception:
        pass
    return None

def get_player(h, slot=None):
    """playerdata + tai nguyen cua MOT slot cu the.

    SUA 2026-11-11 01:45: ban cu tra ve slot DAU TIEN doc duoc -> do la slot 0
    (GAIA), tai nguyen luon 0. Hau qua: log truoc/sau grant hien 0 -> 0,
    gay hieu nham la grant that bai.

    slot=None -> dung slot cua may minh ([manager+0x7C]).
    """
    world = u32(h, PTR_WORLD)
    if not world:
        return 0, None
    mgr = u32(h, world + OFF_MANAGER)
    if not mgr:
        return 0, None

    if slot is None:
        slot = local_index(h)
        if slot < 0:
            return 0, None

    arr = u32(h, mgr + OFF_WRAPARRAY)
    if not arr:
        return 0, None
    cnt = (u32(h, mgr + OFF_SLOTS) or 0) & 0xFFFF
    if slot >= cnt:
        return 0, None

    wrp = u32(h, arr + slot * 4)
    if not wrp:
        return 0, None
    pd = u32(h, wrp + OFF_PLAYER)
    if not pd:
        return 0, None
    vals = {}
    for k, o in RES_OFF.items():
        v = f32(h, pd + o)
        if v is None:
            return 0, None
        vals[k] = v
    return pd, vals


# ----------------------------------------------------------------------------
# Resolve chuoi `this`
# ----------------------------------------------------------------------------
def resolve_chain(h, so=None):
    """Tra dict {ctx, sender, apply, online, pindex, so, ten, slot}.

    Tham so `so`: so thu tu nguoi choi 1..8 (mau+1, KHONG DOI giua cac tran).
                  None = tu tim may minh.

    CHUOI THAT:

        [0x585E88]        world
        [world+0x3F4]     manager
        [mgr+0x40]        wraparray
        [arr + slot*4]    CTX (player wrapper)
        [ctx+0x10C]       sub  -> [+0x26] int16 = mau (0..7)
                          so thu tu = mau + 1
        [mgr+0x58]        SENDER  vtable 0x54EC90
        [sender+0x14]     apply
        [apply+0x1590]    LOCAL PLAYER INDEX (engine tu dung tai 0x41F1CB)

    Slot array index CO THE DOI giua cac tran.
    So (mau+1) thi KHONG -- do la danh tinh nguoi choi.
    """
    world = u32(h, PTR_WORLD)
    if not world:
        raise GrantError('0x%08X (world ptr) = 0 -> chua vao tran' % PTR_WORLD)

    mgr = u32(h, world + OFF_MANAGER)
    if not mgr:
        raise GrantError('world->[+0x3F4] (manager) = 0', world + OFF_MANAGER)

    sender = u32(h, mgr + OFF_SENDER)
    if not sender:
        raise GrantError('mgr->[+0x58] (sender) = 0', mgr + OFF_SENDER)
    vt_s = u32(h, sender)
    apply = u32(h, sender + OFF_APPLY)
    if not apply:
        raise GrantError('sender->[+0x14] (apply obj) = 0', sender + OFF_APPLY)
    online = u32(h, apply + OFF_ONLINE) or 0
    # So slot cua manager: can cho viec xac dinh may minh (duong du phong 3).
    cnt = (u32(h, mgr + OFF_SLOTS) or 0) & 0xFFFF
    # LOCAL SLOT: int16 [manager+0x7C] -- xem local_index() de biet chung minh
    lvraw = rd(h, mgr + OFF_LOCAL_SLOT, 2)
    lv7c = struct.unpack('<h', lvraw)[0] if lvraw and len(lvraw) == 2 else -1
    log('chain', 'world=0x%08X mgr=0x%08X sender=0x%08X vtable=0x%08X apply=0x%08X'
        % (world, mgr, sender, vt_s or 0, apply), world)
    log('chain', 'LOCAL SLOT [mgr+0x7C] = %d   online = %d' % (lv7c, online),
        mgr + OFF_LOCAL_SLOT)

    players = list_players(h)
    if not players:
        raise GrantError('khong doc duoc player nao. Da vao tran chua?')

    print()
    print('  %-5s %-5s %-7s %-16s %9s %9s %9s %9s' %
          ('slot', 'so', '+D8', 'ten', 'thit', 'go', 'da', 'vang'))
    print('  ' + '-' * 74)
    for p in players:
        tag = ''
        if p['idx'] == lv7c:
            tag = '  <<< BAN'
        print('  %-5d %-5s 0x%-5X %-16s %9.0f %9.0f %9.0f %9.0f%s'
              % (p['slot'], p['so'], p.get('bm', 0),
                 (p['ten'] or '(khong ten)')[:16],
                 p['vals']['F'], p['vals']['W'], p['vals']['S'], p['vals']['G'],
                 tag))
    print()

    # ------------------------------------------------------------------
    # CHON MUC TIEU
    #
    # Truoc day CHI co mot duong: tim player co p['idx'] == [mgr+0x7C].
    # Neu [mgr+0x7C] khong phai local slot (build khac, hoac tran khac kieu),
    # ham nem loi "khong tim thay slot cua may minh" -> day chinh la trieu
    # chung "khong nhan dung nguoi choi".
    #
    # Nay thu LAN LUOT 3 dau hieu, dung cai nao khop truoc:
    #   1. [mgr+0x7C]  == [wrap+0x4A]                 (duong cu)
    #   2. [wrapper+0x788] >= 0.5                      (co "may nay", do live)
    #   3. neu chi co DUNG MOT nguoi choi trong tran   -> do la minh
    # Khong co dau hieu nao va co nhieu nguoi -> TU CHOI, khong doan bua.
    # ------------------------------------------------------------------
    if so is None:
        target = None
        how = ''

        # (1) local slot
        for p in players:
            if p['idx'] == lv7c:
                target, how = p, '[mgr+0x7C]=%d' % lv7c
                break

        # (2) co "may nay" trong wrapper
        if target is None:
            marked = []
            for p in players:
                v = f32(h, p['wrap'] + OFF_LOCAL_MARK)
                if v is not None and v >= 0.5:
                    marked.append(p)
            if len(marked) == 1:
                target, how = marked[0], 'co may-nay [+0x%X]' % OFF_LOCAL_MARK

        # (3) Tran chi co MOT nguoi choi.
        #
        # PHAI kiem ca cnt cua manager, khong chi len(players). Neu
        # list_players loc sot (vtable/ten/tai nguyen khong doc duoc), danh
        # sach co the chi con 1 phan tu trong khi tran that co 4 nguoi ->
        # chon bua -> GRANT CHO NGUOI KHAC. Do la loi nghiem trong nhat.
        # Vi vay chi dung duong nay khi manager bao DUNG 2 slot
        # (slot 0 = game-settings + 1 nguoi choi).
        if target is None and len(players) == 1 and cnt == 2:
            target, how = players[0], 'tran chi 1 nguoi (cnt=2)'

        if target is None:
            dss = ', '.join('p%d=%r(slot%d,idx%d)' % (p['so'], p['ten'] or '?',
                                                      p['slot'], p['idx'])
                            for p in players)
            raise GrantError(
                'khong xac dinh duoc may minh la ai.\n'
                '  local slot [mgr+0x7C] = %d\n'
                '  danh sach: %s\n'
                '\n'
                '  Da thu: [mgr+0x7C], co may-nay [+0x%X], va "chi 1 nguoi".\n'
                '  -> Chay lai va chon so thu tu:  --for N  (vd: --for 2)\n'
                '     (N la cot "so" trong bang tren)'
                % (lv7c, dss, OFF_LOCAL_MARK))
        log('chain', 'muc tieu = CHINH MINH (so %d, slot %d) qua %s'
            % (target['so'], target['slot'], how), target['wrap'])
    else:
        if not (1 <= so <= 8):
            raise GrantError('so thu tu phai 1..8, nhan %d' % so)
        target = None
        for p in players:
            if p['slot'] == 0:
                continue
            if p['so'] == so:
                target = p
                break
        if not target:
            ds = [p['so'] for p in players if p['slot'] != 0 and p['so']]
            raise GrantError(
                'khong co nguoi choi so %d.\n'
                '  Cac so hien co: %s\n'
                '  (so = mau+1, lay tu [wrap+0x10C]->[+0x26])'
                % (so, ds or 'khong co'))
        log('chain', 'muc tieu = nguoi choi so %d (slot %d)'
            % (so, target['slot']), target['wrap'])

    if target['slot'] == 0:
        raise GrantError('muc tieu la slot 0 (game settings). TU CHOI.')

    ctx = target['wrap']
    pidx = target['idx']
    if not (0 <= pidx <= 0xFF):
        raise GrantError('player index = %d ngoai mien byte. DUNG.' % pidx,
                         ctx + OFF_PLAYERIDX)

    print('  *** MUC TIEU: slot %d, so %s, ten %r ***'
          % (target['slot'], target['so'] or '?', target['ten']))
    print()

    return {'ctx': ctx, 'sender': sender, 'apply': apply, 'online': online,
            'pindex': pidx, 'so': target['so'], 'ten': target['ten'],
            'slot': target['slot']}


def verify_build(h, base):
    """Kiem tra byte tung dia chi + DllCharacteristics. Khong ghi gi.

    Chu ky byte lay tu bang engine da giai ma tu token, KHONG phai hang so
    trong file. Khong co license -> khong co gi de doi chieu -> tu choi.
    """
    dllch = rd(h, base + DLLCHAR_OFF, 2)
    if dllch is None:
        raise GrantError('khong doc duoc PE header')
    dllch = struct.unpack('<H', dllch)[0]
    if dllch & 0x40:
        raise GrantError('DYNAMIC_BASE bat -> dia chi co the doi. DUNG.')
    log('build', 'DllCharacteristics=0x%04X (ASLR %s, DEP %s)'
        % (dllch, 'OFF' if not dllch & 0x40 else 'ON',
           'OFF' if not dllch & 0x100 else 'ON'))

    if ADDR is None:
        raise GrantError('chua nap bang engine. TU CHOI.')
    sigs = ADDR.sigs()
    if not sigs:
        raise GrantError('token khong co chu ky build. TU CHOI.')

    for name, hx in sorted(sigs.items()):
        try:
            sig = bytes.fromhex(hx)
        except ValueError:
            raise GrantError('chu ky %s hong' % name)
        va = ADDR.get(name)
        if not va:
            raise GrantError('thieu dia chi cho %s' % name)
        got = rd(h, va, len(sig))
        if got != sig:
            raise GrantError('byte tai 0x%08X khong khop.\n  mong doi: %s\n  thuc te : %s'
                             % (va, sig.hex().upper(),
                                got.hex().upper() if got else 'UNREADABLE'))
        log('build', 'byte khop %-32s' % sig.hex().upper(), va)

    vt = u32(h, VTABLE + VT_SLOT_OFF)
    if vt != VT_SLOT_VAL:
        raise GrantError('vtable 0x%08X +0x%X = 0x%08X != 0x%08X'
                         % (VTABLE, VT_SLOT_OFF, vt or 0, VT_SLOT_VAL))
    log('build', 'sender vtable[+0x%X] = 0x%08X khop' % (VT_SLOT_OFF, vt),
        VTABLE + VT_SLOT_OFF)
    # vtable cua player wrapper phai co ChangeResource o +0x78
    wrp_vt = u32(h, WRAPPER_VTABLE + WRAP_CR_OFF)
    if wrp_vt != WRAP_CR_VAL:
        raise GrantError('wrapper vtable 0x%08X +0x%X = 0x%08X != 0x%08X'
                         % (WRAPPER_VTABLE, WRAP_CR_OFF, wrp_vt or 0,
                            WRAP_CR_VAL))
    log('build', 'wrapper vtable[+0x%X] = 0x%08X (ChangeResource) khop' % (WRAP_CR_OFF, wrp_vt),
        WRAPPER_VTABLE + WRAP_CR_OFF)


# ----------------------------------------------------------------------------
# LICENSE -- chot chan trung tam
# ----------------------------------------------------------------------------
_LIC_CACHE = []


def _lic_banner(msg, code=None):
    print()
    print('=' * 70)
    print(msg)
    if code:
        print()
        print('  Ma loi: %s' % code)
    print('=' * 70)
    print()
    print('  Mua license tai: %s' % XL.api_base())
    print('  Ho tro: %s/#/support' % XL.api_base())


def require_license(verbose=True, skip_env_check=False):
    """Nap + xac minh license. Nem NoLicense neu khong dung.

    Day la diem duy nhat duoc phep tao ra bang dia chi engine.
    """
    if _LIC_CACHE:
        return _LIC_CACHE[0]

    if not skip_env_check:
        ok_env, reasons, _ = xa_sec.scan_environment()
        if not ok_env:
            raise NoLicense('moi truong phan tich: %s' % ','.join(reasons))

    lic = XL.License()
    if not lic.load_local():
        if verbose:
            _lic_banner('CHUA KICH HOAT. Chay: xa_grant.exe --key <MA>', 'no_license')
        raise NoLicense('chua co license tren may nay')

    # Kiem tra toan ven state + hang so
    ok_i, bad_i = xa_sec.integrity(lic.payload)
    if not ok_i:
        if verbose:
            _lic_banner('PHAT HIEN CAN THIEP VAO TOOL: %s' % ','.join(bad_i),
                        'tampered')
        try:
            lic.report_violation(','.join(bad_i))
        except Exception:
            pass
        raise NoLicense('integrity: %s' % ','.join(bad_i))

    # Xac minh lai phan cung
    try:
        hw = XL.compute_hwid()
    except Exception as e:
        if verbose:
            _lic_banner('Khong doc duoc HWID: %s' % e, 'hwid_error')
        raise NoLicense('hwid')

    if hw != lic.hwid:
        if verbose:
            _lic_banner(
                'LICENSE KHONG KHOP MAY NAY.\n'
                '  License dang gan cho mot may khac.\n'
                '  Vao muc "License cua toi" tren web, bam "Doi may".',
                'hwid_mismatch')
        raise NoLicense('hwid mismatch')
    lic.hwid = hw

    # Han dung (theo dong ho da neo vao server)
    if lic.expired():
        if verbose:
            _lic_banner('LICENSE DA HET HAN.', 'expired')
        raise NoLicense('expired')

    if lic.clock.tampered:
        if verbose:
            _lic_banner('DONG HO MAY BI CHINH LUI.', 'clock_tampered')
        raise NoLicense('clock_tampered')

    # Phai hoi server de lay token moi (co bang engine). Bat buoc online.
    mono_now = time.monotonic()
    if mono_now >= lic.next_check:
        try:
            lic.check()
        except XL.DenyError as e:
            if e.code in ('not_found', 'revoked', 'expired', 'hwid_mismatch',
                          'trial_only', 'session_invalid', 'wrong_product'):
                if verbose:
                    _lic_banner('LICENSE BI TU CHOI: %s' % (e.msg or e.code),
                                e.code)
                raise NoLicense(e.code)
            # Loi tam thoi (rate limit, 5xx) -> cho phep dung grace
            if not _grace_ok(lic):
                if verbose:
                    _lic_banner('Khong kiem tra duoc license: %s' % (e.msg or e.code),
                                e.code)
                raise NoLicense('deny:' + e.code)
        except XL.NetError as e:
            if not _grace_ok(lic):
                if verbose:
                    _lic_banner(
                        'KHONG KET NOI DUOC SERVER.\n'
                        '  Tool can mang de xac minh ban quyen.\n'
                        '  Chi tiet: %s' % e, 'network')
                raise NoLicense('network')

    # Cat lai bang moi nhat + nap engine
    if lic.addr is None:
        raise NoLicense('khong co bang engine')

    _LIC_CACHE.append(lic)
    return lic


def _grace_ok(lic):
    """Con trong cua so offline grace khong?

    Moc tinh la `last_ok` (giay, do client tu ghi moi lan server tra loi OK)
    — KHONG dung dong ho he thong de tranh bi chinh lui. Moc nay nam trong
    state da ky HMAC nen khong sua duoc.

    Truoc day ham nay hong: no tinh `age` roi khong dung, va `return True`
    vo dieu kien khi chua co moc -> mat mang la tool chay mai mai, grace 6
    gio khong bao gio het han.
    """
    g = int(lic.grace_h or 0)
    if g <= 0:
        return False

    last = getattr(lic, 'last_ok', 0) or 0
    try:
        last = float(last)
    except (TypeError, ValueError):
        return False
    if last <= 0:
        return False

    # Dung thoi diem server da neo (clock.now()) thay vi time.time(): dong ho
    # may chinh lui khong keo dai duoc grace.
    now = lic.clock.now() if lic.clock.srv else time.time()
    return (now - last) < g * 3600


def load_engine():
    """Nap bang dia chi tu license. Nem NoLicense neu chua kich hoat."""
    global ADDR, BUILDER, SENDER, APPLY_GATE, APPLY_IMPL, CHANGE_RES
    global VTABLE, WRAPPER_VTABLE, PTR_WORLD, ALLOC_ADDR
    global VT_SLOT_VAL, WRAP_CR_VAL, VT_SLOT_OFF, WRAP_CR_OFF
    global OFF_CTX, OFF_PLAYERIDX
    global OFF_SENDER, OFF_APPLY, OFF_ONLINE

    lic = require_license(verbose=False)
    ADDR = lic.addr

    BUILDER = ADDR['BUILDER']
    SENDER = ADDR['SENDER']
    APPLY_GATE = ADDR['APPLY_GATE']
    APPLY_IMPL = ADDR['APPLY_IMPL']
    CHANGE_RES = ADDR['CHANGE_RES']
    VTABLE = ADDR['VTABLE']
    WRAPPER_VTABLE = ADDR['WRAP_VTABLE']
    PTR_WORLD = ADDR['PTR_WORLD']
    ALLOC_ADDR = ADDR['ALLOC']
    VT_SLOT_VAL = ADDR.val('vt_slot')
    WRAP_CR_VAL = ADDR.val('wrap_cr')
    VT_SLOT_OFF = ADDR.val('vt_off', 0x08)
    WRAP_CR_OFF = ADDR.val('wrap_off', 0x78)
    OFF_CTX = ADDR.off('ctx', 0x3C)
    OFF_PLAYERIDX = ADDR.off('playeridx', 0x4A)
    OFF_SENDER = ADDR.off('sender', 0x58)
    OFF_APPLY = ADDR.off('apply', 0x14)
    OFF_ONLINE = ADDR.off('online', 0x10E4)

    # Chot cuoi: khong duoc de bat ky dia chi nao = 0. Neu token hong hoac
    # ai patch bo giai ma, tool se goi vao 0x0 -> crash game. Tu choi truoc.
    for _nm, _va in (('BUILDER', BUILDER), ('SENDER', SENDER),
                     ('PTR_WORLD', PTR_WORLD), ('VTABLE', VTABLE),
                     ('WRAPPER_VTABLE', WRAPPER_VTABLE)):
        if not _va:
            raise NoLicense('dia chi %s = 0 (token hong)' % _nm)
    return lic


# ----------------------------------------------------------------------------
# Hanh dong
# ----------------------------------------------------------------------------
def do_check(h, base):
    print()
    log('check', 'base module = 0x%08X' % base)
    verify_build(h, base)
    print()
    try:
        ch = resolve_chain(h)
    except GrantError as e:
        print()
        log('check', 'CHUOI this THAT BAI: %s' % e)
        ch = None
    pd, vals = get_player(h, ch['slot'] if ch else None)
    print()
    if pd:
        log('check', 'playerdata = 0x%08X' % pd, pd)
        for k in ('F', 'W', 'S', 'G'):
            print('        %-2s %-6s = %g' % (k, RES_NAME[k], vals.get(k, 0.0)))
    else:
        log('check', 'KHONG thay playerdata -> chua vao tran that')
    print()
    ok = ch is not None and pd != 0
    print('KET LUAN: %s' % ('DU DIEU KIEN de --grant.' if ok else
                            'THIEU DIEU KIEN -> --grant se bi tu choi.'))
    if ch is not None and ch['online'] != 0:
        print('CANH BAO: online flag = %d != 0 -> record se di qua 0x422CC0'
              ' (msg 0x3E) toi peer; peer KHONG co du lieu nay -> desync.'
              % ch['online'])
    return 0 if ok else 1


def do_grant(h, base, res, amount, dry_run, gate, so=None):
    # ---- thu tu gate: tat ca deu phai qua truoc khi cap phat byte nao ----
    if not gate:
        raise GrantError(
            'THIEU %s.\n'
            '  Cong cu nay goi thang vao engine, bo qua logic game binh thuong.\n'
            '  Hau qua: peer khong co cung du lieu -> lech checksum -> co the bi\n'
            '  kick / out-of-sync. Chi chay khi ban chap nhan dieu do.' % GATE_FLAG)
    log('gate', '%s co mat' % GATE_FLAG)

    # ------------------------------------------------------------------
    # GATE CUNG: CHI GRANT CHO CHINH MINH.
    #
    # so=None  -> tu xac dinh may minh (3 dau hieu, xem resolve_chain)
    # so=N     -> chon nguoi choi thu N trong bang (--for N)
    #
    # TRUOC DAY khoi nay TU CHOI moi so != None, trong khi main() van nhan
    # --for va thong bao loi cua resolve_chain van huong dan dung --for.
    # Ket qua: tinh nang "chon nguoi choi" quang cao duoc nhung KHONG BAO GIO
    # chay. Nay so duoc truyen xuong resolve_chain de chon dung muc tieu.
    # ------------------------------------------------------------------
    if so is not None and not (1 <= so <= 8):
        raise GrantError('so thu tu phai 1..8, nhan %r' % (so,))

    if res not in RES_OFF:
        raise GrantError('slot phai la F/W/S/G, nhan %r' % (res,))
    slot = RES_SLOT[res]                     # F=0 W=1 S=2 G=3 (khop RES_OFF/4)
    try:
        amount = float(amount)
    except Exception:
        raise GrantError('amount khong phai so: %r' % (amount,))
    if not (amount > 0.0):
        raise GrantError('amount phai > 0 (0x45F519..0x45F528: fcomp 0.0 -> tu choi 0)')
    log('gate', 'slot %s -> %d, amount = %g' % (res, slot, amount))

    log('build', 'module base = 0x%08X' % base)
    verify_build(h, base)

    world = u32(h, PTR_WORLD)
    if not world:
        raise GrantError('world = 0 -> chua vao tran that. TU CHOI.')
    mgr = u32(h, world + OFF_MANAGER)
    if not mgr:
        raise GrantError('manager = 0 -> chua vao tran that. TU CHOI.')

    ch = resolve_chain(h, so)

    # playerdata cua DUNG muc tieu (truoc day ham nay tra slot dau tien = GAIA,
    # tai nguyen luon 0 -> log truoc/sau grant hien 0 -> 0, sai hoan toan)
    pd, vals = get_player(h, ch['slot'])
    if not pd:
        raise GrantError('khong doc duoc playerdata cua slot %d. TU CHOI.'
                         % ch['slot'])
    log('vital', 'playerdata slot %d = 0x%08X (ten %r)'
        % (ch['slot'], pd, ch['ten']), pd)
    # ---------------------------------------------------------------------
    # ONLINE FLAG -- DA SUA (2026-11-10)
    #
    # Ban truoc TU CHOI khi online, vi cho rang 0x41F180 online chi gui ma
    # khong ap dung local -> se lech checksum.
    #
    # DIEU DO SAI. Da verify bang byte:
    #
    #   0x422CC0 (ham GUI packet chung, ret 0x14, 5 tham so)
    #     0x42304F  mov  al, [esp+0x38]     ; cmd id (arg2)
    #     0x423054  cmp  al, 0x3e
    #     0x42305C  jne  0x423085           ; khong phai 0x3E -> skip
    #     0x423080  call 0x41f0a0           ; <-- AP DUNG LOCAL
    #     0x423085  ...free packet
    #
    #   0x41F0A0 -> call 0x428710 (copy payload vao ring, cung ham apgpiif goi)
    #
    # Nghia la: khi gui cmd 0x3E, engine VUA gui cho peer VUA ap dung local.
    # Ca hai may cung tang, NHUNG peer chi tang theo so cua no.
    #
    # => Mac dinh TU CHOI khi online (can %s).
    #    Trong tran offline (Single Player) day la duong binh thuong.
    # ---------------------------------------------------------------------
    if ch['online'] != 0:
        print()
        print('  *** ONLINE FLAG = %d ***' % ch['online'])
        print('  Engine se:')
        print('    1. gui packet cmd 0x3E cho peer   (0x422CC0)')
        print('    2. AP DUNG LOCAL tren may nay     (0x422CC0 -> 0x41F0A0)')
        print('  => ca hai may cung tang, NHUNG peer tang theo so cua no.')
        print('  Neu checksum lech -> doc aoesync.txt ca hai dau.')
        if not ALLOW_ONLINE:
            raise GrantError(
                'dang trong tran ONLINE va chua bat %s.\n'
                '  Grant khi online co the lam lech checksum / bi kick.\n'
                '\n'
                '  Cach an toan: thoat ra, tao tran offline (Single Player),\n'
                '  roi chay lai.\n'
                '\n'
                '  Neu ban chap nhan rui ro: them %s vao lenh.'
                % (GATE_FLAG, GATE_FLAG))
    else:
        log('vital', 'online flag = 0 -> 0x41F180 ap dung LOCAL (khong gui)')

    player = ch['pindex']
    rec = build_record(player, slot, amount)
    stub = build_stub(ch['sender'], player, slot, amount)

    # ------------------------------------------------------------------
    # CHUP TAT CA 4 TAI NGUYEN TRUOC KHI GRANT.
    #
    # PHAI chup o day, TRUOC CreateRemoteThread. Dat sau khi thread chay thi
    # gia tri da tang roi -> delta luon ~0 -> bao "khong tai nguyen nao doi"
    # du grant da thanh cong.
    # ------------------------------------------------------------------
    snap_before = {}
    for _k in ('F', 'W', 'S', 'G'):
        _v = f32(h, pd + RES_OFF[_k])
        snap_before[_k] = float(_v) if _v is not None else None

    print()
    log('record', 'record 8 byte = %s' % rec.hex(' ').upper())
    print('        +0 type   = 0x%02X' % rec[0])
    print('        +1 player = %d' % rec[1])
    print('        +2 slot   = %d (%s)' % (rec[2], RES_NAME[res]))
    print('        +3 pad    = 0x%02X' % rec[3])
    print('        +4 f32    = %g  (bits 0x%08X)'
          % (struct.unpack('<f', rec[4:8])[0],
             struct.unpack('<I', rec[4:8])[0]))
    log('stub', 'stub %d byte = %s' % (len(stub), stub.hex(' ').upper()))

    if dry_run:
        print()
        print('DRY-RUN: khong goi gi ca. Khong cap phat, khong tao thread.')
        print('  Se goi  : 0x%08X(ecx=0x%08X, %d, %d, %g)'
              % (BUILDER, ch['sender'], player, slot, amount))
        print('  Sender se goi tiep: 0x%08X(rec, 8) -> 0x%08X -> 0x%08X local'
              % (SENDER, APPLY_GATE, APPLY_IMPL))
        return 0

    # ---- thuc thi ----
    # Kiem kien truc TRUOC khi cap phat/ghi stub: stub la ma may 32-bit, chay
    # trong process 64-bit se chet ma khong bao loi ro rang.
    require_target_is_32bit(h)

    size = 0x1000
    mem = k32.VirtualAllocEx(h, None, size, MEM_COMMIT | MEM_RESERVE,
                             PAGE_EXECUTE_READWRITE)
    if not mem:
        raise GrantError('VirtualAllocEx that bai (err=%d)' % ctypes.get_last_error())
    log('exec', 'VirtualAllocEx 0x%X byte RWX tai 0x%08X' % (size, mem), mem)
    try:
        wrote = ctypes.c_size_t(0)
        if not k32.WriteProcessMemory(h, ctypes.c_void_p(mem), stub, len(stub),
                                      ctypes.byref(wrote)) or wrote.value != len(stub):
            raise GrantError('WriteProcessMemory stub that bai')
        log('exec', 'ghi stub vao 0x%08X' % mem, mem)
        k32.FlushInstructionCache(h, ctypes.c_void_p(mem), len(stub))

        tid = wt.DWORD(0)
        th = k32.CreateRemoteThread(h, None, 0, ctypes.c_void_p(mem), None, 0,
                                    ctypes.byref(tid))
        if not th:
            raise GrantError('CreateRemoteThread that bai (err=%d)'
                             % ctypes.get_last_error())
        log('exec', 'CreateRemoteThread tid=%d' % tid.value)
        try:
            r = k32.WaitForSingleObject(th, 5000)
            if r == WAIT_TIMEOUT:
                raise GrantError('thread khong ket thuc trong 5s -- KHONG xac dinh duoc trang thai')
            code = wt.DWORD(0)
            k32.GetExitCodeThread(th, ctypes.byref(code))
            log('exec', 'thread ket thuc, exit code = %d' % code.value)
        finally:
            k32.CloseHandle(th)
    finally:
        if k32.VirtualFreeEx(h, ctypes.c_void_p(mem), 0, MEM_RELEASE):
            log('exec', 'VirtualFreeEx 0x%08X' % mem, mem)
        else:
            log('exec', 'CANH BAO: VirtualFreeEx that bai (0x%08X con nam lai)'
                % mem, mem)

    # ------------------------------------------------------------------
    # DOC KET QUA -- phai CHO va phai doi CHI EU CUA GRANT, khong phai bat ky
    # thay doi nao.
    #
    # Engine khong cong truc tiep: 0x422CC0 ghi payload vao ring roi drain
    # (0x42A5D0 -> 0x4EA700 -> 0x42B0A0 -> 0x4F9040 -> 0x45DF10). Doc ngay
    # sau khi thread ket thuc se thay gia tri CU.
    #
    # Dong thoi: dan lang thu tai nguyen lien tuc (~10-1000/giay). Neu chi
    # "doi la dung" thi se bat nham phan troi tu nhien -> bao delta +10 trong
    # khi grant +777 da thanh cong. Do 2026-11-11 01:46.
    #
    # => chi chap nhan khi delta dat it nhat 50% amount.
    # ------------------------------------------------------------------
    # chup CA 4 tai nguyen da lam o tren, truoc khi tao thread.
    before = vals.get(res, 0.0)
    if before is None:
        before = 0.0
    before = float(before)
    need = abs(float(amount)) * 0.5
    after = None
    deadline = time.time() + 5.0
    while time.time() < deadline:
        v = f32(h, pd + RES_OFF[res])
        if v is not None:
            v = float(v)
            if (v - before) >= need:
                after = v
                break
        time.sleep(0.05)
    if after is None:
        v = f32(h, pd + RES_OFF[res])
        after = float(v) if v is not None else None

    print()
    if after is None:
        # doc lai that bai -- co the game da dong / process chet giua luc grant
        log('result', '%s tai playerdata+0x%02X: %g -> KHONG DOC DUOC'
            % (RES_NAME[res], RES_OFF[res], before))
        print('  [!] Khong doc lai duoc gia tri sau khi grant.')
        print('      Process co the da dong. Chay --check de kiem tra.')
        return 0

    log('result', '%s tai playerdata+0x%02X: %g -> %g  (delta %+g, yeu cau %+g)'
        % (RES_NAME[res], RES_OFF[res], before, after, after - before, amount))

    # ------------------------------------------------------------------
    # CHAN DOAN: doc CA 4 tai nguyen, cho biet cai nao THUC SU doi.
    # Neu cai minh grant khong doi ma cai khac doi -> biet ngay la lech
    # offset / lech engine slot, khong phai game chan.
    # ------------------------------------------------------------------
    print()
    print('  %-6s %-9s %-12s %-12s %s'
          % ('', 'offset', 'truoc', 'sau', 'delta'))
    print('  ' + '-' * 56)
    moved = []
    for _k in ('F', 'W', 'S', 'G'):
        _v = f32(h, pd + RES_OFF[_k])
        _now = float(_v) if _v is not None else None
        _old = snap_before.get(_k)
        if _now is None or _old is None:
            d_txt = '?'
            d_val = 0.0
        else:
            d_val = _now - _old
            d_txt = '%+g' % d_val
        mark = '   <== GRANT' if _k == res else ''
        if abs(d_val) > 0.5:
            moved.append(_k)
        print('  %-6s 0x%-7X %-12s %-12s %s%s'
              % ('%s %s' % (_k, RES_NAME.get(_k, _k)), RES_OFF[_k],
                 ('%g' % _old) if _old is not None else '?',
                 ('%g' % _now) if _now is not None else '?',
                 d_txt, mark))
    print()

    # kiem: cai minh grant co nam trong danh sach doi khong
    if res in moved:
        print('  [ok] Tai nguyen duoc grant DA DOI dung.')
    elif moved:
        print('  [!] Grant vao %r nhung %s MOI LA CAI DOI.'
              % (res, ', '.join('%s(%s)' % (m, RES_NAME.get(m, m)) for m in moved)))
        print('      => Lech anh xa. Bao lai de sua.')
    else:
        print('  [!] Khong tai nguyen nao doi sau 5s.')

    if (after - before) < need:
        print()
        print('  [!] Gia tri KHONG tang du sau 5s.')
        print('      Kiem tra: online flag, ring drain, hoac amount.')
    print()
    print('Sau khi grant, chay:  python xa_grant.py --check')
    return 0


# ----------------------------------------------------------------------------
def selftest():
    """Chay khong can game: chi kiem tra phan thuan."""
    ok = True
    print('SELFTEST (khong cham vao game)')
    r = build_record(0, 0, 1000.0)
    exp = bytes.fromhex('05 00 00 00 00 00 7A 44')
    print('  record(F,1000) = %s  mong doi %s  %s'
          % (r.hex(' ').upper(), exp.hex(' ').upper(),
             'OK' if r == exp else 'FAIL'))
    ok &= (r == exp)
    r2 = build_record(2, 3, -1.5)
    print('  record(player2,slot3,-1.5) = %s' % r2.hex(' ').upper())
    ok &= (r2[0] == 5 and r2[1] == 2 and r2[2] == 3 and r2[3] == 0)
    for bad in (float('nan'), float('inf')):
        try:
            build_record(0, 0, bad)
            print('  NaN/Inf KHONG bi chan -> FAIL')
            ok = False
        except GrantError:
            print('  NaN/Inf bi chan: OK')
    s = build_stub(0x12345678, 0, 1, 5000.0)
    print('  stub(%d byte) = %s' % (len(s), s.hex(' ').upper()))
    ok &= (len(s) == 28 and s[0] == 0xB9 and s[-3:-1] == b'\xFF\xD0' and s[-1] == 0xC3)
    print('  KET QUA: %s' % ('PASS' if ok else 'FAIL'))
    return 0 if ok else 1


# ============================================================================
# CHE DO TUONG TAC -- alt-tab ra, go lenh
#
# Khong gan phim tat. Khong hook ban phim. Khong chay ngam.
# Chi la vong lap doc lenh tu ban phim, y het console binh thuong.
#
#   python xa_grant.py --interactive
#
# Go:
#   f 500       -> +500 thit
#   g 10000     -> +10000 vang
#   w 500 s 200 -> +500 go va +200 da (nhieu lenh 1 dong)
#   check       -> xem tai nguyen hien tai
#   who         -> xem slot nao la cua ban
#   help        -> huong dan
#   q / quit    -> thoat
# ============================================================================

# Ten hien thi tieng Viet. Dinh nghia DUY NHAT o day (dong ~148) de khong bi
# ghi de: truoc kia file co hai ban RES_NAME, ban tieng Viet nam sau nen moi
# cho dung `RES_NAME` de in nhan tieng Anh deu bi doi thanh tieng Viet.
_VI_NAME = {'F': 'thit', 'W': 'go', 'S': 'da', 'G': 'vang'}


def _vi_name(r):
    """Ten tieng Viet cua tai nguyen."""
    return _VI_NAME.get(r, r)


def _manager(h):
    """Tra manager pointer, hoac 0."""
    world = u32(h, PTR_WORLD)
    if not world:
        return 0
    return u32(h, world + OFF_MANAGER) or 0


def _current_pid():
    """PID cua EMPIRESX dang chay, hoac None."""
    try:
        procs = find_game()
        return procs[0][0] if procs else None
    except Exception:
        return None


def _handle_valid(h, pid):
    """Kiem handle con tro toi dung process con song khong."""
    if not h or not pid:
        return False
    # 1. process con ton tai?
    try:
        procs = find_game()
        if not any(p[0] == pid for p in procs):
            return False
    except Exception:
        return False
    # 2. doc thu world pointer
    try:
        world = u32(h, PTR_WORLD)
    except Exception:
        return False
    if world is None:
        return False
    # 3. exit code (neu da thoat thi GetExitCodeProcess != STILL_ACTIVE)
    try:
        code = wt.DWORD(0)
        if k32.GetExitCodeProcess(h, ctypes.byref(code)):
            if code.value != 259:      # STILL_ACTIVE
                return False
    except Exception:
        pass
    return True


def _check_alive(h):
    """Tra 'ok' | 'reconnect'.

    'reconnect' khi: PID doi, game dong, hoac handle chet.
    """
    pid = _current_pid()
    if pid is None:
        return 'reconnect'
    cur = getattr(_check_alive, '_pid', None)
    if cur is None:
        _check_alive._pid = pid
        return 'ok' if _handle_valid(h, pid) else 'reconnect'
    if pid != cur:
        return 'reconnect'
    return 'ok' if _handle_valid(h, pid) else 'reconnect'


def _interactive_info(h, base):
    """In thong tin ket noi."""
    pid = _current_pid()
    print()
    print('  PID dang chay : %s' % (pid if pid else 'khong co'))
    print('  PID tool dang giu: %s' % getattr(_check_alive, '_pid', None))
    print('  base          : 0x%08X' % (base or 0))
    world = u32(h, PTR_WORLD)
    if not world:
        return None
    mgr = u32(h, world + OFF_MANAGER) if world else 0
    print('  world         : 0x%s' % (('%X' % world) if world else '0'))
    print('  manager       : 0x%s' % (('%X' % mgr) if mgr else '0'))
    print('  local slot    : %d' % local_index(h))
    print()


def _interactive_names(h, base):
    """In so + ten + tai nguyen."""
    _interactive_show(h, base)
    print('  Dung: p<so> <tai nguyen> <so luong>   vd:  p2 v 500')
    print()


def _interactive_handle(h, base, res, amount, so=None):
    """Chay 1 lenh grant trong che do tuong tac. Tra True neu thanh cong."""
    try:
        do_grant(h, base, res, amount, False, True, so)
        return True
    except GrantError as e:
        print('  LOI: %s' % e)
        return False
    except Exception as e:
        print('  LOI KHONG MONG DOI: %s: %s' % (type(e).__name__, e))
        import traceback
        traceback.print_exc()
        print('  (grant co the DA THANH CONG -- chay "check" de xem)')
        return False


def _interactive_show(h, base):
    """In bang tai nguyen -- dung list_players (da bo GAIA, ten tu +0x44)."""
    try:
        players = list_players(h)
        if not players:
            if not _manager(h):
                print('  chua vao tran')
            else:
                print('  khong doc duoc nguoi choi nao')
            return
        lv = local_index(h)
        print()
        print('  %-4s %-6s %-7s %-16s %8s %8s %8s %8s'
              % ('so', 'slot', '+D8', 'ten', 'thit', 'go', 'da', 'vang'))
        print('  ' + '-' * 70)
        for p in players:
            tag = '  <<< BAN' if p['idx'] == lv else ''
            print('  %-4d %-6d 0x%-5X %-16s %8.0f %8.0f %8.0f %8.0f%s'
                  % (p['so'], p['slot'], p.get('bm', 0),
                     (p['ten'] or '?')[:16],
                     p['vals']['F'], p['vals']['W'],
                     p['vals']['S'], p['vals']['G'], tag))
        print()
    except Exception as e:
        print('  LOI: %s: %s' % (type(e).__name__, e))


def _interactive_who(h, base):
    """In minh la ai."""
    try:
        lv = local_index(h)
        if lv < 0:
            print('  chua vao tran (local slot = -1)')
            return
        players = list_players(h)
        print()
        for p in players:
            if p['idx'] == lv:
                print('  BAN la slot %d, so %d, ten %r'
                      % (p['slot'], p['so'], p['ten']))
                print()
                return
        print('  local slot = %d nhung khong khop player nao' % lv)
        print('  danh sach: %s' % [(p['so'], p['ten']) for p in players])
        print()
    except Exception as e:
        print('  LOI: %s: %s' % (type(e).__name__, e))


def _split_glued(tok):
    """Tach chuoi dinh nhau thanh cac cum, TUAN TU, khong regex phuc tap.

    p2v500      -> ['p2', 'v', '500']
    v1000t500   -> ['v', '1000', 't', '500']
    p3full2000  -> ['p3', 'full', '2000']
    v1000       -> ['v', '1000']
    1000v       -> ['1000', 'v']
    1.5k        -> ['1.5k']
    p2          -> ['p2']
    """
    t = tok.strip()
    if not t:
        return []

    # buoc 1: tach pN / @N ra truoc
    out1 = []
    buf = ''
    k = 0
    while k < len(t):
        ch = t[k]
        low = ch.lower()
        if low in ('p', '@', 'n'):
            # thu doc so ngay sau
            m = re.match(r'\d+', t[k + 1:])
            if m and buf == '':
                out1.append(t[k:k + 1 + len(m.group())])
                k += 1 + len(m.group())
                continue
        buf += ch
        k += 1
    if buf:
        out1.append(buf)

    # buoc 2: moi cum tach tiep thanh <chu><so><chu><so>...
    out2 = []
    for seg in out1:
        if re.fullmatch(r'[pPnN@]\d+', seg):
            out2.append(seg)
            continue
        # quet tuan tu
        cur = ''
        cur_is_digit = None
        for ch in seg:
            isdig = ch.isdigit() or ch == '.'
            if cur_is_digit is None:
                cur = ch
                cur_is_digit = isdig
            elif isdig == cur_is_digit:
                cur += ch
            else:
                # neu la hau to don vi (k,m,b,tr) thi gop vao so
                if cur_is_digit and ch.lower() in ('k', 'm', 'b'):
                    cur += ch
                    # ket thuc cum so
                    out2.append(cur)
                    cur = ''
                    cur_is_digit = None
                    continue
                out2.append(cur)
                cur = ch
                cur_is_digit = isdig
        if cur:
            out2.append(cur)

    # gop 'tr' / 'nghin' / 'trieu' / 'ty' vao so truoc
    merged = []
    for x in out2:
        xl = x.lower()
        if (merged and re.fullmatch(r'\d+(?:\.\d+)?', merged[-1])
                and xl in ('tr', 'nghin', 'trieu', 'ty', 'k', 'm', 'b')):
            merged[-1] = merged[-1] + x
            continue
        merged.append(x)

    return merged if merged else [tok]


def _tokenize(line):
    """Tach dong lenh thanh token da phan loai.

    Moi phan tu: (kind, value)
      ('res', 'F'|'W'|'S'|'G')  ('num', float)  ('player', 1..8)
      ('me', None)  ('full', None)  ('bad', chuoiGoc)
    """
    RES_ALIAS = {
        'v': 'G', 'vang': 'G', 'gold': 'G',
        't': 'F', 'thit': 'F', 'food': 'F',
        'g': 'W', 'go': 'W', 'wood': 'W',
        'd': 'S', 'da': 'S', 'stone': 'S',
        'f': 'F', 'w': 'W', 's': 'S',
    }
    FULL_WORDS = ('full', 'het', 'tat', 'all', 'max', 'full4')
    ME_WORDS = ('me', 'minh', 'toi', 'self', 'ta')

    txt = line.strip()
    for ch in ',;=:+':
        txt = txt.replace(ch, ' ')
    raw = txt.split()

    # tach moi token dinh nhau
    exp = []
    for tok in raw:
        exp.extend(_split_glued(tok))

    # phan loai
    out = []
    for t in exp:
        tl = t.lower().strip()
        if not tl:
            continue
        m = re.match(r'^(?:p|@|n|nguoi|player|slot)(\d+)$', tl)
        if m:
            # ------------------------------------------------------------------
            # CHI CHO GRANT CHINH MINH.
            # Chon nguoi khac (p1..p8) bi tu choi o day.
            # ------------------------------------------------------------------
            out.append(('other', t))
            continue
        if tl in ME_WORDS:
            out.append(('me', None))
            continue
        if tl in FULL_WORDS:
            out.append(('full', None))
            continue
        if tl in RES_ALIAS:
            out.append(('res', RES_ALIAS[tl]))
            continue
        num = _parse_number(tl)
        if num is not None:
            out.append(('num', num))
            continue
        out.append(('bad', t))
    return out


def _parse_cmd(line):
    """Phan tich lenh -- CHAP NHAN MOI THU TU.

    Tra (jobs, error). jobs = list (so_nguoi, res, amount).
    so_nguoi = None nghia la chinh minh.

    DEU DUNG:
        v 1000          1000 v          v1000        v=1000
        V 1.000         v 1tr           v 1.5k       v 2m
        t 500 v 200     v g d t 1000    1000 v g d t
        p2 v 500        v 500 p2        p2v500
        full            full 50000      50000 full   full p3 100000
        me v 100        @3 t 500
    """
    if not line or not line.strip():
        return None, 'khong co lenh nao'

    items = _tokenize(line)

    # ------------------------------------------------------------------
    # QUET TOKEN -- logic 2 chieu:
    #   so TRUOC ten  -> "1000 v":    so chuyen sang phai
    #   so SAU  ten   -> "v 1000":    so chuyen sang trai
    #   so giua nhieu ten -> "v g d 1000": ap cho tat ca ten dang cho
    #   pN o CUOI     -> ap nguoc cho ca cau vua doc ("v 500 p2")
    #
    # Cach lam: chia thanh TUNG DOAN (segment). Moi doan bat dau khi gap
    # pN/me hoac khi da "chot" xong mot nhom tai nguyen + so.
    # ------------------------------------------------------------------
    # Buoc 1: tach thanh cac doan theo player
    segs = []          # list of (player_or_None, [items...])
    # CHI 1 SEGMENT: tat ca grant deu cho chinh minh (cur_p luon None).
    # Token 'other' se gay loi khi xu ly.
    segs.append((None, list(items)))

    jobs = []
    err = None

    # Buoc 2: xu ly tung doan
    for pnum, its in segs:
        pend = []          # tai nguyen dang cho so
        carry = None       # so dang cho tai nguyen
        wantfull = False

        for kind, val in its:
            if kind == 'bad':
                err = '"%s" khong hieu. Go "help".' % val
                break

            if kind == 'other':
                err = ('CHI GRANT CHO CHINH MINH.\n'
                       '  Khong ho tro chon nguoi choi khac (%s).\n'
                       '  Go lai khong co "p...": vd  v 1000  hoac  full' % val)
                break

            if kind == 'me':
                continue

            if kind == 'full':
                if carry is not None:
                    for r in ('F', 'W', 'S', 'G'):
                        jobs.append((pnum, r, float(carry)))
                    carry = None
                else:
                    wantfull = True
                continue

            if kind == 'num':
                if wantfull:
                    for r in ('F', 'W', 'S', 'G'):
                        jobs.append((pnum, r, float(val)))
                    wantfull = False
                    pend = []
                elif pend:
                    for r in pend:
                        jobs.append((pnum, r, float(val)))
                    pend = []
                elif carry is not None:
                    # 2 so lien nhau -> so sau thay so truoc? cong don
                    carry = carry + val
                else:
                    carry = val
                continue

            if kind == 'res':
                if carry is not None:
                    jobs.append((pnum, val, float(carry)))
                else:
                    pend.append(val)
                continue

        if err:
            break

        # cuoi doan: chot
        if wantfull:
            for r in ('F', 'W', 'S', 'G'):
                jobs.append((pnum, r, 100000.0))
            wantfull = False
            pend = []
        if pend:
            if carry is not None:
                for r in pend:
                    jobs.append((pnum, r, float(carry)))
            else:
                err = 'thieu so cho: %s' % ', '.join(
                    RES_NAME.get(r, r) for r in pend)
                break

    if err:
        return None, err
    if not jobs:
        return None, 'khong co lenh nao'

    # Buoc 3: pN o CUOI cau -> ap nguoc cho doan cuoi cung truoc do
    # (da xu ly o buoc 1 vi pN tao doan moi; neu pN la token cuoi thi
    #  doan cuoi la rong -> khong con gi de ap, nen bo qua)
    # => khong can xu ly them

    # gop lenh trung
    merged = {}
    order = []
    for so, r, amt in jobs:
        key = (so, r)
        if key not in merged:
            merged[key] = amt
            order.append(key)
        else:
            merged[key] += amt

    out = [(so, r, merged[(so, r)]) for (so, r) in order]
    for so, r, amt in out:
        if amt <= 0:
            return None, 'so phai > 0'
    return out, None


def _parse_number(t):
    """Doc so kieu: 1000 | 1,000 | 1.000 | 1e5 | 1.5k | 2tr | 2m | 3b."""
    s2 = t.strip().lower()
    if not s2:
        return None

    # hau to
    MULT = {'k': 1000.0, 'tr': 1e6, 'm': 1e6, 'b': 1e9,
            'nghin': 1000.0, 'trieu': 1e6, 'ty': 1e9}
    mult = 1.0
    for suf in ('nghin', 'trieu', 'tr', 'ty', 'k', 'm', 'b'):
        if s2.endswith(suf) and len(s2) > len(suf):
            core = s2[:-len(suf)].strip('. ,')
            if core:
                mult = MULT[suf]
                s2 = core
                break

    # bo dau phan cach nghin: 1.000.000 | 1,000,000 | 1 000 000
    if re.fullmatch(r'\d{1,3}(?:[.,]\d{3})+', s2):
        s2 = re.sub(r'[.,]', '', s2)
    else:
        # 1.5 -> 1.5 (thap phan) ; 1,5 -> 1.5
        if re.fullmatch(r'\d+[.,]\d+', s2):
            s2 = s2.replace(',', '.')

    try:
        v = float(s2)
    except ValueError:
        return None
    if v != v or v <= 0:
        return None
    return v * mult


def _interactive_loop(h, base):
    """Vong lap lenh.

    Tra ('quit', None, None) neu thoat.
    Tra ('reconnect', None, None) neu can mo lai process (PID doi / game dong).

    TRUOC MOI LENH: kiem game con song khong, PID co doi khong.
    Neu doi -> tra 'reconnect' de vong ngoai mo lai handle.
    """
    while True:
        # ----- kiem tra game truoc khi cho lenh -----
        state = _check_alive(h)
        if state != 'ok':
            return state, None, None

        try:
            line = input('xa> ').strip()
        except (EOFError, KeyboardInterrupt):
            print()
            return 'quit', None, None
        if not line:
            continue
        low = line.lower()

        if low in ('q', 'quit', 'exit', 'thoat'):
            return 'quit', None, None
        if low in ('help', 'h', '?'):
            _interactive_help()
            continue

        # ----- kiem lai truoc khi lam bat cu gi -----
        state = _check_alive(h)
        if state != 'ok':
            return state, None, None

        if low in ('check', 'xem', 'list'):
            _interactive_show(h, base)
            continue
        if low in ('who', 'toi'):
            _interactive_who(h, base)
            continue
        if low in ('nums', 'so', 'ten'):
            _interactive_names(h, base)
            continue
        if low in ('pid', 'info'):
            _interactive_info(h, base)
            continue
        if low in ('re', 'reconnect', 'lai'):
            return 'reconnect', None, None

        jobs, err = _parse_cmd(line)
        if err:
            print('  LOI: %s' % err)
            continue

        for so, res, amt in jobs:
            state = _check_alive(h)
            if state != 'ok':
                return state, None, None
            if so is None:
                who = 'minh'
            else:
                p = find_by_number(h, so)
                who = ('so %d (%s)' % (so, p['ten'])) if p and p['ten'] else ('so %d' % so)
            print('  --> +%g %s cho %s' % (amt, _vi_name(res), who))
            ok = _interactive_handle(h, base, res, amt, so)
            if not ok:
                print('  THAT BAI')
        print()
        _interactive_show(h, base)


def _interactive_help():
    print()
    print('  === GO THE NAO CUNG DUOC ===')
    print()
    print('  --- TAI NGUYEN (v=vang t=thit g=go d=da) ---')
    print('    v 1000          1000 v         v1000        v=1000')
    print('    V 1.000         v 1tr          v 1.5k       v 2m')
    print('    t 500 v 200     v g d t 1000   1000 v g d t')
    print()
    print('  --- CONG CA 4 CUNG LUC ---')
    print('    full            +100.000 ca 4')
    print('    full 5000       +5.000 ca 4')
    print('    full 1000000    +1.000.000 ca 4')
    print('    50000 full      nhu full 50000')
    print()
    print('  --- LENH KHAC ---')
    print('    check    xem tai nguyen')
    print('    nums     xem so + ten + tai nguyen')
    print('    who      minh la ai')
    print('    pid      xem PID / ket noi')
    print('    re       mo lai process')
    print('    q        thoat')
    print()
    print('  *** CHI GRANT CHO CHINH MINH ***')
    print('  Khong ho tro p1..p8 (chon nguoi choi khac).')
    print()
def interactive():
    """Che do tuong tac -- chay lien tuc, tu tim lai game khi PID doi."""
    print('=' * 72)
    print('  XA GRANT -- CHE DO TUONG TAC')
    print('=' * 72)
    print()

    # License TRUOC, admin SAU (giong thu tu cua ban No Fog).
    try:
        load_engine()
    except NoLicense as e:
        return XL.EXIT_NO_LICENSE
    except Exception as e:
        print('  LOI LICENSE: %s: %s' % (type(e).__name__, e))
        return XL.EXIT_NO_LICENSE

    print('  License: OK')
    _interactive_help()

    if not is_admin():
        print('  !! CAN QUYEN ADMINISTRATOR.')
        print('  Chuot phai Command Prompt > Run as administrator.')
        print()
        try:
            input('  Enter de thoat...')
        except Exception:
            pass
        return XL.EXIT_NOT_ADMIN

    h = None
    pid = None
    base = None
    _check_alive._pid = None

    while True:
        # ---------- mo / mo lai process ----------
        if h is None:
            procs = find_game()
            if not procs:
                print('  [cho] Khong thay EMPIRESX.EXE.')
                print('        Mo game va vao tran. Tool cho, go q de thoat.')
                try:
                    line = input('xa> ').strip().lower()
                except (EOFError, KeyboardInterrupt):
                    print()
                    return 0
                if line in ('q', 'quit', 'exit', 'thoat'):
                    print('  Thoat.')
                    return 0
                if line == 're':
                    continue
                if line:
                    print('  [cho] Chua co game.')
                continue

            pid, name = procs[0]
            try:
                h = open_game(pid)
                base = module_base(h)
                if base != PREFERRED_BASE:
                    print('  base = 0x%08X != 0x%08X. Bo qua lan nay.'
                          % (base, PREFERRED_BASE))
                    try:
                        k32.CloseHandle(h)
                    except Exception:
                        pass
                    h = None
                    continue
                verify_build(h, base)
                _check_alive._pid = pid
                print()
                print('  [ok] %s pid %d  base 0x%08X  signature khop'
                      % (name, pid, base))
                _interactive_who(h, base)
                print('  (go "help" de xem lenh, "q" de thoat)')
                print()
            except Exception as e:
                print('  [loi] khong mo duoc process: %s: %s'
                      % (type(e).__name__, e))
                try:
                    if h:
                        k32.CloseHandle(h)
                except Exception:
                    pass
                h = None
                pid = None
                print('  [cho] Thu lai... (go q de thoat)')
                try:
                    line = input('xa> ').strip().lower()
                except (EOFError, KeyboardInterrupt):
                    return 0
                if line in ('q', 'quit', 'exit', 'thoat'):
                    return 0
                continue

        # ---------- vong lap lenh ----------
        try:
            action, _, _ = _interactive_loop(h, base)
        except Exception as e:
            print('  [loi] %s: %s' % (type(e).__name__, e))
            import traceback
            traceback.print_exc()
            action = 'reconnect'

        if action == 'quit':
            try:
                k32.CloseHandle(h)
            except Exception:
                pass
            print()
            print('  Thoat. Khong co gi duoc ghi lai.')
            return 0

        # action == 'reconnect'
        oldpid = pid
        try:
            k32.CloseHandle(h)
        except Exception:
            pass
        h = None
        pid = None
        base = None
        _check_alive._pid = None

        newpid = _current_pid()
        if newpid:
            print()
            print('  [doi game] PID %s -> %d. Dang mo lai...'
                  % (oldpid if oldpid else '?', newpid))
        else:
            print()
            print('  [mat game] Game da dong (truoc do pid %s).'
                  % (oldpid if oldpid else '?'))
            print('             Tool cho game mo lai. Go q de thoat.')
        # lap lai vong ngoai


def cmd_activate(key, token=None):
    """--key KEY [--token T] : kich hoat license tren may nay."""
    k = XL.norm_key(key)
    if not k:
        print('Thieu ma license.')
        return XL.EXIT_USAGE

    print('=' * 70)
    print('  XA GRANT -- KICH HOAT')
    print('=' * 70)
    print()
    print('  Ma license : %s' % k)

    lic = XL.License()
    try:
        hw = XL.compute_hwid()
    except Exception as e:
        print('  [X] Khong doc duoc HWID: %s' % e)
        return XL.EXIT_USAGE
    print('  May (HWID) : %s' % hw[:16] + '...')
    print()
    print('  Dang lien he server...')

    try:
        lic.activate(k, token)
    except XL.DenyError as e:
        print()
        print('  [X] KICH HOAT THAT BAI: %s' % (e.msg or e.code))
        if e.code == 'rebind_token_required':
            print()
            print('      Ma nay da dung tren may khac.')
            print('      Vao web, muc "License cua toi", bam "Doi may",')
            print('      roi chay lai file cai dat.')
        elif e.code == 'hwid_mismatch':
            print()
            print('      Ma da gan voi may khac. Bam "Doi may" tren web.')
        return XL.EXIT_NO_LICENSE
    except XL.NetError as e:
        print()
        print('  [X] Khong ket noi duoc server: %s' % e)
        print('      Kiem tra mang roi chay lai.')
        return XL.EXIT_NETWORK

    print()
    print('  [OK] KICH HOAT THANH CONG')
    print()
    print('  Goi      : %s' % lic.payload.get('p'))
    if lic.expires_at:
        import datetime
        try:
            exp = datetime.datetime.fromtimestamp(lic.expires_at)
            print('  Het han  : %s' % exp.strftime('%d/%m/%Y %H:%M'))
        except (ValueError, OSError, OverflowError):
            print('  Het han  : %s' % lic.expires_at)
    else:
        print('  Het han  : Vinh vien')
    print()
    print('  Chay tool:  xa_grant.exe')
    print()
    return XL.EXIT_OK


def cmd_status():
    """--status : xem trang thai license, khong cham vao game."""
    print('=' * 70)
    print('  XA GRANT -- TRANG THAI')
    print('=' * 70)
    print()
    try:
        lic = require_license(verbose=True)
    except NoLicense as e:
        print('  Trang thai: CHUA DUNG DUOC (%s)' % e)
        return XL.EXIT_NO_LICENSE
    except Exception as e:
        print('  [X] %s: %s' % (type(e).__name__, e))
        return XL.EXIT_NO_LICENSE

    print('  Ma license : %s' % lic.key)
    print('  May (HWID) : %s' % lic.hwid)
    print('  Goi        : %s' % lic.payload.get('p'))
    if lic.expires_at:
        import datetime
        try:
            exp = datetime.datetime.fromtimestamp(lic.expires_at)
            print('  Het han    : %s' % exp.strftime('%d/%m/%Y %H:%M'))
            left = lic.secs_left()
            if left is not None:
                print('  Con lai    : %.1f gio' % (left / 3600.0))
        except (ValueError, OSError, OverflowError):
            print('  Het han    : %s' % lic.expires_at)
    else:
        print('  Het han    : Vinh vien')
    print('  Che do     : CMD')
    print('  Bang engine: %d dia chi (da xac minh chu ky)'
          % len(lic.addr.dump()['a']))
    print()
    return XL.EXIT_OK


def cmd_rebind(key, token):
    """--rebind KEY TOKEN : doi sang may nay."""
    k = XL.norm_key(key)
    print('=' * 70)
    print('  XA GRANT -- DOI MAY')
    print('=' * 70)
    print()
    lic = XL.License()
    try:
        r = lic.rebind(k, token)
    except XL.DenyError as e:
        print('  [X] That bai: %s' % (e.msg or e.code))
        return XL.EXIT_NO_LICENSE
    except XL.NetError as e:
        print('  [X] Loi mang: %s' % e)
        return XL.EXIT_NETWORK
    print('  [OK] Da doi may. Con %s luot doi may.' % r.get('rebinds_left'))
    print()
    print('  Kich hoat lai:  xa_grant.exe --key %s' % k)
    print()
    return XL.EXIT_OK


def cmd_deactivate():
    """--deactivate : xoa license tren may nay."""
    ok = XL.clear_state()
    print()
    print('  %s' % ('Da xoa license tren may nay.' if ok else 'Khong co gi de xoa.'))
    print('  Key van con hieu luc — chay lai file cai dat de kich hoat lai.')
    print()
    return XL.EXIT_OK


def main():
    args = sys.argv[1:]

    # ------------------------------------------------------------------
    # MAC DINH: CHAY CHE DO TUONG TAC
    # ------------------------------------------------------------------
    if not args:
        return interactive()

    if '--help' in args or '-h' in args:
        print(__doc__)
        try:
            input('\nEnter de thoat...')
        except Exception:
            pass
        return 0
    if '--version' in args or '-v' in args:
        print('XArena Grant %s' % XL.VERSION)
        return 0
    if '--selftest' in args:
        r = selftest()
        if '--pause' in args:
            try:
                input('\nEnter de thoat...')
            except Exception:
                pass
        return r
    if '--interactive' in args or '-i' in args:
        return interactive()

    # ---- Cac lenh license (KHONG can game, KHONG can admin) ----
    if '--key' in args:
        i = args.index('--key')
        if i + 1 >= len(args):
            print('Dung: --key XAGR-XXXX-XXXX-XXXX')
            return XL.EXIT_USAGE
        tok = None
        if '--token' in args:
            j = args.index('--token')
            if j + 1 < len(args):
                tok = args[j + 1]
        return cmd_activate(args[i + 1], tok)

    if '--status' in args:
        return cmd_status()

    if '--rebind' in args:
        i = args.index('--rebind')
        if i + 2 >= len(args):
            print('Dung: --rebind KEY TOKEN')
            return XL.EXIT_USAGE
        return cmd_rebind(args[i + 1], args[i + 2])

    if '--deactivate' in args:
        return cmd_deactivate()

    # ---- Lenh cham vao game: BAT BUOC license hop le ----
    global ALLOW_ONLINE
    gate = GATE_FLAG in args
    ALLOW_ONLINE = gate
    dry_run = '--dry-run' in args
    mode = '--check' if '--check' in args else ('--grant' if '--grant' in args else None)
    if mode is None:
        print('Lenh khong hop le. Xem --help.')
        return XL.EXIT_USAGE

    if mode == '--grant' and not gate:
        print('=' * 70)
        print('TU CHOI: thieu %s' % GATE_FLAG)
        print('=' * 70)
        print('Grant ghi thang vao engine, bo qua logic game binh thuong.')
        print('Trong tran OFFLINE (Single Player) day la duong binh thuong.')
        print('Trong tran ONLINE, peer khong co buoc tuong ung -> co the lech')
        print('checksum / bi kick.')
        print()
        print('Xem truoc khong rui ro (khong ghi gi):')
        print('  xa_grant.exe --grant F 5000 --dry-run')
        print()
        print('Chay that:')
        print('  xa_grant.exe --grant F 5000 %s' % GATE_FLAG)
        return XL.EXIT_NO_LICENSE

    # ---- LICENSE TRUOC, ADMIN SAU ----
    try:
        load_engine()
    except NoLicense as e:
        return XL.EXIT_NO_LICENSE
    except Exception as e:
        print('  LOI LICENSE: %s: %s' % (type(e).__name__, e))
        return XL.EXIT_NO_LICENSE

    if not is_admin():
        print('CAN QUYEN ADMINISTRATOR. Chuot phai Command Prompt -> Run as administrator.')
        return XL.EXIT_NOT_ADMIN

    procs = find_game()
    if not procs:
        print('Khong tim thay EMPIRESX.EXE. Mo game va vao tran truoc.')
        return 1
    pid, name = procs[0]
    print('=' * 70)
    print('XA GRANT -- %s pid %d' % (name, pid))
    print('=' * 70)
    h = open_game(pid)
    try:
        base = module_base(h)
        if base != PREFERRED_BASE:
            raise GrantError('base = 0x%08X != 0x%08X. DUNG.' % (base, PREFERRED_BASE))
        log('open', 'module base = 0x%08X (khop)' % base)
        if mode == '--check':
            return do_check(h, base)
        pos = args.index('--grant')
        rest = [a for a in args[pos + 1:] if not a.startswith('--')]
        if len(rest) < 2:
            print('Dung: --grant SLOT AMOUNT [--for N]   (vd: --grant F 5000)')
            print('  SLOT : F/W/S/G (thit/go/da/vang)')
            print('  --for N : chon nguoi choi thu N trong bang (mac dinh: chinh minh)')
            return XL.EXIT_USAGE

        # --for N: bat buoc khi tool khong tu nhan ra may minh.
        so = None
        if '--for' in args:
            k = args.index('--for')
            if k + 1 >= len(args):
                print('--for can so thu tu (1..8).')
                return XL.EXIT_USAGE
            try:
                so = int(args[k + 1])
            except ValueError:
                print('--for phai la so 1..8, nhan %r' % args[k + 1])
                return XL.EXIT_USAGE
            if not (1 <= so <= 8):
                print('--for phai trong 1..8.')
                return XL.EXIT_USAGE

        return do_grant(h, base, rest[0].upper(), rest[1], dry_run, gate, so)
    except GrantError as e:
        print()
        print('=' * 70)
        print('TU CHOI: %s' % e)
        print('=' * 70)
        print('Khong co gi duoc ghi vao hoac goi trong process.')
        return XL.EXIT_NO_LICENSE
    finally:
        k32.CloseHandle(h)


if __name__ == '__main__':
    # ------------------------------------------------------------------
    # CONG LICENSE -- chay TRUOC moi thu khac.
    #
    # Thu tu bat buoc:
    #   1. Quet moi truong (debugger/VM/Frida). Vi pham -> bao server + dung.
    #   2. Kiem tra dang chay tu CMD (khong cho tao shortcut tro thang EXE).
    #   3. Nap license tu state; neu khong co -> tu choi.
    #   4. Goi server lay token moi (co bang dia chi engine da ky).
    #   5. Chi khi do moi cho phep cham vao game.
    #
    # Khong co buoc nao bi bo qua du goi bang duong nao (--check, --grant,
    # che do tuong tac, hay goi ham truc tiep).
    # ------------------------------------------------------------------
    _rc = 0
    try:
        ok_env, reasons, _detail = xa_sec.scan_environment()
        if not ok_env:
            _LIC = require_license(verbose=True, skip_env_check=True)
            if _LIC:
                _LIC.report_violation(','.join(reasons))
            print()
            print('=' * 70)
            print('TU CHOI: phat hien moi truong phan tich (%s)' % ','.join(reasons))
            print('=' * 70)
            print('Tool khong chay khi:')
            print('  - co debugger dang gan')
            print('  - dang chay trong may ao')
            print('  - co Frida')
            print('  - thoi gian thuc thi bat thuong')
            print()
            print('Hay tat het cong cu go loi roi chay lai.')
            sys.exit(XL.EXIT_TAMPERED)

        if XL.launched_from_explorer() and not ('--rebind' in sys.argv
                                                or '--deactivate' in sys.argv):
            print('=' * 70)
            print('TOOL NAY CHI CHAY BANG CMD')
            print('=' * 70)
            print('Ban vua mo file EXE bang cach bam dup hoac qua shortcut.')
            print('Mo Command Prompt (Win+R -> cmd) roi go:')
            print('    xa_grant.exe' if len(sys.argv) == 1
                  else '    xa_grant.exe ' + ' '.join(sys.argv[1:]))
            print()
            print('Shortcut "XArena Grant" ngoai Desktop cua bo cai dat da mo')
            print('san cua so CMD — dung shortcut do.')
            sys.exit(XL.EXIT_USAGE)

        _rc = main()
    except SystemExit:
        raise
    except BaseException as _e:
        print()
        print('=' * 70)
        print('LOI KHONG MONG DOI: %s: %s' % (type(_e).__name__, _e))
        print('=' * 70)
        import traceback
        traceback.print_exc()
        try:
            input('\nEnter de thoat...')
        except Exception:
            pass
        _rc = 9
    # Neu ket thuc bang loi (khac 0) va dang chay tu console that -> giu cua so
    if _rc not in (0, None) and sys.stdin and sys.stdin.isatty():
        try:
            input('\n[exit code %s] Enter de thoat...' % _rc)
        except Exception:
            pass
    sys.exit(_rc)
