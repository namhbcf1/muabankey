/**
 * Trial 1 GIỜ và 3 NGÀY, mỗi loại 10 lượt/tài khoản.
 *
 * BẢO MẬT:
 *   - Bắt buộc đăng nhập (không cho curl farm)
 *   - Server tự băm HWID từ raw parts — không tin hwid client gửi
 *   - Trừ lượt NGUYÊN TỬ (UPDATE WHERE used < quota)
 *   - 1 máy chỉ được N tài khoản trial (chặn farm account)
 *   - idem_key chống retry trừ 2 lượt
 *   - Giới hạn IP / subnet / toàn hệ thống
 *
 * THỜI GIAN:
 *   - 1 giờ = 3600 giây, 3 ngày = 259200 giây (tuyệt đối, không ngày lịch)
 *   - Bắt đầu đếm từ /api/check thành công LẦN ĐẦU (không phải lúc cấp)
 *   - Hold 7 ngày: cấp rồi không kích hoạt thì vô hiệu
 *   - Trả `now` để client neo giờ server vào monotonic clock
 */
import { json } from '../lib/http.js';
import {
  trialCfg, kindCfg, normKind, nowSec, trialKey, sha256hex,
  looksVirtual, deriveIds, getQuota, consumeUse, refundUse,
  activeUse, deviceAccountCount, countRecent, publicUse,
  KIND_1H, KIND_3D,
} from '../lib/trial-quota.js';

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

async function logEvent(env, key, hwid, kind, detail, ip) {
  try {
    await env.DB.prepare(
      'INSERT INTO lic_events (key, hwid, kind, detail, ip, at) VALUES (?,?,?,?,?,?)'
    ).bind(key, hwid || null, kind, detail || null, ip || null, nowSec()).run();
  } catch { /* ignore */ }
}

/**
 * GET /api/trial/status — xem còn bao nhiêu lượt.
 * Cần đăng nhập.
 */
export async function apiTrialStatus(env, request) {
  const { getSessionUser } = await import('../lib/auth.js');
  const user = await getSessionUser(env, request);
  if (!user) {
    return json({
      ok: false, code: 'login_required',
      msg: 'Đăng nhập để dùng thử',
    }, 401);
  }

  const cfg = await trialCfg(env);
  if (!cfg.enabled) {
    return json({ ok: false, code: 'trial_disabled', msg: 'Dùng thử đang tạm đóng' }, 403);
  }

  const [q1h, q3d, a1h, a3d] = await Promise.all([
    getQuota(env, user.id, KIND_1H, cfg.t1h.quota),
    getQuota(env, user.id, KIND_3D, cfg.t3d.quota),
    activeUse(env, user.id, KIND_1H),
    activeUse(env, user.id, KIND_3D),
  ]);

  return json({
    ok: true,
    now: nowSec(),
    username: user.username || user.email,
    kinds: {
      [KIND_1H]: {
        enabled: cfg.t1h.enabled,
        used: q1h.used, quota: q1h.quota, left: q1h.left,
        active: a1h ? { ...publicUse(a1h, cfg, KIND_1H), hwid: a1h.hwid } : null,
        recheck_sec: cfg.recheck1h,
      },
      [KIND_3D]: {
        enabled: cfg.t3d.enabled,
        used: q3d.used, quota: q3d.quota, left: q3d.left,
        active: a3d ? { ...publicUse(a3d, cfg, KIND_3D), hwid: a3d.hwid } : null,
        recheck_sec: cfg.recheck3d,
      },
    },
  });
}

/**
 * POST /api/trial/start { guid, bios, cpu, vol, kind, idem_key }
 *
 * kind: '1h' | '3d' (mặc định '3d')
 * Bắt buộc đăng nhập.
 */
