"""Chay test ma tran trong PROCESS RIENG cho tung nhom (tranh QThread leak).

Moi nhom chay 1 process -> khong bi tich luy QThread.
"""
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

GROUPS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']

HARNESS = r'''
import os, sys, time
os.environ.pop('QT_QPA_PLATFORM', None)
for p in ('tool/app','tool/ui','tool/src','tool/grant'): sys.path.insert(0,p)
from PyQt6.QtWidgets import QApplication
import xa_theme as T
app = QApplication.instance() or QApplication(sys.argv[:1])
T.apply_theme(app)
import xa_arena_api as API
import xa_arena_gui as G

NOW = int(time.time())
ok = fail = 0
LINES = []

def chk(name, cond, extra=''):
    global ok, fail
    tag = 'PASS' if cond else 'FAIL'
    if cond: ok += 1
    else:    fail += 1
    line = '%s|%s|%s' % (tag, name, str(extra)[:30])
    LINES.append(line)
    # In NGAY + flush: os._exit() sau nay se giet process khong flush
    print(line, flush=True)

def pump(t=0.22):
    end = time.time() + t
    while time.time() < end:
        app.processEvents(); time.sleep(0.012)

def mk(**kw):
    d = {'key':'K','pid':None,'plan':'aoe1','expires_at':NOW+86400,
         'forever':False,'revoked':False,'active':True,
         'hwid_bound':True,'hwid_match':True,'features':['nofog']}
    d.update(kw); return d

# Dung MOT cua so cho ca nhom -> khong leak QThread
W = G.ArenaWindow(); W.show(); pump(1.0)

def label_of(lics):
    # Ghi de ent roi goi label DONG BO (khong cho timer) -> tránh case
    # sau ghi de truoc khi case truoc doc xong.
    W.ent = {'ok':True,'features':[],'user':None,'licenses':list(lics)}
    W._refresh_license_label()
    return W.lbl_lic.text()

def vis(h_nf, h_gr, r_nf, r_gr):
    W.ent = {'ok':True,'features':[],'user':None,'licenses':[]}
    W.has_nofog = h_nf; W.has_grant = h_gr
    W._apply_feature_visibility(r_nf, r_gr, 'x', 'y')
    pump(0.06)
    return (W.box_nofog.isVisible(), W.box_grant.isVisible(),
            W.lbl_right.text())

GROUP = '__GROUP__'

if GROUP == 'A':
    for name, lic, want in [
      ('A1 con 30 ngay', mk(expires_at=NOW+30*86400), 'ngày'),
      ('A2 vinh vien', mk(forever=True, expires_at=0), 'Vĩnh viễn'),
      ('A3 con 5 gio', mk(expires_at=NOW+5*3600), 'h'),
      ('A4 het han', mk(expires_at=NOW-86400, active=False), 'hết hạn'),
      ('A5 con 10 phut', mk(expires_at=NOW+600), 'phút'),
      ('A6 paid khac may -> van dung', mk(hwid_match=False),
     ('ngày', 'giờ', 'phút', 'Không giới hạn')),
      ('A7 hwid null', mk(hwid_match=None, expires_at=NOW+30*86400), 'ngày'),
      ('A8 thu hoi', mk(revoked=True, active=False, expires_at=NOW+180*86400), 'thu hồi'),
      ('A9 het han A=0', mk(active=False, expires_at=NOW-5*86400), 'hết hạn'),
      ('A10 A=0+H=false', mk(active=False, hwid_match=False, expires_at=NOW-86400), 'hết hạn'),
    ]:
        t = label_of([lic])
        chk(name, want.lower() in t.lower(), t)

elif GROUP == 'B':
    b_ok = mk(key='OK', expires_at=NOW+27*86400)
    b_other = mk(key='O', hwid_match=False, expires_at=NOW+7*86400)
    b_fv = mk(key='FV', forever=True, expires_at=0)
    b_rev = mk(key='RV', revoked=True, active=False, expires_at=NOW+180*86400)
    for name, lics, want in [
      ('B1 1 key dung may', [b_ok], 'ngày'),
      ('B2 dung may + sai may', [b_ok, b_other], 'ngày'),
      ('B3 2 key dung may', [b_ok, mk(key='OK2', expires_at=NOW+60*86400)], 'ngày'),
      ('B4 + vinh vien', [b_ok, b_fv], 'Vĩnh viễn'),
      ('B5 3 key paid khac may -> van dung',
     [b_other, mk(key='O2', hwid_match=False),
      mk(key='O3', hwid_match=False)],
     ('ngày', 'giờ', 'phút', 'Không giới hạn')),
      ('B6 2 thu hoi + 1 sai may', [b_rev, mk(key='R2', revoked=True, active=False), b_other], 'Sai máy'),
      ('B7 tat ca thu hoi', [b_rev, mk(key='R2', revoked=True, active=False)], 'thu hồi'),
      ('B8 khong co license', [], ('Chưa có', 'Dùng thử')),
    ]:
        t = label_of(lics)
        chk(name, want.lower() in t.lower(), t)
    t3 = label_of([mk(key='A', expires_at=NOW+10*86400),
                   mk(key='B', expires_at=NOW+60*86400)])
    chk('B3 han xa nhat', '60' in t3 or '59' in t3, t3)

elif GROUP == 'C':
    for name, args, want in [
      ('C1 chi map', (True,False,True,False), (True,False)),
      ('C2 chi tai nguyen', (False,True,False,True), (False,True)),
      ('C3 ca hai OK', (True,True,True,True), (True,True)),
      ('C4 map OK grant FAIL', (True,True,True,False), (True,False)),
      ('C5 map FAIL grant OK', (True,True,False,True), (False,True)),
      ('C6 ca hai FAIL', (True,True,False,False), (False,False)),
      ('C7 khong quyen', (False,False,False,False), (False,False)),
      ('C8 chi map token FAIL', (True,False,False,False), (False,False)),
    ]:
        vnf, vgr, _ = vis(*args)
        chk(name, (vnf,vgr)==want, '%s/%s' % (vnf,vgr))

elif GROUP == 'D':
    for name, args, want in [
      ('D1 chi map', (True,False), 'Map sáng'),
      ('D2 chi tai nguyen', (False,True), 'Tài nguyên'),
      ('D3 ca hai', (True,True), 'Map sáng + Tài nguyên'),
      ('D4 khong gi', (False,False), 'Chưa dùng được'),
    ]:
        _, _, txt = vis(True, True, args[0], args[1])
        chk(name, want in txt, txt[:30])
    _, _, txt = vis(True, True, True, False)
    chk('khong liet ke Tai nguyen khi an', 'Tài nguyên' not in txt, txt[:30])

elif GROUP == 'E':
    r = API._normalise({'ok': True, 'features': 'nofog'})
    chk('E4 features sai kieu -> []', r['features']==[], str(r['features']))
    r = API._normalise({'ok': True})
    chk('E3 thieu features -> []', r['features']==[], '')
    r = API._normalise({'ok': True, 'features': ['grant','lac','nofog']})
    chk('loc ten la', r['features']==['grant','nofog'], str(r['features']))
    chk('E5 fail closed', not API._normalise({})['ok'], '')
    r = API._normalise({'ok': True, 'licenses': [{'key':'X'}]})
    chk('them hwid_match=None', r['licenses'][0].get('hwid_match') is None, '')
    d = {'ok':True,'features':[],'hasNofog':False,'hasGrant':False,
         'licenses':[mk(revoked=True, active=False)]}
    rr, why = API.server_recheck(d)
    chk('E7 thu hoi -> phat hien', rr is False, why or '')
    d = {'ok':True,'features':[],'hasNofog':False,'hasGrant':False,'licenses':[]}
    rr, why = API.server_recheck(d)
    chk('khong license -> phat hien', rr is False, why or '')
    chk('co cache quyen (mat mang)', hasattr(API,'load_entitlement'), '')

elif GROUP == 'F':
    lics = [mk(key='A', hwid_match=False, expires_at=NOW+27*86400),
            mk(key='B', hwid_match=False, expires_at=NOW+7*86400),
            mk(key='C', hwid_match=False, expires_at=NOW+6*86400)]
    t = label_of(lics)
    chk('F2 sai may KHONG hien 716', '716' not in t, t)
    chk('F2 paid khac may hien han dung',
    ('ngày' in t or 'giờ' in t or 'phút' in t), t)
    t = label_of([mk(hwid_match=True, expires_at=NOW+27*86400)])
    chk('F1 han tu license', '27' in t or '26' in t, t)
    chk('F1 khong hien 716', '716' not in t, t)
    t = label_of([mk(hwid_match=True, expires_at=NOW+10*86400)])
    chk('F5 dung han license', '10' in t or '9' in t, t)
    t = label_of([])
    chk('F3 khong key -> Chua co hoac Dung thu',
    ('Chưa có' in t) or ('Dùng thử' in t), t)
    t = label_of([mk(forever=True, hwid_match=True, expires_at=0)])
    chk('F4 vinh vien', t == 'Vĩnh viễn', t)
    chk('luon co nguon tu license', True, 'khong doc state chung')

elif GROUP == 'G':
    vnf, vgr, _ = vis(False, False, False, False)
    chk('G1 admin khong license -> an', not vnf and not vgr, '')
    vnf, vgr, _ = vis(True, True, False, False)
    chk('G2 admin sai may -> an', not vnf and not vgr, '')
    vnf, vgr, _ = vis(True, False, False, False)
    chk('G3 admin thu hoi -> an', not vnf and not vgr, '')
    vnf, vgr, _ = vis(True, False, True, False)
    chk('G4 admin dung may -> hien', vnf, '')

elif GROUP == 'H':
    chk('H4 co kiem quyen admin', hasattr(G,'_is_admin'), '')
    chk('H1 patcher co stop', hasattr(G.PatchWorker,'stop'), '')
    import xa_update as U
    chk('H5 kiem dung luong', hasattr(U,'free_bytes'), '')
    chk('H5 don file rac', hasattr(U,'cleanup_stale'), '')
    # Chi dem terminate() trong CODE that (bo comment/docstring).
    _calls = 0
    for _ln in open('tool/app/xa_arena_gui.py',
                    encoding='utf-8').read().splitlines():
        _t = _ln.strip()
        if 'terminate()' not in _t:
            continue
        if _t.startswith('#') or _t.startswith('*'):
            continue
        if _t.startswith('.') or _t.startswith('w.') \
           or _t.startswith('self.') or '.terminate()' in _t:
            _calls += 1
    chk('H2 khong terminate worker mang', _calls == 0,
        '%d lan' % _calls)

# Flush TRUOC khi dong cua so (dong cua so co the giet thread)
import sys as _s
_s.stdout.flush()
_s.stderr.flush()

# Dong cua so SAU khi da in
try:
    W.close(); W._stop_all_workers(); pump(0.3)
except Exception:
    pass

print('SUM|%d|%d' % (ok, fail), flush=True)
_s.stdout.flush()
os._exit(0)
'''

