import { Client, q, q1, BASE } from './q.mjs';
import { adminCredentials } from './qa-guard.mjs';
import { rec, newUser, makeOrder, getQr, hook, dump, SECRET } from './lib.mjs';

const adm = new Client();
await adm.req('/api/auth/login', { method: 'POST', body: adminCredentials() });
const setS = (k, v) => q(`UPDATE settings SET value = ? WHERE key = ?`, [String(v), k]);
const getS = async (k) => (await q1('SELECT value FROM settings WHERE key = ?', [k]))?.value;

/* ============ A. Basic flow ============ */
const c = await newUser('RG');
const or = await makeOrder(c, 'p-lic-month', 1);
const order = or.json.order;
rec('R2', 'Tạo đơn 180k', or.status === 201 && order.total === 180000 && order.status === 'pending', `total=${order.total}`);

const qr = (await getQr(c, order.id)).json;
rec('R3', 'QR đúng STK/tiền/memo + ảnh tải được',
  qr.qr.amount === 180000 && qr.qr.bank.account === '0010131639304' && qr.qr.memo === 'MBK' + order.code.slice(4),
  `amount=${qr.qr.amount} acc=${qr.qr.bank.account} memo=${qr.qr.memo} bankName=${qr.qr.bank.name} owner=${qr.qr.bank.owner}`);
const img = await fetch(qr.qr.url);
rec('R3b', 'Ảnh QR tải được', img.status === 200 && (await img.arrayBuffer()).byteLength > 200, `${qr.qr.url}`);

const pre = await c.req(`/api/orders/${order.id}`);
rec('R6', 'Key không lộ khi chưa thanh toán', JSON.stringify(pre.json.order.items.map((i) => i.keys)) === '[[]]', '');

/* ============ B. Window ============ */
const whw = await hook({ id: 997001, transferType: 'in', accountNumber: '0010131639304', transferAmount: 180000, content: qr.qr.memo, referenceCode: 'TESTREGW' + Date.now() });
rec('R7', 'Ngoài cửa sổ -> AWAITING_ADMIN_APPROVAL, không giao',
  whw.json.reason === 'AWAITING_ADMIN_APPROVAL' && whw.json.delivered === false, `hour=${whw.json.window?.hour}`);

const pRow = await q1('SELECT state, amount FROM payments WHERE order_id = ?', [order.id]);
rec('R8', 'Ghi sổ payments ngoài cửa sổ', pRow?.state === 'matched' && Number(pRow?.amount) === 180000, JSON.stringify(pRow));

/* ============ C. Money (window off) ============ */
const ORIG = { e: await getS('sepay_auto_enabled'), f: await getS('sepay_auto_from'), t: await getS('sepay_auto_to') };
try {
  await setS('sepay_auto_enabled', 0);

  // #10 auto deliver
  {
    const o = (await makeOrder(c, 'p-lic-month', 1)).json.order;
    const g = (await getQr(c, o.id)).json.qr;
    const h = await hook({ id: 997002, transferType: 'in', accountNumber: '0010131639304', transferAmount: 180000, content: g.memo, referenceCode: 'TESTRGA' + Date.now() });
    const st = await q1('SELECT status FROM orders WHERE id = ?', [o.id]);
    const keys = (await c.req(`/api/orders/${o.id}`)).json.order.items.flatMap((i) => i.keys);
    rec('R10', 'Tắt cửa sổ -> tự giao', h.json.delivered === true && st.status === 'delivered', `order=${st.status}`);
    rec('R5', 'Khách đọc được key sau khi giao', keys.length > 0, `keys=${JSON.stringify(keys)}`);
  }

  // #11 underpaid, #12 top-up
  {
    const o = (await makeOrder(c, 'p-lic-month', 1)).json.order;
    const g = (await getQr(c, o.id)).json.qr;
    const h1 = await hook({ id: 997003, transferType: 'in', accountNumber: '0010131639304', transferAmount: 90000, content: g.memo, referenceCode: 'TESTS' + Date.now() + 'a' });
    const s1 = await q1('SELECT status FROM orders WHERE id = ?', [o.id]);
    rec('R11', 'Chuyển thiếu -> underpaid, không giao', h1.json.underpaid === true && s1.status === 'pending', `order=${s1.status}`);
    const h2 = await hook({ id: 997004, transferType: 'in', accountNumber: '0010131639304', transferAmount: 90000, content: g.memo, referenceCode: 'TESTS' + Date.now() + 'b' });
    const s2 = await q1('SELECT status FROM orders WHERE id = ?', [o.id]);
    rec('R12', 'Chuyển bù đủ -> giao', h2.json.delivered === true && s2.status === 'delivered', `order=${s2.status}`);
  }

  // #13 overpaid
  {
    const o = (await makeOrder(c, 'p-lic-month', 1)).json.order;
    const g = (await getQr(c, o.id)).json.qr;
    const h = await hook({ id: 997005, transferType: 'in', accountNumber: '0010131639304', transferAmount: 200000, content: g.memo, referenceCode: 'TESTO' + Date.now() });
    rec('R13', 'Chuyển thừa -> giao', h.json.delivered === true, `resp=${JSON.stringify(h.json)}`);
  }

  // #14 two transfers
  {
    const o = (await makeOrder(c, 'p-lic-month', 1)).json.order;
    const g = (await getQr(c, o.id)).json.qr;
    await hook({ id: 997006, transferType: 'in', accountNumber: '0010131639304', transferAmount: 180000, content: g.memo, referenceCode: 'TESTT' + Date.now() + '1' });
    const h2 = await hook({ id: 997007, transferType: 'in', accountNumber: '0010131639304', transferAmount: 180000, content: g.memo, referenceCode: 'TESTT' + Date.now() + '2' });
    const cnt = await q1('SELECT COUNT(*) n FROM license_issues WHERE order_id = ?', [o.id]);
    rec('R14', 'Chuyển 2 lần -> lần 2 không giao', h2.json.delivered === false && cnt.n === 1, `dup=${h2.json.duplicated} lic=${cnt.n}`);
  }

  // #16 out
  {
    const o = (await makeOrder(c, 'p-lic-month', 1)).json.order;
    const g = (await getQr(c, o.id)).json.qr;
    const h = await hook({ id: 997008, transferType: 'out', accountNumber: '0010131639304', transferAmount: 180000, content: g.memo, referenceCode: 'TESTOUT' + Date.now() });
    rec('R16', 'transferType=out -> chặn', h.json.reason === 'NOT_INBOUND', JSON.stringify(h.json));
  }

  // #17 wrong account
  {
    const o = (await makeOrder(c, 'p-lic-month', 1)).json.order;
    const g = (await getQr(c, o.id)).json.qr;
    const h = await hook({ id: 997009, transferType: 'in', accountNumber: '8990124112002', transferAmount: 180000, content: g.memo, referenceCode: 'TESTWA' + Date.now() });
    rec('R17', 'STK cũ -> WRONG_ACCOUNT', h.json.reason === 'WRONG_ACCOUNT', JSON.stringify(h.json));
  }

  // #18 no MBK
  {
    const ref = 'TESTNM' + Date.now();
    const h = await hook({ id: 997010, transferType: 'in', accountNumber: '0010131639304', transferAmount: 50000, content: 'chuyen tien mua hang', referenceCode: ref });
    const p = await q1('SELECT state FROM payments WHERE txn_ref = ?', [ref]);
    rec('R18', 'Không có MBK -> unmatched + ghi sổ', h.json.reason === 'NO_ORDER_MATCH' && p?.state === 'unmatched', `pay=${p?.state}`);
  }
} finally {
  await setS('sepay_auto_enabled', ORIG.e);
  await setS('sepay_auto_from', ORIG.f);
  await setS('sepay_auto_to', ORIG.t);
  const now = await q(`SELECT key,value FROM settings WHERE key LIKE 'sepay_auto%' ORDER BY key`);
  console.log('\n  RESTORED:', now.map((x) => `${x.key}=${x.value}`).join(' '));
}

