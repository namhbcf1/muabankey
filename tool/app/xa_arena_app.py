# -*- coding: utf-8 -*-
"""xa_arena_app.py — MỘT app duy nhất cho cả 2 chức năng.

==================  KIẾN TRÚC  ==================

  Trước: 2 EXE riêng
    xa_nofog_pro.exe    bỏ sương mù
    xa_grant.exe        thêm tài nguyên

  Nay: 1 EXE
    Đọc /api/entitlement  ->  biết khách mua gì
      ['nofog']           -> chỉ hiện "Bật map sáng"
      ['grant']           -> chỉ hiện "Cộng tài nguyên"
      ['grant','nofog']   -> hiện cả hai
    Phần khách KHÔNG có quyền thì ẩn hoàn toàn, không cho bấm.

==================  NGUỒN SỰ THẬT  ==================

  Server: src/routes/entitlement.js
    pid = 'xagrant'                 -> grant
    pid = NULL / '' / 'aoe1'        -> nofog
    pid khác                        -> KHÔNG quyền

==================  TÁI DÙNG  ==================

  Không viết lại logic vá game / bơm tài nguyên. App này chỉ là VỎ:
    NoFog : tool/src/xa_nofog_pro.py   (find_game, attach, apply_set, in_match)
    Grant : tool/grant/xa_grant.py      (open_game, do_grant, ensure_engine)

==================  ĐIỂM VÀO  ==================

  Không tham số  -> GUI
  Có cờ         -> chuyển cho tool tương ứng (giữ mọi cờ cũ)
"""

import os
import re
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
for _p in (_HERE,
           os.path.join(_HERE, '..', 'ui'),
           os.path.join(_HERE, '..', 'src'),
           os.path.join(_HERE, '..', 'grant')):
    _p = os.path.abspath(_p)
    if _p not in sys.path:
        sys.path.insert(0, _p)

APP_NAME = 'XA ARENA'
# PHIÊN BẢN — PHẢI TĂNG MỖI LẦN BUILD.
#
# App ép cập nhật bằng cách so số này với EXE_VERSION của server. Bằng nhau
# thì app KHÔNG cập nhật, nên quên tăng = không ai nhận được bản mới.
#
# 3.1.0.0 — BỎ HOÀN TOÀN KEY: quyền theo TÀI KHOẢN, đăng ký ngay trong app,
#           dùng thử 1 ngày cho cả map sáng + tài nguyên.
APP_VERSION = '3.1.0.0'

MUTEX_NAME = 'XArena_AllInOne_v1'


# ---------------------------------------------------------------------------
# Một bản chạy
# ---------------------------------------------------------------------------

def acquire_single_instance():
    """Named mutex toàn máy. None nếu đã có bản khác."""
    import ctypes
    import ctypes.wintypes as wt
    k32 = ctypes.WinDLL('kernel32', use_last_error=True)
    k32.CreateMutexW.restype = wt.HANDLE
    k32.CreateMutexW.argtypes = [ctypes.c_void_p, wt.BOOL, wt.LPCWSTR]
    h = k32.CreateMutexW(None, False, 'Local\\' + MUTEX_NAME)
    if not h:
        return None
    if ctypes.get_last_error() == 183:      # ERROR_ALREADY_EXISTS
        try:
            k32.CloseHandle(h)
        except Exception:
            pass
        return None
    return h


def focus_existing():
    """Đưa cửa sổ đang chạy lên trước."""
    try:
        import ctypes
        u = ctypes.WinDLL('user32', use_last_error=True)
        u.FindWindowW.restype = ctypes.c_void_p
        u.FindWindowW.argtypes = [ctypes.c_wchar_p, ctypes.c_wchar_p]
        for name in (APP_NAME, 'XA ARENA', 'XARENA MAP SÁNG',
                     'XA THÊM TÀI NGUYÊN'):
            hwnd = u.FindWindowW(None, name) or 0
            if hwnd:
                u.ShowWindow(ctypes.c_void_p(hwnd), 9)
                u.SetForegroundWindow(ctypes.c_void_p(hwnd))
                return True
    except Exception:
        pass
    return False


# ---------------------------------------------------------------------------
# Điểm vào
# ---------------------------------------------------------------------------

