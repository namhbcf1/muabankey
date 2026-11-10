/**
 * Tạo 1000 key ngẫu nhiên cho MỖI gói XArena No Fog.
 *
 * API giới hạn 100 key/lần -> gọi 10 lần/gói.
 * Key sinh bằng crypto.getRandomValues (CSPRNG), alphabet loại bỏ
 * ký tự dễ nhầm (0/O, 1/I) — cùng cơ chế với shop đang dùng.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const B = process.argv[2] || 'https://xienhl.com';
const PER_PRODUCT = 1000;
const BATCH = 100;

const PACKAGES = [
  { id: 'p-lic-week',    name: 'Gói Tuần',    days: 7,   price: 70000 },
  { id: 'p-lic-month',   name: 'Gói Tháng',   days: 30,  price: 180000 },
  { id: 'p-lic-year',    name: 'Gói Năm',     days: 365, price: 590000 },
  { id: 'p-lic-forever', name: 'Vĩnh Viễn',   days: 0,   price: 1290000 },
];

async function main() {
  console.log('\n🔑 TẠO KEY XARENA NO FOG\n');
  console.log(`  ${PER_PRODUCT} key × ${PACKAGES.length} gói = ${PER_PRODUCT * PACKAGES.length} key\n`);

  // Đăng nhập
  const pw = readFileSync('ADMIN_CREDENTIALS.txt', 'utf8').match(/Mat khau\s*:\s*(\S+)/)[1];
  const lr = await fetch(B + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'namhbcf', password: pw }),
  });
  const ck = lr.headers.get('set-cookie')?.match(/mbk_session=[^;]+/)?.[0];
  if (!ck) { console.error('❌ Không đăng nhập được admin'); process.exit(1); }
  console.log('  ✅ Đăng nhập admin\n');

  mkdirSync('keys', { recursive: true });
  const all = {};
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');

  for (const pkg of PACKAGES) {
    process.stdout.write(`  ${pkg.name.padEnd(12)} `);
    const keys = [];
    const t0 = Date.now();

    for (let i = 0; i < PER_PRODUCT / BATCH; i++) {
      const r = await fetch(B + '/api/admin/licenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: ck },
        body: JSON.stringify({
          count: BATCH,
          days: pkg.days,
          prefix: 'AOE1',
          note: `Kho ${pkg.name} - lo ${stamp} - phan ${i + 1}`,
        }),
      });
      const d = await r.json();
      if (!r.ok || !d.ok) {
        console.error(`\n  ❌ Lỗi phần ${i + 1}: ${JSON.stringify(d).slice(0, 120)}`);
        break;
      }
      keys.push(...d.keys);
      process.stdout.write('.');
    }

    const ms = Date.now() - t0;
    all[pkg.id] = { ...pkg, keys, count: keys.length };
    console.log(` ${keys.length} key (${(ms / 1000).toFixed(1)}s)`);
  }

  // Lưu ra file
  const lines = [];
  lines.push('# XArena No Fog — Kho key ngẫu nhiên');
  lines.push(`# Tạo lúc: ${new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}`);
  lines.push(`# Tổng: ${Object.values(all).reduce((s, p) => s + p.count, 0)} key`);
  lines.push('');

  for (const pkg of PACKAGES) {
    const d = all[pkg.id];
    lines.push('='.repeat(60));
    lines.push(`${d.name} — ${d.days === 0 ? 'VĨNH VIỄN' : d.days + ' ngày'} — ${d.price.toLocaleString('vi-VN')}đ`);
    lines.push(`Số lượng: ${d.count} key`);
    lines.push('='.repeat(60));
    if (d.days === 0) {
      lines.push('# LƯU Ý: days=0 = VĨNH VIỄN. Hạn tính từ lần kích hoạt đầu tiên.');
    } else {
      lines.push(`# Hạn ${d.days} ngày tính từ lần kích hoạt đầu tiên.`);
    }
    lines.push('');
    d.keys.forEach((k, i) => {
      lines.push(`${String(i + 1).padStart(4, ' ')}. ${k}`);
    });
    lines.push('');
  }

  const out = `keys/xarena-${stamp}.txt`;
  writeFileSync(out, lines.join('\n'), 'utf8');

  // CSV để import
  const csv = ['goi,so_ngay,gia,key'];
  for (const pkg of PACKAGES) {
    const d = all[pkg.id];
    for (const k of d.keys) csv.push(`${pkg.name},${pkg.days},${pkg.price},${k}`);
  }
  writeFileSync(`keys/xarena-${stamp}.csv`, csv.join('\n'), 'utf8');

  console.log(`\n${'─'.repeat(52)}`);
  let total = 0;
  for (const pkg of PACKAGES) {
    const d = all[pkg.id];
    total += d.count;
    const okMark = d.count === PER_PRODUCT ? '✅' : '⚠️ ';
    console.log(`  ${okMark} ${d.name.padEnd(12)} ${String(d.count).padStart(5)} key`);
  }
  console.log(`${'─'.repeat(52)}`);
  console.log(`  Tổng: ${total} key`);
  console.log('');
  console.log(`  📄 ${out}`);
  console.log(`  📄 keys/xarena-${stamp}.csv`);
  console.log('');
}

main().catch((e) => { console.error('💥', e); process.exit(1); });
