/** Dashboard quản trị: thống kê, quản lý người dùng, mã giảm giá, cài đặt. */
import { ok, ApiError, readJson } from '../lib/http.js';
import { str, int, email as vEmail, password as vPassword, enum_ok, bool } from '../lib/validate.js';
import { hashPassword, uuid } from '../lib/crypto.js';
import { requireAdmin } from '../lib/auth.js';
import { audit } from './products.js';

export async function dashboard(env, request) {
  await requireAdmin(env, request);
  const now = Date.now();
  const dayAgo = now - 86400_000;
  const weekAgo = now - 7 * 86400_000;
  const monthAgo = now - 30 * 86400_000;

  const [
    revenue, revenueToday, revenueWeek, revenueMonth,
    orderCount, orderToday, userCount, userToday,
    pendingOrders, lowStock, topProducts, recentOrders, statusBreakdown
  ] = await Promise.all([
    env.DB.prepare("SELECT COALESCE(SUM(total),0) AS v FROM orders WHERE status IN ('paid','delivered')").first(),
    env.DB.prepare("SELECT COALESCE(SUM(total),0) AS v FROM orders WHERE status IN ('paid','delivered') AND created_at >= ?").bind(dayAgo).first(),
    env.DB.prepare("SELECT COALESCE(SUM(total),0) AS v FROM orders WHERE status IN ('paid','delivered') AND created_at >= ?").bind(weekAgo).first(),
    env.DB.prepare("SELECT COALESCE(SUM(total),0) AS v FROM orders WHERE status IN ('paid','delivered') AND created_at >= ?").bind(monthAgo).first(),
    env.DB.prepare('SELECT COUNT(*) AS v FROM orders').first(),
    env.DB.prepare('SELECT COUNT(*) AS v FROM orders WHERE created_at >= ?').bind(dayAgo).first(),
    // Chỉ đếm KHÁCH THẬT: loại user test (@local từ đăng ký username,
    // @test.vn từ e2e) và user hệ thống. Trước đây COUNT(*) báo 97 user
    // trong khi chỉ 2 là thật -> metric sai.
    env.DB.prepare(
      `SELECT COUNT(*) AS v FROM users
       WHERE email NOT LIKE '%@local'
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
  await requireAdmin(env, request);
  const url = new URL(request.url);
  const q = (url.searchParams.get('q') || '').trim();
  const binds = [];
  let where = '1=1';
  if (q) {
    where += ' AND (email LIKE ? OR full_name LIKE ?)';
    binds.push(`%${q}%`, `%${q}%`);
  }
  const { results } = await env.DB.prepare(
    `SELECT u.id, u.email, u.full_name, u.phone, u.role, u.status, u.balance, u.created_at, u.last_login_at,
       (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id) AS order_count
     FROM users u WHERE ${where} ORDER BY u.created_at DESC LIMIT 200`
  ).bind(...binds).all();
  return ok({
    users: (results || []).map((u) => ({
      id: u.id, email: u.email, fullName: u.full_name, phone: u.phone, role: u.role,
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
    const status = enum_ok(body.status, ['active', 'locked'], 'status');
    if (u.id === admin.id && status !== 'active') {
      throw new ApiError(400, 'Không thể tự khoá tài khoản của mình', 'VALIDATION');
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
  await requireAdmin(env, request);
  const { results } = await env.DB.prepare(
    `SELECT a.*, u.email AS actor_email FROM audit_logs a
     LEFT JOIN users u ON u.id = a.actor_id ORDER BY a.created_at DESC LIMIT 200`
  ).all();
  return ok({
    logs: (results || []).map((l) => ({
      id: l.id, action: l.action, target: l.target,
      meta: l.meta ? JSON.parse(l.meta) : null,
      actor: l.actor_email || 'system', createdAt: l.created_at,
    })),
  });
}

export async function getSettings(env, request) {
  await requireAdmin(env, request);
  const { results } = await env.DB.prepare('SELECT key, value FROM settings').all();
  const map = {};
  for (const r of results || []) map[r.key] = r.value;
  return ok({ settings: map });
}

export async function saveSettings(env, request) {
  const admin = await requireAdmin(env, request);
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
    'trial_device_acc_1h', 'trial_device_acc_3d',
    'trial_hold_sec', 'trial_recheck_1h', 'trial_recheck_3d',
    'trial_unlimited_quota',
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
