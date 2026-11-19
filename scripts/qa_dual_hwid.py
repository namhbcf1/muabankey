"""Test DUAL-HWID: client gui ca 2 HWID -> license cua ca 2 module deu khop.

Loi vua sua: hai module tinh HWID KHAC NHAU tren cung may.
  nofog: 775c3fd3...
  grant: d512bc5a...
Client chi gui mot cai -> nua so license bi coi la "sai may" -> mat quyen
-> khong cong duoc tai nguyen.

Nay client gui ?hwid=<nofog>&hwid2=<grant>, server khop MOT TRONG HAI.
"""
import sys

sys.path.insert(0, 'tool/app')
sys.path.insert(0, 'tool/ui')
sys.path.insert(0, 'tool/src')
sys.path.insert(0, 'tool/grant')

import xa_arena_api as API  # noqa: E402

ok = fail = 0


def chk(name, cond, extra=''):
    global ok, fail
    if cond:
        ok += 1
        print('  PASS  %-52s %s' % (name, extra))
    else:
        fail += 1
        print('  FAIL  %-52s %s' % (name, extra))


hw_n = API._hwid_for('nofog')
hw_g = API._hwid_for('grant')

print('=== 0. HAI MODULE TINH HWID KHAC NHAU (nguyen nhan goc) ===')
print('  nofog:', hw_n)
print('  grant:', hw_g)
chk('ca hai doc duoc', bool(hw_n) and bool(hw_g), '')
chk('hai gia tri KHAC nhau (dung thuc te)',
    hw_n != hw_g, 'giong nhau neu bang')

print()
print('=== 1. Key bind HWID NOFOG -> client van khop ===')
d = API.fetch_by_key('AOE1-FULL-TEST-01')
L = (d.get('licenses') or [{}])[0]
print('  quyen:', d.get('features'), '| match:', L.get('hwid_match'))
chk('co quyen nofog', 'nofog' in (d.get('features') or []),
    str(d.get('features')))
chk('hwid_match=True', L.get('hwid_match') is True, '')

print()
print('=== 2. Key bind HWID GRANT -> client van khop ===')
d = API.fetch_by_key('XAGR-GRANT-TEST-01')
L = (d.get('licenses') or [{}])[0]
print('  quyen:', d.get('features'), '| match:', L.get('hwid_match'))
chk('co quyen grant', 'grant' in (d.get('features') or []),
    str(d.get('features')))
chk('hwid_match=True', L.get('hwid_match') is True, '')

print()
print('=== 3. Key bind MAY KHAC -> van KHONG co quyen ===')
d = API.fetch_by_key('XAGR-N2QF-VFP4-HGYQ')
L = (d.get('licenses') or [{}])[0]
print('  quyen:', d.get('features'), '| match:', L.get('hwid_match'))
chk('khong co quyen', not (d.get('features') or []), str(d.get('features')))
chk('hwid_match=False', L.get('hwid_match') is False, '')

print()
print('=== 4. Key THU HOI -> khong co quyen ===')
d = API.fetch_by_key('AOE1-2KHT-7WQP-7R2P')
chk('khong co quyen', not (d.get('features') or []), str(d.get('features')))

print()
print('=== 5. TOKEN GRANT LAY DUOC (dieu kien de cong tai nguyen) ===')
d = API.fetch_by_key('XAGR-GRANT-TEST-01')
okT, msgT = API.ensure_grant_token(d, on_step=lambda m: None)
chk('ensure_grant_token OK', okT, (msgT or '')[:40])
chk('grant_token_ok', API.grant_token_ok(), '')

print()
print('=' * 64)
print('Tong: %d | PASS %d | FAIL %d' % (ok + fail, ok, fail))
sys.exit(0 if fail == 0 else 1)