def _has_cli_args(argv):
    """Có cờ dòng lệnh? (bỏ qua đường dẫn file .py/.exe)

    LỖI ĐÃ SỬA: trước đây chỉ nhận cờ bắt đầu bằng '-' nên `/list` (kiểu
    Windows) không được coi là cờ → app mở thẳng giao diện và chờ, dù
    người dùng gõ sai tham số. Nay nhận cả '/x'.
    """
    for a in argv:
        t = str(a or '')
        if not t:
            continue
        if t.startswith('-'):
            return True
        # '/list' kiểu Windows, nhưng KHÔNG nhầm với đường dẫn '/tmp/x'
        if t.startswith('/') and len(t) > 1 and '\\' not in t \
                and '/' not in t[1:] and not os.path.exists(t):
            return True
    return False


def _updater():
    """Nạp module cập nhật dùng chung."""
    try:
        import xa_update
        return xa_update
    except Exception:
        return None


def _is_onefile_temp(p):
    """Duong dan co nam trong thu muc giai nen tam cua Nuitka?"""
    try:
        low = p.replace('/', chr(92)).lower()
        return (chr(92) + 'onefile_') in low
    except Exception:
        return False


def exe_path():
    """Duong dan TUYET DOI cua file .exe nguoi dung that su bam.

    DA DO BANG THUC NGHIEM (Nuitka 2.x, --onefile):
        sys.frozen      = False            <-- KHONG phai True
        sys.executable  = TEMP/onefile_<pid>_.../python.exe
        sys.argv[0]     = <thu muc that>/xa_arena.exe   <-- DUNG

    LOI DA SUA: code cu doi sys.frozen phai True nen LUON tra ''
    -> update_enforce() coi nhu "chay bang python" -> khong bao gio
    ep cap nhat. Day chinh la ly do update tu 1.7.1.0 khong chay.
    """
    try:
        a0 = sys.argv[0] if sys.argv else ''
        if a0 and a0.lower().endswith('.exe'):
            ap = os.path.abspath(a0)
            if os.path.exists(ap) and not _is_onefile_temp(ap):
                return ap
        p = sys.executable or ''
        if p.lower().endswith('.exe') and not _is_onefile_temp(p):
            ap = os.path.abspath(p)
            if (os.path.exists(ap)
                    and os.path.basename(ap).lower() != 'python.exe'):
                return ap
        return ''
    except Exception:
        return ''


def _status_box(msg):
    """Hop thoai Windows goc hien tien trinh khi CHUA co GUI.

    enforce_update() chay TRUOC khi mo cua so, nen khong dung
    duoc PyQt de bao tien trinh.
    """
    try:
        import ctypes
        ctypes.windll.user32.MessageBoxW(None, str(msg), APP_NAME, 0x40)
    except Exception:
        pass


def _ulog(msg):
    """Vết kỹ thuật của bước cập nhật — CHỈ ghi khi BẬT debug.

    Mặc định KHÔNG tạo file nào trên máy khách: không có XA_DEBUG=1 và
    không có cờ --debug-log thì hàm này là no-op. Khi bật, dòng được che
    key/token/HWID/địa chỉ trước khi ghi (xa_arena_api.debug_log).
    """
    try:
        import xa_arena_api as _API
        _API.debug_log(_API.LOG_UPDATE, msg)
    except Exception:
        pass


class _ProgressBox:
    """Bảng tiến trình nhỏ, KHÔNG modal — hiện % khi tự cập nhật.

    VÌ SAO CẦN: cập nhật tự động tải ~20 MB trong 20–40 giây. Trước đây
    thông báo chỉ ghi ra file nên khách không thấy gì, tưởng app treo,
    tắt đi rồi mở lại — và tải lại từ đầu.

    Dùng PyQt6 (app đã có sẵn): vẽ được chữ, không modal, đóng được
    bằng code. Bản đầu dùng ctypes nhưng cửa sổ không vẽ ra nội dung.
    """

    def __init__(self, title=None):
        self.title = title or APP_NAME
        self._app = None
        self._dlg = None
        self._lbl = None
        self._bar = None

    def _ensure(self):
        if self._dlg is not None:
            return True
        try:
            from PyQt6.QtWidgets import (QApplication, QDialog,
                                         QLabel, QProgressBar,
                                         QVBoxLayout)
            from PyQt6.QtCore import Qt
            self._app = QApplication.instance() or QApplication([])
            d = QDialog()
            d.setWindowTitle(self.title)
            d.setWindowFlags(Qt.WindowType.Window
                             | Qt.WindowType.CustomizeWindowHint
                             | Qt.WindowType.WindowTitleHint
                             | Qt.WindowType.WindowStaysOnTopHint)
            d.setFixedSize(460, 110)
            lay = QVBoxLayout(d)
            lay.setContentsMargins(16, 14, 16, 14)
            lay.setSpacing(10)
            lbl = QLabel('Đang kiểm tra bản mới…')
            lbl.setWordWrap(True)
            bar = QProgressBar()
            bar.setRange(0, 100)
            bar.setValue(0)
            lay.addWidget(lbl)
            lay.addWidget(bar)
            d.show()
            self._app.processEvents()
            self._dlg = d
            self._lbl = lbl
            self._bar = bar
            return True
        except Exception:
            self._dlg = None
            return False

    def show(self):
        self._ensure()

    def set(self, text):
        """Cập nhật chữ + thanh tiến trình theo % trong chuỗi."""
        try:
            if not self._ensure():
                return
            t = str(text)
            self._lbl.setText(t[:160])
            m = re.search(r'(\d{1,3})\s*%', t)
            if m:
                self._bar.setValue(min(100, int(m.group(1))))
            elif 'tải xong' in t.lower():
                self._bar.setValue(100)
            self._app.processEvents()
        except Exception:
            pass

    def close(self):
        try:
            if self._dlg is not None:
                self._dlg.close()
                self._dlg.deleteLater()
                if self._app:
                    self._app.processEvents()
        except Exception:
            pass
        self._dlg = None
        self._lbl = None
        self._bar = None


