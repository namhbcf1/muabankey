# -*- coding: utf-8 -*-
"""xa_arena_api.py — Gọi server để biết QUYỀN của khách.

Tách riêng khỏi GUI để test được không cần PyQt6.

Đường dẫn tuyệt đối tới server lấy từ xa_nofog_pro.API_BASE để chỉ có
MỘT nguồn sự thật.
"""

import base64
import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request

TIMEOUT = 15

# Tên cookie phiên của server (src/lib/auth.js: SESSION_COOKIE).
# Phải khớp CHÍNH XÁC, nếu không server không thấy session.
SESSION_COOKIE_NAME = 'mbk_session'


# ---------------------------------------------------------------------------
# MÃ LỖI -> CÂU HƯỚNG DẪN KẾ TIẾP (tiếng Việt, không lộ chi tiết kỹ thuật)
#
# VÌ SAO: giao diện từng hiện "Map sáng: <câu lỗi của server>" rồi khuyên
# "bấm Đăng nhập hoặc Key để kích hoạt lại" — đúng cái vừa thất bại, nên
# khách bấm mãi mà không đi đâu. Nay mỗi mã lỗi có một bước tiếp theo cụ thể.
# ---------------------------------------------------------------------------

NEXT_STEP = {
    'trial_only':
        'Mã dùng thử: mở lại app và bấm "Nhập key" để kích hoạt',
    'hwid_mismatch':
        'Mã đã gắn máy khác. Vào xienhl.com → License của tôi → Đổi máy',
    # ------------------------------------------------------------------
    # GÓI ĐÃ MUA = THEO TÀI KHOẢN · GÓI DÙNG THỬ = THEO MÁY.
    #
    # Chủ shop: "mua rồi thì không theo HW nữa mà là theo tài khoản luôn
    # ... mua rồi thì đổi máy nào cũng được nhưng mà kiểm soát là chỉ 1
    # nick 1 máy 1 thời điểm". Nên server trả `session_moved` khi tài
    # khoản đang mở ở MÁY KHÁC: máy này bị đá ra và phải đăng nhập lại để
    # lấy máy về. App KHÔNG tự thử lại liên tục (làm vậy là giành máy với
    # máy kia, hai bên đá nhau mãi).
    # ------------------------------------------------------------------
    'session_moved':
        'Tài khoản đang được dùng ở máy khác. Bấm "Đăng nhập lại" để lấy '
        'lại máy này.',
    'no_licence':
        'Tài khoản này chưa có gói nào. Vào xienhl.com để mua gói.',
    'revoked':
        'Mã đã bị thu hồi. Liên hệ hỗ trợ.',
    'expired':
        'Mã đã hết hạn. Mua/gia hạn tại xienhl.com',
    'trial_exhausted':
        'Máy bạn đã dùng hết lượt dùng thử. Vui lòng mua key để tiếp tục — '
        'vào xienhl.com, chọn gói và thanh toán.',
    'trial_expired':
        'Lượt dùng thử 1 giờ đã hết. Bấm "Thử MAP SÁNG" trên xienhl.com '
        'để lấy mã mới (mỗi máy còn nhiều lượt), hoặc mua key để dùng lâu dài.',
    'network':
        'Không kết nối được máy chủ. Kiểm tra mạng rồi bấm "Kiểm tra lại".',
    'offline_grace_expired':
        'Không kết nối được máy chủ quá lâu. Mở mạng rồi bấm "Kiểm tra lại".',
    # ------------------------------------------------------------------
    # MÃ KHÔNG TỒN TẠI — trường hợp rất hay gặp.
    #
    # LỖI ĐÃ SỬA: mã sai/không tồn tại không có câu hướng dẫn nên rơi vào
    # thông báo chung "License chưa dùng được trên máy này", khách không
    # biết là mình nhập sai. Thực tế hay nhầm ký tự khi đọc/chụp:
    #   8 ↔ B   0 ↔ O   1 ↔ I/l   5 ↔ S   6 ↔ b
    # ------------------------------------------------------------------
    'not_found':
        'Mã này không tồn tại. Kiểm tra lại từng ký tự — hay nhầm '
        '8 với B, 0 với O, 1 với I, 5 với S. Hoặc lấy mã mới trên xienhl.com',
    'TRIAL_NOT_FOUND':
        'Mã dùng thử không đúng. Kiểm tra lại — hay nhầm 8 với B, 0 với O, '
        '1 với I. Hoặc bấm "Thử MAP SÁNG" trên xienhl.com để lấy mã mới',
    'TRIAL_EXPIRED':
        'Lượt dùng thử đã hết. Bấm "Thử MAP SÁNG" trên xienhl.com '
        'để lấy mã mới (mỗi máy còn nhiều lượt)',
    'TRIAL_REVOKED':
        'Mã dùng thử đã bị thu hồi. Bấm "Thử MAP SÁNG" trên xienhl.com '
        'để lấy mã mới',
    'WRONG_PRODUCT':
        'Mã này của sản phẩm khác. Kiểm tra bạn mua Map sáng hay Tài nguyên',
    'REVOKED':
        'Mã đã bị thu hồi. Liên hệ hỗ trợ.',
    'EXPIRED':
        'Mã đã hết hạn. Mua/gia hạn tại xienhl.com',
    # ------------------------------------------------------------------
    # CÁC MÃ SERVER THẬT SỰ GỬI MÀ TRƯỚC ĐÂY KHÔNG CÓ TRONG BẢNG.
    #
    # Đo trên production: /api/trial/claim trả `trial_quota_exhausted`
    # (không phải `trial_exhausted`), và các route giới hạn trả
    # `trial_ip_limit` / `trial_global_limit`. Thiếu tên → khách chỉ thấy
    # câu chung "chưa lấy được quyền map sáng trên máy này".
    # ------------------------------------------------------------------
    'trial_quota_exhausted':
        'Máy bạn đã dùng hết lượt dùng thử. Vui lòng mua key để tiếp tục — '
        'vào xienhl.com, chọn gói và thanh toán.',
    'trial_device_limit':
        'Máy này đã dùng hết lượt dùng thử. Vui lòng mua key để tiếp tục — '
        'vào xienhl.com, chọn gói và thanh toán.',
    'trial_ip_limit':
        'Kết nối/mạng này đã dùng hết lượt dùng thử hôm nay. '
        'Thử lại vào ngày mai, hoặc mua key tại xienhl.com để dùng ngay.',
    'trial_net_limit':
        'Mạng này đã dùng hết lượt dùng thử hôm nay. '
        'Thử lại vào ngày mai, hoặc mua key tại xienhl.com.',
    'trial_global_limit':
        'Hệ thống đã hết lượt dùng thử hôm nay. Thử lại vào ngày mai, '
        'hoặc mua key tại xienhl.com.',
    'trial_banned':
        'Thiết bị này không được dùng thử. Vui lòng mua key tại xienhl.com.',
    'trial_disabled':
        'Dùng thử đang tạm đóng. Vui lòng mua key tại xienhl.com.',
    'not_trial':
        'Đây là key trả phí, không phải mã dùng thử. Bấm "Nhập key" và dán '
        'đúng key đã mua.',
    'rate_limit':
        'Bạn thao tác quá nhanh. Chờ khoảng 1 phút rồi bấm "Kiểm tra lại".',
    'http_4xx':
        'Máy chủ trả lỗi tạm thời. Thử lại sau ít phút.',
    'http_5xx':
        'Máy chủ đang bảo trì. Thử lại sau ít phút.',
}

# Nhãn trạng thái ngắn (dòng ● trên giao diện).
STATE_TEXT = {
    'trial_only': 'Mã dùng thử chưa kích hoạt',
    'hwid_mismatch': 'License gắn máy khác',
    # Gói đã mua theo TÀI KHOẢN: dòng ● phải nói đúng "máy khác đang dùng",
    # không nói "License gắn máy khác" (gói mua không gắn máy nữa).
    'session_moved': 'Tài khoản đang dùng ở máy khác',
    'no_licence': 'Tài khoản chưa có gói',
    'revoked': 'License bị thu hồi',
    'expired': 'License đã hết hạn',
    'trial_exhausted': 'Đã hết lượt dùng thử',
    'trial_expired': 'Đã hết lượt dùng thử',
    'network': 'Không kết nối được máy chủ',
    'offline_grace_expired': 'License chưa xác thực được',
    'not_found': 'Mã không tồn tại',
    'TRIAL_NOT_FOUND': 'Mã dùng thử không đúng',
    'TRIAL_EXPIRED': 'Đã hết lượt dùng thử',
    'TRIAL_REVOKED': 'Mã dùng thử bị thu hồi',
    'WRONG_PRODUCT': 'Mã của sản phẩm khác',
    'REVOKED': 'License bị thu hồi',
    'EXPIRED': 'License đã hết hạn',
    'trial_quota_exhausted': 'Máy đã hết lượt dùng thử',
    'trial_device_limit': 'Máy đã hết lượt dùng thử',
    'trial_ip_limit': 'Mạng này đã hết lượt dùng thử',
    'trial_net_limit': 'Mạng này đã hết lượt dùng thử',
    'trial_global_limit': 'Hệ thống đã hết lượt dùng thử',
    'trial_banned': 'Thiết bị không được dùng thử',
    'trial_disabled': 'Dùng thử đang tạm đóng',
    'not_trial': 'Đây là key trả phí',
    'rate_limit': 'Thao tác quá nhanh',
    'http_4xx': 'Máy chủ trả lỗi tạm thời',
    'http_5xx': 'Máy chủ đang bảo trì',
}

# ----------------------------------------------------------------------
# CHUẨN HOÁ KHOÁ BẢNG TRA CỨU VỀ CHỮ THƯỜNG.
#
# LỖI ĐÃ SỬA (lớp lỗi bao trùm): error_code_of() luôn trả chữ THƯỜNG, còn
# hai bảng dưới có cả khoá CHỮ HOA. Mọi mã chữ hoa (NOT_FOUND,
# TRIAL_NOT_FOUND, WRONG_PRODUCT, REVOKED, EXPIRED) đều KHÔNG khớp →
# rơi vào câu chung "License chưa dùng được trên máy này".
#
# Chuẩn hoá một lần ở đây là hết cả lớp lỗi này, và mọi `TABLE[code]`
# sau này cũng an toàn.
# ----------------------------------------------------------------------
NEXT_STEP = {k.lower(): v for k, v in NEXT_STEP.items()}
STATE_TEXT = {k.lower(): v for k, v in STATE_TEXT.items()}

_LAST_CODE = ''


def set_last_code(code):
    """Nhớ mã lỗi gần nhất để GUI chọn câu hướng dẫn đúng nguyên nhân."""
    global _LAST_CODE
    _LAST_CODE = str(code or '')


def last_error_code():
    return _LAST_CODE


def error_code_of(text):
    """Rút mã lỗi từ thông điệp server.

    Chấp nhận:
      'code:expired|...'  (định dạng của xa_nofog_pro.check_online)
      'expired'           (mã trần)
      ''                  (không có -> '')

    Trả '' khi không nhận ra. KHÔNG đoán bừa: nhờ vậy thông báo mặc định
    luôn trung tính thay vì đổ lỗi "máy khác".
    """
    s = str(text or '').strip()
    if not s:
        return ''
    low = s.lower()
    i = low.find('code:')
    if i >= 0:
        rest = s[i + 5:]
        for sep in ('|', ' ', '\n', '\t', ','):
            j = rest.find(sep)
            if j > 0:
                rest = rest[:j]
        rest = rest.strip().lower()
        if rest:
            return rest
    # ------------------------------------------------------------------
    # SO KHỚP KHÔNG PHÂN BIỆT HOA/THƯỜNG.
    #
    # LỖI ĐÃ SỬA: hàm này luôn trả CHỮ THƯỜNG (`low`), nhưng NEXT_STEP có
    # cả khoá CHỮ HOA (TRIAL_NOT_FOUND, WRONG_PRODUCT, REVOKED, ...).
    # Vì vậy mọi mã lỗi chữ hoa đều KHÔNG khớp → next_step_for() trả ''
    # → GUI rơi vào câu chung "License chưa dùng được trên máy này".
    #
    # Đây chính là lý do khách nhập mã sai mà app không nói được là mã sai.
    # ------------------------------------------------------------------
    for table in (NEXT_STEP, STATE_TEXT):
        for k in table:
            if k.lower() == low:
                return low

    # Nhận diện theo từ khoá — cả mã lẫn câu tiếng Việt của server.
    # `session_moved` / `no_licence` đứng ĐẦU: hai trạng thái mới của mô
    # hình "gói mua theo tài khoản", phải nhận ra trước mọi từ khoá khác.
    for key in ('session_moved', 'no_licence', 'no_license',
                'trial_not_found', 'trial_expired', 'trial_revoked',
                'wrong_product', 'trial_only', 'hwid_mismatch',
                'trial_exhausted', 'trial_quota_exhausted',
                'not_found', 'revoked', 'expired', 'account_locked'):
        if key in low:
            return key

    # ------------------------------------------------------------------
    # Câu tiếng Việt server trả (khi không có mã).
    #
    # THỨ TỰ QUAN TRỌNG — xét cụ thể trước, chung sau:
    #   "Mã dùng thử không đúng hoặc đã hết hạn" chứa cả 'không đúng' và
    #   'hết hạn'. Nếu xét 'hết hạn' trước sẽ phân loại nhầm thành key trả
    #   phí hết hạn → khách bị khuyên "mua/gia hạn" thay vì "lấy mã mới".
    # ------------------------------------------------------------------
    if 'không tồn tại' in low or 'khong ton tai' in low:
        return 'not_found'
    # Giới hạn theo mạng/IP phải xét TRƯỚC 'dùng thử' — câu của server là
    # "Kết nối này đã dùng hết lượt dùng thử hôm nay", chứa cả hai.
    if ('kết nối này' in low or 'mạng này' in low
            or 'hệ thống đã' in low or 'hệ thống đạt' in low):
        return 'trial_ip_limit'
    if 'dùng thử' in low or 'dung thu' in low:
        # Mã dùng thử: phân biệt tiếp
        # "Đã dùng hết 3 lượt" / "hết lượt" -> HẾT LƯỢT (mua key),
        # không phải "mã sai". Xét 'lượt' trước 'đã hết'.
        if 'lượt' in low or 'luot' in low:
            return 'trial_quota_exhausted'
        if 'đã hết' in low or 'da het' in low:
            return 'trial_expired'
        if 'thu hồi' in low or 'thu hoi' in low:
            return 'trial_revoked'
        return 'trial_not_found'
    if 'hết lượt' in low or 'het luot' in low:
        return 'trial_exhausted'
    if 'hết hạn' in low or 'het han' in low:
        return 'expired'
    if 'thu hồi' in low or 'thu hoi' in low:
        return 'revoked'
    # ------------------------------------------------------------------
    # BỊ ĐÁ SANG MÁY KHÁC — PHẢI XÉT TRƯỚC 'máy khác'.
    #
    # Câu của server là "Tài khoản đang được dùng ở máy khác", chứa cả
    # 'máy khác'. Xét sau sẽ phân loại thành `hwid_mismatch` (gói gắn máy)
    # và khuyên khách "Đổi máy" — sai hẳn: gói đã mua KHÔNG gắn máy nữa,
    # việc cần làm là đăng nhập lại để giành máy về.
    # ------------------------------------------------------------------
    if (('tài khoản' in low or 'tai khoan' in low)
            and ('máy khác' in low or 'may khac' in low
                 or 'đăng nhập' in low or 'dang nhap' in low
                 or 'nơi khác' in low or 'noi khac' in low)):
        return 'session_moved'
    if ('chưa có gói' in low or 'chua co goi' in low
            or 'chưa có license' in low or 'chua co license' in low
            or 'chưa có licence' in low or 'chua co licence' in low
            or 'không có license' in low or 'khong co license' in low
            or 'không có gói' in low or 'khong co goi' in low):
        return 'no_licence'
    if 'máy khác' in low or 'may khac' in low:
        return 'hwid_mismatch'
    if ('sản phẩm khác' in low or 'san pham khac' in low
            or 'không dùng cho' in low or 'khong dung cho' in low
            or 'mã tăng tài nguyên' in low):
        return 'wrong_product'
    if ('network' in low or 'urlopen' in low or 'timed out' in low
            or 'getaddrinfo' in low or 'connection' in low
            or 'không gọi được server' in low or 'mạng' in low):
        return 'network'
    return ''


