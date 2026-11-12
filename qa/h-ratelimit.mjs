import { Client, q, q1, BASE } from './q.mjs';
import { rec, newUser, hook, dump } from './lib.mjs';

/* ---------- 35. Rate limit đơn hàng ---------- */
const c = await newUser('RL');
const results = [];
let firstBlock = null;
for (let i = 1; i <= 26; i++) {
  const r = await c.req('/api/orders', { method: 'POST', body: { items: [{ productId: 'p-lic-month', quantity: 1 }] } });
  results.push(r.status);
  if (r.status === 429 && firstBlock === null) firstBlock = i;
}
const counts = {};
for (const s of results) counts[s] = (counts[s] || 0) + 1;
console.log('   statuses:', JSON.stringify(counts), 'first429 at request', firstBlock);
rec(35, 'Rate limit đơn hàng -> 429 sau N lần',
  firstBlock !== null && firstBlock === 21,
  `limit=20/600s | first429=request#${firstBlock} | counts=${JSON.stringify(counts)}`);

/* ---------- Memo robustness: nội dung ngân hàng thật ---------- */
console.log('\n=== MEMO MATCHING (nội dung CK thực tế) ===');
const u = await newUser('MM');
const mkPaid = async (contentBuilder) => {
  const o = (await u.req('/api/orders', { method: 'POST', body: { items: [{ productId: 'p-lic-month', quantity: 1 }] } })).json.order;
  const gq = (await u.req(`/api/orders/${o.id}/qr`, { method: 'POST' })).json.qr;
  const content = contentBuilder(o.code, gq.memo);
  const h = await hook({ id: 994000 + Math.floor(Math.random() * 999), transferType: 'in', accountNumber: '0010131639304', transferAmount: 180000, content, referenceCode: 'TESTMEMO' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(-3) });
  return { code: o.code, memo: gq.memo, content, resp: h.json };
};

const cases = [
  ['exact memo', (code, memo) => memo],
  ['có dấu cách: MBK XXX XXX', (code, memo) => 'MBK ' + memo.slice(3)],
  ['có gạch: MBK-XXXXXX', (code) => code],
  ['prefix chữ thường + hậu tố', (code, memo) => 'mbk' + memo.slice(3).toLowerCase() + ' chuyen tien'],
  ['có chữ trước', (code, memo) => 'CK ' + memo + ' mua key'],
  ['có chữ sau', (code, memo) => memo + ' thanh toan don hang'],
  ['full-width/space trong mã', (code, memo) => memo.slice(0, 3) + ' ' + memo.slice(3, 6) + ' ' + memo.slice(6)],
];
for (const [label, fn] of cases) {
  const r = await mkPaid(fn);
  const matched = r.resp?.reason === 'AWAITING_ADMIN_APPROVAL' || r.resp?.delivered === true;
  console.log(`   ${matched ? 'OK  ' : 'MISS'} | ${label.padEnd(28)} | content="${r.content}" -> ${r.resp?.reason || (r.resp?.delivered ? 'DELIVERED' : '?')}`);
}
dump();
