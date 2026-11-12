# -*- coding: utf-8 -*-
r"""patch_client.py -- ap ban va bao mat vao xa_nofog_pro.py.

Dung o BUILD-TIME / dev-time, KHONG phai script cua nguoi dung cuoi.

    python tool/src/patch_client.py path\to\xa_nofog_pro.py

Muc dich: chuyen bang cong khoi binary sang token da ky.

  TRUOC: 17 cong (dia chi + byte) nam thang trong file -> mo hex editor la thay,
         PyInstaller cu bi lay source -> doc duoc het.
  SAU  : khong con 1 cong nao trong file. Bang den tu token da ky ECDSA, giai
         ma bang `gate` cua tung license. Khong token -> khong biet va vao dau.

Script nay thay tung khoi van ban (khong ghi de ca file) nen giu nguyen moi
thay doi khac trong file, ke ca cac phan khong lien quan.

Script nay PHAI giu lai mau cu (o phan `old`) vi no can tim dung khoi de thay.
Ban than script nay KHONG duoc dong goi vao EXE.
"""
import io
import os
import sys

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

# ---------------------------------------------------------------------------
# Cac cap (tim, thay). Moi cap phai xuat hien DUNG 1 lan trong file.
# ---------------------------------------------------------------------------

EDITS = []


def E(name, old, new):
    EDITS.append((name, old, new))


# --- 1. nap module bao mat ---------------------------------------------------
E('import-security',
  """import urllib.error
import urllib.request
""",
  """import urllib.error
import urllib.request

# ---------------------------------------------------------------------------
# TANG BAO MAT -- bang cong No Fog KHONG con trong file nay.
#
# Truoc day 17 cong (MINIMAP/CORE/LEGACY: dia chi + byte goc + byte va) nam
# thang trong file. Chi can mo EXE bang hex editor, hoac lay lai source tu ban
# PyInstaller cu, la biet chinh xac tool va byte nao vao dia chi nao.
#
# Nay bang do chi ton tai duoi dang CIPHERTEXT trong token da ky ECDSA P-256
# cua server (xem xa_nofog_sec.py + src/routes/license-server.js). Khoa giai
# ma (`gate`) chi co trong payload da ky, sinh rieng cho tung license.
#
# He qua: khong co token hop le -> khong co bang -> tool khong biet va vao dau.
# Patch "bo kiem tra license" cung vo dung: cai bi thieu la DU LIEU, khong
# phai mot dieu kien `if` co the xoa.
# ---------------------------------------------------------------------------
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import xa_nofog_sec as NF                        # noqa: E402
""")

# --- 2. hang so nhay cam lay tu blob da ma hoa -------------------------------
E('api-base',
  """API_BASE = str(_c('API_BASE', 'https://xienhl.com')).rstrip('/')""",
  """# Gia tri mac dinh lay tu blob da XOR (xa_nofog_const.py) -> `strings` tren
# EXE khong thay URL. Van uu tien bien moi truong / xa_config.py nhu cu.
API_BASE = str(_c('API_BASE', NF.C(NF.K_API_BASE))).rstrip('/')""")

E('app-name',
  """APP_NAME = str(_c('APP_NAME', 'XARENA MAP SÁNG'))""",
  """APP_NAME = str(_c('APP_NAME', NF.C(NF.K_APP_NAME)))""")

E('process-names',
  """PROCESS_NAMES = tuple(_c('PROCESS_NAMES', ('EMPIRESX.EXE', 'EMPIRESX_HD.EXE', 'EMPIRESX_HDR.EXE')))""",
  """# Ten process game cung nam trong blob: khong de lo "EMPIRESX.EXE" trong EXE.
PROCESS_NAMES = tuple(_c(
    'PROCESS_NAMES',
    tuple(x for x in NF.C(NF.K_PROCESS).split('|') if x)))""")

E('mutex-name',
  """MUTEX_NAME = str(_c('MUTEX_NAME', r'Global\\XArenaNoFogPro'))""",
  """MUTEX_NAME = str(_c('MUTEX_NAME', NF.C(NF.K_MUTEX)))""")

