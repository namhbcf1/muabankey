const T = 'cfut_36vwtVnGqd2KYb59ZWgI9faJGhStWQdeNIdEVWHba90694c6';
const A = '5b62d10947844251d23e0eac532531dd';
const D = '81f478c9-5627-458a-a35f-d483e69d400b';
const B = 'https://xienhl.com';
import { readFileSync } from 'node:fs';

async function q(sql, params = []) {
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${A}/d1/database/${D}/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${T}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql, params }),
  });
  const j = await r.json();
  if (!j.success) throw new Error(JSON.stringify(j.errors));
  return j.result?.[0]?.results || [];
}

const PW = readFileSync('ADMIN_CREDENTIALS.txt', 'utf8').match(/Mat khau\s*:\s*(\S+)/)[1];

(async () => {
  console.log('\n💰 TEST MUA HÀNG ĐẦY ĐỦ (tạo + thanh toán)\n');

  const prods = await q(
    `SELECT p.id, p.name, p.price
     FROM products p WHERE p.delivery_type = 'account' AND p.active = 1
     ORDER BY p.price ASC LIMIT 1`
  );
  const p = prods[0];
  console.log(`  Sản phẩm: ${p.name} | ${p.price}đ`);

  const uname = 'paid' + Date.now().toString().slice(-7);
  const reg = await fetch(B + '/api/auth/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: uname, password: 'abc123' }),
  });
  const uck = reg.headers.get('set-cookie')?.match(/mbk_session=[^;]+/)?.[0];

  const alr = await fetch(B + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'namhbcf', password: PW }),
  });
  const ack = alr.headers.get('set-cookie')?.match(/mbk_session=[^;]+/)?.[0];
  const us = await fetch(B + '/api/admin/users?q=' + uname, { headers: { Cookie: ack } }).then((x) => x.json());
  const uid = (us.users || [])[0]?.id;

  await fetch(B + '/api/admin/wallet/adjust', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: ack },
    body: JSON.stringify({ userId: uid, amount: p.price + 50000, reason: 'test giao hàng mã hoá' }),
  });

  // Tạo đơn
  const o = await fetch(B + '/api/orders', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: uck },
    body: JSON.stringify({ items: [{ productId: p.id, quantity: 1 }] }),
  }).then((x) => x.json());
  const orderId = o.order?.id;
  const code = o.order?.code;
  console.log(`  Đơn tạo: ${code} (${o.order?.status})`);

  // Thanh toán
  const pay = await fetch(B + `/api/orders/${orderId}/pay`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: uck },
    body: '{}',
  });
  const pr = await pay.json();
  console.log(`  Thanh toán: ${pay.status} → ${pr.order?.status || pr.code || '?'}`);

  await new Promise((r) => setTimeout(r, 1500));

  // Kiểm tra key
  const it = await q(
    'SELECT delivered_keys FROM order_items WHERE order_id = ?', [orderId]
  );
  const dk = it[0]?.delivered_keys;
  let parsed = null;
  try { parsed = JSON.parse(dk); } catch { /* */ }
  const first = Array.isArray(parsed) ? parsed[0] : null;

  console.log(`\n  Key khách nhận: ${first ? first.slice(0, 60) : '(rỗng)'}`);
  const readable = !!(first && !first.startsWith('enc1:') && first.length > 3);
  console.log(`  ${readable ? '✅' : '❌'} Đã giải mã thành plaintext`);

  const orig = await q(
    `SELECT k.secret FROM product_keys k WHERE k.order_id = ? LIMIT 1`, [orderId]
  );
  const s = orig[0]?.secret;
  console.log(`  ${s && s.startsWith('enc1:') ? '✅' : '❌'} DB vẫn mã hoá: ${s ? s.slice(0, 22) + '...' : '?'}`);

  // Dọn
  await q('DELETE FROM order_items WHERE order_id = ?', [orderId]);
  await q('DELETE FROM wallet_transactions WHERE user_id = ?', [uid]);
  await q('DELETE FROM orders WHERE id = ?', [orderId]);
  await q('DELETE FROM users WHERE id = ?', [uid]);
  console.log('\n  Đã dọn');
})();
