# -*- coding: utf-8 -*-
"""xa_arena_gui.py — Giao diện MỘT app cho cả 2 chức năng.

==================  BỐ CỤC  ==================

  ┌─────────────────────────────────────────────────────┐
  │ ⚡ XA ARENA              v1.0.0   [Đăng nhập] [Key] │  <- thanh trên
  ├─────────────────────────────────────────────────────┤
  │ ● Trạng thái: Đã kết nối game · Quyền: Map + Tài nguyên │
  ├─────────────────────────────────────────────────────┤
  │  MAP SÁNG                                           │  <- chỉ hiện nếu có quyền
  │  [      BẬT MAP SÁNG      ]                         │
  ├─────────────────────────────────────────────────────┤
  │  TÀI NGUYÊN                                         │  <- chỉ hiện nếu có quyền
  │  [+1.000] [+5.000] [+10.000] [+50.000] [+100.000]   │
  │  [ số khác          ] [+]                           │
  │  [+ Nút]  [20 thịt 20 gỗ]                           │
  ├─────────────────────────────────────────────────────┤
  │  GAME: Chưa mở   LICENSE: Còn 7 ngày   LƯỢT: 9/10   │
  ├─────────────────────────────────────────────────────┤
  │  [Nhật ký ...............................]          │
  └─────────────────────────────────────────────────────┘

  Khách KHÔNG có quyền "grant" -> toàn bộ khối TÀI NGUYÊN bị ẩn.
  Khách KHÔNG có quyền "nofog" -> toàn bộ khối MAP SÁNG bị ẩn.
  Không hiện nút xám, không báo "bạn không có quyền" — chỉ đơn giản là ẩn.
"""

import os
import sys
import time

_HERE = os.path.dirname(os.path.abspath(__file__))

import xa_arena_api as API
import xa_theme as T
import xa_trial_rules as TR
from PyQt6.QtCore import Qt, QThread, QTimer, QEvent, pyqtSignal, QSize
from PyQt6.QtGui import (
    QGuiApplication, QPainter, QColor, QPixmap, QIcon, QLinearGradient, QBrush,
    QCursor,
)
from PyQt6.QtWidgets import (
    QApplication, QWidget, QVBoxLayout, QHBoxLayout, QGridLayout, QLabel,
    QPushButton, QDialog, QLineEdit, QSpinBox, QMessageBox,
    QDialogButtonBox, QMenu, QScrollArea, QFrame, QSizePolicy,
)

# ---------------------------------------------------------------------------
# Hằng số nghiệp vụ
# ---------------------------------------------------------------------------

# Bỏ nút +100.000 (chủ shop: "xóa luôn 100000"). Trần mỗi lần bấm là
# 10.000, thiếu thì bấm thêm lần nữa.
AMOUNTS = [
    (100, '+100'), (500, '+500'), (1000, '+1.000'), (10000, '+10.000'),
    # Bỏ "+50.000": trần mỗi lần bấm là 10.000, nên nút này chỉ cộng
    # 10.000 mà nhãn ghi 50.000 — gây hiểu sai. Muốn thêm thì bấm lại.
]

RES_ORDER = ['F', 'W', 'G']

# ---------------------------------------------------------------------------
# MỐC PHÚT BẮT ĐẦU CỘNG VÀNG
#
# Chủ shop: "sửa lại dưới phút thứ 12 không cộng vàng".
#
# Vàng là tài nguyên khan hiếm nhất giai đoạn đầu trận; cộng vàng sớm là
# dấu hiệu bất thường rõ nhất. Từ phút 12 trở đi mới cộng vàng.
# ---------------------------------------------------------------------------
GOLD_FROM_MIN = 12
RES_VN = {'F': 'thịt', 'W': 'gỗ', 'S': 'đá', 'G': 'vàng'}

GRANT_DELAY = 1.0

# ---------------------------------------------------------------------------
# TRẦN MỖI LẦN BẤM + MỨC CỘNG THEO PHÚT
#
# Chủ shop: "trần là 10000 thôi" và "phút 1 cộng max được 200 thôi,
# phút 2 300, phút 3 400... cộng dần dần".
#
# GRANT_CAP         : tổng tối đa mỗi lần bấm (10.000)
# GRANT_STEP_MIN    : mức cộng tối đa ở phút 1 (200)
# GRANT_STEP_ADD    : mỗi phút cộng thêm 100 -> 200, 300, 400, ...
# GRANT_STEP_MAX    : chặn trên (phút 50 không thành 5.100)
# GRANT_STEP_GAP_MS : cách nhau ~1,5 giây mỗi bước
# ---------------------------------------------------------------------------
GRANT_CAP = 10000          # trần THẬT mỗi lần bấm (chặn trong
#                            `_grant_amounts`, không chỉ là con số trang trí)

# Chặn chế độ TỪ TỪ chạy quá lâu.
#
# +10.000 ở phút 1 (bước 10) sẽ là 1.000 bước × 300 ms = 5 PHÚT — vô lý.
# Trần này chỉ ảnh hưởng mục LỚN; mục nhỏ (+100…+1.000) vẫn giữ nguyên
# số bước cũ vì ước lượng bước cần thiết < 120.
GRANT_MAX_STEPS = 120
# Chủ shop: "thiếu thì ra bấm thêm". Trần lớn + bước nhỏ = hàng trăm
# bước = khách chờ hàng phút. Trần 2.000 là cân bằng.
# CHẾ ĐỘ NHANH (chuột phải) — chủ shop: "thêm chuột phải là cộng nhanh".
#
# Chuột TRÁI giữ nguyên: nhiều bước nhỏ, cách 300 ms (từ từ, khó phát
# hiện). Chuột PHẢI: ít bước lớn, cách 500 ms (nhanh, đỡ phải chờ).
GRANT_FAST_STEPS = 4        # số bước cho mỗi tài nguyên ở chế độ nhanh

# Khoảng cách ở chế độ nhanh PHẢI <= chế độ từ từ.
#
# LỖI ĐÃ SỬA (đo được): đặt 500 ms thì ở phút 2, nút +100 lại CHẬM HƠN
# chế độ từ từ (4 bước × 500 = 1,5 s so với 5 bước × 300 = 1,2 s) —
# vì tốc độ phụ thuộc CẢ số bước LẪN khoảng cách.
#
# Nay bằng nhau (300 ms): thời gian = (số bước − 1) × 300, mà chế độ
# nhanh luôn có số bước ≤ chế độ từ từ ⇒ nhanh KHÔNG BAO GIỜ chậm hơn.
GRANT_FAST_GAP_MS = 300

GRANT_STEP_GAP_MS = 300    # cách nhau 0,3 giây mỗi bước
# Bước nhỏ (vài chục) nên phải đi nhanh, nếu không khách chờ quá lâu.
# 300 ms an toàn: lớn hơn nhịp poll 200 ms của "Mua 2 tính 1" nên hai
# bên không chồng nhau, và engine vẫn xử lý kịp từng record.

# ---------------------------------------------------------------------------
# MỨC TỐI ĐA MỖI BƯỚC, THEO SỐ PHÚT VÀO TRẬN
#
# Chủ shop: "phút 1 cộng 100, phút 2 200, 3 200, 4 200, 5 200. Lên phút
# 10 đổ đi cộng 300, 11 cộng 400, 12 cộng 500... cứ thế cộng lên cho đỡ
# nghi ngờ."
#
#   phút 1        -> 100
#   phút 2 .. 9   -> 200
#   phút 10       -> 300
#   phút 11       -> 400
#   phút 12       -> 500   (+100 mỗi phút)
#   chặn trên     -> 3000
# ---------------------------------------------------------------------------
GRANT_STEP_P1 = 10         # phút 1        -> 10 mỗi bước
GRANT_STEP_MID = 20        # phút 2..5     -> 20
GRANT_STEP_LATE = 30       # phút 6..9     -> 30
GRANT_STEP_M10 = 40        # phút 10 trở đi, +10 mỗi phút
GRANT_STEP_ADD = 10
GRANT_STEP_MAX = 100       # chặn trên: không bao giờ quá 100/bước
RESIDENT_POLL = 2.0
# Bao lau kiem lai token mot lan (giay). 90s du de phat hien het han
# som ma khong ton CPU. KHONG goi mang: chi doc lai file state.
REVERIFY_SEC = 90.0
# Bao lau xac thuc lai voi SERVER (giay). Day la lop chong "thu hoi key
# ma client van chay": token ky 30 ngay, nhung chi can 5 phut la app biet
# key da bi thu hoi.
RECHECK_SEC = 300.0

# ---------------------------------------------------------------------------
# NHỊP TỰ LÀM MỚI — chủ shop: "cái gì cũng real time".
#
# Đang CHỜ (chưa dùng được chức năng nào, hoặc vừa mua xong trên web) thì
# hỏi server dày hơn để khách thấy quyền mới gần như ngay; đã có quyền rồi
# thì thưa lại cho nhẹ máy.
# ---------------------------------------------------------------------------
RT_WAIT_MS = 20000        # 20 giây khi đang chờ mua / hết lượt
RT_IDLE_MS = 60000        # 60 giây khi đã dùng được
# ---------------------------------------------------------------------------
# BỊ ĐÁ SANG MÁY KHÁC -> HỎI SERVER RẤT THƯA.
#
# Chủ shop: "chỉ 1 nick 1 máy 1 thời điểm, đăng nhập nhiều lần nhiều máy
# 1 nick để dùng thì không cho phép". Máy bị đá mà vẫn hỏi dồn dập thì hai
# máy đá nhau liên tục — cả hai đều không dùng được. Nên máy bị đá lùi hẳn
# về 5 phút/lần và KHÔNG tự đăng nhập lại: chỉ khách bấm "Đăng nhập lại".
# ---------------------------------------------------------------------------
RT_KICKED_MS = 300000
RT_TICK_MS = 1000
# Đồng hồ hiển thị: chỉ đổi CHỮ trên màn hình, KHÔNG gọi mạng.
# Nhờ nó "còn 54 phút" tự nhảy về "53 phút" ngay trước mắt khách.
RT_TICK_MS = 1000
# Giữ dải thông báo "đã nhận bản quyền mới" bao lâu.
TOAST_MS = 8000
# Kích hoạt lại cửa sổ (khách quay về từ trình duyệt) mà hỏi server ngay
# thì phải cách lần trước ít nhất chừng này giây, tránh dồn dập.
FOCUS_MIN_GAP = 5.0


# ---------------------------------------------------------------------------
# Tiện ích
# ---------------------------------------------------------------------------

def _fmt_num(n):
    """Số kiểu Việt Nam: 1.000 · 50.000 · 1.000.000.

    LỖI ĐÃ SỬA: trước đây hàm này trả '1.0m' / '50k' trong khi các nút ghi
    '+1.000' -> hai kiểu số khác nhau trên cùng một màn hình.
    """
    try:
        v = int(round(float(n)))
    except Exception:
        return '?'
    neg = v < 0
    s = str(abs(v))
    out = ''
    while len(s) > 3:
        out = '.' + s[-3:] + out
        s = s[:-3]
    out = s + out
    return ('-' + out) if neg else out


def _mask_key(k):
    """Key đã che phần giữa — chỉ hiện đầu/cuối để khách nhận ra key."""
    k = str(k or '').strip()
    if not k:
        return ''
    if len(k) <= 8:
        return k[:2] + '***'
    return k[:4] + '*' * max(3, min(12, len(k) - 8)) + k[-4:]


def _set_button_text(btn, txt):
    """Đặt chữ cho nút (bọc lại để mọi chỗ đổi chữ đi qua một cửa)."""
    try:
        btn.setText(str(txt))
    except Exception:
        pass


def _tech_file(msg):
    """Chi tiết kỹ thuật — CHỈ ghi ra file khi BẬT debug, KHÔNG hiện cho khách.

    Mặc định (không XA_DEBUG=1, không --debug-log) là no-op: máy khách
    không có arena_detail.log. Khi bật, dòng bị che key/token/HWID/địa chỉ
    và file bị giới hạn 64 KB (xa_arena_api.debug_log).

    Dùng chung cho cả worker (QThread) lẫn cửa sổ chính.
    """
    try:
        API.debug_log(API.LOG_DETAIL, msg)
    except Exception:
        pass


def _is_admin():
    """Đang chạy với quyền Administrator?"""
    try:
        import ctypes
        return bool(ctypes.windll.shell32.IsUserAnAdmin())
    except Exception:
        return False


def _avail_height():
    """Chiều cao vùng làm việc khả dụng (đã trừ taskbar). 0 = không rõ."""
    try:
        scr = QGuiApplication.primaryScreen()
        if scr is None:
            return 0
        return int(scr.availableGeometry().height())
    except Exception:
        return 0


def _clamp_h(h):
    """Không cho cửa sổ cao quá vùng làm việc.

    LỖI ĐÃ SỬA: cửa sổ khoá cứng 760/780/820px, nhưng màn hình 1366x768
    chỉ còn ~728px dùng được -> mép dưới (kể cả nút "Đóng") nằm ngoài
    màn hình, khách không bấm được.
    """
    try:
        h = int(h)
    except Exception:
        return 600
    avail = _avail_height()
    if avail > 0:
        return max(360, min(h, avail - 24))
    return max(360, h)


def _fix_height(w, extra=0):
    """Khoá chiều cao widget theo nội dung.

    VÌ SAO CẦN: QVBoxLayout chia khoảng trống thừa cho mọi widget có thể
    giãn. Khi cửa sổ to ra (1920x1080) các khối bị kéo cao 200-250px và
    layout vỡ hẳn. Hàm này buộc widget chỉ cao bằng nội dung của nó.

    extra: cộng thêm pixel (dùng cho card có lề trong).
    """
    w.setSizePolicy(QSizePolicy.Policy.Preferred,
                    QSizePolicy.Policy.Fixed)
    w.setFixedHeight(max(1, w.sizeHint().height() + int(extra or 0)))
    return w


def app_icon():
    """Icon tia sét trên nền gradient."""
    pm = QPixmap(64, 64)
    pm.fill(Qt.GlobalColor.transparent)
    p = QPainter(pm)
    p.setRenderHint(QPainter.RenderHint.Antialiasing)
    g = QLinearGradient(0, 0, 64, 64)
    g.setColorAt(0, QColor(T.COLORS.get('accent', '#2f81f7')))
    g.setColorAt(1, QColor(T.COLORS.get('accent_hi', '#5b9dff')))
    p.setBrush(QBrush(g))
    p.setPen(Qt.PenStyle.NoPen)
    p.drawRoundedRect(2, 2, 60, 60, 14, 14)
    p.setBrush(QBrush(QColor('#ffffff')))
    from PyQt6.QtGui import QPolygonF
    from PyQt6.QtCore import QPointF
    poly = QPolygonF([QPointF(36, 12), QPointF(22, 36),
                      QPointF(31, 36), QPointF(27, 52),
                      QPointF(43, 28), QPointF(34, 28)])
    p.drawPolygon(poly)
    p.end()
    return QIcon(pm)


# ---------------------------------------------------------------------------
# Nút tự tạo (lưu lại)
# ---------------------------------------------------------------------------

def _buttons_path():
    return os.path.join(API.state_dir(), 'arena_buttons.json')


def load_buttons():
    import json
    try:
        with open(_buttons_path(), 'r', encoding='utf-8') as f:
            d = json.load(f)
        if not isinstance(d, list):
            return []
        out = []
        for b in d:
            if not isinstance(b, dict):
                continue
            try:
                out.append({
                    'ten': str(b.get('ten') or '')[:24],
                    'F': max(0, int(b.get('F') or 0)),
                    'W': max(0, int(b.get('W') or 0)),
                    'S': max(0, int(b.get('S') or 0)),
                    'G': max(0, int(b.get('G') or 0)),
                })
            except Exception:
                continue
        return out[:12]
    except Exception:
        return []


def save_buttons(lst):
    import json
    try:
        with open(_buttons_path(), 'w', encoding='utf-8') as f:
            json.dump(lst[:12], f, ensure_ascii=False, indent=1)
        return True
    except Exception:
        return False


def button_label(b):
    ten = (b.get('ten') or '').strip()
    if ten:
        return ten
    parts = []
    for k in RES_ORDER:
        v = int(b.get(k) or 0)
        if v > 0:
            parts.append('%s %s' % (_fmt_num(v), RES_VN[k]))
    return ' + '.join(parts) if parts else '?'


# ---------------------------------------------------------------------------
# Worker: kiểm tra quyền
# ---------------------------------------------------------------------------

class UpdateCheckWorker(QThread):
    """Hỏi server xem có bản mới."""

    found = pyqtSignal(object)

    def __init__(self, parent=None):
        super().__init__(parent)
        self.reason = ''

    def run(self):
        """Hỏi bản mới. Đặt `self.reason` khi KHÔNG lấy được thông tin.

        LỖI ĐÃ SỬA: trước đây 4 kết quả khác nhau đều emit(None) nên GUI
        không phân biệt được "đã mới nhất" với "lỗi mạng".
        """
        self.reason = ''
        try:
            import xa_arena_app as APP
            U = APP._updater()
            if not U:
                self.reason = 'không nạp được module cập nhật'
                self.found.emit(None)
                return
            info = U.check('https://xienhl.com', 'arena')
            if not info.get('ok'):
                self.reason = str(info.get('err') or 'không hỏi được server')
                self.found.emit(None)
                return
            if not U.is_newer(info.get('version') or '',
                              APP.APP_VERSION):
                # Đã mới nhất — KHÔNG phải lỗi
                self.found.emit(None)
                return
            self.found.emit(info)
        except Exception as e:
            self.reason = str(e)[:120]
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
            import xa_arena_app as APP
            U = APP._updater()
            exe = APP.exe_path()
            if not U or not exe:
                self.done.emit(False, 'khong xac dinh duoc file')
                return
            ok, msg = U.download(
                self.info, exe, lambda g, t: self.progress.emit(g, t))
            self.done.emit(ok, msg)
        except Exception as e:
            self.done.emit(False, str(e)[:120])


class TokenWorker(QThread):
    """Bảo đảm token cục bộ khớp quyền. Chạy nền vì có gọi mạng."""

    step = pyqtSignal(str)
    # (ok, msg, mã lỗi) — mã lỗi để GUI chọn đúng câu hướng dẫn kế tiếp.
    done = pyqtSignal(bool, str, str)

    def __init__(self, ent, parent=None):
        super().__init__(parent)
        self.ent = ent

    def run(self):
        try:
            ok, msg = API.ensure_tokens(
                self.ent, on_step=lambda m: self.step.emit(m))
            if ok:
                ok2, msg2 = API.ensure_grant_token(self.ent)
                if not ok2:
                    self.done.emit(False, msg2, API.last_error_code())
                    return
            self.done.emit(ok, msg,
                           '' if ok else API.last_error_code())
        except Exception as e:
            API.set_last_code('network')
            self.done.emit(False, str(e)[:120], 'network')


class FreeTrialWorker(QThread):
    """Bắt đầu/tiếp tục lượt dùng thử THEO TÀI KHOẢN.

    Chủ shop chốt: mỗi tài khoản mới được 1 NGÀY, bật CẢ map sáng và tài
    nguyên, KHÔNG cần nhập mã. Bắt buộc đã đăng nhập.

    Chạy nền để cửa sổ không đứng hình khi mạng chậm.
    """
    done = pyqtSignal(dict)

    def __init__(self, product=None, parent=None):
        super().__init__(parent)
        # `product` giữ lại cho tương thích chỗ gọi cũ; mô hình mới luôn
        # bật CẢ HAI tính năng trong cùng một lượt dùng thử.
        self.product = product

    def run(self):
        try:
            import xa_arena_api as API
            r = API.start_account_trial()
        except Exception as e:
            r = {'ok': False, 'state': 'error', 'left': None,
                 'left_sec': 0,
                 'msg': 'Chưa bật được dùng thử. Bấm "Kiểm tra lại".'}
        self.done.emit(r or {})


class EntitlementWorker(QThread):
    """Hỏi /api/entitlement ở nền (+ số lượt dùng thử nếu được yêu cầu)."""

    done = pyqtSignal(object)

    def __init__(self, key=None, parent=None, with_quota=False):
        super().__init__(parent)
        self.key = key
        self.with_quota = bool(with_quota)

    def run(self):
        try:
            if self.key:
                d = API.fetch_by_key(self.key)
            else:
                d = API.fetch_entitlement()
            d = d or {}
            if self.with_quota:
                # ----------------------------------------------------------
                # HỎI KÈM SỐ LƯỢT — "cái gì cũng real time".
                #
                # Chạy TRONG THREAD NÀY, không mở thêm thread: chỉ một
                # lượt hỏi mạng cho mỗi lần làm mới, nên không bao giờ
                # chồng worker và không treo giao diện.
                #
                # Ưu tiên khối `trial` mà server trả kèm /api/entitlement
                # (hạn mức dùng thử của MÁY đang gọi): có rồi thì KHÔNG gọi
                # thêm /api/trial/left nữa. Không có thì hỏi đường cũ.
                # ----------------------------------------------------------
                if isinstance(d, dict):
                    for _slot, _prod in (('_quota', 'nofog'),
                                         ('_quota_res', 'xagrant')):
                        _q = None
                        try:
                            _q = API.quota_from_entitlement(d, _prod)
                        except Exception:
                            _q = None
                        if _q is None:
                            try:
                                _q = API.quota_snapshot(_prod)
                            except Exception:
                                _q = None
                        if _q is not None:
                            d[_slot] = _q
            self.done.emit(d)
        except Exception as e:
            self.done.emit({'ok': False, 'code': 'error', 'msg': str(e)[:120]})


class LoginWorker(QThread):
    """Đăng nhập hoặc TẠO TÀI KHOẢN ở nền."""

    done = pyqtSignal(bool, str)

    def __init__(self, u, p, parent=None, register=False):
        super().__init__(parent)
        self.u, self.p = u, p
        self.register = bool(register)

    def run(self):
        try:
            if self.register:
                ok, msg = API.register(self.u, self.p)
            else:
                ok, msg = API.login(self.u, self.p)
            self.done.emit(ok, msg or '')
        except Exception as e:
            self.done.emit(False, str(e)[:120])


# ---------------------------------------------------------------------------
# Worker: vá map sáng (giữ nguyên logic NoFog)
# ---------------------------------------------------------------------------

