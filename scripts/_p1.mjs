import * as L from './_qr_lib.mjs';

const o = L.q1('SELECT COUNT(*) AS n FROM orders');
console.log('orders total:', JSON.stringify(o));
const s = L.q1('SELECT status, COUNT(*) AS n FROM orders GROUP BY status');
console.log('by status:', JSON.stringify(s));
const p = L.q1('SELECT COUNT(*) AS n FROM payments');
console.log('payments:', JSON.stringify(p));
const pr = L.q1('SELECT id,name,price,delivery_type,stock_count,license_prefix,license_days FROM products');
console.log('products:', JSON.stringify(pr, null, 1));
