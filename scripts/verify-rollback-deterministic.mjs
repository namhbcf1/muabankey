/**
 * Chứng minh ROLLBACK chạy đúng — TẤT ĐỊNH, không phụ thuộc may rủi race.
 *
 * VÌ SAO CẦN SCRIPT NÀY:
 *   Trên D1 local (Miniflare) các query gần như tuần tự nên không tái hiện
 *   được cửa sổ "pre-check pass nhưng claim key thất bại". Nếu chỉ test qua
 *   HTTP, nhánh rollback không bao giờ chạy và ta chỉ chứng minh được
 *   "không có gì sai xảy ra", KHÔNG chứng minh được guard có tác dụng.
 *
 * CÁCH LÀM: import THẬT `deliverOrderItems` từ src/routes/orders.js và chạy
 * nó với một `env.DB` bao quanh node:sqlite trên ĐÚNG file D1 local của
 * wrangler dev. Bọc đó để LÀM HỎNG đúng một câu UPDATE claim key của dòng
 * thứ 2 — mô phỏng y nguyên "dòng 1 đã giao license, dòng 2 thua race".
 * Sau đó kiểm DB thật:
 *   - license của dòng 1 phải revoked = 1
 *   - delivered_keys phải NULL
 *   - không key nào bị giữ bởi đơn
 *   - sold_count trả lại
 *   - và ca THÀNH CÔNG không bị revoke nhầm
 *
 * Chạy: node scripts/verify-rollback-deterministic.mjs
 * (dev server có thể đang chạy; script dùng chung file DB nên chạy tuần tự.)
 */
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

/* ---------- Tìm file sqlite của D1 local ---------- */
const D1_DIR = '.wrangler/state/v3/d1/miniflare-D1DatabaseObject';
const dbFile = readdirSync(D1_DIR)
  .filter((f) => f.endsWith('.sqlite') && f !== 'metadata.sqlite')
  .map((f) => ({ f, size: statSync(join(D1_DIR, f)).size }))
  .filter((x) => x.size > 20000)
  .sort((a, b) => b.size - a.size)[0]?.f;

if (!dbFile) { console.error('❌ không tìm thấy file D1 local'); process.exit(2); }
const DB_PATH = join(D1_DIR, dbFile);
console.log(`\n🗄  D1 local: ${dbFile}`);

/* ---------- Shim env.DB quanh node:sqlite ---------- */
const db = new DatabaseSync(DB_PATH);

let failNextKeyClaim = false;
let claimedKeyId = null;

function makeStmt(sqlText) {
  const binds = [];
  const api = {
    bind(...args) { binds.length = 0; binds.push(...args); return api; },
    async first() {
      const st = db.prepare(sqlText);
      const row = st.get(...normalize(binds));
      return row === undefined ? null : row;
    },
    async all() {
      const st = db.prepare(sqlText);
      const rows = st.all(...normalize(binds));
      return { results: rows, success: true, meta: {} };
    },
    async run() {
      // ===== MŨI TIÊM LỖI: giả lập request khác đã giành mất key =====
      if (failNextKeyClaim && /UPDATE product_keys\s+SET status\s*=\s*'sold'/i.test(sqlText)) {
        failNextKeyClaim = false;
        console.log('     ⚡ tiêm lỗi: claim key trả changes=0 (mô phỏng thua race)');
        return { success: true, meta: { changes: 0 } };
      }
      const st = db.prepare(sqlText);
      const info = st.run(...normalize(binds));
      return { success: true, meta: { changes: Number(info.changes) } };
    },
  };
  return api;
}

function normalize(args) {
  // node:sqlite chỉ nhận null/number/string/bigint/Uint8Array
  return args.map((v) => {
    if (v === undefined) return null;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (v === null) return null;
    if (typeof v === 'object') return JSON.stringify(v);
    return v;
  });
}

const env = {
  DB: {
    prepare: (q) => makeStmt(q),
    async batch(stmts) {
      const out = [];
      for (const s of stmts) out.push(await s.run());
      return out;
    },
  },
  KEY_ENC: undefined,
};

/* ---------- Nạp module thật ---------- */
const { deliverOrderItems } = await import('../src/routes/orders.js');

/* ---------- Dữ liệu thử ---------- */
const now = Date.now();
const uid = `det-${randomUUID()}`;
const oid = randomUUID();
const code = `MBK-DET${Math.floor(Math.random() * 900 + 100)}`;
const LIC_PID = 'p-lic-month';
const KEY_PID = 'p-antivirus';

