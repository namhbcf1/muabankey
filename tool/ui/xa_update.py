# -*- coding: utf-8 -*-
"""xa_update.py — Tự động cập nhật EXE từ server.

==================  CÁCH HOẠT ĐỘNG  ==================

  1. Gọi /api/app/version lấy {version, sha256, size, urlAbsolute}
  2. So với CLIENT_VERSION của bản đang chạy
  3. Mới hơn -> tải file mới, KIỂM SHA-256 (không khớp = huỷ)
  4. Ghi ra <exe>.new cạnh EXE hiện tại
  5. Sinh script .bat: đợi tiến trình thoát -> chép bản mới đè lên EXE
  6. Thoát app; script thay file và mở lại

==================  VÌ SAO PHẢI QUA .BAT  ==================

Windows KHÔNG cho GHI vào file .exe đang chạy. Nên không thể tự thay mình
khi đang chạy. Phải:
  - ghi bản mới ra tên khác
  - một tiến trình KHÁC (cmd) chờ app thoát rồi chép đè

ĐO THẬT trên Windows 11 (không đoán, xem _scratch/upd-fix/):
    del    <exe đang chạy>            -> "Access is denied."
    copy /y <mới> <exe đang chạy>     -> "being used by another process"
    move /y <mới> <exe đang chạy>     -> "Access is denied."
    move    <exe đang chạy> -> tên mới-> THÀNH CÔNG (Windows cho ĐỔI TÊN)
Vì thế BẮT BUỘC phải ĐỔI TÊN bản cũ đi trước (bước 1), rồi mới đưa bản
mới vào chỗ trống (bước 2). Không có cách nào "ghi đè tại chỗ".
Bù lại: mỗi bước đều có retry và có đường lùi, và script LUÔN mở lại app
(cả khi hỏng) nên khách không bị mất app.

==================  LƯỚI AN TOÀN (rollback)  ==================

Rủi ro thật: nếu bản update bị lỗi (crash ngay khi mở) thì khách kẹt.
Nên trước khi thay:
  - giữ bản cũ thành <exe>.old
  - ghi số lần khởi động vào <state>/boot_count
  - 2 lần hỏng liên tiếp -> tự quay lại <exe>.old

==================  CHỐNG LẶP (quan trọng nhất)  ==================

LỖI THẬT ĐÃ XẢY RA: app "cứ chạy đi chạy lại". Vì mỗi lần khởi động lại
mà bản mới vẫn chưa vào được thì app lại tải 20 MB, lại hẹn thay file,
lại thoát, lại khởi động... KHÔNG CÓ GÌ ĐẾM SỐ LẦN. Nay:

  - `swap_result.txt`: script .bat GHI KẾT QUẢ (ok / fail) ra đĩa, nên
    lần sau app biết lần trước thay được hay không (trước đây câm lặng).
  - `update_state.json`: đếm số lần thử cho MỘT phiên bản server.
    Quá MAX_APPLY_TRIES -> NGHỈ (RETRY_COOLDOWN_SEC) và CHẠY bình thường.
  - `.new` đã tải đúng thì DÙNG LẠI, không tải lại 20 MB.
  - `confirm_installed()`: đầu mỗi lần chạy, nếu SHA-256 của EXE == bản
    vừa cài thì bản mới CHẮC CHẮN chạy được -> xoá `.old` ngay (không để
    khách giữ file 20 MB) và XOÁ BỘ ĐẾM (không rollback oan bản tốt).

==================  GIỚI HẠN  ==================

  - Chỉ nhận EXE từ host trong ALLOWED_HOSTS, phải https
  - SHA-256 phải khớp (chống tải hỏng / sửa trên đường truyền)
  - KHÔNG chống được kẻ chiếm cả Cloudflare VÀ sửa được hash trong EXE
    (đã thống nhất với chủ shop: chấp nhận mức này)
"""

import hashlib
import json
import os
import re
import subprocess
import tempfile
import time
import urllib.parse
import urllib.request

# Chỉ nhận bản cập nhật từ các host này
ALLOWED_HOSTS = ('xienhl.com', 'www.xienhl.com')

# Timeout tải (giây)
DL_TIMEOUT = 300

# Số lần khởi động hỏng liên tiếp thì quay lui
MAX_BAD_BOOTS = 2

# Chạy quá số giây này coi như khởi động THÀNH CÔNG
GOOD_BOOT_SEC = 60

# Tên app dùng cho thư mục trạng thái (LOCALAPPDATA\<tên>)
DEFAULT_APP = 'XAArena'

# Số lần THỬ THAY FILE cho cùng một phiên bản server.
# Quá số này thì nghỉ, KHÔNG tải lại 20 MB mỗi lần mở app.
# 2 = một lần tự động + một lần dự phòng (AV có thể nhả khoá muộn).
MAX_APPLY_TRIES = 2

# Nghỉ bao lâu trước khi thử lại phiên bản đã thất bại (giây).
RETRY_COOLDOWN_SEC = 6 * 3600

# Số vòng retry trong script .bat (mỗi vòng ~1 giây) khi file bị khoá.
BAT_MOVE_RETRIES = 30


# ---------------------------------------------------------------------------
# Đường dẫn trạng thái
# ---------------------------------------------------------------------------

