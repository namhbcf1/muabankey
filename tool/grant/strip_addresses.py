"""Xoa dia chi engine khoi xa_grant.py (chay MOT lan).

Muc dich: khong con mot dia chi ham nao trong source, do do khong con trong
binary sau khi build. Tat ca den tu token.

Chien luoc theo loai dong:
  * COMMENT (#...)  -> xoa dia chi, giu y nghia
  * DOCSTRING       -> xoa dia chi, giu y nghia
  * STRING in ra    -> xoa dia chi
  * CODE that su    -> thay hang so bang ten bien (nap tu token)

Chay: python tool/grant/strip_addresses.py
"""
import re
import sys

PATH = 'tool/grant/xa_grant.py'

# Dia chi -> ten bien tuong ung (de thay trong CODE)
CODE_MAP = {
    '0x42BA60': 'SENDER',
    '0x42BDE0': 'BUILDER',
    '0x41F160': 'APPLY_GATE',
    '0x41F180': 'APPLY_IMPL',
    '0x45F510': 'CHANGE_RES',
    '0x54EC90': 'VTABLE',
    '0x54EE68': 'WRAPPER_VTABLE',
    '0x585E88': 'PTR_WORLD',
    '0x528450': 'ALLOC_ADDR',
    '0x4EA700': 'VT_SLOT_VAL',
    '0x4F9040': 'WRAP_CR',
    '0x422CC0': 'GAME_PKT',
    '0x41F0A0': 'LOCAL_APPLY',
    '0x42BD90': 'BUILDER_SIB',
    '0x428710': 'RING_COPY',
    '0x54EF98': 'VTABLE_SETTINGS',
}

ADDR_RE = re.compile(
    r'0x(?:42BDE0|42BA60|41F160|41F180|45F510|54EC90|54EE68|585E88|'
    r'528450|4EA700|4F9040|422CC0|41F0A0|42BD90|428710|54EF98)',
    re.IGNORECASE)


def classify(line):
    s = line.strip()
    if not s:
        return 'blank'
    if s.startswith('#'):
        return 'comment'
    # dong chi la string noi tiep cua print(...) hoac log(...)
    if s.startswith("'") or s.startswith('"'):
        return 'string'
    return 'code'


def main():
    src = open(PATH, encoding='utf-8').read()
    lines = src.split('\n')
    out = []
    stats = {'comment': 0, 'string': 0, 'code': 0}

    for ln in lines:
        if not ADDR_RE.search(ln):
            out.append(ln)
            continue

        kind = classify(ln)

        if kind in ('comment', 'string'):
            # Xoa dia chi, giu phan con lai. Neu dong tro nen vo nghia thi
            # thay bang 'engine' cho de doc.
            new = ADDR_RE.sub('engine', ln)
            # Don dep: "engine(8,1)" -> "(8,1)", "0x... " da bi thay
            new = re.sub(r'engine\s*->\s*engine', 'engine -> engine', new)
            out.append(new)
            stats[kind] += 1
            continue

        # CODE: thay hang so bang ten bien
        def repl(m):
            key = '0x' + m.group(0)[2:].upper()
            return CODE_MAP.get(key, '0')
        new = ADDR_RE.sub(repl, ln)
        if new != ln:
            stats['code'] += 1
        out.append(new)

    open(PATH, 'w', encoding='utf-8', newline='\n').write('\n'.join(out))

    print('da xu ly:')
    for k, v in stats.items():
        print('  %-8s %d dong' % (k, v))

    # Kiem tra lai
    left = ADDR_RE.findall(open(PATH, encoding='utf-8').read())
    print()
    if left:
        print('CON SOT %d dia chi: %s' % (len(left), set(left)))
        return 1
    print('SACH: khong con dia chi engine nao trong source')
    return 0


if __name__ == '__main__':
    sys.exit(main())
