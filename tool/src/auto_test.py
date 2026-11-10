#!/usr/bin/env python3
"""auto_test.py -- tu dong do nhieu muc ghi, tu loai tru, ghi ket qua.

Chay khi game DANG MO va DA VAO TRAN THAT (>=2 nguoi).

Muc dich: xac dinh
  1. Tai nguyen co vao checksum khong (da biet: CO, trong so 1)
  2. Co nguong dung sai khong (ghi nho co lot khong)
  3. Loai tai nguyen nao cung vao hay chi mot so
  4. Ghi am (giam) co khac gi ghi duong khong

Moi lan: cho log on dinh -> ghi -> doi mismatch -> ghi lai ket qua.
"""
import ctypes
import ctypes.wintypes as wt
import importlib.util
import json
import os
import struct
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

OUT = os.path.join(HERE, 'test_results.json')


def snapshot():
    rows = m.parse_log(m.SYNC_LOG)
    return rows, m.mismatches(rows)


def wait_mismatch(base_n, timeout=90):
    t0 = time.time()
    while time.time() - t0 < timeout:
        time.sleep(2)
        rows, mis = snapshot()
        if len(mis) > base_n:
            return mis[len(mis) - 1], mis
    return None, None


def run_case(h, pd, key, amount, label):
    """Ghi +amount vao key, doi mismatch, tra ket qua."""
    rows, mis = snapshot()
    base_n = len(mis)
    n_rows0 = len(rows)

    off = m.RES_OFF[key]
    old = m.f32(h, pd + off)
    if old is None:
        return {'label': label, 'key': key, 'amount': amount,
                'error': 'unreadable'}
    ok = m.wr_f32(h, pd + off, old + amount)
    if not ok:
        return {'label': label, 'key': key, 'amount': amount,
                'error': 'write-fail'}
    new = m.f32(h, pd + off)

    print('  ghi %+g %s : %g -> %g' % (amount, m.RES_NAME[key], old, new))
    found, _ = wait_mismatch(base_n, timeout=75)

    r = {'label': label, 'key': key, 'amount': amount,
         'old': old, 'new': new, 'rows_before': n_rows0}
    if found:
        r['delta'] = found['delta']
        r['turn'] = found['turn']
        r['other_same'] = found['other_same']
        r['detected'] = True
        print('    -> LECH %d o turn 0x%X' % (found['delta'], found['turn']))
    else:
        r['detected'] = False
        print('    -> KHONG thay lech trong 75s')
    return r


def main():
    if not m.is_admin():
        print('CAN ADMIN.')
        return 5
    procs = m.find_game()
    if not procs:
        print('Khong thay game.')
        return 1
    pid = procs[0][0]
    h, base = m.attach(pid)
    if not h:
        print('Khong mo duoc pid %d' % pid)
        return 1

    pd, vals = m.get_player(h, base)
    if not pd:
        print('Khong tim thay playerdata -- chua vao tran.')
        m.k32.CloseHandle(h)
        return 1

    print('=' * 70)
    print('AUTO TEST -- pid %d  playerdata 0x%08X' % (pid, pd))
    print('=' * 70)
    print('Tai nguyen dau: ' + '  '.join(
        '%s=%g' % (k, vals.get(k, 0)) for k in ('F', 'W', 'S', 'G')))
    print()

    results = []

    # --- Case 1: ghi rat nho, xem co nguong dung sai khong ---
    print('[1] Ghi +1 food (cuc nho -- kiem dung sai)')
    results.append(run_case(h, pd, 'F', 1, 'nho-1'))
    print()

    # --- Case 2: ghi nho ---
    print('[2] Ghi +10 food')
    results.append(run_case(h, pd, 'F', 10, 'nho-10'))
    print()

    # --- Case 3: ghi vua ---
    print('[3] Ghi +1000 food')
    results.append(run_case(h, pd, 'F', 1000, 'vua-1000'))
    print()

    # --- Case 4: tai nguyen khac ---
    print('[4] Ghi +5000 wood (kiem tai nguyen khac cung vao)')
    results.append(run_case(h, pd, 'W', 5000, 'wood-5000'))
    print()

    # --- Case 5: ghi am ---
    print('[5] Ghi -30 food (kiem ghi am)')
    results.append(run_case(h, pd, 'F', -30, 'am-30'))
    print()

    m.k32.CloseHandle(h)

    # --- Tong hop ---
    print('=' * 70)
    print('TONG HOP')
    print('=' * 70)
    print('%-12s %-6s %-10s %-12s %-10s %s'
          % ('case', 'res', 'amount', 'delta', 'khop?', 'ghi chu'))
    for r in results:
        if r.get('error'):
            print('%-12s %-6s %-10s %-12s %-10s %s'
                  % (r['label'], r['key'], r['amount'], '-', '-', r['error']))
            continue
        if not r.get('detected'):
            verdict = 'KHONG LECH'
            note = 'khong phat hien trong 75s'
        else:
            d = r['delta']
            a = r['amount']
            onebyte = int(abs(a)) & 0xFF
            if abs(abs(d) - abs(a)) < 2:
                verdict = 'KHOP DUNG'
                note = 'trong so 1'
            elif abs(abs(d) - onebyte) < 2:
                verdict = 'KHOP 1-BYTE'
                note = 'chi nhom 8 bit'
            else:
                verdict = 'KHAC'
                note = 'can xem lai'
            if r.get('other_same') is False:
                note += '; COT KHAC CUNG LECH'
        print('%-12s %-6s %-10g %-12s %-10s %s'
              % (r['label'], r['key'], r['amount'],
                 r.get('delta', '-'), verdict, note))

    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump({'pid': pid, 'playerdata': pd, 'at': time.time(),
                   'results': results}, f, indent=2)
    print()
    print('Da ghi %s' % OUT)
    return 0


if __name__ == '__main__':
    sys.exit(main())
