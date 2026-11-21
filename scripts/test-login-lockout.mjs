/**
 * test-login-lockout.mjs — kiểm chứng lockout theo TÀI KHOẢN.
 *
 * Trước khi vá: chỉ có rate limit theo IP (500/15 phút), không có bộ đếm
 * theo tên tài khoản -> đổi IP là dò được mật khẩu không giới hạn.
 * Sau khi vá: sai 10 lần trong 15 phút -> khoá tài khoản đó (429), kể cả
 * khi nhập đúng mật khẩu.
 *
 * Chạy: node scripts/test-login-lockout.mjs [baseUrl]
 */
const BASE = process.argv[2] || 'http://127.0.0.1:8798';
const USER = process.env.ADMIN_USER || '${QA_ADMIN_USER}';
const RIGHT = process.env.ADMIN_PASSWORD || '${QA_ADMIN_PASSWORD}';
const LIMIT = 10;

let pass = 0, fail = 0;
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`); }
}

async function attempt(password) {
  const res = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USER, password }),
  });
  let data = null;
  try { data = await res.json(); } catch { /* */ }
  return { status: res.status, code: data?.code };
}

console.log(`=== Dò mật khẩu ${LIMIT} lần vào tài khoản "${USER}" ===`);
let sawLock = false;
let lockAt = -1;
for (let i = 1; i <= LIMIT; i++) {
  const r = await attempt('sai-mat-khau-' + i);
  if (r.code === 'TOO_MANY_ATTEMPTS') {
    if (!sawLock) { sawLock = true; lockAt = i; }
  }
}
ok(`bị khoá sau tối đa ${LIMIT} lần sai`, sawLock, sawLock ? `khoá ở lần ${lockAt}` : 'KHÔNG BAO GIỜ KHOÁ');

console.log('\n=== Sau khi khoá: mật khẩu ĐÚNG vẫn phải bị chặn ===');
{
  const r = await attempt(RIGHT);
  ok('mật khẩu đúng -> vẫn 429 (buộc chờ)',
    r.status === 429 && r.code === 'TOO_MANY_ATTEMPTS',
    `status=${r.status} code=${r.code}`);
}

console.log('\n=== Tài khoản KHÁC vẫn đăng nhập được (không khoá oan) ===');
{
  const res = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'khong_ton_tai_xyz', password: 'whatever123' }),
  });
  let data = null;
  try { data = await res.json(); } catch { /* */ }
  ok('tài khoản khác không bị ảnh hưởng',
    data?.code !== 'TOO_MANY_ATTEMPTS',
    `status=${res.status} code=${data?.code}`);
}

console.log('\n' + '─'.repeat(52));
console.log(`Tổng: ${pass + fail}  |  ✅ ${pass}  |  ❌ ${fail}`);
if (fail) process.exit(1);
console.log('🎉 LOCKOUT THEO TÀI KHOẢN HOẠT ĐỘNG');
console.log('\nLưu ý: chờ 15 phút hoặc xoá KV key "lf:<username>" để mở lại.');
