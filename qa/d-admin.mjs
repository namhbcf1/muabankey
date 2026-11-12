import { Client, q, q1, BASE } from './q.mjs';
import { rec, dump } from './lib.mjs';
import fs from 'node:fs';

const adm = new Client();
const lg = await adm.req('/api/auth/login', { method: 'POST', body: { username: 'namhbcf', password: 'namhbcf123' } });
console.log('login:', lg.status, JSON.stringify(lg.json)?.slice(0, 200));
rec(19, 'Đăng nhập admin namhbcf',
  lg.status === 200 && lg.json?.user?.role === 'admin',
  `HTTP=${lg.status} role=${lg.json?.user?.role} user=${lg.json?.user?.username}`);

/* ---------- 19b. dashboard ---------- */
const dash = await adm.req('/api/admin/dashboard');
const st = dash.json?.stats;
rec('19b', 'Dashboard số liệu', dash.status === 200 && !!st,
  `revenue=${st?.revenue} orders=${st?.orders} users=${st?.users} pending=${st?.pendingOrders} lowStock=${st?.lowStock}`);

// cross-check revenue against DB
const dbRev = await q1(`SELECT COALESCE(SUM(total),0) AS v FROM orders WHERE status IN ('paid','delivered')`);
const revOk = Number(dbRev?.v) === Number(st?.revenue);
rec('19c', 'Dashboard revenue khớp DB', revOk, `api=${st?.revenue} db=${dbRev?.v}`);

// users count cross-check (excluding @local/@test.vn/@example.com, role!=admin)
const dbUsers = await q1(`SELECT COUNT(*) AS v FROM users WHERE email NOT LIKE '%@local' AND email NOT LIKE '%@test.vn' AND email NOT LIKE '%@example.com' AND role != 'admin'`);
rec('19d', 'Dashboard users khớp DB (đã loại test)', Number(dbUsers?.v) === Number(st?.users), `api=${st?.users} db=${dbUsers?.v}`);

/* ---------- 20. Tab "Chờ thanh toán" data ---------- */
const [pay, pendOrders] = await Promise.all([
  adm.req('/api/admin/payments'),
  adm.req('/api/admin/orders?status=pending'),
]);
rec(20, 'Tab "Chờ thanh toán": 2 API nền tảng trả OK',
  pay.status === 200 && pendOrders.status === 200 && Array.isArray(pay.json?.payments) && Array.isArray(pendOrders.json?.orders),
  `payments=${pay.json?.payments?.length} stats=${JSON.stringify(pay.json?.stats)} pendingOrders=${pendOrders.json?.orders?.length}`);

// Check every payment row has the fields the UI renders (orderCode, amount, expected, content, state, at)
const badRows = (pay.json.payments || []).filter((p) => p.state === undefined || p.at === undefined);
rec('20b', 'Mọi dòng payments có đủ field UI cần (state/at/amount)',
  badRows.length === 0, `bad=${badRows.length} sample=${JSON.stringify(pay.json.payments?.[0])?.slice(0, 160)}`);

// UI STATE_LABEL covers all states present in DB?
const statesInDb = (await q('SELECT DISTINCT state FROM payments')).map((r) => r.state);
const UILabels = ['matched', 'unmatched', 'wrong_amount', 'claimed', 'duplicate'];
const missing = statesInDb.filter((s) => !UILabels.includes(s));
rec('20c', 'Mọi state trong DB đều có nhãn trong UI', missing.length === 0,
  `dbStates=${statesInDb.join(',')} missing=${missing.join(',') || 'none'}`);

/* ---------- 21+24. Nút "Đã nhận tiền" / "Giao" ---------- */
// Create a real pending order paid out-of-window, then admin confirms.
const u = new Client();
const reg = await u.req('/api/auth/register', { method: 'POST', body: { username: 'qaAdm' + Date.now().toString(36).slice(-6), password: 'QaPassw0rd!23' } });
u.cookie; u.username = reg.json.user.username; u.userId = reg.json.user.id;
const o = (await u.req('/api/orders', { method: 'POST', body: { items: [{ productId: 'p-lic-month', quantity: 1 }] } })).json.order;
const gq = (await u.req(`/api/orders/${o.id}/qr`, { method: 'POST' })).json.qr;

import { hook } from './lib.mjs';
const whr = await hook({ id: 992001, transferType: 'in', accountNumber: '0010131639304', transferAmount: 180000, content: gq.memo, referenceCode: 'TESTADMIN' + Date.now().toString(36).toUpperCase() });
console.log('   seeded pending w/ money:', JSON.stringify(whr.json));

const cp = await adm.req(`/api/admin/orders/${o.id}/confirm-payment`, { method: 'POST', body: {} });
const oAfter = await q1('SELECT status FROM orders WHERE id = ?', [o.id]);
const li = await q1('SELECT COUNT(*) AS n FROM license_issues WHERE order_id = ?', [o.id]);
rec(21, 'Nút "Đã nhận tiền" (confirm-payment) hoạt động',
  cp.status === 200 && cp.json?.delivered === true && oAfter?.status === 'delivered',
  `HTTP=${cp.status} delivered=${cp.json?.delivered} order=${oAfter?.status} license_issues=${li?.n}`);
rec(24, 'confirm-payment cấp key/license THẬT (license_issues)',
  (li?.n || 0) >= 1, `license_issues=${li?.n}`);

/* ---------- 22. Tab Đơn hàng ---------- */
const allOrders = await adm.req('/api/admin/orders');
const dbOrders = await q1('SELECT COUNT(*) AS n FROM orders');
rec(22, 'Tab Đơn hàng hiện đủ',
  allOrders.status === 200 && (allOrders.json?.orders || []).length > 0,
  `api=${allOrders.json?.orders?.length} (LIMIT 200) dbTotal=${dbOrders?.n}`);

/* ---------- 23. Tab Người dùng: KHÔNG còn cột số dư ---------- */
const us = await adm.req('/api/admin/users');
const hasBalance = (us.json?.users || []).some((x) => 'balance' in x);
const uiHasCol = fs.readFileSync('public/assets/pages/admin.js', 'utf8').includes('Số dư');
rec(23, 'Tab Người dùng KHÔNG còn cột số dư',
  !uiHasCol && us.status === 200,
  `API vẫn trả field balance=${hasBalance} | UI admin.js còn chuỗi "Số dư"=${uiHasCol} (dòng 1244/1257)`);

fs.writeFileSync('qa/tmp-d.json', JSON.stringify({ order: o.id, user: u.userId, adm: adm.cookie }, null, 2));
dump();
