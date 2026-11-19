# -*- coding: utf-8 -*-
"""xa_theme.py — Theme PyQt6 dùng chung cho MỌI GUI của MuaBanKey.

VÌ SAO CÓ FILE NÀY
------------------
Trước đây mỗi tool tự dựng giao diện bằng tkinter với bảng màu riêng, nên:
  - Ba tool trông khác nhau (font, bo góc, màu nhấn, khoảng cách).
  - tkinter không có bo góc, không bóng đổ, không hiệu ứng -> trông cũ.
  - Mỗi lần sửa màu phải sửa 3 file.

Nay: một theme duy nhất (QSS + token), mọi GUI import vào. Sửa một chỗ là
tất cả đổi theo.

CÁCH DÙNG
---------
    from xa_theme import apply_theme, COLORS, title, card, primary_btn, ...
    app = QApplication(sys.argv)
    apply_theme(app)

GHI CHÚ KỸ THUẬT
----------------
- QSS (Qt Style Sheet) giống CSS nhưng chỉ hỗ trợ tập con thuộc tính.
- Không dùng `box-shadow` (QSS không có) -> dùng viền + nền để tạo độ nổi.
- Font: "Segoe UI Variable" có trên Win11, fallback "Segoe UI" (Win7+).
"""

# ---------------------------------------------------------------------------
# Token thiết kế — nguồn sự thật duy nhất
# ---------------------------------------------------------------------------

COLORS = {
    # Nền
    'bg':        '#0d1117',   # nền trang
    'bg_alt':    '#0a0e14',   # nền sâu hơn (ô nhập, log)
    'card':      '#161b22',   # nền thẻ
    'card_alt':  '#1c2129',   # thẻ phụ / hover
    'border':    '#272d36',   # viền thường
    'border_hi': '#3a4250',   # viền khi hover/focus

    # Chữ
    'fg':        '#e6edf3',   # chữ chính
    'fg_dim':    '#9ba7b4',   # chữ phụ
    'fg_mute':   '#6b7785',   # chữ mờ (hint)

    # Nhấn
    'accent':    '#2f81f7',
    'accent_hi': '#4b93ff',
    'accent_lo': '#1f6feb',

    # Trạng thái
    'ok':        '#3fb950',
    'ok_bg':     '#12261a',
    'warn':      '#d29922',
    'warn_bg':   '#2a2113',
    'err':       '#f85149',
    'err_bg':    '#2d1416',
    'info':      '#58a6ff',
    'info_bg':   '#10233d',
}

FONTS = {
    'ui':   'Segoe UI',
    'mono': 'Consolas',
    'size': {
        'h1':   20,
        'h2':   15,
        # h3: tiêu đề trong hộp thoại. Trước đây chỉ có h1/h2 nên
        # label('…', 'h3') rơi vào nhãn thường (không in đậm, không to).
        'h3':   13,
        'body': 10,
        'small': 9,
        'tiny':  8,
        'code': 9,
    },
}

RADIUS = 10
CARD_PAD = 16
GAP = 12


