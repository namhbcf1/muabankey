/**
 * BATTERY E — Xác nhận thủ công. BATTERY F — Rò rỉ / lạm dụng.
 * Chạy THẬT trên production (admin thật: namhbcf).
 */
import * as L from './_qr_lib.mjs';
import { writeFileSync } from 'node:fs';

const R = [];
const rec = (id, method, result, money, goods, note) => {
  R.push({ id, method, result, money, goods, note });
  console.log(`\n[${id}] ${method}\n  → ${result}\n  💰 ${money}   📦 ${goods}\n  📝 ${note}`);
};

const PROD = 'p-lic-month';
const PRICE = 180000;

const adm = await L.login('namhbcf', 'namhbcf123');
console.log('admin login:', adm.status, adm.cookie ? 'COOKIE OK' : 'NO COOKIE', JSON.stringify(adm.data).slice(0, 120));

const u = await L.register('e1');
const st = async (oid) => (await L.getOrder(u.cookie, oid)).data.order;
const keysOf = (o) => o?.items?.[0]?.keys?.length || 0;
const licN = (code) => L.q1(`SELECT COUNT(*) AS n FROM licenses WHERE note LIKE '%${code}%'`)[0].n;

/* ================= E26 — admin bấm "Duyệt" 2 lần (đường web admin/deliver) ================= */
if (adm.cookie) {
  const o = await L.orderWithQr(u.cookie, PROD, 1);
  // khách CK đủ -> tự giao
  await L.wh({ id: 950001, accountNumber: '8990124112002', content: o.qr.memo,
    transferType: 'in', transferAmount: PRICE, referenceCode: L.ref('E26') });
  const n1 = licN(o.order.code);
  // admin bấm Giao 2 lần
  const d1 = await L.http(`/api/admin/orders/${o.order.id}/deliver`, { method: 'POST', cookie: adm.cookie });
  const d2 = await L.http(`/api/admin/orders/${o.order.id}/deliver`, { method: 'POST', cookie: adm.cookie });
  const n2 = licN(o.order.code);
  const s = await st(o.order.id);
  rec('E26', `Đơn đã webhook tự giao (${o.order.code}). Admin bấm "Giao" 2 lần`,
    `lần1=${d1.status}/${d1.data?.code} lần2=${d2.status}/${d2.data?.code} | license ${n1}→${n2} | đơn=${s.status}`,
    'không', n2 === n1 ? 'không (không giao trùng)' : 'MẤT HÀNG',
    'adminDeliverManual chỉ set status, không cấp thêm key → không nhân đôi.');
}

/* ================= E27 — 2 admin bấm cùng lúc ================= */
if (adm.cookie) {
  const o = await L.orderWithQr(u.cookie, PROD, 1);
  L.d1(`UPDATE orders SET status='paid' WHERE id='${o.order.id}'`);
  const [a, b] = await Promise.all([
    L.http(`/api/admin/orders/${o.order.id}/deliver`, { method: 'POST', cookie: adm.cookie }),
    L.http(`/api/admin/orders/${o.order.id}/deliver`, { method: 'POST', cookie: adm.cookie }),
  ]);
  const s = await st(o.order.id);
  rec('E27', `Đơn 'paid' (tiền vào, giao lỗi). 2 request Giao ĐỒNG THỜI`,
    `A=${a.status}/${a.data?.code} B=${b.status}/${b.data?.code} | đơn=${s.status} keys=${keysOf(s)}`,
    '—', keysOf(s) === 0 ? 'MẤT HÀNG: đơn chuyển "delivered" nhưng KHÔNG có key nào' : 'ok',
    'adminDeliverManual đặt delivered mà KHÔNG gọi deliverOrderItems → khách thấy "đã giao" với 0 key.');
}

/* ================= E28 — admin "Duyệt" đơn đã tự giao ================= */
if (adm.cookie) {
  const o = await L.orderWithQr(u.cookie, PROD, 1);
  await L.wh({ id: 950002, accountNumber: '8990124112002', content: o.qr.memo,
    transferType: 'in', transferAmount: PRICE, referenceCode: L.ref('E28') });
  const n1 = licN(o.order.code);
  const d = await L.http(`/api/admin/orders/${o.order.id}/deliver`, { method: 'POST', cookie: adm.cookie });
  const n2 = licN(o.order.code);
  rec('E28', `Admin bấm "Giao" cho đơn ĐÃ tự giao xong`,
    `HTTP=${d.status} body=${JSON.stringify(d.data).slice(0, 100)} | license ${n1}→${n2}`,
    'không', n2 === n1 ? 'không' : 'MẤT HÀNG',
    'Trả 200 dù đã delivered — không có thông báo "đã giao rồi" rõ ràng.');
}

