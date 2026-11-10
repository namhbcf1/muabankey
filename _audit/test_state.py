"""Test B15-B26 + A2 (parse_args) + cac tinh huong state/mutex/dong ho."""
import os, sys, json, time, shutil, subprocess, socket, hashlib
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from harness import run_case, show, RESULTS, ROOT, CLIENT, PY

AUD = os.path.dirname(os.path.abspath(__file__))
LAP = os.environ.get('LOCALAPPDATA')

def free_port():
    s = socket.socket(); s.bind(('127.0.0.1', 0)); p = s.getsockname()[1]; s.close(); return p

PORT = free_port()
BASE = 'http://127.0.0.1:%d' % PORT

def start_mock(mode='ok'):
    p = subprocess.Popen([PY, os.path.join(AUD, 'mock_server.py'), str(PORT), mode],
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(80):
        try:
            s = socket.create_connection(('127.0.0.1', PORT), 0.15); s.close(); return p
        except OSError:
            time.sleep(0.05)
    raise RuntimeError('mock fail')

def mkstate(sub):
    d = os.path.join(LAP, sub)
    if os.path.isdir(d): shutil.rmtree(d, ignore_errors=True)
    os.makedirs(d, exist_ok=True)
    return d

def seed(sub, mockp):
    """Tao lic.bin hop le qua mock."""
    d = mkstate(sub)
    env = dict(os.environ); env.update({'XA_API_BASE': BASE, 'XA_STATE_SUBDIR': sub,
                                        'PYTHONIOENCODING': 'utf-8'})
    subprocess.run([PY, CLIENT, '--key', 'AOE1-TEST-TEST-TEST'],
                   capture_output=True, env=env, cwd=ROOT, timeout=40)
    return d

mock = start_mock('ok')
time.sleep(0.2)

# ============ A2: parse_args ============
print('\n\n############ A2: parse_args ############')
CASES = [
    ('khong tham so', []),
    ('--key thieu gia tri', ['--key']),
    ('--rebind thieu 2', ['--rebind', 'A']),
    ('--rebind thieu 1', ['--rebind', 'A', 'B']),
    ('tham so la', ['--khongtontai']),
    ('--help', ['--help']),
    ('-h', ['-h']),
    ('--HELP (hoa)', ['--HELP']),
    ('--Status (hoa)', ['--Status']),
    ('--key rong', ['--key', '']),
    ('--key + --status', ['--key', 'X', '--status']),
    ('--list', ['--list']),
]
for label, args in CASES:
    r = run_case('A2 ' + label, {'XA_API_BASE': 'http://127.0.0.1:1'},
                 args=args, timeout=30, state_subdir='XA_audit_A2')
    first = (r['stdout'].strip().splitlines() or ['(rong)'])[0][:90]
    err1 = (r['stderr'].strip().splitlines() or [''])[0][:90]
    print('  %-22s rc=%-3s out=%-60s err=%s' % (label, r['rc'], first, err1))

# ============ B15: lic.bin bi hong ============
print('\n\n############ B15: lic.bin bi hong ############')
sd = seed('XA_audit_B15', mock)
lic = os.path.join(sd, 'lic.bin')
raw = open(lic, 'rb').read()
print('  lic.bin size =', len(raw), 'magic =', raw[:4])

def wf(path, data):
    """Ghi file: xoa truoc (file do tien trinh con tao co ACL chi RX)."""
    try:
        os.remove(path)
    except OSError:
        pass
    with open(path, 'wb') as f:
        f.write(data)


for off, label in [(0, 'magic XANF hong'), (10, 'byte giua header'), (len(raw) - 5, 'duoi file')]:
    b = bytearray(raw)
    for i in range(off, min(off + 8, len(b))):
        b[i] ^= 0xFF
    wf(lic, bytes(b))
    r = run_case('B15 corrupt@%d %s' % (off, label), {'XA_API_BASE': BASE},
                 args=['--status'], timeout=40, state_subdir='XA_audit_B15')
    print('  %-30s rc=%s  ->' % (label, r['rc']),
          [l for l in r['stdout'].splitlines() if 'Trang thai' in l or 'Loai' in l])

# truncated
wf(lic, raw[:len(raw)//2])
r = run_case('B15 truncated', {'XA_API_BASE': BASE}, args=['--status'],
             timeout=40, state_subdir='XA_audit_B15')
print('  truncated                      rc=%s  ->' % r['rc'],
      [l for l in r['stdout'].splitlines() if 'Trang thai' in l])

# rong
wf(lic, b'')
r = run_case('B15 empty', {'XA_API_BASE': BASE}, args=['--status'],
             timeout=40, state_subdir='XA_audit_B15')
print('  empty file                     rc=%s  ->' % r['rc'],
      [l for l in r['stdout'].splitlines() if 'Trang thai' in l])

# lic.bin la thu muc
shutil.rmtree(sd, ignore_errors=True); os.makedirs(os.path.join(sd, 'lic.bin'))
r = run_case('B15 lic.bin la thu muc', {'XA_API_BASE': BASE}, args=['--status'],
             timeout=40, state_subdir='XA_audit_B15')
print('  lic.bin la THU MUC             rc=%s  ->' % r['rc'],
      [l for l in r['stdout'].splitlines() if 'Trang thai' in l])

# ============ B16: DPAPI user khac ============
print('\n\n############ B16: lic.bin tu user Windows khac ############')
sd = seed('XA_audit_B16', mock)
lic = os.path.join(sd, 'lic.bin')
raw = open(lic, 'rb').read()
# Gia lap DPAPI blob cua user khac: giu magic, thay phan con lai bang blob gia
fake = raw[:4] + os.urandom(len(raw) - 4)
wf(lic, fake)
r = run_case('B16 DPAPI user khac', {'XA_API_BASE': BASE}, args=['--status'],
             timeout=40, state_subdir='XA_audit_B16')
print('  DPAPI blob la -> rc=%s' % r['rc'])
print('  ' + '\n  '.join(r['stdout'].splitlines()))

# ============ B20: --trial khi da co license ============
print('\n\n############ B20: --trial khi da co license ############')
seed('XA_audit_B20', mock)
r = run_case('B20 --trial khi da co license', {'XA_API_BASE': BASE},
             args=['--trial'], timeout=40, state_subdir='XA_audit_B20')
print('  rc=%s' % r['rc'])
print('  ' + '\n  '.join(r['stdout'].splitlines()[:6]))

# ============ B20b: --trial khi da co TRIAL ============
print('\n############ B20b: --trial khi dang la trial ############')
mkstate('XA_audit_B20b')
env = dict(os.environ); env.update({'XA_API_BASE': BASE, 'XA_STATE_SUBDIR': 'XA_audit_B20b',
                                    'PYTHONIOENCODING': 'utf-8'})
p = subprocess.run([PY, CLIENT, '--trial'], capture_output=True, env=env, cwd=ROOT, timeout=40)
print('  lan 1 (tao trial) rc=', p.returncode)
print('  ' + '\n  '.join(p.stdout.decode('utf-8','replace').splitlines()[:10]))
p = subprocess.run([PY, CLIENT, '--trial'], capture_output=True, env=env, cwd=ROOT, timeout=40)
print('  lan 2 (da la trial) rc=', p.returncode)
print('  ' + '\n  '.join(p.stdout.decode('utf-8','replace').splitlines()[:10]))

# ============ B21: --buy ============
print('\n\n############ B21: --buy ############')
env = dict(os.environ); env.update({'XA_API_BASE': BASE, 'XA_STATE_SUBDIR': 'XA_audit_B21',
                                    'PYTHONIOENCODING': 'utf-8'})
p = subprocess.run([PY, CLIENT, '--buy'], capture_output=True, env=env, cwd=ROOT, timeout=25)
print('  rc=%s' % p.returncode)
print('  out: ' + p.stdout.decode('utf-8','replace').strip()[:400])

# ============ B17: 2 instance cung luc (mutex) ============
print('\n\n############ B17: mutex 2 instance ############')
import ctypes, ctypes.wintypes as wt
k32 = ctypes.WinDLL('kernel32', use_last_error=True)
CTRL_EVENT = 0x0001; SYNCHRONIZE = 0x00100000; WAIT_OBJECT_0 = 0
def sa():
    class SECURITY_ATTRIBUTES(ctypes.Structure):
        _fields_ = [('nLength', wt.DWORD), ('lpSecurityDescriptor', ctypes.c_void_p),
                    ('bInheritHandle', wt.BOOL)]
    s = SECURITY_ATTRIBUTES(); s.nLength = ctypes.sizeof(s); s.lpSecurityDescriptor = None
    s.bInheritHandle = False
    return s
h1 = k32.CreateMutexW(ctypes.byref(sa()), False, 'Global\\XArenaNoFogPro')
e1 = ctypes.get_last_error()
h2 = k32.CreateMutexW(ctypes.byref(sa()), False, 'Global\\XArenaNoFogPro')
e2 = ctypes.get_last_error()
print('  CreateMutexW#1 handle=%s err=%d' % (h1, e1))
print('  CreateMutexW#2 handle=%s err=%d  (183=%s)' % (h2, e2, e2 == 183))

# ============ B18: khong co admin ############
print('\n\n############ B18: require_admin khi khong phai admin ############')
print('  is_admin hien tai:',
      bool(ctypes.WinDLL('shell32').IsUserAnAdmin()))

# ============ B26: dong ho lui ############
print('\n\n############ B26: phat hien dong ho lui ############')
sd = seed('XA_audit_B26', mock)
# Ghi moc thoi gian cao (1 nam sau) vao file anchor + registry
import winreg
FUT = int(time.time()) + 365*86400
SALT = b'xanf-anchor-v1'
body = str(FUT).encode()
mac = hashlib.sha256(SALT + body).digest()
for pth in [os.path.join(sd, 'ts'),
            os.path.join(os.environ.get('PROGRAMDATA', r'C:\ProgramData'),
                         'Microsoft', 'Crypto', 'RSA', 'upd.dat')]:
    try:
        os.makedirs(os.path.dirname(pth), exist_ok=True)
        wf(pth, SALT + body + mac)
        print('  da ghi moc tuong lai vao', pth)
    except Exception as e:
        print('  KHONG ghi duoc', pth, e)
try:
    with winreg.CreateKeyEx(winreg.HKEY_CURRENT_USER,
            r'Software\Microsoft\Windows\CurrentVersion\XASupport', 0, winreg.KEY_WRITE) as k:
        winreg.SetValueEx(k, 'LastRun', 0, winreg.REG_SZ, str(FUT))
    print('  da ghi registry LastRun =', FUT)
except Exception as e:
    print('  registry fail:', e)

r = run_case('B26 dong ho lui -> --status', {'XA_API_BASE': BASE},
             args=['--status'], timeout=40, state_subdir='XA_audit_B26')
print('  rc=%s' % r['rc'])
for l in r['stdout'].splitlines():
    if any(k in l for k in ('Trang thai', 'Dong ho', 'Gio server')):
        print('   ', l)

# va voi --key (dong ho lui + activate)
r = run_case('B26 dong ho lui -> --key', {'XA_API_BASE': BASE},
             args=['--key', 'AOE1-TEST-TEST-TEST'], timeout=40, state_subdir='XA_audit_B26b')
print('  --key khi dong ho lui: rc=%s' % r['rc'])
print('  ' + '\n  '.join(r['stdout'].splitlines()[:8]))

json.dump(RESULTS, open(os.path.join(AUD, 'res_state.json'), 'w', encoding='utf-8'),
          ensure_ascii=False, indent=1)
mock.terminate()
print('\n\nDA LUU res_state.json (%d case)' % len(RESULTS))
