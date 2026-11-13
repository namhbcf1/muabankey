# -*- coding: utf-8 -*-
"""xa_grant_sec.py -- Xac minh + giai ma token `xg1.` cho XA THÊM TÀI NGUYÊN.

VAN DE TRUOC DAY
----------------
`xa_grant.py` nhung THANG toa do ham engine vao source:

    BUILDER = 0x42BDE0
    SENDER  = 0x42BA60
    ...

Ai co file .py (hoac go duoc EXE bang pyinstxtractor) la doc duoc nguyen bang
dia chi -> biet chinh xac phai vao dau de sua bo nho game.

CACH LAM MOI (giong XARENA MAP SANG)
------------------------------------
Server KHONG gui bang dia chi. Server gui mot TOKEN da ky ECDSA P-256, trong
do co khoi dia chi DA MA HOA:

    token   = "xg1." + b64u(JSON payload) + "." + b64u(chu ky ECDSA)
    payload = { ..., 'gk': <gate hex>, 'av': <ciphertext b64u>, 'as': <gate b64u> }

    gate      = 16 byte NGAU NHIEN, sinh RIENG cho tung license
    keystream = SHA-256("xg-ks" || gate || u32be(block_index))
    plaintext = ciphertext XOR keystream

He qua:
  * Khong co token hop le  -> khong co gate -> khong giai duoc bang dia chi.
  * Gate khac nhau moi license -> cung mot bang nhung moi khach mot ban ma
    hoa khac nhau, nen mot blob tinh trong EXE la vo nghia.
  * Chu ky ECDSA khong the sua: doi mot byte trong payload la hong.

GIOI HAN PHAI NEU RO: nguoi sua binary van bo qua duoc toan bo file nay.
Lop nay chan kich ban "lay token cua nguoi khac / dung tool cu", KHONG chan
duoc nguoi tu viet lai client. Muon chan tan goc phai bat online moi lan chay.
"""

import base64
import hashlib
import json
import struct

# ---------------------------------------------------------------------------
# Hang so cau truc (khong phai dia chi engine -> khong can ma hoa)
# ---------------------------------------------------------------------------

TOKEN_PREFIX = 'xg1.'
# PHAI khop `const APP` trong src/routes/xa-grant-server.js:38
APP = 'xagrant'

# Dia chi server. Doi khi chuyen domain.
API_BASE = 'https://xienhl.com'

# Kich thuoc hop ly. Dat tran de token rac khong lam treo client.
MIN_PAYLOAD = 32
MAX_PAYLOAD = 32768
GATE_LEN = 16
MAX_PLAIN = 16384


class TokenError(Exception):
    """Token sai dinh dang / sai chu ky / khong giai duoc."""


class HWIDError(Exception):
    """Khong tao duoc HWID (thieu quyen / khong doc duoc phan cung)."""


# ---------------------------------------------------------------------------
# Base64url (khong padding) -- dung chung dinh dang voi server JS
# ---------------------------------------------------------------------------

def b64u_dec(s):
    """Giai base64url thanh bytes. Nem TokenError neu hong."""
    if not isinstance(s, str) or not s:
        raise TokenError('chuoi base64 rong')
    if len(s) > 65536:
        raise TokenError('chuoi base64 qua dai')
    t = s.replace('-', '+').replace('_', '/')
    t += '=' * (-len(t) % 4)
    try:
        return base64.b64decode(t, validate=True)
    except Exception:
        raise TokenError('base64 khong hop le')


# ---------------------------------------------------------------------------
# ECDSA P-256 -- tu cai dat, KHONG phu thuoc thu vien ngoai
#
# Vi sao tu viet: EXE dong goi bang PyInstaller/Nuitka. Them `cryptography`
# lam binary phinh to va tang kha nang bi AV bao nham. P-256 chi can ~60 dong.
# ---------------------------------------------------------------------------

