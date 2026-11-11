/**
 * BATTERY B — Số tiền. Chạy THẬT trên production.
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
const u = await L.register('b1');
console.log('user:', u.username);

const paySum = (code) => L.q1(
  `SELECT COALESCE(SUM(amount),0) AS s, COUNT(*) AS n FROM payments WHERE order_code='${code}'`)[0];
const st = async (oid) => (await L.getOrder(u.cookie, oid)).data.order;

/* ---------- B7: chuyển THIẾU ---------- */
{
  const o = await L.orderWithQr(u.cookie, PROD, 1);
  const w = await L.wh({
    id: 910001, accountNumber: '8990124112002', content: o.qr.memo,
    transferType: 'in', transferAmount: 100000, referenceCode: L.ref('B7'),
  });
  const s = await st(o.order.id);
  const ps = paySum(o.order.code);
  rec('B7', `Đơn ${o.order.code} 180k, khách CK 100k`,
    `webhook=${JSON.stringify(w.data)} | đơn=${s.status} keys=${s.items?.[0]?.keys?.length} | payments sum=${ps.s} n=${ps.n}`,
    'MẤT 100k tạm thời — ghi sổ wrong_amount, KHÔNG tự giao, KHÔNG báo Telegram',
    'không',
    'Tiền thiếu bị "treo" ở payments. Không có nút/flow nào báo admin trừ khi khách bấm "Tôi đã chuyển khoản".');

  /* ---------- B8: chuyển bù phần còn lại ---------- */
  const w2 = await L.wh({
    id: 910002, accountNumber: '8990124112002', content: o.qr.memo,
    transferType: 'in', transferAmount: 80000, referenceCode: L.ref('B8'),
  });
  const s2 = await st(o.order.id);
  const ps2 = paySum(o.order.code);
  rec('B8', `Bù 80k cho đơn ${o.order.code} (đã nhận 100k)`,
    `webhook=${JSON.stringify(w2.data)} | đơn=${s2.status} keys=${s2.items?.[0]?.keys?.length} | payments sum=${ps2.s} n=${ps2.n}`,
    ps2.s >= PRICE ? 'không (đã nhận đủ 180k)' : 'CẦN XEM',
    s2.items?.[0]?.keys?.length ? 'không (đã giao)' : 'MẤT HÀNG? khách CK đủ 180k mà không giao',
    'Chuyển bù KHÔNG cộng dồn số đã nhận: lần 2 so 80k với 180k → vẫn underpaid.');
}

/* ---------- B9: chuyển THỪA ---------- */
{
  const o = await L.orderWithQr(u.cookie, PROD, 1);
  const w = await L.wh({
    id: 910003, accountNumber: '8990124112002', content: o.qr.memo,
    transferType: 'in', transferAmount: 200000, referenceCode: L.ref('B9'),
  });
  const s = await st(o.order.id);
  const ps = paySum(o.order.code);
  rec('B9', `Đơn ${o.order.code} 180k, khách CK 200k`,
    `webhook=${JSON.stringify(w.data)} | đơn=${s.status} keys=${s.items?.[0]?.keys?.length} | payments sum=${ps.s}`,
    'MẤT 20k (không có cơ chế hoàn/ghi nợ — chỉ Telegram báo "Thừa: 20.000đ — cần hoàn tay")',
    'không (giao đúng 1 key)',
    'excess chỉ xuất hiện trong text Telegram; KHÔNG lưu DB, không có danh sách "cần hoàn".');
}

/* ---------- B10: 2 lần đủ (90k + 90k) ---------- */
{
  const o = await L.orderWithQr(u.cookie, PROD, 1);
  const w1 = await L.wh({
    id: 910004, accountNumber: '8990124112002', content: o.qr.memo,
    transferType: 'in', transferAmount: 90000, referenceCode: L.ref('B10a'),
  });
  const sA = await st(o.order.id);
  const w2 = await L.wh({
    id: 910005, accountNumber: '8990124112002', content: o.qr.memo,
    transferType: 'in', transferAmount: 90000, referenceCode: L.ref('B10b'),
  });
  const sB = await st(o.order.id);
  const ps = paySum(o.order.code);
  rec('B10', `Đơn ${o.order.code}: CK 90k rồi 90k (tổng 180k)`,
    `L1=${JSON.stringify(w1.data)} | L2=${JSON.stringify(w2.data)} | sau L1=${sA.status} sau L2=${sB.status}/${sB.items?.[0]?.keys?.length}key | payments sum=${ps.s} n=${ps.n}`,
    'MẤT 180k THẬT — khách chuyển đủ tiền nhưng đơn không được giao',
    'MẤT HÀNG (khách trả đủ, không nhận key)',
    'Không cộng dồn: mỗi webhook so riêng 90k < 180k → underpaid cả 2 lần. payments có 2 dòng 90k nhưng đơn vẫn pending.');
}

/* ---------- B11: chuyển 0đ ---------- */
{
  const o = await L.orderWithQr(u.cookie, PROD, 1);
  const w = await L.wh({
    id: 910006, accountNumber: '8990124112002', content: o.qr.memo,
    transferType: 'in', transferAmount: 0, referenceCode: L.ref('B11'),
  });
  const s = await st(o.order.id);
  rec('B11', `CK 0đ cho đơn ${o.order.code}`,
    `webhook=${JSON.stringify(w.data)} | đơn=${s.status}`,
    'không', 'không (không giao)', 'Bị chặn bằng ZERO_AMOUNT.');
}

/* ---------- B12: số âm ---------- */
{
  const o = await L.orderWithQr(u.cookie, PROD, 1);
  const w = await L.wh({
    id: 910007, accountNumber: '8990124112002', content: o.qr.memo,
    transferType: 'in', transferAmount: -180000, referenceCode: L.ref('B12'),
  });
  const s = await st(o.order.id);
  rec('B12', `CK -180.000đ cho đơn ${o.order.code}`,
    `webhook=${JSON.stringify(w.data)} | đơn=${s.status}`,
    'không', 'không', 'Bị chặn bằng ZERO_AMOUNT (amount <= 0).');
}

/* ---------- B-EXTRA: amount NaN / chuỗi lạ ---------- */
{
  const o = await L.orderWithQr(u.cookie, PROD, 1);
  const w = await L.wh({
    id: 910008, accountNumber: '8990124112002', content: o.qr.memo,
    transferType: 'in', transferAmount: 'abc', referenceCode: L.ref('B13'),
  });
  const s = await st(o.order.id);
  rec('B13', `transferAmount="abc" (chuỗi không phải số)`,
    `webhook=${JSON.stringify(w.data)} | đơn=${s.status}`,
    'không', 'không', 'Number("abc")=NaN → Math.floor(NaN)=0 → ZERO_AMOUNT.');
}

writeFileSync('qa/results-B.json', JSON.stringify(R, null, 1));
console.log(`\n--- B done: ${R.length} case ---`);
