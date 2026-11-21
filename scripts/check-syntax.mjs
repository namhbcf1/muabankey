/**
 * check-syntax.mjs — Kiểm tra cú pháp + import tĩnh của toàn bộ mã nguồn.
 *
 * VÌ SAO CẦN: dự án không có bundler/TypeScript, nên một lỗi cú pháp hay một
 * `import` trỏ tới file không tồn tại chỉ lộ ra khi Worker chạy thật. Với
 * Cloudflare Worker, lỗi đó = 500 cho MỌI request. Kiểm tra ở đây rẻ và bắt
 * được trước khi deploy.
 *
 * Kiểm tra:
 *   1. `node --check` từng file .js trong src/ (cú pháp ES module).
 *   2. Mọi `import ... from './x.js'` trỏ tới file có thật.
 *   3. Không còn `require(` trong src/ (Worker là ESM).
 */
import { readdirSync, statSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (name.endsWith('.js')) out.push(p);
  }
  return out;
}

const files = walk(SRC);
let errors = 0;
const rel = (p) => relative(ROOT, p).replace(/\\/g, '/');

console.log(`Kiểm tra ${files.length} file trong src/…\n`);

/* ---- 1. Cú pháp ---- */
for (const f of files) {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (r.status !== 0) {
    errors++;
    console.log(`  ✗ cú pháp: ${rel(f)}`);
    const msg = (r.stderr || '').split('\n').filter(Boolean).slice(0, 3).join('\n     ');
    if (msg) console.log(`     ${msg}`);
  }
}

/* ---- 2 & 3. Import tĩnh + require ---- */
for (const f of files) {
  const text = readFileSync(f, 'utf8');
  const dir = dirname(f);

  const re = /(?:^|\n)\s*(?:import|export)[^;\n]*?from\s+['"](\.[^'"]+)['"]/g;
  let m;
  while ((m = re.exec(text))) {
    const spec = m[1];
    const target = resolve(dir, spec);
    if (!existsSync(target)) {
      errors++;
      console.log(`  ✗ import thiếu: ${rel(f)} -> ${spec}`);
    }
  }

  const dyn = /\bimport\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g;
  while ((m = dyn.exec(text))) {
    const target = resolve(dir, m[1]);
    if (!existsSync(target)) {
      errors++;
      console.log(`  ✗ import() động thiếu: ${rel(f)} -> ${m[1]}`);
    }
  }

  if (/(?:^|\n)\s*(?:const|let|var)?\s*[^\n]*\brequire\s*\(/.test(text)) {
    errors++;
    console.log(`  ✗ còn require() (Worker là ESM): ${rel(f)}`);
  }
}

/* ---- 4. Entry point khai báo trong wrangler.toml ---- */
try {
  const toml = readFileSync(join(ROOT, 'wrangler.toml'), 'utf8');
  const mm = toml.match(/^\s*main\s*=\s*"([^"]+)"/m);
  if (mm) {
    const mainPath = join(ROOT, mm[1]);
    if (!existsSync(mainPath)) {
      errors++;
      console.log(`  ✗ entry point không tồn tại: ${mm[1]}`);
    }
  }
} catch {
  errors++;
  console.log('  ✗ không đọc được wrangler.toml');
}

console.log(errors === 0
  ? `\n✓ Cú pháp và import đều hợp lệ (${files.length} file)`
  : `\n✗ ${errors} lỗi`);
process.exit(errors ? 1 : 0);
