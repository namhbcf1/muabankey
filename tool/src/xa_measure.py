#!/usr/bin/env python3
"""xa_measure.py -- DO XEM tai nguyen co nam trong checksum hay khong.

DAY LA PHEP DO QUAN TRONG NHAT, chua ai lam trong toan bo du an.

Y TUONG
=======
`C:\\aoesync.txt` ghi CA HAI dong o CUNG mot turn:

    01: 00512310 00001250 025982 00000000 -460434578 00090095
    02: 00512310 00001250 025982 00000000 -460384578 00090095
                                          ^^^^^^^^^^ ^^^^^^^^
                                          CksumNew   Position (giong het)

P1 = may minh, P2 = may kia bao len. Cung turn, cung Random, cung Position.
Chi CksumNew khac -> hieu chinh la dong gop tai nguyen.

Nen CHI CAN MOT MAY de do. Khong can doc log may kia.

CACH DOC KET QUA
================
Ghi +1000 food, roi xem hieu P1-P2 o turn lech:

    hieu = 1000        -> tai nguyen vao checksum day du (trong so 1)
    hieu = 232         -> chi 1 byte  (1000 & 0xFF = 232)
    hieu = 0 / khong lech -> TAI NGUYEN NGOAI CHECKSUM -> ghi tu do duoc
    hieu = so khac     -> trong so khac 1, can do them

CACH DUNG
=========
    python xa_measure.py                 # tu dong: baseline -> ghi -> do
    python xa_measure.py --amount 1000   # doi luong ghi (mac dinh 1000)
    python xa_measure.py --res F         # F/W/S/G (mac dinh F)
    python xa_measure.py --watch         # chi theo doi, khong ghi
    python xa_measure.py --read          # chi doc tai nguyen hien tai

CAN: quyen Administrator + game dang chay + da vao tran that (>=2 nguoi).
"""
import ctypes
import ctypes.wintypes as wt
import os
import re
import sys
import time

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

PROCESS_NAMES = ('EMPIRESX.EXE', 'EMPIRESX_HD.EXE', 'EMPIRESX_HDR.EXE')
PREFERRED_BASE = 0x400000
SYNC_LOG = r'C:\aoesync.txt'

# Chuoi con tro tai nguyen (da verify byte trong doc)
PTR_WORLD = 0x585E88
OFF_MANAGER = 0x3F4
OFF_SLOTS = 0x3C
OFF_WRAPARRAY = 0x40
OFF_PLAYER = 0x50
RES_OFF = {'F': 0x00, 'W': 0x04, 'S': 0x08, 'G': 0x0C}
RES_NAME = {'F': 'food', 'W': 'wood', 'S': 'stone', 'G': 'gold'}

ACCESS = 0x0438
SYNC = 0x00100000
TH32CS_SNAPPROCESS = 0x2
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
    base = mods[0]
    if not base:
        k32.CloseHandle(h)
        return None, None
    return h, base


def u32(h, a):
    buf = ctypes.create_string_buffer(4)
    g = ctypes.c_size_t(0)
    if not k32.ReadProcessMemory(h, ctypes.c_void_p(a), buf, 4, ctypes.byref(g)):
        return 0
    return int.from_bytes(buf.raw[:4], 'little')


def f32(h, a):
    buf = ctypes.create_string_buffer(4)
    g = ctypes.c_size_t(0)
    if not k32.ReadProcessMemory(h, ctypes.c_void_p(a), buf, 4, ctypes.byref(g)):
        return None
    return struct_unpack_f(buf.raw[:4])


def struct_unpack_f(b):
    import struct
    return struct.unpack('<f', b)[0]


def wr_f32(h, addr, val):
    import struct
    data = struct.pack('<f', float(val))
    old = wt.DWORD()
    if not k32.VirtualProtectEx(h, ctypes.c_void_p(addr), 4, 0x40, ctypes.byref(old)):
        return False
    ok = False
    try:
        w = ctypes.c_size_t(0)
        ok = bool(k32.WriteProcessMemory(h, ctypes.c_void_p(addr), data, 4,
                                         ctypes.byref(w))) and w.value == 4
    finally:
        d = wt.DWORD()
        k32.VirtualProtectEx(h, ctypes.c_void_p(addr), 4, old.value, ctypes.byref(d))
    return ok


