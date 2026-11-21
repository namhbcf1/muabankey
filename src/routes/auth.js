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
  await rateLimit(env, `reg:${ip}`, 300, 3600, { failClosed: true });

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

  // FAIL CLOSED: SESSION_TTL_DAYS khong phai so -> dung 30.
  // Truoc day `Number(x || 30)` cho NaN; NaN*864000 = NaN ->
  // expires_at thanh NaN -> `if (row.expires_at < Date.now())`
  // khong bao gio dung -> phien dang nhap KHONG BAO GIO het han.
  const _ttlRaw = Number(env.SESSION_TTL_DAYS);
  const ttl = Number.isFinite(_ttlRaw) && _ttlRaw > 0 ? _ttlRaw : 30;
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
  await rateLimit(env, `login:${ip}`, 500, 900, { failClosed: true });

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

  /*
   * ===== LOCKOUT THEO TÀI KHOẢN (chống dò mật khẩu) =====
   *
   * Rate limit ở trên chỉ khoá theo IP: 500 lần/15 phút. Kẻ tấn công đổi IP
   * là vượt được, và 500 lần/IP vẫn đủ để dò một mật khẩu yếu. Không có bộ
   * đếm nào theo TÊN TÀI KHOẢN nên spray qua nhiều account gần như tự do.
   *
   * Nay: đếm số lần SAI theo từng tài khoản trong 15 phút. Quá ngưỡng thì
   * chặn, kể cả khi mật khẩu đúng — buộc kẻ tấn công phải chờ.
   *
   * ===== AUDIT #11: BỘ ĐẾM NAY LÀ D1 NGUYÊN TỬ, KHÔNG PHẢI KV =====
   *
   * BẢN CŨ (lỗi): `CACHE.get` rồi `CACHE.put(failCount + 1)` — read-modify-
   * write KHÔNG nguyên tử. N request song song cùng đọc 0 và cùng ghi 1, nên
   * ngưỡng 10 thực tế cho dò được hàng trăm lần nếu bắn song song; ngoài ra
   * mỗi isolate có bản KV riêng (eventual consistency) nên "toàn cục" chỉ là
   * danh nghĩa.
   *
   * NAY: dùng bảng `rate_limits` (đã có từ trước, PK (key, window_at)) với
   * MỘT câu `INSERT ... ON CONFLICT DO UPDATE count = count + 1 RETURNING
   * count` — nguyên tử ở tầng D1, đúng toàn cục. Xem d1Bump/rateLimit ở
   * src/lib/ratelimit.js và counterPeek/counterClear bên dưới.
   *
   * KHOẢNG HỞ CÒN LẠI (nói thẳng, không giấu):
   *   1. Bước ĐỌC đầu tiên (để trả 429 sớm) vẫn là một SELECT thường. Hai
   *      request đồng thời có thể cùng đọc 9 và cùng đi tiếp vào bước kiểm
   *      mật khẩu -> mỗi request dò được 1 mật khẩu trước khi bộ đếm chặn.
   *      Số lần dò tối đa vì thế là N + (số request đang bay cùng lúc), không
   *      phải vô hạn. Lớp chặn THẬT là bước TĂNG nguyên tử: kể cả khi lọt vào
   *      kiểm mật khẩu, lần sai thứ 10 trở đi vẫn bị chặn ngay tại đây.
   *   2. D1 lỗi -> lùi về KV (đọc rồi ghi) như cũ, và nếu lỗi tiếp thì
   *      fail-open (không khoá oan khách vì hạ tầng đếm hỏng). Đây là đánh đổi
   *      có chủ ý, giữ nguyên như bản trước.
   */
  const FAIL_LIMIT = 10;
  const FAIL_WINDOW = 900;
  const failKey = `lf:${loginName}`;
  const {
    counterPeek, counterClear,
    rateLimit: bumpCounterAtomic,
  } = await import('../lib/ratelimit.js');

  // ĐỌC (không tăng): D1 trước, KV chỉ khi D1 lỗi.
  let failCount = 0;
  let counterOk = true;
  try {
    failCount = await counterPeek(env, failKey, FAIL_WINDOW);
  } catch {
    counterOk = false;
    try {
      const rawFail = await env.CACHE.get(failKey);
      failCount = rawFail ? Number(rawFail) : 0;
    } catch { /* KV lỗi -> không chặn */ }
  }
  if (failCount >= FAIL_LIMIT) {
    throw new ApiError(
      429,
      'Tài khoản tạm khoá do sai mật khẩu quá nhiều lần. Thử lại sau 15 phút.',
      'TOO_MANY_ATTEMPTS',
    );
  }
  /** Ghi nhận 1 lần sai NGUYÊN TỬ; reset khi đúng. */
  const bumpFail = async () => {
    /*
     * `FAIL_LIMIT - 1`: rateLimit(failClosed) ném RATE_LIMITED khi
     * count > limit, nên lần sai thứ 10 (count=10 > 9) là lần bị chặn — đúng
     * ngưỡng như bản cũ (khoá NGAY khi chạm ngưỡng, không đợi lượt sau).
     */
    try {
      await bumpCounterAtomic(env, failKey, FAIL_LIMIT - 1, FAIL_WINDOW, { failClosed: true });
      return;
    } catch (e) {
      if (e instanceof ApiError && e.code === 'RATE_LIMITED') {
        throw new ApiError(
          429,
          'Tài khoản tạm khoá do sai mật khẩu quá nhiều lần. Thử lại sau 15 phút.',
          'TOO_MANY_ATTEMPTS',
        );
      }
      if (e instanceof ApiError) throw e;
      /* D1 lỗi -> lớp dự phòng KV (đọc rồi ghi), giữ đúng hành vi cũ. */
    }
    try {
      const next = failCount + 1;
      await env.CACHE.put(failKey, String(next), { expirationTtl: FAIL_WINDOW });
      if (next >= FAIL_LIMIT) {
        throw new ApiError(
          429,
          'Tài khoản tạm khoá do sai mật khẩu quá nhiều lần. Thử lại sau 15 phút.',
          'TOO_MANY_ATTEMPTS',
        );
      }
    } catch (e) {
      if (e instanceof ApiError) throw e;
      /* KV lỗi -> không chặn oan */
    }
  };
  const clearFail = async () => {
    if (counterOk) {
      try { await counterClear(env, failKey, FAIL_WINDOW); } catch { /* ignore */ }
    }
    try { await env.CACHE.put(failKey, '0', { expirationTtl: 60 }); } catch { /* ignore */ }
  };

  const user = await env.DB.prepare(
    'SELECT * FROM users WHERE lower(username) = ? LIMIT 1'
  ).bind(loginName).first();

  // Luôn chạy 1 lượt hash để giảm lộ thông tin thời gian
  if (!user) {
    await bumpFail();
    await hashPassword(password, 'AAAAAAAAAAAAAAAAAAAAAA==');
    throw new ApiError(401, 'Tài khoản hoặc mật khẩu không đúng', 'INVALID_CREDENTIALS');
  }
  if (user.status !== 'active') {
    throw new ApiError(403, 'Tài khoản của bạn đã bị khoá. Vui lòng liên hệ hỗ trợ.', 'ACCOUNT_LOCKED');
  }
  const valid = await verifyPassword(password, user.password_hash, user.password_salt);
  if (!valid) {
    await bumpFail();
    throw new ApiError(401, 'Tài khoản hoặc mật khẩu không đúng', 'INVALID_CREDENTIALS');
  }
  await clearFail();

  // FAIL CLOSED: SESSION_TTL_DAYS khong phai so -> dung 30.
  // Truoc day `Number(x || 30)` cho NaN; NaN*864000 = NaN ->
  // expires_at thanh NaN -> `if (row.expires_at < Date.now())`
  // khong bao gio dung -> phien dang nhap KHONG BAO GIO het han.
  const _ttlRaw = Number(env.SESSION_TTL_DAYS);
  const ttl = Number.isFinite(_ttlRaw) && _ttlRaw > 0 ? _ttlRaw : 30;
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

