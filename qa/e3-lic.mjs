import { q, q1 } from './q.mjs';

console.log('=== licenses.source distribution ===');
for (const r of await q(`SELECT COALESCE(source,'(null)') AS s, COUNT(*) AS n FROM licenses GROUP BY source ORDER BY n DESC`)) {
  console.log(`  ${String(r.s).padEnd(14)} ${r.n}`);
}

console.log('\n=== licenses WITH hwid, split by source ===');
for (const r of await q(
  `SELECT COALESCE(l.source,'(null)') AS src,
          COUNT(*) AS n,
          SUM(CASE WHEN EXISTS(SELECT 1 FROM license_issues i WHERE i.license_key=l.key) THEN 1 ELSE 0 END) AS with_order
   FROM licenses l
   WHERE l.hwid IS NOT NULL AND l.hwid <> ''
   GROUP BY src ORDER BY n DESC`,
)) {
  console.log(`  ${String(r.src).padEnd(14)} n=${String(r.n).padStart(4)} withOrder=${r.with_order} noOrder=${r.n - r.with_order}`);
}

console.log('\n=== HWID licenses WITHOUT order, by source ===');
for (const r of await q(
  `SELECT COALESCE(l.source,'(null)') AS src, COUNT(*) AS n
   FROM licenses l
   WHERE l.hwid IS NOT NULL AND l.hwid <> ''
     AND NOT EXISTS (SELECT 1 FROM license_issues i WHERE i.license_key=l.key)
   GROUP BY src ORDER BY n DESC`,
)) {
  console.log(`  ${String(r.src).padEnd(14)} ${r.n}`);
}

console.log('\n=== sample PAID-source licenses w/o order (real problem) ===');
const bad = await q(
  `SELECT l.key, l.hwid, l.source, l.pid, l.plan, l.created_at, l.revoked
   FROM licenses l
   WHERE l.hwid IS NOT NULL AND l.hwid <> ''
     AND COALESCE(l.source,'') NOT IN ('trial','')
     AND NOT EXISTS (SELECT 1 FROM license_issues i WHERE i.license_key=l.key)
   ORDER BY l.created_at DESC LIMIT 30`,
);
console.log('  count in this query:', bad.length);
for (const r of bad) console.log(`   ${r.key} | hwid=${r.hwid} | src=${r.source} | pid=${r.pid} | plan=${r.plan} | revoked=${r.revoked}`);

const badCnt = await q1(
  `SELECT COUNT(*) AS n FROM licenses l
   WHERE l.hwid IS NOT NULL AND l.hwid <> ''
     AND COALESCE(l.source,'') NOT IN ('trial','')
     AND NOT EXISTS (SELECT 1 FROM license_issues i WHERE i.license_key=l.key)`,
);
console.log('\n  TOTAL paid-source HWID licenses without order:', badCnt?.n);
