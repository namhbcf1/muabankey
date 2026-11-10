"""Kiem tra module nhung trong PYZ cua EXE da build co rebind_key chua."""
import marshal, zlib, struct

p = r"tool/.build/xa_nofog_pro/PYZ-00.pyz"
data = open(p, "rb").read()
print("magic:", data[:4], "pycmagic:", data[4:8].hex())
toc_off = struct.unpack("!i", data[8:12])[0]
print(f"toc_off={toc_off} filesize={len(data)}")
toc = marshal.loads(data[toc_off:])
items = list(toc.items()) if isinstance(toc, dict) else list(toc)
print("TOC entries:", len(items))

hits = [(n, v) for n, v in items if isinstance(n, str) and ("xa_nofog" in n or "xa_config" in n)]
print("modules:", [h[0] for h in hits])


def read_module(val):
    if isinstance(val, tuple) and len(val) == 3:
        tc, off, ln = val
        raw = data[off:off + ln]
        if tc == 1:
            raw = zlib.decompress(raw)
        elif tc != 0:
            return None
        return raw
    return None


for name, val in hits:
    raw = read_module(val)
    if raw is None:
        print(f"  {name}: khong doc duoc (val={val!r})")
        continue
    co = None
    for hdr in (16, 12, 8, 0):
        try:
            co = marshal.loads(raw[hdr:])
            break
        except Exception:
            continue
    if co is None:
        print(f"  {name}: khong unmarshal duoc ({len(raw)} bytes)")
        continue
    fns = [c.co_name for c in co.co_consts if hasattr(c, "co_name")]
    strconsts = [c for c in co.co_consts if isinstance(c, str)]
    print(f"  {name}: size={len(raw)} byte, {len(fns)} ham")
    print(f"      def rebind_key            : {'rebind_key' in fns}")
    print(f"      '--rebind' trong hang so  : {any('--rebind' in s for s in strconsts)}")
    print(f"      'api/rebind' trong hang so: {any('/api/rebind' in s for s in strconsts)}")
    doc = strconsts[0] if strconsts else ""
    print(f"      docstring co '--rebind'   : {'--rebind' in doc}")
    rel = [f for f in fns if 'rebind' in f or 'activate' in f or 'buy' in f or 'trial' in f]
    print(f"      ham lien quan            : {rel}")
