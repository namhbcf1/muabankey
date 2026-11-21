import { Client, q, q1, BASE } from './q.mjs';
import { adminCredentials } from './qa-guard.mjs';
import { rec, newUser, hook, dump } from './lib.mjs';

const adm = new Client();
await adm.req('/api/auth/login', { method: 'POST', body: adminCredentials() });

const u = await newUser('DC');
const o = (await u.req('/api/orders', { method: 'POST', body: { items: [{ productId: 'p-lic-month', quantity: 1 }] } })).json.order;
const gq = (await u.req(`/api/orders/${o.id}/qr`, { method: 'POST' })).json.qr;

console.log('order', o.code, 'total', o.total, 'memo', gq.memo);

/* Scenario 1: khách chuyển ĐÚNG 180k ngoài cửa sổ, rồi admin bấm "Đã nhận tiền" */
const ref = 'TESTDOUBLE' + Date.now().toString(36).toUpperCase();
const h = await hook({ id: 993001, transferType: 'in', accountNumber: '0010131639304', transferAmount: 180000, content: gq.memo, referenceCode: ref });
console.log('webhook:', JSON.stringify(h.json));

const before = await q(`SELECT state, amount, expected, method, confirmed_by FROM payments WHERE order_id = ?`, [o.id]);
console.log('payments BEFORE admin confirm:', JSON.stringify(before));

const cp = await adm.req(`/api/admin/orders/${o.id}/confirm-payment`, { method: 'POST', body: {} });
console.log('confirm-payment resp:', JSON.stringify(cp.json));

const after = await q(`SELECT state, amount, expected, method, confirmed_by FROM payments WHERE order_id = ?`, [o.id]);
console.log('payments AFTER admin confirm:', JSON.stringify(after));

const sum = after.reduce((s, r) => s + Number(r.amount || 0), 0);
const sumCounted = after.filter((r) => ['matched', 'wrong_amount'].includes(r.state)).reduce((s, r) => s + Number(r.amount || 0), 0);
console.log(`\n  order.total = ${o.total}`);
console.log(`  SUM(all payments)         = ${sum}`);
console.log(`  SUM(matched+wrong_amount)  = ${sumCounted}  <-- what confirmOrderPaid uses as prev`);
console.log(`  excess báo cho admin      = ${cp.json?.excess}`);

const orderedAmount = 180000;
const inflated = sumCounted > orderedAmount;
console.log(`\n  *** LEDGER INFLATED? ${inflated ? 'YES (ảo ' + (sumCounted - orderedAmount) + 'đ)' : 'no'}`);

rec('X1', 'Ghi sổ KHÔNG bị đếm trùng khi admin duyệt đơn đã có webhook ghi sổ',
  !inflated && Number(cp.json?.excess || 0) === 0,
  `order.total=180000 | sumRecords=${sumCounted} | rows=${after.length} | excess=${cp.json?.excess} ${inflated ? '=> SAI: báo thừa ' + (sumCounted - 180000) + 'đ' : ''}`);

/* Scenario 2: khách chuyển THIẾU 90k ngoài cửa sổ, admin duyệt */
const u2 = await newUser('DC');
const o2 = (await u2.req('/api/orders', { method: 'POST', body: { items: [{ productId: 'p-lic-month', quantity: 1 }] } })).json.order;
const gq2 = (await u2.req(`/api/orders/${o2.id}/qr`, { method: 'POST' })).json.qr;
const ref2 = 'TESTSHORT2' + Date.now().toString(36).toUpperCase();
const h2 = await hook({ id: 993002, transferType: 'in', accountNumber: '0010131639304', transferAmount: 90000, content: gq2.memo, referenceCode: ref2 });
console.log('\nwebhook short:', JSON.stringify(h2.json));
const cp2 = await adm.req(`/api/admin/orders/${o2.id}/confirm-payment`, { method: 'POST', body: {} });
const after2 = await q(`SELECT state, amount FROM payments WHERE order_id = ?`, [o2.id]);
const sum2 = after2.filter((r) => ['matched', 'wrong_amount'].includes(r.state)).reduce((s, r) => s + Number(r.amount || 0), 0);
console.log('confirm resp:', JSON.stringify(cp2.json), '| rows:', JSON.stringify(after2), '| sum=', sum2);

rec('X2', 'Chuyển THIẾU 90k rồi admin duyệt: sổ không ảo',
  sum2 === 180000,
  `khách thật chuyển 90.000đ nhưng sổ ghi ${sum2}đ (ảo +${sum2 - 90000}đ so với tiền thật)`);

dump();
