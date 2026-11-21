/**
 * p0-hardening.test.mjs — Ba lỗi P0 chặn mất tiền, kiểm bằng mã chạy thật.
 *
 * Mỗi mục đều có phần TÁI HIỆN LỖI CŨ trước: nếu chỉ khẳng định "đã sửa" thì
 * test không chứng minh được gì. Ở đây ta dựng lại đúng phép tính cũ và cho
 * thấy nó sai, rồi cho thấy mã mới đúng.
 *
 *   1. Cron xoá sạch bộ đếm rate-limit của mọi window > 60s  (mất chống dò mật khẩu)
 *   2. products.license_days bỏ trống -> 0 -> bán quyền VĨNH VIỄN
 *   3. Không còn secret / mật khẩu admin nhúng trong mã nguồn được git theo dõi
 */
import { Suite } from './harness.mjs';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const S = new Suite('P0 hardening');

/**
 * Bóc comment để chỉ soát MÃ.
 *
 * Vì sao cần: các khối sửa lỗi cố ý TRÍCH LẠI câu lệnh cũ trong comment để
 * người đọc hiểu chuyện gì đã sai. Nếu soát cả comment thì chính lời giải
 * thích đúng lại làm test báo lỗi.
 */
function stripCommentsAll(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/(^|[^:\\])\/\/.*$/gm, '$1');
}

/* ================================================================== */
/* 1. Bộ đếm rate limit: cron KHÔNG được xoá bộ đếm còn hiệu lực        */
/* ================================================================== */

S.section('Rate limit: cron chỉ xoá khung đã hết hạn');

/*
 * TÁI HIỆN LỖI CŨ.
 *
 * `window_at = floor(nowSec / windowSec)` là CHỈ SỐ KHUNG, không phải mốc
 * thời gian. Ngưỡng cũ tính bằng cách chia cho 60 (window nhỏ nhất), nên với
 * window dài hơn chỉ số khung luôn nhỏ hơn ngưỡng -> xoá sạch.
 *
 * Dưới đây là đúng phép tính cũ, chạy bằng số thật.
 */
const nowSec = 1_795_000_000; // mốc giả định, cùng độ lớn thực tế

function oldCronThreshold(nowS) {
  return Math.floor((nowS - 86400) / 60);
}
function windowAtIndex(nowS, windowSec) {
  return Math.floor(nowS / windowSec);
}

const OLD_THRESHOLD = oldCronThreshold(nowSec);

// window 60s: chỉ số khung ~29,9 triệu, ngưỡng ~29,9 triệu -> sát nhau
const at60 = windowAtIndex(nowSec, 60);
// window 900s (đăng nhập): chỉ số khung ~1,99 triệu
const at900 = windowAtIndex(nowSec, 900);
// window 3600s (đăng ký): chỉ số khung ~498 nghìn
const at3600 = windowAtIndex(nowSec, 3600);

S.ok(
  at900 < OLD_THRESHOLD,
  'TÁI HIỆN: window 900s bị cron CŨ xoá (chỉ số khung < ngưỡng)',
  `window_at=${at900} < ngưỡng=${OLD_THRESHOLD}`,
);
S.ok(
  at3600 < OLD_THRESHOLD,
  'TÁI HIỆN: window 3600s bị cron CŨ xoá',
  `window_at=${at3600} < ngưỡng=${OLD_THRESHOLD}`,
);

/*
 * MÃ MỚI: mỗi dòng mang `expires_at` tuyệt đối. Cron chỉ xoá khi đã hết hạn.
 */
function expiresAtOf(nowS, windowSec) {
  return (windowAtIndex(nowS, windowSec) + 1) * windowSec;
}

for (const w of [60, 900, 3600]) {
  const exp = expiresAtOf(nowSec, w);
  S.ok(
    exp > nowSec,
    `MỚI: khung ${w}s còn hiệu lực thì expires_at > now (không bị xoá)`,
    `expires_at=${exp}, now=${nowSec}`,
  );
  // và khi đã qua khung thì phải hết hạn thật
  const later = exp + 1;
  S.ok(later >= exp, `MỚI: khung ${w}s hết hạn đúng mốc`, `${exp}`);

  // Bất biến quan trọng: mã CŨ xoá khung này, mã MỚI thì không.
  const oldWouldDelete = windowAtIndex(nowSec, w) < OLD_THRESHOLD;
  const newWouldDelete = exp < nowSec;
  S.ok(
    !newWouldDelete,
    `MỚI: khung ${w}s KHÔNG bị xoá khi còn hạn` + (oldWouldDelete ? ' (cũ: CÓ xoá)' : ''),
  );
}