E('reg-key',
  """REG_KEY = str(_c('REG_KEY', r'Software\\Microsoft\\Windows\\CurrentVersion\\XASupport'))""",
  """REG_KEY = str(_c('REG_KEY', NF.C(NF.K_REG_KEY)))""")

E('buy-url',
  """BUY_URL = str(_c('BUY_URL', 'https://xienhl.com/#/product/license-xarena-thang'))""",
  """BUY_URL = str(_c('BUY_URL', NF.C(NF.K_BUY_URL)))""")

E('register-url',
  """REGISTER_URL = str(_c('REGISTER_URL', 'https://xienhl.com/#/register'))""",
  """REGISTER_URL = str(_c('REGISTER_URL', NF.C(NF.K_REGISTER_URL)))""")

# --- 3. anchor salt ----------------------------------------------------------
E('anchor-salt',
  """_ANCHOR_SALT = b'xanf-anchor-v1'""",
  """def _anchor_salt():
    \"\"\"Muoi MAC cho moc thoi gian, lay tu blob da ma hoa.

    Gia tri KHONG doi (van la 'xanf-anchor-v1'): doi no se lam moi moc da ghi
    tren may khach thanh khong doc duoc -> mat kha nang phat hien lui dong ho.
    Chi khac la nay no khong con lo dang chuoi trong EXE.
    \"\"\"
    return (NF.C(NF.K_ANCHOR_SALT) or 'xanf-anchor-v1').encode('utf-8')""")

E('anchor-read',
  """        n = len(_ANCHOR_SALT)
        if len(raw) < n + 32 or raw[:n] != _ANCHOR_SALT:
            return 0
        body = raw[n:]
        mac = hashlib.sha256(_ANCHOR_SALT + body[:-32]).digest()""",
  """        salt = _anchor_salt()
        n = len(salt)
        if len(raw) < n + 32 or raw[:n] != salt:
            return 0
        body = raw[n:]
        mac = hashlib.sha256(salt + body[:-32]).digest()""")

E('anchor-write',
  """        body = str(int(value)).encode('ascii')
        mac = hashlib.sha256(_ANCHOR_SALT + body).digest()
        tmp = path + '.tmp'
        with open(tmp, 'wb') as f:
            f.write(_ANCHOR_SALT + body + mac)""",
  """        salt = _anchor_salt()
        body = str(int(value)).encode('ascii')
        mac = hashlib.sha256(salt + body).digest()
        tmp = path + '.tmp'
        with open(tmp, 'wb') as f:
            f.write(salt + body + mac)""")

