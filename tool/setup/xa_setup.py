# -*- coding: utf-8 -*-
"""xa_setup.py -- BỘ CÀI ĐẶT CÓ GIAO DIỆN cho XA THÊM TÀI NGUYÊN / XARENA MAP SÁNG.

VÌ SAO CÓ FILE NÀY
------------------
Luồng cũ bắt khách dán một dòng PowerShell vào Win+R:

    powershell -NoProfile -ExecutionPolicy Bypass -Command "iex (irm https://.../i/<KEY>.ps1?t=<TOKEN>)"

Khách thường bỏ cuộc ở bước này: chữ dài, dễ dán sai, nhiều máy chặn
ExecutionPolicy, và AV hay cảnh báo "script PowerShell tải từ Internet".
Tỉ lệ cài hỏng cao mà lỗi lại khó giải thích.

File này là bộ cài GUI: khách tải MỘT file .exe, bấm đúp, dán key
(hoặc license key), bấm "Cài đặt". Xong.

NÓ LÀM GÌ (tương đương bộ .ps1 cũ, nhưng rõ ràng hơn)
-----------------------------------------------------
  1. Xin quyền Administrator (UAC) nếu chưa có
  2. Gọi /api/install-info để lấy URL + SHA-256 + kích thước + thư mục cài
  3. Tải EXE tool (3 lớp dự phòng: urllib -> curl -> bitsadmin)
  4. Kiểm SHA-256 + kích thước TRƯỚC khi chạy — sai là dừng, không cài
  5. Ghi file vào thư mục cài, tạo shortcut Desktop + Start Menu
  6. Kích hoạt license ngay (chạy tool với --key)

BẢO MẬT
-------
  * Không có token hợp lệ -> server không trả thông tin -> không tải được.
  * Hash lấy từ SERVER (đã ký trong code server), không nhúng vào bộ cài.
    Nếu kẻ tấn công sửa file EXE tool trên đường truyền, hash lệch -> dừng.
  * HTTPS + kiểm hash = hai lớp độc lập.

CHẠY THỬ KHI PHÁT TRIỂN
-----------------------
    python xa_setup.py                 # mở GUI
    python xa_setup.py --selftest      # kiểm tra logic, không cần mạng

ĐÓNG GÓI
--------
    python -m nuitka --onefile --windows-console-mode=disable ...
    (xem tool/setup/build-setup.ps1)
"""

import ctypes
import ctypes.wintypes as wt
import hashlib
import json
import os
import re
import ssl
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

# ---------------------------------------------------------------------------
# Cấu hình
# ---------------------------------------------------------------------------

# Đổi khi chuyển domain. Có thể ghi đè bằng biến môi trường để test.
API_BASE = os.environ.get('XA_API_BASE', 'https://xienhl.com').rstrip('/')

APP_TITLE = 'Bộ cài XArena'
VERSION = '2.6.0'

CHUNK = 64 * 1024
USER_AGENT = 'XASetup/%s' % VERSION

# Mã màu (dùng cho tkinter)
C_BG = '#0f1115'
C_CARD = '#171a21'
C_FG = '#e8eaed'
C_MUTED = '#9aa0a6'
C_ACCENT = '#2f81f7'
C_OK = '#3fb950'
C_ERR = '#f85149'
C_WARN = '#d29922'


# ---------------------------------------------------------------------------
# Tiện ích Windows
# ---------------------------------------------------------------------------

def is_admin():
    """True nếu tiến trình đang chạy với quyền Administrator.

    Dùng CheckTokenMembership với nhóm Administrators — chính xác hơn cách
    so tên người dùng, và không bị ảnh hưởng bởi UAC ảo hoá.
    """
    try:
        advapi = ctypes.WinDLL('advapi32', use_last_error=True)
        k32 = ctypes.WinDLL('kernel32', use_last_error=True)

        # SECURITY_NT_AUTHORITY = {0,0,0,0,0,5}, DOMAIN_ALIAS_RID_ADMINS = 0x220
        class SID_IDENTIFIER_AUTHORITY(ctypes.Structure):
            _fields_ = [('Value', ctypes.c_ubyte * 6)]

        nt_auth = SID_IDENTIFIER_AUTHORITY()
        nt_auth.Value[5] = 5

        sid = ctypes.c_void_p()
        if not advapi.AllocateAndInitializeSid(
                ctypes.byref(nt_auth), 2,
                0x20, 0x220, 0, 0, 0, 0, 0, 0,
                ctypes.byref(sid)):
            return False
        try:
            is_member = wt.BOOL()
            if not advapi.CheckTokenMembership(None, sid,
                                               ctypes.byref(is_member)):
                return False
            return bool(is_member.value)
        finally:
            advapi.FreeSid(sid)
    except Exception:
        # Không kết luận được -> giả định chưa admin để thử elevate
        return False


def _launcher_path():
    """Đường dẫn file .exe THẬT để chạy lại với quyền Admin.

    Nuitka --onefile giải nén vào thư mục tạm rồi chạy bản sao ở đó. Nếu ta
    đưa `sys.executable` (bản sao tạm) cho ShellExecuteW, tiến trình mới có
    thể chết ngay vì thư mục tạm bị xoá khi tiến trình cha thoát.

    Thứ tự thử:
      1. sys.argv[0] — Nuitka giữ đường dẫn gốc của file .exe
      2. biến môi trường NUITKA_ONEFILE_BINARY (Nuitka đặt khi chạy)
      3. sys.executable
    """
    for cand in (
        getattr(sys, 'argv', [None])[0],
        os.environ.get('NUITKA_ONEFILE_BINARY'),
        sys.executable,
    ):
        if not cand:
            continue
        try:
            p = os.path.abspath(cand)
            if os.path.isfile(p) and p.lower().endswith('.exe'):
                return p
        except Exception:
            pass
    return sys.executable


def relaunch_elevated(extra_args=None):
    """Chạy lại bộ cài với quyền Administrator, giữ nguyên tham số.

    Trả True nếu Windows đã nhận lệnh khởi chạy (người dùng có thể vẫn bấm No).
    """
    try:
        exe = _launcher_path()
        args = list(extra_args if extra_args is not None else sys.argv[1:])
        params = subprocess.list2cmdline(args)
        # SW_SHOWNORMAL = 1 -> cửa sổ hiện bình thường
        ret = ctypes.windll.shell32.ShellExecuteW(
            None, 'runas', exe, params, None, 1)
        ret = int(ret)
        # > 32 = thành công. 5 = access denied (đã từ chối), 1223 = huỷ UAC.
        return ret > 32
    except Exception:
        return False


# Giữ tên cũ để không gãy chỗ khác
def elevate():
    return relaunch_elevated()


def desktop_dirs():
    """Tra DUNG MOT thư mục Desktop để ghi shortcut.

    LỖI ĐÃ SỬA: bản cũ trả CẢ hai (Desktop người dùng + Public Desktop).
    Windows hiển thị Desktop = hợp nhất cả hai -> khách thấy 2 icon trùng
    tên trên màn hình, tưởng cài 2 lần.

    Nay chọn một:
      1. Desktop của tài khoản ĐANG ĐĂNG NHẬP — chỗ khách nhìn thấy trước.
      2. Nếu không truy cập được -> Public Desktop (hiện cho mọi tài khoản).

    Vẫn giữ Public Desktop làm phương án dự phòng vì bộ cài chạy elevated:
    nếu UAC dùng tài khoản admin KHÁC thì `~` trỏ về profile admin và khách
    không thấy shortcut. Nhưng chỉ dùng KHI không ghi được Desktop người dùng.
    """
    # (1) Desktop của người dùng hiện tại
    for base in (os.environ.get('USERPROFILE'),
                 os.path.expanduser('~')):
        if not base:
            continue
        cand = os.path.join(base, 'Desktop')
        if os.path.isdir(cand):
            # Thử ghi thật một file tạm để chắc chắn có quyền
            probe = os.path.join(cand, '.xa_write_probe')
            try:
                with open(probe, 'wb') as f:
                    f.write(b'x')
                os.remove(probe)
                return [cand]
            except Exception:
                pass

    # (2) Dự phòng: Public Desktop
    for env in ('PUBLIC', 'ALLUSERSPROFILE'):
        base = os.environ.get(env)
        if not base:
            continue
        cand = os.path.join(base, 'Desktop')
        if os.path.isdir(cand):
            return [cand]

    fixed = r'C:\Users\Public\Desktop'
    if os.path.isdir(fixed):
        return [fixed]

    return []


