import * as L from './_qr_lib.mjs';

for (const c of ['MBK-PPM9TN', 'MBK-L37NBM', 'MBK-CJJDDF']) {
  console.log('\n=== ' + c + ' ===');
  console.log('order:', JSON.stringify(L.q1(
    `SELECT code,status,total,subtotal,discount,paid_at,confirmed_by FROM orders WHERE code='${c}'`)[0]));
  console.log('payments:', JSON.stringify(L.q1(
    `SELECT amount,expected,state,txn_ref FROM payments WHERE order_code='${c}' ORDER BY at`), null, 1));
}

console.log('\n=== git status ===');
