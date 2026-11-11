import os, json

ROOT = r"C:\Users\ADMIN\Desktop\muabankey"
EXTS = {".js", ".py", ".toml", ".sql", ".json", ".md", ".txt", ".html", ".css", ".svg", ".ts", ".yml", ".yaml", ".ps1"}
SKIP_DIRS = {"node_modules", ".git", "__pycache__", ".wrangler", "dist", "build", "shots", ".build"}

rep = []
for dirpath, dirnames, filenames in os.walk(ROOT):
    dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
    for fn in filenames:
        ext = os.path.splitext(fn)[1].lower()
        if ext not in EXTS:
            continue
        p = os.path.join(dirpath, fn)
        rel = os.path.relpath(p, ROOT)
        raw = open(p, "rb").read()
        try:
            txt = raw.decode("utf-8")
        except UnicodeDecodeError:
            continue  # already reported separately
        if "\ufffd" not in txt:
            continue
        for i, line in enumerate(txt.split("\n"), 1):
            if "\ufffd" in line:
                # show a narrow window around the bad char
                k = line.index("\ufffd")
                rep.append({"file": rel, "line": i, "ctx": line[max(0,k-40):k+40]})

print(json.dumps(rep, ensure_ascii=False, indent=2))
