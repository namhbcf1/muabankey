/**
 * refund.test.mjs — Hoàn tiền: một dịch vụ duy nhất, thu hồi đúng phạm vi.
 *
 * Khoá các lỗi P0:
 *   F04 — web và Telegram phải cho CÙNG kết quả sổ sách
 *   F02 — hoàn tiền phải đảo nguồn quyền tài khoản, đúng phần của đơn
 */
import { Suite } from './harness.mjs';
import { makeEnv, nowSec } from './d1.mjs';

const MIGRATIONS = [
  'db/migrate-account-entitlements.sql',
  'db/migrate-trial-account.sql',
  'db/migrate-entitlement-grants.sql',
];

const S = new Suite('Hoàn tiền');

const { refundOrder, completeRefundTransfer, listPendingRefunds } =
  await import('../src/lib/refund-service.js');
const { grantFeature, shapeAccountEntitlements, FEATURE_NOFOG } =
  await import('../src/lib/account-entitlement.js');

/* ------------------------------------------------------------------ */
/* Dựng dữ liệu                                                        */
/* ------------------------------------------------------------------ */

function seed(sqlite, {
  orderId = 'ord-1', code = 'MBK-TEST01', status = 'delivered',
  total = 180000, userId = 'u1', productId = 'p1', quantity = 1,
} = {}) {
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
        rating, rating_count, warranty_days, active, featured, sort_order, created_at, updated_at, license_days)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(productId, `p-${productId}`, 'c1', 'Gói thử', total, 'license', 0, 5,
    5, 0, 0, 1, 0, 0, t, t, 30);

  sqlite.prepare(
    `INSERT INTO orders (id, code, user_id, status, subtotal, discount, total,
       payment_method, created_at, paid_at, delivered_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  ).run(orderId, code, userId, status, total, 0, total, 'wallet', t, t, t);

  sqlite.prepare(
    `INSERT INTO order_items (id, order_id, product_id, product_name,
       unit_price, quantity, line_total)
     VALUES (?,?,?,?,?,?,?)`
  ).run(`oi-${orderId}`, orderId, productId, 'Gói thử', total, quantity, total * quantity);
}

function orderRow(sqlite, id) {
  return sqlite.prepare('SELECT * FROM orders WHERE id = ?').get(id);
}

function ledgerRow(sqlite, id) {
  return sqlite.prepare('SELECT * FROM refund_ledger WHERE order_id = ?').get(id);
}

/* ================================================================== */
S.section('Hoàn tiền cơ bản — chưa chuyển tiền thì KHÔNG được chốt "đã hoàn"');

{
  const { env, sqlite } = makeEnv({ migrations: MIGRATIONS });
  seed(sqlite);

  const r = await refundOrder(env, { orderId: 'ord-1', channel: 'web', actor: 'admin' });
  S.ok(r.ok === true, 'hoàn được đơn đã giao');
  S.ok(r.state === 'pending', 'sổ ghi state=pending (CHƯA chuyển tiền)', String(r.state));
  S.ok(r.status === 'refund_pending_transfer', 'đơn sang refund_pending_transfer', String(r.status));

  const o = orderRow(sqlite, 'ord-1');
  S.ok(o.status === 'refund_pending_transfer',
    'đơn KHÔNG nhảy thẳng sang "refunded" khi chưa có chứng từ', String(o.status));

  const l = ledgerRow(sqlite, 'ord-1');
  S.ok(Number(l.amount) === 180000, 'sổ ghi đúng số tiền', String(l.amount));

  const pend = await listPendingRefunds(env);
  S.ok(pend.length === 1, 'dashboard đối soát thấy 1 khoản chờ chuyển', `${pend.length}`);
}

S.section('F04 — web và Telegram cho CÙNG kết quả');

{
  const results = [];
  for (const channel of ['web', 'telegram']) {
    const { env, sqlite } = makeEnv({ migrations: MIGRATIONS });
    seed(sqlite);
    const r = await refundOrder(env, { orderId: 'ord-1', channel, actor: channel });
    const o = orderRow(sqlite, 'ord-1');
    const l = ledgerRow(sqlite, 'ord-1');
    results.push({
      ok: r.ok, state: r.state, status: o.status,
      amount: Number(l.amount), ledgerState: l.state, source: l.source,
      balance: Number(sqlite.prepare('SELECT balance FROM users WHERE id = ?').get('u1').balance),
      walletRows: Number(sqlite.prepare('SELECT COUNT(*) AS n FROM wallet_transactions').get().n),
    });
  }

  S.eq(results[0].status, results[1].status, 'hai kênh cho CÙNG trạng thái đơn');
  S.eq(results[0].state, results[1].state, 'hai kênh cho CÙNG trạng thái sổ');
  S.eq(results[0].amount, results[1].amount, 'hai kênh hoàn CÙNG số tiền');
  S.eq(results[0].balance, results[1].balance,
    'KHÔNG kênh nào cộng số dư ví (ví đã bỏ)');
  S.eq(results[0].walletRows, results[1].walletRows,
    'KHÔNG kênh nào ghi wallet_transactions');
  S.eq(results[0].balance, 0, 'số dư khách vẫn 0 sau khi hoàn');
  S.ok(results[0].source === 'web' && results[1].source === 'telegram',
    'sổ vẫn phân biệt được nguồn thao tác');
}

S.section('Chống hoàn hai lần');

{
  const { env, sqlite } = makeEnv({ migrations: MIGRATIONS });
  seed(sqlite);

  const r1 = await refundOrder(env, { orderId: 'ord-1', channel: 'web' });
  S.ok(r1.ok === true, 'lần 1 hoàn được');

  const r2 = await refundOrder(env, { orderId: 'ord-1', channel: 'telegram' });
  S.ok(r2.ok === false, 'lần 2 bị chặn', String(r2.code));

  // Đua thật: hai request đồng thời
  const { env: env2, sqlite: sq2 } = makeEnv({ migrations: MIGRATIONS });
  seed(sq2);
  const both = await Promise.all([
    refundOrder(env2, { orderId: 'ord-1', channel: 'web' }),
    refundOrder(env2, { orderId: 'ord-1', channel: 'telegram' }),
  ]);
  const okCount = both.filter((x) => x.ok).length;
  S.ok(okCount === 1, 'hai request đồng thời: chỉ MỘT lượt hoàn thành công',
    `${okCount} lượt thành công`);

  const n = sq2.prepare('SELECT COUNT(*) AS n FROM refund_ledger').get();
  S.ok(Number(n.n) === 1, 'sổ chỉ có 1 dòng hoàn', `${n.n}`);
}

S.section('Chỉ hoàn đơn đã thanh toán');

{
  for (const [st, label] of [
    ['pending', 'chưa thanh toán'],
    ['expired', 'đã hết hạn'],
    ['cancelled', 'đã huỷ'],
  ]) {
    const { env, sqlite } = makeEnv({ migrations: MIGRATIONS });
    seed(sqlite, { status: st });
    const r = await refundOrder(env, { orderId: 'ord-1', channel: 'web' });
    S.ok(r.ok === false && r.code === 'BAD_STATE',
      `KHÔNG hoàn được đơn ${label}`, String(r.code));
    const n = sqlite.prepare('SELECT COUNT(*) AS n FROM refund_ledger').get();
    S.ok(Number(n.n) === 0, `đơn ${label}: không ghi sổ hoàn`, `${n.n}`);
  }
}

S.section('F02 — hoàn tiền phải THU HỒI QUYỀN TÀI KHOẢN');

{
  const { env, sqlite } = makeEnv({ migrations: MIGRATIONS });
  seed(sqlite);
  const T = nowSec();

  // Đơn này đã cấp 30 ngày nofog
  await grantFeature(env, {
    userId: 'u1', feature: FEATURE_NOFOG, days: 30,
    source: 'purchase', orderId: 'ord-1', now: T,
  });
  let s = await shapeAccountEntitlements(env, 'u1', T);
  S.ok(s.hasNofog === true, 'trước hoàn: khách có quyền nofog');

  const r = await refundOrder(env, { orderId: 'ord-1', channel: 'web', now: T });
  S.ok(r.ok === true, 'hoàn thành công');
  S.eq(r.revoked.features, [FEATURE_NOFOG], 'báo cáo thu hồi đúng tính năng');

  s = await shapeAccountEntitlements(env, 'u1', T);
  S.ok(s.hasNofog === false, 'sau hoàn: quyền nofog ĐÃ bị thu hồi');
}

S.section('F02 — hoàn đơn A giữ nguyên quyền của đơn B');

{
  const { env, sqlite } = makeEnv({ migrations: MIGRATIONS });
  seed(sqlite, { orderId: 'ord-A', code: 'MBK-A' });
  seed(sqlite, { orderId: 'ord-B', code: 'MBK-B' });
  const T = nowSec();

  await grantFeature(env, {
    userId: 'u1', feature: FEATURE_NOFOG, days: 30,
    source: 'purchase', orderId: 'ord-A', now: T,
  });
  await grantFeature(env, {
    userId: 'u1', feature: FEATURE_NOFOG, days: 30,
    source: 'purchase', orderId: 'ord-B', now: T,
  });

  let s = await shapeAccountEntitlements(env, 'u1', T);
  S.ok(s.nofog.daysLeft === 60, 'trước hoàn: 60 ngày', String(s.nofog.daysLeft));

  await refundOrder(env, { orderId: 'ord-A', channel: 'web', now: T });

  s = await shapeAccountEntitlements(env, 'u1', T);
  S.ok(s.nofog.daysLeft === 30, 'sau hoàn đơn A: còn đúng 30 ngày của đơn B',
    String(s.nofog.daysLeft));
  S.ok(s.hasNofog === true, 'quyền của đơn B KHÔNG bị mất');
}

S.section('Chốt "đã chuyển tiền" — bắt buộc có chứng từ');

{
  const { env, sqlite } = makeEnv({ migrations: MIGRATIONS });
  seed(sqlite);
  await refundOrder(env, { orderId: 'ord-1', channel: 'web' });

  const bad = await completeRefundTransfer(env, { orderId: 'ord-1', bankRef: '' });
  S.ok(bad.ok === false && bad.code === 'BANK_REF_REQUIRED',
    'thiếu mã giao dịch -> từ chối chốt', String(bad.code));

  const ok1 = await completeRefundTransfer(env, {
    orderId: 'ord-1', bankRef: 'VCB-20261121-0001', actor: 'admin',
  });
  S.ok(ok1.ok === true, 'có chứng từ -> chốt được');
  S.ok(orderRow(sqlite, 'ord-1').status === 'refunded', 'đơn thành refunded');
  S.ok(ledgerRow(sqlite, 'ord-1').state === 'done', 'sổ thành done');

  const again = await completeRefundTransfer(env, {
    orderId: 'ord-1', bankRef: 'VCB-20261121-0002',
  });
  S.ok(again.ok === false, 'chốt lần hai bị chặn', String(again.code));
}

S.section('Truyền thẳng "đã chuyển tiền" ngay khi hoàn');

{
  const { env, sqlite } = makeEnv({ migrations: MIGRATIONS });
  seed(sqlite);

  const noRef = await refundOrder(env, {
    orderId: 'ord-1', channel: 'web', markPaidOut: true, bankRef: '',
  });
  S.ok(noRef.ok === false && noRef.code === 'BANK_REF_REQUIRED',
    'paidOut mà không có mã GD -> từ chối', String(noRef.code));
  S.ok(orderRow(sqlite, 'ord-1').status === 'delivered',
    'đơn giữ nguyên trạng thái khi bị từ chối');

  const r = await refundOrder(env, {
    orderId: 'ord-1', channel: 'web', markPaidOut: true, bankRef: 'TCB-99',
  });
  S.ok(r.ok === true && r.state === 'done', 'có mã GD -> chốt done ngay');
  S.ok(orderRow(sqlite, 'ord-1').status === 'refunded', 'đơn refunded');
}

S.section('Hoàn đơn đang xử lý (processing) — không treo tiền');

{
  const { env, sqlite } = makeEnv({ migrations: MIGRATIONS });
  seed(sqlite, { status: 'processing' });
  const r = await refundOrder(env, { orderId: 'ord-1', channel: 'web' });
  S.ok(r.ok === true, 'hoàn được đơn đang xử lý (tiền đã vào)');
  S.ok(orderRow(sqlite, 'ord-1').status === 'refund_pending_transfer',
    'đơn sang chờ chuyển tiền');
}

process.exit(S.summary() ? 0 : 1);