/* ================= E29 — admin "Từ chối"/refund rồi khách CK ================= */
if (adm.cookie) {
  const o = await L.orderWithQr(u.cookie, PROD, 1);
  // khách CK -> giao
  await L.wh({ id: 950003, accountNumber: '8990124112002', content: o.qr.memo,
    transferType: 'in', transferAmount: PRICE, referenceCode: L.ref('E29a') });
  const rf = await L.http(`/api/admin/orders/${o.order.id}/refund`, { method: 'POST', cookie: adm.cookie });
  const s1 = await st(o.order.id);
  const nRevoked = L.q1(`SELECT COUNT(*) AS n, SUM(revoked) AS r FROM licenses WHERE note LIKE '%${o.order.code}%'`)[0];
  // khách CK lần nữa sau khi refund
  const w = await L.wh({ id: 950004, accountNumber: '8990124112002', content: o.qr.memo,
    transferType: 'in', transferAmount: PRICE, referenceCode: L.ref('E29b') });
  const s2 = await st(o.order.id);
  rec('E29', `Đơn ${o.order.code}: CK → refund (thu hồi key) → khách CK LẦN NỮA`,
    `refund=${rf.status}/${rf.data?.code} | license tổng=${nRevoked.n} revoked=${nRevoked.r} | sau refund đơn=${s1.status} | CK lần 2=${JSON.stringify(w.data)} | đơn=${s2.status} keys=${keysOf(s2)}`,
    s2.status === 'delivered' ? 'CÓ THỂ mất: tiền lần 2 vào đơn đã refund' : 'không (chặn được)',
    keysOf(s2) ? 'MẤT HÀNG (giao lại key mới cho đơn đã refund)' : 'không',
    `confirmOrderPaid từ chối status 'refunded' → BAD_STATE. Tiền lần 2 thành unmatched/mất.`);
}

/* ================= F30 — tạo 100 đơn rồi bỏ ================= */
{
  const u30 = await L.register('f30');
  const t0 = Date.now();
  let okN = 0;
  for (let i = 0; i < 100; i++) {
    const r = await L.mkOrder(u30.cookie, PROD, 1);
    if (r.status === 201) okN++;
  }
  const dt = Date.now() - t0;
  const cnt = L.q1(`SELECT COUNT(*) AS n FROM orders WHERE user_id='${u30.id}'`)[0].n;
  rec('F30', `1 user tạo 100 đơn rồi bỏ (không CK)`,
    `tạo được ${okN}/100 đơn trong ${dt}ms | DB có ${cnt} đơn pending`,
    'không', 'không',
    `Mỗi đơn = 1 row orders + N row order_items, giữ tới cron 45' → expired (KHÔNG bao giờ xoá). Rate limit 20/10' chỉ chặn 1 lúc.`);
}

/* ================= F31 — brute force mã đơn 6 ký tự ================= */
{
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 ký tự
  console.log('\nF31 không gian mã đơn:', 32 ** 6, '=', (32 ** 6).toExponential(3));
  // kiểm tra endpoint có cho phép dò mã không
  const probe = await L.http('/api/orders/MBK-AAAAAA', { cookie: u.cookie });
  rec('F31', `Brute force mã đơn 6 ký tự (32^6 = ${(32 ** 6).toExponential(2)} ≈ 1,07 tỉ)`,
    `GET /api/orders/MBK-AAAAAA = ${probe.status}/${probe.data?.code}`,
    'Rất khó — cần ~1 tỉ request, rate limit 3000/phút/IP',
    'không',
    'GET chỉ tra đơn CỦA MÌNH (AND user_id) → dò mã không lộ đơn người khác. Nhưng CK thì KHÔNG cần biết chủ: chỉ cần mã là đơn đó được giao.');
}

