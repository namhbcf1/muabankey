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
await req('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'namhbcf', password: 'namhbcf123' }) });

// find the key I just bought
let r = await req('/api/admin/licenses?q=AOE1-JZPA-YKA4-SA2H');
console.log('SEARCH license:', r.s, r.txt.slice(0, 900));

// create a FRESH license to test tool activation without my interference
r = await req('/api/admin/licenses', { method: 'POST', body: JSON.stringify({ quantity: 1, days: 30, prefix: 'QA', note: 'QA tool test' }) });
console.log('\nCREATE LICENSE:', r.s, r.txt.slice(0, 600));
