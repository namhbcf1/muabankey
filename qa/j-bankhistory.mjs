import { q } from './q.mjs';

console.log('=== settings bank_* updated_at ===');
for (const r of await q(`SELECT key, value, updated_at FROM settings WHERE key LIKE 'bank%' OR key LIKE 'sepay_auto%' ORDER BY key`)) {
  console.log(`  ${r.key.padEnd(20)} = ${String(r.value).padEnd(16)} updated=${r.updated_at ? new Date(Number(r.updated_at)).toISOString() : '?'}`);
}

console.log('\n=== payments dùng accountNumber cũ (từ raw) ===');
const rows = await q(`SELECT order_code, amount, state, txn_ref, at, raw FROM payments WHERE raw LIKE '%8990124112002%' ORDER BY at DESC LIMIT 20`);
console.log('  n =', rows.length);
const agg = {};
for (const r of rows) agg[r.state] = (agg[r.state] || 0) + 1;
console.log('  by state:', JSON.stringify(agg));
for (const r of rows.slice(0, 10)) {
  console.log(`   ${new Date(r.at * 1000).toISOString()} ${String(r.amount).padStart(9)} ${String(r.state).padEnd(13)} ${r.order_code || '-'} ref=${r.txn_ref}`);
}

console.log('\n=== payments dùng accountNumber MỚI 0010131639304 ===');
const newAcc = await q(`SELECT COUNT(*) AS n, COALESCE(SUM(amount),0) s FROM payments WHERE raw LIKE '%0010131639304%'`);
console.log(' ', JSON.stringify(newAcc[0]));

console.log('\n=== TẤT CẢ payments is_test=0 (tiền thật) ===');
for (const r of await q(`SELECT order_code, amount, state, method, txn_ref, at FROM payments WHERE COALESCE(is_test,0)=0 ORDER BY at DESC LIMIT 40`)) {
  console.log(`   ${new Date(r.at * 1000).toISOString()} ${String(r.amount).padStart(9)} ${String(r.state).padEnd(13)} ${String(r.method).padEnd(7)} ${r.order_code || '-'} ref=${r.txn_ref}`);
}
const tot = await q(`SELECT COUNT(*) n, COALESCE(SUM(amount),0) s FROM payments WHERE COALESCE(is_test,0)=0`);
console.log('\n  TOTAL real payments:', JSON.stringify(tot[0]));
