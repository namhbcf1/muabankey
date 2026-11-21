/**
 * degrade.test.mjs — HỒI QUY: khi bảng mới CHƯA migrate, hệ thống vẫn phải chạy.
 *
 * VÌ SAO QUAN TRỌNG: production hiện tại CHƯA có `entitlement_grants` và
 * `payment_inbox`. Nếu code mới ném lỗi khi thiếu bảng, deploy lên là khách
 * đã trả tiền không lấy được quyền — biến một bản sửa lỗi thành sự cố.
 *
 * Nguyên tắc: GHI quyền không được phụ thuộc sổ cái; sổ chỉ để đối soát.
 */
import { Suite } from './harness.mjs';
import { makeEnv, nowSec } from './d1.mjs';

/* CHỈ migration cũ — KHÔNG có 0002 (grant) và 0003 (inbox). */
const OLD_ONLY = [
  'db/migrate-account-entitlements.sql',
  'db/migrate-trial-account.sql',
];

const S = new Suite('Hồi quy: chưa migrate bảng mới');

const {
  grantFeature, applyTrialEntitlement, shapeAccountEntitlements,
  revokeOrderGrants, revokeFeature, FEATURE_NOFOG,
} = await import('../src/lib/account-entitlement.js');
const { refundOrder } = await import('../src/lib/refund-service.js');

if (!grantFeature || !applyTrialEntitlement) {
  console.error('không nạp được module');
  process.exit(1);
}

function seedUser(sqlite, id) {
  const t = nowSec() * 1000;
  sqlite.prepare(
    'INSERT INTO users (id, email, password_hash, password_salt, role, status, balance, created_at, updated_at, username) VALUES (?,?,?,?,?,?,?,?,?,?)'
  ).run(id, `${id}@local`, 'x', 'y', 'user', 'active', 0, t, t, id);
}

function seedOrder(sqlite, { id, code, userId, total = 180000 }) {
  const t = nowSec() * 1000;
  sqlite.prepare(
    'INSERT OR IGNORE INTO categories (id, slug, name, created_at) VALUES (?,?,?,?)'
  ).run('c1', 'cat', 'Danh mục', t);
  sqlite.prepare(
    `INSERT OR IGNORE INTO products
       (id, slug, category_id, name, price, delivery_type, stock_count, sold_count,
        rating, rating_count, warranty_days, active, featured, sort_order, created_at, updated_at, license_days)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run('p1', 'p1', 'c1', 'Gói', total, 'license', 0, 0, 5, 0, 0, 1, 0, 0, t, t, 30);
  sqlite.prepare(
    `INSERT INTO orders (id, code, user_id, status, subtotal, discount, total,
       payment_method, created_at, paid_at, delivered_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  ).run(id, code, userId, 'delivered', total, 0, total, 'wallet', t, t, t);
  sqlite.prepare(
    `INSERT INTO order_items (id, order_id, product_id, product_name, unit_price, quantity, line_total)
     VALUES (?,?,?,?,?,?,?)`
  ).run(`oi-${id}`, id, 'p1', 'Gói', total, 1, total);
}

/* ================================================================== */
S.section('grantFeature vẫn cấp được quyền khi THIẾU sổ cái');

{
  const { env, sqlite } = makeEnv({ migrations: OLD_ONLY });
  seedUser(sqlite, 'u1');

  const tables = sqlite.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='entitlement_grants'"
  ).get();
  S.ok(!tables, 'xác nhận: bảng entitlement_grants KHÔNG tồn tại');

  const T = 1_800_000_000;
  const real = Date.now;
  Date.now = () => T * 1000;
  let r;
  try {
    r = await grantFeature(env, {
      userId: 'u1', feature: FEATURE_NOFOG, days: 30, source: 'purchase', orderId: 'o1',
    });
  } finally { Date.now = real; }

  S.ok(r && r.expiresAt === T + 30 * 86400, 'vẫn cộng đúng 30 ngày', String(r?.expiresAt));

  const row = sqlite.prepare(
    'SELECT expires_at FROM account_entitlements WHERE user_id = ? AND feature = ?'
  ).get('u1', FEATURE_NOFOG);
  S.ok(!!row, 'dòng quyền được ghi vào account_entitlements');
}

S.section('applyTrialEntitlement vẫn chạy khi THIẾU sổ cái');

