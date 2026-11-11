/**
 * BATTERY A — Khớp sai đơn. Chạy THẬT trên production.
 * Ghi kết quả ra results-json để dựng bảng.
 */
import * as L from './_qr_lib.mjs';
import { writeFileSync } from 'node:fs';

const R = [];
const rec = (id, method, result, money, goods, note) => {
  R.push({ id, method, result, money, goods, note });
  console.log(`\n[${id}] ${method}\n  → ${result}\n  💰 ${money}   📦 ${goods}`);
};

const PROD = 'p-lic-month'; // 180.000đ, license
const PRICE = 180000;

const u1 = await L.register('a1');
const u2 = await L.register('a2');
console.log('users:', u1.username, u1.cookie ? 'OK' : 'NOCOOKIE', '/', u2.username, u2.cookie ? 'OK' : 'NOCOOKIE');

/* ---------- A1: 2 đơn cùng lúc, chuyển đúng nội dung đơn A ---------- */
{
  const oa = await L.orderWithQr(u1.cookie, PROD, 1);
  const ob = await L.orderWithQr(u1.cookie, PROD, 1);
  console.log('\nA1 orders:', oa.order?.code, ob.order?.code, 'memoA=', oa.qr?.memo, 'memoB=', ob.qr?.memo);

  const w = await L.wh({
    id: 900001, accountNumber: '8990124112002', gateway: 'MBBank',
    content: oa.qr.memo, transferType: 'in', transferAmount: PRICE,
    referenceCode: L.ref('A1'),
  });

  const A = await L.getOrder(u1.cookie, oa.order.id);
  const B = await L.getOrder(u1.cookie, ob.order.id);
  const aKeys = A.data.order.items?.[0]?.keys || [];
  const bKeys = B.data.order.items?.[0]?.keys || [];

  rec('A1',
    `2 đơn (A=${oa.order.code}, B=${ob.order.code}) cùng 180k. CK 180k nội dung "${oa.qr.memo}"`,
    `webhook=${JSON.stringify(w.data)} | A.status=${A.data.order.status} keys=${aKeys.length} | B.status=${B.data.order.status} keys=${bKeys.length}`,
    aKeys.length === 1 || bKeys.length === 1 ? 'KHÔNG mất (1 đơn giao đúng)' : 'CẦN XEM',
    (aKeys.length + bKeys.length) === 1 ? 'KHÔNG (đúng 1 key)' : `CẦN XEM giao ${aKeys.length + bKeys.length} key`,
    'Đơn B vẫn treo chờ tiền — đúng thiết kế.');
}

/* ---------- A2: nội dung chứa 2 mã, chuyển 2x tiền ---------- */
{
  const oa = await L.orderWithQr(u1.cookie, PROD, 1);
  const ob = await L.orderWithQr(u1.cookie, PROD, 1);
  const content = `${oa.qr.memo} ${ob.qr.memo}`;
  console.log('\nA2 content:', content);

  const w = await L.wh({
    id: 900002, accountNumber: '8990124112002',
    content, transferType: 'in', transferAmount: PRICE * 2,
    referenceCode: L.ref('A2'),
  });

  const A = await L.getOrder(u1.cookie, oa.order.id);
  const B = await L.getOrder(u1.cookie, ob.order.id);
  const aKeys = A.data.order.items?.[0]?.keys || [];
  const bKeys = B.data.order.items?.[0]?.keys || [];

  rec('A2',
    `2 đơn A/B. CK 360k nội dung "${content}" (2 mã)`,
    `webhook=${JSON.stringify(w.data)} | A=${A.data.order.status}/${aKeys.length}key | B=${B.data.order.status}/${bKeys.length}key`,
    bKeys.length === 0 ? 'MẤT 180k (chuyển 2 đơn nhưng chỉ 1 đơn được ghi nhận)' : 'không',
    bKeys.length === 0 ? 'MẤT HÀNG cho đơn B? (khách trả 2 đơn, nhận 1)' : 'không',
    'Hệ thống chỉ khớp 1 mã đầu, phần tiền còn lại không tự phân bổ.');
}

/* ---------- A3: nội dung mã đơn NGƯỜI KHÁC ---------- */
{
  const victim = await L.orderWithQr(u1.cookie, PROD, 1); // đơn của user1
  const w = await L.wh({
    id: 900003, accountNumber: '8990124112002',
    content: victim.qr.memo, transferType: 'in', transferAmount: PRICE,
    referenceCode: L.ref('A3'),
  });
  const V = await L.getOrder(u1.cookie, victim.order.id);
  const keys = V.data.order.items?.[0]?.keys || [];
  const mine = await L.http('/api/orders', { cookie: u2.cookie });

  rec('A3',
    `user2 chuyển 180k với nội dung mã đơn của user1 (${victim.qr.memo})`,
    `webhook=${JSON.stringify(w.data)} | đơn user1=${V.data.order.status}/${keys.length}key | user2 thấy ${mine.data.orders?.length ?? 0} đơn`,
    u2.username + ' mất 180k (không đơn của mình)',
    keys.length ? 'Giao đúng cho chủ đơn (không mất hàng)' : 'CẦN XEM',
    'Ai gõ mã đơn người khác thì tiền vào đơn người đó — đơn của mình vẫn pending.');
}

