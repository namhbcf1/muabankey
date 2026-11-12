/**
 * Test các trường hợp có thể MẤT TIỀN / MẤT HÀNG.
 */
const B = 'https://xienhl.com';
import { readFileSync } from 'node:fs';

const SEC = (process.env.WEBHOOK_SECRET
  || readFileSync(process.env.TEMP + '/testsec.txt', 'utf8')).trim();


/* ===== TẮT CỬA SỔ GIỜ TỰ ĐỘNG TRONG LÚC TEST =====
 * Cửa sổ thật 00:00-11:59 (chủ shop chốt). Test này kiểm logic tự giao
 * (underpaid / duplicate / overpaid) nên cần server luôn tự giao.
 * Bật lại ở cuối, dù pass hay fail.
 */
const CF_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const CF_ACCT = process.env.CLOUDFLARE_ACCOUNT_ID;
const CF_DB = '81f478c9-5627-458a-a35f-d483e69d400b';

async function cfSql(sql) {
  const r = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CF_ACCT}/d1/database/${CF_DB}/query`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${CF_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql }),
    },
  );
  const j = await r.json();
  return j.result?.[0]?.results;
}

async function windowOff() {
  await cfSql("UPDATE settings SET value='0' WHERE key='sepay_auto_enabled'");
  // D1 read replica có độ trễ — chờ để Worker đọc được giá trị mới.
  await new Promise((r) => setTimeout(r, 8000));
  // Xác nhận Worker đã thấy
  for (let i = 0; i < 5; i++) {
    const row = await cfSql("SELECT value FROM settings WHERE key='sepay_auto_enabled'");
    if (String(row?.[0]?.value) === '0') break;
    await new Promise((r) => setTimeout(r, 2000));
  }
}
async function windowOn() {
  await cfSql("UPDATE settings SET value='1' WHERE key='sepay_auto_enabled'");
  await new Promise((r) => setTimeout(r, 2000));
}

let pass = 0, fail = 0;
const ok = (n, c, x = '') => {
  if (c) { pass++; console.log(`  ✅ ${n}`); }
  else { fail++; console.log(`  ❌ ${n}${x ? ' — ' + x : ''}`); }
};

const reg = async () => {
  const u = 'risk' + Math.random().toString(36).slice(2, 10);
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
  const q = await fetch(B + `/api/orders/${o.order.id}/qr`, {
    method: 'POST', headers: { Cookie: ck },
  }).then((r) => r.json());
  return { order: o.order, qr: q.qr };
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
  console.log('\n⚠️  TEST TRƯỜNG HỢP MẤT TIỀN / MẤT HÀNG\n');

  await windowOff();
  console.log('  (đã tắt cửa sổ giờ tự động để test, sẽ bật lại sau)\n');

  const ck = await reg();
  const pr = await fetch(B + '/api/products').then((r) => r.json());
  const prod = (pr.products || []).find((p) => p.deliveryType === 'license');
  if (!prod) { console.log('  ❌ không có sản phẩm'); return; }
  console.log(`  Sản phẩm: ${prod.name} — ${prod.price}đ\n`);

  /* ===== 1. Chuyển THIẾU tiền ===== */
  console.log('1️⃣  Chuyển THIẾU tiền');
  const o1 = await mkOrder(ck, prod.id);
  const short = await wh({
    id: 10001, accountNumber: '8990124112002',
    content: o1.qr.memo, transferType: 'in',
    transferAmount: Math.floor(prod.price * 0.5),
    referenceCode: 'SHORT' + Date.now(),
  });
  console.log(`     Kết quả: ${JSON.stringify(short.data).slice(0, 120)}`);
  ok('thiếu tiền KHÔNG giao', short.data.delivered !== true,
    `delivered=${short.data.delivered}`);
  ok('báo underpaid', short.data.underpaid === true || short.data.reason === 'UNDERPAID',
    JSON.stringify(short.data).slice(0, 80));

  // Kiểm tra đơn vẫn còn cơ hội nhận tiền bù
  const o1after = await fetch(B + `/api/orders/${o1.order.id}`, { headers: { Cookie: ck } })
    .then((r) => r.json());
  console.log(`     Đơn sau: ${o1after.order?.status}`);

  // Chuyển bù phần còn lại
  const topup = await wh({
    id: 10002, accountNumber: '8990124112002',
    content: o1.qr.memo, transferType: 'in',
    transferAmount: Math.ceil(prod.price * 0.5) + 1000,
    referenceCode: 'TOPUP' + Date.now(),
  });
  console.log(`     Chuyển bù: ${JSON.stringify(topup.data).slice(0, 120)}`);
  ok('chuyển bù thì giao được', topup.data.delivered === true,
    `delivered=${topup.data.delivered}`);

  /* ===== 2. Chuyển THỪA tiền ===== */
  console.log('\n2️⃣  Chuyển THỪA tiền');
  const o2 = await mkOrder(ck, prod.id);
  const over = await wh({
    id: 10003, accountNumber: '8990124112002',
    content: o2.qr.memo, transferType: 'in',
    transferAmount: prod.price + 50000,
    referenceCode: 'OVER' + Date.now(),
  });
  console.log(`     Kết quả: ${JSON.stringify(over.data).slice(0, 100)}`);
  ok('thừa tiền VẪN giao', over.data.delivered === true,
    `delivered=${over.data.delivered}`);

  /* ===== 3. Chuyển 2 lần ===== */
  console.log('\n3️⃣  Chuyển 2 lần cùng đơn');
  const o3 = await mkOrder(ck, prod.id);
  const first = await wh({
    id: 10004, accountNumber: '8990124112002',
    content: o3.qr.memo, transferType: 'in',
    transferAmount: prod.price, referenceCode: 'TWICE1' + Date.now(),
  });
  const second = await wh({
    id: 10005, accountNumber: '8990124112002',
    content: o3.qr.memo, transferType: 'in',
    transferAmount: prod.price, referenceCode: 'TWICE2' + Date.now(),
  });
  ok('lần 1 giao', first.data.delivered === true);
  ok('lần 2 KHÔNG giao thêm', second.data.delivered !== true,
    `delivered=${second.data.delivered}`);
  console.log(`     Lần 2: duplicated=${second.data.duplicated}, reason=${second.data.reason}`);

  /* ===== 4. Nội dung có 2 mã ===== */
  console.log('\n4️⃣  Nội dung có 2 mã đơn');
  const o4a = await mkOrder(ck, prod.id);
  const o4b = await mkOrder(ck, prod.id);
  const multi = await wh({
    id: 10006, accountNumber: '8990124112002',
    content: `${o4a.qr.memo} ${o4b.qr.memo}`,
    transferType: 'in', transferAmount: prod.price,
    referenceCode: 'MULTI' + Date.now(),
  });
  console.log(`     Kết quả: ${JSON.stringify(multi.data).slice(0, 120)}`);
  console.log(`     (Chỉ 1 đơn được giao là ĐÚNG — không thể tách tiền tự động)`);

  /* ===== 5. Chuyển RA (transferType=out) ===== */
  console.log('\n5️⃣  Lệnh RÚT tiền (transferType=out)');
  const o5 = await mkOrder(ck, prod.id);
  const out = await wh({
    id: 10007, accountNumber: '8990124112002',
    content: o5.qr.memo, transferType: 'out',
    transferAmount: prod.price, referenceCode: 'OUT' + Date.now(),
  });
  ok('chuyển RA bị chặn', out.data.matched === false && out.data.reason === 'NOT_INBOUND',
    JSON.stringify(out.data).slice(0, 80));

  /* ===== 6. Sai tài khoản ===== */
  console.log('\n6️⃣  Sai số tài khoản nhận');
  const o6 = await mkOrder(ck, prod.id);
  const wrongAcc = await wh({
    id: 10008, accountNumber: '9999999999',
    content: o6.qr.memo, transferType: 'in',
    transferAmount: prod.price, referenceCode: 'WRONGACC' + Date.now(),
  });
  ok('sai tài khoản bị chặn', wrongAcc.data.matched === false,
    JSON.stringify(wrongAcc.data).slice(0, 80));

  /* ===== 7. Nội dung không khớp ===== */
  console.log('\n7️⃣  Nội dung không khớp đơn nào');
  const noMatch = await wh({
    id: 10009, accountNumber: '8990124112002',
    content: 'CHUYENKHOANBINHTHUONG',
    transferType: 'in', transferAmount: 500000,
    referenceCode: 'NOMATCH' + Date.now(),
  });
  ok('không khớp -> unmatched', noMatch.data.matched === false,
    JSON.stringify(noMatch.data).slice(0, 80));

  /* ===== 8. Trùng referenceCode ===== */
  console.log('\n8️⃣  Webhook lặp cùng referenceCode');
  const o8 = await mkOrder(ck, prod.id);
  const ref = 'SAME' + Date.now();
  const w1 = await wh({
    id: 10010, accountNumber: '8990124112002',
    content: o8.qr.memo, transferType: 'in',
    transferAmount: prod.price, referenceCode: ref,
  });
  const w2 = await wh({
    id: 10010, accountNumber: '8990124112002',
    content: o8.qr.memo, transferType: 'in',
    transferAmount: prod.price, referenceCode: ref,
  });
  ok('lần 1 giao', w1.data.delivered === true);
  ok('lần 2 (cùng ref) không giao', w2.data.duplicated === true || w2.data.delivered !== true,
    JSON.stringify(w2.data).slice(0, 80));

  console.log(`\n${'─'.repeat(54)}`);
  await windowOn();
  console.log('  (đã bật lại cửa sổ giờ tự động)');
  console.log(`Tổng: ${pass + fail}  |  ✅ ${pass}  |  ❌ ${fail}`);
  process.exit(fail > 0 ? 1 : 0);
})().catch(async (e) => { await windowOn(); console.error('💥', e.message); process.exit(1); });
