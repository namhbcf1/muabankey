/**
 * E2E CUỐI: lấy token THẬT từ web, rồi thử đổi máy bằng
 *   (a) EXE đang phát hành  (deployed, sha C72484...)
 *   (b) source đã fix       (tool/src/xa_nofog_pro.py)
 * In ra lệnh để chạy tay.
 */
import { readFileSync, writeFileSync } from 'node:fs';
const B = 'https://xienhl.com';

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

const adm = await login('namhbcf', readFileSync('ADMIN_CREDENTIALS.txt', 'utf8').match(/Mat khau\s*:\s*(\S+)/)[1]);
const demo = await login('demo@muabankey.vn', 'Demo@123456');

const made = await call('/api/admin/licenses', {
  method: 'POST', cookie: adm, body: { count: 1, days: 30, prefix: 'E2E', note: 'E2E rebind token test' },
});
const KEY = made.data.keys[0];
console.log(`KEY = ${KEY}`);

// gán máy cũ
const a1 = await call('/api/activate', { method: 'POST', body: { key: KEY, hwid: 'p' + 'p'.repeat(31), app: 'XArena No Fog' } });
console.log(`activate máy cũ: HTTP ${a1.status} first_bind=${a1.data.first_bind}`);

// admin gán key cho demo để demo bấm được nút (mô phỏng khách đã mua)
// -> không có API, nên dùng chính admin lấy token qua đường admin không được.
// Dùng license demo có sẵn: AOE1-GFFZ... đã bị revoke. Tạo key mới + ghi license_issues
// không được qua API -> dùng key demo cũ (đã hết lượt) => admin reset trước.
console.log('\nChuẩn bị key demo: admin reset để trả lại lượt đổi máy');
const demoKey = 'AOE1-GFFZ-HZZN-TJTD';
await call(`/api/admin/licenses/${demoKey}/unrevoke`, { method: 'POST', cookie: adm });
const reset = await call(`/api/admin/licenses/${demoKey}/reset-hwid`, { method: 'POST', cookie: adm });
console.log(`  reset: HTTP ${reset.status} status=${reset.data.license?.status} rebinds=${reset.data.license?.rebinds}/${reset.data.license?.maxRebind}`);

// khách bấm nút
const rb = await call(`/api/licenses/${demoKey}/rebind`, { method: 'POST', cookie: demo });
console.log(`\nKhách bấm "Đổi máy": HTTP ${rb.status} rebindsLeft=${rb.data?.rebindsLeft}`);
const TOKEN = rb.data?.token;
console.log(`TOKEN = ${TOKEN}`);

writeFileSync('scripts/_e2e-cmd.txt',
  `$env:TEMP\\dl_exe.exe --rebind "${demoKey}" "${TOKEN}"\n`
  + `python tool/src/xa_nofog_pro.py --rebind "${demoKey}" "${TOKEN}"\n`);

// dọn key E2E
await call(`/api/admin/licenses/${encodeURIComponent(KEY)}/revoke`, { method: 'POST', cookie: adm });
console.log(`\n(dọn key ${KEY})`);
console.log(`\nToken thật đã ghi vào scripts/_e2e-cmd.txt để chạy tay.`);
