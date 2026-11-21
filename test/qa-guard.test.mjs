/**
 * qa-guard.test.mjs — QA KHÔNG được mặc định ghi vào production.
 *
 * Khoá lỗi P1 F15: qa/q.mjs hardcode D1 production + domain production, và
 * qa/lib.mjs đọc WEBHOOK_SECRET.txt thật để tự ký webhook.
 */
import { Suite } from './harness.mjs';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const S = new Suite('QA target guard');

const G = await import('../qa/qa-guard.mjs');
const {
  target, assertWritable, assertSqlAllowed, isReadOnlySql,
  PRODUCTION_HOSTS, PRODUCTION_D1_IDS, QAGuardError,
} = G;

/** Chạy fn với env tạm. */
function withEnv(vars, fn) {
  const saved = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try { return fn(); } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const CODE = (fn) => {
  try { fn(); return null; } catch (e) { return e.code || String(e); }
};

/** Bóc comment để soát chuỗi trong MÃ, không soát trong lời giải thích. */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:\\])\/\/[^\n]*/g, '$1');
}

/* ================================================================== */
S.section('Thiếu QA_BASE -> DỪNG, không đoán target');

{
  withEnv({ QA_BASE: undefined }, () => {
    S.eq(CODE(() => target()), 'QA_BASE_REQUIRED', 'thiếu QA_BASE -> báo lỗi rõ');
  });
}

S.section('Production phải bị nhận diện ở MỌI dạng');

{
  for (const h of PRODUCTION_HOSTS) {
    withEnv({ QA_BASE: `https://${h}` }, () => {
      const t = target();
      S.ok(t.isProduction === true, `nhận diện production: ${h}`);
    });
  }

  withEnv({ QA_BASE: 'https://xienhl.com/some/path' }, () => {
    S.ok(target().isProduction === true, 'nhận diện cả khi URL có đường dẫn');
  });

  withEnv({ QA_BASE: 'https://XIENHL.COM' }, () => {
    S.ok(target().isProduction === true, 'không phân biệt chữ hoa/thường');
  });
}

S.section('Production bị CHẶN khi ghi');

{
  withEnv({ QA_BASE: 'https://xienhl.com' }, () => {
    S.eq(
      CODE(() => assertWritable(target(), { writes: true })),
      'PRODUCTION_TARGET',
      'ghi vào production -> PRODUCTION_TARGET',
    );
    // Đọc thì vẫn cho phép
    S.ok(assertWritable(target(), { writes: false }) !== null, 'chỉ ĐỌC thì vẫn cho phép');
  });
}

S.section('Production bị chặn qua D1 ID');

{
  withEnv({ QA_BASE: 'http://127.0.0.1:8787', QA_D1_DATABASE_ID: PRODUCTION_D1_IDS[0] }, () => {
    const t = target();
    S.ok(t.isProduction === true, 'D1 production -> coi là production');
    S.eq(
      CODE(() => assertWritable(t, { writes: true })),
      'PRODUCTION_TARGET',
      'ghi vào D1 production -> chặn',
    );
  });
}

S.section('Local/staging được phép ghi');

{
  for (const b of ['http://127.0.0.1:8787', 'http://localhost:8787', 'https://staging.example.com']) {
    withEnv({ QA_BASE: b }, () => {
      const t = target();
      S.ok(t.isProduction === false, `${b} không phải production`);
      S.ok(assertWritable(t, { writes: true }) === t, `${b} cho phép ghi`);
    });
  }
}

S.section('Host lạ: ghi phải xác nhận tường minh');

{
  withEnv({ QA_BASE: 'https://my-own-box.example.net', QA_ALLOW_REMOTE_WRITE: undefined }, () => {
    S.eq(
      CODE(() => assertWritable(target(), { writes: true })),
      'REMOTE_WRITE_NOT_CONFIRMED',
      'host lạ -> phải xác nhận',
    );
  });

  withEnv({ QA_BASE: 'https://my-own-box.example.net', QA_ALLOW_REMOTE_WRITE: '1' }, () => {
    S.ok(assertWritable(target(), { writes: true }) !== null,
      'đã xác nhận QA_ALLOW_REMOTE_WRITE=1 -> cho phép');
  });
}

S.section('SQL: câu GHI bị chặn trên production');

