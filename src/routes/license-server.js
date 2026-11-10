/**
 * License server cho client XArena — chạy CHUNG worker muabankey.
 *
 * Giao thức giữ nguyên 100% để client xa_nofog_pro.py/EXE không cần sửa:
 *   POST /api/activate  {key, hwid, app}  -> {ok, expires_at, plan, grace_hours, first_bind}
 *   POST /api/check     {key, hwid, app}  -> {ok, expires_at, ...}
 *   POST /api/rebind    {key, hwid}       -> {ok, rebinds_left}
 *   GET  /api/license/health
 *
 * Khác biệt so với bản cũ: chỉ một worker, một CSDL (muabankey-db).
 * Đã vá bug firstBind: apiCheck không gọi lại apiActivate nữa mà xử lý bind
 * trực tiếp, nên body không bị đọc hai lần.
 */
import { json, ApiError } from '../lib/http.js';

const MESSAGES = {
  not_found: 'Mã không tồn tại',
  revoked: 'Mã đã bị thu hồi',
  expired: 'Mã đã hết hạn',
  hwid_mismatch: 'Mã đã dùng trên máy khác',
  reset: 'Mã đã bị reset, cần kích hoạt lại',
  rate_limit: 'Quá nhiều lần thử, thử lại sau',
  trial_expired: 'Đã hết hạn dùng thử',
  trial_only: 'Đây là mã dùng thử',
};

const GRACE_HOURS = 24;
const RATE_LIMIT = 30;
const RATE_WINDOW = 3600;

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

export function normKey(k) {
  return String(k || '').trim().toUpperCase().replace(/\s+/g, '');
}

/* ------------------------------ helpers ------------------------------ */

async function rateOk(env, ip) {
  const since = nowSec() - RATE_WINDOW;
  const row = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM lic_attempts WHERE ip = ? AND at > ? AND ok = 0'
  ).bind(ip, since).first();
  return (row?.n || 0) < RATE_LIMIT;
}

async function logAttempt(env, ip, ok) {
  try {
    await env.DB.prepare('INSERT INTO lic_attempts (ip, at, ok) VALUES (?,?,?)')
      .bind(ip, nowSec(), ok ? 1 : 0).run();
    // Dọn định kỳ để bảng không phình
    if (Math.random() < 0.02) {
      await env.DB.prepare('DELETE FROM lic_attempts WHERE at < ?')
        .bind(nowSec() - 7 * 86400).run();
    }
  } catch { /* không chặn luồng chính */ }
}

async function logEvent(env, key, hwid, kind, detail, ip) {
  try {
    await env.DB.prepare(
      'INSERT INTO lic_events (key, hwid, kind, detail, ip, at) VALUES (?,?,?,?,?,?)'
    ).bind(key, hwid || null, kind, detail || null, ip || null, nowSec()).run();
  } catch { /* ignore */ }
}

async function getLicense(env, key) {
  return await env.DB.prepare('SELECT * FROM licenses WHERE key = ?').bind(key).first();
}

function judge(lic, hwid, now) {
  if (!lic) return { ok: false, code: 'not_found' };
  if (lic.revoked) return { ok: false, code: 'revoked' };
  if (lic.expires_at && lic.expires_at > 0 && lic.expires_at < now) {
    return { ok: false, code: 'expired', expires_at: lic.expires_at };
  }
  if (!lic.hwid) return { ok: true, firstBind: true };
  if (lic.hwid !== hwid) return { ok: false, code: 'hwid_mismatch' };
  return { ok: true };
}

function publicLic(lic, extra = {}) {
  const isTrial = lic && lic.plan === 'trial';
  return {
    ok: true,
    expires_at: lic.expires_at,
    activated_at: lic.activated_at,
    plan: lic.plan,
    forever: !lic.expires_at,
    // Trial KHONG co offline grace (rut mang = khong chay duoc, 3 ngay khong thanh 4)
    grace_hours: isTrial ? 0 : GRACE_HOURS,
    ...extra,
  };
}

async function readBody(request) {
  const text = await request.text();
  if (!text) return null;
  try {
    const v = JSON.parse(text);
    return (v && typeof v === 'object' && !Array.isArray(v)) ? v : null;
  } catch {
    return null;
  }
}

function ipOf(request) {
  return request.headers.get('cf-connecting-ip') || 'unknown';
}

