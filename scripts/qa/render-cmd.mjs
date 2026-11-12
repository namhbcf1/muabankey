// Render .cmd cua XAGrant de kiem tra cau truc (khong chay).
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function extractFn(src, fnName) {
  const start = src.indexOf(`function ${fnName}(`);
  if (start < 0) return null;
  let p = src.indexOf('(', start);
  let pd = 0;
  let afterParams = -1;
  for (let j = p; j < src.length; j++) {
    if (src[j] === '(') pd++;
    else if (src[j] === ')') {
      pd--;
      if (pd === 0) { afterParams = j; break; }
    }
  }
  if (afterParams < 0) return null;
  let i = src.indexOf('{', afterParams);
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') {
      depth--;
      if (depth === 0) return src.slice(start, j + 1);
    }
  }
  return null;
}

const file = process.argv[2] || 'src/routes/xa-grant-installer.js';
const src = readFileSync(file, 'utf8');

const consts = {};
for (const m of src.matchAll(/^(?:export\s+)?const\s+([A-Z_][A-Z0-9_]*)\s*=\s*(.+?);\s*$/gm)) {
  consts[m[1]] = m[2];
}
const constsSrc = Object.entries(consts).map(([k, v]) => `const ${k} = ${v};`).join('\n');

const fnSrc = extractFn(src, 'buildCmd');
if (!fnSrc) { console.log('KHONG tim thay buildCmd'); process.exit(1); }

const factory = new Function(`${constsSrc}\n${fnSrc}\nreturn buildCmd;`);
const buildCmd = factory();
const out = buildCmd({
  q: 't=' + 'a'.repeat(48),
  key: 'XAGR-TEST-0001-AAAA',
  base: 'https://xienhl.com',
});

const dest = join(tmpdir(), 'xg-render.cmd');
writeFileSync(dest, out, 'utf8');
console.log('Render OK:', out.length, 'ky tu,', out.split('\n').length, 'dong');
console.log('File:', dest);

// Kiem tra cac diem quan trong
const checks = [
  ['co :hashfile', /^:hashfile/m.test(out)],
  ['co :verifyhash', /^:verifyhash/m.test(out)],
  ['co :fail_abort', /^:fail_abort/m.test(out)],
  ['cache co bam hash (call :hashfile "%EXE%")', /call :hashfile "%EXE%"/.test(out)],
  ['co cache_bad', /^:cache_bad/m.test(out)],
  ['verifyhash KHONG con "Bo qua kiem tra"', !/Bo qua kiem tra/.test(out)],
  ['verifyhash dung errorlevel', /exit \/b 1/.test(out)],
];
console.log('\n=== KIEM TRA CAU TRUC ===');
let bad = 0;
for (const [name, ok] of checks) {
  console.log(`  ${ok ? 'OK  ' : 'THIEU'} ${name}`);
  if (!ok) bad++;
}
process.exit(bad ? 1 : 0);
