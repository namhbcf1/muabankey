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
  console.log('\n🔔 TEST NÚT "TÔI ĐÃ CHUYỂN KHOẢN" + ADMIN DUYỆT\n');

  // Tạo user + đơn
  const u = 'claim' + Math.random().toString(36).slice(2, 9);
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
  await fetch(B + `/api/orders/${o.order.id}/qr`, { method: 'POST', headers: { Cookie: ck } });
  console.log(`  Đơn: ${o.order.code} — ${o.order.total}đ\n`);

  /* ===== 1. Bấm "Tôi đã chuyển khoản" ===== */
  console.log('1️⃣  Khách báo đã chuyển khoản');
  const c1 = await fetch(B + `/api/orders/${o.order.id}/claimed`, {
    method: 'POST', headers: { Cookie: ck },
  });
  const c1d = await c1.json();
  console.log(`     ${c1.status} ${JSON.stringify(c1d).slice(0, 120)}`);
  ok('claim 200', c1.status === 200, `status=${c1.status}`);
  ok('có thông báo cho khách', !!c1d.msg, String(c1d.msg).slice(0, 60));

  // Ghi vào payments?
  const pay = await q(
    "SELECT state FROM payments WHERE order_id = ? AND state = 'claimed'",
    [o.order.id]
  );
  ok('ghi payments state=claimed', pay.length > 0, `${pay.length} dòng`);

  /* ===== 2. Bấm lại ngay -> chống spam ===== */
  console.log('\n2️⃣  Bấm lại ngay (chống spam)');
  const c2 = await fetch(B + `/api/orders/${o.order.id}/claimed`, {
    method: 'POST', headers: { Cookie: ck },
  }).then((r) => r.json());
  console.log(`     ${JSON.stringify(c2).slice(0, 100)}`);
  ok('bấm lại được báo "đã báo rồi"', c2.already === true,
    JSON.stringify(c2).slice(0, 60));

  /* ===== 3. Admin xem đơn chờ ===== */
  console.log('\n3️⃣  Admin xem danh sách đơn chờ');
  const alr = await fetch(B + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'namhbcf', password: PW }),
  });
  const ack = alr.headers.get('set-cookie')?.match(/mbk_session=[^;]+/)?.[0];

  const list = await fetch(B + '/api/admin/orders?status=pending', { headers: { Cookie: ack } })
    .then((r) => r.json());
  const found = (list.orders || []).find((x) => x.code === o.order.code);
  console.log(`     Có trong danh sách: ${!!found}`);
  ok('admin thấy đơn pending', !!found);

  /* ===== 4. Admin duyệt thủ công (mô phỏng Telegram) ===== */
  console.log('\n4️⃣  Admin duyệt thủ công');
  // Gọi confirmOrderPaid qua webhook với số tiền đúng
  const SEC = (process.env.WEBHOOK_SECRET
    || readFileSync(process.env.TEMP + '/testsec.txt', 'utf8')).trim();
  const memo = await q('SELECT payment_ref FROM orders WHERE id = ?', [o.order.id]);

  const approve = await fetch(B + '/api/webhooks/sepay', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Apikey ${SEC}` },
    body: JSON.stringify({
      id: 30001, accountNumber: '8990124112002',
      content: memo[0]?.payment_ref || '',
      transferType: 'in', transferAmount: o.order.total,
      referenceCode: 'APPROVE' + Date.now(),
    }),
  }).then((r) => r.json());
  console.log(`     ${JSON.stringify(approve).slice(0, 120)}`);
  ok('duyệt thì giao', approve.delivered === true, `delivered=${approve.delivered}`);

  /* ===== 5. Claim sau khi đã giao ===== */
  console.log('\n5️⃣  Khách bấm claim SAU khi đã giao');
  const c3 = await fetch(B + `/api/orders/${o.order.id}/claimed`, {
    method: 'POST', headers: { Cookie: ck },
  }).then((r) => r.json());
  console.log(`     ${JSON.stringify(c3).slice(0, 100)}`);
  ok('báo "đã thanh toán rồi"', c3.already === true,
    JSON.stringify(c3).slice(0, 60));

  /* ===== 6. Trạng thái đơn cuối ===== */
  const fin = await q('SELECT status, confirmed_by FROM orders WHERE id = ?', [o.order.id]);
  console.log(`\n  Đơn cuối: ${fin[0]?.status} — xác nhận bởi ${fin[0]?.confirmed_by}`);
  ok('đơn delivered', fin[0]?.status === 'delivered', fin[0]?.status);

  /* ===== 7. Có payment record ===== */
  const pays = await q(
    'SELECT state, amount, method FROM payments WHERE order_id = ? ORDER BY at',
    [o.order.id]
  );
  console.log(`  Payments: ${pays.length} dòng`);
  for (const p of pays) console.log(`    ${p.state} — ${p.amount}đ — ${p.method}`);
  ok('có ghi sổ payment', pays.length >= 2, `${pays.length} dòng`);

  console.log(`\n${'─'.repeat(54)}`);
  console.log(`Tổng: ${pass + fail}  |  ✅ ${pass}  |  ❌ ${fail}`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => { console.error('💥', e.message); process.exit(1); });