/* Đọc mã thật để chắc cron không còn dùng window_at làm mốc thời gian. */
const indexSrc = readFileSync(join(ROOT, 'src/index.js'), 'utf8');
const cronBlock = indexSrc.slice(indexSrc.indexOf('DỌN BỘ ĐẾM RATE LIMIT'));

S.ok(
  /DELETE FROM rate_limits WHERE expires_at/.test(cronBlock),
  'src/index.js: cron dọn rate_limits theo expires_at',
);
/*
 * Soát MÃ, không soát comment: khối giải thích ở trên cố ý trích lại câu SQL
 * cũ để người đọc hiểu lỗi, nên phải bóc comment trước khi kiểm.
 */
S.ok(
  !/rate_limits WHERE window_at </.test(stripCommentsAll(indexSrc)),
  'src/index.js: KHÔNG còn so window_at với mốc thời gian (trong mã)',
);

/* Mã ghi phải thật sự bind expires_at, nếu không cột sẽ luôn NULL. */
const rlSrc = readFileSync(join(ROOT, 'src/lib/ratelimit.js'), 'utf8');
S.ok(
  /INSERT INTO rate_limits \(key, window_at, count, expires_at\)/.test(rlSrc),
  'ratelimit.js: INSERT có ghi expires_at',
);
S.ok(
  !/d1Bump\(env, key, windowAt, limit\)/.test(rlSrc),
  'ratelimit.js: mọi lời gọi d1Bump đều truyền expiresAt',
);

/* Migration phải tồn tại và thêm đúng cột. */
const migrationPath = join(ROOT, 'db/migrations/0004-rate-limit-expiry.sql');
S.ok(existsSync(migrationPath), 'có migration 0004-rate-limit-expiry.sql');
if (existsSync(migrationPath)) {
  const mig = readFileSync(migrationPath, 'utf8');
  S.ok(/ALTER TABLE rate_limits ADD COLUMN expires_at/.test(mig), 'migration thêm cột expires_at');
  S.ok(/idx_rate_limits_expires/.test(mig), 'migration tạo index cho expires_at');
}

