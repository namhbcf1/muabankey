#!/usr/bin/env python3
"""xa_probe.py -- do nguong dung sai va cac truong hop bien.

Cau hoi can tra loi:
  1. Ghi +1 co lam lech khong? (+0.5? +0.01?)
  2. Ghi am (-N) co cung quy luat?
  3. Ghi so le (1.5) thi __ftol lam tron hay cat?
  4. Ghi vao tai nguyen khac (W/S/G) co giong F?
  5. Ghi nhieu field cung luc thi delta = tong?
  6. Ghi 0 thi sao?

Chay khi game DANG MO va DA VAO TRAN THAT.
"""
import ctypes
import importlib.util
import os
import sys
import time

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('m', os.path.join(HERE, 'xa_measure.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def read_name(h, pd):
    nb = ctypes.create_string_buffer(32)
    g = ctypes.c_size_t(0)
    if m.k32.ReadProcessMemory(h, ctypes.c_void_p(pd + 0x730), nb, 32, ctypes.byref(g)):
        return nb.raw.split(b'\x00')[0].decode('latin1', 'replace')
    return ''


def find_my_slot(h, base):
    delta = base - m.PREFERRED_BASE
    world = m.u32(h, m.PTR_WORLD + delta)
    if not world:
        return 0, None, -1, ''
    mgr = m.u32(h, world + m.OFF_MANAGER)
    if not mgr:
        return 0, None, -1, ''
    slots = m.u32(h, mgr + m.OFF_SLOTS) & 0xFFFF
    arr = m.u32(h, mgr + m.OFF_WRAPARRAY)
    cands = []
    for s in range(min(slots, 16)):
        wrp = m.u32(h, arr + s * 4)
        if not wrp:
            continue
        pd = m.u32(h, wrp + m.OFF_PLAYER)
        if not pd:
            continue
        vals = {}
        bad = False
        for k in ('F', 'W', 'S', 'G'):
            v = m.f32(h, pd + m.RES_OFF[k])
            if v is None or v < 0 or v > 1e9:
                bad = True
                break
            vals[k] = v
        if bad:
            continue
        nm = read_name(h, pd)
        clean = ''.join(ch for ch in nm if 32 <= ord(ch) < 127)
        if not clean:
            continue
        cands.append((s, pd, vals, clean))
    if not cands:
        return 0, None, -1, ''
    cands.sort(key=lambda x: (sum(x[2].values()), x[0]))
    s, pd, vals, nm = cands[0]
    return pd, vals, s, nm


def snap():
    """Tra (so turn lech, list turn lech, set cac (turn,delta) da thay)."""
    rows = m.parse_log(m.SYNC_LOG)
    mis = m.mismatches(rows)
    seen = set((x['turn'], x['delta']) for x in mis)
    return len(mis), mis, seen


def wait(seen_before, timeout=70):
    """Doi mot (turn,delta) MOI chua tung thay.

    Khong so sanh so luong -- vi neu mismatch o cung turn ma delta doi
    thi so luong khong tang. Phai so cap (turn,delta).
    """
    t0 = time.time()
    while time.time() - t0 < timeout:
        time.sleep(1.5)
        _, mis, seen = snap()
        new = [x for x in mis if (x['turn'], x['delta']) not in seen_before]
        if new:
            return new[-1]
    return None


def case(h, pd, writes, label, timeout=70):
    """writes = [(key, new_value), ...]. Ghi het roi doi mismatch."""
    _, _, seen0 = snap()
    before = {}
    for k, v in writes:
        before[k] = m.f32(h, pd + m.RES_OFF[k])
    for k, v in writes:
        m.wr_f32(h, pd + m.RES_OFF[k], v)
    after = {k: m.f32(h, pd + m.RES_OFF[k]) for k, _ in writes}
    print('  %-22s ' % label, end='')
    for k in before:
        print('%s %.4g->%.4g ' % (k, before[k], after[k]), end='')
    print()
    f = wait(seen0, timeout)
    if f:
        print('      -> delta=%d turn=0x%X other_same=%s'
              % (f['delta'], f['turn'], f['other_same']))
        return {'label': label, 'delta': f['delta'], 'detected': True,
                'before': before, 'after': after}
    print('      -> KHONG LECH (75s)')
    return {'label': label, 'delta': None, 'detected': False,
            'before': before, 'after': after}


def main():
    if not m.is_admin():
        print('CAN ADMIN')
        return 5
    procs = m.find_game()
    if not procs:
        print('Khong thay game')
        return 1
    h, base = m.attach(procs[0][0])
    if not h:
        print('Khong mo duoc')
        return 1
    pd, vals, slot, nm = find_my_slot(h, base)
    if not pd:
        print('Khong tim thay playerdata -- chua vao tran')
        m.k32.CloseHandle(h)
        return 1

    print('=' * 72)
    print('XA PROBE -- slot %d (%s) pd=0x%08X' % (slot, nm, pd))
    print('=' * 72)
    print('dau: ' + '  '.join('%s=%g' % (k, vals.get(k, 0)) for k in 'FWSG'))
    print()

    R = []
    base_f = vals['F']

    print('[1] Nguong dung sai -- ghi +1')
    R.append(case(h, pd, [('F', base_f + 1)], '+1 food'))

    print('[2] Ghi +0.5 (nua don vi)')
    cur = m.f32(h, pd + m.RES_OFF['F'])
    R.append(case(h, pd, [('F', cur + 0.5)], '+0.5 food'))

    print('[3] Ghi +0.01 (duoi nguong __ftol)')
    cur = m.f32(h, pd + m.RES_OFF['F'])
    R.append(case(h, pd, [('F', cur + 0.01)], '+0.01 food'))

    print('[4] Ghi tri tuyet doi (khong cong don)')
    R.append(case(h, pd, [('F', 777.0)], 'set F=777'))

    print('[5] Ghi 4 field cung luc, moi field +300')
    cur = {k: m.f32(h, pd + m.RES_OFF[k]) for k in 'FWSG'}
    R.append(case(h, pd, [(k, cur[k] + 300) for k in 'FWSG'], 'ca 4 +300'))

    print('[6] Ghi am -- giam food 100')
    cur = m.f32(h, pd + m.RES_OFF['F'])
    R.append(case(h, pd, [('F', cur - 100)], '-100 food'))

    print('[7] Ghi ve 0')
    R.append(case(h, pd, [('F', 0.0)], 'set F=0'))

    m.k32.CloseHandle(h)

    print()
    print('=' * 72)
    print('TONG HOP')
    print('=' * 72)
    for r in R:
        d = r['delta']
        if d is None:
            print('  %-14s KHONG LECH' % r['label'])
        else:
            print('  %-14s delta=%d' % (r['label'], d))
    return 0


if __name__ == '__main__':
    sys.exit(main())
