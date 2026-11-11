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
function reset() { cookie = ''; }

// ---- 1. NEW CUSTOMER ----
const uname = 'qab' + Date.now().toString(36).slice(-8);
let r = await req('/api/auth/register', { method: 'POST', body: JSON.stringify({ username: uname, password: 'Test123456' }) });
console.log('REGISTER:', r.s, r.j?.ok, '| user:', uname);

// ---- 2. ORDER with items[] on 0 balance ----
r = await req('/api/orders', { method: 'POST', body: JSON.stringify({ items: [{ productId: 'p-lic-week', quantity: 1 }] }) });
console.log('\nCREATE ORDER (0 balance):', r.s, JSON.stringify(r.j).slice(0, 400));
const orderId = r.j?.order?.id;

// ---- 3. PAY with insufficient balance ----
if (orderId) {
  r = await req(`/api/orders/${orderId}/pay`, { method: 'POST', body: '{}' });
  console.log('PAY (insufficient):', r.s, JSON.stringify(r.j).slice(0, 400));
}

// ---- 4. ADMIN tops up balance ----
reset();
r = await req('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'namhbcf', password: 'namhbcf123' }) });
console.log('\nADMIN LOGIN:', r.s, r.j?.ok);

r = await req('/api/admin/wallet/adjust', { method: 'POST', body: JSON.stringify({ username: uname, amount: 1000000, reason: 'QA test' }) });
console.log('ADMIN ADJUST:', r.s, JSON.stringify(r.j).slice(0, 400));
if (r.s >= 400) {
  r = await req('/api/admin/wallet/adjust', { method: 'POST', body: JSON.stringify({ userId: r.j?.details?.userId, amount: 1000000, note: 'QA test' }) });
  console.log('ADMIN ADJUST retry:', r.s, JSON.stringify(r.j).slice(0, 400));
}

// ---- 5. Customer logs in, checks balance, buys ----
reset();
r = await req('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: uname, password: 'Test123456' }) });
console.log('\nCUSTOMER LOGIN:', r.s, 'balance:', r.j?.user?.balance);

r = await req('/api/wallet');
console.log('WALLET:', r.s, 'balance:', r.j?.balance);

r = await req('/api/orders', { method: 'POST', body: JSON.stringify({ items: [{ productId: 'p-lic-week', quantity: 1 }] }) });
console.log('\nBUY ORDER:', r.s, JSON.stringify(r.j).slice(0, 500));
const oid = r.j?.order?.id;
const ocode = r.j?.order?.code;

if (oid) {
  r = await req(`/api/orders/${oid}/pay`, { method: 'POST', body: '{}' });
  console.log('\nPAY with balance:', r.s);
  console.log(JSON.stringify(r.j).slice(0, 900));

  r = await req(`/api/orders/${oid}`);
  console.log('\nGET ORDER detail:', r.s, JSON.stringify(r.j).slice(0, 700));

  r = await req('/api/licenses/mine');
  console.log('\nMY LICENSES:', r.s, JSON.stringify(r.j).slice(0, 700));

  r = await req('/api/wallet');
  console.log('\nWALLET after:', r.s, 'balance:', r.j?.balance);
}
console.log('\nORDER CODE:', ocode);