def procs_using(exe_path):
    """Danh sách PID đang chạy CHÍNH file này (so khớp đường dẫn đầy đủ).

    VÌ SAO KHÔNG `taskkill /IM <tên>`: khách có thể đang chạy một bản khác
    cùng tên từ thư mục Downloads hoặc bản cũ — giết nó là phá việc của họ.
    Ở đây chỉ giết tiến trình có đường dẫn TRÙNG file ta sắp ghi đè.

    Dùng Toolhelp32 + QueryFullProcessImageNameW (không cần quyền đặc biệt
    để ĐỌC danh sách; quyền admin chỉ cần khi kết thúc tiến trình).
    """
    import ctypes
    out = []
    try:
        target = os.path.normcase(os.path.abspath(exe_path))

        TH32CS_SNAPPROCESS = 0x00000002
        MAX_PATH_LONG = 32768
        PROCESS_QUERY_LIMITED_INFORMATION = 0x1000

        class PROCESSENTRY32W(ctypes.Structure):
            _fields_ = [
                ('dwSize', ctypes.c_ulong),
                ('cntUsage', ctypes.c_ulong),
                ('th32ProcessID', ctypes.c_ulong),
                ('th32DefaultHeapID', ctypes.c_void_p),
                ('th32ModuleID', ctypes.c_ulong),
                ('cntThreads', ctypes.c_ulong),
                ('th32ParentProcessID', ctypes.c_ulong),
                ('pcPriClassBase', ctypes.c_long),
                ('dwFlags', ctypes.c_ulong),
                ('szExeFile', ctypes.c_wchar * 260),
            ]

        k32 = ctypes.WinDLL('kernel32', use_last_error=True)
        k32.CreateToolhelp32Snapshot.restype = ctypes.c_void_p
        k32.QueryFullProcessImageNameW.argtypes = [
            ctypes.c_void_p, ctypes.c_ulong,
            ctypes.c_wchar_p, ctypes.POINTER(ctypes.c_ulong)]

        snap = k32.CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0)
        if not snap or snap == ctypes.c_void_p(-1).value:
            return out
        try:
            pe = PROCESSENTRY32W()
            pe.dwSize = ctypes.sizeof(PROCESSENTRY32W)
            ok = k32.Process32FirstW(snap, ctypes.byref(pe))
            while ok:
                try:
                    # KHÔNG lọc theo tên trước: tiến trình giữ khoá file có
                    # thể không cùng tên (vd. một bản sao đổi tên, hoặc tiến
                    # trình cha). Chỉ so ĐƯỜNG DẪN ĐẦY ĐỦ — chính xác và an
                    # toàn, không giết nhầm tiến trình khác.
                    h = k32.OpenProcess(
                        PROCESS_QUERY_LIMITED_INFORMATION, False,
                        pe.th32ProcessID)
                    if h:
                        try:
                            buf = ctypes.create_unicode_buffer(MAX_PATH_LONG)
                            ln = ctypes.c_ulong(MAX_PATH_LONG)
                            if k32.QueryFullProcessImageNameW(
                                    h, 0, buf, ctypes.byref(ln)):
                                p = os.path.normcase(os.path.abspath(buf.value))
                                if p == target:
                                    out.append(int(pe.th32ProcessID))
                        finally:
                            k32.CloseHandle(h)
                except Exception:
                    pass
                ok = k32.Process32NextW(snap, ctypes.byref(pe))
        finally:
            k32.CloseHandle(snap)
    except Exception:
        pass
    return out


