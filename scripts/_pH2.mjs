import * as L from './_qr_lib.mjs';

const code = L.q1("SELECT code FROM orders WHERE payment_ref IS NOT NULL ORDER BY created_at DESC LIMIT 12");
console.log('12 đơn gần nhất:', JSON.stringify(code));

// tìm đơn của H2: có nhiều dòng payments 18000
const rows = L.q1(`SELECT order_code, COUNT(*) n, SUM(amount) s, MIN(amount) mn
                   FROM payments WHERE amount=18000 GROUP BY order_code ORDER BY n DESC LIMIT 5`);
console.log('\nđơn có payments 18k:', JSON.stringify(rows, null, 1));

if (rows[0]) {
  const oc = rows[0].order_code;
  console.log(`\n=== chi tiết ${oc} ===`);
  console.log('order:', JSON.stringify(L.q1(
    `SELECT code,status,total,paid_at FROM orders WHERE code='${oc}'`)[0]));
  console.log('payments:', JSON.stringify(L.q1(
    `SELECT amount,state,txn_ref FROM payments WHERE order_code='${oc}' ORDER BY at`), null, 1));
  console.log('license:', JSON.stringify(L.q1(
    `SELECT key,revoked FROM licenses WHERE note LIKE '%${oc}%'`)));
  const all = L.q1(`SELECT COUNT(*) n FROM payments WHERE order_code='${oc}'`)[0];
  console.log('TỔNG dòng payments:', JSON.stringify(all));
}
