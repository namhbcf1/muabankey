/** Verify migration command is fail-closed and no longer a silent no-op. */
import { Suite } from './harness.mjs';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const S = new Suite('Migration command');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const script = readFileSync(join(ROOT, 'scripts/migrate-remote.mjs'), 'utf8');
S.ok(pkg.scripts['db:migrate'] === 'node scripts/migrate-remote.mjs', 'db:migrate gọi remote runner thật');
S.ok(/CONFIRM_REMOTE_MIGRATION/.test(script), 'remote migration bắt buộc confirmation');
S.ok(/status !== 0/.test(script), 'migration lỗi dừng với exit code khác 0');
S.ok(/schema_migrations|migrate\.mjs/.test(readFileSync(join(ROOT, 'db/migrate.mjs'), 'utf8')), 'local runner vẫn có checksum/status');
S.ok(!/db:migrate.*migrate\.mjs --remote/.test(pkg.scripts['db:migrate']), 'không còn lệnh silent no-op cũ');
process.exit(S.summary() ? 0 : 1);