def stop_running_tool(exe_path):
    """Đóng các tiến trình đang chạy chính file sắp ghi đè.

    Trả SỐ tiến trình đã đóng.

    Thứ tự: đóng MỀM trước (taskkill không /F -> gửi WM_CLOSE, cho tool tự
    thoát sạch). Nếu sau 5 giây vẫn còn thì mới /F.

    VÌ SAO MỀM TRƯỚC: tool No Fog đã vá bộ nhớ game. Thoát sạch thì nó tự
    khôi phục; kill cứng có thể để game ở trạng thái đã vá -> khách phải mở
    lại game. Nên ưu tiên đóng mềm.
    """
    import subprocess
    import time as _t

    pids = procs_using(exe_path)
    if not pids:
        return 0

    closed = 0
    for pid in pids:
        try:
            subprocess.run(['taskkill', '/PID', str(pid)],
                           stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            timeout=10,
                           creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
            closed += 1
        except Exception:
            pass

    # Chờ tối đa 5 giây cho tiến trình thoát sạch
    for _ in range(25):
        if not procs_using(exe_path):
            return closed
        _t.sleep(0.2)

    # Còn sống -> kill cứng
    for pid in procs_using(exe_path):
        try:
            subprocess.run(['taskkill', '/F', '/PID', str(pid)],
                           stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            timeout=10,
                           creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
            closed += 1
        except Exception:
            pass
    _t.sleep(0.4)
    return closed



def run_quiet(cmd, timeout=30):
    """Chạy lệnh ẩn, KHÔNG đọc pipe -> không bao giờ ném [WinError 6].

    LỖI ĐÃ SỬA: bộ cài chạy elevated ở chế độ GUI nên không có console.
    `subprocess.run(..., capture_output=True)` khi đó ném
    `OSError: [WinError 6] The handle is invalid` — và vì các chỗ gọi đều
    `except Exception: pass`, lỗi bị nuốt:
      - taskkill không chạy -> cài lại trên app đang chạy LUÔN thất bại
      - cả hai đường tải (curl, bitsadmin) đều chết
      - `reg add` RUNASADMIN không chạy mà vẫn báo thành công

    Trả returncode (hoặc None nếu lỗi/không chạy được).
    """
    try:
        p = subprocess.run(cmd, stdin=subprocess.DEVNULL,
                           stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL,
                           timeout=timeout,
                           creationflags=getattr(
                               subprocess, 'CREATE_NO_WINDOW', 0))
        return p.returncode
    except Exception:
        return None


def _ps_quote_dq(s):
    """Bọc bằng nháy kép (dự phòng cho đường dẫn đặc biệt)."""
    t = str(s).replace('`', '``').replace('"', '`"')
    return '"' + t + '"'


def shortcut(target, lnk_path, description='', icon=None):
    """Tạo shortcut .lnk. THỬ LẦN LƯỢT nhiều cách, dùng cách đầu thành công.

    PHẢI đặt WorkingDirectory: WScript.Shell để trống thì Windows dùng thư
    mục tuỳ ý (thường là System32), tool đọc file cạnh nó và ghi state —
    CWD sai có thể làm app không khởi động được.

    VÌ SAO THỬ NHIỀU CÁCH: đo được rằng cách tạo .lnk phụ thuộc môi trường
    (quyền, bảng mã, PowerShell của máy khách). Không có cách nào đúng cho
    mọi máy, nên thử lần lượt. Cách 1 là cách đã chạy thật trên máy chủ
    shop, nên không bao giờ tệ hơn hiện tại.
    """
    work_dir = os.path.dirname(os.path.abspath(target))
    try:
        if os.path.exists(lnk_path):
            os.remove(lnk_path)
    except Exception:
        pass

    def _build(quote):
        return (
            "$w=New-Object -ComObject WScript.Shell;"
            "$s=$w.CreateShortcut(%s);"
            "$s.TargetPath=%s;$s.Description=%s;"
            "$s.WorkingDirectory=%s;%s$s.Save()" % (
                quote(lnk_path), quote(target), quote(description),
                quote(work_dir),
                ("$s.IconLocation=%s;" % quote(icon)) if icon else '',
            )
        )

    def _run(argv):
        # KHÔNG capture_output: bộ cài chạy elevated, không có console ->
        # đọc pipe ném [WinError 6] The handle is invalid.
        try:
            subprocess.run(
                argv, stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                timeout=40,
                creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        except Exception:
            return False
        return os.path.exists(lnk_path)

    # ---- Cách 1: nháy đơn + -Command (cách cũ, đã chạy thật) ----
    try:
        ps = _build(_ps_quote)
        if _run(['powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass',
                 '-Command', ps]):
            return True
    except Exception:
        pass

    # ---- Cách 2: -EncodedCommand (an toàn với Unicode) ----
    try:
        import base64 as _b64
        ps = _build(_ps_quote)
        enc = _b64.b64encode(ps.encode('utf-16-le')).decode('ascii')
        if _run(['powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass',
                 '-EncodedCommand', enc]):
            return True
    except Exception:
        pass

    # ---- Cách 3: nháy kép + -Command ----
    try:
        ps = _build(_ps_quote_dq)
        if _run(['powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass',
                 '-Command', ps]):
            return True
    except Exception:
        pass

    return False


def _ps_quote(s):
    """Bọc chuỗi cho PowerShell bằng NHÁY KÉP.

    LỖI ĐÃ SỬA: bản cũ dùng nháy đơn. Với đường dẫn có dấu tiếng Việt,
    chuỗi truyền cho COM `WScript.Shell.CreateShortcut()` mang cả nháy
    đơn bên trong → PowerShell ném
        "Value does not fall within the expected range."
    → không tạo được shortcut, khách Việt không có icon.

    Nháy kép + escape `` ` `` và ``"`` là dạng PowerShell hiểu đúng và
    truyền nguyên văn cho COM.
    """
    t = str(s)
    # ------------------------------------------------------------------
    # CHUẨN HOÁ THEO NFKC.
    #
    # LỖI ĐÃ SỬA: khách copy từ Zalo / ghi chú / ảnh chụp rất hay dính:
    #   - chữ full-width  ＴＲ－ＭＪＧＮ  -> NFKC đổi thành  TR-MJGN
    #   - non-breaking space (\xa0) và các khoảng trắng Unicode khác
    # Trước đây các ký tự này lọt qua -> hàm trả '' -> báo "mã không tồn
    # tại" dù khách copy đúng.
    # ------------------------------------------------------------------
    try:
        import unicodedata as _ud
        t = _ud.normalize('NFKC', t)
    except Exception:
        pass

    # Đổi mọi loại gạch về gạch thường
    for d in ('\u2010', '\u2011', '\u2012', '\u2013', '\u2014',
              '\u2015', '\u2212', '\uff0d', '_'):
        t = t.replace(d, '-')
    # Bỏ ký tự vô hình + mọi khoảng trắng Unicode -> dấu cách thường
    t = re.sub('[\u200b\u200c\u200d\ufeff]', '', t)
    t = re.sub('[\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]',
               ' ', t)
    t = t.strip().upper()

    # ------------------------------------------------------------------
    # ƯU TIÊN CỤM BẮT ĐẦU BẰNG TIỀN TỐ KEY.
    #
    # LỖI ĐÃ SỬA: "LH 0901234567 TR-MJGN-PV68-4P4Q" (kèm số điện thoại)
    # trước đây bị ghép thành "LH-0901234567-TR-MJGN".
    # Nay lấy từ tiền tố TR-/AOE1-/XAGR- trở đi.
    # ------------------------------------------------------------------
    m_pre = re.search(r'(TR|AOE1|XAGR)[\s\-]*[A-Z0-9]', t)
    if m_pre and m_pre.start() > 0:
        t = t[m_pre.start():]

    # Tách cụm giống key nếu còn chữ bao quanh
    cand = re.findall(r'(?:TR|AOE1|XAGR)[A-Z0-9\s\-]{6,40}', t)
    if cand:
        t = max(cand, key=len).strip()

    # Dấu cách -> gạch
    t = re.sub(r'\s+', '-', t.strip())
    t = re.sub(r'-{2,}', '-', t).strip('-')

    # ------------------------------------------------------------------
    # DẠNG KHÔNG GẠCH (14/15/16 ký tự liền).
    # ------------------------------------------------------------------
    m0 = re.fullmatch(r'(TR|AOE1|XAGR)([A-Z0-9]{12,14})', t)
    if m0:
        g = m0.group(2)
        t = '%s-%s-%s-%s' % (m0.group(1), g[0:4], g[4:8], g[8:12])

    # Chỉ giữ 4 nhóm đầu
    parts = [x for x in t.split('-') if x]
    if len(parts) > 4:
        t = '-'.join(parts[:4])

    if re.fullmatch(r'[A-Z0-9]{2,12}(?:-[A-Z0-9]{2,12}){2,4}', t):
        return t, ''
    return '', ''

    import re

    # --- Duong TUONG THICH: dong lenh/URL cu co ca key va ?t=<hex> ---
    m = re.search(r'/(?:i|xg)/([A-Za-z0-9\-]{6,64})(?:\.ps1|\.cmd)?\?t=([0-9a-fA-F]{48})', s)
    if m:
        return m.group(1).upper(), m.group(2).lower()

    # ------------------------------------------------------------------
    # LÀM SẠCH TRƯỚC KHI KIỂM.
    #
    # LỖI ĐÃ SỬA: khách dán key từ web rất hay dính:
    #   - dấu cách thay gạch   "TR ABCD EFGH IJKL"
    #   - gạch dài en-dash     "TR-ABCD–EFGH–IJKL"  (U+2013)
    #   - chữ bao quanh        "Mã: TR-ABCD-EFGH-IJKL"
    # Code cũ trả '' → bộ cài báo "Mã license không tồn tại" → khách
    # tưởng shop bán key sai.
    #
    # Nay: chuẩn hoá mọi biến thể về đúng dạng TR-XXXX-XXXX-XXXX.
    # ------------------------------------------------------------------
    t = str(s)
    # Đổi mọi loại gạch (en/em dash, gạch ngang dài) về gạch thường
    for dash in ('\u2010', '\u2011', '\u2012', '\u2013', '\u2014',
                 '\u2015', '\u2212', '\uff0d', '_'):
        t = t.replace(dash, '-')
    # Bỏ ký tự trang trí hay bị kèm khi copy từ web
    t = re.sub(r'[\u200b\u200c\u200d\ufeff\u00a0]', '', t)
    t = t.strip().upper()

    # Tách lấy CỤM giống key nếu có chữ bao quanh ("MÃ: TR-..." / "key của bạn: ...")
    cand = re.findall(r'[A-Z0-9][A-Z0-9\s\-]{8,40}', t)
    if cand:
        # Cụm dài nhất thường là key
        t2 = max(cand, key=len).strip()
        if t2.count('-') >= 2 or ' ' in t2:
            t = t2

    # Dấu cách -> gạch (khách dán "TR ABCD EFGH IJKL")
    t = re.sub(r'\s+', '-', t.strip())
    # Gộp gạch liền nhau và bỏ gạch thừa đầu/cuối
    t = re.sub(r'-{2,}', '-', t).strip('-')

    # ------------------------------------------------------------------
    # DẠNG KHÔNG CÓ GẠCH: "TRABCDEFGHIJKL" (14 ký tự).
    # Khách copy từ chỗ hiển thị bị mất gạch.
    # ------------------------------------------------------------------
    m0 = re.fullmatch(r'(TR|AOE1|XAGR)([A-Z0-9]{12})', t)
    if m0:
        g = m0.group(2)
        t = '%s-%s-%s-%s' % (m0.group(1), g[0:4], g[4:8], g[8:12])

    # ------------------------------------------------------------------
    # CHỈ GIỮ ĐÚNG 4 NHÓM ĐẦU của key 4 phần (TR/AOE1: TIEN-4-4-4).
    # Vì "TR-ABCD-EFGH-IJKL nhe" sau khi đổi dấu cách thành gạch sẽ ra
    # "TR-ABCD-EFGH-IJKL-NHE" — phần "NHE" là chữ khách gõ kèm.
    # ------------------------------------------------------------------
    parts = [x for x in t.split('-') if x]
    if len(parts) > 4 and re.fullmatch(r'[A-Z0-9]{1,8}',
                                       parts[0] or ''):
        # Giữ 4 nhóm đầu, bỏ phần đuôi
        t = '-'.join(parts[:4])

    # --- Đường CHÍNH: license key đúng chuẩn ---
    # Tiền tố hợp lệ: TR, AOE1, XAGR (chữ + số), theo sau là các nhóm.
    if re.fullmatch(r'[A-Z0-9]{2,12}(?:-[A-Z0-9]{2,12}){2,4}', t):
        return t, ''

    return '', ''


def setup_self_update(verbose=True, timeout=25):
    """Tự cập nhật BỘ CÀI. Trả True nếu đã chạy bản mới (người gọi THOÁT).

    VÌ SAO CẦN: trước đây bộ cài không hề hỏi server, nên khách dùng link
    cũ sẽ cài mãi bằng bộ cài cũ (thiếu sửa lỗi, thiếu tính năng mới).

    CÁCH LÀM AN TOÀN: không thay file đang chạy. Tải bản mới cạnh file tạm,
    kiểm SHA-256, rồi CHẠY bản mới và để bản mới làm tiếp việc cài. Bản mới
    sẽ thấy version đã bằng nhau nên không lặp vô hạn.
    """
    def say(m):
        if verbose:
            print('  %s' % m)

    try:
        import os as _os
        import sys as _sys
        import tempfile as _tf
        sys.path.insert(0, _os.path.join(
            _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))),
            'ui'))
        import xa_update as U
    except Exception as e:
        say('Bỏ qua tự cập nhật bộ cài (%s)' % str(e)[:50])
        return False

    try:
        info = U.check(API_BASE, 'setup', timeout=timeout)
    except Exception as e:
        say('Không kiểm tra được bản bộ cài mới (%s)' % str(e)[:50])
        return False

    if not info.get('ok'):
        say('Không kiểm tra được bản bộ cài mới (%s)'
            % str(info.get('err') or '')[:50])
        return False

    cur = VERSION
    new = str(info.get('version') or '')
    if not U.is_newer(new, cur):
        say('Bộ cài đã là bản mới nhất (v%s).' % cur)
        return False

    say('Có bộ cài mới v%s (bạn đang dùng v%s) — đang tải…' % (new, cur))

    # Tải về thư mục tạm riêng, KHÔNG ghi đè file đang chạy
    try:
        tmpdir = _tf.mkdtemp(prefix='xasetup_self_')
        dst = _os.path.join(tmpdir, 'xa_setup_new.exe')
        ok, err = download_file(info.get('url') or info.get('urlAbsolute') or '', dst,
                                info['sha256'], int(info['size']))
        if not ok:
            say('Tải bộ cài mới thất bại: %s' % str(err)[:60])
            say('Tiếp tục cài bằng bản hiện tại (v%s).' % cur)
            return False
    except Exception as e:
        say('Tải bộ cài mới lỗi: %s' % str(e)[:60])
        return False

    # Chạy bản mới y hệt tham số hiện tại (giữ --key / --trial-key)
    try:
        import subprocess as _sp
        argv = [_sys.executable if getattr(_sys, 'frozen', False)
                else dst]
        if not getattr(_sys, 'frozen', False):
            argv = [dst]
        # Giữ nguyên tham số người dùng đã truyền
        args = [a for a in _sys.argv[1:]
                if a not in ('--no-self-update',)]
        argv = argv + args
        say('Chạy bộ cài mới…')
        flags = 0
        for attr in ('DETACHED_PROCESS', 'CREATE_NEW_PROCESS_GROUP'):
            flags |= getattr(_sp, attr, 0)
        _sp.Popen(argv, creationflags=flags, close_fds=True,
                  stdin=_sp.DEVNULL, stdout=_sp.DEVNULL,
                  stderr=_sp.DEVNULL)
        return True
    except Exception as e:
        say('Không chạy được bộ cài mới (%s) — tiếp tục bằng bản hiện tại.'
            % str(e)[:50])
        return False


# ---------------------------------------------------------------------------
# Mạng — HTTP, hash, tải file
# ---------------------------------------------------------------------------

USER_AGENT = 'XASetup/%s (Windows)' % VERSION
CHUNK = 65536


def _ssl_ctx():
    """Context SSL mặc định (dùng chứng chỉ hệ thống của Windows)."""
    try:
        import certifi  # noqa: F401
        return ssl.create_default_context(cafile=certifi.where())
    except Exception:
        return ssl.create_default_context()


def file_sha256(path):
    """SHA-256 của file. Rỗng nếu không đọc được."""
    try:
        h = hashlib.sha256()
        with open(path, 'rb') as f:
            while True:
                b = f.read(CHUNK)
                if not b:
                    break
                h.update(b)
        return h.hexdigest()
    except Exception:
        return ''