def _one_box(msg, title=None):
    """Mot hop thoai duy nhat, co tieu de. Dung khi chua co GUI."""
    try:
        import ctypes
        ctypes.windll.user32.MessageBoxW(
            None, str(msg), title or APP_NAME, 0x30)
    except Exception:
        pass


def update_enforce():
    """ÉP CẬP NHẬT trước khi mở GUI.

    Chủ shop: "luôn kiểm tra version trước khi chạy. Thấp hơn thì KHÔNG cho
    chạy, bắt buộc đúng bản mới nhất."

    Trả True  -> được chạy
        False -> đã lên lịch thay file; NGƯỜI GỌI PHẢI THOÁT NGAY
    """
    U = _updater()
    _ulog('enforce: updater=%s' % bool(U))
    if not U:
        _ulog('enforce: KHONG co module cap nhat -> bo qua')
        return True
    exe = exe_path()
    _ulog('enforce: exe_path=%r' % exe)
    if not exe:
        _ulog('enforce: KHONG xac dinh duoc EXE -> bo qua')
        return True
    # ------------------------------------------------------------------
    # TỰ CẬP NHẬT — HIỆN TIẾN TRÌNH, KHÔNG BẮT BẤM.
    #
    # LỖI ĐÃ SỬA: trước đây `on_status=_ulog` chỉ ghi ra file, nên trong
    # 20–40 giây tải 20 MB khách không thấy gì trên màn hình → tưởng app
    # treo, tắt đi, mở lại → tải lại từ đầu.
    #
    # Nay: bảng tiến trình nhỏ, tự hiện %, tự đóng khi xong. Vẫn KHÔNG
    # hỏi, KHÔNG bắt bấm — chỉ để khách biết máy đang làm việc.
    # ------------------------------------------------------------------
    pb = _ProgressBox('%s — đang cập nhật' % APP_NAME)

    def _status(m):
        _ulog(m)
        try:
            pb.set(m)
        except Exception:
            pass

    # App gộp có bản phát hành RIÊNG -> kind 'arena'
    try:
        pb.show()
        st, msg = U.enforce_update(
            'https://xienhl.com', 'arena', APP_VERSION, exe,
            on_status=_status)
    except Exception as e:
        pb.close()
        _ulog('enforce: EXCEPTION %s' % e)
        # Chi tiết vào log; khách chỉ thấy câu cố định (mọi thứ khép kín).
        _ulog('enforce: EXCEPTION %r' % (e,))
        _one_box('Chưa kiểm tra được bản mới.\n'
                 'Kiểm tra mạng rồi mở lại app.')
        return True
    pb.close()
    _ulog('enforce: st=%r msg=%r' % (st, (msg or '')[:120]))

    # ------------------------------------------------------------------
    # LỖI ĐÃ SỬA: trước đây mọi `msg` từ nhánh 'error' bị VỨT ĐI.
    #
    # Khách chỉ thấy app chạy bình thường và KHÔNG biết vì sao không lên
    # được bản mới. Trường hợp tệ nhất: hash sai -> tải đủ 20 MB rồi huỷ,
    # im lặng, và lần mở sau lại tải 20 MB nữa.
    #
    # Nay: hiện ĐÚNG MỘT hộp thoại nêu lý do, rồi vẫn cho chạy (không
    # chặn khách vĩnh viễn chỉ vì lỗi mạng/hash).
    # ------------------------------------------------------------------
    if st == 'error':
        # Không in URL / SHA-256 / cơ chế thay file ra màn hình.
        _ulog('enforce: update fail %r' % ((msg or '')[:200],))
        _one_box('Chưa cập nhật được.\n\n'
                 'App vẫn chạy bản hiện tại (v%s).' % APP_VERSION)
        return True

    # ------------------------------------------------------------------
    # LỖI ĐÃ SỬA: trước đây `return st != 'updating'`. Mọi giá trị lạ (sai
    # chính tả, thêm trạng thái mới...) đều rơi vào True -> main() MỞ GUI
    # trong khi .bat đang thay file = .bat chạy trên EXE còn sống.
    # Nay chỉ đúng một giá trị được coi là "chạy được".
    # ------------------------------------------------------------------
    return st not in ('updating',)


