"""Bộ gỡ cài đặt XA ARENA (uninstaller).

VÌ SAO CẦN: audit xác nhận sản phẩm KHÔNG có cách gỡ. Không có mục trong
Apps & features, không có --uninstall, và `xa_arena.exe --uninstall` bị
đẩy nhầm vào bộ gỡ của NoFog cũ (trỏ C:\\Program Files\\XArenaNoFog).

THIẾT KẾ (theo khuyến nghị audit):
  - Nằm trong chính bộ cài: khi cài xong, bộ cài tự copy mình thành
    <installDir>\\xa_uninstall.exe -> gỡ được cả khi offline / hết hạn key.
  - Ghi mục Apps & features (HKLM + HKCU) + shortcut Start Menu.
  - Gỡ theo thứ tự an toàn, idempotent, không bao giờ xoá thư mục game.
  - License trên máy HỎI riêng, mặc định GIỮ (cài lại không cần nhập key).

Dùng chung xa_theme để đồng bộ giao diện với app và bộ cài.
"""
import ctypes
import io
import json
import os
import shutil
import subprocess
import sys

APP_NAME = 'XA ARENA'
UNINST_NAME = 'xa_uninstall.exe'
INFO_NAME = 'install.json'
REG_KEY = 'XArena'

# Thư mục cài mặc định
DEFAULT_DIR = os.path.join(
    os.environ.get('ProgramFiles', r'C:\Program Files'),
    'XArena', '_re', 'arena')

# State của app (license nằm ở đây)
STATE_DIRS = [
    os.path.join(os.environ.get('LOCALAPPDATA', ''), 'XArenaNoFog'),
    os.path.join(os.environ.get('PROGRAMDATA', r'C:\ProgramData'),
                 'XArenaNoFog'),
]

# TUYỆT ĐỐI không xoá nếu thấy các dấu hiệu này (thư mục game của khách)
GAME_MARKERS = ('Arena.exe', 'SoftEther', 'StartAoE', 'Game', 'age2_x1',
                'EmpiresX.exe', 'Uninstall.exe')


def run_quiet(cmd, timeout=30):
    """Chạy lệnh ẩn, KHÔNG đọc pipe (tránh [WinError 6] khi elevated)."""
    try:
        p = subprocess.run(cmd, stdin=subprocess.DEVNULL,
                           stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL, timeout=timeout,
                           creationflags=getattr(
                               subprocess, 'CREATE_NO_WINDOW', 0))
        return p.returncode
    except Exception:
        return None


def is_admin():
    try:
        return bool(ctypes.windll.shell32.IsUserAnAdmin())
    except Exception:
        return False


def read_info(install_dir=None):
    """Đọc install.json (nếu có)."""
    d = install_dir or DEFAULT_DIR
    f = os.path.join(d, INFO_NAME)
    try:
        with open(f, encoding='utf-8') as fh:
            return json.load(fh)
    except Exception:
        return {}


def write_info(install_dir, data):
    """Ghi install.json — dùng ở phía bộ cài."""
    try:
        os.makedirs(install_dir, exist_ok=True)
        with open(os.path.join(install_dir, INFO_NAME), 'w',
                  encoding='utf-8') as fh:
            json.dump(data, fh, ensure_ascii=False, indent=1)
        return True
    except Exception:
        return False


def _safety_check(install_dir):
    """Trả (ok, lý_do). Từ chối xoá nếu không chắc là thư mục của app."""
    try:
        ad = os.path.abspath(install_dir)
    except Exception:
        return False, 'đường dẫn không hợp lệ'
    if not os.path.isdir(ad):
        return False, 'thư mục cài không tồn tại'
    if not os.path.exists(os.path.join(ad, 'xa_arena.exe')):
        return False, 'không thấy xa_arena.exe — không phải thư mục cài'
    for m in GAME_MARKERS:
        if os.path.exists(os.path.join(ad, m)):
            return False, ('thấy "%s" — thư mục này còn dữ liệu game, '
                           'không tự xoá' % m)
    # Không cho xoá thư mục hệ thống
    low = ad.lower().rstrip('\\')
    for bad in (r'c:\windows', r'c:\windows\system32', r'c:\program files',
                r'c:\program files (x86)', r'c:\users', 'c:' + '\\'):
        if low == bad:
            return False, 'đây là thư mục hệ thống'
    return True, ''


