/** Xác thực & phiên đăng nhập dựa trên cookie HttpOnly + bảng sessions. */
import { sha256, randomHex } from './crypto.js';
import { ApiError } from './http.js';

export const SESSION_COOKIE = 'mbk_session';

export function parseCookies(request) {
  const out = {};
  const raw = request.headers.get('cookie');
  if (!raw) return out;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (!k) continue;
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}

export function sessionCookie(token, maxAgeSeconds) {
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ];
  return parts.join('; ');
}

export function clearCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export async function createSession(env, userId, request, ttlDays = 30) {
  const token = randomHex(32);
  const tokenHash = await sha256(token);
  const now = Date.now();
  const expires = now + ttlDays * 86400_000;
  const ip = request.headers.get('cf-connecting-ip') || '';
  const ua = (request.headers.get('user-agent') || '').slice(0, 400);
  await env.DB.prepare(
    'INSERT INTO sessions (token_hash, user_id, created_at, expires_at, ip, ua) VALUES (?,?,?,?,?,?)'
  )
    .bind(tokenHash, userId, now, expires, ip, ua)
    .run();
  return { token, expires, maxAge: ttlDays * 86400 };
}

export async function getSessionUser(env, request) {
  const cookies = parseCookies(request);
  const token = cookies[SESSION_COOKIE];
  if (!token || token.length !== 64) return null;
  const tokenHash = await sha256(token);
  const row = await env.DB.prepare(
    `SELECT s.token_hash, s.expires_at, u.id, u.email, u.username,
            u.full_name, u.phone, u.role, u.status, u.balance
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? LIMIT 1`
  )
    .bind(tokenHash)
    .first();
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
    return null;
  }
  if (row.status !== 'active') return null;

  // Email nội bộ <username>@local không phải email thật -> trả null
  const isLocal = typeof row.email === 'string' && row.email.endsWith('@local');

  return {
    id: row.id,
    username: row.username || (isLocal ? row.email.slice(0, -6) : null),
    email: isLocal ? null : row.email,
    fullName: row.full_name,
    phone: row.phone,
    role: row.role,
    balance: row.balance,
    tokenHash,
  };
}

export async function requireUser(env, request) {
  const user = await getSessionUser(env, request);
  if (!user) throw new ApiError(401, 'Bạn cần đăng nhập để thực hiện hành động này', 'UNAUTHENTICATED');
  return user;
}

export async function requireAdmin(env, request) {
  const user = await requireUser(env, request);
  if (user.role !== 'admin' && user.role !== 'staff') {
    throw new ApiError(403, 'Bạn không có quyền truy cập', 'FORBIDDEN');
  }
  return user;
}

/**
 * CHỈ admin thật. Dùng cho các thao tác nguy hiểm:
 * đổi role, reset mật khẩu admin khác, xem license toàn hệ thống.
 * Trước đây `staff` dùng chung requireAdmin nên tự nâng được thành admin.
 */
export async function requireAdminStrict(env, request) {
  const user = await requireUser(env, request);
  if (user.role !== 'admin') {
    throw new ApiError(403, 'Chỉ quản trị viên mới được thực hiện thao tác này', 'FORBIDDEN');
  }
  return user;
}

export async function requireCustomer(env, request) {
  const user = await requireUser(env, request);
  if (user.role === 'admin' || user.role === 'staff') {
    // Admin vẫn được mua hàng bình thường
    return user;
  }
  return user;
}

export async function destroySession(env, request) {
  const cookies = parseCookies(request);
  const token = cookies[SESSION_COOKIE];
  if (!token) return;
  const tokenHash = await sha256(token);
  await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
}

export async function purgeExpiredSessions(env) {
  await env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(Date.now()).run();
}

/* ==========================================================================
 * QUẢN LÝ PHIÊN ĐĂNG NHẬP (F16)
 *
 * VÌ SAO CẦN:
 *   Bản cũ không có cách nào để khách xem mình đang đăng nhập ở đâu, và không
 *   có cách nào thu hồi một phiên cụ thể. Hệ quả:
 *     - Nghi ngờ lộ mật khẩu -> chỉ còn cách đổi mật khẩu, mà đổi mật khẩu chỉ
 *       xoá phiên KHÁC (routes/auth.js) chứ không cho chọn từng phiên.
 *     - Máy cũ/điện thoại đã mất vẫn giữ cookie 30 ngày.
 *     - Không phát hiện được đăng nhập lạ vì không thấy danh sách phiên.
 *
 * Dữ liệu đã có sẵn trong bảng `sessions` (ip, ua, created_at, expires_at) —
 * chỉ thiếu phần đọc ra và thu hồi.
 * ========================================================================== */

/**
 * Mô tả ngắn một User-Agent cho người đọc, KHÔNG cần thư viện.
 * Chỉ để khách nhận ra thiết bị của mình, không phải fingerprint.
 */
