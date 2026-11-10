/** Route xác thực: đăng ký, đăng nhập, đăng xuất, hồ sơ. */
import { ok, ApiError, readJson } from '../lib/http.js';
import { email as vEmail, password as vPassword, str } from '../lib/validate.js';
import { hashPassword, verifyPassword, uuid } from '../lib/crypto.js';
import { createSession, sessionCookie, clearCookie, destroySession, requireUser } from '../lib/auth.js';
import { rateLimit, clientIp } from '../lib/ratelimit.js';
import { audit } from './products.js';

export async function register(env, request) {
  const ip = clientIp(request);
  // 20/giờ/IP: đủ thoáng cho hộ gia đình / NAT chung, vẫn chặn spam tạo acc hàng loạt
  await rateLimit(env, `reg:${ip}`, 20, 3600);

  const body = await readJson(request);
  const email = vEmail(body.email);
  const password = vPassword(body.password);
  const fullName = str(body.fullName, 'fullName', { min: 2, max: 120 });
  const phone = str(body.phone, 'phone', { required: false, max: 20 }) || null;

  const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (existing) throw new ApiError(409, 'Email này đã được đăng ký', 'EMAIL_EXISTS');

  const { hash, salt } = await hashPassword(password);
  const id = uuid();
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO users (id, email, password_hash, password_salt, full_name, phone, role, status, balance, created_at, updated_at)
     VALUES (?,?,?,?,?,?,'user','active',0,?,?)`
  )
    .bind(id, email, hash, salt, fullName, phone, now, now)
    .run();

  const ttl = Number(env.SESSION_TTL_DAYS || 30);
  const session = await createSession(env, id, request, ttl);
  await audit(env, id, 'user.register', id, { email });

  return new Response(
    JSON.stringify({
      ok: true,
      user: { id, email, fullName, phone, role: 'user', balance: 0 },
    }),
    {
      status: 201,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Set-Cookie': sessionCookie(session.token, session.maxAge),
        'Cache-Control': 'no-store',
      },
    }
  );
}

export async function login(env, request) {
  const ip = clientIp(request);
  await rateLimit(env, `login:${ip}`, 30, 900);

  const body = await readJson(request);
  const password = str(body.password, 'password', { min: 1, max: 128, trim: false });

  // Cho phép đăng nhập bằng email HOẶC username
  const identifier = str(body.email ?? body.username ?? body.identifier, 'email', { min: 3, max: 254 }).trim();
  const isEmail = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(identifier);
  const loginEmail = isEmail ? vEmail(identifier) : null;
  const loginName = isEmail ? null : identifier.toLowerCase();

  const user = loginEmail
    ? await env.DB.prepare('SELECT * FROM users WHERE email = ? LIMIT 1').bind(loginEmail).first()
    : await env.DB.prepare('SELECT * FROM users WHERE lower(username) = ? LIMIT 1').bind(loginName).first();

  // Luôn chạy 1 lượt hash để giảm lộ thông tin thời gian
  if (!user) {
    await hashPassword(password, 'AAAAAAAAAAAAAAAAAAAAAA==');
    throw new ApiError(401, 'Tài khoản hoặc mật khẩu không đúng', 'INVALID_CREDENTIALS');
  }
  if (user.status !== 'active') {
    throw new ApiError(403, 'Tài khoản của bạn đã bị khoá. Vui lòng liên hệ hỗ trợ.', 'ACCOUNT_LOCKED');
  }
  const valid = await verifyPassword(password, user.password_hash, user.password_salt);
  if (!valid) throw new ApiError(401, 'Tài khoản hoặc mật khẩu không đúng', 'INVALID_CREDENTIALS');

  const ttl = Number(env.SESSION_TTL_DAYS || 30);
  const session = await createSession(env, user.id, request, ttl);
  await env.DB.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').bind(Date.now(), user.id).run();
  await audit(env, user.id, 'user.login', user.id, {});

  return new Response(
    JSON.stringify({
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        username: user.username || null,
        fullName: user.full_name,
        phone: user.phone,
        role: user.role,
        balance: user.balance,
      },
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Set-Cookie': sessionCookie(session.token, session.maxAge),
        'Cache-Control': 'no-store',
      },
    }
  );
}

export async function logout(env, request) {
  await destroySession(env, request);
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Set-Cookie': clearCookie(),
      'Cache-Control': 'no-store',
    },
  });
}

export async function me(env, request) {
  const user = await requireUser(env, request);
  const stats = await env.DB.prepare(
    `SELECT COUNT(*) AS orders, COALESCE(SUM(total),0) AS spent
     FROM orders WHERE user_id = ? AND status IN ('paid','delivered')`
  )
    .bind(user.id)
    .first();
  return ok({
    user: {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      phone: user.phone,
      role: user.role,
      balance: user.balance,
    },
    stats: { orders: stats?.orders || 0, spent: stats?.spent || 0 },
  });
}

export async function updateProfile(env, request) {
  const user = await requireUser(env, request);
  const body = await readJson(request);
  const fullName = str(body.fullName, 'fullName', { min: 2, max: 120 });
  const phone = str(body.phone, 'phone', { required: false, max: 20 }) || null;
  await env.DB.prepare('UPDATE users SET full_name = ?, phone = ?, updated_at = ? WHERE id = ?')
    .bind(fullName, phone, Date.now(), user.id)
    .run();
  return ok({ message: 'Đã cập nhật thông tin' });
}

export async function changePassword(env, request) {
  const user = await requireUser(env, request);
  const ip = clientIp(request);
  await rateLimit(env, `pwd:${user.id}:${ip}`, 5, 3600);

  const body = await readJson(request);
  const current = str(body.currentPassword, 'currentPassword', { min: 1, max: 128, trim: false });
  const next = vPassword(body.newPassword);

  const row = await env.DB.prepare('SELECT password_hash, password_salt FROM users WHERE id = ?')
    .bind(user.id)
    .first();
  const valid = await verifyPassword(current, row.password_hash, row.password_salt);
  if (!valid) throw new ApiError(400, 'Mật khẩu hiện tại không đúng', 'WRONG_PASSWORD');

  const { hash, salt } = await hashPassword(next);
  await env.DB.prepare('UPDATE users SET password_hash = ?, password_salt = ?, updated_at = ? WHERE id = ?')
    .bind(hash, salt, Date.now(), user.id)
    .run();
  // Vô hiệu hoá mọi phiên khác
  await env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?')
    .bind(user.id, user.tokenHash)
    .run();
  await audit(env, user.id, 'user.change_password', user.id, {});
  return ok({ message: 'Đã đổi mật khẩu' });
}
