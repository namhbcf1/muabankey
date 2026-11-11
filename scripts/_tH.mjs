/**
 * BATTERY H — Race điều kiện: claim() chấp nhận cả status 'processing',
 * nên 2 request đồng thời có thể cùng vào deliverOrderItems → giao 2 lần.
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
const u = await L.register('h1');
const licN = (code) => L.q1(`SELECT COUNT(*) AS n FROM licenses WHERE note LIKE '%${code}%'`)[0].n;

/* ---------- H1: 8 webhook ĐỒNG THỜI cùng đơn, license ---------- */
{
  const o = await L.orderWithQr(u.cookie, PROD, 1);
  const before = licN(o.order.code);
  const reqs = Array.from({ length: 8 }, (_, i) =>
    L.wh({ id: 990000 + i, accountNumber: '8990124112002', content: o.qr.memo,
      transferType: 'in', transferAmount: PRICE, referenceCode: `H1-${Date.now()}-${i}` }));
  const res = await Promise.all(reqs);
  const after = licN(o.order.code);
  const s = (await L.getOrder(u.cookie, o.order.id)).data.order;
  const ps = L.q1(`SELECT COALESCE(SUM(amount),0) s, COUNT(*) n FROM payments WHERE order_code='${o.order.code}'`)[0];
  rec('H1', `8 webhook ĐỒNG THỜI, cùng đơn ${o.order.code}, mỗi cái 180k (8 txnRef khác nhau)`,
    `delivered=${res.filter(r => r.data?.delivered).length} dup=${res.filter(r => r.data?.duplicated).length} | license ${before}→${after} (+${after - before}) | payments ${ps.s}đ/${ps.n} dòng | đơn=${s.status}`,
    ps.s > PRICE ? `Sổ ghi ${ps.s}đ cho đơn 180k — thừa ${ps.s - PRICE}đ không ai hoàn` : 'không',
    after - before > 1 ? `MẤT HÀNG: giao ${after - before} license cho 1 đơn` : 'không (chỉ 1 license)',
    'Kiểm chứng khoá L2 + kiểm delivered_keys có chặn được giao trùng license không.');

  const licRows = L.q1(`SELECT key,revoked FROM licenses WHERE note LIKE '%${o.order.code}%'`);
  console.log('  license rows:', JSON.stringify(licRows));
  const oi = L.q1(`SELECT delivered_keys FROM order_items WHERE order_id='${o.order.id}'`);
  console.log('  order_items.delivered_keys:', JSON.stringify(oi));
}

/* ---------- H2: 20 webhook đồng thời, mỗi cái 18k (tổng 360k) ---------- */
{
  const o = await L.orderWithQr(u.cookie, PROD, 1);
  const before = licN(o.order.code);
  const reqs = Array.from({ length: 20 }, (_, i) =>
    L.wh({ id: 991000 + i, accountNumber: '8990124112002', content: o.qr.memo,
      transferType: 'in', transferAmount: 18000, referenceCode: `H2-${Date.now()}-${i}` }));
  const res = await Promise.all(reqs);
  const after = licN(o.order.code);
  const ps = L.q1(`SELECT COALESCE(SUM(amount),0) s, COUNT(*) n FROM payments WHERE order_code='${o.order.code}'`)[0];
  const s = (await L.getOrder(u.cookie, o.order.id)).data.order;
  rec('H2', `20 webhook ĐỒNG THỜI, mỗi cái 18k (tổng 360k) cho đơn 180k`,
    `delivered=${res.filter(r => r.data?.delivered).length} underpaid=${res.filter(r => r.data?.underpaid).length} | license +${after - before} | payments ${ps.s}đ/${ps.n} dòng | đơn=${s.status}`,
    ps.s > PRICE ? `Sổ ghi ${ps.s}đ — khách chuyển thừa ${ps.s - PRICE}đ so với đơn` : 'không',
    after - before > 1 ? `MẤT HÀNG: ${after - before} license` : 'không',
    'Race đọc prevPaid: nhiều request cùng đọc prev=0 nên đều thấy thiếu.');
}

writeFileSync('qa/results-H.json', JSON.stringify(R, null, 1));
console.log(`\n--- H done ---`);
