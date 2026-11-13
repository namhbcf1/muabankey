"""Quet EXE tim dia chi engine o dang NHI PHAN (little-endian 4 byte).

QUAN TRONG: dia chi 0x42BDE0 duoc luu trong binary dang 4 byte
    E0 BD 42 00   (little-endian)
KHONG phai chuoi "42BDE0". Vi vay phai tim byte pattern, khong tim hex string.

Day la ly do lan quet truoc bao "SACH" cho ca ban CU (ban CU chac chan co
dia chi, chi la khong phai dang chuoi).

Chay: python tool/grant/scan_exe_bytes.py
"""
import os
import struct
import sys

try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass

HERE = os.path.dirname(os.path.abspath(__file__))

ADDRS = {
    'BUILDER': 0x42BDE0,
    'SENDER': 0x42BA60,
    'APPLY_GATE': 0x41F160,
    'APPLY_IMPL': 0x41F180,
    'CHANGE_RES': 0x45F510,
    'VTABLE': 0x54EC90,
    'WRAP_VTABLE': 0x54EE68,
    'PTR_WORLD': 0x585E88,
    'ALLOC': 0x528450,
    'VT_SLOT_VAL': 0x4EA700,
    'WRAP_CR': 0x4F9040,
    'GAME_PKT': 0x422CC0,
    'LOCAL_APPLY': 0x41F0A0,
    'BUILDER_SIB': 0x42BD90,
    'RING_COPY': 0x428710,
}

# Chu ky byte cua ham (chac chan phai co neu tool biet dia chi ham)
SIGS = {
    'sig_BUILDER': bytes.fromhex('566A088BF16A01E8'),
    'sig_SENDER': bytes.fromhex('538B5C240856578B7C24148BF1'),
}

NAME_NEEDLES = [b'xa_grant_sec', b'xa_grant_const', b'bind_token_to_machine',
                b'xg-ks', b'open_engine', b'token_wrong_machine']


def scan(path):
    if not os.path.exists(path):
        return None
    data = open(path, 'rb').read()
    out = {'size': len(data), 'addr': {}, 'sig': {}, 'name': {}}

    for name, a in ADDRS.items():
        pat = struct.pack('<I', a)
        c = data.count(pat)
        if c:
            out['addr'][name] = c

    for name, pat in SIGS.items():
        c = data.count(pat)
        if c:
            out['sig'][name] = c

    for n in NAME_NEEDLES:
        c = data.count(n)
        if c:
            out['name'][n.decode('latin1')] = c

    return out


def report(label, path):
    print('=' * 64)
    print('%s' % label)
    print('  %s' % os.path.abspath(path))
    r = scan(path)
    if r is None:
        print('  KHONG TON TAI')
        return None
    print('  kich thuoc: %d B' % r['size'])
    print()
    print('  --- dia chi (byte little-endian) ---')
    if r['addr']:
        for k, v in sorted(r['addr'].items()):
            print('    CO   %-14s x%d' % (k, v))
    else:
        print('    khong co dia chi nao')
    print()
    print('  --- chu ky byte ham ---')
    if r['sig']:
        for k, v in sorted(r['sig'].items()):
            print('    CO   %-14s x%d' % (k, v))
    else:
        print('    khong co')
    print()
    print('  --- ten module noi bo ---')
    if r['name']:
        for k, v in sorted(r['name'].items()):
            print('    CO   %-24s x%d' % (k, v))
    else:
        print('    khong co')
    return r


def main():
    old = os.path.join(HERE, 'xa_grant.exe')
    new = os.path.join(HERE, '..', 'dist-grant', 'xa_grant.exe')

    a = report('BAN CU  (dia chi hardcode trong source)', old)
    print()
    b = report('BAN MOI (nap tu token xg1.)', new)
    print()
    print('=' * 64)
    print('KET LUAN')
    if a is None or b is None:
        print('  Khong du hai ban de so sanh.')
        return 1
    na = len(a['addr'])
    nb = len(b['addr'])
    print('  ban cu : %d/%d dia chi lo trong binary' % (na, len(ADDRS)))
    print('  ban moi: %d/%d dia chi lo trong binary' % (nb, len(ADDRS)))
    if na > 0 and nb == 0:
        print('  => BAN MOI DA XOA SACH dia chi.')
        return 0
    if nb > 0:
        print('  => BAN MOI VAN CON LO %d dia chi. Chua dat.' % nb)
        return 1
    print('  => Ca hai deu khong lo (kiem tra lai cach quet).')
    return 1


if __name__ == '__main__':
    sys.exit(main())
