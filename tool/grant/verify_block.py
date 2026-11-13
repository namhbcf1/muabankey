"""Kiem chung guard CHAN THAT khi phat hien debugger.

Gia lap PEB.BeingDebugged=1 roi goi ensure_engine -> phai TU CHOI.
Chay: python tool/grant/verify_block.py
"""
import ctypes
import ctypes.wintypes as wt
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass


def _peb_addr():
    ntdll = ctypes.WinDLL('ntdll', use_last_error=True)
    k32 = ctypes.WinDLL('kernel32', use_last_error=True)

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
    rl = wt.ULONG(0)
    st = ntdll.NtQueryInformationProcess(
        k32.GetCurrentProcess(), 0, ctypes.byref(pbi),
        ctypes.sizeof(pbi), ctypes.byref(rl))
    if st != 0 or not pbi.PebBaseAddress:
        return None
    return pbi.PebBaseAddress


def main():
    import xa_grant as G

    tokfile = os.path.join(os.environ.get('TEMP', '/tmp'), 'xg-g.txt')
    tok = ''
    if os.path.exists(tokfile):
        tok = open(tokfile, encoding='utf-8').read().strip()
    if not tok:
        print('Khong thay token de test.')
        return 2

    print('=== 1. Binh thuong -> ensure_engine PHAI cho qua ===')
    ok1, msg1 = G.ensure_engine(tok)
    print('  ok =', ok1, '|', (msg1 or '')[:60])
    if not ok1:
        print('  LOI: guard chan sai tren may sach')
        return 1

    print()
    print('=== 2. Gia lap debugger -> PHAI tu choi ===')
    peb = _peb_addr()
    if not peb:
        print('  Khong doc duoc PEB')
        return 1
    at = ctypes.cast(ctypes.c_void_p(peb + 2),
                     ctypes.POINTER(ctypes.c_ubyte))
    old = at[0]
    at[0] = 1
    try:
        ok2, msg2 = G.ensure_engine(tok)
        print('  ok =', ok2)
        print('  msg:', (msg2 or '').replace('\n', ' | ')[:120])
    finally:
        at[0] = old

    print()
    print('=== 3. Sau khi bo gia lap -> cho qua lai ===')
    ok3, _ = G.ensure_engine(tok)
    print('  ok =', ok3)

    print()
    print('=' * 56)
    if ok1 and (not ok2) and ok3:
        print('GUARD CHAN DUNG: sach->chay, debugger->chan, bo->chay lai')
        return 0
    print('SAI: mong doi (True, False, True) nhan (%s, %s, %s)' % (ok1, ok2, ok3))
    return 1


if __name__ == '__main__':
    sys.exit(main())
