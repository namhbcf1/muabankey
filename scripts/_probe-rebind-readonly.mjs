/**
 * Probe READ-ONLY: trạng thái rebind trên production.
 * Không ghi gì vào DB, chỉ đọc + thử gọi endpoint của chính mình.
 */
import { readFileSync } from 'node:fs';

const B = process.argv[2] || 'https://xienhl.com';
const pw = readFileSync('ADMIN_CREDENTIALS.txt', 'utf8').match(/Mat khau\s*:\s*(\S+)/)[1];

async function login(email, password) {
  const r = await fetch(B + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const setc = r.headers.get('set-cookie');
  const ck = setc?.match(/mbk_session=[^;]+/)?.[0] || null;
  let d = null; try { d = await r.json(); } catch {}
  return { status: r.status, cookie: ck, data: d };
}

function table(rows) {
  if (!rows.length) return '  (trống)';
  const cols = Object.keys(rows[0]);
  const w = cols.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c] ?? '').length)));
  const line = (a) => '  ' + cols.map((c, i) => String(a[c] ?? '').padEnd(w[i])).join(' | ');
  return [line(Object.fromEntries(cols.map((c) => [c, c]))), '  ' + w.map((x) => '-'.repeat(x)).join('-'), ...rows.map(line)].join('\n');
}

async function main() {
  console.log(`\n===== PROBE READ-ONLY @ ${B} =====\n`);

  /* 1. Admin login */
  const adm = await login('namhbcf', pw);
  console.log(`1) admin login: ${adm.status} cookie=${adm.cookie ? 'OK' : 'NONE'}`);
  if (!adm.cookie) { console.log('   data:', JSON.stringify(adm.data)); return; }

  /* 2. Danh sách license admin */
  const lr = await fetch(B + '/api/admin/licenses', { headers: { Cookie: adm.cookie } });
  const ld = await lr.json();
  const lics = ld.licenses || [];
  console.log(`2) /api/admin/licenses: ${lr.status} available=${ld.available} n=${lics.length}`);
  console.log('   stats:', JSON.stringify(ld.stats));

  /* 3. Phân bố rebinds / maxRebind */
  const dist = {};
  for (const l of lics) {
    const k = `rebinds=${l.rebinds} max=${l.maxRebind}`;
    dist[k] = (dist[k] || 0) + 1;
  }
  console.log('\n3) Phân bố rebinds/maxRebind (mẫu ' + lics.length + '):');
  for (const [k, v] of Object.entries(dist).sort((a, b) => b[1] - a[1]).slice(0, 15)) {
    console.log(`   ${k.padEnd(24)} ${v}`);
  }

  /* 4. License đã bind + còn lượt đổi máy */
  const bound = lics.filter((l) => l.bound);
  const canRebind = bound.filter((l) => l.status !== 'revoked' && l.status !== 'expired');
  const hasQuota = canRebind.filter((l) => l.rebinds < l.maxRebind);
  console.log(`\n4) Đã bind=${bound.length}  dùng được=${canRebind.length}  còn lượt đổi=${hasQuota.length}`);
  console.log('   Mẫu bound & còn lượt:');
  console.log(table(hasQuota.slice(0, 8).map((l) => ({
    key: l.key, status: l.status, rebinds: l.rebinds, max: l.maxRebind, hwid: l.hwidMasked || '-',
  }))));

  /* 5. License đã bind & HẾT lượt */
  const noQuota = canRebind.filter((l) => l.rebinds >= l.maxRebind);
  console.log(`\n5) HẾT lượt đổi máy: ${noQuota.length}`);
  console.log(table(noQuota.slice(0, 8).map((l) => ({
    key: l.key, status: l.status, rebinds: l.rebinds, max: l.maxRebind,
  }))));

  /* 6. Demo user có license nào */
  console.log('\n6) Tài khoản demo:');
  const demo = await login('demo@muabankey.vn', 'Demo@123456');
  console.log(`   login: ${demo.status} cookie=${demo.cookie ? 'OK' : 'NONE'}`);
  if (demo.cookie) {
    const mr = await fetch(B + '/api/licenses/mine', { headers: { Cookie: demo.cookie } });
    const md = await mr.json();
    console.log(`   /api/licenses/mine: ${mr.status} n=${md.licenses?.length ?? 0}`);
    if (md.licenses?.length) {
      console.log(table(md.licenses.map((l) => ({
        key: l.key, status: l.status, rebinds: `${l.rebinds}/${l.maxRebind}`,
        bound: l.bound, hwid: l.hwidMasked || '-',
      }))));
    }
  }

  /* 7. Endpoint /api/rebind tồn tại? (không ghi vì token sai) */
  console.log('\n7) /api/rebind với token rác (không ghi DB):');
  const rb = await fetch(B + '/api/rebind', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: 'AOE1-2222-2222-2222', hwid: 'a'.repeat(32), token: 'f'.repeat(48) }),
  });
  console.log(`   status=${rb.status} body=${(await rb.text()).slice(0, 200)}`);

  /* 8. /api/licenses/:key/rebind khi không đăng nhập */
  console.log('\n8) /api/licenses/<key>/rebind KHÔNG đăng nhập:');
  const r8 = await fetch(B + '/api/licenses/AOE1-2222-2222-2222/rebind', { method: 'POST' });
  console.log(`   status=${r8.status} body=${(await r8.text()).slice(0, 160)}`);

  /* 9. Admin action không tồn tại */
  console.log('\n9) /api/admin/licenses/<key>/reset (action sai):');
  const r9 = await fetch(B + '/api/admin/licenses/AOE1-2222-2222-2222/reset', {
    method: 'POST', headers: { Cookie: adm.cookie },
  });
  console.log(`   status=${r9.status} body=${(await r9.text()).slice(0, 200)}`);

  /* 10. Kiểm tra code production có mới không: header /api/licenses/mine */
  console.log('\n10) /api/licenses/mine (demo) có trả maxRebind không?');
  if (demo.cookie) {
    const r10 = await fetch(B + '/api/licenses/mine', { headers: { Cookie: demo.cookie } });
    const d10 = await r10.json();
    console.log(`    ${r10.status} keys=${JSON.stringify(Object.keys(d10))}`);
  }
}

main().catch((e) => { console.error('💥', e); process.exit(1); });