def state_dir(app_name=DEFAULT_APP):
    """Thư mục lưu trạng thái update (cùng chỗ với token/state của tool)."""
    base = os.environ.get('LOCALAPPDATA') or os.environ.get('TEMP') or '.'
    d = os.path.join(base, app_name)
    try:
        os.makedirs(d, exist_ok=True)
    except Exception:
        pass
    return d


def _boot_file(app_name):
    return os.path.join(state_dir(app_name), 'boot_count')


def _read_boot(app_name):
    """Đọc (count, pid_last). Lỗi -> (0, 0)."""
    try:
        with open(_boot_file(app_name), 'r', encoding='utf-8') as f:
            d = json.load(f)
        return int(d.get('count') or 0), int(d.get('pid') or 0)
    except Exception:
        return 0, 0


def _write_boot(app_name, count, pid):
    try:
        with open(_boot_file(app_name), 'w', encoding='utf-8') as f:
            json.dump({'count': int(count), 'pid': int(pid)}, f)
    except Exception:
        pass


def update_state_file(app_name=DEFAULT_APP):
    """File JSON ghi tiến trình cập nhật (số lần thử, bản đã hẹn cài)."""
    return os.path.join(state_dir(app_name), 'update_state.json')


def read_update_state(app_name=DEFAULT_APP):
    try:
        with open(update_state_file(app_name), 'r', encoding='utf-8') as f:
            d = json.load(f)
        return d if isinstance(d, dict) else {}
    except Exception:
        return {}


def _write_update_state(app_name, data):
    try:
        with open(update_state_file(app_name), 'w', encoding='utf-8') as f:
            json.dump(data or {}, f)
    except Exception:
        pass


def swap_result_file(app_name=DEFAULT_APP):
    """File do script .bat ghi kết quả thay file ('ok' / 'fail ...')."""
    return os.path.join(state_dir(app_name), 'swap_result.txt')


def read_swap_result(app_name=DEFAULT_APP):
    """Đọc + XOÁ kết quả lần thay file trước. Trả '' nếu không có."""
    p = swap_result_file(app_name)
    try:
        if not os.path.exists(p):
            return ''
        with open(p, 'r', encoding='utf-8', errors='replace') as f:
            txt = f.read().strip()
    except Exception:
        txt = ''
    try:
        os.remove(p)
    except Exception:
        pass
    return txt


# ---------------------------------------------------------------------------
# Bản mới đã tải sẵn? (do lần chạy trước tải)
# ---------------------------------------------------------------------------

def pending_file(exe_path):
    return exe_path + '.new'


def old_file(exe_path):
    return exe_path + '.old'


def file_sha256(path):
    """SHA-256 của file, '' nếu không đọc được."""
    h = hashlib.sha256()
    try:
        with open(path, 'rb') as f:
            while True:
                b = f.read(1048576)
                if not b:
                    break
                h.update(b)
    except Exception:
        return ''
    return h.hexdigest().lower()


def same_bytes(a, b):
    """Hai file giống hệt nhau (kích thước + SHA-256)?"""
    try:
        if not (a and b and os.path.exists(a) and os.path.exists(b)):
            return False
        if os.path.getsize(a) != os.path.getsize(b):
            return False
    except Exception:
        return False
    return file_sha256(a) == file_sha256(b)


def cleanup_stale(exe_path, app_name=DEFAULT_APP):
    """Xoá file tạm còn sót từ lần trước (.part, .new quá cũ, .old vô dụng).

    VÌ SAO CẦN: tải xong nhưng không thay được file (mất quyền ghi, hoặc
    app bị tắt giữa chừng) sẽ để lại .new. Lần sau app lại tưởng "có bản
    mới chờ thay" và hỏi/thay mãi. Hàm này dọn sạch.

    Giữ lại .new nếu nó CÒN MỚI (< 24 giờ) vì có thể là bản vừa tải xong
    đang chờ khách bấm cập nhật.

    .old: xoá NGAY khi biết nó vô dụng (trùng y nguyên bản đang chạy, hoặc
    bản đang chạy đúng là bản vừa cài). Chỉ khi không chứng minh được mới
    giữ 7 ngày. Trước đây LUÔN giữ 7 ngày nên mỗi lần cập nhật để lại một
    file 20 MB trên máy khách.

    Trả số file đã xoá.
    """
    removed = 0
    # LỖI ĐÃ SỬA: download() tạo '<exe>.new.part' nhưng code cũ tìm
    # '<exe>.part' -> file rác 20 MB không bao giờ được dọn.
    for suffix in ('.new.part', '.part', '.new.tmp'):
        f = exe_path + suffix
        try:
            if os.path.exists(f):
                os.remove(f)
                removed += 1
        except Exception:
            pass

    # .bad (bản lỗi do rollback để lại): xoá khi đã có EXE chạy được
    bad = exe_path + '.bad'
    try:
        if os.path.exists(bad) and os.path.exists(exe_path):
            if time.time() - os.path.getmtime(bad) > 86400:
                os.remove(bad)
                removed += 1
    except Exception:
        pass

    # .new: xoá nếu cũ hơn 24 giờ
    nf = pending_file(exe_path)
    try:
        if os.path.exists(nf):
            age = time.time() - os.path.getmtime(nf)
            if age > 86400:
                os.remove(nf)
                removed += 1
    except Exception:
        pass

    # .old: xoá khi CHẮC CHẮN không còn cần cho rollback.
    of = old_file(exe_path)
    try:
        if os.path.exists(of):
            expendable = False
            st = read_update_state(app_name)
            want = str(st.get('applied_sha') or '').lower()
            if want and file_sha256(exe_path) == want:
                # Bản đang chạy CHÍNH LÀ bản vừa cài -> bản mới đã chạy
                # được, .old không còn giá trị.
                expendable = True
            elif same_bytes(of, exe_path):
                # .old y hệt bản đang chạy -> quay lui cũng chẳng đổi gì.
                expendable = True
            elif time.time() - os.path.getmtime(of) > 7 * 86400:
                expendable = True
            if expendable:
                os.remove(of)
                removed += 1
    except Exception:
        pass
    return removed


