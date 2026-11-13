"""Kiem chung guard: phai phat hien debugger/VM that, khong bao nham may that.

Chay: python tool/grant/verify_guard.py
"""
import ctypes
import os
import sys
import threading
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import xa_grant_guard as G  # noqa: E402

try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass

pass_n = fail_n = 0


def ok(name, cond, extra=''):
    global pass_n, fail_n
    if cond:
        pass_n += 1
        print('  PASS  %-42s %s' % (name, extra))
    else:
        fail_n += 1
        print('  FAIL  %-42s %s' % (name, extra))


def main():
    print('=== 1. May hien tai phai SACH (khong bao nham) ===')
    r = G.scan()
    ok('may that -> khong bao dong', r['ok'], r['code'] or '')

    print()
    print('=== 2. Phat hien debugger ===')
    # DebugActiveProcess can quyen admin. Neu khong co (err=5), thu cach khac:
    # GHI truc tiep PEB.BeingDebugged = 1 (cung co che ma debugger that dung).
    got_before = G._is_debugger_present()
    ok('truoc khi gia lap -> khong bao', got_before is False, 'got=%s' % got_before)

    patched = False
    try:
        import ctypes.wintypes as wt
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
        if st == 0 and pbi.PebBaseAddress:
            at = ctypes.cast(ctypes.c_void_p(pbi.PebBaseAddress + 2),
                             ctypes.POINTER(ctypes.c_ubyte))
            old = at[0]
            at[0] = 1              # bat co nhu debugger that
            patched = True
            try:
                got = G._is_debugger_present()
                sc = G.scan()
                ok('gia lap PEB.BeingDebugged=1 -> phat hien',
                   got is True, 'IsDebugger=%s' % got)
                ok('scan() bao debugger', sc['code'] == G.CODES[G.DEBUGGER],
                   sc['code'])
            finally:
                at[0] = old        # tra lai
        else:
            ok('doc duoc PEB', False, 'status=%s' % st)
    except Exception as e:
        ok('gia lap PEB', False, str(e)[:60])

    if not patched:
        ok('khong gia lap duoc PEB', False, 'bo qua')

    print()
    print('=== 3. Phat hien dau hieu may ao (gia lap registry) ===')
    # Khong the tao may ao that, nen kiem tra logic nhan dien bang cach
    # xac nhan bo dau hieu duoc nap dung va ham xu ly token chay dung.
    ok('danh sach dau hieu may ao co', len(G._VM_MARKS) >= 7,
       '%d muc' % len(G._VM_MARKS))
    ok('co token CPU hypervisor', len(G._VM_CPU_TOKENS) >= 7,
       ','.join(G._VM_CPU_TOKENS[:3]) + '...')
    vm = G._vm_signals()
    ok('may that -> _vm_signals() rong', vm == [], ','.join(vm[:3]))

    print()
    print('=== 4. Fingerprint on dinh trong mot lan chay ===')
    a = G.self_fingerprint()
    b = G.self_fingerprint()
    ok('goi 2 lan cung ket qua', a == b and len(a) == 64, a[:16] + '...')

    print()
    print('=== 5. verify_integrity ===')
    okv, act = G.verify_integrity('')
    ok('expected rong -> bo qua (True)', okv, act[:16] + '...')
    okv2, _ = G.verify_integrity('0' * 64)
    ok('sai fingerprint -> False', okv2 is False, 'ok=%s' % okv2)
    okv3, _ = G.verify_integrity(act)
    ok('dung fingerprint -> True', okv3 is True, 'ok=%s' % okv3)

    print()
    print('=' * 58)
    print('Tong: %d  |  PASS %d  |  FAIL %d' % (pass_n + fail_n, pass_n, fail_n))
    if fail_n:
        return 1
    print('GUARD HOAT DONG DUNG')
    return 0


if __name__ == '__main__':
    sys.exit(main())
