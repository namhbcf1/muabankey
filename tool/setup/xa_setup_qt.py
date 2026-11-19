# -*- coding: utf-8 -*-
"""xa_setup_qt.py — Giao diện PyQt6 cho bộ cài XArena.

QUAN HỆ VỚI xa_setup.py
-----------------------
xa_setup.py giữ TOÀN BỘ logic: tải file, kiểm SHA-256, validate_info,
đóng tool đang chạy, ghi file, RUNASADMIN, kích hoạt license, tạo shortcut.
File này CHỈ thay lớp giao diện (tkinter -> PyQt6) và gọi lại đúng các hàm
đó. Không có logic nghiệp vụ nào bị nhân bản.

Tham số dòng lệnh giữ nguyên: --selftest, --version, --token <TOKEN>.
"""

import os
import sys
import tempfile
import time

# Cho phép chạy trực tiếp từ thư mục tool/setup hoặc từ thư mục gốc
_HERE = os.path.dirname(os.path.abspath(__file__))
for p in (_HERE, os.path.join(_HERE, '..', 'ui')):
    p = os.path.abspath(p)
    if p not in sys.path:
        sys.path.insert(0, p)

import xa_setup as core           # logic nghiệp vụ
import xa_theme as T              # theme dùng chung

from PyQt6.QtCore import (
    Qt, QThread, pyqtSignal, QTimer, QSize,
)
from PyQt6.QtGui import (
    QIcon, QPixmap, QPainter, QColor, QFont, QLinearGradient, QBrush, QPen,
)
from PyQt6.QtWidgets import (
    QApplication, QWidget, QVBoxLayout, QHBoxLayout, QLabel, QPushButton,
    QLineEdit, QProgressBar, QPlainTextEdit, QFrame, QMessageBox,
    QGraphicsDropShadowEffect, QSizePolicy, QSpacerItem,
)

# ---------------------------------------------------------------------------
# Icon động (vẽ bằng QPainter để không cần file .ico đi kèm)
# ---------------------------------------------------------------------------

def app_icon() -> QIcon:
    """Icon khiên + tia sét, vẽ bằng code để khỏi phải đóng gói asset."""
    pm = QPixmap(64, 64)
    pm.fill(Qt.GlobalColor.transparent)
    p = QPainter(pm)
    p.setRenderHint(QPainter.RenderHint.Antialiasing)

    g = QLinearGradient(0, 0, 64, 64)
    g.setColorAt(0, QColor('#3b82f6'))
    g.setColorAt(1, QColor('#1d4ed8'))
    p.setBrush(QBrush(g))
    p.setPen(Qt.PenStyle.NoPen)
    p.drawRoundedRect(4, 4, 56, 56, 14, 14)

    # Tia sét
    p.setBrush(QColor('#ffffff'))
    from PyQt6.QtGui import QPolygonF
    from PyQt6.QtCore import QPointF
    bolt = QPolygonF([
        QPointF(35, 14), QPointF(22, 35), QPointF(30, 35),
        QPointF(27, 50), QPointF(42, 28), QPointF(33, 28),
    ])
    p.drawPolygon(bolt)
    p.end()
    return QIcon(pm)

# ---------------------------------------------------------------------------
# Luồng cài đặt — chạy nền, phát signal về GUI
# ---------------------------------------------------------------------------