def next_step_for(text):
    """Câu hướng dẫn kế tiếp cho một mã lỗi/câu lỗi. '' nếu không rõ.

    Tra theo khoá KHỚP (không phân biệt hoa/thường) chứ không theo `code`,
    vì bảng có cả khoá chữ HOA còn error_code_of() trả chữ thường.
    """
    code = error_code_of(text)
    if not code:
        return ''
    if code in NEXT_STEP:
        return NEXT_STEP[code]
    low = code.lower()
    for k, v in NEXT_STEP.items():
        if k.lower() == low:
            return v
    return ''


def state_text_for(text):
    """Nhãn trạng thái ngắn cho một mã lỗi. Mặc định trung tính."""
    code = error_code_of(text)
    return STATE_TEXT.get(code, 'License không còn hiệu lực')


# ---------------------------------------------------------------------------
# Cấu hình
# ---------------------------------------------------------------------------

def api_base():
    """URL server. Ưu tiên hằng số của tool NoFog."""
    try:
        import xa_nofog_pro as NF
        b = getattr(NF, 'API_BASE', '')
        if b:
            return b.rstrip('/')
    except Exception:
        pass
    return 'https://xienhl.com'


def state_dir():
    """Thư mục lưu trạng thái app (dùng chung với NoFog)."""
    base = os.environ.get('LOCALAPPDATA') or os.environ.get('TEMP') or '.'
    d = os.path.join(base, 'XArenaNoFog')
    try:
        os.makedirs(d, exist_ok=True)
    except Exception:
        d = os.path.join(base, 'XAArena')
        try:
            os.makedirs(d, exist_ok=True)
        except Exception:
            pass
    return d


def _ent_file():
    return os.path.join(state_dir(), 'entitlement.json')


# ---------------------------------------------------------------------------
# KHÔNG CÒN FILE KEY DẠNG PLAINTEXT
#
# Trước đây: %LOCALAPPDATA%\XArenaNoFog\entitlement_key.txt — key licence
# nguyên bản, mở bằng Notepad là đọc được. Nhưng key ĐÃ nằm trong state
# ĐÃ MÃ HOÁ DPAPI trên máy:
#     lic.bin  (NoFog)   -> state['key'] / xn_token
#     token.bin (XAGrant)-> payload 'k'
# nên file phụ này vừa THỪA vừa là dấu vết không được để lại.
#
# Nay: key "dán tay" chỉ giữ trong RAM của phiên chạy; đọc lại thì lấy từ
# token DPAPI đã có. File cũ trên máy khách bị XOÁ lúc khởi động
# (startup_hygiene).
# ---------------------------------------------------------------------------

_LEGACY_KEY_FILE = 'entitlement_key.txt'
_MANUAL_KEY = ''          # key đã dán — CHỈ trong RAM, không ghi đĩa


def _ent_key_file():
    """Đường dẫn file key CŨ. Chỉ dùng để XOÁ — không bao giờ ghi vào."""
    return os.path.join(state_dir(), _LEGACY_KEY_FILE)


# ---------------------------------------------------------------------------
# Lưu / đọc quyền gần nhất (dùng khi mất mạng)
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# entitlement.json ĐƯỢC MÃ HOÁ DPAPI.
#
# LỖI ĐÃ SỬA: file này chứa TOÀN BỘ key bản quyền dạng PLAINTEXT (đo được
# 9 key + username trong 3089 B). Ai đọc được file là lấy được hết key —
# lỗ hổng lớn hơn cả file `entitlement_key.txt` (đã bỏ).
#
# Nay: dùng đúng DPAPI mà module nofog đã dùng cho lic.bin. Ghi nhị phân
# có tiền tố `XAENT1:`. Vẫn ĐỌC ĐƯỢC file JSON cũ để không mất dữ liệu
# của máy đã cài trước đó.
# ---------------------------------------------------------------------------
_ENT_MAGIC = b'XAENT1:'


def _ent_crypt(data, encrypt=True):
    """Mã hoá/giải mã bằng DPAPI. Trả bytes hoặc None nếu không làm được."""
    try:
        import xa_nofog_pro as _NF
        fn = getattr(_NF, '_dpapi_encrypt', None) if encrypt else \
            getattr(_NF, '_dpapi_decrypt', None)
        if fn is None:
            return None
        return fn(data)
    except Exception:
        return None


def save_entitlement(data):
    """Lưu quyền gần nhất (ĐÃ MÃ HOÁ) để mất mạng vẫn biết hiện gì."""
    try:
        raw = json.dumps(data or {}, ensure_ascii=False).encode('utf-8')
        enc = _ent_crypt(raw, encrypt=True)
        if enc:
            with open(_ent_file(), 'wb') as f:
                f.write(_ENT_MAGIC + enc)
        else:
            # Không mã hoá được (máy lạ) -> KHÔNG ghi plaintext nữa.
            # Thà mất cache còn hơn để lộ key.
            return False
        return True
    except Exception:
        return False


def load_entitlement():
    """Đọc quyền đã lưu. {} nếu chưa có. Đọc được cả định dạng cũ."""
    try:
        with open(_ent_file(), 'rb') as f:
            blob = f.read()
    except Exception:
        return {}
    # Định dạng mới: DPAPI
    if blob[:len(_ENT_MAGIC)] == _ENT_MAGIC:
        dec = _ent_crypt(blob[len(_ENT_MAGIC):], encrypt=False)
        if not dec:
            return {}
        try:
            d = json.loads(dec.decode('utf-8'))
            return d if isinstance(d, dict) else {}
        except Exception:
            return {}
    # Định dạng CŨ (JSON thô) — đọc được, và lần ghi sau sẽ tự mã hoá.
    try:
        d = json.loads(blob.decode('utf-8', 'replace'))
        return d if isinstance(d, dict) else {}
    except Exception:
        return {}


def _nofog_state_key():
    """Key nằm trong state DPAPI của NoFog (lic.bin). '' nếu chưa có.

    Bộ cài ghi `state['key']`; phiên bản cũ hơn chỉ có xn_token.
    """
    try:
        import xa_nofog_pro as NF
        k = str((NF.load_state() or {}).get('key') or '').strip()
        return k
    except Exception:
        return ''


def _grant_token_key():
    """Key nằm trong token DPAPI của XAGrant (token.bin). '' nếu chưa có.

    Ba bước, từ chắc tới rộng — mục đích là KHÔNG mất key khi token đã hết
    hạn (trước đây file plaintext luôn còn key nên không được kém hơn):
        1. verify_token   — chữ ký + hạn + app đều đúng
        2. parse_token    — chữ ký đúng nhưng có thể đã hết hạn
        3. đọc payload    — chỉ để lấy lại key của CHÍNH máy này
    """
    try:
        XG = _load_grant_module()
        if XG is None:
            return ''
        tok = XG.read_token()
        if not tok:
            return ''
        sec = XG._sec
        pub = XG._pubkey() or (0, 0)
        try:
            r = sec.verify_token(tok, pub, app='xagrant', hwid=None)
            if r.get('ok'):
                k = str(r.get('key') or '').strip()
                if k:
                    return k
        except Exception:
            pass
        try:
            k = str((sec.parse_token(tok, pub) or {}).get('k') or '').strip()
            if k:
                return k
        except Exception:
            pass
        # Cuối cùng: đọc thẳng phần payload (token do server cấp, đã nằm
        # trong file DPAPI của chính user này).
        parts = str(tok).split('.')
        if len(parts) >= 2:
            body = parts[1]
            body += '=' * (-len(body) % 4)
            k = str((json.loads(base64.urlsafe_b64decode(body)) or {})
                    .get('k') or '').strip()
            if k:
                return k
        return ''
    except Exception:
        return ''


def save_manual_key(key):
    """Nhớ key khách đã dán — CHỈ TRONG RAM.

    KHÔNG ghi ra đĩa (xem khối chú thích phía trên). Key vẫn còn dùng được
    ở lần chạy sau vì nó đã nằm trong token DPAPI.
    """
    global _MANUAL_KEY
    k = str(key or '').strip()
    if not k:
        return False
    _MANUAL_KEY = k
    return True


def load_manual_key():
    """Key đã nhớ: RAM trước, sau đó lấy từ token DPAPI trên máy.

    Thứ tự fallback (đều ĐỌC ĐĨA ĐÃ MÃ HOÁ, không có plaintext):
        1. RAM của phiên này
        2. state['key'] của lic.bin      (bộ cài ghi)
        3. xn_token của lic.bin
        4. payload 'k' của token.bin     (XAGrant)
    '' nếu máy chưa có key nào.
    """
    if _MANUAL_KEY:
        return _MANUAL_KEY
    for fn in (_nofog_state_key, local_token_key, _grant_token_key):
        try:
            k = fn()
        except Exception:
            k = ''
        if k:
            return k
    return ''


def clear_manual_key():
    """Quên key đã dán + xoá file plaintext của bản cũ nếu còn sót."""
    global _MANUAL_KEY
    _MANUAL_KEY = ''
    try:
        os.remove(_ent_key_file())
    except Exception:
        pass


# ---------------------------------------------------------------------------
# VẾT KỸ THUẬT TRÊN MÁY — MỘT CÔNG TẮC DUY NHẤT
#
# Cần log để tìm lỗi thật (đã dùng để bắt vài lỗi), nhưng KHÔNG được để lại
# file chứa HWID / key / token / địa chỉ trên máy khách.
#
# LUẬT:
#   - Chỉ ghi khi XA_DEBUG=1 (biến môi trường) HOẶC cờ --debug-log.
#   - Tắt  : hàm ghi là no-op; file cũ bị xoá lúc khởi động.
#   - Bật  : ghi vào %TEMP%, tối đa 64 KB (vượt thì bỏ nửa đầu), và che
#            key / token / HWID / địa chỉ (0x...) trước khi ghi.
# ---------------------------------------------------------------------------

DEBUG_ENV = 'XA_DEBUG'
DEBUG_FLAG = '--debug-log'
LOG_MAX_BYTES = 64 * 1024
LOG_DETAIL = 'arena_detail.log'
LOG_UPDATE = 'arena_update.log'
LOG_FILES = (LOG_DETAIL, LOG_UPDATE)

_DEBUG_ON = False


def debug_on():
    """Đang bật ghi vết kỹ thuật?"""
    if _DEBUG_ON:
        return True
    try:
        return str(os.environ.get(DEBUG_ENV) or '').strip().lower() in (
            '1', 'true', 'yes', 'on')
    except Exception:
        return False


def set_debug(on=True):
    """Bật/tắt bằng cờ --debug-log. XA_DEBUG=1 vẫn luôn thắng."""
    global _DEBUG_ON
    _DEBUG_ON = bool(on)
    return debug_on()


_RX_TOKEN = re.compile(r'\b(?:xn1|xg1)\.[A-Za-z0-9_\-=.]+')
_RX_KEY = re.compile(r'\b(?:TR|AOE1|XAGR)(?:[\s\-]+[A-Za-z0-9]{2,12}){2,4}\b')
_RX_ADDR = re.compile(r'\b0x[0-9A-Fa-f]{3,16}\b')
_RX_HEX = re.compile(r'\b[0-9A-Fa-f]{20,}\b')
_RX_VA = re.compile(r'\bVA\b\s*[=:]?\s*', re.I)


def scrub(text):
    """Che thông tin nhạy cảm trong MỘT dòng vết trước khi ghi đĩa.

    Che: token xn1./xg1., key TR-/AOE1-/XAGR-, địa chỉ 0x..., chuỗi hex dài
    (HWID, hash) và nhãn VA. Không cố "che thông minh" — che hết là an toàn.
    """
    s = str(text or '')
    for rx, rep in ((_RX_TOKEN, '[token]'), (_RX_KEY, '[key]'),
                    (_RX_ADDR, '[addr]'), (_RX_HEX, '[hash]')):
        try:
            s = rx.sub(rep, s)
        except Exception:
            pass
    try:
        s = _RX_VA.sub('', s)
    except Exception:
        pass
    return s


def log_path(name):
    """Đường dẫn file vết trong %TEMP%."""
    base = (os.environ.get('TEMP') or os.environ.get('LOCALAPPDATA') or '.')
    return os.path.join(base, name)


