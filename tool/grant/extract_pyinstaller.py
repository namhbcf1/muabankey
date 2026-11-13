"""Trich bytecode tu EXE PyInstaller (ban CU) de chung minh dia chi bi lo.

Khong can pyinstxtractor: PyInstaller onefile chua mot khoi CArchive o cuoi
file. Script nay:
    1. Tim magic "MEI\\x0c\\x0b\\x0a\\x0b\\x0e" cua CArchive
    2. Doc TOC (bang muc luc) de liet ke entry
    3. Voi entry la .pyc / PYZ: giai nen zlib roi quet dia chi dang
       little-endian VA dang chuoi hex

Day la bang chung: neu ban CU lo dia chi ở dang doc duoc, con ban MOI thi
khong, thi viec ma hoa da co tac dung.

Chay: python tool/grant/extract_pyinstaller.py tool/grant/xa_grant.exe
"""
import os
import struct
import sys
import zlib

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
HEXSTR = [b'42BDE0', b'42bde0', b'54EC90', b'585E88']
MAGIC = b'MEI\x0c\x0b\x0a\x0b\x0e'


def find_archive(data):
    """Tim CArchive cookie o cuoi file (PyInstaller 2.1+)."""
    pos = data.rfind(MAGIC)
    return pos if pos >= 0 else -1


def parse_toc(data, pos):
    """Doc TOC bat dau ngay sau magic 24 byte."""
    # Cookie: magic(8) + pkglen(4) + tocoff(4) + toclen(4) + pyver(4)
    pkg_len, toc_off, toc_len, pyver = struct.unpack('<IIII', data[pos + 8:pos + 24])
    toc_start = pos + 24 + toc_off
    entries = []
    p = toc_start
    end = toc_start + toc_len
    while p < end:
        try:
            (entry_len,) = struct.unpack('<i', data[p:p + 4])
        except struct.error:
            break
        if entry_len <= 0:
            break
        p += 4
        raw = data[p:p + entry_len]
        p += entry_len
        # struct: offset(4) clen(4) ulen(4) cflag(1) typ(1) name
        if len(raw) < 14:
            continue
        off, clen, ulen = struct.unpack('<III', raw[:12])
        cflag = raw[12]
        typ = chr(raw[13])
        name = raw[14:].split(b'\x00')[0].decode('latin1')
        entries.append({
            'name': name, 'typ': typ, 'off': off,
            'clen': clen, 'ulen': ulen, 'cflag': cflag,
        })
    return entries, pkg_len, toc_start, pyver


def scan_bytes(buf, acc):
    """Quet dia chi (binary LE + hex string) trong buf."""
    for name, a in ADDRS.items():
        c = buf.count(struct.pack('<I', a))
        if c:
            acc['addr'][name] = acc['addr'].get(name, 0) + c
    for h in HEXSTR:
        c = buf.count(h)
        if c:
            acc['hex'][h.decode()] = acc['hex'].get(h.decode(), 0) + c


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
        os.path.dirname(os.path.abspath(__file__)), 'xa_grant.exe')
    data = open(path, 'rb').read()
    print('File: %s (%d B)' % (os.path.abspath(path), len(data)))

    pos = find_archive(data)
    if pos < 0:
        print('  KHONG phai PyInstaller onefile (khong thay MEI magic)')
        return 2
    print('  CArchive tai offset 0x%X' % pos)

    entries, pkg_len, toc_start, pyver = parse_toc(data, pos)
    print('  Python bytecode version: %d.%d' % (pyver // 100, pyver % 100))
    print('  %d entry trong TOC' % len(entries))

    pkg_start = pos + 24
    acc = {'addr': {}, 'hex': {}, 'scanned': 0, 'files': []}

    for e in entries:
        if e['typ'] not in ('s', 'z', 'm', 'M'):
            continue
        off = pkg_start + e['off']
        blob = data[off:off + e['clen']]
        if e['cflag']:
            try:
                blob = zlib.decompress(blob)
            except Exception:
                continue
        # Voi PYZ: ZlibArchive, giai nen tung module con
        if e['typ'] == 'z':
            try:
                sub = parse_pyz(blob)
            except Exception:
                sub = []
            acc['scanned'] += len(blob)
            scan_bytes(blob, acc)
            for name, buf in sub:
                acc['scanned'] += len(buf)
                before = sum(acc['addr'].values()) + sum(acc['hex'].values())
                scan_bytes(buf, acc)
                after = sum(acc['addr'].values()) + sum(acc['hex'].values())
                if after > before:
                    acc['files'].append(name)
        else:
            acc['scanned'] += len(blob)
            before = sum(acc['addr'].values()) + sum(acc['hex'].values())
            scan_bytes(blob, acc)
            after = sum(acc['addr'].values()) + sum(acc['hex'].values())
            if after > before:
                acc['files'].append(e['name'])
            if e['name'].endswith('.pyc'):
                acc['scanned'] += 0

    print('  da quet: %d B (da giai nen)' % acc['scanned'])
    print()
    if acc['addr']:
        print('  !! DIA CHI LO (binary little-endian):')
        for k, v in sorted(acc['addr'].items()):
            print('       %-14s x%d' % (k, v))
    else:
        print('  dia chi (binary LE): KHONG co')
    if acc['hex']:
        print('  !! DIA CHI LO (chuoi hex):')
        for k, v in sorted(acc['hex'].items()):
            print('       %-14s x%d' % (k, v))
    else:
        print('  dia chi (chuoi hex): KHONG co')
    if acc['files']:
        print('  module chua dia chi: %s' % ', '.join(sorted(set(acc['files']))))
    return 0


def parse_pyz(blob):
    """ZlibArchive: bang muc luc -> tung entry nen rieng. Tra [(name, bytes)]."""
    out = []
    if len(blob) < 12:
        return out
    try:
        (toc_off,) = struct.unpack('<i', blob[-4:])
    except struct.error:
        return out
    p = toc_off
    if not (0 <= p < len(blob)):
        return out
    while p + 2 <= len(blob):
        (entry_len,) = struct.unpack('<H', blob[p:p + 2])
        if entry_len == 0:
            break
        p += 2
        raw = blob[p:p + entry_len]
        p += entry_len
        if len(raw) < 16:
            break
        try:
            tend, doff, dlen, ulen, _cflag, _typ = struct.unpack('<IIIcB', raw[:14])
        except struct.error:
            break
        name = raw[14:].split(b'\x00')[0].decode('latin1')
        try:
            buf = zlib.decompress(blob[doff:doff + dlen])
        except Exception:
            continue
        out.append((name, buf))
    return out


if __name__ == '__main__':
    sys.exit(main())
