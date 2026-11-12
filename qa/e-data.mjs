import { Client, q, q1, BASE } from './q.mjs';
import { rec, dump } from './lib.mjs';

const adm = new Client();
await adm.req('/api/auth/login', { method: 'POST', body: { username: 'namhbcf', password: 'namhbcf123' } });

const nowMs = Date.now();
const nowS = Math.floor(nowMs / 1000);

/* ---------- 25. Đơn pending quá 2 giờ ---------- */
const stale2h = await q(
  `SELECT code, status, created_at, (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id=o.id) AS items
   FROM orders o WHERE status='pending' AND created_at < ? ORDER BY created_at ASC`,
  [nowMs - 2 * 3600_000],
);
rec(25, 'Đơn pending quá 2 giờ = 0', stale2h.length === 0,
  `n=${stale2h.length} ${stale2h.map((r) => `${r.code}(${Math.round((nowMs - r.created_at) / 60000)}m)`).join(' ')}`);

/* also list ALL pending for context */
const allPend = await q(`SELECT code, created_at, total FROM orders WHERE status='pending' ORDER BY created_at ASC`);
console.log('   all pending:', allPend.map((r) => `${r.code}/${Math.round((nowMs - r.created_at) / 60000)}m/${r.total}đ`).join(' '));

/* ---------- 26. Payments unmatched ---------- */
const un = await q(
  `SELECT id, amount, content, txn_ref, at, COALESCE(is_test,0) AS t
   FROM payments WHERE state='unmatched' ORDER BY at DESC`,
);
const unReal = un.filter((r) => !r.t);
rec(26, 'Payments unmatched (tiền chưa gán)', unReal.length === 0,
  `total=${un.length} real=${unReal.length} (test=${un.length - unReal.length}). Real: ${unReal.map((r) => `${r.amount}đ "${String(r.content).slice(0, 22)}" ref=${r.txn_ref}`).join(' | ') || 'none'}`);

/* ---------- 27. is_test=1 có bị tính hạn mức? ---------- */
const quota = await adm.req('/api/admin/sepay/quota');
const qj = quota.json;
const monthStart = Math.floor(new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime() / 1000);
const realCount = await q1(`SELECT COUNT(*) AS n FROM payments WHERE method='sepay' AND at >= ? AND COALESCE(is_test,0)=0`, [monthStart]);
const testCount = await q1(`SELECT COUNT(*) AS n FROM payments WHERE method='sepay' AND at >= ? AND COALESCE(is_test,0)=1`, [monthStart]);
rec(27, 'is_test=1 KHÔNG bị tính hạn mức',
  quota.status === 200 && Number(qj?.used) === Number(realCount?.n) && Number(qj?.usedByTest) === Number(testCount?.n),
  `api used=${qj?.used} usedByTest=${qj?.usedByTest} limit=${qj?.limit} remaining=${qj?.remaining} percent=${qj?.percent}% | db real=${realCount?.n} test=${testCount?.n}`);

/* ---------- 28. User test rác (@local, @test.vn) — KHÔNG tính @invalid ---------- */
const junkLocal = await q1(`SELECT COUNT(*) AS n FROM users WHERE email LIKE '%@local'`);
const junkTest = await q1(`SELECT COUNT(*) AS n FROM users WHERE email LIKE '%@test.vn'`);
const invalid = await q1(`SELECT COUNT(*) AS n FROM users WHERE email LIKE '%@invalid'`);
const sample = await q(`SELECT username, email FROM users WHERE email LIKE '%@local' OR email LIKE '%@test.vn' LIMIT 8`);
rec(28, 'User test rác @local/@test.vn', (junkLocal?.n || 0) + (junkTest?.n || 0) === 0,
  `@local=${junkLocal?.n} @test.vn=${junkTest?.n} | @invalid(hop le)=${invalid?.n} | sample=${sample.map((s) => s.username || s.email).join(',')}`);

/* ---------- 29. License gắn HWID mà không có order ---------- */
let hwidNoOrder = [];
try {
  hwidNoOrder = await q(
    `SELECT key, hwid, order_id FROM licenses
     WHERE hwid IS NOT NULL AND hwid <> '' AND (order_id IS NULL OR order_id = '') LIMIT 20`,
  );
  const cnt = await q1(
    `SELECT COUNT(*) AS n FROM licenses WHERE hwid IS NOT NULL AND hwid <> '' AND (order_id IS NULL OR order_id = '')`,
  );
  rec(29, 'License gắn HWID mà không có order', (cnt?.n || 0) === 0,
    `n=${cnt?.n} ${hwidNoOrder.map((r) => `${r.key}/${r.hwid}`).join(' ')}`);
} catch (e) {
  // maybe column missing
  const cols = await q(`PRAGMA table_info(licenses)`);
  rec(29, 'License gắn HWID mà không có order', false, `ERR ${e.message} cols=${cols.map((c) => c.name).join(',')}`);
}

/* ---------- 30. Product_keys available ---------- */
const avail = await q(
  `SELECT p.id, p.name, p.stock_count, p.delivery_type,
     (SELECT COUNT(*) FROM product_keys k WHERE k.product_id = p.id AND k.status='available') AS real_avail
   FROM products p WHERE p.active = 1 ORDER BY p.price`,
);
console.log('   stock:', avail.map((r) => `${r.name.slice(0, 28)}=${r.real_avail}(declared ${r.stock_count}, ${r.delivery_type})`).join(' | '));
const keyProds = avail.filter((r) => r.delivery_type === 'key');
const mismatch = keyProds.filter((r) => r.real_avail !== r.stock_count);
rec(30, 'Product_keys available (và stock_count khớp thực tế)',
  mismatch.length === 0,
  `mismatches=${mismatch.map((m) => `${m.id}: declared=${m.stock_count} real=${m.real_avail}`).join(',') || 'none'}`);

/* ---------- 36. reconcile ---------- */
const rec1 = await adm.req('/api/admin/sepay/reconcile?days=1');
console.log('   reconcile raw:', JSON.stringify(rec1.json)?.slice(0, 400));
rec(36, '/api/admin/sepay/reconcile?days=1 không lỗi',
  rec1.status === 200 && !rec1.json?.error,
  `HTTP=${rec1.status} error=${rec1.json?.error || 'none'} checked=${rec1.json?.checked} missing=${rec1.json?.missing?.length}`);

/* ---------- 37. quota (already) ---------- */
rec(37, '/api/admin/sepay/quota số liệu đúng', quota.status === 200 && Number(qj?.remaining) === Math.max(0, 50 - Number(qj?.used)),
  `used=${qj?.used} remaining=${qj?.remaining} percent=${qj?.percent}% daysLeft=${qj?.daysLeft} overLimit=${qj?.overLimit} window=${JSON.stringify(qj?.window)}`);

dump();
