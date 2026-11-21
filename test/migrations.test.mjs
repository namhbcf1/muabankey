/**
 * migrations.test.mjs — Migration runner: dựng được CSDL mới, nâng cấp được CSDL cũ.
 *
 * Khoá lỗi P1 F08:
 *   - schema.sql thiếu hai bảng của mô hình mới -> dựng môi trường mới bị thiếu
 *   - không có bảng theo dõi phiên bản -> không biết đã chạy tới đâu
 *   - sửa file migration đã chạy thì âm thầm không có tác dụng
 */
import { Suite } from './harness.mjs';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const S = new Suite('Migration');

const { runMigrations, status, baseline, listMigrations } =
  await import('../db/migrate.mjs');

function tablesOf(sqlite) {
  return sqlite.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
  ).all().map((r) => String(r.name));
}

function fresh() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  return sqlite;
}

/* ================================================================== */
S.section('Danh sách migration');

{
  const list = listMigrations();
  S.ok(list.length >= 3, 'có ít nhất 3 migration', `${list.length}`);
  S.ok(list.every((m) => /^\d{4}-/.test(m.id)), 'mọi migration có số thứ tự 4 chữ số');
  S.ok(list.every((m) => m.checksum.length === 64), 'mỗi migration có checksum SHA-256');
  const ids = list.map((m) => m.id);
  S.eq(ids, [...ids].sort(), 'danh sách đã sắp theo thứ tự');
}

S.section('Dựng CSDL MỚI — phải đủ bảng của mô hình hiện hành');

{
  const sqlite = fresh();
  // Giống hệt môi trường mới: chỉ có schema nền rồi chạy migration.
  sqlite.exec(readFileSync(join(ROOT, 'db/schema.sql'), 'utf8'));

  const before = tablesOf(sqlite);
  S.ok(before.includes('orders'), 'schema nền có bảng orders');
  S.ok(!before.includes('account_entitlements'),
    'schema nền THIẾU account_entitlements (đúng như lỗi F08)');
  S.ok(!before.includes('trial_accounts'),
    'schema nền THIẾU trial_accounts (đúng như lỗi F08)');

  const r = runMigrations(sqlite);
  S.ok(r.errors.length === 0, 'chạy migration không lỗi', r.errors.join('; '));

  const after = tablesOf(sqlite);
  S.ok(after.includes('account_entitlements'), 'sau migrate: có account_entitlements');
  S.ok(after.includes('trial_accounts'), 'sau migrate: có trial_accounts');
  S.ok(after.includes('entitlement_grants'), 'sau migrate: có entitlement_grants');
  S.ok(after.includes('payment_inbox'), 'sau migrate: có payment_inbox');
  S.ok(after.includes('schema_migrations'), 'sau migrate: có schema_migrations');
}

S.section('Chạy lại — idempotent, không lỗi');

{
  const sqlite = fresh();
  sqlite.exec(readFileSync(join(ROOT, 'db/schema.sql'), 'utf8'));

  const r1 = runMigrations(sqlite);
  S.ok(r1.applied.length >= 3, 'lần 1 áp dụng hết', `${r1.applied.length}`);

  const r2 = runMigrations(sqlite);
  S.ok(r2.applied.length === 0, 'lần 2 không áp dụng gì thêm', `${r2.applied.length}`);
  S.ok(r2.errors.length === 0, 'lần 2 không lỗi', r2.errors.join('; '));
  S.ok(r2.skipped.length === r1.applied.length, 'lần 2 bỏ qua đúng số đã chạy');
}

S.section('Nâng cấp CSDL CŨ đã có dữ liệu');

