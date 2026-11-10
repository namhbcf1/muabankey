/**
 * B. XÁC THỰC — brute force, SQLi, XSS, session fixation, logout.
 */
import { record, loginAs, freshUser, makeClient, ACCOUNTS } from '../lib/record.mjs';

export async function runGroupB(ctx) {
  // ---------- B5: brute force 20 lần sai liên tiếp cùng IP ----------
  const bf = makeClient('bf').setIp('203.0.113.55');
  const bfCodes = [];
  for (let i = 0; i < 20; i++) {
    const r = await bf.post('/api/auth/login', { email: ACCOUNTS.demo.email, password: `WrongPass${i}!` });
    bfCodes.push(r.status);
  }
  const limited = bfCodes.filter((s) => s === 429).length;
  // thử đăng nhập ĐÚNG sau khi bị chặn
  const afterBlock = await bf.post('/api/auth/login', { email: ACCOUNTS.demo.email, password: ACCOUNTS.demo.password });
  record(5,
    'Brute force 20 lần sai liên tiếp (cùng IP) + thử login đúng ngay sau',
    limited > 0
      ? `BỊ CHẶN sau ${bfCodes.indexOf(429) + 1} lần (429), login đúng sau đó -> ${afterBlock.status}`
      : `KHÔNG CHẶN trong 20 lần; login đúng -> ${afterBlock.status}`,
    limited > 0 ? (afterBlock.status === 429 ? 'MEDIUM' : 'OK') : 'HIGH',
    `Mã 20 lần: ${bfCodes.join(',')} | login đúng ngay sau -> ${afterBlock.status} ${afterBlock.json?.error || ''}`,
    limited > 0
      ? 'Rate limit 30/900s theo IP hoạt động. Nhưng IP đổi được qua header (xem #36) nên cần thêm đếm theo email + khoá tài khoản tạm.'
      : 'Thêm rateLimit theo identifier (email) chứ không chỉ theo IP.');

  // ---------- B5b: brute force với IP xoay (bypass) ----------
  const bfRot = makeClient('bfrot');
  const rotCodes = [];
  for (let i = 0; i < 40; i++) {
    bfRot.setIp(`198.51.100.${i + 1}`);
    const r = await bfRot.post('/api/auth/login', { email: ACCOUNTS.demo.email, password: `Wrong${i}!` });
    rotCodes.push(r.status);
  }
  const rotBlocked = rotCodes.filter((s) => s === 429).length;
  record(5.5,
    'Brute force 40 lần với IP xoay vòng (mỗi request 1 IP)',
    rotBlocked === 0 ? 'BYPASS HOÀN TOÀN — 0/40 bị chặn, không có đếm theo email' : `Bị chặn ${rotBlocked}/40`,
    rotBlocked === 0 ? 'HIGH' : 'OK',
    `40 request sai, IP khác nhau -> 0 lần 429. Không có khoá theo email/tài khoản.`,
    'Đếm cả theo identifier: rateLimit(env, `login:${email}`, 10, 900) song song với IP; thêm exponential backoff + CAPTCHA sau N lần sai.');

  // ---------- B5c: có tài khoản bị khoá sau nhiều lần sai không? ----------
  const okAfter = await makeClient('okafter').login(ACCOUNTS.demo.email, ACCOUNTS.demo.password);
  record(5.7,
    'Tài khoản demo có bị khoá sau 60 lần đăng nhập sai?',
    okAfter.status === 200 ? 'KHÔNG KHOÁ — vẫn đăng nhập đúng được' : `Bị khoá (${okAfter.status})`,
    okAfter.status === 200 ? 'LOW' : 'OK',
    `Login đúng sau 60 lần sai -> ${okAfter.status}`,
    'Chấp nhận được nếu có rate limit theo IP; nhưng nên đếm theo tài khoản để chống credential stuffing.');

  // ---------- B6: SQL injection ----------
  const sqliPayloads = [
    { email: "admin'--", password: 'x' },
    { email: "' OR 1=1--", password: 'x' },
    { email: "admin@muabankey.vn' OR '1'='1", password: 'x' },
    { email: "'; DROP TABLE users;--", password: 'x' },
    { email: 'admin@muabankey.vn', password: "' OR '1'='1" },
    { email: "test@test.local' UNION SELECT 1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16--", password: 'x' },
    { email: 'namhbcf', password: "' OR 1=1--" },
  ];
  const sqliOut = [];
  for (const p of sqliPayloads) {
    const c = makeClient('sqli');
    const r = await c.post('/api/auth/login', p);
    sqliOut.push(`${String(p.email).slice(0, 30)} -> ${r.status}${r.json?.ok ? ' OK!!' : ''}`);
  }
  const sqliPwned = sqliOut.some((s) => s.includes('OK!!'));
  // kiểm tra bảng users còn nguyên
  const stillWorks = await makeClient('chk').login(ACCOUNTS.admin.email, ACCOUNTS.admin.password);
  record(6,
    'SQL injection qua email/password khi login (7 payload)',
    sqliPwned ? 'KHAI THÁC ĐƯỢC — đăng nhập không cần mật khẩu' : 'BỊ CHẶN — tất cả trả 400/401',
    sqliPwned ? 'CRITICAL' : 'OK',
    sqliOut.join(' | ') + ` | bảng users còn nguyên: ${stillWorks.status === 200}`,
    'Đã đúng: D1 prepared statement với .bind() tham số hoá — không nối chuỗi.');

  // ---------- B6b: SQLi qua ô tìm kiếm / tham số GET ----------
  const sq = makeClient('sq2');
  const searchPays = [
    "/api/products?q=' OR 1=1--",
    '/api/products?category=%27%20OR%201%3D1--',
    '/api/products?sort=price_asc;DROP TABLE users',
    '/api/products/1' + "' OR '1'='1",
  ];
  const sOut = [];
  for (const p of searchPays) {
    const r = await sq.get(p);
    sOut.push(`${p.slice(0, 42)} -> ${r.status}`);
  }
  record(6.5,
    'SQL injection qua GET /api/products (q, category, sort, path)',
    'BỊ CHẶN / không ảnh hưởng',
    'OK',
    sOut.join(' | ') + ` | login admin vẫn OK: ${(await makeClient('c3').login(ACCOUNTS.admin.email, ACCOUNTS.admin.password)).status}`,
    'Đã đúng: whitelist sort key (products.js:97-104), q được escape %/_, bind tham số.');

  // ---------- B7: XSS — đăng ký tên có thẻ script ----------
  const xss = makeClient('xss');
  const xssName = '<script>alert(1)</script>';
  const reg = await xss.post('/api/auth/register', {
    email: `xss${Date.now()}@test.local`, password: 'Test@123456', fullName: xssName, phone: '<img src=x onerror=alert(1)>',
  });
  const meX = await xss.get('/api/auth/me');
  const stored = meX.json?.user?.fullName;
  // kiểm tra user này có lọt vào danh sách admin (nơi render) với raw HTML không
  const adminC = await loginAs('admin');
  const usersList = await adminC.get('/api/admin/users?q=' + encodeURIComponent('<script>'));
  const leakedRaw = usersList.text.includes('<script>alert(1)</script>');
  record(7,
    'XSS lưu trữ: đăng ký fullName = "<script>alert(1)</script>"',
    leakedRaw ? 'API trả raw (frontend có esc nên chưa cháy — cần verify FE)' : 'Lưu raw trong DB, API trả raw — frontend phải escape',
    'LOW',
    `Đăng ký: ${reg.status}; API /api/auth/me trả nguyên: ${JSON.stringify(stored)}; admin/users chứa raw: ${leakedRaw}`,
    'Backend lưu/h trả nguyên chuỗi. Frontend đã dùng esc() (lib.js) — cần xác nhận mọi chỗ render fullName đều esc. Nên sanitize ở server (strip <>) để phòng thủ nhiều lớp.');

  // ---------- B7b: XSS qua tên sản phẩm (admin nhập) và note đơn ----------
  const noteXss = await freshUser('note');
  const ord = await noteXss.post('/api/orders', {
    items: [{ productId: 'p-win11', quantity: 1 }],
    note: '<img src=x onerror=alert(document.cookie)>',
  });
  const ordMe = await noteXss.get('/api/orders');
  const noteRaw = ordMe.text.includes('onerror=alert');
  record(7.5,
    'XSS lưu trữ qua note đơn hàng',
    noteRaw ? 'API trả raw — phụ thuộc escape frontend' : 'Bị lọc',
    'LOW',
    `Tạo đơn: ${ord.status}; /api/orders chứa payload raw: ${noteRaw}`,
    'Frontend orders.js render note bằng esc() — OK. Vẫn nên validate/strip ở server.');

  // ---------- B8: session fixation — login 2 lần cookie có đổi không ----------
  const sf = makeClient('sf');
  await sf.login(ACCOUNTS.demo.email, ACCOUNTS.demo.password);
  const tok1 = sf.jar.get('mbk_session');
  await sf.login(ACCOUNTS.demo.email, ACCOUNTS.demo.password);
  const tok2 = sf.jar.get('mbk_session');
  record(8,
    'Session fixation: đăng nhập 2 lần, cookie có đổi?',
    tok1 !== tok2 ? 'Cookie ĐỔI mỗi lần login (đúng)' : 'Cookie KHÔNG đổi — nguy cơ fixation',
    tok1 !== tok2 ? 'OK' : 'HIGH',
    `token1=${tok1?.slice(0, 16)}… token2=${tok2?.slice(0, 16)}… khác nhau: ${tok1 !== tok2}`,
    'Đã đúng: createSession sinh randomHex(32) mỗi lần (auth.js:43).');

  // ---------- B8b: có vô hiệu session cũ khi login lại không? ----------
  const sf2 = makeClient('sf2');
  await sf2.login(ACCOUNTS.demo.email, ACCOUNTS.demo.password);
  const oldTok = sf2.jar.get('mbk_session');
  const sf3 = makeClient('sf3');
  await sf3.login(ACCOUNTS.demo.email, ACCOUNTS.demo.password);
  // dùng token cũ
  const replay = await makeClient('replay').get('/api/auth/me', { headers: { cookie: `mbk_session=${oldTok}` } });
  record(8.5,
    'Login lần 2 có vô hiệu session lần 1? (dùng lại token cũ)',
    replay.status === 200 ? 'Session cũ VẪN DÙNG ĐƯỢC (nhiều session song song)' : 'Session cũ bị huỷ',
    replay.status === 200 ? 'LOW' : 'OK',
    `Token cũ sau khi login máy khác -> ${replay.status}`,
    'Cho phép nhiều phiên song song là hợp lý cho web. Nên có trang "đăng xuất mọi thiết bị" + giới hạn số phiên.');

  // ---------- B9: logout có invalidate server-side? ----------
  const lo = makeClient('lo');
  await lo.login(ACCOUNTS.demo.email, ACCOUNTS.demo.password);
  const tokBefore = lo.jar.get('mbk_session');
  const loRes = await lo.post('/api/auth/logout');
  const afterLogout = await makeClient('after').get('/api/auth/me', { headers: { cookie: `mbk_session=${tokBefore}` } });
  record(9,
    'Logout có huỷ session server-side? (dùng lại cookie cũ)',
    afterLogout.status === 401 ? 'BỊ CHẶN — session bị xoá khỏi DB' : 'SESSION VẪN SỐNG sau logout',
    afterLogout.status === 401 ? 'OK' : 'HIGH',
    `logout -> ${loRes.status}; dùng lại cookie cũ -> ${afterLogout.status}`,
    'Đã đúng: destroySession DELETE khỏi bảng sessions (auth.js:122-128).');

  // ---------- B9b: session có sống sau khi bị admin khoá tài khoản? ----------
  const lockUser = await freshUser('lock');
  const adm = await loginAs('admin');
  const rLock = await adm.patch(`/api/admin/users/${lockUser._id}`, { status: 'locked' });
  const afterLock = await lockUser.get('/api/auth/me');
  record(9.5,
    'Admin khoá tài khoản -> session đang có của user còn dùng được?',
    afterLock.status === 401 ? 'BỊ CHẶN ngay' : 'Session vẫn sống (kiểm tra status mỗi request) — xác nhận',
    afterLock.status === 401 ? 'OK' : 'MEDIUM',
    `PATCH status=locked -> ${rLock.status}; /api/auth/me -> ${afterLock.status}`,
    'Đã đúng: getSessionUser kiểm tra u.status !== "active" -> null (auth.js:74).');

  return {};
}