/* ==========================================================================
 * QUẢN LÝ PHIÊN ĐĂNG NHẬP (F16)
 *
 * Trước đây khách không có cách nào biết mình đang đăng nhập ở đâu, và không
 * có cách nào đá một máy ra. Đây là phần thiếu thật sự — bảng `sessions` vốn
 * đã lưu ip/ua/thời gian.
 * ========================================================================== */

/** GET /api/auth/sessions — danh sách phiên còn hiệu lực. */
export async function listSessions(env, request) {
  const user = await requireUser(env, request);
  const { listUserSessions } = await import('../lib/auth.js');
  const sessions = await listUserSessions(env, user.id, request);
  return ok({
    sessions,
    count: sessions.length,
    /*
     * Cảnh báo mềm: nhiều phiên đang sống cùng lúc có thể là dấu hiệu chia sẻ
     * tài khoản. Không chặn gì — chỉ để khách thấy mà tự xử lý.
     */
    manyActive: sessions.length > 3,
  });
}

/**
 * DELETE /api/auth/sessions/:id — thu hồi MỘT phiên.
 *
 * Chỉ thu hồi được phiên của chính tài khoản đang đăng nhập (truy vấn luôn
 * kèm user_id). Nếu thu hồi đúng phiên đang dùng thì cookie hiện tại cũng
 * mất hiệu lực — trả `self: true` để client đưa khách về trang đăng nhập.
 */
export async function revokeSession(env, request, sessionId) {
  const user = await requireUser(env, request);
  const { revokeUserSession } = await import('../lib/auth.js');
  const { removed, self } = await revokeUserSession(env, user.id, sessionId, request);
  if (!removed) {
    throw new ApiError(404, 'Không tìm thấy phiên này', 'SESSION_NOT_FOUND');
  }
  await audit(env, user.id, 'user.revoke_session', sessionId, { self });
  return ok({
    message: self ? 'Đã đăng xuất thiết bị này' : 'Đã đăng xuất thiết bị',
    self,
  });
}

/** POST /api/auth/sessions/revoke-others — đăng xuất mọi máy khác. */
export async function revokeOtherSessionsRoute(env, request) {
  const user = await requireUser(env, request);
  const { revokeOtherSessions } = await import('../lib/auth.js');
  const { removed } = await revokeOtherSessions(env, user.id, request);
  await audit(env, user.id, 'user.revoke_other_sessions', user.id, { removed });
  return ok({
    message: removed
      ? `Đã đăng xuất ${removed} thiết bị khác`
      : 'Không có thiết bị nào khác đang đăng nhập',
    removed,
  });
}
