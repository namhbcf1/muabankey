/**
 * TEST: key do admin tạo tay (adminIssueLicenses) có hiện trên trang khách không?
 * adminIssueLicenses() -> issueLicenses() -> INSERT licenses
 * KHÔNG tạo dòng license_issues -> myLicenses() JOIN license_issues -> KHÔNG THẤY
 * => khách không có nút "Đổi máy" với key admin tặng
 */
import { readFileSync } from 'node:fs';
const B = process.argv[2] || 'https://xienhl.com';
const pw = readFileSync('ADMIN_CREDENTIALS.txt', 'utf8').match(/Mat khau\s*:\s*(\S+)/)[1];

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

const adm = await login('namhbcf', pw);
const demo = await login('demo@muabankey.vn', 'Demo@123456');

console.log('\n=== TEST: key admin tặng có nút "Đổi máy" trên trang khách không? ===\n');
const made = await call('/api/admin/licenses', {
  method: 'POST', cookie: adm, body: { count: 1, days: 30, prefix: 'GIFT', note: 'TEST key admin tang' },
});
const KEY = made.data.keys[0];
console.log(`1) Admin tạo key: ${KEY}  (HTTP ${made.status})`);

console.log('\n2) Máy khách kích hoạt key đó');
const act = await call('/api/activate', { method: 'POST', body: { key: KEY, hwid: 'g' + 'g'.repeat(31), app: 'XArena No Fog' } });
console.log(`   HTTP ${act.status} ok=${act.data.ok} first_bind=${act.data.first_bind}`);

console.log('\n3) Khách vào trang /#/licenses -> /api/licenses/mine');
const mine = await call('/api/licenses/mine', { cookie: demo });
const found = (mine.data.licenses || []).some((l) => l.key === KEY);
console.log(`   HTTP ${mine.status}  tổng license của demo: ${mine.data.licenses?.length}`);
console.log(`   Key admin tặng có trong danh sách? ${found ? 'CÓ' : '❌ KHÔNG'}`);

console.log('\n4) Khách thử bấm "Đổi máy" cho key đó (nếu thấy)');
const rb = await call(`/api/licenses/${encodeURIComponent(KEY)}/rebind`, { method: 'POST', cookie: demo });
console.log(`   HTTP ${rb.status} code=${rb.data?.code} msg=${rb.data?.msg || rb.data?.error}`);

console.log('\n5) Khách thử lấy lệnh cài cho key admin tặng');
const it = await call(`/api/licenses/${encodeURIComponent(KEY)}/install-token`, { method: 'POST', cookie: demo });
console.log(`   HTTP ${it.status} code=${it.data?.code} msg=${it.data?.msg || it.data?.error}`);

console.log('\n──────── KẾT LUẬN ────────');
if (!found) {
  console.log('  🚨 Key do ADMIN TẠO TAY không xuất hiện trên trang "License của tôi".');
  console.log('     => Khách không thấy nút "Đổi máy", không lấy được lệnh cài.');
  console.log('     => Vì adminIssueLicenses() KHÔNG ghi bảng license_issues,');
  console.log('        còn myLicenses()/rebindMyLicense() lại JOIN/đòi bảng đó.');
  console.log('     => Đây là lý do phổ biến nhất khiến chủ shop bảo "reset HWID chưa được":');
  console.log('        key tặng khách (bù lỗi) là key admin tạo tay.');
}

// dọn
await call(`/api/admin/licenses/${encodeURIComponent(KEY)}/revoke`, { method: 'POST', cookie: adm });
console.log(`\n  (đã thu hồi key test ${KEY})`);
