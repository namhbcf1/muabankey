/**
 * KIỂM CHỨNG CUỐI TRÊN PRODUCTION: EXE mới (có --rebind) + server
 * Kịch bản thật: mua key -> activate máy cũ -> web cấp token -> EXE MỚI --rebind trên máy mới
 */
import { readFileSync, writeFileSync } from 'node:fs';
const B = 'https://xienhl.com';
const EXE = process.env.TEMP + '\\dl2.exe';

async function login(email, password) {
  const r = await fetch(B + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  return r.headers.get('set-cookie')?.match(/mbk_session=[^;]+/)?.[0] || null;
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
const lic = (path, payload) => call(path, { method: 'POST', body: payload });

const adm = await login('namhbcf', readFileSync('ADMIN_CREDENTIALS.txt', 'utf8').match(/Mat khau\s*:\s*(\S+)/)[1]);

// user mới để có bucket rate-limit riêng
const email = `fin${Date.now().toString(36)}@test.vn`, PW = 'Test123456';
await call('/api/auth/register', { method: 'POST', body: { email, password: PW, fullName: 'Final Test' } });
const usr = await login(email, PW);
const me = await call('/api/auth/me', { cookie: usr });
const uid = me.data.user.id;

await call('/api/admin/wallet/adjust', { method: 'POST', cookie: adm, body: { userId: uid, amount: 500000, reason: 'Final E2E' } });
const prods = await call('/api/products?category=license-xarena&perPage=20');
const week = prods.data.products.find((p) => p.slug === 'license-xarena-tuan');
const order = await call('/api/orders', { method: 'POST', cookie: usr, body: { items: [{ productId: week.id, quantity: 1 }] } });
const pay = await call(`/api/orders/${order.data.order.id}/pay`, { method: 'POST', cookie: usr });
const KEY = pay.data.order.delivered[0].raw[0];
console.log(`KEY = ${KEY}`);

console.log('\n1) Máy CŨ kích hoạt');
let r = await lic('/api/activate', { key: KEY, hwid: 'o'.repeat(32), app: 'XArena No Fog' });
console.log(`   HTTP ${r.status} first_bind=${r.data.first_bind}`);

console.log('\n2) Khách bấm "Đổi máy" trên web');
r = await call(`/api/licenses/${encodeURIComponent(KEY)}/rebind`, { method: 'POST', cookie: usr });
console.log(`   HTTP ${r.status} rebindsLeft=${r.data.rebindsLeft}`);
const TOKEN = r.data.token;
console.log(`   token = ${TOKEN}`);

writeFileSync('scripts/_final-cmd.txt', `--rebind ${KEY} ${TOKEN}\n`);
console.log(`\n3) Chạy EXE MỚI (đã deploy) trên MÁY MỚI:`);
console.log(`   ${EXE} --rebind ${KEY} ${TOKEN}`);
console.log('\n   (script con sẽ chạy lệnh này tiếp theo)');