def apply_pending_if_any():
    """Áp dụng bản .new đã tải xong từ lần chạy TRƯỚC (nếu có).

    LỖI ĐÃ SỬA: xa_update.has_pending() được định nghĩa nhưng KHÔNG NƠI NÀO
    gọi. Hệ quả: tải xong 20 MB rồi lần đổi tên thất bại (AV, mất quyền)
    thì file .new nằm đó vĩnh viễn, mỗi lần mở app lại tải 20 MB nữa mà
    không bao giờ cập nhật.

    LỖI ĐÃ SỬA (vòng lặp vô hạn — "cứ chạy đi chạy lại"): hàm này KHÔNG
    ghi log và KHÔNG đếm số lần thử. Nếu .new hợp lệ mà việc thay file
    không bao giờ thành công thì mỗi lần khởi động app lại thoát ngay để
    thay file -> .bat mở lại app -> lại thoát... khách chỉ thấy app nhấp
    nháy, KHÔNG có log, KHÔNG có thông báo. Nay: có log từng bước, có bộ
    đếm (MAX_APPLY_TRIES) và sau đó thì BỎ .new để app chạy bình thường.

    Trả True nếu ĐÃ lên lịch thay (người gọi phải THOÁT).
    """
    U = _updater()
    exe = exe_path()
    if not U or not exe:
        return False
    try:
        if not U.has_pending(exe):
            return False
        _ulog('pending: co ban .new da tai tu lan truoc')
        # Chỉ tin .new nếu kích thước + SHA-256 khớp bản server công bố
        info = U.check('https://xienhl.com', 'arena')
        if not info.get('ok'):
            _ulog('pending: khong hoi duoc server (%r) -> de .new lai'
                  % ((info.get('err') or '')[:120],))
            return False
        pf = U.pending_file(exe)
        srv = info.get('version') or ''
        # ------------------------------------------------------------------
        # BẢN SERVER KHÔNG MỚI HƠN -> .new này vô nghĩa (vd bản dev đang
        # mới hơn server, hoặc server vừa bị hạ phiên bản).
        #
        # LỖI ĐÃ SỬA: trước đây .new cứ khớp hash là thay, kể cả khi nó
        # KHÔNG mới hơn bản đang chạy -> tự hạ cấp app của khách.
        # ------------------------------------------------------------------
        if not U.is_newer(srv, APP_VERSION):
            _ulog('pending: server %r khong moi hon %r -> xoa .new'
                  % (srv, APP_VERSION))
            try:
                os.remove(pf)
            except Exception:
                pass
            return False
        if not U.pending_matches(exe, info):
            # .new hỏng/không khớp -> bỏ, tải lại sau
            _ulog('pending: .new KHONG khop server -> xoa')
            try:
                os.remove(pf)
            except Exception:
                pass
            U.clear_attempts('XAArena')
            return False
        blocked = U.update_block_reason('XAArena', srv)
        if blocked:
            # Đã thử thay mà không vào được -> BỎ, chạy bình thường.
            #
            # LỖI ĐÃ SỬA: KHÔNG clear_attempts ở đây. Xoá bộ đếm thì
            # enforce_update() lại thấy "chưa thử lần nào" -> tải 20 MB ->
            # hẹn thay -> lặp tiếp. Giữ bộ đếm để cả hai đường đều biết
            # là đã bỏ cuộc.
            _ulog('pending: bo qua cap nhat (%s) -> xoa .new' % blocked)
            try:
                os.remove(pf)
            except Exception:
                pass
            return False
        U.note_attempt('XAArena', srv, spawned=True)
        okr, _m = U.apply_and_restart(exe, info=info, app_name='XAArena')
        _ulog('pending: apply_and_restart=%r %r'
              % (okr, (_m or '')[:120]))
        if okr:
            return True
        # apply_and_restart đã xoá .new khi không chạy được script
        U.clear_attempts('XAArena')
        return False
    except Exception as e:
        _ulog('pending: EXCEPTION %r' % (e,))
        return False


