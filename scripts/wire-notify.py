# -*- coding: utf-8 -*-
"""Chèn notifyTopup vào các nhánh cộng tiền của webhook."""
import re
from pathlib import Path

f = Path(__file__).resolve().parent.parent / 'src' / 'routes' / 'wallet.js'
s = f.read_text(encoding='utf-8')

NOTIFY = """
  // Thông báo Telegram (không chặn luồng nếu lỗi)
  try {
    const { notifyTopup } = await import('../lib/telegram.js');
    const u = await env.DB.prepare('SELECT email, full_name, balance FROM users WHERE id = ?')
      .bind(topup.user_id).first();
    await notifyTopup(env, {
      topup, email: u?.email, customer: u?.full_name,
      received: amountIn, via: '%VIA%', ref, balanceBefore: u?.balance, matched: true,
    });
  } catch (e) { console.error('tg notify:', e && e.message); }
"""

# Nhánh payOS paid
old_payos_paid = """  await audit(env, null, 'topup.paid', topup.id, {
    amount: credited, ref, excess, via: 'payos', orderCode: data.orderCode,
  });
"""
new_payos_paid = old_payos_paid + NOTIFY.replace('%VIA%', 'payos')
if old_payos_paid in s:
    s = s.replace(old_payos_paid, new_payos_paid, 1)
    print('✓ payOS paid')
else:
    print('✗ payOS paid')

# Nhánh payOS partial
old_payos_part = "    await audit(env, null, 'topup.partial', topup.id, { expected: topup.amount, received: amountIn, via: 'payos' });"
if old_payos_part in s:
    s = s.replace(old_payos_part, old_payos_part + NOTIFY.replace('%VIA%', 'payos').replace('  ', '    ', 1), 1)
    print('✓ payOS partial')
else:
    print('✗ payOS partial')

# Nhánh SePay paid (dòng ~644)
old_sepay_paid = "  await audit(env, null, 'topup.paid', topup.id, { amount: credited, ref, excess: excess || 0 });"
count = s.count(old_sepay_paid)
if count > 0:
    s = s.replace(old_sepay_paid, old_sepay_paid + NOTIFY.replace('%VIA%', 'sepay'), 1)
    print(f'✓ SePay paid (còn {count - 1} chỗ khác)')
else:
    print('✗ SePay paid')

# Nhánh SePay partial
old_sepay_part = "    await audit(env, null, 'topup.partial', topup.id, { expected: topup.amount, received: amountIn });"
count2 = s.count(old_sepay_part)
if count2 > 0:
    s = s.replace(old_sepay_part, old_sepay_part + NOTIFY.replace('%VIA%', 'sepay').replace('  ', '    ', 1), 1)
    print(f'✓ SePay partial (còn {count2 - 1} chỗ khác)')
else:
    print('✗ SePay partial')

f.write_text(s, encoding='utf-8')

final = f.read_text(encoding='utf-8')
print('')
print('So lan goi notifyTopup:', final.count('notifyTopup(env, {'))
