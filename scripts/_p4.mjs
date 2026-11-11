import * as L from './_qr_lib.mjs';

console.log('products hiện tại:');
console.log(JSON.stringify(L.q1(
  'SELECT id,name,active,price,delivery_type,stock_count FROM products ORDER BY id'), null, 1));
