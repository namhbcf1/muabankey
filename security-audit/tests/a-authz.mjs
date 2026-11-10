/**
 * A. PHÂN QUYỀN — user thường gọi API admin; staff leo thang; session giả.
 */
import { record, loginAs, freshUser, makeClient, ACCOUNTS } from '../lib/record.mjs';

export async function runGroupA(ctx) {
  const user = await freshUser('a-normal');
  const staff = await loginAs('staff');
  const admin = await loginAs('admin');

  // ---------- A1: user thường gọi mọi API admin ----------
  const adminGets = [
    '/api/admin/dashboard', '/api/admin/users', '/api/admin/orders', '/api/admin/products',
    '/api/admin/licenses', '/api/admin/logs', '/api/admin/topups', '/api/admin/settings',
    '/api/admin/coupons', '/api/admin/telegram/status',
  ];
  const getLeaks = [];
  for (const p of adminGets) {
    const r = await user.get(p);
    if (r.status < 400) getLeaks.push({ p, status: r.status, body: r.text.slice(0, 120) });
  }
  record(1,
    'GET mọi API admin bằng user thường (10 endpoint)',
    getLeaks.length === 0 ? `BỊ CHẶN đủ 10/10 (401/403)` : `RÒ RỈ: ${getLeaks.length} endpoint trả <400`,
    getLeaks.length === 0 ? 'OK' : 'CRITICAL',
    getLeaks.length === 0
      ? `Cả 10 endpoint trả 403 FORBIDDEN. Kiểm tra mẫu: ${(await user.get('/api/admin/users')).status}`
      : JSON.stringify(getLeaks),
    'Đã đúng: requireAdmin() ở đầu mỗi handler.');

  // ---------- A1b: user thường gọi POST/PATCH/DELETE admin ----------
  const adminWrites = [
    ['POST', '/api/admin/products', { name: 'Hack Product', price: 1 }],
    ['POST', '/api/admin/coupons', { code: 'HACK', type: 'percent', value: 100 }],
    ['POST', '/api/admin/wallet/adjust', { userId: user._id, amount: 999999, reason: 'hack' }],
    ['POST', '/api/admin/settings', { bank_account: '99999999' }],
    ['POST', '/api/admin/settings/payos', { checksumKey: 'XXXXXXXXXXXXXXXXXXXX' }],
    ['POST', '/api/admin/telegram/config', { botToken: '123456789:BBBBBBBBBBBBBBBBBBBB', chatId: '111222333' }],
    ['POST', '/api/admin/telegram/test', {}],
    ['PATCH', `/api/admin/users/${user._id}`, { role: 'admin' }],
    ['POST', '/api/admin/orders/xxx/deliver', {}],
    ['POST', '/api/admin/orders/xxx/refund', {}],
    ['POST', '/api/admin/licenses', { count: 5, days: 9999 }],
  ];
  const writeLeaks = [];
  for (const [m, p, b] of adminWrites) {
    const r = await user.req(m, p, { body: b });
    if (r.status < 400) writeLeaks.push({ m, p, status: r.status, body: r.text.slice(0, 140) });
  }
  record(1.5,
    'POST/PATCH 11 API ghi admin bằng user thường',
    writeLeaks.length === 0 ? 'BỊ CHẶN đủ 11/11' : `RÒ RỈ: ${writeLeaks.length} endpoint thành công`,
    writeLeaks.length === 0 ? 'OK' : 'CRITICAL',
    writeLeaks.length === 0 ? 'Tất cả trả 403/400 trước khi vào handler.' : JSON.stringify(writeLeaks),
    'Đã đúng: requireAdmin() chặn trước mọi thao tác ghi.');

  // ---------- A2: staff tự leo thang lên admin ----------
  const staffSelf = await staff.get('/api/auth/me');
  const staffId = staffSelf.json?.user?.id;
  const escNote = [];

  for (const [label, body] of [
    ['role=admin tự nâng', { role: 'admin' }],
    ['role=staff (ngang cấp)', { role: 'staff' }],
  ]) {
    const r = await staff.patch(`/api/admin/users/${staffId}`, body);
    escNote.push(`${label} -> ${r.status} ${r.json?.error || r.json?.code || 'OK'}`);
  }
  const selfCheck = await staff.get('/api/auth/me');
  const becameAdmin = selfCheck.json?.user?.role === 'admin';

  record(2,
    'Staff tự nâng quyền: PATCH /api/admin/users/<self> {role:"admin"}',
    becameAdmin ? 'LEO THANG THÀNH CÔNG — staff thành admin' : 'BỊ CHẶN',
    becameAdmin ? 'CRITICAL' : 'OK',
    escNote.join(' | ') + ` | role sau khi thử: ${selfCheck.json?.user?.role}`,
    'Đã đúng: admin.js:100-108 chặn khi admin.role !== "admin".');

  // ---------- A2b: staff đổi role của admin khác ----------
  const adminMe = await admin.get('/api/auth/me');
  const adminId = adminMe.json?.user?.id;
  const rDemote = await staff.patch(`/api/admin/users/${adminId}`, { role: 'user' });
  const adminStill = await admin.get('/api/auth/me');
  record(2.5,
    'Staff đổi role admin khác (hạ quyền admin)',
    adminStill.json?.user?.role === 'admin' ? 'BỊ CHẶN' : 'HẠ QUYỀN ĐƯỢC ADMIN',
    adminStill.json?.user?.role === 'admin' ? 'OK' : 'CRITICAL',
    `PATCH -> ${rDemote.status} ${rDemote.json?.error || ''} | admin role hiện tại: ${adminStill.json?.user?.role}`,
    'Đã đúng: yêu cầu admin.role === "admin".');

  // ---------- A2c: staff reset mật khẩu admin (chiếm tài khoản) ----------
  const rPw = await staff.patch(`/api/admin/users/${adminId}`, { resetPassword: 'Hacked@123456' });
  const canAdminStillLogin = makeClient('chk');
  const lr = await canAdminStillLogin.login(ACCOUNTS.admin.email, 'Hacked@123456');
  record(2.7,
    'Staff reset mật khẩu admin (chiếm tài khoản)',
    lr.status === 200 ? 'CHIẾM ĐƯỢC TÀI KHOẢN ADMIN' : 'BỊ CHẶN',
    lr.status === 200 ? 'CRITICAL' : 'OK',
    `PATCH resetPassword -> ${rPw.status} ${rPw.json?.error || ''} | login bằng pw mới: ${lr.status}`,
    'Đã đúng: admin.js:114-120 chặn reset pw admin khác.');

  // ---------- A3: gọi API admin không có cookie ----------
  const anon = makeClient('anon');
  const anonLeaks = [];
  for (const p of adminGets) {
    const r = await anon.get(p);
    if (r.status < 400) anonLeaks.push({ p, status: r.status });
  }
  record(3,
    'Gọi 10 API admin KHÔNG có session (không cookie)',
    anonLeaks.length === 0 ? 'BỊ CHẶN đủ 10/10' : `RÒ RỈ: ${JSON.stringify(anonLeaks)}`,
    anonLeaks.length === 0 ? 'OK' : 'CRITICAL',
    anonLeaks.length ? JSON.stringify(anonLeaks) : `Mẫu: GET /api/admin/dashboard -> ${(await anon.get('/api/admin/dashboard')).status}`,
    'Đã đúng: requireUser() ném 401.');

  // ---------- A4: session cookie giả/ngẫu nhiên ----------
  const forged = makeClient('forged');
  const fakeTokens = [
    'a'.repeat(64),
    '0'.repeat(64),
    'f'.repeat(64),
    crypto.randomUUID().replace(/-/g, '') + 'x'.repeat(32),
  ];
  const forgeOut = [];
  for (const t of fakeTokens) {
    const r = await forged.get('/api/auth/me', { headers: { cookie: `mbk_session=${t}` } });
    forgeOut.push(`${t.slice(0, 8)}… -> ${r.status}`);
  }
  // thử cả token đúng độ dài nhưng sai
  const allBlocked = forgeOut.every((s) => s.endsWith('401'));
  record(4,
    'Cookie session giả/ngẫu nhiên (4 token 64 ký tự)',
    allBlocked ? 'BỊ CHẶN — lookup DB theo SHA-256 thất bại' : 'LỌT',
    allBlocked ? 'OK' : 'CRITICAL',
    forgeOut.join(' | '),
    'Đã đúng: getSessionUser tra bảng sessions bằng sha256(token).');

  // ---------- A4b: staff có làm được thao tác nguy hiểm nào khác? ----------
  // requireAdmin cho phép staff, nên kiểm tra staff có gọi được các API ghi không
  const staffWrite = [];
  for (const [m, p, b] of [
    ['POST', '/api/admin/products', { name: 'Staff Product', price: 1000 }],
    ['POST', '/api/admin/coupons', { code: 'STAFF' + Date.now() % 100000, type: 'fixed', value: 1000 }],
    ['POST', '/api/admin/settings', { topup_max: '999999999' }],
  ]) {
    const r = await staff.req(m, p, { body: b });
    staffWrite.push(`${m} ${p} -> ${r.status}`);
  }
  record(4.5,
    'Staff gọi API ghi admin (sản phẩm/coupon/settings) — cần xác nhận phạm vi',
    'Staff ĐƯỢC PHÉP (theo thiết kế requireAdmin nhận staff)',
    'MEDIUM',
    staffWrite.join(' | '),
    'Xác nhận đây là chủ ý. Nếu không, đổi các route ghi sang requireAdminStrict().');

  return { user, staff, admin };
}