# Duong cong secp256r1 (P-256), dang affine.
_P = 0xFFFFFFFF00000001000000000000000000000000FFFFFFFFFFFFFFFFFFFFFFFF
_A = _P - 3
_B = 0x5AC635D8AA3A93E7B3EBBD55769886BC651D06B0CC53B0F63BCE3C3E27D2604B
_N = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551
_GX = 0x6B17D1F2E12C4247F8BCE6E563A440F277037D812DEB33A0F4A13945D898C296
_GY = 0x4FE342E2FE1A7F9B8EE7EB4A7C0F9E162BCE33576B315ECECBB6406837BF51F5


def _on_curve(pt):
    """True neu diem nam tren duong cong (hoac la diem vo cuc)."""
    if pt is None:
        return True
    x, y = pt
    if not (0 <= x < _P and 0 <= y < _P):
        return False
    return (y * y - (x * x * x + _A * x + _B)) % _P == 0


def _add(p1, p2):
    """Cong 2 diem tren duong cong. None = diem vo cuc."""
    if p1 is None:
        return p2
    if p2 is None:
        return p1
    x1, y1 = p1
    x2, y2 = p2
    if x1 == x2:
        if (y1 + y2) % _P == 0:
            return None
        # Nhan doi
        lam = (3 * x1 * x1 + _A) * pow(2 * y1, _P - 2, _P) % _P
    else:
        lam = (y2 - y1) * pow(x2 - x1, _P - 2, _P) % _P
    x3 = (lam * lam - x1 - x2) % _P
    y3 = (lam * (x1 - x3) - y1) % _P
    return (x3, y3)


def _mul(k, pt):
    """Nhan diem voi so nguyen k (double-and-add)."""
    out = None
    addend = pt
    while k:
        if k & 1:
            out = _add(out, addend)
        addend = _add(addend, addend)
        k >>= 1
    return out


def _sha256(*chunks):
    h = hashlib.sha256()
    for c in chunks:
        h.update(c)
    return h.digest()


def verify_sig(message, sig_b64u, pub_xy):
    """Xac minh chu ky ECDSA P-256/SHA-256 (dang r||s 64 byte, base64url).

    pub_xy = (x, y) hai so nguyen. Tra True/False. KHONG nem ra ngoai.
    """
    try:
        sig = b64u_dec(sig_b64u)
    except TokenError:
        return False
    if len(sig) != 64:
        return False

    r = int.from_bytes(sig[:32], 'big')
    s = int.from_bytes(sig[32:], 'big')
    if not (1 <= r < _N and 1 <= s < _N):
        return False

    # Tu choi high-S: chu ky ECDSA co hai dang tuong duong (s va N-s).
    # Chi nhan low-S de mot token khong the bi doi hinh dang ma van dung.
    if s > _N // 2:
        return False

    pub = (pub_xy[0], pub_xy[1])
    if not _on_curve(pub):
        return False

    # e = leftmost 256 bit cua SHA-256(message)
    e = int.from_bytes(_sha256(message), 'big')
    w = pow(s, _N - 2, _N)
    u1 = (e * w) % _N
    u2 = (r * w) % _N

    pt = _add(_mul(u1, (_GX, _GY)), _mul(u2, pub))
    if pt is None:
        return False
    return (pt[0] % _N) == r


# ---------------------------------------------------------------------------
# Giai ma khoi ENGINE
# ---------------------------------------------------------------------------

def open_engine(payload):
    """Giai khoi bang dia chi engine tu payload da ky.

    Tra dict JSON cua bang ENGINE. Nem TokenError neu hong.

    Khoi nay chi giai duoc khi co `gate` sinh rieng cho tung license, va
    `gate` chi nam trong payload DA KY. Khong co token hop le -> khong co
    gate -> khong biet dia chi nao de goi.
    """
    if not isinstance(payload, dict):
        raise TokenError('payload sai kieu')

    gate_b64 = payload.get('as') or payload.get('gk')
    ct_b64 = payload.get('av')
    if not gate_b64 or not ct_b64:
        raise TokenError('token thieu khoi ENGINE')

    try:
        gate = b64u_dec(gate_b64)
        ct = b64u_dec(ct_b64)
    except TokenError:
        raise TokenError('khoi ENGINE khong phai base64')

    if len(gate) != GATE_LEN:
        raise TokenError('gate sai kich thuoc')
    if len(ct) < 16 or len(ct) > MAX_PLAIN:
        raise TokenError('khoi ENGINE sai kich thuoc')

    out = bytearray(len(ct))
    blocks = (len(ct) + 31) // 32
    for b in range(blocks):
        ks = _sha256(b'xg-ks', gate, struct.pack('>I', b))
        for j in range(32):
            at = b * 32 + j
            if at >= len(ct):
                break
            out[at] = ct[at] ^ ks[j]

    # Rang buoc dinh dang: ban ro PHAI la JSON object. Nho vay ham giai ma bi
    # sua de "return {}" se bi bat o day, khong am tham roi vao dia chi rac
    # (goi ham lung tung trong tien trinh game => crash hoac hong tran).
    if not out.startswith(b'{'):
        raise TokenError('khoi ENGINE giai ra khong phai JSON')

    try:
        eng = json.loads(out.decode('utf-8'))
    except Exception:
        raise TokenError('khoi ENGINE khong phai JSON hop le')

    if not isinstance(eng, dict) or 'a' not in eng:
        raise TokenError('khoi ENGINE thieu truong "a"')

    _validate_engine(eng)
    return eng