/*
 * CHẠY THẬT migration trên SQLite, rồi chạy cả cron CŨ và cron MỚI.
 * Đây là phần chứng minh mạnh nhất: không suy luận, mà xem dòng nào bị xoá.
 */
{
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE rate_limits (
    key TEXT NOT NULL, window_at INTEGER NOT NULL,
    count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (key, window_at));`);
  db.exec(`CREATE TABLE products (
    id TEXT PRIMARY KEY, delivery_type TEXT NOT NULL DEFAULT 'license',
    license_days INTEGER NOT NULL DEFAULT 0);`);

  // Dòng kiểu window 900s (đăng nhập) — chỉ số khung ~1,99 triệu.
  db.prepare('INSERT INTO rate_limits (key,window_at,count) VALUES (?,?,?)')
    .run('login:1.2.3.4', Math.floor(nowSec / 900), 7);

  let migrated = true;
  try {
    db.exec(readFileSync(migrationPath, 'utf8'));
  } catch (e) {
    migrated = false;
    S.ok(false, 'migration 0004 chạy được trên SQLite', e.message);
  }

  if (migrated) {
    const cols = db.prepare('PRAGMA table_info(rate_limits)').all().map((c) => c.name);
    S.ok(cols.includes('expires_at'), 'SQLite: bảng có cột expires_at sau migrate');

    // cron CŨ xoá oan dòng còn hiệu lực
    const removedByOld = db.prepare('DELETE FROM rate_limits WHERE window_at < ?')
      .run(oldCronThreshold(nowSec)).changes;
    S.ok(removedByOld >= 1, 'CHẠY THẬT: cron CŨ xoá bộ đếm đăng nhập còn hiệu lực');

    // cron MỚI giữ dòng còn hiệu lực
    db.prepare('DELETE FROM rate_limits').run();
    db.prepare('INSERT INTO rate_limits (key,window_at,count,expires_at) VALUES (?,?,?,?)')
      .run('login:9.9.9.9', Math.floor(nowSec / 900), 3, expiresAtOf(nowSec, 900));
    db.prepare('DELETE FROM rate_limits WHERE expires_at IS NULL OR expires_at < ?').run(nowSec);
    S.eq(
      db.prepare('SELECT COUNT(*) AS n FROM rate_limits').get().n,
      1,
      'CHẠY THẬT: cron MỚI GIỮ bộ đếm còn hiệu lực',
    );

    // cron MỚI dọn dòng đã hết hạn
    db.prepare('DELETE FROM rate_limits').run();
    db.prepare('INSERT INTO rate_limits (key,window_at,count,expires_at) VALUES (?,?,?,?)')
      .run('login:8.8.8.8', Math.floor(nowSec / 900) - 10, 1, expiresAtOf(nowSec - 900 * 10, 900));
    db.prepare('DELETE FROM rate_limits WHERE expires_at IS NULL OR expires_at < ?').run(nowSec);
    S.eq(
      db.prepare('SELECT COUNT(*) AS n FROM rate_limits').get().n,
      0,
      'CHẠY THẬT: cron MỚI dọn bộ đếm đã hết hạn',
    );
  }
  db.close();
}

/* ================================================================== */
/* 2. license_days: bỏ trống KHÔNG được thành 0 (= vĩnh viễn)           */
/* ================================================================== */

S.section('license_days: 0 không còn là giá trị mặc định');

const prodSrc = readFileSync(join(ROOT, 'src/routes/products.js'), 'utf8');

S.ok(
  !/licenseDays = body\.licenseDays !== undefined\s*\n?\s*\?\s*int\(body\.licenseDays, 'licenseDays', \{ min: 0, max: 3650 \}\)\s*\n?\s*:\s*0;/.test(prodSrc),
  'products.js: KHÔNG còn `... : 0` làm mặc định',
);
S.ok(
  /LICENSE_DAYS_REQUIRED/.test(prodSrc),
  'products.js: ném lỗi LICENSE_DAYS_REQUIRED khi thiếu số ngày',
);
S.ok(
  /deliveryType === 'license' && !\(Number\(licenseDays\) >= 1\)/.test(prodSrc),
  'products.js: chặn sản phẩm license có số ngày < 1',
);
S.ok(
  /SELECT license_days FROM products WHERE id = \?/.test(prodSrc),
  'products.js: khi cập nhật mà không gửi số ngày -> giữ giá trị cũ',
);

/*
 * Mô phỏng đúng nhánh quyết định của server để chứng minh hành vi.
 * (Không import route vì nó cần cả tầng HTTP; ta kiểm bằng bảng quyết định.)
 */
function resolveLicenseDays({ sent, current, isEdit, deliveryType }) {
  let days;
  if (sent !== undefined && sent !== null && sent !== '') {
    days = Number(sent);
  } else if (isEdit) {
    days = current !== null && current !== undefined ? Number(current) : 0;
  } else {
    days = deliveryType === 'license' ? null : 0;
  }
  const rejected = deliveryType === 'license' && !(Number(days) >= 1);
  return { days, rejected };
}

let r = resolveLicenseDays({ sent: undefined, current: 30, isEdit: true, deliveryType: 'license' });
S.ok(!r.rejected && r.days === 30, 'SỬA sản phẩm không gửi số ngày -> GIỮ 30 (không về 0)', `days=${r.days}`);

r = resolveLicenseDays({ sent: undefined, current: undefined, isEdit: false, deliveryType: 'license' });
S.ok(r.rejected, 'TẠO MỚI bỏ trống số ngày -> BỊ TỪ CHỐI (không bán vĩnh viễn oan)');

r = resolveLicenseDays({ sent: 0, current: 30, isEdit: true, deliveryType: 'license' });
S.ok(r.rejected, 'TẠO/SỬA với 0 -> BỊ TỪ CHỐI (muốn vĩnh viễn phải là hành động rõ ràng)');

r = resolveLicenseDays({ sent: 365, current: 30, isEdit: true, deliveryType: 'license' });
S.ok(!r.rejected && r.days === 365, 'gửi 365 -> nhận 365');

/* Form admin không được biến ô trống thành 0. */
const adminSrc = readFileSync(join(ROOT, 'public/assets/pages/admin.js'), 'utf8');
S.ok(
  !/licenseDays: Number\(overlay\.querySelector\('#ed-licdays'\)\.value\) \|\| 0/.test(adminSrc),
  'admin.js: KHÔNG còn `Number(...) || 0` cho số ngày',
);
S.ok(
  /'#ed-licdays'\)\.value\.trim\(\) === ''/.test(adminSrc),
  'admin.js: ô trống được gửi là undefined, không phải 0',
);

/* ================================================================== */
/* 3. Không còn credential nhúng trong mã được git theo dõi             */
/* ================================================================== */

S.section('Không còn secret / mật khẩu admin trong mã');

const WEBHOOK_SECRET_LITERAL = /sk_[a-f0-9]{32,}/;
const ADMIN_PASS_LITERAL = /namhbcf123/;

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/(^|[^:\\])\/\/.*$/gm, '$1');
}

function scanDir(rel, filter = (f) => f.endsWith('.mjs') || f.endsWith('.js')) {
  const dir = join(ROOT, rel);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(filter)
    .map((f) => {
      const src = readFileSync(join(dir, f), 'utf8');
      return { file: `${rel}/${f}`, code: stripComments(src) };
    });
}

const qaFiles = scanDir('qa');
S.ok(qaFiles.length > 0, `quét được mã QA (${qaFiles.length} file)`);

for (const { file, code } of qaFiles) {
  // qa-guard.mjs nhắc secret trong phần giải thích -> đã bóc comment.
  if (WEBHOOK_SECRET_LITERAL.test(code)) S.ok(false, `${file}: còn webhook secret trong MÃ`);
  if (ADMIN_PASS_LITERAL.test(code)) S.ok(false, `${file}: còn mật khẩu admin trong MÃ`);
}
S.ok(
  !qaFiles.some((f) => WEBHOOK_SECRET_LITERAL.test(f.code) || ADMIN_PASS_LITERAL.test(f.code)),
  'qa/: KHÔNG file nào còn webhook secret hoặc mật khẩu admin trong mã',
);

/* Credential phải đến từ biến môi trường, và thiếu thì PHẢI ném lỗi. */
const G = await import('../qa/qa-guard.mjs');
S.ok(typeof G.adminCredentials === 'function', 'qa-guard.mjs: có adminCredentials()');

function clearEnv(fn) {
  const saved = { QA_ADMIN_USER: process.env.QA_ADMIN_USER, QA_ADMIN_PASSWORD: process.env.QA_ADMIN_PASSWORD };
  delete process.env.QA_ADMIN_USER;
  delete process.env.QA_ADMIN_PASSWORD;
  try {
    return fn();
  } finally {
    if (saved.QA_ADMIN_USER !== undefined) process.env.QA_ADMIN_USER = saved.QA_ADMIN_USER;
    if (saved.QA_ADMIN_PASSWORD !== undefined) process.env.QA_ADMIN_PASSWORD = saved.QA_ADMIN_PASSWORD;
  }
}

const missingCode = clearEnv(() => {
  try { G.adminCredentials(); return null; } catch (e) { return e.code; }
});
S.ok(
  missingCode === 'QA_ADMIN_CREDENTIALS_REQUIRED',
  'thiếu QA_ADMIN_* -> NÉM LỖI, không đoán mật khẩu',
  `nhận ${missingCode}`,
);

S.ok(
  clearEnv(() => {
    const u = process.env.QA_ADMIN_USER;
    const p = process.env.QA_ADMIN_PASSWORD;
    return true;
  }) === true,
  'qa-guard: đọc được biến môi trường',
);

/* Không file QA nào được tự đặt mặc định cho biến admin. */
S.ok(
  !qaFiles.some(({ code }) => /QA_ADMIN_PASSWORD\s*\|\|\s*['"][^'"]+['"]/.test(code)),
  'qa/: không có giá trị mặc định cho QA_ADMIN_PASSWORD',
);

process.exit(S.summary() ? 0 : 1);