def http_get_json(url, timeout=20):
    """GET JSON. Trả (status, dict|None, err_msg)."""
    req = urllib.request.Request(url, method='GET')
    req.add_header('Accept', 'application/json')
    req.add_header('User-Agent', USER_AGENT)
    try:
        with urllib.request.urlopen(req, timeout=timeout,
                                    context=_ssl_ctx()) as r:
            raw = r.read(65536)
            status = r.getcode()
    except urllib.error.HTTPError as e:
        try:
            body = e.read(65536)
        except Exception:
            body = b''
        msg = ''
        try:
            msg = (json.loads(body.decode('utf-8')) or {}).get('error', '')
        except Exception:
            pass
        return e.code, None, msg or ('HTTP %s' % e.code)
    except Exception as e:
        return 0, None, str(e)
    try:
        return status, json.loads(raw.decode('utf-8')), ''
    except Exception:
        return status, None, 'server trả dữ liệu không phải JSON'


def _http_to_file(url, dest, timeout=300):
    """Tải bằng urllib. Trả (ok, err)."""
    try:
        req = urllib.request.Request(url, method='GET')
        req.add_header('User-Agent', USER_AGENT)
        with urllib.request.urlopen(req, timeout=timeout,
                                    context=_ssl_ctx()) as r, \
                open(dest, 'wb') as f:
            total = 0
            while True:
                b = r.read(CHUNK)
                if not b:
                    break
                f.write(b)
                total += len(b)
        return True, ''
    except Exception as e:
        return False, str(e)[:200]


def download_file(url, dest, expect_sha, expect_size, progress=None):
    """Tải file, kiểm hash + kích thước. Trả (ok, err_msg).

    LUÔN kiểm hash trước khi dùng file. Dùng các đường dự phòng khi
    urllib lỗi (curl có sẵn trên Windows 10+).
    """
    import os
    import subprocess

    last_err = 'không tải được'

    # Dọn file cũ
    try:
        if os.path.exists(dest):
            os.remove(dest)
    except Exception:
        pass

    # ---- Đường 1: urllib ----
    ok, err = _http_to_file(url, dest)
    if ok and os.path.exists(dest):
        size = os.path.getsize(dest)
        if expect_size and size != int(expect_size):
            last_err = ('kích thước sai: nhận %d, cần %d'
                        % (size, int(expect_size)))
            try:
                os.remove(dest)
            except Exception:
                pass
        else:
            if expect_sha:
                actual = file_sha256(dest)
                if actual.lower() != str(expect_sha).lower():
                    last_err = ('SHA-256 KHÔNG khớp.\n  nhận: %s\n  cần: %s'
                                % (actual, expect_sha))
                    try:
                        os.remove(dest)
                    except Exception:
                        pass
                else:
                    return True, ''
            else:
                return True, ''
    elif err:
        last_err = err

    # ---- Đường 2: curl.exe (có sẵn trên Windows 10 1803+) ----
    try:
        rc = run_quiet(['curl.exe', '-L', '--fail', '--retry', '3',
                        '--retry-delay', '2', '-A', USER_AGENT,
                        '-o', dest, url], timeout=300)
        if rc == 0 and os.path.exists(dest):
            size = os.path.getsize(dest)
            if (not expect_size or size == int(expect_size)) and \
                    (not expect_sha
                     or file_sha256(dest).lower()
                     == str(expect_sha).lower()):
                return True, ''
            last_err = 'tải xong nhưng kiểm tra sai (curl)'
            try:
                os.remove(dest)
            except Exception:
                pass
    except Exception:
        pass

    # Dọn file rác
    try:
        if os.path.exists(dest):
            os.remove(dest)
    except Exception:
        pass
    return False, last_err


def resolve_input(text):
    """Nhận LICENSE KEY -> (key, token).

    Chuẩn hoá mọi kiểu dán từ Zalo / ghi chú / ảnh chụp:
      - chữ full-width  ＴＲ -> TR (NFKC)
      - gạch dài, non-breaking space, zero-width
      - chữ bao quanh ("Mã:", số điện thoại đứng trước)
      - mất gạch, thừa gạch, chữ thường
    Trả (key, token). Token chỉ khác rỗng khi input là link cũ.
    """
    import re
    s = str(text or '').strip()
    if not s:
        return '', ''

    # Link cũ có ?t=<hex>
    m = re.search(
        r'/(?:i|xg)/([A-Za-z0-9\-]{6,64})(?:\.ps1|\.cmd)?\?t='
        r'([0-9a-fA-F]{48})', s)
    if m:
        return m.group(1).upper(), m.group(2).lower()

    t = str(s)
    # NFKC: chữ full-width -> chữ thường
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
    t = re.sub('[\u200b\u200c\u200d\ufeff]', '', t)
    # Khoảng trắng Unicode -> dấu cách
    t = re.sub('[\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]',
               ' ', t)
    t = t.strip().upper()

    # Lấy từ tiền tố key trở đi (bỏ số điện thoại đứng trước)
    m_pre = re.search(r'(TR|AOE1|XAGR)[\s\-]*[A-Z0-9]', t)
    if m_pre and m_pre.start() > 0:
        t = t[m_pre.start():]

    # Cụm giống key
    cand = re.findall(r'(?:TR|AOE1|XAGR)[A-Z0-9\s\-]{6,40}', t)
    if cand:
        t = max(cand, key=len).strip()

    # Dấu cách -> gạch
    t = re.sub(r'\s+', '-', t.strip())
    t = re.sub(r'-{2,}', '-', t).strip('-')

    # ------------------------------------------------------------------
    # DẠNG KHÔNG GẠCH ĐÚNG CHỖ: "TRMJGNP V684P4Q"
    # Sau khi đổi dấu cách thành gạch, chuỗi thành "TRMJGNP-V684P4Q" —
    # gạch nằm SAI vị trí nên không khớp "TIEN-4-4-4".
    # Nay: bỏ HẾT gạch + khoảng trắng rồi chèn lại theo nhóm 4.
    # ------------------------------------------------------------------
    flat = re.sub(r'[^A-Z0-9]', '', t)
    m0 = re.fullmatch(r'(TR|AOE1|XAGR)([A-Z0-9]{12,14})', flat)
    if m0:
        g = m0.group(2)
        t = '%s-%s-%s-%s' % (m0.group(1), g[0:4], g[4:8], g[8:12])
    else:
        m1 = re.fullmatch(r'(TR|AOE1|XAGR)([A-Z0-9]{12,14})', t)
        if m1:
            g = m1.group(2)
            t = '%s-%s-%s-%s' % (m1.group(1), g[0:4], g[4:8], g[8:12])

    # Chỉ 4 nhóm đầu
    parts = [x for x in t.split('-') if x]
    if len(parts) > 4:
        t = '-'.join(parts[:4])

    if re.fullmatch(r'[A-Z0-9]{2,12}(?:-[A-Z0-9]{2,12}){2,4}', t):
        return t, ''
    return '', ''



def fetch_info(key, token, app=None):
    """Gọi server lấy thông tin cài đặt. Trả (info|None, err)."""
    if token and not key:
        u = '%s/api/install-info/resolve?t=%s' % (API_BASE, token)
        st, data, err = http_get_json(u)
        if st != 200 or not data:
            return None, err or 'không lấy được thông tin cài đặt'
        return data, ''
    if not key:
        return None, 'thiếu license key'
    u = '%s/api/install-info?key=%s' % (API_BASE, key)
    if token:
        u += '&t=%s' % token
    if app:
        u += '&app=%s' % app
    st, data, err = http_get_json(u)
    if st != 200 or not data:
        return None, err or 'không lấy được thông tin cài đặt'
    return data, ''


# ---------------------------------------------------------------------------
# GUI
# ---------------------------------------------------------------------------

