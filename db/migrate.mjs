/**
 * migrate.mjs — Migration runner có đánh số, checksum và bảng theo dõi.
 *
 * ============================================================================
 * F08 — VÌ SAO PHẢI CÓ
 *
 * Bản cũ chỉ có `npm run db:migrate` = chạy `db/schema.sql` bằng
 * `wrangler d1 execute --remote`. Vấn đề:
 *
 *   1. `schema.sql` được sinh từ production và DÙNG `CREATE TABLE` KHÔNG có
 *      `IF NOT EXISTS`. Chạy lại trên CSDL đã có dữ liệu là lỗi ngay.
 *   2. Nó KHÔNG chứa hai bảng của mô hình mới (`account_entitlements`,
 *      `trial_accounts`) — dựng môi trường mới ra CSDL thiếu bảng.
 *   3. Không có bảng `schema_migrations` nên KHÔNG biết CSDL đang ở phiên
 *      bản nào, không biết migration nào đã chạy, không rollback được.
 *   4. Không có checksum nên sửa một file migration đã chạy sẽ âm thầm
 *      không có tác dụng (hoặc tệ hơn: hai môi trường lệch nhau).
 *
 * Runner này giải quyết cả bốn:
 *   - Mỗi migration là một file trong `db/migrations/`, đặt tên `NNNN-ten.sql`.
 *   - Bảng `schema_migrations` ghi id, checksum SHA-256, thời điểm chạy.
 *   - Chạy theo thứ tự, trong MỘT transaction cho mỗi file.
 *   - File đã chạy mà checksum đổi -> DỪNG và báo lỗi (không đoán).
 *   - `--check` chỉ kiểm tra trạng thái, không ghi gì.
 *
 * Dùng:
 *   node db/migrate.mjs                 # chạy migration còn thiếu trên D1 local
 *   node db/migrate.mjs --check         # chỉ xem trạng thái
 *   node db/migrate.mjs --sqlite <path> # chạy trên file SQLite (kiểm thử)
 *   node db/migrate.mjs --baseline      # ghi nhận CSDL đã có sẵn là "đã chạy hết"
 * ============================================================================
 */
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(HERE, 'migrations');

