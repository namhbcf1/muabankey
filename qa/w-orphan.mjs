import { q, q1 } from './q.mjs';

console.log('=== license_issues orphan (order không tồn tại) ===');
const o1 = await q1(`SELECT COUNT(*) n FROM license_issues i
  WHERE i.order_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.id=i.order_id)`);
console.log('  n =', o1.n);

console.log('\n=== license_issues orphan (license không tồn tại) ===');
const o2 = await q1(`SELECT COUNT(*) n FROM license_issues i
  WHERE NOT EXISTS (SELECT 1 FROM licenses l WHERE l.key=i.license_key)`);
console.log('  n =', o2.n);

console.log('\n=== product_keys còn bao nhiêu (mọi status) ===');
for (const r of await q(`SELECT status, COUNT(*) n FROM product_keys GROUP BY status`)) {
  console.log(`  ${String(r.status).padEnd(12)} ${r.n}`);
}

console.log('\n=== SePay API: transactions ===');
const S = 'H1RIWPEIYXVYVCAZ1BT9VNTLKG35XMZ0CY9FMKFEWHZFJH2LSNL6UUQGPV8OXBTA';
const r = await fetch('https://my.sepay.vn/userapi/transactions/list?limit=20', { headers: { Authorization: `Bearer ${S}` } });
const j = await r.json();
console.log('  HTTP', r.status, '| transactions:', (j.transactions || []).length, '| error:', j.error);

console.log('\n=== Bank account đã nối SePay ===');
const ra = await fetch('https://my.sepay.vn/userapi/bankaccounts/list', { headers: { Authorization: `Bearer ${S}` } });
const ja = await ra.json();
for (const b of ja.bankaccounts || []) {
  console.log(`  ${b.account_number} | ${b.bank_short_name} | ${b.account_holder_name} | active=${b.active} | created=${b.created_at} | last_txn=${b.last_transaction}`);
}