{
  const sqlite = fresh();
  sqlite.exec(readFileSync(join(ROOT, 'db/schema.sql'), 'utf8'));

  // Dữ liệu có sẵn từ trước khi migrate
  const t = Date.now();
  sqlite.prepare(
    'INSERT INTO users (id, email, password_hash, password_salt, role, status, balance, created_at, updated_at, username) VALUES (?,?,?,?,?,?,?,?,?,?)'
  ).run('u-old', 'old@local', 'h', 's', 'user', 'active', 0, t, t, 'olduser');
  sqlite.prepare(
    'INSERT INTO orders (id, code, user_id, status, subtotal, discount, total, payment_method, created_at) VALUES (?,?,?,?,?,?,?,?,?)'
  ).run('o-old', 'MBK-OLD001', 'u-old', 'delivered', 180000, 0, 180000, 'wallet', t);

  const r = runMigrations(sqlite);
  S.ok(r.errors.length === 0, 'nâng cấp CSDL cũ không lỗi', r.errors.join('; '));

  const u = sqlite.prepare('SELECT * FROM users WHERE id = ?').get('u-old');
  S.ok(!!u && u.username === 'olduser', 'dữ liệu users cũ KHÔNG bị mất');
  const o = sqlite.prepare('SELECT * FROM orders WHERE id = ?').get('o-old');
  S.ok(!!o && o.code === 'MBK-OLD001', 'dữ liệu orders cũ KHÔNG bị mất');

  // Bảng mới dùng được ngay
  sqlite.prepare(
    'INSERT INTO account_entitlements (user_id, feature, expires_at, source, created_at, updated_at) VALUES (?,?,?,?,?,?)'
  ).run('u-old', 'nofog', 0, 'purchase', t, t);
  const e = sqlite.prepare('SELECT * FROM account_entitlements WHERE user_id = ?').get('u-old');
  S.ok(!!e && Number(e.expires_at) === 0, 'ghi được quyền vào bảng mới');
}

S.section('Phát hiện file migration đã chạy bị SỬA (checksum đổi)');

{
  const sqlite = fresh();
  sqlite.exec(readFileSync(join(ROOT, 'db/schema.sql'), 'utf8'));
  runMigrations(sqlite);

  // Giả lập: file đã chạy nhưng nội dung khác với checksum đã ghi.
  sqlite.prepare('UPDATE schema_migrations SET checksum = ? WHERE id = ?')
    .run('0'.repeat(64), '0001-account-model');

  const r = runMigrations(sqlite);
  S.ok(r.errors.length > 0, 'checksum lệch -> BÁO LỖI, không im lặng',
    r.errors[0] ? r.errors[0].slice(0, 80) : 'không có lỗi');
  S.ok(r.changed.includes('0001-account-model'), 'đánh dấu đúng migration bị đổi');
}

S.section('status()');

{
  const sqlite = fresh();
  sqlite.exec(readFileSync(join(ROOT, 'db/schema.sql'), 'utf8'));

  let st = status(sqlite);
  S.ok(st.every((s) => s.state === 'pending'), 'CSDL mới: mọi migration pending');

  runMigrations(sqlite);
  st = status(sqlite);
  S.ok(st.every((s) => s.state === 'applied'), 'sau migrate: mọi migration applied');
  S.ok(st.every((s) => s.appliedAt > 0), 'có mốc thời gian áp dụng');
}

S.section('baseline() — nhận CSDL production đã có sẵn');

{
  const sqlite = fresh();
  // Giả lập production: schema đầy đủ đã có, KHÔNG có bảng theo dõi.
  sqlite.exec(readFileSync(join(ROOT, 'db/schema.sql'), 'utf8'));
  sqlite.exec(readFileSync(join(ROOT, 'db/migrations/0001-account-model.sql'), 'utf8'));
  sqlite.exec(readFileSync(join(ROOT, 'db/migrations/0002-grant-ledger.sql'), 'utf8'));
  sqlite.exec(readFileSync(join(ROOT, 'db/migrations/0003-payment-inbox.sql'), 'utf8'));

  const n = baseline(sqlite);
  S.ok(n >= 3, 'baseline ghi nhận toàn bộ migration', `${n}`);

  const r = runMigrations(sqlite);
  S.ok(r.applied.length === 0, 'sau baseline: không chạy lại gì');
  S.ok(r.errors.length === 0, 'sau baseline: không lỗi');
}

S.section('Dừng đúng chỗ khi một migration lỗi');

{
  const sqlite = fresh();
  const bad = new DatabaseSync(':memory:');
  void bad;

  /*
   * Chạy trên CSDL mà bảng `payment_inbox` đã tồn tại với schema KHÁC khiến
   * chỉ mục UNIQUE không tạo được -> phải dừng và báo, không chạy tiếp.
   */
  sqlite.exec(readFileSync(join(ROOT, 'db/schema.sql'), 'utf8'));
  sqlite.exec('CREATE TABLE payment_inbox (id TEXT PRIMARY KEY);');
  sqlite.exec('CREATE UNIQUE INDEX ux_payment_inbox_txn ON payment_inbox(id);');

  const r = runMigrations(sqlite);
  S.ok(r.errors.length > 0, 'migration lỗi -> dừng và báo', r.errors[0]?.slice(0, 90) || '');
  S.ok(!r.applied.includes('0003-payment-inbox'),
    'migration lỗi KHÔNG được đánh dấu đã chạy');
}

process.exit(S.summary() ? 0 : 1);
