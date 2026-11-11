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
  rebind_token_required: 'Cần mã đổi máy — lấy trên web tại mục License của tôi',
  invalid_token: 'Mã đổi máy không đúng',
  token_used: 'Mã đổi máy đã được dùng',
  token_expired: 'Mã đổi máy đã hết hạn',
};

// Bắt buộc online: không có offline grace cho bất kỳ key nào.
const GRACE_HOURS = 0;
// Giới hạn số lần THẤT BẠI / IP / giờ.
// Trước đây 30 -> quán net 30 máy hoặc khách thử vài lần là bị chặn oan.
// Nay 500: vẫn chặn được brute-force key nhưng không ảnh hưởng NAT chung.
const RATE_LIMIT = 500;
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
    // ===== SERVER-AUTHORITATIVE TIME =====
    // Client KHÔNG được tự quyết định "còn hạn hay không" bằng đồng hồ máy.
    // Trả giờ server trong MỌI response để client neo vào monotonic clock.
    now: nowSec(),
    expires_at: lic.expires_at,
    activated_at: lic.activated_at,
    plan: lic.plan,
    forever: !lic.expires_at,
    // Trial KHONG co offline grace (rut mang = khong chay duoc)
    grace_hours: isTrial ? 0 : GRACE_HOURS,
    trial: isTrial,
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
 *
 * VẤN ĐỀ ĐÃ SỬA: trước đây hàm này bind bất kỳ ai khi `hwid IS NULL`.
 * Admin reset HWID -> cửa mở cho TẤT CẢ. Máy cũ (tool chạy nền, /api/check
 * mỗi 30 phút) sẽ thắng máy mới -> khách đổi máy không bao giờ được.
 *
 * NAY: nếu license đã từng được bind (activated_at IS NOT NULL) thì
 * "hwid = NULL" nghĩa là ĐANG CHỜ ĐỔI MÁY -> bắt buộc phải có
 * rebind_token. Máy cũ không có token -> bị chặn.
 */
async function bindFirstTime(env, lic, key, hwid, ip, now, token) {
  // reset_pending=1: admin vừa reset -> BẮT BUỘC có token.
  // activated_at != null: key đã từng dùng -> cũng cần token (đổi máy).
  const needToken = !!lic.activated_at || !!lic.reset_pending;

  if (needToken) {
    if (!token) {
      await logEvent(env, key, hwid, 'deny', 'rebind needs token', ip);
      return { ok: false, code: 'rebind_token_required' };
    }
    const tokenHash = await sha256hex(token);
    const row = await env.DB.prepare(
      'SELECT * FROM rebind_tokens WHERE token_hash = ? LIMIT 1'
    ).bind(tokenHash).first();
    if (!row) {
      await logEvent(env, key, hwid, 'deny', 'invalid rebind token', ip);
      return { ok: false, code: 'invalid_token' };
    }
    if (row.used) return { ok: false, code: 'token_used' };
    if (row.expires_at < now) return { ok: false, code: 'token_expired' };
    if (row.key !== key) return { ok: false, code: 'invalid_token' };

    await env.DB.prepare('UPDATE rebind_tokens SET used = 1 WHERE token_hash = ?')
      .bind(tokenHash).run();

    // Đổi máy: GIỮ NGUYÊN activated_at + expires_at, chỉ đổi HWID
    await env.DB.prepare(
      `UPDATE licenses SET hwid = ?, last_seen = ?, last_ip = ?,
              reset_pending = 0, reset_at = NULL,
              rebinds = COALESCE(rebinds, 0) + 1
       WHERE key = ?`
    ).bind(hwid, now, ip, key).run();

    lic.hwid = hwid;
    lic.reset_pending = 0;
    await logEvent(env, key, hwid, 'rebind', 'hwid changed (token)', ip);
    return {
      ok: true,
      rebind: true,
      days: lic.expires_at > 0 ? Math.max(0, Math.round((lic.expires_at - now) / 86400)) : 0,
    };
  }

  // Lần kích hoạt ĐẦU TIÊN: tính hạn từ bây giờ
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
  return { ok: true, days, rebind: false };
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
      now: now,   // server-authoritative time
      expires_at: v.expires_at || 0,
    }, 403);
  }

  if (v.firstBind) {
    // Truyền token để bindFirstTime biết đây là đổi máy hay kích hoạt lần đầu
    const br = await bindFirstTime(env, lic, key, hwid, ip, now, b.token);
    if (!br.ok) {
      await logAttempt(env, ip, false);
      return json({
        ok: false, code: br.code,
        msg: MESSAGES[br.code] || 'Cần mã đổi máy hợp lệ',
        now,
      }, 403);
    }
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

  // ===== NHÁNH RIÊNG CHO TRIAL =====
  // Trial KHÔNG dùng bindFirstTime: hạn đã được tính sẵn lúc cấp,
  // và cần trả thêm quota + nhịp recheck cho client.
  if (lic && lic.plan === 'trial') {
    return trialCheck(env, request, lic, key, hwid, ip, now);
  }

  const v = judge(lic, hwid, now);

  if (!v.ok) {
    await logAttempt(env, ip, false);
    await logEvent(env, key, hwid, 'deny', v.code, ip);
    return json({
      ok: false, code: v.code, msg: MESSAGES[v.code] || v.code,
      now: now,   // server-authoritative time
      expires_at: v.expires_at || 0,
    }, 403);
  }

  // Bản cũ gọi lại apiActivate ở đây -> body đã bị đọc -> 400.
  // Nay xử lý bind trực tiếp.
  if (v.firstBind) {
    // license từng bị reset -> cần token đổi máy, tránh máy cũ tự bind lại
    const br = await bindFirstTime(env, lic, key, hwid, ip, now, b.token);
    if (!br.ok) {
      await logAttempt(env, ip, false);
      return json({
        ok: false, code: br.code,
        msg: MESSAGES[br.code] || 'Cần mã đổi máy hợp lệ',
        now,
      }, 403);
    }
    await logAttempt(env, ip, true);
    return json(publicLic(lic, { first_bind: true, rebound: !!br.rebind }));
  }

  await env.DB.prepare(
    'UPDATE licenses SET last_seen = ?, last_ip = ? WHERE key = ?'
  ).bind(now, ip, key).run();
  await logAttempt(env, ip, true);
  await logEvent(env, key, hwid, 'check', null, ip);

  return json(publicLic(lic));
}

