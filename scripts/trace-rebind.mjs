/**
 * Truy vết lỗi "Đổi máy" / reset HWID không hoạt động.
 */
import { readFileSync } from 'node:fs';

const B = process.argv[2] || 'https://xienhl.com';

let pass = 0, fail = 0;
const ok = (n, c, x = '') => {
  if (c) { pass++; console.log(`  ✅ ${n}`); }
  else { fail++; console.log(`  ❌ ${n}${x ? ' — ' + x : ''}`); }
};

async function main() {
  console.log('\n🔍 TRUY VẾT LỖI RESET HWID\n');

  const pw = readFileSync('ADMIN_CREDENTIALS.txt', 'utf8').match(/Mat khau\s*:\s*(\S+)/)[1];

  /* ---------- 1. Trạng thái license hiện tại ---------- */
  console.log('1️⃣  Xem license hiện có');
  const dl = await fetch(B + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'demo@muabankey.vn', password: 'Demo@123456' }),
  });
  const uck = dl.headers.get('set-cookie')?.match(/mbk_session=[^;]+/)?.[0];

  const mine = await fetch(B + '/api/licenses/mine', { headers: { Cookie: uck } }).then((r) => r.json());
  const lic = mine.licenses?.[0];
  if (!lic) { console.log('  ❌ demo không có license nào'); return; }
  console.log(`     Key: ${lic.key}`);
  console.log(`     Status: ${lic.status}`);
  console.log(`     HWID: ${lic.hwid || '(chưa gán)'}`);
  console.log(`     Đổi máy: ${lic.rebinds}/${lic.maxRebind}`);

  // Nút "Đổi máy" có hiện không? (điều kiện: rebinds < maxRebind VÀ status hợp lệ)
  const canRebind = ['active', 'forever', 'expiring', 'unbound'].includes(lic.status);
  const hasQuota = lic.rebinds < lic.maxRebind;
  console.log(`     Nút hiện: ${canRebind && hasQuota ? 'CÓ' : 'KHÔNG'}`
    + (hasQuota ? '' : ` (hết lượt ${lic.rebinds}/${lic.maxRebind})`));

  /* ---------- 2. Gọi API đổi máy ---------- */
  console.log('\n2️⃣  Gọi API /api/licenses/:key/rebind');
  const rb = await fetch(B + `/api/licenses/${encodeURIComponent(lic.key)}/rebind`, {
    method: 'POST', headers: { Cookie: uck },
  });
  const rbd = await rb.json();
  console.log(`     status: ${rb.status}`);
  console.log(`     data: ${JSON.stringify(rbd).slice(0, 200)}`);
  ok('API đổi máy phản hồi', rb.status < 500, `status=${rb.status}`);

  if (rb.status === 403 && rbd.code === 'REBIND_LIMIT') {
    console.log('\n     ⚠️  HẾT LƯỢT ĐỔI MÁY — đây có thể là lý do "không hoạt động"');
    console.log('     Khách đã dùng hết max_rebind nên không bấm được nữa.');
  }

  /* ---------- 3. Admin reset HWID ---------- */
  console.log('\n3️⃣  Admin reset HWID trực tiếp');
  const al = await fetch(B + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'namhbcf', password: pw }),
  });
  const ack = al.headers.get('set-cookie')?.match(/mbk_session=[^;]+/)?.[0];

  const reset = await fetch(B + `/api/admin/licenses/${encodeURIComponent(lic.key)}/reset-hwid`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: ack },
    body: JSON.stringify({}),
  });
  const resetD = await reset.json();
  console.log(`     status: ${reset.status}`);
  console.log(`     data: ${JSON.stringify(resetD).slice(0, 200)}`);
  ok('admin reset-hwid chạy', reset.status === 200, `status=${reset.status}`);

  if (reset.status === 200) {
    const l2 = resetD.license;
    console.log(`     Sau reset: hwid=${l2?.hwid || 'NULL'}, rebinds=${l2?.rebinds}, status=${l2?.status}`);
    ok('hwid về NULL', !l2?.hwid, String(l2?.hwid));
    ok('rebinds về 0', l2?.rebinds === 0, String(l2?.rebinds));
    ok('status về unbound', l2?.status === 'unbound', l2?.status);
  }

  /* ---------- 4. Sau reset, khách còn đổi máy được không ---------- */
  console.log('\n4️⃣  Sau reset, khách đổi máy được chưa');
  const mine2 = await fetch(B + '/api/licenses/mine', { headers: { Cookie: uck } }).then((r) => r.json());
  const lic2 = mine2.licenses?.[0];
  console.log(`     rebinds: ${lic2?.rebinds}/${lic2?.maxRebind}`);
  console.log(`     hwid: ${lic2?.hwid || '(chưa gán)'}`);

  const rb2 = await fetch(B + `/api/licenses/${encodeURIComponent(lic.key)}/rebind`, {
    method: 'POST', headers: { Cookie: uck },
  });
  const rb2d = await rb2.json();
  console.log(`     Gọi lại đổi máy: status=${rb2.status} ${JSON.stringify(rb2d).slice(0, 120)}`);
  ok('sau reset gọi được đổi máy', rb2.status === 200, `status=${rb2.status}`);

  /* ---------- 5. Client có --rebind không ---------- */
  console.log('\n5️⃣  Client tool có hỗ trợ --rebind?');
  const py = readFileSync('tool/src/xa_nofog_pro.py', 'utf8');
  const hasRebindArg = /--rebind/.test(py);
  const hasRebindFunc = /def rebind/.test(py);
  console.log(`     parse_args có --rebind: ${hasRebindArg ? 'CÓ' : 'KHÔNG'}`);
  console.log(`     có hàm rebind(): ${hasRebindFunc ? 'CÓ' : 'KHÔNG'}`);
  ok('client hỗ trợ --rebind', hasRebindArg && hasRebindFunc,
    hasRebindArg ? 'thiếu hàm' : 'thiếu tham số');

  /* ---------- 6. Token dùng thế nào ---------- */
  console.log('\n6️⃣  Token đổi máy dùng ở đâu?');
  console.log('     Web tạo token -> khách phải COPY token đó vào đâu?');

  console.log(`\n${'─'.repeat(52)}`);
  console.log(`Tổng: ${pass + fail}  |  ✅ ${pass}  |  ❌ ${fail}`);
}

main().catch((e) => { console.error('💥', e); process.exit(1); });
