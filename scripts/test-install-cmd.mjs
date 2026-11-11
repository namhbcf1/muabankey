/**
 * Test lệnh cài đặt như khách thật sự dùng (one-liner).
 * Kiểm tra cả PowerShell và CMD.
 */
const B = 'https://xienhl.com';
import { readFileSync } from 'node:fs';

const PW = readFileSync('ADMIN_CREDENTIALS.txt', 'utf8').match(/Mat khau\s*:\s*(\S+)/)[1];

(async () => {
  console.log('\n🧪 TEST LỆNH CÀI ĐẶT THẬT\n');

  // Lấy token
  const lr = await fetch(B + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'namhbcf', password: PW }),
  });
  const ck = lr.headers.get('set-cookie')?.match(/mbk_session=[^;]+/)?.[0];

  const tr = await fetch(B + '/api/licenses/AOE1-BDY5-YK6H-SPS9/install-token', {
    method: 'POST', headers: { Cookie: ck },
  });
  const td = await tr.json();

  console.log('1️⃣  LỆNH SERVER TRẢ VỀ\n');
  console.log('  oneLiner (PowerShell):');
  console.log(`    ${td.oneLiner}`);
  console.log('\n  command (CMD):');
  console.log(`    ${td.command}`);
  console.log('\n  downloadCmd:');
  console.log(`    ${td.downloadCmd}`);

  /* ===== 2. Kiểm tra .ps1 ===== */
  console.log('\n2️⃣  KIỂM TRA FILE .ps1');
  const ps1Url = `${B}/i/AOE1-BDY5-YK6H-SPS9.ps1?t=${td.token}`;
  const r = await fetch(ps1Url);
  const txt = await r.text();
  console.log(`  HTTP ${r.status} — ${txt.length} bytes`);

  const issues = [];
  const lines = txt.split('\n');
  lines.forEach((l, i) => {
    if (/^\s*\/\*/.test(l) || /\*\//.test(l)) issues.push(`dòng ${i + 1}: comment JS /* */`);
    if (/<#/.test(l)) issues.push(`dòng ${i + 1}: block comment <#`);
    if (/\bconst |\blet |\bvar /.test(l) && !/^\s*#/.test(l)) issues.push(`dòng ${i + 1}: khai báo JS`);
  });

  if (issues.length) {
    console.log('  ❌ Vẫn còn lỗi:');
    issues.slice(0, 10).forEach((x) => console.log(`     ${x}`));
  } else {
    console.log('  ✅ Không có comment/khai báo JS');
  }

  /* ===== 3. Kiểm tra .cmd ===== */
  console.log('\n3️⃣  KIỂM TRA FILE .cmd');
  const cmdUrl = `${B}/i/AOE1-BDY5-YK6H-SPS9.cmd?t=${td.token}`;
  const rc = await fetch(cmdUrl);
  const cmdtxt = await rc.text();
  console.log(`  HTTP ${rc.status} — ${cmdtxt.length} bytes`);

  const cmdIssues = [];
  cmdtxt.split('\n').forEach((l, i) => {
    if (/^\s*\/\*/.test(l) || /\*\//.test(l)) cmdIssues.push(`dòng ${i + 1}: comment JS`);
    if (/\bconst |\blet /.test(l)) cmdIssues.push(`dòng ${i + 1}: khai báo JS`);
  });
  console.log(cmdIssues.length ? '  ❌ Có lỗi: ' + cmdIssues.join(', ') : '  ✅ Sạch');

  /* ===== 4. Lưu file để test ===== */
  const { writeFileSync } = await import('node:fs');
  writeFileSync(process.env.TEMP + '\\khach-ps1.ps1', txt, 'utf8');
  writeFileSync(process.env.TEMP + '\\khach-cmd.cmd', cmdtxt, 'utf8');
  console.log('\n4️⃣  ĐÃ LƯU');
  console.log('  %TEMP%\\khach-ps1.ps1');
  console.log('  %TEMP%\\khach-cmd.cmd');

  /* ===== 5. So sánh 2 lệnh ===== */
  console.log('\n5️⃣  PHÂN TÍCH');
  const hasOneLiner = !!td.oneLiner;
  const hasCmd = !!td.command;
  console.log(`  ${hasOneLiner ? '✅' : '❌'} Có oneLiner (chạy PowerShell + CMD)`);
  console.log(`  ${hasCmd ? '✅' : '❌'} Có command (chỉ CMD, dùng &&)`);

  if (hasCmd && td.command.includes('&&')) {
    console.log('\n  ⚠️  command dùng "&&" — CHẾT trong PowerShell 5.1');
    console.log('     → Phải dùng oneLiner cho khách Win11');
  }
})();