def has_pending(exe_path):
    """Có bản mới đã tải, chờ thay không?"""
    return os.path.exists(pending_file(exe_path))


def pending_matches(exe_path, info):
    """File .new đã có ĐÚNG là bản server công bố chưa (kích thước + hash)?"""
    pf = pending_file(exe_path)
    try:
        if not os.path.exists(pf):
            return False
        want_size = int(info.get('size') or 0)
        if want_size <= 0 or os.path.getsize(pf) != want_size:
            return False
        want_sha = str(info.get('sha256') or '').lower()
        if not want_sha:
            return False
        return file_sha256(pf) == want_sha
    except Exception:
        return False


# ---------------------------------------------------------------------------
# Đếm số lần thử thay file — CHỐNG LẶP VÔ HẠN
# ---------------------------------------------------------------------------

def note_attempt(app_name, server_version, spawned=True):
    """Ghi nhận một lần ĐÃ hẹn thay file cho phiên bản này.

    Phải ghi TRƯỚC khi tiến trình thoát (app tự os._exit) — nếu không thì
    lần khởi động sau lại tưởng "chưa thử lần nào" và lặp vô hạn.

    Trả số lần đã thử cho phiên bản này.
    """
    ver = str(server_version or '')
    d = read_update_state(app_name)
    if str(d.get('version') or '') != ver:
        # Phiên bản server mới -> đếm lại từ đầu
        d['version'] = ver
        d['attempts'] = 0
        d['blocked_until'] = 0
    if spawned:
        d['attempts'] = int(d.get('attempts') or 0) + 1
        if int(d['attempts']) >= MAX_APPLY_TRIES:
            d['blocked_until'] = time.time() + RETRY_COOLDOWN_SEC
    _write_update_state(app_name, d)
    return int(d.get('attempts') or 0)


def clear_attempts(app_name):
    d = read_update_state(app_name)
    d['attempts'] = 0
    d['blocked_until'] = 0
    d['version'] = ''
    _write_update_state(app_name, d)
    return d


def update_block_reason(app_name, server_version):
    """Vì sao KHÔNG nên thử cập nhật phiên bản này nữa? '' = được thử."""
    ver = str(server_version or '')
    d = read_update_state(app_name)
    if str(d.get('version') or '') != ver:
        return ''
    tries = int(d.get('attempts') or 0)
    if tries < MAX_APPLY_TRIES:
        return ''
    until = float(d.get('blocked_until') or 0)
    if until and time.time() < until:
        return ('đã thử %d lần cho bản %s' % (tries, ver))
    return ''


def confirm_installed(app_name=DEFAULT_APP, exe_path=None):
    """Bản vừa hẹn cài ĐÃ nằm trên đĩa và ĐANG chạy chưa?

    Ta đang chạy chính file đó, nên hash khớp = bản mới mở được.

    Khớp -> xoá <exe>.old (20 MB, không cần nữa) + xoá bộ đếm khởi động
    hỏng (để không rollback OAN một bản tốt — chính lỗi "cứ chạy đi chạy
    lại" trước đây) + xoá số lần thử.

    Trả (True, ghi_chu) hoặc (False, lý_do).
    """
    if not exe_path or not os.path.exists(exe_path):
        return False, 'khong co EXE'
    d = read_update_state(app_name)
    want = str(d.get('applied_sha') or '').lower()
    if not want:
        return False, 'chua co marker ban moi'
    got = file_sha256(exe_path)
    if not got:
        return False, 'khong bam duoc EXE'
    if got != want:
        return False, 'ban moi chua vao (exe=%s)' % got[:12]

    # ---- BẢN MỚI ĐÃ CHẠY ĐƯỢC ----
    gone = False
    of = old_file(exe_path)
    try:
        if os.path.exists(of):
            os.remove(of)
            gone = True
    except Exception:
        # .old có thể còn bị tiến trình cũ map -> để cleanup_stale dọn sau
        pass
    _write_boot(app_name, 0, 0)
    d['applied_sha'] = ''
    d['applied_size'] = 0
    d['applied_version'] = ''
    d['attempts'] = 0
    d['blocked_until'] = 0
    d['version'] = ''
    _write_update_state(app_name, d)
    return True, 'da cai ban moi, xoa .old=%s' % gone


# ---------------------------------------------------------------------------
# Kiểm tra bản mới
# ---------------------------------------------------------------------------

