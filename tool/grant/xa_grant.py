#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""xa_grant.py -- Goi ham engine engine (ChangeResource builder) tu ngoai.

TAT CA DIA CHI DUOI DAY DA DUOC VERIFY BANG BYTE THAT trong
C:\\Program Files\\XArena\\Game\\AoE-HD\\EMPIRESX.EXE (ImageBase 0x400000,
DllCharacteristics = 0 => ASLR TAT, DEP TAT).

SIGNATURE THAT CUA BUILDER  (re-derived, xem bao cao)
------------------------------------------------------
    __thiscall void Builder_ChangeResource(int32 player, uint8 resSlot, float amount)
    ret 0xC  -> 12 byte tham so stack = 3 tham so
    ecx = sender object = [[ctx+0x3C]+0x58]

    Bang chung arg1 la DWORD: no duoc doc lai bang `8b 4c 24 10` (mov ecx,
    DWORD) va ghi `89 48 04` (mov DWORD [eax+4], ecx) -- tuc ghi ca 4 byte.
    Bang chung arg2 la BYTE: `8a 54 24 14` (mov dl, BYTE) roi `88 50 02`.
    Bang chung arg1 la CHI SO NGUOI CHOI chu khong phai con tro: ham anh em
    BUILDER_SIB co cung prologue va dung `cmp WORD [esp+4], 0xFFFF` lam sentinel
    "khong co doi tuong". Du lieu that truyen vao la `[ctx+0x4A]` (int16),
    xem 0x45F4E6 va 0x45F533.

    Record 8 byte duoc tao (alloc ALLOC_ADDR(8,1) -> vung da ZEROED):
        +0  0x05                (loai record, c6 00 05 @0x42BDFE)
        +1  (uint8)player       (88 48 01, cl <- [esp+0x10] @0x42BDEC)
        +2  (uint8)resSlot      (88 50 02, dl <- [esp+0x14] @0x42BDF0)
        +3  0x00                (khong ghi -> alloc da zero)
        +4  float32 amount      (89 48 04, ecx <- [esp+0x10] @0x42BDFA)

    Giai thich diem "nhin nhu doc [esp+0x10] hai lan":
    0x42BDF4 co `83 c4 08` = add esp,8. Truoc do esp thap hon 8.
    => 0x42BDEC/0x42BDF0 doc [esp+0x10]/[esp+0x14] = slot1/slot2 (arg1/arg2)
    0x42BDFA doc [esp+0x10] SAU khi add = slot3 (arg3). Hai tham so KHAC NHAU.

DUNG
----
    python xa_grant.py --key <TOKEN>     # nap token (lay tren website)
    python xa_grant.py --check
    python xa_grant.py --grant F 5000 --dry-run
    python xa_grant.py --grant F 5000 --i-understand-this-may-desync
    python xa_grant.py --stealth F 5000 --dry-run   # duong anti-cheat khong kiem
    python xa_grant.py --stealth F 5000             # KHONG can gate flag
    python xa_grant.py --selftest        # khong can game, khong can admin

HAI DUONG GRANT
---------------
    --grant    record type 0x05 qua BUILDER.
               Anti-cheat kiem amount > 0.0 -> ghi nhan "hack tai nguyen".

    --stealth  record type 0x67 sub=2, tu build 12 byte, gui thang SENDER.
               Anti-cheat dich 0x67/2 -> type 5 nhung phai tra player tu ring
               256 slot (0x100061F0). Ring tra 0 khi khong khop VA cung tra 0
               khi khop slot moi nhat -> player bi ghi = 0 -> nhanh type-5
               thoat tai `test edi,edi / jle` => KHONG kiem, KHONG bao.
               Van gui qua SENDER nen peer nhan va ap dung => khong desync.

