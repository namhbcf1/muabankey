# -*- coding: utf-8 -*-
import re, os, json, sys
from collections import defaultdict

ROOT = r"C:\Users\ADMIN\Desktop\muabankey\public"
CSS = os.path.join(ROOT, r"assets\style.css")
css = open(CSS, encoding="utf-8").read()

# --- class names defined in CSS ---
css_classes = set(re.findall(r'\.([A-Za-z_][A-Za-z0-9_-]*)', css))

files = []
for dirpath, dirnames, filenames in os.walk(os.path.join(ROOT, "assets")):
    for fn in filenames:
        if fn.endswith(".js"):
            files.append(os.path.join(dirpath, fn))

EMOJI = re.compile(
    "[\U0001F000-\U0001FAFF\u2190-\u21FF\u2600-\u27BF\u2B00-\u2BFF\uFE0F\u2700-\u27bf\u23E9-\u23FA\u231A-\u231B]"
)

report = {}

print("=" * 70)
print("EMOJI / NON-ASCII SYMBOLS IN JS")
print("=" * 70)
for f in files:
    txt = open(f, encoding="utf-8").read()
    for i, line in enumerate(txt.splitlines(), 1):
        hits = EMOJI.findall(line)
        if hits:
            rel = os.path.relpath(f, ROOT)
            print(f"{rel}:{i}: {''.join(sorted(set(hits)))}  ||  {line.strip()[:150]}")

print()
print("=" * 70)
print("HARDCODED HEX COLORS IN JS")
print("=" * 70)
for f in files:
    txt = open(f, encoding="utf-8").read()
    for i, line in enumerate(txt.splitlines(), 1):
        hits = re.findall(r'#[0-9a-fA-F]{3,8}\b', line)
        if hits:
            rel = os.path.relpath(f, ROOT)
            print(f"{rel}:{i}: {sorted(set(hits))}")

print()
print("=" * 70)
print("100vh / 100svh / 100dvh")
print("=" * 70)
for f in files + [CSS]:
    txt = open(f, encoding="utf-8").read()
    for i, line in enumerate(txt.splitlines(), 1):
        if re.search(r'100(vh|svh|dvh)', line):
            print(f"{os.path.relpath(f, ROOT)}:{i}: {line.strip()}")

print()
print("=" * 70)
print("INLINE style= COUNTS PER FILE")
print("=" * 70)
for f in sorted(files):
    txt = open(f, encoding="utf-8").read()
    n = len(re.findall(r'style="', txt))
    if n:
        print(f"{os.path.relpath(f, ROOT)}: {n}")

print()
print("=" * 70)
print("CLASSES USED IN JS BUT NOT DEFINED IN CSS")
print("=" * 70)
IGNORE = set()
undefined = defaultdict(set)
for f in files:
    txt = open(f, encoding="utf-8").read()
    rel = os.path.relpath(f, ROOT)
    # class="a b c"
    for m in re.finditer(r'class="([^"$`{}]*)"', txt):
        for c in m.group(1).split():
            if '{' in c or '}' in c or '$' in c or not c.strip():
                continue
            if c not in css_classes:
                undefined[c].add(rel)
    # cls: 'x y'
    for m in re.finditer(r"cls:\s*'([^']*)'", txt):
        for c in m.group(1).split():
            if c not in css_classes:
                undefined[c].add(rel)
    # classList.add/toggle/remove
    for m in re.finditer(r"classList\.(?:add|toggle|remove)\('([^']+)'", txt):
        c = m.group(1)
        if c not in css_classes:
            undefined[c].add(rel)
    # className = 'x'
    for m in re.finditer(r"className\s*=\s*'([^']*)'", txt):
        for c in m.group(1).split():
            if c not in css_classes:
                undefined[c].add(rel)

for c in sorted(undefined):
    print(f"  {c}  <- {', '.join(sorted(undefined[c]))}")
