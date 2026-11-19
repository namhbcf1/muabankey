/** Dashboard quản trị: thống kê, quản lý người dùng, mã giảm giá, cài đặt. */
import { ok, ApiError, readJson } from '../lib/http.js';
import { str, int, email as vEmail, password as vPassword, enum_ok, bool } from '../lib/validate.js';
import { hashPassword, uuid } from '../lib/crypto.js';
import { requireAdmin, requireAdminStrict } from '../lib/auth.js';
import { audit } from './products.js';

export async function dashboard(env, request) {
  await requireAdmin(env, request);
  const now = Date.now();
  const dayAgo = now - 86400_000;
  const weekAgo = now - 7 * 86400_000;
  const monthAgo = now - 30 * 86400_000;

  /*
   * Mốc "ĐÃ THU TIỀN" chuẩn hoá về MILI-GIÂY (audit #16).
   *
   * `orders.created_at` là mili-giây. `paid_at` hiện cũng ghi mili-giây, nhưng
   * dữ liệu cũ có giai đoạn ghi bằng GIÂY (bug đơn vị đã sửa). 1e11 GIÂY =
   * năm 5138, còn 1e11 MILI-GIÂY = năm 1973, nên mọi giá trị thật rơi về đúng
   * một phía: nhỏ hơn ngưỡng = giây -> nhân 1000. NULL -> lùi về created_at.
   */
  const PAID_AT_MS = 'COALESCE(CASE WHEN paid_at > 100000000000 THEN paid_at ELSE paid_at * 1000 END, created_at)';

  const [
    revenue, revenueToday, revenueWeek, revenueMonth,
    orderCount, orderToday, userCount, userToday,
    pendingOrders, lowStock, topProducts, recentOrders, statusBreakdown
  ] = await Promise.all([
    // Doanh thu MỌI THỜI KỲ đều phải tính theo NGÀY THU TIỀN THẬT.
    // Xem chú thích ở revenueToday (audit #16).
    env.DB.prepare("SELECT COALESCE(SUM(total),0) AS v FROM orders WHERE status IN ('paid','delivered')").first(),
    /*
     * ===== AUDIT #16: doanh thu theo `paid_at`, không phải `created_at` =====
     *
     * LỖI GỐC: cửa sổ doanh thu lọc `created_at >= ?`. `created_at` là lúc
     * KHÁCH BẤM ĐẶT ĐƠN, còn tiền về sau đó (khách quét QR muộn, chuyển khoản
     * tay, hoặc đơn tạo 23:59 mà trả 00:10). Hệ quả:
     *   - doanh thu HÔM NAY hụt đúng những đơn trả muộn của hôm qua;
     *   - đơn tạo hôm qua nhưng trả hôm nay lại bị tính vào hôm qua, tức số
     *     của ngày đã "chốt" vẫn đổi sau khi chủ shop đã đối soát sao kê.
     * Nay: ưu tiên `paid_at` (mốc xác nhận tiền), đơn cũ chưa có `paid_at`
     * thì lùi về `created_at` để không mất số liệu lịch sử.
     *
     * CHUẨN HOÁ ĐƠN VỊ: `PAID_AT_MS` ở trên đã quy đổi giá trị cũ lưu bằng
     * GIÂY sang MILI-GIÂY trước khi so sánh — nếu không, các đơn trả tiền
     * trước lần sửa đơn vị sẽ rơi khỏi mọi cửa sổ doanh thu.
     */
    env.DB.prepare(`SELECT COALESCE(SUM(total),0) AS v FROM orders WHERE status IN ('paid','delivered') AND ${PAID_AT_MS} >= ?`).bind(dayAgo).first(),
    env.DB.prepare(`SELECT COALESCE(SUM(total),0) AS v FROM orders WHERE status IN ('paid','delivered') AND ${PAID_AT_MS} >= ?`).bind(weekAgo).first(),
    env.DB.prepare(`SELECT COALESCE(SUM(total),0) AS v FROM orders WHERE status IN ('paid','delivered') AND ${PAID_AT_MS} >= ?`).bind(monthAgo).first(),
    env.DB.prepare('SELECT COUNT(*) AS v FROM orders').first(),
    env.DB.prepare('SELECT COUNT(*) AS v FROM orders WHERE created_at >= ?').bind(dayAgo).first(),
    /*
     * Chỉ đếm KHÁCH THẬT.
     *
     * LỖI ĐÃ SỬA (audit #15): bộ lọc cũ loại '@local' / '@test.vn' /
     * '@example.com' — nhưng từ khi bỏ đăng ký bằng email, MỌI tài khoản mới
     * đều có email nội bộ dạng `u-<uuid>@invalid` (xem auth.register). Không
     * mẫu nào ở trên khớp `@invalid`, nên bộ lọc "khách thật" thực tế KHÔNG
     * loại được ai: metric vẫn đếm toàn bộ user test/e2e.
     *
     * Nay loại đúng mẫu đang được sinh ra (`u-<uuid>@invalid`) và giữ các mẫu
     * cũ cho dữ liệu lịch sử. Mẫu dùng LIKE 'u-%@invalid' vì phần uuid là
     * chuỗi bất kỳ; tiền tố 'u-' đủ đặc trưng, không lẫn email thật.
     */
    env.DB.prepare(
      `SELECT COUNT(*) AS v FROM users
       WHERE email NOT LIKE 'u-%@invalid'
         AND email NOT LIKE '%@local'
         AND email NOT LIKE '%@test.vn'
         AND email NOT LIKE '%@example.com'
         AND role != 'admin'`
    ).first(),
    env.DB.prepare(
      `SELECT COUNT(*) AS v FROM users
       WHERE created_at >= ?
         AND email NOT LIKE '%@local'
         AND email NOT LIKE '%@test.vn'
         AND email NOT LIKE '%@example.com'
         AND role != 'admin'`
    ).bind(dayAgo).first(),
    env.DB.prepare("SELECT COUNT(*) AS v FROM orders WHERE status='pending'").first(),
    env.DB.prepare(
      `SELECT COUNT(*) AS v FROM products
       WHERE active = 1 AND delivery_type NOT IN ('manual','license') AND stock_count < 5`
    ).first(),
    env.DB.prepare(
      `SELECT product_name, SUM(quantity) AS qty, SUM(line_total) AS revenue
       FROM order_items oi JOIN orders o ON o.id = oi.order_id
       WHERE o.status IN ('paid','delivered') GROUP BY product_name ORDER BY qty DESC LIMIT 5`
    ).all(),
    env.DB.prepare(
      `SELECT o.code, o.status, o.total, o.created_at, u.email
       FROM orders o JOIN users u ON u.id = o.user_id ORDER BY o.created_at DESC LIMIT 8`
    ).all(),
    env.DB.prepare('SELECT status, COUNT(*) AS n FROM orders GROUP BY status').all(),
  ]);

  return ok({
    stats: {
      revenue: revenue?.v || 0,
      revenueToday: revenueToday?.v || 0,
      revenueWeek: revenueWeek?.v || 0,
      revenueMonth: revenueMonth?.v || 0,
      orders: orderCount?.v || 0,
      ordersToday: orderToday?.v || 0,
      users: userCount?.v || 0,
      usersToday: userToday?.v || 0,
      pendingOrders: pendingOrders?.v || 0,
      lowStock: lowStock?.v || 0,
    },
    topProducts: (topProducts.results || []).map((p) => ({
      name: p.product_name, qty: p.qty, revenue: p.revenue,
    })),
    recentOrders: (recentOrders.results || []).map((o) => ({
      code: o.code, status: o.status, total: o.total, createdAt: o.created_at, email: o.email,
    })),
    statusBreakdown: (statusBreakdown.results || []).map((s) => ({ status: s.status, count: s.n })),
  });
}

