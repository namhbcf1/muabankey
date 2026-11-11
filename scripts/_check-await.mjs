// Tìm chỗ gọi helper async mà thiếu await trong orders.js.
import { readFileSync } from 'node:fs';

const src = readFileSync('src/routes/orders.js', 'utf8');
const lines = src.split('\n');

const asyncFns = ['safeParse', 'sealKeys', 'openSecret', 'sealSecret', 'issueLicenses', 'deliverLicenseLine'];

let bad = 0;
lines.forEach((l, i) => {
  for (const fn of asyncFns) {
    if (l.includes(`${fn}(`) && !l.includes('await') && !l.includes('async function') && !l.includes('import')) {
      console.log(`THIẾU AWAIT dòng ${i + 1} [${fn}]: ${l.trim()}`);
      bad++;
    }
  }
});
console.log(bad === 0 ? 'OK: không có chỗ nào thiếu await' : `\n${bad} chỗ cần sửa`);
