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
const reset = () => { cookie = ''; };

const uname = 'qac' + Date.now().toString(36).slice(-8);
let r = await req('/api/auth/register', { method: 'POST', body: JSON.stringify({ username: uname, password: 'Test123456' }) });
const userId = r.j?.user?.id;
console.log('REGISTER:', r.s, uname, '| userId:', userId);

reset();
r = await req('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'namhbcf', password: 'namhbcf123' }) });
r = await req('/api/admin/wallet/adjust', { method: 'POST', body: JSON.stringify({ userId, amount: 1000000, reason: 'QA topup test' }) });
console.log('ADMIN ADJUST:', r.s, JSON.stringify(r.j));

reset();
r = await req('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: uname, password: 'Test123456' }) });
console.log('CUSTOMER balance:', r.j?.user?.balance);

r = await req('/api/orders', { method: 'POST', body: JSON.stringify({ items: [{ productId: 'p-lic-week', quantity: 1 }] }) });
const oid = r.j?.order?.id;
console.log('ORDER:', r.s, r.j?.order?.code, 'total', r.j?.order?.total);

r = await req(`/api/orders/${oid}/pay`, { method: 'POST', body: '{}' });
console.log('\nPAY:', r.s, JSON.stringify(r.j).slice(0, 900));

r = await req(`/api/orders/${oid}`);
console.log('\nORDER after pay:', r.s, JSON.stringify(r.j).slice(0, 900));

r = await req('/api/licenses/mine');
console.log('\nMY LICENSES:', r.s, JSON.stringify(r.j).slice(0, 1200));

r = await req('/api/wallet');
console.log('\nWALLET:', r.s, 'balance:', r.j?.balance, 'txCount:', r.j?.transactions?.length);

// replay pay (idempotency / double-delivery check)
r = await req(`/api/orders/${oid}/pay`, { method: 'POST', body: '{}' });
console.log('\nPAY AGAIN (idempotency):', r.s, JSON.stringify(r.j).slice(0, 300));
r = await req('/api/wallet');
console.log('WALLET after 2nd pay:', r.s, 'balance:', r.j?.balance);

// check the license key actually works against license server
const myLics = (await req('/api/licenses/mine')).j?.licenses || [];
console.log('\nLICENSE COUNT:', myLics.length);
if (myLics[0]) {
  const k = myLics[0].key;
  reset();
  const act = await fetch(B + '/api/check', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: k, hwid: 'a'.repeat(32) }) });
  console.log('LICENSE CHECK:', act.status, (await act.text()).slice(0, 500));
}