export async function listUsers(env, request) {
  const admin = await requireAdmin(env, request);
  /*
   * AUDIT #12: `staff` KHÔNG được đọc PII của toàn bộ khách.
   *
   * List này trả email + số điện thoại + tên thật của MỌI khách. Với một tài
   * khoản hỗ trợ (hoặc phiên bị chiếm), đó là cả cơ sở dữ liệu khách hàng.
   * Nay staff chỉ thấy dạng che (`a***@x.com`, `***1234`); admin thật vẫn thấy
   * đủ. Các trường VẬN HÀNH staff cần (username, vai trò, trạng thái, số đơn,
   * ngày tạo) giữ nguyên — nếu không họ không làm được việc.
   */
  const { isStaffViewer, maskEmail, maskPhone } = await import('../lib/pii.js');
  const staffView = isStaffViewer(admin);
  const url = new URL(request.url);
  const q = (url.searchParams.get('q') || '').trim();
  const binds = [];
  let where = '1=1';
  if (q) {
    where += ' AND (email LIKE ? OR full_name LIKE ?)';
    binds.push(`%${q}%`, `%${q}%`);
  }
  const { results } = await env.DB.prepare(
    `SELECT u.id, u.email, u.username, u.full_name, u.phone, u.role, u.status, u.balance, u.created_at, u.last_login_at,
       (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id) AS order_count
     FROM users u WHERE ${where} ORDER BY u.created_at DESC LIMIT 200`
  ).bind(...binds).all();
  return ok({
    users: (results || []).map((u) => ({
      id: u.id,
      /*
       * `username` là TÊN ĐĂNG NHẬP — thứ duy nhất khách thật sự có.
       *
       * Trước đây API không trả field này, trong khi bảng Người dùng hiển thị
       * "Tên đăng nhập" -> mọi dòng đều ra "—", admin không biết ai là ai.
       *
       * Fallback cho user cũ chưa có username: `email` là địa chỉ nội bộ
       * `u-<uuid>@invalid` (xem auth.register) — KHÔNG được hiện ra vì nó chỉ
       * là UUID ngẫu nhiên, vô nghĩa với admin. Suy ra từ full_name, hoặc để
       * trống cho UI hiện "—".
       */
      username: u.username
        || (typeof u.email === 'string' && u.email.endsWith('@invalid') ? null : u.email)
        || u.full_name || null,
      /*
       * `email` cho UI: ẩn địa chỉ nội bộ `u-<uuid>@invalid` (xem auth.register).
       * Đó chỉ là UUID ngẫu nhiên, hiện ra không cho biết khách là ai mà còn
       * trông như dữ liệu hỏng. NULL để UI hiện "—"; username đã ở field riêng.
       */
      email: (typeof u.email === 'string' && u.email.endsWith('@invalid'))
        ? null
        : (staffView ? maskEmail(u.email) : u.email),
      fullName: u.full_name,
      phone: staffView ? maskPhone(u.phone) : u.phone,
      role: u.role,
      status: u.status, balance: u.balance, createdAt: u.created_at,
      lastLoginAt: u.last_login_at, orderCount: u.order_count,
    })),
  });
}

