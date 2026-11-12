import { Client, q, q1, BASE } from './q.mjs';
import { rec, newUser, makeOrder, getQr, hook, dump, SECRET } from './lib.mjs';
import fs from 'node:fs';

const tmp = JSON.parse(fs.readFileSync('qa/tmp-a.json', 'utf8'));
const vnHour = new Date(Date.now() + 7 * 3600_000).getUTCHours();
console.log('VN hour now =', vnHour, '(expect 12-23 => outside window)');

const c = new Client();
c.cookie = tmp.cookie;
c.username = tmp.username;
c.userId = tmp.userId;
const orderId = tmp.orderId;
const code = tmp.code;

// sanity: window settings
const win = await q(`SELECT key,value FROM settings WHERE key LIKE 'sepay_auto%' ORDER BY key`);
console.log('window settings:', win.map((w) => `${w.key}=${w.value}`).join(' '));

/* ---------- 7. Out of window -> AWAITING_ADMIN_APPROVAL ---------- */
const ref = 'TESTA' + Date.now().toString(36).toUpperCase();
const h7 = await hook({
  id: 990001, gateway: 'MBBank', transactionDate: '2026-11-12 19:45:00',
  accountNumber: '0010131639304', subAccount: null, transferType: 'in',
  transferAmount: 180000, accumulated: 0, code: null, content: 'MBK' + code.replace(/[^A-Z0-9]/g, '').replace(/^MBK/, ''),
  referenceCode: ref, description: 'QA test',
});
console.log('webhook resp:', JSON.stringify(h7.json));
rec(7, 'Ngoài cửa sổ -> AWAITING_ADMIN_APPROVAL, KHÔNG tự giao',
  h7.status === 200 && h7.json?.reason === 'AWAITING_ADMIN_APPROVAL' && h7.json?.delivered === false,
  `HTTP=${h7.status} reason=${h7.json?.reason} delivered=${h7.json?.delivered} window=${JSON.stringify(h7.json?.window)}`);

/* ---------- 8. payments row must be written with correct state/amount ---------- */
const p8 = await q1(
  `SELECT state, amount, expected, method, confirmed_by, is_test, order_id FROM payments WHERE txn_ref = ?`,
  [ref],
);
rec(8, 'Ghi sổ payments (state/amount) khi ngoài cửa sổ',
  p8?.state === 'matched' && Number(p8?.amount) === 180000 && Number(p8?.expected) === 180000 && p8?.order_id === orderId,
  `row=${JSON.stringify(p8)}`);

/* order must stay pending */
const o8 = await q1('SELECT status, paid_at FROM orders WHERE id = ?', [orderId]);
rec('8b', 'Đơn vẫn pending (chưa giao) ngoài cửa sổ', o8?.status === 'pending', `status=${o8?.status} paid_at=${o8?.paid_at}`);

/* ---------- 8c. duplicate webhook same referenceCode ---------- */
const h15 = await hook({
  id: 990001, transferType: 'in', accountNumber: '0010131639304',
  transferAmount: 180000, content: 'MBK' + code.replace(/[^A-Z0-9]/g, '').replace(/^MBK/, ''),
  referenceCode: ref,
});
const dupCount = await q1('SELECT COUNT(*) AS n FROM payments WHERE txn_ref = ?', [ref]);
rec(15, 'Webhook lặp cùng referenceCode -> không ghi 2 lần',
  dupCount?.n === 1 && h15.json?.duplicated === true,
  `count=${dupCount?.n} duplicated=${h15.json?.duplicated} resp=${JSON.stringify(h15.json)}`);

/* ---------- 9. notifyPaymentClaim called? (code read) ---------- */
rec(9, 'Báo Telegram notifyPaymentClaim ở nhánh ngoài cửa sổ (đọc code)',
  true,
  'payments.js:954-959 gọi notifyPaymentClaim khi !duplicated — ĐỌC CODE, chưa quan sát Telegram thật');

/* tidy: mark consumed so later tests can reuse */
fs.writeFileSync('qa/tmp-b.json', JSON.stringify({ ...tmp, ref, vnHour }, null, 2));
dump();
