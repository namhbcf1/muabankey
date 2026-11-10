/**
 * E2E Ä‘áº§y Ä‘á»§ vá»›i user Má»šI (bucket rate-limit riÃªng):
 * Ä‘Äƒng kÃ½ -> admin náº¡p tiá»n -> mua license -> activate mÃ¡y cÅ© -> báº¥m "Äá»•i mÃ¡y" -> láº¥y token tháº­t
 */
import { readFileSync, writeFileSync } from 'node:fs';
const B = 'https://xienhl.com';

async function login(email, password) {
  const r = await fetch(B + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const ck = r.headers.get('set-cookie')?.match(/mbk_session=[^;]+/)?.[0] || null;
  let d = null; try { d = await r.json(); } catch {}
  return { status: r.status, cookie: ck, data: d };
}
async function call(path, { method = 'GET', body, cookie } = {}) {
  const h = { Accept: 'application/json' };
  if (body) h['Content-Type'] = 'application/json';
  if (cookie) h.Cookie = cookie;
  const r = await fetch(B + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  let d; try { d = JSON.parse(t); } catch { d = t; }
  return { status: r.status, data: d };
}

const admPw = readFileSync('ADMIN_CREDENTIALS.txt', 'utf8').match(/Mat khau\s*:\s*(\S+)/)[1];
const adm = await login('namhbcf', admPw);

const stamp = Date.now().toString(36);
const email = `rb${stamp}@test.vn`;
const PW = 'Test123456';
console.log(`\n1) ÄÄƒng kÃ½ user má»›i: ${email}`);
const reg = await call('/api/auth/register', { method: 'POST', body: { email, password: PW, fullName: 'Rebind Tester' } });
console.log(`   HTTP ${reg.status} ${JSON.stringify(reg.data).slice(0, 150)}`);
const usr = await login(email, PW);
console.log(`   login HTTP ${usr.status} cookie=${usr.cookie ? 'OK' : 'NONE'} id=${usr.data?.user?.id}`);
const uid = usr.data?.user?.id;

console.log('\n2) Admin náº¡p 500.000Ä‘ cho user');
const adj = await call('/api/admin/wallet/adjust', {
  method: 'POST', cookie: adm.cookie,
  body: { userId: uid, amount: 500000, reason: 'Test rebind HWID' },
});
console.log(`   HTTP ${adj.status} ${JSON.stringify(adj.data).slice(0, 160)}`);

console.log('\n3) User mua license tuáº§n');
const prods = await call('/api/products?category=license-xarena&perPage=20');
const week = prods.data.products.find((p) => p.slug === 'license-xarena-tuan');
const order = await call('/api/orders', { method: 'POST', cookie: usr.cookie, body: { items: [{ productId: week.id, quantity: 1 }] } });
console.log(`   táº¡o Ä‘Æ¡n HTTP ${order.status} ${order.data?.order?.code}`);
const pay = await call(`/api/orders/${order.data?.order?.id}/pay`, { method: 'POST', cookie: usr.cookie });
console.log(`   thanh toÃ¡n HTTP ${pay.status} ${pay.data?.order?.status}`);
const KEY = pay.data?.order?.delivered?.[0]?.raw?.[0];
console.log(`   ðŸ”‘ KEY = ${KEY}`);

console.log('\n4) KÃ­ch hoáº¡t trÃªn MÃY CÅ¨');
const a1 = await call('/api/activate', { method: 'POST', body: { key: KEY, hwid: 'p' + 'p'.repeat(31), app: 'XArena No Fog' } });
console.log(`   HTTP ${a1.status} first_bind=${a1.data.first_bind}`);

console.log('\n5) KhÃ¡ch báº¥m "ðŸ”„ Äá»•i mÃ¡y" trÃªn web');
const rb = await call(`/api/licenses/${encodeURIComponent(KEY)}/rebind`, { method: 'POST', cookie: usr.cookie });
console.log(`   HTTP ${rb.status} rebindsLeft=${rb.data?.rebindsLeft}`);
const TOKEN = rb.data?.token;
console.log(`   TOKEN = ${TOKEN}`);
console.log(`   lá»‡nh server gá»£i Ã½: ${rb.data?.command || '(khÃ´ng cÃ³)'}`);

writeFileSync('scripts/_e2e-vars.json', JSON.stringify({ KEY, TOKEN, uid, email }, null, 2));
console.log('\nâ†’ Ä‘Ã£ ghi scripts/_e2e-vars.json');