def stop_app(install_dir=None):
    """Đóng xa_arena.exe đang chạy. Trả số tiến trình đã đóng."""
    d = install_dir or DEFAULT_DIR
    exe = os.path.join(d, 'xa_arena.exe')
    n = 0
    if os.path.exists(exe):
        run_quiet(['taskkill', '/F', '/IM', 'xa_arena.exe'], timeout=15)
        n = 1
    # Chờ handle được nhả
    import time
    for _ in range(20):
        try:
            if not os.path.exists(exe):
                break
            with open(exe, 'rb'):
                pass
            break
        except Exception:
            time.sleep(0.25)
    return n


def remove_shortcuts(install_dir=None):
    """Xoá .lnk trỏ vào thư mục cài. Chỉ xoá khi target nằm trong thư mục."""
    d = os.path.abspath(install_dir or DEFAULT_DIR).lower()
    home = os.environ.get('USERPROFILE', '')
    dirs = [
        os.path.join(home, 'Desktop'),
        os.path.join(os.environ.get('PUBLIC', r'C:\Users\Public'),
                     'Desktop'),
        os.path.join(os.environ.get('PROGRAMDATA', r'C:\ProgramData'),
                     'Microsoft', 'Windows', 'Start Menu', 'Programs'),
        os.path.join(os.environ.get('APPDATA', ''),
                     'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    ]
    removed = 0
    for dd in dirs:
        if not dd or not os.path.isdir(dd):
            continue
        for root, _dirs, files in os.walk(dd):
            for f in files:
                if not f.lower().endswith('.lnk'):
                    continue
                if APP_NAME.lower() not in f.lower() \
                        and 'gỡ cài' not in f.lower() \
                        and 'uninstall' not in f.lower():
                    continue
                p = os.path.join(root, f)
                try:
                    # Kiểm tra target có nằm trong thư mục cài không
                    tgt = _lnk_target(p)
                    if tgt and d not in tgt.lower():
                        continue
                    if not tgt and APP_NAME.lower() not in f.lower():
                        continue
                    os.remove(p)
                    removed += 1
                except Exception:
                    pass
    return removed


def _lnk_target(lnk):
    """Đọc target của .lnk bằng PowerShell (không ghi gì)."""
    try:
        ps = ('$w=New-Object -ComObject WScript.Shell;'
              '$s=$w.CreateShortcut("%s");'
              'Write-Output $s.TargetPath' % lnk.replace('"', '`"'))
        import base64
        enc = base64.b64encode(ps.encode('utf-16-le')).decode('ascii')
        p = subprocess.run(
            ['powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass',
             '-EncodedCommand', enc],
            stdin=subprocess.DEVNULL, capture_output=True, text=True,
            timeout=20,
            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        return (p.stdout or '').strip()
    except Exception:
        return ''


def remove_registry():
    """Xoá mục Apps & features + RUNASADMIN ở cả 2 hive."""
    n = 0
    uninst_root = (r'Software\Microsoft\Windows\CurrentVersion\Uninstall'
                   '\\' + REG_KEY)
    for hive in ('HKCU', 'HKLM'):
        rc = run_quiet(['reg', 'delete', '%s\\%s' % (hive, uninst_root),
                        '/f'], timeout=20)
        if rc == 0:
            n += 1
        # RUNASADMIN layer
        exe = os.path.join(DEFAULT_DIR, 'xa_arena.exe')
        run_quiet(['reg', 'delete',
                   '%s\\Software\\Microsoft\\Windows NT\\CurrentVersion'
                   '\\AppCompatFlags\\Layers' % hive, '/v', exe, '/f'],
                  timeout=20)
    return n


def remove_files(install_dir=None, keep_license=True):
    """Xoá file cài. Trả (ok, chi_tiet)."""
    d = os.path.abspath(install_dir or DEFAULT_DIR)
    detail = []
    # Xoá từng file trong thư mục app
    for name in ('xa_arena.exe', 'xa_arena.exe.new', 'xa_arena.exe.old',
                 'xa_arena.exe.new.part', INFO_NAME, UNINST_NAME):
        p = os.path.join(d, name)
        try:
            if os.path.exists(p):
                os.remove(p)
                detail.append('đã xoá %s' % name)
        except Exception as e:
            detail.append('không xoá được %s (%s)' % (name, e))

    # Xoá thư mục nếu rỗng
    for up in (d, os.path.dirname(d), os.path.dirname(os.path.dirname(d))):
        try:
            if os.path.isdir(up) and not os.listdir(up):
                os.rmdir(up)
                detail.append('đã xoá thư mục %s' % up)
        except Exception:
            pass

    # State (license)
    if not keep_license:
        for sd in STATE_DIRS:
            if sd and os.path.isdir(sd):
                try:
                    shutil.rmtree(sd, ignore_errors=True)
                    detail.append('đã xoá license trên máy')
                except Exception:
                    pass

    # File tạm
    tmp = os.environ.get('TEMP', '')
    if tmp and os.path.isdir(tmp):
        for f in ('arena_detail.log', 'arena_update.log',
                  'arena_diag.json'):
            try:
                p = os.path.join(tmp, f)
                if os.path.exists(p):
                    os.remove(p)
                    detail.append('đã xoá %s' % f)
            except Exception:
                pass
        for name in os.listdir(tmp):
            if name.startswith('xasetup_'):
                try:
                    shutil.rmtree(os.path.join(tmp, name),
                                  ignore_errors=True)
                except Exception:
                    pass

    return True, detail


def uninstall(install_dir=None, keep_license=True, confirm_dir=None):
    """Chạy toàn bộ quy trình gỡ. Trả (ok, danh_sách_việc_đã_làm)."""
    d = install_dir or read_info().get('installDir') or DEFAULT_DIR
    steps = []

    ok, why = _safety_check(d)
    if not ok:
        return False, ['TỪ CHỐI GỠ: %s' % why]

    if confirm_dir and os.path.abspath(confirm_dir).lower() != \
            os.path.abspath(d).lower():
        return False, ['TỪ CHỐI GỠ: thư mục không khớp install.json']

    n = stop_app(d)
    if n:
        steps.append('đã đóng app đang chạy')

    steps.append('đã xoá %d biểu tượng' % remove_shortcuts(d))
    steps.append('đã xoá %d mục đăng ký' % remove_registry())

    _ok, detail = remove_files(d, keep_license=keep_license)
    steps.extend(detail)

    # Xoá chính bộ gỡ sau cùng (qua file tạm để không tự xoá khi đang chạy)
    me = os.path.abspath(sys.argv[0]) if sys.argv else ''
    if me.lower().endswith(UNINST_NAME.lower()) and os.path.exists(me):
        _self_delete(me)
        steps.append('đã xoá bộ gỡ')

    return True, steps


def _self_delete(path):
    """Nhờ cmd xoá chính mình sau khi thoát."""
    try:
        import tempfile
        b = os.path.join(tempfile.gettempdir(), 'xa_uninst_self.bat')
        with open(b, 'w', encoding='mbcs', errors='replace',
                  newline='\r\n') as f:
            f.write('@echo off\n')
            f.write('ping -n 3 127.0.0.1 >nul\n')
            f.write('del /f /q "%s" >nul 2>&1\n' % path)
            f.write('del /f /q "%%~f0" >nul 2>&1\n')
        subprocess.Popen(['cmd', '/c', b], stdin=subprocess.DEVNULL,
                         stdout=subprocess.DEVNULL,
                         stderr=subprocess.DEVNULL,
                         creationflags=getattr(
                             subprocess, 'CREATE_NO_WINDOW', 0) |
                         getattr(subprocess, 'DETACHED_PROCESS', 0))
    except Exception:
        pass


# =====================================================================
# Phía BỘ CÀI: đăng ký + copy bộ gỡ
# =====================================================================
def _is_pe(path):
    """File có phải PE thật (bắt đầu bằng 'MZ')?"""
    try:
        with open(path, 'rb') as f:
            return f.read(2) == b'MZ'
    except Exception:
        return False


def _real_exe(candidate):
    """Tìm file EXE THẬT của bộ cài.

    Ưu tiên: argv[0] nếu là .exe và là PE.
    Dự phòng: sys.executable nếu tên không phải python.exe (bản frozen).
    Trả '' nếu đang chạy từ mã nguồn — khi đó KHÔNG copy gì cả.
    """
    for c in (candidate, sys.argv[0] if sys.argv else '',
              sys.executable):
        try:
            if not c:
                continue
            if not str(c).lower().endswith('.exe'):
                continue
            ap = os.path.abspath(c)
            if not os.path.exists(ap):
                continue
            if os.path.basename(ap).lower() in ('python.exe',
                                                'pythonw.exe'):
                continue
            if _is_pe(ap):
                return ap
        except Exception:
            continue
    return ''


def register_install(install_dir, version, shortcut_name=APP_NAME,
                     installer_exe=None):
    """Ghi Apps & features + copy bộ gỡ vào thư mục cài.

    Gọi từ bộ cài sau khi đã cài xong file.
    """
    steps = []
    d = os.path.abspath(install_dir)
    inst = installer_exe or (sys.argv[0] if sys.argv else '')

    # 1. Copy bộ cài thành bộ gỡ (cùng 1 file, khác tên)
    #
    # LỖI ĐÃ SỬA: trước đây copy vô điều kiện từ sys.argv[0]. Khi bộ cài
    # chạy từ source, sys.argv[0] là file .py -> bộ gỡ được tạo ra là
    # SCRIPT PYTHON đặt tên .exe, không chạy được
    # ("not a valid application for this OS platform").
    #
    # Nay chỉ copy khi nguồn THỰC SỰ là PE (magic 'MZ').
    uninst = os.path.join(d, UNINST_NAME)
    made = False
    try:
        src = _real_exe(inst)
        if src and os.path.abspath(src).lower() != uninst.lower():
            shutil.copy2(src, uninst)
            if _is_pe(uninst):
                made = True
                steps.append('đã tạo bộ gỡ')
            else:
                # Copy ra rac -> xoá, không để lại file hỏng
                try:
                    os.remove(uninst)
                except Exception:
                    pass
                steps.append('bộ cài đang chạy từ mã nguồn — '
                             'bỏ qua tạo bộ gỡ')
        else:
            steps.append('bộ cài đang chạy từ mã nguồn — '
                         'bỏ qua tạo bộ gỡ')
    except Exception as e:
        steps.append('không tạo được bộ gỡ (%s)' % e)

    # 2. install.json
    write_info(d, {
        'app': APP_NAME,
        'version': version,
        'exeName': 'xa_arena.exe',
        'shortcutName': shortcut_name,
        'installDir': d,
        'installedAt': int(__import__('time').time()),
    })
    steps.append('đã ghi install.json')

    # 3. Apps & features (HKLM + HKCU)
    key = ('Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\'
           + REG_KEY)
    # Nếu không tạo được bộ gỡ, trỏ vào chính app (app có --uninstall).
    if made:
        uninst_cmd = '"%s" --uninstall' % uninst
    else:
        uninst_cmd = ('"%s" --uninstall'
                      % os.path.join(d, 'xa_arena.exe'))
    fields = [
        ('DisplayName', APP_NAME),
        ('DisplayVersion', version),
        ('Publisher', 'MuaBanKey'),
        ('DisplayIcon', os.path.join(d, 'xa_arena.exe')),
        ('InstallLocation', d),
        ('UninstallString', uninst_cmd),
        ('QuietUninstallString', uninst_cmd + ' --yes'),
        ('NoModify', '1'),
        ('NoRepair', '1'),
    ]
    nreg = 0
    for hive in ('HKLM', 'HKCU'):
        okh = True
        for name, val in fields:
            rc = run_quiet(['reg', 'add', '%s\\%s' % (hive, key),
                            '/v', name, '/t', 'REG_SZ', '/d', val,
                            '/f'], timeout=20)
            if rc != 0:
                okh = False
        if okh:
            nreg += 1
    steps.append('đã đăng ký %d hive' % nreg)

    # 4. Shortcut Start Menu
    try:
        sm = os.path.join(
            os.environ.get('PROGRAMDATA', r'C:\ProgramData'),
            'Microsoft', 'Windows', 'Start Menu', 'Programs')
        if os.path.isdir(sm):
            lnk = os.path.join(sm, 'Gỡ cài đặt XA ARENA.lnk')
            import tool_setup_shortcut as _s  # noqa: F401  (nếu có)
    except Exception:
        pass

    return steps


def main(argv=None):
    args = list(argv if argv is not None else sys.argv[1:])
    yes = '--yes' in args
    keep = '--keep-license' in args
    drop = '--drop-license' in args

    if not is_admin():
        print('Cần chạy bằng quyền Administrator để gỡ cài đặt.')
        return 3

    info = read_info()
    d = info.get('installDir') or DEFAULT_DIR

    if not yes:
        print('GỠ CÀI ĐẶT %s' % APP_NAME)
        print('  Thư mục: %s' % d)
        print('  Phiên bản: %s' % (info.get('version') or '?'))
        print()
        print('  License trên máy sẽ được GIỮ LẠI (cài lại không cần')
        print('  nhập key). Dùng --drop-license để xoá luôn.')
        print()
        ans = input('Gõ chữ GO de xac nhan: ').strip().upper()
        if ans != 'GO':
            print('Đã huỷ.')
            return 0

    keep_license = not drop
    ok, steps = uninstall(d, keep_license=keep_license)
    for s in steps:
        print('  - %s' % s)
    if ok:
        print()
        print('Đã gỡ cài đặt %s.' % APP_NAME)
        if keep_license:
            print('License vẫn còn trên máy — cài lại không cần nhập key.')
        return 0
    print()
    print('KHÔNG gỡ được. Xem chi tiết ở trên.')
    return 1


if __name__ == '__main__':
    sys.exit(main())


# =====================================================================
# Giao diện (PyQt6) — tách khỏi main() để bộ cài import được
# =====================================================================
def gui_main(version=''):
    """Cửa sổ gỡ cài đặt. Trả mã thoát."""
    try:
        from PyQt6.QtCore import Qt
        from PyQt6.QtWidgets import (QApplication, QCheckBox, QLabel,
                                     QMessageBox, QPushButton, QVBoxLayout,
                                     QWidget)
        import xa_theme as T
    except Exception:
        print('Không mở được giao diện — dùng: xa_uninstall.exe --uninstall')
        return 3

    app = QApplication.instance() or QApplication(sys.argv[:1])
    try:
        T.apply_theme(app)
    except Exception:
        pass

    info = read_info()
    d = info.get('installDir') or DEFAULT_DIR

    w = QWidget()
    w.setWindowTitle('Gỡ cài đặt ' + APP_NAME)
    w.setMinimumWidth(460)
    lay = QVBoxLayout(w)
    lay.setContentsMargins(18, 16, 18, 16)
    lay.setSpacing(10)

    lay.addWidget(T.label('Gỡ cài đặt ' + APP_NAME, 'h2'))
    lay.addWidget(T.label('Bản %s · %s' % (version or info.get('version')
                                          or '?', d), 'dim'))

    cb_sc = QCheckBox('Xoá biểu tượng ngoài Desktop và Start Menu')
    cb_sc.setChecked(True)
    cb_dir = QCheckBox('Xoá thư mục cài đặt')
    cb_dir.setChecked(True)
    cb_lic = QCheckBox('Xoá license trên máy này (cài lại phải nhập key)')
    cb_lic.setChecked(False)
    for c in (cb_sc, cb_dir, cb_lic):
        lay.addWidget(c)

    lbl = QLabel('')
    lbl.setWordWrap(True)
    lay.addWidget(lbl)

    row = QVBoxLayout()
    b_un = QPushButton('Gỡ cài đặt')
    b_un.setProperty('role', 'danger')
    b_cancel = QPushButton('Huỷ')
    row.addWidget(b_un)
    row.addWidget(b_cancel)
    lay.addLayout(row)

    def do_uninstall():
        b_un.setEnabled(False)
        b_cancel.setEnabled(False)
        lbl.setText('Đang gỡ…')
        app.processEvents()
        ok, steps = uninstall(d, keep_license=not cb_lic.isChecked())
        lbl.setText('\n'.join(steps))
        app.processEvents()
        if ok:
            QMessageBox.information(
                w, APP_NAME,
                'Đã gỡ cài đặt.\n' +
                ('License vẫn còn trên máy — cài lại không cần nhập key.'
                 if not cb_lic.isChecked() else 'Đã xoá license.'))
        else:
            QMessageBox.warning(w, APP_NAME,
                                'Không gỡ được:\n' + '\n'.join(steps[:4]))
        app.quit()

    b_un.clicked.connect(do_uninstall)
    b_cancel.clicked.connect(app.quit)

    w.show()
    return app.exec()
