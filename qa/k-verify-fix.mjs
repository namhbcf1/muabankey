import { Client, q, q1, BASE } from './q.mjs';
import { adminCredentials } from './qa-guard.mjs';
import { rec, newUser, hook, dump } from './lib.mjs';

const adm = new Client();
await adm.req('/api/auth/login', { method: 'POST', body: adminCredentials() });

async function scenario(label, transferAmount) {
  const u = await newUser('FV');
  const o = (await u.req('/api/orders', { method: 'POST', body: { items: [{ productId: 'p-lic-month', quantity: 1 }] } })).json.order;
  const gq = (await u.req(`/api/orders/${o.id}/qr`, { method: 'POST' })).json.qr;
  const ref = 'TESTFIX' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(-3);
  const h = await hook({ id: 995000 + Math.floor(Math.random() * 999), transferType: 'in', accountNumber: '0010131639304', transferAmount, content: gq.memo, referenceCode: ref });
  const before = await q(`SELECT state, amount, confirmed_by FROM payments WHERE order_id = ?`, [o.id]);
  const cp = await adm.req(`/api/admin/orders/${o.id}/confirm-payment`, { method: 'POST', body: {} });
  const after = await q(`SELECT state, amount, confirmed_by FROM payments WHERE order_id = ?`, [o.id]);
  const sum = after.filter((r) => ['matched', 'wrong_amount'].includes(r.state)).reduce((s, r) => s + Number(r.amount || 0), 0);
  console.log(`\n[${label}] transfer=${transferAmount} order=${o.code} total=${o.total}`);
  console.log(`  webhook: ${JSON.stringify(h.json)}`);
  console.log(`  before : ${JSON.stringify(before)}`);
  console.log(`  confirm: delivered=${cp.json?.delivered} excess=${cp.json?.excess}`);
  console.log(`  after  : ${JSON.stringify(after)}`);
  console.log(`  SUM(sổ)=${sum} vs tiền thật chuyển=${transferAmount} -> ${sum === Number(transferAmount) ? 'KHỚP' : 'LỆCH ' + (sum - Number(transferAmount))}`);
  return { o, sum, transferAmount, excess: cp.json?.excess, delivered: cp.json?.delivered, rows: after };
}

/* Case 1: chuyển đúng 180k, admin duyệt -> sổ phải = 180k, excess = 0 */
const c1 = await scenario('đúng 180k', 180000);
rec('F1', 'Admin duyệt đơn đã ghi sổ: sổ = 180k, excess = 0',
  c1.sum === 180000 && Number(c1.excess || 0) === 0 && c1.delivered === true,
  `sum=${c1.sum} excess=${c1.excess} delivered=${c1.delivered} rows=${c1.rows.length}`);

/* Case 2: chuyển thiếu 90k, admin duyệt (đồng ý giao dù thiếu) -> sổ = 90k, giao */
const c2 = await scenario('thiếu 90k', 90000);
rec('F2', 'Chuyển thiếu 90k + admin duyệt: sổ = 90k (đúng tiền thật), vẫn giao',
  c2.sum === 90000 && c2.delivered === true,
  `sum=${c2.sum} delivered=${c2.delivered} excess=${c2.excess}`);

/* Case 3: webhook trượt hoàn toàn -> admin duyệt -> PHẢI ghi sổ 180k */
{
  const u = await newUser('FW');
  const o = (await u.req('/api/orders', { method: 'POST', body: { items: [{ productId: 'p-lic-month', quantity: 1 }] } })).json.order;
  await u.req(`/api/orders/${o.id}/qr`, { method: 'POST' });
  const cp = await adm.req(`/api/admin/orders/${o.id}/confirm-payment`, { method: 'POST', body: {} });
  const rows = await q(`SELECT state, amount, confirmed_by FROM payments WHERE order_id = ?`, [o.id]);
  const sum = rows.reduce((s, r) => s + Number(r.amount || 0), 0);
  console.log(`\n[webhook trượt] ${o.code} rows=${JSON.stringify(rows)} sum=${sum} delivered=${cp.json?.delivered}`);
  rec('F3', 'Webhook trượt hẳn + admin duyệt: VẪN ghi sổ 180k (đường cứu còn nguyên)',
    sum === 180000 && rows.length === 1 && cp.json?.delivered === true,
    `rows=${rows.length} sum=${sum} delivered=${cp.json?.delivered}`);
}

/* Case 4: admin nhập số tiền tường minh -> phải ghi sổ khoản mới */
{
  const u = await newUser('FE');
  const o = (await u.req('/api/orders', { method: 'POST', body: { items: [{ productId: 'p-lic-month', quantity: 1 }] } })).json.order;
  const gq = (await u.req(`/api/orders/${o.id}/qr`, { method: 'POST' })).json.qr;
  await hook({ id: 996001, transferType: 'in', accountNumber: '0010131639304', transferAmount: 90000, content: gq.memo, referenceCode: 'TESTEXPL' + Date.now().toString(36).toUpperCase() });
  const cp = await adm.req(`/api/admin/orders/${o.id}/confirm-payment`, { method: 'POST', body: { amount: 90000 } });
  const rows = await q(`SELECT state, amount, confirmed_by FROM payments WHERE order_id = ?`, [o.id]);
  const sum = rows.reduce((s, r) => s + Number(r.amount || 0), 0);
  console.log(`\n[admin nhập 90k bù] ${o.code} rows=${JSON.stringify(rows)} sum=${sum}`);
  rec('F4', 'Admin nhập tay số tiền -> ghi sổ khoản mới (không bị ratify chặn)',
    sum === 180000 && rows.length === 2,
    `rows=${rows.length} sum=${sum}`);
}

dump();
