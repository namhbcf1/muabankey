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
  console.log('\n🔓 TEST GIAO HÀNG VỚI SECRET MÃ HOÁ\n');

  // Tìm sản phẩm account rẻ nhất còn hàng
  const prods = await q(
    `SELECT p.id, p.name, p.price, COUNT(k.id) AS stock
     FROM products p JOIN product_keys k ON k.product_id = p.id AND k.status = 'available'
     WHERE p.delivery_type = 'account' AND p.active = 1
     GROUP BY p.id ORDER BY p.price ASC LIMIT 1`
  );
  if (!prods.length) { console.log('  ❌ Không có sản phẩm account còn hàng'); return; }
  const p = prods[0];
  console.log(`  Sản phẩm: ${p.name} | ${p.price}đ | còn ${p.stock}`);

  // Tạo user + nạp đủ tiền
  const uname = 'enc' + Date.now().toString().slice(-8);
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
  if (!uid) { console.log('  ❌ Không tìm thấy user'); return; }

  await fetch(B + '/api/admin/wallet/adjust', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: ack },
    body: JSON.stringify({ userId: uid, amount: p.price + 100000, reason: 'test mã hoá' }),
  });

  // Mua
  const o = await fetch(B + '/api/orders', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: uck },
    body: JSON.stringify({ items: [{ productId: p.id, quantity: 1 }] }),
  }).then((x) => x.json());

  if (!o.ok) { console.log('  ❌ Tạo đơn lỗi:', JSON.stringify(o).slice(0, 150)); return; }
  const code = o.order?.code || o.code;
  console.log(`  Đơn: ${code}`);

  await new Promise((r) => setTimeout(r, 1500));

  // Kiểm tra delivered_keys
  const rows = await q(
    `SELECT oi.delivered_keys FROM orders o
     JOIN order_items oi ON oi.order_id = o.id
     WHERE o.code = ? LIMIT 1`, [code]
  );
  const dk = rows[0]?.delivered_keys;
  let parsed = null;
  try { parsed = JSON.parse(dk); } catch { /* */ }
  const first = Array.isArray(parsed) ? parsed[0] : null;

  console.log(`  Key khách nhận: ${first ? first.slice(0, 55) : '(rỗng)'}`);
  const readable = !!(first && !first.startsWith('enc1:') && first.length > 3);
  console.log(`  ${readable ? '✅' : '❌'} Đã giải mã (plaintext)`);

  // DB gốc phải còn mã hoá
  const orig = await q(
    `SELECT k.secret FROM product_keys k JOIN orders o ON o.id = k.order_id
     WHERE o.code = ? LIMIT 1`, [code]
  );
  const s = orig[0]?.secret;
  console.log(`  ${s && s.startsWith('enc1:') ? '✅' : '❌'} DB vẫn mã hoá`);

  // Dọn
  await q('DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE code = ?)', [code]);
  await q('DELETE FROM orders WHERE code = ?', [code]);
  await q('DELETE FROM users WHERE id = ?', [uid]);
  console.log('  Đã dọn dữ liệu test');
})();
