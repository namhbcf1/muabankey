const B = 'https://xienhl.com';
import { readFileSync } from 'node:fs';

const PW = readFileSync('ADMIN_CREDENTIALS.txt', 'utf8').match(/Mat khau\s*:\s*(\S+)/)[1];

(async () => {
  console.log('\n🔑 LẤY TOKEN CÀI ĐẶT MỚI\n');

  // Login admin (vì license AOE1-BDY5-YK6H-SPS9 thuộc u-admin)
  const lr = await fetch(B + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'namhbcf', password: PW }),
  });
  const ck = lr.headers.get('set-cookie')?.match(/mbk_session=[^;]+/)?.[0];
  console.log('  Admin login:', lr.status);

  // Lấy token cài đặt
  const tr = await fetch(B + '/api/licenses/AOE1-BDY5-YK6H-SPS9/install-token', {
    method: 'POST', headers: { Cookie: ck },
  });
  const td = await tr.json();
  console.log(`  Token: ${tr.status} ${JSON.stringify(td).slice(0, 200)}`);

  if (!td.ok || !td.token) {
    console.log('\n  ❌ Không lấy được token');
    return;
  }

  const url = `${B}/i/AOE1-BDY5-YK6H-SPS9.ps1?t=${td.token}`;
  console.log(`\n  URL: ${url}`);

  // Tải file .ps1
  const r = await fetch(url);
  const txt = await r.text();
  console.log(`\n  .ps1: ${r.status} — ${txt.length} bytes`);

  if (r.status !== 200) {
    console.log('  ❌ Lỗi:', txt.slice(0, 150));
    return;
  }

  // Kiểm tra comment JS
  const jsComments = (txt.match(/\/\*|\*\//g) || []).length;
  console.log(`  Comment JS /* */: ${jsComments} ${jsComments === 0 ? '✅' : '❌'}`);

  // Lưu để test
  const { writeFileSync } = await import('node:fs');
  writeFileSync(process.env.TEMP + '\\test-install2.ps1', txt, 'utf8');
  console.log(`  Đã lưu: %TEMP%\\test-install2.ps1`);

  // Tìm lỗi cú pháp phổ biến
  const lines = txt.split('\n');
  const problems = [];
  lines.forEach((l, i) => {
    if (/^\s*\/\*/.test(l)) problems.push(`  dòng ${i + 1}: comment JS /*`);
    if (/\*\//.test(l)) problems.push(`  dòng ${i + 1}: comment JS */`);
    if (/<#/.test(l)) problems.push(`  dòng ${i + 1}: block comment <# (làm vỡ iex)`);
  });
  if (problems.length) {
    console.log('\n  ⚠️  Vấn đề:');
    problems.forEach((p) => console.log(p));
  } else {
    console.log('  ✅ Không có comment gây lỗi');
  }
})();
