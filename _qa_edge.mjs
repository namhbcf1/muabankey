const B = 'https://xienhl.com';
let cookie = '';
async function req(path, opt = {}) {
  const r = await fetch(B + path, {
    ...opt,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...(opt.headers || {}) },
  });
  const sc = r.headers.getSetCookie?.() || [];
  if (sc.length) cookie = sc.map(c => c.split(';')[0]).join('; ');
  const txt = await r.text();
  let j = null; try { j = JSON.parse(txt); } catch { /* */ }
  return { s: r.status, j, txt };
}
const P = (p, b) => req(p, { method: 'POST', body: JSON.stringify(b) });

console.log('=== 22: POST /api/trial/command NO BODY ===');
let r = await req('/api/trial/command', { method: 'POST' });
console.log('status:', r.s, '| ok:', r.j?.ok, '| kind:', r.j?.kind);
console.log('   => SHOULD this be an error? Body empty is accepted silently.');

console.log('\n=== 22b: POST with invalid JSON ===');
r = await req('/api/trial/command', { method: 'POST', body: '{broken', headers: {'content-type':'application/json'} });
console.log('status:', r.s, '| ok:', r.j?.ok, '| kind:', r.j?.kind);

console.log('\n=== 23: kind sai ("xyz") ===');
r = await P('/api/trial/command', { kind: 'xyz' });
console.log('status:', r.s, '| ok:', r.j?.ok, '| kind returned:', r.j?.kind, '| label:', r.j?.label);

console.log('\n=== 23b: kind = "sql injection" ===');
r = await P('/api/trial/command', { kind: "1h' OR 1=1--" });
console.log('status:', r.s, '| ok:', r.j?.ok, '| kind:', r.j?.kind);

console.log('\n=== trial/status WITHOUT login ===');
r = await req('/api/trial/status');
console.log('status:', r.s, r.txt.slice(0, 300));

console.log('\n=== STATS consistency ===');
r = await req('/api/stats');
const st = r.j;
console.log('public stats:', JSON.stringify(st));
cookie = '';
await req('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'namhbcf', password: 'namhbcf123' }) });
const dash = await req('/api/admin/dashboard');
console.log('admin stats:', JSON.stringify(dash.j?.stats));
const ords = await req('/api/admin/orders?status=delivered&perPage=200');
const deliveredN = ords.j?.orders?.length ?? ords.j?.total ?? 'n/a';
console.log('delivered orders via admin:', deliveredN, '| stats.orders says:', st.orders);

console.log('\n=== /i/<key> JSON without token (leak check) ===');
const t = await P('/api/trial/command', { kind: '1h' });
const key = t.j.key;
cookie = '';
r = await req(`/i/${key}`);
console.log('no-token:', r.s, r.txt.slice(0, 250));
r = await req(`/i/${key}.cmd`);
console.log('.cmd no-token:', r.s, r.txt.slice(0, 200));

console.log('\n=== admin whitelist GET without auth ===');
r = await req('/api/admin/trial/whitelist');
console.log(r.s, r.txt.slice(0,150));
console.log('=== admin dashboard without auth ===');
r = await req('/api/admin/dashboard');
console.log(r.s, r.txt.slice(0,150));
console.log('=== non-admin user hits admin API ===');
cookie='';
await req('/api/auth/register', { method:'POST', body: JSON.stringify({ username:'qax'+Date.now().toString(36).slice(-6), password:'Test123456' })});
r = await req('/api/admin/dashboard');
console.log('user->admin:', r.s, r.txt.slice(0,150));
