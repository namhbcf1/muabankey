# -*- coding: utf-8 -*-
"""xa_nofog_sec.py -- tang bao mat cua XARENA MAP SÁNG.

PORT tu `tool/grant/src/xa_sec.py` (kien truc da chay that cho XAGrant),
doi tuong bao ve la BANG OFFSET PATCH cua No Fog thay vi bang dia chi engine.

MUC TIEU BAO MAT
================
1. KHONG con mot cong nao trong binary. Bang cong (MINIMAP / CORE / LEGACY:
   dia chi + byte goc + byte da) chi ton tai duoi dang CIPHERTEXT trong
   token da ky ECDSA cua server. Khoa giai ma (`gate`) chi co trong payload
   da ky, sinh rieng cho tung license.

   >>> BANG OFFSET LAY TU TOKEN, KHONG NHUNG VAO BINARY.
   >>> Ly do: khoa `gate` khac nhau cho tung license, ma cung mot ban ro
   >>> (bang offset) voi N khoa khac nhau se ra N ciphertext khac nhau ->
   >>> khong the nhung MOT blob tinh ma phuc vu moi key. Va neu client tu
   >>> tinh duoc gate tu key thi khong con bao ve gi. Vi vay ban ro phai do
   >>> server ma hoa theo gate cua tung license va gui trong token da ky.

   Hau qua: go EXE ra doc cung khong biet va vao dau, va byte gi. Patch
   "bo kiem tra license" -> khong co bang cong -> tool khong lam gi duoc.
   Keygen cung vo dung: khong co `gate` that thi giai ra rac.

2. Chu ky kiem bang PUBLIC KEY. Lo toan bo source client cung khong tao
   duoc token hop le. Dung license server gia (hosts + proxy) cung vo dung.

3. Moi chuoi/nhang so nhay cam (public key, API base, ten process game, ...)
   duoc ma hoa XOR voi khoa sinh tai runtime -> `strings`/`hexdump` tren EXE
   khong lo gi.

GHI CHU TRUNG THUC
==================
Khong co co che client-side nao la "khong the be". Ke tan cong chay tren may
cua ho luon co the patch code. Thu ma thiet ke nay bao dam: sau khi patch,
ho KHONG co bang cong -> tool khong hoat dong, va ho khong biet byte nao can
ghi vao dia chi nao.

Xem `xa_sec.py` de biet phan tich day du hon ve cac quyet dinh thiet ke.
"""
import base64
import hashlib
import json
import struct
import time

# ============================================================================
# 1. MA HOA HANG SO  (chong `strings`)
# ============================================================================

# Muoi sinh khoa XOR. Tach 2 manh, khong lien nhau trong file.
_SALT_A = b'XN|5d1c'
_SALT_B = b'9b27|fQ'


def _xk(i):
    """Sinh khoa XOR cho hang so thu i. Khong co bang khoa nao luu trong file."""
    h = hashlib.sha256(_SALT_A + bytes([i & 0xFF]) + _SALT_B).digest()
    return h[:16]


def _hx(blob_hex, i):
    """Giai ma mot hang so da ma hoa. '' neu hong."""
    try:
        raw = bytes.fromhex(blob_hex)
    except (ValueError, TypeError):
        return ''
    k = _xk(i)
    out = bytearray(len(raw))
    for n, b in enumerate(raw):
        out[n] = b ^ k[n % 16]
    try:
        return out.decode('utf-8')
    except UnicodeDecodeError:
        return ''


def _obf(i, text):
    """Dung o BUILD-TIME (gen_nofog_const.py) de tao blob. Khong dung luc chay."""
    raw = text.encode('utf-8')
    k = _xk(i)
    out = bytearray(len(raw))
    for n, b in enumerate(raw):
        out[n] = b ^ k[n % 16]
    return out.hex()


# Bang hang so: index -> blob hex. Sinh boi gen_nofog_const.py luc build.
try:
    from xa_nofog_const import BLOBS as _BLOBS