def check(api_base, kind='nofog', timeout=12):
    """Gọi server lấy thông tin bản mới.

    kind: 'nofog' | 'arena' | 'grant' | 'setup'
    Trả dict {ok, version, sha256, size, url} hoặc {ok: False, err}
    """
    # ------------------------------------------------------------------
    # BỘ CÀI có endpoint RIÊNG: /api/setup/version (không nằm trong
    # /api/app/version). Trả thẳng {ok, version, sha256, size, urlAbsolute}
    # đúng dạng node bên dưới nên dùng lại được toàn bộ phần kiểm tra.
    # ------------------------------------------------------------------
    is_setup = (kind == 'setup')
    try:
        ep = '/api/setup/version' if is_setup else '/api/app/version'
        u = api_base.rstrip('/') + ep
        req = urllib.request.Request(u, headers={'User-Agent': 'xa-updater'})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            data = json.loads(r.read().decode('utf-8'))
    except Exception as e:
        return {'ok': False, 'err': 'khong hoi duoc server: %s' % e}

    if not isinstance(data, dict) or not data.get('ok'):
        return {'ok': False, 'err': 'server tra loi sai'}

    # Mỗi bản phát hành là MỘT field riêng trong /api/app/version:
    #   nofog -> cấu trúc gốc (CHỈ tool NoFog cũ)
    #   grant -> data.grant
    #   arena -> data.arena  (EXE GỘP, có bản phát hành riêng)
    if is_setup:
        node = data            # /api/setup/version trả node ở gốc
    elif kind == 'nofog':
        node = data
    elif kind == 'arena':
        node = data.get('arena') or {}
    else:
        node = data.get('grant') or {}
    if not node:
        return {'ok': False, 'err': 'server khong co thong tin ban %s' % kind}

    url = node.get('urlAbsolute') or ''
    sha = (node.get('sha256') or '').lower()
    size = int(node.get('size') or 0)
    ver = str(node.get('version') or '')

    if not url or not sha or size <= 0:
        return {'ok': False, 'err': 'thong tin ban moi thieu'}

    # Bảo vệ: chỉ https + host cho phép
    try:
        uu = urllib.parse.urlparse(url)
    except Exception:
        return {'ok': False, 'err': 'url sai'}
    if uu.scheme != 'https' or (uu.hostname or '').lower() not in ALLOWED_HOSTS:
        return {'ok': False, 'err': 'url khong duoc phep: %s' % url}

    return {'ok': True, 'version': ver, 'sha256': sha, 'size': size,
            'url': url}


def version_tuple(v):
    """'1.5.0.0' -> (1,5,0,0). Loi -> ()

    LỖI ĐÃ SỬA: trước đây tách theo '.' rồi BỎ các mảnh không phải số.
    Với 'v2.10.0.0' (server lỡ thêm tiền tố 'v') thì mảnh 'v2' bị bỏ ->
    tuple (10,0) -> so với (2,2,0,0) thấy 10 > 2 -> LẦN NÀO CŨNG "có bản
    mới" -> tải lại 20 MB mỗi lần mở app. Nay lấy MỌI cụm số theo đúng
    thứ tự, nên 'v2.10.0.0' -> (2,10,0,0).
    """
    try:
        t = str(v or '').strip()
        if not t:
            return ()
        return tuple(int(x) for x in re.findall(r'\d+', t))
    except Exception:
        return ()


def is_newer(server_ver, client_ver):
    """Server mới hơn client?"""
    a = version_tuple(server_ver)
    b = version_tuple(client_ver)
    if not a or not b:
        return False
    n = max(len(a), len(b))
    a = a + (0,) * (n - len(a))
    b = b + (0,) * (n - len(b))
    return a > b


# ---------------------------------------------------------------------------
# Tải bản mới
# ---------------------------------------------------------------------------

def free_bytes(path):
    """Dung lượng còn trống (byte) của ổ chứa path. -1 nếu không đọc được."""
    try:
        import shutil
        p = path
        # Lên tới thư mục tồn tại gần nhất
        while p and not os.path.exists(p):
            parent = os.path.dirname(p)
            if parent == p:
                break
            p = parent
        return shutil.disk_usage(p).free
    except Exception:
        return -1


def download(info, exe_path, on_progress=None):
    """Tải bản mới ra <exe>.new và kiểm SHA-256.

    Trả (True, '') hoặc (False, ly_do). KHÔNG thay file đang chạy.

    Nếu <exe>.new ĐÃ CÓ và ĐÚNG là bản server công bố thì KHÔNG tải lại.
    VÌ SAO: trước đây mỗi lần mở app lại tải đủ 20 MB, kể cả khi lần trước
    đã tải xong mà chưa thay được file -> "cứ chạy đi chạy lại".
    """
    url = info['url']
    want_sha = info['sha256'].lower()
    want_size = int(info['size'])
    dst = pending_file(exe_path)

    if pending_matches(exe_path, info):
        if on_progress:
            try:
                on_progress(want_size, want_size)
            except Exception:
                pass
        return True, ''

    tmp = dst + '.part'

    # KIỂM DUNG LƯỢNG TRƯỚC KHI TẢI.
    # LỖI ĐÃ SỬA: trước đây tải thẳng; ổ đầy thì ghi được nửa file rồi lỗi
    # khó hiểu, và có thể làm hỏng luôn bản đang chạy nếu đĩa cạn giữa lúc
    # đổi tên.
    free = free_bytes(os.path.dirname(dst) or '.')
    if free >= 0:
        # Cần thêm 20% dư cho an toàn
        need = int(want_size * 1.2)
        if free < need:
            return False, ('ổ đĩa không đủ chỗ: cần %d MB, còn %d MB'
                           % (need // 1048576, free // 1048576))

    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'xa-updater'})
        got = 0
        h = hashlib.sha256()
        with urllib.request.urlopen(req, timeout=DL_TIMEOUT) as r, \
                open(tmp, 'wb') as f:
            while True:
                chunk = r.read(65536)
                if not chunk:
                    break
                f.write(chunk)
                h.update(chunk)
                got += len(chunk)
                if on_progress:
                    try:
                        on_progress(got, want_size)
                    except Exception:
                        pass

        if got != want_size:
            try:
                os.remove(tmp)
            except Exception:
                pass
            return False, 'kich thuoc sai: %d != %d' % (got, want_size)

        if h.hexdigest().lower() != want_sha:
            try:
                os.remove(tmp)
            except Exception:
                pass
            return False, 'SHA-256 khong khop — HUY (co the bi sua)'

        # Đổi tên .part -> .new (nguyen tu)
        try:
            os.replace(tmp, dst)
        except Exception as e:
            return False, 'khong dat duoc ten file: %s' % e
        return True, ''

    except Exception as e:
        for f in (tmp,):
            try:
                os.remove(f)
            except Exception:
                pass
        return False, 'tai that bai: %s' % e


