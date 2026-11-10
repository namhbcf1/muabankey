import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const exePath = 'tool/dist/xa_nofog_pro.exe';
const buf = readFileSync(exePath);
const sha = createHash('sha256').update(buf).digest('hex').toUpperCase();
const size = buf.length;

console.log('EXE:', exePath);
console.log('  size  :', size, 'bytes (' + (size / 1048576).toFixed(2) + ' MB)');
console.log('  sha256:', sha);
console.log('');

const f = 'src/routes/installer.js';
let c = readFileSync(f, 'utf8');

c = c.replace(/const EXE_SHA256 = '[A-Fa-f0-9]+';/, `const EXE_SHA256 = '${sha}';`);
c = c.replace(/const EXE_SIZE = \d+;/, `const EXE_SIZE = ${size};`);

writeFileSync(f, c, 'utf8');

const m1 = c.match(/const EXE_SHA256 = '([A-Fa-f0-9]+)'/);
const m2 = c.match(/const EXE_SIZE = (\d+)/);
console.log('Đã cập nhật installer.js:');
console.log('  EXE_SHA256:', m1 ? m1[1] : 'KHÔNG THẤY');
console.log('  EXE_SIZE  :', m2 ? m2[1] : 'KHÔNG THẤY');
console.log('');
console.log('Khớp:', m1 && m1[1] === sha && m2 && Number(m2[1]) === size ? '✅' : '❌');
