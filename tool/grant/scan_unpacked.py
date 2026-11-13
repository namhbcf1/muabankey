"""Quet thu muc giai nen cua Nuitka onefile de chung minh khong lo dia chi.

Nuitka --onefile NEN payload (~31%), nen quet truc tiep file .exe la VO NGHIA:
khong tim thay gi ca, ke ca voi ban CU co hardcode. Phai:
    1. Chay EXE de no tu giai nen ra %TEMP%/onefile_*
    2. Quet cac file .pyd/.dll trong do (da giai nen, chua nen lai)

Chay: python tool/grant/scan_unpacked.py <dir-onefile> [dir2 ...]
"""
import os
import struct
import sys

try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass

ADDRS = {
    'BUILDER': 0x42BDE0, 'SENDER': 0x42BA60, 'APPLY_GATE': 0x41F160,
    'APPLY_IMPL': 0x41F180, 'CHANGE_RES': 0x45F510, 'VTABLE': 0x54EC90,
    'WRAP_VTABLE': 0x54EE68, 'PTR_WORLD': 0x585E88, 'ALLOC': 0x528450,
    'VT_SLOT_VAL': 0x4EA700, 'WRAP_CR': 0x4F9040, 'GAME_PKT': 0x422CC0,
    'LOCAL_APPLY': 0x41F0A0, 'BUILDER_SIB': 0x42BD90, 'RING_COPY': 0x428710,
}
SIGS = {
    'sig_BUILDER': bytes.fromhex('566A088BF16A01E8'),
    'sig_SENDER': bytes.fromhex('538B5C240856578B7C24148BF1'),
    'sig_APPLY_GATE': bytes.fromhex('8B4424088B542404'),
}
NAMES = [b'xa_grant_sec', b'xa_grant_const', b'bind_token_to_machine',
         b'xg-ks', b'open_engine', b'token_wrong_machine', b'load_engine_from_token']


def scan_dir(d):
    total = {'files': 0, 'bytes': 0, 'addr': {}, 'sig': {}, 'name': {}}
    for root, _dirs, files in os.walk(d):
        for fn in files:
            p = os.path.join(root, fn)
            try:
                data = open(p, 'rb').read()
            except Exception:
                continue
            total['files'] += 1
            total['bytes'] += len(data)
            for name, a in ADDRS.items():
                c = data.count(struct.pack('<I', a))
                if c:
                    total['addr'][name] = total['addr'].get(name, 0) + c
            for name, pat in SIGS.items():
                c = data.count(pat)
                if c:
                    total['sig'][name] = total['sig'].get(name, 0) + c
            for n in NAMES:
                c = data.count(n)
                if c:
                    k = n.decode('latin1')
                    total['name'][k] = total['name'].get(k, 0) + c
    return total


def report(label, d):
    print('=' * 64)
    print(label)
    print('  %s' % d)
    if not os.path.isdir(d):
        print('  KHONG TON TAI')
        return None
    r = scan_dir(d)
    print('  %d file, %d B da giai nen' % (r['files'], r['bytes']))
    print()
    if r['addr']:
        print('  !! DIA CHI LO:')
        for k, v in sorted(r['addr'].items()):
            print('       %-14s x%d' % (k, v))
    else:
        print('  dia chi engine: KHONG co (sach)')
    if r['sig']:
        print('  !! CHU KY BYTE LO:')
        for k, v in sorted(r['sig'].items()):
            print('       %-16s x%d' % (k, v))
    else:
        print('  chu ky byte ham: KHONG co (sach)')
    if r['name']:
        print('  ten module noi bo: %s' % ', '.join(sorted(r['name'])))
    else:
        print('  ten module noi bo: khong co')
    return r


def main():
    if len(sys.argv) < 2:
        print('Dung: python scan_unpacked.py <dir-onefile>')
        return 2
    for d in sys.argv[1:]:
        report('THU MUC GIAI NEN', d)
        print()
    return 0


if __name__ == '__main__':
    sys.exit(main())
