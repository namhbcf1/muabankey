# -*- coding: utf-8 -*-
"""Test nhanh cac ham moi cua xa_nofog_pro (khong dung toi license/server)."""
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import xa_nofog_pro as m

print('CLIENT_VERSION   :', m.CLIENT_VERSION)
print('is_admin()       :', m.is_admin())
print('INSTALL_ROOT     :', m.INSTALL_ROOT)
print('INSTALL_EXE      :', m.INSTALL_EXE)
print('is_installed()   :', m.is_installed())
print('running_from_inst:', m.running_from_install())
print('current_exe      :', m._current_exe())
print('programdata_dir  :', m._programdata_dir())
print('desktop_dir      :', m._desktop_dir())
print('shortcuts        :', m._shortcut_paths())
print('breadcrumb       :', m._install_breadcrumb())
print('lock_path        :', m._lock_path())
print('legacy lock      :', m._LOCK_FILE_LEGACY)
print()
print('-- version compare --')
for a, b in (('1.4.1', '1.4.0'), ('1.4.0', '1.4.1'), ('1.4.1', '1.4.1'),
             ('1.4', '1.4.0'), ('1.10.0', '1.9.9'), ('1.4.1', ''), ('', '1.0')):
    print('  cmp(%-7r,%-7r) = %2d' % (a, b, m._ver_cmp(a, b)))
print()
print('-- check_min_version --')
for r in ({}, {'min_ver': '1.4.0'}, {'min_ver': '1.4.1'},
          {'min_ver': '2.0.0'}, {'min_version': '9.9'}):
    print('  %-28s -> %s' % (r, m.check_min_version(r)))
print()
print('-- parse_args --')
for argv in (['--install'], ['--cai-dat'], ['--caidat'], ['--uninstall'],
             ['--go-cai'], ['--gocai'], ['--remove'], ['--install', '--force'],
             ['--status'], ['--bogus']):
    o, e = m.parse_args(argv)
    if e:
        print('  %-24s -> ERR %s' % (' '.join(argv), e))
    else:
        tags = [k for k in ('install', 'uninstall', 'force', 'status')
                if o.get(k)]
        print('  %-24s -> ok %s' % (' '.join(argv), tags))
print()
print('-- runasadmin read --')
print('  has_runasadmin(INSTALL_EXE) =', m._has_runasadmin(m.INSTALL_EXE))
print()
print('ALL HELPERS OK')
