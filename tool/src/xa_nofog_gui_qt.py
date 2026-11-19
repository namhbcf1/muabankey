# -*- coding: utf-8 -*-
"""xa_nofog_gui_qt.py — Giao diện PyQt6 cho XARENA MAP SÁNG (No Fog).

YÊU CẦU CỦA CHỦ SHOP
--------------------
"kiểu đợi game khi nào có thì bật map sáng đỡ phải bật đi bật lại nhiều.
 có nút bật tắt map sáng."

Nên file này có:
  1. CÔNG TẮC BẬT/TẮT — gạt một lần, tool tự chờ game.
  2. Chờ game: game chưa mở -> đứng chờ; game mở -> tự vá; game tắt ->
     tự nhả handle và chờ tiếp. Không phải khởi động lại tool.
  3. Trạng thái rõ ràng: đang chờ game / đang bật / đã tắt / lỗi.

QUAN HỆ VỚI xa_nofog_pro.py
---------------------------
KHÔNG nhân bản logic. File này chỉ gọi:
    find_game, attach, apply_set, _require_sites, trial_guard, in_match,
    require_license, load_state, is_trial, _fmt_left
Mọi thay đổi về bảng offset, license, chống dịch ngược vẫn nằm ở file gốc.

CHẾ ĐỘ
------
- Bật  : vòng lặp chờ game, tự vá khi game xuất hiện.
- Tắt  : nhả handle, KHÔNG ghi trả byte gốc (theo đúng hành vi --off cũ:
         byte gốc chỉ tồn tại trong RAM của process game, đóng game là sạch).
"""

import os
import sys
import time

_HERE = os.path.dirname(os.path.abspath(__file__))
for p in (_HERE, os.path.join(_HERE, '..', 'ui')):
    p = os.path.abspath(p)
    if p not in sys.path:
        sys.path.insert(0, p)

import xa_theme as T

from PyQt6.QtCore import Qt, QThread, pyqtSignal, QTimer, QSize
from PyQt6.QtGui import (
    QIcon, QPixmap, QPainter, QColor, QLinearGradient, QBrush,
)
from PyQt6.QtWidgets import (
    QApplication, QWidget, QVBoxLayout, QHBoxLayout, QLabel, QPushButton,
    QMessageBox,
)


def app_icon() -> QIcon:
    pm = QPixmap(64, 64)
    pm.fill(Qt.GlobalColor.transparent)
    p = QPainter(pm)
    p.setRenderHint(QPainter.RenderHint.Antialiasing)
    g = QLinearGradient(0, 0, 64, 64)
    g.setColorAt(0, QColor('#8b5cf6'))
    g.setColorAt(1, QColor('#6d28d9'))
    p.setBrush(QBrush(g))
    p.setPen(Qt.PenStyle.NoPen)
    p.drawRoundedRect(4, 4, 56, 56, 14, 14)
    # Con mắt (map sáng = nhìn xuyên sương)
    p.setBrush(Qt.BrushStyle.NoBrush)
    from PyQt6.QtGui import QPen
    p.setPen(QPen(QColor('#ffffff'), 3.2))
    p.drawEllipse(14, 22, 36, 20)
    p.setBrush(QColor('#ffffff'))
    p.setPen(Qt.PenStyle.NoPen)
    p.drawEllipse(27, 27, 10, 10)
    p.end()
    return QIcon(pm)


# ---------------------------------------------------------------------------
# Worker: vòng lặp chờ game + vá
# ---------------------------------------------------------------------------

class UpdateCheckWorker(QThread):
    """Hỏi server xem có bản mới. Chạy nền."""

    found = pyqtSignal(object)

    def run(self):
        try:
            import xa_nofog_pro as NF
            self.found.emit(NF.update_check())
        except Exception:
            self.found.emit(None)


class UpdateDownloadWorker(QThread):
    """Tải bản mới ở nền."""

    progress = pyqtSignal(int, int)
    done = pyqtSignal(bool, str)

    def __init__(self, info, parent=None):
        super().__init__(parent)
        self.info = info

    def run(self):
        try:
            import xa_nofog_pro as NF
            ok, msg = NF.update_download(
                self.info, lambda g, t: self.progress.emit(g, t))
            self.done.emit(ok, msg)
        except Exception as e:
            self.done.emit(False, str(e)[:120])


