import * as L from './_qr_lib.mjs';

const orders = ['MBK-PMJLM2', 'MBK-V2ARXH', 'MBK-UDX39K', 'MBK-34FZUY'];
for (const c of orders) {
  const o = L.q1(`SELECT id,code,status,total,payment_ref FROM orders WHERE code='${c}'`);
  const p = L.q1(`SELECT amount,expected,state,txn_ref,content FROM payments WHERE order_code='${c}'`);
  console.log(`\n${c}:`, JSON.stringify(o[0]));
  console.log('  payments:', JSON.stringify(p));
}

console.log('\n--- unmatched gần nhất ---');
console.log(JSON.stringify(L.q1(
  `SELECT amount,content,txn_ref,state FROM payments WHERE order_id IS NULL ORDER BY at DESC LIMIT 10`), null, 1));

console.log('\n--- tổng tiền theo đơn đã delivered hôm nay ---');
console.log(JSON.stringify(L.q1(
  `SELECT o.code,o.total,o.status,(SELECT COALESCE(SUM(p.amount),0) FROM payments p WHERE p.order_id=o.id) AS da_ghi_so
   FROM orders o WHERE o.created_at > (strftime('%s','now')-7200)*1000 AND o.status='delivered' ORDER BY o.created_at DESC LIMIT 15`), null, 1));
