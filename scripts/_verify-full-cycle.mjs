/**
 * KIỂM CHỨNG VÒNG ĐẦY ĐỦ trên production:
 * mua key (customer thật) -> admin reset -> khách bấm "Đổi máy" -> EXE mới --rebind -> chạy được
 */
import { readFileSync, writeFileSync } from 'node:fs';
const B = 'https://xienhl.com';

async function login(e, p) {
  const r = await fetch(B + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: e, password: p }),
  });
  return r.headers.get('set-cookie')?.match(/mbk_session=[^;]+/)?.[0] || null;
}
async function call(path, { method = 'GET', body, cookie } = {}) {
  const h = { Accept: 'application/json' };
  if (body) h['Content-Type'] = 'application/json';
  if (cookie) h.Cookie = cookie;
  const r = await fetch(B + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let d; try { d = JSON.parse(t); } catch { d = t; }
  return { status: r.status, data: d };
}
const adm = await login('namhbcf', readFileSync('ADMIN_CREDENTIALS.txt', 'utf8').match(/Mat khau\s*:\s*(\S+)/)[1]);

/* user + key thật */
const email = `cyc${Date.now().toString(36)}@test.vn`, PW = 'Test123456';
await call('/api/auth/register', { method: 'POST', body: { email, password: PW, fullName: 'Cycle' } });
const usr = await login(email, PW);
const uid = (await call('/api/auth/me', { cookie: usr })).data.user.id;
await call('/api/admin/wallet/adjust', { method: 'POST', cookie: adm, body: { userId: uid, amount: 500000, reason: 'cycle' } });
const prods = await call('/api/products?category=license-xarena&perPage=20');
const week = prods.data.products.find((p) => p.slug === 'license-xarena-tuan');
const o = await call('/api/orders', { method: 'POST', cookie: usr, body: { items: [{ productId: week.id, quantity: 1 }] } });
const p = await call(`/api/orders/${o.data.order.id}/pay`, { method: 'POST', cookie: usr });
const KEY = p.data.order.delivered[0].raw[0];
console.log(`KEY = ${KEY}`);

const H1 = 'a'.repeat(32), H2 = 'b'.repeat(32);

console.log('\n1) Máy 1 activate');
let r = await call('/api/activate', { method: 'POST', body: { key: KEY, hwid: H1, app: 'X' } });
console.log(`   HTTP ${r.status} first_bind=${r.data.first_bind}`);

console.log('\n2) ADMIN bấm "Reset máy" (đổi máy hộ khách — tình huống thật)');
r = await call(`/api/admin/licenses/${encodeURIComponent(KEY)}/reset-hwid`, { method: 'POST', cookie: adm });
console.log(`   HTTP ${r.status} bound=${r.data.license?.bound} status=${r.data.license?.status}`);
console.log(`   ⚠️ Khách đã dùng hết 1/1 lượt tự đổi — GIỜ ADMIN RESET, khách cần lấy token`);

console.log('\n3) Khách vào /#/licenses, API trả gì?');
r = await call('/api/licenses/mine', { cookie: usr });
const L = r.data.licenses.find((x) => x.key === KEY);
console.log(`   HTTP ${r.status}`);
console.log(`   status=${L?.status}  rebinds=${L?.rebinds}/${L?.maxRebind}  bound=${L?.bound}`);
console.log(`   → Nút "Đổi máy" hiện? ${['active', 'forever', 'expiring', 'unbound'].includes(L?.status) && L?.rebinds < L?.maxRebind ? 'CÓ' : '❌ KHÔNG'}`);

console.log('\n4) Khách bấm "Đổi máy" lấy token');
r = await call(`/api/licenses/${encodeURIComponent(KEY)}/rebind`, { method: 'POST', cookie: usr });
console.log(`   HTTP ${r.status} rebindsLeft=${r.data.rebindsLeft}`);
const TOKEN = r.data.token;
console.log(`   token = ${TOKEN}`);

if (TOKEN) {
  writeFileSync('scripts/_cycle-cmd.txt', `--rebind ${KEY} ${TOKEN}\n`);
  console.log(`\n5) Máy 2 chạy EXE MỚI:`);
  console.log(`   dl2.exe --rebind ${KEY} ${TOKEN.slice(0, 16)}…`);
}