def debug_log(name, msg):
    """Ghi một dòng vết kỹ thuật (đã scrub, đã cắt độ dài).

    No-op tuyệt đối khi tắt debug. Không bao giờ raise.
    """
    if not debug_on():
        return False
    try:
        p = log_path(name)
        line = '[%s] %s\n' % (time.strftime('%Y-%m-%d %H:%M:%S'),
                              scrub(msg)[:400])
        # Giữ file nhỏ: vượt 64 KB thì bỏ nửa đầu, giữ nửa cuối (cắt theo
        # dòng để dòng đầu không bị cụt giữa chừng).
        try:
            if os.path.getsize(p) > LOG_MAX_BYTES:
                with open(p, 'r', encoding='utf-8', errors='ignore') as f:
                    tail = f.read()[-LOG_MAX_BYTES // 2:]
                nl = tail.find('\n')
                if 0 <= nl < len(tail) - 1:
                    tail = tail[nl + 1:]
                with open(p, 'w', encoding='utf-8') as f:
                    f.write(tail)
        except Exception:
            pass
        with open(p, 'a', encoding='utf-8') as f:
            f.write(line)
        return True
    except Exception:
        return False


def cleanup_logs():
    """Xoá vết kỹ thuật cũ — CHỈ khi đang TẮT debug. Trả số file đã xoá."""
    if debug_on():
        return 0
    n = 0
    for name in LOG_FILES:
        try:
            os.remove(log_path(name))
            n += 1
        except Exception:
            pass
    return n


def purge_legacy_key_file():
    """Xoá file key plaintext của bản cũ. True nếu vừa xoá.

    KHÔNG gọi state_dir() (hàm đó tạo thư mục): chạy `--version` cũng không
    được sinh thêm thư mục rỗng trên máy khách.
    """
    base = (os.environ.get('LOCALAPPDATA') or os.environ.get('TEMP') or '.')
    removed = False
    for name in ('XArenaNoFog', 'XAArena'):
        try:
            p = os.path.join(base, name, _LEGACY_KEY_FILE)
            if os.path.exists(p):
                os.remove(p)
                removed = True
        except Exception:
            pass
    return removed


def startup_hygiene():
    """Dọn dấu vết trên máy — gọi MỘT lần lúc khởi động.

    Làm 2 việc, đều không ảnh hưởng quyền/license:
      - xoá entitlement_key.txt (key plaintext của bản cũ)
      - xoá arena_detail.log / arena_update.log khi KHÔNG bật debug
    """
    out = {'key_file_removed': False, 'logs_removed': 0}
    try:
        out['key_file_removed'] = purge_legacy_key_file()
    except Exception:
        pass
    try:
        out['logs_removed'] = cleanup_logs()
    except Exception:
        pass
    return out


# ---------------------------------------------------------------------------
# Gọi server
# ---------------------------------------------------------------------------

def _cookie_header(token):
    """Tạo header Cookie ĐÚNG ĐỊNH DẠNG.

    LỖI ĐÃ SỬA: trước đây gửi thẳng token trần ('Cookie: abc123') nên
    server (đọc cookie theo tên 'mbk_session') không thấy phiên.
    Token có thể đã có sẵn 'ten=' hoặc không — chuẩn hoá cả hai.
    """
    t = str(token or '').strip()
    if not t:
        return ''
    if '=' in t.split(';')[0]:
        return t                      # đã có tên, giữ nguyên
    return '%s=%s' % (SESSION_COOKIE_NAME, t)


def _get_json(path, cookie=None, timeout=TIMEOUT):
    """GET JSON. Trả dict; lỗi -> {'ok': False, 'code': 'network', ...}."""
    url = api_base() + path
    req = urllib.request.Request(url, headers={'User-Agent': 'ya-arena'})
    ch = _cookie_header(cookie)
    if ch:
        req.add_header('Cookie', ch)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read().decode('utf-8', 'ignore')
            d = json.loads(raw) if raw.strip() else {}
            return d if isinstance(d, dict) else {'ok': False}
    except urllib.error.HTTPError as e:
        try:
            raw = e.read().decode('utf-8', 'ignore')
            d = json.loads(raw) if raw.strip() else {}
            if isinstance(d, dict):
                d.setdefault('ok', False)
                return d
        except Exception:
            pass
        return {'ok': False, 'code': 'http_%d' % e.code}
    except Exception as e:
        return {'ok': False, 'code': 'network', 'msg': str(e)[:120]}


def local_token_key():
    """Key đang kích hoạt CỤC BỘ trên máy này (đọc từ token đã lưu).

    Dùng để gộp vào danh sách license khi đăng nhập — nếu không, màn hình
    sẽ mâu thuẫn: khối chức năng hiện (token còn tốt) mà LICENSE báo
    "Sai máy" (license của tài khoản bind máy khác).

    '' nếu không đọc được.
    """
    try:
        import xa_nofog_pro as NF
        st = NF.load_state() or {}
        tok = str(st.get('xn_token') or '')
        if not tok.startswith('xn1.'):
            return ''
        # Token có 3 phần: xn1.<payload>.<signature>
        # LỖI ĐÃ SỬA: split('.', 1) lấy cả "payload.signature" -> decode lỗi.
        parts = tok.split('.')
        if len(parts) < 2:
            return ''
        body = parts[1]
        # Padding: độ dài base64 phải chia hết cho 4
        pad = (-len(body)) % 4
        if pad:
            body += '=' * pad
        payload = json.loads(base64.urlsafe_b64decode(body))
        return str(payload.get('k') or '').strip()
    except Exception:
        return ''


def session_cookie():
    """Cookie phiên đã lưu (nếu khách từng đăng nhập)."""
    try:
        import xa_nofog_pro as NF
        for name in ('load_session', 'read_session'):
            fn = getattr(NF, name, None)
            if not fn:
                continue
            v = fn()
            if isinstance(v, tuple) and v:
                tok = v[0] or ''
            elif isinstance(v, str):
                tok = v
            else:
                continue
            tok = str(tok or '').strip()
            if tok:
                return tok
        return ''
    except Exception:
        pass
    return ''


def fetch_entitlement(key=None):
    """Hỏi quyền.

    key=None -> dùng session (đã đăng nhập) hoặc key đã nhớ
    key=XXX  -> hỏi đúng key đó

    Trả dict đã chuẩn hoá:
      { ok, via, features:[], hasNofog, hasGrant, licenses:[], user }
    """
    ck = session_cookie()

    # ------------------------------------------------------------------
    # THỨ TỰ ƯU TIÊN — session TRƯỚC, key sau.
    #
    # LỖI ĐÃ SỬA: trước đây nếu đã lưu key (từ lần dán key trước) thì code
    # luôn hỏi bằng key, kể cả khi đã đăng nhập. Hậu quả: server trả
    # via='key' và user=None, nên giao diện KHÔNG hiện tên tài khoản dù
    # khách đã đăng nhập, và quyền chỉ tính cho MỘT key thay vì tất cả
    # license của tài khoản.
    # ------------------------------------------------------------------
    if not key:
        if not ck:
            # Chưa đăng nhập -> mới dùng key đã nhớ
            key = load_manual_key()

    # Gửi HWID của máy để server biết license có bind ĐÚNG máy này không.
    # Thiếu nó thì server không phân biệt được "đã bind máy khác" với
    # "bind máy này" -> app hiện hạn của license không dùng được.
    # Gửi CẢ HAI HWID: hai module tính ra hai giá trị khác nhau trên cùng
    # một máy. License map sáng bind bằng HWID #1, license tài nguyên bind
    # bằng HWID #2. Gửi một cái thì nửa số license bị coi là "sai máy".
    hw1 = _hwid_for('nofog')
    hw2 = _hwid_for('grant')
    _parts = []
    if hw1:
        _parts.append('hwid=' + urllib.parse.quote(hw1))
    if hw2 and hw2 != hw1:
        _parts.append('hwid2=' + urllib.parse.quote(hw2))
    qs = ('?' + '&'.join(_parts)) if _parts else ''

    # ------------------------------------------------------------------
    # ĐỒNG BỘ KEY: STATE (bộ cài ghi) THẮNG MANUAL_KEY (app ghi trước đó).
    #
    # LỖI ĐÃ SỬA: khách cài lại bằng key MỚI, bộ cài ghi state['key'] mới,
    # nhưng app vẫn còn manual_key của lần trước. App hỏi quyền bằng key CŨ
    # trong khi token trên máy là của key MỚI → không khớp → hiện
    # "chưa lấy được quyền map sáng trên máy này" dù vừa cài xong.
    #
    # Nay: nếu state có key khác thì lấy key trong state và cập nhật lại
    # manual_key cho lần sau.
    # ------------------------------------------------------------------
    try:
        _stk = local_token_key()
        _mkey = load_manual_key()
        if _stk and _stk != _mkey:
            key = _stk
            save_manual_key(_stk)
    except Exception:
        pass

    if not key:
        # ------------------------------------------------------------------
        # KHÔNG ĐĂNG NHẬP + CHƯA CÓ KEY -> DÙNG KEY TRONG TOKEN CỤC BỘ.
        #
        # LỖI ĐÃ SỬA: khách cài bằng mã dùng thử (bộ cài chạy
        # `xa_arena.exe --trial-key`) rồi mở app thì app không biết key
        # nào để hỏi quyền, nên hiện "Cần đăng nhập hoặc dán key" và ẩn
        # cả hai khối — khách tưởng cài đặt hỏng.
        #
        # Nay: mượn key từ token đã có trên máy.
        # ------------------------------------------------------------------
        try:
            _lk = local_token_key()
            if _lk:
                key = _lk
                save_manual_key(_lk)
        except Exception:
            pass

    # Hỏi bằng PHIÊN (không phải bằng key dán tay)? Quyết định cách đọc mã
    # lỗi: cùng `not_found` nhưng nghĩa khác hẳn nhau (xem account_code_of).
    by_session = bool(ck) and not key

    if key:
        q = ('/api/entitlement?key=' + urllib.parse.quote(str(key).strip())
             + (('&' + '&'.join(_parts)) if _parts else ''))
        d = _get_json(q, cookie=ck)
    else:
        d = _get_json('/api/entitlement' + qs, cookie=ck)

    if not d.get('ok'):
        # ------------------------------------------------------------------
        # LỖI KHI HỎI QUYỀN.
        #
        # `code` được quy đổi theo NGỮ CẢNH: hỏi bằng phiên mà server nói
        # `not_found` thì nghĩa là "tài khoản chưa có gói nào", KHÔNG phải
        # "khách gõ sai mã" -> câu hướng dẫn phải khác (no_licence).
        # ------------------------------------------------------------------
        code = str(d.get('code') or '')
        if by_session:
            code = account_code_of(code)
        d = dict(d)
        d['code'] = code or 'network'
        set_last_code(d['code'])

        # BỊ ĐÁ SANG MÁY KHÁC: KHÔNG được lấy bản lưu cũ ra dùng — bản lưu
        # đó nói "còn quyền", đúng cái phải chặn.
        if d['code'] == 'session_moved':
            return d

        # Mất mạng / chưa đăng nhập -> dùng bản lưu gần nhất
        cached = load_entitlement()
        if cached and cached.get('ok'):
            cached = dict(cached)
            cached['_cached'] = True
            return cached
        return d

    d = _normalise(d)
    set_last_code('')
    # Liên lạc thành công với server = mốc để tính ân hạn offline.
    try:
        _save_last_check(nofog_key_of(d) or grant_key_of(d))
    except Exception:
        pass

    # ------------------------------------------------------------------
    # GỘP QUYỀN CỦA KEY ĐANG KÍCH HOẠT CỤC BỘ.
    #
    # Khi đăng nhập, server chỉ trả license của TÀI KHOẢN. Nhưng máy có
    # thể đang có token của một key khác (khách dán key trước đó, hoặc
    # key mua hộ). Token đó vẫn hoạt động -> khối chức năng hiện, trong
    # khi LICENSE báo "Sai máy" -> mâu thuẫn.
    #
    # Nay lấy thêm quyền của key cục bộ rồi gộp, để hai phần khớp nhau.
    #
    # KHÔNG gộp khi máy này đã bị đá sang máy khác: gộp sẽ trả lại quyền
    # cho một máy không còn được dùng tài khoản.
    # ------------------------------------------------------------------
    if d.get('via') == 'session' and not session_moved(d):
        lk = local_token_key()
        have = {str(L.get('key') or '') for L in (d.get('licenses') or [])}
        if lk and lk not in have:
            try:
                extra = _get_json(
                    '/api/entitlement?key=' + urllib.parse.quote(lk)
                    + (('&' + '&'.join(_parts)) if _parts else ''),
                    cookie=ck)
                if extra.get('ok'):
                    ex = _normalise(extra)
                    # GỘP THEO KEY — tránh trùng lặp.
                    merged = {str(L.get('key') or ''): L
                              for L in (d.get('licenses') or [])}
                    for L in (ex.get('licenses') or []):
                        k2 = str(L.get('key') or '')
                        if k2 and k2 not in merged:
                            merged[k2] = L
                    d['licenses'] = list(merged.values())

                    feats = set(d.get('features') or [])
                    for f in (ex.get('features') or []):
                        feats.add(f)
                    d['features'] = [f for f in ('grant', 'nofog')
                                     if f in feats]
                    d['hasNofog'] = 'nofog' in d['features']
                    d['hasGrant'] = 'grant' in d['features']

                    # --------------------------------------------------
                    # KEY CỤC BỘ ĐÃ BỊ THU HỒI -> XOÁ TOKEN ĐI.
                    #
                    # Token ký hạn dài nên vẫn "dùng được" cục bộ dù key
                    # đã bị thu hồi. Giữ lại thì app tiếp tục vá -> thất
                    # thoát. Nay xoá token ngay khi server nói revoked.
                    # --------------------------------------------------
                    for L in (ex.get('licenses') or []):
                        if str(L.get('key') or '') == lk and L.get('revoked'):
                            try:
                                import xa_nofog_pro as _NF
                                stt = _NF.load_state() or {}
                                stt.pop('xn_token', None)
                                stt.pop('sites', None)
                                _NF.save_state(stt)
                            except Exception:
                                pass
                            break
            except Exception:
                pass

    save_entitlement(d)
    return d


def clean_key(text):
    """Chuẩn hoá key khách dán vào về dạng TR-XXXX-XXXX-XXXX.

    LỖI ĐÃ SỬA: khách copy key từ web rất hay dính dấu cách thay gạch,
    gạch dài (en-dash), hoặc chữ bao quanh ("Mã: TR-..."). Trước đây app
    chỉ .strip() nên gửi nguyên chuỗi lên server -> 404 "không tồn tại"
    -> khách tưởng shop bán key sai.

    Trả '' nếu không nhận ra key.
    """
    import re as _re
    t = str(text or '')

    # NFKC: chữ full-width (copy từ Zalo/ảnh) -> chữ thường
    try:
        import unicodedata as _ud
        t = _ud.normalize('NFKC', t)
    except Exception:
        pass

    # Gạch các loại -> gạch thường
    for d in ('\u2010', '\u2011', '\u2012', '\u2013', '\u2014',
              '\u2015', '\u2212', '\uff0d', '_'):
        t = t.replace(d, '-')
    # Ký tự vô hình
    t = _re.sub('[\u200b\u200c\u200d\ufeff]', '', t)
    # Khoảng trắng Unicode (kể cả non-breaking) -> dấu cách
    t = _re.sub('[\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]',
                ' ', t)
    t = t.strip().upper()

    # Lấy từ tiền tố key trở đi (bỏ số điện thoại đứng trước)
    m_pre = _re.search(r'(TR|AOE1|XAGR)[\s\-]*[A-Z0-9]', t)
    if m_pre and m_pre.start() > 0:
        t = t[m_pre.start():]

    # Tách cụm giống key nếu có chữ bao quanh
    cand = _re.findall(r'(?:TR|AOE1|XAGR)[A-Z0-9\s\-]{6,40}', t)
    if cand:
        t = max(cand, key=len).strip()

    # Dấu cách -> gạch
    t = _re.sub(r'\s+', '-', t.strip())
    t = _re.sub(r'-{2,}', '-', t).strip('-')

    # Dạng không gạch: bỏ hết ký tự ngăn rồi chèn lại nhóm 4.
    flat = _re.sub(r'[^A-Z0-9]', '', t)
    m = _re.fullmatch(r'(TR|AOE1|XAGR)([A-Z0-9]{12,14})', flat)
    if m:
        g = m.group(2)
        t = '%s-%s-%s-%s' % (m.group(1), g[0:4], g[4:8], g[8:12])

    # Chỉ giữ 4 nhóm đầu (bỏ đuôi chữ khách gõ kèm)
    parts = [x for x in t.split('-') if x]
    if len(parts) > 4:
        t = '-'.join(parts[:4])

    if _re.fullmatch(r'[A-Z0-9]{2,12}(?:-[A-Z0-9]{2,12}){2,4}', t):
        return t
    return ''


def fetch_by_key(key):
    """Hỏi quyền của MỘT key (không cần đăng nhập)."""
    hw1 = _hwid_for('nofog')
    hw2 = _hwid_for('grant')
    _p2 = []
    if hw1:
        _p2.append('hwid=' + urllib.parse.quote(hw1))
    if hw2 and hw2 != hw1:
        _p2.append('hwid2=' + urllib.parse.quote(hw2))
    _k = clean_key(key) or str(key).strip()
    q2 = '/api/entitlement?key=' + urllib.parse.quote(_k)
    if _p2:
        q2 += '&' + '&'.join(_p2)
    d = _get_json(q2)
    if d.get('ok'):
        d = _normalise(d)
        set_last_code('')
        save_entitlement(d)
        save_manual_key(_k)
        # Mốc liên lạc thành công -> tính ân hạn offline cho server_recheck.
        try:
            _save_last_check(nofog_key_of(d) or grant_key_of(d) or key)
        except Exception:
            pass
    else:
        set_last_code(d.get('code') or 'network')
    return d


def start_account_trial(timeout=25):
    """Bắt đầu/tiếp tục lượt dùng thử THEO TÀI KHOẢN.

    Chủ shop chốt: mỗi tài khoản mới được 1 NGÀY, bật CẢ map sáng và tài
    nguyên, KHÔNG phải nhập mã. Đồng hồ chạy từ lần đầu mở app.

    Server trả 2 token đã ký (xn1. cho map sáng, xg1. cho tài nguyên) cùng
    hạn. Hàm này lưu cả hai vào state để các worker khác dùng ngay, không
    phải gọi lại server.

    Trả dict:
      ok       : True nếu có quyền dùng
      state    : ok | login_required | used_before | device_limit | banned
                 | expired | offline | no_hw | error
      left_sec : số giây còn lại
      msg      : câu tiếng Việt cho khách
    """
    out = {'ok': False, 'state': 'error', 'left_sec': 0,
           'expires_at': 0, 'msg': ''}

    try:
        import xa_nofog_pro as NF
    except Exception:
        out['msg'] = 'Không nạp được module mạng.'
        return out

    # ---- 1. Phải có phiên đăng nhập ----
    try:
        ck = session_cookie()
    except Exception:
        ck = ''
    if not ck:
        out.update({'state': 'login_required',
                    'msg': 'Đăng nhập để dùng thử miễn phí 1 ngày.'})
        return out

    # ---- 2. Đọc phần cứng ----
    try:
        parts = NF._hwid_parts()
        okp, why = NF._hwid_parts_check(parts)
        if not okp:
            out.update({'state': 'no_hw',
                        'msg': 'Không đọc được thông tin máy. Thử chạy lại app.'})
            return out
    except Exception:
        out.update({'state': 'no_hw',
                    'msg': 'Không đọc được thông tin máy. Thử chạy lại app.'})
        return out

    guid, bios, cpu, vol = [str(x or '') for x in parts]

    # ---- 3. Gọi server ----
    r = NF._post('/api/trial/session', {
        'guid': guid, 'bios': bios, 'cpu': cpu, 'vol': vol,
        'app': 'xa-arena', 'ver': NF.CLIENT_VERSION,
    }, timeout=timeout, retries=1, cookie=ck)

    if not r.get('ok'):
        code = str(r.get('code') or '').lower()
        msg = str(r.get('msg') or '')

        if code == 'login_required':
            out.update({'state': 'login_required',
                        'msg': 'Phiên đăng nhập đã hết. Đăng nhập lại.'})
        elif code in ('trial_used_before',):
            out.update({'state': 'used_before',
                        'msg': 'Tài khoản này đã dùng thử rồi. Mua license để tiếp tục.'})
        elif code in ('trial_device_limit',):
            out.update({'state': 'device_limit', 'msg': msg or
                        'Máy này đã dùng thử cho nhiều tài khoản khác.'})
        elif code in ('trial_banned', 'trial_denied_device'):
            out.update({'state': 'banned', 'msg': msg or 'Thiết bị không được dùng thử.'})
        elif code in ('trial_expired',):
            out.update({'state': 'expired',
                        'msg': msg or 'Lượt dùng thử đã kết thúc. Mua license để tiếp tục.'})
        elif code in ('trial_disabled', 'rate_limit'):
            out.update({'state': 'offline', 'msg': msg or 'Dùng thử đang tạm đóng.'})
        elif code in ('network', 'timeout', ''):
            out.update({'state': 'offline',
                        'msg': 'Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.'})
        else:
            out.update({'state': 'error', 'msg': msg or code or 'Không bật được dùng thử.'})
        return out

    # ---- 4. Lưu token map sáng vào state ----
    no = r.get('nofog') or {}
    gr = r.get('grant') or {}
    exp = int(r.get('expires_at') or 0)
    started = int(r.get('started_at') or 0)

    if no.get('token'):
        try:
            st = NF.load_state()
            NF.anchor_server_time(st, r.get('now'))
            st.update({
                'key': no.get('key') or '',
                'hwid': no.get('hwid') or '',
                'xn_token': no['token'],
                'expires_at': exp,
                'activated_at': started,
                'plan': 'trial',
                'is_trial': True,
                'grace_hours': 0,
                'last_ok': time.time(),
                'mode': 'server',
            })
            NF.save_state(st)
        except Exception as e:
            out.update({'state': 'error', 'msg': 'Không lưu được quyền: %s' % str(e)[:60]})
            return out

    # ---- 5. Lưu token tài nguyên ----
    if gr.get('token'):
        try:
            import xa_grant as XG
            XG.write_token(gr['token'])
        except Exception:
            # Không lưu được token tài nguyên thì map sáng vẫn chạy;
            # lần sau sẽ xin lại. Không chặn toàn bộ.
            pass

    out.update({
        'ok': True,
        'state': 'ok',
        'left_sec': int(r.get('left_sec') or 0),
        'expires_at': exp,
        'started_at': started,
        'msg': '',
        'has_nofog': bool(no.get('token')),
        'has_grant': bool(gr.get('token')),
    })
    return out


def fetch_account_token(timeout=25):
    """Lấy token theo QUYỀN CỦA TÀI KHOẢN (đã mua hoặc đang dùng thử).

    MÔ HÌNH MỚI: không còn key. App chỉ cần đăng nhập, server biết tài khoản
    có quyền gì và ký token tương ứng.

    Trả dict giống start_account_trial().
    """
    out = {'ok': False, 'state': 'error', 'left_sec': 0,
           'expires_at': 0, 'msg': ''}

    try:
        import xa_nofog_pro as NF
    except Exception:
        out['msg'] = 'Không nạp được module mạng.'
        return out

    try:
        ck = session_cookie()
    except Exception:
        ck = ''
    if not ck:
        out.update({'state': 'login_required', 'msg': 'Đăng nhập để sử dụng app.'})
        return out

    # ---- Đọc phần cứng ----
    try:
        parts = NF._hwid_parts()
        okp, _why = NF._hwid_parts_check(parts)
        if not okp:
            out.update({'state': 'no_hw',
                        'msg': 'Không đọc được thông tin máy. Thử chạy lại app.'})
            return out
    except Exception:
        out.update({'state': 'no_hw',
                    'msg': 'Không đọc được thông tin máy. Thử chạy lại app.'})
        return out

    guid, bios, cpu, vol = [str(x or '') for x in parts]

    r = NF._post('/api/account/token', {
        'guid': guid, 'bios': bios, 'cpu': cpu, 'vol': vol,
        'app': 'xa-arena', 'ver': NF.CLIENT_VERSION,
    }, timeout=timeout, retries=1, cookie=ck)

    if not r.get('ok'):
        code = str(r.get('code') or '').lower()
        msg = str(r.get('msg') or '')
        if code == 'login_required':
            out.update({'state': 'login_required',
                        'msg': 'Phiên đăng nhập đã hết. Đăng nhập lại.'})
        elif code in ('no_entitlement',):
            out.update({'state': 'no_entitlement',
                        'msg': msg or 'Tài khoản chưa có quyền. Dùng thử hoặc mua license.'})
        elif code in ('network', 'timeout', ''):
            out.update({'state': 'offline',
                        'msg': 'Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.'})
        else:
            out.update({'state': 'error', 'msg': msg or code or 'Không lấy được quyền.'})
        return out

    # ---- Lưu token map sáng ----
    no = r.get('nofog') or {}
    gr = r.get('grant') or {}
    exp = int((no.get('expires_at') or gr.get('expires_at') or 0))

    if no.get('token'):
        try:
            st = NF.load_state()
            NF.anchor_server_time(st, r.get('now'))
            st.update({
                'key': '',
                'hwid': '',
                'xn_token': no['token'],
                'expires_at': exp,
                'activated_at': int(no.get('activated_at') or 0),
                'plan': no.get('plan') or 'aoe1',
                'grace_hours': 0,
                'last_ok': time.time(),
                'mode': 'server',
            })
            for _k in ('is_trial', 'trial_weak', 'trial_started', 'trial_days'):
                st.pop(_k, None)
            NF.save_state(st)
        except Exception as e:
            out.update({'state': 'error', 'msg': 'Không lưu được quyền: %s' % str(e)[:60]})
            return out

    if gr.get('token'):
        try:
            import xa_grant as XG
            XG.write_token(gr['token'])
        except Exception:
            pass

    out.update({
        'ok': True, 'state': 'ok',
        'left_sec': max(0, exp - int(time.time())) if exp else 0,
        'expires_at': exp,
        'msg': '',
        'features': r.get('features') or [],
        'has_nofog': bool(no.get('token')),
        'has_grant': bool(gr.get('token')),
    })
    return out


def register(username, password):
    """Tạo tài khoản mới ngay trong app. Trả (ok, msg).

    Chủ shop chốt: "bắt buộc phải đăng ký mới sử dụng được app, đăng ký luôn
    trên EXE cũng được."

    Dùng /api/auth/register — server trả Set-Cookie ngay, nên tạo xong là
    đăng nhập luôn, khách không phải gõ lại mật khẩu.
    """
    try:
        import xa_nofog_pro as NF
    except Exception:
        return False, 'không nạp được module mạng'
    try:
        ok, msg, _ck = NF.register_to_server(username, password, verbose=False)
    except Exception as e:
        return False, str(e)[:120]
    if not ok:
        return False, msg or 'không tạo được tài khoản'

    # Tạo xong thì key dán tay không cần nữa
    try:
        clear_manual_key()
    except Exception:
        pass

    # Lấy quyền ngay để giao diện biết bật khối nào
    d = fetch_entitlement()
    if not d.get('ok'):
        # Tạo tài khoản THÀNH CÔNG nhưng chưa lấy được quyền (mạng chập chờn)
        # -> vẫn trả True, lần làm mới sau sẽ có. Không doạ khách.
        return True, ''
    return True, ''


def login(username, password):
    """Đăng nhập. Trả (ok, msg). Thành công -> tự lấy quyền."""
    try:
        import xa_nofog_pro as NF
    except Exception:
        return False, 'không nạp được module mạng'
    try:
        ok, msg, _ck = NF.login_to_server(username, password, verbose=False)
    except Exception as e:
        return False, str(e)[:120]
    if not ok:
        # LỖI ĐÃ SỬA: chuỗi này hiện thẳng cho khách nhưng thiếu dấu.
        return False, msg or 'không đăng nhập được'

    # login_to_server đã gọi save_session, nhưng kiểm lại cho chắc: mất
    # session thì lần chạy sau khách phải đăng nhập lại.
    try:
        if not session_cookie():
            import xa_nofog_pro as NF
            if _ck:
                NF.save_session(_ck, username)
    except Exception:
        pass

    # Đăng nhập xong thì key dán tay không còn cần -> xoá để lần sau
    # dùng session, tránh quyền bị tính theo 1 key.
    try:
        clear_manual_key()
    except Exception:
        pass

    d = fetch_entitlement()
    if not d.get('ok'):
        return False, (d.get('error') or d.get('msg')
                       or 'không lấy được quyền')
    return True, ''


def logout():
    """Đăng xuất: xoá session + quyền đã lưu + key đã nhớ.

    CHỈ dùng đúng API có sẵn của xa_nofog_pro (drop_session). Trước đây
    hàm này thử nhiều tên hàm và có thể gọi save_session('') – sai.
    """
    try:
        import xa_nofog_pro as NF
        fn = getattr(NF, 'drop_session', None)
        if callable(fn):
            fn()
    except Exception:
        pass
    for f in (_ent_file(), _ent_key_file()):
        try:
            os.remove(f)
        except Exception:
            pass
    return True


# ---------------------------------------------------------------------------
# MÔ HÌNH QUYỀN MỚI (chủ shop):
#   "nếu mua rồi thì không theo HW nữa mà là theo tài khoản luôn. trial mới
#    theo HW còn mua rồi thì không theo gì nữa mà theo tài khoản thôi."
#
#   · GÓI DÙNG THỬ  -> gắn MÁY, tối đa 10 lượt / máy, đổi tài khoản trên
#                      cùng máy KHÔNG thêm lượt (server đếm theo HWID).
#   · GÓI ĐÃ MUA    -> theo TÀI KHOẢN, đổi máy nào cũng dùng được sau khi
#                      đăng nhập; chỉ chặn "1 nick 1 máy 1 thời điểm".
#
# Vì vậy MỌI chỗ chặn vì "sai máy" dưới đây chỉ được áp cho gói DÙNG THỬ.
# ---------------------------------------------------------------------------

def is_trial_licence(L):
    """License này là gói DÙNG THỬ (gắn máy) hay gói ĐÃ MUA (theo tài khoản)?

    Đọc `plan` trước; thiếu `plan` thì dùng `isTrial`; cuối cùng nhận theo
    key dùng thử (TR-...) — tín hiệu CỤC BỘ, đúng cả khi server cũ chưa
    gửi `plan`, nên không bao giờ coi gói dùng thử là gói đã mua.
    """
    if not isinstance(L, dict):
        return False
    plan = str(L.get('plan') or '').strip().lower()
    if plan == 'trial':
        return True
    if plan in ('paid', 'purchase', 'purchased', 'forever', 'pro', 'full'):
        return False
    if L.get('isTrial') is True:
        return True
    if L.get('isTrial') is False:
        return False
    return is_trial_key(L.get('key'))


def machine_ok(L):
    """License có bị CHẶN vì máy này không?

    CHỈ gói DÙNG THỬ mới bị chặn khi `hwid_match is False`. Gói ĐÃ MUA đổi
    máy vẫn dùng được sau khi đăng nhập — việc "1 nick 1 máy" do SERVER
    kiểm (`isActiveDevice`), client không chặn theo HW nữa.
    """
    if not isinstance(L, dict):
        return True
    if not is_trial_licence(L):
        return True
    return L.get('hwid_match') is not False


def _as_bool3(v):
    """True / False / None. None = server KHÔNG nói gì (không được suy ra)."""
    if v is None:
        return None
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)):
        return bool(v)
    s = str(v).strip().lower()
    if s in ('1', 'true', 'yes', 'on'):
        return True
    if s in ('0', 'false', 'no', 'off'):
        return False
    return None