/* ============ D. Admin ============ */
const dash = await adm.req('/api/admin/dashboard');
const dbRev = await q1(`SELECT COALESCE(SUM(total),0) v FROM orders WHERE status IN ('paid','delivered')`);
rec('R19', 'Dashboard khớp DB', Number(dash.json.stats.revenue) === Number(dbRev.v), `api=${dash.json.stats.revenue} db=${dbRev.v}`);

const us = await adm.req('/api/admin/users');
const leakU = (us.json.users || []).filter((u) => String(u.email || '').includes('@invalid')).length;
const gotUname = (us.json.users || []).filter((u) => u.username).length;
rec('R23', 'Tab Người dùng: không cột số dư, có username, không lộ @invalid',
  gotUname > 0 && leakU === 0 && !(await import('node:fs')).readFileSync('public/assets/pages/admin.js', 'utf8').includes('Số dư'),
  `username=${gotUname}/${us.json.users.length} leakInvalid=${leakU}`);

const ao = await adm.req('/api/admin/orders');
const leakO = (ao.json.orders || []).filter((o) => String(o.email || '').includes('@invalid')).length;
rec('R22', 'Tab Đơn hàng: không lộ @invalid', leakO === 0, `leak=${leakO}/${ao.json.orders.length}`);

/* ============ F. Security ============ */
const anon = new Client();
const s401 = (await anon.req('/api/admin/dashboard')).status;
const s403 = (await c.req('/api/admin/dashboard')).status;
rec('R31', 'Admin không auth -> 401', s401 === 401, `${s401}`);
rec('R32', 'User thường -> 403', s403 === 403, `${s403}`);

const other = await newUser('OT');
rec('R33', 'Đọc đơn người khác -> 404', (await other.req(`/api/orders/${order.id}`)).status === 404, '');

const tamper = await c.req('/api/orders', { method: 'POST', body: { items: [{ productId: 'p-lic-month', quantity: 1, price: 1 }], total: 1 } });
rec('R34', 'Sửa giá -> server giữ giá gốc', tamper.json?.order?.total === 180000, `total=${tamper.json?.order?.total}`);

/* ============ G. SePay ============ */
const rq = await adm.req('/api/admin/sepay/quota');
rec('R37', 'quota đúng', rq.status === 200 && Number(rq.json.remaining) === Math.max(0, 50 - Number(rq.json.used)),
  `used=${rq.json.used} test=${rq.json.usedByTest} remaining=${rq.json.remaining}`);

const rc = await adm.req('/api/admin/sepay/reconcile?days=1');
rec('R36', 'reconcile không lỗi', rc.status === 200 && !rc.json.error, `checked=${rc.json.checked} missing=${rc.json.missing?.length} error=${rc.json.error || 'none'}`);

/* window restored check */
const wfinal = await q(`SELECT key,value FROM settings WHERE key LIKE 'sepay_auto%' ORDER BY key`);
rec('R-ENV', 'sepay_auto_enabled=1 khôi phục đúng', wfinal.find((x) => x.key === 'sepay_auto_enabled')?.value === '1',
  wfinal.map((x) => `${x.key}=${x.value}`).join(' '));

dump();
