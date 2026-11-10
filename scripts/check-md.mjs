// Kiểm tra chuỗi MarkdownV2 thực tế gửi lên Telegram.
function mdEsc(s) {
  return String(s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
}
function vnd(n) { return Number(n || 0).toLocaleString('vi-VN') + 'đ'; }

console.log('=== Test mdEsc cơ bản ===');
console.log('  "secret"      ->', JSON.stringify(mdEsc('secret')));
console.log('  "12.34"       ->', JSON.stringify(mdEsc('12.34')));
console.log('  "1.000đ"      ->', JSON.stringify(mdEsc(vnd(1000))));
console.log('  "a\\\\b"        ->', JSON.stringify(mdEsc('a\\b')));

const now = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
console.log('\n=== Chuỗi từ tgTest ===');
const text = [
  '✅ *KẾT NỐI THÀNH CÔNG*',
  '',
  'MuaBanKey đã gửi được thông báo về Telegram.',
  '',
  `_Nguồn cấu hình: ${mdEsc('secret')}_`,
  `_Thời gian: ${mdEsc(now)}_`,
].join('\n');

console.log(JSON.stringify(text, null, 1));
console.log('\n=== Đọc được ===');
console.log(text);

// Tìm ký tự KHÔNG được escape mà nằm ngoài markup
// Trong MarkdownV2: * _ ` [ ] là markup. Các ký tự . ! - + = | { } ( ) ~ > # phải escape
const reserved = '._!-+=|{}()~>#';
let issues = [];
text.split('\n').forEach((line, i) => {
  let j = 0;
  while (j < line.length) {
    const ch = line[j];
    if (ch === '\\') { j += 2; continue; }
    if (reserved.includes(ch)) {
      issues.push(`  dòng ${i + 1}: ký tự "${ch}" tại vị trí ${j} KHÔNG escape`);
    }
    j++;
  }
});
console.log('\n=== Ký tự reserved chưa escape ===');
if (issues.length === 0) console.log('  (không có)');
else issues.forEach((x) => console.log(x));
