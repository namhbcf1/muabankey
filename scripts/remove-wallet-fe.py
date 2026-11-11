# -*- coding: utf-8 -*-
"""Bỏ ví khỏi frontend: state, app, components, account, admin."""
import pathlib
import re

root = pathlib.Path(__file__).resolve().parent.parent / 'public' / 'assets'

# ============ state.js ============
f = root / 'state.js'
s = f.read_text(encoding='utf-8')
# Xoá refreshBalance + updateBalanceChip
for pat in [
    r'export async function refreshBalance\(\)\s*\{.*?\n\}\n',
    r'export function updateBalanceChip\([^)]*\)\s*\{.*?\n\}\n',
]:
    m = re.search(pat, s, re.S)
    if m:
        s = s[:m.start()] + s[m.end():]
        print(f'✓ state.js: xoá {pat[:35]}')
f.write_text(s, encoding='utf-8')

# ============ app.js ============
f = root / 'app.js'
s = f.read_text(encoding='utf-8')
# Bỏ import wallet route
s = s.replace("import { renderWallet, mountWallet } from './pages/wallet.js';\n", '')
# Bỏ route /wallet -> redirect sang /orders
s = s.replace(
    "  { pattern: /^\\/wallet$/, render: renderWallet, mount: mountWallet },",
    "  // /wallet không còn — trang nạp tiền đã bỏ. Chuyển khách sang đơn hàng.\n"
    "  { pattern: /^\\/wallet$/, render: renderOrders, mount: mountOrders },")
# Bỏ refreshBalance khỏi import
s = re.sub(r',\s*refreshBalance', '', s)
s = s.replace('refreshBalance, ', '')
# Bỏ interval + visibilitychange
s = re.sub(r'\s*setInterval\(refreshBalance[^;]*;\n', '\n', s)
s = re.sub(r'\s*refreshBalance\(\);\n', '\n', s)
f.write_text(s, encoding='utf-8')
print('✓ app.js: bỏ route/interval ví')

# ============ components.js ============
f = root / 'components.js'
s = f.read_text(encoding='utf-8')
# Bỏ chip số dư (khối balance-chip)
m = re.search(r'\s*<[^>]*id="balance-chip".*?</[^>]+>\s*\n', s, re.S)
if m:
    s = s[:m.start()] + '\n' + s[m.end():]
    print('✓ components.js: bỏ balance-chip')
# Bỏ link Nạp tiền (desktop + mobile)
s = re.sub(
    r'\s*<a href="#/wallet"[^>]*>.*?</a>',
    '', s, flags=re.S)
# Bỏ import refreshBalance
s = re.sub(r',\s*refreshBalance', '', s)
f.write_text(s, encoding='utf-8')
print('✓ components.js: bỏ link Nạp tiền')

# ============ account.js: bỏ metric số dư ============
f = root / 'pages' / 'account.js'
s = f.read_text(encoding='utf-8')
# Bỏ metric "Số dư ví"
m = re.search(r'\s*\{[^{}]*Số dư ví[^{}]*\},?\n', s)
if m:
    s = s[:m.start()] + '\n' + s[m.end():]
    print('✓ account.js: bỏ metric số dư')
# Bỏ nút "Nạp tiền vào ví"
s = re.sub(r'\s*<[^>]*data-goto="/wallet"[^>]*>.*?</[^>]+>', '', s, flags=re.S)
s = re.sub(r'\s*<button[^>]*>[^<]*Nạp tiền[^<]*</button>', '', s)
f.write_text(s, encoding='utf-8')
print('✓ account.js: bỏ nút nạp tiền')

# ============ admin.js: bỏ cột số dư + nút adjust ============
f = root / 'pages' / 'admin.js'
s = f.read_text(encoding='utf-8')
# Bỏ <th>Số dư</th>
s = s.replace('<th>Số dư</th>', '')
# Bỏ <td> balance
s = re.sub(r'\s*<td>\$\{fmtVnd\(u\.balance\)\}</td>', '', s)
# Bỏ nút điều chỉnh số dư
s = re.sub(r'\s*<button[^>]*data-adj[^>]*>[^<]*</button>', '', s)
f.write_text(s, encoding='utf-8')
print('✓ admin.js: bỏ cột/nút số dư')
