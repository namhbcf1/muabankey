import * as L from './_qr_lib.mjs';

// 1) Tách tiền unmatched/wrong_amount do AUDIT tạo vs có từ TRƯỚC
const auditTags = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'B7', 'B8', 'B9', 'B10', 'B11', 'B12', 'B13',
  'C13', 'C14', 'C16', 'C17', 'C18', 'D19', 'D20', 'D21', 'D22', 'D23', 'D24', 'D25', 'E26', 'E29',
  'F33', 'G1', 'G2', 'G3', 'G4', 'H1', 'H2', 'I1', 'I2', 'I4', 'J4', 'PROBE'];
const cond = auditTags.map((t) => `txn_ref LIKE '${t}-%' OR txn_ref LIKE '${t}%'`).join(' OR ');

console.log('=== unmatched/wrong_amount: TÁCH audit vs TRƯỚC ĐÓ ===');
console.log(JSON.stringify(L.q1(
  `SELECT state,
          SUM(CASE WHEN (${cond}) THEN 1 ELSE 0 END) AS audit_n,
          SUM(CASE WHEN (${cond}) THEN 0 ELSE 1 END) AS cu_n,
          SUM(CASE WHEN (${cond}) THEN 0 ELSE amount END) AS cu_tien
     FROM payments WHERE state IN ('unmatched','wrong_amount') GROUP BY state`), null, 1));

console.log('\n=== các dòng CÓ TỪ TRƯỚC đợt audit (tiền thật cần đối soát) ===');
console.log(JSON.stringify(L.q1(
  `SELECT state, amount, content, txn_ref, at FROM payments
    WHERE state IN ('unmatched','wrong_amount') AND NOT (${cond})
    ORDER BY at DESC LIMIT 30`), null, 1));

console.log('\n=== đơn paid kẹt: chỉ của audit hay có từ trước? ===');
console.log(JSON.stringify(L.q1(
  `SELECT o.code,o.total,o.created_at,o.admin_note FROM orders o WHERE o.status='paid'
    ORDER BY o.created_at`), null, 1));

console.log('\n=== tổng quan đơn theo trạng thái ===');
console.log(JSON.stringify(L.q1(
  "SELECT status, COUNT(1) n, SUM(total) s FROM orders GROUP BY status ORDER BY n DESC"), null, 1));
