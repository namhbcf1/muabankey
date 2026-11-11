/**
 * Helper: chạy SQL trên D1 local, trả về mảng rows.
 *
 * Gọi thẳng file JS của wrangler bằng `node` thay vì `npx`:
 * trên Windows + Node 26, spawn `npx.cmd` trả EINVAL, và truyền SQL qua
 * `--command` thì bị cmd.exe tách nhỏ đối số. Ghi SQL ra file .sql rồi
 * dùng `--file=` là cách duy nhất chạy ổn định ở cả Windows lẫn POSIX.
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const WRANGLER_JS = resolve('node_modules/wrangler/wrangler-dist/cli.js');
const dir = mkdtempSync(join(tmpdir(), 'd1q-'));
let n = 0;

function run(query) {
  const f = join(dir, `q${n++}.sql`);
  writeFileSync(f, query, 'utf8');
  const out = execFileSync(
    process.execPath,
    [WRANGLER_JS, 'd1', 'execute', 'muabankey-db', '--local', '--json', `--file=${f}`],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  const i = out.indexOf('[');
  if (i < 0) return [];
  return JSON.parse(out.slice(i)).map((r) => r.results || []);
}

/** Rows của statement ĐẦU TIÊN. */
export function sql(query) {
  return run(query)[0] || [];
}

/** Rows của MỌI statement theo thứ tự. */
export function sqlAll(query) {
  return run(query);
}
