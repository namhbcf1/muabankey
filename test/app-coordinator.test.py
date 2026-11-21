# -*- coding: utf-8 -*-
"""app-coordinator.test.py — State machine của app: quyền đã mua TRƯỚC, trial SAU.

Khoá lỗi P0 F06:
  * `ensure_grant_token()` gọi thẳng `start_account_trial()` — xin DÙNG THỬ
    thay vì đọc quyền đã mua, nên khách đã trả tiền nhận `trial_used_before`
    hoặc `trial_expired` và không lấy được token.
  * `_on_login_required()` bật dùng thử ngay sau khi đăng nhập, kể cả khách
    vừa mua gói.
  * `_maybe_free_trial()` chỉ xét license mô hình cũ nên không thấy quyền
    của mô hình mới.

Chạy:  python test/app-coordinator.test.py
Không cần Qt, không cần mạng — chỉ kiểm logic quyết định.
"""
import ast
import os
import sys

# Console Windows hay dùng cp1252 -> ép UTF-8 để in được tiếng Việt và ký tự khung.
try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

pass_n = 0
fail_n = 0
failures = []


def ok(cond, label, detail=''):
    global pass_n, fail_n
    if cond:
        pass_n += 1
        print('  [OK] %s' % label)
    else:
        fail_n += 1
        failures.append('%s%s' % (label, (' - ' + detail) if detail else ''))
        print('  [FAIL] %s%s' % (label, (' - ' + detail) if detail else ''))


def section(t):
    print('\n-- %s' % t)


def read(path):
    with open(os.path.join(ROOT, path), encoding='utf-8') as f:
        return f.read()


def func_src(src, name):
    """Trả mã nguồn của một hàm (kể cả method trong class). Dùng AST."""
    tree = ast.parse(src)
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == name:
            return ast.get_source_segment(src, node) or ''
    return ''


# ======================================================================
section('F06 — ensure_grant_token phải đọc quyền đã mua TRƯỚC khi xin trial')

api = read('tool/app/xa_arena_api.py')
grant_fn = func_src(api, 'ensure_grant_token')

ok(grant_fn != '', 'tìm thấy ensure_grant_token()')

# Bỏ comment trước khi soát thứ tự thật.
code_lines = [ln for ln in grant_fn.splitlines()
              if ln.strip() and not ln.strip().startswith('#')]
code = '\n'.join(code_lines)

i_fetch = code.find('fetch_account_token()')
i_trial = code.find('start_account_trial()')

ok(i_fetch >= 0, 'có gọi fetch_account_token() (đường ĐỌC quyền)')
ok(i_trial >= 0, 'có gọi start_account_trial() (đường dùng thử)')
ok(i_fetch < i_trial,
   'fetch_account_token() đứng TRƯỚC start_account_trial()',
   'fetch@%d trial@%d' % (i_fetch, i_trial))

ok("r.get('state') == 'no_entitlement'" in code
   or 'state\') == \'no_entitlement\'' in code,
   'dùng trial CHỈ KHI server trả no_entitlement',
   'phải có điều kiện no_entitlement')

ok('set_last_code(' in code, 'có ghi mã lỗi để app hiện đúng nguyên nhân')

# ======================================================================
section('F06 — _on_login_required KHÔNG được bật trial ngay')

gui = read('tool/app/xa_arena_gui.py')
login_fn = func_src(gui, '_on_login_required')

ok(login_fn != '', 'tìm thấy _on_login_required()')

login_code = '\n'.join(
    ln for ln in login_fn.splitlines()
    if ln.strip() and not ln.strip().startswith('#'))

ok('_start_free_trial()' not in login_code,
   'không gọi _start_free_trial() ngay sau khi đăng nhập')
ok('_refresh_entitlement()' in login_code,
   'gọi _refresh_entitlement() để ĐỌC quyền trước')

# ======================================================================
section('F06 — _maybe_free_trial phải thấy quyền của MÔ HÌNH MỚI')

maybe = func_src(gui, '_maybe_free_trial')
ok(maybe != '', 'tìm thấy _maybe_free_trial()')

maybe_code = '\n'.join(
    ln for ln in maybe.splitlines()
    if ln.strip() and not ln.strip().startswith('#'))

ok("hasNofog" in maybe_code and "hasGrant" in maybe_code,
   'xét hasNofog/hasGrant (quyền của mô hình mới)',
   'thiếu điều kiện quyền mới')
ok('has_paid_licence' in maybe_code,
   'vẫn giữ điều kiện license cũ (khách bản cũ)')

# ======================================================================
section('F06 — _refresh_entitlement không tự xin trial khi đã có phiên')

refresh_fn = func_src(gui, '_refresh_entitlement')
refresh_code = '\n'.join(
    ln for ln in refresh_fn.splitlines()
    if ln.strip() and not ln.strip().startswith('#'))

ok('need_free = False' in refresh_code,
   'need_free không còn suy từ "có phiên mà chưa có token"',
   'phải đặt need_free = False và để _on_entitlement quyết')

# ======================================================================
section('Cú pháp Python của các file đã sửa')

for path in ('tool/app/xa_arena_api.py', 'tool/app/xa_arena_gui.py',
             'tool/app/xa_arena_app.py'):
    try:
        ast.parse(read(path))
        ok(True, 'cú pháp hợp lệ: %s' % path)
    except SyntaxError as e:
        ok(False, 'cú pháp hợp lệ: %s' % path, str(e))

# ======================================================================
section('Không còn hàm bị mất sau khi sửa')

for name in ('_post_json', 'ensure_tokens', 'ensure_grant_token',
             'fetch_account_token', 'start_account_trial', 'token_ok',
             'session_cookie', 'set_last_code'):
    ok(func_src(api, name) != '', 'xa_arena_api.py còn %s()' % name)

tree = ast.parse(api)
top = [n.name for n in tree.body if isinstance(n, ast.FunctionDef)]
dups = set(n for n in top if top.count(n) > 1)
ok(not dups, 'không có định nghĩa trùng', ', '.join(sorted(dups)))

# ======================================================================
print('\n' + '=' * 58)
total = pass_n + fail_n
print('Coordinator app: %d kiem tra | OK %d | FAIL %d' % (total, pass_n, fail_n))
if fail_n:
    print('\nLoi:')
    for f in failures:
        print('  - %s' % f)
print('=' * 58)
sys.exit(0 if fail_n == 0 else 1)
