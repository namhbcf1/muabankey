/**
 * qa-guard.mjs — CHẶN KIỂM THỬ GHI VÀO PRODUCTION.
 *
 * ============================================================================
 * F15 — VÌ SAO PHẢI CÓ FILE NÀY
 *
 * `qa/q.mjs` hardcode:
 *     export const D = '81f478c9-...';        // D1 PRODUCTION
 *     export const BASE = 'https://xienhl.com'; // DOMAIN PRODUCTION
 *
 * và `qa/lib.mjs` lấy `WEBHOOK_SECRET` thật rồi tạo user / tạo đơn / gửi
 * webhook. Nghĩa là CHẠY BẤT KỲ SCRIPT QA NÀO = ghi thẳng vào cơ sở dữ liệu
 * thật và có thể đẩy đơn ảo vào sổ tiền thật.
 *
 * Đã xảy ra thật (ghi trong qa/results-G.json): một webhook tự ký đã giao
 * license VĨNH VIỄN cho đơn 1.290.000đ trong khi tài khoản ngân hàng không
 * nhận được đồng nào.
 *
 * ============================================================================
 * QUY TẮC
 *
 *   1. KHÔNG có hằng số production nào trong mã QA.
 *   2. Target PHẢI đến từ biến môi trường (`QA_BASE`, `QA_D1_DATABASE_ID`).
 *   3. Mọi script có GHI (POST/PATCH/DELETE, SQL không phải SELECT) phải:
 *        - khai báo `writes: true` khi gọi assertTarget(),
 *        - trỏ tới một target KHÔNG nằm trong danh sách production.
 *   4. Nếu thiếu biến môi trường -> DỪNG, không đoán.
 *
 * Cách dùng trong script QA:
 *
 *     import { target, assertWritable } from './qa-guard.mjs';
 *     const t = target();                  // đọc env, kiểm tra, ném nếu sai
 *     assertWritable(t, { writes: true }); // chặn nếu là production
 * ============================================================================
 */

/** Host được coi là PRODUCTION — tuyệt đối không ghi. */
export const PRODUCTION_HOSTS = [
  'xienhl.com',
  'www.xienhl.com',
];

/** D1 database id của production — tuyệt đối không ghi. */
export const PRODUCTION_D1_IDS = [
  '81f478c9-5627-458a-a35f-d483e69d400b',
];

/** Dấu hiệu một host là môi trường local/staging hợp lệ để ghi. */
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '0.0.0.0', '[::1]'];
const STAGING_HINTS = ['staging', 'stage', 'test', 'dev', 'preview', 'sandbox'];

export class QAGuardError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = 'QAGuardError';
  }
}

/**
 * Đọc target từ biến môi trường. NÉM LỖI nếu thiếu.
 *
 * @returns {{base:string, d1Id:string|null, env:string, isProduction:boolean}}
 */
export function target(env = process.env) {
  const base = String(env.QA_BASE || '').trim();
  if (!base) {
    throw new QAGuardError(
      'QA_BASE_REQUIRED',
      'Thiếu QA_BASE. Kiểm thử KHÔNG còn mặc định trỏ về production.\n'
      + 'Ví dụ: QA_BASE=http://127.0.0.1:8787 node qa/e2e.mjs',
    );
  }

  let url;
  try {
    url = new URL(base);
  } catch {
    throw new QAGuardError('QA_BASE_INVALID', `QA_BASE không phải URL hợp lệ: ${base}`);
  }

  const host = url.hostname.toLowerCase();
  const d1Id = String(env.QA_D1_DATABASE_ID || '').trim() || null;

  const isProdHost = PRODUCTION_HOSTS.includes(host);
  const isProdDb = d1Id ? PRODUCTION_D1_IDS.includes(d1Id) : false;

  return {
    base: base.replace(/\/+$/, ''),
    d1Id,
    env: String(env.QA_ENV || (isProdHost || isProdDb ? 'production' : 'local')),
    isProduction: isProdHost || isProdDb,
  };
}

/**
 * Chặn thao tác GHI vào production.
 *
 * @param {object} t   kết quả của target()
 * @param {object} [opts]
 * @param {boolean} [opts.writes=false] script này có ghi dữ liệu không
 * @param {string}  [opts.what]         mô tả ngắn để thông báo lỗi rõ
 * @returns {object} t (để dùng tiếp)
 */
