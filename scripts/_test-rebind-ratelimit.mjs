/**
 * TEST: rate limit của /api/licenses/:key/rebind
 * rebindMyLicense() gọi rateLimit(`rebind:${user.id}:${ip}`, 5, 3600) TRƯỚC khi
 * kiểm quota -> khách bấm vài lần là bị khoá 1 giờ với thông báo sai.
 */
import { readFileSync } from 'node:fs';
const B = process.argv[2] || 'https://xienhl.com';

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

const demo = await login('demo@muabankey.vn', 'Demo@123456');
const mine = await call('/api/licenses/mine', { cookie: demo });
const lic = mine.data.licenses[0];
console.log(`\nLicense demo: ${lic.key}  đổi máy ${lic.rebinds}/${lic.maxRebind}  status=${lic.status}`);

console.log('\nGọi /api/licenses/:key/rebind liên tiếp 7 lần:');
const results = [];
for (let i = 1; i <= 7; i++) {
  const r = await call(`/api/licenses/${encodeURIComponent(lic.key)}/rebind`, { method: 'POST', cookie: demo });
  const code = r.data?.code || (r.data?.ok ? 'OK' : '?');
  const msg = r.data?.msg || r.data?.error || '';
  results.push({ i, status: r.status, code, msg: String(msg).slice(0, 60) });
  console.log(`  lần ${i}: HTTP ${r.status}  code=${code}  "${String(msg).slice(0, 60)}"`);
}

console.log('\n──────── ĐÁNH GIÁ ────────');
const limited = results.filter((r) => r.code === 'RATE_LIMITED');
const quota = results.filter((r) => r.code === 'REBIND_LIMIT');
console.log(`  Bị RATE_LIMITED: ${limited.length}/7`);
console.log(`  Nhận đúng REBIND_LIMIT: ${quota.length}/7`);
if (limited.length && !quota.length) {
  console.log('\n  🚨 LỖI UX: khách bấm "Đổi máy" vài lần (kể cả khi đã hết lượt) sẽ thấy');
  console.log('     "Bạn thao tác quá nhanh" thay vì "Đã hết số lần đổi máy".');
  console.log('     Nguyên nhân: rateLimit() đặt TRƯỚC kiểm tra quota + không kiểm tra gì cả.');
  console.log('     => Khách tưởng lỗi mạng, bấm tiếp, bị khoá thêm. Chủ shop tưởng "không hoạt động".');
}
