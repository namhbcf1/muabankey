import { readFileSync, writeFileSync } from 'node:fs';

const f = 'src/routes/installer.js';
let c = readFileSync(f, 'utf8');

// VẤN ĐỀ: trong block (...), %SZ% được expand LÚC PARSE, nên luôn rỗng
// -> "if ""=="13172433"" -> batch báo ". was unexpected at this time."
// GIẢI PHÁP: dùng delayed expansion (!SZ!) và bật EnableDelayedExpansion.
//   Nhưng ! sẽ bị ăn nếu trong chuỗi có dấu !, code này không có nên an toàn.

// 1. Bật EnableDelayedExpansion
if (c.includes('setlocal\nchcp 65001')) {
  c = c.replace('setlocal\nchcp 65001', 'setlocal EnableDelayedExpansion\nchcp 65001');
  console.log('✓ bật EnableDelayedExpansion');
} else if (c.includes('setlocal\r\nchcp 65001')) {
  c = c.replace('setlocal\r\nchcp 65001', 'setlocal EnableDelayedExpansion\r\nchcp 65001');
  console.log('✓ bật EnableDelayedExpansion (CRLF)');
} else {
  console.log('⚠️  không tìm thấy "setlocal" — kiểm tra thủ công');
}

// 2. Đổi %SZ% -> !SZ! trong toàn bộ template
const before = c.split('%SZ%').length - 1;
c = c.split('%SZ%').join('!SZ!');
console.log(`✓ đổi ${before} chỗ %SZ% -> !SZ!`);

writeFileSync(f, c, 'utf8');
console.log('');
console.log('EnableDelayedExpansion:', c.includes('setlocal EnableDelayedExpansion'));
console.log('Còn %SZ%           :', c.includes('%SZ%'));