def _validate_engine(eng):
    """Kiem tra cau truc bang dia chi truoc khi dung.

    Muc dich: mot khoi bi sua hoac giai sai se khong dung duoc. Gia tri ngoai
    vung .text cua EMPIRESX.EXE (0x401000..0x600000) gan nhu chac chan la rac.
    """
    addrs = eng.get('a')
    if not isinstance(addrs, list) or not addrs:
        raise TokenError('bang dia chi rong')

    for v in addrs:
        if not isinstance(v, int):
            raise TokenError('dia chi khong phai so nguyen')
        # 0 = o RESERVED, duoc phep
        if v != 0 and not (0x400000 <= v < 0x800000):
            raise TokenError('dia chi ngoai vung anh: 0x%X' % v)

    for key in ('s', 'v', 'o'):
        if key in eng and not isinstance(eng[key], dict):
            raise TokenError('truong %r phai la object' % key)


# ---------------------------------------------------------------------------
# Giai ma + kiem tra token day du
# ---------------------------------------------------------------------------

def parse_token(token, pub_xy):
    """Tach va XAC MINH CHU KY token `xg1.<payload>.<sig>`.

    Tra dict payload. Nem TokenError neu sai.
    """
    if not isinstance(token, str):
        raise TokenError('token khong phai chuoi')
    token = token.strip()
    if not token.startswith(TOKEN_PREFIX):
        raise TokenError('token khong bat dau bang %r' % TOKEN_PREFIX)

    parts = token.split('.')
    if len(parts) != 3:
        raise TokenError('token phai co 3 phan')

    body = (parts[0] + '.' + parts[1]).encode('ascii', 'strict')
    if not verify_sig(body, parts[2], pub_xy):
        raise TokenError('chu ky token KHONG hop le')

    raw = b64u_dec(parts[1])
    if not (MIN_PAYLOAD <= len(raw) <= MAX_PAYLOAD):
        raise TokenError('payload sai kich thuoc')

    try:
        payload = json.loads(raw.decode('utf-8'))
    except Exception:
        raise TokenError('payload khong phai JSON')
    if not isinstance(payload, dict):
        raise TokenError('payload phai la object')
    return payload


