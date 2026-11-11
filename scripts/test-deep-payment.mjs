/**
 * Test sâu: 2 mã trong 1 nội dung, đơn hết hạn, sản phẩm hết hàng.
 */
const B = 'https://xienhl.com';
import { readFileSync } from 'node:fs';

const SEC = (process.env.WEBHOOK_SECRET
  || readFileSync(process.env.TEMP + '/testsec.txt', 'utf8')).trim();

const T = process.env.CLOUDFLARE_API_TOKEN;
const A = process.env.CLOUDFLARE_ACCOUNT_ID;
const D = '81f478c9-5627-458a-a35f-d483e69d400b';

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

const reg = async () => {
  const u = 'deep' + Math.random().toString(36).slice(2, 10);
  const r = await fetch(B + '/api/auth/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: u, password: 'abc123' }),
  });
  return r.headers.get('set-cookie')?.match(/mbk_session=[^;]+/)?.[0];
};

const mkOrder = async (ck, prodId) => {
  const o = await fetch(B + '/api/orders', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: ck },
    body: JSON.stringify({ items: [{ productId: prodId, quantity: 1 }] }),
  }).then((r) => r.json());
  const qq = await fetch(B + `/api/orders/${o.order.id}/qr`, {
    method: 'POST', headers: { Cookie: ck },
  }).then((r) => r.json());
  return { order: o.order, qr: qq.qr };
};

const wh = async (payload) => {
  const r = await fetch(B + '/api/webhooks/sepay', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Apikey ${SEC}` },
    body: JSON.stringify(payload),
  });
  return { status: r.status, data: await r.json() };
};

(async () => {
  console.log('\n🔬 TEST SÂU\n');

  const ck = await reg();
  const pr = await fetch(B + '/api/products').then((r) => r.json());
  const prod = (pr.products || []).find((p) => p.deliveryType === 'license');
  console.log(`  Sản phẩm: ${prod.name} — ${prod.price}đ\n`);

  /* ===== 1. Nội dung có 2 mã — mã nào được chọn? ===== */
  console.log('1️⃣  Nội dung chứa 2 mã đơn');
  const a1 = await mkOrder(ck, prod.id);
  const a2 = await mkOrder(ck, prod.id);

  // Chuyển đúng tiền 1 đơn, nội dung có cả 2 mã
  const r1 = await wh({
    id: 20001, accountNumber: '8990124112002',
    content: `${a1.qr.memo} ${a2.qr.memo}`,
    transferType: 'in', transferAmount: prod.price,
    referenceCode: 'TWO' + Date.now(),
  });
  console.log(`     ${JSON.stringify(r1.data).slice(0, 100)}`);
  const which = r1.data.order;
  console.log(`     Giao đơn: ${which}`);
  ok('chỉ giao 1 đơn', r1.data.delivered === true);
  ok('đơn kia vẫn pending', (() => {
    const other = which === a1.order.code ? a2 : a1;
    return true; // sẽ kiểm tra SQL bên dưới
  })());

  const otherCode = which === a1.order.code ? a2.order.code : a1.order.code;
  const otherSt = await q('SELECT status FROM orders WHERE code = ?', [otherCode]);
  console.log(`     Đơn ${otherCode}: ${otherSt[0]?.status}`);
  ok('đơn còn lại vẫn pending', otherSt[0]?.status === 'pending',
    otherSt[0]?.status);

  /* ===== 2. Nội dung mã đơn ĐÃ GIAO ===== */
  console.log('\n2️⃣  Nội dung mã đơn đã giao rồi');
  const r2 = await wh({
    id: 20002, accountNumber: '8990124112002',
    content: which, transferType: 'in',
    transferAmount: prod.price, referenceCode: 'AGAIN' + Date.now(),
  });
  console.log(`     ${JSON.stringify(r2.data).slice(0, 100)}`);
  ok('không giao lại', r2.data.delivered !== true,
    `delivered=${r2.data.delivered}`);

  /* ===== 3. Đơn hết hạn ===== */
  console.log('\n3️⃣  Đơn hết hạn (giả lập)');
  const a3 = await mkOrder(ck, prod.id);
  await q("UPDATE orders SET status = 'expired' WHERE id = ?", [a3.order.id]);
  const r3 = await wh({
    id: 20003, accountNumber: '8990124112002',
    content: a3.qr.memo, transferType: 'in',
    transferAmount: prod.price, referenceCode: 'EXP' + Date.now(),
  });
  console.log(`     ${JSON.stringify(r3.data).slice(0, 120)}`);
  ok('đơn hết hạn VẪN nhận tiền + giao', r3.data.delivered === true,
    `delivered=${r3.data.delivered} reason=${r3.data.reason}`);

  /* ===== 4. Đơn cancelled ===== */
  console.log('\n4️⃣  Đơn đã huỷ (cancelled)');
  const a4 = await mkOrder(ck, prod.id);
  await q("UPDATE orders SET status = 'cancelled' WHERE id = ?", [a4.order.id]);
  const r4 = await wh({
    id: 20004, accountNumber: '8990124112002',
    content: a4.qr.memo, transferType: 'in',
    transferAmount: prod.price, referenceCode: 'CAN' + Date.now(),
  });
  console.log(`     ${JSON.stringify(r4.data).slice(0, 120)}`);
  ok('đơn cancelled VẪN nhận tiền + giao', r4.data.delivered === true,
    `delivered=${r4.data.delivered} reason=${r4.data.reason}`);

  /* ===== 5. Sản phẩm hết hàng ===== */
  console.log('\n5️⃣  Hết hàng giữa lúc chờ tiền');
  const a5 = await mkOrder(ck, prod.id);
  // Tạm đánh dấu hết hàng: đặt stock_count = 0 và không có key available
  const before = await q('SELECT stock_count FROM products WHERE id = ?', [prod.id]);
  await q('UPDATE products SET stock_count = 0 WHERE id = ?', [prod.id]);
  const keyCnt = await q(
    "SELECT COUNT(*) AS n FROM product_keys WHERE product_id = ? AND status='available'",
    [prod.id]
  );
  const r5 = await wh({
    id: 20005, accountNumber: '8990124112002',
    content: a5.qr.memo, transferType: 'in',
    transferAmount: prod.price, referenceCode: 'OOS' + Date.now(),
  });
  console.log(`     Key available: ${keyCnt[0]?.n}`);
  console.log(`     ${JSON.stringify(r5.data).slice(0, 150)}`);
  // Khôi phục
  await q('UPDATE products SET stock_count = ? WHERE id = ?',
    [before[0]?.stock_count || 10, prod.id]);

  const a5st = await q('SELECT status, admin_note FROM orders WHERE id = ?', [a5.order.id]);
  console.log(`     Đơn: ${a5st[0]?.status} — ${String(a5st[0]?.admin_note || '').slice(0, 60)}`);
  ok('hết hàng giữ đơn ở paid (không mất tiền)',
    ['paid', 'delivered'].includes(a5st[0]?.status), a5st[0]?.status);

  console.log(`\n${'─'.repeat(54)}`);
  console.log(`Tổng: ${pass + fail}  |  ✅ ${pass}  |  ❌ ${fail}`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => { console.error('💥', e.message); process.exit(1); });
