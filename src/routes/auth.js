/** Route xác thực: đăng ký, đăng nhập, đăng xuất, hồ sơ. */
import { ok, ApiError, readJson } from '../lib/http.js';
import { password as vPassword, str, username as vUsername } from '../lib/validate.js';
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

  /*
   * CHỈ tài khoản + mật khẩu. Không email, không số điện thoại, không họ tên.
   *
   * Yêu cầu của chủ shop: không lưu bất kỳ thông tin định danh cá nhân nào của
   * khách. Liên hệ hỗ trợ đi qua Telegram, không qua email/SĐT.
   *
   * Cột `users.email` vẫn là NOT NULL UNIQUE trong schema (nhiều chỗ khác đọc),
   * nên ghi một giá trị nội bộ KHÔNG mang thông tin người dùng:
   *   u-<id>@invalid  -- id là UUID ngẫu nhiên, không suy ra được gì.
   * Không gửi mail tới địa chỉ này, không hiển thị nó ra ngoài.
   */
  const loginName = vUsername(body.username);
  const password = vPassword(body.password);

  // Tên hiển thị dùng luôn username — không hỏi, không lưu thêm.
  const fullName = loginName;

  const existing = await env.DB.prepare(
    'SELECT id FROM users WHERE lower(username) = ?'
  ).bind(loginName).first();
  if (existing) {
    throw new ApiError(409, 'Tên đăng nhập này đã có người dùng', 'USERNAME_EXISTS');
  }

  const { hash, salt } = await hashPassword(password);
  const id = uuid();
  const now = Date.now();
  // Địa chỉ nội bộ dẫn xuất từ UUID: duy nhất, không lộ danh tính.
  const emailForDb = `u-${id}@invalid`;
  await env.DB.prepare(
    `INSERT INTO users (id, email, username, password_hash, password_salt, full_name, phone, role, status, balance, created_at, updated_at)
     VALUES (?,?,?,?,?,?,NULL,'user','active',0,?,?)`
  )
    .bind(id, emailForDb, loginName, hash, salt, fullName, now, now)
    .run();

  const ttl = Number(env.SESSION_TTL_DAYS || 30);
  const session = await createSession(env, id, request, ttl);
  await audit(env, id, 'user.register', id, { loginName });

  return new Response(
    JSON.stringify({
      ok: true,
      user: {
        id,
        username: loginName,
        fullName, role: 'user', balance: 0,
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

  /*
   * CHỈ đăng nhập bằng username. Email đã bị bỏ hoàn toàn để không lưu bất kỳ
   * thông tin định danh nào của khách.
   *
   * Tương thích: client cũ vẫn gửi field `email`; nếu giá trị KHÔNG chứa `@`
   * thì coi như username. Nếu chứa `@` thì từ chối — tránh trường hợp ai đó
   * quen đăng nhập bằng email cũ mà không hiểu vì sao hỏng.
   */
  const raw = body.username ?? body.email ?? body.identifier;
  const identifier = str(raw, 'username', { min: 3, max: 32 }).trim();
  if (identifier.includes('@')) {
    throw new ApiError(
      400,
      'Đăng nhập bằng tên tài khoản, không dùng email',
      'USERNAME_REQUIRED',
    );
  }
  const loginName = identifier.toLowerCase();

  const user = await env.DB.prepare(
    'SELECT * FROM users WHERE lower(username) = ? LIMIT 1'
  ).bind(loginName).first();

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
        username: user.username || null,
        fullName: user.full_name,
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

  /*
   * KHÔNG trả email/phone ra ngoài — kể cả email nội bộ @local.
   * User cũ tạo trước khi bỏ email có `username = NULL` và loại nội bộ
   * (`<name>@local` hoặc `u-<uuid>@invalid`); chỉ khi đó mới suy ra tên
   * hiển thị từ username đã lưu, không lộ địa chỉ email.
   */
  const uname = user.username
    || (typeof user.email === 'string' && user.email.endsWith('@local')
      ? user.email.slice(0, -6)
      : null);

  return ok({
    user: {
      id: user.id,
      username: uname,
      fullName: user.full_name,
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
