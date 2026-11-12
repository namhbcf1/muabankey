const T = process.env.CLOUDFLARE_API_TOKEN;
const A = process.env.CLOUDFLARE_ACCOUNT_ID;
const D = '81f478c9-5627-458a-a35f-d483e69d400b';

async function q(sql) {
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${A}/d1/database/${D}/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${T}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql }),
  });
  const j = await r.json();
  if (!j.success) throw new Error(JSON.stringify(j.errors));
  return j.result?.[0]?.results || [];
}

(async () => {
  console.log('\n🔑 TEST TOKEN END-TO-END\n');

  // Lấy key chưa gắn
  const free = await q(
    `SELECT key FROM licenses WHERE hwid IS NULL AND source='sold' AND revoked=0 LIMIT 1`
  );
  if (!free.length) {
    console.log('  Không có key chưa gắn. Tạo key test...');
    const k = 'AOE1-TEST-' + Math.random().toString(36).slice(2, 6).toUpperCase() + '-TOKN';
    await q(`INSERT INTO licenses (key, hwid, plan, created_at, expires_at, revoked, max_rebind, rebinds, source)
             VALUES ('${k}', NULL, 'THANG', ${Math.floor(Date.now() / 1000)}, ${Math.floor(Date.now() / 1000) + 86400 * 30}, 0, 1, 0, 'test')`);
    console.log(`  Đã tạo: ${k}`);
    await testKey(k);
    await q(`DELETE FROM licenses WHERE key='${k}'`);
    return;
  }

  const key = free[0].key;
  console.log(`  Key chưa gắn: ${key}\n`);
  await testKey(key);
})();

async function testKey(key) {
  const HWID = 'aabbccdd' + Math.random().toString(16).slice(2, 10).padEnd(24, '0');

  // 1. Activate
  const r = await fetch('https://xienhl.com/api/activate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, hwid: HWID, app: 'xa-nofog' }),
  });
  const d = await r.json();
  console.log(`1️⃣  /api/activate → ${r.status}`);
  console.log(`     ok=${d.ok} plan=${d.plan} grace=${d.grace_hours}`);

  if (!d.ok) {
    console.log(`     ❌ ${d.code}: ${d.msg}`);
    return;
  }

  // 2. Có token không?
  const tk = d.token || '';
  console.log(`\n2️⃣  TOKEN`);
  console.log(`     Độ dài: ${tk.length} ký tự`);
  console.log(`     Tiền tố: ${tk.slice(0, 12)}...`);

  if (!tk) {
    console.log('     ❌ KHÔNG CÓ TOKEN — server chưa trả');
    return;
  }

  // 3. Verify bằng Python client
  const fs = await import('node:fs');
  fs.writeFileSync(process.env.TEMP + '\\tok.txt', tk, 'utf8');
  const { execSync } = await import('node:child_process');
  try {
    const out = execSync(
      `python -c "import sys; sys.path.insert(0,'tool/src'); import xa_nofog_sec as NF, pathlib; t=pathlib.Path(r'${process.env.TEMP}\\tok.txt').read_text(encoding='utf-8').strip(); r=NF.verify_token_local(t); print('ok=' + str(r.get('ok'))); print('count=' + str(r.get('count'))); print('groups=' + str(list((r.get('groups') or {}).keys()))); print('code=' + str(r.get('code')))"`,
      { cwd: 'C:\\Users\\ADMIN\\Desktop\\muabankey', encoding: 'utf8' }
    );
    console.log('\n3️⃣  PYTHON VERIFY (xa_nofog_sec.py)');
    for (const line of out.trim().split('\n')) console.log(`     ${line}`);
  } catch (e) {
    console.log('\n3️⃣  PYTHON VERIFY');
    console.log(`     ❌ ${String(e.stderr || e.message).slice(0, 300)}`);
  }
}