def session_moved(d):
    """Máy này có bị tài khoản 'đá' sang MÁY KHÁC không?

    Server nói bằng `isActiveDevice: false` (hoặc `code: 'session_moved'`).
    Thiếu trường = server không nói gì -> KHÔNG coi là bị đá (không chặn
    oan khách đang dùng bình thường).
    """
    if not isinstance(d, dict):
        return False
    if str(d.get('code') or '').strip().lower() == 'session_moved':
        return True
    for k in ('isActiveDevice', 'is_active_device'):
        if _as_bool3(d.get(k)) is False:
            return True
    return False


def active_device_label(d):
    """Nhãn MÁY ĐANG GIỮ tài khoản — chỉ để ghi nhật ký kỹ thuật.

    Server phải gửi chuỗi người đọc được (ví dụ "Máy Windows"). TUYỆT ĐỐI
    không gửi mã phần cứng: app không được để khách thấy HWID. Giá trị
    trông như mã máy (hex dài) bị bỏ qua ngay tại đây.
    """
    if not isinstance(d, dict):
        return ''
    for k in ('activeDeviceLabel', 'active_device_label'):
        v = str(d.get(k) or '').strip()
        if not v:
            continue
        low = v.lower()
        if len(low) >= 16 and all(c in '0123456789abcdef-' for c in low):
            continue
        return v[:40]
    return ''