class PatchWorker(QThread):
    """Vòng lặp chính. Chạy nền tuyệt đối — GUI không được đứng hình.

    Sao chép ĐÚNG logic vòng lặp của xa_nofog_pro.run() ở chế độ resident,
    nhưng thay print/title bằng signal để GUI hiển thị.
    """

    log = pyqtSignal(str)
    state = pyqtSignal(str, str, str)   # (text, kind, detail)
    game_seen = pyqtSignal(bool)        # đang thấy game hay không
    needs_key = pyqtSignal()            # thiếu/hỏng license -> cần nhập key

    def __init__(self, parent=None):
        super().__init__(parent)
        self._stop = False
        self.h = None
        self.base = 0
        self.pid = 0
        self.patched_pid = 0
        self.sites = []
        self.label = 'all'

    def stop(self):
        self._stop = True

    def run(self):
        import xa_nofog_pro as NF

        # ---- NẠP BẢNG OFFSET ----
        #
        # LỖI ĐÃ GẶP: GUI mở sau khi license đã kích hoạt từ trước, nên
        # require_license() không chạy lại -> _load_sites() chưa được gọi ->
        # SITES vẫn None -> GUI báo "Không có bảng offset" dù license hợp lệ.
        #
        # Nay: tự nạp bảng từ token đã lưu TRƯỚC khi vào vòng lặp.
        try:
            st = NF.load_state() or {}
            if st.get('xn_token'):
                okL, msgL = NF._load_sites(st)
                if not okL:
                    self.log.emit('Cần kích hoạt lại key.')
        except Exception:
            pass

        # ---- Lấy bảng offset (cần license hợp lệ) ----
        try:
            self.sites, self.label = NF._require_sites().full(), 'all'
        except Exception:
            self.state.emit('Cần kích hoạt key', 'err',
                            'Bấm "Đổi key" để nhập key mới.')
            self.needs_key.emit()
            return

        self.state.emit('Đang chờ game…', 'info',
                        'Mở AoE và vào trận — tool tự bật map sáng')
        self.game_seen.emit(False)

        last_license_check = 0.0
        poll = float(getattr(NF, 'RESIDENT_POLL', 2.0))
        recheck = float(getattr(NF, 'TRIAL_RECHECK_SEC', 300))

        while not self._stop:
            # ---- Kiểm license định kỳ ----
            nowt = time.time()
            if nowt - last_license_check >= recheck:
                last_license_check = nowt
                try:
                    if not NF.trial_guard():
                        self.state.emit('License hết hạn hoặc mất mạng', 'err',
                                        'Tool đã dừng. Gia hạn rồi bật lại.')
                        self.log.emit('DỪNG: license không còn hợp lệ.')
                        self._close_handle()
                        return
                except Exception as e:
                    self.log.emit('Cảnh báo kiểm license: %s' % e)

            # ---- Tìm game ----
            try:
                procs = NF.find_game()
            except Exception as e:
                self.log.emit('Lỗi tìm game: %s' % e)
                time.sleep(poll)
                continue

            if not procs:
                if self.h:
                    self.log.emit('Đã đóng map sáng.')
                    self._close_handle()
                    self.patched_pid = 0
                    self.state.emit('Game đã đóng — đang chờ mở lại…',
                                    'info', 'Mở lại AoE là tool tự bật tiếp')
                    self.game_seen.emit(False)
                self._sleep(poll)
                continue

            # Ưu tiên EMPIRESX.EXE
            procs.sort(key=lambda p: 0 if str(p[1]).lower() == 'empiresx.exe' else 99)
            pid, name = procs[0]

            # ---- Đã vá process này rồi? ----
            if pid == self.patched_pid:
                if self.h and NF._alive(self.h):
                    self._sleep(poll)
                    continue
                self._close_handle()

            # ---- Gắn vào process ----
            if pid != self.pid:
                self._close_handle()
                try:
                    h, base = NF.attach(pid)
                except Exception:
                    self.log.emit('Không kết nối được game.')
                    self._sleep(2.0)
                    continue
                if not h:
                    self.log.emit('Không kết nối được game.')
                    self.game_seen.emit(True)
                    self._sleep(2.0)
                    continue
                self.h, self.base, self.pid = h, base, pid
                self.log.emit('Đã mở map sáng.')
                self.game_seen.emit(True)

            # ---- CHỜ VÀO TRẬN (KHÔNG vá khi còn ở menu) ----
            #
            # LỖI ĐÃ SỬA: bản trước vá ngay khi attach được process. Game
            # chưa vào trận -> engine chưa khởi tạo vùng dữ liệu trận ->
            # byte vá ghi vào làm game lỗi.
            #
            # Nay: chỉ vá khi in_match() xác nhận đã vào trận thật.
            # Chưa vào -> giữ nguyên, chờ tiếp. Nếu đang vá mà thoát trận ->
            # trả byte gốc về để không để rác trong RAM game.
            try:
                _in = NF.in_match(self.h, self.base)
            except Exception:
                _in = False

            if not _in:
                if self.patched_pid:
                    # Vừa thoát trận -> trả gốc
                    try:
                        NF.apply_set(self.h, self.base, self.sites, True,
                                     self.label, quiet=True)
                    except Exception:
                        pass
                    self.patched_pid = 0
                    self.log.emit('Đã đóng map sáng.')
                self.state.emit('Chờ vào trận…', 'info',
                                'Vào trận rồi tool tự bật')
                self.game_seen.emit(True)
                self._sleep(poll)
                continue

            # ---- Vá (đã chắc chắn trong trận) ----
            try:
                changed, bad = NF.apply_set(
                    self.h, self.base, self.sites, False, self.label, quiet=True)
            except Exception as e:
                self.log.emit('Lỗi khi vá: %s' % e)
                self.patched_pid = 0
                self._sleep(poll)
                continue

            if bad:
                self.patched_pid = 0
                self.log.emit('LỖI MỞ MAP: %s' % ' '.join(bad))
                self.state.emit('Có cổng không vá được', 'err',
                                'Xem log. Thử tắt/bật lại.')
            else:
                self.patched_pid = pid
                if changed:
                    self.log.emit('Đã mở map sáng.')
                self.state.emit('Đang bật map sáng', 'ok', '')

            self._sleep(poll)

        # ---- KHÔI PHỤC BYTE GỐC ----
        #
        # LỖI ĐÃ SỬA: trước đây chỗ này chỉ _close_handle() rồi báo "Đã tắt".
        # Byte vá vẫn nằm trong RAM game -> bấm TẮT mà sương mù KHÔNG hiện
        # lại, phải đóng game mới sạch.
        #
        # Nay: gọi apply_set(..., restore=True) để trả từng cổng về byte gốc.
        # Chỉ làm được khi handle còn sống và đúng tiến trình đã vá.
        restored = self._restore_patches()
        self._close_handle()
        if restored:
            self.state.emit('Đã tắt', 'info',
                            'Đã trả %d cổng về gốc — sương mù hiện lại.'
                            % restored)
        else:
            self.state.emit('Đã tắt', 'info',
                            'Tool đã dừng. Nếu sương mù chưa hiện lại, '
                            'đóng game rồi mở lại.')

    # -- khôi phục --
    def _restore_patches(self):
        """Trả các cổng đã vá về byte gốc. Trả SỐ cổng khôi phục được.

        An toàn: nếu handle đã chết, tiến trình đã thoát, hoặc game đã đổi
        vùng nhớ thì bỏ qua và trả 0 (không crash, không ghi bừa).
        """
        import xa_nofog_pro as NF
        if not self.h or not self.base or not self.sites:
            return 0
        try:
            if not NF._alive(self.h):
                self.log.emit('Game đã đóng — không cần khôi phục.')
                return 0
        except Exception:
            return 0
        try:
            changed, bad = NF.apply_set(
                self.h, self.base, self.sites, True, self.label, quiet=True)
            n = len(changed) if changed else 0
            if n:
                self.log.emit('Đã đóng map sáng.')
            if bad:
                self.log.emit('Không trả được: %s' % ' '.join(bad))
            return n
        except Exception as e:
            self.log.emit('Lỗi khi khôi phục: %s' % e)
            return 0

    # -- tiện ích --
    def _sleep(self, sec):
        """Ngủ có thể ngắt — để nút Tắt phản hồi ngay."""
        step = 0.1
        left = float(sec)
        while left > 0 and not self._stop:
            time.sleep(min(step, left))
            left -= step

    def _close_handle(self):
        if self.h:
            try:
                import ctypes
                k32 = ctypes.WinDLL('kernel32', use_last_error=True)
                k32.CloseHandle(ctypes.c_void_p(self.h))
            except Exception:
                pass
        self.h = None
        self.base = 0
        self.pid = 0


