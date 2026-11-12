import { q, q1 } from './q.mjs';

const rows = await q(
  `SELECT id, order_id, order_code, amount, expected, method, txn_ref, content, state,
          confirmed_by, raw, at, is_test FROM payments WHERE state='unmatched' AND COALESCE(is_test,0)=0`,
);
for (const r of rows) {
  console.log('=== REAL UNMATCHED ===');
  console.log('  id       :', r.id);
  console.log('  amount   :', r.amount, '(' + Number(r.amount).toLocaleString() + 'đ)');
  console.log('  content  :', JSON.stringify(r.content));
  console.log('  txn_ref  :', r.txn_ref);
  console.log('  at       :', new Date(r.at * 1000).toISOString());
  console.log('  method   :', r.method, '| confirmed_by:', r.confirmed_by);
  console.log('  raw      :', String(r.raw || '').slice(0, 600));
}

console.log('\n=== Orders quanh thời điểm đó (1.800.000đ) ===');
const near = await q(
  `SELECT code, status, total, created_at, user_id FROM orders
   WHERE created_at BETWEEN ? AND ? ORDER BY created_at`,
  [(rows[0]?.at - 7200) * 1000, (rows[0]?.at + 7200) * 1000],
);
for (const o of near) console.log(`  ${o.code} ${o.status} ${o.total}đ ${new Date(o.created_at).toISOString()}`);

console.log('\n=== Có order nào total=1800000 không? ===');
for (const o of await q(`SELECT code, status, total, created_at FROM orders WHERE total = 1800000`)) {
  console.log(`  ${o.code} ${o.status} ${o.total} ${new Date(o.created_at).toISOString()}`);
}

console.log('\n=== payments gần đó (mọi state) ===');
for (const p of await q(
  `SELECT order_code, amount, state, txn_ref, content, at FROM payments
   WHERE at BETWEEN ? AND ? ORDER BY at`,
  [rows[0].at - 3600, rows[0].at + 3600],
)) {
  console.log(`  ${new Date(p.at * 1000).toISOString()} ${String(p.amount).padStart(8)} ${String(p.state).padEnd(13)} ${p.order_code || '-'} ref=${p.txn_ref} "${String(p.content || '').slice(0, 30)}"`);
}

console.log('\n=== Tổng unmatched thật theo thời gian ===');
for (const r of await q(`SELECT date(at,'unixepoch') d, COUNT(*) n, SUM(amount) s FROM payments WHERE state='unmatched' AND COALESCE(is_test,0)=0 GROUP BY d`)) {
  console.log(`  ${r.d} n=${r.n} ${Number(r.s).toLocaleString()}đ`);
}