def get_player(h, base):
    """Tra (playerdata, dict tai nguyen) hoac (0, None)."""
    delta = base - PREFERRED_BASE
    world = u32(h, PTR_WORLD + delta)
    if not world:
        return 0, None
    mgr = u32(h, world + OFF_MANAGER)
    if not mgr:
        return 0, None
    slots = u32(h, mgr + OFF_SLOTS) & 0xFFFF
    arr = u32(h, mgr + OFF_WRAPARRAY)
    if not arr:
        return 0, None
    for s in range(min(slots, 16)):
        wrp = u32(h, arr + s * 4)
        if not wrp:
            continue
        pd = u32(h, wrp + OFF_PLAYER)
        if not pd:
            continue
        vals = {}
        for k, o in RES_OFF.items():
            v = f32(h, pd + o)
            if v is None:
                break
            vals[k] = v
        else:
            return pd, vals
    return 0, None


LINE_RE = re.compile(r'^\s*(\d\d):\s+([0-9A-Fa-f]+)\s+([0-9A-Fa-f]+)\s+'
                     r'([0-9A-Fa-f]+)\s+([0-9A-Fa-f]+)\s+(-?\d+)\s+(\d+)')


def parse_log(path):
    """Tra list dict moi dong du lieu."""
    rows = []
    try:
        with open(path, 'r', encoding='utf-8', errors='replace') as f:
            for i, l in enumerate(f):
                m = LINE_RE.match(l)
                if m:
                    rows.append({
                        'line': i, 'plr': m.group(1),
                        'wtime': int(m.group(2), 16),
                        'turn': int(m.group(3), 16),
                        'rand': int(m.group(4), 16),
                        'ck': int(m.group(6)),
                        'pos': int(m.group(7)),
                    })
    except Exception:
        pass
    return rows


def mismatches(rows):
    """Nhom theo (wtime, turn) va tra cac turn co P1 != P2."""
    from collections import OrderedDict
    g = OrderedDict()
    for r in rows:
        g.setdefault((r['wtime'], r['turn']), []).append(r)
    out = []
    for k, v in g.items():
        if len(v) == 2:
            p1 = next((x for x in v if x['plr'] == '01'), None)
            p2 = next((x for x in v if x['plr'] == '02'), None)
            if p1 and p2:
                d = p1['ck'] - p2['ck']
                same = (p1['rand'] == p2['rand'] and p1['pos'] == p2['pos'])
                if d != 0:
                    out.append({'wtime': k[0], 'turn': k[1], 'p1': p1['ck'],
                                'p2': p2['ck'], 'delta': d, 'other_same': same})
    return out


