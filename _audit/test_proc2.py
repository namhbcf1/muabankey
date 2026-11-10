"""Doc lap: tim game, attach, doc/ghi byte, va kiem tra tinh huong bi tu choi."""
import os, sys, time, shutil, subprocess

LAP = os.environ['LOCALAPPDATA']
FAKE = os.path.join(LAP, 'fakegame2')

os.makedirs(FAKE, exist_ok=True)
exe = os.path.join(FAKE, 'EMPIRESX.EXE')
shutil.copy2(sys.executable, exe)
print('fake game:', exe, '(copy cua python.exe)')

p = subprocess.Popen([exe, '-c', 'import time\nwhile True: time.sleep(0.5)'], cwd=FAKE)
time.sleep(2.0)
try:
    o = subprocess.run(['tasklist', '/FI', 'IMAGENAME eq EMPIRESX.EXE', '/FO', 'CSV', '/NH'],
                       capture_output=True, text=True)
    print('tasklist:', (o.stdout or '').strip().splitlines()[:1])

    code = r'''
import sys, ctypes
sys.path.insert(0, r"C:\Users\ADMIN\Desktop\muabankey\tool\src")
import xa_nofog_pro as X

procs = X.find_game()
print("find_game ->", procs)
if not procs:
    raise SystemExit(0)
pid, nm = procs[0]
h, base = X.attach(pid)
print("attach -> h=%r base=0x%x" % (h, base or 0))
if not h:
    raise SystemExit(0)
print("base - 0x400000 = 0x%x" % (base - X.PREFERRED_BASE))
print("base co phai 0x400000? ", base == 0x400000)
print("=> dia chi thuc se la base + (va - 0x400000); neu base la 0x140000000 thi")
print("   0x%08X (T1) se doc vao 0x%08X" % (0x514E0F, base + (0x514E0F - 0x400000)))

# doc thu 1 dia chi
a = base + (0x514E0F - X.PREFERRED_BASE)
b = X.rd(h, a, 4)
print("rd(0x%08X,4) -> %r" % (a, b))

# patch: mong doi 'other:<hex>' vi day khong phai game that
st = X.patch(h, base, X.CORE[0])
print("patch T1 ->", st)

# write_at co ghi duoc khong (thu vao vung .rdata cua process khac)
print("_alive(h) ->", X._alive(h))

# dump_state
print("dump_state:")
X.dump_state(h, base, X.CORE)
X.kernel32.CloseHandle(h)
'''
    o = subprocess.run([sys.executable, '-c', code], capture_output=True, text=True,
                       timeout=120, env={**os.environ, 'XA_API_BASE': 'http://127.0.0.1:1'})
    print('--- probe ---')
    for l in (o.stdout or '').strip().splitlines():
        print('  ' + l)
    if o.stderr.strip():
        print('  STDERR:', o.stderr.strip()[:600])
finally:
    p.terminate()
    try: p.wait(timeout=5)
    except Exception: p.kill()
    time.sleep(0.5)
    shutil.rmtree(FAKE, ignore_errors=True)