class InstallWorker(QThread):
    """Chạy toàn bộ quy trình cài trong thread nền.

    GUI không được đứng hình khi tải 9 MB, nên mọi việc nặng nằm ở đây.
    Giao tiếp MỘT CHIỀU qua signal — không widget nào bị chạm từ thread này.
    """

    progress = pyqtSignal(int)            # 0..100
    log = pyqtSignal(str)                 # một dòng log
    status = pyqtSignal(str, str)         # (text, kind: info|ok|warn|err)
    done = pyqtSignal(bool, str, str)     # (ok, message, shortcut_name)

    def __init__(self, raw_input: str, parent=None):
        super().__init__(parent)
        self.raw = raw_input
        self._stop = False

    # -- tiện ích --
    def _p(self, v):
        self.progress.emit(max(0, min(100, int(v))))

    def _l(self, s=''):
        self.log.emit(str(s))

    def _s(self, text, kind='info'):
        self.status.emit(str(text), kind)

    def run(self):  # noqa: C901 — tuyến tính theo đúng thứ tự cài đặt
        try:
            self._do_install()
        except Exception as e:
            self._s('Lỗi không mong đợi: %s' % e, 'err')
            self._l('EXCEPTION: %r' % e)
            self.done.emit(False, str(e), '')
        finally:
            pass

    def _do_install(self):
        raw = self.raw

        key, token = core.resolve_input(raw)
        if not key and not token:
            self._s('Key không hợp lệ. Dạng đúng: AOE1-XXXX-XXXX-XXXX', 'err')
            self._l('Nhập không nhận diện được: %r' % raw[:80])
            self.done.emit(False, 'Mã không hợp lệ', '')
            return

        info, err = core.fetch_info(key, token)
        if not info:
            self._s('Không lấy được thông tin: %s' % err, 'err')
            self._l('LỖI: ' + str(err))
            self.done.emit(False, str(err), '')
            return

        key = info.get('key') or key
        app = info.get('app') or 'nofog'
        name = info.get('name') or app

        okV, errV = core.validate_info(info)
        if not okV:
            self._s('Dữ liệu cài đặt không hợp lệ: %s' % errV, 'err')
            self._l('LỖI kiểm tra: ' + errV)
            self.done.emit(False, errV, '')
            return

        exe_url = info.get('exeUrl') or ''
        sha = info.get('sha256') or ''
        size = int(info.get('size') or 0)
        target_dir = info.get('installDir') or ''
        shortcut_name = info.get('shortcutName') or name
        exe_name = info.get('exeName') or 'app.exe'
        is_trial = str(key).upper().startswith('TR-')

        # GON: chi ten ban + key. Khong liet ke duong dan, han dung.
        self._l('%s' % name)
        self._l('Key: %s' % key)

        # ---- Tải ----
        self._s('Đang tải bộ xử lý…')
        self._p(4)
        tmpdir = tempfile.mkdtemp(prefix='xasetup_')
        tmp_exe = os.path.join(tmpdir, exe_name)

        def on_prog(got, total):
            self._p(4 + int(86 * got / max(total, 1)))

        ok, derr = core.download_file(exe_url, tmp_exe, sha, size, on_prog)
        if not ok:
            self._s('Tải thất bại: %s' % derr, 'err')
            self._l('LỖI tải: ' + str(derr))
            self.done.emit(False, str(derr), '')
            return
        self._p(90)

        # ---- Thư mục đích ----
        self._s('Đang cài đặt…')
        try:
            os.makedirs(target_dir, exist_ok=True)
        except PermissionError as e:
            self._s('Windows từ chối quyền ghi vào thư mục cài.', 'err')
            self._l('LỖI QUYỀN: ' + str(e))
            self._l('')
            self._l('Thư mục: %s' % target_dir)
            self._l('Nguyên nhân: chưa chạy với quyền Administrator,')
            self._l('hoặc thư mục đang bị chương trình khác giữ.')
            self._l('')
            self._l('CÁCH SỬA:')
            self._l('  1. Đóng game và mọi cửa sổ XArena đang mở')
            self._l('  2. Chuột phải xa_setup.exe -> Run as administrator')
            self._l('  3. Bấm Yes rồi cài lại')
            self.done.emit(False, 'Không đủ quyền ghi thư mục cài', '')
            return
        except Exception as e:
            self._s('Không tạo được thư mục cài: %s' % e, 'err')
            self._l('LỖI: ' + str(e))
            self.done.emit(False, str(e), '')
            return

        final_exe = os.path.join(target_dir, exe_name)

        # ---- Bỏ qua ghi nếu file đã đúng phiên bản ----
        already_ok = False
        if os.path.exists(final_exe):
            try:
                if os.path.getsize(final_exe) == int(size):
                    if core.file_sha256(final_exe).lower() == sha.lower():
                        already_ok = True
            except Exception:
                pass

        if not already_ok:
            stopped = core.stop_running_tool(final_exe)
            if stopped:
                self._l('Đã đóng %d tiến trình %s đang chạy.'
                        % (stopped, exe_name))

        # ---- Ghi file ----
        # Bản cũ ĐỔI TÊN (không xoá) để khôi phục nếu bước sau lỗi.
        backup_exe = final_exe + '.old'
        try:
            if not already_ok:
                if os.path.exists(final_exe):
                    try:
                        if os.path.exists(backup_exe):
                            os.remove(backup_exe)
                        os.replace(final_exe, backup_exe)
                    except Exception:
                        pass

                staging = final_exe + '.new'
                with open(tmp_exe, 'rb') as src, open(staging, 'wb') as dst:
                    while True:
                        b = src.read(core.CHUNK)
                        if not b:
                            break
                        dst.write(b)

                if core.file_sha256(staging).lower() != sha.lower():
                    self._s('Hash sai sau khi cài. Đã huỷ.', 'err')
                    try:
                        os.remove(staging)
                    except Exception:
                        pass
                    self.done.emit(False, 'Hash sai sau khi cài', '')
                    return

                last_err = None
                for attempt in range(6):
                    try:
                        os.replace(staging, final_exe)
                        last_err = None
                        break
                    except PermissionError as e:
                        last_err = e
                        time.sleep(0.15 * (attempt + 1))
                        if attempt >= 2:
                            core.stop_running_tool(final_exe)
                    except Exception as e:
                        last_err = e
                        break
                if last_err is not None:
                    raise last_err
        except PermissionError as e:
            self._s('Không ghi đè được: file đang được chương trình khác dùng.',
                    'err')
            self._l('LỖI QUYỀN: ' + str(e))
            self._l('')
            self._l('File đích: %s' % final_exe)
            self._l('Nguyên nhân thường gặp:')
            self._l('  1. Tool đang chạy (kể cả cửa sổ CMD của tool)')
            self._l('  2. Game EMPIRESX.EXE đang mở')
            self._l('  3. Phần mềm diệt virus đang quét file vừa tải')
            self._l('')
            self._l('CÁCH SỬA: đóng hết cửa sổ tool + game, rồi cài lại.')
            self.done.emit(False, 'File đang được chương trình khác sử dụng', '')
            return
        except Exception as e:
            self._s('Không ghi được file cài: %s' % e, 'err')
            self._l('LỖI: ' + str(e))
            self.done.emit(False, str(e), '')
            return

        self._l('Đã cài: %s' % final_exe)
        self._p(94)

        # ---- RUNASADMIN ----
        try:
            if core.set_runasadmin(final_exe):
                self._l('Đã bật yêu cầu quyền Administrator cho app.')
        except Exception:
            pass

        # ---- Bộ gỡ cài đặt + Apps & features ----
        # LỖI ĐÃ SỬA: trước đây sản phẩm KHÔNG có cách gỡ nào.
        # Nay: copy bộ cài thành <installDir>\xa_uninstall.exe, ghi
        # install.json, và đăng ký mục trong Apps & features.
        try:
            import xa_uninstall as _UN
            _vers = '?'
            try:
                import xa_arena_app as _AP
                _vers = _AP.APP_VERSION
            except Exception:
                pass
            _steps = _UN.register_install(
                target_dir, _vers, 'XA ARENA',
                installer_exe=sys.argv[0] if sys.argv else '')
            for _st in _steps:
                self._l(_st)
        except Exception as _e:
            self._l('Chưa tạo được bộ gỡ cài đặt (%s)' % _e)
        # ---- Kích hoạt ----
        self._s('Đang kích hoạt license…')
        self._p(97)
        okA, errA = core.activate(final_exe, key, is_trial)
        if okA:
            self._l('Đã kích hoạt license: %s' % key)
        else:
            self._l('CẢNH BÁO: chưa kích hoạt được (%s)' % errA)
            self._l('  Mở tool và nhập key thủ công: %s' % key)

        # ---- Shortcut ----
        made = []
        seen = set()
        for d in core.desktop_dirs():
            lnk = os.path.join(d, shortcut_name + '.lnk')
            if lnk in seen:
                continue
            seen.add(lnk)
            if core.shortcut(final_exe, lnk, description=name, icon=final_exe):
                made.append(d)
        startmenu = os.path.join(
            os.environ.get('PROGRAMDATA', r'C:\ProgramData'),
            'Microsoft', 'Windows', 'Start Menu', 'Programs')
        if core.shortcut(final_exe,
                         os.path.join(startmenu, shortcut_name + '.lnk'),
                         description=name, icon=final_exe):
            made.append('Start Menu')

        self._p(100)

        # ------------------------------------------------------------------
        # TỰ MỞ APP SAU KHI CÀI
        #
        # Chủ shop: "cài xong thì thấy giao diện đó luôn, phải cài xong mới
        # dùng tool". Nên không bắt khách đi tìm shortcut: cài xong là mở.
        #
        # Chạy tách rời (DETACHED) để bộ cài đóng được ngay, và để app
        # không bị coi là tiến trình con của bộ cài.
        # ------------------------------------------------------------------
        launched = False
        try:
            import subprocess
            flags = 0
            for attr in ('DETACHED_PROCESS', 'CREATE_NEW_PROCESS_GROUP'):
                flags |= getattr(subprocess, attr, 0)
            subprocess.Popen(
                [final_exe], cwd=os.path.dirname(final_exe),
                creationflags=flags, close_fds=True,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL)
            launched = True
        except Exception as e:
            self._l('Không tự mở được app: %s' % e)

        if launched:
            self._s('Xong. Đang mở %s…' % name, 'ok')
            msg = 'Đã cài xong "%s".\n\nApp đang mở.' % name
        elif made:
            self._s('Xong. Biểu tượng "%s" đã có trên Desktop.' % shortcut_name,
                    'ok')
            msg = ('Đã cài xong "%s".\n\nBấm đúp "%s" ngoài Desktop để chạy.'
                   % (name, shortcut_name))
        else:
            self._s('Xong. Mở trong thư mục cài đặt.', 'ok')
            msg = ('Đã cài xong "%s".\n\nMở file:\n%s' % (name, final_exe))

        self.done.emit(True, msg, shortcut_name)