except Exception:                                   # chay khi chua generate
    _BLOBS = {}

_C = {}


def C(i):
    """Lay hang so thu i (da giai ma, cache lai)."""
    if i in _C:
        return _C[i]
    blob = _BLOBS.get(i, '')
    v = _hx(blob, i)
    _C[i] = v
    return v


# Chi so hang so, dung chung giua gen_nofog_const.py va file nay.
K_PUB_X = 1
K_PUB_Y = 2
K_API_BASE = 3
K_APP_NAME = 4
K_UA = 5
K_MUTEX = 6
K_REG_KEY = 7
K_ANCHOR_SALT = 8
K_PROCESS = 9
K_BUY_URL = 10
K_REGISTER_URL = 11
K_INSTALL_ROOT = 12

# Cac index 1..12 phai khop gen_nofog_const.py.

# ============================================================================
# 2. ECDSA P-256 VERIFY (pure python, khong phu thuoc thu vien ngoai)
# ============================================================================

_P = 0xffffffff00000001000000000000000000000000ffffffffffffffffffffffff
_A = _P - 3
_N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551
_GX = 0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296
_GY = 0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5
_B_COEF = 0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604b


class TokenError(Exception):
    """Token khong hop le. KHONG BAO GIO tiep tuc sau loi nay."""


def _inv(a, m):
    return pow(a, m - 2, m)


def _add(p1, p2):
    if p1 is None:
        return p2
    if p2 is None:
        return p1
    x1, y1 = p1
    x2, y2 = p2
    if x1 == x2 and (y1 + y2) % _P == 0:
        return None
    if p1 == p2:
        if y1 == 0:
            return None
        lam = (3 * x1 * x1 + _A) * _inv(2 * y1 % _P, _P) % _P
    else:
        lam = (y2 - y1) * _inv((x2 - x1) % _P, _P) % _P
    x3 = (lam * lam - x1 - x2) % _P
    y3 = (lam * (x1 - x3) - y1) % _P
    return (x3, y3)


def _mul(k, pt):
    r = None
    addend = pt
    while k:
        if k & 1:
            r = _add(r, addend)
        addend = _add(addend, addend)
        k >>= 1
    return r


def b64u_dec(s):
    """Giai base64url (khong padding). Nem ValueError neu hong."""
    if not isinstance(s, str):
        raise ValueError('not a str')
    s2 = s.replace('-', '+').replace('_', '/')
    s2 += '=' * (-len(s2) % 4)
    return base64.b64decode(s2, validate=False)


def _on_curve(pt):
    """True neu diem nam tren duong cong P-256 (y^2 == x^3 + ax + b).

    BAT BUOC kiem truoc khi dung public key / diem trung gian. Thieu buoc nay
    la lo hong "invalid curve attack": ke tan cong gui mot diem nam tren
    duong cong khac co cap nho, doan dan toa do, roi gia mao chu ky.
    """
    if not pt:
        return False
    x, y = pt
    if not (0 <= x < _P and 0 <= y < _P):
        return False
    return (y * y - (x * x * x + _A * x + _B_COEF)) % _P == 0


def public_key():
    """Doc public key tu hang so da ma hoa. (x, y). None neu khong hop le."""
    sx = C(K_PUB_X)
    sy = C(K_PUB_Y)
    if not sx or not sy:
        return None
    try:
        pt = (int(sx, 16), int(sy, 16))
    except ValueError:
        return None
    if not _on_curve(pt):
        return None
    return pt