def account_code_of(code):
    """Quy đổi mã lỗi theo NGỮ CẢNH TÀI KHOẢN (hỏi bằng phiên đăng nhập).

    `not_found` khi hỏi bằng KEY nghĩa là "khách gõ sai mã" (cần câu nhắc
    hay nhầm 8↔B). Cùng mã đó khi hỏi bằng PHIÊN lại nghĩa là "tài khoản
    chưa có gói nào" — hai câu hướng dẫn khác hẳn nhau, nên phải tách.
    """
    low = str(code or '').strip().lower()
    if low in ('not_found', 'no_license', 'no_licence', 'no_licenses',
               'license_not_found', 'licence_not_found', 'empty'):
        return 'no_licence'
    return low


def entitlement_code(d):
    """Mã trạng thái của một dict quyền ĐÃ chuẩn hoá. '' = bình thường.

    Dùng cho giao diện: chọn ĐÚNG câu hướng dẫn thay vì câu chung.
    """
    if not isinstance(d, dict):
        return 'network'
    if session_moved(d):
        return 'session_moved'
    if not d.get('ok'):
        return account_code_of(d.get('code') or 'network')
    if d.get('features'):
        return ''
    if d.get('licenses'):
        return ''
    if str(d.get('via') or '') == 'session':
        return 'no_licence'
    return ''


def has_paid_licence(d):
    """Tài khoản có GÓI ĐÃ MUA còn dùng được không? (gói dùng thử không tính)

    Dùng để quyết định có xin dùng thử theo máy nữa hay không: đã mua rồi
    thì không xin dùng thử (đỡ tốn lượt của khách).
    """
    if not isinstance(d, dict) or not d.get('ok'):
        return False
    now = int(time.time())
    for L in (d.get('licenses') or []):
        if not isinstance(L, dict):
            continue
        if is_trial_licence(L):
            continue
        if L.get('revoked'):
            continue
        if L.get('active') is False:
            continue
        if not machine_ok(L):
            continue
        if L.get('forever'):
            return True
        try:
            exp = int(L.get('expires_at') or 0)
        except Exception:
            exp = 0
        if exp <= 0 or exp > now:
            return True
    return False


def _normalise(d):
    """Bảo đảm các trường luôn có, kiểu đúng. Fail closed."""
    out = dict(d or {})
    feats = out.get('features')
    if not isinstance(feats, list):
        feats = []
    # Chỉ nhận tên hợp lệ
    feats = [f for f in feats if f in ('nofog', 'grant')]
    if not isinstance(out.get('licenses'), list):
        out['licenses'] = []
    out.setdefault('via', '')
    out.setdefault('user', None)
    out['ok'] = bool(out.get('ok'))

    # ------------------------------------------------------------------
    # BỊ ĐÁ SANG MÁY KHÁC -> MÁY NÀY KHÔNG CÓ QUYỀN GÌ.
    #
    # Server vẫn có thể gửi kèm features/licenses (dữ liệu của tài khoản).
    # Giữ nguyên sẽ khiến app bật map sáng trên máy đã bị đá — đúng cái
    # chủ shop cấm ("đăng nhập nhiều lần nhiều máy 1 nick để dùng thì
    # không cho phép").
    # ------------------------------------------------------------------
    moved = session_moved(out)
    if moved:
        feats = []
    out['features'] = feats
    out['hasNofog'] = ('nofog' in feats)
    out['hasGrant'] = ('grant' in feats)

    # Trạng thái "máy này có phải máy đang dùng tài khoản không" — ba giá
    # trị: True / False / None (None = server không nói gì).
    out['isActiveDevice'] = _as_bool3(
        out.get('isActiveDevice',
                out.get('is_active_device')))
    out['activeDeviceLabel'] = str(
        out.get('activeDeviceLabel')
        or out.get('active_device_label') or '')[:40]

    for L in out['licenses']:
        if not isinstance(L, dict):
            continue
        # Mỗi license: bảo đảm có hwid_match (None = không kết luận được)
        if 'hwid_match' not in L:
            L['hwid_match'] = None
        # `plan` / `isTrial` chuẩn hoá để is_trial_licence() đọc chắc chắn.
        L['plan'] = str(L.get('plan') or '').strip().lower()
        if 'isTrial' in L:
            L['isTrial'] = bool(L.get('isTrial'))
        # Chấp nhận cả camelCase: app đọc `expires_at` khắp nơi, còn server
        # có thể gửi `expiresAt`. Đổi tên ở MỘT chỗ này thay vì sửa 20 chỗ.
        if 'expires_at' not in L and 'expiresAt' in L:
            L['expires_at'] = L.get('expiresAt')
        if 'hwidMatch' in L and 'hwid_match' not in L:
            L['hwid_match'] = L.get('hwidMatch')
    return out


def _pick_key(d, feat):
    """Chọn key tốt nhất cho một chức năng.

    THỨ TỰ ƯU TIÊN:
      0. Gói ĐÃ MUA còn hiệu lực       — không xét máy (theo tài khoản)
      1. active + hwid_match = True    — dùng thử bind ĐÚNG máy này
      2. active + hwid_match = None    — chưa kết luận được
      3. active (còn lại)              — dự phòng

    LỖI ĐÃ SỬA (a): trước đây lấy license ĐẦU TIÊN có `active`, không xét
    `hwid_match`. Khách có nhiều key (mua + test) thì app chọn nhầm key
    của MÁY KHÁC -> kích hoạt thất bại -> "License chưa dùng được trên
    máy này" dù trong tài khoản CÓ key đúng máy.

    LỖI ĐÃ SỬA (b): `hwid_match is False` từng loại bỏ CẢ gói đã mua. Chủ
    shop: "mua rồi thì không theo HW nữa mà là theo tài khoản luôn" — gói
    đã mua đổi máy vẫn phải dùng được sau khi đăng nhập. Nay chỉ gói DÙNG
    THỬ mới bị xét máy, và gói dùng thử gắn máy khác thì KHÔNG chọn.
    """
    best = None
    best_rank = -1
    for L in (d or {}).get('licenses') or []:
        if not isinstance(L, dict):
            continue
        if feat not in (L.get('features') or []):
            continue
        if not L.get('active'):
            continue
        if not machine_ok(L):
            continue        # dùng thử gắn máy khác -> không dùng được ở đây
        m = L.get('hwid_match')
        if not is_trial_licence(L):
            rank = 3        # gói đã mua: mạnh nhất, không xét máy
        else:
            rank = 2 if m is True else (1 if m is None else 0)
        if rank > best_rank:
            best_rank = rank
            best = str(L.get('key') or '')
            if rank == 3:
                break        # gói đã mua: tốt nhất có thể
            if rank == 2:
                continue     # vẫn xét tiếp: có thể gặp gói ĐÃ MUA (hạng 3)
    return best or ''


def nofog_key_of(d):
    """Lấy key cấp quyền 'nofog'. Ưu tiên key bind ĐÚNG máy này."""
    return _pick_key(d, 'nofog')


def grant_key_of(d):
    """Lấy key cấp quyền 'grant'. Ưu tiên key bind ĐÚNG máy này."""
    return _pick_key(d, 'grant')





# ---------------------------------------------------------------------------
# XÁC THỰC LẠI VỚI SERVER — chống dùng key đã bị thu hồi
# ---------------------------------------------------------------------------

# Quá bao lâu không liên lạc được server thì coi như KHÔNG hợp lệ.
# Đủ rộng để khách mất mạng ngắn không bị cắt oan, đủ hẹp để không
# cho dùng key thu hồi quá lâu.
GRACE_SEC = 3 * 86400       # 3 ngày


def _recheck_file():
    return os.path.join(state_dir(), 'last_check.json')


def _load_last_check():
    try:
        with open(_recheck_file(), 'r', encoding='utf-8') as f:
            d = json.load(f)
        return float(d.get('t') or 0), str(d.get('key') or '')
    except Exception:
        return 0.0, ''


def _save_last_check(key):
    """Ghi mốc liên lạc server gần nhất.

    KHÔNG ghi key nữa: `key` là key licence NGUYÊN BẢN mà không chỗ nào đọc
    lại (người đọc chỉ dùng mốc thời gian — xem `_load_last_check`), nên ghi
    ra chỉ tạo thêm một bản key plaintext trên đĩa khách. Tham số `key` giữ
    nguyên để mọi chỗ gọi cũ chạy y như trước.
    """
    try:
        with open(_recheck_file(), 'w', encoding='utf-8') as f:
            json.dump({'t': time.time()}, f)
    except Exception:
        pass


def _fallback_check_time():
    """Mốc liên lạc server gần nhất khi chưa có last_check.json.

    VÌ SAO CẦN: bản cũ không ghi mốc này, nên máy đã cài từ trước rơi
    vào nhánh "chưa từng kiểm được" — mà nhánh đó cũ lại luôn cho qua.
    Lấy thời điểm file quyền/file trạng thái được ghi làm mốc thay thế.
    Trả 0.0 nếu không đọc được gì.
    """
    best = 0.0
    cands = [_ent_file(), _recheck_file()]
    try:
        import xa_nofog_pro as NF
        d = getattr(NF, 'STATE_FILE', '') or ''
        if d:
            cands.append(str(d))
    except Exception:
        pass
    for fp in cands:
        try:
            m = os.path.getmtime(fp)
            if m > best:
                best = float(m)
        except Exception:
            continue
    return best


def _load_grant_module():
    """Nạp xa_grant, tự thêm tool/grant vào sys.path nếu cần."""
    try:
        import xa_grant
        return xa_grant
    except Exception:
        pass
    try:
        import os as _os
        import sys as _sys
        here = _os.path.dirname(_os.path.abspath(__file__))
        for cand in (_os.path.join(here, '..', 'grant'),
                     _os.path.join(here, '..', 'src')):
            cand = _os.path.abspath(cand)
            if _os.path.isdir(cand) and cand not in _sys.path:
                _sys.path.insert(0, cand)
        import xa_grant
        return xa_grant
    except Exception:
        return None


def _hwid_for(kind):
    """HWID theo LOẠI license.

    LỖI ĐÃ SỬA: hai module tính HWID KHÁC NHAU (chuỗi khác nhau trên cùng
    một máy):
        xa_nofog_pro.compute_hwid()  -> '775c3fd3...'
        xa_grant._guard_safe_hwid()  -> 'd512bc5a...'
    Gửi nhầm HWID thì server trả hwid_mismatch, app tưởng hết hạn OAN.

    kind: 'nofog' | 'grant'
    """
    if kind == 'grant':
        try:
            XG = _load_grant_module()
            if XG is None:
                return ''
            for name in ('_guard_safe_hwid', 'compute_hwid', 'get_hwid'):
                fn = getattr(XG, name, None)
                if callable(fn):
                    try:
                        v = str(fn() or '').strip().lower()
                        if v:
                            return v
                    except Exception:
                        continue
        except Exception:
            pass
        return ''

    try:
        import xa_nofog_pro as NF
        for name in ('compute_hwid', 'get_hwid'):
            fn = getattr(NF, name, None)
            if callable(fn):
                try:
                    v = str(fn() or '').strip().lower()
                    if v:
                        return v
                except Exception:
                    continue
    except Exception:
        pass
    return ''


def _grant_recheck(key, hwid, timeout=25):
    """Hỏi /api/xg/check cho license tài nguyên.

    Trả (status, body). status = 0 nghĩa là KHÔNG KIỂM ĐƯỢC (mạng/lỗi
    cục bộ) — người gọi không được kết luận gì từ đó.
    """
    try:
        # Chỉ cần biết module bảo vệ tài nguyên có mặt; phần gọi mạng
        # dùng _post_json bên dưới.
        __import__('xa_grant_sec')
    except Exception:
        return 0, {}
    sid = ''
    try:
        import xa_grant as XG
        stt = XG.load_state() or {}
        sid = str(stt.get('sid') or '')
    except Exception:
        sid = ''
    if not sid:
        # Chưa có phiên tài nguyên -> thử activate để lấy sid (idempotent
        # với máy đã bind). Thất bại thì coi như không kiểm được.
        try:
            st_a, r_a = _post_json('/api/xg/activate',
                                   {'key': key, 'hwid': hwid},
                                   timeout=timeout)
            if st_a == 200 and (r_a or {}).get('ok'):
                sid = str((r_a or {}).get('sid') or '')
            else:
                return 0, {}
        except Exception:
            return 0, {}
        if not sid:
            return 0, {}
    try:
        return _post_json('/api/xg/check',
                          {'key': key, 'hwid': hwid, 'sid': sid},
                          timeout=timeout)
    except Exception:
        return 0, {}


