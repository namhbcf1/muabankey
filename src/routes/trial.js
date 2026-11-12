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
  looksVirtual, deriveIds, getQuota, consumeUse, refundUse, checkWhitelist,
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
 * POST /api/trial/claim { key, guid, bios, cpu, vol }
 *
 * Nhận mã TR- do WEB cấp, gắn với máy đang chạy tool.
 *
 * VẤN ĐỀ ĐÃ SỬA: web cấp mã TR- rồi bảo "chạy tool, nó tự nhận mã này"
 * nhưng /api/activate chặn plan='trial' (trial_only) và tool không có
 * endpoint nào để nhận. Đường web→tool đứt hoàn toàn.
 *
 * Endpoint này lấp chỗ đứt: khách nhập mã TR- vào tool, tool gọi đây.
 */
export async function apiTrialClaim(env, request) {
  const ip = ipOf(request);
  const body = await readBody(request);
  if (!body) {
    return json({ ok: false, code: 'bad_request', msg: 'JSON không hợp lệ' }, 400);
  }

  /*
   * ===== CHẶN LẠM DỤNG (đã vá) =====
   *
   * Trước đây route này KHÔNG có bất kỳ kiểm soát nào: không rate limit,
   * không kiểm ban, không đếm quota, không giới hạn số máy. Chỉ cần biết
   * một mã TR- là gọi được từ bao nhiêu máy cũng xong — trong khi mọi
   * đường trial khác đều bị chặn.
   *
   * Nay: rate limit theo IP + kiểm trial_bans trước khi làm bất cứ việc gì.
   * Đây là lớp phòng thủ rẻ, chặn dò mã và chặn máy đã bị đánh dấu.
   */
  try {
    const { rateLimit } = await import('../lib/ratelimit.js');
    await rateLimit(env, `trialc:${ip}`, 30, 3600, { failClosed: true });
  } catch (e) {
    if (e && e.code === 'RATE_LIMITED') {
      return json({
        ok: false, code: 'rate_limit',
        msg: 'Bạn thao tác quá nhanh, thử lại sau ít phút',
      }, 429);
    }
    throw e;
  }

  const key = String(body.key || '').trim().toUpperCase();
  if (!/^TR-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(key)) {
    return json({
      ok: false, code: 'bad_request',
      msg: 'Mã dùng thử có dạng TR-XXXX-XXXX-XXXX',
    }, 400);
  }

  // Tính HWID từ raw parts (server tự băm)
  let ids;
  // Gửi parts nhưng tất cả RỖNG -> từ chối (tránh weak = sha256("w1|||") hằng số)
  const _p1 = [body.guid, body.bios, body.cpu, body.vol].map((x) =>
    String(x === undefined || x === null ? '' : x).trim());
  const _sent1 = [body.guid, body.bios, body.cpu, body.vol].some(
    (x) => x !== undefined && x !== null);
  const _ne1 = _p1.filter((x) => x.length > 0);
  if (_sent1 && _ne1.length === 0) {
    return json({
      ok: false, code: 'bad_request',
      msg: 'Thông tin máy rỗng — chạy tool trực tiếp',
    }, 400);
  }
  const hasParts = _ne1.length > 0;
  if (hasParts) {
    ids = await deriveIds(_p1);
  } else if (body.hwid) {
    const raw = String(body.hwid).trim().toLowerCase();
    if (!/^[0-9a-z]{16,128}$/.test(raw)) {
      return json({ ok: false, code: 'bad_request', msg: 'HWID không hợp lệ' }, 400);
    }
    ids = { hwid: raw, weak: raw, bios: '', cpu: '' };
  } else {
    return json({
      ok: false, code: 'bad_request',
      msg: 'Thiếu thông tin máy — chạy tool trực tiếp, đừng gọi API tay',
    }, 400);
  }

  // WHITELIST: máy dev được bỏ qua mọi chặn
  const wlClaim = await checkWhitelist(env, {
    hwid: ids.hwid, weak: ids.weak, ip,
  });

  // Máy ảo (bỏ qua nếu whitelist)
  if (!wlClaim.unlimited && (ids.bios || ids.cpu)) {
    if (looksVirtual(ids.bios, ids.cpu)) {
      return json({
        ok: false, code: 'trial_denied_device',
        msg: 'Không hỗ trợ dùng thử trên máy ảo',
      }, 403);
    }
  }

  /*
   * KIỂM TRA BAN (đã thêm). Trước đây nhánh claim bỏ qua hoàn toàn
   * trial_bans, nên máy đã bị admin đánh dấu vẫn claim được mã mới.
   */
  if (!wlClaim.unlimited) {
    try {
      for (const [scope, value] of [['hwid', ids.hwid], ['weak', ids.weak]]) {
        if (!value) continue;
        const ban = await env.DB.prepare(
          'SELECT reason FROM trial_bans WHERE scope = ? AND value = ? LIMIT 1'
        ).bind(scope, value).first();
        if (ban) {
          await logEvent(env, key, ids.hwid, 'trial_banned', `claim bi chan: ${ban.reason || ''}`, ip);
          return json({
            ok: false, code: 'trial_banned',
            msg: 'Thiết bị này không được dùng thử. Liên hệ hỗ trợ nếu cần.',
          }, 403);
        }
      }
    } catch { /* chưa migrate trial_bans -> bỏ qua, không chặn oan */ }
  }

  const cfg = await trialCfg(env);
  if (!cfg.enabled) {
    return json({ ok: false, code: 'trial_disabled', msg: 'Dùng thử đang tạm đóng' }, 403);
  }

  const lic = await env.DB.prepare('SELECT * FROM licenses WHERE key = ?').bind(key).first();
  if (!lic) {
    return json({ ok: false, code: 'not_found', msg: 'Mã dùng thử không tồn tại' }, 404);
  }
  if (lic.plan !== 'trial') {
    return json({
      ok: false, code: 'not_trial',
      msg: 'Đây là mã bản quyền trả phí. Kích hoạt bằng: xa_nofog_pro.exe --key ' + key,
    }, 400);
  }
  if (lic.revoked) {
    return json({ ok: false, code: 'revoked', msg: 'Mã dùng thử đã bị thu hồi' }, 403);
  }

  const now = nowSec();

  // Tìm grant tương ứng
  const use = await env.DB.prepare(
    'SELECT * FROM trial_uses WHERE lic_key = ? LIMIT 1'
  ).bind(key).first();

  if (!use) {
    // license trial không có grant -> dữ liệu cũ, cho bind trực tiếp
    if (lic.hwid && lic.hwid !== ids.hwid) {
      return json({
        ok: false, code: 'hwid_mismatch',
        msg: 'Mã này đã gắn với máy khác',
      }, 403);
    }
    await env.DB.prepare(
      'UPDATE licenses SET hwid = ?, activated_at = COALESCE(activated_at, ?) WHERE key = ?'
    ).bind(ids.hwid, now, key).run();
    // Phải trả trial_kind + label, nếu không client mặc định '3d'
    // -> mã 1 GIỜ hiện thành "DÙNG THỬ 3 NGÀY -- còn 7.0 ngày".
    const cfgL = await trialCfg(env);
    const kcL = kindCfg(cfgL, KIND_3D);
    return json({
      ok: true, key, plan: 'trial', legacy: true,
      trial: true,
      trial_kind: KIND_3D,
      trial_kind_state: 'claimed',
      activated: true,
      time_left_sec: lic.expires_at ? Math.max(0, lic.expires_at - now) : 0,
      recheck_sec: cfgL.recheck3d,
      quota_total: kcL ? kcL.quota : null,
      expires_at: lic.expires_at, now,
    });
  }

  if (use.ended_at) {
    return json({
      ok: false, code: 'trial_expired',
      msg: use.end_reason === 'reset'
        ? 'Lượt dùng thử đã được reset — lấy mã mới trên web'
        : 'Lượt dùng thử đã kết thúc',
    }, 403);
  }

  // Đã gắn máy khác (cùng grant) -> chặn
  if (use.hwid && use.hwid !== ids.hwid) {
    return json({
      ok: false, code: 'hwid_mismatch',
      msg: 'Mã dùng thử đã gắn với máy khác. Mỗi mã chỉ dùng cho 1 máy.',
    }, 403);
  }

  // Chưa kích hoạt -> bắt đầu đồng hồ NGAY (khách vừa nhập mã vào tool)
  const kind = normKind(use.kind) || KIND_3D;
  const kc = kindCfg(cfg, kind);
  const secs = kc ? kc.sec : cfg.t3d.sec;

  if (!use.started_at) {
    const expiresAt = now + secs;
    await env.DB.prepare(
      `UPDATE trial_uses SET hwid = COALESCE(hwid, ?), started_at = ?, expires_at = ?
       WHERE id = ? AND ended_at IS NULL`
    ).bind(ids.hwid, now, expiresAt, use.id).run();
    await env.DB.prepare(
      'UPDATE licenses SET hwid = ?, activated_at = ?, expires_at = ? WHERE key = ?'
    ).bind(ids.hwid, now, expiresAt, key).run();

    const fresh = await env.DB.prepare('SELECT * FROM trial_uses WHERE id = ?')
      .bind(use.id).first();
    await logEvent(env, key, ids.hwid, 'trial_claim', `${kind} activated`, ip);

    return json({
      ...publicUse(fresh, cfg, kind),
      trial_kind_state: 'claimed',
      now,
    });
  }

  // Đã kích hoạt, còn hạn -> trả trạng thái
  if (use.expires_at && use.expires_at <= now) {
    await env.DB.prepare(
      "UPDATE trial_uses SET ended_at = ?, end_reason = 'expired' WHERE id = ? AND ended_at IS NULL"
    ).bind(now, use.id).run();
    return json({
      ok: false, code: 'trial_expired',
      msg: 'Lượt dùng thử đã hết hạn',
      now, expires_at: use.expires_at,
    }, 403);
  }

  // Gắn hwid nếu chưa có
  if (!use.hwid) {
    await env.DB.prepare('UPDATE trial_uses SET hwid = ? WHERE id = ?')
      .bind(ids.hwid, use.id).run();
    await env.DB.prepare('UPDATE licenses SET hwid = ? WHERE key = ?')
      .bind(ids.hwid, key).run();
  }

  return json({
    ...publicUse(use, cfg, kind),
    trial_kind_state: 'active',
    now,
  });
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
    await rateLimit(env, `trial:${ip}`, 200, 3600);
    await rateLimit(env, `trial:u:${user.id}`, 200, 3600);
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
  const _p2 = [body.guid, body.bios, body.cpu, body.vol].map((x) =>
    String(x === undefined || x === null ? '' : x).trim());
  const _sent2 = [body.guid, body.bios, body.cpu, body.vol].some(
    (x) => x !== undefined && x !== null);
  const _ne2 = _p2.filter((x) => x.length > 0);
  if (_sent2 && _ne2.length === 0) {
    return json({
      ok: false, code: 'bad_request',
      msg: 'Thông tin máy rỗng — chạy tool trực tiếp',
    }, 400);
  }
  const hasParts = _ne2.length > 0;
  const hasHwid = !!body.hwid;

  if (hasParts) {
    ids = await deriveIds(_p2);
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