export async function apiTrialStart(env, request) {
  const ip = ipOf(request);
  const ua = (request.headers.get('user-agent') || '').slice(0, 200);
  const body = await readBody(request);
  if (!body) {
    return json({ ok: false, code: 'bad_request', msg: 'JSON không hợp lệ' }, 400);
  }

  // ---- 1. Bắt buộc đăng nhập ----
  const { getSessionUser } = await import('../lib/auth.js');
  const user = await getSessionUser(env, request);
  if (!user) {
    return json({
      ok: false, code: 'login_required',
      msg: 'Cần đăng nhập để dùng thử. Tạo tài khoản miễn phí trên web.',
    }, 401);
  }

  const cfg = await trialCfg(env);
  if (!cfg.enabled) {
    return json({ ok: false, code: 'trial_disabled', msg: 'Dùng thử đang tạm đóng' }, 403);
  }

  // ---- 2. Xác định loại trial ----
  const kind = normKind(body.kind) || KIND_3D;
  const kc = kindCfg(cfg, kind);
  if (!kc || !kc.enabled) {
    return json({
      ok: false, code: 'trial_kind_invalid',
      msg: `Loại dùng thử "${kind}" không khả dụng`,
    }, 400);
  }

  // ---- 3. Rate limit riêng cho trial ----
  try {
    const { rateLimit } = await import('../lib/ratelimit.js');
    await rateLimit(env, `trial:${ip}`, 20, 3600);
    await rateLimit(env, `trial:u:${user.id}`, 30, 3600);
  } catch (e) {
    if (e && e.code === 'RATE_LIMITED') {
      return json({
        ok: false, code: 'rate_limit',
        msg: 'Bạn thao tác quá nhanh, thử lại sau ít phút',
      }, 429);
    }
    throw e;
  }

  // ---- 4. Idempotency: retry mạng không trừ 2 lượt ----
  const idemKey = String(body.idem_key || '').trim().slice(0, 64) || null;
  if (idemKey) {
    const dup = await env.DB.prepare(
      'SELECT * FROM trial_uses WHERE idem_key = ? LIMIT 1'
    ).bind(idemKey).first();
    if (dup) {
      if (dup.expires_at && dup.expires_at < nowSec()) {
        return json({ ok: false, code: 'trial_expired', msg: 'Lượt dùng thử này đã hết hạn' }, 403);
      }
      return json({ ...publicUse(dup, cfg, kind), trial_kind_state: 'idem' });
    }
  }

  // ---- 5. Tính HWID từ raw parts ----
  // Web KHÔNG đọc được phần cứng máy khách, nên cho phép bỏ trống:
  //   - Có raw parts -> tính HWID ngay (client tool gửi)
  //   - Không có      -> cấp key trước, HWID gắn ở /api/check lần đầu
  //     (bảo vệ bằng: license chưa bind thì chỉ bind được 1 lần,
  //      sau đó đổi máy phải có token)
  let ids;
  const hasParts = (body.guid !== undefined || body.bios !== undefined
    || body.cpu !== undefined || body.vol !== undefined);
  const hasHwid = !!body.hwid;

  if (hasParts) {
    ids = await deriveIds([body.guid, body.bios, body.cpu, body.vol]);
  } else if (hasHwid) {
    const raw = String(body.hwid).trim().toLowerCase();
    if (!/^[0-9a-z]{16,128}$/.test(raw)) {
      return json({ ok: false, code: 'bad_request', msg: 'HWID không hợp lệ' }, 400);
    }
    ids = { hwid: raw, weak: raw, bios: '', cpu: '' };
  } else {
    // WEB PATH: cấp key trước, HWID = NULL -> bind ở /api/check lần đầu
    ids = { hwid: null, weak: null, bios: '', cpu: '' };
  }

  // ---- 6. Chặn máy ảo (chỉ khi biết thông tin máy) ----
  if (ids.bios || ids.cpu) {
    if (looksVirtual(ids.bios, ids.cpu)) {
      await logEvent(env, '-', ids.hwid, 'trial_deny', 'virtual machine', ip);
      return json({
        ok: false, code: 'trial_denied_device',
        msg: 'Không hỗ trợ dùng thử trên máy ảo',
      }, 403);
    }
  }

  // ---- 7. Thiết bị bị ban (chỉ khi có weak) ----
  if (ids.weak) {
    const banned = await env.DB.prepare(
      'SELECT reason FROM trial_bans WHERE scope = ? AND value = ?'
    ).bind('weak', ids.weak).first();
    if (banned) {
      return json({
        ok: false, code: 'trial_denied_device',
        msg: 'Thiết bị này bị chặn dùng thử',
      }, 403);
    }
  }

  // ---- 8. Đang có trial cùng loại còn hạn -> RESUME, không trừ lượt ----
  const active = await activeUse(env, user.id, kind);
  if (active) {
    // Nếu gửi HWID và khác -> cập nhật (đổi máy/đổi volume serial), không trừ lượt
    let hwidChanged = false;
    if (ids.hwid && active.hwid !== ids.hwid) {
      await env.DB.prepare(
        'UPDATE trial_uses SET hwid = ? WHERE id = ?'
      ).bind(ids.hwid, active.id).run();
      await env.DB.prepare(
        'UPDATE licenses SET hwid = ? WHERE key = ?'
      ).bind(ids.hwid, active.lic_key).run();
      hwidChanged = true;
    }
    const q = await getQuota(env, user.id, kind, kc.quota);
    return json({
      ...publicUse(active, cfg, kind),
      hwid: ids.hwid || active.hwid || null,
      hwid_updated: hwidChanged,
      trial_kind_state: 'resume',
      used: q.used, quota: q.quota, left: q.left,
      now: nowSec(),
    });
  }

  // ---- 9. Chống farm tài khoản trên 1 máy (chỉ khi có weak) ----
  if (ids.weak) {
    const maxAcc = kind === KIND_1H ? cfg.deviceAccounts1h : cfg.deviceAccounts3d;
    const accCount = await deviceAccountCount(env, ids.weak, kind, user.id);
    if (accCount >= maxAcc) {
      await logEvent(env, '-', ids.hwid, 'trial_deny', `device has ${accCount} accounts`, ip);
      return json({
        ok: false, code: 'trial_device_limit',
        msg: 'Máy này đã dùng thử cho nhiều tài khoản khác. '
          + 'Mỗi máy chỉ được dùng thử cho một số tài khoản nhất định.',
      }, 403);
    }
  }

  // ---- 10. Hạn mức IP / subnet / ngày ----
  const since30d = nowSec() - 30 * 86400;
  const net = String(ip).split('.').slice(0, 3).join('.');

  if (ip !== 'unknown') {
    const nIp = await countRecent(env, ip, net, nowSec() - 86400, { perIp: true });
    if (nIp >= cfg.maxPerIp) {
      return json({
        ok: false, code: 'trial_ip_limit',
        msg: 'Kết nối này đã dùng hết lượt dùng thử hôm nay',
      }, 429);
    }
    if (net.split('.').length === 3) {
      const nNet = await countRecent(env, ip, net, since30d, { perIp: false });
      if (nNet >= cfg.maxPerNet) {
        return json({
          ok: false, code: 'trial_ip_limit',
          msg: 'Mạng này đã dùng hết lượt dùng thử',
        }, 429);
      }
    }
  }

  const nDay = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM trial_uses WHERE created_at > ?'
  ).bind(nowSec() - 86400).first();
  if ((nDay?.n || 0) >= cfg.maxPerDay) {
    return json({
      ok: false, code: 'trial_global_limit',
      msg: 'Hệ thống đã đạt giới hạn dùng thử hôm nay, vui lòng thử lại mai',
    }, 429);
  }

  // ---- 11. Trừ lượt NGUYÊN TỬ ----
  const quota = await consumeUse(env, user.id, kind, kc.quota);
  if (!quota.ok) {
    if (quota.reason === 'banned') {
      return json({
        ok: false, code: 'trial_banned',
        msg: 'Tài khoản này bị chặn dùng thử',
      }, 403);
    }
    return json({
      ok: false, code: 'trial_quota_exhausted',
      msg: `Đã dùng hết ${quota.quota} lượt dùng thử ${kind === KIND_1H ? '1 giờ' : '3 ngày'}`,
      used: quota.used, quota: quota.quota, left: 0,
      other_kind_left: undefined,
    }, 403);
  }

  // ---- 12. Cấp license trial ----
  const key = trialKey();
  const useId = crypto.randomUUID();
  const now = nowSec();
  const holdUntil = now + cfg.holdSec;

  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO licenses
           (key, hwid, plan, note, created_at, activated_at, expires_at,
            last_seen, last_ip, revoked, max_rebind, rebinds)
         VALUES (?,?, 'trial', ?,?, NULL, ?, NULL, ?, 0, 0, 0)`
      ).bind(key, ids.hwid, `Trial ${kind} - ${user.username || user.id}`,
        now, holdUntil, ip),
      env.DB.prepare(
        `INSERT INTO trial_uses
           (id, user_id, kind, lic_key, hwid, device_weak, ip, ua,
            started_at, expires_at, created_at, idem_key)
         VALUES (?,?,?,?,?,?,?,?, NULL, ?, ?, ?)`
      ).bind(useId, user.id, kind, key, ids.hwid, ids.weak,
        ip, ua, holdUntil, now, idemKey),
    ]);
  } catch (e) {
    // Cấp lỗi -> HOÀN LƯỢT để khách không mất oan
    await refundUse(env, user.id, kind);
    console.error('trial issue:', e && e.message);
    return json({ ok: false, code: 'server_error', msg: 'Không tạo được dùng thử' }, 500);
  }

  await logEvent(env, key, ids.hwid, 'trial_start', `${kind} #${quota.used}/${quota.quota}`, ip);

  const row = await env.DB.prepare('SELECT * FROM trial_uses WHERE id = ?').bind(useId).first();
  return json({
    ...publicUse(row, cfg, kind),
    // Client cần hwid thật để gọi /api/check — KHÔNG phải raw parts
    hwid: ids.hwid,
    trial_kind_state: 'new',
    used: quota.used,
    quota: quota.quota,
    left: quota.left,
    hold_until: holdUntil,
    now: nowSec(),
  });
}

/**
 * POST /api/trial/stop — khách tự dừng trial (giải phóng, KHÔNG hoàn lượt).
 * Dùng khi khách muốn đổi sang gói khác ngay.
 */
export async function apiTrialStop(env, request) {
  const { getSessionUser } = await import('../lib/auth.js');
  const user = await getSessionUser(env, request);
  if (!user) return json({ ok: false, code: 'login_required' }, 401);

  const body = await readBody(request).catch(() => ({}));
  const kind = normKind(body?.kind) || KIND_3D;

  const active = await activeUse(env, user.id, kind);
  if (!active) return json({ ok: true, stopped: false, reason: 'NO_ACTIVE_TRIAL' });

  const now = nowSec();
  await env.DB.prepare(
    "UPDATE trial_uses SET expires_at = ?, ended_at = ?, end_reason = 'stopped' WHERE id = ?"
  ).bind(now, now, active.id).run();
  await env.DB.prepare('UPDATE licenses SET expires_at = ? WHERE key = ?')
    .bind(now, active.lic_key).run();

  return json({ ok: true, stopped: true, key: active.lic_key });
}
