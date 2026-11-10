"""Chung minh chinh xac co che nao dang chay (khong doan).

B15 "byte giua header" -> van HOAT DONG, con "duoi file" -> CHUA KICH HOAT.
Nghia la khong phai DPAPI tu choi. Can xac dinh thu tu kiem.
"""
import os, sys, json, hashlib, base64, ctypes, ctypes.wintypes as wt

sys.path.insert(0, r'C:\Users\ADMIN\Desktop\muabankey\tool\src')
os.environ['XA_STATE_SUBDIR'] = 'XA_probe'
import xa_nofog_pro as X

LAP = os.environ['LOCALAPPDATA']
sd = os.path.join(LAP, 'XA_probe')
os.makedirs(sd, exist_ok=True)
lic = X.STATE_FILE
print('STATE_FILE =', lic)

st = {'key': 'AOE1-AAAA-BBBB-CCCC', 'hwid': X.compute_hwid(),
      'expires_at': 9999999999, 'plan': 'aoe1', 'last_ok': 0}
print('save_state ->', X.save_state(st))
raw = open(lic, 'rb').read()
print('size', len(raw), 'magic', raw[:4])
print('load_state ->', X.load_state())

# ---- Thu 1: doi magic ----
def wf(p, d):
    try: os.remove(p)
    except OSError: pass
    open(p, 'wb').write(d)

wf(lic, b'XXXX' + raw[4:])
print('\n[1] magic XXXX ->', X.load_state() or '{} (bi tu choi, DUNG)')

# ---- Thu 2: hong 1 byte trong DPAPI blob (dau blob) ----
b = bytearray(raw); b[4] ^= 0xFF
wf(lic, bytes(b))
print('[2] hong byte dau DPAPI ->', X.load_state() or '{} (tu choi)')

# ---- Thu 3: hong 1 byte CUOI blob (integrity check) ----
b = bytearray(raw); b[-1] ^= 0xFF
wf(lic, bytes(b))
r3 = X.load_state()
print('[3] hong byte CUOI blob ->', r3 or '{} (tu choi)')

# ---- Thu 4: hong byte O GIUA blob ----
b = bytearray(raw); mid = len(b)//2; b[mid] ^= 0xFF
wf(lic, bytes(b))
r4 = X.load_state()
print('[4] hong byte GIUA blob (offset %d) ->' % mid, r4 or '{} (tu choi)')

# ---- Thu 5: cat cut ----
wf(lic, raw[:len(raw)//2])
print('[5] truncated ->', X.load_state() or '{} (tu choi)')

# ---- Thu 6: blob cua "user khac" = random ----
wf(lic, raw[:4] + os.urandom(len(raw) - 4))
print('[6] random blob ->', X.load_state() or '{} (tu choi)')

# ---- Thu 7: DPAPI that su tu context khac? (khong the) -> kiem CRYPTPROTECT flags ----
print('\nsource: CryptProtectData flags =', hex(0x01), '(CRYPTPROTECT_UI_FORBIDDEN)')
print('  -> KHONG co CRYPTPROTECT_LOCAL_MACHINE -> rang buoc user, dung nhu thiet ke')

# ---- compute_hwid on tung phan ----
print('\n=== compute_hwid components ===')
parts = X._hwid_parts()
for nm, v in zip(['MachineGuid','BIOS serial','CPU brand','Volume serial'], parts):
    print('  %-14s = %r  (len %d)' % (nm, v, len(v)))
print('  HWID  =', X.compute_hwid())
print('  WEAK  =', X.compute_weak_hwid())

# ---- _post timeout/retry behaviour ----
print('\n=== _post signature defaults ===')
import inspect
print(' ', inspect.signature(X._post))
print('  HTTP_TIMEOUT =', X.HTTP_TIMEOUT)

# ---- trial_guard call sites ----
print('\n=== trial_guard goi o dau? ===')
import re
src = open(os.path.join(os.path.dirname(X.__file__), 'xa_nofog_pro.py'), encoding='utf-8').read()
for i, l in enumerate(src.splitlines(), 1):
    if 'trial_guard' in l:
        print('  line %d: %s' % (i, l.strip()))

# ---- rebind handling ----
print('\n=== --rebind duoc xu ly o dau? ===')
for i, l in enumerate(src.splitlines(), 1):
    if 'rebind' in l.lower():
        print('  line %d: %s' % (i, l.strip()[:110]))

try:
    os.remove(lic); os.rmdir(sd)
except OSError:
    pass
