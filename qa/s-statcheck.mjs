import { q, q1 } from './q.mjs';

const all = await q1(`SELECT COUNT(*) n, COALESCE(SUM(amount),0) s FROM payments WHERE state='matched'`);
const real = await q1(`SELECT COUNT(*) n, COALESCE(SUM(amount),0) s FROM payments WHERE state='matched' AND COALESCE(is_test,0)=0`);
const test = await q1(`SELECT COUNT(*) n, COALESCE(SUM(amount),0) s FROM payments WHERE state='matched' AND COALESCE(is_test,0)=1`);
console.log('matched TẤT CẢ :', all.n, Number(all.s).toLocaleString(), 'đ');
console.log('matched THẬT    :', real.n, Number(real.s).toLocaleString(), 'đ');
console.log('matched TEST    :', test.n, Number(test.s).toLocaleString(), 'đ');

console.log('\n--- Các state khác ---');
for (const st of ['unmatched', 'wrong_amount', 'claimed']) {
  const a = await q1(`SELECT COUNT(*) n, COALESCE(SUM(amount),0) s FROM payments WHERE state=?`, [st]);
  const r = await q1(`SELECT COUNT(*) n, COALESCE(SUM(amount),0) s FROM payments WHERE state=? AND COALESCE(is_test,0)=0`, [st]);
  console.log(`  ${st.padEnd(13)} all n=${String(a.n).padStart(3)} ${String(Number(a.s).toLocaleString()).padStart(12)}đ | thật n=${String(r.n).padStart(3)} ${String(Number(r.s).toLocaleString()).padStart(12)}đ`);
}

const ordRev = await q1(`SELECT COALESCE(SUM(total),0) v FROM orders WHERE status IN ('paid','delivered')`);
console.log('\nDoanh thu đơn (paid+delivered):', Number(ordRev.v).toLocaleString(), 'đ');
console.log('=> UI "Tổng đã khớp" đang hiện:', Number(all.s).toLocaleString(), 'đ (gồm test)');
console.log('=> Lệch so với tiền thật:', Number(all.s - real.s).toLocaleString(), 'đ');