CAN: Administrator + game dang chay + da vao tran that + token hop le.
"""
import ctypes
import ctypes.wintypes as wt
import base64
import json
import os
import re
import struct
import sys
import time

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

# Module xac minh token. Nam cung thu muc nen hoat dong ca khi chay .py lan
# khi da dong goi thanh .exe (Nuitka/PyInstaller gom ca goi).
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import xa_grant_sec as _sec  # noqa: E402
import xa_grant_guard as _guard  # noqa: E402

# ----------------------------------------------------------------------------
# Dia chi engine -- NAP TU TOKEN DA KY, khong con hardcode
#
# TRUOC DAY: cac hang so duoi day nam THANG trong file nay, nen ai doc duoc
# source (hoac go EXE) la biet chinh xac phai goi ham nao trong game.
#
# NAY: gia tri that den tu token `xg1.` do server ky, trong do bang dia chi
# da duoc MA HOA bang `gate` rieng cua tung license. Xem xa_grant_sec.py.
#
# Cac hang so duoi day chi la GIA TRI MAC DINH cho --selftest (kiem tra logic
# khong can game, khong can token) va lam lop du phong khi khong co token.
# Khi chay that, `load_engine_from_token()` ghi de toan bo.
# ----------------------------------------------------------------------------
PREFERRED_BASE = 0x400000
DLLCHAR_OFF = 0x46                      # DllCharacteristics trong PE optional header

# ===== GIA TRI MAC DINH: TAT CA = 0 =====
#
# Truoc day cac dong duoi day chua DIA CHI THAT (engine, engine, ...).
# Du da co token, chinh viec giu chung lam "gia tri mac dinh" van khien dia
# chi nam trong binary -> nguoi go EXE van doc duoc. Da kiem chung bang cach
# quet binary: SENDER van lo ra dang chuoi hex.
#
# Nay dat 0. Moi gia tri that den TU TOKEN. Neu chua nap token ma van goi
# vao game thi se bi chan boi `_require_engine()` (bao loi ro rang), khong
# am tham goi vao dia chi rong.
BUILDER        = 0
SENDER         = 0
APPLY_GATE     = 0
APPLY_IMPL     = 0
CHANGE_RES     = 0
VTABLE         = 0
WRAPPER_VTABLE = 0
PTR_WORLD      = 0

# Cac dia chi phu (chi dung de hien thi/kiem tra, khong tham gia stub).
ALLOC_ADDR       = 0
WRAP_CR          = 0
GAME_PKT         = 0
LOCAL_APPLY      = 0
BUILDER_SIB      = 0
RING_COPY        = 0
VTABLE_SETTINGS  = 0

# Offset trong object: day la HANG SO CAU TRUC, khong phai "dia chi ham".
# Chung khong cho biet phai goi ham nao, nen giu lai khong lam lo gi.
OFF_CTX        = 0x3C
OFF_PLAYERIDX  = 0x4A
OFF_SENDER     = 0x58
OFF_APPLY      = 0x14
OFF_ONLINE     = 0x10E4

# chuoi tai nguyen cua xa_measure.py (de validate da vao tran)
OFF_MANAGER, OFF_SLOTS, OFF_WRAPARRAY, OFF_PLAYER = 0x3F4, 0x3C, 0x40, 0x50
OFF_LOCAL_IDX  = 0x1590      # HANG SO 2 — KHONG phai local index (giu ten cu)
OFF_LOCAL_SLOT = 0x7C        # int16 [manager+0x7C] = LOCAL PLAYER SLOT INDEX
OFF_BITMASK    = 0xD8        # dword [wrapper+0xD8] = bitmask NHOM, KHONG phai 1<<slot
                             # do 2026-11-11: tran 9 slot -> slot1..4 = 0x1E, slot5..8 = 0x1E0
                             # Chi de hien thi tham khao. KHONG dung lam identity.
OFF_LOCAL_MARK = 0x788       # float: 1.0 chi o slot cua MAY NAY (do live)
# ---------------------------------------------------------------------------
# THU TU TAI NGUYEN TRONG playerdata -- DA DO, KHONG DOAN
#
# SUA 2026-11-11 01:40. Bang cu ghi F=0x00 W=0x04 S=0x08 G=0x0C -> SAI.
#
# Bang that, chung minh bang 2 phep do doc lap (HUD game vs RAM cung thoi diem):
#
#   tran A (6 slot): HUD  thit 250 | go 450 | vang 450 | da 200
#                    RAM  +04=250 | +00=450 | +0C=450  | +08=200
#   tran B (9 slot): HUD  thit 995654 | go 994030 | vang 99444 | da 150
#                    RAM  +04=995691 | +00=994030 | +0C=99444 | +08=150
#
#   -> 8/8 khop. HUD lay tu anh chup that (_h2_0.png, _n1_0.png), doc icon
#      de xac dinh vi tri: icon1=thit(be/kem) icon2=go(nau do)
#      icon3=vang(金) icon4=da(xam).
#
# Khop voi phan tich tinh: HUD panel 0x432B23..0x432C0C gan
#   +0x04 -> widget 0x628 (X=440, trai nhat)   = Food
#   +0x00 -> widget 0x620 (X=480)              = Wood
#   +0x0C -> widget 0x624 (X=520)              = Gold
#   +0x08 -> widget 0x62c (X=560)              = Stone
# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# OFFSET TAI NGUYEN TRONG PLAYERDATA
#
# SUA 2026-11-11 03:10. Ban cu bi DOI CHO F va W:
#     CU (SAI): {'F': 0x04, 'W': 0x00, ...}
#     DUNG    : {'F': 0x00, 'W': 0x04, ...}
#
# Chung minh tu log that:
#   Lenh "go 100000" -> [result] "thit tai +0x04: 20 -> 100020"
#     => go nam o 0x04, va 20 -> 100020 la DUNG.
#     Nhung nhan hien thi ghi "thit" vi RES_NAME/api doc nham.
#   Lenh "go 100000" lan 2 -> [result] "go tai +0x00: 0 -> 0"
#     => doc 0x00 (thit, dang 0) chu khong phai go.
#
# Va xac nhan tu HUD: slot 6 co 100020 thit / 0 go / 100000 vang.
#   File log ghi "thit +0x04: 20->100020" nhung thuc te la GO.
#   Nghia la 0x04 = GO, khong phai THIT.
# ---------------------------------------------------------------------------
RES_OFF = {'F': 0x00, 'W': 0x04, 'S': 0x08, 'G': 0x0C}

# Chi so "slot tai nguyen" ghi vao record +2, dung cho 0x45DF10 -> array[slot].
# 0x45DF10 KHONG co bang hoan vi: no lay slot*4 cong thang vao cung mang
# playerdata+0x50. Vi vay slot phai la CHINH offset/4 cua bang tren.
#   0x45df20  mov 0x50(%ecx),%ecx     ; array = playerdata
#   0x45df2a  fadds (%ecx,%eax,4)     ; array[slot] += amount
# Engine slot (byte +2 trong record). Chung minh tu log that:
#   grant F 500 -> record "05 01 00 00 00 00 7A 44", +2 slot = 0 (food)
#   => FOOD = slot 0, khong phai wood.
# Ban cu ghi W=0, F=1 -> GOI SAI TAI NGUYEN khi grant.
RES_SLOT = {'F': 0, 'W': 1, 'S': 2, 'G': 3}

# Tap tai nguyen cho lenh `full`.
# BO 'S' (da) -- 2026-11-12: dedup 0x42BA10 bo record thu 2..4
# trong 500ms (cung size=8 + type=5), nen chi record dau chay.
# Giu 3 cai de moi cai co the lan luot chay khi cho du 500ms.
FULL_SET = ('F', 'W', 'G')
RES_NAME = {'F': 'food', 'W': 'wood', 'S': 'stone', 'G': 'gold'}

# Byte "nhan dang build" -- phai khop truoc khi lam bat cu thu gi.
#
# KHONG chua byte that: chu ky byte cua tung ham engine cung la tri thuc
# reverse-engineering, de lo ra thi nguoi go EXE biet ngay doan ma nao can
# tim. Nay nap tu token qua `load_engine_from_token()`.
# Dict rong = chua nap; `_require_engine()` se chan neu dung som.
SIG = {}

VT_SLOT_OFF = 0x08                       # [sender_vtable+0x08]
VT_SLOT_VAL = 0                          # nap tu token

# ----------------------------------------------------------------------------
# Nap bang dia chi tu token (THAY THE gia tri hardcode o tren)
# ----------------------------------------------------------------------------
# Anh xa ten -> chi so trong mang `a` cua khoi ENGINE. Thu tu nay CO DINH,
# khop voi `const ENGINE` trong src/routes/xa-grant-server.js.
_ENGINE_ORDER = (
    'BUILDER', 'SENDER', 'APPLY_GATE', 'APPLY_IMPL', 'CHANGE_RES',
    'VTABLE', 'WRAP_VTABLE', 'PTR_WORLD', 'ALLOC', 'VT_SLOT_VAL',
    'WRAP_CR', 'GAME_PKT', 'LOCAL_APPLY', 'BUILDER_SIB', 'RING_COPY',
    'RESERVED',
)

_ENGINE_LOADED = {'on': False, 'key': '', 'exp': 0, 'hwid': ''}


def engine_loaded():
    """True neu dia chi da duoc nap tu token that."""
    return _ENGINE_LOADED['on']


def load_engine_from_token(token, pub_xy, app=None, hwid=None):
    """Xac minh token roi GHI DE cac hang so dia chi toan cuc.

    Tra dict ket qua cua xa_grant_sec.verify_token (ok/code/msg).
    Khi ok=True, moi hang so BUILDER/SENDER/... da duoc thay bang gia tri
    giai ma tu token. Khi that bai, KHONG doi gi (giu gia tri cu) — ben goi
    phai tu quyet dinh co dung tiep hay khong.
    """
    global BUILDER, SENDER, APPLY_GATE, APPLY_IMPL, CHANGE_RES
    global VTABLE, WRAPPER_VTABLE, PTR_WORLD
    global OFF_CTX, OFF_PLAYERIDX, OFF_SENDER, OFF_APPLY, OFF_ONLINE
    global VT_SLOT_VAL, VT_SLOT_OFF, SIG
    global ALLOC_ADDR, WRAP_CR, GAME_PKT, LOCAL_APPLY, BUILDER_SIB, RING_COPY
    global VTABLE_SETTINGS

    if app is None:
        app = 'xagrant'
    r = _sec.verify_token(token, pub_xy, app=app, hwid=hwid)
    if not r.get('ok'):
        return r

    eng = r['engine']
    addrs = eng['a']

    def A(name):
        i = _ENGINE_ORDER.index(name)
        v = addrs[i]
        if v == 0 and name != 'RESERVED':
            raise GrantError('dia chi %s = 0 trong token' % name)
        return v

    try:
        BUILDER = A('BUILDER')
        SENDER = A('SENDER')
        APPLY_GATE = A('APPLY_GATE')
        APPLY_IMPL = A('APPLY_IMPL')
        CHANGE_RES = A('CHANGE_RES')
        VTABLE = A('VTABLE')
        WRAPPER_VTABLE = A('WRAP_VTABLE')
        PTR_WORLD = A('PTR_WORLD')
        VT_SLOT_VAL = A('VT_SLOT_VAL')

        # Dia chi phu: co thi nap, khong co thi de 0.
        for _nm, _var in (
            ('ALLOC', 'ALLOC_ADDR'),
            ('WRAP_CR', 'WRAP_CR'),
            ('GAME_PKT', 'GAME_PKT'),
            ('LOCAL_APPLY', 'LOCAL_APPLY'),
            ('BUILDER_SIB', 'BUILDER_SIB'),
            ('RING_COPY', 'RING_COPY'),
        ):
            if _nm in _ENGINE_ORDER:
                globals()[_var] = A(_nm)

        # Hang so cau truc (offset trong object) cung tu token.
        o = eng.get('o') or {}
        OFF_CTX = int(o.get('ctx', OFF_CTX))
        OFF_PLAYERIDX = int(o.get('playeridx', OFF_PLAYERIDX))
        OFF_SENDER = int(o.get('sender', OFF_SENDER))
        OFF_APPLY = int(o.get('apply', OFF_APPLY))
        OFF_ONLINE = int(o.get('online', OFF_ONLINE))

        v = eng.get('v') or {}
        VT_SLOT_OFF = int(v.get('vt_off', VT_SLOT_OFF))

        # Chu ky byte: dung de xac nhan dung phien ban EMPIRESX.EXE.
        s = eng.get('s') or {}
        for nm in ('BUILDER', 'SENDER', 'APPLY_GATE', 'APPLY_IMPL', 'CHANGE_RES'):
            hx = s.get(nm)
            if hx:
                SIG[globals()[nm]] = bytes.fromhex(hx)
    except GrantError as e:
        return {'ok': False, 'code': 'bad_engine', 'msg': str(e)}
    except (KeyError, ValueError, TypeError) as e:
        return {'ok': False, 'code': 'bad_engine',
                'msg': 'khoi ENGINE sai cau truc: %s' % e}

    _ENGINE_LOADED.update({
        'on': True,
        'key': r.get('key') or '',
        'exp': r.get('expires_at') or 0,
        'hwid': r.get('hwid') or '',
    })
    return r


# ----------------------------------------------------------------------------
# Doc token tu dia + khoa cong khai
# ----------------------------------------------------------------------------

def state_dir():
    """Thu muc luu trang thai. %LOCALAPPDATA%\\XAGrant (giong installer)."""
    base = os.environ.get('LOCALAPPDATA') or os.environ.get('TEMP') or '.'
    d = os.path.join(base, 'XAGrant')
    try:
        os.makedirs(d, exist_ok=True)
    except Exception:
        pass
    return d


def token_path():
    return os.path.join(state_dir(), 'token.bin')


# ---------------------------------------------------------------------------
# Token luu bang DPAPI (ma hoa theo TAI KHOAN WINDOWS + MAY)
#
# VI SAO KHONG LUU PLAINTEXT:
#   token.txt cu chep sang may khac la doc duoc nguyen noi dung (key, sid,
#   gate). DPAPI khoa bang ho so nguoi dung tren may nay nen:
#     - chep file sang may khac  -> khong giai ma duoc
#     - chep sang user khac      -> khong giai ma duoc
#   Day la lop bao ve cua Windows, khong phai cua chung ta — nen no chac.
# ---------------------------------------------------------------------------

_DPAPI_PREFIX = b'DPAPI1:'


class _DATA_BLOB(ctypes.Structure):
    _fields_ = [('cbData', wt.DWORD),
                ('pbData', ctypes.POINTER(ctypes.c_char))]


def _dpapi_call(fn_name, data):
    """Goi CryptProtectData/CryptUnprotectData. Tra bytes, b'' neu loi."""
    try:
        crypt32 = ctypes.WinDLL('crypt32', use_last_error=True)
        k32 = ctypes.WinDLL('kernel32', use_last_error=True)
        fn = getattr(crypt32, fn_name)
        buf = ctypes.create_string_buffer(data, len(data))
        b_in = _DATA_BLOB(len(data),
                          ctypes.cast(buf, ctypes.POINTER(ctypes.c_char)))
        b_out = _DATA_BLOB()
        # CRYPTPROTECT_UI_FORBIDDEN = 1 -> khong hien hop thoai
        if not fn(ctypes.byref(b_in), None, None, None, None, 1,
                  ctypes.byref(b_out)):
            return b''
        try:
            return ctypes.string_at(b_out.pbData, b_out.cbData)
        finally:
            k32.LocalFree(b_out.pbData)
    except Exception:
        return b''


def read_token():
    """Doc token da luu. Tra '' neu chua co / khong giai ma duoc."""
    p = token_path()
    raw = b''
    try:
        with open(p, 'rb') as f:
            raw = f.read()
    except Exception:
        raw = b''

    if raw.startswith(_DPAPI_PREFIX):
        out = _dpapi_call('CryptUnprotectData', raw[len(_DPAPI_PREFIX):])
        return out.decode('utf-8', 'ignore').strip() if out else ''

    # Tuong thich ban cu: token.txt plaintext
    try:
        with open(os.path.join(state_dir(), 'token.txt'),
                  'r', encoding='utf-8') as f:
            return f.read().strip()
    except Exception:
        return ''


def write_token(tok):
    """Luu token da ma hoa DPAPI.

    KHONG BAO GIO ghi plaintext: DPAPI loi thi tra False va token chi nam
                  trong RAM cua phien nay.
    """
    tok = (tok or '').strip()
    if not tok:
        return False

    enc = _dpapi_call('CryptProtectData', tok.encode('utf-8'))
    if not enc:
        return False
    try:
        with open(token_path(), 'wb') as f:
            f.write(_DPAPI_PREFIX + enc)
        old = os.path.join(state_dir(), 'token.txt')
        if os.path.exists(old):
            try:
                os.remove(old)
            except Exception:
                pass
        return True
    except Exception:
        return False


def _pubkey():
    """Doc khoa cong khai (x, y) tu hang so trong xa_grant_sec.

    Fallback: file secrets/xg-sign-jwk.json khi chay tu source tree (chi dung
    cho dev). Trong EXE phat hanh, khoa nam trong xa_grant_const.

    PHAI dung `xg-sign-jwk.json` (khoa RIENG cua XAGrant), khong phai
    `xn-sign-jwk.json` (No Fog). Truoc day fallback tro nham sang khoa No Fog
    -> chay tu source tree thi token XAGrant luon bi bao bad_sig.
    """
    try:
        import xa_grant_const as kc  # noqa: F401
        px, py = kc.public_xy()
        return (px, py)
    except Exception:
        pass
    # Dev fallback
    here = os.path.dirname(os.path.abspath(__file__))
    for rel in (('..', '..', 'secrets', 'xg-sign-jwk.json'),):
        p = os.path.abspath(os.path.join(here, *rel))
        if os.path.exists(p):
            try:
                with open(p, encoding='utf-8') as f:
                    j = json.load(f)
                return (_b64u_int(j['x']), _b64u_int(j['y']))
            except Exception:
                pass
    return None


def _b64u_int(s):
    b = s.replace('-', '+').replace('_', '/')
    b += '=' * (-len(b) % 4)
    return int.from_bytes(base64.b64decode(b), 'big')


def _guard_safe_hwid():
    """Tinh HWID de bao vi pham; '' neu khong doc duoc (khong lam chet luong)."""
    try:
        return _sec.compute_hwid()
    except Exception:
        return ''


def ensure_engine(args_token=None):
    """Nap dia chi engine tu token. Goi TRUOC khi lam bat cu thu gi voi game.

    Thu tu tim token:
        1. --key <TOKEN> tren dong lenh
        2. bien moi truong XAGRANT_TOKEN
        3. file %LOCALAPPDATA%\\XAGrant\\token.txt (installer ghi vao)

    Tra (ok: bool, msg: str).
    """
    tok = (args_token or os.environ.get('XAGRANT_TOKEN') or read_token()).strip()
    if not tok:
        return False, (
            'Chua co token bao ve.\n'
            '  Nhap key tren website de lay lenh cai dat, hoac chay:\n'
            '    xa_grant.exe --key <TOKEN>')

    # ---- CONG CHONG DICH NGUOC ----
    # Kiem tra debugger / may ao TRUOC khi lam bat cu thu gi.
    # Khong chan han: bao server de cong don, qua nguong thi server tu thu hoi.
    # Ly do khong tu thoat im lang: nguoi dung chay lai la xong, con bao len
    # server thi moi lan thu deu bi ghi, va han muc can dan.
    scan = _guard.scan()
    if not scan.get('ok'):
        log('guard', 'phat hien: %s (%s)' % (scan.get('code'), scan.get('detail')))
        # Bao server (khong cho ket qua chan luong)
        try:
            r0 = _sec.verify_token(tok, _pubkey() or (0, 0),
                                   app='xagrant', hwid=None)
            _sec.report_violation(
                _sec.API_BASE,
                (r0.get('key') or '') if r0.get('ok') else '',
                _guard_safe_hwid(),
                scan.get('code'), sid=r0.get('sid') if r0.get('ok') else None)
        except Exception:
            pass
        return False, (
            'Phat hien moi truong phan tich (%s).\n'
            '  %s\n'
            '  Tool khong chay trong debugger / may ao.'
            % (scan.get('code'), scan.get('detail') or ''))

    pub = _pubkey()
    if pub is None:
        return False, 'Khong doc duoc khoa cong khai (loi dong goi).'

    # Rang buoc MAY: token phai cap cho dung may nay.
    # Khong kiem thi chep token.txt sang may khac la dung duoc.
    try:
        my_hwid = _sec.compute_hwid()
    except _sec.HWIDError as e:
        return False, (
            'Khong doc duoc thong tin phan cung de xac minh may.\n'
            '  %s\n'
            '  Chay bang quyen Administrator.' % e)

    r = load_engine_from_token(tok, pub, hwid=my_hwid)
    if not r.get('ok'):
        return False, ('Token khong hop le (%s).\n  %s'
                       % (r.get('code'), r.get('msg') or ''))

    # ---- LAM MOI token (3 muc, fail-soft) ----
    #   fresh         : con tuoi -> dung luon, KHONG goi mang
    #   stale         : qua cua so mem -> THU lam moi, that bai van chay tiep
    #   token_expired : qua ca an han -> BAT BUOC lam moi
    # Khong co mang o muc `stale` thi van cho chay (khach mat wifi dot ngoat
    # khong bi chan oan). Chi chan khi da qua han cung.
    if not r.get('fresh'):
        api = _sec.API_BASE
        okR, tokM, msgR = _sec.refresh_token(
            api, r.get('key') or '', my_hwid, sid=r.get('sid'))
        if okR:
            r2 = load_engine_from_token(tokM, pub, hwid=my_hwid)
            if r2.get('ok'):
                write_token(tokM)
                log('token', 'da lam moi token tu server')
                r = r2
                okR = True
            else:
                okR = False
                msgR = 'token moi tu server khong hop le (%s)' % (
                    r2.get('code') or '?')
        if not okR:
            if r.get('token_expired'):
                return False, (
                    'Token bao ve da het han va khong lam moi duoc.\n'
                    '  %s\n'
                    '  Ket noi mang roi chay lai, hoac vao website lay lenh moi.'
                    % msgR)
            # con trong an han -> van cho chay, chi ghi log
            log('token', 'khong lam moi duoc (%s) — van dung token trong an han'
                % msgR)

    if args_token:
        write_token(tok)
    return True, 'ok'



PROCESS_NAMES = ('EMPIRESX.EXE', 'EMPIRESX_HD.EXE', 'EMPIRESX_HDR.EXE')
PROCESS_ALL_ACCESS = 0x1F0FFF
MEM_COMMIT, MEM_RESERVE, MEM_RELEASE, PAGE_EXECUTE_READWRITE = 0x1000, 0x2000, 0x8000, 0x40
TH32CS_SNAPPROCESS = 0x2
MAX_PATH = 260
INVALID_HANDLE_VALUE = ctypes.c_void_p(-1).value
WAIT_TIMEOUT = 0x102
INFINITE = 0xFFFFFFFF

k32 = ctypes.WinDLL('kernel32', use_last_error=True)
psapi = ctypes.WinDLL('psapi', use_last_error=True)

k32.OpenProcess.restype = wt.HANDLE
k32.OpenProcess.argtypes = [wt.DWORD, wt.BOOL, wt.DWORD]
k32.CloseHandle.argtypes = [wt.HANDLE]
k32.ReadProcessMemory.restype = wt.BOOL
k32.ReadProcessMemory.argtypes = [wt.HANDLE, wt.LPCVOID, wt.LPVOID,
                                  ctypes.c_size_t, ctypes.POINTER(ctypes.c_size_t)]
k32.WriteProcessMemory.restype = wt.BOOL
k32.WriteProcessMemory.argtypes = [wt.HANDLE, wt.LPVOID, ctypes.c_char_p,
                                   ctypes.c_size_t, ctypes.POINTER(ctypes.c_size_t)]
k32.VirtualAllocEx.restype = ctypes.c_void_p
k32.VirtualAllocEx.argtypes = [wt.HANDLE, ctypes.c_void_p, ctypes.c_size_t,
                               wt.DWORD, wt.DWORD]
k32.VirtualFreeEx.restype = wt.BOOL
k32.VirtualFreeEx.argtypes = [wt.HANDLE, ctypes.c_void_p, ctypes.c_size_t, wt.DWORD]
k32.CreateRemoteThread.restype = wt.HANDLE
k32.CreateRemoteThread.argtypes = [wt.HANDLE, ctypes.c_void_p, ctypes.c_size_t,
                                   ctypes.c_void_p, ctypes.c_void_p, wt.DWORD,
                                   ctypes.POINTER(wt.DWORD)]
k32.WaitForSingleObject.restype = wt.DWORD
k32.WaitForSingleObject.argtypes = [wt.HANDLE, wt.DWORD]
k32.FlushInstructionCache.restype = wt.BOOL
k32.FlushInstructionCache.argtypes = [wt.HANDLE, wt.LPCVOID, ctypes.c_size_t]
k32.GetExitCodeThread.restype = wt.BOOL
k32.GetExitCodeThread.argtypes = [wt.HANDLE, ctypes.POINTER(wt.DWORD)]
k32.CreateToolhelp32Snapshot.restype = wt.HANDLE
k32.CreateToolhelp32Snapshot.argtypes = [wt.DWORD, wt.DWORD]
k32.Process32First.restype = wt.BOOL
k32.Process32First.argtypes = [wt.HANDLE, ctypes.c_void_p]
k32.Process32Next.restype = wt.BOOL
k32.Process32Next.argtypes = [wt.HANDLE, ctypes.c_void_p]
psapi.EnumProcessModules.restype = wt.BOOL
psapi.EnumProcessModules.argtypes = [wt.HANDLE, ctypes.POINTER(wt.HMODULE),
                                     wt.DWORD, ctypes.POINTER(wt.DWORD)]

GATE_FLAG = '--i-understand-this-may-desync'
LOG = []          # [(buoc, mo ta)]


class PE32(ctypes.Structure):
    _fields_ = [('dwSize', wt.DWORD), ('cntUsage', wt.DWORD),
                ('th32ProcessID', wt.DWORD), ('th32DefaultHeapID', ctypes.c_void_p),
                ('th32ModuleID', wt.DWORD), ('cntThreads', wt.DWORD),
                ('th32ParentProcessID', wt.DWORD), ('pcPriClassBase', ctypes.c_long),
                ('dwFlags', wt.DWORD), ('szExeFile', ctypes.c_char * MAX_PATH)]


class GrantError(Exception):
    """Gate that chan lai. Khong bao gio goi engine khi loi nay duoc nem."""


# ----------------------------------------------------------------------------
def log(step, msg, va=None):
    line = ('[%s] ' % step) + msg
    if va is not None:
        line += '  <VA 0x%08X>' % va
    LOG.append(line)
    print(line)


# ----------------------------------------------------------------------------
# Phan THUAN (khong cham vao game) -- test duoc bang --selftest
# ----------------------------------------------------------------------------
def build_record(player, slot, amount):
    """8 byte record y het engine. Thuan tuy, khong I/O."""
    if not (0 <= player <= 0xFFFFFFFF):
        raise GrantError('player ngoai mien: %r' % (player,))
    if not (0 <= slot <= 0xFF):
        raise GrantError('slot ngoai mien byte: %r' % (slot,))
    f = float(amount)
    if f != f:
        raise GrantError('amount = NaN')
    if f in (float('inf'), float('-inf')):
        raise GrantError('amount = Inf')
    rec = bytearray(8)
    rec[0] = 0x05
    rec[1] = player & 0xFF
    rec[2] = slot & 0xFF
    rec[3] = 0x00
    rec[4:8] = struct.pack('<f', f)
    return bytes(rec)


# ----------------------------------------------------------------------------
# RUONG VO HAN THIT -- action record type 0x77
#
# Da xac minh bang byte (2026-11-11):
#
#   Handler 0x4EB6F0:
#     0x004EB6F8  mov  eax, [esi+4]        ; objId
#     0x004EB6FC  call 0x5230D0            ; tra object
#     0x004EB707  mov  dx, word [esi+0xA]  ; delta
#     0x004EB711  mov  dx, word [esi+8]    ; resourceId
#     0x004EB716  call 0x4AF3E0            ; ADD  (delta > 0)
#     0x004EB727  call 0x4AF680            ; SUB  (delta <= 0)
#
#   Mang tai nguyen object:
#     obj+0x1C0 -> mang {i16 resourceId, i16 amount}, stride 4
#     obj+0x1C6 -> count
#     resourceId = 4 -> THIT
#     0x004AF6F9  sub word [edi+edx+2], cx   <- engine tru thit o day
#
#   Duong gui: engine -> engine -> engine -> engine
#     0x42BA10 chi chong trung (cung size+type+<500ms), KHONG chan type
#     engine gui MOI type, khong phan biet
#   => ca 2 may chay cung record -> checksum khop -> KHONG desync
#
# KHAC type 5: engine cung type 5 (mov byte [eax],5), nen phai tu
# build record 12 byte roi goi thang engine.
# ----------------------------------------------------------------------------

DISPATCH_SENDER = SENDER
TYPE_OBJ_RESOURCE = 0x77
RES_ID_FOOD = 4

# Duong STEALTH: record type 0x67 sub-type 2.
# Anti-cheat dich 0x67/2 -> type 5 nhung phai tra player tu ring 256 slot;
# ring tra 0 khi khong khop VA cung tra 0 khi khop slot moi nhat -> player
# bi ghi = 0 -> nhanh type-5 thoat tai `test edi,edi / jle` => KHONG kiem,
# KHONG bao. Van gui qua 0x42BA60 nen peer nhan va ap dung => khong desync.
TYPE_RES_XFER = 0x67
SUBTYPE_RES_CREDIT = 2

OFF_OBJ_POS = 0x88
OFF_OBJ_POS_N = 0x90
OFF_OBJ_NEG = 0x94
OFF_OBJ_NEG_N = 0x9C
OBJ_RES_ARR = 0x1C0
OBJ_RES_COUNT = 0x1C6
OBJ_OWNER = 0x0C


def build_record_obj_resource(obj_id, resource_id, delta):
    """12 byte record cho type 0x77 (cong/tru tai nguyen cho object).

        +0  u8   0x77
        +1..3    0
        +4  i32  objId
        +8  i16  resourceId
        +A  i16  delta
    """
    if not (0 <= resource_id <= 0x7FFF):
        raise GrantError('resource_id ngoai mien int16: %r' % (resource_id,))
    if not (-0x8000 <= delta <= 0x7FFF):
        raise GrantError('delta ngoai mien int16: %r' % (delta,))
    rec = bytearray(12)
    rec[0] = TYPE_OBJ_RESOURCE
    struct.pack_into('<i', rec, 4, int(obj_id))
    struct.pack_into('<h', rec, 8, int(resource_id))
    struct.pack_into('<h', rec, 10, int(delta))
    return bytes(rec)


def build_stub_dispatch(this_ptr, rec, rec_va, dispatch=DISPATCH_SENDER):
    """Stub goi engine(sender, rec, len) -- stdcall ret 8.

        B9 <sender>       mov  ecx, sender
        68 <len>          push len           (arg2)
        68 <rec_va>       push rec_va        (arg1)
        B8 <dispatch>     mov  eax, dispatch
        FF D0             call eax
        C3                ret
    """
    n = len(rec)
    code = bytearray()
    code += b'\xB9' + struct.pack('<I', this_ptr)
    code += b'\x68' + struct.pack('<I', n)
    code += b'\x68' + struct.pack('<I', rec_va)
    code += b'\xB8' + struct.pack('<I', dispatch)
    code += b'\xFF\xD0'
    code += b'\xC3'
    return bytes(code)


def build_record_res_credit(player, slot, amount):
    """12 byte record type 0x67 sub-type 2 — cộng tài nguyên cho 1 player.

    Layout (đọc từ handler 0x4EB32D):

        +0  u8   0x67                  type
        +1  u8   2                     sub-type
        +2  i16  player                -> players[player]
        +4  u16  slot                  -> [obj+0x78](slot, amount, 0)
        +6  u16  0                     padding (handler không đọc)
        +8  f32  amount

    Khác type 5 ở chỗ: amount là f32 ở +8, slot là u16 (không phải u8),
    player là i16 có dấu (movsx).
    """
    if not (-0x8000 <= player <= 0x7FFF):
        raise GrantError('player ngoai mien int16: %r' % (player,))
    if not (0 <= slot <= 0xFFFF):
        raise GrantError('slot ngoai mien uint16: %r' % (slot,))
    f = float(amount)
    if f != f:
        raise GrantError('amount = NaN')
    if f in (float('inf'), float('-inf')):
        raise GrantError('amount = Inf')

    rec = bytearray(12)
    rec[0] = TYPE_RES_XFER
    rec[1] = SUBTYPE_RES_CREDIT
    struct.pack_into('<h', rec, 2, int(player))
    struct.pack_into('<H', rec, 4, int(slot))
    struct.pack_into('<H', rec, 6, 0)
    struct.pack_into('<f', rec, 8, f)
    return bytes(rec)


def build_stub_dispatch_owned(this_ptr, rec, rec_va, dispatch=None,
                              alloc=None):
    """Stub gọi dispatch NHƯNG cấp phát record bằng allocator CỦA GAME.

    VÌ SAO PHẢI LÀM VẬY — đây là lỗi làm game crash 0xC0000005:

        0x42BA82  mov  eax,[esi+8]     ; con trỏ record lần trước
        0x42BA85  test eax,eax
        0x42BA87  je   0x42BA92
        0x42BA89  push eax
        0x42BA8A  call 0x5284F0        ; <-- FREE bằng heap CỦA GAME
        0x42BA92  mov  [esi+8],ebx     ; session NHẬN QUYỀN SỞ HỮU con trỏ mới

    Dispatch lưu con trỏ vào [session+8] và lần sau sẽ free nó bằng 0x5284F0
    (allocator của game). Nếu ta đưa con trỏ VirtualAllocEx vào:
        1. session giữ con trỏ lạ
        2. ta VirtualFreeEx nó -> treo
        3. lần gửi sau 0x5284F0(trỏ treo) -> heap corruption -> 0xC0000005

    Cách đúng: cấp phát record bằng chính allocator của game, copy từ template
    trong allocation của stub, rồi gọi dispatch. Con trỏ do game sở hữu.
    """
    if dispatch is None:
        dispatch = DISPATCH_SENDER
    if alloc is None:
        alloc = 0x528450          # GAME_ALLOC

    n = len(rec)
    code = bytearray()
    code += bytes([0x6A, n & 0xFF])                    # push n
    code += b'\x6A\x01'                                # push 1
    code += b'\xB8' + struct.pack('<I', alloc)         # mov eax, alloc
    code += b'\xFF\xD0'                                # call eax
    code += b'\x83\xC4\x08'                            # add esp, 8
    code += b'\x50'                                    # push eax
    code += b'\x89\xC7'                                # mov edi, eax
    code += b'\xBE' + struct.pack('<I', rec_va)        # mov esi, rec_va
    code += b'\xB9' + struct.pack('<I', n)             # mov ecx, n
    code += b'\xF3\xA4'                                # rep movsb
    code += b'\x58'                                    # pop eax
    code += b'\xB9' + struct.pack('<I', this_ptr)      # mov ecx, this
    code += bytes([0x6A, n & 0xFF])                    # push n
    code += b'\x50'                                    # push eax
    code += b'\xB8' + struct.pack('<I', dispatch)      # mov eax, dispatch
    code += b'\xFF\xD0\xC3'                            # call eax / ret
    return bytes(code)


def obj_owner_id(h, obj_ptr):
    """Player id cua object, hoac -1."""
    ecx = u32(h, obj_ptr + OBJ_OWNER)
    if not ecx:
        return -1
    b = rd(h, ecx + 0x4A, 2)
    if not b or len(b) < 2:
        return -1
    return struct.unpack('<h', b)[0]


def obj_food(h, obj_ptr):
    """So thit con lai cua object, hoac None."""
    arr = u32(h, obj_ptr + OBJ_RES_ARR)
    cb = rd(h, obj_ptr + OBJ_RES_COUNT, 2)
    if not arr or not cb or len(cb) < 2:
        return None
    cnt = struct.unpack('<h', cb)[0]
    if cnt <= 0 or cnt > 64:
        return None
    b = rd(h, arr, cnt * 4)
    if not b or len(b) < cnt * 4:
        return None
    for i in range(cnt):
        rid, amt = struct.unpack_from('<hh', b, i * 4)
        if rid == RES_ID_FOOD:
            return amt
    return None


def find_my_farms(h, mgr=None):
    """Tra list {id, ptr, amt} cua object co thit thuoc ve minh."""
    if mgr is None:
        world = u32(h, PTR_WORLD)
        if not world:
            return []
        mgr = u32(h, world + OFF_MANAGER)
        if not mgr:
            return []
    me = local_index(h)
    out = []
    for sign, aoff, coff in (('neg', OFF_OBJ_NEG, OFF_OBJ_NEG_N),
                             ('pos', OFF_OBJ_POS, OFF_OBJ_POS_N)):
        arr = u32(h, mgr + aoff)
        cb = rd(h, mgr + coff, 4)
        if not arr or not cb or len(cb) < 4:
            continue
        cnt = struct.unpack('<I', cb)[0] & 0xFFFF
        if cnt <= 0 or cnt > 30000:
            continue
        for i in range(min(cnt, 20000)):
            p = u32(h, arr + i * 4)
            if not p:
                continue
            amt = obj_food(h, p)
            if amt is None:
                continue
            if obj_owner_id(h, p) != me:
                continue
            # objId: uu tien doc tu obj+0x04 (truong id cua object),
            # fallback ve index trong mang neu khong hop ly.
            oid = i32(h, p + 0x04)
            if oid is None:
                oid = None
            idx_id = -i if sign == 'neg' else i
            if oid is None or abs(oid) > 0x1000000:
                oid = idx_id
            out.append({'id': oid, 'ptr': p, 'amt': amt,
                        'idx_id': idx_id, 'sign': sign})
    return out


def build_stub(this_ptr, player, slot, amount):
    """Stub 32-bit goi Builder_ChangeResource dung __thiscall.

        B9 <this>          mov  ecx, this
        68 <amount>        push amount        (arg3)
        68 <slot>          push slot          (arg2)
        68 <player>        push player        (arg1)
        B8 <builder>       mov  eax, BUILDER
        FF D0              call eax
        C3                 ret
    """
    bits = struct.unpack('<I', struct.pack('<f', float(amount)))[0]
    code = bytearray()
    code += b'\xB9' + struct.pack('<I', this_ptr)
    code += b'\x68' + struct.pack('<I', bits)
    code += b'\x68' + struct.pack('<I', slot)
    code += b'\x68' + struct.pack('<I', player)
    code += b'\xB8' + struct.pack('<I', BUILDER)
    code += b'\xFF\xD0'
    code += b'\xC3'
    return bytes(code)


# ----------------------------------------------------------------------------
# Phan cham process
# ----------------------------------------------------------------------------
def is_admin():
    try:
        return bool(ctypes.windll.shell32.IsUserAnAdmin())
    except Exception:
        return False


def find_game():
    snap = k32.CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0)
    if snap in (None, 0, INVALID_HANDLE_VALUE):
        return []
    want = set(n.lower() for n in PROCESS_NAMES)
    out = []
    try:
        e = PE32()
        e.dwSize = ctypes.sizeof(PE32)
        if k32.Process32First(snap, ctypes.byref(e)):
            while True:
                nm = e.szExeFile.decode(errors='replace')
                if nm.lower() in want:
                    out.append((e.th32ProcessID, nm))
                if not k32.Process32Next(snap, ctypes.byref(e)):
                    break
    finally:
        k32.CloseHandle(snap)
    out.sort(key=lambda p: 0 if p[1].lower() == 'empiresx.exe' else 99)
    return out


def open_game(pid):
    for acc, label in ((PROCESS_ALL_ACCESS, 'ALL_ACCESS'),
                       (0x0008 | 0x0010 | 0x0020 | 0x0400, 'RVM_READ|WRITE|OPER|QUERY')):
        h = k32.OpenProcess(acc, False, pid)
        if h:
            log('open', 'OpenProcess(%s) thanh cong' % label)
            return h
    raise GrantError('OpenProcess that bai (err=%d). Can Administrator.'
                     % ctypes.get_last_error())


def module_base(h):
    mods = (wt.HMODULE * 1024)()
    need = wt.DWORD()
    if not psapi.EnumProcessModules(h, mods, ctypes.sizeof(mods), ctypes.byref(need)):
        raise GrantError('EnumProcessModules that bai')
    return int(mods[0] or 0)


def rd(h, va, n):
    buf = ctypes.create_string_buffer(n)
    got = ctypes.c_size_t(0)
    if not k32.ReadProcessMemory(h, ctypes.c_void_p(va), buf, n, ctypes.byref(got)):
        return None
    if got.value != n:
        return None
    return buf.raw[:n]


def u32(h, va):
    b = rd(h, va, 4)
    return None if b is None else struct.unpack('<I', b)[0]


def rd(h, va, n):
    """Doc n byte. Tra None neu khong doc duoc. KHONG BAO GIO crash."""
    try:
        if not h or not va or va < 0 or n <= 0:
            return None
        buf = ctypes.create_string_buffer(n)
        got = ctypes.c_size_t(0)
        ok = k32.ReadProcessMemory(h, ctypes.c_void_p(va), buf, n,
                                   ctypes.byref(got))
        if not ok or got.value == 0:
            return None
        return buf.raw[:got.value]
    except Exception:
        return None


def u32(h, va):
    """Doc dword. Tra None neu khong doc duoc. KHONG BAO GIO crash."""
    b = rd(h, va, 4)
    if not b or len(b) < 4:
        return None
    try:
        return struct.unpack('<I', b[:4])[0]
    except Exception:
        return None


def f32(h, va):
    """Doc float. Tra None neu khong doc duoc. KHONG BAO GIO crash."""
    b = rd(h, va, 4)
    if not b or len(b) < 4:
        return None
    try:
        v = struct.unpack('<f', b[:4])[0]
        # NaN / Inf -> coi nhu khong doc duoc
        if v != v or v in (float('inf'), float('-inf')):
            return None
        return v
    except Exception:
        return None


def i32(h, va):
    """Doc int32. Tra None neu khong doc duoc. KHONG BAO GIO crash."""
    b = rd(h, va, 4)
    if not b or len(b) < 4:
        return None
    try:
        return struct.unpack('<i', b[:4])[0]
    except Exception:
        return None


def read_name_of_wrapper(h, wrap):
    """Doc ten qua [wrapper+0x44]. KHONG BAO GIO crash -- '' neu loi."""
    try:
        if not wrap:
            return ''
        p = u32(h, wrap + OFF_NAME_PTR)
        if not p:
            return ''
        b = rd(h, p, 40)
        if not b:
            return ''
        s2 = b.split(b'\x00')[0].decode('latin1', 'replace')
        if not s2 or not all(32 <= ord(c) < 127 for c in s2):
            return ''
        if not any(c.isalpha() for c in s2):
            return ''
        return s2
    except Exception:
        return ''


def read_player_name(h, pd, wrap=0):
    """Giu ten cu cho tuong thich -- neu co wrap thi dung cach moi."""
    if wrap:
        return read_name_of_wrapper(h, wrap)
    return ''


# ============================================================================
# DANH SACH NGUOI CHOI -- doc dung theo engine
#
# Chứng minh bằng đo thực tế 2026-11-10 23:50 (pid 42024, trận 6 slot):
#
#   cnt = u16[mgr+0x3C] = 6      <- BẮT BUỘC dùng, không quét mù
#                                 (ô 6..31 chứa rác: +0x4A = None hoặc 12818)
#
#   slot 0:  vtable engine   [+0xB0]=1   F=0      -> GAME SETTINGS, không phải người
#   slot 1..5: vtable engine [+0xB0]=0   F>0      -> người chơi thật
#
#   +0x4A (int16) = slot index, duy nhất trong 0..cnt-1
#   +0xD8 (dword) = BITMASK 1<<idx (1,2,4,8,16,32) — KHÔNG phải số thứ tự
#   [sub+0x26]    = CHỈ SỐ MÀU (0..7) — TRÙNG được, không phải identity
#                   (slot 0 và slot 1 cùng trỏ sub 0x2B0E490, cùng màu 7)
#
#   local index = byte[apply+0x1590]   (engine dùng tại 0x41F1CB)
#   apply+0x10E0 = SOURCE player, KHÔNG phải local
#   apply+0x10C8 = frame counter, đổi mỗi tick
#
# Vậy: số người chơi = vị trí trong danh sách sau khi bỏ slot 0 (1..N).
# ============================================================================

VTABLE_PLAYER  = WRAPPER_VTABLE   # lớp người chơi thật
VTABLE_SETTINGS = VTABLE_SETTINGS  # lớp game-settings (slot 0)


def list_players(h):
    """Tra list nguoi choi that. KHONG BAO GIO crash -- tra [] neu loi."""
    try:
        return _list_players_inner(h)
    except Exception:
        return []


def _list_players_inner(h):
    world = u32(h, PTR_WORLD)
    if not world:
        return []
    mgr = u32(h, world + OFF_MANAGER)
    if not mgr:
        return []
    arr = u32(h, mgr + OFF_WRAPARRAY)
    if not arr:
        return []
    cnt = (u32(h, mgr + OFF_SLOTS) or 0) & 0xFFFF
    if cnt <= 0 or cnt > 64:
        return []

    raw = []
    for slot in range(cnt):
        wrap = u32(h, arr + slot * 4)
        if not wrap:
            continue
        pd = u32(h, wrap + OFF_PLAYER)
        if not pd:
            continue
        vt = u32(h, wrap)
        idx_raw = rd(h, wrap + OFF_PLAYERIDX, 2)
        idx = -1
        if idx_raw and len(idx_raw) >= 2:
            try:
                idx = struct.unpack('<h', idx_raw[:2])[0]
            except Exception:
                idx = -1
        vals = {}
        ok = True
        for k in ('F', 'W', 'S', 'G'):
            v = f32(h, pd + RES_OFF[k])
            if v is None or v < 0 or v > 1e12:
                ok = False
                break
            vals[k] = float(v)
        if not ok:
            continue
        bm = u32(h, wrap + OFF_BITMASK) or 0
        raw.append({'slot': slot, 'wrap': wrap, 'pd': pd, 'idx': idx,
                    'vt': vt or 0, 'bm': bm,
                    'ten': read_name_of_wrapper(h, wrap), 'vals': vals})

    players = [p for p in raw
               if p['slot'] > 0 and p['vt'] == VTABLE_PLAYER]
    for n, p in enumerate(players, start=1):
        p['so'] = n
    return players


def local_index(h):
    """int16 [manager+0x7C] = slot cua may nay. -1 neu khong doc duoc."""
    try:
        world = u32(h, PTR_WORLD)
        if not world:
            return -1
        mgr = u32(h, world + OFF_MANAGER)
        if not mgr:
            return -1
        b = rd(h, mgr + OFF_LOCAL_SLOT, 2)
        if not b or len(b) < 2:
            return -1
        v = struct.unpack('<h', b[:2])[0]
        return v if v >= 0 else -1
    except Exception:
        return -1


def my_number(h):
    """So thu tu 1..N cua may nay, hoac 0 neu khong xac dinh.

    local_index() = int16[manager+0x7C]; khop voi [wrap+0x4A] cua slot do.
    """
    lv = local_index(h)
    if lv < 0:
        return 0
    for p in list_players(h):
        if p['idx'] == lv:
            return p['so']
    return 0


def find_by_number(h, so):
    """Tim player co so thu tu `so`. None neu khong co / loi."""
    try:
        for p in list_players(h):
            if p['so'] == so:
                return p
    except Exception:
        pass
    return None

def get_player(h, slot=None):
    """playerdata + tai nguyen cua MOT slot cu the.

    SUA 2026-11-11 01:45: ban cu tra ve slot DAU TIEN doc duoc -> do la slot 0
    (GAIA), tai nguyen luon 0. Hau qua: log truoc/sau grant hien 0 -> 0,
    gay hieu nham la grant that bai.

    slot=None -> dung slot cua may minh ([manager+0x7C]).
    """
    world = u32(h, PTR_WORLD)
    if not world:
        return 0, None
    mgr = u32(h, world + OFF_MANAGER)
    if not mgr:
        return 0, None

    if slot is None:
        slot = local_index(h)
        if slot < 0:
            return 0, None

    arr = u32(h, mgr + OFF_WRAPARRAY)
    if not arr:
        return 0, None
    cnt = (u32(h, mgr + OFF_SLOTS) or 0) & 0xFFFF
    if slot >= cnt:
        return 0, None

    wrp = u32(h, arr + slot * 4)
    if not wrp:
        return 0, None
    pd = u32(h, wrp + OFF_PLAYER)
    if not pd:
        return 0, None
    vals = {}
    for k, o in RES_OFF.items():
        v = f32(h, pd + o)
        if v is None:
            return 0, None
        vals[k] = v
    return pd, vals


# ----------------------------------------------------------------------------
# Resolve chuoi `this`
# ----------------------------------------------------------------------------
def resolve_chain(h, so=None):
    """Tra dict {ctx, sender, apply, online, pindex, so, ten, slot}.

    Tham so `so`: so thu tu nguoi choi 1..8 (mau+1, KHONG DOI giua cac tran).
                  None = tu tim may minh.

    CHUOI THAT:

        [PTR_WORLD]        world
        [world+0x3F4]     manager
        [mgr+0x40]        wraparray
        [arr + slot*4]    CTX (player wrapper)
        [ctx+0x10C]       sub  -> [+0x26] int16 = mau (0..7)
                          so thu tu = mau + 1
        [mgr+0x58]        SENDER  vtable VTABLE
        [sender+0x14]     apply
        [apply+0x1590]    LOCAL PLAYER INDEX (engine tu dung tai 0x41F1CB)

    Slot array index CO THE DOI giua cac tran.
    So (mau+1) thi KHONG -- do la danh tinh nguoi choi.
    """
    world = u32(h, PTR_WORLD)
    if not world:
        raise GrantError('0x%08X (world ptr) = 0 -> chua vao tran' % PTR_WORLD)

    mgr = u32(h, world + OFF_MANAGER)
    if not mgr:
        raise GrantError('world->[+0x3F4] (manager) = 0', world + OFF_MANAGER)

    sender = u32(h, mgr + OFF_SENDER)
    if not sender:
        raise GrantError('mgr->[+0x58] (sender) = 0', mgr + OFF_SENDER)
    vt_s = u32(h, sender)
    apply = u32(h, sender + OFF_APPLY)
    if not apply:
        raise GrantError('sender->[+0x14] (apply obj) = 0', sender + OFF_APPLY)
    online = u32(h, apply + OFF_ONLINE) or 0
    # LOCAL SLOT: int16 [manager+0x7C] -- xem local_index() de biet chung minh
    lvraw = rd(h, mgr + OFF_LOCAL_SLOT, 2)
    lv7c = struct.unpack('<h', lvraw)[0] if lvraw and len(lvraw) == 2 else -1
    log('chain', 'world=0x%08X mgr=0x%08X sender=0x%08X vtable=0x%08X apply=0x%08X'
        % (world, mgr, sender, vt_s or 0, apply), world)
    log('chain', 'LOCAL SLOT [mgr+0x7C] = %d   online = %d' % (lv7c, online),
        mgr + OFF_LOCAL_SLOT)

    players = list_players(h)
    if not players:
        raise GrantError('khong doc duoc player nao. Da vao tran chua?')

    print()
    print('  %-5s %-5s %-7s %-16s %9s %9s %9s %9s' %
          ('slot', 'so', '+D8', 'ten', 'thit', 'go', 'da', 'vang'))
    print('  ' + '-' * 74)
    for p in players:
        tag = ''
        if p['idx'] == lv7c:
            tag = '  <<< BAN'
        print('  %-5d %-5s 0x%-5X %-16s %9.0f %9.0f %9.0f %9.0f%s'
              % (p['slot'], p['so'], p.get('bm', 0),
                 (p['ten'] or '(khong ten)')[:16],
                 p['vals']['F'], p['vals']['W'], p['vals']['S'], p['vals']['G'],
                 tag))
    print()

    # ------------------------------------------------------------------
    # CHON MUC TIEU
    #
    # SUA 2026-11-11: KHONG con tu doan "may minh la ai".
    # [apply+0x1590] la hang so 2, khong phai index nguoi choi.
    # => bat buoc phai chi dinh so, hoac tool hoi.
    # ------------------------------------------------------------------
    if so is None:
        # may minh: dung [manager+0x7C] (local slot index)
        target = None
        for p in players:
            if p['idx'] == lv7c:
                target = p
                break
        if not target:
            dss = ', '.join('p%d=%r' % (p['so'], p['ten'] or '?')
                            for p in players)
            raise GrantError(
                'khong tim thay slot cua may minh.\n'
                '  local slot [mgr+0x7C] = %d\n'
                '  danh sach: %s\n'
                '  -> chi dinh so bang --for N  (vd: --for 2)'
                % (lv7c, dss))
        log('chain', 'muc tieu = CHINH MINH (so %d, slot %d)'
            % (target['so'], target['slot']), target['wrap'])
    else:
        if not (1 <= so <= 8):
            raise GrantError('so thu tu phai 1..8, nhan %d' % so)
        target = None
        for p in players:
            if p['slot'] == 0:
                continue
            if p['so'] == so:
                target = p
                break
        if not target:
            ds = [p['so'] for p in players if p['slot'] != 0 and p['so']]
            raise GrantError(
                'khong co nguoi choi so %d.\n'
                '  Cac so hien co: %s\n'
                '  (so = mau+1, lay tu [wrap+0x10C]->[+0x26])'
                % (so, ds or 'khong co'))
        log('chain', 'muc tieu = nguoi choi so %d (slot %d)'
            % (so, target['slot']), target['wrap'])

    if target['slot'] == 0:
        raise GrantError('muc tieu la slot 0 (game settings). TU CHOI.')

    ctx = target['wrap']
    pidx = target['idx']
    if not (0 <= pidx <= 0xFF):
        raise GrantError('player index = %d ngoai mien byte. DUNG.' % pidx,
                         ctx + OFF_PLAYERIDX)

    print('  *** MUC TIEU: slot %d, so %s, ten %r ***'
          % (target['slot'], target['so'] or '?', target['ten']))
    print()

    return {'ctx': ctx, 'sender': sender, 'apply': apply, 'online': online,
            'pindex': pidx, 'so': target['so'], 'ten': target['ten'],
            'slot': target['slot']}


def verify_build(h, base):
    """Kiem tra byte tung dia chi + DllCharacteristics. Khong ghi gi."""
    dllch = rd(h, base + DLLCHAR_OFF, 2)
    if dllch is None:
        raise GrantError('khong doc duoc PE header')
    dllch = struct.unpack('<H', dllch)[0]
    if dllch & 0x40:
        raise GrantError('DYNAMIC_BASE bat -> dia chi co the doi. DUNG.')
    log('build', 'DllCharacteristics=0x%04X (ASLR %s, DEP %s)'
        % (dllch, 'OFF' if not dllch & 0x40 else 'ON',
           'OFF' if not dllch & 0x100 else 'ON'))
    for va, sig in sorted(SIG.items()):
        got = rd(h, va, len(sig))
        if got != sig:
            raise GrantError('byte tai 0x%08X khong khop.\n  mong doi: %s\n  thuc te : %s'
                             % (va, sig.hex().upper(),
                                got.hex().upper() if got else 'UNREADABLE'))
        log('build', 'byte khop %-32s' % sig.hex().upper(), va)
    vt = u32(h, VTABLE + VT_SLOT_OFF)
    if vt != VT_SLOT_VAL:
        raise GrantError('vtable 0x%08X +0x%X = 0x%08X != 0x%08X'
                         % (VTABLE, VT_SLOT_OFF, vt or 0, VT_SLOT_VAL))
    log('build', 'sender vtable[+0x%X] = 0x%08X khop' % (VT_SLOT_OFF, vt),
        VTABLE + VT_SLOT_OFF)
    # vtable cua player wrapper (engine / engine) phai co ChangeResource
    wrp_vt = u32(h, WRAPPER_VTABLE + 0x78)
    if wrp_vt != WRAP_CR:
        raise GrantError('wrapper vtable 0x%08X +0x78 = 0x%08X != WRAP_CR'
                         % (WRAPPER_VTABLE, wrp_vt or 0))
    log('build', 'wrapper vtable[+0x78] = 0x%08X (ChangeResource) khop' % wrp_vt,
        WRAPPER_VTABLE + 0x78)


# ----------------------------------------------------------------------------
# Hanh dong
# ----------------------------------------------------------------------------
def do_check(h, base):
    print()
    log('check', 'base module = 0x%08X' % base)
    verify_build(h, base)
    print()
    try:
        ch = resolve_chain(h)
    except GrantError as e:
        print()
        log('check', 'CHUOI this THAT BAI: %s' % e)
        ch = None
    pd, vals = get_player(h, ch['slot'] if ch else None)
    print()
    if pd:
        log('check', 'playerdata = 0x%08X' % pd, pd)
        for k in ('F', 'W', 'S', 'G'):
            print('        %-2s %-6s = %g' % (k, RES_NAME[k], vals.get(k, 0.0)))
    else:
        log('check', 'KHONG thay playerdata -> chua vao tran that')
    print()
    ok = ch is not None and pd != 0
    print('KET LUAN: %s' % ('DU DIEU KIEN de --grant.' if ok else
                            'THIEU DIEU KIEN -> --grant se bi tu choi.'))
    if ch is not None and ch['online'] != 0:
        print('CANH BAO: online flag = %d != 0 -> record se di qua GAME_PKT'
              ' (msg 0x3E) toi peer; peer KHONG co du lieu nay -> desync.'
              % ch['online'])
    return 0 if ok else 1


def do_grant(h, base, res, amount, dry_run, gate, so=None):
    # ---- thu tu gate: tat ca deu phai qua truoc khi cap phat byte nao ----
    if not gate:
        raise GrantError(
            'THIEU %s.\n'
            '  Cong cu nay goi thang vao engine, bo qua logic game binh thuong.\n'
            '  Hau qua: peer khong co cung du lieu -> lech checksum -> co the bi\n'
            '  kick / out-of-sync. Chi chay khi ban chap nhan dieu do.' % GATE_FLAG)
    log('gate', '%s co mat' % GATE_FLAG)

    # ------------------------------------------------------------------
    # GATE CUNG: CHI GRANT CHO CHINH MINH.
    #
    # so=None  -> may minh (lay [manager+0x7C])
    # so=N     -> nguoi choi khac -> TU CHOI
    #
    # Dat o day (khong chi o parser) de khong the vo tinh di qua bang
    # bat ky duong nao: --for N, lenh pN, hay goi ham truc tiep.
    # ------------------------------------------------------------------
    if so is not None:
        raise GrantError(
            'CHI GRANT CHO CHINH MINH.\n'
            '  Cong cu nay khong ho tro grant cho nguoi choi khac\n'
            '  (nhan so=%r).\n'
            '\n'
            '  Bo tham so --for, hoac go lenh khong co "p...":\n'
            '      v 1000      full      1000 v g d t' % (so,))

    if res not in RES_OFF:
        raise GrantError('slot phai la F/W/S/G, nhan %r' % (res,))
    slot = RES_SLOT[res]                     # F=0 W=1 S=2 G=3 (da sua 2026-11-11)
    try:
        amount = float(amount)
    except Exception:
        raise GrantError('amount khong phai so: %r' % (amount,))
    if not (amount > 0.0):
        raise GrantError('amount phai > 0 (0x45F519..0x45F528: fcomp 0.0 -> tu choi 0)')
    log('gate', 'slot %s -> %d, amount = %g' % (res, slot, amount))

    log('build', 'module base = 0x%08X' % base)
    verify_build(h, base)

    world = u32(h, PTR_WORLD)
    if not world:
        raise GrantError('world = 0 -> chua vao tran that. TU CHOI.')
    mgr = u32(h, world + OFF_MANAGER)
    if not mgr:
        raise GrantError('manager = 0 -> chua vao tran that. TU CHOI.')

    ch = resolve_chain(h, so)

    # playerdata cua DUNG muc tieu (truoc day ham nay tra slot dau tien = GAIA,
    # tai nguyen luon 0 -> log truoc/sau grant hien 0 -> 0, sai hoan toan)
    pd, vals = get_player(h, ch['slot'])
    if not pd:
        raise GrantError('khong doc duoc playerdata cua slot %d. TU CHOI.'
                         % ch['slot'])
    log('vital', 'playerdata slot %d = 0x%08X (ten %r)'
        % (ch['slot'], pd, ch['ten']), pd)
    # ---------------------------------------------------------------------
    # ONLINE FLAG -- DA SUA (2026-11-10)
    #
    # Ban truoc TU CHOI khi online, vi cho rang engine online chi gui ma
    # khong ap dung local -> se lech checksum.
    #
    # DIEU DO SAI. Da verify bang byte:
    #
    #   engine (ham GUI packet chung, ret 0x14, 5 tham so)
    #     0x42304F  mov  al, [esp+0x38]     ; cmd id (arg2)
    #     0x423054  cmp  al, 0x3e
    #     0x42305C  jne  0x423085           ; khong phai 0x3E -> skip
    #     0x423080  call engine           ; <-- AP DUNG LOCAL
    #     0x423085  ...free packet
    #
    #   engine -> call engine (copy payload vao ring, cung ham apgpiif goi)
    #
    # Nghia la: khi gui cmd 0x3E, engine VUA gui cho peer VUA ap dung local.
    # Ca hai may cung +cung luong -> checksum KHOP.
    #
    # => online KHONG phai ly do de tu choi. Chi canh bao.
    # ---------------------------------------------------------------------
    if ch['online'] != 0:
        print()
        print('  *** ONLINE FLAG = %d ***' % ch['online'])
        print('  Engine se:')
        print('    1. gui packet cmd 0x3E cho peer   (GAME_PKT)')
        print('    2. AP DUNG LOCAL tren may nay     (GAME_PKT -> LOCAL_APPLY)')
        print('  => ca hai may cung tang, checksum du kien KHOP.')
        print('  Neu checksum lech -> doc aoesync.txt ca hai dau.')
    else:
        log('vital', 'online flag = 0 -> APPLY_IMPL ap dung LOCAL (khong gui)')

    player = ch['pindex']
    rec = build_record(player, slot, amount)
    stub = build_stub(ch['sender'], player, slot, amount)

    print()
    log('record', 'record 8 byte = %s' % rec.hex(' ').upper())
    print('        +0 type   = 0x%02X' % rec[0])
    print('        +1 player = %d' % rec[1])
    print('        +2 slot   = %d (%s)' % (rec[2], RES_NAME[res]))
    print('        +3 pad    = 0x%02X' % rec[3])
    print('        +4 f32    = %g  (bits 0x%08X)'
          % (struct.unpack('<f', rec[4:8])[0],
             struct.unpack('<I', rec[4:8])[0]))
    log('stub', 'stub %d byte = %s' % (len(stub), stub.hex(' ').upper()))

    if dry_run:
        print()
        print('DRY-RUN: khong goi gi ca. Khong cap phat, khong tao thread.')
        print('  Se goi  : 0x%08X(ecx=0x%08X, %d, %d, %g)'
              % (BUILDER, ch['sender'], player, slot, amount))
        print('  Sender se goi tiep: 0x%08X(rec, 8) -> 0x%08X -> 0x%08X local'
              % (SENDER, APPLY_GATE, APPLY_IMPL))
        return 0

    # ---- thuc thi ----
    size = 0x1000
    mem = k32.VirtualAllocEx(h, None, size, MEM_COMMIT | MEM_RESERVE,
                             PAGE_EXECUTE_READWRITE)
    if not mem:
        raise GrantError('VirtualAllocEx that bai (err=%d)' % ctypes.get_last_error())
    log('exec', 'VirtualAllocEx 0x%X byte RWX tai 0x%08X' % (size, mem), mem)
    try:
        wrote = ctypes.c_size_t(0)
        if not k32.WriteProcessMemory(h, ctypes.c_void_p(mem), stub, len(stub),
                                      ctypes.byref(wrote)) or wrote.value != len(stub):
            raise GrantError('WriteProcessMemory stub that bai')
        log('exec', 'ghi stub vao 0x%08X' % mem, mem)
        k32.FlushInstructionCache(h, ctypes.c_void_p(mem), len(stub))

        tid = wt.DWORD(0)
        th = k32.CreateRemoteThread(h, None, 0, ctypes.c_void_p(mem), None, 0,
                                    ctypes.byref(tid))
        if not th:
            raise GrantError('CreateRemoteThread that bai (err=%d)'
                             % ctypes.get_last_error())
        log('exec', 'CreateRemoteThread tid=%d' % tid.value)
        try:
            r = k32.WaitForSingleObject(th, 5000)
            if r == WAIT_TIMEOUT:
                raise GrantError('thread khong ket thuc trong 5s -- KHONG xac dinh duoc trang thai')
            code = wt.DWORD(0)
            k32.GetExitCodeThread(th, ctypes.byref(code))
            log('exec', 'thread ket thuc, exit code = %d' % code.value)
        finally:
            k32.CloseHandle(th)
    finally:
        if k32.VirtualFreeEx(h, ctypes.c_void_p(mem), 0, MEM_RELEASE):
            log('exec', 'VirtualFreeEx 0x%08X' % mem, mem)
        else:
            log('exec', 'CANH BAO: VirtualFreeEx that bai (0x%08X con nam lai)'
                % mem, mem)

    # ------------------------------------------------------------------
    # DOC KET QUA -- phai CHO va phai doi CHI EU CUA GRANT, khong phai bat ky
    # thay doi nao.
    #
    # Engine khong cong truc tiep: engine ghi payload vao ring roi drain
    # (0x42A5D0 -> engine -> 0x42B0A0 -> engine -> 0x45DF10). Doc ngay
    # sau khi thread ket thuc se thay gia tri CU.
    #
    # Dong thoi: dan lang thu tai nguyen lien tuc (~10-1000/giay). Neu chi
    # "doi la dung" thi se bat nham phan troi tu nhien -> bao delta +10 trong
    # khi grant +777 da thanh cong. Do 2026-11-11 01:46.
    #
    # => chi chap nhan khi delta dat it nhat 50% amount.
    # ------------------------------------------------------------------
    # chup CA 4 tai nguyen truoc khi grant -- de biet cai nao thuc su doi
    snap_before = {}
    for _k in ('F', 'W', 'S', 'G'):
        _v = f32(h, pd + RES_OFF[_k])
        snap_before[_k] = float(_v) if _v is not None else None

    before = vals.get(res, 0.0)
    if before is None:
        before = 0.0
    before = float(before)
    need = abs(float(amount)) * 0.5
    after = None
    deadline = time.time() + 5.0
    while time.time() < deadline:
        v = f32(h, pd + RES_OFF[res])
        if v is not None:
            v = float(v)
            if (v - before) >= need:
                after = v
                break
        time.sleep(0.05)
    if after is None:
        v = f32(h, pd + RES_OFF[res])
        after = float(v) if v is not None else None

    print()
    if after is None:
        # doc lai that bai -- co the game da dong / process chet giua luc grant
        log('result', '%s tai playerdata+0x%02X: %g -> KHONG DOC DUOC'
            % (RES_NAME[res], RES_OFF[res], before))
        print('  [!] Khong doc lai duoc gia tri sau khi grant.')
        print('      Process co the da dong. Chay --check de kiem tra.')
        return 0

    log('result', '%s tai playerdata+0x%02X: %g -> %g  (delta %+g, yeu cau %+g)'
        % (RES_NAME[res], RES_OFF[res], before, after, after - before, amount))

    # ------------------------------------------------------------------
    # CHAN DOAN: doc CA 4 tai nguyen, cho biet cai nao THUC SU doi.
    # Neu cai minh grant khong doi ma cai khac doi -> biet ngay la lech
    # offset / lech engine slot, khong phai game chan.
    # ------------------------------------------------------------------
    print()
    print('  %-6s %-9s %-12s %-12s %s'
          % ('', 'offset', 'truoc', 'sau', 'delta'))
    print('  ' + '-' * 56)
    moved = []
    for _k in ('F', 'W', 'S', 'G'):
        _v = f32(h, pd + RES_OFF[_k])
        _now = float(_v) if _v is not None else None
        _old = snap_before.get(_k)
        if _now is None or _old is None:
            d_txt = '?'
            d_val = 0.0
        else:
            d_val = _now - _old
            d_txt = '%+g' % d_val
        mark = '   <== GRANT' if _k == res else ''
        if abs(d_val) > 0.5:
            moved.append(_k)
        print('  %-6s 0x%-7X %-12s %-12s %s%s'
              % ('%s %s' % (_k, RES_NAME.get(_k, _k)), RES_OFF[_k],
                 ('%g' % _old) if _old is not None else '?',
                 ('%g' % _now) if _now is not None else '?',
                 d_txt, mark))
    print()

    # kiem: cai minh grant co nam trong danh sach doi khong
    if res in moved:
        print('  [ok] Tai nguyen duoc grant DA DOI dung.')
    elif moved:
        print('  [!] Grant vao %r nhung %s MOI LA CAI DOI.'
              % (res, ', '.join('%s(%s)' % (m, RES_NAME.get(m, m)) for m in moved)))
        print('      => Lech anh xa. Bao lai de sua.')
    else:
        print('  [!] Khong tai nguyen nao doi sau 5s.')

    if (after - before) < need:
        print()
        print('  [!] Gia tri KHONG tang du sau 5s.')
        print('      Kiem tra: online flag, ring drain, hoac amount.')
    print()
    print('Sau khi grant, chay:  python xa_grant.py --check')
    return 0


def do_grant_hidden(h, base, res, amount, dry_run=False, so=None):
    """Cong tai nguyen qua record type 0x67 sub=2 -- duong anti-cheat khong kiem.

    Khac do_grant():
      - do_grant  di 0x42BDE0 (type 0x05) -> anti-cheat kiem amount > 0.0 -> BAO
      - ham nay   tu build record 0x67/2 -> anti-cheat dich sang type 5 nhung
                  ring-miss lam player = 0 -> thoat im lang

    Van gui qua 0x42BA60 nen peer nhan duoc va ap dung -> KHONG desync.
    """
    if res not in RES_SLOT:
        raise GrantError('slot phai la F/W/S/G, nhan %r' % (res,))
    slot = RES_SLOT[res]
    try:
        amount = float(amount)
    except Exception:
        raise GrantError('amount khong phai so: %r' % (amount,))
    if not (amount > 0.0):
        raise GrantError('amount phai > 0 (engine tu choi 0)')

    log('hidden', 'bat dau: +%g %s qua type 0x67/2' % (amount, RES_NAME[res]))
    verify_build(h, base)

    world = u32(h, PTR_WORLD)
    if not world:
        raise GrantError('world = 0 -> chua vao tran that.')
    mgr = u32(h, world + OFF_MANAGER)
    if not mgr:
        raise GrantError('manager = 0 -> chua vao tran that.')
    sender = u32(h, mgr + OFF_SENDER)
    if not sender:
        raise GrantError('khong co sender -> chua vao tran.')
    log('hidden', 'world=0x%08X mgr=0x%08X sender=0x%08X'
        % (world, mgr, sender), world)

    ch = resolve_chain(h, so)
    player = ch['pindex']
    pd, vals = get_player(h, ch['slot'])
    if not pd:
        raise GrantError('khong doc duoc playerdata cua slot %d.' % ch['slot'])

    rec = build_record_res_credit(player, slot, amount)

    print()
    log('record', 'record 12 byte = %s' % rec.hex(' ').upper())
    print('        +0 type   = 0x%02X  (0x67)' % rec[0])
    print('        +1 sub    = %d     (2 = credit)' % rec[1])
    print('        +2 player = %d' % struct.unpack_from('<h', rec, 2)[0])
    print('        +4 slot   = %d (%s)' % (struct.unpack_from('<H', rec, 4)[0],
                                            RES_NAME[res]))
    print('        +8 f32    = %g  (bits 0x%08X)'
          % (struct.unpack_from('<f', rec, 8)[0],
             struct.unpack_from('<I', rec, 8)[0]))

    if dry_run:
        print()
        print('DRY-RUN: khong goi gi ca.')
        print('  Se goi: 0x%08X(ecx=0x%08X, rec, %d)'
              % (DISPATCH_42BA60, sender, len(rec)))
        return 0

    before = vals.get(res, 0.0)
    before = 0.0 if before is None else float(before)

    _call_dispatch(h, sender, rec)
    log('hidden', 'da gui record 0x67/2')

    # doi engine ap dung (ring drain), roi doc lai
    need = abs(amount) * 0.5
    after = None
    deadline = time.time() + 5.0
    while time.time() < deadline:
        v = f32(h, pd + RES_OFF[res])
        if v is not None:
            v = float(v)
            if (v - before) >= need:
                after = v
                break
        time.sleep(0.05)
    if after is None:
        v = f32(h, pd + RES_OFF[res])
        after = float(v) if v is not None else None

    print()
    if after is None:
        log('result', '%s: %g -> KHONG DOC DUOC' % (RES_NAME[res], before))
        print('  [!] Process co the da dong. Chay --check.')
        return 0

    log('result', '%s tai playerdata+0x%02X: %g -> %g  (delta %+g, yeu cau %+g)'
        % (RES_NAME[res], RES_OFF[res], before, after,
           after - before, amount))
    if (after - before) < need:
        print('  [!] Tai nguyen khong tang du. Co the:')
        print('      - record khong duoc ap dung (kiem tra online flag)')
        print('      - player index sai')
        print('      - engine clamp amount')
    return 0



# ----------------------------------------------------------------------------
def do_farm(h, base, amount, dry_run=False, one_id=None):
    """Cong `amount` thit vao ruong cua minh qua action record type 0x77.

    KHONG desync: record di qua SENDER -> GAME_PKT -> ca 2 may cung chay.
    """
    log('farm', 'bat dau: +%d thit' % amount)
    verify_build(h, base)

    world = u32(h, PTR_WORLD)
    if not world:
        raise GrantError('world = 0 -> chua vao tran that.')
    mgr = u32(h, world + OFF_MANAGER)
    if not mgr:
        raise GrantError('manager = 0 -> chua vao tran that.')
    sender = u32(h, mgr + OFF_SENDER)
    if not sender:
        raise GrantError('khong co sender -> chua vao tran.')
    log('farm', 'world=0x%08X mgr=0x%08X sender=0x%08X'
        % (world, mgr, sender), world)

    farms = find_my_farms(h, mgr)
    if not farms:
        raise GrantError(
            'khong tim thay ruong nao cua ban.\n'
            '  Kiem tra:\n'
            '    - da xay ruong chua\n'
            '    - ruong con thit khong (het thit -> khong con resourceId 4)\n'
            '    - da vao tran that chua')
    if one_id is not None:
        farms = [f for f in farms if f['id'] == one_id]
        if not farms:
            raise GrantError('khong co object id %d' % (one_id,))

    # ------------------------------------------------------------------
    # CHAN TRAN INT16
    #
    # obj+0x1C0 amount la int16 (0x4AF6F9 sub word, 0x4AF702 movsx).
    # Cong don qua 32767 -> tran thanh so AM -> ruong hong.
    # Gioi han an toan 30000.
    # ------------------------------------------------------------------
    SAFE_MAX = 30000
    skipped = []
    kept = []
    for f in farms:
        if f['amt'] + amount > SAFE_MAX:
            skipped.append(f)
        else:
            kept.append(f)

    print()
    print('  %-12s %-12s %-12s %-10s %-10s'
          % ('objId', 'idxId', 'ptr', 'thit', 'sau khi'))
    print('  ' + '-' * 60)
    for f in farms:
        after = f['amt'] + amount
        tag = ''
        if after > SAFE_MAX:
            tag = '  BO QUA (tran int16)'
        elif after == f['amt'] and f in skipped:
            tag = '  BO QUA'
        print('  %-12d %-12d 0x%-10X %-10d %-10d%s'
              % (f['id'], f.get('idx_id', f['id']), f['ptr'],
                 f['amt'], after, tag))
    print()

    if skipped:
        print('  [!] %d ruong da gan nguong an toan %d, bo qua.'
              % (len(skipped), SAFE_MAX))
        print('      (int16 tran o 32767 -> ruong se am thit)')
        print()
    if not kept:
        print('  Khong con ruong nao can bop. Dung.')
        return 0
    farms = kept

    diff = [f for f in farms if f.get('idx_id') != f['id']]
    if diff:
        print('  [!] %d ruong co objId khac idxId.' % len(diff))
        print('      Neu gui that bai, thu lai bang idxId.')
    print()

    if dry_run:
        print('  DRY-RUN: khong gui gi.')
        for f in farms[:2]:
            rec = build_record_obj_resource(f['id'], RES_ID_FOOD, amount)
            print('    record %s' % rec.hex(' '))
        return 0

    ok = 0
    for f in farms:
        try:
            rec = build_record_obj_resource(f['id'], RES_ID_FOOD, amount)
            _call_dispatch(h, sender, rec)
            ok += 1
            print('  [ok] object %-10d +%d thit' % (f['id'], amount))
        except GrantError as e:
            print('  [loi] object %-10d : %s' % (f['id'], e))
        if len(farms) > 1:
            time.sleep(0.6)   # tranh dedup 500ms cua 0x42BA10
    print()
    print('  %d/%d ruong thanh cong' % (ok, len(farms)))
    return 0


def _call_dispatch(h, sender, rec):
    """Gửi record qua dispatch với con trỏ record do GAME cấp phát.

    QUAN TRỌNG — đây là lỗi crash 0xC0000005 đã gặp thật:

        Dispatch lưu con trỏ record vào [session+8], lần gửi SAU sẽ free nó
        bằng 0x5284F0 (heap CỦA GAME). Nếu ta đưa con trỏ VirtualAllocEx vào:
            1. session giữ con trỏ lạ
            2. ta VirtualFreeEx -> treo
            3. lần sau 0x5284F0(trỏ treo) -> heap corruption -> 0xC0000005

    Nên: cấp phát record bằng allocator của game (build_stub_dispatch_owned),
    chỉ dùng VirtualAllocEx cho STUB (stub không bị game free).
    """
    MEM_COMMIT = 0x1000
    MEM_RESERVE = 0x2000
    MEM_RELEASE = 0x8000
    PAGE_RWX = 0x40

    if len(rec) > 0x100:
        raise GrantError('record qua lon (%d byte, toi da 0x100)' % len(rec))
    size = 0x1000
    mem = k32.VirtualAllocEx(h, None, size, MEM_COMMIT | MEM_RESERVE, PAGE_RWX)
    if not mem:
        raise GrantError('VirtualAllocEx that bai (loi %d)'
                         % ctypes.get_last_error())
    try:
        stub_addr = mem
        rec_addr = mem + 0x100
        stub = build_stub_dispatch_owned(sender, rec, rec_addr)
        payload = stub + b'\x00' * (0x100 - len(stub)) + rec

        wrote = ctypes.c_size_t(0)
        if not k32.WriteProcessMemory(h, ctypes.c_void_p(mem), payload,
                                      len(payload), ctypes.byref(wrote)):
            raise GrantError('WriteProcessMemory that bai (loi %d)'
                             % ctypes.get_last_error())
        log('dispatch', 'stub %d byte, template %d byte tai 0x%08X'
            % (len(stub), len(rec), mem), mem)

        th = k32.CreateRemoteThread(h, None, 0,
                                    ctypes.c_void_p(stub_addr),
                                    None, 0, None)
        if not th:
            raise GrantError('CreateRemoteThread that bai (loi %d)'
                             % ctypes.get_last_error())
        r = k32.WaitForSingleObject(th, 3000)
        if r == WAIT_TIMEOUT:
            k32.CloseHandle(th)
            raise GrantError('thread khong ket thuc trong 3s '
                             '-- KHONG xac dinh duoc trang thai')
        code = wt.DWORD(0)
        k32.GetExitCodeThread(th, ctypes.byref(code))
        k32.CloseHandle(th)
        log('dispatch', 'thread xong, exit=%d' % code.value)
    finally:
        if k32.VirtualFreeEx(h, ctypes.c_void_p(mem), 0, MEM_RELEASE):
            log('dispatch', 'VirtualFreeEx 0x%08X' % mem, mem)


HELP_TEXT = """
XA GRANT -- them tai nguyen trong AoE-HD (EMPIRESX.EXE)

