/**
 * Xác định PRODUCTION đang chạy version nào (có các fix trong working tree chưa).
 */
import * as L from './_qr_lib.mjs';

const adm = await L.login('namhbcf', 'namhbcf123');
const u = await L.register('ver1');
const o = await L.orderWithQr(u.cookie, 'p-lic-month', 1);

const checks = [
  ['POST /api/admin/orders/:id/confirm-payment (fix mới)', () =>
    L.http(`/api/admin/orders/${o.order.id}/confirm-payment`, { method: 'POST', cookie: adm.cookie, body: {} })],
  ['GET /api/admin/payments (sổ tiền vào)', () =>
    L.http('/api/admin/payments', { cookie: adm.cookie })],
  ['GET /api/admin/payments?state=unmatched', () =>
    L.http('/api/admin/payments?state=unmatched', { cookie: adm.cookie })],
];

for (const [label, fn] of checks) {
  try {
    const r = await fn();
    console.log(`\n${label}\n  HTTP=${r.status} code=${r.data?.code || '-'} :: ${JSON.stringify(r.data).slice(0, 220)}`);
  } catch (e) {
    console.log(`\n${label}\n  ERR ${e.message}`);
  }
}
