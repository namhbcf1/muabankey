"""Quet chinh xac: dead code that su, nhanh khong bao gio chay, bien cuc bo khong dung."""
import ast, sys

PATH = sys.argv[1] if len(sys.argv) > 1 else r'tool\src\xa_nofog_pro.py'
src = open(PATH, encoding='utf-8').read()
tree = ast.parse(src)
lines = src.splitlines()

# ---- dem ten duoc DUNG (Load/Store khac dong def) ----
used_names = {}
def walk_uses(fn):
    for n in ast.walk(fn):
        if isinstance(n, ast.Name) and isinstance(n.ctx, ast.Load):
            used_names[n.id] = used_names.get(n.id, 0) + 1
        elif isinstance(n, ast.Attribute):
            pass

top_funcs = {}
for node in tree.body:
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
        top_funcs[node.name] = node
        walk_uses(node)
    elif isinstance(node, ast.ClassDef):
        for b in node.body:
            if isinstance(b, (ast.FunctionDef, ast.AsyncFunctionDef)):
                top_funcs[node.name + '.' + b.name] = b
                walk_uses(b)

# import names
imp = {}
for node in tree.body:
    if isinstance(node, (ast.Import, ast.ImportFrom)):
        for a in node.names:
            imp[(a.asname or a.name).split('.')[0]] = node.lineno

print('=== DEAD CODE THAT SU (0 lan goi) ===')
found = False
for name, fn in sorted(top_funcs.items(), key=lambda x: x[1].lineno):
    short = name.split('.')[-1]
    if used_names.get(short, 0) == 0:
        # bo qua entry point + dunder
        if short in ('run', '__init__', '__main__'):
            continue
        print('  %-24s line %d-%d' % (name, fn.lineno, fn.end_lineno))
        found = True
if not found:
    print('  (khong co)')

print()
print('=== DUNG 1 LAN (chi 1 call site - can kiem tra) ===')
for name, fn in sorted(top_funcs.items(), key=lambda x: x[1].lineno):
    short = name.split('.')[-1]
    if used_names.get(short, 0) == 1 and short not in ('run', '__init__'):
        print('  %-24s line %d' % (name, fn.lineno))

print()
print('=== IMPORT KHONG DUNG ===')
for name, ln in sorted(imp.items(), key=lambda x: x[1]):
    if used_names.get(name, 0) == 0:
        print('  %-16s line %d' % (name, ln))

print()
print('=== HANG SO MODULE KHONG DUNG ===')
for node in tree.body:
    if isinstance(node, ast.Assign):
        for t in node.targets:
            if isinstance(t, ast.Name) and used_names.get(t.id, 0) == 0:
                print('  %-20s line %d' % (t.id, node.lineno))

print()
print('=== BIEN CUC BO GAN MA KHONG DOC (moi ham) ===')
for name, fn in sorted(top_funcs.items(), key=lambda x: x[1].lineno):
    stores, loads = {}, {}
    for n in ast.walk(fn):
        if isinstance(n, ast.Name):
            if isinstance(n.ctx, ast.Store):
                stores.setdefault(n.id, n.lineno)
            elif isinstance(n.ctx, ast.Load):
                loads[n.id] = loads.get(n.id, 0) + 1
        elif isinstance(n, ast.arg):
            loads[n.arg] = loads.get(n.arg, 0) + 1
    dead = [(k, v) for k, v in stores.items() if loads.get(k, 0) == 0 and not k.startswith('_')]
    if dead:
        for k, v in dead:
            print('  %-24s bien %-14s line %d' % (name, k, v))

print()
print('=== NHANH IF LUON FALSE/TRUE (hang so) ===')
for n in ast.walk(tree):
    if isinstance(n, ast.If):
        try:
            v = ast.literal_eval(n.test)
        except Exception:
            continue
        print('  line %d: if %r -> nhanh %s chet' % (n.lineno, v, 'TRUE' if not v else 'FALSE'))