def main():
    args = sys.argv[1:]
    amount = 1000.0
    res = 'F'
    watch_only = '--watch' in args
    read_only = '--read' in args

    for i, a in enumerate(args):
        if a == '--amount' and i + 1 < len(args):
            amount = float(args[i + 1])
        if a == '--res' and i + 1 < len(args):
            res = args[i + 1].upper()

    if '--help' in args or '-h' in args:
        print(__doc__)
        return 0

    if not is_admin():
        print('CAN QUYEN ADMINISTRATOR.')
        print('  Chuot phai vao Command Prompt -> Run as administrator')
        print('  roi chay lai lenh nay.')
        return 5

    procs = find_game()
    if not procs:
        print('Khong tim thay game. Mo EMPIRESX.EXE va vao tran truoc.')
        return 1

    procs.sort(key=lambda p: 0 if p[1].lower() == 'empiresx.exe' else 99)
    pid, name = procs[0]
    h, base = attach(pid)
    if not h:
        print('Khong mo duoc pid %d' % pid)
        return 1

    print('=' * 66)
    print('XA MEASURE -- %s pid %d base 0x%08X' % (name, pid, base))
    print('=' * 66)

    pd, vals = get_player(h, base)
    if not pd:
        print('KHONG TIM THAY playerdata.')
        print('  Nguyen nhan: chua vao tran (dang o menu/lobby).')
        print('  -> Vao tran that roi chay lai.')
        k32.CloseHandle(h)
        return 1

    print()
    print('Tai nguyen hien tai (slot dau tien):')
    for k in ('F', 'W', 'S', 'G'):
        print('  %-6s %-8s = %g' % (k, RES_NAME[k], vals.get(k, 0)))

    if read_only:
        k32.CloseHandle(h)
        return 0

    if not os.path.exists(SYNC_LOG):
        print()
        print('CHUA CO %s' % SYNC_LOG)
        print('  File nay chi duoc tao khi engine that su chay lockstep')
        print('  (>=2 nguoi that, da vao tran).')
        k32.CloseHandle(h)
        return 1

    before = parse_log(SYNC_LOG)
    n_before = len(before)
    mis_before = mismatches(before)
    print()
    print('Log hien co: %d dong du lieu, %d turn lech san' % (n_before, len(mis_before)))
    if mis_before:
        last = mis_before[-1]
        print('  Turn lech gan nhat: wtime %d turn 0x%X  delta %d'
              % (last['wtime'], last['turn'], last['delta']))

    if watch_only:
        print()
        print('CHE DO THEO DOI. Ghi tai nguyen bang tool khac, script nay se bao.')
        print('Ctrl-C de dung.')
        try:
            while True:
                time.sleep(3)
                cur = parse_log(SYNC_LOG)
                if len(cur) > n_before:
                    newmis = mismatches(cur)
                    if len(newmis) > len(mis_before):
                        for m in newmis[len(mis_before):]:
                            print('  [LECH] turn 0x%X  P1=%d P2=%d  delta=%d  %s'
                                  % (m['turn'], m['p1'], m['p2'], m['delta'],
                                     'cot khac giong' if m['other_same'] else
                                     'COT KHAC CUNG LECH'))
                    n_before = len(cur)
                    mis_before = newmis
        except KeyboardInterrupt:
            k32.CloseHandle(h)
            print('\nDung.')
        return 0

    # ---- Do ----
    print()
    print('BUOC 1: ghi +%g %s' % (amount, RES_NAME.get(res, res)))
    addr = pd + RES_OFF[res]
    old = vals.get(res, 0)
    if not wr_f32(h, addr, old + amount):
        print('  GHI THAT BAI (khong co quyen ghi?)')
        k32.CloseHandle(h)
        return 1
    nv = f32(h, addr)
    print('  truoc = %g   sau = %g   (da ghi)' % (old, nv))

    print()
    print('BUOC 2: cho engine tinh lai checksum...')
    print('  (co the mat 5-60 giay. Dung tat game.)')

    found = None
    t0 = time.time()
    last_report = 0
    try:
        while time.time() - t0 < 120:
            time.sleep(2)
            cur = parse_log(SYNC_LOG)
            newmis = mismatches(cur)
            # tim turn lech MOI xuat hien sau khi ghi
            if len(newmis) > len(mis_before):
                found = newmis[-1]
                break
            el = int(time.time() - t0)
            if el - last_report >= 10:
                print('    ...%ds  (%d dong log)' % (el, len(cur)))
                last_report = el
    except KeyboardInterrupt:
        pass

    k32.CloseHandle(h)

    print()
    print('=' * 66)
    print('KET QUA')
    print('=' * 66)

    if not found:
        print('KHONG THAY TURN LECH MOI trong 120 giay.')
        print()
        print('Y NGHIA:')
        print('  Tai nguyen KHONG nam trong checksum -> ghi tu do duoc.')
        print('  Day la ket qua TOT NHAT: khong can patch gi.')
        print()
        print('  NHUNG kiem tra lai:')
        print('   - Ban co that su o trong tran (>=2 nguoi that)?')
        print('   - File %s co duoc ghi them dong nao khong?' % SYNC_LOG)
        print('   - Tai nguyen trong game co tang that khong?')
        return 0

    d = found['delta']
    print('Turn lech: wtime %d  turn 0x%X' % (found['wtime'], found['turn']))
    print('  P1 (may ban) = %d' % found['p1'])
    print('  P2 (may kia) = %d' % found['p2'])
    print('  HIEU         = %d' % d)
    print('  Cot khac (Random, Position) giong nhau? %s'
          % ('CO' if found['other_same'] else 'KHONG'))
    print()
    print('PHAN TICH:')
    print('  Da ghi +%g %s' % (amount, RES_NAME.get(res, res)))
    onebyte = int(amount) & 0xFF
    print('  Neu tai nguyen vao day du  -> hieu phai la %d' % int(amount))
    print('  Neu chi 1 byte (nhom 8 bit) -> hieu phai la %d' % onebyte)
    print()
    if abs(abs(d) - int(amount)) < 2:
        print('  >>> KET LUAN: tai nguyen VAO CHECKSUM DAY DU (trong so 1).')
        print('      Muon mot may khong lech -> phai che checksum (nhom B).')
    elif abs(abs(d) - onebyte) < 2:
        print('  >>> KET LUAN: tai nguyen chi chiem 1 BYTE (nhom 8 bit).')
        print('      Voi +%g thi dong gop la %d, khong phai %d.'
              % (amount, onebyte, int(amount)))
        print('      => Ghi so lon (>=256) co the KHONG lam lech checksum!')
        print('      Thu lai voi +100000 de xem dong gop co tang khong.')
    elif abs(d) < 2:
        print('  >>> KET LUAN: gan nhu khong lech -> tai nguyen ngoai checksum.')
    else:
        print('  >>> KET LUAN: hieu = %d, KHONG khop ca hai gia thuyet.' % d)
        print('      Co the turn lech nay do nguyen nhan khac, khong phai tai nguyen.')
        print('      Chay lai, hoac tang luong ghi de phan biet.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
