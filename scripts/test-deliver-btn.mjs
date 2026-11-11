/**
 * Test: nút "Giao" của admin phải cấp KEY thật (không chỉ đổi status).
 */
const B = 'https://xienhl.com';
import { readFileSync } from 'node:fs';

const T = process.env.CLOUDFLARE_API_TOKEN;
const A = process.env.CLOUDFLARE_ACCOUNT_ID;
const D = '81f478c9-5627-458a-a35f-d483e69d400b';
const PW = readFileSync('ADMIN_CREDENTIALS.txt', 'utf8').match(/Mat khau\s*:\s*(\S+)/)[1];

let pass = 0, fail = 0;
const ok = (n, c, x = '') => {
  if (c) { pass++; console.log(`  ✅ ${n}`); }
  else { fail++; console.log(`  ❌ ${n}${x ? ' — ' + x : ''}`); }
};

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

(async () => {
  console.log('\n🔧 TEST NÚT "GIAO" PHẢI CẤP KEY\n');

  // Đăng ký + tạo đơn
  const u = 'dlv' + Math.random().toString(36).slice(2, 9);
  const reg = await fetch(B + '/api/auth/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: u, password: 'abc123' }),
  });
  const ck = reg.headers.get('set-cookie')?.match(/mbk_session=[^;]+/)?.[0];

  const pr = await fetch(B + '/api/products').then((r) => r.json());
  const prod = (pr.products || []).find((p) => p.deliveryType === 'license');

  const o = await fetch(B + '/api/orders', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: ck },
    body: JSON.stringify({ items: [{ productId: prod.id, quantity: 1 }] }),
  }).then((r) => r.json());
  console.log(`  Đơn: ${o.order.code} — ${o.order.total}đ`);

  // Admin login
  const alr = await fetch(B + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'namhbcf', password: PW }),
  });
  const ack = alr.headers.get('set-cookie')?.match(/mbk_session=[^;]+/)?.[0];

  // Đặt đơn thành 'paid' (mô phỏng đã nhận tiền)
  await q("UPDATE orders SET status='paid', paid_at=? WHERE id=?",
    [Date.now(), o.order.id]);
  console.log('  Đơn → paid\n');

  // Đếm license trước
  const beforeLic = await q(
    'SELECT COUNT(*) AS n FROM licenses'
  );

  // Bấm "Giao"
  const dlv = await fetch(B + `/api/admin/orders/${o.order.id}/deliver`, {
    method: 'POST', headers: { Cookie: ack },
  });
  const dlvData = await dlv.json();
  console.log(`  POST /deliver: ${dlv.status} ${JSON.stringify(dlvData).slice(0, 150)}`);
  ok('deliver 200', dlv.status === 200, `status=${dlv.status}`);

  // Kiểm tra status
  const st = await q('SELECT status FROM orders WHERE id = ?', [o.order.id]);
  ok('đơn delivered', st[0]?.status === 'delivered', st[0]?.status);

  // Kiểm tra KEY thật
  const items = await q(
    'SELECT delivered_keys FROM order_items WHERE order_id = ?', [o.order.id]
  );
  let keys = [];
  try { keys = JSON.parse(items[0]?.delivered_keys || '[]'); } catch { /* */ }
  console.log(`  delivered_keys: ${keys.length} key`);
  if (keys[0]) console.log(`    ${String(keys[0]).slice(0, 50)}`);
  ok('CẤP KEY THẬT (không rỗng)', keys.length > 0,
    `keys=${keys.length}`);

  // License tăng?
  const afterLic = await q(
    'SELECT COUNT(*) AS n FROM licenses'
  );
  const delta = (afterLic[0]?.n || 0) - (beforeLic[0]?.n || 0);
  console.log(`  License: ${beforeLic[0]?.n} → ${afterLic[0]?.n} (+${delta})`);
  ok('có bản ghi license mới', delta >= 1, `delta=${delta}`);

  // Bấm lại -> không cấp thêm
  const dlv2 = await fetch(B + `/api/admin/orders/${o.order.id}/deliver`, {
    method: 'POST', headers: { Cookie: ack },
  }).then((r) => r.json());
  ok('bấm lại không cấp thêm', dlv2.already === true,
    JSON.stringify(dlv2).slice(0, 60));

  const items2 = await q(
    'SELECT delivered_keys FROM order_items WHERE order_id = ?', [o.order.id]
  );
  let keys2 = [];
  try { keys2 = JSON.parse(items2[0]?.delivered_keys || '[]'); } catch { /* */ }
  ok('số key không đổi', keys2.length === keys.length,
    `${keys.length} → ${keys2.length}`);

  console.log(`\n${'─'.repeat(52)}`);
  console.log(`Tổng: ${pass + fail}  |  ✅ ${pass}  |  ❌ ${fail}`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => { console.error('💥', e.message); process.exit(1); });