def _qss():
    """Sinh chuỗi QSS từ token."""
    c = COLORS
    f = FONTS
    return f"""
/* ================= NỀN CHUNG ================= */
QWidget {{
    background-color: {c['bg']};
    color: {c['fg']};
    font-family: "{f['ui']}";
    font-size: {f['size']['body']}pt;
}}

QMainWindow, QDialog {{
    background-color: {c['bg']};
}}

/* ================= NHÃN ================= */
QLabel {{
    background: transparent;
}}
QLabel[role="h1"] {{
    font-size: {f['size']['h1']}pt;
    font-weight: 700;
    color: {c['fg']};
}}
QLabel[role="h2"] {{
    font-size: {f['size']['h2']}pt;
    font-weight: 600;
    color: {c['fg']};
}}
QLabel[role="h3"] {{
    font-size: {f['size']['h3']}pt;
    font-weight: 600;
    color: {c['fg']};
}}
QLabel[role="dim"] {{
    color: {c['fg_dim']};
}}
QLabel[role="mute"] {{
    color: {c['fg_mute']};
    font-size: {f['size']['small']}pt;
}}
/* Trạng thái BÌNH THƯỜNG (đang chờ, đang chuẩn bị…): màu trung tính.
   Trước đây 'info' bị map sang màu cảnh báo nên chuyện thường ngày
   trông như có sự cố. */
QLabel[role="neutral"] {{ color: {c['fg']}; }}
QLabel[role="ok"]    {{ color: {c['ok']}; }}
QLabel[role="warn"]  {{ color: {c['warn']}; }}
QLabel[role="err"]   {{ color: {c['err']}; }}
QLabel[role="info"]  {{ color: {c['info']}; }}
QLabel[role="code"] {{
    font-family: "{f['mono']}";
    font-size: {f['size']['code']}pt;
    color: {c['ok']};
    background: {c['bg_alt']};
    border: 1px solid {c['border']};
    border-radius: 8px;
    padding: 10px 12px;
}}

/* ================= THẺ ================= */
QFrame[role="card"] {{
    background-color: {c['card']};
    border: 1px solid {c['border']};
    border-radius: {RADIUS}px;
}}
QFrame[role="cardFlat"] {{
    background-color: {c['card']};
    border: none;
    border-radius: {RADIUS}px;
}}
QFrame[role="banner"] {{
    background-color: {c['info_bg']};
    border: 1px solid {c['accent_lo']};
    border-radius: 8px;
}}
QFrame[role="bannerWarn"] {{
    background-color: {c['warn_bg']};
    border: 1px solid {c['warn']};
    border-radius: 8px;
}}
QFrame[role="bannerErr"] {{
    background-color: {c['err_bg']};
    border: 1px solid {c['err']};
    border-radius: 8px;
}}
QFrame[role="bannerOk"] {{
    background-color: {c['ok_bg']};
    border: 1px solid {c['ok']};
    border-radius: 8px;
}}
QFrame[role="sep"] {{
    background-color: {c['border']};
    border: none;
    max-height: 1px;
    min-height: 1px;
}}

/* ================= Ô NHẬP ================= */
QLineEdit, QPlainTextEdit, QTextEdit {{
    background-color: {c['bg_alt']};
    color: {c['fg']};
    border: 1px solid {c['border']};
    border-radius: 8px;
    padding: 9px 11px;
    selection-background-color: {c['accent_lo']};
    selection-color: #ffffff;
}}
QLineEdit:hover, QPlainTextEdit:hover, QTextEdit:hover {{
    border-color: {c['border_hi']};
}}
QLineEdit:focus, QPlainTextEdit:focus, QTextEdit:focus {{
    border-color: {c['accent']};
    background-color: #0c1219;
}}
QLineEdit:disabled, QPlainTextEdit:disabled {{
    color: {c['fg_mute']};
    background-color: {c['card']};
}}
QLineEdit[role="code"] {{
    font-family: "{f['mono']}";
    font-size: {f['size']['code']}pt;
    color: {c['ok']};
    letter-spacing: 0.5px;
}}

/* ================= NÚT ================= */
QPushButton {{
    background-color: {c['card_alt']};
    color: {c['fg']};
    border: 1px solid {c['border']};
    border-radius: 8px;
    padding: 9px 16px;
    font-weight: 600;
}}
QPushButton:hover {{
    background-color: #242a33;
    border-color: {c['border_hi']};
}}
QPushButton:pressed {{
    background-color: #1a1f26;
}}
QPushButton:disabled {{
    color: {c['fg_mute']};
    background-color: {c['card']};
    border-color: {c['border']};
}}

QPushButton[role="primary"] {{
    background-color: {c['accent']};
    color: #ffffff;
    border: 1px solid {c['accent']};
}}
QPushButton[role="primary"]:hover  {{ background-color: {c['accent_hi']}; }}
QPushButton[role="primary"]:pressed{{ background-color: {c['accent_lo']}; }}
QPushButton[role="primary"]:disabled {{
    background-color: #1d3355;
    color: #7d8ea3;
    border-color: #1d3355;
}}

QPushButton[role="ghost"] {{
    background-color: transparent;
    border: 1px solid {c['border']};
    color: {c['fg_dim']};
}}
QPushButton[role="ghost"]:hover {{
    background-color: {c['card']};
    color: {c['fg']};
    border-color: {c['border_hi']};
}}

QPushButton[role="danger"] {{
    background-color: transparent;
    border: 1px solid {c['err']};
    color: {c['err']};
}}
QPushButton[role="danger"]:hover {{
    background-color: {c['err_bg']};
}}

QPushButton[role="big"] {{
    padding: 12px 20px;
    font-size: {f['size']['h2']}pt;
    border-radius: 9px;
}}

/* Nút chọn nhanh (grid cộng tài nguyên) */
QPushButton[role="tile"] {{
    background-color: {c['card']};
    border: 1px solid {c['border']};
    border-radius: 10px;
    padding: 14px 12px;
    text-align: left;
    font-weight: 600;
}}
QPushButton[role="tile"]:hover {{
    background-color: {c['card_alt']};
    border-color: {c['accent']};
}}
QPushButton[role="tile"]:pressed {{
    background-color: #101a2c;
}}
QPushButton[role="tile"]:disabled {{
    color: {c['fg_mute']};
    border-color: {c['border']};
}}

/* ================= THANH TIẾN TRÌNH ================= */
QProgressBar {{
    background-color: {c['bg_alt']};
    border: 1px solid {c['border']};
    border-radius: 6px;
    height: 10px;
    text-align: center;
    color: transparent;
}}
QProgressBar::chunk {{
    background-color: {c['accent']};
    border-radius: 5px;
}}
QProgressBar[state="ok"]::chunk  {{ background-color: {c['ok']}; }}
QProgressBar[state="err"]::chunk {{ background-color: {c['err']}; }}

/* ================= LOG ================= */
QPlainTextEdit[role="log"] {{
    font-family: "{f['mono']}";
    font-size: {f['size']['tiny']}pt;
    color: {c['fg_dim']};
    background-color: {c['bg_alt']};
    border: 1px solid {c['border']};
    border-radius: 8px;
    padding: 8px 10px;
}}

/* ================= SCROLLBAR ================= */
QScrollBar:vertical {{
    background: transparent;
    width: 10px;
    margin: 0;
}}
QScrollBar::handle:vertical {{
    background: #2c333d;
    border-radius: 5px;
    min-height: 28px;
}}
QScrollBar::handle:vertical:hover {{
    background: #3a4250;
}}
QScrollBar::add-line:vertical,
QScrollBar::sub-line:vertical {{ height: 0; }}
QScrollBar::add-page:vertical,
QScrollBar::sub-page:vertical {{ background: none; }}

QScrollBar:horizontal {{
    background: transparent;
    height: 10px;
    margin: 0;
}}
QScrollBar::handle:horizontal {{
    background: #2c333d;
    border-radius: 5px;
    min-width: 28px;
}}
QScrollBar::add-line:horizontal,
QScrollBar::sub-line:horizontal {{ width: 0; }}

/* ================= TOOLTIP ================= */
QToolTip {{
    background-color: {c['card']};
    color: {c['fg']};
    border: 1px solid {c['border_hi']};
    border-radius: 6px;
    padding: 6px 9px;
}}

/* ================= HỘP THOẠI ================= */
QMessageBox {{
    background-color: {c['card']};
}}
QMessageBox QLabel {{
    color: {c['fg']};
    font-size: {f['size']['body']}pt;
}}
QMessageBox QPushButton {{
    min-width: 88px;
    padding: 7px 14px;
}}

/* ================= CHECKBOX ================= */
QCheckBox {{
    spacing: 8px;
    color: {c['fg_dim']};
}}
QCheckBox::indicator {{
    width: 16px; height: 16px;
    border: 1px solid {c['border_hi']};
    border-radius: 4px;
    background: {c['bg_alt']};
}}
QCheckBox::indicator:checked {{
    background: {c['accent']};
    border-color: {c['accent']};
}}
"""