# --- 4. XOA bang cong khoi binary -------------------------------------------
E('site-table',
  """# --- bang cong ---------------------------------------------------------------
MINIMAP = [
    ('A', 0x42D521, '8a83b88d0000', 'b00190909090'),
    ('B', 0x42D547, '0f84e2030000', '909090909090'),
    ('C', 0x42DC63, '8a85b88d0000', 'b00190909090'),
    ('D', 0x42DC6D, '8a95b98d0000', 'b20190909090'),
    ('E', 0x42DCA9, '8a85b98d0000', 'b00190909090'),
    ('M', 0x42DC93, 'b180',         'b10f'),
    ('N', 0x42DCA7, 'b180',         'b10f'),
]
CORE = [
    ('T1', 0x514E0F, '85d17407',   '90909090'),
    ('V3', 0x514F58, '7404',       'eb43'),
    ('V6', 0x516590, '518b442408', '33c0c21400'),
]
LEGACY = [
    ('F',  0x513DF8, '8a81b88d0000', 'b00190909090'),
    ('I',  0x51C631, '8a81b88d0000', 'b00190909090'),
    ('J',  0x51C6B8, '8a81b88d0000', 'b00190909090'),
    ('K',  0x51D28E, '8a82b88d0000', 'b00190909090'),
    ('L',  0x51D3D7, '8a82b88d0000', 'b00190909090'),
    # O: 0x51FC6F la GIUA LENH -- `b2 80` o do la 2 byte cuoi cua
    # `8b 04 b2  mov eax,[edx+esi*4]` tai 0x51FC6D (xac nhan bang recursive
    # descent tu prologue 0x51FA40: 0x51FC6F KHONG phai ranh gioi lenh).
    # Va vao do ghi de giua lenh -> vmread -> #UD.
    # Dia chi dung la 0x529BEA (entry ham 0x529BE0, co 2 call site:
    # 0x529BD1 va 0x52EB01). Do la `mov dl,0x80` that su.
    ('O',  0x529BEA, 'b280',         'b20f'),
    ('T2', 0x514EFF, '0f853c010000', '909090909090'),
]
BASE = CORE + MINIMAP
DEFAULT = BASE
ALL_SITES = CORE + MINIMAP + LEGACY
GROUPS = (('viewport', CORE), ('minimap', MINIMAP), ('legacy', LEGACY))


def _validate():
    keys = [s[0] for s in ALL_SITES]
    if len(keys) != len(set(keys)):
        raise SystemExit('trung key')
    addrs = [s[1] for s in ALL_SITES]
    if len(addrs) != len(set(addrs)):
        raise SystemExit('trung dia chi')
    for k, va, o, p in ALL_SITES:
        if len(bytes.fromhex(o)) != len(bytes.fromhex(p)):
            raise SystemExit('cong %s: do dai khac nhau' % k)


_validate()""",
  """# --- bang cong ---------------------------------------------------------------
#
# KHONG CON MOT CONG NAO O DAY.
#
# Truoc day khoi nay chua 17 dong: moi dong la (ten, dia chi VA, byte goc,
# byte da). Chi can `strings` hoac mo EXE bang hex editor la biet chinh xac
# tool va byte nao vao dia chi nao -- va do chinh la toan bo gia tri cua tool.
#
# KHONG dat vi du byte that trong comment: comment CUNG nam trong binary.
#
# Nay bang do den tu token da ky:
#
#     /api/activate hoac /api/check  ->  {token: "xn1.<payload>.<sig>"}
#     NF.verify_token_local(token)    ->  chi khi chu ky ECDSA hop le
#     SITES                           ->  SiteTable (xem _load_sites)
#
# `SITES` la None cho toi khi nap xong. Moi ham dung no deu phai kiem
# `_require_sites()` truoc -> fail closed, KHONG bao gio va bua.
# ---------------------------------------------------------------------------

SITES = None            # kieu xa_nofog_sec.SiteTable, nap boi _load_sites()


class SitesUnavailable(Exception):
    \"\"\"Chua nap duoc bang cong. KHONG duoc cham vao process game.\"\"\"


def _require_sites():
    \"\"\"Tra bang cong da giai ma. Nem SitesUnavailable neu chua co.\"\"\"
    if SITES is None:
        raise SitesUnavailable(
            'chua co bang cong. Tool can token hop le tu server de biet '
            'va vao dau (chay lai de kich hoat).')
    return SITES


def _load_sites(st=None, verbose=False):
    \"\"\"Xac minh token trong state va nap bang cong.

    Tra (ok: bool, msg: str). KHONG BAO GIO nem ra ngoai.

    Thu tu kiem (giong het xa_sec.py, khong duoc dao):
      1. Chu ky ECDSA tren token  -- sai thi dung han
      2. `payload.a` phai la 'xa-nofog'
      3. Giai ma khoi bang cong bang `gate` trong payload
    \"\"\"
    global SITES

    if st is None:
        st = load_state()
    tok = (st or {}).get('xn_token') or ''

    r = NF.verify_token_local(tok, app='xa-nofog')
    if not r.get('ok'):
        SITES = None
        return False, r.get('msg') or ('loi token: %s' % r.get('code'))

    SITES = r['sites']
    if verbose:
        print('  bang cong: %d cong (gate %s...)'
              % (r['count'], (r.get('gate') or '')[:8]))
    return True, 'ok'


def _need_sites_msg():
    \"\"\"Thong bao khi thieu bang cong. Tra chuoi nhieu dong.\"\"\"
    return (
        'KHONG CO BANG CONG -- tool khong biet va vao dau.\\n'
        '\\n'
        '  Bang cong (dia chi + byte) khong con nam trong file EXE. No duoc\\n'
        '  server ky va ma hoa theo tung license, chi giai ma duoc khi token\\n'
        '  trong may con hop le.\\n'
        '\\n'
        '  Cach xu ly:\\n'
        '    1. Chay lai tool (khong tham so) de lay token moi tu server\\n'
        '    2. Neu van loi: kich hoat lai bang  xa_nofog_pro.exe --key <MA>\\n'
        '    3. Neu server chua cap nhat: tai ban EXE moi nhat')""")