def server_recheck(ent, timeout=12):
    """Hỏi server xem license còn hiệu lực không.

    KIỂM TẤT CẢ KEY, không chỉ một. Tài khoản có thể có nhiều license
    (mua nhiều gói, nhiều sản phẩm). Chỉ kết luận "bị thu hồi" khi MỌI
    key còn hạn đều bị server từ chối.

    Trả (ok: bool, ly_do: str).
      ok=True  -> còn ít nhất 1 key hiệu lực (hoặc lỗi mạng trong ân hạn)
      ok=False -> tất cả đều bị thu hồi/hết hạn/sai máy -> PHẢI dừng
    """
    if not ent or not ent.get('ok'):
        return False, 'chưa có quyền'

    lics = ent.get('licenses') or []
    # Chỉ kiểm license mà client tưởng là còn hiệu lực
    cands = []
    for L in lics:
        if not isinstance(L, dict):
            continue
        if L.get('revoked'):
            continue
        if L.get('active') is False:
            continue
        k = str(L.get('key') or '').strip()
        if not k:
            continue
        feats = L.get('features') or []
        kind = 'grant' if ('grant' in feats and 'nofog' not in feats) else 'nofog'
        cands.append((k, kind))

    if not cands:
        # Không có license nào client coi là hợp lệ
        return False, 'không có license còn hiệu lực'

    # Thử từng key; dừng ngay khi có key được server chấp nhận
    last_code = ''
    network_fail = 0
    for key, kind in cands:
        hwid = _hwid_for(kind)
        if not hwid:
            # Không đọc được HWID -> KHÔNG kiểm được key này. Trước đây
            # `continue` trần nên trường hợp "mọi key đều thiếu HWID" rơi
            # xuống nhánh "lỗi lạ: không cắt" -> chạy mãi. Nay đếm là
            # không-kiểm-được để đi vào ân hạn.
            network_fail += 1
            continue

        # ------------------------------------------------------------
        # MỖI SẢN PHẨM CÓ ENDPOINT RIÊNG.
        #
        # LỖI ĐÃ SỬA: trước đây LUÔN gọi /api/check dù key là tài nguyên.
        # /api/check là endpoint của map sáng và từ chối key tài nguyên
        # (403 wrong_product) -> app hiểu nhầm là bị thu hồi và TẮT khối
        # tài nguyên dù khách còn hạn.
        # ------------------------------------------------------------
        if kind == 'grant':
            st, r = _grant_recheck(key, hwid, timeout)
            if st == 0:
                network_fail += 1     # không kiểm được -> không kết luận
                continue
            if st == 200 and (r or {}).get('ok'):
                _save_last_check(key)
                return True, ''
            code = str((r or {}).get('code') or '')
            last_code = code
            if code in ('session_invalid', 'no_session', 'rate_limit',
                        'wrong_product', 'not_found'):
                # chưa/không kiểm được bằng đường này -> thử key khác,
                # KHÔNG kết luận thu hồi
                network_fail += 1
            continue

        st, r = _post_json('/api/check', {'key': key, 'hwid': hwid},
                           timeout=timeout)

        if st == 200 and (r or {}).get('ok'):
            _save_last_check(key)
            return True, ''               # một key còn tốt là đủ

        code = str((r or {}).get('code') or '')
        last_code = code

        # Lỗi mạng/server bận -> không kết luận vội
        if st == 0 or st >= 500 or code in ('rate_limit', 'network'):
            network_fail += 1
            continue

        # Server từ chối dứt khoát (revoked/expired/hwid_mismatch) ->
        # thử key tiếp theo, chưa kết luận.

    # Không key nào được chấp nhận
    if network_fail and network_fail == len(cands):
        # ------------------------------------------------------------------
        # FAIL CLOSED SAU ÂN HẠN — LỖ HỔNG ĐÃ SỬA
        #
        # Trước đây CẢ HAI nhánh đều `return True, ''` -> GRACE_SEC không
        # bao giờ có tác dụng: key đã bị thu hồi cứ chạy mãi miễn là máy
        # không lên mạng. Nay: quá GRACE_SEC kể từ lần kiểm tra THÀNH CÔNG
        # gần nhất thì coi như KHÔNG hợp lệ và trả lý do.
        # ------------------------------------------------------------------
        t_last, _k = _load_last_check()
        if not t_last:
            # Chưa từng ghi mốc (bản cũ) -> lấy mốc gần nhất còn đọc được.
            t_last = _fallback_check_time()
        if t_last and (time.time() - t_last) < GRACE_SEC:
            return True, ''               # còn trong ân hạn
        return False, 'offline_grace_expired'

    if last_code in ('revoked', 'expired', 'hwid_mismatch', 'not_found',
                     'trial_exhausted', 'account_locked'):
        return False, last_code

    # Lỗi lạ: không cắt
    return True, ''


def grant_token_ok():
    """Token tai nguyen (bang dia chi engine) da dung duoc chua?"""
    try:
        XG = _load_grant_module()
        if XG is None:
            return False
        okE, _m = XG.ensure_engine(None)
        return bool(okE)
    except Exception:
        return False


def token_ok():
    """Token NoFog hiện tại có dùng được không? (chữ ký + hạn + đúng máy)"""
    try:
        import xa_nofog_pro as NF
        ok, _msg = NF._load_sites(None, verbose=False)
        return bool(ok)
    except Exception:
        return False


def is_trial_key(key):
    """Key dung thu? (TR-XXXX-XXXX-XXXX)"""
    return str(key or '').strip().upper().startswith('TR-')


def claim_trial_key(key, on_step=None):
    """Nhận mã dùng thử: /api/trial/claim -> /api/check -> token.

    VÌ SAO RIÊNG HÀM NÀY:
    Key TR- KHÔNG kích hoạt được qua /api/activate (server trả 403
    trial_only — đúng thiết kế, để 1 mã không share cho 100 máy).
    Đường đúng là claim (gắn HWID + bắt đầu tính giờ) rồi check (cấp token).

    Trả (ok, msg). Tương thích với ensure_tokens.
    """
    key = str(key or '').strip().upper()
    if not key:
        return False, 'thiếu key'

    def say(m):
        if on_step:
            try:
                on_step(m)
            except Exception:
                pass

    try:
        import xa_nofog_pro as NF
    except Exception as e:
        return False, 'không nạp được module: %s' % e

    # ---- 1. Claim: gắn mã với máy này, bắt đầu tính giờ ----
    say('Đang nhận mã dùng thử…')
    try:
        parts = NF._hwid_parts_checked()
    except Exception as e:
        return False, 'không đọc được thông tin phần cứng (%s)' % str(e)[:60]

    try:
        r = NF._post('/api/trial/claim', {
            'key': key,
            'guid': parts[0], 'bios': parts[1],
            'cpu': parts[2], 'vol': parts[3],
            'app': NF.APP_NAME, 'ver': NF.CLIENT_VERSION,
        }, timeout=NF.HTTP_TIMEOUT, retries=1)
    except Exception as e:
        return False, 'không gọi được server: %s' % str(e)[:80]

    if not r.get('ok'):
        code = str(r.get('code') or '')
        # Nhớ mã lỗi để giao diện chọn đúng câu hướng dẫn kế tiếp.
        set_last_code(code or 'network')
        msgs = {
            'not_found': 'Mã dùng thử không tồn tại',
            'hwid_mismatch': 'Mã này đã gắn với máy khác',
            'trial_expired': 'Lượt dùng thử đã hết hạn',
            'revoked': 'Mã dùng thử đã bị thu hồi',
            'not_trial': 'Đây là key trả phí, không phải mã dùng thử',
            'bad_request': 'Mã không đúng dạng TR-XXXX-XXXX-XXXX',
            'trial_denied_device': 'Không hỗ trợ dùng thử trên máy ảo',
        }
        return False, msgs.get(code, r.get('msg') or code or 'lỗi không rõ')

    # ---- 2. Ghi state giống CLI đã làm (để token/expiry nhất quán) ----
    activated = bool(r.get('activated'))
    try:
        st = NF.load_state() or {}
        NF.anchor_server_time(st, r.get('now'))
        kind = str(r.get('trial_kind') or '1h')
        kc = NF.TRIAL_KINDS.get(kind, NF.TRIAL_KINDS.get('1h', {}))
        st.update({
            'key': key,
            'hwid': str(r.get('hwid') or NF._hwid_safe()),
            'plan': 'trial',
            'is_trial': 1,
            'trial_kind': kind,
            'trial_label': kc.get('label', 'DÙNG THỬ'),
            'trial_started': int(r.get('activated_at') or NF.server_now()),
            'grace_hours': 0,
            'last_ok': time.time(),
            'mono_last_ok': NF._mono(),
            'mode': 'server',
            'recheck_sec': int(r.get('recheck_sec')
                               or kc.get('recheck') or 300),
        })
        if activated:
            st['expires_at'] = int(r.get('expires_at') or 0)
            st['activated_at'] = int(r.get('activated_at')
                                     or NF.server_now())
            st.pop('hold_until', None)
        else:
            st['hold_until'] = int(r.get('expires_at') or 0)
            st['expires_at'] = 0
            st['activated_at'] = 0
        NF.save_state(st)
    except Exception as e:
        return False, 'không lưu được trạng thái: %s' % str(e)[:60]

    # ---- 3. Check: lấy token thật (server chạy trialCheck) ----
    say('Đang lấy token…')
    try:
        ok2, msg2 = NF.check_online(verbose=False)
    except Exception as e:
        return False, 'lấy token lỗi: %s' % str(e)[:80]
    if not ok2:
        return False, str(msg2 or 'không lấy được token')[:120]

    # ---- 4. Nạp bảng cổng từ token ----
    try:
        ok3, _m3 = NF._load_sites(None, verbose=False)
        if not ok3:
            return False, 'token nhận được không dùng được'
    except Exception:
        pass

    say('Đã kích hoạt mã dùng thử.')
    return True, ''


def ensure_free_trial(on_step=None, verbose=False, product=None):
    """TỰ NHẬN DÙNG THỬ THEO MÁY — KHÔNG CẦN KEY.

    Chủ shop: "bỏ nhập key đi, ghi luôn nhận dùng thử ... mọi thứ gắn
    theo HW ... số lần bao nhiêu còn bao nhiêu cũng báo luôn".

    Cách làm: server đã có `/api/trial/command` — nhận thẳng các mảnh
    phần cứng (guid/bios/cpu/vol), KHÔNG cần key, KHÔNG cần đăng nhập.
    Hàm `xa_nofog_pro.start_trial()` đã viết sẵn nhưng trước đây chỉ CLI
    gọi; GUI không bao giờ gọi nên lần chạy đầu là ngõ cụt.

    Nay hàm này là cửa duy nhất để có quyền:
      1. Token trên máy còn dùng được  -> không làm gì (không tốn lượt)
      2. Chưa có                        -> xin dùng thử 1 lần
      3. Server hết lượt                -> 'exhausted' (hiện nút Mua)

    Trả dict:
      ok       : True nếu dùng được
      state    : ok | exhausted | banned | offline | no_hw | error
      left     : số lượt còn lại (None nếu server không cho biết)
      left_sec : số giây dùng thử còn lại (0 nếu không rõ)
      msg      : câu tiếng Việt cho khách
    """
    def _say(m):
        if on_step:
            try:
                on_step(m)
            except Exception:
                pass
        elif verbose:
            print('  ' + str(m))

    out = {'ok': False, 'state': 'error', 'left': None, 'total': None,
           'left_sec': 0, 'msg': ''}

    # ------------------------------------------------------------------
    # BỔ SUNG SỐ LƯỢT VÀO KẾT QUẢ — chủ shop: "còn bao nhiêu cũng báo".
    #
    # LỖI ĐÃ SỬA: trước đây hàm này LUÔN trả left=None, nên không chỗ nào
    # hiện được "còn 7/10 lượt" dù server có trả `left`/`quota` và
    # `start_trial()` có ghi vào state. Nay điền từ server (nếu có) rồi
    # lấy nốt từ state.
    # ------------------------------------------------------------------
    def _fill_counts(d, src=None):
        src = src if isinstance(src, dict) else {}
        for sk, dk in (('left', 'left'), ('quota', 'total')):
            if d.get(dk) is None:
                v = src.get(sk)
                if v is not None:
                    try:
                        d[dk] = int(v)
                    except Exception:
                        pass
        try:
            fs = free_status() or {}
        except Exception:
            fs = {}
        if d.get('left') is None and fs.get('left') is not None:
            d['left'] = fs.get('left')
        if d.get('total') is None and fs.get('total') is not None:
            d['total'] = fs.get('total')
        return d

    # ---- 1. Đã có token dùng được -> không xin lại (không tốn lượt) ----
    try:
        if token_ok():
            st = {}
            try:
                import xa_nofog_pro as _NF
                st = _NF.load_state() or {}
            except Exception:
                pass
            exp = int(st.get('expires_at') or 0)
            import time as _t
            left = max(0, exp - int(_t.time())) if exp else 0
            out.update({'ok': True, 'state': 'ok', 'left_sec': left,
                        'expires_at': exp, 'msg': ''})
            return _fill_counts(out)
    except Exception:
        pass

    # ---- 2. Chưa có -> xin dùng thử ----
    _say('Đang bật dùng thử cho máy này…')
    try:
        import xa_nofog_pro as NF
    except Exception:
        out.update({'state': 'error',
                    'msg': 'Không bật được dùng thử. Thử lại sau.'})
        return out

    # ------------------------------------------------------------------
    # THỬ LẦN LƯỢT CÁC GÓI DÙNG THỬ.
    #
    # LỖI ĐÃ SỬA: `start_trial()` mặc định xin gói '3d', nhưng server đã
    # TẮT gói 3 ngày (trial3d_enabled=0) và chỉ bật gói 1 giờ
    # (trial1h_enabled=1). Vì vậy mọi lần xin đều trả
    #     {'code':'trial_kind_invalid','msg':'Gói "3d" không khả dụng.'}
    # và khách KHÔNG BAO GIỜ nhận được dùng thử.
    #
    # Nay thử '1h' trước (gói đang bật), rồi mới '3d'.
    # ------------------------------------------------------------------
    r = None
    _last = None
    for _kind in ('1h', '3d'):
        try:
            _r = NF.start_trial(kind=_kind, verbose=False,
                                product=product)
        except TypeError:
            # Bản cũ không nhận tham số kind
            try:
                _r = NF.start_trial(verbose=False, product=product)
            except Exception:
                _r = None
        except Exception:
            _r = None
        if isinstance(_r, dict):
            _last = _r
            if _r.get('ok'):
                r = _r
                break
            # Gói này không dùng được -> thử gói kế
            if str(_r.get('code') or '') == 'trial_kind_invalid':
                continue
            # Lỗi khác (hết lượt, mạng...) -> dừng, báo đúng lý do
            r = _r
            break
    if r is None:
        r = _last

    if not isinstance(r, dict):
        out.update({'state': 'error',
                    'msg': 'Không bật được dùng thử. Thử lại sau.'})
        return out

    if r.get('ok'):
        # Hạn KHÔNG nằm trong dict kết quả của start_trial — nó nằm trong
        # state đã lưu (lic.bin). Đọc lại từ state, không đọc từ `r`.
        exp = int(r.get('expires_at') or 0)
        if not exp:
            try:
                exp = int((NF.load_state() or {}).get('expires_at') or 0)
            except Exception:
                exp = 0
        import time as _t
        left = max(0, exp - int(_t.time())) if exp else 0
        out.update({'ok': True, 'state': 'ok', 'left_sec': left,
                    'expires_at': exp, 'msg': ''})
        return _fill_counts(out, r)

    # ---- 3. Thất bại: phân loại đúng lý do ----
    code = str(r.get('code') or '').lower()
    msg = str(r.get('msg') or '')

    if code in ('trial_quota_exhausted', 'trial_device_limit',
                'trial_1h_limit', 'trial_device_acc_1h'):
        # Server TỪ CHỐI vì hết lượt -> chắc chắn 0 lượt còn lại.
        out.update({'state': 'exhausted', 'left': 0,
                    'msg': 'Máy này đã dùng hết lượt dùng thử. '
                           'Mua key để tiếp tục.'})
        return _fill_counts(out, r)
    elif 'không đọc được thông tin phần cứng' in msg or code == 'hwid_unavailable':
        out.update({'state': 'no_hw',
                    'msg': 'Không đọc được thông tin máy. '
                           'Thử chạy lại app.'})
    elif code in ('trial_ip_limit', 'trial_net_limit',
                  'trial_global_limit', 'rate_limit'):
        out.update({'state': 'offline',
                    'msg': 'Mạng này đã dùng hết lượt dùng thử hôm nay. '
                           'Thử lại vào ngày mai, hoặc mua key để dùng ngay.'})
    else:
        st_txt = 'network' if code in ('network', 'timeout', '') else code
        if st_txt == 'network':
            out.update({'state': 'offline',
                        'msg': 'Không kết nối được máy chủ. '
                               'Kiểm tra mạng rồi bấm "Kiểm tra lại".'})
        else:
            out.update({'state': 'error',
                        'msg': next_step_for(code) or
                               'Chưa bật được dùng thử. Bấm "Kiểm tra lại".'})
    return out


