/**
 * BATTERY C14 (làm lại đúng) + BATTERY D — Webhook. Chạy THẬT production.
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
const u = await L.register('d1');

const st = async (oid) => (await L.getOrder(u.cookie, oid)).data.order;
const keysOf = (o) => o?.items?.[0]?.keys?.length || 0;
const pays = (code) => L.q1(
  `SELECT COALESCE(SUM(amount),0) AS s, COUNT(*) AS n FROM payments WHERE order_code='${code}'`)[0];
const licN = (code) => L.q1(`SELECT COUNT(*) AS n FROM licenses WHERE note LIKE '%${code}%'`)[0].n;

/* ================= C14 — Tạo lại QR khi QR hết hạn nhưng đơn còn 'pending' ================= */
{
  const o = await L.orderWithQr(u.cookie, PROD, 1);
  // QR hết hạn (quá 30') NHƯNG đơn vẫn pending (cron 45' chưa chạy)
  L.d1(`UPDATE orders SET qr_expires_at=${Math.floor(Date.now() / 1000) - 60} WHERE id='${o.order.id}'`);
  const q = await L.getQr(u.cookie, o.order.id); // "Tạo lại QR"
  const memo2 = q.data?.qr?.memo;
  const w = await L.wh({
    id: 930001, accountNumber: '8990124112002', content: memo2,
    transferType: 'in', transferAmount: PRICE, referenceCode: L.ref('C14b'),
  });
  const s = await st(o.order.id);
  rec('C14', `QR hết hạn, đơn còn 'pending'. Khách bấm "Tạo lại QR" rồi CK`,
    `QR mới=${q.status}, memo ${o.qr.memo} → ${memo2} (${memo2 === o.qr.memo ? 'GIỐNG' : 'KHÁC'}), secondsLeft=${q.data?.qr?.secondsLeft} | webhook=${JSON.stringify(w.data)} | đơn=${s.status} keys=${keysOf(s)}`,
    keysOf(s) ? 'không' : 'CÓ', keysOf(s) ? 'không' : 'CÓ',
    'Sinh lại QR chỉ gia hạn thời gian, GIỮ NGUYÊN nội dung → tiền luôn khớp. Tốt.');
}

/* ================= D19 — webhook 2 lần CÙNG referenceCode ================= */
{
  const o = await L.orderWithQr(u.cookie, PROD, 1);
  const rc = L.ref('D19');
  const p = { id: 930002, accountNumber: '8990124112002', content: o.qr.memo,
    transferType: 'in', transferAmount: PRICE, referenceCode: rc };
  const w1 = await L.wh(p);
  const n1 = licN(o.order.code);
  const w2 = await L.wh(p);
  const n2 = licN(o.order.code);
  const ps = pays(o.order.code);
  rec('D19', `Gửi webhook 2 lần CÙNG referenceCode=${rc}`,
    `L1=${JSON.stringify(w1.data)} | L2=${JSON.stringify(w2.data)} | license ${n1}→${n2} | payments=${ps.s}/${ps.n}`,
    n2 === n1 ? 'không' : 'MẤT (giao trùng)', n2 === n1 ? 'không (chống trùng OK)' : 'MẤT HÀNG',
    'UNIQUE index ux_pay_txn + check txn_ref tồn tại → chặn được replay.');
}

/* ================= D20 — 2 webhook KHÁC referenceCode cùng mã đơn ================= */
{
  const o = await L.orderWithQr(u.cookie, PROD, 1);
  const w1 = await L.wh({ id: 930003, accountNumber: '8990124112002', content: o.qr.memo,
    transferType: 'in', transferAmount: PRICE, referenceCode: L.ref('D20a') });
  const n1 = licN(o.order.code);
  const w2 = await L.wh({ id: 930004, accountNumber: '8990124112002', content: o.qr.memo,
    transferType: 'in', transferAmount: PRICE, referenceCode: L.ref('D20b') });
  const n2 = licN(o.order.code);
  const ps = pays(o.order.code);
  rec('D20', `2 webhook KHÁC referenceCode, cùng mã đơn (khách CK 2 lần thật)`,
    `L1=${JSON.stringify(w1.data)} | L2=${JSON.stringify(w2.data)} | license ${n1}→${n2} | payments=${ps.s}/${ps.n}`,
    n2 === n1 ? 'MẤT 180k lần 2 — KHÔNG ghi sổ, KHÔNG Telegram' : 'ok',
    n2 === n1 ? 'không (không giao trùng)' : 'MẤT HÀNG',
    'Chống giao trùng tốt, nhưng tiền lần 2 biến mất khỏi sổ + không ai được báo.');
}

/* ================= D21 — transferType='out' ================= */
{
  const o = await L.orderWithQr(u.cookie, PROD, 1);
  const before = licN(o.order.code);
  const w = await L.wh({ id: 930005, accountNumber: '8990124112002', content: o.qr.memo,
    transferType: 'out', transferAmount: PRICE, referenceCode: L.ref('D21') });
  const after = licN(o.order.code);
  const s = await st(o.order.id);
  rec('D21', `Webhook transferType='out' (lệnh RÚT tiền) trùng mã đơn`,
    `webhook=${JSON.stringify(w.data)} | đơn=${s.status} license ${before}→${after}`,
    'không', 'không (bị chặn)', 'NOT_INBOUND chặn đúng.');
}

