import { readFileSync, writeFileSync } from 'node:fs';

const f = 'src/routes/installer.js';
let c = readFileSync(f, 'utf8');

// Dòng lỗi: nếu file không tồn tại thì "%%~zA" rỗng -> batch báo
//   ". was unexpected at this time."
// màu: dùng biến trung gian an toàn
const BAD = '    for %%A in ("%EXE%.new") do if %%~zA EQU %EXESIZE% set "GOT=1"';
const GOOD = [
  '    set "SZ="',
  '    for %%A in ("%EXE%.new") do set "SZ=%%~zA"',
  '    if "%SZ%"=="%EXESIZE%" set "GOT=1"',
].join('\n');

const count = c.split(BAD).length - 1;
if (count === 0) {
  console.log('Không tìm thấy mẫu lỗi (có thể đã sửa)');
} else {
  c = c.split(BAD).join(GOOD);
  writeFileSync(f, c, 'utf8');
  console.log(`Đã sửa ${count} chỗ`);
}

console.log('Còn mẫu lỗi:', c.includes(BAD));
console.log('Có mẫu mới :', c.includes('set "SZ=%%~zA"'));
