"""
Cau hinh XARENA MAP SÁNG
======================

Sua MỌI thứ ở đây, KHÔNG cần chạm vào xa_nofog_pro.py.

Sau khi sua, build lai EXE:
    cd tool
    powershell -File build.ps1

Hoac chay truc tiep khong can build:
    python tool\\src\\xa_nofog_pro.py --status
"""

# ---------------------------------------------------------------------------
# 1. SERVER LICENSE
# ---------------------------------------------------------------------------
# URL worker cua ban. Doi sang ten mien rieng neu co.
API_BASE = 'https://xienhl.com'

# Ten hien thi trong tieu de cua so console va User-Agent
APP_NAME = 'XARENA MAP SÁNG'


# ---------------------------------------------------------------------------
# 2. GAME
# ---------------------------------------------------------------------------
# Ten cac file EXE cua game (khong phan biet hoa thuong)
PROCESS_NAMES = (
    'EMPIRESX.EXE',
    'EMPIRESX_HD.EXE',
    'EMPIRESX_HDR.EXE',
)

# Dia chi base ua thich cua module game
PREFERRED_BASE = 0x400000

# Chu ky kiem tra game (giay) khi chay thuong tru
RESIDENT_POLL = 2.0


# ---------------------------------------------------------------------------
# 3. LICENSE
# ---------------------------------------------------------------------------
# Thoi han theo ten goi (chi de tham khao -- server quyet dinh)
TERMS = {'TUAN': 7, 'THANG': 30, 'NAM': 365, 'VINHVIEN': 0}

# Cho phep dong ho may chay lech bao nhieu giay truoc khi coi la chinh lui
CLOCK_SKEW_TOLERANCE = 2 * 3600

# Thu muc luu state license (tuong doi voi %LOCALAPPDATA%)
STATE_SUBDIR = 'XArenaNoFog'

# Khoa registry luu moc thoi gian chong chinh dong ho
REG_KEY = r'Software\Microsoft\Windows\CurrentVersion\XASupport'


# ---------------------------------------------------------------------------
# 4. MUTEX (chi mot ban chay cung luc)
# ---------------------------------------------------------------------------
MUTEX_NAME = r'Global\XArenaNoFogPro'


# ---------------------------------------------------------------------------
# 5. KET NOI
# ---------------------------------------------------------------------------
HTTP_TIMEOUT = 10


# ---------------------------------------------------------------------------
# 6. MA THOAT
# ---------------------------------------------------------------------------
EXIT_NOT_ADMIN = 5
EXIT_NO_LICENSE = 3
EXIT_ALREADY_RUNNING = 4
EXIT_TRIAL_END = 6


# ---------------------------------------------------------------------------
# 7. DUNG THU -- 2 loai: 1 GIO va 3 NGAY
# ---------------------------------------------------------------------------
# Bat/tat tinh nang dung thu
TRIAL_ENABLED = True

# BAT BUOC dang nhap: server tra 401 login_required neu chua dang nhap
TRIAL_REQUIRE_ACCOUNT = True

# Goi 1 gio
TRIAL_1H_MINUTES = 60          # do dai (phut)
TRIAL_1H_LIMIT = 10            # so luot / tai khoan
TRIAL_1H_RECHECK = 120         # kiem server moi 2 phut

# Goi 3 ngay
TRIAL_3D_DAYS = 3              # do dai (ngay)
TRIAL_3D_LIMIT = 10            # so luot / tai khoan
TRIAL_3D_RECHECK = 900         # kiem server moi 15 phut

# Goi mac dinh khi khach chay khong tham so
TRIAL_DEFAULT_KIND = '3d'

# Canh bao khi con bao nhieu giay (1 gio) / ngay (3 ngay)
TRIAL_WARN_SEC_1H = 600        # con 10 phut
TRIAL_WARN_DAYS_3D = 1         # con 1 ngay

# Trial KHONG co offline grace: phai co mang moi lan chay
TRIAL_GRACE_HOURS = 0

# Khi dang chay thuong tru, kiem lai server moi bao nhieu giay
# (server co the tra recheck rieng, day la mac dinh)
TRIAL_RECHECK_SEC = 300

# Trang mua hang -- in ra khi het han / het luot
BUY_URL = 'https://xienhl.com/#/product/license-xarena-thang'

# Trang dang nhap -- in ra khi chua dang nhap
LOGIN_URL = 'https://xienhl.com/#/login'


# ---------------------------------------------------------------------------
# 8. BAT BUOC ONLINE
# ---------------------------------------------------------------------------
# True  = moi lan chay phai xac minh duoc voi server (khong co offline grace)
# False = cho phep chay offline trong GRACE_HOURS
#
# Khach mat mang se KHONG dung duoc tool. Bui lai: khong the chan hosts
# file / rut mang de chay lau.
REQUIRE_ONLINE = True
