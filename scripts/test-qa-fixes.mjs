/**
 * Kiểm chứng 3 lỗi QA agent tìm ra đã fix.
 */
const B = 'https://xienhl.com';

let pass = 0, fail = 0;
const ok = (n, c, x = '') => {
  if (c) { pass++; console.log(`  ✅ ${n}`); }
  else { fail++; console.log(`  ❌ ${n}${x ? ' — ' + x : ''}`); }
};

(async () => {
  console.log('\n🔒 KIỂM CHỨNG FIX QA\n');

  /* ===== 1. Body rỗng / JSON hỏng ===== */
  console.log('1️⃣  Body rỗng, JSON hỏng (phải 400)');
  const bad = [
    ['rỗng', ''],
    ['{', '{'],
    ['null', 'null'],
    ['[]', '[]'],
    ['"str"', '"str"'],
  ];
  for (const [name, body] of bad) {
    const r = await fetch(B + '/api/trial/command', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
    });
    const d = await r.json().catch(() => ({}));
    ok(`body="${name}" → 400`, r.status === 400, `status=${r.status} ${d.code || ''}`);
  }

  /* ===== 2. kind sai ===== */
  console.log('\n2️⃣  kind sai (phải 400)');
  for (const kind of ['xxx', '2h', { a: 1 }, ['1h'], 123]) {
    const r = await fetch(B + '/api/trial/command', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, device_id: 'kindtest' + Date.now() }),
    });
    const d = await r.json().catch(() => ({}));
    ok(`kind=${JSON.stringify(kind)} → 400`, r.status === 400,
      `status=${r.status} ${d.code || ''}`);
  }

  /* ===== 3. Xoay device_id không bypass được ===== */
  console.log('\n3️⃣  Xoay device_id (không được vượt trần IP)');
  let created = 0, blocked = 0;
  const codes = {};
  // Gửi 30 lần với device_id ngẫu nhiên khác nhau
  for (let i = 0; i < 30; i++) {
    const r = await fetch(B + '/api/trial/command', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: '1h', device_id: 'rotate' + Math.random().toString(36).slice(2, 12) }),
    });
    const d = await r.json().catch(() => ({}));
    if (d.ok) created++;
    else { blocked++; codes[d.code] = (codes[d.code] || 0) + 1; }
  }
  console.log(`     Tạo ${created}, chặn ${blocked}`);
  console.log(`     Mã lỗi: ${JSON.stringify(codes)}`);
  ok('Bị chặn sau trần IP (20/ngày)', blocked > 0,
    `${created} mã, ${blocked} chặn`);

  /* ===== 4. Whitelist IP đã xoá ===== */
  console.log('\n4️⃣  Whitelist không cấp quyền theo IP');
  const w = await fetch(B + '/api/trial/command', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: '1h', device_id: 'wltest' + Date.now() }),
  });
  const wd = await w.json().catch(() => ({}));
  console.log(`     status=${w.status} quota=${wd.quota} left=${wd.left}`);
  ok('Không còn quota 999999', wd.quota !== 999999 && wd.left !== 999999,
    `quota=${wd.quota}`);
  ok('Không lộ field unlimited', !('unlimited' in wd));

  /* ===== 5. kind hợp lệ vẫn chạy ===== */
  console.log('\n5️⃣  kind hợp lệ vẫn chạy');
  for (const kind of ['1h', '3d']) {
    const r = await fetch(B + '/api/trial/command', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, device_id: 'valid' + kind + Date.now() }),
    });
    const d = await r.json().catch(() => ({}));
    ok(`kind=${kind} → ${r.status}`, r.status === 200 || r.status === 429,
      `${d.code || 'ok'}`);
  }

  console.log(`\n${'─'.repeat(52)}`);
  console.log(`Tổng: ${pass + fail}  |  ✅ ${pass}  |  ❌ ${fail}`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => { console.error('💥', e.message); process.exit(1); });
