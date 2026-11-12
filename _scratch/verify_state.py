import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import xa_nofog_pro as P

tok = open('token.txt', 'r', encoding='utf-8').read().strip()

# Gia lap state da kich hoat (bo qua DPAPI that de test doc lap)
st = {'key': 'AOE1-TEST-KEY-0001', 'hwid': 'a'*32, 'xn_token': tok,
      'expires_at': 1893456000, 'activated_at': 1794000000,
      'plan': 'aoe1', 'grace_hours': 0, 'srv_ts': 1794000000}
r = P._load_sites(st, verbose=True)
print('load_sites ->', r)
print('so cong  ->', len(P.SITES.all()))
print('nhom     ->', [(g, len(v)) for g, v in P.SITES.groups()])
print('mac dinh ->', len(P.SITES.default()), [s[0] for s in P.SITES.default()])
print('full     ->', len(P.SITES.full()))
print()
print('--- _anchor_salt() ---')
print(' ', P._anchor_salt())
assert P._anchor_salt() == b'xanf-anchor-v1', 'SALT DOI -> moc cu se khong doc duoc!'
print('  khop gia tri cu: OK')
print()
print('--- T1 trong bang giai ma ---')
t1 = [s for s in P.SITES.all() if s[0] == 'T1'][0]
print(' ', hex(t1[1]), t1[2], '->', t1[3])
assert t1[1] == 0x514E0F and t1[2] == '85d17407' and t1[3] == '90909090', t1
print('  dung gia tri goc: OK')
