/**
 * Kiểm tra bảo mật: mọi endpoint admin phải chặn người không có quyền.
 */
const B = 'https://xienhl.com';
import { readFileSync } from 'node:fs';
const PW = readFileSync('ADMIN_CREDENTIALS.txt', 'utf8')
  .match(/Mat khau\s*:\s*(\S+)/)[1];

let pass = 0, fail = 0;
const ok = (n, c, x = '') => {
  if (c) { pass++; }
  else { fail++; console.log(`  ❌ ${n} ${x}`); }
};

const ADMIN_ENDPOINTS = [
  ['GET', '/api/admin/dashboard'],
  ['GET', '/api/admin/users'],
  ['GET', '/api/admin/orders'],
  ['GET', '/api/admin/topups'],
  ['GET', '/api/admin/products'],
  ['GET', '/api/admin/licenses'],
  ['GET', '/api/admin/settings'],
  ['GET', '/api/admin/logs'],
  ['GET', '/api/admin/trial/accounts'],
  ['GET', '/api/admin/trial/uses'],
  ['GET', '/api/admin/trial/resets'],
  ['GET', '/api/admin/trial/whitelist'],
  ['POST', '/api/admin/trial/whitelist'],
  ['POST', '/api/admin/trial/reset'],
  ['POST', '/api/admin/trial/grant'],
  ['POST', '/api/admin/trial/ban'],
  ['POST', '/api/admin/wallet/adjust'],
  ['POST', '/api/admin/settings'],
  ['GET', '/api/admin/telegram/status'],
];

(async () => {
  console.log('\n🔒 KIỂM TRA BẢO MẬT ADMIN ROUTES\n');

  // 1. Không có cookie
  console.log('1️⃣  Không đăng nhập (phải 401):');
  let leaked = 0;
  for (const [method, ep] of ADMIN_ENDPOINTS) {
    const r = await fetch(B + ep, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: method === 'POST' ? '{}' : undefined,
    });
    if (r.status === 200) {
      console.log(`  ❌ ${method} ${ep} -> 200 (RÒ RỈ!)`);
      leaked++;
      fail++;
    } else {
      ok(`${method} ${ep}`, r.status === 401 || r.status === 403, `status=${r.status}`);
    }
  }
  console.log(`  ${leaked === 0 ? '✅ Tất cả đều chặn' : `❌ ${leaked} endpoint rò rỉ`}`);

  // 2. Dùng cookie user thường
  console.log('\n2️⃣  Đăng nhập user thường (phải 403):');
  const uname = 'secur' + Date.now().toString().slice(-8);
  const reg = await fetch(B + '/api/auth/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: uname, password: 'abc123' }),
  });
  const uck = reg.headers.get('set-cookie')?.match(/mbk_session=[^;]+/)?.[0];

  if (!uck) {
    console.log('  ⚠️  không tạo được user test, bỏ qua');
  } else {
    let leaked2 = 0;
    for (const [method, ep] of ADMIN_ENDPOINTS) {
      const r = await fetch(B + ep, {
        method,
        headers: { 'Content-Type': 'application/json', Cookie: uck },
        body: method === 'POST' ? '{}' : undefined,
      });
      if (r.status === 200) {
        console.log(`  ❌ ${method} ${ep} -> 200 (LEO THANG ĐẶC QUYỀN!)`);
        leaked2++;
        fail++;
      } else {
        ok(`${method} ${ep}`, r.status === 403 || r.status === 401, `status=${r.status}`);
      }
    }
    console.log(`  ${leaked2 === 0 ? '✅ Tất cả đều chặn user thường' : `❌ ${leaked2} endpoint cho phép user`}`);
  }

  // 3. Admin thật phải vào được
  console.log('\n3️⃣  Admin thật (phải 200):');
  const lr = await fetch(B + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'namhbcf', password: PW }),
  });
  const ack = lr.headers.get('set-cookie')?.match(/mbk_session=[^;]+/)?.[0];

  let adminFail = 0;
  for (const [method, ep] of ADMIN_ENDPOINTS) {
    if (method === 'POST') continue; // không muốn tạo dữ liệu
    const r = await fetch(B + ep, { headers: { Cookie: ack } });
    if (r.status !== 200) {
      console.log(`  ❌ ${ep} -> ${r.status}`);
      adminFail++;
      fail++;
    } else {
      ok(ep, true);
    }
  }
  console.log(`  ${adminFail === 0 ? '✅ Admin vào được tất cả' : `❌ ${adminFail} endpoint lỗi với admin`}`);

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Tổng: ${pass + fail}  |  ✅ ${pass}  |  ❌ ${fail}`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => { console.error('💥', e.message); process.exit(1); });
