/**
 * test-zerokey-repair.mjs — kiểm chứng đường CỨU đơn "delivered nhưng 0 key".
 *
 * BỐI CẢNH: trên production có thật 4 đơn status='delivered' với
 * order_items.delivered_keys = NULL. Nguyên nhân: đường Telegram
 * ("📦 Giao đơn") chỉ UPDATE status='delivered' mà không cấp hàng.
 *
 * Test này dựng đúng trạng thái đó trong D1 LOCAL rồi gọi
 * POST /api/admin/orders/:id/deliver và kiểm:
 *   1. Đơn 'delivered' + 0 key PHẢI được cấp bù (trước đây trả {already:true}).
 *   2. Sau khi cấp bù, delivered_keys không còn rỗng.
 *   3. Gọi LẦN HAI không sinh thêm key (idempotent, chống giao trùng).
 *
 * Dùng D1 LOCAL qua wrangler. Không đụng production.
 *
 * Chạy: node scripts/test-zerokey-repair.mjs [baseUrl]
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.argv[2] || 'http://127.0.0.1:8791';
const DB = 'muabankey-db';
const ADMIN_USER = process.env.ADMIN_USER || 'namhbcf';
const ADMIN_PW = process.env.ADMIN_PASSWORD || 'namhbcf123';

let pass = 0, fail = 0;
const fails = [];
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; fails.push(name); console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`); }
}

/**
 * Chạy SQL trên D1 local, trả về mảng row.
 *
 * Dùng --file qua stdin tạm thay vì --command vì SQL có khoảng trắng + dấu
 * phẩy; truyền qua dòng lệnh bị shell tách thành nhiều tham số.
 */
