# -*- coding: utf-8 -*-
"""xa_trial_rules.py — QUY TẮC DÙNG THỬ (thuần logic).

================================================================================
VÌ SAO CÓ FILE NÀY
================================================================================
`xa_arena_gui.py` từng là 4400 dòng, trong đó có ~200 dòng quy tắc dùng thử
trộn lẫn với mã giao diện Qt. Hệ quả:

  - Không test được nếu không dựng Qt (chậm, hay lỗi font offscreen).
  - File quá to nên khi sửa rất dễ chạm nhầm chỗ khác.
  - Các lỗi "cái được cái không" trước đây đều nằm ở phần quy tắc này.

Nay quy tắc nằm RIÊNG ở đây, không import Qt, không gọi mạng. GUI chỉ gọi
hàm và hiển thị kết quả.

================================================================================
MÔ HÌNH NGHIỆP VỤ (đọc kỹ trước khi sửa)
================================================================================
Có HAI sản phẩm, mỗi sản phẩm có bộ đếm lượt dùng thử RIÊNG:

    'nofog'   -> Map sáng
    'xagrant' -> Tài nguyên

Một license dùng thử chỉ cấp MỘT quyền. Nên khách thường chỉ thấy một khối.
Đó là lý do phải có `missing_product()` và `trial_claimable()`: để giao diện
mời khách lấy nốt sản phẩm còn thiếu thay vì im lặng ẩn đi.
"""

# ---------------------------------------------------------------------------
# Hằng số sản phẩm
# ---------------------------------------------------------------------------
PRODUCT_NOFOG = 'nofog'
PRODUCT_GRANT = 'xagrant'

# Nhãn hiển thị — dùng chung, không viết lại ở GUI.
PRODUCT_LABEL = {
    PRODUCT_NOFOG: 'Map sáng',
    PRODUCT_GRANT: 'Tài nguyên',
}

# Ngưỡng "sắp hết" để đổi màu cảnh báo.
WARN_LEFT = 2


def norm_product(value):
    """Chuẩn hoá đầu vào về 'nofog' | 'xagrant'."""
    v = str(value or '').strip().lower()
    if v in (PRODUCT_GRANT, 'xg', 'grant', 'tai-nguyen', 'tainguyen'):
        return PRODUCT_GRANT
    return PRODUCT_NOFOG


def quota_of(quota, which):
    """Số lượt còn lại của một sản phẩm. None = không biết.

    `quota` là dict ảnh chụp (có khoá 'left'). Không bao giờ ném lỗi:
    giao diện gọi hàm này mỗi giây, một exception sẽ làm đứng đồng hồ.
    """
    try:
        if not isinstance(quota, dict):
            return None
        v = quota.get('left')
        return None if v is None else int(v)
    except Exception:
        return None


def missing_product(has_nofog, has_grant):
    """Máy này còn THIẾU ít nhất một sản phẩm?"""
    return (not bool(has_nofog)) or (not bool(has_grant))


def trial_claimable(has_nofog, has_grant, q_nofog, q_grant):
    """Còn lượt dùng thử cho sản phẩm mà máy này CHƯA có quyền?

    LỖI UX ĐÃ SỬA ("không có cộng gỗ thịt vàng"): nút "Nhận thêm lượt"
    trước đây chỉ hiện khi ĐÃ HẾT lượt. Khách còn 10/10 lượt tài nguyên
    nhưng thiếu quyền tài nguyên ⇒ không có nút ⇒ không bao giờ bật được
    dùng thử tài nguyên.

    `q_*` = None nghĩa là CHƯA BIẾT (chưa hỏi server) — vẫn cho phép xin,
    vì thà cho bấm còn hơn bắt khách chờ.
    """
    n = bool(has_nofog)
    g = bool(has_grant)
    if n and g:
        return False
    if not n and (q_nofog is None or int(q_nofog) > 0):
        return True
    if not g and (q_grant is None or int(q_grant) > 0):
        return True
    return False