def verify_sig(message, sig_b64u):
    """Xac minh chu ky ECDSA P-256 (raw r||s, 64 byte) tren `message` (bytes)."""
    try:
        sig = b64u_dec(sig_b64u)
    except Exception:
        return False
    if len(sig) != 64:
        return False
    r = int.from_bytes(sig[:32], 'big')
    s = int.from_bytes(sig[32:], 'big')
    # s > N/2 la chu ky "high-S": van hop le ve toan hoc, nhung tu choi de
    # tranh malleability (cung mot thong diep co 2 chu ky hop le).
    if not (1 <= r < _N and 1 <= s < _N):
        return False
    if s > _N // 2:
        return False

    q = public_key()
    if q is None:
        return False

    e = int.from_bytes(hashlib.sha256(message).digest(), 'big') % _N
    try:
        w = _inv(s, _N)
    except (ValueError, ZeroDivisionError):
        return False
    u1 = (e * w) % _N
    u2 = (r * w) % _N

    p1 = _mul(u1, (_GX, _GY))
    p2 = _mul(u2, q)
    if p1 is not None and not _on_curve(p1):
        return False
    if p2 is not None and not _on_curve(p2):
        return False

    pt = _add(p1, p2)
    if pt is None:
        return False
    if not _on_curve(pt):
        return False
    return pt[0] % _N == r


def parse_token(token):
    """Tach + xac minh token `xn1.<payload>.<sig>`.

    Tra dict payload. Nem TokenError neu sai chu ky.
    """
    if not isinstance(token, str):
        raise TokenError('token khong phai chuoi')
    parts = token.split('.')
    if len(parts) != 3 or parts[0] != 'xn1':
        raise TokenError('dinh dang token sai')

    body = (parts[0] + '.' + parts[1]).encode('ascii')
    if not verify_sig(body, parts[2]):
        raise TokenError('chu ky token KHONG hop le')

    try:
        payload = json.loads(b64u_dec(parts[1]).decode('utf-8'))
    except Exception:
        raise TokenError('payload token hong')
    if not isinstance(payload, dict):
        raise TokenError('payload token sai kieu')
    return payload


# ============================================================================
# 3. GIAI MA BANG OFFSET PATCH
# ============================================================================

def _sha256(*chunks):
    h = hashlib.sha256()
    for c in chunks:
        h.update(c)
    return h.digest()


# Mien cua dia chi: module game 32-bit nap o 0x400000.
_VA_MIN = 0x400000
_VA_MAX = 0x08000000
# Do dai byte goc/byte va phai bang nhau, va trong khoang hop ly.
_RUN_MIN = 1
_RUN_MAX = 16


def open_site_table(payload):
    """Giai ma khoi SITES tu token.

    Keystream = SHA-256("xn-ks" || gate || u32be(i)).

    Khoi ciphertext (`sv`) chi giai duoc khi co `gate` (`ss`) sinh rieng cho
    tung license, va `gate` chi co trong payload da ky. Khong co token hop le
    -> khong co gate -> khong giai duoc -> khong biet va vao dau.
    """
    if not isinstance(payload, dict):
        raise TokenError('payload sai kieu')

    gate_b64 = payload.get('ss')
    ct_b64 = payload.get('sv')
    if not gate_b64 or not ct_b64:
        raise TokenError('token thieu khoi SITES')

    try:
        gate = b64u_dec(gate_b64)
        ct = b64u_dec(ct_b64)
    except Exception:
        raise TokenError('khoi SITES khong phai base64')

    if len(gate) != 16:
        raise TokenError('gate sai kich thuoc')
    if len(ct) < 16 or len(ct) > 8192:
        raise TokenError('khoi SITES sai kich thuoc')

    out = bytearray(len(ct))
    blocks = (len(ct) + 31) // 32
    for b in range(blocks):
        ks = _sha256(b'xn-ks', gate, struct.pack('>I', b))
        for j in range(32):
            at = b * 32 + j
            if at >= len(ct):
                break
            out[at] = ct[at] ^ ks[j]

    # Rang buoc dinh dang: ban ro PHAI la JSON object => patch ham giai ma
    # de "return []" se bi bat o day, khong am tham va vao dia chi rac.
    if not out.startswith(b'{'):
        raise TokenError('khoi SITES khong hop le')

    try:
        blob = json.loads(out.decode('utf-8'))
    except Exception:
        raise TokenError('khoi SITES khong giai ma duoc')
    if not isinstance(blob, dict):
        raise TokenError('khoi SITES sai kieu')
    return blob