/* ---------- A4: nội dung mã đơn ĐÃ GIAO, chuyển lần 2 ---------- */
{
  const o = await L.orderWithQr(u1.cookie, PROD, 1);
  const before = L.licCount(o.order.code);
  const w1 = await L.wh({
    id: 900004, accountNumber: '8990124112002', content: o.qr.memo,
    transferType: 'in', transferAmount: PRICE, referenceCode: L.ref('A4a'),
  });
  const mid = L.licCount(o.order.code);
  // chuyển lần 2 (KHÁC referenceCode) — khách bấm nhầm 2 lần
  const w2 = await L.wh({
    id: 900005, accountNumber: '8990124112002', content: o.qr.memo,
    transferType: 'in', transferAmount: PRICE, referenceCode: L.ref('A4b'),
  });
  const after = L.licCount(o.order.code);
  const payRows = L.q1(`SELECT COUNT(*) AS n, COALESCE(SUM(amount),0) AS s FROM payments WHERE order_code='${o.order.code}'`);

  rec('A4',
    `Đơn ${o.order.code} đã giao. Chuyển thêm 180k lần 2 (referenceCode khác)`,
    `L1=${JSON.stringify(w1.data)} | L2=${JSON.stringify(w2.data)} | license: ${before}→${mid}→${after} | payments rows=${payRows[0]?.n} sum=${payRows[0]?.s}`,
    after > mid ? 'không' : 'MẤT 180k lần 2 — KHÔNG ghi sổ, KHÔNG báo admin',
    after > mid ? 'MẤT HÀNG (giao thêm)' : 'không (không giao lại)',
    'Lần 2 trả duplicated=true nhưng KHÔNG insert payments, KHÔNG bắn Telegram → tiền thứ 2 vô hình.');
}

/* ---------- A5: nội dung mã đơn đã HUỶ / hết hạn ---------- */
{
  // đơn A5a: ép 'expired' (mô phỏng cron 45 phút)
  const oe = await L.orderWithQr(u1.cookie, PROD, 1);
  L.d1(`UPDATE orders SET status='expired' WHERE id='${oe.order.id}'`);
  const we = await L.wh({
    id: 900006, accountNumber: '8990124112002', content: oe.qr.memo,
    transferType: 'in', transferAmount: PRICE, referenceCode: L.ref('A5exp'),
  });
  const E = await L.getOrder(u1.cookie, oe.order.id);

  // đơn A5b: ép 'cancelled'
  const oc = await L.orderWithQr(u1.cookie, PROD, 1);
  L.d1(`UPDATE orders SET status='cancelled' WHERE id='${oc.order.id}'`);
  const wc = await L.wh({
    id: 900007, accountNumber: '8990124112002', content: oc.qr.memo,
    transferType: 'in', transferAmount: PRICE, referenceCode: L.ref('A5can'),
  });
  const C = await L.getOrder(u1.cookie, oc.order.id);
  const eK = E.data.order.items?.[0]?.keys || [];
  const cK = C.data.order.items?.[0]?.keys || [];

  rec('A5',
    `Đơn expired (${oe.order.code}) và đơn cancelled (${oc.order.code}) — khách vẫn CK 180k`,
    `expired: ${JSON.stringify(we.data)} → ${E.data.order.status}/${eK.length}key | cancelled: ${JSON.stringify(wc.data)} → ${C.data.order.status}/${cK.length}key`,
    (eK.length && cK.length) ? 'không' : 'CÓ (đơn không được giao dù đã có tiền)',
    (eK.length && cK.length) ? 'không' : 'không',
    'Cả hai trạng thái vẫn được xác nhận & giao — đúng chủ đích "tiền về muộn vẫn giao".');
}

/* ---------- A6: gõ sai 1 ký tự ---------- */
{
  const o = await L.orderWithQr(u1.cookie, PROD, 1);
  const wrong = o.qr.memo.slice(0, -1) + (o.qr.memo.endsWith('X') ? 'Y' : 'X');
  const before = L.licCount(o.order.code);
  const w = await L.wh({
    id: 900008, accountNumber: '8990124112002', content: wrong,
    transferType: 'in', transferAmount: PRICE, referenceCode: L.ref('A6'),
  });
  const O = await L.getOrder(u1.cookie, o.order.id);
  const after = L.licCount(o.order.code);
  const un = L.q1(`SELECT COUNT(*) AS n FROM payments WHERE order_id IS NULL AND state='unmatched'`);

  rec('A6',
    `Đơn ${o.order.code}: khách gõ sai 1 ký tự "${wrong}" (đúng: ${o.qr.memo})`,
    `webhook=${JSON.stringify(w.data)} | đơn=${O.data.order.status} license ${before}→${after} | payments unmatched tổng=${un[0]?.n}`,
    after === before ? 'MẤT 180k tạm thời — chỉ cứu được nếu admin đọc Telegram' : 'không',
    'không (không giao sai)',
    'Tiền vào unmatched + báo Telegram. Không tự khớp mờ → đúng nhưng phụ thuộc admin.');
}

writeFileSync('qa/results-A.json', JSON.stringify(R, null, 1));
console.log(`\n--- A done: ${R.length} case ---`);
console.log(`users: ${u1.username} / ${u2.username}`);
