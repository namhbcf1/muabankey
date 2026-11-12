# -*- coding: utf-8 -*-
"""Kiem tra chan an toan: --uninstall/--install KHONG duoc cham vao game Arena."""
import sys, os, io, contextlib
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import xa_nofog_pro as m

GAME_DIR = r'C:\Program Files\XArena'
# Chan elevation khi test: khong muon mo UAC that trong luc chay test.
m.is_admin = lambda: True
print('=== 0. is_admin() bi gia lap = True (tranh mo UAC khi test) ===')
print()
print('=== 1. Mo phong INSTALL_ROOT = thu muc GAME cua khach ===')
m.INSTALL_ROOT = GAME_DIR
m.INSTALL_EXE_DIR = os.path.join(GAME_DIR, '_re', 'chayduoc')
m.INSTALL_EXE = os.path.join(m.INSTALL_EXE_DIR, 'xa_nofog_pro.exe')

print('  _root_owned_by_us()  =', m._root_owned_by_us(), '  <-- PHAI la False')
assert m._root_owned_by_us() is False, 'LOI: guard khong nhan ra thu muc game!'
foreign = m._foreign_files_in_root()
print('  foreign files (dau)  =', foreign[:6])
assert 'Arena.exe' in foreign, 'LOI: khong thay Arena.exe'

print()
print('=== 2. run_uninstall phai TU CHOI xoa, game con nguyen ===')
before = len(os.listdir(GAME_DIR))
buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    rc = m.run_uninstall({'force': False})
out = buf.getvalue()
print('  rc =', rc)
after = len(os.listdir(GAME_DIR))
print('  so muc truoc/sau = %d / %d' % (before, after))
print('  Arena.exe con ton tai =', os.path.isfile(os.path.join(GAME_DIR, 'Arena.exe')))
print('  SoftEther con ton tai =', os.path.isdir(os.path.join(GAME_DIR, 'SoftEther')))
for line in out.splitlines():
    if 'KHONG xoa' in line or 'khong phai cua' in line or 'Arena' in line:
        print('  |', line.strip())
assert os.path.isfile(os.path.join(GAME_DIR, 'Arena.exe')), 'LOI: da xoa game!'
assert after >= before, 'LOI: so muc giam'

print()
print('=== 3. run_install phai TU CHOI cai vao thu muc game ===')
buf2 = io.StringIO()
with contextlib.redirect_stdout(buf2), contextlib.redirect_stderr(io.StringIO()) as ebuf:
    rc2 = m.run_install({'force': False})
print('  rc =', rc2, ' <-- phai la 1')
assert rc2 == 1, 'LOI: install khong tu choi'
assert os.path.isfile(os.path.join(GAME_DIR, 'Arena.exe')), 'LOI: game bi anh huong'

print()
print('=== 4. Thu muc rieng XArenaNoFog: owned=True sau khi tao dau vet ===')
m.INSTALL_ROOT = os.path.join(os.environ.get('TEMP'), '_t_xanf_root')
m.INSTALL_EXE_DIR = os.path.join(m.INSTALL_ROOT, '_re', 'chayduoc')
m.INSTALL_EXE = os.path.join(m.INSTALL_EXE_DIR, 'xa_nofog_pro.exe')
os.makedirs(m.INSTALL_EXE_DIR, exist_ok=True)
print('  owned (rong)         =', m._root_owned_by_us(), ' <-- False')
open(m.INSTALL_EXE, 'wb').write(b'MZ')
print('  owned (co exe cua ta)=', m._root_owned_by_us(), ' <-- True')
assert m._root_owned_by_us() is True
# gia lap co them file la -> phai thanh False
open(os.path.join(m.INSTALL_ROOT, 'Uninstall.exe'), 'wb').write(b'MZ')
print('  owned (+Uninstall.exe)=', m._root_owned_by_us(), ' <-- False (chan)')
assert m._root_owned_by_us() is False
import shutil; shutil.rmtree(m.INSTALL_ROOT, ignore_errors=True)

print()
print('ALL SAFETY GUARD TESTS PASSED')