export async function updateUser(env, request, userId) {
  const admin = await requireAdmin(env, request);
  const body = await readJson(request);
  const u = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first();
  if (!u) throw new ApiError(404, 'Người dùng không tồn tại', 'NOT_FOUND');

  // ===== CHỐNG LEO THANG QUYỀN =====
  // 1. Chỉ admin thật mới được đổi role
  if (body.role !== undefined && admin.role !== 'admin') {
    throw new ApiError(403, 'Chỉ quản trị viên mới được đổi vai trò', 'FORBIDDEN');
  }
  // 2. Không ai được tự nâng quyền hoặc cấp quyền ngang/cao hơn mình
  if (body.role !== undefined) {
    const role = enum_ok(body.role, ['user', 'staff', 'admin'], 'role');
    if (role === 'admin' && admin.role !== 'admin') {
      throw new ApiError(403, 'Bạn không thể cấp quyền quản trị viên', 'FORBIDDEN');
    }
    if (u.role === 'admin' && u.id !== admin.id && admin.role !== 'admin') {
      throw new ApiError(403, 'Bạn không thể sửa tài khoản quản trị viên', 'FORBIDDEN');
    }
  }
  // 3. Chỉ admin thật mới reset được mật khẩu người khác
  if (body.resetPassword !== undefined && admin.role !== 'admin') {
    throw new ApiError(403, 'Chỉ quản trị viên mới được đặt lại mật khẩu', 'FORBIDDEN');
  }
  // 4. Không reset mật khẩu admin khác (trừ chính mình)
  if (body.resetPassword !== undefined && u.role === 'admin' && u.id !== admin.id) {
    throw new ApiError(403, 'Không thể đặt lại mật khẩu của quản trị viên khác', 'FORBIDDEN');
  }

  const fields = [];
  const binds = [];
  if (body.role !== undefined) {
    const role = enum_ok(body.role, ['user', 'staff', 'admin'], 'role');
    if (u.id === admin.id && role !== 'admin') {
      throw new ApiError(400, 'Không thể tự hạ quyền chính mình', 'VALIDATION');
    }
    fields.push('role = ?'); binds.push(role);
  }
  if (body.status !== undefined) {
    /*
     * ===== AUDIT #12: KHOÁ/MỞ KHOÁ TÀI KHOẢN LÀ QUYỀN CỦA ADMIN THẬT =====
     *
     * Trước đây `staff` vẫn khoá/mở được tài khoản khách (nhánh dưới chỉ chặn
     * khi mục tiêu là admin/staff khác). Khoá tài khoản là thao tác ĐÌNH CHỈ
     * DỊCH VỤ của khách đã trả tiền — một tài khoản hỗ trợ không được có quyền
     * đó, và cũng không cần cho công việc thường ngày.
     */
    if (admin.role !== 'admin') {
      throw new ApiError(403,
        'Chỉ quản trị viên mới được khoá/mở khoá tài khoản', 'FORBIDDEN');
    }
    const status = enum_ok(body.status, ['active', 'locked'], 'status');
    if (u.id === admin.id && status !== 'active') {
      throw new ApiError(400, 'Không thể tự khoá tài khoản của mình', 'VALIDATION');
    }
    /*
     * Trước đây chỉ chặn tự khoá: staff khoá được admin thật → đá chủ shop ra
     * khỏi hệ thống rồi tự do dùng các quyền tài chính. Chặn theo cấp bậc.
     */
    if (u.role === 'admin' && u.id !== admin.id) {
      throw new ApiError(403, 'Không thể khoá tài khoản quản trị viên khác', 'FORBIDDEN');
    }
    if (admin.role !== 'admin' && u.role !== 'user') {
      throw new ApiError(403, 'Chỉ quản trị viên mới được đổi trạng thái tài khoản nội bộ', 'FORBIDDEN');
    }
    fields.push('status = ?'); binds.push(status);
  }
  if (body.fullName !== undefined) {
    fields.push('full_name = ?'); binds.push(str(body.fullName, 'fullName', { min: 2, max: 120 }));
  }
  if (body.resetPassword !== undefined) {
    const pw = vPassword(body.resetPassword);
    const { hash, salt } = await hashPassword(pw);
    fields.push('password_hash = ?', 'password_salt = ?');
    binds.push(hash, salt);
    await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId).run();
  }
  if (fields.length === 0) throw new ApiError(400, 'Không có trường nào để cập nhật', 'VALIDATION');

  fields.push('updated_at = ?'); binds.push(Date.now());
  binds.push(userId);
  await env.DB.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).bind(...binds).run();
  await audit(env, admin.id, 'user.update', userId, Object.keys(body));
  return ok({ id: userId });
}

