/** Route xác thực: đăng ký, đăng nhập, đăng xuất, hồ sơ. */
import { ok, ApiError, readJson } from '../lib/http.js';
import { email as vEmail, password as vPassword, str, username as vUsername } from '../lib/validate.js';
import { hashPassword, verifyPassword, uuid } from '../lib/crypto.js';
import { createSession, sessionCookie, clearCookie, destroySession, requireUser } from '../lib/auth.js';
import { rateLimit, clientIp } from '../lib/ratelimit.js';
import { audit } from './products.js';

/**
 * Đăng ký — ĐƠN GIẢN: chỉ cần tài khoản + mật khẩu.
 *
 * Nhận MỘT trong hai:
 *   { username, password }        -- khuyến nghị, không cần email
 *   { email, password }           -- vẫn hỗ trợ cho tương thích
 *
 * Không xác minh email, không OTP, không captcha.
 * fullName là tuỳ chọn, nếu không có thì dùng luôn username.
 */
export async function register(env, request) {
  const ip = clientIp(request);
  // 100/giờ/IP: thoáng cho quán net và NAT chung, vẫn chặn spam tự động hàng loạt
  await rateLimit(env, `reg:${ip}`, 300, 3600);

  const body = await readJson(request);

  // Xác định tài khoản: ưu tiên username, fallback email
  let loginName;
  let email = null;
  let isEmail = false;

  if (body.username !== undefined && String(body.username).trim() !== '') {
    loginName = vUsername(body.username);
  } else if (body.email !== undefined && String(body.email).trim() !== '') {
    email = vEmail(body.email);
    loginName = email;
    isEmail = true;
  } else {
    throw new ApiError(400, 'Nhập tên đăng nhập và mật khẩu', 'VALIDATION');
  }

  const password = vPassword(body.password);

  // Tên hiển thị: tuỳ chọn
  let fullName;
  if (body.fullName !== undefined && String(body.fullName).trim() !== '') {
    fullName = str(body.fullName, 'fullName', { min: 2, max: 120 });
  } else {
    fullName = isEmail ? loginName.split('@')[0] : loginName;
  }

  const phone = str(body.phone, 'phone', { required: false, max: 20 }) || null;

  // Trùng: kiểm cả username lẫn email (kể cả email nội bộ @local)
  const emailForDb = isEmail ? loginName : `${loginName}@local`;
  const existing = await env.DB.prepare(
    'SELECT id FROM users WHERE lower(username) = ? OR lower(email) = ?'
  ).bind(loginName, emailForDb).first();
  if (existing) {
    throw new ApiError(409,
      isEmail ? 'Email này đã được đăng ký' : 'Tên đăng nhập này đã có người dùng',
      'USERNAME_EXISTS');
  }

  // Cột email là NOT NULL UNIQUE trong schema, không thể để trống.
  // Với đăng ký chỉ có username, sinh email nội bộ từ username:
  //   <username>@local  -- không gửi mail, không hiển thị cho khách.
  // Cột username vẫn là nguồn xác thực chính.
  const { hash, salt } = await hashPassword(password);
  const id = uuid();
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO users (id, email, username, password_hash, password_salt, full_name, phone, role, status, balance, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,'user','active',0,?,?)`
  )
    .bind(id, emailForDb, isEmail ? null : loginName, hash, salt, fullName, phone, now, now)
    .run();

  const ttl = Number(env.SESSION_TTL_DAYS || 30);
  const session = await createSession(env, id, request, ttl);
  await audit(env, id, 'user.register', id, { loginName, isEmail });

  return new Response(
    JSON.stringify({
      ok: true,
      user: {
        id,
        username: isEmail ? null : loginName,
        // Không trả email nội bộ (@local) ra ngoài
        email: isEmail ? email : null,
        fullName, phone, role: 'user', balance: 0,
      },
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
  await rateLimit(env, `login:${ip}`, 500, 900);

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

  // Email nội bộ dạng <username>@local KHÔNG được trả ra ngoài
  const isLocalEmail = typeof user.email === 'string' && user.email.endsWith('@local');

  return ok({
    user: {
      id: user.id,
      username: user.username || (isLocalEmail ? user.email.slice(0, -6) : null),
      email: isLocalEmail ? null : user.email,
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
