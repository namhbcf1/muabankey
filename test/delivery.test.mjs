/**
 * delivery.test.mjs — Giao hàng: quantity, cấp quyền, rollback khi lỗi.
 *
 * Khoá lỗi P0 F02:
 *   - grantFeature nhận `days` của MỘT đơn vị trong khi quantity tới 20
 *   - rollback không hoàn tác quyền đã cấp
 */
import { Suite } from './harness.mjs';
import { makeEnv, nowSec } from './d1.mjs';

const MIGRATIONS = [
  'db/migrate-account-entitlements.sql',
  'db/migrate-trial-account.sql',
  'db/migrate-entitlement-grants.sql',
];

const S = new Suite('Giao hàng & cấp quyền');

const { deliverOrderItems } = await import('../src/routes/orders.js');
const { shapeAccountEntitlements, FEATURE_NOFOG, FEATURE_GRANT } =
  await import('../src/lib/account-entitlement.js');

function seed(sqlite, { userId = 'u1', licenseDays = 30, qty = 1, prefix = 'AOE1' } = {}) {
  const t = nowSec() * 1000;
  sqlite.prepare(
    'INSERT OR IGNORE INTO users (id, email, password_hash, password_salt, role, status, balance, created_at, updated_at, username) VALUES (?,?,?,?,?,?,?,?,?,?)'
  ).run(userId, `${userId}@local`, 'x', 'y', 'user', 'active', 0, t, t, userId);

  sqlite.prepare(
    'INSERT OR IGNORE INTO categories (id, slug, name, created_at) VALUES (?,?,?,?)'
  ).run('c1', 'cat', 'Danh mục', t);

  sqlite.prepare(
    `INSERT OR IGNORE INTO products
       (id, slug, category_id, name, price, delivery_type, stock_count, sold_count,
        rating, rating_count, warranty_days, active, featured, sort_order,
        created_at, updated_at, license_days, license_prefix)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run('p1', 'p1', 'c1', 'Gói thử', 180000, 'license', 0, 0,
    5, 0, 0, 1, 0, 0, t, t, licenseDays, prefix);

  sqlite.prepare(
    `INSERT INTO orders (id, code, user_id, status, subtotal, discount, total,
       payment_method, created_at, paid_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).run('o1', 'MBK-1', userId, 'processing', 180000 * qty, 0, 180000 * qty, 'wallet', t, t);

  sqlite.prepare(
    `INSERT INTO order_items (id, order_id, product_id, product_name, unit_price, quantity, line_total)
     VALUES (?,?,?,?,?,?,?)`
  ).run('oi1', 'o1', 'p1', 'Gói thử', 180000, qty, 180000 * qty);

  return sqlite.prepare('SELECT * FROM orders WHERE id = ?').get('o1');
}

function orderRow(sqlite) {
  return sqlite.prepare('SELECT * FROM orders WHERE id = ?').get('o1');
}

/* ================================================================== */
S.section('quantity = 1 -> cấp đúng 30 ngày');

{
  const { env, sqlite } = makeEnv({ migrations: MIGRATIONS });
  const order = seed(sqlite, { licenseDays: 30, qty: 1 });
  const T = Math.floor(Date.now() / 1000);

  const r = await deliverOrderItems(env, order);
  S.ok(!!r, 'giao hàng trả kết quả');
  S.ok(r.delivered.length === 1, 'có 1 dòng được giao', String(r.delivered.length));

  const s = await shapeAccountEntitlements(env, 'u1', T);
  S.ok(s.hasNofog === true, 'tài khoản có quyền nofog');
  const days = s.nofog.daysLeft;
  S.ok(days === 30, 'đúng 30 ngày', String(days));
}

S.section('F02 — quantity = 2 phải cấp 60 ngày (không phải 30)');

{
  const { env, sqlite } = makeEnv({ migrations: MIGRATIONS });
  const order = seed(sqlite, { licenseDays: 30, qty: 2 });
  const T = Math.floor(Date.now() / 1000);

  await deliverOrderItems(env, order);

  const s = await shapeAccountEntitlements(env, 'u1', T);
  const days = s.nofog.daysLeft;
  S.ok(days === 60, 'mua 2 kỳ 30 ngày -> 60 ngày quyền', `${days} ngày`);
}

S.section('F02 — quantity = 3 với gói 7 ngày -> 21 ngày');

{
  const { env, sqlite } = makeEnv({ migrations: MIGRATIONS });
  const order = seed(sqlite, { licenseDays: 7, qty: 3 });
  const T = Math.floor(Date.now() / 1000);

  await deliverOrderItems(env, order);
  const s = await shapeAccountEntitlements(env, 'u1', T);
  S.ok(s.nofog.daysLeft === 21, '3 × 7 = 21 ngày', String(s.nofog.daysLeft));
}

S.section('Sản phẩm vĩnh viễn (license_days = 0) -> vĩnh viễn');

{
  const { env, sqlite } = makeEnv({ migrations: MIGRATIONS });
  const order = seed(sqlite, { licenseDays: 0, qty: 1 });
  const T = Math.floor(Date.now() / 1000);

  await deliverOrderItems(env, order);
  const s = await shapeAccountEntitlements(env, 'u1', T);
  S.ok(s.nofog.forever === true, 'quyền vĩnh viễn');
  S.ok(s.nofog.expires_at === 0, 'expires_at = 0');
}

S.section('Sản phẩm XAGR -> cấp tính năng grant, KHÔNG phải nofog');

{
  const { env, sqlite } = makeEnv({ migrations: MIGRATIONS });
  // Sản phẩm tài nguyên: prefix XAGR
  const t = nowSec() * 1000;
  sqlite.prepare(
    'INSERT OR IGNORE INTO users (id, email, password_hash, password_salt, role, status, balance, created_at, updated_at, username) VALUES (?,?,?,?,?,?,?,?,?,?)'
  ).run('u2', 'u2@local', 'x', 'y', 'user', 'active', 0, t, t, 'u2');
  sqlite.prepare(
    'INSERT OR IGNORE INTO categories (id, slug, name, created_at) VALUES (?,?,?,?)'
  ).run('c1', 'cat', 'Danh mục', t);
  sqlite.prepare(
    `INSERT INTO products
       (id, slug, category_id, name, price, delivery_type, stock_count, sold_count,
        rating, rating_count, warranty_days, active, featured, sort_order,
        created_at, updated_at, license_days, license_prefix)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run('p2', 'p2', 'c1', 'Tài nguyên', 100000, 'license', 0, 0,
    5, 0, 0, 1, 0, 0, t, t, 30, 'XAGR');
  sqlite.prepare(
    `INSERT INTO orders (id, code, user_id, status, subtotal, discount, total,
       payment_method, created_at, paid_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).run('o2', 'MBK-2', 'u2', 'processing', 100000, 0, 100000, 'wallet', t, t);
  sqlite.prepare(
    `INSERT INTO order_items (id, order_id, product_id, product_name, unit_price, quantity, line_total)
     VALUES (?,?,?,?,?,?,?)`
  ).run('oi2', 'o2', 'p2', 'Tài nguyên', 100000, 1, 100000);

  const order = sqlite.prepare('SELECT * FROM orders WHERE id = ?').get('o2');
  await deliverOrderItems(env, order);

  const T = Math.floor(Date.now() / 1000);
  const s = await shapeAccountEntitlements(env, 'u2', T);
  S.ok(s.hasGrant === true, 'có quyền grant');
  S.ok(s.hasNofog === false, 'KHÔNG có quyền nofog');
}

S.section('Gọi lại (retry) không nhân đôi thời gian');

{
  const { env, sqlite } = makeEnv({ migrations: MIGRATIONS });
  const order = seed(sqlite, { licenseDays: 30, qty: 1 });
  const T = Math.floor(Date.now() / 1000);

  await deliverOrderItems(env, order);
  // Webhook gửi lại / admin bấm giao bù -> gọi lần hai với cùng order
  const fresh = orderRow(sqlite);
  await deliverOrderItems(env, fresh);
  const fresh2 = orderRow(sqlite);
  await deliverOrderItems(env, fresh2);

  const s = await shapeAccountEntitlements(env, 'u1', T);
  S.ok(s.nofog.daysLeft === 30, 'gọi 3 lần vẫn 30 ngày', String(s.nofog.daysLeft));
}

S.section('Sản phẩm đã xoá -> giao lỗi, không cấp quyền');

{
  const { env, sqlite } = makeEnv({ migrations: MIGRATIONS });
  const order = seed(sqlite, { licenseDays: 30, qty: 1 });
  sqlite.prepare('DELETE FROM products WHERE id = ?').run('p1');

  let threw = false;
  try {
    await deliverOrderItems(env, order);
  } catch { threw = true; }
  S.ok(threw === true, 'ném lỗi khi sản phẩm không còn');

  const T = Math.floor(Date.now() / 1000);
  const s = await shapeAccountEntitlements(env, 'u1', T);
  S.ok(s.hasNofog === false, 'KHÔNG cấp quyền khi giao lỗi');
}

S.section('Kiểu giao hàng lạ -> ném lỗi rõ ràng');

{
  const { env, sqlite } = makeEnv({ migrations: MIGRATIONS });
  const order = seed(sqlite, { licenseDays: 30, qty: 1 });
  sqlite.prepare("UPDATE products SET delivery_type = 'key' WHERE id = ?").run('p1');

  let msg = '';
  try {
    await deliverOrderItems(env, order);
  } catch (e) { msg = String(e.message || e); }
  S.ok(/không còn hỗ trợ/i.test(msg), 'báo rõ kiểu giao hàng đã bỏ', msg.slice(0, 60));

  const T = Math.floor(Date.now() / 1000);
  const s = await shapeAccountEntitlements(env, 'u1', T);
  S.ok(s.hasNofog === false, 'không cấp quyền');
}

S.section('Sổ cái ghi đúng nguồn và số ngày');

{
  const { env, sqlite } = makeEnv({ migrations: MIGRATIONS });
  const order = seed(sqlite, { licenseDays: 30, qty: 2 });
  await deliverOrderItems(env, order);

  const g = sqlite.prepare(
    'SELECT * FROM entitlement_grants WHERE user_id = ? AND source_type = ?'
  ).all('u1', 'purchase');
  S.ok(g.length === 1, '1 dòng sổ cho 1 đơn × 1 tính năng', String(g.length));
  S.ok(Number(g[0].days_added) === 60, 'days_added = 60 (30 × 2)', String(g[0]?.days_added));
  S.ok(String(g[0].source_id) === 'o1', 'source_id = mã đơn', String(g[0]?.source_id));
}

process.exit(S.summary() ? 0 : 1);
