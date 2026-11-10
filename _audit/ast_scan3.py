"""Quet lan 3: tinh ca module-level + attribute access."""
import ast, sys

PATH = sys.argv[1] if len(sys.argv) > 1 else r'tool\src\xa_nofog_pro.py'
src = open(PATH, encoding='utf-8').read()
tree = ast.parse(src)

# Toan bo file: dem Load cua Name + attribute name + string refs
loads = {}
attr_loads = {}
for n in ast.walk(tree):
    if isinstance(n, ast.Name) and isinstance(n.ctx, ast.Load):
        loads[n.id] = loads.get(n.id, 0) + 1
    elif isinstance(n, ast.Attribute):
        attr_loads[n.attr] = attr_loads.get(n.attr, 0) + 1

def total(name):
    return loads.get(name, 0) + attr_loads.get(name, 0)

funcs = {}
for node in ast.walk(tree):
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
        funcs[getattr(node, 'name')] = node

print('=== DEAD CODE THAT SU (khong Name-load, khong attribute-load) ===')
for name, fn in sorted(funcs.items(), key=lambda x: x[1].lineno):
    if total(name) == 0 and name not in ('run', '__init__'):
        print('  %-24s line %d-%d' % (name, fn.lineno, fn.end_lineno))

print()
print('=== HANG SO MODULE KHONG DUNG ===')
assigned = set()
for node in tree.body:
    if isinstance(node, ast.Assign):
        for t in node.targets:
            if isinstance(t, ast.Name):
                assigned.add((t.id, node.lineno))
for nm, ln in sorted(assigned, key=lambda x: x[1]):
    # tru chinh lan gan (Store khong tinh) -> chi can xet Load/attr
    if total(nm) == 0:
        print('  %-20s line %d' % (nm, ln))

print()
print('=== GHI CHU: global _mutex_handle duoc dung qua global statement ===')
for n in ast.walk(tree):
    if isinstance(n, ast.Global):
        print('  line %d: global %s' % (n.lineno, ', '.join(n.names)))

print()
print('=== SO SANH: sort key lambda trong run() ===')
for n in ast.walk(tree):
    if isinstance(n, ast.Lambda):
        print('  line %d: %s' % (n.lineno, ast.unparse(n)))
