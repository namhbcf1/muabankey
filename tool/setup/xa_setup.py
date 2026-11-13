# -*- coding: utf-8 -*-
"""xa_setup.py -- BỘ CÀI ĐẶT CÓ GIAO DIỆN cho XA THÊM TÀI NGUYÊN / XARENA MAP SÁNG.

VÌ SAO CÓ FILE NÀY
------------------
Luồng cũ bắt khách dán một dòng PowerShell vào Win+R:

    powershell -NoProfile -ExecutionPolicy Bypass -Command "iex (irm https://.../i/<KEY>.ps1?t=<TOKEN>)"

Khách thường bỏ cuộc ở bước này: chữ dài, dễ dán sai, nhiều máy chặn
ExecutionPolicy, và AV hay cảnh báo "script PowerShell tải từ Internet".
Tỉ lệ cài hỏng cao mà lỗi lại khó giải thích.

File này là bộ cài GUI: khách tải MỘT file .exe, bấm đúp, dán mã cài đặt
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
VERSION = '2.0.0'

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
    """Danh sách thư mục Desktop để ghi shortcut.

    VÌ SAO KHÔNG DÙNG `os.path.expanduser('~')` MỘT MÌNH:

    Bộ cài chạy bằng quyền Administrator (manifest requireAdministrator).
    Nếu khách là user thường và UAC bắt nhập tài khoản admin, thì `~` trỏ về
    profile CỦA TÀI KHOẢN ADMIN — shortcut rơi vào Desktop của admin, còn
    khách KHÔNG THẤY GÌ. Đây là lỗi rất khó phát hiện vì bộ cài vẫn báo
    "thành công".

    Cách đúng: ghi vào CẢ HAI
      1. Desktop của người dùng đang đăng nhập (nếu truy cập được)
      2. Public Desktop — hiện cho MỌI tài khoản, luôn truy cập được

    Trả list các thư mục đã có thật.
    """
    out = []

    # (1) Desktop người dùng hiện tại
    try:
        cand = os.path.join(os.path.expanduser('~'), 'Desktop')
        if os.path.isdir(cand):
            out.append(cand)
    except Exception:
        pass

    # (1b) USERPROFILE (khác `~` trong vài cấu hình)
    try:
        up = os.environ.get('USERPROFILE')
        if up:
            cand = os.path.join(up, 'Desktop')
            if os.path.isdir(cand) and cand not in out:
                out.append(cand)
    except Exception:
        pass

    # (2) Public Desktop — QUAN TRỌNG NHẤT khi chạy elevated
    for env in ('PUBLIC', 'ALLUSERSPROFILE'):
        base = os.environ.get(env)
        if not base:
            continue
        cand = os.path.join(base, 'Desktop')
        if os.path.isdir(cand) and cand not in out:
            out.append(cand)
            break

    # (2b) Đường dẫn cố định, phòng khi biến môi trường bị thiếu
    fixed = r'C:\Users\Public\Desktop'
    if os.path.isdir(fixed) and fixed not in out:
        out.append(fixed)

    return out


def shortcut(target, lnk_path, description='', icon=None):
    """Tạo shortcut .lnk bằng WScript.Shell (có sẵn trên mọi Windows)."""
    try:
        ps = (
            "$w=New-Object -ComObject WScript.Shell;"
            "$s=$w.CreateShortcut(%s);"
            "$s.TargetPath=%s;$s.Description=%s;%s$s.Save()" % (
                _ps_quote(lnk_path), _ps_quote(target), _ps_quote(description),
                ("$s.IconLocation=%s;" % _ps_quote(icon)) if icon else '',
            )
        )
        subprocess.run(
            ['powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass',
             '-Command', ps],
            capture_output=True, timeout=30,
            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        return os.path.exists(lnk_path)
    except Exception:
        return False


def _ps_quote(s):
    return "'" + str(s).replace("'", "''") + "'"


# ---------------------------------------------------------------------------
# Mạng
# ---------------------------------------------------------------------------

def _ssl_ctx():
    ctx = ssl.create_default_context()
    # Một số máy Win7 thiếu CA mới -> không hạ chuẩn, chỉ báo lỗi rõ ràng.
    return ctx


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


def download_file(url, dest, expect_sha, expect_size, progress=None):
    """Tải file, kiểm hash + kích thước. Trả (ok, err_msg).

    Ba lớp: urllib -> curl.exe -> bitsadmin. Windows nào cũng có ít nhất một.
    LUÔN kiểm hash trước khi dùng file.
    """
    def _one_urllib():
        req = urllib.request.Request(url, method='GET')
        req.add_header('User-Agent', USER_AGENT)
        with urllib.request.urlopen(req, timeout=60, context=_ssl_ctx()) as r, \
                open(dest, 'wb') as f:
            total = int(r.headers.get('Content-Length') or 0)
            got = 0
            while True:
                buf = r.read(CHUNK)
                if not buf:
                    break
                f.write(buf)
                got += len(buf)
                if progress and total:
                    progress(got, total)
        return True

    def _one_curl():
        cmd = ['curl.exe', '-L', '--fail', '--retry', '3', '--retry-delay', '2',
               '-A', USER_AGENT, '-o', dest, url]
        p = subprocess.run(cmd, capture_output=True, timeout=300,
                           creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        return p.returncode == 0 and os.path.exists(dest)

    def _one_bitsadmin():
        cmd = ['bitsadmin', '/transfer', 'xasetup', url, dest]
        subprocess.run(cmd, capture_output=True, timeout=300,
                       creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        return os.path.exists(dest)

    last_err = 'không tải được'
    for name, fn in (('urllib', _one_urllib), ('curl', _one_curl),
                     ('bitsadmin', _one_bitsadmin)):
        try:
            if os.path.exists(dest):
                os.remove(dest)
        except Exception:
            pass
        try:
            if not fn():
                last_err = '%s thất bại' % name
                continue
        except Exception as e:
            last_err = '%s: %s' % (name, str(e)[:120])
            continue

        # ---- KIỂM TRA BẮT BUỘC ----
        size = os.path.getsize(dest) if os.path.exists(dest) else 0
        if expect_size and size != int(expect_size):
            last_err = ('kích thước sai: nhận %d, cần %d' % (size, expect_size))
            continue
        actual = file_sha256(dest)
        if not actual:
            last_err = 'không đọc được file để băm'
            continue
        if expect_sha and actual.lower() != str(expect_sha).lower():
            last_err = ('SHA-256 KHÔNG khớp.\n  nhận: %s\n  cần: %s'
                        % (actual, expect_sha))
            continue
        return True, ''

    return False, last_err


def file_sha256(path):
    try:
        h = hashlib.sha256()
        with open(path, 'rb') as f:
            while True:
                b = f.read(1024 * 1024)
                if not b:
                    break
                h.update(b)
        return h.hexdigest()
    except Exception:
        return ''


# ---------------------------------------------------------------------------
# Luồng cài đặt (không phụ thuộc GUI -> test được bằng --selftest)
# ---------------------------------------------------------------------------

def resolve_input(text):
    """Nhận 'token' hoặc 'KEY' hoặc cả dòng lệnh cũ -> (key, token).

    Chấp nhận những gì khách thực tế có thể dán:
        * token 48 hex
        * KEY dạng XAGR-XXXX-... hoặc AOE1-...
        * dòng lệnh cũ: powershell ... /i/<KEY>.ps1?t=<TOKEN>
        * URL .../i/<KEY>?t=<TOKEN>
    """
    s = str(text or '').strip()
    if not s:
        return '', ''

    import re
    # Dòng lệnh/URL chứa cả key và token
    m = re.search(r'/i/([A-Za-z0-9\-]{6,64})(?:\.ps1|\.cmd)?\?t=([0-9a-fA-F]{48})', s)
    if m:
        return m.group(1).upper(), m.group(2).lower()
    m = re.search(r'/xg/([A-Za-z0-9\-]{6,64})(?:\.ps1|\.cmd)?\?t=([0-9a-fA-F]{48})', s)
    if m:
        return m.group(1).upper(), m.group(2).lower()

    # Chỉ token
    if re.fullmatch(r'[0-9a-fA-F]{48}', s):
        return '', s.lower()

    # Chỉ key
    if re.fullmatch(r'[A-Za-z0-9\-]{6,64}', s):
        return s.upper(), ''

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

def run_gui(prefill=''):
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
              text='Dán mã cài đặt hoặc license key vào ô dưới rồi bấm Cài đặt.',
              style='Muted.TLabel').pack(anchor='w', pady=(0, 14), **pad)

    card = tk.Frame(root, bg=C_CARD, highlightthickness=0)
    card.pack(fill='x', **pad)

    inner = tk.Frame(card, bg=C_CARD)
    inner.pack(fill='x', padx=16, pady=14)

    tk.Label(inner, text='Mã cài đặt / License key', bg=C_CARD, fg=C_FG,
             font=('Segoe UI', 9)).pack(anchor='w')

    entry = tk.Entry(inner, bg='#0b0d11', fg=C_FG, insertbackground=C_FG,
                     relief='flat', font=('Consolas', 10))
    entry.pack(fill='x', pady=(4, 6), ipady=6)
    entry.focus_set()
    # Token truyền từ dòng lệnh (khi tiến trình admin được khởi chạy lại)
    if prefill:
        entry.insert(0, prefill)

    hint = tk.Label(inner, text='Ví dụ: 3f2a…(48 ký tự)  hoặc  XAGR-XXXX-XXXX-XXXX',
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
                set_status('Mã không hợp lệ. Cần 48 ký tự hex hoặc license key.', 'err')
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
            try:
                if os.path.exists(final_exe):
                    try:
                        os.remove(final_exe)
                    except Exception:
                        pass
                # copy qua file tạm rồi đổi tên -> không để file hỏng nửa chừng
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
                os.replace(staging, final_exe)
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
            set_status('Cài đặt xong. Shortcut "%s" đã có ngoài Desktop.'
                       % shortcut_name, 'ok')
            append_log('')
            append_log('HOÀN TẤT.')
            append_log('Shortcut "%s" đã nằm ngoài Desktop — mở game rồi'
                       ' bấm đúp shortcut đó.' % shortcut_name)

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


def activate(exe_path, key, is_trial):
    """Kích hoạt license bằng cách chạy tool một lần với --key/--trial-key.

    VÌ SAO BẮT BUỘC: bộ cài .cmd/.ps1 cũ đều làm bước này
    (installer.js: `& $Exe --key $Key`). Bản GUI trước đây BỎ SÓT -> khách
    cài xong mở tool ra vẫn bị đòi key, tưởng mua nhầm.

    Trả (ok, msg).
    """
    flag = '--trial-key' if is_trial else '--key'
    try:
        p = subprocess.run(
            [exe_path, flag, key],
            capture_output=True, timeout=180,
            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        out = ((p.stdout or b'') + (p.stderr or b'')).decode('utf-8', 'ignore')
        if p.returncode == 0:
            return True, ''
        # Tool trả mã khác 0 nhưng đôi khi vẫn kích hoạt xong (vd cảnh báo).
        low = out.lower()
        if 'kích hoạt' in low or 'activated' in low or 'ok' in low:
            return True, ''
        return False, 'mã %d: %s' % (p.returncode, out.strip()[-300:])
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
            subprocess.run(
                ['reg', 'add', key, '/v', exe_path, '/t', 'REG_SZ',
                 '/d', '~ RUNASADMIN', '/f'],
                capture_output=True, timeout=30,
                creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
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
    k, t = resolve_input('3f2a' + 'a' * 44)
    chk('nhận token 48 hex', (k == '' and len(t) == 48), t[:8] + '…')
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
        'exeName': 'xa_nofog_pro.exe',
        'shortcutName': 'XARENA MAP SANG',
        'sha256': 'a' * 64,
        'size': 9105408,
        'exeUrl': 'https://xienhl.com/download/xa_nofog_pro.exe',
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

    # ---- desktop_dirs: phải có Public Desktop (chạy elevated) ----
    dds = desktop_dirs()
    chk('desktop_dirs không rỗng', len(dds) >= 1, '%d thư mục' % len(dds))
    has_public = any('Public' in d or 'public' in d for d in dds)
    chk('desktop_dirs có Public Desktop', has_public, str(dds))
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

    return run_gui(prefill)


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
