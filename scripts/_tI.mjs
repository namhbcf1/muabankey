/**
 * BATTERY I — Hoàn tiền vào VÍ ĐÃ BỊ BỎ + lạm dụng tài nguyên.
 */
import * as L from './_qr_lib.mjs';
import { writeFileSync } from 'node:fs';

const R = [];
const rec = (id, method, result, money, goods, note) => {
  R.push({ id, method, result, money, goods, note });
  console.log(`\n[${id}] ${method}\n  → ${result}\n  💰 ${money}   📦 ${goods}\n  📝 ${note}`);
};

const adm = await L.login('namhbcf', 'namhbcf123');
const PROD = 'p-lic-month';
const PRICE = 180000;
const u = await L.register('i1');

/* ---------- I1: refund cộng vào ví — nhưng ví KHÔNG còn tồn tại ---------- */
{
  const o = await L.orderWithQr(u.cookie, PROD, 1);
  await L.wh({ id: 995001, accountNumber: '8990124112002', content: o.qr.memo,
    transferType: 'in', transferAmount: PRICE, referenceCode: L.ref('I1') });
  const balBefore = L.q1(`SELECT balance FROM users WHERE id='${u.id}'`)[0];
  const rf = await L.http(`/api/admin/orders/${o.order.id}/refund`, { method: 'POST', cookie: adm.cookie });
  const balAfter = L.q1(`SELECT balance FROM users WHERE id='${u.id}'`)[0];
  const wt = L.q1(`SELECT type,amount FROM wallet_transactions WHERE user_id='${u.id}'`);
  // khách có API nào đọc/tiêu số dư này không?
  const w1 = await L.http('/api/wallet', { cookie: u.cookie });
  const w2 = await L.http('/api/cart/checkout', { method: 'POST', cookie: u.cookie, body: {} });
  const lic = L.q1(`SELECT key,revoked FROM licenses WHERE note LIKE '%${o.order.code}%'`);

  rec('I1', `Admin bấm "Hoàn" đơn ${o.order.code} (180k). Tiền đi đâu?`,
    `refund=${rf.status} | users.balance ${balBefore.balance}→${balAfter.balance} | wallet_transactions=${JSON.stringify(wt)} | GET /api/wallet=${w1.status}/${w1.data?.code} | license revoked=${lic.map(x => x.revoked)}`,
    `MẤT 180k THẬT với khách: tiền "hoàn" chỉ là số dư ảo trong users.balance`,
    'Hàng đã thu hồi (revoked=1) → khách mất cả tiền lẫn key',
    'Không còn trang ví (app.js: "/wallet bỏ"), không có API đọc/tiêu số dư → số dư này không dùng được. Hoàn tiền = xoá key mà không trả tiền.');
}

/* ---------- I2: flood 150 request /claimed xuyên nhiều đơn ---------- */
{
  const uf = await L.register('i2');
  const os = [];
  for (let i = 0; i < 8; i++) os.push(await L.orderWithQr(uf.cookie, PROD, 1));
  let sent = 0, first = null;
  for (const o of os) {
    const r = await L.claim(uf.cookie, o.order.id);
    if (r.data?.claimed) { sent++; first = first || r; }
    if (r.status === 429) { first = r; break; }
  }
  rec('I2', `1 tài khoản (chưa CK đồng nào) bấm "Tôi đã chuyển khoản" trên 8 đơn khác nhau`,
    `${sent}/8 lần tạo thông báo Telegram | HTTP=${first?.status} | ${JSON.stringify(first?.data).slice(0, 90)}`,
    'không (khách không mất tiền)', 'không',
    'Chống spam tính THEO ĐƠN, không theo user/IP → 1 người spam được N tin Telegram, làm nhiễu kênh duyệt.');
}

/* ---------- I3: đơn giá 0 / số lượng lớn ---------- */
{
  const o5 = await L.mkOrder(u.cookie, PROD, 20);
  rec('I3', `Đặt 20 license gói tháng (20 × 180k = 3.600.000đ) trong 1 đơn`,
    `HTTP=${o5.status} total=${o5.data?.order?.total}`,
    'không', 'không',
    'Giới hạn 20/đơn. License sinh động nên không bị "hết hàng" giả.');
}

/* ---------- I4: QR của đơn đã giao ---------- */
{
  const o = await L.orderWithQr(u.cookie, PROD, 1);
  await L.wh({ id: 995002, accountNumber: '8990124112002', content: o.qr.memo,
    transferType: 'in', transferAmount: PRICE, referenceCode: L.ref('I4') });
  const q = await L.getQr(u.cookie, o.order.id);
  rec('I4', `Sau khi đơn đã giao, khách gọi lại POST /qr`,
    `HTTP=${q.status} code=${q.data?.code}`, 'không', 'không', '409 ALREADY_PAID, chặn đúng.');
}

/* ---------- I5: response QR có lộ gì nhạy cảm? ---------- */
{
  const o = await L.orderWithQr(u.cookie, PROD, 1);
  console.log('\n  QR response đầy đủ:');
  console.log('  ' + JSON.stringify(o.qr));
  rec('I5', `Kiểm tra dữ liệu trả về của POST /api/orders/:id/qr`,
    `fields=${Object.keys(o.qr || {}).join(',')} | bank=${JSON.stringify(o.qr?.bank)}`,
    'không', 'không',
    'Chỉ trả số TK + tên chủ TK (công khai, in trên QR). Không lộ secret.');
}

writeFileSync('qa/results-I.json', JSON.stringify(R, null, 1));
console.log(`\n--- I done: ${R.length} ---`);