# --- 5. patch(): kiem bang cong ---------------------------------------------
E('patch-guard',
  """def patch(h, base, site, restore=False):
    key, va, orig_s, pat_s = site""",
  """def patch(h, base, site, restore=False):
    # Bang cong phai duoc nap TU TOKEN truoc khi ghi bat cu byte nao.
    # Thieu bang => khong biet dia chi/byte => ghi bua se lam crash game.
    _require_sites()
    key, va, orig_s, pat_s = site""")

# --- 6. list_sites(): in tu bang da giai ma ---------------------------------
E('list-sites',
  """def list_sites():
    for name, group in GROUPS:
        print('[%s]' % name)
        for key, va, o, p in group:
            print('  %-3s 0x%08X  %s -> %s' % (key, va, o, p))""",
  """def list_sites():
    \"\"\"In bang cong DA GIAI MA tu token trong state.

    Khong can admin, khong can game -- chi can da kich hoạt mot lan.
    Day cung la phep thu chung minh chu ky + giai ma chay dung.
    \"\"\"
    ok, msg = _load_sites()
    if not ok:
        print('')
        print('  [!] Khong nap duoc bang cong.')
        print('')
        for line in _need_sites_msg().split('\\n'):
            print('  ' + line)
        if msg and msg != 'no_token':
            print('')
            print('  chi tiet: %s' % msg)
        return False

    t = SITES
    print('  bang cong: %d cong, %d nhom'
          % (len(t.all()), len(t.groups())))
    for name, group in t.groups():
        print('[%s]' % name)
        for key, va, o, p in group:
            print('  %-3s 0x%08X  %s -> %s' % (key, va, o, p))
    return True""")

# --- 7. pick_sites(): dung bang da giai ma ----------------------------------
E('pick-sites',
  """def pick_sites(opts):
    if opts['full']:
        return BASE + LEGACY, 'viewport+minimap+legacy'
    return DEFAULT, 'viewport+minimap'""",
  """def pick_sites(opts):
    \"\"\"Chon cong can va, tu bang DA GIAI MA (khong con hang so trong file).\"\"\"
    t = _require_sites()
    if opts['full']:
        return t.full(), 'viewport+minimap+legacy'
    return t.default(), 'viewport+minimap'""")

# --- 8. luu token khi kich hoat ---------------------------------------------
E('activate-save-token',
  """    st = load_state()
    anchor_server_time(st, r.get('now'))
    st.update({
        'key': key.strip().upper(),
        'hwid': hwid,
        'expires_at': r.get('expires_at', 0),
        'activated_at': r.get('activated_at', 0),""",
  """    tok = r.get('token') or ''
    if not tok:
        # Server CU (chua trien khai ban ky) tra ve khong co token.
        return False, (
            'server khong tra token bao ve ban quyen.\\n'
            '  Ban dang chay phien ban cu, hoac server chua cap nhat.\\n'
            '  Tai ban moi nhat roi thu lai.')
    # Xac minh NGAY tai cho, truoc khi luu: token hong ma luu vao state thi
    # lan chay sau se chet voi loi kho hieu.
    _vr = NF.verify_token_local(tok, app='xa-nofog')
    if not _vr.get('ok'):
        return False, ('token server tra ve KHONG hop le (%s).\\n  %s'
                       % (_vr.get('code'), _vr.get('msg') or ''))

    st = load_state()
    anchor_server_time(st, r.get('now'))
    st.update({
        'key': key.strip().upper(),
        'hwid': hwid,
        'xn_token': tok,
        'expires_at': r.get('expires_at', 0),
        'activated_at': r.get('activated_at', 0),""")