{
  const { env, sqlite } = makeEnv({ migrations: OLD_ONLY });
  seedUser(sqlite, 'u2');
  const T = 1_800_000_000;
  const real = Date.now;
  Date.now = () => T * 1000;
  try {
    await applyTrialEntitlement(env, {
      userId: 'u2', feature: FEATURE_NOFOG, expiresAt: T + 86400, trialToken: 'x',
    });
  } finally { Date.now = real; }

  const row = sqlite.prepare(
    'SELECT expires_at FROM account_entitlements WHERE user_id = ? AND feature = ?'
  ).get('u2', FEATURE_NOFOG);
  S.ok(Number(row?.expires_at) === T + 86400, 'dùng thử vẫn ghi đúng mốc',
    String(row?.expires_at));
}

S.section('revokeOrderGrants không ném lỗi khi thiếu sổ');

{
  const { env } = makeEnv({ migrations: OLD_ONLY });
  let threw = false;
  try {
    const r = await revokeOrderGrants(env, 'order-x');
    S.ok(r.revoked === 0, 'trả revoked=0 (không có gì để thu hồi)');
  } catch (e) {
    threw = true;
    console.error(e);
  }
  S.ok(!threw, 'không ném lỗi khi thiếu bảng sổ');
}

S.section('refundOrder vẫn hoàn được khi thiếu sổ cái');

{
  const { env, sqlite } = makeEnv({ migrations: OLD_ONLY });
  seedUser(sqlite, 'u3');
  seedOrder(sqlite, { id: 'o3', code: 'MBK-3', userId: 'u3' });

  const r = await refundOrder(env, { orderId: 'o3', channel: 'web' });
  S.ok(r.ok === true, 'hoàn thành công dù thiếu sổ', r.message || '');
  const o = sqlite.prepare('SELECT status FROM orders WHERE id = ?').get('o3');
  S.ok(o.status === 'refund_pending_transfer', 'đơn sang chờ chuyển tiền', o.status);
}

S.section('revokeFeature không ném lỗi khi thiếu sổ');

{
  const { env, sqlite } = makeEnv({ migrations: OLD_ONLY });
  seedUser(sqlite, 'u4');
  let threw = false;
  try {
    await revokeFeature(env, 'u4', FEATURE_NOFOG);
  } catch { threw = true; }
  S.ok(!threw, 'thu hồi không ném lỗi');
}

S.section('shapeAccountEntitlements vẫn chạy');

{
  const { env, sqlite } = makeEnv({ migrations: OLD_ONLY });
  seedUser(sqlite, 'u5');
  const T = 1_800_000_000;
  const real = Date.now;
  Date.now = () => T * 1000;
  let s;
  try {
    await grantFeature(env, { userId: 'u5', feature: FEATURE_NOFOG, days: 7 });
    s = await shapeAccountEntitlements(env, 'u5', T);
  } finally { Date.now = real; }

  S.ok(s.hasNofog === true, 'đọc được quyền');
  S.ok(s.nofog.daysLeft === 7, 'daysLeft đúng', String(s.nofog.daysLeft));
}

S.section('Sau khi migrate: idempotent mới bật (không hồi quy)');

{
  const ALL = [...OLD_ONLY, 'db/migrate-entitlement-grants.sql'];
  const { env, sqlite } = makeEnv({ migrations: ALL });
  seedUser(sqlite, 'u6');
  const T = 1_800_000_000;
  const real = Date.now;
  Date.now = () => T * 1000;
  try {
    const a = await grantFeature(env, {
      userId: 'u6', feature: FEATURE_NOFOG, days: 30, source: 'purchase', orderId: 'same',
    });
    const b = await grantFeature(env, {
      userId: 'u6', feature: FEATURE_NOFOG, days: 30, source: 'purchase', orderId: 'same',
    });
    S.ok(a.applied === true, 'lần đầu áp dụng');
    S.ok(b.applied === false, 'lần hai KHÔNG áp lại (idempotent bật khi có sổ)');
  } finally { Date.now = real; }

  const row = sqlite.prepare(
    'SELECT expires_at FROM account_entitlements WHERE user_id = ? AND feature = ?'
  ).get('u6', FEATURE_NOFOG);
  S.ok(Number(row.expires_at) === T + 30 * 86400, 'tổng vẫn 30 ngày',
    String(Math.round((Number(row.expires_at) - T) / 86400)));
}

process.exit(S.summary() ? 0 : 1);
