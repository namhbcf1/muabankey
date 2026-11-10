"""Test B19, B22-B25 + lop process/patch voi tien trinh gia lap EMPIRESX.EXE."""
import os, sys, json, time, shutil, subprocess, ctypes, ctypes.wintypes as wt
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from harness import run_case, RESULTS, ROOT, CLIENT, PY

LAP = os.environ['LOCALAPPDATA']
FAKE = os.path.join(LAP, 'fakegame')

def mkfake():
    """Copy mot exe that he 32-bit/64-bit ra ten EMPIRESX.EXE."""
    os.makedirs(FAKE, exist_ok=True)
    dst = os.path.join(FAKE, 'EMPIRESX.EXE')
    # Dung exe he thong (64-bit) lam gia lap: khong co dia chi va nao dung
    for cand in [r'C:\Windows\SysWOW64\notepad.exe', r'C:\Windows\System32\notepad.exe',
                 r'C:\Windows\SysWOW64\cmd.exe', r'C:\Windows\System32\timeout.exe']:
        if os.path.exists(cand):
            shutil.copy2(cand, dst)
            return dst, cand
    raise RuntimeError('khong co exe mau')

print('############ B22: game khong chay ############')
r = run_case('B22 --once khong co game', {'XA_API_BASE': 'http://127.0.0.1:1'},
             args=['--once'], timeout=40, state_subdir='XA_audit_B22')
print('  --once  rc=%s' % r['rc'])
print('  ' + '\n  '.join(r['stdout'].splitlines()[:6]))
print('  err: ' + (r['stderr'].strip().splitlines() or [''])[0][:120])

r = run_case('B22b --off khong co game', {'XA_API_BASE': 'http://127.0.0.1:1'},
             args=['--off'], timeout=40, state_subdir='XA_audit_B22')
print('  --off   rc=%s' % r['rc'])
print('  ' + '\n  '.join(r['stdout'].splitlines()[:8]))

r = run_case('B22c --dump khong co game', {'XA_API_BASE': 'http://127.0.0.1:1'},
             args=['--dump'], timeout=40, state_subdir='XA_audit_B22')
print('  --dump  rc=%s' % r['rc'])
print('  ' + '\n  '.join(r['stdout'].splitlines()[:4]))

print('\n############ B22d: --off co can license khong? ############')
r = run_case('B22d --off khong license', {'XA_API_BASE': 'http://127.0.0.1:1'},
             args=['--off'], timeout=40, state_subdir='XA_audit_B22d', delete_state=True)
print('  --off khong lic  rc=%s (mong doi: chay toi buoc tim game, KHONG hoi key)' % r['rc'])
print('  ' + '\n  '.join(r['stdout'].splitlines()[:6]))
if r['stdout'] and 'Nhap ma' in r['stdout']:
    print('  !!! --off VAN hoi key')

print('\n############ B23: game chay (gia lap) ############')
exe, src = mkfake()
print('  fake exe:', exe, '(copy tu', src, ')')
p = subprocess.Popen([exe], cwd=FAKE)
time.sleep(1.5)
try:
    import subprocess as sp
    o = sp.run(['tasklist', '/FI', 'IMAGENAME eq EMPIRESX.EXE', '/FO', 'CSV', '/NH'],
               capture_output=True, text=True)
    print('  tasklist:', o.stdout.strip().splitlines()[0][:90] if o.stdout.strip() else '(khong thay)')

    # Goi find_game() truc tiep qua import
    code = r'''
import sys
sys.path.insert(0, r"C:\Users\ADMIN\Desktop\muabankey\tool\src")
import xa_nofog_pro as X
print("find_game ->", X.find_game())
procs = X.find_game()
if procs:
    pid, nm = procs[0]
    h, base = X.attach(pid)
    print("attach -> h=%s base=0x%x" % (h, base or 0))
    if h:
        print("base - PREFERRED_BASE = 0x%x" % (base - X.PREFERRED_BASE))
        st = X.patch(h, base, X.CORE[0])
        print("patch(CORE[0]=%s) -> %s" % (X.CORE[0][0], st))
        st = X.patch(h, base, X.CORE[0], restore=True)
        print("patch restore     -> %s" % st)
        X.kernel32.CloseHandle(h)
'''
    o = sp.run([PY, '-c', code], capture_output=True, text=True, timeout=90,
               env={**os.environ, 'XA_API_BASE': 'http://127.0.0.1:1'})
    print('  --- import-level probe ---')
    for l in (o.stdout or '').strip().splitlines():
        print('   ', l)
    if o.stderr.strip():
        print('  stderr:', o.stderr.strip()[:400])
finally:
    p.terminate()
    try: p.wait(timeout=5)
    except Exception: p.kill()

print('\n############ B23b: --dump voi game gia lap (khong co dia chi that) ############')
p = subprocess.Popen([exe], cwd=FAKE)
time.sleep(1.5)
try:
    r = run_case('B23b --dump voi game gia', {'XA_API_BASE': 'http://127.0.0.1:1'},
                 args=['--dump'], timeout=60, state_subdir='XA_audit_B23')
    print('  --dump rc=%s' % r['rc'])
    print('  ' + '\n  '.join(r['stdout'].splitlines()[:22]))
    if r['stderr'].strip():
        print('  stderr: ' + r['stderr'].strip()[:300])
finally:
    p.terminate()
    try: p.wait(timeout=5)
    except Exception: p.kill()

print('\n############ B23c: --once voi game gia lap (patch that bai) ############')
p = subprocess.Popen([exe], cwd=FAKE)
time.sleep(1.5)
try:
    r = run_case('B23c --once game gia (patch fail)', {'XA_API_BASE': 'http://127.0.0.1:1'},
                 args=['--once'], timeout=60, state_subdir='XA_audit_B23c')
    print('  --once rc=%s' % r['rc'])
    print('  ' + '\n  '.join(r['stdout'].splitlines()[:10]))
    if r['stderr'].strip():
        print('  stderr: ' + r['stderr'].strip()[:300])
finally:
    p.terminate()
    try: p.wait(timeout=5)
    except Exception: p.kill()

shutil.rmtree(FAKE, ignore_errors=True)
json.dump(RESULTS, open(os.path.join(os.path.dirname(os.path.abspath(__file__)),
          'res_proc.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('\nDA LUU res_proc.json')