def more_product(has_nofog, has_grant, pref=''):
    """Nên xin dùng thử sản phẩm NÀO?

    Ưu tiên sản phẩm KHÁC với cái đang có:

        đang có tài nguyên, thiếu map sáng -> 'nofog'
        đang có map sáng, thiếu tài nguyên -> 'xagrant'
        thiếu cả hai                      -> theo `pref` khách chọn
        đã có cả hai                      -> 'nofog' (không dùng tới)

    LỖI UX ĐÃ SỬA: trước đây mặc định 'nofog'. Khách đang dùng tài nguyên
    bấm "Nhận thêm lượt" lại nhận DÙNG THỬ MAP SÁNG — đúng thứ không cần.
    """
    n = bool(has_nofog)
    g = bool(has_grant)
    if g and not n:
        return PRODUCT_NOFOG
    if n and not g:
        return PRODUCT_GRANT
    p = str(pref or '').strip().lower()
    if p in (PRODUCT_NOFOG, PRODUCT_GRANT):
        return p
    return PRODUCT_NOFOG


def quota_role(left):
    """Màu cho số lượt: ok / warn / err."""
    if left is None:
        return 'dim'
    try:
        v = int(left)
    except Exception:
        return 'dim'
    if v <= 0:
        return 'err'
    if v <= WARN_LEFT:
        return 'warn'
    return 'ok'


def quota_line(which, quota, run_sec=0, fmt_quota=None, fmt_left=None):
    """Một dòng hiển thị cho một sản phẩm.

    Trả (text, role, has_data).

        'Map sáng  ● 10/10'
        'Tài nguyên  ● 9/10 · còn 42 phút'
        'Map sáng  ○ chưa rõ'          (has_data=False -> GUI ẩn dòng)

    `fmt_quota`, `fmt_left` được truyền vào để module này KHÔNG phụ thuộc
    `xa_arena_api` (giữ nó thuần logic, test được một mình).
    """
    name = PRODUCT_LABEL.get(which, which)
    q = quota if isinstance(quota, dict) else {}
    left = q.get('left')
    total = q.get('total')

    cnt = ''
    try:
        if fmt_quota is not None:
            cnt = str(fmt_quota(left, total) or '')
    except Exception:
        cnt = ''

    if not cnt:
        # Chưa biết số lượt: chỉ nói phần CHẮC CHẮN (đang có lượt chạy).
        if run_sec and int(run_sec) > 0:
            t = ''
            try:
                if fmt_left is not None:
                    t = str(fmt_left(int(run_sec)) or '')
            except Exception:
                t = ''
            if t:
                return ('%s  ● %s' % (name, t), 'ok', True)
        return ('%s  ○ chưa rõ' % name, 'mute', False)

    role = quota_role(left)
    mark = '○' if role == 'err' else '●'
    txt = '%s  %s %s' % (name, mark, cnt)
    if run_sec and int(run_sec) > 0:
        t = ''
        try:
            if fmt_left is not None:
                t = str(fmt_left(int(run_sec)) or '')
        except Exception:
            t = ''
        if t:
            txt += ' · %s' % t
    return (txt, role, True)


def sec_label(quotas):
    """Nhãn "1 lượt = 1 giờ" lấy từ ảnh chụp server (khoá 'sec_label').

    Trả '' nếu chưa biết — KHÔNG bịa. GUI để trống khi rỗng.
    """
    for q in quotas or ():
        try:
            if isinstance(q, dict) and q.get('sec_label'):
                return str(q['sec_label'])
        except Exception:
            continue
    return ''


def trial_card_visible(has_nofog_ready, has_grant_ready, kicked=False):
    """Có hiện khối DÙNG THỬ không?

    Ẩn khi: bị đá sang máy khác (không còn quyền tài khoản), hoặc đã dùng
    được CẢ HAI chức năng trả phí (không còn gì để mời).
    """
    if kicked:
        return False
    return not (bool(has_nofog_ready) and bool(has_grant_ready))


def primary_buttons(has_nofog_ready, has_grant_ready, free_over,
                    claimable, missing):
    """Nút chính nên hiện gì?

    Trả (need_more, need_buy):

        need_more : hiện "Nhận thêm lượt"  (còn lượt cho sản phẩm chưa có)
        need_buy  : hiện "Mua"             (hết lượt, hoặc chưa dùng được gì)

    LỖI ĐÃ SỬA: trước đây `need_more = (not ready) and free_over`, mà
    `ready = nofog_ready or grant_ready`. Khách có map sáng (ready=True)
    mà thiếu tài nguyên ⇒ need_more luôn False ⇒ KHÔNG BAO GIỜ có nút
    nhận dùng thử tài nguyên.
    """
    ready = bool(has_nofog_ready) or bool(has_grant_ready)
    need_more = bool(claimable)
    need_buy = (not ready) or (bool(missing) and not need_more)
    return need_more, need_buy
