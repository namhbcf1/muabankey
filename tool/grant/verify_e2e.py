"""Kiem chung xa_grant_sec.py giai ma token THAT tu server.

Doc token tu file, verify chu ky, giai khoi ENGINE, roi so sanh bang dia chi
giai duoc voi bang GOC trong server (engines phai khop tung byte).

Chay: python tool/grant/verify_e2e.py <token-file>
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import xa_grant_sec as S  # noqa: E402

try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
JWK = os.path.join(ROOT, 'secrets', 'xg-sign-jwk.json')


def b64u_to_int(s):
    b = S.b64u_dec(s)
    return int.from_bytes(b, 'big')


def main():
    tokfile = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
        os.environ.get('TEMP', '/tmp'), 'xg-token.txt')
    if not os.path.exists(tokfile):
        print('KHONG THAY TOKEN:', tokfile)
        return 2

    token = open(tokfile, encoding='utf-8').read().strip()
    print('TOKEN: %d ky tu' % len(token))

    jwk = json.load(open(JWK, encoding='utf-8'))
    pub = (b64u_to_int(jwk['x']), b64u_to_int(jwk['y']))
    print('PUBKEY: x=%s...' % jwk['x'][:12])

    print()
    print('=== 1. Xac minh + giai ma ===')
    r = S.verify_token(token, pub)
    if not r.get('ok'):
        print('  THAT BAI: code=%s msg=%s' % (r.get('code'), r.get('msg')))
        return 1
    eng = r['engine']
    print('  OK: chu ky hop le, giai duoc khoi ENGINE')
    print('  so dia chi: %d' % len(eng.get('a') or []))
    print('  so chu ky byte: %d' % len(eng.get('s') or {}))
    print('  expires_at: %s' % r.get('expires_at'))

    print()
    print('=== 2. Bang dia chi giai duoc ===')
    names = ['BUILDER', 'SENDER', 'APPLY_GATE', 'APPLY_IMPL', 'CHANGE_RES',
             'VTABLE', 'WRAP_VTABLE', 'PTR_WORLD', 'ALLOC', 'VT_SLOT_VAL',
             'WRAP_CR', 'GAME_PKT', 'LOCAL_APPLY', 'BUILDER_SIB', 'RING_COPY',
             'RESERVED']
    okcount = 0
    for i, a in enumerate(eng['a']):
        nm = names[i] if i < len(names) else '?%d' % i
        print('  %-14s 0x%08X' % (nm, a))
        if a != 0:
            okcount += 1
    print('  -> %d dia chi khac 0' % okcount)

    print()
    print('=== 3. So khop voi gia tri KY VONG (tu server) ===')
    # Cac gia tri nay lay tu ENGINE trong src/routes/xa-grant-server.js
    expect = {
        'BUILDER': 0x42bde0, 'SENDER': 0x42ba60, 'APPLY_GATE': 0x41f160,
        'APPLY_IMPL': 0x41f180, 'CHANGE_RES': 0x45f510, 'VTABLE': 0x54ec90,
        'WRAP_VTABLE': 0x54ee68, 'PTR_WORLD': 0x585e88, 'ALLOC': 0x528450,
        'VT_SLOT_VAL': 0x4ea700, 'WRAP_CR': 0x4f9040, 'GAME_PKT': 0x422cc0,
        'LOCAL_APPLY': 0x41f0a0, 'BUILDER_SIB': 0x42bd90, 'RING_COPY': 0x428710,
    }
    idx = {n: i for i, n in enumerate(names)}
    bad = 0
    for nm, want in expect.items():
        got = eng['a'][idx[nm]]
        mark = 'OK  ' if got == want else 'SAI '
        if got != want:
            bad += 1
        print('  %s %-14s mong=0x%08X nhan=0x%08X' % (mark, nm, want, got))

    print()
    print('=== 4. Chu ky byte ===')
    for k in ('BUILDER', 'SENDER', 'APPLY_GATE', 'APPLY_IMPL', 'CHANGE_RES'):
        print('  %-14s %s' % (k, eng.get('s', {}).get(k, '(thieu)')))

    print()
    print('=== 5. Hang so cau truc ===')
    print('  v =', json.dumps(eng.get('v'), ensure_ascii=False))
    print('  o =', json.dumps(eng.get('o'), ensure_ascii=False))

    print()
    if bad == 0:
        print('KET LUAN: 15/15 dia chi KHOP CHINH XAC voi server.')
        return 0
    print('KET LUAN: %d dia chi SAI' % bad)
    return 1


if __name__ == '__main__':
    sys.exit(main())
