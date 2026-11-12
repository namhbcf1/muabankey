import { q } from './q.mjs';

console.log('=== 26 license_issues orphan — chi tiết ===');
const rows = await q(
  `SELECT i.id, i.order_id, i.user_id, i.license_key, i.product_id, i.created_at,
     (SELECT username FROM users u WHERE u.id=i.user_id) uname
   FROM license_issues i
   WHERE i.order_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.id=i.order_id)
   ORDER BY i.created_at DESC LIMIT 30`,
);
console.log('n =', rows.length);
for (const r of rows) {
  console.log(`  ${new Date(Number(r.created_at)).toISOString()} | key=${r.license_key} | user=${r.uname || r.user_id} | order=${r.order_id}`);
}

console.log('\n=== Theo ngày tạo ===');
for (const r of await q(
  `SELECT date(created_at/1000,'unixepoch') d, COUNT(*) n FROM license_issues i
   WHERE i.order_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.id=i.order_id)
   GROUP BY d ORDER BY d DESC`)) {
  console.log(`  ${r.d}  ${r.n}`);
}
