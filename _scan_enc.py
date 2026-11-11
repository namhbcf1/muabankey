import os, sys, re, json

ROOT = r"C:\Users\ADMIN\Desktop\muabankey"
DIRS = ["src", "public", "db", "tool", "scripts", "docs", "qa", "security-audit", "aios", "keys"]
EXTS = {".js", ".py", ".toml", ".sql", ".json", ".md", ".txt", ".html", ".css", ".svg"}

# Mojibake patterns: UTF-8 bytes mistakenly decoded as CP1252/Latin-1
PATTERNS = [
    "\u00c3\u00a1", "\u00c3\u00a0", "\u00c3\u00a2", "\u00c3\u00a3", "\u00c3\u00a9",
    "\u00c3\u00a8", "\u00c3\u00aa", "\u00c3\u00ac", "\u00c3\u00ad", "\u00c3\u00b3",
    "\u00c3\u00b4", "\u00c3\u00b5", "\u00c3\u00b6", "\u00c3\u00b9", "\u00c3\u00ba",
    "\u00c3\u00bb", "\u00c3\u00bd", "\u00c3\u0080", "\u00c3\u0082", "\u00c3\u0089",
    "\u00c4\u2018", "\u00c4\u2019", "\u00c3\u00a2\u20ac",
    "\u00e1\u00ba", "\u00e1\u00bb", "\u00c3\u2020", "\u00c3\u00a2\u201a\u00ac",
    "\u00e2\u20ac\u201c", "\u00e2\u20ac\u2122", "\u00e2\u20ac",
    "\u00c6\u00b0", "\u00c6\u00a1",
]
# suspicious raw byte sequences
BAD_BYTES = [b"\xc3\x28", b"\xa0\xa1", b"\xe2\x28\xa1", b"=A3", b"=E1"]

results = []
nonurft8 = []
badbytes = []

for d in DIRS:
    base = os.path.join(ROOT, d)
    if not os.path.isdir(base):
        continue
    for dirpath, dirnames, filenames in os.walk(base):
        dirnames[:] = [x for x in dirnames if x not in ("node_modules", ".git", "__pycache__", ".wrangler")]
        for fn in filenames:
            ext = os.path.splitext(fn)[1].lower()
            if ext not in EXTS:
                continue
            p = os.path.join(dirpath, fn)
            rel = os.path.relpath(p, ROOT)
            try:
                raw = open(p, "rb").read()
            except Exception as e:
                continue
            for bb in BAD_BYTES:
                if bb in raw:
                    badbytes.append((rel, bb))
            try:
                txt = raw.decode("utf-8")
            except UnicodeDecodeError as e:
                # try cp1258 / latin1
                nonurft8.append((rel, str(e)))
                try:
                    txt = raw.decode("utf-8", errors="replace")
                except Exception:
                    continue
            lines = txt.split("\n")
            for i, line in enumerate(lines, 1):
                for pat in PATTERNS:
                    if pat in line:
                        results.append({"file": rel, "line": i, "pattern": pat, "text": line.strip()[:160]})
                        break

out = {
    "mojibake_hits": results,
    "non_utf8_files": nonurft8,
    "suspicious_byte_seq": [{"file": f, "bytes": repr(b)} for f, b in badbytes],
}
print(json.dumps(out, ensure_ascii=False, indent=2))
