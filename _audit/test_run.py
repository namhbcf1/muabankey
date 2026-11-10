"""B25 Ctrl-C, B17 mutex o muc tool, --rebind fallthrough, require_admin gia lap."""
import os, sys, json, time, shutil, subprocess, signal, ctypes, ctypes.wintypes as wt
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from harness import run_case, RESULTS, ROOT, CLIENT, PY

LAP = os.environ['LOCALAPPDATA']
AUD = os.path.dirname(os.path.abspath(__file__))

def env_for(sub, base='http://127.0.0.1:1'):
    e = dict(os.environ)
    e.update({'XA_API_BASE': base, 'XA_STATE_SUBDIR': sub, 'PYTHONIOENCODING': 'utf-8',
              'PYTHONUTF8': '1'})
    return e

print('############ --rebind: co xu ly khong? ############')
sub = 'XA_audit_rb'
pr = subprocess.Popen([PY, CLIENT, '--rebind', 'AOE1-AAAA-BBBB-CCCC', 'tok123'],
                      stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                      env=env_for(sub, 'http://127.0.0.1:1'), cwd=ROOT)
try:
    out, err = pr.communicate(timeout=25)
    print('  rc=%s' % pr.returncode)
    print('  out:', out.decode('utf-8', 'replace').strip()[:400])
    print('  err:', err.decode('utf-8', 'replace').strip()[:200])
except subprocess.TimeoutExpired:
    pr.kill(); out, err = pr.communicate()
    print('  !! TREO >25s (khong thoat) -> da kill')
    print('  out:', out.decode('utf-8', 'replace').strip()[:400])
    print('  ==> --rebind KHONG co handler: roi xuong require_license() -> mo hop thoai')
    print('      nhap key (tkinter) va treo vo han. Token bi bo qua hoan toan.')

print('\n############ B25: Ctrl-C khi dang chay thuong tru ############')
# Can license de vao duoc vong lap: dung mock
def free_port():
    import socket
    s = socket.socket(); s.bind(('127.0.0.1', 0)); pt = s.getsockname()[1]; s.close(); return pt
PORT = free_port()
BASE = 'http://127.0.0.1:%d' % PORT
mock = subprocess.Popen([PY, os.path.join(AUD, 'mock_server.py'), str(PORT), 'ok'],
                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(0.6)

sub = 'XA_audit_cc'
sd = os.path.join(LAP, sub)
shutil.rmtree(sd, ignore_errors=True)
# tao license truoc
subprocess.run([PY, CLIENT, '--key', 'AOE1-TEST-TEST-TEST'], capture_output=True,
               env=env_for(sub, BASE), cwd=ROOT, timeout=40)
print('  lic.bin:', os.path.exists(os.path.join(sd, 'lic.bin')))

# chay thuong tru roi gui Ctrl-C (CTRL_C_EVENT toi process group)
DETACHED = 0x00000008
p = subprocess.Popen([PY, CLIENT], stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                     env=env_for(sub, BASE), cwd=ROOT,
                     creationflags=subprocess.CREATE_NEW_PROCESS_GROUP)
time.sleep(4.0)
print('  dang chay, pid=%d alive=%s' % (p.pid, p.poll() is None))
# Gui CTRL_C_EVENT
k32 = ctypes.WinDLL('kernel32')
k32.GenerateConsoleCtrlEvent.argtypes = [wt.DWORD, wt.DWORD]
ok = k32.GenerateConsoleCtrlEvent(0, p.pid)
print('  GenerateConsoleCtrlEvent(CTRL_C) ->', ok)
try:
    out, err = p.communicate(timeout=15)
    print('  rc=%s' % p.returncode)
    print('  out:')
    for l in out.decode('utf-8', 'replace').strip().splitlines()[-8:]:
        print('   ', l)
    if err.strip():
        print('  err:', err.decode('utf-8', 'replace').strip()[:300])
except subprocess.TimeoutExpired:
    print('  !! KHONG THOAT sau Ctrl-C -> kill')
    p.kill(); out, err = p.communicate()
    print('  out:', out.decode('utf-8', 'replace')[-500:])

print('\n############ B17b: 2 instance thuong tru (mutex) ############')
p1 = subprocess.Popen([PY, CLIENT], stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                      env=env_for(sub, BASE), cwd=ROOT)
time.sleep(3.5)
p2 = subprocess.run([PY, CLIENT], capture_output=True, env=env_for(sub, BASE),
                    cwd=ROOT, timeout=40)
print('  instance 2 rc=%s (mong doi 4 = EXIT_ALREADY_RUNNING)' % p2.returncode)
print('  out:', p2.stdout.decode('utf-8', 'replace').strip()[:300])
print('  err:', p2.stderr.decode('utf-8', 'replace').strip()[:200])
p1.terminate()
try: p1.wait(timeout=6)
except Exception: p1.kill()

print('\n############ require_admin: gia lap KHONG phai admin ############')
code = r'''
import sys, ctypes
sys.path.insert(0, r"C:\Users\ADMIN\Desktop\muabankey\tool\src")
import xa_nofog_pro as X

# Gia lap IsUserAnAdmin = False
X.is_admin = lambda: False
# Chan ShellExecuteW de khong thuc su bam UAC
calls = []
def fake_se(hwnd, verb, exe, params, cwd, show):
    calls.append((verb, exe, params))
    return 42   # >32 = thanh cong
X.shell32.ShellExecuteW = fake_se

try:
    X.require_admin(allow_view=False)
except SystemExit as e:
    print("SystemExit rc =", e.code)
print("ShellExecuteW calls:", calls)
print()
print("--- allow_view=True (--status) ---")
r = X.require_admin(allow_view=True)
print("returned (khong xin UAC):", r)
'''
o = subprocess.run([PY, '-c', code], capture_output=True, text=True, timeout=60,
                   env={**os.environ, 'XA_API_BASE': 'http://127.0.0.1:1'})
print(o.stdout.strip())
if o.stderr.strip():
    print('  stderr:', o.stderr.strip()[:400])

mock.terminate()
shutil.rmtree(os.path.join(LAP, sub), ignore_errors=True)
shutil.rmtree(os.path.join(LAP, 'XA_audit_rb'), ignore_errors=True)
print('\nDONE')