def verify_token(token, pub_xy, app=APP, now=None, hwid=None):
    """Xac minh token va tra bang engine da giai.

    Tham so `hwid`: neu truyen vao, token PHAI cap cho dung may nay.
    Khong truyen (None) = bo qua kiem may (dung cho test/--selftest).

    Tra dict:
        {'ok': True, 'engine': {...}, 'payload': {...}}
      hoac
        {'ok': False, 'code': '...', 'msg': '...'}

    KHONG BAO GIO nem ra ngoai: moi loi tra ve duoi dang code/msg de client
    hien thi thong bao tu te thay vi crash.
    """
    try:
        payload = parse_token(token, pub_xy)
    except TokenError as e:
        msg = str(e)
        code = 'bad_sig' if ('chu ky' in msg) else 'bad_format'
        return {'ok': False, 'code': code, 'msg': msg}
    except Exception as e:  # noqa: BLE001 - khong duoc crash client
        return {'ok': False, 'code': 'bad_payload', 'msg': str(e)}

    got_app = payload.get('a')
    if app is not None and got_app != app:
        return {'ok': False, 'code': 'wrong_app',
                'msg': 'token cap cho san pham khac (%r)' % (got_app,)}

    # ---- Rang buoc MAY ----
    # VI SAO CAN: token luu trong token.txt. Khong kiem may thi chep file
    # sang may khac la dung duoc (ca hai may cung chay tool, cung co banh
    # rang bang dia chi). Server da ky 'h' nhung truoc day client KHONG doc.
    if hwid is not None:
        want = str(payload.get('h') or '').strip().lower()
        got = str(hwid).strip().lower()
        if want and got and want != got:
            return {'ok': False, 'code': 'token_wrong_machine',
                    'msg': 'Token nay cap cho MAY KHAC.\n'
                           '  Moi key chi dung cho 1 may. Vao muc\n'
                           '  "License cua toi" tren website de doi may.'}

    # Han dung: 'e' = 0 nghia la vinh vien.
    try:
        exp = int(payload.get('e') or 0)
    except Exception:
        exp = 0
    if exp > 0:
        import time
        if (time.time() if now is None else now) > exp:
            return {'ok': False, 'code': 'token_expired',
                    'msg': 'token bao ve da het han, chay lai khi co mang'}

    # ---- Hạn của TOKEN (khác hạn license) ----
    # `n` = thời điểm server ký, `c` = số giây client nên gọi lại,
    # `g` = số giờ ân hạn được chạy tiếp khi không làm mới được.
    #
    # VÌ SAO CẦN: 'e' là hạn LICENSE (0 = vĩnh viễn), nên token vĩnh viễn
    # dùng mãi được và KHÔNG THỂ thu hồi. Cửa sổ `c` + ân hạn `g` buộc
    # client quay lại server định kỳ.
    #
    # BA MỨC (fail-soft, không chặn oan khách mất mạng):
    #   tươi   : t <= n+c            -> dùng luôn, không gọi mạng
    #   cũ     : n+c < t <= n+c+g    -> THỬ làm mới; thất bại vẫn cho chạy
    #   hết hạn: t > n+c+g           -> bắt buộc làm mới, thất bại thì chặn
    issued = 0
    try:
        issued = int(payload.get('n') or 0)
    except Exception:
        issued = 0
    try:
        check_after = int(payload.get('c') or 0)
    except Exception:
        check_after = 0
    try:
        grace_h = int(payload.get('g') or 0)
    except Exception:
        grace_h = 0

    fresh = True
    stale = False
    expired_token = False
    if issued > 0 and check_after > 0:
        import time
        t = time.time() if now is None else now
        soft = issued + check_after
        hard = soft + max(0, grace_h) * 3600
        if t > hard:
            expired_token = True
            fresh = False
        elif t > soft:
            stale = True
            fresh = False

    try:
        eng = open_engine(payload)
    except TokenError as e:
        msg = str(e)
        code = 'no_engine' if ('thieu khoi' in msg) else 'bad_engine'
        return {'ok': False, 'code': code, 'msg': msg}
    except Exception as e:  # noqa: BLE001
        return {'ok': False, 'code': 'bad_engine', 'msg': str(e)}

    return {'ok': True, 'engine': eng, 'payload': payload,
            'expires_at': exp,
            'issued_at': issued,
            'check_after': check_after,
            'grace_hours': grace_h,
            'fresh': fresh,
            'stale': stale,
            'token_expired': expired_token,
            'hwid': payload.get('h') or '',
            'key': payload.get('k') or '',
            'sid': payload.get('s') or ''}


# ---------------------------------------------------------------------------
# HWID cua may hien tai
#
# PHAI KHOP cach server nhan: hwid = sha256('v1|' + guid|bios|cpu|vol)[:32]
# (xem src/routes/xa-grant-server.js va src/lib/trial-quota.js deriveIds)
# ---------------------------------------------------------------------------