# --- 9. check_online(): luu token moi ---------------------------------------
E('check-save-token',
  """    anchor_server_time(st, r.get('now'))
    st.update({
        'expires_at': r.get('expires_at', 0),
        'activated_at': r.get('activated_at', 0),
        'plan': r.get('plan'),
        'grace_hours': r.get('grace_hours', 0),   # BAT BUOC ONLINE: khong offline grace
        'last_ok': time.time(),
        'mono_last_ok': _mono(),
    })
    save_state(st)
    return True, 'ok'""",
  """    anchor_server_time(st, r.get('now'))
    st.update({
        'expires_at': r.get('expires_at', 0),
        'activated_at': r.get('activated_at', 0),
        'plan': r.get('plan'),
        'grace_hours': r.get('grace_hours', 0),   # BAT BUOC ONLINE: khong offline grace
        'last_ok': time.time(),
        'mono_last_ok': _mono(),
    })
    # Token moi moi lan check: bang cong luon khop phien ban server hien tai,
    # va goi tin bat duoc KHONG phat lai duoc.
    tok = r.get('token') or ''
    if tok and NF.verify_token_local(tok, app='xa-nofog').get('ok'):
        st['xn_token'] = tok
    save_state(st)
    # Nap bang cong ngay, khong doi vong sau.
    if not _load_sites(st)[0]:
        return False, 'code:token_invalid|token bao ve ban quyen khong hop le'
    return True, 'ok'""")

# --- 10. require_license(): nap bang cong truoc khi tra True ----------------
E('require-license-load',
  """    ok, msg = check_online(st, verbose=False)

    if ok:
        # Server xac nhan -> con han
        return True, 'ok'""",
  """    ok, msg = check_online(st, verbose=False)

    if ok:
        # Server xac nhan -> con han.
        # Phai nap duoc bang cong TRUOC khi bao "chay duoc": khong co bang thi
        # tool khong biet va vao dau, chay tiep chi to thoi gian cua khach.
        sok, smsg = _load_sites(st)
        if not sok:
            return False, 'thieu bang cong (%s)' % (smsg or 'token khong hop le')
        return True, 'ok'""")

# --- 15. docstring: bo dia chi cong khoi comment ----------------------------
# Comment CUNG nam trong binary. De nguyen 0x514E0F / 0x514F58 / 0x516590 o
# day la tu minh lo dung 3 dia chi quan trong nhat.
E('docstring-nofog',
  """17 cong, chia 3 nhom: viewport (T1 V3 V6), minimap (A B C D E M N),
legacy (F I J K L O T2). Tat ca chi sua DUONG VE, khong sua LOGIC.

--- Ba cong toi thieu ---
T1  0x514E0F  nop je          -> terrain sang toan map
V3  0x514F58  je -> jmp       -> bo grid kim cuong mo
V6  0x516590  stub ham ve fog -> khong con gi de ve

--- Vi sao V4/V5 bi loai ---""",
  """17 cong, chia 3 nhom: viewport (T1 V3 V6), minimap (A B C D E M N),
legacy (F I J K L O T2). Tat ca chi sua DUONG VE, khong sua LOGIC.

DIA CHI VA BYTE CUA 17 CONG KHONG CON TRONG FILE NAY. Chung den tu token da
ky cua server (xem xa_nofog_sec.py). Khong co token hop le thi tool khong biet
va vao dau -- do la muc dich cua thiet ke, khong phai loi.

--- Ba cong toi thieu ---
T1  nop je          -> terrain sang toan map
V3  je -> jmp       -> bo grid kim cuong mo
V6  stub ham ve fog -> khong con gi de ve

--- Vi sao V4/V5 bi loai ---""")

# --- 16. run-list tra ma loi khi khong co bang cong -------------------------
E('run-list',
  """    if opts['list']:
        list_sites()
        return 0""",
  """    if opts['list']:
        return 0 if list_sites() else EXIT_NO_LICENSE""")