class ActivateWorker(QThread):
    """Kích hoạt license trong nền (không chặn GUI)."""

    log = pyqtSignal(str)
    done = pyqtSignal(bool, str)

    def __init__(self, key, parent=None):
        super().__init__(parent)
        self.key = key

    def run(self):
        try:
            import xa_nofog_pro as NF
            import argparse
            ns = argparse.Namespace(**{k: v for k, v in {
                'key': self.key, 'restore': False, 'once': False,
                'dump': False, 'list': False, 'watch': False,
                'off': False, 'verbose': False, 'sites': None,
                'groups': None, 'buy': False, 'install': False,
                'uninstall': False, 'login': None, 'logout': False,
                'trial_key': None, 'rebind': None, 'help': False,
                'pause': False,
            }.items()})
            ok = NF.require_license(ns)
            if ok:
                self.log.emit('Kích hoạt thành công.')
                self.done.emit(True, '')
            else:
                self.done.emit(False, 'Key không hợp lệ hoặc đã hết hạn.')
        except Exception as e:
            self.log.emit('LỖI kích hoạt: %r' % e)
            self.done.emit(False, str(e))


# ---------------------------------------------------------------------------
# Cửa sổ chính
# ---------------------------------------------------------------------------

class NoFogWindow(QWidget):

    def __init__(self):
        super().__init__()
        self.worker = None
        self.act_worker = None
        self._lic_timer = None
        self._has_key = False
        self._build()
        self._refresh_license()

        # ---- TỰ BẬT KHI MỞ APP ----
        # Đã có key đã lưu thì không bắt khách bấm gì nữa: tự vào chế độ
        # chờ game. Đây là yêu cầu "lưu vào mỗi khi bật app lên".
        if self._has_key:
            QTimer.singleShot(300, self._auto_start)

        # ---- TỰ KIỂM TRA BẢN MỚI (chạy nền) ----
        #
        # Đặt sau khi GUI đã hiện để không làm chậm khởi động.
        # Có bản mới -> hiện nút "Cập nhật x.y.z" ở góc phải.
        QTimer.singleShot(2500, self._start_update_check)

        # ---- ĐÁNH DẤU KHỞI ĐỘNG TỐT ----
        #
        # Nếu app sống quá 60 giây thì coi như bản này chạy được -> xoá bộ
        # đếm boot. Nếu bản update bị lỗi (crash ngay), bộ đếm không được
        # xoá -> lần sau tự quay lui về bản cũ.
        def _mark_good():
            try:
                import xa_nofog_pro as NF
                NF.update_mark_good()
            except Exception:
                pass
        QTimer.singleShot(60000, _mark_good)

    def _auto_start(self):
        if self._running():
            return
        self._log('Đã có key lưu sẵn — tự động bật chế độ chờ game.')
        self._start_patch()

    # ---------------- giao diện ----------------
    def _build(self):
        self.setWindowTitle('XARENA MAP SÁNG')
        self.setWindowIcon(app_icon())
        self.setMinimumSize(600, 660)
        self.resize(640, 700)

        root = QVBoxLayout(self)
        root.setContentsMargins(24, 20, 24, 18)
        root.setSpacing(14)

        # ===== Đầu =====
        head = QHBoxLayout()
        head.setSpacing(13)
        logo = QLabel()
        logo.setPixmap(app_icon().pixmap(QSize(44, 44)))
        logo.setFixedSize(44, 44)
        head.addWidget(logo)

        tt = QVBoxLayout()
        tt.setSpacing(1)
        tt.addWidget(T.label('XARENA MAP SÁNG', 'h1'))
        tt.addWidget(T.label('Bỏ sương mù toàn map + minimap', 'mute'))
        head.addLayout(tt, 1)

        # Nút cập nhật: chỉ hiện khi server có bản mới
        self.btn_update = T.btn('Cập nhật', 'primary')
        self.btn_update.setFixedWidth(96)
        self.btn_update.clicked.connect(self._do_update)
        self.btn_update.hide()
        head.addWidget(self.btn_update)

        self.btn_key = T.btn('Nhập key', 'primary')
        self.btn_key.setFixedWidth(96)
        self.btn_key.clicked.connect(self._ask_key)
        head.addWidget(self.btn_key)
        root.addLayout(head)

        # ===== Công tắc lớn =====
        self.btn_toggle = QPushButton('BẬT MAP SÁNG')
        self.btn_toggle.setMinimumHeight(66)
        self.btn_toggle.setCursor(Qt.CursorShape.PointingHandCursor)
        self.btn_toggle.clicked.connect(self._toggle)
        self.btn_toggle.setProperty('role', 'primary')
        f = self.btn_toggle.font()
        f.setPointSize(14)
        f.setBold(True)
        self.btn_toggle.setFont(f)
        root.addWidget(self.btn_toggle)

        # ===== Trạng thái =====
        st = T.card()
        sl = QVBoxLayout(st)
        sl.setContentsMargins(16, 13, 16, 13)
        sl.setSpacing(4)

        self.lbl_state = T.label('● Đang tắt', 'dim')
        f2 = self.lbl_state.font()
        f2.setBold(True)
        f2.setPointSize(12)
        self.lbl_state.setFont(f2)
        sl.addWidget(self.lbl_state)

        self.lbl_detail = T.label('Bấm nút trên để bắt đầu.',
                                  'mute', wrap=True)
        sl.addWidget(self.lbl_detail)
        root.addWidget(st)

        # ===== Hàng thông tin game =====
        info = QHBoxLayout()
        info.setSpacing(10)

        self.card_game = T.card('cardFlat')
        gl = QVBoxLayout(self.card_game)
        gl.setContentsMargins(14, 10, 14, 10)
        gl.setSpacing(2)
        gl.addWidget(T.label('GAME', 'mute'))
        self.lbl_game = T.label('Chưa mở', 'dim')
        self.lbl_game.setStyleSheet('font-weight:600;')
        gl.addWidget(self.lbl_game)
        info.addWidget(self.card_game, 1)

        self.card_lic = T.card('cardFlat')
        ll = QVBoxLayout(self.card_lic)
        ll.setContentsMargins(14, 10, 14, 10)
        ll.setSpacing(2)
        ll.addWidget(T.label('LICENSE', 'mute'))
        self.lbl_lic = T.label('Đang kiểm tra…', 'dim')
        self.lbl_lic.setStyleSheet('font-weight:600;')
        ll.addWidget(self.lbl_lic)
        info.addWidget(self.card_lic, 1)

        # ===== Thẻ LƯỢT CÒN LẠI (đếm theo phần cứng) =====
        #
        # YÊU CẦU CHỦ SHOP: hiện số lần dùng thử còn lại NGAY TRONG APP,
        # đếm theo phần cứng chứ không theo tài khoản web.
        #
        # HWID do chính tool này tính từ phần cứng (MachineGuid + BIOS + CPU
        # + Volume) — xem _hwid_parts(). Server đếm theo HWID nên khách đổi
        # tài khoản / xoá cookie vẫn là cùng máy, không lấy thêm được lượt.
        self.card_left = T.card('cardFlat')
        lfl = QVBoxLayout(self.card_left)
        lfl.setContentsMargins(14, 10, 14, 10)
        lfl.setSpacing(2)
        lfl.addWidget(T.label('LƯỢT CÒN LẠI', 'mute'))
        self.lbl_left = T.label('…', 'dim')
        self.lbl_left.setStyleSheet('font-weight:600;')
        lfl.addWidget(self.lbl_left)
        info.addWidget(self.card_left, 1)

        root.addLayout(info)

        # ===== Log =====
        root.addWidget(T.label('Nhật ký', 'dim'))
        self.log = T.log_view()
        self.log.setMinimumHeight(140)
        root.addWidget(self.log, 1)

        # ===== Chân =====
        foot = QHBoxLayout()
        foot.setSpacing(8)
        self.btn_clear = T.btn('Xoá log', 'ghost')
        self.btn_clear.clicked.connect(lambda: self.log.clear())
        foot.addWidget(self.btn_clear)
        self.btn_copy = T.btn('Sao chép log', 'ghost')
        self.btn_copy.clicked.connect(self._copy_log)
        foot.addWidget(self.btn_copy)
        foot.addStretch(1)
        self.btn_min = T.btn('Ẩn xuống', 'ghost',
                             tooltip='Thu nhỏ xuống khay hệ thống')
        self.btn_min.clicked.connect(self.showMinimized)
        foot.addWidget(self.btn_min)
        root.addLayout(foot)

        T.set_dark_titlebar(self)
        T.center_on_screen(self)

    # ---------------- tiện ích ----------------
    def _log(self, s):
        self.log.appendPlainText(str(s))
        sb = self.log.verticalScrollBar()
        sb.setValue(sb.maximum())

    def _state(self, text, kind='info', detail=''):
        role = {'info': 'dim', 'ok': 'ok', 'warn': 'warn',
                'err': 'err'}.get(kind, 'dim')
        self.lbl_state.setText('● ' + text)
        self.lbl_state.setProperty('role', role)
        self.lbl_state.style().unpolish(self.lbl_state)
        self.lbl_state.style().polish(self.lbl_state)
        self.lbl_detail.setText(detail or '')

    def _copy_log(self):
        try:
            QApplication.clipboard().setText(self.log.toPlainText())
            self._state(self.lbl_state.text().lstrip('● '), 'info',
                        'Đã sao chép log')
        except Exception:
            pass

    # ---------------- tự cập nhật ----------------

    def _start_update_check(self):
        """Kiểm tra bản mới ở NỀN. Không chặn GUI."""
        try:
            self._upd_info = None
            self._upd_worker = UpdateCheckWorker(self)
            self._upd_worker.found.connect(self._on_update_found)
            self._upd_worker.start()
        except Exception:
            pass

    def _on_update_found(self, info):
        if not info:
            return
        self._upd_info = info
        ver = info.get('version') or '?'
        self.btn_update.setText('Cập nhật %s' % ver)
        self.btn_update.show()
        try:
            self._say('Có bản mới %s — bấm "Cập nhật" để lấy.' % ver)
        except Exception:
            pass

    def _do_update(self):
        info = getattr(self, '_upd_info', None)
        if not info:
            return
        self.btn_update.setEnabled(False)
        self.btn_update.setText('Đang tải…')
        try:
            self._state('Đang tải bản mới…', 'warn', '')
        except Exception:
            pass
        try:
            self._upd_dl = UpdateDownloadWorker(info, self)
            self._upd_dl.progress.connect(self._on_update_progress)
            self._upd_dl.done.connect(self._on_update_done)
            self._upd_dl.start()
        except Exception:
            self.btn_update.setText('Cập nhật')
            self.btn_update.setEnabled(True)

    def _on_update_progress(self, got, total):
        try:
            self.btn_update.setText('%d%%' % int(100 * got / max(1, total)))
        except Exception:
            pass

    def _on_update_done(self, ok, msg):
        if not ok:
            try:
                self._state('Cập nhật thất bại', 'err', msg[:70])
                self._say('LỖI cập nhật: %s' % msg)
            except Exception:
                pass
            self.btn_update.setText('Cập nhật')
            self.btn_update.setEnabled(True)
            return
        try:
            self._state('Đã tải xong — khởi động lại…', 'ok', '')
        except Exception:
            pass
        try:
            import xa_nofog_pro as NF
            ok2, msg2 = NF.update_apply()
            if not ok2:
                try:
                    self._state('Không thay được file', 'err', msg2[:70])
                except Exception:
                    pass
                self.btn_update.setText('Cập nhật')
                self.btn_update.setEnabled(True)
                return
        except Exception:
            return
        try:
            if self.worker is not None:
                self.worker.stop()
        except Exception:
            pass
        try:
            self.hide()
        except Exception:
            pass
        import os as _os
        _os._exit(0)

    def _refresh_license(self):
        """Đọc state license và hiện hạn dùng."""
        try:
            import xa_nofog_pro as NF
            st = NF.load_state() or {}
            exp = st.get('expires_at')
            is_trial = False
            try:
                is_trial = bool(NF.is_trial(st))
            except Exception:
                pass
            if exp == 0:
                txt, role = 'Vĩnh viễn', 'ok'
            elif exp:
                try:
                    left = NF._fmt_left(st)
                except Exception:
                    left = '?'
                txt = 'Còn %s' % left
                role = 'warn' if is_trial else 'ok'
            else:
                txt, role = 'Chưa kích hoạt', 'err'
            self.lbl_lic.setText(txt)
            self.lbl_lic.setProperty('role', role)
            self.lbl_lic.style().unpolish(self.lbl_lic)
            self.lbl_lic.style().polish(self.lbl_lic)

            # ---- LƯỢT DÙNG THỬ CÒN LẠI (theo phần cứng) ----
            self._refresh_trial_left()

            # ---- KEY ĐÃ LƯU: tự động bật, không bắt nhập lại ----
            #
            # YÊU CẦU CHỦ SHOP: "nhập key lúc cài xong thì tự động gán luôn
            # khi chạy đi, đừng bắt nhập key nữa. Lưu vào mỗi khi bật app."
            #
            # lic.bin (DPAPI) đã có key từ lúc cài. Nếu khách chưa bật map
            # thì tool tự bật luôn — khách chỉ cần mở app là chạy.
            has_key = bool(st.get('key'))
            self._has_key = has_key
            if has_key:
                key = str(st.get('key'))
                masked = (key[:9] + '…' + key[-4:]) if len(key) > 14 else key
                self.lbl_lic.setToolTip('Key đã lưu: %s' % masked)
                self.btn_key.setText('Đổi key')
            else:
                self.btn_key.setText('Nhập key')

            return has_key
        except Exception as e:
            self.lbl_lic.setText('Không đọc được')
            self._log('Không đọc được license: %s' % e)
            return False

    # ---------------- hành vi ----------------
    def _refresh_trial_left(self):
        """Hiện số lượt dùng thử còn lại — đếm theo PHẦN CỨNG.

        HWID lấy từ chính máy này (NF.compute_hwid), server đếm theo HWID.
        Đổi tài khoản web / xoá cookie không làm tăng lượt.
        Không lấy được mạng -> hiện dấu "?" chứ không chặn tool.
        """
        try:
            import xa_nofog_pro as NF

            # Chỉ hiện khi license đang là dùng thử
            st = NF.load_state() or {}
            try:
                if not NF.is_trial(st):
                    self.lbl_left.setText('Đã mua')
                    return
            except Exception:
                pass

            hwid = ''
            try:
                hwid = NF.compute_hwid()
            except Exception:
                hwid = ''

            txt = '?'
            try:
                getf = getattr(NF, '_get', None)
                if getf and hwid:
                    r = getf('/api/trial/left?hwid=%s' % hwid) or {}
                    if r.get('ok'):
                        left = r.get('left')
                        quota = r.get('quota')
                        if left is None:
                            txt = 'Không giới hạn'
                        else:
                            txt = '%s/%s' % (left, quota)
            except Exception:
                txt = '?'

            self.lbl_left.setText(txt)
            role = 'warn'
            try:
                if txt not in ('?',) and '/' in txt:
                    n = int(str(txt).split('/')[0])
                    role = 'err' if n <= 0 else ('warn' if n <= 3 else 'ok')
            except Exception:
                pass
            self.lbl_left.setProperty('role', role)
            self.lbl_left.style().unpolish(self.lbl_left)
            self.lbl_left.style().polish(self.lbl_left)
        except Exception:
            pass

    def _running(self):
        return self.worker is not None and self.worker.isRunning()

    def _toggle(self):
        if self._running():
            self._stop_patch()
        else:
            self._start_patch()

    def _start_patch(self):
        self.btn_toggle.setEnabled(False)
        self.btn_toggle.setText('ĐANG KHỞI ĐỘNG…')
        self._log('')
        self._log('=== BẬT MAP SÁNG ===')

        self.worker = PatchWorker(self)
        self.worker.log.connect(self._log)
        self.worker.state.connect(self._on_state)
        self.worker.game_seen.connect(self._on_game_seen)
        self.worker.needs_key.connect(self._on_needs_key)
        self.worker.finished.connect(self._on_worker_done)
        self.worker.start()

        # Cập nhật hạn dùng mỗi 15 giây
        if self._lic_timer is None:
            self._lic_timer = QTimer(self)
            self._lic_timer.timeout.connect(self._refresh_license)
        self._lic_timer.start(15000)

        QTimer.singleShot(600, lambda: self._set_toggle(True))

    def _set_toggle(self, running):
        self.btn_toggle.setEnabled(True)
        self.btn_toggle.setText('TẮT MAP SÁNG' if running else 'BẬT MAP SÁNG')
        self.btn_toggle.setProperty('role', 'danger' if running else 'primary')
        self.btn_toggle.style().unpolish(self.btn_toggle)
        self.btn_toggle.style().polish(self.btn_toggle)

    def _stop_patch(self):
        self._log('Đang tắt…')
        self.btn_toggle.setEnabled(False)
        self.btn_toggle.setText('ĐANG TẮT…')
        if self._lic_timer is not None:
            self._lic_timer.stop()
        w = self.worker
        if w is not None:
            w.stop()
            # Chờ vòng lặp thoát (poll 0.1s nên rất nhanh)
            if not w.wait(4000):
                w.terminate()
                w.wait(1000)
        self._set_toggle(False)
        self.lbl_game.setText('Chưa mở')
        self._state('Đã tắt', 'info',
                    'Byte gốc vẫn trong RAM game. Đóng game là sạch hoàn toàn.')

    def _on_state(self, text, kind, detail):
        self._state(text, kind, detail)

    def _on_game_seen(self, seen):
        self.lbl_game.setText('Đã kết nối' if seen else 'Chưa mở')

    def _on_needs_key(self):
        """License thiếu/hỏng: mở khoá nút Đổi key để khách sửa ngay.

        LỖI ĐÃ GẶP: nút "Đổi key" bị disable khi tool đang chạy, nên khách
        thấy lỗi "Không có bảng offset" mà KHÔNG bấm được gì — phải tắt tool
        mở lại. Nay nút luôn bấm được, và sáng lên khi cần nhập key.
        """
        self.btn_key.setEnabled(True)
        self.btn_key.setProperty('role', 'primary')
        self.btn_key.style().unpolish(self.btn_key)
        self.btn_key.style().polish(self.btn_key)

    def _on_worker_done(self):
        # Worker tự thoát (hết license, lỗi bảng offset)
        self._set_toggle(False)
        if self._lic_timer is not None:
            self._lic_timer.stop()

    def _ask_key(self):
        from PyQt6.QtWidgets import QInputDialog
        key, ok = QInputDialog.getText(
            self, 'Nhập license key',
            'Dán key AOE1-XXXX-XXXX-XXXX:')
        key = (key or '').strip()
        if not ok or not key:
            return
        self._log('Đang kích hoạt %s …' % key)
        self.act_worker = ActivateWorker(key, self)
        self.act_worker.log.connect(self._log)

        def done(okA, msg):
            self._refresh_license()
            if okA:
                QMessageBox.information(
                    self, 'Thành công',
                    'Đã kích hoạt key.\n\nBấm BẬT MAP SÁNG để bắt đầu.')
            else:
                QMessageBox.critical(self, 'Kích hoạt thất bại', msg)
        self.act_worker.done.connect(done)
        self.act_worker.start()

    def closeEvent(self, e):
        if self._running():
            r = QMessageBox.question(
                self, 'Đang chạy',
                'Tool đang bật map sáng.\n\n'
                'Tắt tool bây giờ?\n\n'
                '(Byte gốc vẫn nằm trong RAM game — đóng game là sạch.)',
                QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
                QMessageBox.StandardButton.No)
            if r != QMessageBox.StandardButton.Yes:
                e.ignore()
                return
            self._stop_patch()
        e.accept()


def run_gui():
    app = QApplication.instance() or QApplication(sys.argv)
    T.apply_theme(app)
    win = NoFogWindow()
    win.show()
    return app.exec()