def _post_json(url, payload, timeout=20):
    """POST JSON, tra (status, dict|None). Khong bao gio raise."""
    import json as _json
    import urllib.error
    import urllib.request

    body = _json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(url, data=body, method='POST')
    req.add_header('Content-Type', 'application/json')
    req.add_header('Accept', 'application/json')
    # User-Agent rieng: server co the dung de phan biet client that
    req.add_header('User-Agent', 'XAGrant/1.0')
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read(65536)
            status = resp.getcode()
    except urllib.error.HTTPError as e:
        try:
            raw = e.read(65536)
        except Exception:
            raw = b''
        status = e.code
    except Exception:
        return 0, None
    try:
        return status, _json.loads(raw.decode('utf-8'))
    except Exception:
        return status, None


def refresh_token(api_base, key, hwid, sid=None, timeout=20):
    """Xin token MOI tu server (/api/xg/check).

    Tra (ok: bool, token_moi|'', msg).
    Dung khi token cu qua cua so tuoi (`stale`). Khong bao gio raise.

    VI SAO GOI /check chu khong /activate: /activate chi cap SESSION MOI va
    tu choi khi license da bind (dung thiet ke). /check la duong lam moi:
    no xac thuc license + hwid hien tai roi tra token moi.
    """
    url = api_base.rstrip('/') + '/api/xg/check'
    body = {'key': key, 'hwid': hwid}
    if sid:
        body['sid'] = sid
    status, data = _post_json(url, body, timeout=timeout)
    if status != 200 or not isinstance(data, dict):
        code = (data or {}).get('code') if isinstance(data, dict) else ''
        return False, '', 'khong lam moi duoc (HTTP %s%s)' % (
            status, (': ' + str(code)) if code else '')
    tok = data.get('token') or ''
    if not tok:
        return False, '', 'server khong tra token'
    return True, tok, 'ok'
    try:
        import subprocess
        out = subprocess.run(
            cmd, capture_output=True, timeout=25,
            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        if out.returncode != 0:
            return ''
        return out.stdout.decode('utf-8', 'ignore').strip()
    except Exception:
        return ''


def report_violation(api_base, key, hwid, code, sid=None, timeout=12):
    """Bao server biet client phat hien can thiep (debugger/VM/patch).

    Tra (ok: bool, msg). Khong bao gio raise.

    VI SAO BAO LEN SERVER chu khong chi thoat:
        * Thoat don gian: nguoi dung chay lai la xong, khong ai biet.
        * Bao len server: cong don theo (key, hwid). Qua VIOLATION_BUDGET
          (mac dinh 8) server TU THU HOI license -> muon dung tiep phai mua
          key moi, va moi lan thu lai deu bi ghi lai.
        * Server da xac thuc (key + hwid/sid) nen nguoi khac khong "dot"
          han muc cua may that duoc.
    """
    url = api_base.rstrip('/') + '/api/xg/violation'
    body = {'key': key or '', 'hwid': hwid or '', 'code': code or 'unknown'}
    if sid:
        body['sid'] = sid
    status, data = _post_json(url, body, timeout=timeout)
    if status == 200 and isinstance(data, dict) and data.get('ok'):
        return True, 'reported'
    return False, 'report failed (HTTP %s)' % status


def _run(cmd):
    """Chay lenh Windows, tra stdout (str) hoac '' neu loi."""
    try:
        import subprocess
        out = subprocess.run(
            cmd, capture_output=True, timeout=25,
            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        if out.returncode != 0:
            return ''
        return out.stdout.decode('utf-8', 'ignore').strip()
    except Exception:
        return ''


def _cim(klass, prop, timeout=25):
    """Doc 1 thuoc tinh WMI qua PowerShell CIM. Tra '' neu loi.

    VI SAO KHONG DUNG `wmic`:
      Microsoft khai tu WMIC tu Windows 11 24H2 va go mac dinh tren ban moi.
      May khong con wmic thi BIOS/CPU rong -> HWID bam chuoi co phan rong ->
      KHAC han -> license da bind bi tu choi.

    VI SAO KHONG DUNG GetSystemFirmwareTable (SMBIOS):
      Da do tren may that: SMBIOS type 2 tra serial MAINBOARD
      (L940NRCX00DYW7MB) trong khi wmic/Win32_BIOS tra serial BIOS FIRMWARE
      (L9NRCX07959140E). Hai thu KHAC NHAU -> doi sang SMBIOS lam HWID doi.

    CIM `Win32_BIOS.SerialNumber` tra DUNG gia tri wmic tra (da kiem chung
    tren may that) -> thay the an toan, HWID khong doi.
    """
    try:
        ps = ("(Get-CimInstance -ClassName %s -ErrorAction Stop).%s"
              % (klass, prop))
        r = subprocess.run(
            ['powershell', '-NoProfile', '-NonInteractive',
             '-ExecutionPolicy', 'Bypass', '-Command', ps],
            capture_output=True, text=True, timeout=timeout,
            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        if r.returncode != 0:
            return ''
        for line in (r.stdout or '').splitlines():
            if line.strip():
                return line.strip()
        return ''
    except Exception:
        return ''


def _volume_serial():
    """Serial o dia C: dang 'XXXX-XXXX' - GIONG HET `cmd /c vol C:`.

    Khong dung subprocess nua: `cmd /c vol C:` lam nhay cua so den tren mot
    so may. GetVolumeInformationW tra 8 hex; `vol` in co dau gach sau 4 ky tu
    nen phai chen lai cho khop dinh dang cu -> HWID khong doi.
    """
    try:
        import ctypes
        serial = ctypes.c_ulong(0)
        maxlen = ctypes.c_ulong(0)
        flags = ctypes.c_ulong(0)
        ok = ctypes.windll.kernel32.GetVolumeInformationW(
            ctypes.c_wchar_p('C:\\'), None, 0,
            ctypes.byref(serial), ctypes.byref(maxlen), ctypes.byref(flags),
            None, 0)
        if not ok:
            return ''
        v = '%08X' % serial.value
        return '%s-%s' % (v[:4], v[4:]) if len(v) == 8 else v
    except Exception:
        return ''


def machine_parts():
    """Doc 4 thong so phan cung. Tra (guid, bios, cpu, vol).

    THU TU VA DINH DANG KHONG DUOC DOI: HWID = sha256('v1|' + 4 manh).
    Doi bat ky manh nao -> HWID doi -> moi license da ban bi tu choi.
    """
    guid = ''
    try:
        import winreg
        k = winreg.OpenKey(
            winreg.HKEY_LOCAL_MACHINE,
            r'SOFTWARE\Microsoft\Cryptography', 0,
            winreg.KEY_READ | getattr(winreg, 'KEY_WOW64_64KEY', 0))
        guid, _ = winreg.QueryValueEx(k, 'MachineGuid')
        winreg.CloseKey(k)
    except Exception:
        # Du phong: CIM Win32_ComputerSystemProduct.UUID
        guid = _cim('Win32_ComputerSystemProduct', 'UUID')

    # CIM truoc (Win 11 moi), wmic sau (may cu thieu PowerShell)
    bios = _cim('Win32_BIOS', 'SerialNumber')
    if not bios:
        bios = _run(['wmic', 'bios', 'get', 'SerialNumber']).split('\n')[-1].strip()

    cpu = _cim('Win32_Processor', 'Name')
    if not cpu:
        cpu = _run(['wmic', 'cpu', 'get', 'Name']).split('\n')[-1].strip()

    vol = _volume_serial()
    if not vol:
        vol = _run(['cmd', '/c', 'vol', 'C:'])
        vol = vol.split('is')[-1].strip() if 'is' in vol else vol

    return (guid or '', bios or '', cpu or '', vol or '')


def compute_hwid(parts=None):
    """HWID cua may hien tai. Nem HWIDError neu khong du thong tin.

    FAIL CLOSED: khong bao gio bam chuoi rong -> neu thieu du lieu thi bao
    loi, khong tra mot hash hang so (moi may se co cung HWID -> vo dung).
    """
    if parts is None:
        parts = machine_parts()
    ne = [str(p).strip() for p in parts if str(p).strip()]
    if len(ne) < 2:
        raise HWIDError('Khong doc duoc thong tin phan cung de tao HWID')
    raw = 'v1|' + '|'.join(str(p).strip() for p in parts)
    return hashlib.sha256(raw.encode('utf-8')).hexdigest()[:32]