export async function listCoupons(env, request) {
  await requireAdmin(env, request);
  const { results } = await env.DB.prepare('SELECT * FROM coupons ORDER BY created_at DESC LIMIT 200').all();
  return ok({
    coupons: (results || []).map((c) => ({
      id: c.id, code: c.code, type: c.type, value: c.value, minSubtotal: c.min_subtotal,
      maxDiscount: c.max_discount, usageLimit: c.usage_limit, usedCount: c.used_count,
      startsAt: c.starts_at, expiresAt: c.expires_at, active: !!c.active,
    })),
  });
}

export async function saveCoupon(env, request) {
  const admin = await requireAdmin(env, request);
  const body = await readJson(request);
  const code = str(body.code, 'code', { min: 3, max: 40 }).toUpperCase();
  const type = enum_ok(body.type || 'percent', ['percent', 'fixed'], 'type');
  const value = int(body.value, 'value', { min: 1, max: 100_000_000 });
  const minSubtotal = body.minSubtotal ? int(body.minSubtotal, 'minSubtotal', { min: 0 }) : 0;
  const maxDiscount = body.maxDiscount ? int(body.maxDiscount, 'maxDiscount', { min: 1 }) : null;
  const usageLimit = body.usageLimit ? int(body.usageLimit, 'usageLimit', { min: 1 }) : null;
  const expiresAt = body.expiresAt ? int(body.expiresAt, 'expiresAt', { min: 0 }) : null;
  const active = bool(body.active, true) ? 1 : 0;

  if (type === 'percent' && value > 100) throw new ApiError(400, 'Phần trăm giảm tối đa 100', 'VALIDATION');

  const existing = await env.DB.prepare('SELECT id FROM coupons WHERE code = ?').bind(code).first();
  if (body.id || existing) {
    const id = body.id || existing.id;
    await env.DB.prepare(
      `UPDATE coupons SET code=?, type=?, value=?, min_subtotal=?, max_discount=?, usage_limit=?,
       expires_at=?, active=? WHERE id=?`
    ).bind(code, type, value, minSubtotal, maxDiscount, usageLimit, expiresAt, active, id).run();
    await audit(env, admin.id, 'coupon.update', id, { code });
    return ok({ id });
  }

  const id = uuid();
  await env.DB.prepare(
    `INSERT INTO coupons (id, code, type, value, min_subtotal, max_discount, usage_limit, used_count, starts_at, expires_at, active, created_at)
     VALUES (?,?,?,?,?,?,?,0,?,?,?,?)`
  ).bind(id, code, type, value, minSubtotal, maxDiscount, usageLimit, Date.now(), expiresAt, active, Date.now()).run();
  await audit(env, admin.id, 'coupon.create', id, { code });
  return ok({ id }, 201);
}

