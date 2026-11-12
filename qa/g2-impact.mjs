import { q, q1 } from './q.mjs';

console.log('=== ORDERS có >1 dòng payment (matched/wrong_amount) ===');
const multi = await q(
  `SELECT p.order_id, o.code, o.total, o.status,
          COUNT(*) AS rows,
          SUM(p.amount) AS sum_amt,
          GROUP_CONCAT(p.state || ':' || p.amount || ':' || p.method || ':' || COALESCE(p.confirmed_by,'') || ':' || COALESCE(p.is_test,0), ' | ') AS detail
   FROM payments p JOIN orders o ON o.id = p.order_id
   WHERE p.state IN ('matched','wrong_amount')
   GROUP BY p.order_id HAVING COUNT(*) > 1
   ORDER BY o.created_at DESC LIMIT 40`,
);
console.log('  count:', multi.length);
for (const r of multi) {
  const inflated = Number(r.sum_amt) - Number(r.total);
  const real = r.detail.includes('sepay-window') && r.detail.includes('manual');
  console.log(`  ${r.code} total=${String(r.total).padStart(8)} rows=${r.rows} sum=${String(r.sum_amt).padStart(9)} diff=${String(inflated).padStart(9)} ${ideal(r)} ${r.detail}`);
}
function ideal(r) { return r.detail.includes('sepay-window') && (r.detail.includes('manual') || r.detail.includes('telegram')) ? '<<< DOUBLE-WRITE' : ''; }

const multiCnt = await q1(
  `SELECT COUNT(*) AS n FROM (SELECT p.order_id FROM payments p
    WHERE p.state IN ('matched','wrong_amount') GROUP BY p.order_id HAVING COUNT(*) > 1)`,
);
console.log('\n  TỔNG số đơn có nhiều dòng payment:', multiCnt?.n);

console.log('\n=== Tác động lên thống kê /api/admin/payments (stats.matched.total) ===');
const stats = await q1(`SELECT COUNT(*) AS n, COALESCE(SUM(amount),0) AS total FROM payments WHERE state='matched'`);
console.log(`  payments.state='matched' -> n=${stats.n} total=${Number(stats.total).toLocaleString()}đ`);

const realRevenue = await q1(`SELECT COALESCE(SUM(total),0) AS v FROM orders WHERE status IN ('paid','delivered')`);
console.log(`  orders thực thu (paid+delivered) -> ${Number(realRevenue.v).toLocaleString()}đ`);
console.log(`  LỆCH: ${(Number(stats.total) - Number(realRevenue.v)).toLocaleString()}đ (gồm cả test + double-write)`);

console.log('\n=== Chỉ đơn THẬT (is_test=0) ===');
const realStats = await q1(`SELECT COALESCE(SUM(amount),0) AS total FROM payments WHERE state='matched' AND COALESCE(is_test,0)=0`);
console.log(`  matched thật (is_test=0) total = ${Number(realStats.total).toLocaleString()}đ`);

console.log('\n=== Đơn thật có double-write (sepay-window + manual/telegram) ===');
const dw = await q(
  `SELECT o.code, o.total,
     (SELECT SUM(amount) FROM payments p2 WHERE p2.order_id=o.id AND p2.state IN ('matched','wrong_amount')) AS sum_amt
   FROM orders o
   WHERE EXISTS (SELECT 1 FROM payments p WHERE p.order_id=o.id AND p.confirmed_by='sepay-window')
     AND EXISTS (SELECT 1 FROM payments p3 WHERE p3.order_id=o.id AND p3.method IN ('manual','telegram'))
   ORDER BY o.created_at DESC`,
);
console.log('  n =', dw.length);
for (const r of dw) console.log(`   ${r.code} total=${r.total} sổ=${r.sum_amt} ảo=+${Number(r.sum_amt) - Number(r.total)}đ`);