class SiteTable(object):
    """Toan bo tri thuc patch cua No Fog cho MOT license.

    Moi cong la (key, va, orig_hex, pat_hex). Khong the dung neu thieu token
    hop le.
    """

    # Nhom cong, thu tu CO DINH -- khop server `GROUPS`.
    GROUPS = ('viewport', 'minimap', 'legacy')

    def __init__(self, blob):
        if not isinstance(blob, dict):
            raise TokenError('khoi SITES sai kieu')

        raw = blob.get('s')
        if not isinstance(raw, list) or not raw:
            raise TokenError('bang cong rong')
        if len(raw) > 128:
            raise TokenError('bang cong qua lon')

        self._sites = []
        self._groups = {}
        seen_keys = set()
        seen_addrs = set()

        for row in raw:
            if not isinstance(row, list) or len(row) < 5:
                raise TokenError('dong bang cong sai dinh dang')
            key, group, va, orig_s, pat_s = row[0], row[1], row[2], row[3], row[4]

            if not isinstance(key, str) or not (1 <= len(key) <= 8):
                raise TokenError('ten cong sai')
            if key in seen_keys:
                raise TokenError('trung ten cong: %s' % key)
            seen_keys.add(key)

            if group not in self.GROUPS:
                raise TokenError('nhom cong la: %r' % (group,))

            try:
                va = int(va)
            except (TypeError, ValueError):
                raise TokenError('dia chi cong khong phai so')
            if not (_VA_MIN <= va < _VA_MAX):
                raise TokenError('dia chi cong ngoai mien: 0x%X' % va)
            if va in seen_addrs:
                raise TokenError('trung dia chi cong: 0x%X' % va)
            seen_addrs.add(va)

            try:
                orig = bytes.fromhex(orig_s)
                pat = bytes.fromhex(pat_s)
            except (TypeError, ValueError):
                raise TokenError('byte cong khong phai hex')
            if not (_RUN_MIN <= len(orig) <= _RUN_MAX):
                raise TokenError('do dai byte cong ngoai mien')
            if len(pat) != len(orig):
                raise TokenError('byte goc va byte va khac do dai: %s' % key)
            # Ghi de bang CHINH no la vo nghia -> bang cong bi sua.
            if orig == pat:
                raise TokenError('byte goc bang byte va: %s' % key)

            self._sites.append((key, va, orig_s.lower(), pat_s.lower()))
            self._groups.setdefault(group, []).append(
                (key, va, orig_s.lower(), pat_s.lower()))

        if not self._sites:
            raise TokenError('bang cong rong')

    # -- truy van ---------------------------------------------------------
    def all(self):
        """Toan bo cong, thu tu nhu server gui."""
        return list(self._sites)

    def group(self, name):
        """Cong cua mot nhom ('viewport' | 'minimap' | 'legacy')."""
        return list(self._groups.get(name, ()))

    def groups(self):
        """[(ten_nhom, [cong...])] theo thu tu CO DINH, bo nhom rong."""
        return [(g, list(self._groups[g])) for g in self.GROUPS
                if self._groups.get(g)]

    def default(self):
        """Cong mac dinh = viewport + minimap (giong `DEFAULT` cu)."""
        return self.group('viewport') + self.group('minimap')

    def full(self):
        """Toan bo cong (giong `--full` cu)."""
        return self.all()

    def __len__(self):
        return len(self._sites)

    def keys(self):
        return [s[0] for s in self._sites]


# ============================================================================
# 4. TIEN ICH BAO VE STATE CUC BO
# ============================================================================

def gate_key(gate_hex):
    """Khoa cuc bo rieng cho tung license (tu token) -- dung cho MAC state."""
    try:
        return hashlib.sha256(b'xn-state|' + bytes.fromhex(gate_hex)).digest()
    except Exception:
        return hashlib.sha256(b'xn-state|').digest()


