/**
 * d1.mjs — Mô phỏng D1 bằng `node:sqlite` để chạy thật mã nguồn Worker offline.
 *
 * VÌ SAO CẦN: các lỗi P0 của dự án (cộng dồn dùng thử, mất ngày khi gia hạn
 * đồng thời, hoàn tiền không thu hồi quyền) chỉ lộ ra khi CHẠY mã thật trên
 * một cơ sở dữ liệu thật. Kiểm thử bằng cách đọc code không chứng minh được
 * gì. Harness này cấp cho `src/` một đối tượng `env` có đúng bề mặt D1 mà
 * Worker đang dùng:
 *
 *   env.DB.prepare(sql).bind(...).first()/all()/run()
 *   env.DB.batch([stmt, ...])            -> chạy trong MỘT transaction
 *   env.CACHE.get/put/delete            -> KV trong RAM
 *
 * Không có mạng, không có Cloudflare, không đụng dữ liệu thật.
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(HERE, '..');

/* ------------------------------------------------------------------ */
/* Câu lệnh D1                                                         */
/* ------------------------------------------------------------------ */

class Stmt {
  constructor(db, sql, params = []) {
    this.db = db;
    this.sql = sql;
    this.params = params;
  }

  bind(...params) {
    // D1 cho phép bind nhiều lần; giữ đúng ngữ nghĩa "thay thế toàn bộ".
    return new Stmt(this.db, this.sql, params);
  }

  /** Trả dòng đầu tiên hoặc null. */
  first(colName) {
    const rows = this.db.prepare(this.sql).all(...this.params);
    if (!rows.length) return null;
    const row = plain(rows[0]);
    if (colName) return Object.prototype.hasOwnProperty.call(row, colName) ? row[colName] : null;
    return row;
  }

  /** Trả { results: [...] } giống D1. */
  all() {
    const rows = this.db.prepare(this.sql).all(...this.params);
    return { results: rows.map(plain), success: true, meta: metaOf(rows) };
  }

  /** Trả { success, meta: { changes, last_row_id } } giống D1. */
  run() {
    const st = this.db.prepare(this.sql);
    const r = st.run(...this.params);
    return {
      success: true,
      meta: {
        changes: Number(r.changes || 0),
        last_row_id: Number(r.lastInsertRowid || 0),
      },
      results: [],
    };
  }

  /** Câu lệnh có RETURNING: D1 trả qua .all()/.first(), ở đây y hệt. */
  raw() {
    return this.db.prepare(this.sql).all(...this.params);
  }
}

function metaOf(rows) {
  return { changes: 0, rows_read: rows.length, rows_written: 0 };
}

/** node:sqlite trả object null-prototype; chuyển sang object thường. */
function plain(row) {
  if (row === null || row === undefined) return row;
  const out = {};
  for (const k of Object.keys(row)) out[k] = row[k];
  return out;
}

/* ------------------------------------------------------------------ */
/* DB                                                                  */
/* ------------------------------------------------------------------ */

export class D1 {
  constructor(database) {
    this.db = database;
    this.batchCalls = 0;
  }

  prepare(sql) {
    return new Stmt(this.db, sql, []);
  }

  /**
   * D1 `batch` chạy TẤT CẢ câu lệnh trong MỘT transaction: hoặc cùng xong,
   * hoặc cùng không. Đây là tính chất mã nguồn dựa vào (xem adminRefund và
   * phần cộng tiền + chốt sổ), nên harness phải tái hiện đúng.
   */
  batch(stmts) {
    this.batchCalls += 1;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const out = stmts.map((s) => s.run());
      this.db.exec('COMMIT');
      return Promise.resolve(out);
    } catch (e) {
      try { this.db.exec('ROLLBACK'); } catch { /* đã rollback */ }
      throw e;
    }
  }

  exec(sql) {
    this.db.exec(sql);
  }
}

/* ------------------------------------------------------------------ */
/* KV trong RAM                                                        */
/* ------------------------------------------------------------------ */

export class KV {
  constructor() { this.map = new Map(); }
  async get(k) { return this.map.has(k) ? this.map.get(k) : null; }
  async put(k, v) { this.map.set(k, String(v)); }
  async delete(k) { this.map.delete(k); }
}

/* ------------------------------------------------------------------ */
/* Dựng môi trường                                                     */
/* ------------------------------------------------------------------ */

/**
 * Tạo env sạch, đã nạp schema.
 *
 * @param {object} [opts]
 * @param {string[]} [opts.migrations] đường dẫn tương đối tới ROOT cần chạy thêm
 * @returns {{env: object, db: D1, sqlite: DatabaseSync}}
 */
export function makeEnv(opts = {}) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  const db = new D1(sqlite);

  const schemaPath = join(ROOT, opts.schema || 'db/schema.sql');
  sqlite.exec(readFileSync(schemaPath, 'utf8'));

  for (const m of opts.migrations || []) {
    sqlite.exec(readFileSync(join(ROOT, m), 'utf8'));
  }

  const env = {
    DB: db,
    CACHE: new KV(),
    ENV: 'test',
    SESSION_TTL_DAYS: '30',
  };
  return { env, db, sqlite };
}

/** Chạy nhiều câu SQL (không bind) — dùng để seed dữ liệu kiểm thử. */
export function exec(sqlite, sql) {
  sqlite.exec(sql);
}

export const nowSec = () => Math.floor(Date.now() / 1000);