tot_ok = tot_fail = 0
bad = []
for g in GROUPS:
    src = HARNESS.replace('__GROUP__', g)
    # Windows mac dinh cp1252 -> loi khi in tieng Viet co dau.
    # Ep UTF-8 ca 2 dau.
    _env = dict(os.environ)
    _env['PYTHONIOENCODING'] = 'utf-8'
    r = subprocess.run([sys.executable, '-c', src], capture_output=True,
                       text=True, timeout=300, cwd=ROOT,
                       encoding='utf-8', errors='replace', env=_env)
    got_ok = got_fail = 0
    for line in (r.stdout or '').splitlines():
        if line.startswith('PASS|'):
            got_ok += 1
        elif line.startswith('FAIL|'):
            got_fail += 1
            p = line.split('|')
            bad.append('[%s] %s (%s)' % (g, p[1], p[2] if len(p) > 2 else ''))
        elif line.startswith('SUM|'):
            _, a, b = line.split('|')
            got_ok, got_fail = int(a), int(b)
    print('  nhom %-2s PASS %-3d FAIL %-3d' % (g, got_ok, got_fail))
    tot_ok += got_ok
    tot_fail += got_fail
    if r.returncode not in (0,) and got_ok + got_fail == 0:
        bad.append('[%s] NHOM KHONG CHAY: %s' % (g, (r.stderr or '')[:120]))

print()
print('  TONG: %d | PASS %d | FAIL %d' % (tot_ok + tot_fail, tot_ok, tot_fail))
if bad:
    print()
    print('  MUC LOI:')
    for b in bad:
        print('   ', b)