def mac(key_bytes, data):
    """HMAC-SHA256 (khong can thu vien ngoai)."""
    import hmac
    return hmac.new(key_bytes, data, hashlib.sha256).digest()


def integrity(payload):
    """Phep kiem toan ven cuc bo.

    KHONG dung hash tu tham chieu. Thay vao do kiem cac bat bien ma mot ban
    patch "tat license" hay lam hong:
      - co day du public key va nam tren duong cong
      - ham xac minh chu ky con hoat dong (tu kiem bang sig gia)
      - khoi SITES giai ma duoc thanh SiteTable hop le
    Tra (ok, danh_sach_ly_do).
    """
    bad = []
    if public_key() is None:
        bad.append('no-pubkey')
    # Neu ai patch verify_sig de luon tra True thi phep thu nay bat duoc.
    try:
        if verify_sig(b'probe', 'A' * 86):
            bad.append('verify-always-true')
    except Exception:
        pass
    if payload is not None:
        try:
            SiteTable(open_site_table(payload))
        except TokenError:
            bad.append('no-site-block')
        except Exception:
            bad.append('site-block-error')
    return (len(bad) == 0), bad


# ============================================================================
# 5. KIEM TRA TOKEN OFFLINE (dung de test khong can server)
# ============================================================================

# Ma loi -> thong bao cho nguoi dung. Dung chung cho CLI va run().
_TOKEN_ERRORS = {
    'no_token': (
        'Server chua tra token bao ve ban quyen.\n'
        '  Tool can token de biet VA VAO DAU; khong co token thi khong lam\n'
        '  duoc gi. Kiem tra: dang chay EXE cu, hoac server chua cap nhat.\n'
        '  Tai ban moi nhat roi thu lai.'),
    'bad_format': 'Token sai dinh dang (phai la xn1.<payload>.<sig>).',
    'bad_sig': (
        'CHU KY TOKEN KHONG HOP LE.\n'
        '  Token khong do server cua XArena cap, hoac da bi sua.\n'
        '  Tool tu choi de khong va sai byte vao game.'),
    'bad_payload': 'Payload token hong hoac sai kieu.',
    'no_sites': 'Token thieu khoi bang cong (server qua cu).',
    'bad_sites': 'Khoi bang cong khong giai ma duoc (token bi sua?).',
    'wrong_app': 'Token nay cap cho san pham khac, khong phai XARENA MAP SÁNG.',
}


def bind_token_to_machine(result, hwid=None, now=None, expire_skew=0):
    """Kiem tra token co dung MAY NAY va con HAN khong.

    VI SAO CAN: `verify_token_local()` chi kiem CHU KY + truong 'a' (app).
    Payload do server ky co du `h` (hwid), `e` (expires_at), `n` (now),
    `k` (key) nhung client KHONG doc. He qua: copy `lic.bin` tu may A sang
    may B la dung duoc — token van hop le vi chu ky dung, chi la no cap cho
    may khac.

    Ham nay nhan ket qua cua verify_token_local va kiem them:
        - payload['h'] phai trung hwid cua may dang chay
        - payload['e'] (neu > 0) phai con o tuong lai

    Tham so:
        result : dict tra ve tu verify_token_local (phai co 'ok': True)
        hwid   : hwid cua may hien tai; None = bo qua kiem hwid
                 (dung khi goi tu test khong co phan cung)
        now    : moc thoi gian de so (mac dinh time.time())
        expire_skew : giay du bi cho lech dong ho

    Tra ve cung shape voi verify_token_local: {'ok': bool, 'code', 'msg', ...}
    KHONG BAO GIO raise.
    """
    if not result or not result.get('ok'):
        return result

    payload = result.get('payload') or {}

    # ---- 1. Han dung ----
    try:
        exp = int(payload.get('e') or 0)
    except Exception:
        exp = 0
    if exp > 0:
        t = time.time() if now is None else now
        if t > exp + expire_skew:
            return {
                'ok': False,
                'code': 'token_expired',
                'msg': ('Token bao ve da het han (%s).\n'
                        '  Chay lai tool khi co mang de lay token moi.'
                        % time.strftime('%Y-%m-%d %H:%M', time.localtime(exp))),
                'expires_at': exp,
            }

    # ---- 2. Rang buoc may ----
    if hwid is not None:
        want = str(payload.get('h') or '').strip().lower()
        got = str(hwid).strip().lower()
        # Server co the ky h rong (key chua bind) -> khi do bo qua.
        if want and got and want != got:
            return {
                'ok': False,
                'code': 'token_wrong_machine',
                'msg': ('Token nay cap cho MAY KHAC.\n'
                        '  Moi key chi dung cho 1 may. Vao muc "License cua toi"\n'
                        '  tren website de doi may neu can.'),
            }

    result['expires_at'] = exp
    return result


