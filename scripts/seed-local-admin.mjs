/**
 * Tạo (hoặc đặt lại) một tài khoản admin trên D1 LOCAL với mật khẩu đã biết.
 *
 * Dùng đúng định dạng hash của src/lib/crypto.js: PBKDF2-SHA256, 100.000 vòng,
 * khoá 256-bit, base64 — nên verifyPassword() của app chấp nhận.
 *
 * Chỉ dành cho test local. KHÔNG chạy với --remote.
 *
 * Chạy: node scripts/seed-local-admin.mjs [username] [password]
 */
import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { sql } from './_d1local.mjs';

const username = process.argv[2] || 'testadmin';
const password = process.argv[3] || 'TestAdmin123456';
const ITER = 100000;

const salt = randomBytes(16);
const bits = pbkdf2Sync(password, salt, ITER, 32, 'sha256');
const saltB64 = salt.toString('base64');
const hashB64 = bits.toString('base64');

const now = Date.now();
const email = `${username}@local`;
const id = `u-${username}`;

// Xoá bản cũ nếu có rồi tạo mới (tránh UNIQUE email)
sql(`DELETE FROM users WHERE username = '${username}' OR email = '${email}';`);
sql(`
INSERT INTO users (id, email, username, password_hash, password_salt, full_name,
                   role, status, balance, created_at, updated_at)
VALUES ('${id}', '${email}', '${username}', '${hashB64}', '${saltB64}',
        'Test Admin', 'admin', 'active', 0, ${now}, ${now});
`);

const row = sql(`SELECT id, email, username, role FROM users WHERE id='${id}'`)[0];
if (!row) {
  console.error('❌ tạo admin thất bại');
  process.exit(1);
}
console.log(`✅ admin local: ${row.username} / ${password}  (id=${row.id}, role=${row.role})`);
