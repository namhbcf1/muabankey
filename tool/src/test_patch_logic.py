# -*- coding: utf-8 -*-
"""test_patch_logic.py -- kiem chung LOGIC va bang cong tren BO NHO GIA.

Chay:
    python tool/src/test_patch_logic.py

Khong can game, khong can admin, khong can mang. No:
  1. Doc token tu file (hoac sinh tu stdin) va giai ma bang cong
  2. Dung mot "process gia" (bytearray) chua DUNG byte goc tai DUNG dia chi
  3. Chay lai dung thuat toan cua patch()/apply_set()/dump_state()
     (khong import xa_nofog_pro.py de tranh phu thuoc vao file dang sua)
  4. Kiem: va -> PATCHED, tra goc -> orig, va lai -> PATCHED, byte la -> OTHER
"""
import os
import sys

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import xa_nofog_sec as S                       # noqa: E402

PREFERRED_BASE = 0x400000


class FakeMem(object):
    """Process gia: bytearray + ghi/ doc theo dia chi VA."""

    def __init__(self, base=PREFERRED_BASE):
        self.base = base
        self.buf = bytearray(0x40000000)       # 1 GiB ao, chi cham phan dung

    def _off(self, va):
        if not (self.base <= va < self.base + len(self.buf)):
            raise ValueError('VA ngoai mien: 0x%X' % va)
        return va - self.base

    def write(self, va, data):
        o = self._off(va)
        self.buf[o:o + len(data)] = data

    def read(self, va, n):
        o = self._off(va)
        return bytes(self.buf[o:o + n])


def patch(mem, site, restore=False):
    """Ban sao CHINH XAC cua logic patch() -- khong import file dang sua."""
    key, va, orig_s, pat_s = site
    orig = bytes.fromhex(orig_s)
    pat = bytes.fromhex(pat_s)
    want = orig if restore else pat
    other = pat if restore else orig
    cur = mem.read(va, len(want))
    if len(cur) != len(want):
        return 'unreadable'
    if cur == want:
        return 'ok'
    if cur != other:
        return 'other:' + cur.hex(' ')
    mem.write(va, want)
    return 'restored' if restore else 'patched'


def apply_set(mem, sites, restore):
    changed, bad = [], []
    for site in sites:
        st = patch(mem, site, restore=restore)
        if st in ('patched', 'restored'):
            changed.append(site[0])
        elif st != 'ok':
            bad.append('%s(%s)' % (site[0], st))
    return changed, bad


