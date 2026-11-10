"""Quet tinh: liet ke ham, tim dead code, bien khong dung, except:pass."""
import ast, sys, io

PATH = sys.argv[1] if len(sys.argv) > 1 else r'tool\src\xa_nofog_pro.py'
src = open(PATH, encoding='utf-8').read()
tree = ast.parse(src)
lines = src.splitlines()

funcs = {}     # name -> (lineno, endlineno, is_method)
classes = {}
imports = {}
consts = {}    # module-level assignments

for node in tree.body:
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
        funcs[node.name] = (node.lineno, node.end_lineno, False, node)
    elif isinstance(node, ast.ClassDef):
        classes[node.name] = (node.lineno, node.end_lineno, node)
        for b in node.body:
            if isinstance(b, (ast.FunctionDef, ast.AsyncFunctionDef)):
                funcs[node.name + '.' + b.name] = (b.lineno, b.end_lineno, True, b)
    elif isinstance(node, ast.Assign):
        for t in node.targets:
            if isinstance(t, ast.Name):
                consts[t.id] = node.lineno
    elif isinstance(node, (ast.Import, ast.ImportFrom)):
        for a in node.names:
            imports[(a.asname or a.name).split('.')[0]] = node.lineno

# Dem so lan ten xuat hien (khong tinh dong def)
counts = {}
for node in ast.walk(tree):
    if isinstance(node, ast.Name):
        counts[node.id] = counts.get(node.id, 0) + 1
    elif isinstance(node, ast.Attribute):
        counts[node.attr] = counts.get(node.attr, 0) + 1

print('=== %d HAM/PHUONG THUC ===' % len(funcs))
for name, (ln, end, ism, node) in sorted(funcs.items(), key=lambda x: x[1][0]):
    nargs = len(node.args.args)
    print('  %-26s %5d-%-5d args=%d  refs=%d' % (name, ln, end, nargs, counts.get(name.split('.')[-1], 0)))

print()
print('=== HAM KHONG DUOC GOI O DAU (dead code ung vien) ===')
for name, (ln, end, ism, node) in sorted(funcs.items(), key=lambda x: x[1][0]):
    short = name.split('.')[-1]
    refs = counts.get(short, 0)
    # 1 ref = chinh dong def
    if refs <= 1:
        print('  [DEAD?] %-26s line %d (refs=%d)' % (name, ln, refs))

print()
print('=== BIEN/HANG KHAI BAO O MODULE KHONG DUNG ===')
for name, ln in sorted(consts.items(), key=lambda x: x[1]):
    if counts.get(name, 0) <= 1:
        print('  [UNUSED] %-24s line %d' % (name, ln))

print()
print('=== IMPORT KHONG DUNG ===')
for name, ln in sorted(imports.items(), key=lambda x: x[1]):
    if counts.get(name, 0) == 0:
        print('  [UNUSED IMPORT] %-20s line %d' % (name, ln))

print()
print('=== except: pass / except Exception: pass (nuot loi) ===')
for node in ast.walk(tree):
    if isinstance(node, ast.ExceptHandler):
        body = node.body
        only_pass = len(body) == 1 and isinstance(body[0], ast.Pass)
        only_ret = len(body) == 1 and isinstance(body[0], ast.Return)
        if only_pass or only_ret:
            t = ast.unparse(node.type) if node.type else 'bare'
            kind = 'PASS' if only_pass else 'RETURN'
            seg = (body[0].lineno if only_pass else body[0].lineno)
            print('  line %-5d except %-22s -> %s' % (node.lineno, t, kind))

print()
print('=== KHONG DUNG: try/except boc ngoai toan bo than ham ===')
