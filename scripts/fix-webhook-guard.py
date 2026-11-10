# -*- coding: utf-8 -*-
"""Fix P1-5: SePay webhook thiếu idempotency guard + P1-4 partial cộng đôi."""
from pathlib import Path

f = Path(__file__).resolve().parent.parent / 'src' / 'routes' / 'wallet.js'
s = f.read_text(encoding='utf-8')

report = []

# ---- P1-5: thêm guard AND status != 'paid' cho SePay ----
repls = [
    # partial
    ("await env.DB.prepare(\"UPDATE topups SET status='partial', txn_ref = ? WHERE id = ?\")",
     "await env.DB.prepare(\"UPDATE topups SET status='partial', txn_ref = ? WHERE id = ? AND status != 'paid'\")"),
    # paid
    ("await env.DB.prepare(\"UPDATE topups SET status='paid', txn_ref = ?, paid_at = ? WHERE id = ?\")",
     "await env.DB.prepare(\"UPDATE topups SET status='paid', txn_ref = ?, paid_at = ? WHERE id = ? AND status != 'paid'\")"),
]

for old, new in repls:
    n = s.count(old)
    if n:
        s = s.replace(old, new)
        report.append(f'✓ thêm guard: {n} chỗ  ({old[:52]}...)')
    else:
        report.append(f'· không thấy: {old[:52]}')

# Kiểm tra kết quả update có thành công không -> nếu không thì dừng
# Tìm khối partial của SePay và thêm kiểm tra changes
old_partial_block = """  if (amountIn < topup.amount) {
    const credited = Math.floor(amountIn);
    await env.DB.prepare("UPDATE topups SET status='partial', txn_ref = ? WHERE id = ? AND status != 'paid'")
      .bind(ref, topup.id).run();"""

new_partial_block = """  if (amountIn < topup.amount) {
    const credited = Math.floor(amountIn);
    // Guard: chỉ cộng nếu thực sự chuyển được sang 'partial'.
    // Thiếu guard -> webhook retry hoặc 2 webhook song song cộng tiền nhiều lần.
    const claimPartial = await env.DB.prepare(
      "UPDATE topups SET status='partial', txn_ref = ? WHERE id = ? AND status != 'paid'"
    ).bind(ref, topup.id).run();
    if (!claimPartial.meta || claimPartial.meta.changes !== 1) {
      return ok({ matched: true, duplicated: true, reason: 'RACE_ALREADY_PAID' });
    }"""

if old_partial_block in s:
    s = s.replace(old_partial_block, new_partial_block, 1)
    report.append('✓ partial: thêm kiểm tra claim.meta.changes')
else:
    report.append('· partial block: không khớp chính xác')

# Khối paid của SePay
old_paid_block = """  const credited = topup.amount;
  const excess = Math.floor(amountIn) - topup.amount;

  await env.DB.prepare("UPDATE topups SET status='paid', txn_ref = ?, paid_at = ? WHERE id = ? AND status != 'paid'")
    .bind(ref, now, topup.id).run();"""

new_paid_block = """  const credited = topup.amount;
  const excess = Math.floor(amountIn) - topup.amount;

  const claimPaid = await env.DB.prepare(
    "UPDATE topups SET status='paid', txn_ref = ?, paid_at = ? WHERE id = ? AND status != 'paid'"
  ).bind(ref, now, topup.id).run();
  if (!claimPaid.meta || claimPaid.meta.changes !== 1) {
    return ok({ matched: true, duplicated: true, reason: 'RACE_ALREADY_PAID' });
  }"""

if old_paid_block in s:
    s = s.replace(old_paid_block, new_paid_block, 1)
    report.append('✓ paid: thêm kiểm tra claim.meta.changes')
else:
    report.append('· paid block: không khớp chính xác')

f.write_text(s, encoding='utf-8')

for r in report:
    print(r)

final = f.read_text(encoding='utf-8')
print('')
print('SePay guard paid   :', final.count("status != 'paid'"))
print('claimPartial       :', 'claimPartial' in final)
print('claimPaid          :', 'claimPaid' in final)