# ---------------------------------------------------------------------------
# Thay file + chạy lại (qua .bat)
# ---------------------------------------------------------------------------

def _bat_path(prefix):
    return os.path.join(tempfile.gettempdir(),
                        '%s_%d.bat' % (prefix, os.getpid()))


def _write_bat(path, lines):
    """Ghi .bat bằng UTF-8 CÓ BOM.

    VÌ SAO ĐỔI (đo thật, xem `_scratch/upd-fix/enc_probe2.py`):
      - ANSI (mbcs): KHÔNG ghi nổi đường dẫn có dấu ngoài bảng mã (vd
        "C:\\Users\\Nguyễn\\..." trên Windows bảng mã US) -> code cũ rơi
        xuống nhánh UTF-8 KHÔNG BOM.
      - UTF-8 không BOM + console bảng mã 437: cmd đọc sai TOÀN BỘ đường
        dẫn -> `move` trượt, không log, lần sau lại thử -> cập nhật không
        bao giờ thành công mà app vẫn "cứ chạy đi chạy lại".
      - UTF-8 CÓ BOM: cmd nhận đúng BOM nên đọc đúng cả khi console 437.
        Đã đo: OK ở cả codepage 437 và 65001.
    """
    txt = '\n'.join(lines) + '\n'
    try:
        with open(path, 'w', encoding='utf-8-sig', newline='\r\n') as f:
            f.write(txt)
        return True, ''
    except Exception:
        pass
    try:
        with open(path, 'w', encoding='mbcs', newline='\r\n') as f:
            f.write(txt)
        return True, ''
    except Exception as e:
        return False, str(e)


def _spawn_bat(bat):
    """Chạy .bat tách rời, không cửa sổ. Trả (True,'') hoặc (False,err)."""
    cflags = 0
    if hasattr(subprocess, 'DETACHED_PROCESS'):
        cflags |= subprocess.DETACHED_PROCESS
    if hasattr(subprocess, 'CREATE_NEW_PROCESS_GROUP'):
        cflags |= subprocess.CREATE_NEW_PROCESS_GROUP
    cflags |= getattr(subprocess, 'CREATE_NO_WINDOW', 0)
    try:
        subprocess.Popen(['cmd', '/c', bat], creationflags=cflags,
                         close_fds=True,
                         stdin=subprocess.DEVNULL,
                         stdout=subprocess.DEVNULL,
                         stderr=subprocess.DEVNULL)
    except Exception as e:
        return False, str(e)
    return True, ''


def _remember_applied(exe_path, info, app_name):
    """Ghi lại 'bản mới sắp cài' để lần khởi động sau biết mà xác nhận."""
    d = read_update_state(app_name)
    sha = ''
    size = 0
    ver = ''
    if info:
        sha = str(info.get('sha256') or '').lower()
        size = int(info.get('size') or 0)
        ver = str(info.get('version') or '')
    if not sha:
        # Gọi từ GUI (không có info) -> tự băm file .new
        pf = pending_file(exe_path)
        sha = file_sha256(pf)
        try:
            size = os.path.getsize(pf)
        except Exception:
            size = 0
    d['applied_sha'] = sha
    d['applied_size'] = size
    d['applied_version'] = ver
    _write_update_state(app_name, d)
    return sha