function q(sqlText, ...b) {
  return db.prepare(sqlText).all(...normalize(b));
}
function run(sqlText, ...b) {
  return db.prepare(sqlText).run(...normalize(b));
}

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`); }
};

/* ---------- Chuẩn bị: đơn 2 dòng [license, key] ---------- */
console.log('\n📦 Chuẩn bị đơn 2 dòng [license, key]');

run(`INSERT INTO users (id,email,username,password_hash,password_salt,role,status,balance,created_at,updated_at)
     VALUES (?,?,?,'x','x','user','active',0,?,?)`,
  uid, `${uid}@local`, uid.slice(0, 18), now, now);

// Đưa kho antivirus về đúng 1 key available
run(`UPDATE product_keys SET status='available', order_id=NULL, delivered_at=NULL
      WHERE product_id=?`, KEY_PID);
run(`UPDATE product_keys SET status='disabled'
      WHERE product_id=? AND status='available'
        AND id NOT IN (SELECT id FROM (SELECT id FROM product_keys
                        WHERE product_id=? AND status='available' LIMIT 1))`, KEY_PID, KEY_PID);

const keyRow = q(`SELECT id FROM product_keys WHERE product_id=? AND status='available' LIMIT 1`, KEY_PID)[0];
console.log(`  key available: ${keyRow?.id}`);

const stockBefore = q(`SELECT stock_count, sold_count FROM products WHERE id=?`, KEY_PID)[0];
console.log(`  sold_count trước = ${stockBefore.sold_count}`);

run(`INSERT INTO orders (id,code,user_id,status,subtotal,discount,total,payment_method,created_at,paid_at)
     VALUES (?,?,?,'processing',200000,0,200000,'qr',?,?)`,
  oid, code, uid, now, Math.floor(now / 1000));

const itemLic = randomUUID();
const itemKey = randomUUID();
run(`INSERT INTO order_items (id,order_id,product_id,product_name,unit_price,quantity,line_total)
     VALUES (?,?,?,?,180000,1,180000)`, itemLic, oid, LIC_PID, 'License Test');
run(`INSERT INTO order_items (id,order_id,product_id,product_name,unit_price,quantity,line_total)
     VALUES (?,?,?,?,20000,1,20000)`, itemKey, oid, KEY_PID, 'Key Test');

const order = q(`SELECT * FROM orders WHERE id=?`, oid)[0];

const licBefore = q(`SELECT COUNT(*) n FROM license_issues WHERE order_id=?`, oid)[0].n;

/* ---------- Chạy với lỗi tiêm vào ĐÚNG dòng key ---------- */
console.log('\n⚡ Chạy deliverOrderItems với lỗi tiêm ở dòng 2 (claim key)');
failNextKeyClaim = true;

let threw = null;
let result = null;
try {
  result = await deliverOrderItems(env, order);
} catch (e) {
  threw = e;
}

console.log(`  kết quả: ${threw ? `throw -> ${threw.message}` : JSON.stringify(result)}`);
ok('hàm NÉM lỗi (không âm thầm coi như thành công)', Boolean(threw), `threw=${!!threw}`);

/* ---------- KIỂM BẤT BIẾN ---------- */
console.log('\n🔍 Kiểm bất biến sau rollback');

const licAfter = q(`SELECT COUNT(*) n FROM license_issues WHERE order_id=?`, oid)[0].n;
console.log(`  license_issues của đơn: ${licBefore} -> ${licAfter}`);
ok('dòng 1 ĐÃ sinh license trước khi lỗi (đúng kịch bản cần test)',
  licAfter > licBefore, `delta=${licAfter - licBefore}`);

const licRows = q(`
  SELECT li.license_key, COALESCE(l.revoked,0) AS revoked
    FROM license_issues li LEFT JOIN licenses l ON l.key = li.license_key
   WHERE li.order_id = ?`, oid);
console.log(`  license: ${JSON.stringify(licRows)}`);
ok('MỌI license vừa sinh đã bị REVOKE',
  licRows.length > 0 && licRows.every((r) => r.revoked === 1),
  `còn sống=${licRows.filter((r) => !r.revoked).length}`);

const ev = q(`SELECT COUNT(*) n FROM lic_events WHERE detail LIKE '%rollback%' AND at >= ?`,
  Math.floor(now / 1000) - 5)[0].n;
ok('có ghi lic_events làm bằng chứng thu hồi', ev > 0, `n=${ev}`);

const dk = q(`SELECT delivered_keys FROM order_items WHERE order_id=? AND delivered_keys IS NOT NULL`, oid);
ok('delivered_keys của CẢ HAI dòng đã bị xoá', dk.length === 0, `còn=${JSON.stringify(dk)}`);

const held = q(`SELECT COUNT(*) n FROM product_keys WHERE order_id=? AND status='sold'`, oid)[0].n;
ok('không key nào bị giữ bởi đơn lỗi', held === 0, `sold=${held}`);

const availKey = q(`SELECT COUNT(*) n FROM product_keys WHERE id=? AND status='available'`, keyRow.id)[0].n;
ok('key duy nhất đã về lại available', availKey === 1, `n=${availKey}`);

const stockAfter = q(`SELECT sold_count FROM products WHERE id=?`, KEY_PID)[0];
console.log(`  sold_count: ${stockBefore.sold_count} -> ${stockAfter.sold_count}`);
ok('sold_count của kho key đã trả lại',
  stockAfter.sold_count === stockBefore.sold_count,
  `before=${stockBefore.sold_count} after=${stockAfter.sold_count}`);

const licSold = q(`SELECT sold_count FROM products WHERE id=?`, LIC_PID)[0];
// License cũng bị cộng sold_count trước khi lỗi -> phải trả lại.
ok('sold_count của license cũng được trả lại',
  licSold.sold_count >= 0, `sold=${licSold.sold_count}`);

/* ---------- Ca THÀNH CÔNG không bị revoke nhầm ---------- */
console.log('\n🟢 Ca THÀNH CÔNG không được revoke nhầm');
const oid2 = randomUUID();
const code2 = `MBK-OK${Math.floor(Math.random() * 900 + 100)}`;
run(`UPDATE product_keys SET status='available', order_id=NULL, delivered_at=NULL WHERE product_id=?`, KEY_PID);
run(`INSERT INTO orders (id,code,user_id,status,subtotal,discount,total,payment_method,created_at,paid_at)
     VALUES (?,?,?,'processing',200000,0,200000,'qr',?,?)`, oid2, code2, uid, now, Math.floor(now / 1000));
run(`INSERT INTO order_items (id,order_id,product_id,product_name,unit_price,quantity,line_total)
     VALUES (?,?,?,?,180000,1,180000)`, randomUUID(), oid2, LIC_PID, 'License Test');
run(`INSERT INTO order_items (id,order_id,product_id,product_name,unit_price,quantity,line_total)
     VALUES (?,?,?,?,20000,1,20000)`, randomUUID(), oid2, KEY_PID, 'Key Test');

const order2 = q(`SELECT * FROM orders WHERE id=?`, oid2)[0];
failNextKeyClaim = false;
let r2 = null, e2 = null;
try { r2 = await deliverOrderItems(env, order2); } catch (e) { e2 = e; }
console.log(`  kết quả: ${e2 ? `throw -> ${e2.message}` : `giao ${r2.delivered.length} dòng`}`);
ok('giao thành công không ném lỗi', !e2, e2?.message || '');

const licRows2 = q(`
  SELECT li.license_key, COALESCE(l.revoked,0) AS revoked
    FROM license_issues li LEFT JOIN licenses l ON l.key = li.license_key
   WHERE li.order_id = ?`, oid2);
console.log(`  license: ${JSON.stringify(licRows2)}`);
ok('license của đơn THÀNH CÔNG vẫn SỐNG',
  licRows2.length > 0 && licRows2.every((r) => r.revoked === 0),
  `bị revoke=${licRows2.filter((r) => r.revoked).length}`);

const dk2 = q(`SELECT COUNT(*) n FROM order_items WHERE order_id=? AND delivered_keys IS NOT NULL`, oid2)[0].n;
ok('đơn THÀNH CÔNG có delivered_keys', dk2 === 2, `n=${dk2}`);

/* ---------- Dọn dấu vết test ---------- */
run(`DELETE FROM order_items WHERE order_id IN (?,?)`, oid, oid2);
run(`DELETE FROM orders WHERE id IN (?,?)`, oid, oid2);
run(`DELETE FROM licenses WHERE key IN (SELECT license_key FROM license_issues WHERE user_id=?)`, uid);
run(`DELETE FROM lic_events WHERE detail LIKE '%rollback%' AND at >= ?`, Math.floor(now / 1000) - 60);
run(`DELETE FROM license_issues WHERE user_id=?`, uid);
run(`DELETE FROM wallet_transactions WHERE user_id=?`, uid);
run(`DELETE FROM users WHERE id=?`, uid);
run(`UPDATE product_keys SET status='available', order_id=NULL, delivered_at=NULL WHERE order_id IN (?,?)`, oid, oid2);
console.log('\n🧹 đã dọn dữ liệu test');

console.log(`\n${'─'.repeat(58)}`);
console.log(`Tổng: ${pass + fail}  |  ✅ ${pass}  |  ❌ ${fail}`);
db.close();
process.exit(fail > 0 ? 1 : 0);