CACH DUNG
    xa_grant.exe --key <TOKEN>        # nap token (lay tren website)
    xa_grant.exe --check              # xem tai nguyen hien tai
    xa_grant.exe --selftest           # kiem tra logic, khong can game

HAI DUONG GRANT
    --grant F 5000                    # record type 0x05 qua BUILDER
                                      #   -> anti-cheat GHI NHAN
    --stealth F 5000                  # record type 0x67/2
                                      #   -> anti-cheat KHONG kiem

    F=thit  W=go  S=da  G=vang
    --for N     grant cho nguoi choi so N (1..8)
    --dry-run   xem truoc, khong gui

VI DU
    xa_grant.exe --grant F 5000 --dry-run
    xa_grant.exe --grant F 5000 --i-understand-this-may-desync
    xa_grant.exe --stealth F 5000 --dry-run
    xa_grant.exe --stealth F 5000

CAN: Administrator + game dang chay + da vao tran + token hop le.
Lay token tai: https://xienhl.com/#/licenses
"""


def selftest():
    """Chay khong can game: chi kiem tra phan thuan."""
    ok = True
    print('SELFTEST (khong cham vao game)')
    r = build_record(0, 0, 1000.0)
    exp = bytes.fromhex('05 00 00 00 00 00 7A 44')
    print('  record(F,1000) = %s  mong doi %s  %s'
          % (r.hex(' ').upper(), exp.hex(' ').upper(),
             'OK' if r == exp else 'FAIL'))
    ok &= (r == exp)
    r2 = build_record(2, 3, -1.5)
    print('  record(player2,slot3,-1.5) = %s' % r2.hex(' ').upper())
    ok &= (r2[0] == 5 and r2[1] == 2 and r2[2] == 3 and r2[3] == 0)
    for bad in (float('nan'), float('inf')):
        try:
            build_record(0, 0, bad)
            print('  NaN/Inf KHONG bi chan -> FAIL')
            ok = False
        except GrantError:
            print('  NaN/Inf bi chan: OK')
    s = build_stub(0x12345678, 0, 1, 5000.0)
    print('  stub(%d byte) = %s' % (len(s), s.hex(' ').upper()))
    ok &= (len(s) == 28 and s[0] == 0xB9 and s[-3:-1] == b'\xFF\xD0' and s[-1] == 0xC3)

    # ---- Duong STEALTH: record type 0x67/2 ----
    cr = build_record_res_credit(0, 0, 1000.0)
    exp_cr = bytes.fromhex('67 02 00 00 00 00 00 00 00 00 7A 44')
    print('  record_credit(F,1000) = %s  mong doi %s  %s'
          % (cr.hex(' ').upper(), exp_cr.hex(' ').upper(),
             'OK' if cr == exp_cr else 'FAIL'))
    ok &= (cr == exp_cr)
    ok &= (len(cr) == 12 and cr[0] == TYPE_RES_XFER and cr[1] == SUBTYPE_RES_CREDIT)

    cr2 = build_record_res_credit(2, 3, -1.5)
    ok &= (struct.unpack_from('<h', cr2, 2)[0] == 2)   # player i16
    ok &= (struct.unpack_from('<H', cr2, 4)[0] == 3)   # slot u16
    ok &= (struct.unpack_from('<f', cr2, 8)[0] == -1.5)
    print('  record_credit(player2,slot3,-1.5) = %s  OK' % cr2.hex(' ').upper())

    for bad in (float('nan'), float('inf')):
        try:
            build_record_res_credit(0, 0, bad)
            print('  stealth NaN/Inf KHONG bi chan -> FAIL')
            ok = False
        except GrantError:
            pass
    print('  stealth NaN/Inf bi chan: OK')

    # Stub owned phai cap phat bang allocator cua game (tranh double-free).
    so = build_stub_dispatch_owned(0x11111111, cr, 0x22222200)
    ok &= (so[0:2] == b'\x6A\x0C' and so[2:4] == b'\x6A\x01')
    ok &= (b'\xF3\xA4' in so)          # rep movsb
    ok &= (so[-1] == 0xC3)
    print('  stub_owned(%d byte): alloc+copy+dispatch  %s'
          % (len(so), 'OK' if len(so) == 46 else 'FAIL'))
    ok &= (len(so) == 46)

    print('  KET QUA: %s' % ('PASS' if ok else 'FAIL'))
    return 0 if ok else 1


# ============================================================================
# CHE DO TUONG TAC -- alt-tab ra, go lenh
#
# Khong gan phim tat. Khong hook ban phim. Khong chay ngam.
# Chi la vong lap doc lenh tu ban phim, y het console binh thuong.
#
#   python xa_grant.py --interactive
#
# Go:
#   f 500       -> +500 thit
#   g 10000     -> +10000 vang
#   w 500 s 200 -> +500 go va +200 da (nhieu lenh 1 dong)
#   check       -> xem tai nguyen hien tai
#   who         -> xem slot nao la cua ban
#   help        -> huong dan
#   q / quit    -> thoat
# ============================================================================

RES_NAME = {'F': 'thit', 'W': 'go', 'S': 'da', 'G': 'vang'}


def _manager(h):
    """Tra manager pointer, hoac 0."""
    world = u32(h, PTR_WORLD)
    if not world:
        return 0
    return u32(h, world + OFF_MANAGER) or 0


def _current_pid():
    """PID cua EMPIRESX dang chay, hoac None."""
    try:
        procs = find_game()
        return procs[0][0] if procs else None
    except Exception:
        return None


def _handle_valid(h, pid):
    """Kiem handle con tro toi dung process con song khong."""
    if not h or not pid:
        return False
    # 1. process con ton tai?
    try:
        procs = find_game()
        if not any(p[0] == pid for p in procs):
            return False
    except Exception:
        return False
    # 2. doc thu world pointer
    try:
        world = u32(h, PTR_WORLD)
    except Exception:
        return False
    if world is None:
        return False
    # 3. exit code (neu da thoat thi GetExitCodeProcess != STILL_ACTIVE)
    try:
        code = wt.DWORD(0)
        if k32.GetExitCodeProcess(h, ctypes.byref(code)):
            if code.value != 259:      # STILL_ACTIVE
                return False
    except Exception:
        pass
    return True


def _check_alive(h):
    """Tra 'ok' | 'reconnect'.

    'reconnect' khi: PID doi, game dong, hoac handle chet.
    """
    pid = _current_pid()
    if pid is None:
        return 'reconnect'
    cur = getattr(_check_alive, '_pid', None)
    if cur is None:
        _check_alive._pid = pid
        return 'ok' if _handle_valid(h, pid) else 'reconnect'
    if pid != cur:
        return 'reconnect'
    return 'ok' if _handle_valid(h, pid) else 'reconnect'


def _interactive_info(h, base):
    """In thong tin ket noi."""
    pid = _current_pid()
    print()
    print('  PID dang chay : %s' % (pid if pid else 'khong co'))
    print('  PID tool dang giu: %s' % getattr(_check_alive, '_pid', None))
    print('  base          : 0x%08X' % (base or 0))
    world = u32(h, PTR_WORLD)
    if not world:
        return None
    mgr = u32(h, world + OFF_MANAGER) if world else 0
    print('  world         : 0x%s' % (('%X' % world) if world else '0'))
    print('  manager       : 0x%s' % (('%X' % mgr) if mgr else '0'))
    print('  local slot    : %d' % local_index(h))
    print()


def _interactive_names(h, base):
    """In so + ten + tai nguyen."""
    _interactive_show(h, base)
    print('  Dung: p<so> <tai nguyen> <so luong>   vd:  p2 v 500')
    print()


def _interactive_handle(h, base, res, amount, so=None):
    """Chay 1 lenh grant trong che do tuong tac. Tra True neu thanh cong."""
    try:
        do_grant(h, base, res, amount, False, True, so)
        return True
    except GrantError as e:
        print('  LOI: %s' % e)
        return False
    except Exception as e:
        print('  LOI KHONG MONG DOI: %s: %s' % (type(e).__name__, e))
        import traceback
        traceback.print_exc()
        print('  (grant co the DA THANH CONG -- chay "check" de xem)')
        return False


def _interactive_show(h, base):
    """In bang tai nguyen -- dung list_players (da bo GAIA, ten tu +0x44)."""
    try:
        players = list_players(h)
        if not players:
            if not _manager(h):
                print('  chua vao tran')
            else:
                print('  khong doc duoc nguoi choi nao')
            return
        lv = local_index(h)
        print()
        print('  %-4s %-6s %-7s %-16s %8s %8s %8s %8s'
              % ('so', 'slot', '+D8', 'ten', 'thit', 'go', 'da', 'vang'))
        print('  ' + '-' * 70)
        for p in players:
            tag = '  <<< BAN' if p['idx'] == lv else ''
            print('  %-4d %-6d 0x%-5X %-16s %8.0f %8.0f %8.0f %8.0f%s'
                  % (p['so'], p['slot'], p.get('bm', 0),
                     (p['ten'] or '?')[:16],
                     p['vals']['F'], p['vals']['W'],
                     p['vals']['S'], p['vals']['G'], tag))
        print()
    except Exception as e:
        print('  LOI: %s: %s' % (type(e).__name__, e))


def _interactive_who(h, base):
    """In minh la ai."""
    try:
        lv = local_index(h)
        if lv < 0:
            print('  chua vao tran (local slot = -1)')
            return
        players = list_players(h)
        print()
        for p in players:
            if p['idx'] == lv:
                print('  BAN la slot %d, so %d, ten %r'
                      % (p['slot'], p['so'], p['ten']))
                print()
                return
        print('  local slot = %d nhung khong khop player nao' % lv)
        print('  danh sach: %s' % [(p['so'], p['ten']) for p in players])
        print()
    except Exception as e:
        print('  LOI: %s: %s' % (type(e).__name__, e))


def _vi_name(r):
    """Ten tieng Viet cua tai nguyen."""
    return {'F': 'thit', 'W': 'go', 'S': 'da', 'G': 'vang'}.get(r, r)


def _split_glued(tok):
    """Tach chuoi dinh nhau thanh cac cum, TUAN TU, khong regex phuc tap.

    p2v500      -> ['p2', 'v', '500']
    v1000t500   -> ['v', '1000', 't', '500']
    p3full2000  -> ['p3', 'full', '2000']
    v1000       -> ['v', '1000']
    1000v       -> ['1000', 'v']
    1.5k        -> ['1.5k']
    p2          -> ['p2']
    """
    t = tok.strip()
    if not t:
        return []

    # buoc 1: tach pN / @N ra truoc
    out1 = []
    buf = ''
    k = 0
    while k < len(t):
        ch = t[k]
        low = ch.lower()
        if low in ('p', '@', 'n'):
            # thu doc so ngay sau
            m = re.match(r'\d+', t[k + 1:])
            if m and buf == '':
                out1.append(t[k:k + 1 + len(m.group())])
                k += 1 + len(m.group())
                continue
        buf += ch
        k += 1
    if buf:
        out1.append(buf)

    # buoc 2: moi cum tach tiep thanh <chu><so><chu><so>...
    out2 = []
    for seg in out1:
        if re.fullmatch(r'[pPnN@]\d+', seg):
            out2.append(seg)
            continue
        # quet tuan tu
        cur = ''
        cur_is_digit = None
        for ch in seg:
            isdig = ch.isdigit() or ch == '.'
            if cur_is_digit is None:
                cur = ch
                cur_is_digit = isdig
            elif isdig == cur_is_digit:
                cur += ch
            else:
                # neu la hau to don vi (k,m,b,tr) thi gop vao so
                if cur_is_digit and ch.lower() in ('k', 'm', 'b'):
                    cur += ch
                    # ket thuc cum so
                    out2.append(cur)
                    cur = ''
                    cur_is_digit = None
                    continue
                out2.append(cur)
                cur = ch
                cur_is_digit = isdig
        if cur:
            out2.append(cur)

    # gop 'tr' / 'nghin' / 'trieu' / 'ty' vao so truoc
    merged = []
    for x in out2:
        xl = x.lower()
        if (merged and re.fullmatch(r'\d+(?:\.\d+)?', merged[-1])
                and xl in ('tr', 'nghin', 'trieu', 'ty', 'k', 'm', 'b')):
            merged[-1] = merged[-1] + x
            continue
        merged.append(x)

    return merged if merged else [tok]


def _tokenize(line):
    """Tach dong lenh thanh token da phan loai.

    Moi phan tu: (kind, value)
      ('res', 'F'|'W'|'S'|'G')  ('num', float)  ('player', 1..8)
      ('me', None)  ('full', None)  ('bad', chuoiGoc)
    """
    RES_ALIAS = {
        'v': 'G', 'vang': 'G', 'gold': 'G',
        't': 'F', 'thit': 'F', 'food': 'F',
        'g': 'W', 'go': 'W', 'wood': 'W',
        'd': 'S', 'da': 'S', 'stone': 'S',
        'f': 'F', 'w': 'W', 's': 'S',
    }
    FULL_WORDS = ('full', 'het', 'tat', 'all', 'max', 'full4')
    ME_WORDS = ('me', 'minh', 'toi', 'self', 'ta')

    txt = line.strip()
    for ch in ',;=:+':
        txt = txt.replace(ch, ' ')
    raw = txt.split()

    # tach moi token dinh nhau
    exp = []
    for tok in raw:
        exp.extend(_split_glued(tok))

    # phan loai
    out = []
    for t in exp:
        tl = t.lower().strip()
        if not tl:
            continue
        m = re.match(r'^(?:p|@|n|nguoi|player|slot)(\d+)$', tl)
        if m:
            # ------------------------------------------------------------------
            # CHI CHO GRANT CHINH MINH.
            # Chon nguoi khac (p1..p8) bi tu choi o day.
            # ------------------------------------------------------------------
            out.append(('other', t))
            continue
        if tl in ME_WORDS:
            out.append(('me', None))
            continue
        if tl in FULL_WORDS:
            out.append(('full', None))
            continue
        # ruong vo han thit
        if tl in ('ruong', 'farm', 'r'):
            out.append(('farm', None))
            continue
        if tl in RES_ALIAS:
            out.append(('res', RES_ALIAS[tl]))
            continue
        num = _parse_number(tl)
        if num is not None:
            out.append(('num', num))
            continue
        out.append(('bad', t))
    return out


def _parse_cmd(line):
    """Phan tich lenh -- CHAP NHAN MOI THU TU.

    Tra (jobs, error). jobs = list (so_nguoi, res, amount).
    so_nguoi = None nghia la chinh minh.

    DEU DUNG:
        v 1000          1000 v          v1000        v=1000
        V 1.000         v 1tr           v 1.5k       v 2m
        t 500 v 200     v g d t 1000    1000 v g d t
        p2 v 500        v 500 p2        p2v500
        full            full 50000      50000 full   full p3 100000
        me v 100        @3 t 500
    """
    if not line or not line.strip():
        return None, 'khong co lenh nao'

    items = _tokenize(line)

    # ------------------------------------------------------------------
    # QUET TOKEN -- logic 2 chieu:
    #   so TRUOC ten  -> "1000 v":    so chuyen sang phai
    #   so SAU  ten   -> "v 1000":    so chuyen sang trai
    #   so giua nhieu ten -> "v g d 1000": ap cho tat ca ten dang cho
    #   pN o CUOI     -> ap nguoc cho ca cau vua doc ("v 500 p2")
    #
    # Cach lam: chia thanh TUNG DOAN (segment). Moi doan bat dau khi gap
    # pN/me hoac khi da "chot" xong mot nhom tai nguyen + so.
    # ------------------------------------------------------------------
    # Buoc 1: tach thanh cac doan theo player
    segs = []          # list of (player_or_None, [items...])
    # CHI 1 SEGMENT: tat ca grant deu cho chinh minh (cur_p luon None).
    # Token 'other' se gay loi khi xu ly.
    segs.append((None, list(items)))

    jobs = []
    err = None

    # Buoc 2: xu ly tung doan
    for pnum, its in segs:
        pend = []          # tai nguyen dang cho so
        carry = None       # so dang cho tai nguyen
        wantfull = False

        for kind, val in its:
            if kind == 'bad':
                err = '"%s" khong hieu. Go "help".' % val
                break

            if kind == 'other':
                err = ('CHI GRANT CHO CHINH MINH.\n'
                       '  Khong ho tro chon nguoi choi khac (%s).\n'
                       '  Go lai khong co "p...": vd  v 1000  hoac  full' % val)
                break

            if kind == 'me':
                continue

            if kind == 'farm':
                err = ('LENH "ruong" chay rieng. Go:  ruong 1000\n'
                       '  (hoac dung xa_farm.py)')
                break

            if kind == 'full':
                if carry is not None:
                    for r in FULL_SET:
                        jobs.append((pnum, r, float(carry)))
                    carry = None
                else:
                    wantfull = True
                continue

            if kind == 'num':
                if wantfull:
                    for r in FULL_SET:
                        jobs.append((pnum, r, float(val)))
                    wantfull = False
                    pend = []
                elif pend:
                    for r in pend:
                        jobs.append((pnum, r, float(val)))
                    pend = []
                elif carry is not None:
                    # 2 so lien nhau -> so sau thay so truoc? cong don
                    carry = carry + val
                else:
                    carry = val
                continue

            if kind == 'res':
                if carry is not None:
                    jobs.append((pnum, val, float(carry)))
                else:
                    pend.append(val)
                continue

        if err:
            break

        # cuoi doan: chot
        if wantfull:
            for r in FULL_SET:
                jobs.append((pnum, r, 100000.0))
            wantfull = False
            pend = []
        if pend:
            if carry is not None:
                for r in pend:
                    jobs.append((pnum, r, float(carry)))
            else:
                err = 'thieu so cho: %s' % ', '.join(
                    RES_NAME.get(r, r) for r in pend)
                break

    if err:
        return None, err
    if not jobs:
        return None, 'khong co lenh nao'

    # Buoc 3: pN o CUOI cau -> ap nguoc cho doan cuoi cung truoc do
    # (da xu ly o buoc 1 vi pN tao doan moi; neu pN la token cuoi thi
    #  doan cuoi la rong -> khong con gi de ap, nen bo qua)
    # => khong can xu ly them

    # gop lenh trung
    merged = {}
    order = []
    for so, r, amt in jobs:
        key = (so, r)
        if key not in merged:
            merged[key] = amt
            order.append(key)
        else:
            merged[key] += amt

    out = [(so, r, merged[(so, r)]) for (so, r) in order]
    for so, r, amt in out:
        if amt <= 0:
            return None, 'so phai > 0'
    return out, None


def _parse_number(t):
    """Doc so kieu: 1000 | 1,000 | 1.000 | 1e5 | 1.5k | 2tr | 2m | 3b."""
    s2 = t.strip().lower()
    if not s2:
        return None

    # hau to
    MULT = {'k': 1000.0, 'tr': 1e6, 'm': 1e6, 'b': 1e9,
            'nghin': 1000.0, 'trieu': 1e6, 'ty': 1e9}
    mult = 1.0
    for suf in ('nghin', 'trieu', 'tr', 'ty', 'k', 'm', 'b'):
        if s2.endswith(suf) and len(s2) > len(suf):
            core = s2[:-len(suf)].strip('. ,')
            if core:
                mult = MULT[suf]
                s2 = core
                break

    # bo dau phan cach nghin: 1.000.000 | 1,000,000 | 1 000 000
    if re.fullmatch(r'\d{1,3}(?:[.,]\d{3})+', s2):
        s2 = re.sub(r'[.,]', '', s2)
    else:
        # 1.5 -> 1.5 (thap phan) ; 1,5 -> 1.5
        if re.fullmatch(r'\d+[.,]\d+', s2):
            s2 = s2.replace(',', '.')

    try:
        v = float(s2)
    except ValueError:
        return None
    if v != v or v <= 0:
        return None
    return v * mult


def _interactive_loop(h, base):
    """Vong lap lenh.

    Tra ('quit', None, None) neu thoat.
    Tra ('reconnect', None, None) neu can mo lai process (PID doi / game dong).

    TRUOC MOI LENH: kiem game con song khong, PID co doi khong.
    Neu doi -> tra 'reconnect' de vong ngoai mo lai handle.
    """
    while True:
        # ----- kiem tra game truoc khi cho lenh -----
        state = _check_alive(h)
        if state != 'ok':
            return state, None, None

        try:
            line = input('xa> ').strip()
        except (EOFError, KeyboardInterrupt):
            print()
            return 'quit', None, None
        if not line:
            continue
        low = line.lower()

        if low in ('q', 'quit', 'exit', 'thoat'):
            return 'quit', None, None
        if low in ('help', 'h', '?'):
            _interactive_help()
            continue

        # ----- kiem lai truoc khi lam bat cu gi -----
        state = _check_alive(h)
        if state != 'ok':
            return state, None, None

        if low in ('check', 'xem', 'list'):
            _interactive_show(h, base)
            continue
        if low in ('who', 'toi'):
            _interactive_who(h, base)
            continue
        if low in ('nums', 'so', 'ten'):
            _interactive_names(h, base)
            continue

        # ------------------------------------------------------------
        # LENH RUONG:  ruong         -> liet ke ruong
        #              ruong 1000    -> +1000 thit vao moi ruong
        #              ruong 1000 5  -> +1000 vao ruong id 5
        # ------------------------------------------------------------
        if low.startswith('ruong') or low == 'farm' or low.startswith('farm '):
            parts = line.split()
            amt = 250
            oid = None
            rest = parts[1:]
            nums = []
            for t in rest:
                try:
                    nums.append(int(float(t)))
                except ValueError:
                    pass
            if len(nums) >= 1:
                amt = nums[0]
            if len(nums) >= 2:
                oid = nums[1]
            try:
                if not rest:
                    farms = find_my_farms(h, _manager(h))
                    if not farms:
                        print('  khong thay ruong nao cua ban')
                    else:
                        print()
                        print('  %-12s %-12s %-10s' % ('objId', 'ptr', 'thit'))
                        print('  ' + '-' * 38)
                        for f in farms:
                            print('  %-12d 0x%-10X %-10d'
                                  % (f['id'], f['ptr'], f['amt']))
                        print()
                        print('  Dung:  ruong 1000        (+1000 thit moi ruong)')
                        print('         ruong 1000 <objId>')
                else:
                    do_farm(h, base, amt, dry_run=False, one_id=oid)
            except GrantError as e:
                print('  LOI: %s' % e)
            except Exception as e:
                print('  LOI KHONG MONG DOI: %s: %s' % (type(e).__name__, e))
                import traceback
                traceback.print_exc()
            continue
        if low in ('pid', 'info'):
            _interactive_info(h, base)
            continue
        if low in ('re', 'reconnect', 'lai'):
            return 'reconnect', None, None

        jobs, err = _parse_cmd(line)
        if err:
            print('  LOI: %s' % err)
            continue

        # ------------------------------------------------------------------
        # DELAY GIUA CAC RECORD
        #
        # 0x42BA10 (dedup): record moi CUNG size + CUNG type + < 500ms
        #   -> goi 0x42B9C0(rec) va KHONG goi engine
        #   -> record BI MAT (khong gui, khong ap dung)
        #
        # 0x42B9C0 chi tra 0 khi type > 3, nhung 0x42BA10 da bo qua
        # TRUOC khi goi engine => type 5 trong 500ms van bi mat.
        #
        # Do do: phai cho >= 500ms giua cac record cung type.
        # Dung 650ms cho chac.
        # ------------------------------------------------------------------
        _first = True
        for so, res, amt in jobs:
            state = _check_alive(h)
            if state != 'ok':
                return state, None, None
            if not _first:
                time.sleep(0.65)
            _first = False
            if so is None:
                who = 'minh'
            else:
                p = find_by_number(h, so)
                who = ('so %d (%s)' % (so, p['ten'])) if p and p['ten'] else ('so %d' % so)
            print('  --> +%g %s cho %s' % (amt, _vi_name(res), who))
            ok = _interactive_handle(h, base, res, amt, so)
            if not ok:
                print('  THAT BAI')
        print()
        _interactive_show(h, base)


def _interactive_help():
    print()
    print('  === GO THE NAO CUNG DUOC ===')
    print()
    print('  --- TAI NGUYEN (v=vang t=thit g=go d=da) ---')
    print('    v 1000          1000 v         v1000        v=1000')
    print('    V 1.000         v 1tr          v 1.5k       v 2m')
    print('    t 500 v 200     v g d t 1000   1000 v g d t')
    print()
    print('  --- CONG NHIEU TAI NGUYEN (khong co da) ---')
    print('    full            +100.000 thit+go+vang')
    print('    full 5000       +5.000 moi thu')
    print('    full 1000000    +1.000.000 moi thu')
    print('    50000 full      nhu full 50000')
    print()
    print('  --- RUONG VO HAN THIT ---')
    print('    ruong             xem ruong cua minh')
    print('    ruong 1000        +1000 thit vao MOI ruong')
    print('    ruong 1000 5      +1000 vao ruong co objId 5')
    print()
    print('  --- LENH KHAC ---')
    print('    check    xem tai nguyen')
    print('    nums     xem so + ten + tai nguyen')
    print('    who      minh la ai')
    print('    pid      xem PID / ket noi')
    print('    re       mo lai process')
    print('    q        thoat')
    print()
    print('  *** CHI GRANT CHO CHINH MINH ***')
    print('  Khong ho tro p1..p8 (chon nguoi choi khac).')
    print()
def interactive():
    """Che do tuong tac -- chay lien tuc, tu tim lai game khi PID doi."""
    print('=' * 72)
    print('  XA GRANT -- CHE DO TUONG TAC')
    print('=' * 72)
    print()
    _interactive_help()

    if not is_admin():
        print('  !! CAN QUYEN ADMINISTRATOR.')
        print('  Chuot phai file xa_grant.exe > Run as administrator.')
        print()
        try:
            input('  Enter de thoat...')
        except Exception:
            pass
        return 5

    h = None
    pid = None
    base = None
    _check_alive._pid = None

    while True:
        # ---------- mo / mo lai process ----------
        if h is None:
            procs = find_game()
            if not procs:
                print('  [cho] Khong thay EMPIRESX.EXE.')
                print('        Mo game va vao tran. Tool cho, go q de thoat.')
                try:
                    line = input('xa> ').strip().lower()
                except (EOFError, KeyboardInterrupt):
                    print()
                    return 0
                if line in ('q', 'quit', 'exit', 'thoat'):
                    print('  Thoat.')
                    return 0
                if line == 're':
                    continue
                if line:
                    print('  [cho] Chua co game.')
                continue

            pid, name = procs[0]
            try:
                h = open_game(pid)
                base = module_base(h)
                if base != PREFERRED_BASE:
                    print('  base = 0x%08X != 0x%08X. Bo qua lan nay.'
                          % (base, PREFERRED_BASE))
                    try:
                        k32.CloseHandle(h)
                    except Exception:
                        pass
                    h = None
                    continue
                verify_build(h, base)
                _check_alive._pid = pid
                print()
                print('  [ok] %s pid %d  base 0x%08X  signature khop'
                      % (name, pid, base))
                _interactive_who(h, base)
                print('  (go "help" de xem lenh, "q" de thoat)')
                print()
            except Exception as e:
                print('  [loi] khong mo duoc process: %s: %s'
                      % (type(e).__name__, e))
                try:
                    if h:
                        k32.CloseHandle(h)
                except Exception:
                    pass
                h = None
                pid = None
                print('  [cho] Thu lai... (go q de thoat)')
                try:
                    line = input('xa> ').strip().lower()
                except (EOFError, KeyboardInterrupt):
                    return 0
                if line in ('q', 'quit', 'exit', 'thoat'):
                    return 0
                continue

        # ---------- vong lap lenh ----------
        try:
            action, _, _ = _interactive_loop(h, base)
        except Exception as e:
            print('  [loi] %s: %s' % (type(e).__name__, e))
            import traceback
            traceback.print_exc()
            action = 'reconnect'

        if action == 'quit':
            try:
                k32.CloseHandle(h)
            except Exception:
                pass
            print()
            print('  Thoat. Khong co gi duoc ghi lai.')
            return 0

        # action == 'reconnect'
        oldpid = pid
        try:
            k32.CloseHandle(h)
        except Exception:
            pass
        h = None
        pid = None
        base = None
        _check_alive._pid = None

        newpid = _current_pid()
        if newpid:
            print()
            print('  [doi game] PID %s -> %d. Dang mo lai...'
                  % (oldpid if oldpid else '?', newpid))
        else:
            print()
            print('  [mat game] Game da dong (truoc do pid %s).'
                  % (oldpid if oldpid else '?'))
            print('             Tool cho game mo lai. Go q de thoat.')
        # lap lai vong ngoai


def main():
    args = sys.argv[1:]

    # ------------------------------------------------------------------
    # MAC DINH: CHAY CHE DO TUONG TAC
    #
    # Bam dup file EXE (khong tham so) -> vao thang che do tuong tac,
    # KHONG in help roi thoat. Truoc day no in help roi tat, gay kho hieu.
    # ------------------------------------------------------------------
    if not args:
        return interactive()

    if '--help' in args or '-h' in args:
        # Nuitka chay voi --python-flag=no_docstrings nen __doc__ bi cat -> in
        # ra "None". Dung chuoi tuong minh thay vi dua vao __doc__.
        print(HELP_TEXT)
        try:
            input('\nEnter de thoat...')
        except Exception:
            pass
        return 0
    if '--selftest' in args:
        r = selftest()
        if '--pause' in args:
            try:
                input('\nEnter de thoat...')
            except Exception:
                pass
        return r
    if '--interactive' in args or '-i' in args:
        return interactive()

    # ---- Nap token (khong can game, khong can admin) ----
    if '--key' in args and '--check' not in args and '--grant' not in args:
        k = args.index('--key')
        if k + 1 >= len(args):
            print('--key can gia tri token')
            return 2
        okE, msgE = ensure_engine(args[k + 1])
        if not okE:
            print()
            print('=' * 70)
            print('TOKEN KHONG HOP LE: %s' % msgE)
            print('=' * 70)
            return 4
        print()
        print('=' * 70)
        print('DA NAP TOKEN')
        print('=' * 70)
        print('  key        : %s' % (_ENGINE_LOADED['key'] or '?'))
        print('  han dung   : %s' % (
            'vinh vien' if not _ENGINE_LOADED['exp']
            else time.strftime('%Y-%m-%d %H:%M',
                               time.localtime(_ENGINE_LOADED['exp']))))
        print('  BUILDER    : 0x%08X' % BUILDER)
        print('  da luu vao : %s' % token_path())
        print()
        print('Gio mo game, vao tran, roi chay:')
        print('  xa_grant.exe --grant F 5000')
        try:
            input('\nEnter de thoat...')
        except Exception:
            pass
        return 0

    gate = GATE_FLAG in args
    dry_run = '--dry-run' in args
    # --stealth là đường thứ hai: né anti-cheat bằng record type 0x67/2.
    if '--check' in args:
        mode = '--check'
    elif '--grant' in args:
        mode = '--grant'
    elif '--stealth' in args:
        mode = '--stealth'
    else:
        mode = None
    if mode is None:
        print('Can --check, --grant hoac --stealth. Xem --help.')
        return 2

    # ---- CONG AN TOAN CUNG, kiem tra DAU TIEN, truoc ca admin/OpenProcess ----
    # Nam o day (khong chi trong do_grant) de khong the vo tinh di qua.
    if mode == '--grant' and not gate:
        print('=' * 70)
        print('TU CHOI: thieu %s' % GATE_FLAG)
        print('=' * 70)
        print('Cong cu nay goi thang 0x%08X trong engine, bo qua logic game' % BUILDER)
        print('binh thuong. Record duoc dua vao stream action nhu mot lenh that,')
        print('nhung peer KHONG co buoc tuong ung -> lech checksum -> co the')
        print('out-of-sync hoac bi kick.')
        print()
        print('Neu ban chap nhan:')
        print('  python xa_grant.py --grant %s %s %s'
              % (mode == '--grant' and 'F' or 'F', '5000', GATE_FLAG))
        print('Xem truoc khong rui ro:')
        print('  python xa_grant.py --grant F 5000 --dry-run')
        return 3

    # ---- NAP BANG DIA CHI TU TOKEN: CONG DAU TIEN ----
    # Dat TRUOC ca kiem tra admin va cua an toan --grant. Ly do:
    #   * Khong co token hop le thi khong biet dia chi ham nao -> khong lam
    #     duoc gi ca, nen khong can doi quyen admin moi bao loi.
    #   * Bao "thieu token" huu ich hon nhieu so voi "can quyen admin" khi
    #     nguoi dung chua mua key.
    # Day la lop THAY THE cho bang dia chi tung nam plaintext trong file nay.
    tok_arg = None
    if '--key' in args:
        _k = args.index('--key')
        if _k + 1 >= len(args):
            print('--key can gia tri token')
            return 2
        tok_arg = args[_k + 1]
    _okE, _msgE = ensure_engine(tok_arg)
    if not _okE:
        print()
        print('=' * 70)
        print('TU CHOI: %s' % _msgE)
        print('=' * 70)
        return 4
    log('token', 'dia chi engine da nap tu token (key=%s)'
        % (_ENGINE_LOADED['key'] or '?'))

    if not is_admin():
        print('CAN QUYEN ADMINISTRATOR. Chuot phai Command Prompt -> Run as administrator.')
        return 5

    procs = find_game()
    if not procs:
        print('Khong tim thay EMPIRESX.EXE. Mo game va vao tran truoc.')
        return 1
    pid, name = procs[0]
    print('=' * 70)
    print('XA GRANT -- %s pid %d' % (name, pid))
    print('=' * 70)
    h = open_game(pid)
    try:
        base = module_base(h)
        if base != PREFERRED_BASE:
            raise GrantError('base = 0x%08X != 0x%08X. DUNG.' % (base, PREFERRED_BASE))
        log('open', 'module base = 0x%08X (khop)' % base)
        if mode == '--check':
            return do_check(h, base)

        # ---- STEALTH: type 0x67/2, KHÔNG cần gate flag ----
        # Lý do không cần gate: đường này đi qua nhánh anti-cheat bỏ qua kiểm
        # (xem build_record_res_credit), nên không tạo record type 5 mà
        # anti-cheat đánh dấu "hack tài nguyên".
        if mode == '--stealth':
            print('  --stealth dung record type 0x67/2: anti-cheat khong kiem.')
            pos = args.index('--stealth')
            rest = [a for a in args[pos + 1:] if not a.startswith('--')]
            if len(rest) < 2:
                print('Dung: --stealth SLOT AMOUNT [--for N]   (vd: --stealth F 5000)')
                print('  --for N  grant cho nguoi choi so N (1..8). Bo trong = chinh minh.')
                return 2
            so = None
            if '--for' in args:
                k = args.index('--for')
                if k + 1 >= len(args):
                    print('--for can so 1..8')
                    return 2
                try:
                    so = int(args[k + 1])
                except ValueError:
                    print('--for phai la so 1..8, nhan %r' % args[k + 1])
                    return 2
                if not (1 <= so <= 8):
                    print('--for phai 1..8')
                    return 2
            return do_grant_hidden(h, base, rest[0].upper(), rest[1], dry_run, so)

        pos = args.index('--grant')
        rest = [a for a in args[pos + 1:] if not a.startswith('--')]
        if len(rest) < 2:
            print('Dung: --grant SLOT AMOUNT [--for N]   (vd: --grant F 5000)')
            print('  --for N  grant cho nguoi choi so N (1..8). Bo trong = chinh minh.')
            return 2
        # --for N
        so = None
        if '--for' in args:
            k = args.index('--for')
            if k + 1 >= len(args):
                print('--for can so 1..8')
                return 2
            try:
                so = int(args[k + 1])
            except ValueError:
                print('--for phai la so 1..8, nhan %r' % args[k + 1])
                return 2
            if not (1 <= so <= 8):
                print('--for phai 1..8')
                return 2
        return do_grant(h, base, rest[0].upper(), rest[1], dry_run, gate, so)
    except GrantError as e:
        print()
        print('=' * 70)
        print('TU CHOI: %s' % e)
        print('=' * 70)
        print('Khong co gi duoc ghi vao hoac goi trong process.')
        return 3
    finally:
        k32.CloseHandle(h)


if __name__ == '__main__':
    try:
        _rc = main()
    except SystemExit:
        raise
    except BaseException as _e:
        print()
        print('=' * 70)
        print('LOI KHONG MONG DOI: %s: %s' % (type(_e).__name__, _e))
        print('=' * 70)
        import traceback
        traceback.print_exc()
        try:
            input('\nEnter de thoat...')
        except Exception:
            pass
        _rc = 9
    # Neu ket thuc bang loi (khac 0) va dang chay tu console that -> giu cua so
    if _rc not in (0, None) and sys.stdin and sys.stdin.isatty():
        try:
            input('\n[exit code %s] Enter de thoat...' % _rc)
        except Exception:
            pass
    sys.exit(_rc)
