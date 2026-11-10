/**
 * KIỂM CHỨNG LUỒNG ADMIN RESET trên PRODUCTION:
 * admin reset -> máy cũ check (phải bị chặn) -> máy mới bind
 */
import { readFileSync } from 'node:fs';
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

/* key test riêng, không đụng key khách */
const made = await call('/api/admin/licenses', {
  method: 'POST', cookie: adm,
  body: { count: 1, days: 30, prefix: 'RST', note: 'Test admin reset production' },
});
const KEY = made.data.keys[0];
console.log(`\nKEY = ${KEY}`);
const OLD = 'o'.repeat(32), NEW = 'n'.repeat(32);

console.log('\n1) Máy CŨ activate');
let r = await call('/api/activate', { method: 'POST', body: { key: KEY, hwid: OLD, app: 'X' } });
console.log(`   HTTP ${r.status} first_bind=${r.data.first_bind}`);

console.log('\n2) Admin bấm "Reset máy"');
r = await call(`/api/admin/licenses/${encodeURIComponent(KEY)}/reset-hwid`, { method: 'POST', cookie: adm });
console.log(`   HTTP ${r.status} bound=${r.data.license?.bound} status=${r.data.license?.status} resetPending=${r.data.license?.resetPending}`);

console.log('\n3) ⚠️ Máy CŨ tự /api/check (tool nền 30 phút/lần)');
r = await call('/api/check', { method: 'POST', body: { key: KEY, hwid: OLD, app: 'X' } });
console.log(`   HTTP ${r.status} ok=${r.data.ok} code=${r.data.code || '-'} msg=${r.data.msg || ''}`);
const oldBlocked = r.status === 403;

const after = await call('/api/admin/licenses?q=' + encodeURIComponent(KEY), { cookie: adm });
const L = after.data.licenses.find((x) => x.key === KEY);
console.log(`   DB: hwid=${L?.bound ? L.hwidMasked : 'NULL'} rebinds=${L?.rebinds}/${L?.maxRebind}`);

console.log('\n4) Máy MỚI activate (không token — phải bị chặn)');
r = await call('/api/activate', { method: 'POST', body: { key: KEY, hwid: NEW, app: 'X' } });
console.log(`   HTTP ${r.status} ok=${r.data.ok} code=${r.data.code || '-'} msg=${r.data.msg || ''}`);

console.log('\n5) Admin cấp token qua đường khách: không được (admin không sở hữu)');
r = await call('/api/licenses/' + encodeURIComponent(KEY) + '/rebind', { method: 'POST', cookie: adm });
console.log(`   HTTP ${r.status} code=${r.data.code || '-'} ${r.data.msg || r.data.error || ''}`);

console.log('\n6) Admin bấm "Reset máy" lần 2-> rồi tự activate qua admin? thử revoke để dọn');

console.log('\n──────── KẾT LUẬN ────────');
console.log(`  Máy cũ bị chặn sau reset : ${oldBlocked ? '✅ CÓ' : '❌ KHÔNG — reset vẫn hở'}`);
console.log(`  reset_pending có trong API: ${L?.resetPending !== undefined ? '✅ CÓ (server mới đã deploy)' : '❌ KHÔNG (server cũ)'}`);
console.log(`  hwid trong DB             : ${L?.bound ? L.hwidMasked : 'NULL'}`);

// dọn
await call(`/api/admin/licenses/${encodeURIComponent(KEY)}/revoke`, { method: 'POST', cookie: adm });
console.log(`\n  (đã thu hồi ${KEY})`);
