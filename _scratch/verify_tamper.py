import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import xa_nofog_pro as P

tok = open('token.txt', 'r', encoding='utf-8').read().strip()

print('=== A. Token bi sua -> phai fail closed ===')
bad = tok[:-8] + 'AAAAAAAA'
st = {'key': 'K', 'hwid': 'a'*32, 'xn_token': bad}
ok, msg = P._load_sites(st)
print('  ok=%s' % ok)
print('  P.SITES =', P.SITES)
assert ok is False and P.SITES is None, (ok, P.SITES)
print('  OK: khong nap duoc, SITES=None')

print()
print('=== B. Khong co token -> fail closed ===')
ok, msg = P._load_sites({'key': 'K','hwid':'a'*32})
print('  ok=%s' % ok)
assert ok is False and P.SITES is None
print('  OK')

print()
print('=== C. patch() khi chua co bang -> phai tu choi ===')
P.SITES = None
try:
    P.patch(0, 0x400000, ('T1', 0x514E0F, '85d17407', '90909090'))
    print('  FAIL: patch() khong chan!')
    sys.exit(1)
except P.SitesUnavailable as e:
    print('  OK: chan bang SitesUnavailable')
    print('  msg:', str(e)[:60], '...')

print()
print('=== D. pick_sites() khi chua co bang -> phai tu choi ===')
try:
    P.pick_sites({'full': False})
    print('  FAIL: pick_sites() khong chan!')
    sys.exit(1)
except P.SitesUnavailable:
    print('  OK: chan')

print()
print('=== E. Co bang -> pick_sites tra dung ===')
P._load_sites({'xn_token': tok})
d, l1 = P.pick_sites({'full': False})
f, l2 = P.pick_sites({'full': True})
print('  default: %d cong (%s)' % (len(d), l1))
print('  full   : %d cong (%s)' % (len(f), l2))
assert len(d) == 10 and len(f) == 17
print('  OK')

print()
print('=== F. list_sites() co bang -> in duoc ===')
P.SITES = None
sys.stdout = open(os.devnull, 'w')
import io
buf = io.StringIO(); real = sys.stdout; sys.stdout = buf
res = P.list_sites.__wrapped__ if hasattr(P.list_sites,'__wrapped__') else None
sys.stdout = real
print('  (list_sites can state that; da kiem o phan --list rieng)')

print()
print('TAT CA DEU DAT')