def state_of(mem, site):
    key, va, orig_s, pat_s = site
    cur = mem.read(va, len(orig_s) // 2)
    orig = bytes.fromhex(orig_s)
    pat = bytes.fromhex(pat_s)
    if len(cur) != len(orig):
        return 'UNREADABLE'
    if cur == pat:
        return 'PATCHED'
    if cur == orig:
        return 'orig'
    return 'OTHER'


def run(token):
    print('\n=== 1. Giai ma token ===')
    r = S.verify_token_local(token, app='xa-nofog')
    if not r.get('ok'):
        print('  THAT BAI: %s' % r.get('code'))
        print('  %s' % r.get('msg'))
        return 1
    t = r['sites']
    print('  OK: %d cong, %d nhom' % (r['count'], len(r['groups'])))
    print('  gate = %s' % r['gate'])
    for g, rows in r['groups']:
        print('    %-9s %d: %s' % (g, len(rows), ' '.join(x[0] for x in rows)))

    print('\n=== 2. Nap byte GOC vao bo nho gia ===')
    mem = FakeMem()
    for key, va, orig_s, pat_s in t.all():
        mem.write(va, bytes.fromhex(orig_s))
    print('  da nap %d cong' % len(t.all()))
    before = {s[0]: state_of(mem, s) for s in t.all()}
    n_orig = sum(1 for v in before.values() if v == 'orig')
    print('  trang thai: %d/%d orig' % (n_orig, len(before)))
    ok1 = (n_orig == len(before))
    print('  %s' % ('OK' if ok1 else 'FAIL'))

    print('\n=== 3. Va (mac dinh = viewport + minimap) ===')
    dflt = t.default()
    changed, bad = apply_set(mem, dflt, restore=False)
    print('  va %d cong: %s' % (len(changed), ' '.join(changed)))
    if bad:
        print('  LOI: %s' % ' '.join(bad))
    exp = [x[0] for x in dflt]
    ok2 = (sorted(changed) == sorted(exp)) and not bad
    print('  %s (mong doi %d cong)' % ('OK' if ok2 else 'FAIL', len(exp)))

    print('\n=== 4. Kiem trang thai sau khi va ===')
    st = {s[0]: state_of(mem, s) for s in t.all()}
    ok3 = all(st[k] == 'PATCHED' for k in exp)
    legacy_untouched = all(st[k] == 'orig' for k in st if k not in exp)
    print('  %d/%d cong PATCHED' % (sum(1 for k in exp if st[k] == 'PATCHED'), len(exp)))
    print('  legacy con orig: %s' % legacy_untouched)
    print('  %s' % ('OK' if ok3 and legacy_untouched else 'FAIL'))

    print('\n=== 5. Va ca 17 cong (--full) ===')
    changed2, bad2 = apply_set(mem, t.full(), restore=False)
    # nhung cong da va -> 'ok' (khong nam trong changed)
    ok4 = not bad2
    print('  them %d cong, loi: %s' % (len(changed2), bad2 or 'khong'))
    st2 = {s[0]: state_of(mem, s) for s in t.all()}
    ok5 = all(v == 'PATCHED' for v in st2.values())
    print('  toan bo PATCHED: %s' % ok5)
    print('  %s' % ('OK' if ok4 and ok5 else 'FAIL'))

    print('\n=== 6. Tra goc (--off) ===')
    changed3, bad3 = apply_set(mem, t.full(), restore=True)
    st3 = {s[0]: state_of(mem, s) for s in t.all()}
    ok6 = all(v == 'orig' for v in st3.values()) and not bad3
    print('  tra goc %d cong, loi: %s' % (len(changed3), bad3 or 'khong'))
    print('  toan bo orig: %s' % (all(v == 'orig' for v in st3.values())))
    print('  %s' % ('OK' if ok6 else 'FAIL'))

    print('\n=== 7. Byte la -> phai bao OTHER, KHONG ghi ===')
    site = t.all()[0]
    key, va, orig_s, pat_s = site
    mem.write(va, b'\xCC' * (len(orig_s) // 2))
    s = patch(mem, site, restore=False)
    ok7 = s.startswith('other:')
    print('  ket qua: %s' % s)
    print('  byte sau do KHONG bi ghi de: %s'
          % (mem.read(va, len(orig_s) // 2) == b'\xCC' * (len(orig_s) // 2)))
    print('  %s' % ('OK' if ok7 else 'FAIL'))

    print('\n=== 8. Base lech (ASLR) -- tinh dia chi theo base ===')
    # patch() dung base + (va - PREFERRED_BASE). Base lech -> dia chi dich lech.
    base2 = 0x400000 + 0x10000
    mem2 = FakeMem(base=base2)
    for key, va, orig_s, pat_s in t.all():
        mem2.write(base2 + (va - PREFERRED_BASE), bytes.fromhex(orig_s))
    moved = [(k, base2 + (v - PREFERRED_BASE), o, p) for k, v, o, p in t.all()]
    ch, bd = apply_set(mem2, moved, restore=False)
    ok8 = (len(ch) == 17) and not bd
    print('  va %d/17 cong khi base lech 0x10000: %s' % (len(ch), 'OK' if ok8 else 'FAIL'))
    print('  %s' % ('OK' if ok8 else 'FAIL'))

    results = [ok1, ok2, ok3, ok4 and ok5, ok6, ok7, ok8]
    print('\n' + '=' * 60)
    print('  %d/%d nhom kiem dat' % (sum(1 for x in results if x), len(results)))
    if all(results):
        print('  TAT CA DEU DAT')
        return 0
    print('  CO LOI')
    return 1


def main():
    if len(sys.argv) > 1 and os.path.exists(sys.argv[1]):
        with open(sys.argv[1], 'r', encoding='utf-8') as f:
            token = f.read().strip()
    else:
        token = sys.stdin.read().strip()
    if not token:
        print('Can token:  python test_patch_logic.py <file-token>')
        print('hoac:        node scripts/test-nofog-token.mjs --emit-token')
        return 2
    return run(token)


if __name__ == '__main__':
    sys.exit(main())