BUY_BASE = 'https://xienhl.com'


# ---------------------------------------------------------------------------
# MÁY CHỦ SHOP — cổng cho tính năng "Mua 2 tính 1" (chỉ riêng chủ shop)
#
# Danh sách HWID CHỈ đọc từ file do SERVER KÝ: `shop.lic`.
# Chi tiết + lý do bảo mật: xem hàm `_shop_hwid_set()` bên dưới.
# ---------------------------------------------------------------------------

_SHOP_CACHE = {'at': 0, 'set': set()}


def machine_hwid():
    """HWID của máy này. '' nếu không đọc được."""
    try:
        import xa_nofog_pro as _NF
        return str(_NF.compute_hwid() or '').strip().lower()
    except Exception:
        pass
    try:
        import xa_nofog_pro as _NF
        return str(_NF._guard_safe_hwid() or '').strip().lower()
    except Exception:
        return ''


# ---------------------------------------------------------------------------
# DANH SÁCH MÁY CHỦ SHOP — PHẢI DO SERVER KÝ
#
# LỖ HỔNG ĐÃ SỬA (đo được): trước đây danh sách đọc từ
#   - %LOCALAPPDATA%\XArenaNoFog\shop.hwid   (khách GHI ĐƯỢC)
#   - biến môi trường XA_SHOP_HWIDS           (khách ĐẶT ĐƯỢC)
# ⇒ khách chỉ cần tạo 1 file text 20 byte chứa HWID của họ là BẬT ĐƯỢC
#   tính năng độc quyền của chủ shop. Đã thử và xác nhận: bật được.
#
# Nay: chỉ tin file do SERVER KÝ bằng ECDSA P-256.
#   File : %LOCALAPPDATA%\XArenaNoFog\shop.lic
#   Nội dung: <base64(payload)>.<base64(chữ ký)>
#   payload: {"h": "<hwid>", "exp": <unix giây>}
#   Khoá công khai nằm trong exe; khoá riêng chỉ trên Cloudflare.
#
# Không có file, file hỏng, chữ ký sai, hết hạn, hoặc HWID không khớp
# ⇒ KHÔNG bật (fail closed).
#
# Bỏ hoàn toàn biến môi trường XA_SHOP_HWIDS.
# ---------------------------------------------------------------------------

# Khoá công khai ECDSA P-256 (điền khi tạo cặp khoá — xem docs/SHOP-KEY.md)
SHOP_PUBKEY_B64 = (
    'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE7bxMEvO+jVV1dvfFG7nUQ9gjDnDNwgRCqxIDzuGrTp28zbrAMapEpmsBhRBDzaFQy9DYHALlHi5wZPHiLr0y6Q==')
# Khoá CÔNG KHAI ECDSA P-256. Khoá RIÊNG chỉ nằm trên Cloudflare
# (secret SHOP_SIGN_KEY). Khách đổi khoá này cũng vô ích vì chữ ký
# phải khớp — mà khoá riêng họ không có.

SHOP_LIC_NAME = 'shop.lic'


def _b64d(txt):
    """Giải base64 (chấp nhận cả base64url)."""
    import base64 as _b
    t = str(txt or '').strip()
    t = t.replace('-', '+').replace('_', '/')
    t += '=' * ((4 - len(t) % 4) % 4)
    return _b.b64decode(t)


def _verify_shop_sig(payload_bytes, sig_bytes):
    """Kiểm tra chữ ký ECDSA P-256 của server. Fail closed.

    LỖI ĐÃ SỬA (đo được): WebCrypto `crypto.subtle.sign` trả chữ ký ECDSA ở
    dạng RAW 64 byte (r||s), KHÔNG phải DER. Đưa thẳng vào
    `pub.verify()` thì luôn `InvalidSignature` ⇒ app không bao giờ nhận
    được shop.lic dù server ký đúng.

    Đo thật: raw(r||s) -> OK ; DER -> InvalidSignature.

    Nay: chấp nhận CẢ HAI dạng — thử raw trước, rồi DER.
    """
    try:
        if not SHOP_PUBKEY_B64:
            return False
        from cryptography.hazmat.primitives import hashes
        from cryptography.hazmat.primitives.asymmetric import ec, utils
        from cryptography.hazmat.primitives.serialization import (
            load_der_public_key)
        import base64 as _b
        pub = load_der_public_key(_b.b64decode(SHOP_PUBKEY_B64))

        # (1) Dạng RAW 64 byte r||s (WebCrypto) — thử trước
        if len(sig_bytes) == 64:
            try:
                r = int.from_bytes(sig_bytes[:32], 'big')
                sg = int.from_bytes(sig_bytes[32:], 'big')
                der = utils.encode_dss_signature(r, sg)
                pub.verify(der, payload_bytes, ec.ECDSA(hashes.SHA256()))
                return True
            except Exception:
                pass

        # (2) Dạng DER (một số thư viện trả DER)
        try:
            pub.verify(sig_bytes, payload_bytes, ec.ECDSA(hashes.SHA256()))
            return True
        except Exception:
            pass

        return False
    except Exception:
        return False


def _read_shop_lic():
    """Đọc + kiểm tra shop.lic. Trả set HWID (rỗng nếu không hợp lệ)."""
    import json as _json
    import os as _os
    import time as _t
    out = set()
    try:
        p = _os.path.join(state_dir(), SHOP_LIC_NAME)
        if not _os.path.exists(p):
            return out
        with open(p, 'r', encoding='utf-8', errors='replace') as f:
            raw = f.read().strip()
        if not raw or '.' not in raw:
            return out
        b_payload, b_sig = raw.split('.', 1)
        payload = _b64d(b_payload)
        sig = _b64d(b_sig)
        # BẮT BUỘC chữ ký đúng — nếu không thì bỏ
        if not _verify_shop_sig(payload, sig):
            return out
        d = _json.loads(payload.decode('utf-8'))
        if not isinstance(d, dict):
            return out
        exp = int(d.get('exp') or 0)
        if exp and _t.time() > exp:
            return out
        for h in (d.get('h') or '').split(','):
            v = str(h or '').strip().lower()
            if v:
                out.add(v)
    except Exception:
        return set()
    return out


def _shop_hwid_set():
    """Danh sách HWID chủ shop — CHỈ từ file do server ký (cache 5 giây)."""
    import time as _t
    now = _t.time()
    if now - _SHOP_CACHE['at'] < 5:
        return _SHOP_CACHE['set']
    out = _read_shop_lic()
    _SHOP_CACHE['at'] = now
    _SHOP_CACHE['set'] = out
    return out


def is_shop_hwid(hwid=None):
    """Máy này có nằm trong danh sách chủ shop không? Fail closed."""
    try:
        want = str(hwid if hwid is not None else machine_hwid())
        want = want.strip().lower()
        if not want:
            return False
        return want in _shop_hwid_set()
    except Exception:
        return False


def buy_url(product='nofog'):
    """Link mua hang, mo san dung san pham khach dang can.

    Chủ shop: "khi nào hết thì đưa lên web mua". Nút Mua mở thẳng trang
    sản phẩm tương ứng, không bắt khách tự tìm.
    """
    prod = str(product or '').lower()
    if prod in ('grant', 'xagrant', 'tai-nguyen', 'tainguyen'):
        return BUY_BASE + '/?p=grant'
    return BUY_BASE + '/?p=map'


def open_url(url):
    """Mở link bằng trình duyệt mặc định. Trả True/False."""
    try:
        import os
        os.startfile(str(url))
        return True
    except Exception:
        pass
    try:
        import webbrowser
        return bool(webbrowser.open(str(url)))
    except Exception:
        return False


def free_status():
    """Trạng thái dùng thử theo MÁY: còn bao nhiêu giây, còn mấy lượt.

    Dùng để hiện "còn bao nhiêu" ở mọi chỗ — chủ shop yêu cầu luôn báo.

    LỖI ĐÃ SỬA: hàm này trước đây LUÔN trả left=None/total=None, dù
    `start_trial()` đã ghi quota_left/quota_total vào state. Nay đọc ra,
    nhờ vậy giao diện hiện được "còn 7/10 lượt" mà không cần gọi mạng.
    """
    import time as _t
    out = {'has': False, 'left_sec': 0, 'left': None, 'total': None,
           'expires_at': 0, 'forever': False, 'kind': '', 'hwid': ''}
    try:
        import xa_nofog_pro as NF
        st = NF.load_state() or {}
    except Exception:
        return out
    exp = int(st.get('expires_at') or 0)
    now = int(_t.time())
    # KHÔNG gán thẳng `expires_at` ở đây — hạn có thể là của KEY TRẢ PHÍ.
    # Gán sau khi biết plan (xem cuối hàm).
    out['has'] = bool(st.get('xn_token'))
    out['kind'] = str(st.get('trial_kind') or '')
    out['hwid'] = str(st.get('hwid') or '')
    # Số lượt do start_trial() ghi lại sau khi server trả.
    for src, dst in (('quota_left', 'left'), ('quota_total', 'total')):
        v = st.get(src)
        if v is not None:
            try:
                out[dst] = int(v)
            except Exception:
                out[dst] = None
    # ------------------------------------------------------------------
    # LỖI ĐÃ SỬA: "Dùng thử" hiện 28 ngày của KEY TRẢ PHÍ.
    #
    # `expires_at` trong state có thể là hạn của license TRẢ PHÍ
    # (plan='aoe1'…). Trước đây hàm này lấy thẳng nó làm thời gian dùng
    # thử ⇒ màn hình ghi "Dùng thử: còn 10/10 lượt · 28 ngày 20 giờ",
    # trong khi dùng thử chỉ 1 giờ/lượt.
    #
    # Nay: chỉ báo `left_sec` khi license đúng là DÙNG THỬ. Key trả phí
    # có field riêng `paid_left_sec`.
    # ------------------------------------------------------------------
    try:
        _plan = str(st.get('plan') or '').strip().lower()
    except Exception:
        _plan = ''
    if exp:
        _left = max(0, exp - now)
        if _plan == 'trial':
            out['left_sec'] = _left
            out['expires_at'] = exp
        else:
            # Key trả phí: đây KHÔNG phải thời gian dùng thử.
            out['left_sec'] = 0
            out['expires_at'] = 0
            out['paid_left_sec'] = _left
            out['paid_expires_at'] = exp
        out['forever'] = exp <= 0
    out['plan'] = _plan
    return out


# ---------------------------------------------------------------------------
# SỐ LƯỢT DÙNG THỬ CÒN LẠI — hiện thẳng lên app và tự cập nhật
#
# Chủ shop: "hiện rõ còn bao nhiêu lần free ... giới hạn tài nguyên 10 lần".
#
# Số lượt do SERVER đếm (mỗi máy, mỗi sản phẩm một bộ đếm riêng), nên muốn
# đúng thì phải hỏi server. Endpoint /api/trial/left là endpoint CHỈ-ĐỌC:
# hỏi bao nhiêu lần cũng không trừ lượt của khách — nhờ vậy app dám hỏi lại
# liên tục để "cái gì cũng real time".
# ---------------------------------------------------------------------------

# Trần lượt dùng thử của server (settings `trial1h_limit`, mặc định 10 —
# xem src/lib/trial-quota.js dòng 43). CHỈ dùng để hiển thị dạng "N/10" khi
# server không trả số tổng. KHÔNG dùng để tự cấp thêm lượt: chỉ server cấp.
TRIAL_LIMIT_DEFAULT = 10


def trial_hwid():
    """Mã máy dùng để ĐẾM lượt dùng thử (khớp server deriveIds).

    Ưu tiên mã đã lưu trong state: đó chính là giá trị SERVER tính từ phần
    cứng của máy này lúc cấp lượt, nên khớp tuyệt đối. Chỉ khi state chưa có
    mới đọc phần cứng — đọc phần cứng có thể gọi PowerShell, KHÔNG nên chạy
    mỗi 20 giây.
    """
    try:
        import xa_nofog_pro as NF
        st = NF.load_state() or {}
        v = str(st.get('hwid') or '').strip().lower()
        if 8 <= len(v) <= 64 and all(c in '0123456789abcdef' for c in v):
            return v
    except Exception:
        pass
    try:
        return str(_hwid_for('nofog') or '').strip().lower()
    except Exception:
        return ''


def trial_left(product='nofog', kind='1h', timeout=6):
    """Hỏi server CÒN MẤY LƯỢT dùng thử. CHỈ ĐỌC — không trừ lượt.

    GET /api/trial/left?hwid=<mã máy>&kind=1h&product=nofog|xagrant
    (src/routes/trial.js — apiTrialLeft)

    Trả {ok, left, quota, used, product} hoặc {ok: False, code}.
    """
    prod = 'xagrant' if str(product or '').lower() in (
        'xagrant', 'xg', 'grant', 'tai-nguyen', 'tainguyen') else 'nofog'
    hw = trial_hwid()
    if not hw:
        return {'ok': False, 'code': 'no_hwid'}
    q = ('/api/trial/left?hwid=' + urllib.parse.quote(hw)
         + '&kind=' + urllib.parse.quote(str(kind or '1h'))
         + '&product=' + prod)
    d = _get_json(q, timeout=timeout)
    if not isinstance(d, dict):
        return {'ok': False, 'code': 'network'}
    if not d.get('ok'):
        return {'ok': False, 'code': str(d.get('code') or 'network')}
    out = {'ok': True, 'product': prod,
           'left': None, 'quota': None, 'used': None}
    for src, dst in (('left', 'left'), ('quota', 'quota'), ('used', 'used')):
        try:
            v = d.get(src)
            out[dst] = int(v) if v is not None else None
        except Exception:
            out[dst] = None
    return out


