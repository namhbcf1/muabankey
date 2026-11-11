# -*- coding: utf-8 -*-
import re, os
ROOT = r"C:\Users\ADMIN\Desktop\muabankey\public"
icons_src = open(os.path.join(ROOT, r"assets\icons.js"), encoding="utf-8").read()

# PATHS keys defined
m = re.search(r'const PATHS\s*=\s*\{(.*?)\n\};', icons_src, re.S)
if not m:
    m = re.search(r'PATHS\s*=\s*\{(.*?)\n\}', icons_src, re.S)
body = m.group(1) if m else ''
defined = set(re.findall(r"^\s{0,4}([A-Za-z_][A-Za-z0-9_]*)\s*:", body, re.M))
print("defined icon count:", len(defined))

files = []
for dp, dn, fns in os.walk(os.path.join(ROOT, "assets")):
    for fn in fns:
        if fn.endswith(".js"):
            files.append(os.path.join(dp, fn))

used = {}
for f in files:
    txt = open(f, encoding="utf-8").read()
    for mm in re.finditer(r"icon\(\s*'([A-Za-z0-9_]+)'", txt):
        used.setdefault(mm.group(1), set()).add(os.path.relpath(f, ROOT))
    # ternary icon names inside icon(...) e.g. icon(isLicense ? 'key' : 'info'
    for mm in re.finditer(r"icon\([^)]*\?\s*'([A-Za-z0-9_]+)'\s*:\s*'([A-Za-z0-9_]+)'", txt):
        used.setdefault(mm.group(1), set()).add(os.path.relpath(f, ROOT))
        used.setdefault(mm.group(2), set()).add(os.path.relpath(f, ROOT))

missing = {k: v for k, v in used.items() if k not in defined}
print("\nUSED icon names:", len(used))
print("\nMISSING ICONS (used but not defined):")
for k in sorted(missing):
    print(f"  {k}  <- {', '.join(sorted(missing[k]))}")

unused = sorted(defined - set(used))
print(f"\nDEFINED BUT UNUSED ({len(unused)}):")
print("  " + ", ".join(unused))

# iconBox
print("\niconBox(" + " present" if 'export function iconBox' in icons_src else " iconBox MISSING")