# ---------------------------------------------------------------------------
# Cửa sổ chính
# ---------------------------------------------------------------------------

class SetupWindow(QWidget):

    def __init__(self, prefill=''):
        super().__init__()
        self.worker = None
        self.prefill = prefill
        self._build()
        self._post_build()

    # ---------------- dựng giao diện ----------------
    def _build(self):
        self.setWindowTitle('%s %s' % (core.APP_TITLE, core.VERSION))
        self.setWindowIcon(app_icon())
        self.setMinimumSize(640, 620)
        self.resize(680, 700)
        self.setWindowFlag(Qt.WindowType.Window, True)

        root = QVBoxLayout(self)
        root.setContentsMargins(26, 22, 26, 20)
        root.setSpacing(14)

        # ===== Tiêu đề =====
        head = QHBoxLayout()
        head.setSpacing(13)

        logo = QLabel()
        logo.setPixmap(app_icon().pixmap(QSize(42, 42)))
        logo.setFixedSize(42, 42)
        head.addWidget(logo)

        titles = QVBoxLayout()
        titles.setSpacing(1)
        titles.addWidget(T.label('Cài đặt XArena', 'h1'))
        titles.addWidget(T.label(
            'Dán license key của bạn, rồi bấm Cài đặt.',
            'mute'))
        head.addLayout(titles, 1)
        root.addLayout(head)

        # ===== Thẻ nhập mã =====
        card = T.card()
        cl = QVBoxLayout(card)
        cl.setContentsMargins(16, 14, 16, 14)
        cl.setSpacing(9)

        cl.addWidget(T.label('License key'))

        self.entry = T.line_input(
            'Ví dụ: AOE1-2KHT-7WQP-7R2P  hoặc  XAGR-XXXX-XXXX-XXXX', code=True)
        self.entry.setMinimumHeight(42)
        cl.addWidget(self.entry)

        hint_row = QHBoxLayout()
        hint_row.setSpacing(8)
        hint_row.addWidget(T.label(
            'Key có trong mục Đơn hàng trên web. Không cần mã nào khác.', 'mute'), 1)

        self.btn_paste = T.btn('Dán', 'ghost')
        self.btn_paste.setFixedWidth(70)
        self.btn_paste.clicked.connect(self._paste)
        hint_row.addWidget(self.btn_paste)
        cl.addLayout(hint_row)

        root.addWidget(card)

        # ===== Nút cài =====
        self.btn_install = T.btn('Cài đặt', 'primary', big=True)
        self.btn_install.setMinimumHeight(50)
        self.btn_install.clicked.connect(self._start)
        root.addWidget(self.btn_install)

        # ===== Tiến trình =====
        self.prog = T.progress()
        root.addWidget(self.prog)

        self.lbl_status = T.label('Sẵn sàng.', 'mute', wrap=True)
        self.lbl_status.setMinimumHeight(20)
        root.addWidget(self.lbl_status)

        # ===== Log: gon, tu an khi chua co gi =====
        self.log = T.log_view()
        self.log.setMinimumHeight(110)
        self.log.setMaximumHeight(150)
        self.log.hide()
        root.addWidget(self.log, 0)

        # ===== Chân: chỉ phiên bản + Đóng =====
        foot = QHBoxLayout()
        foot.setSpacing(8)
        self.lbl_ver = T.label('v%s' % core.VERSION, 'mute')
        foot.addWidget(self.lbl_ver)
        foot.addStretch(1)

        # Giữ nút cũ để code không vỡ, nhưng ẩn đi (không chiếm chỗ)
        self.btn_copy_log = T.btn('', 'ghost')
        self.btn_copy_log.hide()

        self.btn_close = T.btn('Đóng', 'ghost')
        self.btn_close.setFixedWidth(84)
        self.btn_close.clicked.connect(self.close)
        foot.addWidget(self.btn_close)
        root.addLayout(foot)

    def _post_build(self):
        T.set_dark_titlebar(self)
        T.center_on_screen(self)

        if self.prefill:
            self.entry.setText(self.prefill)

        # ĐÃ BỎ khối "--- thông tin ---" (phiên bản, tên máy, Python, Frozen,
        # Launcher): khách không cần và nó làm log dài, rối.
        # Chỉ giữ cảnh báo quyền vì nó ảnh hưởng thao tác của khách.
        admin = core.is_admin()
        if not admin:
            self._set_status(
                'Chưa có quyền Administrator — sẽ hỏi khi bấm Cài đặt.', 'warn')

        self.entry.returnPressed.connect(self._start)
        self.entry.setFocus()

    # ---------------- hành vi ----------------
    def _set_status(self, text, kind='info'):
        role = {'info': 'dim', 'ok': 'ok', 'warn': 'warn',
                'err': 'err'}.get(kind, 'dim')
        self.lbl_status.setText(text)
        self.lbl_status.setProperty('role', role)
        # Buộc Qt vẽ lại sau khi đổi property
        self.lbl_status.style().unpolish(self.lbl_status)
        self.lbl_status.style().polish(self.lbl_status)

    def _log(self, line=''):
        self.log.appendPlainText(str(line))
        sb = self.log.verticalScrollBar()
        sb.setValue(sb.maximum())

    def _paste(self):
        try:
            cb = QApplication.clipboard()
            txt = (cb.text() or '').strip()
            if txt:
                self.entry.setText(txt)
            else:
                self._set_status('Clipboard trống.', 'warn')
        except Exception:
            self._set_status('Không đọc được clipboard.', 'warn')

    def _copy_log(self):
        try:
            QApplication.clipboard().setText(self.log.toPlainText())
            self._set_status('Đã sao chép log.', 'ok')
        except Exception:
            pass

    def _set_busy(self, busy):
        self.btn_install.setEnabled(not busy)
        self.entry.setEnabled(not busy)
        self.btn_paste.setEnabled(not busy)
        self.btn_install.setText('Đang cài…' if busy else 'Cài đặt')

    def _start(self):
        # Đang chạy thì bỏ qua
        if self.worker is not None and self.worker.isRunning():
            return

        raw = self.entry.text().strip()
        if not raw:
            self._set_status('Hãy dán license key của bạn.', 'warn')
            self.entry.setFocus()
            return

        # Cần quyền Admin -> mở lại với quyền cao, mang theo mã
        if not core.is_admin():
            self._set_status('Cần quyền Administrator — đang mở lại…', 'warn')
            self._log('Chưa có quyền Administrator. Đang mở lại với quyền Admin…')
            if core.relaunch_elevated(['--token', raw]):
                self._log('Đã mở bộ cài với quyền Administrator.')
                QTimer.singleShot(400, self.close)
                return
            self._set_status('Không tự xin được quyền.', 'err')
            self._log('')
            self._log('CÁCH KHẮC PHỤC:')
            self._log('  1. Đóng bộ cài này')
            self._log('  2. Chuột phải xa_setup.exe -> "Run as administrator"')
            self._log('  3. Bấm Yes rồi cài lại')
            QMessageBox.warning(
                self, 'Cần quyền Administrator',
                'Bộ cài cần quyền Administrator để ghi vào Program Files.\n\n'
                'Hãy đóng cửa sổ này, chuột phải vào xa_setup.exe và chọn\n'
                '"Run as administrator".')
            return

        self._set_busy(True)
        self.prog.setValue(0)
        self._log('')

        self.worker = InstallWorker(raw, self)
        self.worker.progress.connect(self._on_progress)
        self.worker.log.connect(self._log)
        self.worker.status.connect(self._set_status)
        self.worker.done.connect(self._on_done)
        self.worker.start()

    def _on_progress(self, v):
        self.prog.setValue(v)

    def _on_done(self, ok, msg, shortcut_name):
        self._set_busy(False)
        state = 'ok' if ok else 'err'
        self.prog.setProperty('state', state)
        self.prog.style().unpolish(self.prog)
        self.prog.style().polish(self.prog)

        if ok:
            QMessageBox.information(self, 'Cài đặt xong', msg)
        else:
            QMessageBox.critical(self, 'Cài đặt thất bại', msg)

    def closeEvent(self, e):
        w = self.worker
        if w is not None and w.isRunning():
            r = QMessageBox.question(
                self, 'Đang cài đặt',
                'Bộ cài đang chạy. Thoát bây giờ có thể để lại file dở.\n\n'
                'Vẫn thoát?',
                QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
                QMessageBox.StandardButton.No)
            if r != QMessageBox.StandardButton.Yes:
                e.ignore()
                return
            w.terminate()
            w.wait(2000)
        e.accept()

