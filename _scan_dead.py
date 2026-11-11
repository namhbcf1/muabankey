import ast, sys, json, io, os

P = r"C:\Users\ADMIN\Desktop\muabankey\tool\src\xa_nofog_pro.py"
src = open(P, encoding="utf-8").read()
tree = ast.parse(src)

defined = []
for node in tree.body:
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
        defined.append((node.name, node.lineno))
    elif isinstance(node, ast.ClassDef):
        defined.append((node.name, node.lineno))
        for sub in node.body:
            if isinstance(sub, (ast.FunctionDef, ast.AsyncFunctionDef)):
                defined.append((node.name + "." + sub.name, sub.lineno))

# count all Name/Attribute references
refs = {}
for node in ast.walk(tree):
    if isinstance(node, ast.Name):
        refs[node.id] = refs.get(node.id, 0) + 1
    elif isinstance(node, ast.Attribute):
        refs[node.attr] = refs.get(node.attr, 0) + 1

out = []
for name, line in defined:
    base = name.split(".")[-1]
    # a def counts itself as a Name occurrence -> require >=2 (def + use), but 'def' isn't a Name node
    c = refs.get(base, 0)
    if c == 0:
        out.append({"name": name, "line": line, "refs": c})

# time.time() usages
tt = []
for node in ast.walk(tree):
    if isinstance(node, ast.Call):
        f = node.func
        if isinstance(f, ast.Attribute) and isinstance(f.value, ast.Name):
            if f.value.id == "time" and f.attr == "time":
                tt.append(node.lineno)

print(json.dumps({"dead": out, "time_time_lines": tt}, ensure_ascii=False, indent=2))
