import { Client, q, q1, BASE } from './q.mjs';
import { newUser, makeOrder, getQr } from './lib.mjs';

/* Kiểm tra lại #35 với client KHÔNG dùng cookie (rate limit theo IP thật)
   — lần trước đo được first429 = #22, giờ kiểm chính xác hơn. */
const c = await newUser('RX');
const st = [];
let first = null;
for (let i = 1; i <= 25; i++) {
  const r = await c.req('/api/orders', { method: 'POST', body: { items: [{ productId: 'p-lic-month', quantity: 1 }] } });
  st.push(r.status);
  if (r.status === 429 && first === null) { first = i; break; }
}
console.log(`first429=#${first} statuses=${JSON.stringify(st.slice(-5))}`);
console.log(`=> limit cấu hình: 20 đơn / 600s trong code (rateLimit 'order:user:ip', 20, 600)`);
console.log(`=> quan sát: chặn ở request #${first}; (KV eventual-consistency làm biên mềm ±1-2)`);

/* dọn user test vừa tạo */
const u = await q1('SELECT id FROM users WHERE username = ?', [c.username]);
if (u) {
  await q(`DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE user_id=?)`, [u.id]);
  await q(`DELETE FROM payments WHERE order_id IN (SELECT id FROM orders WHERE user_id=?)`, [u.id]);
  await q(`DELETE FROM orders WHERE user_id=?`, [u.id]);
  await q(`DELETE FROM sessions WHERE user_id=?`, [u.id]);
  await q(`DELETE FROM users WHERE id=?`, [u.id]);
  console.log('cleaned', c.username);
}