function sql(statement) {
  const f = join(tmpdir(), `zk-${randomUUID()}.sql`);
  writeFileSync(f, statement, 'utf8');
  try {
    const out = execFileSync('npx', [
      'wrangler@4', 'd1', 'execute', DB, '--local', '--json', `--file=${f}`,
    ], { encoding: 'utf8', shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const start = out.indexOf('[');
    if (start < 0) return [];
    const parsed = JSON.parse(out.slice(start));
    return parsed[0]?.results || [];
  } finally {
    try { unlinkSync(f); } catch { /* ignore */ }
  }
}

function esc(s) {
  return String(s).replace(/'/g, "''");
}

class Client {
  constructor() { this.cookie = null; }
  async req(path, { method = 'GET', body = null } = {}) {
    const headers = { Accept: 'application/json' };
    if (body) headers['Content-Type'] = 'application/json';
    if (this.cookie) headers.Cookie = this.cookie;
    const res = await fetch(BASE + path, {
      method, headers, body: body ? JSON.stringify(body) : undefined,
    });
    const sc = res.headers.get('set-cookie');
    if (sc) {
      const m = sc.match(/mbk_session=[^;]+/);
      if (m) this.cookie = m[0];
    }
    let data = null;
    try { data = await res.json(); } catch { /* */ }
    return { status: res.status, data };
  }
}

const tag = Date.now().toString(36);

/* ===== 0. Đăng nhập admin ===== */
const admin = new Client();
const login = await admin.req('/api/auth/login', {
  method: 'POST', body: { username: ADMIN_USER, password: ADMIN_PW },
});
ok('đăng nhập admin', login.status === 200 && login.data?.ok !== false,
  `status=${login.status} ${JSON.stringify(login.data).slice(0, 120)}`);
if (login.status !== 200) {
  console.log('\nKhông đăng nhập được admin -> dừng. Seed admin local trước:');
  console.log('  xem scripts/seed-local-admin.mjs');
  process.exit(1);
}

/* ===== 1. Dựng đơn 'delivered' + 0 key, sản phẩm license (sinh động) ===== */
const productId = `p-test-zk-${tag}`;
const userId = `u-test-zk-${tag}`;
const orderId = randomUUID();
const code = `MBK-ZK${tag.slice(-4).toUpperCase()}`;
const now = Date.now();

sql(`INSERT INTO products (id, name, slug, price, delivery_type, license_days,
      license_prefix, active, stock_count, sold_count, created_at, updated_at)
     VALUES ('${esc(productId)}','Test ZeroKey ${esc(tag)}','test-zk-${esc(tag)}',
      100000,'license',30,'TZK',1,0,0,${now},${now});`);

sql(`INSERT INTO users (id, email, username, password_hash, password_salt,
      role, status, balance, created_at, updated_at)
     VALUES ('${esc(userId)}','zk${esc(tag)}@invalid','zk${esc(tag)}',
      'x','x','user','active',0,${now},${now});`);

sql(`INSERT INTO orders (id, code, user_id, status, subtotal, discount, total,
      created_at, paid_at, delivered_at)
     VALUES ('${esc(orderId)}','${esc(code)}','${esc(userId)}','delivered',
      100000,0,100000,${now},${now},${now});`);

sql(`INSERT INTO order_items (id, order_id, product_id, product_name,
      unit_price, quantity, line_total, delivered_keys)
     VALUES ('${esc(randomUUID())}','${esc(orderId)}','${esc(productId)}',
      'Test ZeroKey',100000,1,100000,NULL);`);

const before = sql(`SELECT delivered_keys FROM order_items WHERE order_id='${esc(orderId)}'`);
ok('tiền đề: đơn delivered với delivered_keys NULL',
  before.length === 1 && before[0].delivered_keys === null,
  JSON.stringify(before));

/* ===== 2. Gọi endpoint admin deliver -> phải cấp bù ===== */
const r1 = await admin.req(`/api/admin/orders/${orderId}/deliver`, { method: 'POST' });
ok('gọi deliver trên đơn 0-key không bị từ chối "already"',
  r1.status === 200 && r1.data?.already !== true,
  `status=${r1.status} body=${JSON.stringify(r1.data).slice(0, 200)}`);

const after = sql(`SELECT delivered_keys FROM order_items WHERE order_id='${esc(orderId)}'`);
const dk = after[0]?.delivered_keys;
ok('delivered_keys đã được cấp (không còn NULL/rỗng)',
  dk !== null && dk !== '' && dk !== '[]', `got=${String(dk).slice(0, 60)}`);

const lic = sql(`SELECT COUNT(*) AS n FROM license_issues WHERE order_id='${esc(orderId)}'`);
ok('license thật đã được ghi vào license_issues', (lic[0]?.n || 0) >= 1,
  `n=${lic[0]?.n}`);

const st = sql(`SELECT status FROM orders WHERE id='${esc(orderId)}'`);
ok('đơn vẫn ở trạng thái delivered', st[0]?.status === 'delivered',
  `status=${st[0]?.status}`);

/* ===== 3. Gọi lần hai -> KHÔNG sinh thêm key (idempotent) ===== */
const licBefore2 = (sql(
  `SELECT COUNT(*) AS n FROM license_issues WHERE order_id='${esc(orderId)}'`)[0]?.n) || 0;
const r2 = await admin.req(`/api/admin/orders/${orderId}/deliver`, { method: 'POST' });
const licAfter2 = (sql(
  `SELECT COUNT(*) AS n FROM license_issues WHERE order_id='${esc(orderId)}'`)[0]?.n) || 0;

ok('gọi lần 2 trả already (không giao lại)', r2.data?.already === true,
  `body=${JSON.stringify(r2.data).slice(0, 160)}`);
ok('gọi lần 2 KHÔNG sinh thêm license',
  licAfter2 === licBefore2, `before=${licBefore2} after=${licAfter2}`);

/* ===== 4. Sản phẩm hết hàng -> phải ở 'paid', KHÔNG 'delivered' ===== */
const p2 = `p-test-zk2-${tag}`;
const o2 = randomUUID();
const u2 = `u-test-zk2-${tag}`;
const code2 = `MBK-ZL${tag.slice(-4).toUpperCase()}`;

sql(`INSERT INTO products (id, name, slug, price, delivery_type, active,
      stock_count, sold_count, created_at, updated_at)
     VALUES ('${esc(p2)}','Test ZeroKey2 ${esc(tag)}','test-zk2-${esc(tag)}',
      50000,'key',1,0,0,${now},${now});`);
sql(`INSERT INTO users (id, email, username, password_hash, password_salt,
      role, status, balance, created_at, updated_at)
     VALUES ('${esc(u2)}','zl${esc(tag)}@invalid','zl${esc(tag)}','x','x',
      'user','active',0,${now},${now});`);
sql(`INSERT INTO orders (id, code, user_id, status, subtotal, discount, total,
      created_at, paid_at)
     VALUES ('${esc(o2)}','${esc(code2)}','${esc(u2)}','paid',50000,0,50000,
      ${now},${now});`);
sql(`INSERT INTO order_items (id, order_id, product_id, product_name,
      unit_price, quantity, line_total, delivered_keys)
     VALUES ('${esc(randomUUID())}','${esc(o2)}','${esc(p2)}',
      'Test ZeroKey2',50000,1,50000,NULL);`);

const r3 = await admin.req(`/api/admin/orders/${o2}/deliver`, { method: 'POST' });
const st2 = sql(`SELECT status FROM orders WHERE id='${esc(o2)}'`);
ok('hết hàng: đơn KHÔNG bị đánh delivered (ở lại paid)',
  st2[0]?.status === 'paid',
  `status=${st2[0]?.status} http=${r3.status} body=${JSON.stringify(r3.data).slice(0, 160)}`);

const dk2 = sql(`SELECT delivered_keys FROM order_items WHERE order_id='${esc(o2)}'`);
ok('hết hàng: delivered_keys vẫn rỗng', dk2[0]?.delivered_keys === null,
  `got=${String(dk2[0]?.delivered_keys)}`);

/* ===== dọn dẹp ===== */
sql(`DELETE FROM license_issues WHERE order_id IN ('${esc(orderId)}','${esc(o2)}');`);
sql(`DELETE FROM order_items WHERE order_id IN ('${esc(orderId)}','${esc(o2)}');`);
sql(`DELETE FROM orders WHERE id IN ('${esc(orderId)}','${esc(o2)}');`);
sql(`DELETE FROM products WHERE id IN ('${esc(productId)}','${esc(p2)}');`);
sql(`DELETE FROM users WHERE id IN ('${esc(userId)}','${esc(u2)}');`);

console.log('\n' + '─'.repeat(54));
console.log(`Tổng: ${pass + fail}  |  ✅ ${pass}  |  ❌ ${fail}`);
if (fail) {
  console.log('\nLỗi:\n' + fails.map((f) => '  • ' + f).join('\n'));
  process.exit(1);
}
console.log('🎉 ĐƯỜNG CỨU ĐƠN 0-KEY HOẠT ĐỘNG ĐÚNG');
