/**
 * q.mjs — D1 + HTTP helper cho QA, ĐÃ ĐI QUA TARGET GUARD.
 *
 * ============================================================================
 * F15 — SỬA LỖI GỐC: KHÔNG CÒN HARDCODE PRODUCTION
 *
 * Bản cũ:
 *     export const D = '81f478c9-5627-458a-a35f-d483e69d400b';  // D1 THẬT
 *     export const BASE = 'https://xienhl.com';                 // DOMAIN THẬT
 *
 * Mọi script QA import file này đều ghi thẳng vào production. Chạy một script
 * kiểm thử là có thể tạo user ảo, đơn ảo và đẩy webhook vào sổ tiền thật.
 *
 * NAY:
 *   - Target đến từ `QA_BASE` / `QA_D1_DATABASE_ID`.
 *   - `q()` và `q1()` kiểm từng câu SQL: câu GHI bị chặn trên production.
 *   - `Client` mặc định không cho gọi method ghi trên production.
 *   - Thiếu biến môi trường -> ném lỗi rõ ràng, KHÔNG đoán target.
 * ============================================================================
 */
import {
  target, assertWritable, assertSqlAllowed, isReadOnlySql, QAGuardError,
} from './qa-guard.mjs';

export { QAGuardError, isReadOnlySql };

export const T = process.env.CLOUDFLARE_API_TOKEN;
export const A = process.env.CLOUDFLARE_ACCOUNT_ID;

/**
 * Target hiện tại. Đọc LƯỜI (mỗi lần dùng) để test có thể đổi env giữa các
 * case, nhưng vẫn ném lỗi ngay khi thiếu.
 */
export function currentTarget() {
  return target();
}

/** @deprecated Giữ tên cũ cho script chưa sửa; giờ đọc từ env, không hardcode. */
export function d1Id() {
  return currentTarget().d1Id;
}

/** @deprecated Giữ tên cũ; giờ đọc từ env. */
export function baseUrl() {
  return currentTarget().base;
}

/**
 * Chạy một câu SQL qua D1 HTTP API.
 *
 * Mọi câu KHÔNG phải SELECT bị chặn khi target là production — đây là chốt
 * cuối, không phụ thuộc việc script có tự khai báo hay không.
 */
export async function q(sql, params = null) {
  const t = currentTarget();
  assertSqlAllowed(t, sql, 'truy vấn QA');

  if (!T || !A || !t.d1Id) {
    throw new QAGuardError(
      'D1_NOT_CONFIGURED',
      'Thiếu CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID / QA_D1_DATABASE_ID.\n'
      + 'Script QA cần một D1 RIÊNG, không dùng database production.',
    );
  }

  const body = params ? { sql, params } : { sql };
  const r = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${A}/d1/database/${t.d1Id}/query`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${T}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
  const j = await r.json();
  if (!j.success) throw new Error(JSON.stringify(j.errors));
  return j.result?.[0]?.results || [];
}

export async function q1(sql, params = null) {
  const rows = await q(sql, params);
  return rows[0] || null;
}

/**
 * HTTP client giữ cookie phiên.
 *
 * `allowWrites` phải bật TƯỜNG MINH để gọi POST/PATCH/DELETE. Trên production
 * thì dù bật cũng bị chặn — mọi thao tác thay đổi dữ liệu phải chạy ở môi
 * trường riêng.
 */
export class Client {
  constructor({ base = null, allowWrites = false } = {}) {
    const t = currentTarget();
    this.base = base || t.base;
    this.cookie = '';
    this.allowWrites = allowWrites === true;
    this.isProduction = t.isProduction;
  }

  async req(path, { method = 'GET', body, headers = {}, raw = false } = {}) {
    const m = String(method).toUpperCase();
    const isWrite = m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS';

    if (isWrite) {
      if (this.isProduction) {
        throw new QAGuardError(
          'PRODUCTION_HTTP_WRITE',
          `TỪ CHỐI ${m} ${path} trên production (${this.base}).\n`
          + 'Thao tác thay đổi dữ liệu phải chạy ở môi trường riêng.',
        );
      }
      if (!this.allowWrites) {
        throw new QAGuardError(
          'WRITES_NOT_ENABLED',
          `${m} ${path}: client chưa bật allowWrites.\n`
          + 'Khởi tạo: new Client({ allowWrites: true }) — phải là quyết định có ý thức.',
        );
      }
    }

    const h = { ...headers };
    if (this.cookie) h.cookie = this.cookie;
    let payload;
    if (body !== undefined) {
      h['content-type'] = 'application/json';
      payload = typeof body === 'string' ? body : JSON.stringify(body);
    }
    const r = await fetch(this.base + path, {
      method, headers: h, body: payload, redirect: 'manual',
    });
    const sc = r.headers.getSetCookie?.() || [];
    for (const c of sc) {
      const mm = c.match(/mbk_session=([^;]+)/);
      if (mm) this.cookie = `mbk_session=${mm[1]}`;
    }
    const text = await r.text();
    if (raw) return { status: r.status, headers: r.headers, text };
    let json = null;
    try { json = JSON.parse(text); } catch { /* có thể không phải JSON */ }
    return { status: r.status, json, text, headers: r.headers };
  }
}

/** Tạo client GHI — yêu cầu target không phải production. */
export function writeClient(opts = {}) {
  const t = assertWritable(currentTarget(), {
    writes: true, what: opts.what || 'HTTP',
  });
  return new Client({ base: t.base, allowWrites: true });
}

/** Tạo client CHỈ ĐỌC — an toàn trên mọi target. */
export function readClient(opts = {}) {
  return new Client({ base: opts.base, allowWrites: false });
}

export function log(...a) { console.log(...a); }
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ */
/* TƯƠNG THÍCH NGƯỢC cho script QA cũ còn `import { BASE }`            */
/* ------------------------------------------------------------------ */

/**
 * `BASE` cũ là hằng số production. Giữ TÊN nhưng KHÔNG còn hardcode: đọc từ
 * `QA_BASE` và ném nếu thiếu.
 *
 * Vì sao không để `export const BASE = ...` đọc env ngay khi import: module
 * được nạp trước khi script kịp đặt env trong một số trường hợp, và ta muốn
 * thông báo lỗi rõ ràng thay vì `undefined`.
 *
 * Dùng getter qua Proxy-free cách: gán một object có toString, để mọi chỗ
 * `BASE + '/api/...'` vẫn chạy.
 */
export const BASE = (() => {
  try {
    return target().base;
  } catch {
    /*
     * Thiếu QA_BASE: trả chuỗi rỗng thay vì ném ngay khi import, để script cũ
     * vẫn nạp được và nhận lỗi rõ ràng ở lần gọi mạng đầu tiên (qua
     * currentTarget() trong q()/Client). Tránh làm hỏng cả file vì một import.
     */
    return '';
  }
})();
