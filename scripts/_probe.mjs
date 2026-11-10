/** _probe.mjs — kiểm tra nhanh: login admin/user, webhook secret, tạo topup. */
const B = 'https://xienhl.com';

async function j(path, opts = {}) {
  const r = await fetch(B + path, opts);
  let d = null; try { d = await r.json(); } catch {}
  return { status: r.status, data: d, setCookie: r.headers.get('set-cookie') };
}

// 1. health
console.log('health:', JSON.stringify((await j('/api/health')).data));

// 2. admin login bằng username
const a = await j('/api/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'namhbcf', password: 'namhbcf123' }),
});
console.log('admin login (username):', a.status, JSON.stringify(a.data).slice(0, 200));

// 3. admin login bằng email
const a2 = await j('/api/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'admin@muabankey.vn', password: 'namhbcf123' }),
});
console.log('admin login (email):', a2.status, JSON.stringify(a2.data).slice(0, 200));

// 4. user demo login
const u = await j('/api/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'demo', password: 'Demo@123456' }),
});
console.log('demo login:', u.status, JSON.stringify(u.data).slice(0, 300));

// 5. webhook secret test — thử cả 2 secret
for (const s of ['94bd64b2b4060695d5ee57fc9a030a77010d68d4e1d09d44', 'ebc11a82']) {
  const r = await j('/api/webhooks/sepay', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Apikey ' + s },
    body: JSON.stringify({ content: 'PROBE', transferAmount: 1000, referenceCode: 'P1' }),
  });
  console.log(`sepay secret ${s.slice(0, 12)}...:`, r.status, JSON.stringify(r.data).slice(0, 160));
}

// 6. stats endpoint
console.log('stats:', JSON.stringify((await j('/api/stats')).data).slice(0, 300));
