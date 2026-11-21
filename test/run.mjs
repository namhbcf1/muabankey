/**
 * run.mjs — Chạy toàn bộ kiểm thử.
 *
 *   node test/run.mjs            # tất cả
 *   node test/run.mjs refund     # chỉ file có tên khớp
 *
 * Mỗi file test tự chạy trong process riêng để một suite lỗi không che suite
 * khác, và để `Date.now` bị giả lập không rò sang test sau.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const filter = process.argv[2] || '';

const files = readdirSync(HERE)
  .filter((f) => f.endsWith('.test.mjs'))
  .filter((f) => !filter || f.includes(filter))
  .sort();

if (!files.length) {
  console.error(`Không có file test nào khớp "${filter}"`);
  process.exit(1);
}

const results = [];
for (const f of files) {
  console.log(`\n${'━'.repeat(60)}`);
  console.log(`▶ ${f}`);
  console.log('━'.repeat(60));
  const r = spawnSync(process.execPath, [join(HERE, f)], {
    stdio: 'inherit',
    env: { ...process.env, NODE_OPTIONS: '' },
  });
  results.push({ file: f, code: r.status ?? 1 });
}

console.log(`\n${'═'.repeat(60)}`);
console.log('TỔNG KẾT');
console.log('═'.repeat(60));
let failed = 0;
for (const r of results) {
  const mark = r.code === 0 ? '✓' : '✗';
  if (r.code !== 0) failed++;
  console.log(`  ${mark} ${r.file}`);
}
console.log(`\n${results.length - failed}/${results.length} file đạt`);
process.exit(failed ? 1 : 0);