def update_on_start():
    """Đếm khởi động để phát hiện bản lỗi -> rollback."""
    U = _updater()
    if not U:
        return 0, False
    try:
        cnt, should = U.on_start('XAArena', exe_path())
        if should:
            _ulog('boot: count=%r -> can quay lui' % (cnt,))
        return cnt, should
    except Exception as e:
        _ulog('boot: EXCEPTION %r' % (e,))
        return 0, False


def update_mark_good():
    U = _updater()
    if U:
        try:
            U.mark_good('XAArena')
        except Exception:
            pass


def rollback_if_needed():
    """Quay lui nếu bản mới hỏng 2 lần liên tiếp."""
    try:
        cnt, should = update_on_start()
        if not should:
            return False
        exe = exe_path()
        if not exe:
            return False
        U = _updater()
        if not U:
            return False
        okr, _m = U.rollback_now(exe, 'XAArena')
        _ulog('rollback: rollback_now=%r %r' % (okr, (_m or '')[:120]))
        return bool(okr)
    except Exception as e:
        _ulog('rollback: EXCEPTION %r' % (e,))
        return False


def update_gate():
    """TOÀN BỘ quyết định cập nhật trước khi mở GUI — một chỗ duy nhất.

    Trả True  -> được mở GUI
        False -> đã hẹn thay file; NGƯỜI GỌI PHẢI os._exit(0) NGAY

    Thứ tự: quay lui nếu bản trước hỏng -> áp dụng .new đã tải -> ép cập nhật.

    VÌ SAO TÁCH RA: `main()` trước đây nhúng cả 3 khối try/except, nên
    KHÔNG thể kiểm thử được chuỗi quyết định (mà lỗi "cứ chạy đi chạy lại"
    nằm đúng ở chuỗi này). Hàm này chỉ gọi các hàm thật ở trên, không mở
    cửa sổ gì, nên test điều khiển được bằng file giả.
    """
    # Kết quả lần thay file TRƯỚC do .bat ghi ra (trước đây hoàn toàn câm)
    try:
        U = _updater()
        if U:
            r = U.read_swap_result('XAArena')
            if r:
                _ulog('swap lan truoc: %s' % r)
    except Exception:
        pass

    try:
        if rollback_if_needed():
            _ulog('gate: da hen QUAY LUI -> thoat')
            return False
    except Exception as e:
        _ulog('gate: rollback EXCEPTION %r' % (e,))

    try:
        if apply_pending_if_any():
            _ulog('gate: da hen THAY FILE -> thoat')
            return False
    except Exception as e:
        _ulog('gate: pending EXCEPTION %r' % (e,))

    try:
        if not update_enforce():
            _ulog('gate: da hen CAP NHAT -> thoat')
            return False
    except Exception as e:
        _ulog('gate: enforce EXCEPTION %r' % (e,))

    return True


def cli_activate_key(key):
    """Kích hoạt MỘT key (bộ cài và khách chạy tay đều dùng).

    Tự nhận loại key bằng cách hỏi server quyền của nó, nên xử lý được
    cả AOE1-/TR- (map sáng) lẫn XAGR- (tài nguyên).

    Trả mã thoát: 0 xong, 4 dữ liệu sai, 5 lỗi mạng.
    """
    key = (key or '').strip()
    if not key:
        print('Thieu key.')
        return 4

    import xa_arena_api as API

    print('Dang kiem tra key...')
    d = API.fetch_by_key(key)
    if not d.get('ok'):
        code = str(d.get('code') or '')
        print('Chưa lấy được quyền. Thử lại.')
        return 4 if code in ('NOT_FOUND', 'NEED_LOGIN_OR_KEY') else 5

    feats = d.get('features') or []
    print('Quyen: %s' % (', '.join(feats) if feats else '(khong co)'))
    if not feats:
        print('LOI: license nay khong cap quyen dung tool.')
        return 4

    ok, msg = API.ensure_tokens(d, on_step=lambda m: print('  %s' % m))
    if not ok:
        print('Chưa lấy được quyền. Thử lại.')
        return 5

    ok2, msg2 = API.ensure_grant_token(d)
    if not ok2:
        print('Chưa lấy được quyền tài nguyên. Thử lại.')
        return 5

    print('XONG.')
    return 0


