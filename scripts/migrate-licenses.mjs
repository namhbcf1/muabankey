/**
 * Chuyển license từ D1 xa_license (cũ) sang muabankey-db (mới).
 * Sinh file SQL để chạy bằng wrangler.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const raw = readFileSync(process.argv[2], 'utf8').replace(/^\uFEFF/, '');
const parsed = JSON.parse(raw);
const rows = parsed[0]?.results || [];

if (!rows.length) {
  console.error('Không có dữ liệu để chuyển');
  process.exit(1);
}

const esc = (v) => {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return String(v);
  return `'${String(v).replace(/'/g, "''")}'`;
};

const values = rows.map((r) => `(
  ${esc(r.key)}, ${esc(r.hwid)}, ${esc(r.plan || 'aoe1')}, ${esc(r.note)},
  ${esc(r.created_at || 0)}, ${esc(r.activated_at)}, ${esc(r.expires_at || 0)},
  ${esc(r.last_seen)}, ${esc(r.last_ip)}, ${esc(r.revoked || 0)},
  ${esc(r.max_rebind ?? 1)}, ${esc(r.rebinds || 0)}
)`).join(',\n');

const sql = `-- Chuyển ${rows.length} license từ xa_license sang muabankey-db
-- Giữ nguyên hwid / activated_at / expires_at / rebinds để khách không bị ảnh hưởng.

DELETE FROM licenses;

INSERT INTO licenses
  (key, hwid, plan, note, created_at, activated_at, expires_at,
   last_seen, last_ip, revoked, max_rebind, rebinds)
VALUES
${values};
`;

writeFileSync(new URL('../db/migrate-licenses.sql', import.meta.url), sql, 'utf8');
console.log(`✅ Đã tạo db/migrate-licenses.sql — ${rows.length} license`);
for (const r of rows) {
  const bound = r.hwid ? `máy ${r.hwid.slice(0, 8)}…` : 'chưa bind';
  const exp = r.expires_at === 0 ? 'vĩnh viễn' : new Date(r.expires_at * 1000).toLocaleDateString('vi-VN');
  console.log(`   ${r.key.padEnd(20)} ${bound.padEnd(20)} hết hạn: ${exp}`);
}