class PatchWorker(QThread):
    """Bật/tắt map sáng. Dùng nguyên logic xa_nofog_pro."""

    log = pyqtSignal(str)
    state = pyqtSignal(str, str)          # (text, kind)
    game_seen = pyqtSignal(bool)
    game_text = pyqtSignal(str)           # nhãn GAME khi không chỉ là bật/tắt
    need_key = pyqtSignal()

    def __init__(self, parent=None, ent=None):
        super().__init__(parent)
        # Quyền hiện tại — dùng để xác thực lại với server.
        # Truyền vào để không phải đọc lại file mỗi vòng.
        self._ent = ent or {}
        self.h = None
        self.base = 0
        self.pid = 0
        self.sites = None
        self._stop = False
        self.patched = False
        self.needs_admin = False
        self._expired = False
        self._denied = False        # đã báo "thiếu quyền admin" chưa

    def stop(self):
        self._stop = True

    def _sleep(self, sec):
        step, left = 0.1, float(sec)
        while left > 0 and not self._stop:
            self.msleep(int(step * 1000))
            left -= step

    def _close(self):
        if self.h:
            try:
                import ctypes
                ctypes.WinDLL('kernel32').CloseHandle(ctypes.c_void_p(self.h))
            except Exception:
                pass
        self.h = None
        self.base = 0
        self.pid = 0

    def run(self):
        # ------------------------------------------------------------------
        # NẠP MODULE TRONG try — LỖI ĐÃ SỬA
        #
        # Trước đây `import xa_nofog_pro` nằm NGOÀI try, ngay đầu run().
        # Nếu file module thiếu/hỏng thì thread chết im lặng: nút map sáng
        # không bao giờ bật và khách không nhận được lời nào.
        # ------------------------------------------------------------------
        try:
            import xa_nofog_pro as NF
        except Exception as e:
            _tech_file('import xa_nofog_pro: %s' % e)
            self.state.emit('Không nạp được chức năng map sáng', 'err')
            self.log.emit('Cài lại app rồi thử lại.')
            return

        # Nạp bảng vá từ token
        try:
            st = NF.load_state() or {}
            if st.get('xn_token'):
                NF._load_sites(st)
        except Exception:
            pass
        try:
            self.sites = NF._require_sites().full()
        except Exception:
            self.state.emit('Cần kích hoạt key', 'err')
            self.need_key.emit()
            return

        self.state.emit('Đang chờ game…', 'info')
        self.game_seen.emit(False)

        # Mốc kiểm lại token. Ban đầu coi như vừa kiểm xong.
        import time as _t
        last_verify = _t.time()
        last_server_check = _t.time()
        self._expired = False

        while not self._stop:
            # ---------------------------------------------------------
            # KIỂM LẠI LICENSE ĐỊNH KỲ — LỖI ĐÃ SỬA
            #
            # Trước đây chỉ nạp token một lần lúc bắt đầu. License hết hạn
            # giữa trận vẫn vá tiếp -> dùng miễn phí vô hạn.
            # ---------------------------------------------------------
            if _t.time() - last_verify >= REVERIFY_SEC:
                last_verify = _t.time()
                try:
                    st2 = NF.load_state() or {}
                    ok2, msg2 = NF._load_sites(st2, verbose=False)
                except Exception:
                    ok2, msg2 = True, ''      # lỗi đọc -> không cắt oan
                if not ok2:
                    self._expired = True
                    _tech_file('license: %s' % msg2)
                    self.log.emit('Key đã hết hạn. Mua/gia hạn tại xienhl.com')
                    self.state.emit('License đã hết hạn', 'err')
                    break

                # ------------------------------------------------------
                # XÁC THỰC LẠI VỚI SERVER — LỖ HỔNG ĐÃ SỬA
                #
                # Token được ký hạn 30 ngày. Nếu chủ shop THU HỒI key,
                # kiểm tra cục bộ KHÔNG biết -> app vẫn chạy đủ 30 ngày.
                # Đây chính là hiện tượng "thu hồi hết key mà vẫn còn
                # thời gian". Nay cứ RECHECK_SEC giây hỏi server 1 lần.
                # ------------------------------------------------------
                if _t.time() - last_server_check >= RECHECK_SEC:
                    last_server_check = _t.time()
                    try:
                        import xa_arena_api as _API
                        okS, whyS = _API.server_recheck(self._ent)
                    except Exception:
                        okS, whyS = True, ''     # lỗi -> không cắt oan
                    if not okS:
                        self._expired = True
                        # Chi tiết (mã lỗi server) chỉ ghi ra file; khách
                        # nhận câu tiếng Việt cụ thể, không phải mã kỹ thuật.
                        _tech_file('server_recheck: %s' % whyS)
                        self.log.emit(API.next_step_for(whyS) or
                                      'Key không còn hiệu lực. Liên hệ hỗ trợ.')
                        self.state.emit(API.state_text_for(whyS), 'err')
                        break

                # Cập nhật lại bảng cổng (token có thể vừa đổi)
                try:
                    self.sites = NF._require_sites().full()
                except Exception:
                    pass

            try:
                procs = NF.find_game()
            except Exception:
                procs = []
            if not procs:
                if self.patched:
                    self._close()
                    self.patched = False
                self.game_seen.emit(False)
                self._sleep(RESIDENT_POLL)
                continue

            pid = procs[0][0]
            if pid != self.pid:
                self._close()
                try:
                    h, base = NF.attach(pid)
                except Exception as e:
                    _tech_file('attach: %s' % e)
                    h, base = None, None
                if not h:
                    # --------------------------------------------------
                    # THẤY GAME NHƯNG KHÔNG VÀO ĐƯỢC — LỖI ĐÃ SỬA
                    #
                    # Trước đây `continue` im lặng: nhãn GAME đứng nguyên
                    # "Chưa mở" mãi và khách không biết phải làm gì, dù
                    # nguyên nhân gần như luôn là thiếu quyền Administrator.
                    # --------------------------------------------------
                    if not self._denied:
                        self._denied = True
                        if not _is_admin():
                            self.state.emit(
                                'Cần chạy bằng quyền Administrator', 'err')
                            self.log.emit(
                                'Tắt app, chuột phải file > Run as administrator.')
                            self.game_text.emit('Thiếu quyền')
                        else:
                            self.state.emit('Không kết nối được game', 'err')
                            self.log.emit('Thử tắt game rồi mở lại.')
                            self.game_text.emit('Chưa mở')
                    self._sleep(RESIDENT_POLL)
                    continue
                self._denied = False
                self.h, self.base, self.pid = h, base, pid
                self.game_seen.emit(True)

            # Chỉ vá khi ĐÃ VÀO TRẬN
            try:
                inside = NF.in_match(self.h, self.base)
            except Exception:
                inside = False

            if not inside:
                if self.patched:
                    try:
                        NF.apply_set(self.h, self.base, self.sites,
                                     True, 'all', quiet=True)
                    except Exception:
                        pass
                    self.patched = False
                    self.log.emit('Tắt map sáng.')
                self.state.emit('Chờ vào trận…', 'info')
                self._sleep(RESIDENT_POLL)
                continue

            try:
                changed, bad = NF.apply_set(self.h, self.base, self.sites,
                                            False, 'all', quiet=True)
            except Exception as e:
                _tech_file('patch: %s' % e)
                self.log.emit('Không va được vào game lần này.')
                self._sleep(RESIDENT_POLL)
                continue

            if bad:
                _tech_file('patch: some sites failed')
                self.log.emit('Chưa bật được map sáng.')
                self.state.emit('Không bật được map sáng', 'err')
            else:
                if not self.patched:
                    self.log.emit('Bật map sáng.')
                self.patched = True
                self.state.emit('Đang bật map sáng', 'ok')
            self._sleep(RESIDENT_POLL)

        # Thoát (dù do stop hay do hết hạn): TRẢ BYTE GỐC.
        # Đây là điểm then chốt: license hết hạn mà không trả byte thì
        # map vẫn sáng tới khi tắt game -> lộ hoàn toàn.
        if self.patched and self.h:
            try:
                NF.apply_set(self.h, self.base, self.sites, True, 'all',
                             quiet=True)
                self.log.emit('Tắt map sáng.')
            except Exception:
                pass
            self.patched = False
        self._close()

        # Báo GUI nếu dừng vì hết hạn (không phải do người dùng tắt)
        if getattr(self, '_expired', False) and not self._stop:
            self.state.emit('License đã hết hạn — đã tắt map sáng', 'err')


# ---------------------------------------------------------------------------
# Worker: cộng tài nguyên (giữ nguyên logic XAGrant)
# ---------------------------------------------------------------------------

class RefundWorker(QThread):
    """Chạy `RefundWatcher.tick()` ở THREAD RIÊNG.

    LỖI ĐÃ SỬA (R2): trước đây watcher chạy bằng `QTimer` trên GUI
    thread. Mỗi `do_grant` có thể chờ tới 5 giây (WaitForSingleObject),
    và một đợt hoàn 3 loại có thể mất ~16-22 giây ⇒ TREO GIAO DIỆN,
    lặp lại mỗi đợt. Nay chạy nền, GUI không bao giờ đứng.

    `_ENGINE_LOCK` (non-blocking) vẫn bảo đảm không chồng với
    `GrantWorker` — hai bên dùng CHUNG một khoá.
    """

    event = pyqtSignal(object)      # list[(res, amount)]
    died = pyqtSignal()             # game đã tắt

    def __init__(self, watcher, parent=None, interval_ms=200):
        super().__init__(parent)
        self.w = watcher
        self.interval_ms = max(100, int(interval_ms))
        self._stop = False

    def stop(self):
        """Yêu cầu dừng (không chặn)."""
        self._stop = True

    def run(self):
        import time as _t
        while not self._stop:
            try:
                if getattr(self.w, '_dead', False) or not self.w.alive():
                    self.died.emit()
                    return
                done = self.w.tick()
                if done:
                    self.event.emit(done)
            except Exception:
                # Lỗi lẻ không được giết worker; thoát nếu watcher chết.
                if getattr(self.w, '_dead', False):
                    self.died.emit()
                    return
            # Ngủ từng bước nhỏ để `stop()` phản ứng nhanh.
            _end = _t.time() + self.interval_ms / 1000.0
            while not self._stop and _t.time() < _end:
                self.msleep(25)


