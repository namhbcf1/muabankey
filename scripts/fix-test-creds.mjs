import { readFileSync, writeFileSync } from 'node:fs';

// Đọc mật khẩu admin từ ADMIN_CREDENTIALS.txt thay vì hardcode
const cred = readFileSync('ADMIN_CREDENTIALS.txt', 'utf8');
const m = cred.match(/Mat khau\s*:\s*(\S+)/);
if (!m) {
  console.error('Không đọc được mật khẩu admin từ ADMIN_CREDENTIALS.txt');
  process.exit(1);
}
const pw = m[1];
console.log('Mật khẩu admin đọc được:', pw.slice(0, 3) + '***');

for (const f of ['scripts/e2e.mjs', 'scripts/e2e-license.mjs']) {
  let c = readFileSync(f, 'utf8');
  if (!c.includes('process.env.ADMIN_PASSWORD')) {
    // Thêm hằng số đầu file
    const anchor = "const BASE = ";
    if (c.includes("password: 'Admin@123456'")) {
      c = c.split("password: 'Admin@123456'").join("password: ADMIN_PW");
      c = c.replace(anchor, "const ADMIN_PW = process.env.ADMIN_PASSWORD || '" + pw + "';\nconst BASE = ");
      writeFileSync(f, c, 'utf8');
      console.log('✓', f);
    }
  } else {
    console.log('  đã sửa trước đó:', f);
  }
}