# ---------------------------------------------------------------------------
# Điểm vào
# ---------------------------------------------------------------------------

def run_gui(prefill=''):
    app = QApplication.instance() or QApplication(sys.argv)
    T.apply_theme(app)
    win = SetupWindow(prefill)
    win.show()
    return app.exec()

def run_cli_install(key):
    """Cài KHÔNG GUI: kiểm tra key -> tải -> cài -> shortcut -> mở app.

    Dùng cho `xa_setup.exe --key <KEY>` và cho các luồng tự động.
    Trả mã thoát: 0 xong, 1 lỗi.
    """
    key = (key or '').strip()
    if not key:
        print('Thieu key.')
        return 1

    print('Dang kiem tra key...')
    # fetch_info tra TUPLE (info, err) — khong phai dict
    info, errF = core.fetch_info(key, None)
    if not info:
        print('LOI: %s' % (errF or 'khong lay duoc thong tin cai dat'))
        return 1
    if not info.get('ok'):
        print('LOI: %s' % (info.get('error') or info.get('msg')
                           or 'key khong hop le'))
        return 1
    okV, errV = core.validate_info(info)
    if not okV:
        print('LOI: %s' % errV)
        return 1

    name = info.get('name') or 'XA ARENA'
    exe_url = info.get('exeUrl') or ''
    sha = info.get('sha256') or ''
    size = int(info.get('size') or 0)
    target_dir = info.get('installDir') or ''
    exe_name = info.get('exeName') or 'xa_arena.exe'
    shortcut_name = info.get('shortcutName') or name
    is_trial = str(key).upper().startswith('TR-')

    print('%s' % name)
    print('Key: %s' % key)

    # ---- Tải ----
    print('Dang tai...')
    tmpdir = tempfile.mkdtemp(prefix='xasetup_')
    tmp_exe = os.path.join(tmpdir, exe_name)
    # LỖI ĐÃ SỬA (P0): download_file trả (ok, err) — phải kiểm.
    # Trước đây bỏ qua kết quả rồi vẫn đi tiếp: xoá app cũ và copy từ
    # file tạm không tồn tại -> APP BIẾN MẤT.
    try:
        dl = core.download_file(exe_url, tmp_exe, sha, size,
                               progress=None)
    except Exception as e:
        print('LOI tai: %s' % e)
        return 1
    if isinstance(dl, tuple):
        dl_ok = bool(dl[0])
        dl_err = str(dl[1] or '') if len(dl) > 1 else ''
    else:
        dl_ok = bool(dl)
        dl_err = ''
    if not dl_ok or not os.path.exists(tmp_exe):
        print('LOI tai ban moi: %s' % (dl_err or 'khong tai duoc'))
        print('  App dang cai van giu nguyen. Thu lai sau.')
        return 1

    # ---- Ghi file ----
    final_exe = os.path.join(target_dir, exe_name)
    # Bản cũ ĐỔI TÊN (không xoá) để khôi phục nếu bước sau lỗi.
    backup_exe = final_exe + '.old'
    try:
        os.makedirs(target_dir, exist_ok=True)
    except Exception as e:
        print('LOI tao thu muc: %s' % e)
        return 1

    # KHÔNG xoá app cũ. Đổi tên thành .old rồi mới đưa bản mới vào.
    # Nếu bước sau thất bại thì khôi phục .old — không bao giờ mất app.
    backup = final_exe + '.old'
    had_old = False
    if os.path.exists(final_exe):
        try:
            core.stop_running_tool(final_exe)
        except Exception:
            pass
        try:
            if os.path.exists(backup):
                os.remove(backup)
            os.replace(final_exe, backup)
            had_old = True
        except Exception as e:
            print('LOI: khong thay duoc ban cu: %s' % e)
            print('  App dang cai van giu nguyen.')
            return 1

    try:
        staging = final_exe + '.new'
        with open(tmp_exe, 'rb') as src, open(staging, 'wb') as dst:
            while True:
                b = src.read(core.CHUNK)
                if not b:
                    break
                dst.write(b)
        if core.file_sha256(staging).lower() != sha.lower():
            print('LOI: hash sai sau khi cai')
            try:
                os.remove(staging)
            except Exception:
                pass
            return 1
        os.replace(staging, final_exe)
    except Exception as e:
        print('LOI ghi file: %s' % e)
        return 1

    print('Da cai: %s' % final_exe)

    try:
        core.set_runasadmin(final_exe)
    except Exception:
        pass

    # ---- Kích hoạt ----
    print('Dang kich hoat license...')
    try:
        okA, errA = core.activate(final_exe, key, is_trial)
        if okA:
            print('Da kich hoat.')
        else:
            print('CANH BAO: chua kich hoat duoc (%s)' % errA)
    except Exception as e:
        print('CANH BAO: kich hoat loi (%s)' % e)

    # ---- Shortcut ----
    try:
        for d in core.desktop_dirs():
            core.shortcut(final_exe, os.path.join(d, shortcut_name + '.lnk'),
                          description=name, icon=final_exe)
        startmenu = os.path.join(
            os.environ.get('PROGRAMDATA', r'C:\ProgramData'),
            'Microsoft', 'Windows', 'Start Menu', 'Programs')
        core.shortcut(final_exe, os.path.join(startmenu, shortcut_name + '.lnk'),
                      description=name, icon=final_exe)
        print('Da tao shortcut.')
    except Exception as e:
        print('CANH BAO: shortcut loi (%s)' % e)

    # ---- Bộ gỡ cài đặt + Apps & features ----
    # LỖI ĐÃ SỬA: chỉ nhánh GUI gọi register_install. Cài bằng `--key`
    # (đường bộ cài thật sự dùng) không tạo bộ gỡ và không đăng ký
    # Apps & features -> sản phẩm vẫn không gỡ được.
    try:
        import xa_uninstall as _UN
        _vers = '?'
        try:
            import xa_arena_app as _AP
            _vers = _AP.APP_VERSION
        except Exception:
            pass
        for _st in _UN.register_install(
                target_dir, _vers, shortcut_name,
                installer_exe=sys.argv[0] if sys.argv else ''):
            print('  %s' % _st)
    except Exception as e:
        print('CANH BAO: chua tao duoc bo go cai dat (%s)' % e)

    # ---- Mở app ----
    try:
        import subprocess
        flags = 0
        for attr in ('DETACHED_PROCESS', 'CREATE_NEW_PROCESS_GROUP'):
            flags |= getattr(subprocess, attr, 0)
        subprocess.Popen([final_exe], cwd=target_dir, creationflags=flags,
                         close_fds=True, stdin=subprocess.DEVNULL,
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        print('Da mo %s.' % name)
    except Exception as e:
        print('CANH BAO: khong tu mo duoc (%s)' % e)

    print('XONG.')
    return 0


def main():
    args = sys.argv[1:]

    # ------------------------------------------------------------------
    # GỠ CÀI ĐẶT — PHẢI ĐỨNG TRƯỚC MỌI THỨ.
    #
    # LỖI ĐÃ SỬA: `xa_uninstall.exe` là BẢN COPY của bộ cài (cùng file,
    # khác tên). Bộ cài không có nhánh `--uninstall` nên khi khách bấm
    # "Gỡ cài đặt" nó mở luôn GUI **CÀI ĐẶT** và treo — không gỡ gì cả.
    # ------------------------------------------------------------------
    if '--uninstall' in args:
        try:
            import xa_uninstall as _UN
        except Exception as e:
            print('Khong nap duoc bo go cai dat: %s' % e)
            return 3
        if '--yes' in args:
            return _UN.main(['--uninstall', '--yes']
                            + (['--drop-license']
                               if '--drop-license' in args else []))
        return _UN.gui_main(core.VERSION)

    # ------------------------------------------------------------------
    # TỰ CẬP NHẬT BỘ CÀI.
    #
    # LỖI ĐÃ SỬA: trước đây bộ cài KHÔNG hề hỏi server, nên khách dùng
    # link cũ sẽ cài mãi bằng bộ cài cũ (thiếu bản sửa lỗi). Nay mỗi lần
    # chạy, bộ cài tự so version với /api/setup/version; nếu có bản mới
    # thì tải, kiểm SHA-256, chạy bản mới rồi thoát.
    #
    # `--no-self-update` để tắt khi cần (dùng trong kiểm thử).
    # ------------------------------------------------------------------
    if '--no-self-update' not in args and '--selftest' not in args \
            and '--version' not in args:
        try:
            if core.setup_self_update(verbose=False):
                return 0
        except Exception:
            pass

    if '--selftest' in args:
        return core.selftest()
    if '--version' in args:
        print(core.VERSION)
        return 0

    prefill = ''
    if '--token' in args:
        i = args.index('--token')
        if i + 1 < len(args):
            prefill = args[i + 1]

    # ------------------------------------------------------------------
    # --key: CÀI THẲNG, KHÔNG MỞ GUI
    #
    # Chủ shop: "cài xong thì thấy giao diện đó luôn, phải cài xong mới
    # dùng tool". Nên đường --key phải chạy tới cùng rồi mở app, không
    # dừng lại chờ khách bấm.
    #
    # LỖI ĐÃ SỬA: trước đây main() chỉ đọc --token, bỏ qua --key, nên
    # `xa_setup.exe --key XXX` mở GUI rồi chờ -> không cài gì cả.
    # ------------------------------------------------------------------
    cli_key = ''
    if '--key' in args:
        i = args.index('--key')
        if i + 1 < len(args):
            cli_key = args[i + 1].strip()

    if cli_key:
        return run_cli_install(cli_key)

    # Chỉ một bộ cài chạy cùng lúc
    guard = core.acquire_single_instance()
    if guard is False:
        app = QApplication.instance() or QApplication(sys.argv)
        T.apply_theme(app)
        QMessageBox.information(
            None, 'Bộ cài đang mở',
            'Bộ cài XArena đang chạy rồi.\n\n'
            'Hãy dùng cửa sổ đang mở, hoặc đóng nó rồi mở lại.')
        return 0

    return run_gui(prefill)

if __name__ == '__main__':
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except BaseException as e:
        try:
            app = QApplication.instance() or QApplication(sys.argv)
            QMessageBox.critical(None, 'Lỗi', 'Không chạy được:\n\n%r' % (e,))
        except Exception:
            print('LOI:', e)
        sys.exit(1)