export function describeUserAgent(ua) {
  const s = String(ua || '');
  if (!s) return 'Không rõ thiết bị';
  const browser =
    /Edg\//.test(s) ? 'Edge'
      : /OPR\/|Opera/.test(s) ? 'Opera'
        : /Firefox\//.test(s) ? 'Firefox'
          : /Chrome\//.test(s) ? 'Chrome'
            : /Safari\//.test(s) ? 'Safari'
              : /curl|python|node|wget/i.test(s) ? 'Công cụ dòng lệnh'
                : 'Trình duyệt khác';
  const os =
    /Windows NT 10/.test(s) ? 'Windows'
      : /Windows/.test(s) ? 'Windows'
        : /Android/.test(s) ? 'Android'
          : /iPhone|iPad|iOS/.test(s) ? 'iOS'
            : /Mac OS X/.test(s) ? 'macOS'
              : /Linux/.test(s) ? 'Linux'
                : '';
  return os ? `${browser} · ${os}` : browser;
}

/**
 * Danh sách phiên còn hiệu lực của một tài khoản.
 *
 * KHÔNG trả `token_hash` — đó là khoá tra phiên; lộ ra ngoài là mở đường
 * chiếm phiên. Thay vào đó trả `id` ngắn, ổn định trong phạm vi tài khoản.
 *
 * ĐỊNH DẠNG `id`: `token_hash` được lưu dưới dạng **base64** (xem
 * `sha256()` trong src/lib/crypto.js), không phải hex. Vì vậy `id` phải là
 * một đoạn của chuỗi base64 đó — bao gồm cả ký tự `+`, `/`, `=` — và mọi
 * so sánh phải làm trên chuỗi ĐÃ ĐƯỢC ĐỐI CHIẾU CHÍNH XÁC, không dùng LIKE
 * (LIKE của SQLite không phân biệt hoa/thường với ASCII, nên 'Ab' khớp 'ab',
 * dẫn tới xoá nhầm phiên).
 */
const SESSION_ID_LEN = 16;

/** Cắt `token_hash` thành id ngắn để hiển thị. */
function shortSessionId(tokenHash) {
  return String(tokenHash || '').slice(0, SESSION_ID_LEN);
}

export async function listUserSessions(env, userId, request) {
  const now = Date.now();
  /*
   * Xoá phiên hết hạn của CHÍNH tài khoản này trước khi liệt kê, để khách
   * không thấy một đống phiên chết. Cron cũng dọn, nhưng chỉ mỗi 10 phút.
   */
  await env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND expires_at < ?')
    .bind(userId, now).run();

  const { results } = await env.DB.prepare(
    `SELECT token_hash, created_at, expires_at, ip, ua
       FROM sessions WHERE user_id = ? AND expires_at >= ?
      ORDER BY created_at DESC LIMIT 50`
  ).bind(userId, now).all();

  const currentHash = await currentSessionHash(request);

  return (results || []).map((r) => ({
    id: shortSessionId(r.token_hash),
    device: describeUserAgent(r.ua),
    ip: r.ip || null,
    created_at: Number(r.created_at) || 0,
    expires_at: Number(r.expires_at) || 0,
    current: currentHash ? r.token_hash === currentHash : false,
  }));
}

/** Hash phiên của request hiện tại (để đánh dấu "phiên này"). */
async function currentSessionHash(request) {
  const cookies = parseCookies(request);
  const token = cookies[SESSION_COOKIE];
  if (!token || token.length !== 64) return null;
  return await sha256(token);
}

/**
 * Thu hồi MỘT phiên theo `id` ngắn.
 *
 * Chỉ xoá được phiên thuộc chính tài khoản đang đăng nhập — truy vấn luôn
 * kèm `user_id` nên không thể thu hồi phiên của người khác dù đoán được id.
 *
 * VÌ SAO ĐỌC RỒI XOÁ THEO KHOÁ CHÍNH, KHÔNG DÙNG LIKE:
 *   - `token_hash` là base64; `LIKE 'abc%'` của SQLite so khớp KHÔNG phân
 *     biệt hoa/thường với ASCII, nên id 'AbC' sẽ khớp cả 'abc' — xoá nhầm
 *     phiên của người khác trong cùng tài khoản.
 *   - Đọc danh sách (tối đa 50 dòng) rồi so sánh CHÍNH XÁC bằng `===`, sau
 *     đó xoá theo `token_hash` đầy đủ (khoá chính) là an toàn tuyệt đối.
 *
 * @returns {Promise<{removed:boolean, self:boolean}>}
 */
export async function revokeUserSession(env, userId, sessionId, request) {
  const id = String(sessionId || '').trim();
  if (!id || id.length > SESSION_ID_LEN) return { removed: false, self: false };

  const { results } = await env.DB.prepare(
    'SELECT token_hash FROM sessions WHERE user_id = ?'
  ).bind(userId).all();

  // So khớp CHÍNH XÁC trên chuỗi đã cắt.
  const match = (results || []).find((r) => shortSessionId(r.token_hash) === id);
  if (!match) return { removed: false, self: false };

  const selfHash = await currentSessionHash(request);
  const self = selfHash ? match.token_hash === selfHash : false;

  const r = await env.DB.prepare(
    'DELETE FROM sessions WHERE user_id = ? AND token_hash = ?'
  ).bind(userId, match.token_hash).run();

  return { removed: (r.meta?.changes || 0) > 0, self };
}

/** Thu hồi TẤT CẢ phiên khác của tài khoản, giữ phiên hiện tại. */
export async function revokeOtherSessions(env, userId, request) {
  const selfHash = await currentSessionHash(request);
  const r = selfHash
    ? await env.DB.prepare(
      'DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?'
    ).bind(userId, selfHash).run()
    : await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId).run();
  return { removed: r.meta?.changes || 0 };
}
