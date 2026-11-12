import { q, q1 } from './q.mjs';

/* 26 license_issues trỏ tới order đã bị xoá — license đó còn sống không? */
const rows = await q(
  `SELECT i.license_key, i.user_id,
     (SELECT COUNT(*) FROM users u WHERE u.id=i.user_id) userExists,
     (SELECT revoked FROM licenses l WHERE l.key=i.license_key) revoked,
     (SELECT expires_at FROM licenses l WHERE l.key=i.license_key) expires,
     (SELECT hwid FROM licenses l WHERE l.key=i.license_key) hwid
   FROM license_issues i
   WHERE i.order_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.id=i.order_id)`,
);
console.log('Tổng:', rows.length);
let live = 0, liveWithUser = 0;
for (const r of rows) {
  const isLive = r.revoked === 0;
  if (isLive) live++;
  if (isLive && r.userExists) liveWithUser++;
  console.log(`  ${r.license_key} | userExists=${r.userExists} | revoked=${r.revoked} | hwid=${r.hwid || 'none'} | exp=${r.expires}`);
}
console.log(`\n  → license CÒN SỐNG (revoked=0): ${live}/${rows.length}`);
console.log(`  → trong đó còn user thật: ${liveWithUser}`);

/* users có còn tồn tại không */
const ux = await q1(`SELECT COUNT(DISTINCT i.user_id) n FROM license_issues i
  WHERE i.order_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.id=i.order_id)
    AND EXISTS (SELECT 1 FROM users u WHERE u.id=i.user_id)`);
console.log(`  → số user liên quan còn tồn tại: ${ux.n}`);
