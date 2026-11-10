import { readFileSync, writeFileSync } from 'node:fs';

const f = 'public/assets/pages/checkout.js';
let c = readFileSync(f, 'utf8');
const before = c;

const edits = [
  // 1. Re-price loop dùng items
  ['for (const item of [...state.cart]) {', 'for (const item of [...items]) {'],
  // 2. subtotal từ items
  ['  const subtotal = cartSubtotal();',
   '  const subtotal = items.reduce((s, i) => s + i.price * i.quantity, 0);'],
  // 3. render danh sách từ items
  ['${state.cart.map((i) => `', '${items.map((i) => `'],
  // 4. order items từ items
  ['items: state.cart.map((i) => ({ productId: i.productId, quantity: i.quantity })),',
   'items: items.map((i) => ({ productId: i.productId, quantity: i.quantity })),'],
  // 5. clearCart có điều kiện
  ['      clearCart();',
   '      if (mode === \'buynow\') { store.del(\'mbk_buynow\'); } else { clearCart(); }'],
  // 6. kiểm tra rỗng sau re-price
  ['  if (state.cart.length === 0) {\n    host.innerHTML = `<div class="empty-state">\n      <div class="ico">🛒</div>\n      <div class="t">Không còn sản phẩm hợp lệ</div>',
   '  if (items.length === 0) {\n    host.innerHTML = `<div class="empty-state">\n      <div class="ico">🛒</div>\n      <div class="t">Không còn sản phẩm hợp lệ</div>'],
];

const report = [];
for (const [from, to] of edits) {
  if (c.includes(from)) {
    c = c.split(from).join(to);
    report.push(`✓ ${from.slice(0, 45).replace(/\n/g, ' ')}`);
  } else {
    report.push(`✗ KHÔNG TÌM THẤY: ${from.slice(0, 45).replace(/\n/g, ' ')}`);
  }
}

writeFileSync(f, c, 'utf8');
console.log(report.join('\n'));
console.log('\nThay đổi:', before !== c);
console.log('mbk_buynow:', c.includes('mbk_buynow'));
console.log('items.map:', c.includes('${items.map'));
console.log('items.reduce:', c.includes('items.reduce'));