export async function deleteCoupon(env, request, couponId) {
  const admin = await requireAdmin(env, request);
  await env.DB.prepare('UPDATE coupons SET active = 0 WHERE id = ?').bind(couponId).run();
  await audit(env, admin.id, 'coupon.disable', couponId, {});
  return ok({ id: couponId });
}

export async function listAuditLogs(env, request) {
  const actor = await requireAdmin(env, request);
  /*
   * AUDIT #12: nhật ký thao tác chứa email của người thao tác (thường là
   * admin/staff). Không phải PII khách, nhưng vẫn là danh tính nội bộ — staff
   * chỉ cần biết "ai làm gì"; email đầy đủ để admin xem.
   */
  const { isStaffViewer, maskEmail } = await import('../lib/pii.js');
  const staffView = isStaffViewer(actor);
  const { results } = await env.DB.prepare(
    `SELECT a.*, u.email AS actor_email FROM audit_logs a
     LEFT JOIN users u ON u.id = a.actor_id ORDER BY a.created_at DESC LIMIT 200`
  ).all();
  return ok({
    logs: (results || []).map((l) => ({
      id: l.id, action: l.action, target: l.target,
      meta: l.meta ? JSON.parse(l.meta) : null,
      actor: l.actor_email
        ? (staffView ? maskEmail(l.actor_email) : l.actor_email)
        : 'system',
      createdAt: l.created_at,
    })),
  });
}

/*
 * Khoá bí mật KHÔNG bao giờ trả về client, kể cả cho admin.
 * `payos_checksum_key` cho phép tự ký webhook payOS (= tự tạo tiền) và
 * `telegram_bot_token` điều khiển kênh duyệt nạp. Trước đây getSettings trả
 * nguyên bảng settings nên staff đọc được cả hai.
 */
const SECRET_SETTING_KEYS = [
  'payos_checksum_key', 'telegram_bot_token', 'telegram_chat_id',
  'sepay_api_key', 'xg_sign_jwk', 'key_enc',
];

