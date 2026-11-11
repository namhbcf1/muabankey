import os, json

ROOT = r"C:\Users\ADMIN\Desktop\muabankey"
EXTS = {".js", ".py", ".toml", ".sql", ".json", ".md", ".txt", ".html", ".css", ".svg", ".ts", ".yml", ".yaml", ".ps1"}

hits = []
non_utf8 = []
replacement = []

for dirpath, dirnames, filenames in os.walk(ROOT):
    dirnames[:] = [d for d in dirnames if d not in ("node_modules", ".git", "__pycache__", ".wrangler", "dist", "build")]
    for fn in filenames:
        ext = os.path.splitext(fn)[1].lower()
        if ext not in EXTS:
            continue
        p = os.path.join(dirpath, fn)
        rel = os.path.relpath(p, ROOT)
        raw = open(p, "rb").read()
        try:
            txt = raw.decode("utf-8")
        except UnicodeDecodeError as e:
            non_utf8.append({"file": rel, "pos": e.start, "reason": e.reason,
                             "context": raw[max(0,e.start-40):e.start+40].hex()})
            txt = raw.decode("utf-8", errors="replace")
        if "\ufffd" in txt:
            for i, line in enumerate(txt.split("\n"), 1):
                if "\ufffd" in line:
                    replacement.append({"file": rel, "line": i, "text": line.strip()[:150]})
        for i, line in enumerate(txt.split("\n"), 1):
            # Ã / Ä / Æ followed by a CP1252 continuation-range char => mojibake
            for j, ch in enumerate(line):
                if ch in "\u00c3\u00c4\u00c6\u00c2\u00e1\u00e2":
                    if j + 1 < len(line):
                        nx = line[j+1]
                        o = ord(nx)
                        if 0x80 <= o <= 0xBF:
                            hits.append({"file": rel, "line": i, "pair": ch+nx,
                                         "text": line.strip()[:150]})
                            break

print(json.dumps({"mojibake": hits, "non_utf8": non_utf8, "replacement_char": replacement},
                 ensure_ascii=False, indent=2))