def quota_snapshot(product='nofog'):
    """Ảnh chụp số lượt dùng thử của MỘT sản phẩm — để hiện lên app.

    Thứ tự tin cậy: server (chỉ đọc) -> state cục bộ -> không biết.
    KHÔNG bịa số: chỗ nào không biết thì để None và giao diện chỉ nói
    phần chắc chắn (ví dụ chỉ nói còn bao nhiêu thời gian).

    Trả:
      left       : số lượt còn lại (None = không biết)
      total      : tổng lượt của gói (None = không biết)
      left_sec   : lượt đang dùng còn bao nhiêu giây (0 = không còn)
      expires_at : mốc hết hạn của lượt đang dùng (0 = không có)
      has        : máy đã có quyền dùng thử chưa
      source     : 'server' | 'local' | ''
      need_more  : nên hiện nút "Nhận thêm lượt" hay không
    """
    prod = 'xagrant' if str(product or '').lower() in (
        'xagrant', 'xg', 'grant', 'tai-nguyen', 'tainguyen') else 'nofog'
    out = {'ok': False, 'product': prod, 'left': None, 'total': None,
           'used': None, 'left_sec': 0, 'expires_at': 0, 'has': False,
           'source': '', 'need_more': False,
           # Thời lượng MỘT lượt (giây) + nhãn "1 giờ" — để khách biết
           # mình được bao lâu TRƯỚC khi bấm nhận.
           'sec': 0, 'sec_label': ''}

    # ---- 1. State cục bộ (luôn có, không cần mạng) ----
    try:
        fs = free_status() or {}
    except Exception:
        fs = {}
    out['has'] = bool(fs.get('has'))
    out['left_sec'] = int(fs.get('left_sec') or 0)
    out['expires_at'] = int(fs.get('expires_at') or 0)
    if fs.get('left') is not None:
        try:
            out['left'] = int(fs.get('left'))
            out['source'] = 'local'
        except Exception:
            out['left'] = None
    if fs.get('total') is not None:
        try:
            out['total'] = int(fs.get('total'))
        except Exception:
            out['total'] = None

    # ---- 2. Server (chỉ đọc, không trừ lượt) ----
    try:
        r = trial_left(prod)
    except Exception:
        r = {}
    if isinstance(r, dict) and r.get('ok'):
        if r.get('left') is not None:
            out['left'] = int(r['left'])
        # Thời lượng mỗi lượt — server trả `sec` + `sec_label`.
        try:
            if r.get('sec'):
                out['sec'] = int(r['sec'])
        except Exception:
            pass
        try:
            out['sec_label'] = str(r.get('sec_label') or '')
        except Exception:
            pass
        if r.get('quota') is not None:
            out['total'] = int(r['quota'])
        if r.get('used') is not None:
            out['used'] = int(r['used'])
        out['source'] = 'server'
        out['ok'] = True

    if out['total'] is None and out['left'] is not None:
        out['total'] = TRIAL_LIMIT_DEFAULT

    # ---- 3. Có nên hiện "Nhận thêm lượt"? ----
    # Hết sạch lượt VÀ không còn thời gian nào đang chạy.
    out['need_more'] = (out['left'] is not None and out['left'] <= 0
                        and out['left_sec'] <= 0)
    return out


def quota_pair():
    """Số lượt của CẢ HAI sản phẩm: map sáng ('nofog') và tài nguyên ('xagrant').

    Không ném lỗi ra ngoài: chỗ nào hỏng thì để None để giao diện nói thật.
    """
    return {'nofog': quota_snapshot('nofog'),
            'grant': quota_snapshot('xagrant')}


def _prod_key(product):
    """Tên sản phẩm chuẩn hoá: 'nofog' | 'xagrant'."""
    return 'xagrant' if str(product or '').lower() in (
        'xagrant', 'xg', 'grant', 'tai-nguyen', 'tainguyen') else 'nofog'


def quota_from_entitlement(d, product='nofog'):
    """Số lượt dùng thử của MÁY NÀY lấy từ chính câu trả lời /api/entitlement.

    Hợp đồng server (xem khối `trial`): server trả kèm hạn mức dùng thử của
    MÁY đang gọi, tách theo sản phẩm:

        "trial": {
          "nofog": {"left": 3, "total": 10, "leftSec": 1240, "expiresAt": 0},
          "grant": {"left": 10, "total": 10, "leftSec": 0, "expiresAt": 0}
        }

    Có khối này thì KHÔNG phải gọi thêm /api/trial/left (bớt 1 lượt mạng
    mỗi 20 giây). Không có -> trả None để người gọi tự hỏi đường cũ.
    """
    if not isinstance(d, dict) or not d.get('ok'):
        return None
    t = d.get('trial')
    if not isinstance(t, dict):
        return None
    prod = _prod_key(product)
    blk = t.get(prod)
    if not isinstance(blk, dict):
        blk = t.get('grant') if prod == 'xagrant' else None
    if not isinstance(blk, dict):
        # Khối phẳng (không tách theo sản phẩm): dùng chung cho cả hai.
        if 'left' in t or 'total' in t or 'leftSec' in t:
            blk = t
        else:
            return None

    out = {'ok': True, 'product': prod, 'left': None, 'total': None,
           'used': None, 'left_sec': 0, 'expires_at': 0, 'has': False,
           'source': 'server', 'need_more': False}
    # Nhận cả camelCase (`leftSec`/`expiresAt`) lẫn snake_case.
    for src, dst in (('left', 'left'), ('total', 'total'),
                     ('used', 'used'), ('leftSec', 'left_sec'),
                     ('left_sec', 'left_sec'), ('expiresAt', 'expires_at'),
                     ('expires_at', 'expires_at')):
        v = blk.get(src)
        if v is None:
            continue
        try:
            out[dst] = int(v)
        except Exception:
            continue
    try:
        fs = free_status() or {}
    except Exception:
        fs = {}
    out['has'] = bool(fs.get('has'))
    if not out['expires_at']:
        out['expires_at'] = int(fs.get('expires_at') or 0)
    # Cùng luật với quota_snapshot: hết lượt VÀ không còn giờ đang chạy.
    out['need_more'] = (out['left'] is not None and out['left'] <= 0
                        and out['left_sec'] <= 0)
    return out


def fmt_quota(left, total):
    """'7/10' khi biết cả hai · '7' khi chỉ biết số còn · '' khi mù."""
    try:
        if left is None:
            return ''
        l = int(left)
        if total is None:
            return str(l)
        t = int(total)
        if t <= 0:
            return str(l)
        return '%d/%d' % (max(0, l), t)
    except Exception:
        return ''


def fmt_left(sec):
    """Đổi số giây thành câu tiếng Việt ngắn: '2 ngày 3 giờ', '58 phút'."""
    try:
        sec = int(sec)
    except Exception:
        return ''
    if sec <= 0:
        return '0 phút'
    d = sec // 86400
    h = (sec % 86400) // 3600
    m = (sec % 3600) // 60
    if d > 0:
        return '%d ngày %d giờ' % (d, h) if h else '%d ngày' % d
    if h > 0:
        return '%d giờ %d phút' % (h, m) if m else '%d giờ' % h
    return '%d phút' % max(1, m)


def ensure_tokens(d, on_step=None):
    """Bảo đảm token cục bộ khớp với quyền trên TÀI KHOẢN.

    MÔ HÌNH MỚI: không còn key. Quyền nằm ở tài khoản, server trả token đã
    ký khi app gọi /api/trial/session (dùng thử) hoặc /api/account/token
    (đã mua). Hàm này chỉ lo lấy/làm mới token, không bao giờ hỏi khách
    nhập gì.

    Trả (ok, msg). Không ném ra ngoài.
    """
    def say(m):
        if on_step:
            try:
                on_step(m)
            except Exception:
                pass

    if not d or not d.get('ok'):
        return False, 'chưa có quyền'

    if not d.get('hasNofog'):
        return True, ''          # chỉ mua tài nguyên -> không cần token vá

    if token_ok():
        return True, ''          # token còn tốt

    say('Đang lấy quyền từ tài khoản…')

    # ---- Đường duy nhất: lấy token theo TÀI KHOẢN ----
    #
    # Thứ tự: thử /api/account/token trước (khách đã mua — chỉ ĐỌC quyền),
    # nếu chưa có quyền thì mới xin lượt dùng thử 1 ngày.
    try:
        r = fetch_account_token()
    except Exception as e:
        set_last_code('network')
        return False, 'không lấy được quyền: %s' % str(e)[:100]

    if not r.get('ok') and r.get('state') == 'no_entitlement':
        # Chưa mua gì -> xin dùng thử 1 ngày
        try:
            r = start_account_trial()
        except Exception as e:
            set_last_code('network')
            return False, 'không bật được dùng thử: %s' % str(e)[:100]

    if not r.get('ok'):
        set_last_code(r.get('state') or 'error')
        return False, r.get('msg') or 'không lấy được quyền'

    # Nạp lại bảng cổng sau khi có token mới
    try:
        import xa_nofog_pro as NF
        ok2, _m2 = NF._load_sites(None, verbose=False)
        if not ok2:
            return False, 'token mới vẫn không dùng được'
    except Exception:
        return False, 'không nạp được bảng cổng'

    set_last_code('')
    say('Đã có quyền.')
    return True, ''


def _post_json(path, payload, timeout=20):
    """POST JSON, tra (status, dict). Khong raise."""
    import urllib.error
    url = api_base() + path
    data = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(
        url, data=data,
        headers={'Content-Type': 'application/json',
                 'User-Agent': 'xa-arena'})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read().decode('utf-8', 'ignore')
            return r.status, (json.loads(raw) if raw.strip() else {})
    except urllib.error.HTTPError as e:
        try:
            raw = e.read().decode('utf-8', 'ignore')
            return e.code, (json.loads(raw) if raw.strip() else {})
        except Exception:
            return e.code, {}
    except Exception as e:
        return 0, {'ok': False, 'msg': str(e)[:120]}


def ensure_grant_token(d, on_step=None):
    """Bảo đảm có token tài nguyên (bảng địa chỉ engine).

    Thứ tự ĐÚNG (đã kiểm bằng thực nghiệm):
      1. Token sẵn có và còn dùng được  -> xong
      2. /api/xg/activate               -> bind HWID, lấy sid
      3. /api/xg/check                  -> cấp token ký
      4. Ghi token xuống đĩa

    LỖI ĐÃ SỬA: trước đây gọi thẳng /api/xg/check khi license chưa bind
    máy -> server trả 403 session_invalid, không bao giờ lấy được token.

    Trả (ok, msg).
    """
    def say(m):
        if on_step:
            try:
                on_step(m)
            except Exception:
                pass

    if not d or not d.get('ok') or not d.get('hasGrant'):
        return True, ''

    try:
        import xa_grant as XG
    except Exception as e:
        return False, 'không nạp được module tài nguyên: %s' % e

    # ---- 1. Token sẵn có dùng được? ----
    try:
        okE, msgE = XG.ensure_engine(None)
        if okE:
            return True, ''
    except Exception as e:
        msgE = str(e)[:80]

    key = grant_key_of(d)
    if not key:
        # MÔ HÌNH MỚI: không còn key. Quyền tài nguyên nằm ở TÀI KHOẢN.
        #
        # ==================================================================
        # F06 — LỖI ĐÃ SỬA: ĐÂY TỪNG GỌI start_account_trial()
        #
        # Bản cũ gọi THẲNG `start_account_trial()` — tức endpoint DÙNG THỬ
        # (POST /api/trial/session). Endpoint đó KHÔNG phải đường đọc quyền đã
        # mua: nó chạy đồng hồ dùng thử, kiểm "tài khoản đã dùng thử chưa",
        # chặn khi đã dùng rồi, và trả lỗi `trial_expired` / `trial_used_before`.
        #
        # Hệ quả thật với khách ĐÃ TRẢ TIỀN cho gói tài nguyên:
        #   • tài khoản đã dùng thử trước đây  -> nhận `trial_used_before` và
        #     KHÔNG lấy được token dù quyền mua còn nguyên;
        #   • tài khoản đã dùng thử hết 1 ngày -> nhận `trial_expired`;
        #   • khách chỉ mua grant (không có nofog) -> hàm ensure_tokens() ở
        #     trên thoát sớm ở `if not d.get('hasNofog')`, nên đây là ĐƯỜNG
        #     DUY NHẤT lấy token tài nguyên, và nó hỏng đúng với khách đó.
        #
        # Nay: `/api/account/token` trước (CHỈ ĐỌC quyền tài khoản, không chạy
        # đồng hồ, không kiểm lượt thử). Chỉ khi server nói thẳng
        # `no_entitlement` — nghĩa là tài khoản thật sự chưa có quyền nào —
        # mới xin dùng thử.
        #
        # Đây đúng là state machine mà kế hoạch yêu cầu:
        #   session -> snapshot quyền -> token cho tính năng ĐÃ CÓ
        #           -> chỉ start trial nếu chưa có và đủ điều kiện.
        # ==================================================================
        say('Đang lấy quyền tài nguyên từ tài khoản…')
        try:
            r = fetch_account_token()
        except Exception as e:
            set_last_code('network')
            return False, 'không lấy được quyền tài nguyên: %s' % str(e)[:100]

        if not r.get('ok') and r.get('state') == 'no_entitlement':
            # Chưa mua gì -> mới xin dùng thử
            say('Chưa có quyền — đang bật dùng thử…')
            try:
                r = start_account_trial()
            except Exception as e:
                set_last_code('network')
                return False, 'không bật được dùng thử: %s' % str(e)[:100]

        if not r.get('ok'):
            set_last_code(r.get('state') or 'error')
            return False, r.get('msg') or 'không lấy được quyền tài nguyên'

        try:
            okE3, msgE3 = XG.ensure_engine(None)
        except Exception as e:
            return False, str(e)[:100]
        if not okE3:
            return False, msgE3 or 'token tài nguyên mới vẫn không dùng được'
        set_last_code('')
        say('Đã có quyền tài nguyên.')
        return True, ''

    # ---- HWID ----
    hwid = ''
    for name in ('_guard_safe_hwid', 'compute_hwid', 'get_hwid', 'hwid'):
        fn = getattr(XG, name, None)
        if callable(fn):
            try:
                hwid = str(fn() or '').strip().lower()
                if hwid:
                    break
            except Exception:
                continue
    if not hwid:
        return False, 'không đọc được thông tin phần cứng'

    # ---- 2. Activate (bind máy) ----
    say('Đang kích hoạt license…')
    st_a, r_a = _post_json('/api/xg/activate', {'key': key, 'hwid': hwid})
    sid = str((r_a or {}).get('sid') or '')
    if st_a != 200 or not (r_a or {}).get('ok'):
        code = str((r_a or {}).get('code') or '')
        # Đã bind sẵn trên máy này là bình thường -> đi tiếp sang /check
        if code not in ('already_bound', 'session_invalid'):
            return False, 'kích hoạt thất bại: %s' % (
                (r_a or {}).get('msg') or code or ('HTTP %s' % st_a))

    # ---- 3. Check (lấy token) ----
    body = {'key': key, 'hwid': hwid}
    if sid:
        body['sid'] = sid
    st_c, r_c = _post_json('/api/xg/check', body)
    tok = ''
    if st_c == 200 and (r_c or {}).get('ok'):
        tok = str((r_c or {}).get('token') or '')

    if not tok:
        # Thử qua refresh_token của module bảo vệ (nó tự xử lý thêm)
        try:
            import xa_grant_sec as S
            res = S.refresh_token(api_base(), key, hwid, sid or None)
            if isinstance(res, tuple) and len(res) >= 2:
                if res[0]:
                    tok = str(res[1] or '')
            elif isinstance(res, str):
                tok = res
        except Exception:
            pass

    if not tok:
        code = str((r_c or {}).get('code') or '')
        return False, 'không lấy được token: %s' % (
            (r_c or {}).get('msg') or code or ('HTTP %s' % st_c))

    if not tok.startswith('xg1.'):
        return False, 'token nhận được không đúng định dạng'

    # ---- 4. Ghi ----
    try:
        XG.write_token(tok)
    except Exception as e:
        return False, 'không ghi được token: %s' % str(e)[:80]

    try:
        okE2, msgE2 = XG.ensure_engine(None)
    except Exception as e:
        return False, str(e)[:100]
    if not okE2:
        return False, msgE2 or 'token mới vẫn không dùng được'

    say('Đã kích hoạt.')
    return True, ''


def feature_summary(d):
    """Chuỗi ngắn để hiện trên giao diện."""
    if not d or not d.get('ok'):
        return 'Chưa có quyền'
    f = d.get('features') or []
    if not f:
        return 'License không hợp lệ'
    names = {'nofog': 'Map sáng', 'grant': 'Tài nguyên'}
    return ' + '.join(names.get(x, x) for x in f)
