import { readFileSync } from 'node:fs';

const f = 'src/routes/installer.js';
const c = readFileSync(f, 'utf8');
const s = c.indexOf('function buildPs1');
const e = c.indexOf('export async function servePs1');
const body = c.slice(s, e);
const lines = body.split('\n');

console.log('\n=== Dong PS1 co $ khong duoc escape ===\n');
let bad = 0;
lines.forEach((l, i) => {
  // Tim $ theo sau la ky tu khong phai { (tuc la PS variable, khong phai JS)
  const m = l.match(/\$[A-Za-z_]/);
  if (m) {
    console.log(`  ${i + 1}: ${l.trim().slice(0, 90)}`);
    bad++;
  }
});
console.log('\n  Tong dong co $PSvariable:', bad);

// Tim cac cho co \$\{ hoac ${ khong hop le
console.log('\n=== Cac cho JS interpolation hop le ===');
const re = /\$\{/g;
let m2;
const found = [];
while ((m2 = re.exec(body)) !== null) {
  const line = body.slice(0, m2.index).split('\n').length;
  const content = body.slice(m2.index, m2.index + 40).split('}')[0] + '}';
  found.push(`  dong ${line}: ${content}`);
}
found.forEach((x) => console.log(x));
console.log('  Tong:', found.length);
