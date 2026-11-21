import { Client, q, q1, BASE } from './q.mjs';
import { adminCredentials } from './qa-guard.mjs';
import { rec, dump } from './lib.mjs';

const adm = new Client();
await adm.req('/api/auth/login', { method: 'POST', body: adminCredentials() });

/* ---------- 29 redo: license gắn HWID nhưng không có order ----------
   licenses KHÔNG có cột order_id -> quan hệ qua bảng license_issues */
const cols = await q(`PRAGMA table_info(license_issues)`);
console.log('   license_issues cols:', cols.map((c) => c.name).join(','));

let hwidTotal = await q1(`SELECT COUNT(*) AS n FROM licenses WHERE hwid IS NOT NULL AND hwid <> ''`);
let hwidNoOrder = [];
try {
  hwidNoOrder = await q(
    `SELECT l.key, l.hwid FROM licenses l
     WHERE l.hwid IS NOT NULL AND l.hwid <> ''
       AND NOT EXISTS (SELECT 1 FROM license_issues i WHERE i.license_key = l.key)
     LIMIT 25`,
  );
  const cnt = await q1(
    `SELECT COUNT(*) AS n FROM licenses l
     WHERE l.hwid IS NOT NULL AND l.hwid <> ''
       AND NOT EXISTS (SELECT 1 FROM license_issues i WHERE i.license_key = l.key)`,
  );
  rec(29, 'License gắn HWID mà không có order', (cnt?.n || 0) === 0,
    `hwidTotal=${hwidTotal?.n} noOrder=${cnt?.n} ${hwidNoOrder.map((r) => r.key).join(' ')}`);
} catch (e) {
  rec(29, 'License gắn HWID mà không có order', false, `ERR ${e.message}`);
}

/* extra: license_issues trỏ tới license không tồn tại (orphan) */
const orphanIssues = await q1(
  `SELECT COUNT(*) AS n FROM license_issues i WHERE NOT EXISTS (SELECT 1 FROM licenses l WHERE l.key = i.license_key)`,
);
console.log('   license_issues orphan (trỏ license không tồn tại):', orphanIssues?.n);

/* license_issues trỏ tới order không tồn tại */
const orphanOrder = await q1(
  `SELECT COUNT(*) AS n FROM license_issues i WHERE i.order_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.id = i.order_id)`,
);
console.log('   license_issues orphan order:', orphanOrder?.n);

/* ---------- 26 detail: the REAL unmatched payment ---------- */
const realUn = await q(
  `SELECT id, amount, expected, content, txn_ref, at, method, COALESCE(is_test,0) t
   FROM payments WHERE state='unmatched' AND COALESCE(is_test,0)=0 ORDER BY at DESC`,
);
console.log('\n   REAL unmatched rows:');
for (const r of realUn) {
  console.log(`     ${new Date(r.at * 1000).toISOString()} | ${r.amount}đ | ref=${r.txn_ref} | content="${r.content}"`);
}
/* can it be matched to any order? */
for (const r of realUn) {
  const memo = String(r.content || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const i = memo.indexOf('MBK');
  const guess = i >= 0 ? memo.slice(i, i + 15) : null;
  const ord = guess ? await q1('SELECT code, status, total FROM orders WHERE payment_ref = ? LIMIT 1', [guess]) : null;
  const amtMatch = await q(`SELECT code, status, total FROM orders WHERE total = ? ORDER BY created_at DESC LIMIT 5`, [r.amount]);
  console.log(`     -> memoGuess=${guess} matchedOrder=${JSON.stringify(ord)} ordersWithSameAmount=${JSON.stringify(amtMatch)}`);
}

/* how old is it */
if (realUn[0]) {
  const days = Math.round((Date.now() / 1000 - realUn[0].at) / 86400);
  console.log(`     AGE: ${days} days`);
}

dump();
