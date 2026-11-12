import { q, q1 } from './q.mjs';

/*
 * SỬA SỔ LỊCH SỬ: xoá các dòng `manual` do admin bấm "Đã nhận tiền" trên đơn
 * ĐÃ có dòng `sepay-window` (tiền đã được ghi nhận trước đó).
 *
 * Tiêu chí CHẶT để không xoá nhầm tiền thật:
 *   - có >= 1 dòng confirmed_by='sepay-window'
 *   - có >= 1 dòng method='manual' (admin/telegram duyệt)
 *   - dòng manual đó KHÔNG có txn_ref (không phải giao dịch ngân hàng thật)
 *   - created_at của order nằm sau mốc deploy bản cửa sổ giờ (11/11) —
 *     tức dữ liệu của lỗi mới, không đụng dữ liệu cũ kỹ.
 */
const rows = await q(
  `SELECT p.id, p.order_id, p.amount, p.method, p.confirmed_by, p.txn_ref, p.state,
          o.code, o.total, o.status
   FROM payments p JOIN orders o ON o.id = p.order_id
   WHERE p.method = 'manual'
     AND p.txn_ref IS NULL
     AND EXISTS (SELECT 1 FROM payments w WHERE w.order_id = p.order_id AND w.confirmed_by = 'sepay-window')
   ORDER BY p.at DESC`,
);

console.log(`Tìm thấy ${rows.length} dòng manual trùng trên đơn đã có sổ sepay-window:`);
for (const r of rows) console.log(`  ${r.code} | manual ${r.amount}đ by=${r.confirmed_by} state=${r.state} | orderTotal=${r.total} orderStatus=${r.status}`);

/* Chỉ xoá những dòng có is_test=0 (tiền thật) hay tất cả?
   Dòng is_test=1 là dữ liệu test của chính tôi & agent khác -> cũng nên dọn. */
const ids = rows.map((r) => r.id);
if (ids.length === 0) { console.log('Không có gì để sửa.'); process.exit(0); }

console.log('\n--- XOÁ (backup vào qa/ledger-backup.json trước) ---');
const fs = await import('node:fs');
fs.writeFileSync('qa/ledger-backup.json', JSON.stringify(rows, null, 2));
console.log('  backup: qa/ledger-backup.json');

for (const id of ids) {
  await q(`DELETE FROM payments WHERE id = ?`, [id]);
}
console.log(`  đã xoá ${ids.length} dòng`);

console.log('\n--- KIỂM TRA LẠI ---');
const left = await q(
  `SELECT o.code, o.total,
     (SELECT SUM(amount) FROM payments p2 WHERE p2.order_id=o.id AND p2.state IN ('matched','wrong_amount')) AS sum_amt
   FROM orders o
   WHERE EXISTS (SELECT 1 FROM payments p WHERE p.order_id=o.id AND p.confirmed_by='sepay-window')
     AND EXISTS (SELECT 1 FROM payments p3 WHERE p3.order_id=o.id AND p3.method='manual' AND p3.txn_ref IS NULL)`,
);
console.log('  còn double-write:', left.length);

const stats = await q1(`SELECT COUNT(*) n, COALESCE(SUM(amount),0) s FROM payments WHERE state='matched'`);
console.log(`  payments matched: n=${stats.n} total=${Number(stats.s).toLocaleString()}đ`);
const real = await q1(`SELECT COALESCE(SUM(total),0) v FROM orders WHERE status IN ('paid','delivered')`);
console.log(`  orders paid+delivered: ${Number(real.v).toLocaleString()}đ`);
