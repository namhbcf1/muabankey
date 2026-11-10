import { readFileSync, writeFileSync } from 'node:fs';

const f = 'src/index.js';
let c = readFileSync(f, 'utf8');

const marker = '// Chỉ xử lý /api/* ở worker; phần còn lại do ASSETS phục vụ';
const start = c.indexOf(marker);
if (start === -1) {
  console.log('Không tìm thấy marker — kiểm tra thủ công');
  process.exit(0);
}

// Tìm dòng đóng block: dòng "    }" ngay sau "return new Response(res.body..."
const respIdx = c.indexOf('return new Response(res.body, { status: res.status, headers: h });', start);
if (respIdx === -1) {
  console.log('Đã đơn giản hoá từ trước (không còn block CSP)');
  process.exit(0);
}

const endBrace = c.indexOf('\n    }\n', respIdx);
if (endBrace === -1) {
  console.log('Không tìm thấy dấu đóng block');
  process.exit(1);
}

const replacement =
  '// Security headers cho HTML do public/_headers đảm nhiệm\n' +
  "    if (!url.pathname.startsWith('/api/')) {\n" +
  '      return env.ASSETS.fetch(request);\n' +
  '    }\n';

c = c.slice(0, start) + replacement + c.slice(endBrace + '\n    }\n'.length);
writeFileSync(f, c, 'utf8');

console.log('✓ Đã thay block CSP bằng ASSETS.fetch đơn giản');
console.log('  CSP còn trong index.js:', c.includes('Content-Security-Policy'));
console.log('  ASSETS.fetch còn:', c.includes('env.ASSETS.fetch(request)'));
