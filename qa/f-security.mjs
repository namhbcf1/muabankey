import { Client, q, q1, BASE } from './q.mjs';
import { rec, newUser, makeOrder, getQr, dump } from './lib.mjs';
import fs from 'node:fs';

const cA = new Client(); // user A
const regA = await cA.req('/api/auth/register', { method: 'POST', body: { username: 'qaSecA' + Date.now().toString(36).slice(-6), password: 'QaPassw0rd!23' } });
cA.cookie; cA.username = regA.json.user.username; cA.userId = regA.json.user.id;

const ordA = await makeOrder(cA, 'p-lic-month', 1);
const orderA = ordA.json.order;

/* ---------- 31. /api/admin/* without auth -> 401 ---------- */
const anon = new Client();
const adminEps = [
  ['GET', '/api/admin/dashboard'],
  ['GET', '/api/admin/users'],
  ['GET', '/api/admin/orders'],
  ['GET', '/api/admin/payments'],
  ['GET', '/api/admin/settings'],
  ['GET', '/api/admin/sepay/quota'],
  ['GET', '/api/admin/sepay/reconcile?days=1'],
  ['GET', '/api/admin/products'],
  ['GET', '/api/admin/licenses'],
];
const anonRes = [];
for (const [m, p] of adminEps) {
  const r = await anon.req(p, { method: m });
  anonRes.push(`${p}=${r.status}`);
}
const all401 = anonRes.every((s) => s.endsWith('=401'));
rec(31, '/api/admin/* không auth -> 401', all401, anonRes.join(' '));

/* ---------- 32. user thường gọi admin -> 403 ---------- */
const userRes = [];
for (const [m, p] of adminEps) {
  const r = await cA.req(p, { method: m });
  userRes.push(`${p}=${r.status}`);
}
const all403 = userRes.every((s) => s.endsWith('=403'));
rec(32, 'User thường gọi admin -> 403', all403, userRes.join(' '));

/* ---------- 33. đọc đơn người khác -> 404 ---------- */
const cB = new Client();
const regB = await cB.req('/api/auth/register', { method: 'POST', body: { username: 'qaSecB' + Date.now().toString(36).slice(-6), password: 'QaPassw0rd!23' } });
cB.cookie; cB.username = regB.json.user.username; cB.userId = regB.json.user.id;

const steal1 = await cB.req(`/api/orders/${orderA.id}`);
const steal2 = await cB.req(`/api/orders/${orderA.code}`);
const steal3 = await cB.req(`/api/orders/${orderA.id}/qr`, { method: 'POST' });
rec(33, 'Đọc/sửa đơn người khác -> 404',
  steal1.status === 404 && steal2.status === 404 && steal3.status === 404,
  `byId=${steal1.status} byCode=${steal2.status} qr=${steal3.status}`);

/* ---------- 34. sửa giá trong request -> server giữ giá gốc ---------- */
const tamper = await cA.req('/api/orders', {
  method: 'POST',
  body: { items: [{ productId: 'p-lic-month', quantity: 1, price: 1, unitPrice: 1, lineTotal: 1 }], total: 1, subtotal: 1 },
});
const tamperOk = tamper.status === 201 && tamper.json?.order?.total === 180000;
rec(34, 'Sửa giá trong request -> server giữ giá gốc 180k', tamperOk,
  `HTTP=${tamper.status} total=${tamper.json?.order?.total} subtotal=${tamper.json?.order?.subtotal}`);

/* tamper quantity/negative */
const tamper2 = await cA.req('/api/orders', { method: 'POST', body: { items: [{ productId: 'p-lic-month', quantity: -5 }] } });
rec('34b', 'quantity âm -> chặn 400', tamper2.status === 400, `HTTP=${tamper2.status} code=${tamper2.json?.error?.code || tamper2.json?.code}`);

/* forged webhook without secret */
const forge = await fetch(BASE + '/api/webhooks/sepay', {
  method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Apikey WRONG' },
  body: JSON.stringify({ transferType: 'in', accountNumber: '0010131639304', transferAmount: 180000, content: 'MBK' + orderA.code.replace(/[^A-Z0-9]/g, '').replace(/^MBK/, ''), referenceCode: 'FORGE' + Date.now() }),
}).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
const stillPending = await q1('SELECT status FROM orders WHERE id = ?', [orderA.id]);
rec('34c', 'Webhook sai secret -> 401, đơn không đổi',
  forge.status === 401 && stillPending?.status === 'pending',
  `HTTP=${forge.status} order=${stillPending?.status}`);

fs.writeFileSync('qa/tmp-f.json', JSON.stringify({ orderA: orderA.id, a: cA.userId, b: cB.userId }, null, 2));
dump();
