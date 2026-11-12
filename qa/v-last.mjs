import { q, q1 } from './q.mjs';

const u = await q1(`SELECT id, username FROM users WHERE username LIKE 'qa%' OR full_name LIKE 'qa%'`);
console.log('còn lại:', JSON.stringify(u));
if (u) {
  const ph = [u.id];
  await q(`DELETE FROM lic_events WHERE key IN (SELECT license_key FROM license_issues WHERE user_id=?)`, ph);
  await q(`DELETE FROM license_issues WHERE user_id=?`, ph);
  await q(`DELETE FROM payments WHERE order_id IN (SELECT id FROM orders WHERE user_id=?)`, ph);
  await q(`DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE user_id=?)`, ph);
  await q(`DELETE FROM orders WHERE user_id=?`, ph);
  await q(`DELETE FROM sessions WHERE user_id=?`, ph);
  await q(`DELETE FROM users WHERE id=?`, ph);
  console.log('đã xoá', u.username);
}

console.log('\n=== KIỂM TRA LẠI ===');
console.log('users:', (await q1('SELECT COUNT(*) n FROM users')).n);
console.log('user QA:', (await q1(`SELECT COUNT(*) n FROM users WHERE username LIKE 'qa%' OR full_name LIKE 'qa%'`)).n);
console.log('orders pending:', (await q1(`SELECT COUNT(*) n FROM orders WHERE status='pending'`)).n);
const nowMs = Date.now();
console.log('pending >2h:', (await q1(`SELECT COUNT(*) n FROM orders WHERE status='pending' AND created_at < ?`, [nowMs - 2 * 3600_000])).n);
console.log('payments TEST*:', (await q1(`SELECT COUNT(*) n FROM payments WHERE txn_ref LIKE 'TEST%'`)).n);

console.log('\n=== ORDERS STATUS ===');
for (const r of await q(`SELECT status, COUNT(*) n FROM orders GROUP BY status ORDER BY n DESC`)) console.log(`  ${String(r.status).padEnd(12)} ${r.n}`);

console.log('\n=== PAYMENTS theo state (thật vs test) ===');
for (const r of await q(
  `SELECT state,
     SUM(CASE WHEN COALESCE(is_test,0)=0 THEN 1 ELSE 0 END) real_n,
     SUM(CASE WHEN COALESCE(is_test,0)=0 THEN amount ELSE 0 END) real_s,
     SUM(CASE WHEN COALESCE(is_test,0)=1 THEN 1 ELSE 0 END) test_n
   FROM payments GROUP BY state`)) {
  console.log(`  ${String(r.state).padEnd(13)} thật=${String(r.real_n).padStart(3)} (${Number(r.real_s).toLocaleString()}đ)  test=${r.test_n}`);
}
