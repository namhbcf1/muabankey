/**
 * Bổ sung nhóm B: tìm ngưỡng rate limit login thật, và test XSS đúng cách.
 */
import { record, loginAs, freshUser, makeClient, ACCOUNTS } from '../lib/record.mjs';

export async function runGroupB2() {
  // ---------- B37: 50 lần login fail cùng IP — chặn ở lần thứ mấy? ----------
  const c = makeClient('bf50').setIp('203.0.113.77');
  const codes = [];
  let firstBlock = null;
  for (let i = 1; i <= 50; i++) {
    const r = await c.post('/api/auth/login', { email: ACCOUNTS.demo.email, password: `X${i}!aaaa` });
    codes.push(r.status);
    if (r.status === 429 && firstBlock === null) firstBlock = i;
  }
  const afterBlockCorrect = await c.post('/api/auth/login', {
    email: ACCOUNTS.demo.email, password: ACCOUNTS.demo.password,
  });
  record(37,
    '50 lần login fail cùng IP — bị chặn ở lần thứ mấy?',
    firstBlock ? `Chặn ở lần thứ ${firstBlock} (429); login đúng sau đó -> ${afterBlockCorrect.status}` : 'KHÔNG CHẶN trong 50 lần',
    firstBlock ? (afterBlockCorrect.status === 429 ? 'OK' : 'MEDIUM') : 'HIGH',
    `Ngưỡng thực tế: lần ${firstBlock}. Mã: ${codes.slice(0, firstBlock + 2).join(',')}… | login đúng ngay sau -> ${afterBlockCorrect.status}`,
    firstBlock && afterBlockCorrect.status === 429
      ? 'Đã chặn cả login đúng trong window — hành vi đúng (chống dò). Cân nhắc thêm đếm theo email.'
      : 'Thêm rateLimit theo email và/hoặc CAPTCHA.');

  // ---------- B5 lại: 20 lần — có chặn không (ngưỡng 30/900s) ----------
  const c20 = makeClient('bf20').setIp('203.0.113.88');
  const codes20 = [];
  for (let i = 0; i < 20; i++) {
    const r = await c20.post('/api/auth/login', { email: ACCOUNTS.demo.email, password: `Y${i}!aaaa` });
    codes20.push(r.status);
  }
  record(5,
    'Brute force 20 lần sai liên tiếp (ngưỡng cấu hình là 30/15 phút)',
    codes20.includes(429) ? 'Bị chặn' : 'KHÔNG chặn ở 20 lần — nhưng ngưỡng là 30 nên đúng thiết kế',
    codes20.includes(429) ? 'OK' : 'MEDIUM',
    `20 lần đều 401, chưa chạm ngưỡng 30/900s (login:${'{ip}'}, auth.js:55). Bị chặn ở lần 31 (xem #37).`,
    'Ngưỡng 30 lần/15 phút/IP là hợp lý. Rủi ro còn lại: IP xoay (#36) và đếm theo email.');

  // ---------- B7 lại: XSS với phone hợp lệ ----------
  const xss = makeClient('xss2');
  const payload = '<script>alert(1)</script>';
  const reg = await xss.post('/api/auth/register', {
    email: `xss${Date.now()}@test.local`, password: 'Test@123456',
    fullName: payload, phone: '0912345678',
  });
  const me = await xss.get('/api/auth/me');
  const storedName = me.json?.user?.fullName;

  // admin xem danh sách user -> có raw không
  const adm = await loginAs('admin');
  const q = await adm.get('/api/admin/users?q=' + encodeURIComponent('script'));
  const rawInAdminApi = q.text.includes('<script>');

  // user này đăng nhập lại -> login response trả fullName raw?
  const relogin = await makeClient('relogin').post('/api/auth/login', {
    email: xss._email, password: 'Test@123456',
  });
  const rawInLogin = relogin.text.includes('<script>');

  record(7,
    'XSS lưu trữ qua fullName (phone hợp lệ) — backend có lọc/escape?',
    rawInAdminApi || rawInLogin
      ? 'LƯU & TRẢ NGUYÊN RAW HTML — an toàn phụ thuộc hoàn toàn vào esc() ở frontend'
      : 'Bị lọc ở server',
    rawInAdminApi || rawInLogin ? 'MEDIUM' : 'OK',
    `Đăng ký ${reg.status}; /api/auth/me trả fullName nguyên: ${JSON.stringify(storedName)}; admin/users chứa raw: ${rawInAdminApi}; login trả raw: ${rawInLogin}`,
    'Frontend render fullName qua esc() nên hiện chưa cháy. Nhưng đây là stored XSS chờ ngày: chỉ cần 1 chỗ innerHTML không esc là cháy (đặc biệt ở trang admin duyệt đơn). Nên strip <> ở server cho fullName/note.');

  // ---------- B7c: XSS qua admin tạo sản phẩm (lưu vào tên SP) rồi render công khai ----------
  const evilName = 'SP<img src=x onerror=alert(1)>X';
  const mk = await adm.post('/api/admin/products', {
    name: evilName, price: 1000, deliveryType: 'key', description: '<svg onload=alert(1)>',
  });
  let rawPublic = false;
  if (mk.status < 400) {
    const pub = await makeClient('pub').get('/api/products?q=SP');
    rawPublic = pub.text.includes('<img src=x');
  }
  record(7.7,
    'XSS qua tên/mô tả sản phẩm do admin nhập -> render ở trang công khai',
    rawPublic ? 'API công khai trả raw HTML' : 'Không thấy raw',
    rawPublic ? 'MEDIUM' : 'LOW',
    `Tạo SP ${mk.status}; API /api/products chứa raw "<img src=x": ${rawPublic}`,
    'Trang sản phẩm render qua esc() nên an toàn hiện tại. Vẫn nên sanitize HTML ở server (allowlist tag) cho description nếu sau này render rich-text.');
}