/**
 * Kiểm tra trial: bắt đầu đồng hồ ở lần check ĐẦU TIÊN, trả quota + recheck.
 */
async function trialCheck(env, request, lic, key, hwid, ip, now) {
  const { trialCfg, getQuota, publicUse, normKind, KIND_1H, KIND_3D } =
    await import('../lib/trial-quota.js');

  // Tìm grant tương ứng
  const use = await env.DB.prepare(
    'SELECT * FROM trial_uses WHERE lic_key = ? LIMIT 1'
  ).bind(key).first();

  if (!use) {
    // License trial tồn tại nhưng không có grant -> dữ liệu cũ (v1)
    // Cho chạy nếu license còn hạn, nhưng không có quota.
    const v = judge(lic, hwid, now);
    if (!v.ok) {
      return json({
        ok: false, code: v.code, msg: MESSAGES[v.code] || v.code,
        now, expires_at: v.expires_at || 0,
      }, 403);
    }
    return json(publicLic(lic, { legacy_trial: true }));
  }

  // Đã bị thu hồi / dừng
  if (use.ended_at) {
    await logEvent(env, key, hwid, 'deny', `trial ${use.end_reason || 'ended'}`, ip);
    return json({
      ok: false, code: 'trial_expired',
      msg: use.end_reason === 'reset'
        ? 'Lượt dùng thử đã được đặt lại'
        : 'Lượt dùng thử đã kết thúc',
      now, expires_at: use.expires_at || 0,
    }, 403);
  }

  // HWID không khớp -> chặn copy lic.bin
  if (use.hwid && use.hwid !== hwid) {
    await logEvent(env, key, hwid, 'deny', 'trial hwid mismatch', ip);
    return json({
      ok: false, code: 'hwid_mismatch',
      msg: 'Mã dùng thử đã gắn với máy khác',
      now,
    }, 403);
  }

  // ===== BẮT ĐẦU ĐỒNG HỒ Ở LẦN CHECK ĐẦU TIÊN =====
  if (!use.started_at) {
    const cfg = await trialCfg(env);
    const kind = normKind(use.kind) || KIND_3D;
    const secs = kind === KIND_1H ? cfg.t1h.sec : cfg.t3d.sec;
    const startedAt = now;
    const expiresAt = now + secs;

    // Ghi HWID ngay lần check đầu tiên.
    // Trước đây trial cấp qua web có hwid=NULL và KHÔNG BAO GIỜ được ghi
    // -> máy nào gọi /api/check đầu tiên sẽ chiếm license vĩnh viễn,
    // ai có mã TR- đều dùng được. Nay bind đúng như key trả phí.
    await env.DB.prepare(
      `UPDATE trial_uses SET started_at = ?, expires_at = ?,
              hwid = COALESCE(hwid, ?) WHERE id = ? AND started_at IS NULL`
    ).bind(startedAt, expiresAt, hwid, use.id).run();
    await env.DB.prepare(
      `UPDATE licenses SET activated_at = ?, expires_at = ?,
              hwid = COALESCE(hwid, ?) WHERE key = ?`
    ).bind(startedAt, expiresAt, hwid, key).run();

    const fresh = await env.DB.prepare('SELECT * FROM trial_uses WHERE id = ?')
      .bind(use.id).first();

    await logEvent(env, key, hwid, 'trial_activate', `${kind} ${secs}s`, ip);

    return json({
      ...publicUse(fresh, cfg, kind),
      trial_kind_state: 'activated',
      now,
    });
  }

  // Đã kích hoạt -> kiểm hạn
  if (use.expires_at && use.expires_at <= now) {
    await env.DB.prepare(
      "UPDATE trial_uses SET ended_at = ?, end_reason = 'expired' WHERE id = ? AND ended_at IS NULL"
    ).bind(now, use.id).run();
    await logEvent(env, key, hwid, 'deny', 'trial expired', ip);
    return json({
      ok: false, code: 'trial_expired',
      msg: 'Lượt dùng thử đã hết hạn',
      now, expires_at: use.expires_at,
    }, 403);
  }

  // Còn hạn -> trả trạng thái + quota
  const cfg = await trialCfg(env);
  const kind = normKind(use.kind) || KIND_3D;
  const quota = use.user_id
    ? await getQuota(env, use.user_id, kind, kind === KIND_1H ? cfg.t1h.quota : cfg.t3d.quota)
    : null;

  await env.DB.prepare(
    'UPDATE licenses SET last_seen = ?, last_ip = ? WHERE key = ?'
  ).bind(now, ip, key).run();

  return json({
    ...publicUse(use, cfg, kind),
    trial_kind_state: 'active',
    now,
    ...(quota ? { used: quota.used, quota: quota.quota, left: quota.left } : {}),
  });
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