def _route_cli(args):
    """Chuyển cờ cho tool phù hợp để giữ tương thích.

    --stealth/--grant/--check/--rebind  -> XAGrant
    --once/--off/--dump/--watch/--trial -> NoFog
    Còn lại: thử NoFog trước (nó có nhiều cờ nhất).
    """
    # --key do APP GOP tu xu ly: phai nhan ca 2 loai key san pham.
    if '--key' in args:
        try:
            i = args.index('--key')
            k = args[i + 1] if i + 1 < len(args) else ''
        except Exception:
            k = ''
        return cli_activate_key(k)

    # ------------------------------------------------------------------
    # ALLOWLIST CỜ — KHÔNG chuyển nguyên xi xuống module.
    #
    # LỖI ĐÃ SỬA (rò rỉ nghiêm trọng): `_route_cli` chuyển MỌI cờ xuống
    # `xa_nofog_pro`, mà module đó có các cờ CHẨN ĐOÁN NỘI BỘ. Đo trên
    # EXE phát hành thật:
    #     xa_arena.exe --list   -> in toàn bộ BẢNG VÁ
    #                              <key> 0x<địa chỉ> <byte gốc> -> <byte vá>
    #     xa_arena.exe --dump   -> in trạng thái từng ô nhớ
    #     xa_arena.exe --status -> in 8 ký tự đầu của gate từng license
    # Khách đã mua chỉ cần một lệnh là lấy được toàn bộ cách làm.
    #
    # Nay chỉ chuyển các cờ dành cho khách; cờ chẩn đoán bị từ chối.
    # ------------------------------------------------------------------
    # ------------------------------------------------------------------
    # CHỈ CHẶN CỜ CHẨN ĐOÁN THẬT.
    #
    # LỖI TÔI GÂY RA (đã sửa): tôi từng thêm cả '--grant', '--stealth',
    # '--check', '--rebind', '--hidden' vào danh sách này. Nhưng đó chính
    # là các cờ để KHỞI ĐỘNG MODULE TÀI NGUYÊN (xem `grant_flags` bên
    # dưới). Vì danh sách chặn được kiểm TRƯỚC, module tài nguyên không
    # bao giờ chạy được nữa → bật tài nguyên trong game thì game bị drop.
    #
    # Nay chỉ chặn những cờ THẬT SỰ in ra bí mật (bảng vá, HWID, key,
    # địa chỉ nạp). Các cờ khởi động module phải đi tiếp xuống dưới.
    # ------------------------------------------------------------------
    _DIAG_FLAGS = ('--list', '--dump', '--status-sites', '--sites',
                   '--show-sites', '--hexdump',
                   '/list', '/dump', '/sites', '/hexdump',
                   '--status', '--selftest', '/status', '/selftest',
                   '--off', '--deactivate',
                   '--full', '--watch')
    for a in args:
        if str(a).lower() in _DIAG_FLAGS:
            _ulog('cli: tu choi co chan doan %r' % a)
            # KHÔNG dùng _one_box(): MessageBox là MODAL, chạy không có
            # người ngồi máy (script/CI/kiểm thử) sẽ TREO vô hạn.
            # Đây là đường dòng lệnh -> trả về bằng thông báo trên console.
            try:
                print('Lệnh này không dùng được ở bản dành cho khách.')
            except Exception:
                pass
            return 2

    # ------------------------------------------------------------------
    # ĐỊNH TUYẾN CỜ CLI — PHẢI ĐÚNG MODULE
    #
    # LỖI ĐÃ SỬA (P1): trước đây `--rebind` và `--hidden` nằm trong
    # `grant_flags` nên bị đẩy sang `xa_grant`. Nhưng `xa_grant` KHÔNG xử
    # lý hai cờ này — nó in "Can --check, --grant hoac --stealth" rồi
    # thoát mã 2. Hàm thật `rebind_key()` và nhánh `--rebind` nằm trong
    # `xa_nofog_pro`. Hệ quả: lệnh ĐỔI MÁY của khách không bao giờ chạy.
    #
    # Nay: chỉ --grant/--stealth/--check sang xa_grant;
    #      --rebind/--hidden sang xa_nofog_pro (cùng nhánh mặc định).
    # ------------------------------------------------------------------
    # `--hidden` là cờ CŨ, không module nào xử lý. Đường "ẩn" thật là
    # `--stealth` (record type 0x67/2). Báo rõ thay vì để nó rơi vào
    # NoFog rồi in "tham so khong hop le".
    for a in args:
        if str(a).lower() == '--hidden':
            try:
                print('Cờ --hidden không còn dùng. Dùng --stealth.')
            except Exception:
                pass
            return 2

    grant_flags = ('--grant', '--stealth', '--check')
    for a in args:
        if a in grant_flags:
            import xa_grant as core
            return core.main()
    import xa_nofog_pro as core
    # NoFog dat ten la run(), khong phai main()
    fn = getattr(core, 'main', None) or getattr(core, 'run', None)
    if fn is None:
        print('Khong tim thay diem vao cua NoFog')
        return 1
    return fn()


