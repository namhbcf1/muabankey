import { q, q1 } from './q.mjs';

console.log('=== ĐƠN PENDING CÒN LẠI ===');
const pend = await q(
  `SELECT o.code, o.total, o.created_at, u.username, u.full_name,
     ROUND((? - o.created_at)/60000.0) AS age_min
   FROM orders o LEFT JOIN users u ON u.id = o.user_id
   WHERE o.status='pending' ORDER BY o.created_at`,
  [Date.now()],
);
for (const r of pend) console.log(`  ${r.code} | ${r.total}đ | ${r.username || r.full_name || '?'} | ${r.age_min} phút`);

console.log('\n=== USER RÁC ===');
for (const r of await q(`SELECT
   SUM(CASE WHEN username LIKE 'qa%' OR full_name LIKE 'qa%' THEN 1 ELSE 0 END) qa,
   SUM(CASE WHEN email LIKE '%@local' THEN 1 ELSE 0 END) local,
   SUM(CASE WHEN email LIKE '%@test.vn' THEN 1 ELSE 0 END) testvn,
   SUM(CASE WHEN email LIKE '%@invalid' THEN 1 ELSE 0 END) invalid,
   COUNT(*) total FROM users`)) {
  console.log(' ', JSON.stringify(r));
}

console.log('\n=== LICENSE RÁC do QA (key bắt đầu TEST/E2E/RACE/GIFT/AUD/AB-) ===');
for (const r of await q(
  `SELECT COUNT(*) n FROM licenses WHERE key LIKE 'TEST-%' OR key LIKE 'E2E-%' OR key LIKE 'RACE-%'
     OR key LIKE 'GIFT-%' OR key LIKE 'AUD-%' OR key LIKE 'AB-%'`)) {
  console.log('  n =', r.n);
}

console.log('\n=== ĐƠN/PAYMENT THẬT (is_test=0) ===');
const real = await q(`SELECT order_code, amount, state, method, at FROM payments WHERE COALESCE(is_test,0)=0 ORDER BY at DESC`);
for (const r of real) console.log(`  ${new Date(r.at * 1000).toISOString()} ${String(r.amount).padStart(9)} ${String(r.state).padEnd(13)} ${String(r.method).padEnd(7)} ${r.order_code || '-'}`);

console.log('\n=== DOUBLE-WRITE còn không? ===');
const dw = await q(
  `SELECT o.code FROM orders o
   WHERE EXISTS (SELECT 1 FROM payments p WHERE p.order_id=o.id AND p.confirmed_by='sepay-window')
     AND EXISTS (SELECT 1 FROM payments p3 WHERE p3.order_id=o.id AND p3.method='manual' AND p3.txn_ref IS NULL)`,
);
console.log('  n =', dw.length);

console.log('\n=== ORDERS THEO STATUS ===');
for (const r of await q(`SELECT status, COUNT(*) n FROM orders GROUP BY status ORDER BY n DESC`)) console.log(`  ${String(r.status).padEnd(14)} ${r.n}`);

console.log('\n=== PAYMENTS THEO STATE ===');
for (const r of await q(`SELECT state, COUNT(*) n, COALESCE(SUM(amount),0) s FROM payments GROUP BY state`)) console.log(`  ${String(r.state).padEnd(14)} n=${String(r.n).padStart(3)} ${Number(r.s).toLocaleString()}đ`);

console.log('\n=== SETTINGS ===');
for (const s of await q(`SELECT key,value FROM settings WHERE key LIKE 'sepay_auto%' OR key LIKE 'bank%' ORDER BY key`)) console.log(`  ${s.key} = ${s.value}`);