def token_error_msg(code, detail=''):
    """Thong bao than thien cho mot ma loi token."""
    base = _TOKEN_ERRORS.get(code) or ('loi token: %s' % code)
    if detail:
        return base + '\n  chi tiet: %s' % detail
    return base


def verify_token_local(token, app=None):
    """Xac minh + giai ma token HOAN TOAN CUC BO. KHONG goi mang.

    Dung de test khong can server:
        python -c "import xa_nofog_sec as S; import sys; \\
print(S.verify_token_local(open(sys.argv[1]).read()))" token.txt

    Tra dict:
        {'ok': True,
         'payload': {...},            # payload da ky
         'gate': '<hex 32>',          # gate cua license nay
         'sites': SiteTable,          # bang cong DA GIAI MA
         'groups': [(ten, [cong...])],
         'count': int}
      hoac
        {'ok': False, 'code': '...', 'msg': '...'}

    KHONG BAO GIO raise: moi loi duoc tra ve duoi dang code/message.
    """
    if not token:
        return {'ok': False, 'code': 'no_token',
                'msg': token_error_msg('no_token')}
    if not isinstance(token, str):
        return {'ok': False, 'code': 'bad_format',
                'msg': token_error_msg('bad_format')}
    token = token.strip()

    # 1. Chu ky TRUOC TIEN -- moi truong khac chi duoc dung sau buoc nay.
    if not token.startswith('xn1.'):
        return {'ok': False, 'code': 'bad_format',
                'msg': token_error_msg('bad_format')}
    try:
        payload = parse_token(token)
    except TokenError as e:
        code = 'bad_sig' if 'chu ky' in str(e) else 'bad_format'
        return {'ok': False, 'code': code,
                'msg': token_error_msg(code, str(e))}
    except Exception as e:
        return {'ok': False, 'code': 'bad_payload',
                'msg': token_error_msg('bad_payload', str(e))}

    # 2. Token phai cap cho dung san pham.
    if app is not None:
        got = payload.get('a')
        if got != app:
            return {'ok': False, 'code': 'wrong_app',
                    'msg': token_error_msg('wrong_app', 'token a=%r' % (got,))}

    # 3. Giai ma bang cong.
    try:
        table = SiteTable(open_site_table(payload))
    except TokenError as e:
        code = ('no_sites' if 'thieu khoi' in str(e) else 'bad_sites')
        return {'ok': False, 'code': code,
                'msg': token_error_msg(code, str(e))}
    except Exception as e:
        return {'ok': False, 'code': 'bad_sites',
                'msg': token_error_msg('bad_sites', str(e))}

    gate_hex = ''
    try:
        gate_hex = b64u_dec(payload.get('ss') or '').hex()
    except Exception:
        pass

    return {
        'ok': True,
        'payload': payload,
        'gate': gate_hex,
        'sites': table,
        'groups': table.groups(),
        'count': len(table),
    }
