/**
 * Chạy numbered D1 migrations trên remote một cách explicit.
 *
 * `db/migrate.mjs` dùng node:sqlite để kiểm thử/local file; nó KHÔNG thể
 * tự mở Cloudflare D1. Trước đây package.json gọi `db:migrate --remote`,
 * migrate.mjs chỉ in hướng dẫn rồi exit 0 => lệnh deploy tưởng đã migrate
 * nhưng thực tế không làm gì.
 *
 * Script này fail-closed: phải đặt CONFIRM_REMOTE_MIGRATION=YES. Mỗi file
 * được chạy theo thứ tự bằng Wrangler và Wrangler phải trả exit code 0.
 * Chạy `db:migrate:check` trước để xem migration local.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(new URL('..', import.meta.url).pathname);
const dbName = process.env.D1_DATABASE || 'muabankey-db';
const confirm = process.env.CONFIRM_REMOTE_MIGRATION;

if (confirm !== 'YES') {
  console.error('Từ chối migrate remote: đặt CONFIRM_REMOTE_MIGRATION=YES để xác nhận ghi D1 production/staging.');
  process.exit(2);
}

const dir = join(root, 'db', 'migrations');
const files = readdirSync(dir).filter((f) => /^\d{4}-.+\.sql$/.test(f)).sort();
if (!files.length) {
  console.error('Không tìm thấy db/migrations/*.sql');
  process.exit(1);
}

console.log(`Sẽ chạy ${files.length} migration trên D1: ${dbName}`);
for (const file of files) {
  const path = join(dir, file);
  console.log(`\n▶ ${file}`);
  const r = spawnSync('npx', [
    '--no-install', 'wrangler', 'd1', 'execute', dbName,
    '--remote', `--file=${path}`, '--yes',
  ], { cwd: root, stdio: 'inherit', env: process.env });
  if (r.error) {
    console.error(`Không chạy được Wrangler: ${r.error.message}`);
    process.exit(1);
  }
  if (r.status !== 0) {
    console.error(`Migration thất bại tại ${file}; dừng, không chạy file sau.`);
    process.exit(r.status || 1);
  }
}
console.log('\n✓ Tất cả migration remote đã chạy thành công.');
