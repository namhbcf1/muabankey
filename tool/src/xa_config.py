"""
Cau hinh XArena No Fog
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
APP_NAME = 'XArena No Fog'


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
# 7. DUNG THU 3 NGAY -- tu dong, gan theo HWID
# ---------------------------------------------------------------------------
# Bat/tat tinh nang dung thu. Khach chua co key -> tu dong bat trial.
TRIAL_ENABLED = True

# So ngay dung thu (server cung co cau hinh rieng, day chi de hien thi)
TRIAL_DAYS = 3

# Trial KHONG co offline grace: phai co mang moi lan chay.
# Neu cho grace, chi can rut mang la 3 ngay thanh 4-5 ngay.
TRIAL_GRACE_HOURS = 0

# Nhac nho khi con <= bao nhieu ngay
TRIAL_WARN_DAYS = 1

# Khi dang chay thuong tru, kiem lai server moi bao nhieu giay
TRIAL_RECHECK_SEC = 1800

# Trang mua hang -- in ra khi het han
BUY_URL = 'https://xienhl.com/#/product/license-xarena-thang'


# ---------------------------------------------------------------------------
# 8. BAT BUOC ONLINE
# ---------------------------------------------------------------------------
# True  = moi lan chay phai xac minh duoc voi server (khong co offline grace)
# False = cho phep chay offline trong GRACE_HOURS
#
# Khach mat mang se KHONG dung duoc tool. Bui lai: khong the chan hosts
# file / rut mang de chay lau.
REQUIRE_ONLINE = True