/**
 * Gắn máy cho license lần đầu + bắt đầu tính hạn từ BÂY GIỜ.
 * Tách riêng để cả activate và check dùng chung (không đọc lại body).
 */
async function bindFirstTime(env, lic, key, hwid, ip, now) {
  const days = lic.expires_at > 0
    ? Math.max(1, Math.round((lic.expires_at - lic.created_at) / 86400))
    : 0;
  const exp = days === 0 ? 0 : now + days * 86400;
  await env.DB.prepare(
    `UPDATE licenses SET hwid = ?, activated_at = ?, expires_at = ?,
            last_seen = ?, last_ip = ? WHERE key = ?`
  ).bind(hwid, now, exp, now, ip, key).run();
  await logEvent(env, key, hwid, 'activate',
    'first bind, ' + (days === 0 ? 'forever' : days + 'd'), ip);
  lic.expires_at = exp;
  lic.activated_at = now;
  lic.hwid = hwid;
  return days;
}

/* ------------------------------ handlers ------------------------------ */

export async function apiActivate(env, request) {
  const ip = ipOf(request);
  const b = await readBody(request);
  if (!b) return json({ ok: false, code: 'bad_request', msg: 'JSON không hợp lệ' }, 400);

  const key = normKey(b.key);
  const hwid = String(b.hwid || '').trim();

  if (!key || !hwid) {
    return json({ ok: false, code: 'bad_request', msg: 'Thiếu mã hoặc HWID' }, 400);
  }
  if (hwid.length < 8 || hwid.length > 128) {
    return json({ ok: false, code: 'bad_request', msg: 'HWID không hợp lệ' }, 400);
  }
  if (!(await rateOk(env, ip))) {
    await logAttempt(env, ip, false);
    return json({ ok: false, code: 'rate_limit', msg: MESSAGES.rate_limit }, 429);
  }

  const lic = await getLicense(env, key);
  const now = nowSec();

  // Trial key KHÔNG kích hoạt được qua /api/activate (chỉ qua /api/trial/start).
  // Nếu cho phép, 1 key trial share ra 100 máy đều activate được.
  if (lic && lic.plan === 'trial') {
    await logEvent(env, key, hwid, 'deny', 'trial key via activate', ip);
    return json({
      ok: false, code: 'trial_only',
      msg: 'Đây là mã dùng thử, không kích hoạt được theo cách này',
    }, 403);
  }

  const v = judge(lic, hwid, now);

  if (!v.ok) {
    await logAttempt(env, ip, false);
    await logEvent(env, key, hwid, 'deny', v.code, ip);
    return json({
      ok: false, code: v.code, msg: MESSAGES[v.code] || v.code,
      expires_at: v.expires_at || 0,
    }, 403);
  }

  if (v.firstBind) {
    await bindFirstTime(env, lic, key, hwid, ip, now);
  } else {
    await env.DB.prepare(
      'UPDATE licenses SET last_seen = ?, last_ip = ? WHERE key = ?'
    ).bind(now, ip, key).run();
    await logEvent(env, key, hwid, 'activate', 'same hwid', ip);
  }

  await logAttempt(env, ip, true);
  return json(publicLic(lic, { first_bind: !!v.firstBind }));
}

export async function apiCheck(env, request) {
  const ip = ipOf(request);
  const b = await readBody(request);
  if (!b) return json({ ok: false, code: 'bad_request', msg: 'JSON không hợp lệ' }, 400);

  const key = normKey(b.key);
  const hwid = String(b.hwid || '').trim();
  if (!key || !hwid) return json({ ok: false, code: 'bad_request' }, 400);
  if (!(await rateOk(env, ip))) {
    return json({ ok: false, code: 'rate_limit', msg: MESSAGES.rate_limit }, 429);
  }

  const lic = await getLicense(env, key);
  const now = nowSec();
  const v = judge(lic, hwid, now);

  if (!v.ok) {
    await logAttempt(env, ip, false);
    await logEvent(env, key, hwid, 'deny', v.code, ip);
    return json({
      ok: false, code: v.code, msg: MESSAGES[v.code] || v.code,
      expires_at: v.expires_at || 0,
    }, 403);
  }

  // Bản cũ gọi lại apiActivate ở đây -> body đã bị đọc -> 400.
  // Nay xử lý bind trực tiếp.
  if (v.firstBind) {
    await bindFirstTime(env, lic, key, hwid, ip, now);
    await logAttempt(env, ip, true);
    return json(publicLic(lic, { first_bind: true }));
  }

  await env.DB.prepare(
    'UPDATE licenses SET last_seen = ?, last_ip = ? WHERE key = ?'
  ).bind(now, ip, key).run();
  await logAttempt(env, ip, true);
  await logEvent(env, key, hwid, 'check', null, ip);

  return json(publicLic(lic));
}