export async function getSettings(env, request) {
  const admin = await requireAdmin(env, request);
  const placeholders = SECRET_SETTING_KEYS.map(() => '?').join(',');
  const { results } = await env.DB.prepare(
    `SELECT key, value FROM settings WHERE key NOT IN (${placeholders})`
  ).bind(...SECRET_SETTING_KEYS).all();
  const map = {};
  for (const r of results || []) map[r.key] = r.value;

  /*
   * AUDIT #12: số tài khoản nhận tiền + tên chủ tài khoản là thông tin
   * NHẠY CẢM VỀ TIỀN, không phải cấu hình vận hành thường ngày.
   *
   * Bảng settings không nằm trong danh sách secret (staff cần xem các key
   * trial/cửa sổ giờ...), nhưng riêng hai trường ngân hàng thì che với staff:
   * staff còn thấy 4 số cuối để đối chiếu, không thấy đủ để dùng.
   */
  const { isStaffViewer, maskAccount, maskName } = await import('../lib/pii.js');
  if (isStaffViewer(admin)) {
    if (map.bank_account) map.bank_account = maskAccount(map.bank_account);
    if (map.bank_owner) map.bank_owner = maskName(map.bank_owner);
  }

  // Chỉ báo đã cấu hình hay chưa — đủ để admin biết trạng thái, không lộ giá trị.
  const { results: secretRows } = await env.DB.prepare(
    `SELECT key FROM settings WHERE key IN (${placeholders})`
  ).bind(...SECRET_SETTING_KEYS).all();
  map._secretsConfigured = Object.fromEntries(
    (secretRows || []).map((r) => [r.key, Boolean(r.value)])
  );
  return ok({ settings: map });
}

export async function saveSettings(env, request) {
  // Đổi bank_account/bank_owner chuyển hướng tiền của MỌI khách → chỉ admin thật.
  const admin = await requireAdminStrict(env, request);
  const body = await readJson(request);
  // Cho phép lưu cả cấu hình trial.
  // Trước đây chỉ 6 key -> admin không đổi được số lượt trial, phải sửa SQL tay.
  const allowed = [
    'bank_name', 'bank_account', 'bank_owner', 'topup_min', 'topup_max', 'auto_deliver',
    // Trial
    'trial_enabled',
    'trial1h_enabled', 'trial1h_minutes', 'trial1h_limit',
    'trial3d_enabled', 'trial3d_days', 'trial3d_limit',
    'trial_max_per_ip', 'trial_max_per_net', 'trial_max_per_day',
    // Audit #2: trần /24 trong 24 giờ (không phụ thuộc dữ liệu client)
    'trial_max_per_net24_day',
    'trial_device_acc_1h', 'trial_device_acc_3d',
    'trial_hold_sec', 'trial_recheck_1h', 'trial_recheck_3d',
    'trial_unlimited_quota',
    // Cửa sổ giờ tự động xác nhận SePay
    'sepay_auto_enabled', 'sepay_auto_from', 'sepay_auto_to',
    // Thanh toán theo đơn
    'payment_auto_deliver', 'payment_prefix', 'order_ttl_minutes',
    'order_remind_minutes', 'order_qr_min', 'order_qr_max',
    // Audit #14: cho phép bỏ lớp kiểm accountNumber khi SePay đổi payload
    'sepay_allow_missing_account',
    // Giao diện
    'site_name', 'site_tagline', 'support_zalo', 'support_telegram',
  ];
  const now = Date.now();
  const stmts = [];
  for (const [k, v] of Object.entries(body)) {
    if (!allowed.includes(k)) continue;
    stmts.push(
      env.DB.prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES (?,?,?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      ).bind(k, String(v), now)
    );
  }
  if (stmts.length === 0) throw new ApiError(400, 'Không có cài đặt hợp lệ', 'VALIDATION');
  await env.DB.batch(stmts);
  await audit(env, admin.id, 'settings.update', 'site', Object.keys(body));
  return ok({ message: 'Đã lưu cài đặt' });
}
