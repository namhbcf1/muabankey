/** The bundled Arena release must not silently run indefinitely when update metadata is unavailable. */
import { Suite } from './harness.mjs';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const S = new Suite('Updater policy');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const app = readFileSync(join(ROOT, 'tool/app/xa_arena_app.py'), 'utf8');
const updater = readFileSync(join(ROOT, 'tool/ui/xa_update.py'), 'utf8');
S.ok(/'https:\/\/xienhl\.com', 'arena', APP_VERSION[\s\S]{0,220}allow_offline=False/.test(app), 'XA ARENA fail-closed khi không kiểm tra được release');
S.ok(/if allow_offline:/.test(updater), 'updater giữ adapter offline cho legacy caller có policy rõ');
S.ok(/Chưa kiểm tra được bản mới/.test(app), 'UX báo lỗi thay vì giả vờ đã mới nhất');
process.exit(S.summary() ? 0 : 1);