export function assertWritable(t, opts = {}) {
  const writes = opts.writes === true;
  const what = opts.what ? ` (${opts.what})` : '';

  /*
   * ĐỌC trên production thì HỢP LỆ: xem sổ tiền, đối soát, kiểm trạng thái
   * không thay đổi gì. Chỉ thao tác GHI mới bị chặn.
   */
  if (!writes) return t;

  if (t.isProduction) {
    throw new QAGuardError(
      'PRODUCTION_TARGET',
      `TỪ CHỐI chạy QA${what}: target là PRODUCTION (${t.base}`
      + `${t.d1Id ? `, D1 ${t.d1Id}` : ''}).\n`
      + 'Kiểm thử có ghi dữ liệu phải chạy trên môi trường riêng.\n'
      + 'Dựng môi trường:  npx wrangler dev   (rồi QA_BASE=http://127.0.0.1:8787)',
    );
  }

  /*
   * Ghi vào một host KHÔNG rõ là local/staging cũng phải xác nhận. Người
   * chạy phải đặt QA_ALLOW_REMOTE_WRITE=1 — một hành động có ý thức, không
   * phải mặc định.
   */
  const host = new URL(t.base).hostname.toLowerCase();
  const isLocal = LOCAL_HOSTS.includes(host) || host.endsWith('.localhost');
  const looksStaging = STAGING_HINTS.some((h) => host.includes(h));

  if (!isLocal && !looksStaging && process.env.QA_ALLOW_REMOTE_WRITE !== '1') {
    throw new QAGuardError(
      'REMOTE_WRITE_NOT_CONFIRMED',
      `TỪ CHỐI ghi${what} vào "${t.base}": host này không phải local/staging.\n`
      + 'Nếu chắc chắn đây là môi trường kiểm thử riêng, đặt QA_ALLOW_REMOTE_WRITE=1.',
    );
  }

  return t;
}

/**
 * Kiểm tra một câu SQL có phải chỉ ĐỌC không.
 *
 * Dùng cho các script chạy SQL trực tiếp: script đọc thì được phép chạy trên
 * mọi target, script ghi thì không.
 */
export function isReadOnlySql(sql) {
  const s = String(sql || '').trim().replace(/^\(+/, '');
  // Bỏ comment đầu câu
  const cleaned = s.replace(/^(--[^\n]*\n|\/\*[\s\S]*?\*\/|\s)+/g, '').trim();
  return /^(SELECT|PRAGMA|EXPLAIN|WITH)\b/i.test(cleaned);
}

/**
 * Chặn nếu script chuẩn bị chạy SQL GHI trên production.
 */
export function assertSqlAllowed(t, sql, what = 'SQL') {
  if (t.isProduction && !isReadOnlySql(sql)) {
    throw new QAGuardError(
      'PRODUCTION_WRITE_SQL',
      `TỪ CHỐI chạy ${what} GHI trên production: ${String(sql).slice(0, 120)}`,
    );
  }
  return t;
}

/**
 * Tạo client D1/HTTP đã qua kiểm tra. Thay cho hằng số hardcode trong q.mjs.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.writes]
 */
export function qaClient(opts = {}) {
  const t = target();
  assertWritable(t, { writes: opts.writes === true, what: opts.what });
  return t;
}

/* ------------------------------------------------------------------ */
/* TÀI KHOẢN ADMIN CHO QA — KHÔNG BAO GIỜ NHÚNG VÀO MÃ NGUỒN          */
/* ------------------------------------------------------------------ */

/**
 * Đọc tài khoản admin QA từ biến môi trường. NÉM LỖI nếu thiếu.
 *
 * VÌ SAO: 15 file QA trong repo đang hardcode
 *     { username: 'namhbcf', password: 'namhbcf123' }
 * và tất cả đều được git theo dõi. Đây là tài khoản admin THẬT của shop:
 * ai có repo là đăng nhập được vào trang quản trị, sửa giá, cấp quyền,
 * xem toàn bộ đơn hàng.
 *
 * @returns {{username:string, password:string}}
 */
export function adminCredentials(env = process.env) {
  const username = String(env.QA_ADMIN_USER || '').trim();
  const password = String(env.QA_ADMIN_PASSWORD || '').trim();
  if (!username || !password) {
    throw new QAGuardError(
      'QA_ADMIN_CREDENTIALS_REQUIRED',
      'Thiếu QA_ADMIN_USER / QA_ADMIN_PASSWORD.\n' +
      '  Mã QA KHÔNG được nhúng tài khoản admin thật (xem qa/qa-guard.mjs).\n' +
      '  Đặt biến môi trường trước khi chạy, ví dụ:\n' +
      "    $env:QA_ADMIN_USER='...'; $env:QA_ADMIN_PASSWORD='...'",
    );
  }
  return { username, password };
}

/* ------------------------------------------------------------------ */
/* CLI: `node qa/qa-guard.mjs` để xem đang trỏ vào đâu                 */
/* ------------------------------------------------------------------ */

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`) {
  try {
    const t = target();
    console.log('QA target:');
    console.log(`  base      : ${t.base}`);
    console.log(`  D1        : ${t.d1Id || '(không đặt)'}`);
    console.log(`  env       : ${t.env}`);
    console.log(`  production: ${t.isProduction ? 'CÓ — chỉ được ĐỌC' : 'không'}`);
    if (t.isProduction) {
      console.log('\nCẢNH BÁO: script có GHI sẽ bị chặn trên target này.');
      process.exit(2);
    }
  } catch (e) {
    console.error(`✗ ${e.code || 'ERROR'}: ${e.message}`);
    process.exit(1);
  }
}
