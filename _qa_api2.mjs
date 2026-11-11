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
  return { s: r.status, j, txt, ct: r.headers.get('content-type') };
}

// admin login
let r = await req('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'namhbcf', password: 'namhbcf123' }) });
console.log('ADMIN LOGIN:', r.s, r.j?.ok, 'role=', r.j?.user?.role);

r = await req('/api/admin/trial/whitelist');
console.log('\n=== WHITELIST ===');
console.log(JSON.stringify(r.j, null, 1).slice(0, 2000));

// dashboard numbers
r = await req('/api/admin/dashboard');
console.log('\n=== ADMIN DASHBOARD ===');
console.log(JSON.stringify(r.j, null, 1).slice(0, 1500));

// public stats vs reality
const stats = await req('/api/stats');
console.log('\n=== PUBLIC STATS ===', JSON.stringify(stats.j));
