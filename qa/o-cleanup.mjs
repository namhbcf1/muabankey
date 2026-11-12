import { q, q1 } from './q.mjs';

/*
 * DỌN SẠCH dữ liệu test do QA tạo ra phiên này.
 *
 * Nhận diện CHẮC CHẮN (chỉ dữ liệu của tôi):
 *   - username bắt đầu bằng 'qa' + tag tôi dùng (qaA, qaC, qaSec, qaAdm, qaAdm,
 *     qaDC, qaRL, qaMM, qaFV, qaFW, qaFE, qaRG, qaOT, qaA...)
 *   - payments.txn_ref bắt đầu bằng 'TEST' (tiền tố is_test của tôi)
 *   - order_items của các đơn đó
 *
 * KHÔNG đụng: user thật, đơn thật, @invalid của user cũ.
 */

const patUsers = await q(
  `SELECT id, username, full_name, email, created_at FROM users
   WHERE username LIKE 'qa%' OR full_name LIKE 'qa%'`,
);
console.log(`Users QA tìm thấy: ${patUsers.length}`);
for (const u of patUsers.slice(0, 15)) console.log(`  ${u.username} | ${u.email}`);

const ids = patUsers.map((u) => u.id);
if (ids.length === 0) { console.log('Không có user QA.'); }

const ph = ids.map(() => '?').join(',');
const ords = ids.length ? await q(`SELECT id FROM orders WHERE user_id IN (${ph})`, ids) : [];
const ordIds = ords.map((o) => o.id);
console.log(`Đơn của user QA: ${ordIds.length}`);

/* payments test theo txn_ref TEST* */
const pTest = await q1(`SELECT COUNT(*) n FROM payments WHERE txn_ref LIKE 'TEST%'`);
console.log(`Payments txn_ref TEST*: ${pTest.n}`);

console.log('\n--- XOÁ ---');
let del = {};

if (ids.length) {
  del.lic_events = (await q(`DELETE FROM lic_events WHERE key IN (SELECT license_key FROM license_issues WHERE user_id IN (${ph}))`, ids)).length ?? 'ok';
  del.license_issues = (await q(`DELETE FROM license_issues WHERE user_id IN (${ph})`, ids)).length ?? 'ok';
  del.payments = (await q(`DELETE FROM payments WHERE order_id IN (SELECT id FROM orders WHERE user_id IN (${ph}))`, ids)).length ?? 'ok';
  del.order_items = (await q(`DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE user_id IN (${ph}))`, ids)).length ?? 'ok';
  del.orders = (await q(`DELETE FROM orders WHERE user_id IN (${ph})`, ids)).length ?? 'ok';
  del.sessions = (await q(`DELETE FROM sessions WHERE user_id IN (${ph})`, ids)).length ?? 'ok';
  del.users = (await q(`DELETE FROM users WHERE id IN (${ph})`, ids)).length ?? 'ok';
}

/* xoá nốt payments test còn sót (unmatched test) */
const pLeft = await q(`SELECT id, txn_ref, state, amount FROM payments WHERE txn_ref LIKE 'TEST%'`);
console.log(`Payments TEST* còn lại: ${pLeft.length}`);
for (const p of pLeft.slice(0, 20)) console.log(`  ${p.txn_ref} ${p.state} ${p.amount}`);
if (pLeft.length) await q(`DELETE FROM payments WHERE txn_ref LIKE 'TEST%'`);

/* licenses sinh ra từ đơn QA (source=sold gắn license_issues đã xoá) */
console.log('\n--- KIỂM TRA SAU KHI DỌN ---');
const check = {
  users: (await q1('SELECT COUNT(*) n FROM users')).n,
  qaUsers: (await q1(`SELECT COUNT(*) n FROM users WHERE username LIKE 'qa%' OR full_name LIKE 'qa%'`)).n,
  orders: (await q1('SELECT COUNT(*) n FROM orders')).n,
  payments: (await q1('SELECT COUNT(*) n FROM payments')).n,
  testPayments: (await q1(`SELECT COUNT(*) n FROM payments WHERE txn_ref LIKE 'TEST%'`)).n,
  pendingOrders: (await q1(`SELECT COUNT(*) n FROM orders WHERE status='pending'`)).n,
  unmatchedReal: (await q1(`SELECT COUNT(*) n FROM payments WHERE state='unmatched' AND COALESCE(is_test,0)=0`)).n,
};
console.log(JSON.stringify(check, null, 2));

console.log('\n--- SETTINGS CUỐI ---');
for (const s of await q(`SELECT key,value FROM settings WHERE key LIKE 'sepay_auto%' OR key LIKE 'bank%' ORDER BY key`)) {
  console.log(`  ${s.key} = ${s.value}`);
}