export async function apiRebind(env, request) {
  const ip = ipOf(request);
  const b = await readBody(request);
  if (!b) return json({ ok: false, code: 'bad_request' }, 400);

  const key = normKey(b.key);
  const hwid = String(b.hwid || '').trim();
  if (!key || !hwid) return json({ ok: false, code: 'bad_request' }, 400);

  // ===== BẢO VỆ: /api/rebind là endpoint CÔNG KHAI mà client EXE gọi.
  // Trước đây ai biết key là đổi được HWID -> chiếm license người khác.
  // Nay yêu cầu:
  //   - hoặc đăng nhập web và sở hữu key,
  //   - hoặc có rebind token do chủ key xin từ trang cá nhân.
  const { getSessionUser } = await import('../lib/auth.js');
  const user = await getSessionUser(env, request);

  if (user) {
    const owns = await env.DB.prepare(
      'SELECT 1 AS x FROM license_issues WHERE user_id = ? AND license_key = ? LIMIT 1'
    ).bind(user.id, key).first();
    if (!owns) {
      await logEvent(env, key, hwid, 'deny', 'rebind: not owner', ip);
      return json({ ok: false, code: 'forbidden', msg: 'Bạn không sở hữu mã này' }, 403);
    }
  } else {
    // Không có session: chấp nhận nếu client gửi kèm rebind token hợp lệ
    const token = String(b.token || request.headers.get('x-rebind-token') || '').trim();
    if (!token) {
      await logEvent(env, key, hwid, 'deny', 'rebind: no auth', ip);
      return json({ ok: false, code: 'unauthorized', msg: 'Cần đăng nhập để đổi máy' }, 401);
    }
    const row = await env.DB.prepare(
      `SELECT 1 AS x FROM rebind_tokens
       WHERE key = ? AND token_hash = ? AND used = 0 AND expires_at > ? LIMIT 1`
    ).bind(key, await sha256hex(token), nowSec()).first();
    if (!row) {
      await logEvent(env, key, hwid, 'deny', 'rebind: bad token', ip);
      return json({ ok: false, code: 'unauthorized', msg: 'Mã đổi máy không hợp lệ' }, 401);
    }
    // Token dùng 1 lần
    await env.DB.prepare('UPDATE rebind_tokens SET used = 1 WHERE key = ? AND token_hash = ?')
      .bind(key, await sha256hex(token)).run();
  }

  // ===== ATOMIC: tránh TOCTOU, chỉ update khi còn lượt
  const now = nowSec();
  const up = await env.DB.prepare(
    `UPDATE licenses SET hwid = ?, rebinds = rebinds + 1, last_seen = ?, last_ip = ?
     WHERE key = ? AND revoked = 0 AND rebinds < max_rebind`
  ).bind(hwid, now, ip, key).run();

  if (!up.meta || up.meta.changes !== 1) {
    const lic = await getLicense(env, key);
    if (!lic) return json({ ok: false, code: 'not_found' }, 404);
    if (lic.revoked) return json({ ok: false, code: 'revoked' }, 403);
    return json({ ok: false, code: 'rebind_limit', msg: 'Hết số lần đổi máy' }, 403);
  }

  await logEvent(env, key, hwid, 'rebind', 'to ' + hwid, ip);
  const lic = await getLicense(env, key);
  return json({
    ok: true,
    rebinds_left: Math.max(0, (lic.max_rebind || 0) - (lic.rebinds || 0)),
    expires_at: lic.expires_at,
  });
}

/** SHA-256 hex, dùng cho rebind token. */
async function sha256hex(text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function apiHealth(env) {
  const total = await env.DB.prepare('SELECT COUNT(*) AS n FROM licenses').first();
  return json({ ok: true, at: nowSec(), licenses: total?.n || 0, server: 'muabankey' });
}