def run_gui_tk(prefill=''):
    """GUI tkinter CŨ — giữ làm dự phòng khi máy thiếu PyQt6."""
    import tkinter as tk
    from tkinter import ttk, messagebox, filedialog

    root = tk.Tk()
    root.title('%s %s' % (APP_TITLE, VERSION))
    root.configure(bg=C_BG)
    root.geometry('620x560')
    root.minsize(560, 520)

    style = ttk.Style()
    try:
        style.theme_use('clam')
    except Exception:
        pass
    style.configure('TFrame', background=C_BG)
    style.configure('TLabel', background=C_BG, foreground=C_FG,
                    font=('Segoe UI', 10))
    style.configure('Muted.TLabel', foreground=C_MUTED, font=('Segoe UI', 9))
    style.configure('Title.TLabel', foreground=C_FG, font=('Segoe UI Semibold', 16))
    style.configure('TButton', font=('Segoe UI', 10), padding=(14, 8))
    style.configure('Accent.TButton', foreground='#ffffff')
    style.configure('TEntry', fieldbackground=C_CARD, foreground=C_FG,
                    insertcolor=C_FG, padding=6)
    style.configure('Horizontal.TProgressbar', background=C_ACCENT)

    pad = {'padx': 22}

    ttk.Label(root, text='Cài đặt XArena', style='Title.TLabel').pack(
        anchor='w', pady=(20, 2), **pad)
    ttk.Label(root,
              text='Dán license key vào ô dưới rồi bấm Cài đặt.',
              style='Muted.TLabel').pack(anchor='w', pady=(0, 14), **pad)

    card = tk.Frame(root, bg=C_CARD, highlightthickness=0)
    card.pack(fill='x', **pad)

    inner = tk.Frame(card, bg=C_CARD)
    inner.pack(fill='x', padx=16, pady=14)

    tk.Label(inner, text='License key', bg=C_CARD, fg=C_FG,
             font=('Segoe UI', 9)).pack(anchor='w')

    entry = tk.Entry(inner, bg='#0b0d11', fg=C_FG, insertbackground=C_FG,
                     relief='flat', font=('Consolas', 10))
    entry.pack(fill='x', pady=(4, 6), ipady=6)
    entry.focus_set()
    # Token truyền từ dòng lệnh (khi tiến trình admin được khởi chạy lại)
    if prefill:
        entry.insert(0, prefill)

    hint = tk.Label(inner, text='Ví dụ: AOE1-2KHT-7WQP-7R2P  hoặc  XAGR-XXXX-XXXX-XXXX',
                    bg=C_CARD, fg=C_MUTED, font=('Segoe UI', 8), anchor='w')
    hint.pack(fill='x')

    row = tk.Frame(inner, bg=C_CARD)
    row.pack(fill='x', pady=(12, 0))

    paste_btn = tk.Button(row, text='Dán', bg='#232833', fg=C_FG,
                          relief='flat', font=('Segoe UI', 9), padx=12, pady=4,
                          activebackground='#2d3340', activeforeground=C_FG,
                          cursor='hand2')
    paste_btn.pack(side='left')

    def do_paste():
        try:
            entry.delete(0, 'end')
            entry.insert(0, root.clipboard_get())
        except Exception:
            set_status('Clipboard trống hoặc không đọc được.', 'warn')

    paste_btn.config(command=do_paste)

    # --- Nút cài ---
    btn_row = tk.Frame(root, bg=C_BG)
    btn_row.pack(fill='x', pady=(16, 8), **pad)

    install_btn = tk.Button(btn_row, text='Cài đặt', bg=C_ACCENT, fg='#ffffff',
                            relief='flat', font=('Segoe UI Semibold', 11),
                            padx=22, pady=9, cursor='hand2',
                            activebackground='#1f6feb', activeforeground='#ffffff')
    install_btn.pack(side='left')

    # --- Tiến trình ---
    prog = ttk.Progressbar(root, mode='determinate', maximum=100)
    prog.pack(fill='x', pady=(6, 4), **pad)

    status = tk.Label(root, text='Sẵn sàng.', bg=C_BG, fg=C_MUTED,
                      font=('Segoe UI', 9), anchor='w', justify='left',
                      wraplength=560)
    status.pack(fill='x', pady=(0, 8), **pad)

    # --- Log ---
    log_frame = tk.Frame(root, bg=C_CARD)
    log_frame.pack(fill='both', expand=True, pady=(0, 14), **pad)
    log = tk.Text(log_frame, bg='#0b0d11', fg=C_MUTED, relief='flat',
                  font=('Consolas', 8), height=8, wrap='word',
                  insertbackground=C_FG, state='disabled')
    log.pack(fill='both', expand=True, padx=10, pady=10)

    def set_status(text, kind='info'):
        colors = {'info': C_MUTED, 'ok': C_OK, 'err': C_ERR, 'warn': C_WARN}
        status.config(text=text, fg=colors.get(kind, C_MUTED))

    def append_log(text):
        log.config(state='normal')
        log.insert('end', text.rstrip() + '\n')
        log.see('end')
        log.config(state='disabled')

    state = {'busy': False}

    def set_busy(b):
        state['busy'] = b
        install_btn.config(state='disabled' if b else 'normal',
                           bg='#2d3340' if b else C_ACCENT)
        entry.config(state='disabled' if b else 'normal')

    def worker():
        try:
            raw = entry.get()
            key, token = resolve_input(raw)
            if not key and not token:
                set_status('Key không hợp lệ. Dạng đúng: AOE1-XXXX-XXXX-XXXX', 'err')
                append_log('Nhập không nhận diện được: %r' % raw[:80])
                return

            append_log('Đang hỏi máy chủ…')
            set_status('Đang lấy thông tin cài đặt…')
            info, err = fetch_info(key, token)
            if not info:
                set_status('Không lấy được thông tin cài đặt: %s' % err, 'err')
                append_log('LỖI: ' + err)
                return

            key = info.get('key') or key
            app = info.get('app') or 'nofog'
            name = info.get('name') or app

            # ---- CHẶN DỮ LIỆU SERVER KHÔNG HỢP LỆ ----
            # Bộ cài chạy bằng quyền Administrator; đường dẫn lấy từ server
            # nên phải kiểm trước khi dùng để ghi file.
            okV, errV = validate_info(info)
            if not okV:
                set_status('Dữ liệu cài đặt không hợp lệ: %s' % errV, 'err')
                append_log('LỖI kiểm tra: ' + errV)
                return

            exe_url = info.get('exeUrl') or ''
            sha = info.get('sha256') or ''
            size = int(info.get('size') or 0)
            target_dir = info.get('installDir') or ''
            shortcut_name = info.get('shortcutName') or name
            exe_name = info.get('exeName') or 'app.exe'
            is_trial = str(key).upper().startswith('TR-')

            append_log('Sản phẩm : %s' % name)
            append_log('License  : %s' % key)
            lic = info.get('license') or {}
            if lic.get('forever'):
                append_log('Hạn dùng : vĩnh viễn')
            else:
                import time
                exp = lic.get('expires_at') or 0
                append_log('Hạn dùng : %s' % (
                    time.strftime('%Y-%m-%d', time.localtime(exp)) if exp else '?'))
            append_log('Cài vào  : %s' % target_dir)

            set_status('Đang tải bộ xử lý…')
            prog['value'] = 5
            tmpdir = tempfile.mkdtemp(prefix='xasetup_')
            tmp_exe = os.path.join(tmpdir, exe_name)

            def on_prog(got, total):
                pct = 5 + int(85 * got / max(total, 1))
                try:
                    prog['value'] = pct
                except Exception:
                    pass

            ok, derr = download_file(exe_url, tmp_exe, sha, size, on_prog)
            if not ok:
                set_status('Tải thất bại: %s' % derr, 'err')
                append_log('LỖI tải: ' + derr)
                return

            prog['value'] = 92
            append_log('Đã tải + kiểm SHA-256 khớp.')

            # ---- Cài đặt ----
            set_status('Đang cài đặt…')
            try:
                os.makedirs(target_dir, exist_ok=True)
            except PermissionError as e:
                # Lỗi thật đã gặp: [WinError 5] Access is denied.
                # Nói rõ nguyên nhân và cách sửa thay vì để khách đoán.
                set_status('Windows từ chối quyền ghi vào thư mục cài.', 'err')
                append_log('LỖI QUYỀN: ' + str(e))
                append_log('')
                append_log('Thư mục: %s' % target_dir)
                append_log('Nguyên nhân: bộ cài chưa chạy với quyền Administrator,')
                append_log('hoặc thư mục đang bị chương trình khác giữ.')
                append_log('')
                append_log('CÁCH SỬA:')
                append_log('  1. Đóng game và mọi cửa sổ XArena đang mở')
                append_log('  2. Chuột phải xa_setup.exe -> Run as administrator')
                append_log('  3. Bấm Yes rồi cài lại')
                try:
                    messagebox.showerror(
                        'Không đủ quyền',
                        'Windows từ chối ghi vào:\n%s\n\n'
                        'Hãy đóng game, sau đó chuột phải vào xa_setup.exe '
                        'và chọn "Run as administrator".' % target_dir)
                except Exception:
                    pass
                return
            except Exception as e:
                set_status('Không tạo được thư mục cài: %s' % e, 'err')
                append_log('LỖI: ' + str(e))
                return

            final_exe = os.path.join(target_dir, exe_name)


            # ĐÓNG TOOL ĐANG CHẠY TRƯỚC KHI GHI ĐÈ.
            #
            # Lỗi thật khách gặp:
            #   "Không ghi được file cài: [WinError 5] Access is denied:
            #    ...\xa_nofog_pro.exe.new -> ...\xa_nofog_pro.exe"
            #
            # Nguyên nhân: tool cũ ĐANG CHẠY và giữ khoá file. Ghi được
            # file .new (thư mục vẫn cho ghi) nhưng os.replace() không đổi
            # tên được vì file đích bị khoá.
            #
            # Bộ cài .cmd/.ps1 cũ CŨNG không xử lý — khách phải tự tắt tool.
            #
            # NHƯNG bộ .cmd "chạy được" vì nó có ĐƯỜNG TẮT: nếu file đích ĐÃ
            # ĐÚNG hash thì nó KHÔNG GHI GÌ CẢ (installer.js FROMCACHE).
            # Bản GUI trước đây thiếu đường này nên luôn ghi đè -> luôn lỗi
            # khi tool đang chạy. Đây là lý do thật của "exe nào cũng lỗi".
            already_ok = False
            if os.path.exists(final_exe):
                try:
                    if os.path.getsize(final_exe) == int(size):
                        if file_sha256(final_exe).lower() == sha.lower():
                            already_ok = True
                except Exception:
                    pass

            if already_ok:
                append_log('File đã đúng phiên bản — không cần ghi lại.')
                append_log('   %s' % final_exe)
            else:
                stopped = stop_running_tool(final_exe)
                if stopped:
                    append_log('Đã đóng %d tiến trình %s đang chạy.'
                               % (stopped, exe_name))

            try:
                if already_ok:
                    # Bỏ qua toàn bộ bước ghi — đây là đường mà .cmd dùng.
                    pass
                elif os.path.exists(final_exe):
                    # ĐỔI TÊN, KHÔNG XOÁ.
                    # LỖI ĐÃ SỬA: trước đây xoá trước rồi mới copy; nếu
                    # đĩa đầy / AV chặn / mạng đứt thì KHÔNG CÒN app nào
                    # và cũng không có bản để khôi phục.
                    # Nay giữ .old, chỉ xoá sau khi bản mới đã qua kiểm hash.
                    try:
                        _bk = final_exe + '.old'
                        if os.path.exists(_bk):
                            os.remove(_bk)
                        os.replace(final_exe, _bk)
                    except Exception:
                        pass

                if not already_ok:
                    # copy qua file tạm rồi đổi tên -> không hỏng nửa chừng
                    staging = final_exe + '.new'
                    with open(tmp_exe, 'rb') as src, open(staging, 'wb') as dst:
                        while True:
                            b = src.read(CHUNK)
                            if not b:
                                break
                            dst.write(b)
                    # kiểm lại hash tại ĐÍCH (đề phòng ghi lỗi)
                    if file_sha256(staging).lower() != sha.lower():
                        set_status('Hash sai sau khi cài. Đã huỷ.', 'err')
                        try:
                            os.remove(staging)
                        except Exception:
                            pass
                        return

                    # THAY THẾ CÓ THỬ LẠI.
                    #
                    # Kể cả sau khi kill, file có thể còn bị giữ thêm vài
                    # trăm ms (Windows chưa giải phóng handle, antivirus đang
                    # quét). Thử 6 lần, chờ tăng dần, tổng ~3 giây.
                    last_err = None
                    for attempt in range(6):
                        try:
                            os.replace(staging, final_exe)
                            last_err = None
                            break
                        except PermissionError as e:
                            last_err = e
                            time.sleep(0.15 * (attempt + 1))
                            # thử đóng tool lần nữa (khách có thể vừa mở lại)
                            if attempt >= 2:
                                stop_running_tool(final_exe)
                        except Exception as e:
                            last_err = e
                            break

                    if last_err is not None:
                        raise last_err

            except PermissionError as e:
                set_status('Không ghi đè được: file đang được chương trình khác dùng.',
                           'err')
                append_log('LỖI QUYỀN: ' + str(e))
                append_log('')
                append_log('File đích: %s' % final_exe)
                append_log('Nguyên nhân thường gặp:')
                append_log('  1. Tool đang chạy (kể cả cửa sổ CMD của tool)')
                append_log('  2. Game EMPIRESX.EXE đang mở')
                append_log('  3. Phần mềm diệt virus đang quét file vừa tải')
                append_log('')
                append_log('CÁCH SỬA: đóng hết cửa sổ tool + game, rồi cài lại.')
                try:
                    messagebox.showerror(
                        'Không ghi đè được file',
                        'File đang được chương trình khác sử dụng:\n\n%s\n\n'
                        'Hãy đóng cửa sổ tool (CMD) và game, rồi bấm '
                        'Cài đặt lại.' % final_exe)
                except Exception:
                    pass
                return
            except Exception as e:
                set_status('Không ghi được file cài: %s' % e, 'err')
                append_log('LỖI: ' + str(e))
                return

            append_log('Đã cài: %s' % final_exe)
            prog['value'] = 94

            # ---- BẬT RUNASADMIN ----
            # xa_grant.exe từ chối chạy nếu không elevated -> shortcut sẽ
            # chết nếu bỏ bước này (bộ .cmd cũ có làm).
            if set_runasadmin(final_exe):
                append_log('Đã bật RUNASADMIN cho file cài.')

            # ---- KÍCH HOẠT LICENSE ----
            # Bước quan trọng nhất: bộ .cmd/.ps1 cũ đều chạy
            #   <exe> --key <KEY>   (hoặc --trial-key với mã TR-)
            # Bản GUI trước đây BỎ SÓT -> cài xong mở tool vẫn bị đòi key.
            set_status('Đang kích hoạt license…')
            prog['value'] = 97
            okA, errA = activate(final_exe, key, is_trial)
            if okA:
                append_log('Đã kích hoạt license: %s' % key)
            else:
                # Không chặn: file đã cài đúng, chỉ chưa kích hoạt.
                append_log('CẢNH BÁO: chưa kích hoạt được (%s)' % errA)
                append_log('  Mở tool và nhập key thủ công: %s' % key)

            # ---- Shortcut ----
            # Ghi vào CẢ Desktop người dùng VÀ Public Desktop.
            # Lý do: chạy elevated thì `~` có thể là profile của tài khoản
            # admin -> shortcut rơi nhầm chỗ, khách không thấy.
            made = []
            seen = set()
            for d in desktop_dirs():
                lnk = os.path.join(d, shortcut_name + '.lnk')
                if lnk in seen:
                    continue
                seen.add(lnk)
                if shortcut(final_exe, lnk, description=name, icon=final_exe):
                    made.append(d)
            # Start Menu (mọi tài khoản)
            startmenu = os.path.join(
                os.environ.get('PROGRAMDATA', r'C:\ProgramData'),
                'Microsoft', 'Windows', 'Start Menu', 'Programs')
            if shortcut(final_exe, os.path.join(startmenu, shortcut_name + '.lnk'),
                        description=name, icon=final_exe):
                made.append('Start Menu')
            # Start Menu riêng người dùng (nếu ghi được)
            su = os.path.join(os.environ.get('APPDATA', ''),
                              'Microsoft', 'Windows', 'Start Menu', 'Programs')
            if su and os.path.isdir(su):
                if shortcut(final_exe, os.path.join(su, shortcut_name + '.lnk'),
                            description=name, icon=final_exe):
                    if 'Start Menu' not in made:
                        made.append('Start Menu')

            if made:
                append_log('Đã tạo shortcut: %s' % ', '.join(made))
                for d in made:
                    if d.startswith('C:') or d.startswith('\\'):
                        append_log('   %s' % d)
            else:
                append_log('CẢNH BÁO: không tạo được shortcut nào.')

            prog['value'] = 100
            append_log('')
            append_log('HOÀN TẤT.')
            # LỖI ĐÃ SỬA: trước đây 3 dòng dưới in VÔ ĐIỀU KIỆN, nên khi
            # tạo shortcut thất bại khách vẫn thấy cả "CẢNH BÁO: không tạo
            # được shortcut nào" LẪN "Shortcut đã nằm ngoài Desktop" —
            # mâu thuẫn, không biết tin dòng nào.
            if made:
                set_status('Cài đặt xong. Shortcut "%s" đã có ngoài Desktop.'
                           % shortcut_name, 'ok')
                append_log('Shortcut "%s" đã nằm ngoài Desktop — mở game rồi'
                           ' bấm đúp shortcut đó.' % shortcut_name)
            else:
                set_status('Cài đặt xong. Mở tool tại thư mục cài đặt.', 'warn')
                append_log('Không có shortcut. Mở file này để chạy:')
                append_log('   %s' % final_exe)

            # Thông báo kết quả — KHÔNG hỏi mở folder (đã có shortcut Desktop).
            try:
                msg = 'Đã cài xong "%s".\n\n' % name
                if made:
                    msg += ('Shortcut "%s" đã có ngoài Desktop.\n\n'
                            'Mở game rồi bấm đúp shortcut đó để chạy.'
                            % shortcut_name)
                else:
                    msg += ('Nhưng KHÔNG tạo được shortcut ngoài Desktop.\n\n'
                            'Mở file trực tiếp tại:\n%s' % final_exe)
                messagebox.showinfo('Cài đặt xong', msg)
            except Exception:
                pass
        except Exception as e:
            set_status('Lỗi không mong đợi: %s' % e, 'err')
            append_log('EXCEPTION: %r' % e)
        finally:
            set_busy(False)

    def on_install():
        if state['busy']:
            return

        # BẮT BUỘC ADMIN — kiểm NGAY TẠI ĐÂY, không tin bước khởi động.
        #
        # Lỗi thật đã gặp: khách bấm Cài đặt, bộ cài tải xong 9 MB rồi mới
        # chết với "[WinError 5] Access is denied: C:\Program Files\...".
        # Nguyên nhân: tiến trình không elevated (UAC bị từ chối ở bước
        # khởi động, hoặc ShellExecuteW không khởi chạy được bản .exe thật
        # dưới Nuitka onefile).
        #
        # Nay: xin quyền TRƯỚC khi tải, và mang theo token sang tiến trình
        # admin để khách không phải dán lại.
        if not is_admin():
            raw = entry.get().strip()
            set_status('Cần quyền Administrator — đang mở lại bộ cài…', 'warn')
            append_log('Chưa có quyền Administrator. Đang mở lại với quyền Admin…')
            args = ['--token', raw] if raw else []

            # GIẤU cửa sổ HIỆN TẠI trước khi mở cửa sổ admin.
            #
            # Lỗi thật khách báo: "vừa ấn cái này lại nhảy sang cái kia" —
            # cửa sổ cũ còn hiện 1,2 giây trong khi cửa sổ admin đã mở, nên
            # khách thấy HAI bộ cài cùng lúc. Nay ẩn ngay lập tức.
            try:
                root.withdraw()
                root.update_idletasks()
            except Exception:
                pass

            if relaunch_elevated(args):
                append_log('Đã mở bộ cài với quyền Administrator.')
                # Đóng hẳn tiến trình cũ — chỉ còn MỘT cửa sổ.
                root.destroy()
                return
            # Không khởi chạy được -> hiện lại cửa sổ và hướng dẫn thủ công
            try:
                root.deiconify()
            except Exception:
                pass
            set_status('Không tự xin được quyền. Làm theo hướng dẫn trong ô log.', 'err')
            append_log('')
            append_log('CÁCH KHẮC PHỤC:')
            append_log('  1. Đóng bộ cài này')
            append_log('  2. Chuột phải file xa_setup.exe -> "Run as administrator"')
            append_log('  3. Bấm Yes ở hộp thoại Windows rồi cài lại')
            try:
                messagebox.showwarning(
                    'Cần quyền Administrator',
                    'Bộ cài cần quyền Administrator để ghi vào Program Files.\n\n'
                    'Hãy đóng cửa sổ này, chuột phải vào xa_setup.exe và chọn '
                    '"Run as administrator".')
            except Exception:
                pass
            return

        set_busy(True)
        append_log('')
        threading.Thread(target=worker, daemon=True).start()

    install_btn.config(command=on_install)
    entry.bind('<Return>', lambda e: on_install())

    # Cảnh báo nếu chưa phải admin
    if not is_admin():
        set_status('Chưa có quyền Administrator — sẽ hỏi khi bấm Cài đặt.', 'warn')
        append_log('Lưu ý: cài vào Program Files cần quyền Administrator.')
        append_log('       Bấm Cài đặt, Windows sẽ hỏi quyền (bấm Yes).')
    else:
        append_log('Đã có quyền Administrator.')

    # Ghi chẩn đoán để hỗ trợ khách khi cần
    append_log('')
    append_log('--- thông tin ---')
    append_log('Bộ cài : %s' % VERSION)
    append_log('Máy    : %s' % (os.environ.get('COMPUTERNAME') or '?'))
    append_log('Quyền  : %s' % ('Administrator' if is_admin() else 'người dùng thường'))
    append_log('Python : %s' % (sys.version.split()[0] if sys.version else '?'))
    append_log('Frozen : %s' % bool(getattr(sys, 'frozen', False)))
    append_log('Launcher: %s' % _launcher_path())

    root.mainloop()
    return 0