class GrantWorker(QThread):
    """Cộng tài nguyên. amounts = {'F':20,'W':20,'G':0}."""

    log = pyqtSignal(str)
    state = pyqtSignal(str, str)
    finished_ok = pyqtSignal(bool)

    def __init__(self, h, base, amounts, parent=None, mins=1, fast=False):
        super().__init__(parent)
        self.h = h
        self.base = base
        # Chế độ nhanh (chuột phải): ít bước lớn thay vì nhiều bước nhỏ.
        self.fast = bool(fast)
        # LỖI ĐÃ SỬA (P0): trước đây `mins` là tham số nhưng KHÔNG được
        # gán vào `self.mins`. `run()` đọc bằng `getattr(self,'mins',1)`
        # nên luôn nhận 1 ⇒ mức cộng luôn là mức phút 1 (100), dù đang ở
        # phút 20. Hậu quả: +10.000 thành 100 lần gọi engine thay vì 4,
        # khoá giao diện ~148 giây mỗi tài nguyên.
        try:
            self.mins = max(1, int(mins or 1))
        except Exception:
            self.mins = 1
        if isinstance(amounts, dict):
            self.amounts = {k: int(amounts.get(k) or 0) for k in RES_ORDER}
        else:
            v = int(amounts)
            self.amounts = {k: v for k in RES_ORDER}
        # LỌC VÀNG khi chưa đủ phút.
        #
        # LỖI ĐÃ SỬA (theo yêu cầu): trước đây mọi tài nguyên đều được
        # cộng ngay từ phút 1, kể cả vàng. Vàng sớm là dấu hiệu bất
        # thường rõ nhất. Nay dưới phút 12 chỉ cộng thịt + gỗ.
        self.todo = [k for k in RES_ORDER if self.amounts.get(k, 0) > 0]
        if self.mins < GOLD_FROM_MIN:
            self.todo = [k for k in self.todo if k != 'G']
        # Ghi lại phần bị bỏ để nhãn hiển thị đúng
        self.skipped_gold = ('G' in self.amounts
                             and self.amounts.get('G', 0) > 0
                             and 'G' not in self.todo)

    def _label(self):
        return ' + '.join('%s %s' % (_fmt_num(self.amounts[k]), RES_VN[k])
                          for k in self.todo)

    def run(self):
        # ------------------------------------------------------------------
        # NẠP MODULE + LUÔN MỞ LẠI NÚT — LỖI ĐÃ SỬA
        #
        # `import xa_grant` trước đây nằm NGOÀI try: module thiếu/hỏng là
        # thread chết im lặng, nút cộng tài nguyên bị khoá vĩnh viễn mà
        # khách không nhận được lời nào. Nay bọc try + finally để nút luôn
        # được mở lại dù thành công hay lỗi.
        # ------------------------------------------------------------------
        ok_all = False
        try:
            try:
                import xa_grant as XG
            except Exception as e:
                _tech_file('import xa_grant: %s' % e)
                self.state.emit('Không nạp được chức năng tài nguyên', 'err')
                self.log.emit('Cài lại app rồi thử lại.')
                return
            if not self.todo:
                self.state.emit('Không có gì để cộng', 'err')
                return
            label = self._label()
            self.state.emit('Đang cộng %s…' % label, 'warn')
            okn = 0
            try:
                # ==========================================================
                # XEN KE TAI NGUYEN — thịt, gỗ, vàng, thịt, gỗ, vàng, ...
                #
                # Chủ shop: "cộng khi grant là xen kẽ thịt gỗ vàng không chỉ
                # riêng thịt xong mới tới gỗ".
                #
                # LỖI ĐÃ SỬA: trước đây vòng NGOÀI theo tài nguyên, nên cộng
                # HẾT thịt rồi mới sang gỗ, rồi mới sang vàng. Nhìn vào thì
                # thấy từng loại nhảy một cục rồi đứng im — không giống thu
                # thập thật.
                #
                # Nay: lập kế hoạch bước cho TỪNG loại, rồi đi XEN KẼ — mỗi
                # vòng lấy một bước của mỗi loại. Cả 3 loại cùng tăng đều.
                # ==========================================================
                mins = self.mins
                if mins <= 1:
                    cap = GRANT_STEP_P1          # phút 1    -> 10
                elif mins <= 5:
                    cap = GRANT_STEP_MID         # phút 2..5 -> 20
                elif mins <= 9:
                    cap = GRANT_STEP_LATE        # phút 6..9 -> 30
                else:
                    # phút 10 -> 40, 11 -> 50, 12 -> 60, ...
                    cap = GRANT_STEP_M10 + GRANT_STEP_ADD * (mins - 10)
                cap = max(GRANT_STEP_P1, min(GRANT_STEP_MAX, cap))
                
                # ---- BƯỚC 1: lập kế hoạch bước cho từng loại ----
                plans = {}      # r -> [số lượng từng bước]
                sent = {}       # r -> tổng đã gửi THÀNH CÔNG
                caps = {}       # r -> mức tối đa mỗi bước của loại đó
                order = []      # giữ đúng thứ tự F, W, G (RES_ORDER)
                for r in self.todo:
                    total = int(self.amounts.get(r) or 0)
                    if total <= 0:
                        continue
                    if self.fast:
                        # Chế độ nhanh: gộp thành <= GRANT_FAST_STEPS bước.
                        #
                        # LỖI ĐÃ SỬA: trước đây LUÔN chia đúng 4 bước, nên
                        # ở phút 10 (cấp thường đã là 40) nút +100 thành
                        # 4 bước x 25 = 1,5 giây — CHẬM HƠN chế độ từ từ
                        # (3 bước x 40 = 1,0 giây). "Nhanh" mà lại chậm.
                        #
                        # Nay: lấy cap LỚN HƠN giữa cap thường và mức đủ
                        # để gói trong GRANT_FAST_STEPS bước ⇒ số bước luôn
                        # ≤ chế độ từ từ.
                        _by_steps = max(1, (total + GRANT_FAST_STEPS - 1)
                                        // GRANT_FAST_STEPS)
                        _c = max(cap, _by_steps)
                    else:
                        _c = cap
                    # Chặn số bước để chế độ TỪ TỪ không chạy quá lâu.
                    # +10.000 ở phút 1 (bước 10) sẽ là 1.000 bước ×
                    # 300 ms = 5 phút. Mục nhỏ không bị ảnh hưởng.
                    _need_n = (total + _c - 1) // _c
                    if _need_n > GRANT_MAX_STEPS:
                        _c = max(_c, (total + GRANT_MAX_STEPS - 1)
                                 // GRANT_MAX_STEPS)
                    caps[r] = _c
                    n = max(1, (total + _c - 1) // _c)
                    base = total // n
                    rem = total - base * n
                    q = [base] * n
                    q[0] += rem          # dồn phần dư vào bước đầu
                    plans[r] = [x for x in q if x > 0]
                    sent[r] = 0
                    order.append(r)
                
                # ---- BƯỚC 2: đi XEN KẼ, mỗi vòng một bước của mỗi loại ----
                idx = {r: 0 for r in order}
                _first_call = True
                strikes = {r: 0 for r in order}
                while True:
                    _did = False
                    for r in order:
                        q = plans[r]
                        k = idx[r]
                        if k >= len(q):
                            continue
                        if strikes[r] > 3:
                            idx[r] = len(q)      # bỏ phần còn lại của loại này
                            continue
                        if not _first_call:
                            self.msleep(GRANT_FAST_GAP_MS if self.fast
                                        else GRANT_STEP_GAP_MS)
                        _first_call = False
                        _did = True
                        want = q[k]
                        idx[r] = k + 1
                        try:
                            # KHOÁ ENGINE: không chạy chồng với "Mua 2 tính 1"
                            # (2 lệnh engine cùng lúc -> crash game).
                            with XG.engine_lock():
                                _ok = XG.do_grant(self.h, self.base, r, want,
                                                  False, True, None)
                            # Chỉ tính khi ĐÃ GỬI VÀ XÁC MINH (do_grant trả 0 nếu
                            # không xác minh được).
                            if _ok:
                                sent[r] += want
                            else:
                                strikes[r] += 1
                        except Exception as e:
                            strikes[r] += 1
                            _tech_file('grant %s buoc %d: %s' % (r, k, e))
                    if not _did:
                        break
                
                # ---- BƯỚC 3: "thiếu đâu cộng đấy" — cộng nốt phần còn thiếu ----
                for r in order:
                    total = int(self.amounts.get(r) or 0)
                    guard = 0
                    while sent[r] < total and guard < 5:
                        guard += 1
                        need = min(caps.get(r, cap), total - sent[r])
                        if need <= 0:
                            break
                        try:
                            with XG.engine_lock():
                                _ok = XG.do_grant(self.h, self.base, r, need,
                                                  False, True, None)
                            if _ok:
                                sent[r] += need
                            else:
                                break
                        except Exception as e:
                            _tech_file('grant %s bu cuoi: %s' % (r, e))
                            self.msleep(800)
                
                # ---- BƯỚC 4: đếm loại nào xong ----
                for r in self.todo:
                    total = int(self.amounts.get(r) or 0)
                    if total <= 0 or sent.get(r, 0) >= total:
                        okn += 1
            except Exception as e:
                    # Chi tiết (địa chỉ, byte, handle) chỉ ra file.
                    _tech_file('grant %s: %s' % (r, e))
                    self.log.emit('Chưa cộng được tài nguyên này. Bấm "Kiểm tra lại".')
            if okn == len(self.todo):
                self.state.emit('Đã cộng %s' % label, 'ok')
                self.log.emit('Cộng tài nguyên: +%s' % label)
                ok_all = True
            elif okn:
                self.state.emit('Cộng %d/%d loại' % (okn, len(self.todo)),
                                'warn')
                self.log.emit('Cộng tài nguyên: +%s (một phần)' % label)
                ok_all = True
            else:
                self.state.emit('Không cộng được', 'err')
        except Exception as e:
            _tech_file('grant worker: %s' % e)
            self.state.emit('Không cộng được', 'err')
        finally:
            # LUÔN mở lại nút — kể cả khi lỗi bất ngờ.
            self.finished_ok.emit(ok_all)


# ---------------------------------------------------------------------------
# Hộp thoại đăng nhập
# ---------------------------------------------------------------------------

class LoginDialog(QDialog):
    """Đăng nhập HOẶC đăng ký ngay trong app.

    CHỦ SHOP CHỐT: "bắt buộc phải đăng ký mới sử dụng được app. Đăng ký luôn
    trên EXE cũng được."

    Vì vậy hộp thoại này có 2 chế độ:
      * Đăng nhập  — khách đã có tài khoản
      * Đăng ký    — tạo tài khoản mới, xong là vào luôn (không hỏi email/SĐT)
    """

    def __init__(self, parent=None, mode='login'):
        super().__init__(parent)
        self.mode = 'login' if mode != 'register' else 'register'
        self.setMinimumWidth(380)
        lay = QVBoxLayout(self)
        lay.setContentsMargins(20, 18, 20, 16)
        lay.setSpacing(10)

        self.lbl_title = T.label('', 'h3')
        lay.addWidget(self.lbl_title)
        self.lbl_sub = T.label('', 'mute', wrap=True)
        lay.addWidget(self.lbl_sub)

        lay.addSpacing(4)
        lay.addWidget(T.label('Tên đăng nhập', 'mute'))
        self.e_user = T.line_input('')
        self.e_user.setMinimumHeight(38)
        self.e_user.setPlaceholderText('3-32 ký tự, không dấu')
        lay.addWidget(self.e_user)

        lay.addWidget(T.label('Mật khẩu', 'mute'))
        self.e_pass = T.line_input('')
        self.e_pass.setEchoMode(QLineEdit.EchoMode.Password)
        self.e_pass.setMinimumHeight(38)
        lay.addWidget(self.e_pass)

        # Ô nhập lại mật khẩu — CHỈ hiện ở chế độ Đăng ký
        self.lbl_pass2 = T.label('Nhập lại mật khẩu', 'mute')
        self.e_pass2 = T.line_input('')
        self.e_pass2.setEchoMode(QLineEdit.EchoMode.Password)
        self.e_pass2.setMinimumHeight(38)
        lay.addWidget(self.lbl_pass2)
        lay.addWidget(self.e_pass2)

        self.lbl_err = T.label('', 'err', wrap=True)
        lay.addWidget(self.lbl_err)

        # Nút chuyển chế độ
        self.btn_switch = QPushButton('')
        self.btn_switch.setFlat(True)
        self.btn_switch.setCursor(QCursor(Qt.CursorShape.PointingHandCursor))
        self.btn_switch.clicked.connect(self._toggle_mode)
        lay.addWidget(self.btn_switch)

        bb = QDialogButtonBox(
            QDialogButtonBox.StandardButton.Ok
            | QDialogButtonBox.StandardButton.Cancel)
        self.btn_ok = bb.button(QDialogButtonBox.StandardButton.Ok)
        _set_button_text(
            bb.button(QDialogButtonBox.StandardButton.Cancel), 'Thoát')
        bb.accepted.connect(self._on_ok)
        bb.rejected.connect(self.reject)
        lay.addWidget(bb)

        self._apply_mode()

    def _apply_mode(self):
        is_reg = self.mode == 'register'
        self.setWindowTitle('Tạo tài khoản' if is_reg else 'Đăng nhập')
        self.lbl_title.setText(
            'Tạo tài khoản miễn phí' if is_reg else 'Đăng nhập tài khoản xienhl.com')
        self.lbl_sub.setText(
            'Chỉ cần tên đăng nhập và mật khẩu. Không cần email hay số điện thoại.\n'
            'Tài khoản mới được dùng thử MIỄN PHÍ 1 NGÀY — cả map sáng và tài nguyên.'
            if is_reg else
            'App tự lấy quyền từ tài khoản của bạn.')
        self.lbl_pass2.setVisible(is_reg)
        self.e_pass2.setVisible(is_reg)
        _set_button_text(self.btn_ok, 'Tạo tài khoản' if is_reg else 'Đăng nhập')
        self.btn_switch.setText(
            'Đã có tài khoản? Đăng nhập' if is_reg
            else 'Chưa có tài khoản? Tạo miễn phí')
        self.lbl_err.setText('')
        if is_reg:
            self.e_user.setFocus()

    def _toggle_mode(self):
        self.mode = 'login' if self.mode == 'register' else 'register'
        self.e_pass.setText('')
        self.e_pass2.setText('')
        self._apply_mode()

    def _on_ok(self):
        """Kiểm tra phía client trước khi gửi lên server."""
        u = self.e_user.text().strip()
        p = self.e_pass.text()
        if not u or not p:
            self.lbl_err.setText('Nhập đủ tên đăng nhập và mật khẩu.')
            return
        if self.mode == 'register':
            if len(u) < 3:
                self.lbl_err.setText('Tên đăng nhập phải có ít nhất 3 ký tự.')
                return
            if len(p) < 6:
                self.lbl_err.setText('Mật khẩu phải có ít nhất 6 ký tự.')
                return
            if p != self.e_pass2.text():
                self.lbl_err.setText('Hai lần nhập mật khẩu không khớp.')
                return
        self.accept()

    def values(self):
        return (self.e_user.text().strip(), self.e_pass.text())

    def is_register(self):
        return self.mode == 'register'


# ---------------------------------------------------------------------------
# Cửa sổ chính
# ---------------------------------------------------------------------------

class ArenaWindow(QWidget):
    def __init__(self):
        super().__init__()
        self.ent = {}
        # Có QUYỀN theo server (chưa chắc bấm được)
        self.has_nofog = False
        self.has_grant = False
        # BẤM ĐƯỢC (có quyền + có token dùng được). Khối chỉ hiện khi True.
        self.nofog_ready = False
        self.grant_ready = False

        self.patcher = None
        self.grant_engine = None
        self.grant_worker = None
        self.ent_worker = None
        self.login_worker = None
        self.free_worker = None

        # ------------------------------------------------------------------
        # TRẠNG THÁI DÙNG THỬ / "REAL TIME"
        #
        # _quota      : ảnh chụp lượt dùng thử của MAP SÁNG
        # _quota_res  : ảnh chụp lượt dùng thử của TÀI NGUYÊN
        # _quota_exp  : mốc hết hạn của lượt ĐANG dùng (đồng hồ máy)
        # _free_state : ok | exhausted | banned | offline | no_hw | error
        # _free_over  : đã hết lượt -> phải hiện nút "Nhận thêm lượt"
        # _ent_sig    : dấu vân tay lần kiểm tra trước, để biết "vừa có
        #               quyền mới" và không ghi đè loạn xạ mỗi 20 giây
        # ------------------------------------------------------------------
        self._quota = {}
        self._quota_res = {}
        self._quota_exp = 0
        self._free_state = ''
        self._free_over = False
        self._ent_sig = None
        self._last_rt = 0.0
        self._toast_seq = 0
        self._quota_visible = False
        self._first_apply = True
        # ------------------------------------------------------------------
        # _kicked     : tài khoản đang dùng ở MÁY KHÁC -> máy này bị đá ra.
        #               Khi True: ẩn hết chức năng + khối dùng thử, chỉ còn
        #               MỘT việc để làm là "Đăng nhập lại".
        # _allow_free : lần hỏi quyền NÀY được phép xin dùng thử theo máy.
        #               Đồng hồ tự làm mới luôn đặt False (chỉ ĐỌC, không
        #               tiêu lượt của khách).
        # ------------------------------------------------------------------
        self._kicked = False
        self._allow_free = False
        self._login_prompting = False
        self._login_is_register = False

        self.my_buttons = load_buttons()

        # Cờ điều khiển vòng đời
        self._stopping = False        # đang chờ patcher dừng hẳn
        self._stop_deadline = 0.0
        self._close_when_idle = False  # đóng ngay khi tải xong
        self._closing = False

        self.setWindowTitle(API and 'XA ARENA')
        self.setWindowIcon(app_icon())
        # Chiều cao bị chặn theo vùng làm việc thật của màn hình.
        self.setMinimumSize(560, _clamp_h(620))
        self.resize(600, _clamp_h(700))

        self._build()
        self._init_realtime()
        # Hoãn sang nhịp kế tiếp: hộp thoại đăng nhập bắt buộc cần cửa sổ đã
        # hiện ra trước, nếu không nó sẽ nổi lên trên một cửa sổ chưa vẽ.
        QTimer.singleShot(0, self._refresh_entitlement)

        # Dọn file tạm còn sót từ lần trước (.part, .new/.old quá cũ).
        # LỖI ĐÃ SỬA: không dọn thì .new mồ côi làm app tưởng "có bản mới
        # chờ thay" mãi, và .old chiếm chỗ vô ích.
        try:
            import xa_arena_app as _APP
            U = _APP._updater()
            exep = _APP.exe_path()
            if U and exep:
                n = U.cleanup_stale(exep)
                if n:
                    self._say('Đã dọn %d file tạm từ lần trước.' % n)
        except Exception:
            pass

        # Kiểm tra bản mới ở nền (sau khi GUI đã hiện)
        QTimer.singleShot(2500, self._start_update_check)

        # Sống quá 60 giây -> đánh dấu bản này chạy tốt
        def _good():
            try:
                import xa_arena_app as APP
                APP.update_mark_good()
            except Exception:
                pass
        QTimer.singleShot(60000, _good)

    # ---------------- giao diện ----------------

    def _build(self):
        outer = QVBoxLayout(self)
        outer.setContentsMargins(0, 0, 0, 0)
        outer.setSpacing(0)

        # Vùng cuộn: khi hiện CẢ HAI khối, nội dung cao hơn cửa sổ -> cuộn
        # được thay vì nén/chồng nút. Đây là lỗi đã thấy: các nút tài nguyên
        # bị đè lên nhau khi cửa sổ không đủ cao.
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setFrameShape(QFrame.Shape.NoFrame)
        scroll.setHorizontalScrollBarPolicy(
            Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        outer.addWidget(scroll, 1)

        body = QWidget()
        self.scroll_body = body
        scroll.setWidget(body)

        root = QVBoxLayout(body)
        root.setContentsMargins(20, 16, 20, 14)
        root.setSpacing(10)

        # ===== Thanh trên: logo + tên + version + đăng nhập + key =====
        top = QHBoxLayout()
        top.setSpacing(9)

        # Khối nhận diện: icon BÊN TRÁI, tên + version BÊN PHẢI, cùng hàng.
        # Dùng widget chứa riêng để icon luôn thẳng hàng dù font to nhỏ.
        brana = QWidget()
        brana.setFixedHeight(46)
        bh = QHBoxLayout(brana)
        bh.setContentsMargins(0, 0, 0, 0)
        bh.setSpacing(10)

        logo = QLabel()
        logo.setPixmap(app_icon().pixmap(QSize(34, 34)))
        logo.setFixedSize(34, 34)
        bh.addWidget(logo, 0, Qt.AlignmentFlag.AlignVCenter)

        tcol = QVBoxLayout()
        tcol.setSpacing(0)
        tcol.setContentsMargins(0, 0, 0, 0)
        lbl_name = T.label('XA ARENA', 'h2')
        lbl_name.setContentsMargins(0, 0, 0, 0)
        tcol.addWidget(lbl_name)

        # VERSION + trạng thái cập nhật. Bấm vào để kiểm tra lại ngay.
        # (Trước đây dòng này chỉ là nhãn tĩnh, nên các hàm cập nhật gọi
        # self.lbl_ver đều crash vì widget chưa tồn tại.)
        self.lbl_ver = T.label('v%s  ·  đang kiểm tra…' % self._ver(), 'mute')
        self.lbl_ver.setCursor(Qt.CursorShape.PointingHandCursor)
        self.lbl_ver.setToolTip('Bấm để kiểm tra bản mới')
        self.lbl_ver.mousePressEvent = (
            lambda _e: self._start_update_check(manual=True))
        tcol.addWidget(self.lbl_ver)
        bh.addLayout(tcol)
        bh.addStretch(1)

        top.addWidget(brana, 1, Qt.AlignmentFlag.AlignVCenter)

        self.btn_login = T.btn('Đăng nhập', 'primary')
        self.btn_login.setFixedWidth(116)
        self.btn_login.clicked.connect(self._do_login)
        top.addWidget(self.btn_login, 0, Qt.AlignmentFlag.AlignVCenter)

        # Nút ĐĂNG XUẤT: chỉ hiện khi đã đăng nhập.
        self.btn_logout = T.btn('Thoát', 'ghost')
        self.btn_logout.setFixedWidth(72)
        self.btn_logout.setToolTip('Đăng xuất tài khoản')
        self.btn_logout.clicked.connect(self._do_logout)
        self.btn_logout.hide()
        top.addWidget(self.btn_logout, 0, Qt.AlignmentFlag.AlignVCenter)

        # Nút cập nhật: chỉ hiện khi server có bản mới
        self.btn_update = T.btn('Cập nhật', 'primary')
        self.btn_update.setFixedWidth(124)
        self.btn_update.clicked.connect(self._do_update)
        self.btn_update.hide()
        top.addWidget(self.btn_update, 0, Qt.AlignmentFlag.AlignVCenter)

        # ------------------------------------------------------------------
        # KHÔNG CÒN "NHẬP KEY" — HOÀN TOÀN THEO TÀI KHOẢN.
        #
        # Chủ shop chốt: "bỏ toàn bộ key trên hệ thống app và web đi".
        #
        # Mọi thứ giờ đi qua TÀI KHOẢN:
        #   * Đăng nhập (hoặc tạo tài khoản ngay trong app) là bắt buộc
        #   * Tài khoản mới được dùng thử 1 NGÀY, cả map sáng + tài nguyên
        #   * Mua trên web -> quyền cộng thẳng vào tài khoản, app tự nhận
        #
        # Không còn ô nhập key, không còn mã để khách phải giữ hay gõ sai.
        # ------------------------------------------------------------------
        # NÚT MUA — hiện khi hết quyền. Mở thẳng trang mua trên web.
        self.btn_buy = T.btn('Mua', 'primary')
        self.btn_buy.setFixedWidth(88)
        self.btn_buy.setToolTip('Mở trang mua trên xienhl.com')
        self.btn_buy.clicked.connect(self._do_buy)
        self.btn_buy.hide()
        top.addWidget(self.btn_buy, 0, Qt.AlignmentFlag.AlignVCenter)

        # Nút ĐĂNG NHẬP / ĐĂNG XUẤT
        self.btn_key = T.btn('Đăng nhập', 'ghost')
        self.btn_key.setFixedWidth(88)
        self.btn_key.setToolTip('Đăng nhập tài khoản — app tự lấy quyền')
        self.btn_key.clicked.connect(self._do_login)
        top.addWidget(self.btn_key, 0, Qt.AlignmentFlag.AlignVCenter)

        # Thanh trên cao CỐ ĐỊNH: nếu để layout tự co giãn, khoảng trống
        # thừa sẽ dồn xuống dưới header (đã thấy khi chạy thật).
        hdr = QWidget()
        hdr.setFixedHeight(48)
        hdr.setLayout(top)
        top.setContentsMargins(0, 0, 0, 0)
        root.addWidget(hdr, 0)

        # ===== Trạng thái =====
        st = T.card()
        self.status_card = st
        sl = QVBoxLayout(st)
        sl.setContentsMargins(14, 10, 14, 10)
        sl.setSpacing(3)
        self.lbl_state = T.label('● Đang kiểm tra…', 'warn')
        f = self.lbl_state.font()
        f.setBold(True)
        f.setPointSize(11)
        self.lbl_state.setFont(f)
        sl.addWidget(self.lbl_state)
        st_row = QHBoxLayout()
        st_row.setSpacing(8)
        self.lbl_right = T.label('Chưa có quyền', 'mute')
        st_row.addWidget(self.lbl_right, 1)
        # Chỉ hiện khi lần kiểm tra trước THẤT BẠI — để câu hướng dẫn
        # "bấm Kiểm tra lại" luôn có nút thật mà bấm.
        self.btn_recheck = T.btn('Kiểm tra lại', 'ghost')
        self.btn_recheck.setFixedHeight(26)
        self.btn_recheck.setToolTip('Kiểm tra lại quyền với máy chủ')
        self.btn_recheck.clicked.connect(
            lambda _c=False: self._refresh_entitlement())
        self.btn_recheck.hide()
        st_row.addWidget(self.btn_recheck, 0)
        sl.addLayout(st_row)
        _fix_height(st, 24)
        root.addWidget(st, 0)

        # ===== DẢI THÔNG BÁO (không phải hộp thoại) =====
        # Chủ shop: "app hiện thông báo xong tự update lên luôn".
        # Hiện ngay trong cửa sổ, tự tắt sau 8 giây, không chặn thao tác.
        self.box_toast = T.banner('', 'ok')
        self.box_toast.hide()
        root.addWidget(self.box_toast, 0)

        # ===== DÙNG THỬ: CÒN BAO NHIÊU LƯỢT =====
        # Chủ shop: "hiện rõ còn bao nhiêu lần free ... hết free hiện lên
        # nút nhận thêm lượt". MỘT khối riêng, chữ to, không giấu trong
        # tooltip. Khối này CHỈ nói số liệu thật, không đoán.
        self.box_quota = T.card()
        self.box_quota.hide()
        ql = QVBoxLayout(self.box_quota)
        ql.setContentsMargins(14, 9, 14, 9)
        ql.setSpacing(3)

        q_top = QHBoxLayout()
        q_top.setSpacing(8)
        q_top.addWidget(T.label('Dùng thử', 'dim'), 0)
        q_top.addStretch(1)
        # "1 lượt = 1 giờ" — khách phải biết TRƯỚC khi bấm nhận.
        self.lbl_trial_sec = T.label('', 'mute')
        q_top.addWidget(self.lbl_trial_sec, 0)
        ql.addLayout(q_top)

        # Hai dòng sản phẩm: mỗi dòng "Tên  ● 10/10"
        self.lbl_q_nofog = T.label('', 'dim')
        self.lbl_q_grant = T.label('', 'dim')
        ql.addWidget(self.lbl_q_nofog)
        ql.addWidget(self.lbl_q_grant)

        q_top2 = QHBoxLayout()
        q_top2.setSpacing(8)
        q_top2.addWidget(T.label('', 'dim'), 0)
        self.lbl_quota = T.label('chưa bật', 'warn')
        _qfont = self.lbl_quota.font()
        _qfont.setBold(True)
        _qfont.setPointSize(12)
        self.lbl_quota.setFont(_qfont)
        q_top2.addWidget(self.lbl_quota, 0)
        ql.addLayout(q_top2)

        self.lbl_quota_sub = T.label('', 'mute')
        ql.addWidget(self.lbl_quota_sub)

        # Nút CHÍNH khi hết lượt. Chữ đúng như chủ shop yêu cầu.
        self.btn_more = T.btn('Nhận thêm lượt', 'primary')
        self.btn_more.setFixedHeight(38)
        self.btn_more.setToolTip('Xin thêm lượt dùng thử cho máy này')
        self.btn_more.clicked.connect(self._do_more)
        self.btn_more.hide()
        ql.addWidget(self.btn_more)
        _fix_height(self.box_quota, 16)
        root.addWidget(self.box_quota, 0)

        # ===== KHỐI MAP SÁNG (ẩn nếu không có quyền) =====
        # ẨN NGAY khi tạo. Chỉ hiện sau khi server xác nhận quyền.
        # LỖI ĐÃ SỬA: trước đây hiện sẵn nên khách chưa có license vẫn thấy
        # cả hai khối, và bấm được trong khoảng 15–40 giây chờ kiểm tra.
        self.box_nofog = T.card()
        self.box_nofog.hide()
        nl = QVBoxLayout(self.box_nofog)
        nl.setContentsMargins(14, 12, 14, 12)
        nl.setSpacing(8)
        nl.addWidget(T.label('MAP SÁNG', 'dim'))
        self.btn_toggle = QPushButton('BẬT MAP SÁNG')
        self.btn_toggle.setFixedHeight(52)
        self.btn_toggle.setSizePolicy(QSizePolicy.Policy.Expanding,
                                      QSizePolicy.Policy.Fixed)
        self.btn_toggle.setCursor(Qt.CursorShape.PointingHandCursor)
        self.btn_toggle.clicked.connect(self._toggle_nofog)
        self.btn_toggle.setProperty('role', 'primary')
        fb = self.btn_toggle.font()
        fb.setPointSize(13)
        fb.setBold(True)
        self.btn_toggle.setFont(fb)
        nl.addWidget(self.btn_toggle)
        _fix_height(self.box_nofog, 30)
        root.addWidget(self.box_nofog, 0)

        # ===== KHỐI TÀI NGUYÊN (ẩn nếu không có quyền) =====
        self.box_grant = T.card()
        self.box_grant.hide()
        gl = QVBoxLayout(self.box_grant)
        gl.setContentsMargins(14, 12, 14, 12)
        gl.setSpacing(8)
        gl.addWidget(T.label('TÀI NGUYÊN', 'dim'))

        grid = QGridLayout()
        grid.setSpacing(8)
        self.amount_buttons = []
        for idx, (amt, lab) in enumerate(AMOUNTS):
            r, c = divmod(idx, 2)
            b = T.btn(lab, 'tile')
            b.setMinimumHeight(48)
            b.setSizePolicy(QSizePolicy.Policy.Expanding,
                            QSizePolicy.Policy.Fixed)
            fnt = b.font()
            fnt.setPointSize(12)
            fnt.setBold(True)
            b.setFont(fnt)
            b.clicked.connect(lambda _=False, a=amt: self._grant_amount(a))
            # CHUỘT PHẢI = cộng nhanh (chủ shop yêu cầu).
            b.setToolTip('Chuột trái: cộng từ từ · Chuột phải: cộng nhanh')
            b.setContextMenuPolicy(Qt.ContextMenuPolicy.CustomContextMenu)
            b.customContextMenuRequested.connect(
                lambda _p, a=amt: self._grant_amount(a, fast=True))
            grid.addWidget(b, r, c)
            self.amount_buttons.append(b)
        # Chỉ kéo giãn nút cuối khi số nút LẺ (để không trống một ô).
        #
        # LỖI ĐÃ SỬA: trước đây luôn giãn, nên khi thêm nút thứ 4 thì
        # nút đó bị đẩy xuống hàng 3 và chiếm cả hàng — lệch hẳn so với
        # 3 nút trên.
        if len(self.amount_buttons) % 2 == 1:
            last = self.amount_buttons[-1]
            rows = len(self.amount_buttons) // 2
            grid.addWidget(last, rows, 0, 1, 2)
        grid.setColumnStretch(0, 1)
        grid.setColumnStretch(1, 1)
        gl.addLayout(grid)

        row = QHBoxLayout()
        row.setSpacing(7)
        self.ent_custom = T.line_input('')
        self.ent_custom.setPlaceholderText('Số khác…')
        self.ent_custom.setMinimumHeight(40)
        row.addWidget(self.ent_custom, 1)
        # LỖI ĐÃ SỬA: nút chỉ ghi "+" nên không ai hiểu bấm để làm gì.
        self.btn_custom = T.btn('Thêm', 'primary')
        self.btn_custom.setFixedWidth(66)
        self.btn_custom.setMinimumHeight(40)
        self.btn_custom.setToolTip('Cộng đúng số vừa nhập')
        self.btn_custom.clicked.connect(lambda _=False: self._grant_custom())
        # CHUỘT PHẢI = cộng nhanh số vừa nhập.
        self.btn_custom.setToolTip(
            'Chuột trái: cộng từ từ · Chuột phải: cộng nhanh')
        self.btn_custom.setContextMenuPolicy(
            Qt.ContextMenuPolicy.CustomContextMenu)
        self.btn_custom.customContextMenuRequested.connect(
            lambda _p: self._grant_custom(fast=True))
        row.addWidget(self.btn_custom)
        gl.addLayout(row)

        # ------------------------------------------------------------------
        # NÚT "MUA 1 CỘNG 1" — CHỈ MÁY CHỦ SHOP MỚI THẤY.
        #
        # Chủ shop: "t muốn nâng cấp cái tính năng 'mua 2 tính 1' và chỉ
        # riêng t có".
        #
        # Cách làm: nút bị ẨN mặc định. Chỉ hiện khi HWID máy này nằm
        # trong danh sách máy chủ shop (`SHOP_HWIDS`). Khách thường không
        # thấy, không bật được — vì HWID của họ không có trong danh sách.
        #
        # KHÁC HẲN "sửa bảng chi phí": không đụng dữ liệu game nên không
        # gây lệch checksum. Xem `xa_grant.RefundWatcher`.
        # ------------------------------------------------------------------
        self.btn_x2 = T.btn('Mua 2 tính 1', 'ghost')
        self.btn_x2.setMinimumHeight(40)
        self.btn_x2.setToolTip('Mua quân — hoàn lại một nửa tài nguyên đã tiêu')
        self.btn_x2.clicked.connect(self._toggle_x2)
        self.btn_x2.hide()
        self._x2_on = False
        self._x2_watcher = None
        # Khách CHỦ ĐỘNG tắt -> không tự bật lại (tôn trọng ý muốn).
        self._x2_pref_off = False
        # Mốc thời gian lần thử tự bật gần nhất (giãn cách 3 giây).
        self._x2_try_at = 0.0
        # Worker nền của "Mua 2 tính 1" (R2: không dùng QTimer GUI).
        self._x2_worker = None
        gl.addWidget(self.btn_x2)

        # ------------------------------------------------------------------
        # HÀNG NÚT TỰ TẠO — NẰM TRONG VÙNG CUỘN NGANG.
        #
        # LỖI ĐÃ SỬA: thanh cuộn ngang bị tắt (AlwaysOff) nên với 6+ nút
        # thì các nút cuối bị cắt mất, không bấm được và cũng không kéo
        # tới được.
        # ------------------------------------------------------------------
        tb_row = QHBoxLayout()
        tb_row.setSpacing(6)
        self.btn_add = T.btn('Thêm nút', 'ghost')
        # Đủ rộng cho 'Thêm nút' — 84px làm chữ bị cắt thành 'hêm nú'.
        self.btn_add.setMinimumWidth(104)
        self.btn_add.setMinimumHeight(34)
        self.btn_add.setToolTip('Tạo nút cộng riêng (chuột phải để sửa/xoá)')
        self.btn_add.clicked.connect(self._add_button)
        tb_row.addWidget(self.btn_add, 0)

        self.tb_area = QScrollArea()
        self.tb_area.setWidgetResizable(False)
        self.tb_area.setFrameShape(QFrame.Shape.NoFrame)
        self.tb_area.setVerticalScrollBarPolicy(
            Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        self.tb_area.setHorizontalScrollBarPolicy(
            Qt.ScrollBarPolicy.ScrollBarAsNeeded)
        self.tb_area.setFixedHeight(48)
        self.tb_holder = QWidget()
        self.tb_buttons = QHBoxLayout(self.tb_holder)
        self.tb_buttons.setContentsMargins(0, 0, 0, 0)
        self.tb_buttons.setSpacing(6)
        self.tb_area.setWidget(self.tb_holder)
        tb_row.addWidget(self.tb_area, 1)
        gl.addLayout(tb_row)
        _fix_height(self.box_grant, 40)
        root.addWidget(self.box_grant, 0)

        # ===== Hàng thông tin =====
        info = QHBoxLayout()
        info.setSpacing(8)
        for key, title in (('game', 'GAME'), ('lic', 'LICENSE')):
            card = T.card('cardFlat')
            cl = QVBoxLayout(card)
            cl.setContentsMargins(12, 9, 12, 9)
            cl.setSpacing(1)
            cl.addWidget(T.label(title, 'mute'))
            lb = T.label('—', 'dim')
            lb.setStyleSheet('font-weight:600;')
            cl.addWidget(lb)
            if key == 'game':
                self.lbl_game = lb
            else:
                self.lbl_lic = lb
            info.addWidget(card, 1)
        root.addLayout(info)
        root.addStretch(0)

        # ===== Nhật ký =====
        # NHẬT KÝ là khối DUY NHẤT được giãn theo chiều dọc.
        # Mọi khối khác đã bị khoá chiều cao ở trên.
        self.log = T.log_view()
        self.log.setMinimumHeight(86)
        self.log.setSizePolicy(QSizePolicy.Policy.Expanding,
                               QSizePolicy.Policy.Expanding)
        root.addWidget(self.log, 1)

        # ===== Chân =====
        foot = QHBoxLayout()
        foot.addStretch(1)
        self.btn_close = T.btn('Đóng', 'ghost')
        self.btn_close.setFixedWidth(80)
        self.btn_close.clicked.connect(self.close)
        foot.addWidget(self.btn_close)
        root.addLayout(foot)

        T.set_dark_titlebar(self)
        T.center_on_screen(self)

        self._render_buttons()

    def _ver(self):
        try:
            from xa_arena_app import APP_VERSION
            return APP_VERSION
        except Exception:
            return '1.0.0.0'

    # ---------------- trạng thái ----------------

    def _say(self, s):
        try:
            self.log.appendPlainText(str(s))
            sb = self.log.verticalScrollBar()
            sb.setValue(sb.maximum())
        except Exception:
            pass

    def _tech(self, msg):
        """Ghi chi tiết kỹ thuật ra FILE, không hiện cho khách."""
        _tech_file(msg)

    # ---------------- "real time": số lượt + tự làm mới ----------------

    def _init_realtime(self):
        """Dựng 2 đồng hồ: một để ĐỔI CHỮ, một để HỎI SERVER định kỳ.

        Tách làm hai vì:
          - Đổi chữ 1 giây/lần cho khách thấy số phút tự giảm — chỉ sửa
            nhãn, KHÔNG gọi mạng, không tốn gì.
          - Hỏi server 20/60 giây một lần — đủ nhanh để nhận quyền vừa mua
            trên web, đủ thưa để không nặng máy.
        """
        self._tick = QTimer(self)
        self._tick.setInterval(RT_TICK_MS)
        self._tick.timeout.connect(self._on_tick)
        self._tick.start()

        self._rt = QTimer(self)
        self._rt.setInterval(RT_IDLE_MS)
        self._rt.timeout.connect(self._rt_tick)
        self._rt.start()

    def _workers_busy(self):
        """Có worker nào đang chạy không? -> KHÔNG xếp thêm worker."""
        for attr in ('ent_worker', 'free_worker', '_tok_worker'):
            w = getattr(self, attr, None)
            try:
                if w is not None and w.isRunning():
                    return True
            except Exception:
                continue
        return False

    def _release_worker(self, attr):
        """Giải phóng một worker ĐÃ XONG.

        VÌ SAO CẦN: QThread tạo với parent là cửa sổ sẽ do cửa sổ sở hữu và
        KHÔNG tự xoá. Đồng hồ tự làm mới tạo 1 worker mỗi 20 giây, để lâu
        sẽ phình. Chỉ xoá khi thread đã dừng -> không bao giờ xoá thread
        đang chạy (đó là lỗi làm sập app).
        """
        w = getattr(self, attr, None)
        if w is None:
            return
        try:
            if not w.isRunning():
                w.deleteLater()
                setattr(self, attr, None)
        except Exception:
            setattr(self, attr, None)

    def _rt_tick(self):
        """Đồng hồ HỎI SERVER — chỉ ĐỌC, không bao giờ tự tiêu lượt."""
        if self._closing or self._workers_busy():
            return
        try:
            if not self.isVisible():
                return          # cửa sổ đang ẩn: không hỏi server vô ích
        except Exception:
            pass
        self._last_rt = time.time()
        self._refresh_entitlement(allow_free=False, quiet=True)

    def _rt_retune(self):
        """Đổi nhịp hỏi: chưa dùng được gì (đang chờ mua/hết lượt) -> 20s."""
        try:
            if getattr(self, '_kicked', False):
                # Bị đá sang máy khác: lùi hẳn, không tranh máy với máy kia.
                ms = RT_KICKED_MS
            else:
                waiting = not (self.nofog_ready or self.grant_ready)
                ms = RT_WAIT_MS if waiting else RT_IDLE_MS
            if self._rt.interval() != ms:
                self._rt.setInterval(ms)
                self._rt.start()
        except Exception:
            pass

    def _on_tick(self):
        """Đồng hồ ĐỔI CHỮ (mỗi giây): không gọi mạng."""
        if self._closing:
            return
        self._refresh_free_over()
        self._render_quota()
        # ------------------------------------------------------------------
        # THỬ TỰ BẬT "Mua 2 tính 1" MỖI GIÂY — giống NoFog tự vá.
        #
        # LỖI ĐÃ SỬA: trước đây chỉ thử MỘT lần khi quyền đổi. Khách mở
        # app TRƯỚC khi vào trận thì lần thử đó thất bại (chưa có game)
        # và không bao giờ thử lại ⇒ vào trận phải bấm nút thủ công.
        #
        # Nay: mỗi giây thử lại nếu chưa bật. Rất rẻ:
        #   - đã bật rồi  -> `_x2_on` True -> thoát ngay
        #   - không quyền -> `_can_use_x2` False -> thoát ngay
        #   - đã tắt tay  -> `_x2_pref_off` True -> thoát ngay
        # Chỉ khi THỰC SỰ cần mới gọi `_x2_start`, mà nó tự kiểm tra
        # game có đang chạy hay không.
        # ------------------------------------------------------------------
        try:
            if not self._x2_on and not self._x2_pref_off:
                import time as _t
                now = _t.time()
                # Thử lại mỗi 3 giây, không phải mỗi giây: `_x2_start`
                # phải quét danh sách process khi chưa có handle.
                if now - self._x2_try_at >= 3.0:
                    self._x2_try_at = now
                    self._auto_start_x2()
        except Exception:
            pass

    def _on_activate(self):
        """Khách vừa quay lại cửa sổ — thường là VỪA MUA trên trình duyệt."""
        if self._closing or self._workers_busy():
            return
        if time.time() - self._last_rt < FOCUS_MIN_GAP:
            return
        self._last_rt = time.time()
        self._refresh_entitlement(allow_free=False, quiet=True)

    def changeEvent(self, ev):
        """Bắt sự kiện cửa sổ được kích hoạt lại (quay về từ trình duyệt)."""
        try:
            if (ev.type() == QEvent.Type.ActivationChange
                    and self.isActiveWindow()):
                self._on_activate()
        except Exception:
            pass
        super().changeEvent(ev)

    # ---------------- số lượt dùng thử ----------------

    @staticmethod
    def _set_role_text(w, text, role):
        """Đổi chữ + đổi màu một nhãn (QSS đọc theo property 'role').

        Chỉ tính lại style khi MÀU đổi: hàm này chạy mỗi giây (đồng hồ
        đổi chữ), tính lại style vô ích sẽ làm giao diện giật.
        """
        try:
            t = str(text or '')
            old = str(w.property('role') or '')
            if w.text() == t and old == role:
                return
            w.setText(t)
            if old != role:
                w.setProperty('role', role)
                w.style().unpolish(w)
                w.style().polish(w)
        except Exception:
            pass

    def _left_sec_now(self):
        """Số giây còn lại của lượt đang dùng, tính theo đồng hồ máy."""
        exp = int(self._quota_exp or 0)
        if exp > 0:
            return max(0, exp - int(time.time()))
        try:
            return int((self._quota or {}).get('left_sec') or 0)
        except Exception:
            return 0

    def _refresh_free_over(self):
        """Đã hết thời gian dùng thử chưa? -> có hiện nút "Nhận thêm lượt" không.

        LUẬT (đúng ý chủ shop "hết free hiện lên nút nhận thêm lượt"):

          - còn thời gian đang chạy          -> KHÔNG hiện nút
          - hết thời gian, biết còn lượt     -> HIỆN (bấm là xin lượt kế tiếp)
          - hết thời gian, biết hết lượt     -> HIỆN (bấm sẽ nhận câu từ chối
                                                thật thà + nút Mua)
          - server đã từ chối (hết/bị chặn)  -> HIỆN
          - chưa biết gì (vừa mở app)        -> KHÔNG hiện, tránh nhấp nháy
        """
        left = None
        try:
            if isinstance(self._quota, dict):
                left = self._quota.get('left')
        except Exception:
            left = None
        left_sec = self._left_sec_now()
        st = str(self._free_state or '')
        if st in ('exhausted', 'banned'):
            self._free_over = True          # server đã từ chối: chắc chắn hết
        elif left is not None and int(left) <= 0:
            # ------------------------------------------------------------------
            # HẾT LƯỢT — KHÁC HẾT GIỜ.
            #
            # LỖI ĐÃ SỬA: trước đây chỉ xét `left_sec > 0` (còn giờ của lượt
            # đang chạy) nên khi khách đã dùng hết 10 lượt mà lượt cuối vẫn
            # còn 20 phút thì `_free_over` bị đặt lại False → nút
            # "Nhận thêm lượt" KHÔNG hiện, khách tưởng còn dùng được.
            #
            # Nay: biết chắc `left <= 0` thì coi là hết lượt, phải hiện nút
            # để khách xin thêm (hoặc được báo mua).
            # ------------------------------------------------------------------
            self._free_over = True
        elif left_sec > 0:
            self._free_over = False         # đang có lượt chạy, còn lượt
        else:
            self._free_over = bool(left is not None or st == 'ok')

    def _quota_res_text(self):
        """Số lượt dùng thử TÀI NGUYÊN — hiện cùng kiểu với map sáng."""
        r = self._quota_res if isinstance(self._quota_res, dict) else {}
        if not r:
            return ''
        cnt = API.fmt_quota(r.get('left'), r.get('total'))
        if cnt:
            return 'Tài nguyên: còn %s lượt' % cnt
        return ''

    def _quota_line(self, which):
        """Một dòng cho một sản phẩm: (chữ, role, có dữ liệu).

        Toàn bộ quy tắc nằm ở `xa_trial_rules.quota_line` — file này chỉ
        lấy số liệu rồi đưa vào hàm thuần.
        """
        w = TR.norm_product(which)
        q = self._quota_res if w == TR.PRODUCT_GRANT else self._quota
        run_sec = 0
        try:
            if w == TR.PRODUCT_GRANT:
                run_sec = int((q or {}).get('left_sec') or 0)
            else:
                run_sec = self._left_sec_now()
        except Exception:
            run_sec = 0
        return TR.quota_line(w, q, run_sec, API.fmt_quota, API.fmt_left)

    def _render_quota(self):
        """Vẽ khối DÙNG THỬ: thời lượng + CẢ HAI sản phẩm. Không bịa số."""
        
        # --- Nhãn thời lượng: "1 lượt = 1 giờ" (từ server) ---
        try:
            _lbl = TR.sec_label((self._quota, self._quota_res))
            self.lbl_trial_sec.setText(
                ('1 lượt = %s' % _lbl) if _lbl else '')
        except Exception:
            pass

        # --- Hai dòng sản phẩm ---
        try:
            for which, lbl in (('nofog', getattr(self, 'lbl_q_nofog', None)),
                               ('xagrant', getattr(self, 'lbl_q_grant', None))):
                if lbl is None:
                    continue
                txt, role, has = self._quota_line(which)
                self._set_role_text(lbl, txt, role)
                lbl.setVisible(has)
        except Exception:
            pass

        # --- Dòng tổng (giữ lại cho tương thích; ẩn nếu đã có 2 dòng trên) ---
        try:
            self.lbl_quota.setText('')
            self.lbl_quota.setVisible(False)
        except Exception:
            pass

        sub = self._quota_res_text()
        try:
            self.lbl_quota_sub.setText(sub)
            self.lbl_quota_sub.setVisible(bool(sub))
        except Exception:
            pass

        # Khối dùng thử chỉ có nghĩa khi khách CHƯA có đủ quyền trả phí.
        # Bị đá sang máy khác thì KHÔNG hiện khối này: máy này không còn
        # quyền dùng tài khoản, hiện "còn N lượt" chỉ gây hiểu nhầm.
        show = TR.trial_card_visible(
            bool(self.nofog_ready), bool(self.grant_ready),
            bool(getattr(self, '_kicked', False)))
        if show != self._quota_visible:
            self._quota_visible = show
            try:
                self.box_quota.setVisible(show)
            except Exception:
                pass
            self._relayout()
        self._sync_primary_action()

    def _apply_quota(self, q=None, qr=None):
        """Nhận ảnh chụp số lượt (từ worker) rồi vẽ lại."""
        if isinstance(q, dict) and q:
            self._quota = q
            try:
                exp = int(q.get('expires_at') or 0)
            except Exception:
                exp = 0
            if exp != int(self._quota_exp or 0):
                self._quota_exp = exp
        if isinstance(qr, dict) and qr:
            self._quota_res = qr
        self._refresh_free_over()
        self._render_quota()

    def _sync_primary_action(self):
        """MỘT nút chính: hết lượt -> "Nhận thêm lượt"; còn lại -> "Mua"."""
        # ------------------------------------------------------------------
        # BỊ ĐÁ SANG MÁY KHÁC: chỉ MỘT việc đúng.
        #
        # Không mời mua (khách đã mua rồi), không mời xin thêm lượt (đá
        # nhau với máy kia), không "Kiểm tra lại" (hỏi lại cũng thế). Việc
        # duy nhất có tác dụng là ĐĂNG NHẬP LẠI để lấy máy này về.
        # ------------------------------------------------------------------
        if getattr(self, '_kicked', False):
            try:
                self.btn_more.setVisible(False)
                self.btn_buy.setVisible(False)
                self.btn_recheck.setVisible(False)
                self.btn_login.setText('Đăng nhập lại')
                self.btn_login.setEnabled(True)
            except Exception:
                pass
            self._rt_retune()
            return
        # ------------------------------------------------------------------
        # LỖI ĐÃ SỬA: trước đây chỉ hiện nút khi ĐÃ HẾT lượt.
        #
        # Khách còn 10/10 lượt dùng thử tài nguyên (chưa dùng lần nào)
        # nhưng chưa có quyền tài nguyên ⇒ KHÔNG có nút nào ⇒ không thể
        # bật dùng thử ⇒ tưởng "bản dùng thử không có tài nguyên".
        #
        # Nay: hiện nút khi hết lượt, HOẶC còn lượt cho sản phẩm chưa có.
        # ------------------------------------------------------------------
        # ------------------------------------------------------------------
        # NÚT PHẢI THEO SẢN PHẨM CÒN THIẾU, KHÔNG THEO `ready`.
        #
        # LỖI ĐÃ SỬA: `ready = nofog_ready or grant_ready`. Khách có map
        # sáng (ready=True) mà thiếu tài nguyên ⇒ `need_more` luôn False
        # ⇒ KHÔNG BAO GIỜ có nút nhận dùng thử tài nguyên. Đó đúng là
        # trường hợp chủ shop gặp: "không có cộng gỗ thịt vàng".
        # ------------------------------------------------------------------
        # Toàn bộ quyết định nằm ở `xa_trial_rules.primary_buttons` —
        # file này chỉ lấy trạng thái rồi đưa vào hàm thuần.
        need_more, need_buy = TR.primary_buttons(
            bool(self.nofog_ready), bool(self.grant_ready),
            bool(self._free_over), self._trial_claimable(),
            self._missing_product())
        try:
            self.btn_more.setVisible(need_more)
        except Exception:
            pass
        try:
            self.btn_buy.setVisible(need_buy)
            role = 'ghost' if need_more else 'primary'
            if str(self.btn_buy.property('role') or '') != role:
                self.btn_buy.setProperty('role', role)
                self.btn_buy.style().unpolish(self.btn_buy)
                self.btn_buy.style().polish(self.btn_buy)
        except Exception:
            pass
        # LỖI ĐÃ SỬA: hiện/ẩn btn_more làm chiều cao khối đổi, nhưng không
        # ai tính lại layout ⇒ nút bị cắt (đo được: cao 71 trong khi
        # sizeHint cần 96). Phải _relayout() sau khi đổi.
        try:
            self._relayout()
        except Exception:
            pass
        self._rt_retune()

    # ---------------- thông báo trong cửa sổ ----------------

    def _toast(self, text):
        """Dải thông báo trong cửa sổ (KHÔNG phải hộp thoại chặn thao tác)."""
        try:
            body = getattr(self.box_toast, '_body', None)
            if body is None:
                return
            body.setText(str(text or ''))
        except Exception:
            return
        self._toast_seq += 1
        seq = self._toast_seq
        try:
            self.box_toast.show()
        except Exception:
            return
        self._relayout()

        def _hide():
            if self._closing or self._toast_seq != seq:
                return      # đã có thông báo MỚI -> cái mới tự lo việc tắt
            try:
                self.box_toast.hide()
            except Exception:
                pass
            self._relayout()
        QTimer.singleShot(TOAST_MS, _hide)

    def _hide_toast(self):
        """Tắt dải thông báo ngay (đổi trạng thái lớn thì không để nó treo)."""
        self._toast_seq += 1
        try:
            self.box_toast.hide()
        except Exception:
            return
        self._relayout()

    def _notify_gain(self, gained):
        """Khách VỪA có quyền mới -> báo ngay trong app, không phải mở lại."""
        names = []
        if 'nofog' in gained:
            names.append('Map sáng')
        if 'grant' in gained:
            names.append('Tài nguyên')
        if not names:
            return
        txt = 'Đã nhận bản quyền mới — %s' % ' + '.join(names)
        until = self._until_text(gained)
        if until:
            txt += ' đến %s' % until
        self._toast(txt)
        self._say(txt)
        self._state('Sẵn sàng', 'ok')

    def _until_text(self, feats):
        """Hạn của quyền vừa nhận: '20/12/2026' hoặc 'vĩnh viễn'."""
        try:
            lics = (self.ent or {}).get('licenses') or []
        except Exception:
            return ''
        best = 0
        for L in lics:
            if not isinstance(L, dict):
                continue
            fs = L.get('features') or []
            if not any(f in fs for f in feats):
                continue
            if not L.get('active') or not API.machine_ok(L):
                continue
            if L.get('forever'):
                return 'vĩnh viễn'
            try:
                e = int(L.get('expires_at') or 0)
            except Exception:
                e = 0
            if e > best:
                best = e
        if not best:
            return ''
        try:
            return time.strftime('%d/%m/%Y', time.localtime(best))
        except Exception:
            return ''

    @staticmethod
    def _ent_sig_of(d):
        """Dấu vân tay ngắn của kết quả kiểm tra quyền.

        Dùng để biết "có gì MỚI không": y hệt lần trước thì không ghi đè
        nhãn/nhật ký mỗi 20 giây (khách sẽ thấy chữ nhảy loạn).
        """
        d = d if isinstance(d, dict) else {}
        try:
            lics = d.get('licenses') or []
            lsig = tuple(sorted(
                (str(L.get('key') or ''), int(L.get('expires_at') or 0),
                 bool(L.get('active')), bool(L.get('revoked')),
                 str(L.get('hwid_match')),
                 # `plan` / `isTrial`: gói dùng thử hay gói đã mua — đổi
                 # loại là đổi cách hiển thị, phải tính vào dấu vân tay.
                 str(L.get('plan') or ''), bool(L.get('isTrial')))
                for L in lics if isinstance(L, dict)))
        except Exception:
            lsig = ()
        try:
            user = (d.get('user') or {}).get('username') or ''
        except Exception:
            user = ''
        # Trạng thái "bị đá sang máy khác" cũng phải nằm trong dấu vân tay:
        # server có thể chỉ đổi `isActiveDevice` mà không đổi `code`, và
        # khi đó giao diện vẫn phải vẽ lại.
        return (bool(d.get('ok')), bool(d.get('hasNofog')),
                bool(d.get('hasGrant')), user,
                str(d.get('code') or ''), str(d.get('via') or ''),
                API.session_moved(d), lsig)

    def _relayout(self):
        """Tính lại chiều cao các khối + cửa sổ sau khi NỘI DUNG đổi.

        LỖI ĐÃ SỬA: _fix_height() chỉ chạy một lần lúc dựng giao diện.
        Khi khối chức năng hiện ra hoặc hàng nút tự tạo mọc thêm, chiều
        cao khoá cũ sai -> nội dung bị nén/chồng.
        """
        try:
            _fix_height(self.status_card, 24)
            _fix_height(self.box_quota, 16)
            _fix_height(self.box_toast, 12)
            _fix_height(self.box_nofog, 30)
            _fix_height(self.box_grant, 40)
        except Exception:
            pass
        try:
            if getattr(self, 'scroll_body', None) is not None:
                self.scroll_body.adjustSize()
        except Exception:
            pass
        self._fit_window()

    def _fit_window(self, min_h=0, want_h=0):
        """Đặt chiều cao tối thiểu/mong muốn TRONG vùng làm việc, rồi căn giữa.

        LỖI ĐÃ SỬA: trước đây setMinimumHeight(820) trên màn 1366x768 làm
        mép dưới (kể cả nút "Đóng") rơi ra ngoài màn hình.
        """
        try:
            changed = False
            if min_h:
                m = _clamp_h(min_h)
                if m != self.minimumHeight():
                    self.setMinimumHeight(m)
                    changed = True
            if want_h:
                h = _clamp_h(want_h)
                if self.height() < h:
                    self.resize(self.width(), h)
                    changed = True
            # Sau MỌI resize: áp lại kích thước trong vùng làm việc rồi
            # căn giữa lại (resize() làm cửa sổ lệch khỏi tâm).
            w2 = max(560, self.width())
            h2 = _clamp_h(self.height())
            if w2 != self.width() or h2 != self.height():
                self.resize(w2, h2)
                changed = True
            if changed:
                T.center_on_screen(self)
        except Exception:
            pass

    def _state(self, text, kind='info'):
        # LỖI ĐÃ SỬA: 'info' trước đây map sang 'warn' -> trạng thái bình
        # thường ("Đang chờ game…") hiện màu cảnh báo.
        role = {'info': 'neutral', 'ok': 'ok', 'warn': 'warn',
                'err': 'err'}.get(kind, 'dim')
        self.lbl_state.setText('● ' + text)
        self.lbl_state.setProperty('role', role)
        self.lbl_state.style().unpolish(self.lbl_state)
        self.lbl_state.style().polish(self.lbl_state)
        self._sync_toggle(text)

    def _sync_toggle(self, text):
        """Nút map sáng phản ánh TRẠNG THÁI THẬT, không phải ý định.

        LỖI ĐÃ SỬA: trước đây đặt ON ngay khi bắt đầu chờ game, nên nút
        ghi "TẮT MAP SÁNG" (tức đang bật) trong khi chưa vá byte nào —
        khách tưởng đã bật, vào trận không thấy gì.
        """
        try:
            t = str(text or '')
            if t.startswith('Đang bật map sáng'):
                self._set_toggle(True)
            elif t.startswith(('Không bật được', 'License đã hết hạn',
                               'License bị thu hồi', 'Cần kích hoạt key',
                               'Đang chờ game', 'Chờ vào trận',
                               'Đã tắt')):
                self._set_toggle(False)
        except Exception:
            pass

    # ---------------- tự cập nhật ----------------

    def _start_update_check(self, manual=False):
        """Hỏi server xem có bản mới. Chạy nền."""
        try:
            self._upd_info = None
            self._upd_worker = UpdateCheckWorker(self)
            self._upd_worker.found.connect(
                lambda info: self._on_update_found(
                    info, manual, getattr(self._upd_worker, 'reason', '')))
            self._upd_worker.start()
        except Exception:
            pass

    def _on_update_found(self, info, manual=False, reason=''):
        cur = self._ver()
        self._upd_reason = reason or ''
        if not info:
            # ------------------------------------------------------------------
            # PHÂN BIỆT "đã mới nhất" với "không hỏi được server".
            #
            # LỖI ĐÃ SỬA: cả hai đều hiện "mới nhất" -> khách tưởng đã cập
            # nhật trong khi thực ra không liên lạc được server.
            # ------------------------------------------------------------------
            reason = getattr(self, '_upd_reason', '') or ''
            if reason:
                self.lbl_ver.setText('v%s  ·  lỗi kiểm tra' % cur)
                # Chi tiết (URL, mã HTTP…) chỉ ra file; khách nhận câu ngắn.
                self._tech('update check: %s' % reason)
                self._say('Không kiểm tra được bản mới. Thử lại sau.')
            else:
                self.lbl_ver.setText('v%s  ·  mới nhất' % cur)
                if manual:
                    self._say('Bạn đang dùng bản mới nhất (v%s).' % cur)
            self.btn_update.hide()
            return

        self._upd_info = info
        ver = info.get('version') or '?'
        mb = ''
        try:
            mb = ' (%.1f MB)' % (int(info.get('size') or 0) / 1048576.0)
        except Exception:
            pass

        self.lbl_ver.setText('v%s  →  %s' % (cur, ver))
        self.btn_update.setText('Cập nhật %s' % ver)
        self.btn_update.show()
        self._say('Có bản mới v%s%s. Bấm "Cập nhật %s".' % (ver, mb, ver))

    def _do_update(self):
        info = getattr(self, '_upd_info', None)
        if not info:
            return
        self.btn_update.setEnabled(False)
        self.btn_update.setText('Đang tải…')
        self._state('Đang tải bản mới…', 'warn')
        try:
            self._upd_dl = UpdateDownloadWorker(info, self)
            self._upd_dl.progress.connect(self._on_upd_progress)
            self._upd_dl.done.connect(self._on_upd_done)
            self._upd_dl.start()
        except Exception:
            self.btn_update.setText('Cập nhật')
            self.btn_update.setEnabled(True)

    def _on_upd_progress(self, got, total):
        try:
            pct = int(100 * got / max(1, total))
            self.btn_update.setText('Đang tải %d%%' % pct)
            self.lbl_ver.setText('v%s  ·  đang tải %d%%' % (self._ver(), pct))
        except Exception:
            pass

    def _on_upd_done(self, ok, msg):
        """Tải xong (hoặc lỗi) — LUÔN trả nút về trạng thái bấm được.

        LỖI ĐÃ SỬA: trước đây có nhánh `except Exception: return` nên nút
        kẹt ở "Đang tải…" và bị khoá vĩnh viễn.
        """
        try:
            if not ok:
                self._state('Cập nhật thất bại', 'err')
                self._tech('update: %s' % msg)
                self._say('Cập nhật thất bại. Thử lại sau.')
                self.lbl_ver.setText('v%s  ·  tải lỗi' % self._ver())
                self.btn_update.setText('Thử lại')
                return
            # ----------------------------------------------------------
            # DỪNG PATCHER TRƯỚC KHI THAY FILE — VÀ CHỜ NÓ DỪNG HẲN.
            #
            # LỖI ĐÃ SỬA: code cũ gọi patcher.stop() SAU khi đã lên lịch
            # thay file, và không chờ. os._exit(0) giết thread giữa vòng
            # lặp -> byte game có thể còn bị vá.
            # ----------------------------------------------------------
            self._stop_patcher_wait()
            self._state('Đã tải xong — khởi động lại…', 'ok')
            import xa_arena_app as APP
            U = APP._updater()
            exe = APP.exe_path()
            if U and exe:
                okr, _m = U.apply_and_restart(exe)
                if not okr:
                    self._state('Không thay được file', 'err')
                    self.btn_update.setText('Cập nhật')
                    return
            self.hide()
            os._exit(0)
        except Exception as e:
            self._tech('update done: %s' % e)
            self._state('Cập nhật thất bại', 'err')
            self.btn_update.setText('Thử lại')
            self.btn_update.show()
            return
        finally:
            # Nút luôn bấm lại được (trừ khi app đã restart ở trên).
            try:
                self.btn_update.setEnabled(True)
            except Exception:
                pass
            if getattr(self, '_close_when_idle', False):
                # Khách đã bấm Đóng khi đang tải -> giờ mới được đóng.
                QTimer.singleShot(0, self.close)

    # ---------------- quyền ----------------

    def _refresh_entitlement(self, key=None, allow_free=True, quiet=False):
        # ------------------------------------------------------------------
        # CHƯA CÓ GÌ -> TỰ XIN DÙNG THỬ THEO MÁY (không cần key).
        #
        # LỖI ĐÃ SỬA: trước đây lần chạy đầu (không đăng nhập, không key)
        # gọi thẳng /api/entitlement -> 401 -> màn hình trống + câu
        # "Bấm Đăng nhập hoặc Nhập key để bắt đầu" = ngõ cụt. Khách vừa
        # tải exe về không dùng được gì.
        #
        # Nay: nếu chưa có token dùng được và cũng không có session, app
        # tự xin dùng thử; xong mới hỏi quyền.
        #
        # allow_free=False dành cho đồng hồ TỰ LÀM MỚI: nó chỉ được ĐỌC,
        # tuyệt đối không tự xin thêm lượt (mỗi lần xin là tiêu 1 lượt của
        # khách — phải để khách tự bấm "Nhận thêm lượt").
        # ------------------------------------------------------------------
        if quiet:
            # Đồng hồ tự làm mới không được xếp chồng worker.
            if self._workers_busy():
                return
        # Nhớ ý định "lần hỏi này ĐƯỢC PHÉP xin dùng thử" cho _on_entitlement:
        # khách ĐÃ ĐĂNG NHẬP mà KHÔNG có gói trả phí vẫn phải nhận được lượt
        # dùng thử của MÁY NÀY (chủ shop: "trial cho free nhưng chỉ được 10
        # lần 1 máy"). Trước đây có session là bỏ luôn dùng thử.
        self._allow_free = bool(allow_free) and key is None and not self._kicked
        need_free = False
        need_login = False
        if key is None and allow_free:
            try:
                import xa_arena_api as _A
                has_tok = False
                try:
                    has_tok = _A.token_ok()
                except Exception:
                    has_tok = False
                # LỖI ĐÃ SỬA: `_cookie_header(None)` luôn trả '' vì
                # nó chỉ ĐỊNH DẠNG token được truyền vào, không đọc
                # session từ đĩa. Nên `has_sess` luôn False → app xin
                # dùng thử lại mỗi lần mở dù khách đã đăng nhập.
                try:
                    has_sess = bool(_A.session_cookie())
                except Exception:
                    has_sess = False
                # ------------------------------------------------------------------
                # MÁY ĐÃ CÓ KEY (mua hoặc dùng thử cũ) -> KHÔNG xin dùng thử.
                #
                # LỖI ĐÃ SỬA: trước đây chỉ xét `token_ok()`. Token hết hạn
                # (hoặc máy vừa cài lại) là app đi xin dùng thử NGAY, tiêu
                # mất 1 lượt của khách dù trong máy đã có key trả phí chờ
                # kích hoạt. Nay có key là đi thẳng vào đường kích hoạt.
                # ------------------------------------------------------------------
                has_key = False
                try:
                    has_key = bool(_A.local_token_key() or _A.load_manual_key())
                except Exception:
                    has_key = False

                # ----------------------------------------------------------
                # BẮT BUỘC ĐĂNG NHẬP (chủ shop chốt).
                #
                # Trước đây không đăng nhập vẫn xin được dùng thử theo máy.
                # Nay dùng thử tính theo TÀI KHOẢN, nên không có phiên thì
                # không có gì để tính -> phải đăng nhập (hoặc tạo tài khoản
                # ngay trong app).
                # ----------------------------------------------------------
                if not has_sess and not has_key:
                    need_login = True
                else:
                    # Đã đăng nhập mà chưa có token -> bắt đầu lượt dùng thử
                    need_free = (not has_tok) and has_sess
            except Exception:
                need_free = False

        if need_login:
            self._state('Cần đăng nhập để sử dụng', 'warn')
            self._require_login()
            return

        if need_free:
            self._allow_free = False      # đã xin ở đây rồi, không xin lại
            self._state('Đang bật dùng thử cho máy này…', 'warn')
            self._start_free_trial()
            return

        if not quiet:
            self._state('Đang kiểm tra quyền…', 'warn')
        self.ent_worker = EntitlementWorker(key, self, with_quota=True)
        self.ent_worker.done.connect(self._on_entitlement)
        self.ent_worker.start()

    def _start_free_trial(self, product=None):
        """Xin (lại) dùng thử cho máy này — chạy nền, không treo cửa sổ.

        `product`: 'nofog' (map sáng) hoặc 'xagrant' (tài nguyên). Server
        tách riêng bộ đếm lượt theo sản phẩm, nên phải gửi đúng — nếu
        không, bấm "Nhận thêm lượt" cho tài nguyên lại trừ lượt map sáng.
        """
        if not product:
            product = self._more_product()
        try:
            self.free_worker = FreeTrialWorker(product, self)
            self.free_worker.done.connect(
                lambda r: self._after_free_trial(r, None))
            self.free_worker.start()
        except Exception as e:
            self._tech('free trial worker: %s' % e)
            self._after_free_trial(
                {'ok': False, 'state': 'error',
                 'msg': 'Chưa bật được dùng thử. Bấm "Kiểm tra lại".'}, None)

    def _missing_product(self):
        """Máy này CHƯA có quyền của ít nhất một sản phẩm? (xem xa_trial_rules)"""
        return TR.missing_product(getattr(self, 'has_nofog', False),
                                  getattr(self, 'has_grant', False))

    def _quota_of(self, which):
        """Số lượt còn lại của một sản phẩm (xem xa_trial_rules)."""
        q = (self._quota_res if TR.norm_product(which) == TR.PRODUCT_GRANT
             else self._quota)
        return TR.quota_of(q, which)

    def _trial_claimable(self):
        """Còn lượt cho sản phẩm CHƯA có quyền? (xem xa_trial_rules)"""
        return TR.trial_claimable(
            getattr(self, 'has_nofog', False),
            getattr(self, 'has_grant', False),
            self._quota_of('nofog'), self._quota_of('xagrant'))

    def _more_product(self):
        """Nên xin dùng thử sản phẩm nào? (xem xa_trial_rules)"""
        return TR.more_product(
            getattr(self, 'has_nofog', False),
            getattr(self, 'has_grant', False),
            getattr(self, '_trial_pref', ''))

    def _do_more(self):
        """Nút "Nhận thêm lượt": xin thêm lượt dùng thử cho máy này.

        Server giữ luật (tối đa 10 lượt mỗi máy, mỗi sản phẩm) nên đây chỉ
        là việc XIN LẠI — không phá được giới hạn. Nếu server từ chối thì
        app nói đúng lý do và đưa nút Mua ra.
        """
        if self._workers_busy():
            return
        self.btn_more.setEnabled(False)
        _set_button_text(self.btn_more, 'Đang xin thêm…')
        self._state('Đang xin thêm lượt…', 'warn')
        self._start_free_trial()

    def _after_free_trial(self, r, key=None):
        """Xin dùng thử xong: báo cho khách biết còn bao nhiêu, rồi hỏi quyền."""
        r = r or {}
        state = str(r.get('state') or '')
        msg = str(r.get('msg') or '')
        self._free_state = state or 'error'

        # Nút phải LUÔN bấm lại được, dù kết quả nào.
        try:
            self.btn_more.setEnabled(True)
            _set_button_text(self.btn_more, 'Nhận thêm lượt')
        except Exception:
            pass

        # Số lượt server vừa trả -> hiện ngay, không chờ vòng làm mới sau.
        q = dict(self._quota or {})
        for _k in ('left', 'total', 'left_sec', 'expires_at'):
            _v = r.get(_k)
            if _v is not None:          # KHÔNG xoá số đang biết bằng None
                try:
                    q[_k] = int(_v)
                except Exception:
                    pass
        q['has'] = bool(r.get('ok')) or bool(q.get('has'))
        self._apply_quota(q)

        if state == 'ok':
            # Chỉ một câu ngắn: số còn lại đã hiện ở khối DÙNG THỬ và ô
            # LICENSE, không lặp lại (chủ shop: "ít chữ thôi").
            self._say('Đã bật dùng thử miễn phí.')
        elif msg:
            # Nói ĐÚNG lý do (hết lượt / mạng này hết lượt / bị chặn).
            self._state(msg[:120], 'err')
            self._say(msg[:160])
            try:
                self.btn_buy.setVisible(True)
            except Exception:
                pass
            self._sync_primary_action()
            # Ô LICENSE phải khớp với câu vừa báo (không để số cũ).
            self._refresh_license_label()

        # ------------------------------------------------------------------
        # HỎI QUYỀN TIẾP — CHỈ KHI VỪA CÓ TOKEN MỚI.
        #
        # LỖI ĐÃ SỬA: trước đây hỏi LẠI trong MỌI trường hợp, kể cả khi
        # server vừa từ chối dùng thử. Câu "Máy này đã dùng hết lượt dùng
        # thử. Mua key để tiếp tục." bị lần hỏi quyền kế tiếp ghi đè thành
        # "Cần đăng nhập hoặc dán key" — khách mất luôn lý do thật và tưởng
        # app hỏng. Bị từ chối thì không có token mới nên hỏi lại cũng vô ích.
        # ------------------------------------------------------------------
        if state == 'ok' and not self._closing:
            self._state('Đang kiểm tra quyền…', 'warn')
            self.ent_worker = EntitlementWorker(key, self, with_quota=True)
            self.ent_worker.done.connect(self._on_entitlement)
            self.ent_worker.start()
        self._release_worker('free_worker')

    def _on_entitlement(self, d):
        self.ent = d or {}
        self.has_nofog = bool(d.get('hasNofog'))
        self.has_grant = bool(d.get('hasGrant'))

        # ------------------------------------------------------------------
        # BỊ ĐÁ SANG MÁY KHÁC -> ĐI ĐƯỜNG RIÊNG, KHÔNG rơi vào nhánh thường.
        #
        # Xét TRƯỚC mọi thứ: máy này không còn quyền gì, nên mọi nhánh bên
        # dưới (bật khối, cấp token, hiện "Sẵn sàng") đều SAI. Đặc biệt
        # KHÔNG được chạy _ensure_tokens: sẽ kích hoạt license của tài khoản
        # trên máy đã bị đá.
        # ------------------------------------------------------------------
        if API.session_moved(self.ent):
            self._enter_kicked(self.ent)
            return
        self._kicked = False

        # Số lượt được hỏi kèm trong CÙNG lượt mạng -> vẽ ngay.
        if isinstance(d, dict):
            self._apply_quota(d.get('_quota'), d.get('_quota_res'))
        # Nhớ "dấu vân tay" để lần làm mới sau biết có gì mới hay không.
        self._ent_sig = self._ent_sig_of(d)

        # ------------------------------------------------------------------
        # ĐÃ ĐĂNG NHẬP MÀ KHÔNG CÓ GÓI TRẢ PHÍ -> MÁY NÀY VẪN ĐƯỢC DÙNG THỬ.
        #
        # Chủ shop: "trial cho free nhưng chỉ được 10 lần 1 máy. có dùng tài
        # khoản khác cũng không có tác dụng". Nên ở đây KHÔNG xét tài khoản
        # nào đang đăng nhập: xin theo MÁY (server đếm theo HWID), nên đổi
        # nick trên cùng máy cũng không thêm được lượt.
        # ------------------------------------------------------------------
        if self._maybe_free_trial(self.ent):
            self._release_worker('ent_worker')
            return

        # KHÔNG setVisible ở đây. Việc hiện/ẩn do
        # _apply_feature_visibility() quyết định SAU KHI biết token có
        # dùng được không — nếu hiện sớm rồi mới ẩn thì màn hình nhấp nháy
        # và có lúc hiện khối không bấm được (đúng lỗi chủ shop nêu).

        # Cửa sổ cao vừa đủ: 1 khối thấp hơn, 2 khối cao hơn.
        # Chiều cao LUÔN bị chặn theo vùng làm việc thật của màn hình và
        # được căn giữa lại sau khi đổi kích thước.
        n_feat = int(self.has_nofog) + int(self.has_grant)
        if n_feat >= 2:
            self._fit_window(600, 820)
        else:
            self._fit_window(480, 660)

        if d.get('ok'):
            who = (d.get('user') or {}).get('username') or ''
            # ------------------------------------------------------------------
            # LUÔN BÁO CÒN BAO NHIÊU.
            #
            # Chủ shop: "số lần bao nhiêu còn bao nhiêu cũng báo luôn".
            # Dòng này gộp: quyền có gì + còn lại bao lâu + tên tài khoản.
            # ------------------------------------------------------------------
            _extra = ''
            try:
                import xa_arena_api as _A
                _fs = _A.free_status()
                _lics = (d.get('licenses') or [])
                _is_trial = any(
                    _A.is_trial_licence(L) for L in _lics
                )
                if _is_trial or (not _lics and _fs.get('has')):
                    _left = _A.fmt_left(_fs.get('left_sec') or 0)
                    if _left:
                        _extra = '  ·  còn ' + _left
                else:
                    _act = [L for L in _lics
                            if L.get('active') and _A.machine_ok(L)]
                    if _act:
                        _exp = max(int(L.get('expires_at') or 0)
                                   for L in _act)
                        if _exp > 0:
                            import time as _t
                            _left = _A.fmt_left(_exp - int(_t.time()))
                            if _left:
                                _extra = '  ·  còn ' + _left
            except Exception:
                pass

            self.lbl_right.setText(
                'Quyền: %s%s%s'
                % (API.feature_summary(d), _extra,
                   ('  ·  ' + who) if who else ''))
            self.btn_recheck.hide()

            # Key đang dùng — chỉ hiện phần đầu/cuối.
            try:
                _k = API.grant_key_of(d) or API.nofog_key_of(d)
                if _k:
                    # KHÔNG in key ra nhật ký nữa (chủ shop: mọi thứ khép kín).
                    pass
            except Exception:
                pass

            # Đã đăng nhập -> khoá nút đăng nhập, hiện nút Thoát
            logged = bool(who)
            self.btn_login.setText('Đã đăng nhập' if logged else 'Đăng nhập')
            self.btn_login.setEnabled(not logged)
            self.btn_logout.setVisible(logged)

            if self.has_nofog or self.has_grant:
                # Quyền có, nhưng máy có thể chưa có token hoặc token hết
                # hạn -> tự kích hoạt lấy token mới rồi mới bật.
                self._state('Đang chuẩn bị…', 'warn')
                self._ensure_tokens()
            else:
                # ------------------------------------------------------
                # KHÔNG CÓ QUYỀN -> ẨN HẾT + DỪNG PATCHER.
                #
                # LỖI ĐÃ SỬA: trước đây chỉ set trạng thái, không gọi
                # _apply_feature_visibility(). Khối giữ nguyên trạng thái
                # từ lần khởi động trước (token còn dùng) nên VẪN HIỆN
                # và bấm được dù server đã thu hồi / sai máy.
                # ------------------------------------------------------
                self._state('License không có quyền dùng', 'err')
                self.nofog_ready = False
                self.grant_ready = False
                self.box_nofog.hide()
                self.box_grant.hide()
                try:
                    if self.patcher is not None and self.patcher.isRunning():
                        self.patcher.stop()
                except Exception:
                    pass
                self._refresh_license_label()
        else:
            code = str(d.get('code') or '')
            _code_low = API.account_code_of(code)
            self.lbl_right.setText('Chưa có quyền')
            self.btn_logout.hide()
            self._state('Cần đăng nhập', 'warn')
            # ------------------------------------------------------------------
            # KHÔNG CÒN PHIÊN -> NÚT ĐĂNG NHẬP PHẢI BẤM LẠI ĐƯỢC.
            #
            # LỖI ĐÃ SỬA: trước đây nhánh này không đụng tới nút đăng nhập.
            # Phiên hết hạn phía server (hoặc máy vừa mất quyền) là nút còn
            # nguyên "Đã đăng nhập" và BỊ KHOÁ — khách không đăng nhập lại
            # được, app thành ngõ cụt.
            # ------------------------------------------------------------------
            if not API.session_cookie():
                try:
                    self.btn_login.setText('Đăng nhập')
                    self.btn_login.setEnabled(True)
                except Exception:
                    pass
            if code == 'NEED_LOGIN_OR_KEY':
                self._say('Bấm "Đăng nhập" để bắt đầu.')
                self.btn_recheck.hide()
            elif code:
                # Lỗi khi hỏi quyền: nêu bước tiếp theo theo ĐÚNG nguyên nhân
                # và hiện nút "Kiểm tra lại" để câu hướng dẫn có chỗ bấm.
                _step = API.next_step_for(_code_low)
                # Dòng ● phải nói đúng chuyện gì, không để câu chung
                # "Cần đăng nhập hoặc dán key" khi biết rõ nguyên nhân.
                if _code_low in ('no_licence', 'expired', 'revoked',
                                 'trial_exhausted', 'trial_quota_exhausted'):
                    self._state(API.state_text_for(_code_low), 'err')
                if _step:
                    self._say(_step)
                else:
                    # Chi tiết kỹ thuật ra file; khách chỉ thấy câu ngắn.
                    self._tech('entitlement: %s' % (
                        d.get('error') or d.get('msg') or code))
                    self._say('Không lấy được quyền. Thử lại sau.')
                self.btn_recheck.setVisible(_code_low == 'network')

        self._refresh_license_label()
        # Trạng thái đã đổi -> cân lại nút chính + nhịp tự làm mới.
        self._sync_primary_action()
        # Worker này xong việc rồi -> giải phóng (đồng hồ tạo 1 cái mỗi 20s).
        self._release_worker('ent_worker')

    # ---------------- tài khoản đang dùng ở MÁY KHÁC ----------------

    def _kick_stop_patcher(self):
        """Bị đá sang máy khác GIỮA LÚC ĐANG VÁ: tắt và TRẢ BYTE GỐC.

        VÌ SAO PHẢI CHỜ Ở ĐÂY: map sáng là byte đã vá trong tiến trình
        game. Nếu chỉ ẩn giao diện rồi báo lỗi, khách vẫn thấy map sáng
        tới khi tắt game — tức là máy đã bị đá mà vẫn đang được dùng.
        PatchWorker trả byte gốc ở đoạn cuối run(); wait() chỉ trả về khi
        run() đã thoát HẲN, nên chờ ở đây chính là điều kiện để chắc chắn
        byte đã được trả lại.
        """
        w = self.patcher
        try:
            running = bool(w is not None and w.isRunning())
        except Exception:
            running = False
        if not running:
            return
        self._stop_patcher_wait()
        try:
            self._set_toggle(False)
            self.btn_toggle.setEnabled(True)
        except Exception:
            pass
        try:
            self.lbl_game.setText('Chưa mở')
        except Exception:
            pass
        self._say('Đã tắt map sáng và trả game về như cũ.')

    def _enter_kicked(self, d):
        """Tài khoản đang dùng ở MÁY KHÁC -> máy này bị đá ra.

        Thứ tự QUAN TRỌNG:
          1. Tắt patcher + CHỜ trả byte gốc (nếu đang vá) — TRƯỚC khi báo.
          2. Ẩn hết khối chức năng + khối dùng thử.
          3. Dòng ● đúng chuyện + một dòng nhật ký + MỘT nút "Đăng nhập lại".
          4. Giãn nhịp hỏi server (5 phút) để KHÔNG tranh máy với máy kia.
        """
        first = not getattr(self, '_kicked', False)
        self._kicked = True
        # Nút Mua / Nhận thêm lượt / Kiểm tra lại đều vô nghĩa lúc này.
        self._free_over = False

        # --- 1. Trả byte gốc cho game trước khi báo cho khách ---
        self._kick_stop_patcher()
        # TẮT "Mua 2 tính 1": không còn quyền thì không được hoàn tài
        # nguyên nữa. Lỗi đã sửa — trước đây watcher vẫn chạy 200ms/lần.
        try:
            self._x2_off()
        except Exception:
            pass

        # --- 2. Không còn quyền gì trên máy này ---
        self.has_nofog = False
        self.has_grant = False
        self.nofog_ready = False
        self.grant_ready = False
        try:
            self.box_nofog.hide()
            self.box_grant.hide()
            self.box_quota.hide()
        except Exception:
            pass
        self._quota_visible = False
        self._hide_toast()

        # --- 3. Chữ khách thấy ---
        self.lbl_right.setText('Tài khoản đang dùng ở máy khác')
        self._state(API.state_text_for('session_moved'), 'err')
        self.btn_recheck.hide()
        self.btn_logout.hide()
        self.btn_more.hide()
        self.btn_buy.hide()
        try:
            self.box_toast.hide()
        except Exception:
            pass

        if first:
            self._say(API.next_step_for('session_moved'))
            label = API.active_device_label(d)
            if label:
                # Nhãn do server đặt, KHÔNG phải mã máy (API đã lọc).
                self._tech('session_moved: máy đang dùng = %s' % label)
        else:
            # Đã báo rồi: chỉ ghi chi tiết kỹ thuật, không lặp chữ cho khách.
            self._tech('session_moved (lặp lại)')

        # --- 4. Một nút duy nhất + nhịp hỏi thưa ---
        self._sync_primary_action()
        self._refresh_license_label()
        self._fit_window(440, 620)
        self._relayout()
        self._release_worker('ent_worker')

    def _maybe_free_trial(self, d):
        """Đã đăng nhập mà KHÔNG có gói trả phí -> máy này vẫn được dùng thử.

        Trả True nếu VỪA khởi động việc xin dùng thử (người gọi phải dừng
        việc vẽ giao diện, vì kết quả sẽ về sau).

        Ba điều kiện để KHÔNG xin (tránh tiêu lượt oan của khách):
          · không nằm trong lần hỏi "được phép xin" (_allow_free)
          · đã có gói ĐÃ MUA còn dùng được, hoặc máy đã có token tốt
          · server đã từ chối dùng thử (hết lượt/bị chặn) — không hỏi lại
        """
        if not getattr(self, '_allow_free', False):
            return False
        if str(self._free_state or '') in ('exhausted', 'banned'):
            return False        # server đã từ chối -> không xin lại liên tục
        try:
            if API.has_paid_licence(d) or API.token_ok():
                return False
            # Máy đã có KEY trong tay -> đi đường kích hoạt, đừng tiêu lượt.
            if API.local_token_key() or API.load_manual_key():
                return False
        except Exception:
            return False
        if self._workers_busy():
            return False
        self._allow_free = False      # mỗi lần mở app chỉ xin MỘT lần
        self._state('Đang bật dùng thử cho máy này…', 'warn')
        self._start_free_trial()
        return True

    def _refresh_license_label(self):
        """Hiện hạn dùng — lấy từ LICENSE DÙNG ĐƯỢC TRÊN MÁY NÀY.

        LỖI ĐÃ SỬA (chủ shop phát hiện "cứ hiện 716 giờ"):
        Trước đây hiện số giờ từ `state` cục bộ (hạn token của lần kích
        hoạt CŨ), không liên quan license hiện có. Nay hạn lấy từ license
        thật sự dùng được trên máy này.

        THỨ TỰ XÉT (đã kiểm bằng ma trận 44 trường hợp):
          0. Tài khoản đang dùng ở máy khác -> "Máy khác"  (xét TRƯỚC HẾT)
          1. Không license nào            -> "Chưa có"
          2. Có license active + đúng máy -> "Còn N ngày"
          3. Có active nhưng SAI MÁY      -> "Sai máy"   (chỉ gói DÙNG THỬ)
          4. Tất cả thu hồi               -> "Đã thu hồi"
          5. Còn lại                      -> "Đã hết hạn"

        "SAI MÁY" chỉ còn áp cho gói DÙNG THỬ (API.machine_ok). Gói ĐÃ MUA
        theo tài khoản: đổi máy vẫn dùng được sau khi đăng nhập.
        """
        def _set(txt, role):
            self.lbl_lic.setText(txt)
            try:
                self.lbl_lic.setProperty('role', role)
                self.lbl_lic.style().unpolish(self.lbl_lic)
                self.lbl_lic.style().polish(self.lbl_lic)
            except Exception:
                pass

        try:
            # 0. Bị đá sang máy khác: nói đúng chuyện đang xảy ra.
            if getattr(self, '_kicked', False):
                _set('Máy khác', 'err')
                return

            lics = (self.ent or {}).get('licenses') or []

            # 1. Không có license -> KHÔNG BAO GIỜ đọc state cục bộ.
            #    (Lỗi cũ: rơi vào nhánh dưới, đọc expires_at của token cũ
            #     nên báo "Còn 26 ngày" dù không có quyền gì.)
            if not lics:
                # ------------------------------------------------------------------
                # CHƯA CÓ LICENSE — nhưng có thể đang DÙNG THỬ.
                #
                # Chủ shop: "số lần bao nhiêu còn bao nhiêu cũng báo luôn".
                # Nếu đang dùng thử thì phải nói còn bao nhiêu, chứ không
                # được chỉ ghi "Chưa có" (khách tưởng không có gì).
                # ------------------------------------------------------------------
                try:
                    import xa_arena_api as _A
                    fs = _A.free_status()
                    if fs.get('has') and fs.get('left_sec'):
                        _set('Dùng thử: còn %s'
                             % _A.fmt_left(fs.get('left_sec')), 'warn')
                        return
                except Exception:
                    pass
                _set('Chưa có', 'dim')
                return

            # 2. License dùng được = active + KHÔNG bị chặn máy.
            #    hwid_match=None (client chưa gửi HWID) -> tạm coi như khớp.
            #    Gói ĐÃ MUA: máy nào cũng dùng được -> không xét hwid_match.
            usable = [L for L in lics
                      if L.get('active') and API.machine_ok(L)]

            if usable:
                def _exp(L):
                    if L.get('forever'):
                        return 10 ** 12
                    return int(L.get('expires_at') or 0)

                best = max(usable, key=_exp)
                if best.get('forever'):
                    _set('Vĩnh viễn', 'ok')
                    return
                e = int(best.get('expires_at') or 0)
                if e <= 0:
                    _set('Đang dùng', 'ok')
                    return
                left = e - time.time()
                if left <= 0:
                    _set('Đã hết hạn', 'err')
                    return
                days = int(left // 86400)
                hours = int((left % 86400) // 3600)
                mins = int((left % 3600) // 60)
                if days >= 1:
                    _set('Còn %d ngày' % days, 'ok')
                elif hours >= 1:
                    # LỖI ĐÃ SỬA: 'Còn 5h 03ph' trộn đơn vị với 'Còn 3 ngày'.
                    _set('Còn %d giờ %02d phút' % (hours, mins), 'ok')
                else:
                    _set('Còn %d phút' % max(1, mins), 'ok')
                return

            # 3. Có DÙNG THỬ còn hạn nhưng bind máy khác -> "Sai máy".
            #    Xét TRƯỚC "hết hạn": nguyên nhân là sai máy, mua lại
            #    không giải quyết được. Gói ĐÃ MUA không bao giờ vào đây.
            alive_other = [L for L in lics
                           if L.get('active') and not API.machine_ok(L)]
            if alive_other:
                _set('Sai máy', 'err')
                return

            # 4. Tất cả bị thu hồi
            revoked = [L for L in lics if L.get('revoked')]
            if revoked and len(revoked) == len(lics):
                _set('Đã thu hồi', 'err')
                return
            if revoked:
                _set('Đã thu hồi', 'err')
                return

            # 5. Còn lại: hết hạn
            _set('Đã hết hạn', 'err')
        except Exception:
            self.lbl_lic.setText('—')

    def _ensure_tokens(self):
        """Tự kích hoạt license để lấy token (map sáng / bảng địa chỉ)."""
        self._tok_worker = TokenWorker(self.ent, self)
        self._tok_worker.step.connect(self._state)
        self._tok_worker.done.connect(self._on_tokens_ready)
        self._tok_worker.start()

    def _apply_feature_visibility(self, nofog_ready, grant_ready,
                                  reason_nofog='', reason_grant='',
                                  next_step=''):
        """Áp dụng hiện/ẩn khối theo khả năng BẤM ĐƯỢC.

        ĐÂY LÀ NGUỒN SỰ THẬT DUY NHẤT cho hiển thị chức năng.

        nofog_ready / grant_ready: có quyền VÀ đã có token dùng được.
        Khối chỉ hiện khi ready -> "hiện là bấm được", đúng yêu cầu.
        """
        step = str(next_step or '')
        # BỊ ĐÁ SANG MÁY KHÁC: không có gì được phép hiện. Chặn ngay tại
        # nguồn sự thật duy nhất này để không nhánh nào vô tình bật khối.
        if getattr(self, '_kicked', False):
            self.nofog_ready = False
            self.grant_ready = False
            try:
                self.box_nofog.hide()
                self.box_grant.hide()
                self.box_quota.hide()
            except Exception:
                pass
            self._quota_visible = False
            self._sync_primary_action()
            self._refresh_license_label()
            self._relayout()
            return
        was_nofog = bool(self.nofog_ready)
        was_grant = bool(self.grant_ready)
        self.nofog_ready = bool(nofog_ready) and bool(self.has_nofog)
        self.grant_ready = bool(grant_ready) and bool(self.has_grant)

        # ------------------------------------------------------------------
        # VỪA CÓ QUYỀN MỚI -> BÁO NGAY, KHÔNG BẮT KHÁCH MỞ LẠI APP.
        #
        # Đây là mắt xích "mua trên web xong app tự nhận": đồng hồ tự làm
        # mới hỏi server, thấy quyền mới -> _on_tokens_ready -> hàm này ->
        # thông báo + đổi dòng trạng thái thành "Sẵn sàng".
        # Bỏ qua lần áp dụng ĐẦU TIÊN (lúc mở app) để không báo vô cớ.
        # ------------------------------------------------------------------
        gained = []
        if self.nofog_ready and not was_nofog:
            gained.append('nofog')
        if self.grant_ready and not was_grant:
            gained.append('grant')
        if gained and not self._first_apply:
            self._notify_gain(gained)
        self._first_apply = False

        # Hiện/ẩn + tính lại chiều cao SAU khi đổi nội dung.
        #
        # LỖI ĐÃ SỬA: `box_grant` trước đây chỉ hiện khi `grant_ready` —
        # mà giá trị đó cần TOKEN ENGINE trên đĩa. Trên máy khác token
        # chưa lấy được ⇒ khối ẩn ⇒ nút "Mua 2 tính 1" (nằm trong khối)
        # cũng ẩn, dù khách đã mua gói tài nguyên.
        #
        # Nay: hiện khối khi khách CÓ QUYỀN (`has_grant`). Từng nút bên
        # trong tự báo lỗi rõ khi bấm mà chưa sẵn sàng — `_engine()` nói
        # "Chưa mở game" / "Cần quyền Administrator".
        self.box_nofog.setVisible(self.nofog_ready)
        self.box_grant.setVisible(
            bool(getattr(self, 'has_grant', False))
            or bool(self.grant_ready))

        # Có quyền dùng được -> giấu nút Mua; không -> hiện.
        try:
            self.btn_buy.setVisible(not (self.nofog_ready or self.grant_ready))
        except Exception:
            pass

        # --- Nhãn quyền: chỉ nêu phần THỰC SỰ dùng được ---
        names = []
        if self.nofog_ready:
            names.append('Map sáng')
        if self.grant_ready:
            names.append('Tài nguyên')

        who = ((self.ent or {}).get('user') or {}).get('username') or ''
        if names:
            txt = 'Quyền: ' + ' + '.join(names)
        else:
            txt = 'Chưa dùng được chức năng nào'

        # ------------------------------------------------------------------
        # UX: ĐANG DÙNG THỬ MÀ THIẾU MỘT TRONG HAI QUYỀN.
        #
        # LỖI UX ĐÃ SỬA: server chỉ cấp MỘT quyền cho mỗi license dùng thử,
        # nên khách chỉ thấy một khối. Khối kia bị ẩn hoàn toàn ⇒ khách
        # tưởng "bản dùng thử không có tài nguyên" / "không có map sáng".
        #
        # Nay: thêm MỘT dòng ngắn nói rõ còn sản phẩm kia và cách lấy.
        # Không thêm nút, không thêm hộp thoại.
        # ------------------------------------------------------------------
        try:
            _has_n = bool(getattr(self, 'has_nofog', False))
            _has_g = bool(getattr(self, 'has_grant', False))
            _is_trial = False
            try:
                import xa_arena_api as _At
                for _L in ((self.ent or {}).get('licenses') or []):
                    if _At.is_trial_licence(_L):
                        _is_trial = True
                        break
            except Exception:
                _is_trial = False
            if _is_trial and (_has_n != _has_g):
                _other = 'Tài nguyên' if _has_n else 'Map sáng'
                txt += (' · chưa có %s — bấm "Nhận thêm lượt" để thử'
                        % _other)
        except Exception:
            pass

        # ------------------------------------------------------------------
        # LUÔN HIỆN CÒN BAO NHIÊU.
        #
        # Chủ shop: "số lần bao nhiêu còn bao nhiêu cũng báo luôn".
        # Đây là nơi ghi CUỐI CÙNG vào dòng này, nên phải thêm ở đây —
        # _on_entitlement ghi trước đó sẽ bị hàm này ghi đè.
        # ------------------------------------------------------------------
        try:
            import xa_arena_api as _A
            _lics = (self.ent or {}).get('licenses') or []
            _is_trial = any(
                _A.is_trial_licence(L) for L in _lics
            )
            _left = ''
            if _is_trial or not _lics:
                _fs = _A.free_status()
                if _fs.get('has') and _fs.get('left_sec'):
                    _left = _A.fmt_left(_fs.get('left_sec'))
            if not _left:
                _act = [L for L in _lics
                        if L.get('active') and _A.machine_ok(L)]
                if _act:
                    import time as _t
                    _exp = max(int(L.get('expires_at') or 0) for L in _act)
                    if _exp > 0:
                        _left = _A.fmt_left(_exp - int(_t.time()))
            if _left:
                txt += '  ·  còn ' + _left
        except Exception:
            pass

        if who:
            txt += '  ·  ' + who
        self.lbl_right.setText(txt)

        # --- Ghi lý do khi có quyền mà không dùng được ---
        if self.has_nofog and not self.nofog_ready and reason_nofog:
            self._say('Map sáng: %s' % reason_nofog[:100])
        if self.has_grant and not self.grant_ready and reason_grant:
            self._say('Tài nguyên: %s' % reason_grant[:100])

        # --- Không chức năng nào -> nói rõ BƯỚC KẾ TIẾP ---
        # LỖI ĐÃ SỬA: trước đây luôn khuyên "bấm Đăng nhập hoặc Key để
        # kích hoạt lại" — đúng cái vừa thất bại, một ngõ cụt.
        if not self.nofog_ready and not self.grant_ready:
            if self.has_nofog or self.has_grant:
                # ------------------------------------------------------------------
                # NÓI RÕ LÝ DO, KHÔNG DÙNG CÂU CHUNG.
                #
                # LỖI ĐÃ SỬA: trước đây luôn hiện "License chưa dùng được
                # trên máy này" — khách không biết là mã sai, hết hạn, sai
                # máy hay lỗi mạng. Ví dụ thật: khách nhập
                # TR-MCBY-... (mã đúng là TR-MC8Y-..., đọc số 8 thành chữ B)
                # → chỉ thấy câu chung, không biết phải làm gì.
                #
                # Nay: lấy đúng lý do đã có (reason_nofog / reason_grant),
                # nếu không có thì hiện mã lỗi thật.
                # ------------------------------------------------------------------
                detail = ''
                if self.has_nofog and reason_nofog:
                    detail = str(reason_nofog)
                elif self.has_grant and reason_grant:
                    detail = str(reason_grant)
                elif step:
                    detail = str(step)

                # Hết quyền -> hiện nút Mua (đưa khách lên web).
                try:
                    self.btn_buy.setVisible(True)
                except Exception:
                    pass

                if detail:
                    self._state(detail[:120], 'err')
                else:
                    self._state('License chưa dùng được trên máy này', 'err')

                if step:
                    self._say(step)
                elif detail:
                    self._say(detail[:160])
                else:
                    self._say('Bấm "Kiểm tra lại" để thử lại.')
                self.btn_recheck.setVisible(True)
            else:
                # ------------------------------------------------------------------
                # KHÔNG CÓ LICENSE NÀO -> nói đúng chuyện, không nói câu chung.
                #
                # "Tài khoản chưa có gói" khác hẳn "cần đăng nhập": khách đã
                # đăng nhập rồi mà vẫn thấy "Cần đăng nhập hoặc dán key" thì
                # tưởng app hỏng. Đây là trường hợp `no_licence`.
                # ------------------------------------------------------------------
                _code = API.entitlement_code(self.ent)
                if _code == 'no_licence':
                    self._state(API.state_text_for(_code), 'err')
                    _st = API.next_step_for(_code)
                    if _st:
                        self._say(_st)
                    self.btn_recheck.hide()
                else:
                    self._state('Cần đăng nhập', 'warn')
                    self.btn_recheck.hide()
                    # Chưa đăng nhập -> nút chính là "Đăng nhập".
                    try:
                        self.btn_login.setText('Đăng nhập')
                        self.btn_login.setEnabled(True)
                    except Exception:
                        pass
        else:
            self._state('Sẵn sàng', 'ok')
            self.btn_recheck.hide()

        # --- Cửa sổ cao theo SỐ KHỐI THỰC SỰ HIỆN (đã chặn theo màn hình) ---
        #
        # LỖI ĐÃ SỬA: trước đây đếm theo `grant_ready`. Sau khi khối tài
        # nguyên hiện theo QUYỀN (không chờ token), cách đếm cũ chọn cửa
        # sổ nhỏ trong khi có 2 khối ⇒ khối bị cắt.
        _show_nofog = bool(getattr(self, 'nofog_ready', False))
        _show_grant = bool(getattr(self, 'has_grant', False)) \
            or bool(getattr(self, 'grant_ready', False))
        n = int(_show_nofog) + int(_show_grant)
        if n >= 2:
            self._fit_window(600, 820)
        elif n == 1:
            self._fit_window(500, 680)
        else:
            self._fit_window(440, 620)

        # Nội dung vừa đổi -> tính lại chiều cao các khối.
        self._relayout()
        # Khối DÙNG THỬ phải ẩn/hiện NGAY trong cùng nhịp này.
        # LỖI ĐÃ SỬA: trước đây chỉ đồng hồ 1 giây (_on_tick) mới gọi
        # _render_quota, nên khách VỪA mua xong còn thấy khối "Dùng thử:
        # chưa bật" chễm chệ thêm một giây trên màn hình đã có đủ quyền.
        self._render_quota()
        self._refresh_license_label()
        # Một nút chính: hết lượt -> "Nhận thêm lượt", còn lại -> "Mua".
        self._sync_primary_action()
        # Máy chủ shop: nút "Mua 2 tính 1" chỉ hiện khi có quyền + đúng HWID.
        try:
            self._refresh_x2_button()
        except Exception:
            pass

    def _on_tokens_ready(self, ok, msg, code=''):
        """Sau khi chuẩn bị token: quyết định hiện/ẩn từng chức năng.

        Chủ shop: "mua map sáng thì hiện map sáng VÀ BẤM ĐƯỢC; mua tài
        nguyên thì hiện tài nguyên; có cả 2 thì hiện cả 2; không thì ẩn".
        Nên phải kiểm RIÊNG từng cái xem có dùng được không.
        """
        import xa_arena_api as _API

        nofog_ready = False
        grant_ready = False
        why_n = ''
        why_g = ''

        # --------------------------------------------------------------
        # CÂU HƯỚNG DẪN PHẢI KHỚP NGUYÊN NHÂN.
        #
        # LỖI ĐÃ SỬA (a): trước đây chỉ hiện câu server + "bấm Đăng nhập
        # hoặc Key để kích hoạt lại" — đúng cái vừa thất bại -> ngõ cụt.
        # LỖI ĐÃ SỬA (b): trước đây mặc định "key này đã dùng trên máy
        # khác" cho MỌI lỗi, kể cả lỗi mạng/không đọc được HWID -> khách
        # tưởng bị khoá oan.
        # --------------------------------------------------------------
        code = _API.error_code_of(code or msg)
        step = _API.next_step_for(code)

        if getattr(self, 'has_nofog', False):
            try:
                nofog_ready = _API.token_ok()
            except Exception:
                nofog_ready = False
            if not nofog_ready:
                why_n = step or 'chưa lấy được quyền map sáng trên máy này'

        if getattr(self, 'has_grant', False):
            try:
                grant_ready = _API.grant_token_ok()
            except Exception:
                grant_ready = False
            if not grant_ready:
                why_g = step or 'chưa lấy được quyền tài nguyên trên máy này'

        self._apply_feature_visibility(nofog_ready, grant_ready,
                                       why_n, why_g, next_step=step)

        if nofog_ready:
            self._auto_start_patcher()

    def _do_logout(self):
        """Đăng xuất: xoá session + quyền + key đã nhớ."""
        try:
            API.logout()
        except Exception as e:
            self._tech('logout: %s' % e)

        # Dừng patcher vì không còn quyền map sáng
        try:
            if self.patcher is not None and self.patcher.isRunning():
                self._stop_patcher()
        except Exception:
            pass

        self.ent = {}
        self.has_nofog = False
        self.has_grant = False
        self.nofog_ready = False
        self.grant_ready = False
        # Đăng xuất là khách CHỦ ĐỘNG -> không còn ở trạng thái bị đá.
        self._kicked = False
        self._allow_free = False
        self._free_state = ''
        # TẮT "Mua 2 tính 1" — nếu không, watcher vẫn chạy 200ms/lần và
        # vẫn hoàn tài nguyên dù khách đã đăng xuất (mất quyền).
        try:
            self._x2_off()
        except Exception:
            pass
        self.box_nofog.hide()
        self.box_grant.hide()
        self.btn_logout.hide()
        self.btn_login.setText('Đăng nhập')
        self.btn_login.setEnabled(True)
        self.lbl_right.setText('Chưa có quyền')
        self.lbl_lic.setText('—')
        self._hide_toast()
        self._state('Đã đăng xuất', 'info')
        self._say('Đã đăng xuất. Bấm "Đăng nhập" để dùng lại.')

    def _require_login(self):
        """BẮT BUỘC đăng nhập: mở hộp thoại, khách không thoát được nếu chưa có tài khoản.

        Chủ shop chốt: "bất buộc phải đăng ký mới sử dụng được app. Đăng ký
        luôn trên EXE cũng được."

        Luồng:
          1. Đã có phiên -> không làm gì
          2. Chưa có -> mở hộp thoại (đăng nhập hoặc tạo tài khoản)
          3. Khách bấm Thoát -> đóng app (không cho dùng chế độ không tài khoản)
        """
        if getattr(self, '_login_prompting', False):
            return
        try:
            import xa_arena_api as _A
            if _A.session_cookie():
                return
        except Exception:
            pass

        self._login_prompting = True
        try:
            d = LoginDialog(self)
            if d.exec() != QDialog.DialogCode.Accepted:
                # Không đăng nhập -> không dùng được app.
                self._say('Cần đăng nhập để sử dụng. Đang đóng…')
                self._closing = True
                QTimer.singleShot(120, self.close)
                return
            u, p = d.values()
            if not u or not p:
                QTimer.singleShot(120, self._require_login)
                return
            self._login_is_register = d.is_register()
            self._state('Đang tạo tài khoản…' if self._login_is_register
                        else 'Đang đăng nhập…', 'warn')
            w = getattr(self, 'login_worker', None)
            if w is not None and w.isRunning():
                QTimer.singleShot(300, self._require_login)
                return
            self.login_worker = LoginWorker(u, p, self,
                                            register=self._login_is_register)
            self.login_worker.done.connect(self._on_login_required)
            self.login_worker.start()
        finally:
            self._login_prompting = False

    def _on_login_required(self, ok, msg):
        """Đăng nhập/tạo tài khoản ở cổng bắt buộc xong."""
        if not ok:
            self._state('Đăng nhập thất bại', 'err')
            self._tech('login: %s' % msg)
            self._say(msg or 'Không đăng nhập được. Thử lại.')
            # Cho khách thử lại, không đóng app ngay
            QTimer.singleShot(200, self._require_login)
            return
        self._say('Tạo tài khoản thành công. Đang bật dùng thử 1 ngày…'
                  if getattr(self, '_login_is_register', False)
                  else 'Đăng nhập thành công.')
        self._kicked = False
        self._free_state = ''
        # Có tài khoản rồi -> xin lượt dùng thử 1 ngày ngay
        self._state('Đang bật dùng thử cho tài khoản…', 'warn')
        self._start_free_trial()

    def _do_login(self):
        """Mở hộp thoại đăng nhập / tạo tài khoản."""
        d = LoginDialog(self)
        if d.exec() != QDialog.DialogCode.Accepted:
            return
        u, p = d.values()
        if not u or not p:
            self._state('Thiếu tên đăng nhập hoặc mật khẩu', 'err')
            return
        is_reg = d.is_register()
        self._state('Đang tạo tài khoản…' if is_reg else 'Đang đăng nhập…', 'warn')
        # Chặn gán đè worker đang chạy (thread mồ côi -> có thể crash khi thoát)
        w = getattr(self, 'login_worker', None)
        if w is not None and w.isRunning():
            self._state('Đang xử lý, chờ một chút…', 'warn')
            return
        self._login_is_register = is_reg
        self.login_worker = LoginWorker(u, p, self, register=is_reg)
        self.login_worker.done.connect(self._on_login)
        self.login_worker.start()

    def _on_login(self, ok, msg):
        if ok:
            self._say('Tạo tài khoản thành công.' if getattr(self, '_login_is_register', False)
                      else 'Đăng nhập thành công.')
            # Đăng nhập lại sau khi bị đá sang máy khác: lần hỏi này ĐƯỢC
            # PHÉP xin dùng thử theo máy (nếu tài khoản không có gói trả phí
            # và máy này còn lượt) — nên phải đặt lại cờ trước khi hỏi.
            self._kicked = False
            self._free_state = ''
            self._refresh_entitlement()
        else:
            self._state('Tạo tài khoản thất bại' if getattr(self, '_login_is_register', False)
                        else 'Đăng nhập thất bại', 'err')
            self._tech('login: %s' % msg)
            self._say(msg or 'Không đăng nhập được. Kiểm tra tên và mật khẩu.')

    def _do_buy(self):
        """Mở trang mua trên web."""
        try:
            import xa_arena_api as _A
            prod = 'grant' if (self.has_grant and not self.has_nofog) else 'nofog'
            url = _A.buy_url(prod)
            if _A.open_url(url):
                self._say('Đã mở trang mua trong trình duyệt.')
            else:
                self._say('Mở xienhl.com để mua.')
        except Exception:
            self._say('Mở xienhl.com để mua.')

    def _ask_key(self):
        """ĐÃ BỎ: không còn nhập key.

        Giữ hàm rỗng để tín hiệu `patcher.need_key` (phát khi token hỏng)
        không làm vỡ chương trình. Nay token hỏng nghĩa là phiên đăng nhập
        hoặc lượt dùng thử có vấn đề — việc đúng là làm mới quyền, không
        phải bắt khách gõ key.
        """
        self._refresh_entitlement()

    # ---------------- map sáng ----------------

    def _auto_start_patcher(self):
        if not self.has_nofog:
            return
        if self._stopping:
            # Đang tắt dở -> thử lại sau (không chặn giao diện).
            QTimer.singleShot(300, self._auto_start_patcher)
            return
        if self.patcher is not None and self.patcher.isRunning():
            return
        self.patcher = PatchWorker(self, ent=getattr(self, 'ent', None))
        self.patcher.log.connect(self._say)
        self.patcher.state.connect(self._state)
        self.patcher.game_seen.connect(self._on_game_seen)
        self.patcher.game_text.connect(self._on_game_text)
        # LỖI ĐÃ SỬA: tín hiệu need_key trước đây phát ra mà không ai nối
        # -> worker báo "cần kích hoạt key" rồi im lặng mãi.
        self.patcher.need_key.connect(self._ask_key)
        self.patcher.start()
        # KHÔNG đặt ON ở đây — nút sẽ tự bật khi PatchWorker báo
        # 'Đang bật map sáng' (xem _sync_toggle). Giữ nút ở trạng thái
        # "đang bật…" bằng cách khoá tạm để khách không bấm đúp.
        self._set_toggle(False)
        self._stopping = False
        self.btn_toggle.setEnabled(True)

    def _on_game_seen(self, seen):
        self.lbl_game.setText('Đã kết nối' if seen else 'Chưa mở')

    def _on_game_text(self, txt):
        self.lbl_game.setText(str(txt or '—'))

    def _toggle_nofog(self):
        if self._stopping:
            # Đang chờ patcher trả byte gốc -> không nhận bấm mới.
            self._state('Đang tắt map sáng…', 'warn')
            return
        # Đang chạy -> cho tắt (luôn cho phép tắt, an toàn hơn).
        if self.patcher is not None and self.patcher.isRunning():
            self._stop_patcher()
            return
        # Bật -> phải có quyền thật
        if not getattr(self, 'nofog_ready', False):
            self._say('Chưa dùng được map sáng.')
            return
        self._auto_start_patcher()

    def _stop_patcher(self):
        """Bắt đầu dừng patcher — KHÔNG chặn giao diện.

        LỖI ĐÃ SỬA: trước đây hàm này gọi w.wait(8000) + wait(4000) ngay
        trên luồng giao diện. Bấm đúp trong lúc dừng là cửa sổ đứng hình
        8–12 giây, không một dòng phản hồi nào.
        """
        self._stopping = True
        self.btn_toggle.setEnabled(False)
        _set_button_text(self.btn_toggle, 'Đang tắt…')
        self._state('Đang tắt map sáng…', 'warn')
        self._stop_deadline = time.monotonic() + 12.0
        w = self.patcher
        if w is not None:
            # KHÔNG terminate(): giết thread ở điểm bất kỳ có thể hỏng
            # handle Win32 hoặc bỏ dở việc trả byte gốc cho game.
            w.stop()
        QTimer.singleShot(120, self._poll_stop_done)

    def _poll_stop_done(self):
        """Chờ patcher dừng thật rồi mới mở lại nút (không chặn GUI)."""
        w = self.patcher
        try:
            running = bool(w is not None and w.isRunning())
        except Exception:
            running = False
        if running and time.monotonic() < self._stop_deadline:
            QTimer.singleShot(120, self._poll_stop_done)
            return
        if running:
            # Quá 12s: báo cho khách biết thay vì im lặng.
            self._say('Map sáng có thể vẫn đang tắt dở. Thử lại sau ít giây.')
            self._tech('patcher still running after stop deadline')
        self._stopping = False
        self._set_toggle(False)
        self.btn_toggle.setEnabled(True)
        self.lbl_game.setText('Chưa mở')
        self._state('Đã tắt', 'info')

    def _stop_patcher_wait(self):
        """Dừng patcher VÀ CHỜ (dùng khi sắp thoát / thay file).

        Trả True nếu đã dừng hẳn. Dùng đúng 8s + 4s như trước.
        """
        w = self.patcher
        if w is None:
            return True
        try:
            if not w.isRunning():
                return True
            w.stop()
            if w.wait(8000):
                return True
            self._say('Chưa dừng hẳn, đang chờ thêm…')
            return bool(w.wait(4000))
        except Exception:
            return True

    def _set_toggle(self, on):
        if on:
            _set_button_text(self.btn_toggle, 'TẮT MAP SÁNG')
            self.btn_toggle.setProperty('role', 'danger')
        else:
            _set_button_text(self.btn_toggle, 'BẬT MAP SÁNG')
            self.btn_toggle.setProperty('role', 'primary')
        self.btn_toggle.style().unpolish(self.btn_toggle)
        self.btn_toggle.style().polish(self.btn_toggle)

    # ---------------- tài nguyên ----------------

    def _engine(self):
        """Mở handle game + nạp bảng địa chỉ. None nếu không được."""
        try:
            import xa_grant as XG
        except Exception:
            self._state('Chưa bật được tài nguyên', 'err')
            return None
        if self.grant_engine:
            h, base = self.grant_engine
            try:
                import ctypes
                code = ctypes.c_ulong(0)
                ok = ctypes.WinDLL('kernel32').GetExitCodeProcess(
                    ctypes.c_void_p(h), ctypes.byref(code))
                if ok and code.value == 259:
                    return self.grant_engine
            except Exception:
                pass
            self.grant_engine = None

        procs = XG.find_game()
        if not procs:
            self._state('Chưa mở game', 'warn')
            self._say('Mở AoE và vào trận trước.')
            return None
        pid = procs[0][0]
        h = XG.open_game(pid)
        if not h:
            # PHÂN BIỆT nguyên nhân: thiếu quyền admin hay lỗi khác.
            # Trước đây luôn báo "Không kết nối được game" nên khách
            # không biết phải làm gì.
            if not _is_admin():
                self._state('Cần chạy bằng quyền Administrator', 'err')
                self._say('Tắt app, chuột phải file > Run as administrator.')
                self.lbl_game.setText('Thiếu quyền')
            else:
                self._state('Không kết nối được game', 'err')
                self._say('Thử tắt game rồi mở lại.')
            return None
        base = XG.module_base(h)
        okE, msgE = XG.ensure_engine(None)
        if not okE:
            self._state('Cần kích hoạt key', 'err')
            self._tech('engine table: %s' % msgE)
            self._say('Chưa mở được chức năng tài nguyên.')
            return None
        self.grant_engine = (h, base)
        self.lbl_game.setText('Đã kết nối')
        return self.grant_engine

    def _busy_buttons(self, on):
        """Khoá/mở mọi nút có thể gọi engine.

        LỖI ĐÃ SỬA: trước đây chỉ khoá `amount_buttons` + `btn_custom`.
        `btn_x2` ("Mua 2 tính 1") và các nút tự tạo trong `tb_buttons`
        KHÔNG bị khoá, nên khách bấm được khi engine đang bận ⇒ hai lệnh
        engine cùng lúc ⇒ crash game (0xC0000005).
        """
        btns = list(self.amount_buttons) + [self.btn_custom]
        for name in ('btn_x2', 'btn_add', 'btn_x2_toggle'):
            b = getattr(self, name, None)
            if b is not None:
                btns.append(b)
        for b in btns:
            try:
                b.setEnabled(not on)
            except Exception:
                pass

    def _match_minute(self):
        """Đang ở phút thứ mấy của trận? 1 = phút đầu.

        Ưu tiên đọc THỜI GIAN TRẬN từ game. Nếu chưa đọc được (chưa vào
        trận, hoặc engine chưa có địa chỉ) thì trả 1 — tức mức cộng nhỏ
        nhất, an toàn nhất.

        Trả về số nguyên >= 1.
        """
        try:
            import xa_grant as XG
            fn = getattr(XG, 'match_seconds', None)
            if fn is None:
                return 1
            # LỖI ĐÃ SỬA (P0): trước đây dùng `self.h` / `self.base` —
            # ArenaWindow KHÔNG có hai thuộc tính đó (handle nằm trong
            # `self.grant_engine`). Nó ném AttributeError, bị nuốt, nên
            # luôn trả về phút 1 và lỗi hoàn toàn vô hình.
            eng = getattr(self, 'grant_engine', None)
            if not eng:
                return 1
            sec = fn(eng[0], eng[1])
            if not sec or sec <= 0:
                return 1
            self._tech('match_seconds=%s' % sec)
            return max(1, int(sec) // 60 + 1)
        except Exception as e:
            self._tech('match_minute: %s' % e)
            return 1

    def _grant_amount(self, amt, fast=False):
        self._grant_amounts(amt, fast=fast)

    def _grant_amounts(self, amounts, fast=False):
        # CHẶN THEO QUYỀN, KHÔNG CHỈ THEO GIAO DIỆN.
        # LỖI ĐÃ SỬA: trước đây chỉ cần còn token cũ trên đĩa là cộng
        # được tài nguyên, dù server đã thu hồi hoặc chưa từng cấp quyền.
        if not getattr(self, 'grant_ready', False):
            self._say('Chưa dùng được chức năng tài nguyên.')
            return
        # CHẶN TRẦN THẬT.
        #
        # LỖI ĐÃ SỬA: `GRANT_CAP` trước đây là con số CHẾT — không
        # `_grant_amounts` cũng không `GrantWorker.run` đọc nó, nên
        # comment "trần mỗi lần bấm" là sai sự thật và không chặn gì.
        #
        # Nay chặn đúng ở đây. Nhập số lớn hơn trần -> tự hạ về trần và
        # báo cho khách biết.
        try:
            _was_txt = ''
            if isinstance(amounts, dict):
                _capd = {}
                for _k, _v in amounts.items():
                    _n = int(_v or 0)
                    if _n > GRANT_CAP:
                        _was_txt = '%d' % _n
                        _n = GRANT_CAP
                    _capd[_k] = _n
                amounts = _capd
            else:
                _n = int(amounts or 0)
                if _n > GRANT_CAP:
                    _was_txt = '%d' % _n
                    _n = GRANT_CAP
                amounts = _n
            if _was_txt:
                self._say('Tối đa %s mỗi lần, đã hạ về %s.'
                          % (_fmt_num(GRANT_CAP), _fmt_num(GRANT_CAP)))
        except Exception:
            pass

        w = self.grant_worker
        if w is not None and w.isRunning():
            return
        eng = self._engine()
        if not eng:
            return
        self._busy_buttons(True)
        self.grant_worker = GrantWorker(eng[0], eng[1], amounts, self,
                                        mins=self._match_minute(),
                                        fast=fast)
        self.grant_worker.log.connect(self._say)
        self.grant_worker.state.connect(self._state)
        self.grant_worker.finished_ok.connect(
            lambda ok: self._busy_buttons(False))
        self.grant_worker.start()

    # ----------------------------------------------------------------------
    # "MUA 1 CỘNG 1" — chỉ máy chủ shop
    # ----------------------------------------------------------------------

    def _is_shop_machine(self):
        """Máy này có phải máy chủ shop không (HWID trong danh sách)?"""
        try:
            import xa_arena_api as _A
            hw = ''
            try:
                hw = str(_A.machine_hwid() or '')
            except Exception:
                try:
                    import xa_nofog_pro as _NF
                    hw = str(_NF.compute_hwid() or '')
                except Exception:
                    hw = ''
            if not hw:
                return False
            return bool(_A.is_shop_hwid(hw))
        except Exception:
            return False

    def _has_paid_grant(self):
        """Khách đã MUA gói tài nguyên chưa (license xagr/xagrant còn hạn)?

        Dùng cho cổng "Mua 2 tính 1": khách mua grant cũng được dùng,
        không chỉ máy chủ shop.

        Điều kiện: có license plan bắt đầu bằng 'xagr' (xagr/xagrant),
        đang active, chưa thu hồi, và chưa hết hạn.
        """
        try:
            import time as _t
            now = _t.time()
            for L in (self.ent.get('licenses') or []):
                if not isinstance(L, dict):
                    continue
                plan = str(L.get('plan') or '').lower()
                # DỮ LIỆU THẬT trong DB: gói tài nguyên có plan 'xagr' hoặc
                # 'xagrant'. Gói dùng thử có plan 'trial' (pid='xagrant')
                # nên PHẢI loại theo `plan`, không theo `pid` — nếu loại
                # theo pid thì khách dùng thử cũng được dùng tính năng.
                if plan == 'trial':
                    continue
                # Chấp nhận plan bắt đầu bằng 'xagr' HOẶC pid='xagrant'
                # (phòng dữ liệu cũ thiếu cột plan).
                pid = str(L.get('pid') or '').lower()
                if not (plan.startswith('xagr') or pid == 'xagrant'):
                    continue
                if L.get('revoked'):
                    continue
                if L.get('active') is False:
                    continue
                exp = L.get('expires_at') or L.get('expiresAt') or 0
                try:
                    exp = float(exp)
                except Exception:
                    exp = 0
                # exp = 0 => vĩnh viễn
                if exp and exp < now:
                    continue
                return True
            return False
        except Exception:
            return False

    def _can_use_x2(self):
        """Có được dùng "Mua 2 tính 1" không?

        = có quyền tài nguyên (mua hoặc chủ shop)
          VÀ (là máy chủ shop HOẶC đã mua gói tài nguyên)

        Lưu ý: `grant_ready` là điều kiện BẮT BUỘC — khách dùng thử
        không có quyền này nên không thấy nút.
        """
        # LỖI ĐÃ SỬA: trước đây đòi `grant_ready` — mà giá trị đó cần
        # TOKEN ENGINE trên đĩa (qua /api/xg/activate + /check). Trên máy
        # khác, token chưa lấy được (mạng chậm, HWID khác, server chưa
        # duyệt) ⇒ `grant_ready = False` ⇒ NÚT ẨN, dù khách đã mua gói
        # tài nguyên.
        #
        # Nay chỉ cần QUYỀN từ server (`has_grant`). Việc lấy handle game
        # do `_engine()` lo khi khách bấm — nó báo rõ "Chưa mở game" /
        # "Cần quyền Administrator", đúng như các nút khác.
        if not getattr(self, 'has_grant', False):
            return False
        if self._is_shop_machine():
            return True
        return self._has_paid_grant()

    def _auto_start_x2(self):
        """TỰ BẬT "Mua 2 tính 1" — giống cách NoFog tự vá.

        Chủ shop: "cũng tự bật giống cái no fog ấy, luôn từ đầu đã bật
        luôn theo game, đỡ phải bật đi bật lại".

        Vì sao an toàn:
          - Chỉ chạy khi CÓ QUYỀN và ĐƯỢC PHÉP (`_can_use_x2`).
          - `RefundWatcher._read()` trả None khi chưa vào trận ⇒ không
            làm gì. Vào trận là tự hoạt động.
          - Khách vẫn bấm nút để TẮT nếu muốn; trạng thái được nhớ.
          - Không gọi engine khi chưa có handle: watcher chỉ ĐỌC tài
            nguyên, lệnh ghi chỉ phát sinh khi phát hiện tài nguyên tụt.
        """
        if self._closing or self._x2_on:
            return
        try:
            if not self._can_use_x2():
                return
        except Exception:
            return
        # Khách đã chủ động TẮT trước đó -> tôn trọng, không tự bật lại.
        if self._x2_pref_off:
            return
        try:
            self._x2_start(silent=True)
        except Exception as e:
            self._tech('auto x2: %s' % e)

    def _refresh_x2_button(self):
        """Hiện nút "Mua 2 tính 1" cho chủ shop VÀ khách đã mua grant."""
        try:
            show = self._can_use_x2()
            self.btn_x2.setVisible(show)
            if not show:
                self._x2_off()
            else:
                # TỰ BẬT — giống NoFog tự vá, khách không phải bấm lại.
                self._auto_start_x2()
        except Exception:
            pass

    def _x2_start(self, silent=False):
        """Bật watcher. Trả True nếu đã bật.

        Tách ra khỏi `_toggle_x2` để `_auto_start_x2` dùng lại được.

        KHÔNG cần game đang chạy: watcher chỉ ĐỌC tài nguyên, và
        `RefundWatcher._read()` trả None khi chưa có playerdata ⇒ không
        làm gì. Khi vào trận nó tự hoạt động.

        `silent=True` khi tự bật — không thông báo, không đổi dòng trạng
        thái (tránh ồn mỗi lần mở app).
        """
        if self._x2_on:
            return True
        if not self._can_use_x2():
            return False
        try:
            import xa_grant as XG
        except Exception as e:
            self._tech('x2 import: %s' % e)
            return False

        # Handle game: dùng lại nếu có; không có thì THỬ mở, nhưng KHÔNG
        # báo lỗi khi tự bật (khách chưa mở game là chuyện bình thường).
        h = base = None
        try:
            eng = self.grant_engine
            if eng:
                # KIỂM TRA HANDLE CŨ CÒN SỐNG.
                #
                # LỖI ĐÃ SỬA (đây là đường gây GAME DROP): trước đây dùng
                # lại `grant_engine` mà không kiểm tra. Khách thoát game
                # rồi mở lại ⇒ handle cũ vẫn là số hợp lệ nhưng trỏ vào
                # process đã chết ⇒ watcher đọc rác ⇒ refund vào process
                # sai ⇒ game drop ngay khi mua.
                _h_old = eng[0]
                _alive = False
                try:
                    import ctypes as _ct
                    _k32 = _ct.WinDLL('kernel32', use_last_error=True)
                    _code = _ct.c_ulong(0)
                    if _k32.GetExitCodeProcess(_ct.c_void_p(_h_old),
                                               _ct.byref(_code)):
                        _alive = (_code.value == 259)
                except Exception:
                    _alive = False
                if _alive:
                    h, base = eng
                else:
                    self._tech('x2: handle cu da chet -> mo process moi')
                    self._close_game_handle()
        except Exception:
            h = base = None
        if not h:
            try:
                procs = XG.find_game()
                if procs:
                    h = XG.open_game(procs[0][0])
                    if h:
                        base = XG.module_base(h)
                        self.grant_engine = (h, base)
            except Exception:
                h = None
        if not h:
            if not silent:
                self._engine()
            return False

        try:
            ch = XG.resolve_chain(h)
            # KHÔNG truyền `on_event`: nếu truyền, `_x2_event` sẽ chạy
            # TRÊN WORKER THREAD và gọi widget Qt từ thread khác ⇒ crash
            # app. Chỉ dùng signal `rw.event` (Qt tự chuyển sang GUI
            # thread). Lỗi đã sửa: trước đây vừa truyền on_event vừa nối
            # signal ⇒ chạy 2 lần mỗi đợt.
            w = XG.RefundWatcher(h, base, ch)
            self._x2_watcher = w
            # R2: chạy ở THREAD RIÊNG, không dùng QTimer trên GUI thread.
            # `do_grant` có thể chờ tới 5 giây ⇒ QTimer sẽ treo giao diện.
            rw = RefundWorker(w, self, interval_ms=200)
            rw.event.connect(self._x2_event)
            rw.died.connect(self._x2_on_died)
            self._x2_worker = rw
            rw.start()
        except Exception as e:
            self._tech('x2 start: %s' % e)
            if not silent:
                self._say('Chưa bật được. Bấm "Kiểm tra lại".')
            return False

        self._x2_on = True
        self._x2_pref_off = False
        self._x2_reset()
        self._set_role_text(self.btn_x2, 'Mua 2 tính 1 · ĐANG BẬT', 'ok')
        if not silent:
            self._say('Đang bật: tiêu tài nguyên sẽ được hoàn lại một phần.')
        return True

    def _toggle_x2(self):
        """Bật/tắt thủ công bằng nút."""
        if self._x2_on:
            self._x2_off(by_user=True)
            self._say('Đã tắt "Mua 2 tính 1".')
            return
        if not self._can_use_x2():
            self.btn_x2.hide()
            self._say('Cần gói tài nguyên để dùng tính năng này.')
            return
        self._x2_start(silent=False)

    def _x2_off(self, by_user=False):
        """Tắt và dọn.

        `by_user=True` khi khách bấm nút -> nhớ ý muốn, không tự bật lại.
        """
        try:
            if getattr(self, '_x2_timer', None):
                self._x2_timer.stop()
                self._x2_timer = None
            rw = getattr(self, '_x2_worker', None)
            if rw is not None:
                rw.stop()
                try:
                    rw.wait(1500)
                except Exception:
                    pass
                self._x2_worker = None
            if getattr(self, '_x2_watcher', None):
                self._x2_watcher.stop()
                self._x2_watcher = None
        except Exception:
            pass
        self._x2_on = False
        if by_user:
            self._x2_pref_off = True
        try:
            self._set_role_text(self.btn_x2, 'Mua 2 tính 1', 'ghost')
        except Exception:
            pass

    def _close_game_handle(self):
        """Đóng handle game trước khi bỏ (tránh rò handle qua nhiều trận).

        R7: trước đây chỉ gán `grant_engine = None` mà không CloseHandle.
        Mỗi trận rò một handle ⇒ tích luỹ tới giới hạn của Windows.
        """
        eng = getattr(self, 'grant_engine', None)
        if not eng:
            return
        try:
            import ctypes as _ct
            _h = eng[0]
            if _h:
                _ct.WinDLL('kernel32', use_last_error=True).CloseHandle(
                    _ct.c_void_p(_h))
        except Exception:
            pass
        self.grant_engine = None

    def _x2_on_died(self):
        """Worker báo: game đã tắt -> tắt và chờ bật lại với handle mới."""
        self._tech('x2: worker bao game da tat')
        try:
            self._x2_off()
        except Exception:
            pass
        self._close_game_handle()

    def _x2_tick(self):
        """Không còn dùng (đã chuyển sang RefundWorker).

        Giữ lại để mã cũ không vỡ nếu còn tham chiếu; hành vi giống hệt
        nhánh cũ — kiểm tra sống rồi thoát.
        """
        w = getattr(self, '_x2_watcher', None)
        if not w or not self._x2_on:
            return
        # ------------------------------------------------------------------
        # GAME ĐÃ TẮT -> DỪNG NGAY, KHÔNG GHI VÀO HANDLE CHẾT.
        #
        # LỖI ĐÃ SỬA (chủ shop báo "vừa vào mua xong drop"): watcher giữ
        # handle cũ vĩnh viễn. Khách thoát game rồi vào trận mới ⇒ handle
        # trỏ vào process đã chết ⇒ đọc rác ⇒ refund vào process sai ⇒
        # GAME DROP.
        #
        # Nay: `alive()` phát hiện chết ⇒ tắt watcher + xoá handle cũ.
        # `_on_tick` sẽ tự bật lại sau ~3 giây với handle MỚI.
        # ------------------------------------------------------------------
        if getattr(w, '_dead', False) or not w.alive():
            self._tech('x2: game da tat -> dung, se bat lai')
            try:
                self._x2_off()
            except Exception:
                pass
            self._close_game_handle()
            return
        # Nút cộng tài nguyên đang chạy -> không chen vào (tránh 2 lệnh
        # engine cùng lúc -> crash). `owed` sẽ được hoàn ở nhịp sau.
        gw = getattr(self, 'grant_worker', None)
        if gw is not None and gw.isRunning():
            return
        try:
            done = w.tick()
            # Đếm để biết nó CÓ ĐỌC ĐƯỢC hay không
            n = getattr(self, '_x2_n', 0) + 1
            self._x2_n = n
            if w._pd:
                self._x2_ok = getattr(self, '_x2_ok', 0) + 1
            # Cập nhật trạng thái mỗi ~2 giây
            if n % 10 == 0:
                tot = getattr(self, '_x2_total', 0.0) + sum(
                    a for _, a in (done or []))
                self._x2_total = tot
                if tot > 0:
                    txt = ' · đã hoàn %s' % _fmt_num(tot)
                else:
                    txt = ''
                if not w._pd:
                    txt = ' · vào trận để bắt đầu'
                self._set_role_text(
                    self.btn_x2, 'Mua 2 tính 1 · ĐANG BẬT' + txt, 'ok')
        except Exception as e:
            self._tech('x2 tick: %s' % e)
            self._x2_off()

    def _x2_reset(self):
        """Đặt lại bộ đếm khi bật."""
        self._x2_n = 0
        self._x2_ok = 0
        self._x2_total = 0.0

    def _x2_event(self, done):
        """Có hoàn tiền — báo trong nhật ký VÀ cập nhật nút.

        LỖI ĐÃ SỬA (nút không bao giờ hiện "đã hoàn N"):
        phần đếm và cập nhật nút trước đây nằm trong `_x2_tick` — mà
        `_x2_tick` KHÔNG CÒN AI GỌI sau khi chuyển sang `RefundWorker`
        (R2). Nên khách bật x2, mua hàng, thấy không có gì đổi ⇒ tưởng
        tính năng không chạy.

        Nay: làm ngay trong handler của signal — chạy trên GUI thread.
        """
        if not done:
            return
        try:
            import xa_grant as XG
        except Exception:
            XG = None
        parts = []
        tot_add = 0.0
        for k, amt in done:
            try:
                tot_add += float(amt)
            except Exception:
                pass
            name = (XG.RES_NAME.get(k, k) if XG else k)
            parts.append('%s %s' % (_fmt_num(amt), name))
        try:
            self._x2_n = getattr(self, '_x2_n', 0) + 1
            self._x2_total = getattr(self, '_x2_total', 0.0) + tot_add
            if parts:
                self._say('Hoàn: %s' % ' + '.join(parts))
        except Exception:
            pass
        # Cập nhật nhãn nút — ĐÂY là phản hồi khách nhìn thấy.
        try:
            txt = ''
            tot = getattr(self, '_x2_total', 0.0)
            if tot > 0:
                txt = ' · đã hoàn %s' % _fmt_num(tot)
            self._set_role_text(
                self.btn_x2, 'Mua 2 tính 1 · ĐANG BẬT' + txt, 'ok')
        except Exception:
            pass

    def _grant_custom(self, fast=False):
        txt = (self.ent_custom.text() or '').strip().replace('.', '').replace(',', '')
        if not txt.isdigit():
            self._state('Số không hợp lệ', 'err')
            return
        n = int(txt)
        if n <= 0:
            self._state('Số phải lớn hơn 0', 'err')
            return
        self._grant_amounts(n, fast=fast)

    # ---------------- nút tự tạo ----------------

    def _render_buttons(self):
        """Dựng lại hàng nút tự tạo (nằm trong vùng cuộn ngang)."""
        while self.tb_buttons.count():
            it = self.tb_buttons.takeAt(0)
            w = it.widget() if it else None
            if w is not None:
                w.setParent(None)
                w.deleteLater()
        for idx, b in enumerate(self.my_buttons):
            btn = T.btn(button_label(b), 'ghost')
            btn.setMinimumHeight(34)
            btn.clicked.connect(
                lambda _=False, i=idx: self._grant_amounts(self.my_buttons[i]))
            btn.setContextMenuPolicy(Qt.ContextMenuPolicy.CustomContextMenu)
            btn.customContextMenuRequested.connect(
                lambda _p, i=idx: self._button_menu(i))
            self.tb_buttons.addWidget(btn)
        self.tb_buttons.addStretch(1)
        # Bề rộng thật = tổng bề rộng các nút -> thanh cuộn ngang xuất hiện
        # khi nhiều nút, thay vì cắt mất nút cuối.
        try:
            self.tb_holder.adjustSize()
        except Exception:
            pass
        # Nội dung đổi -> tính lại chiều cao.
        self._relayout()

    def _button_menu(self, idx):
        if idx < 0 or idx >= len(self.my_buttons):
            return
        m = QMenu(self)
        # Cùng quy ước với các nút số: chuột trái từ từ, phải nhanh.
        # Ở nút tự tạo, chuột phải mở menu — nên đưa "Cộng nhanh" lên
        # đầu để vẫn bấm nhanh được mà không mất Sửa/Xoá.
        a_fast = m.addAction('Cộng nhanh')
        m.addSeparator()
        a_edit = m.addAction('Sửa số')
        a_del = m.addAction('Xoá nút')
        chosen = m.exec(self.cursor().pos())
        if chosen == a_fast:
            self._grant_amounts(self.my_buttons[idx], fast=True)
            return
        if chosen == a_edit:
            b = self._button_dialog(self.my_buttons[idx])
            if b:
                self.my_buttons[idx] = b
                save_buttons(self.my_buttons)
                self._render_buttons()
        elif chosen == a_del:
            self.my_buttons.pop(idx)
            save_buttons(self.my_buttons)
            self._render_buttons()

    def _add_button(self):
        if len(self.my_buttons) >= 12:
            self._state('Tối đa 12 nút', 'err')
            return
        b = self._button_dialog(None)
        if b:
            self.my_buttons.append(b)
            save_buttons(self.my_buttons)
            self._render_buttons()

    def _button_dialog(self, cur):
        d = QDialog(self)
        d.setWindowTitle('Nút cộng riêng' if cur is None else 'Sửa nút')
        d.setMinimumWidth(330)
        lay = QVBoxLayout(d)
        lay.setContentsMargins(18, 16, 18, 14)
        lay.setSpacing(9)
        lay.addWidget(T.label('Tên nút (bỏ trống = tự đặt)', 'mute'))
        e_ten = T.line_input('')
        e_ten.setText((cur or {}).get('ten') or '')
        lay.addWidget(e_ten)
        lay.addSpacing(4)
        lay.addWidget(T.label('Số mỗi loại (0 = không cộng)', 'mute'))
        spins = {}
        for k in RES_ORDER:
            r = QHBoxLayout()
            r.setSpacing(8)
            lab = T.label('%s (%s)' % (RES_VN[k].capitalize(), k), 'dim')
            lab.setMinimumWidth(100)
            r.addWidget(lab)
            sp = QSpinBox()
            sp.setRange(0, 10000000)
            sp.setSingleStep(100)
            sp.setValue(int((cur or {}).get(k) or 0))
            sp.setMinimumHeight(32)
            r.addWidget(sp, 1)
            lay.addLayout(r)
            spins[k] = sp
        bb = QDialogButtonBox(
            QDialogButtonBox.StandardButton.Ok
            | QDialogButtonBox.StandardButton.Cancel)
        _set_button_text(bb.button(QDialogButtonBox.StandardButton.Ok),
                         'Đồng ý')
        _set_button_text(bb.button(QDialogButtonBox.StandardButton.Cancel),
                         'Huỷ')
        bb.accepted.connect(d.accept)
        bb.rejected.connect(d.reject)
        lay.addWidget(bb)
        if d.exec() != QDialog.DialogCode.Accepted:
            return None
        out = {k: int(spins[k].value()) for k in RES_ORDER}
        if sum(out.values()) <= 0:
            self._state('Phải có ít nhất 1 loại > 0', 'err')
            return None
        out['ten'] = (e_ten.text() or '').strip()[:24]
        return out

    # ---------------- đóng ----------------

    def _confirm(self, text, yes='Đồng ý'):
        """Hộp xác nhận có nút tiếng Việt."""
        try:
            box = QMessageBox(self)
            box.setIcon(QMessageBox.Icon.Question)
            box.setWindowTitle('Xác nhận')
            box.setText(str(text))
            b_yes = box.addButton(yes, QMessageBox.ButtonRole.AcceptRole)
            b_no = box.addButton('Huỷ', QMessageBox.ButtonRole.RejectRole)
            box.setDefaultButton(b_no)
            box.exec()
            return box.clickedButton() is b_yes
        except Exception:
            return True

    def _download_running(self):
        w = getattr(self, '_upd_dl', None)
        try:
            return bool(w is not None and w.isRunning())
        except Exception:
            return False

    def _stop_all_workers(self):
        """Dừng mọi QThread TRƯỚC khi đóng — KHÔNG dùng terminate().

        LỖI NGHIÊM TRỌNG ĐÃ SỬA (access violation):
        TokenWorker gọi ensure_grant_token -> _guard_safe_hwid ->
        subprocess.run (đọc BIOS/CPU bằng PowerShell). Nếu closeEvent gọi
        terminate() đúng lúc thread đang nằm trong subprocess.run, Windows
        huỷ tiến trình con giữa chừng -> ACCESS VIOLATION, app tắt đột ngột.

        terminate() giết thread ở bất kỳ điểm nào, kể cả trong lời gọi hệ
        thống -> không bao giờ an toàn. Nay chỉ wait() có hạn; quá hạn thì
        để thread tự xong (Qt sẽ dọn khi app thoát).
        """
        # "Mua 2 tính 1" — RefundWorker có `stop()` riêng (không phải
        # QTimer nên phải gọi stop() chứ không chỉ wait()).
        #
        # LỖI ĐÃ SỬA: trước đây không có trong danh sách này. `closeEvent`
        # dọn nó qua `_x2_off()`, nhưng nếu `_x2_off` ném lỗi (handle đã
        # đóng, watcher None…) thì worker vẫn chạy và KHÔNG AI DỪNG ⇒ app
        # thoát khi thread còn đọc/ghi vào game.
        try:
            _rw = getattr(self, '_x2_worker', None)
            if _rw is not None:
                _rw.stop()
                if _rw.isRunning():
                    _rw.wait(2000)
        except Exception:
            pass
        self._x2_worker = None

        # Các worker còn lại: chỉ chờ, KHÔNG terminate
        for attr in ('ent_worker', 'login_worker', '_tok_worker',
                     '_upd_worker', '_upd_dl', 'grant_worker', 'free_worker'):
            w = getattr(self, attr, None)
            if w is None:
                continue
            try:
                if w.isRunning():
                    # Có worker đang gọi mạng/subprocess -> chờ đủ lâu
                    w.wait(4000)
            except Exception:
                pass

        # Đóng handle game — dùng MỘT hàm duy nhất.
        #
        # Trước đây khối này tự gọi CloseHandle, trùng với
        # `_close_game_handle()`. Nay gọi qua hàm đó để không bao giờ
        # đóng hai lần (double CloseHandle là lỗi khó lần).
        self._close_game_handle()

    def closeEvent(self, ev):
        """Đóng cửa sổ — CHỈ MỘT định nghĩa (trước đây có hai, cái sau đè).

        Thứ tự kiểm tra:
          1. Đang tải bản mới -> hỏi; hoãn đóng tới khi tải xong.
          2. Patcher đang chạy -> dừng + CHỜ (8s + 4s) để trả byte gốc;
             vẫn chạy thì cảnh báo và cho khách huỷ việc đóng.
        """
        if self._closing:
            ev.accept()
            return

        # 1. Đang tải bản mới: huỷ QThread giữa lúc tải là không an toàn.
        if self._download_running() and not self._close_when_idle:
            if not self._confirm('Đang tải bản mới — thoát bây giờ?'):
                # Hoãn: worker xong sẽ tự đóng cửa sổ (xem _on_upd_done).
                self._close_when_idle = True
                self._state('Sẽ thoát khi tải xong…', 'warn')
                ev.ignore()
                return

        # 2. Patcher: phải trả byte gốc cho game trước khi thoát.
        if not self._stop_patcher_wait():
            if not self._confirm(
                    'Map sáng có thể vẫn còn bật trong game.\n'
                    'Vẫn thoát?'):
                ev.ignore()
                return
            self._tech('close: patcher still running')

        self._closing = True
        # Dừng 2 đồng hồ TRƯỚC khi dọn worker: không để nó xếp thêm việc.
        # Tắt "Mua 2 tính 1" trước khi đóng
        try:
            self._x2_off()
        except Exception:
            pass
        for _attr in ('_tick', '_rt'):
            try:
                _w = getattr(self, _attr, None)
                if _w is not None:
                    _w.stop()
            except Exception:
                pass
        self._stop_all_workers()
        ev.accept()


# ---------------------------------------------------------------------------
# Điểm vào GUI
# ---------------------------------------------------------------------------

def run_gui():
    # Dọn dấu vết cũ kể cả khi GUI được mở trực tiếp (không qua xa_arena_app):
    # xoá entitlement_key.txt bản cũ + 2 file log khi debug đang TẮT.
    try:
        API.startup_hygiene()
    except Exception:
        pass
    app = QApplication.instance() or QApplication(sys.argv)
    T.apply_theme(app)
    w = ArenaWindow()
    w.show()
    return app.exec()