{
  withEnv({ QA_BASE: 'https://xienhl.com' }, () => {
    const t = target();
    for (const sql of [
      'DELETE FROM users',
      'UPDATE orders SET status = "refunded"',
      'INSERT INTO audit_logs (id) VALUES (1)',
      'DROP TABLE orders',
      '  -- comment\n  DELETE FROM orders',
    ]) {
      S.eq(CODE(() => assertSqlAllowed(t, sql)), 'PRODUCTION_WRITE_SQL',
        `chặn: ${sql.slice(0, 34)}`);
    }

    for (const sql of [
      'SELECT 1',
      'select * from orders',
      '  SELECT COUNT(*) FROM users',
      'WITH x AS (SELECT 1) SELECT * FROM x',
      'PRAGMA table_info(users)',
    ]) {
      S.ok(assertSqlAllowed(t, sql) === t, `cho phép đọc: ${sql.slice(0, 30)}`);
    }
  });
}

S.section('isReadOnlySql');

{
  S.ok(isReadOnlySql('SELECT 1') === true, 'SELECT -> đọc');
  S.ok(isReadOnlySql('-- chú thích\nDELETE FROM t') === false, 'DELETE sau comment -> ghi');
  S.ok(isReadOnlySql('/* x */ UPDATE t SET a=1') === false, 'UPDATE sau block comment -> ghi');
  S.ok(isReadOnlySql('WITH a AS (SELECT 1) SELECT * FROM a') === true, 'WITH...SELECT -> đọc');
  S.ok(isReadOnlySql('INSERT INTO t VALUES (1)') === false, 'INSERT -> ghi');
}

S.section('qa/q.mjs không còn hardcode production');

{
  const qSrc = readFileSync(join(ROOT, 'qa/q.mjs'), 'utf8');
  const code = stripComments(qSrc);

  for (const id of PRODUCTION_D1_IDS) {
    S.ok(!code.includes(id), `qa/q.mjs KHÔNG hardcode D1 ${id.slice(0, 8)}…`);
  }
  for (const h of PRODUCTION_HOSTS) {
    S.ok(!code.includes(`'https://${h}'`) && !code.includes(`"https://${h}"`),
      `qa/q.mjs KHÔNG hardcode domain ${h}`);
  }
  /*
   * QA_BASE được đọc trong qa-guard.mjs (module chuyên trách), nên kiểm ở đó.
   */
  const guardSrc = stripComments(readFileSync(join(ROOT, 'qa/qa-guard.mjs'), 'utf8'));
  S.ok(guardSrc.includes('QA_BASE'), 'qa-guard.mjs đọc QA_BASE từ env');
  S.ok(code.includes('currentTarget'), 'qa/q.mjs lấy target qua currentTarget()');
  S.ok(code.includes('assertSqlAllowed'), 'q() kiểm SQL trước khi chạy');
  S.ok(code.includes('PRODUCTION_HTTP_WRITE'), 'Client chặn ghi trên production');
  S.ok(code.includes('allowWrites'), 'Client yêu cầu bật allowWrites tường minh');
}

S.section('qa/lib.mjs không còn đọc secret production');

{
  const libCode = stripComments(readFileSync(join(ROOT, 'qa/lib.mjs'), 'utf8'));
  S.ok(!/readFileSync\(\s*['"]WEBHOOK_SECRET\.txt/.test(libCode),
    'lib.mjs KHÔNG đọc WEBHOOK_SECRET.txt (secret production)');
  S.ok(libCode.includes('QA_WEBHOOK_SECRET'), 'dùng QA_WEBHOOK_SECRET của môi trường test');
  S.ok(libCode.includes('writeClient'), 'các thao tác ghi đi qua writeClient()');
  S.ok(libCode.includes('PRODUCTION_WEBHOOK'), 'hook() chặn trên production');
}

S.section('Script QA cũ import BASE vẫn nạp được (tương thích)');

{
  const qCode = stripComments(readFileSync(join(ROOT, 'qa/q.mjs'), 'utf8'));
  S.ok(/export const BASE/.test(qCode), 'vẫn export BASE để không vỡ script cũ');
  S.ok(!/export const BASE = 'https:\/\//.test(qCode), 'BASE không còn là hằng số cứng');
}

S.section('QAGuardError có mã lỗi');

{
  const e = new QAGuardError('X', 'msg');
  S.ok(e instanceof Error, 'là Error');
  S.ok(e.code === 'X', 'có code');
  S.ok(e.name === 'QAGuardError', 'có name riêng');
}

process.exit(S.summary() ? 0 : 1);