def diag_update():
    """In chẩn đoán cập nhật. Dùng cho `--diag-update` khi kiểm thử."""
    import json
    out = {}
    U = _updater()
    out['updater_loaded'] = bool(U)
    out['app_version'] = APP_VERSION
    out['exe_path'] = exe_path()
    try:
        out['sys_frozen'] = getattr(sys, 'frozen', 'ABSENT')
        out['sys_executable'] = sys.executable
        out['sys_argv0'] = sys.argv[0] if sys.argv else ''
    except Exception as e:
        out['sys_err'] = str(e)
    if U:
        try:
            info = U.check('https://xienhl.com', 'arena')
            out['server'] = info
            out['is_newer'] = U.is_newer(info.get('version') or '',
                                         APP_VERSION)
        except Exception as e:
            out['check_err'] = str(e)[:200]
        try:
            ex = exe_path()
            out['has_pending'] = U.has_pending(ex) if ex else None
        except Exception as e:
            out['pending_err'] = str(e)[:120]
    txt = json.dumps(out, ensure_ascii=False, indent=1)
    print(txt)
    # File chẩn đoán chỉ ghi khi BẬT debug (mặc định: không để lại gì).
    try:
        import xa_arena_api as _API
        if _API.debug_on():
            with open(_API.log_path('arena_diag.json'),
                      'w', encoding='utf-8') as f:
                f.write(_API.scrub(txt))
    except Exception:
        pass
    return 0


def _force_utf8_stdio():
    """Ép stdout/stderr sang UTF-8 để in được tiếng Việt trên Windows.

    LỖI ĐÃ SỬA (đo trên bản phát hành): `xa_arena.exe --help` trả mã 1 và
    in ra "LOI: 'charmap' codec can't encode character...". Nguyên nhân:
    console Windows mặc định không phải UTF-8, nên `print()` tiếng Việt
    ném UnicodeEncodeError và khách không đọc được hướng dẫn.

    Nay: thử ép UTF-8; nếu không được thì dùng 'replace' để không bao giờ
    ném lỗi. Hàm này KHÔNG được phép làm hỏng khởi động.
    """
    for name in ('stdout', 'stderr'):
        try:
            st = getattr(sys, name, None)
            if st is None:
                continue
            enc = (getattr(st, 'encoding', '') or '').lower()
            if 'utf' in enc:
                continue
            st.reconfigure(encoding='utf-8', errors='replace')
        except Exception:
            pass


