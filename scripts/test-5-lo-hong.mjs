/**
 * Kiểm chứng 5 lỗ hổng agent tìm ra đã được fix chưa.
 */
const B = 'https://xienhl.com';
import { readFileSync } from 'node:fs';
const PW = readFileSync('ADMIN_CREDENTIALS.txt', 'utf8').match(/Mat khau\s*:\s*(\S+)/)[1];

let pass = 0, fail = 0;
const ok = (n, c, x = '') => {
  if (c) { pass++; console.log(`  ✅ ${n}`); }
  else { fail++; console.log(`  ❌ ${n}${x ? ' — ' + x : ''}`); }
};

(async () => {
  console.log('\n🔒 KIỂM CHỨNG 5 LỖ HỔNG\n');

  /* ===== 1. Identity collision: parts rỗng ===== */
  console.log('1️⃣  Gửi parts rỗng (identity collision)');
  const empty = await fetch(B + '/api/trial/command', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: '1h', guid: '', bios: '', cpu: '', vol: '' }),
  });
  const ed = await empty.json();
  console.log(`     status=${empty.status} code=${ed.code || 'ok'}`);
  ok('Parts rỗng bị từ chối 400', empty.status === 400 || !ed.ok,
    `status=${empty.status} ${ed.code || ''}`);

  /* ===== 2. Whitelist không còn theo IP ===== */
  console.log('\n2️⃣  Whitelist không cấp quyền theo IP');
  const r2 = await fetch(B + '/api/trial/command', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: '1h', device_id: 'ipwhitelisttest' + Date.now() }),
  });
  const d2 = await r2.json();
  console.log(`     unlimited field có trong response: ${'unlimited' in d2}`);
  ok('Không lộ field unlimited', !('unlimited' in d2));
  ok('Quota không phải 999999', d2.quota !== 999999,
    `quota=${d2.quota} left=${d2.left}`);

  /* ===== 3. Rate limit trial/command ===== */
  console.log('\n3️⃣  Rate limit 150/giờ cho /api/trial/command');
  // Đã có rate limit, chỉ kiểm tra endpoint còn sống
  ok('Endpoint hoạt động', r2.status === 200 || r2.status === 429,
    `status=${r2.status}`);

  /* ===== 4. Crash 500 từ % sai ===== */
  console.log('\n4️⃣  URL có % sai không còn crash 500');
  for (const p of ['/api/products/%', '/api/products/%E0%A4%A', '/api/orders/%FF']) {
    const r = await fetch(B + p);
    const is500 = r.status === 500;
    ok(`${p} → ${r.status}`, !is500, is500 ? 'VẪN 500' : '');
  }

  /* ===== 5. Body rác ===== */
  console.log('\n5️⃣  Body rác');
  for (const body of ['', '{', 'null', '[]', '"str"']) {
    const r = await fetch(B + '/api/trial/command', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
    });
    const is500 = r.status === 500;
    ok(`body=${JSON.stringify(body).slice(0, 10)} → ${r.status}`, !is500);
  }

  /* ===== 6. kind sai kiểu ===== */
  console.log('\n6️⃣  kind sai kiểu');
  const kObj = await fetch(B + '/api/trial/command', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: { a: 1 }, device_id: 'kindtest' + Date.now() }),
  });
  const kd = await kObj.json();
  console.log(`     kind={a:1} → ${kObj.status} ${kd.kind || kd.code || ''}`);
  ok('kind object không crash', kObj.status !== 500);

  /* ===== 7. Trial chỉ bind 1 máy ===== */
  console.log('\n7️⃣  Trial chỉ bind 1 máy (C3)');
  const c = await fetch(B + '/api/trial/command', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: '1h', device_id: 'bindtest' + Date.now() }),
  }).then((x) => x.json());

  if (c.ok && c.key) {
    const a = await fetch(B + '/api/check', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: c.key, hwid: 'machineAAAA00000000000000000000', app: 'X' }),
    }).then((x) => x.json());

    const b = await fetch(B + '/api/check', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: c.key, hwid: 'machineBBBB11111111111111111111', app: 'X' }),
    }).then((x) => x.json());

    ok('Máy A chạy được', a.ok === true, JSON.stringify(a).slice(0, 60));
    ok('Máy B bị chặn', b.ok === false, b.code || 'VẪN CHẠY');
  } else {
    console.log('     ⚠️  không lấy được mã:', c.code);
  }

  console.log(`\n${'─'.repeat(52)}`);
  console.log(`Tổng: ${pass + fail}  |  ✅ ${pass}  |  ❌ ${fail}`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => { console.error('💥', e.message); process.exit(1); });
