import { execSync } from 'node:child_process';

const B = 'https://xienhl.com';
const ENV = { ...process.env };

function d1(sql) {
  execSync(
    `npx --yes wrangler@4 d1 execute muabankey-db --remote --command="${sql}" --yes`,
    { stdio: 'pipe', env: ENV }
  );
}

async function main() {
  console.log('\n🧪 TEST GIỚI HẠN 10 LƯỢT / THIẾT BỊ\n');

  // Dọn sạch
  d1("DELETE FROM trial_uses WHERE created_at > strftime('%s','now')-86400");
  d1("DELETE FROM trial_quota WHERE user_id LIKE 'dev:%'");

  const dev = 'devlimit' + Date.now();
  let ok = 0;
  const codes = {};

  for (let i = 1; i <= 12; i++) {
    const r = await fetch(B + '/api/trial/command', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: '1h', device_id: dev }),
    }).then((x) => x.json());

    if (r.ok) {
      ok++;
      // Xoá grant để lần sau tạo mã mới (giả lập trial đã kết thúc)
      d1(`DELETE FROM trial_uses WHERE lic_key='${r.key}'`);
      process.stdout.write(`  ${i}: ok (${r.key}) left=${r.left}\n`);
    } else {
      codes[r.code] = (codes[r.code] || 0) + 1;
      process.stdout.write(`  ${i}: CHẶN ${r.code}\n`);
    }
  }

  console.log(`\n  Kết quả: ${ok} ok / ${12 - ok} chặn`);
  console.log('  Mã lỗi:', JSON.stringify(codes));
  console.log(`  ${ok === 10 ? '✅ ĐÚNG: chặn sau 10 lượt/thiết bị' : `⚠️  kỳ vọng 10, được ${ok}`}`);
}

main().catch((e) => { console.error('💥', e.message); process.exit(1); });