def apply_and_restart(exe_path, wait_ms=1500, info=None,
                      app_name=DEFAULT_APP):
    """Sinh script thay file rồi thoát app. Trả (True, '') hoặc (False, err).

    Người gọi PHẢI gọi os._exit() / QApplication.quit() ngay sau khi hàm
    này trả True, để script chép đè được (khuyến nghị; Windows cho đổi tên
    file đang chạy nhưng ta vẫn thoát trước cho sạch).

    Script .bat (xem `_swap_lines`) làm đúng thứ tự ĐÃ ĐO:
      1. nếu thiếu .new -> KHÔNG đụng vào bản cũ, chỉ mở lại app
      2. ĐỔI TÊN bản cũ -> .old (bắt buộc: Windows KHÔNG cho ghi/`copy`/
         `move` đè lên file .exe đang chạy, nhưng CHO đổi tên nó đi)
      3. move /y .new vào chỗ trống, RETRY tới BAT_MOVE_RETRIES lần
         (AV có thể giữ file .new vài giây)
      4. nếu bước 3 hỏng -> đưa .old TRỞ LẠI đúng chỗ (khách không mất app)
      5. ghi swap_result.txt = ok / fail... (để lần sau còn biết, có log)
      6. mở lại app (cả khi thất bại, để khách luôn có app dùng)
    """
    new = pending_file(exe_path)
    old = old_file(exe_path)
    if not os.path.exists(new):
        return False, 'khong co ban moi cho thay'

    exe_abs = os.path.abspath(exe_path)
    old_full = os.path.abspath(old)
    new_full = os.path.abspath(new)
    res = swap_result_file(app_name)

    # Ghi marker TRƯỚC khi chạy script: lần khởi động sau dựa vào đây để
    # biết bản mới đã vào hay chưa (và để xoá .old + bộ đếm).
    try:
        _remember_applied(exe_path, info, app_name)
    except Exception:
        pass

    bat = _bat_path('xa_update')
    try:
        init = max(1, int(wait_ms) // 1000)
    except Exception:
        init = 1
    lines = _swap_lines(exe_abs, old_full, new_full, res, init)
    ok, err = _write_bat(bat, lines)
    if not ok:
        return False, 'khong tao duoc script: %s' % err

    ok, err = _spawn_bat(bat)
    if not ok:
        # Không chạy được script -> xoá .new để lần sau không tưởng là
        # còn bản chờ thay (nếu không sẽ lặp vô hạn)
        try:
            os.remove(new)
        except Exception:
            pass
        clear_attempts(app_name)
        return False, 'khong chay duoc script: %s' % err
    return True, ''


def _swap_lines(exe_abs, old_full, new_full, res, init_ping):
    """Nội dung script thay file. Tách riêng để kiểm thử được từng dòng.

    THỨ TỰ BẮT BUỘC (đã đo trên Windows 11, xem đầu file):
        move /y <file mới> <exe đang chạy>  -> "Access is denied"
        copy /y <file mới> <exe đang chạy>  -> "being used by another process"
        move /y <exe đang chạy> <tên trống> -> THÀNH CÔNG
    Nên phải ĐỔI TÊN bản cũ đi trước, rồi mới đưa bản mới vào chỗ trống.
    Mỗi bước đều có retry (AV giữ file vài giây) và có đường lùi:
    nếu bản mới không vào được thì đưa bản cũ về đúng chỗ.
    """
    lines = [
        '@echo off',
        'chcp 65001 >nul 2>&1',
        'setlocal enableextensions',
        'rem Cho tien trinh cu thoat han (moi lan ping ~1 giay)',
        'ping -n %d 127.0.0.1 >nul' % (init_ping + 1),
        'rem Ban moi phai con day du, neu khong thi KHONG dung vao ban cu',
        'if not exist "%s" goto nonew' % new_full,
        'rem (1) doi ten ban cu -> .old  (Khong xoa gi ca)',
        'set "N=0"',
        ':try1',
        'del /f /q "%s" >nul 2>&1' % old_full,
        'move /y "%s" "%s" >nul 2>&1' % (exe_abs, old_full),
        'if not exist "%s" goto renamed' % exe_abs,
        'set /a N+=1',
        'if %%N%% GEQ %d goto giveup' % BAT_MOVE_RETRIES,
        'ping -n 2 127.0.0.1 >nul',
        'goto try1',
        ':giveup',
        '>"%s" echo fail-khong-doi-ten-duoc-exe' % res,
        'rem Chua dong vao gi -> ban cu van nguyen, chi can mo lai',
        'if exist "%s" start "" "%s"' % (exe_abs, exe_abs),
        'goto done',
        'rem (2) dua ban moi vao cho trong',
        ':renamed',
        'move /y "%s" "%s" >nul 2>&1' % (new_full, exe_abs),
        'if exist "%s" goto swapped' % exe_abs,
        '>"%s" echo fail-khong-chep-duoc-ban-moi' % res,
        'rem (3) ban moi that bai -> tra ban cu ve dung cho',
        'move /y "%s" "%s" >nul 2>&1' % (old_full, exe_abs),
        'if not exist "%s" copy /y "%s" "%s" >nul 2>&1' % (
            exe_abs, old_full, exe_abs),
        'if exist "%s" start "" "%s"' % (exe_abs, exe_abs),
        'goto done',
        ':swapped',
        '>"%s" echo ok' % res,
        'start "" "%s"' % exe_abs,
        'goto done',
        ':nonew',
        '>"%s" echo fail-thieu-ban-moi' % res,
        'if exist "%s" start "" "%s"' % (exe_abs, exe_abs),
        ':done',
        'del /f /q "%~f0" >nul 2>&1',
        'endlocal',
    ]
    return lines


# ---------------------------------------------------------------------------
# BẮT BUỘC CẬP NHẬT
#
# Chủ shop: "luôn kiểm tra version trước khi chạy app. Nếu thấp hơn thì KHÔNG
# cho chạy, bắt buộc đúng bản mới nhất. Tự động update, không hỏi."
#
# Cách làm: trước khi mở GUI, hỏi server. Nếu bản này cũ hơn:
#   - tải bản mới (có tiến trình)
#   - thay file + khởi động lại
#   - app hiện tại THOÁT, không cho dùng
#
# Fail-open khi mất mạng: KHÔNG chặn khách (nếu chặn thì mất mạng = không
# dùng được tool, ảnh hưởng khách trả tiền). Chỉ chặn khi BIẾT CHẮC có bản mới.
# ---------------------------------------------------------------------------

def enforce_update(api_base, kind, client_version, exe_path,
                   on_status=None, allow_offline=True,
                   app_name=DEFAULT_APP):
    """Kiểm tra + ép cập nhật. Gọi TRƯỚC khi mở GUI.

    Trả:
      ('ok', None)        -> được chạy (đã mới nhất, hoặc không hỏi được server)
      ('updating', None)  -> đã tải + lên lịch thay file. NGƯỜI GỌI PHẢI THOÁT.
      ('error', msg)      -> lỗi không xử lý được (người gọi nên cảnh báo)
    """

    def say(m):
        if on_status:
            try:
                on_status(m)
            except Exception:
                pass

    if not exe_path or not os.path.exists(exe_path):
        # Chạy bằng python script -> không tự cập nhật được
        return 'ok', None

    say('Đang kiểm tra phiên bản…')
    info = check(api_base, kind)
    if not info.get('ok'):
        # Không hỏi được server
        if allow_offline:
            say('Không kiểm tra được phiên bản — vẫn chạy.')
            return 'ok', None
        return 'error', info.get('err') or 'không kiểm tra được phiên bản'

    srv = info.get('version') or ''
    if not is_newer(srv, client_version):
        # Bản này đã mới nhất (hoặc mới hơn server, vd bản dev)
        return 'ok', None

    # ------------------------------------------------------------------
    # ĐÃ THỬ THAY FILE MÀ KHÔNG VÀO ĐƯỢC -> NGHỈ, ĐỪNG TẢI LẠI 20 MB.
    #
    # VÌ SAO: nếu quyền ghi/mở file bị chặn (C:\Program Files, AV), mỗi
    # lần mở app lại tải 20 MB, lại thoát, lại khởi động -> "cứ chạy đi
    # chạy lại". Đây là lỗi thật của khách. Nay có bộ đếm + thời gian nghỉ;
    # bản server MỚI hơn thì tự thử lại ngay.
    # ------------------------------------------------------------------
    blocked = update_block_reason(app_name, srv)
    if blocked:
        say('Bỏ qua cập nhật (%s) — vẫn chạy bản hiện tại.' % blocked)
        return 'ok', None

    # ---- CÓ BẢN MỚI: ÉP CẬP NHẬT ----
    say('Có bản mới %s — đang cập nhật…' % srv)

    # ------------------------------------------------------------------
    # GỘP THÔNG BÁO TIẾN TRÌNH.
    #
    # LỖI ĐÃ SỬA: trước đây `say()` chạy mỗi khối 64 KB. Với 20 MB, đó là
    # ~317 lần gọi MessageBoxW — MỖI CÁI LÀ MODAL, đóng băng vòng tải và
    # bắt khách bấm 317 lần. Nay chỉ báo mỗi 10% (tối đa 10 hộp thoại).
    # ------------------------------------------------------------------
    _last = [-1]

    def prog(g, t):
        try:
            pct = int(100 * g / max(1, t))
            if pct >= _last[0] + 10 or pct >= 100:
                _last[0] = pct
                say('Đang tải bản mới… %d%%' % pct)
        except Exception:
            pass

    if pending_matches(exe_path, info):
        # Đã có .new đúng bản này -> không tải lại 20 MB
        say('Đang dùng lại bản đã tải trước đó…')
        okdl, msgdl = True, ''
    else:
        okdl, msgdl = download(info, exe_path, prog)
    if not okdl:
        return 'error', 'tải bản mới thất bại: %s' % msgdl

    say('Đã tải xong — đang khởi động lại…')
    okap, msgap = apply_and_restart(exe_path, info=info, app_name=app_name)
    if not okap:
        return 'error', 'không thay được file: %s' % msgap

    # Đếm NGAY (trước khi tiến trình thoát) để lần sau còn biết đã thử.
    note_attempt(app_name, srv, spawned=True)
    return 'updating', None


# ---------------------------------------------------------------------------
# Đếm khởi động hỏng -> rollback
# ---------------------------------------------------------------------------

def on_start(app_name, exe_path=None):
    """Gọi NGAY khi app khởi động.

    BƯỚC 1 — xác nhận bản mới: nếu EXE đang chạy đúng là bản vừa hẹn cài
    thì bản mới ĐÃ CHẠY ĐƯỢC -> xoá .old, xoá bộ đếm, không đếm gì nữa.
    Đây là chỗ chặn vòng lặp "rollback bản tốt -> tải lại -> rollback":
    trước đây bộ đếm chỉ được xoá bởi mark_good() sau 60 giây mở GUI, nên
    khách mở/đóng nhanh 3 lần là app tự hạ cấp bản đang tốt.

    BƯỚC 2 — chỉ đếm khi THỰC SỰ có file `.old` bên cạnh EXE VÀ .old khác
    nội dung với EXE (tức là có gì đó để quay lui).

    Trả (count, should_rollback).
    """
    exe_path = exe_path or ''
    # --- BƯỚC 1 ---
    if exe_path:
        try:
            okc, _note = confirm_installed(app_name, exe_path)
            if okc:
                return 0, False
        except Exception:
            pass

    # --- BƯỚC 2 ---
    # Không có .old -> chưa từng cập nhật -> không đếm, không rollback.
    if not exe_path or not os.path.exists(old_file(exe_path)):
        _write_boot(app_name, 0, 0)
        return 0, False

    # .old phải có nội dung thật (tránh file 0 byte do lần đổi tên hỏng)
    try:
        if os.path.getsize(old_file(exe_path)) < 1024:
            _write_boot(app_name, 0, 0)
            return 0, False
    except Exception:
        pass

    # .old y hệt EXE -> quay lui cũng chẳng đổi gì -> đừng đếm.
    if same_bytes(old_file(exe_path), exe_path):
        _write_boot(app_name, 0, 0)
        return 0, False

    cnt, _ = _read_boot(app_name)
    cnt += 1
    _write_boot(app_name, cnt, os.getpid())
    should = cnt > MAX_BAD_BOOTS
    return cnt, should


def mark_good(app_name):
    """Gọi khi app đã chạy ổn (sau GOOD_BOOT_SEC). Xoá bộ đếm."""
    _write_boot(app_name, 0, 0)


def rollback_now(exe_path, app_name=DEFAULT_APP):
    """Quay lui: <exe>.old -> <exe>, thoát app.

    Dùng khi on_start() báo should_rollback.
    Trả (True, '') nếu đã lên lịch.

    LỖI ĐÃ SỬA (nguy hiểm): script cũ `del exe` RỒI mới `move .old exe`.
    Nếu bước move hỏng (file .old bị khoá) thì EXE ĐÃ BỊ XOÁ -> khách mất
    app, không log. Nay dùng `copy /y .old exe` (ghi đè tại chỗ), chỉ xoá
    .old SAU KHI đã copy xong, và giữ bản lỗi thành .bad để chẩn đoán.
    """
    old = old_file(exe_path)
    if not os.path.exists(old):
        return False, 'khong co ban cu de quay lui'
    # Không có gì để quay lui nếu .old y hệt bản đang chạy
    if same_bytes(old, exe_path):
        _write_boot(app_name, 0, 0)
        # KHÔNG xoá bộ đếm: nếu bản đang chạy chính là bản lỗi
        # (ví dụ .old trùng vì lần thay trước hỏng), xoá bộ đếm sẽ
        # mở lại vòng tải-lại. Giữ nguyên để `update_block_reason` chặn.
        return False, 'ban cu giong het ban dang chay'

    exe_abs = os.path.abspath(exe_path)
    old_full = os.path.abspath(old)
    bad_full = exe_abs + '.bad'
    res = swap_result_file(app_name)
    bat = _bat_path('xa_rollback')
    lines = [
        '@echo off',
        'chcp 65001 >nul 2>&1',
        'setlocal enableextensions',
        'ping -n 4 127.0.0.1 >nul',
        'if not exist "%s" goto done' % old_full,
        'rem (1) doi ten ban loi -> .bad (giu lai de chan doan, KHONG xoa)',
        'move /y "%s" "%s" >nul 2>&1' % (exe_abs, bad_full),
        'if exist "%s" goto locked' % exe_abs,
        'rem (2) dua ban cu ve dung cho (duong dan dang trong)',
        'move /y "%s" "%s" >nul 2>&1' % (old_full, exe_abs),
        'if exist "%s" goto restored' % exe_abs,
        'rem (3) that bai -> tra lai dung ban dang chay truoc do',
        'move /y "%s" "%s" >nul 2>&1' % (bad_full, exe_abs),
        '>"%s" echo rollback-fail' % res,
        'if exist "%s" start "" "%s"' % (exe_abs, exe_abs),
        'goto done',
        ':restored',
        '>"%s" echo rollback' % res,
        'del /f /q "%s" >nul 2>&1' % bad_full,
        'start "" "%s"' % exe_abs,
        'goto done',
        ':locked',
        '>"%s" echo rollback-fail-exe-dang-khoa' % res,
        'start "" "%s"' % exe_abs,
        ':done',
        'del /f /q "%~f0" >nul 2>&1',
        'endlocal',
    ]
    ok, err = _write_bat(bat, lines)
    if not ok:
        return False, 'khong tao duoc script: %s' % err
    ok, err = _spawn_bat(bat)
    if not ok:
        return False, err
    # ------------------------------------------------------------------
    # KHÔNG XOÁ BỘ ĐẾM SỐ LẦN THỬ.
    #
    # LỖI ĐÃ SỬA (P1): trước đây rollback gọi `clear_attempts()`, tức
    # là xoá cả `attempts` lẫn `blocked_until`. Hệ quả là vòng lặp vô
    # hạn: bản mới lỗi -> rollback -> xoá bộ đếm ->
    # `update_block_reason()` trả '' -> lần sau TẢI LẠI 20 MB ->
    # thay -> lỗi -> rollback -> ... Mỗi vòng tốn 1 lần tải 20 MB và
    # 5 lần khởi động lại.
    #
    # Nay: chỉ reset bộ đếm KHỞI ĐỘNG (bản cũ đã chạy được). Số lần
    # thử và `blocked_until` được GIỮ NGUYÊN, nên `update_block_reason()`
    # chặn việc thay lại đúng bản lỗi đó. Khi server ra version MỚI,
    # `version` trong state khác đi nên việc thử lại được mở.
    # ------------------------------------------------------------------
    _write_boot(app_name, 0, 0)
    return True, ''