/** Danh sách migration theo thứ tự tên file. */
export function listMigrations() {
  let files;
  try {
    files = readdirSync(MIGRATIONS_DIR);
  } catch {
    return [];
  }
  return files
    .filter((f) => /^\d{4}-.+\.sql$/.test(f))
    .sort()
    .map((f) => {
      const path = join(MIGRATIONS_DIR, f);
      const sql = readFileSync(path, 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      return {
        id: f.replace(/\.sql$/, ''),
        file: f,
        path,
        sql,
        checksum,
      };
    });
}

const SCHEMA_MIGRATIONS_DDL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  id          TEXT PRIMARY KEY,
  checksum    TEXT NOT NULL,
  applied_at  INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL DEFAULT 0
);
`;

function ensureTable(sqlite) {
  sqlite.exec(SCHEMA_MIGRATIONS_DDL);
}

function appliedMap(sqlite) {
  ensureTable(sqlite);
  const rows = sqlite.prepare('SELECT id, checksum, applied_at FROM schema_migrations').all();
  const m = new Map();
  for (const r of rows) m.set(String(r.id), r);
  return m;
}

/**
 * Chạy migration trên một DatabaseSync (hoặc bất cứ thứ gì có exec/prepare).
 *
 * @returns {{applied:string[], skipped:string[], changed:string[], errors:string[]}}
 */
export function runMigrations(sqlite, { dryRun = false, log = () => {} } = {}) {
  const out = { applied: [], skipped: [], changed: [], errors: [] };
  const migrations = listMigrations();
  if (!migrations.length) {
    out.errors.push(`Không tìm thấy migration nào trong ${MIGRATIONS_DIR}`);
    return out;
  }

  const done = appliedMap(sqlite);

  for (const m of migrations) {
    const prev = done.get(m.id);
    if (prev) {
      if (String(prev.checksum) !== m.checksum) {
        /*
         * Đã chạy nhưng nội dung file đổi -> PHẢI dừng. Nếu bỏ qua im lặng,
         * hai môi trường sẽ có schema khác nhau mà không ai biết.
         */
        out.changed.push(m.id);
        out.errors.push(
          `Migration "${m.id}" đã chạy nhưng checksum đã đổi `
          + `(${String(prev.checksum).slice(0, 12)}… -> ${m.checksum.slice(0, 12)}…). `
          + 'Tạo migration MỚI thay vì sửa file đã chạy.',
        );
        continue;
      }
      out.skipped.push(m.id);
      log(`  · ${m.id} (đã chạy)`);
      continue;
    }

    if (dryRun) {
      out.applied.push(m.id);
      log(`  + ${m.id} (sẽ chạy)`);
      continue;
    }

    const t0 = Date.now();
    sqlite.exec('BEGIN IMMEDIATE');
    try {
      sqlite.exec(m.sql);
      sqlite.prepare(
        'INSERT INTO schema_migrations (id, checksum, applied_at, duration_ms) VALUES (?,?,?,?)'
      ).run(m.id, m.checksum, Date.now(), Date.now() - t0);
      sqlite.exec('COMMIT');
      out.applied.push(m.id);
      log(`  ✓ ${m.id} (${Date.now() - t0}ms)`);
    } catch (e) {
      try { sqlite.exec('ROLLBACK'); } catch { /* đã rollback */ }
      out.errors.push(`${m.id}: ${e && e.message ? e.message : e}`);
      log(`  ✗ ${m.id}: ${e && e.message}`);
      // Dừng ngay: migration sau có thể phụ thuộc migration trước.
      break;
    }
  }

  return out;
}

/**
 * Đánh dấu TOÀN BỘ migration hiện có là "đã chạy" (baseline).
 *
 * Dùng MỘT LẦN cho một CSDL đã tồn tại từ trước (production hiện tại), sau khi
 * đã xác nhận schema thật khớp với các file migration. Không dùng cho CSDL mới.
 */
export function baseline(sqlite, { log = () => {} } = {}) {
  ensureTable(sqlite);
  const migrations = listMigrations();
  const now = Date.now();
  let n = 0;
  for (const m of migrations) {
    const r = sqlite.prepare(
      'INSERT INTO schema_migrations (id, checksum, applied_at, duration_ms) VALUES (?,?,?,0) ON CONFLICT(id) DO NOTHING'
    ).run(m.id, m.checksum, now);
    if (r.changes) { n++; log(`  = ${m.id}`); }
  }
  return n;
}

/** Trạng thái: migration nào đã chạy, còn thiếu, bị đổi. */
export function status(sqlite) {
  const migrations = listMigrations();
  const done = appliedMap(sqlite);
  return migrations.map((m) => {
    const prev = done.get(m.id);
    let state = 'pending';
    if (prev) state = String(prev.checksum) === m.checksum ? 'applied' : 'changed';
    return { id: m.id, state, appliedAt: prev ? Number(prev.applied_at) : null };
  });
}

/* ------------------------------------------------------------------ */
/* CLI                                                                 */
/* ------------------------------------------------------------------ */

function main() {
  const argv = process.argv.slice(2);
  const checkOnly = argv.includes('--check');
  const doBaseline = argv.includes('--baseline');
  const dbIdx = argv.indexOf('--sqlite');

  if (dbIdx >= 0 && !argv[dbIdx + 1]) {
    console.error('Thiếu đường dẫn sau --sqlite');
    process.exit(1);
  }

  if (dbIdx < 0) {
    console.log(
      'Runner này thao tác trực tiếp trên SQLite.\n'
      + 'Với D1 local:  npx wrangler d1 execute muabankey-db --local --file=<file>\n'
      + 'Với D1 remote: npx wrangler d1 execute muabankey-db --remote --file=<file>\n'
      + '\nDùng --sqlite <path> để chạy trên một file cụ thể (kiểm thử).',
    );
    process.exit(0);
  }

  const sqlite = new DatabaseSync(argv[dbIdx + 1]);

  if (checkOnly) {
    console.log('Trạng thái migration:');
    for (const s of status(sqlite)) {
      const mark = s.state === 'applied' ? '✓' : s.state === 'changed' ? '!' : '·';
      console.log(`  ${mark} ${s.id.padEnd(34)} ${s.state}`);
    }
    process.exit(0);
  }

  if (doBaseline) {
    console.log('Baseline — ghi nhận migration hiện có là đã chạy:');
    const n = baseline(sqlite, { log: console.log });
    console.log(`Đã ghi ${n} dòng.`);
    process.exit(0);
  }

  console.log('Chạy migration:');
  const r = runMigrations(sqlite, { log: console.log });
  console.log(`\nKết quả: ${r.applied.length} mới, ${r.skipped.length} bỏ qua, ${r.errors.length} lỗi`);
  if (r.errors.length) {
    for (const e of r.errors) console.error(`  ✗ ${e}`);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`) {
  main();
}