def apply_theme(app):
    """Áp theme lên QApplication. Gọi ngay sau khi tạo app."""
    try:
        from PyQt6.QtGui import QFont
        f = QFont(FONTS['ui'], FONTS['size']['body'])
        # Có font biến thiên trên Win11 thì đẹp hơn
        try:
            from PyQt6.QtGui import QFontDatabase
            fams = QFontDatabase.families()
            for cand in ('Segoe UI Variable Text', 'Segoe UI Variable',
                         'Segoe UI'):
                if cand in fams:
                    f = QFont(cand, FONTS['size']['body'])
                    break
        except Exception:
            pass
        f.setHintingPreference(QFont.HintingPreference.PreferDefaultHinting)
        app.setFont(f)
    except Exception:
        pass
    app.setStyleSheet(_qss())
    return app


# ---------------------------------------------------------------------------
# Hàm dựng widget — dùng lại để mọi tool giống nhau
# ---------------------------------------------------------------------------

def label(text, role=None, wrap=False, selectable=False):
    from PyQt6.QtCore import Qt
    from PyQt6.QtWidgets import QLabel
    w = QLabel(text)
    if role:
        w.setProperty('role', role)
    if wrap:
        w.setWordWrap(True)
    if selectable:
        w.setTextInteractionFlags(
            Qt.TextInteractionFlag.TextSelectableByMouse
            | Qt.TextInteractionFlag.TextSelectableByKeyboard)
    return w


def card(role='card'):
    from PyQt6.QtWidgets import QFrame
    w = QFrame()
    w.setProperty('role', role)
    return w


def sep():
    from PyQt6.QtWidgets import QFrame
    w = QFrame()
    w.setProperty('role', 'sep')
    w.setFixedHeight(1)
    return w


