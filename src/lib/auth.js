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
    `SELECT s.token_hash, s.expires_at, u.id, u.email, u.full_name, u.phone, u.role, u.status, u.balance
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
  return {
    id: row.id,
    email: row.email,
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
