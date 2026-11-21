import { q, q1, Client, BASE } from './q.mjs';
import { adminCredentials } from './qa-guard.mjs';

console.log('# ═══ KIỂM TRA CUỐI ═══\n');

/* #25 pending > 2h */
const nowMs = Date.now();
const stale = await q(`SELECT code, created_at, total, user_id FROM orders WHERE status='pending' AND created_at < ?`, [nowMs - 2 * 3600_000]);
console.log(`#25 Đơn pending > 2 giờ: ${stale.length}`);
for (const s of stale) console.log(`   ${s.code} ${Math.round((nowMs - s.created_at) / 60000)}m ${s.total}đ`);

const pend = await q(`SELECT o.code, o.total, o.created_at, u.username,
  ROUND((?-o.created_at)/60000.0) age FROM orders o LEFT JOIN users u ON u.id=o.user_id
  WHERE o.status='pending' ORDER BY o.created_at`, [nowMs]);
console.log(`\n   Tổng pending hiện tại: ${pend.length}`);
for (const p of pend) console.log(`   ${p.code} | ${p.username || '?'} | ${p.age}m | ${p.total}đ`);

/* #26 unmatched real */
const unReal = await q(`SELECT amount, content, txn_ref, at FROM payments WHERE state='unmatched' AND COALESCE(is_test,0)=0`);
console.log(`\n#26 Unmatched THẬT: ${unReal.length}`);
for (const u of unReal) console.log(`   ${new Date(u.at * 1000).toISOString()} ${Number(u.amount).toLocaleString()}đ ref=${u.txn_ref} "${u.content}"`);

/* #29 licenses */
console.log('\n#29 License gắn HWID KHÔNG có order, phân theo source:');
for (const r of await q(
  `SELECT COALESCE(l.source,'(null)') src, COUNT(*) n FROM licenses l
   WHERE l.hwid IS NOT NULL AND l.hwid<>''
     AND NOT EXISTS (SELECT 1 FROM license_issues i WHERE i.license_key=l.key)
   GROUP BY src ORDER BY n DESC`)) {
  const note = r.src === 'trial' ? '(dùng thử - hợp lệ, không có order)' : r.src === 'stock' ? '(key kho chưa bán / seed test)' : '(null)';
  console.log(`   ${String(r.src).padEnd(8)} ${String(r.n).padStart(3)}  ${note}`);
}
const prob = await q1(
  `SELECT COUNT(*) n FROM licenses l
   WHERE l.hwid IS NOT NULL AND l.hwid<>'' AND l.source IN ('sold')
     AND NOT EXISTS (SELECT 1 FROM license_issues i WHERE i.license_key=l.key)`);
console.log(`   → license ĐÃ BÁN (source='sold') mà không có order: ${prob.n}  ${prob.n === 0 ? '✅' : '❌'}`);

/* #30 */
console.log('\n#30 product_keys available:');
for (const r of await q(
  `SELECT p.name, p.stock_count, p.delivery_type,
    (SELECT COUNT(*) FROM product_keys k WHERE k.product_id=p.id AND k.status='available') real
   FROM products p WHERE p.active=1`)) {
  console.log(`   ${String(r.name).slice(0, 34).padEnd(34)} declared=${r.stock_count} real=${r.real} (${r.delivery_type})`);
}

/* settings */
console.log('\n#CONFIG:');
for (const s of await q(`SELECT key,value FROM settings WHERE key LIKE 'sepay_auto%' OR key LIKE 'bank%' ORDER BY key`)) {
  console.log(`   ${s.key} = ${s.value}`);
}

/* final counts */
console.log('\n#DỮ LIỆU:');
for (const t of ['users', 'orders', 'payments', 'licenses', 'license_issues', 'product_keys']) {
  console.log(`   ${t.padEnd(16)} ${(await q1(`SELECT COUNT(*) n FROM ${t}`)).n}`);
}
const dw = await q1(`SELECT COUNT(*) n FROM orders o
  WHERE EXISTS(SELECT 1 FROM payments p WHERE p.order_id=o.id AND p.confirmed_by='sepay-window')
    AND EXISTS(SELECT 1 FROM payments p3 WHERE p3.order_id=o.id AND p3.method='manual' AND p3.txn_ref IS NULL)`);
console.log(`   double-write còn lại: ${dw.n} ${dw.n === 0 ? '✅' : '❌'}`);

const qaU = await q1(`SELECT COUNT(*) n FROM users WHERE username LIKE 'qa%' OR full_name LIKE 'qa%'`);
console.log(`   user QA còn lại: ${qaU.n} ${qaU.n === 0 ? '✅' : '❌'}`);
const tPay = await q1(`SELECT COUNT(*) n FROM payments WHERE txn_ref LIKE 'TEST%'`);
console.log(`   payment TEST còn lại: ${tPay.n} ${tPay.n === 0 ? '✅' : '❌'}`);

/* admin API paranoia check */
const adm = new Client();
await adm.req('/api/auth/login', { method: 'POST', body: adminCredentials() });
const pm = await adm.req('/api/admin/payments');
console.log('\n#API stats sau fix:', JSON.stringify(pm.json.stats), '\n statsAll:', JSON.stringify(pm.json.statsAll));