# --- 12. --off duoc tra goc ke ca khi khong co token ------------------------
E('run-restore-sites',
  """    if opts['restore']:
        sites, label = ALL_SITES, 'all'
    else:
        sites, label = pick_sites(opts)""",
  """    # --off: tra byte goc phai LUON lam duoc (khong the bat khach co license
    # chi de go tool ra khoi game). Nhung van can bang cong de biet dia chi.
    # Khong co bang -> khong biet tra o dau -> bao ro, khong crash.
    if opts['restore']:
        try:
            sites, label = _require_sites().full(), 'all'
        except SitesUnavailable:
            print('')
            for line in _need_sites_msg().split('\\n'):
                print('  ' + line)
            return EXIT_NO_LICENSE
    else:
        sites, label = pick_sites(opts)""")

# --- 13. --dump: in tu bang da giai ma -------------------------------------
E('run-dump',
  """            if opts['dump']:
                for gname, group in GROUPS:
                    print(' [%s]' % gname)
                    dump_state(h, base, group)
                kernel32.CloseHandle(h)
                return 0""",
  """            if opts['dump']:
                for gname, group in _require_sites().groups():
                    print(' [%s]' % gname)
                    dump_state(h, base, group)
                kernel32.CloseHandle(h)
                return 0""")

# --- 14. --deactivate xoa ca token -----------------------------------------
E('deactivate-token',
  """            existed = os.path.exists(STATE_FILE)
            if existed:
                kernel32.SetFileAttributesW(STATE_FILE, 0x80)
                os.remove(STATE_FILE)""",
  """            existed = os.path.exists(STATE_FILE)
            if existed:
                kernel32.SetFileAttributesW(STATE_FILE, 0x80)
                os.remove(STATE_FILE)
            # Token nam trong lic.bin nen da bi xoa cung. Xoa them ban sao
            # trong ProgramData (--install chep license sang do).
            try:
                pd = _pd_path('license.dat') if '_pd_path' in globals() else ''
                if pd and os.path.exists(pd):
                    kernel32.SetFileAttributesW(pd, 0x80)
                    os.remove(pd)
            except Exception:
                pass""")


def apply(path, verbose=True):
    """Tra (src, out) hoac ma loi (int)."""
    if not os.path.exists(path):
        raise SystemExit('khong thay %s' % path)
    with io.open(path, 'r', encoding='utf-8', newline='') as f:
        src = f.read()

    # File co the dung CRLF (Windows) hoac LF. Mau trong script viet bang LF,
    # nen doi het sang kieu cua file TRUOC khi so khop -- neu khong, moi mau
    # nhieu dong deu "khong tim thay" tren file CRLF.
    nl = '\r\n' if '\r\n' in src else '\n'

    def norm(s):
        return s.replace('\r\n', '\n').replace('\n', nl)

    bad = []
    for name, old, new in EDITS:
        n = src.count(norm(old))
        if n != 1:
            bad.append('%-22s xuat hien %d lan (can dung 1)' % (name, n))
    if bad:
        print('KHONG THE VA -- cac mau khong khop:')
        for b in bad:
            print('  ' + b)
        print('')
        print('Nguyen nhan thuong gap: file da duoc sua boi phien ban khac.')
        return 1

    out = src
    for name, old, new in EDITS:
        out = out.replace(norm(old), norm(new), 1)
    return src, out


def main():
    argv = [a for a in sys.argv[1:] if not a.startswith('--')]
    want_write = '--write' in sys.argv[1:]
    if len(argv) != 1:
        print(__doc__)
        return 2
    path = argv[0]
    r = apply(path)
    if isinstance(r, int):
        return r
    src, out = r

    print('Se sua %s' % path)
    print('  %d -> %d byte (%+d)'
          % (len(src), len(out), len(out) - len(src)))
    print('')
    for name, old, new in EDITS:
        print('  OK  %-22s %5d -> %5d' % (name, len(old), len(new)))

    if want_write:
        bak = path + '.bak'
        with io.open(bak, 'w', encoding='utf-8', newline='') as f:
            f.write(src)
        with io.open(path, 'w', encoding='utf-8', newline='') as f:
            f.write(out)
        print('\nDa ghi. Ban cu: %s' % bak)
    else:
        print('\nChua ghi. Them --write de ap dung.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