def main():
    _force_utf8_stdio()
    args = sys.argv[1:]

    # ------------------------------------------------------------------
    # CÔNG TẮC DEBUG + DỌN DẤU VẾT — chạy TRƯỚC mọi thứ khác.
    #
    # `--debug-log` là cờ CỦA APP, không phải cờ chức năng: phải bỏ khỏi
    # args (và khỏi sys.argv) trước khi _has_cli_args()/_route_cli() nhìn
    # tới, nếu không app sẽ tưởng "có tham số" -> chạy chế độ dòng lệnh
    # thay vì mở giao diện.
    #
    # startup_hygiene() xoá entitlement_key.txt (key plaintext bản cũ) và
    # xoá arena_detail.log / arena_update.log khi debug ĐANG TẮT.
    # ------------------------------------------------------------------
    try:
        import xa_arena_api as _API
        _low = [str(a).lower() for a in args]
        if _API.DEBUG_FLAG in _low:
            _API.set_debug(True)
            # Đặt luôn biến môi trường để module con (xa_grant/nofog) cũng
            # thấy công tắc dù cờ đã bị bỏ khỏi sys.argv.
            os.environ[_API.DEBUG_ENV] = '1'
            args = [a for a in args
                    if str(a).lower() != _API.DEBUG_FLAG]
            if sys.argv:
                sys.argv[:] = [sys.argv[0]] + list(args)
        _API.startup_hygiene()
    except Exception:
        pass

    # Chan doan cap nhat (dung khi kiem thu ban dong goi)
    # ------------------------------------------------------------------
    # `--version` / `-v` / `--help`
    #
    # LỖI ĐÃ SỬA: trước đây các cờ này rơi xuống `_route_cli` rồi vào
    # `xa_nofog_pro`, nơi chúng KHÔNG được biết đến → in
    # "tham so khong hop le: --version" và trả mã 2. Không có cách nào
    # hỏi phiên bản mà không mở giao diện.
    # ------------------------------------------------------------------
    if args and str(args[0]).lower() in ('--version', '-v', '/v', '/version'):
        print(APP_VERSION)
        return 0
    if args and str(args[0]).lower() in ('--help', '-h', '/?', '/help'):
        print('XA ARENA %s' % APP_VERSION)
        print('  (không cần tham số) — mở giao diện')
        print('  --uninstall   gỡ cài đặt')
        print('  --version     in phiên bản')
        return 0

    if '--diag-update' in args:
        return diag_update()

    # ------------------------------------------------------------------
    # GỠ CÀI ĐẶT.
    #
    # LỖI ĐÃ SỬA: trước đây `--uninstall` rơi xuống router cũ và chạy bộ
    # gỡ của NoFog (trỏ C:\Program Files\XArenaNoFog) — có thể xoá NHẦM
    # thư mục của bản cũ. Nay mở đúng bộ gỡ của XA ARENA.
    # ------------------------------------------------------------------
    if '--uninstall' in args:
        try:
            import xa_uninstall as _UN
        except Exception:
            try:
                _one_box('Không tìm thấy bộ gỡ cài đặt.\n'
                         'Mở Start Menu → "Gỡ cài đặt XA ARENA".')
            except Exception:
                pass
            return 1
        return _UN.gui_main(APP_VERSION)

    # --- Có cờ -> chế độ dòng lệnh (giữ nguyên hành vi cũ) ---
    if _has_cli_args(args):
        try:
            return _route_cli(args)
        except SystemExit:
            raise
        except Exception as e:
            _ulog('cli: EXCEPTION %r' % (e,))
            print('Không làm được. Thử lại.')
            return 1

    # --- Chỉ một bản GUI ---
    _mutex = acquire_single_instance()
    if _mutex is None:
        if focus_existing():
            return 0
        try:
            import ctypes
            ctypes.windll.user32.MessageBoxW(
                None,
                'XA ARENA đang chạy rồi.\n'
                'Tìm cửa sổ "XA ARENA" trên taskbar.',
                APP_NAME, 0x40)
        except Exception:
            pass
        return 0

    # --- CỔNG CẬP NHẬT (quay lui / .new chờ sẵn / ép bản mới) ---
    #
    # LỖI ĐÃ SỬA: trước đây là 3 khối try/except rời trong main(), mỗi khối
    # có thể im lặng bỏ qua (pass) và không ghi log. Nay gộp vào
    # update_gate() để (a) kiểm thử được, (b) mọi nhánh đều ghi log.
    #
    # Trả False = app đã hẹn thay file -> PHẢI THOÁT, .bat mới thay được
    # EXE (Windows không cho ghi vào file .exe đang chạy).
    try:
        if not update_gate():
            os._exit(0)
    except Exception as e:
        _ulog('gate: EXCEPTION ngoai cung %r' % (e,))

    # --- GUI ---
    try:
        import xa_arena_gui as gui
    except ImportError as e:
        try:
            import ctypes
            ctypes.windll.user32.MessageBoxW(
                None, 'Không mở được giao diện.\nCài lại app rồi thử lại.',
            APP_NAME, 0x10)
        except Exception:
            print('LOI GUI:', e)
        return 3

    try:
        return gui.run_gui()
    except Exception as e:
        _ulog('gui: EXCEPTION %r' % (e,))
        try:
            from PyQt6.QtWidgets import QApplication, QMessageBox
            QApplication.instance() or QApplication(sys.argv)
            QMessageBox.critical(None, 'Không mở được giao diện',
                                 'App gặp lỗi. Mở lại app.')
        except Exception:
            pass
        return 1


if __name__ == '__main__':
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except BaseException as e:
        print('LOI:', e)
        sys.exit(1)