def btn(text, role='', big=False, on_click=None, tooltip=None):
    from PyQt6.QtWidgets import QPushButton
    w = QPushButton(text)
    roles = [r for r in (role, 'big' if big else '') if r]
    if roles:
        # QSS chỉ khớp được MỘT property -> nối bằng dấu cách, QSS dùng
        # selector [role~="x"]; ở đây ta đặt role chính, big xử lý bằng size
        w.setProperty('role', role or '')
    if big:
        w.setMinimumHeight(46)
        f = w.font()
        f.setPointSize(FONTS['size']['h2'])
        f.setBold(True)
        w.setFont(f)
    if on_click:
        w.clicked.connect(on_click)
    if tooltip:
        w.setToolTip(tooltip)
    w.setCursor(__import__('PyQt6.QtCore', fromlist=['Qt']).Qt
                .CursorShape.PointingHandCursor)
    return w


def line_input(placeholder='', code=False, mono=False):
    from PyQt6.QtWidgets import QLineEdit
    w = QLineEdit()
    w.setPlaceholderText(placeholder)
    if code:
        w.setProperty('role', 'code')
        f = w.font()
        f.setFamily(FONTS['mono'])
        w.setFont(f)
    elif mono:
        f = w.font()
        f.setFamily(FONTS['mono'])
        w.setFont(f)
    w.setMinimumHeight(38)
    return w


def log_view():
    from PyQt6.QtWidgets import QPlainTextEdit
    w = QPlainTextEdit()
    w.setProperty('role', 'log')
    w.setReadOnly(True)
    w.setMaximumBlockCount(3000)   # chặn phình bộ nhớ
    f = w.font()
    f.setFamily(FONTS['mono'])
    f.setPointSize(FONTS['size']['tiny'])
    w.setFont(f)
    return w


def progress():
    from PyQt6.QtWidgets import QProgressBar
    w = QProgressBar()
    w.setTextVisible(False)
    w.setFixedHeight(10)
    w.setRange(0, 100)
    w.setValue(0)
    return w


def hbox(parent=None, gap=0, margins=None):
    from PyQt6.QtWidgets import QHBoxLayout
    lay = QHBoxLayout(parent) if parent is not None else QHBoxLayout()
    lay.setSpacing(gap)
    if margins is not None:
        lay.setContentsMargins(*margins)
    return lay


def vbox(parent=None, gap=0, margins=None):
    from PyQt6.QtWidgets import QVBoxLayout
    lay = QVBoxLayout(parent) if parent is not None else QVBoxLayout()
    lay.setSpacing(gap)
    if margins is not None:
        lay.setContentsMargins(*margins)
    return lay


def banner(text, kind='info'):
    """Dải thông báo màu, có icon ký tự."""
    from PyQt6.QtWidgets import QFrame, QHBoxLayout
    icons = {'info': 'i', 'warn': '!', 'err': '×', 'ok': '✓'}
    roles = {'info': 'banner', 'warn': 'bannerWarn',
             'err': 'bannerErr', 'ok': 'bannerOk'}
    f = QFrame()
    f.setProperty('role', roles.get(kind, 'banner'))
    lay = QHBoxLayout(f)
    lay.setContentsMargins(12, 10, 12, 10)
    lay.setSpacing(9)
    ico = label(icons.get(kind, 'i'), 'h2')
    ico.setFixedWidth(16)
    lay.addWidget(ico)
    body = label(text, 'dim', wrap=True)
    body.setWordWrap(True)
    lay.addWidget(body, 1)
    f._body = body
    return f


def center_on_screen(win):
    """Đặt cửa sổ giữa màn hình đang có con trỏ."""
    try:
        from PyQt6.QtGui import QCursor
        from PyQt6.QtWidgets import QApplication
        scr = QApplication.screenAt(QCursor.pos()) or QApplication.primaryScreen()
        if not scr:
            return
        g = scr.availableGeometry()
        fg = win.frameGeometry()
        fg.moveCenter(g.center())
        win.move(fg.topLeft())
    except Exception:
        pass


def set_dark_titlebar(win):
    """Bật thanh tiêu đề tối trên Windows 10/11 (DWM)."""
    try:
        import ctypes
        win.setAttribute(__import__('PyQt6.QtCore', fromlist=['Qt'])
                         .Qt.WidgetAttribute.WA_NativeWindow, True)
        hwnd = int(win.winId())
        dwm = ctypes.windll.dwmapi
        # DWMWA_USE_IMMERSIVE_DARK_MODE: 20 trên Win10 2004+, 19 trước đó
        for attr in (20, 19):
            val = ctypes.c_int(1)
            r = dwm.DwmSetWindowAttribute(
                hwnd, attr, ctypes.byref(val), ctypes.sizeof(val))
            if r == 0:
                break
    except Exception:
        pass