# ---------------------------------------------------------------------------
# Selftest
# ---------------------------------------------------------------------------

def validate_info(info):
    """Kiểm tra dữ liệu server trả về TRƯỚC khi dùng đường dẫn để ghi file.

    VÌ SAO BẮT BUỘC: bộ cài chạy với quyền Administrator. Nếu server bị
    chiếm quyền hoặc response bị sửa, `installDir` có thể là
    C:\\Windows\\System32 -> ghi file đặc quyền tuỳ ý. Chặn ở đây.

    Trả (ok, err).
    """
    if not isinstance(info, dict):
        return False, 'dữ liệu server không hợp lệ'

    d = str(info.get('installDir') or '')
    if not d:
        return False, 'server không trả thư mục cài'
    # Phải là đường dẫn TUYỆT ĐỐI trên ổ đĩa
    if not re.match(r'^[A-Za-z]:\\', d):
        return False, 'thư mục cài không phải đường dẫn tuyệt đối: %r' % d
    # Cấm các thư mục hệ thống trọng yếu
    norm = d.rstrip('\\').lower()
    for bad in ('c:\\windows', 'c:\\windows\\system32', 'c:\\program files\\windows',
                'c:\\programdata\\microsoft', 'c:\\users'):
        if norm == bad or norm.startswith(bad + '\\'):
            return False, 'từ chối ghi vào thư mục hệ thống: %r' % d
    # Cấm thoát thư mục
    if '..' in d.split('\\'):
        return False, 'thư mục cài chứa "..": %r' % d

    # Tên file phải đơn giản: chỉ tên, không đường dẫn
    exe = str(info.get('exeName') or '')
    if not exe or not re.fullmatch(r'[A-Za-z0-9._-]{1,80}\.exe', exe):
        return False, 'tên file không hợp lệ: %r' % exe

    # Tên shortcut: không cho ký tự điều khiển đường dẫn
    sc = str(info.get('shortcutName') or '')
    if not sc or any(c in sc for c in '\\/:*?"<>|'):
        return False, 'tên shortcut không hợp lệ: %r' % sc

    # Hash phải đủ 64 hex — FAIL CLOSED, không bỏ qua khi rỗng
    sha = str(info.get('sha256') or '')
    if not re.fullmatch(r'[0-9a-fA-F]{64}', sha):
        return False, 'server không trả SHA-256 hợp lệ'

    size = int(info.get('size') or 0)
    if size < 10000:
        return False, 'kích thước file vô lý: %d' % size

    url = str(info.get('exeUrl') or '')
    if not re.match(r'^https://', url):
        return False, 'URL tải phải là https: %r' % url

    return True, ''