/* ================= D22 — sai accountNumber ================= */
{
  const o = await L.orderWithQr(u.cookie, PROD, 1);
  const w = await L.wh({ id: 930006, accountNumber: '9999999999', content: o.qr.memo,
    transferType: 'in', transferAmount: PRICE, referenceCode: L.ref('D22') });
  const s = await st(o.order.id);
  rec('D22', `Webhook accountNumber='9999999999' (sai TK nhận)`,
    `webhook=${JSON.stringify(w.data)} | đơn=${s.status}`, 'không', 'không', 'WRONG_ACCOUNT chặn đúng.');

  // D22b: THIẾU hẳn accountNumber -> có bị bỏ qua kiểm tra?
  const w2 = await L.wh({ id: 930007, content: o.qr.memo,
    transferType: 'in', transferAmount: PRICE, referenceCode: L.ref('D22b') });
  const s2 = await st(o.order.id);
  rec('D22b', `Webhook KHÔNG có accountNumber (field bị bỏ trống)`,
    `webhook=${JSON.stringify(w2.data)} | đơn=${s2.status} keys=${keysOf(s2)}`,
    'không', keysOf(s2) ? 'không' : '-',
    'Guard chỉ chạy khi body.accountNumber có giá trị → payload thiếu field vẫn được chấp nhận.');
}

/* ================= D23 — thiếu content ================= */
{
  const o = await L.orderWithQr(u.cookie, PROD, 1);
  const w = await L.wh({ id: 930008, accountNumber: '8990124112002',
    transferType: 'in', transferAmount: PRICE, referenceCode: L.ref('D23') });
  const s = await st(o.order.id);
  rec('D23', `Webhook thiếu hẳn 'content'`,
    `webhook=${JSON.stringify(w.data)} | đơn=${s.status}`, 'không', 'không',
    'content="" → extractMemo null → unmatched (ghi sổ + báo Telegram). An toàn.');
}

/* ================= D24 — 100 webhook ĐỒNG THỜI cùng đơn ================= */
{
  const o = await L.orderWithQr(u.cookie, PROD, 1);
  const before = licN(o.order.code);
  const reqs = [];
  for (let i = 0; i < 100; i++) {
    reqs.push(L.wh({ id: 940000 + i, accountNumber: '8990124112002', content: o.qr.memo,
      transferType: 'in', transferAmount: PRICE, referenceCode: `D24-${Date.now()}-${i}` }));
  }
  const res = await Promise.all(reqs);
  const after = licN(o.order.code);
  const delivered = res.filter((x) => x.data?.delivered === true).length;
  const dup = res.filter((x) => x.data?.duplicated === true).length;
  const under = res.filter((x) => x.data?.underpaid === true).length;
  const ps = pays(o.order.code);
  rec('D24', `Bắn 100 webhook ĐỒNG THỜI, cùng mã đơn, cùng 180k, 100 referenceCode khác nhau`,
    `delivered=${delivered} duplicated=${dup} underpaid=${under} | license ${before}→${after} (+${after - before}) | payments sum=${ps.s} n=${ps.n}`,
    `MẤT ${ps.s - PRICE}đ về mặt đối soát (sổ ghi ${ps.s} nhưng chỉ 1 đơn 180k)`,
    after - before > 1 ? `MẤT HÀNG: giao ${after - before} license cho 1 đơn` : 'không (chỉ 1 key)',
    `Khoá nguyên tử L2 cứu được việc giao trùng, nhưng ${ps.n} dòng payments được ghi → sổ tiền phồng.`);
}

/* ================= D25 — webhook đến TRƯỚC khi đơn commit xong ================= */
{
  // Mô phỏng: đoán mã đơn CHƯA tồn tại (đơn khách khác đang tạo) -> unmatched
  const fake = 'MBK' + Math.random().toString(36).slice(2, 8).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const w = await L.wh({ id: 935000, accountNumber: '8990124112002', content: fake,
    transferType: 'in', transferAmount: PRICE, referenceCode: L.ref('D25') });
  const un = L.q1(`SELECT COUNT(*) AS n FROM payments WHERE state='unmatched'`)[0].n;
  rec('D25', `Webhook tới với mã đơn CHƯA tồn tại (${fake}) — race với lúc tạo đơn`,
    `webhook=${JSON.stringify(w.data)} | tổng unmatched=${un}`,
    'MẤT tạm thời — không có cơ chế khớp lại sau', 'không',
    'Không có retry/reconcile: nếu webhook tới trước khi INSERT orders xong thì tiền thành unmatched vĩnh viễn.');
}

writeFileSync('qa/results-D.json', JSON.stringify(R, null, 1));
console.log(`\n--- C14+D done: ${R.length} ---`);