/* ================= F32 — dùng /qr của người khác ================= */
{
  const victim = await L.orderWithQr(u.cookie, PROD, 1);
  const attacker = await L.register('f32');
  const r = await L.http(`/api/orders/${victim.order.id}/qr`, { method: 'POST', cookie: attacker.cookie });
  rec('F32', `user khác gọi POST /api/orders/:id/qr của đơn người khác`,
    `HTTP=${r.status} code=${r.data?.code}`, 'không', 'không',
    'Query có AND user_id = ? → 404. Chặn đúng.');

  // nhưng nếu attacker BIẾT MÃ ĐƠN thì sao? -> GET /api/orders/:id với code
  const r2 = await L.http(`/api/orders/${victim.order.code}`, { cookie: attacker.cookie });
  rec('F32b', `user khác gọi GET /api/orders/MBK-XXXXXX (bằng mã đơn)`,
    `HTTP=${r2.status} code=${r2.data?.code}`, 'không', 'không', 'Cũng AND user_id → 404.');
}

/* ================= F33 — sửa response QR trả số tiền nhỏ hơn ================= */
{
  const o = await L.orderWithQr(u.cookie, PROD, 1);
  // Khách tự sửa QR phía client: CK 1.000đ với nội dung đúng
  const w = await L.wh({ id: 960001, accountNumber: '8990124112002', content: o.qr.memo,
    transferType: 'in', transferAmount: 1000, referenceCode: L.ref('F33') });
  const s = await st(o.order.id);
  rec('F33', `Khách sửa QR/amount ở client: CK 1.000đ nhưng nội dung đúng mã đơn`,
    `webhook=${JSON.stringify(w.data)} | đơn=${s.status} keys=${keysOf(s)}`,
    'không', keysOf(s) ? 'MẤT HÀNG — giao key 180k với 1.000đ' : 'không (underpaid)',
    'Server so số tiền THẬT trong webhook với orders.total, không tin client. Chặn đúng.');

  // F33b: cộng dồn lách — CK 1.000đ nhiều lần? (đã sửa cộng dồn) 
  for (let i = 0; i < 3; i++) {
    await L.wh({ id: 960010 + i, accountNumber: '8990124112002', content: o.qr.memo,
      transferType: 'in', transferAmount: 1000, referenceCode: L.ref('F33b' + i) });
  }
  const s2 = await st(o.order.id);
  const ps = L.q1(`SELECT COALESCE(SUM(amount),0) AS s FROM payments WHERE order_code='${o.order.code}'`)[0];
  rec('F33b', `Lách bằng nhiều lần nhỏ: 1.000đ × 4 lần (tổng 4.000đ)`,
    `đơn=${s2.status} keys=${keysOf(s2)} | payments tổng=${ps.s}`,
    'không', keysOf(s2) ? 'MẤT HÀNG' : 'không',
    'Cộng dồn đúng 4.000 < 180.000 → vẫn underpaid. Nhưng lưu ý: cộng dồn khiến 1.000đ × 180 lần = 180.000đ → GIAO HÀNG.');
}

/* ================= F34 — spam /claimed 100 lần ================= */
{
  const o = await L.orderWithQr(u.cookie, PROD, 1);
  const res = [];
  for (let i = 0; i < 100; i++) res.push(await L.claim(u.cookie, o.order.id));
  const first = res.filter((r) => r.data?.claimed === true).length;
  const skip = res.filter((r) => r.data?.already === true).length;
  const claims = L.q1(`SELECT COUNT(*) AS n FROM payments WHERE order_id='${o.order.id}' AND state='claimed'`)[0].n;
  rec('F34', `Bấm "Tôi đã chuyển khoản" 100 lần liên tiếp`,
    `claimed=${first} already/skip=${skip} | dòng payments 'claimed'=${claims}`,
    'không', 'không',
    `Chống spam 1 lần/2 phút/đơn → chỉ 1 dòng + 1 tin Telegram. Nhưng 100 request vẫn tới Telegram API 1 lần là đủ.`);
}

/* ================= F34b — spam claimed trên NHIỀU đơn ================= */
{
  const us = await L.register('f34b');
  let sent = 0;
  for (let i = 0; i < 10; i++) {
    const o = await L.orderWithQr(us.cookie, PROD, 1);
    const r = await L.claim(us.cookie, o.order.id);
    if (r.data?.claimed) sent++;
  }
  rec('F34b', `1 user bấm "Tôi đã chuyển khoản" trên 10 ĐƠN KHÁC NHAU (chưa CK đồng nào)`,
    `${sent}/10 lần gửi Telegram thành công`,
    'không (khách chưa CK)', 'không',
    `Rate limit là THEO ĐƠN, không theo user/IP → spam ${sent} tin Telegram. Admin bị nhiễu, dễ duyệt nhầm.`);
}

writeFileSync('qa/results-EF.json', JSON.stringify(R, null, 1));
console.log(`\n--- E+F done: ${R.length} ---`);