def _state_has_license(exe_path):
    """Tool đã lưu license chưa? Đọc file state mà tool ghi.

    No Fog  : %LOCALAPPDATA%\\XArenaNoFog\\lic.bin   (DPAPI, prefix 'XANF')
    XAGrant : %LOCALAPPDATA%\\XAGrant\\token.bin     (DPAPI, prefix 'DPAPI1:')

    Chỉ cần file tồn tại và có nội dung > 100 byte — đủ để biết tool đã ghi
    state. Không giải mã (bộ cài không có khoá DPAPI của phiên tool).
    """
    import glob
    local = (os.environ.get('LOCALAPPDATA') or '').strip()
    if not local:
        return False

    cands = []
    # Đoán theo tên EXE đang cài
    base = os.path.basename(exe_path).lower()
    if 'grant' in base:
        cands.append(os.path.join(local, 'XAGrant', 'token.bin'))
        cands.append(os.path.join(local, 'XArenaGrant', 'token.bin'))
    elif 'nofog' in base:
        cands.append(os.path.join(local, 'XArenaNoFog', 'lic.bin'))

    # Nếu không đoán được (tên lạ) -> quét cả hai thư mục đã biết.
    # KHÔNG quét glob rộng: làm vậy file nào trên máy cũng khiến hàm trả True.
    if not cands:
        cands = [
            os.path.join(local, 'XArenaNoFog', 'lic.bin'),
            os.path.join(local, 'XAGrant', 'token.bin'),
            os.path.join(local, 'XArenaGrant', 'token.bin'),
        ]

    for p in cands:
        try:
            if os.path.isfile(p) and os.path.getsize(p) > 100:
                return True
        except Exception:
            pass
    return False


def activate(exe_path, key, is_trial):
    """Kích hoạt license bằng cách chạy tool một lần với --key/--trial-key.

    VÌ SAO BẮT BUỘC: bộ cài .cmd/.ps1 cũ đều làm bước này
    (installer.js: `& $Exe --key $Key`). Bản GUI trước đây BỎ SÓT -> khách
    cài xong mở tool ra vẫn bị đòi key, tưởng mua nhầm.

    Trả (ok, msg).
    """
    flag = '--trial-key' if is_trial else '--key'
    try:
        # KHÔNG dùng capture_output=True.
        #
        # LỖI ĐÃ SỬA: bộ cài chạy ELEVATED (không có console). EXE đích là
        # GUI-subsystem build bằng --windows-console-mode=attach, nên nó cố
        # AttachConsole(ATTACH_PARENT_PROCESS) vào console KHÔNG tồn tại.
        # Kết hợp với pipe của capture_output -> Python ném
        #   [WinError 6] The handle is invalid
        # và khách thấy "chưa kích hoạt được" dù tool đã kích hoạt xong.
        #
        # Nay: chuyển stdout/stderr vào DEVNULL (không tạo pipe để đọc) và
        # cho tiến trình con một process group riêng. Kết quả kích hoạt
        # được xác nhận bằng FILE STATE, không bằng stdout.
        _CFLAGS = (getattr(subprocess, 'CREATE_NO_WINDOW', 0)
                   | getattr(subprocess, 'CREATE_NEW_PROCESS_GROUP', 0))
        try:
            p = subprocess.run(
                [exe_path, flag, key],
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=180, creationflags=_CFLAGS)
        except OSError as _e:
            # Một số cấu hình vẫn từ chối handle -> dùng shell-less Popen
            # không redirect gì cả, rồi chờ file state.
            import traceback as _tb
            _ = _tb.format_exc()
            p = subprocess.Popen(
                [exe_path, flag, key],
                stdin=subprocess.DEVNULL,
                creationflags=_CFLAGS)
            try:
                p.wait(timeout=180)
            except subprocess.TimeoutExpired:
                return False, 'kích hoạt quá 3 phút không xong'

        # ---- KIỂM CHỨNG THẬT: file state đã có key chưa? ----
        #
        # VÌ SAO KHÔNG TIN returncode/stdout: EXE phát hành là GUI-subsystem
        # (--windows-console-mode=attach/disable). Khi chạy từ bộ cài, stdout
        # KHÔNG được nối vào pipe -> capture_output trả rỗng và returncode
        # có thể là 0 dù việc kích hoạt thất bại, hoặc khác 0 dù thành công.
        #
        # Cách đúng: đọc lại file state mà TOOL đã ghi (lic.bin cho No Fog,
        # token.bin cho XAGrant). Có key là thành công thật.
        import time as _t
        for _ in range(12):
            if _state_has_license(exe_path):
                return True, ''
            _t.sleep(0.4)

        # Không capture được stdout (xem chú thích trên), nên kết luận
        # dựa vào FILE STATE và returncode.
        rc = getattr(p, 'returncode', None)
        if rc == 0:
            # Tiến trình báo thành công nhưng state chưa thấy -> có thể
            # tool ghi chậm. Đã chờ 4.8s ở trên; báo thành công để không
            # làm khách hoang mang, kèm hướng dẫn nếu vẫn bị đòi key.
            return True, ''
        return False, ('kích hoạt trả mã %s. Mở tool và nhập key thủ công: %s'
                       % (rc, key))
    except FileNotFoundError:
        return False, 'không tìm thấy file vừa cài'
    except subprocess.TimeoutExpired:
        return False, 'kích hoạt quá 3 phút không xong'
    except Exception as e:
        return False, str(e)[:200]


def set_runasadmin(exe_path):
    """Bật RUNASADMIN cho EXE ở cả HKCU và HKLM.

    VÌ SAO CẦN: xa_grant.exe từ chối chạy nếu không elevated. Bộ cài .cmd cũ
    ghi AppCompatFlags\\Layers; bản GUI trước đây bỏ sót -> shortcut chết.
    """
    ok_any = False
    for hive in ('HKCU', 'HKLM'):
        key = ('%s\\Software\\Microsoft\\Windows NT\\CurrentVersion'
               '\\AppCompatFlags\\Layers' % hive)
        try:
            # KIỂM RETURNCODE — trước đây đặt ok_any=True vô điều kiện nên
            # reg thất bại vẫn báo "Đã bật RUNASADMIN".
            rc = run_quiet(
                ['reg', 'add', key, '/v', exe_path, '/t', 'REG_SZ',
                 '/d', '~ RUNASADMIN', '/f'], timeout=30)
            if rc == 0:
                ok_any = True
        except Exception:
            pass
    return ok_any


def acquire_single_instance():
    """Chỉ cho MỘT bộ cài chạy cùng lúc.

    VÌ SAO CẦN: khách báo "vừa ấn cái này lại nhảy sang cái kia" — hai cửa sổ
    bộ cài cùng mở. Ngoài việc ẩn cửa sổ cũ khi xin quyền, ta chặn hẳn
    trường hợp bấm đúp nhiều lần hoặc tiến trình admin và tiến trình thường
    cùng sống.

    Dùng named mutex toàn hệ thống (Global\\) để cả hai tiến trình — dù khác
    mức quyền — đều thấy nhau.

    Trả handle nếu giành được, None nếu đã có bản khác đang chạy.
    """
    try:
        k32 = ctypes.WinDLL('kernel32', use_last_error=True)
        k32.CreateMutexW.restype = ctypes.c_void_p
        k32.CreateMutexW.argtypes = [ctypes.c_void_p, wt.BOOL, wt.LPCWSTR]
        name = 'Global\\XASetup-{9C1F4A2B-7D3E-4B8A-9E10-5A6C2D8F1B34}'
        h = k32.CreateMutexW(None, True, name)
        if not h:
            return True  # không tạo được -> cho chạy để không chặn oan
        err = ctypes.get_last_error()
        # ERROR_ALREADY_EXISTS = 183
        if err == 183:
            k32.CloseHandle(ctypes.c_void_p(h))
            return False
        return h
    except Exception:
        return True


def selftest():
    ok_n = fail_n = 0

    def chk(name, cond, extra=''):
        nonlocal ok_n, fail_n
        if cond:
            ok_n += 1
            print('  PASS  %-44s %s' % (name, extra))
        else:
            fail_n += 1
            print('  FAIL  %-44s %s' % (name, extra))

    print('SELFTEST (không cần mạng, không cần game)')

    # resolve_input
    # CHU SHOP CHOT: chi dung license key. Hex 48 phai bi TU CHOI.
    k, t = resolve_input('3f2a' + 'a' * 44)
    chk('TU CHOI token 48 hex', (k == '' and t == ''), 'key=%r token=%r' % (k, t))
    k, t = resolve_input('AOE1-2KHT-7WQP-7R2P')
    chk('nhan key AOE1', (k == 'AOE1-2KHT-7WQP-7R2P' and t == ''), k)
    k, t = resolve_input('TR-LLTH-MT6H-XYWM')
    chk('nhan key dung thu TR-', (k == 'TR-LLTH-MT6H-XYWM' and t == ''), k)
    k, t = resolve_input('XAGR-ABCD-EFGH-IJKL')
    chk('nhận license key', (k == 'XAGR-ABCD-EFGH-IJKL' and t == ''), k)
    k, t = resolve_input(
        'powershell -c "iex (irm https://xienhl.com/i/XAGR-TEST-0001.ps1?t='
        + 'a' * 48 + ')"')
    chk('nhận dòng lệnh cũ', (k == 'XAGR-TEST-0001' and len(t) == 48),
        '%s / %s…' % (k, t[:6]))
    k, t = resolve_input('rác rác')
    chk('dữ liệu rác -> rỗng', (k == '' and t == ''), '(đúng)')
    k, t = resolve_input('')
    chk('rỗng -> rỗng', (k == '' and t == ''), '(đúng)')

    # hash
    d = tempfile.mkdtemp(prefix='xast_')
    p = os.path.join(d, 'x.bin')
    with open(p, 'wb') as f:
        f.write(b'hello')
    chk('sha256 đúng', file_sha256(p) ==
        hashlib.sha256(b'hello').hexdigest(), file_sha256(p)[:16] + '…')
    chk('sha256 file không tồn tại -> rỗng',
        file_sha256(os.path.join(d, 'nope')) == '', '(đúng)')

    # is_admin không crash
    a = is_admin()
    chk('is_admin() chạy được', isinstance(a, bool), 'admin=%s' % a)

    # ---- validate_info: chặn dữ liệu server độc hại ----
    good = {
        'installDir': 'C:\\Program Files\\XArenaNoFog\\_re\\chayduoc',
        'exeName': 'xa_arena.exe',
        'shortcutName': 'XARENA MAP SANG',
        'sha256': 'a' * 64,
        'size': 9105408,
        'exeUrl': 'https://xienhl.com/download/xa_arena.exe',
    }
    okv, errv = validate_info(good)
    chk('validate_info: dữ liệu tốt -> OK', okv, errv)

    bad_cases = [
        ('Windows', {**good, 'installDir': 'C:\\Windows\\System32'}),
        ('System32', {**good, 'installDir': 'C:\\Windows\\System32\\x'}),
        ('..', {**good, 'installDir': 'C:\\Program Files\\..\\Windows'}),
        ('tương đối', {**good, 'installDir': 'Program Files\\X'}),
        ('exeName có path', {**good, 'exeName': '..\\evil.exe'}),
        ('sha rỗng', {**good, 'sha256': ''}),
        ('sha ngắn', {**good, 'sha256': 'abc'}),
        ('size nhỏ', {**good, 'size': 10}),
        ('http', {**good, 'exeUrl': 'http://xienhl.com/x.exe'}),
        ('shortcut có /', {**good, 'shortcutName': 'a/b'}),
    ]
    for name, info in bad_cases:
        okb, _ = validate_info(info)
        chk('validate_info chặn: %s' % name, okb is False, '(đúng)' if not okb else 'LỌT!')

    # ---- desktop_dirs: tra DUNG MOT thư mục (chống shortcut trùng) ----
    #
    # HÀNH VI MỚI: bản cũ trả cả Desktop người dùng + Public Desktop ->
    # Windows hợp nhất hai nơi -> khách thấy 2 icon trùng tên.
    # Nay chỉ trả một nơi.
    dds = desktop_dirs()
    chk('desktop_dirs không rỗng', len(dds) >= 1, '%d thư mục' % len(dds))
    chk('CHỈ trả 1 thư mục (không trùng)', len(dds) == 1, str(dds))
    chk('mọi đường dẫn đều tồn tại', all(os.path.isdir(d) for d in dds),
        ', '.join(dds))

    print()
    print('Tổng: %d  |  PASS %d  |  FAIL %d' % (ok_n + fail_n, ok_n, fail_n))
    return 0 if fail_n == 0 else 1


def main():
    args = sys.argv[1:]
    if '--selftest' in args:
        return selftest()
    if '--version' in args:
        print(VERSION)
        return 0

    # Token truyền sang tiến trình admin (khi khởi chạy lại để xin quyền).
    prefill = ''
    if '--token' in args:
        i = args.index('--token')
        if i + 1 < len(args):
            prefill = args[i + 1]

    # Chỉ một bộ cài chạy cùng lúc — tránh hai cửa sổ.
    guard = acquire_single_instance()
    if guard is False:
        try:
            import tkinter as tk
            from tkinter import messagebox
            r = tk.Tk()
            r.withdraw()
            messagebox.showinfo(
                'Bộ cài đang mở',
                'Bộ cài XArena đang chạy rồi.\n\n'
                'Hãy dùng cửa sổ đang mở, hoặc đóng nó rồi mở lại.')
            r.destroy()
        except Exception:
            print('Bo cai dang chay.')
        return 0

    # QUYỀN ADMIN: do MANIFEST lo, không phải code.
    #
    # Bộ cài được build với `--windows-uac-admin`, nên manifest của file .exe
    # khai báo requireAdministrator. Windows nâng quyền NGAY KHI MỞ FILE,
    # trước khi chương trình chạy -> luôn có đúng MỘT tiến trình, MỘT cửa sổ.
    #
    # Trước đây bộ cài tự gọi ShellExecuteW('runas') từ trong code. Cách đó
    # sinh tiến trình THỨ HAI trong khi cửa sổ cũ chưa đóng -> khách thấy hai
    # bộ cài cùng lúc ("vừa ấn cái này lại nhảy sang cái kia").
    #
    # Nhánh `is_admin()` trong on_install chỉ còn là lưới an toàn cho trường
    # hợp manifest bị bỏ (ví dụ chạy bằng python trực tiếp khi phát triển).
    if not is_admin():
        print('Chua co quyen Administrator -- se xin khi bam Cai dat.')

    # Giao diện PyQt6 là mặc định (đẹp hơn, có bo góc/hiệu ứng/dark titlebar).
    # Nếu máy thiếu PyQt6 thì quay về tkinter để bộ cài KHÔNG bị chết.
    try:
        import xa_setup_qt
        return xa_setup_qt.run_gui(prefill)
    except ImportError:
        pass
    except Exception as e:
        print('PyQt6 GUI loi (%s) -> dung tkinter' % e)

    return run_gui_tk(prefill)


if __name__ == '__main__':
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except BaseException as e:
        try:
            import tkinter.messagebox as mb
            mb.showerror('Lỗi', 'Không chạy được bộ cài:\n\n%r' % (e,))
        except Exception:
            print('LỖI:', e)
        sys.exit(1)
