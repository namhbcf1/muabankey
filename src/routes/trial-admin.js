/**
 * Admin quản lý trial: xem lượt, reset, ban, cấp thêm.
 *
 * BẢO MẬT:
 *   - requireAdminStrict (chỉ admin thật, staff không được)
 *   - Admin KHÔNG được tự reset chính mình (403) — tránh lạm dụng
 *   - Giới hạn 3 lần/30 ngày/tài khoản, 50 lần/24h toàn hệ thống
 *   - Mọi thao tác ghi trial_resets + audit_logs
 *
 * QUY TẮC RESET:
 *   - used = 0                    ✅
 *   - quota giữ nguyên            ✅
 *   - license trial đang chạy -> thu hồi ✅ (mặc định)
 *   - trial_uses KHÔNG xoá        ✅ (giữ lịch sử)
 *   - trial_bans KHÔNG xoá        ✅ (chặn vẫn còn)
 */
import { json } from '../lib/http.js';
import { nowSec, normKind, trialCfg, getQuota, KIND_1H, KIND_3D } from '../lib/trial-quota.js';

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

/** Tìm user theo id hoặc username/email. */
async function findUser(env, ref) {
  const s = String(ref || '').trim();
  if (!s) return null;
  return env.DB.prepare(
    'SELECT id, username, email, full_name, role, status FROM users WHERE id = ? OR lower(username) = lower(?) OR lower(email) = lower(?) LIMIT 1'
  ).bind(s, s, s).first();
}

/** GET /api/admin/trial/accounts?q=... — danh sách tài khoản có trial. */
export async function adminTrialAccounts(env, request) {
  const { ok } = await import('../lib/http.js');
  const { requireAdminStrict } = await import('../lib/auth.js');
  await requireAdminStrict(env, request);

  const url = new URL(request.url);
  const q = (url.searchParams.get('q') || '').trim();
  const cfg = await trialCfg(env);

  // Lấy user có dùng trial, kèm lượt từng loại
  const { results } = await env.DB.prepare(
    `SELECT u.id, u.username, u.email, u.full_name, u.status, u.created_at,
            COALESCE(q1.used,0) AS used_1h, COALESCE(q1.quota,?) AS quota_1h,
            COALESCE(q1.reset_count,0) AS reset_1h,
            COALESCE(q3.used,0) AS used_3d, COALESCE(q3.quota,?) AS quota_3d,
            COALESCE(q3.reset_count,0) AS reset_3d,
            q1.banned_at AS banned_1h, q3.banned_at AS banned_3d,
            (SELECT COUNT(*) FROM trial_uses tu WHERE tu.user_id = u.id) AS total_uses
     FROM users u
     LEFT JOIN trial_quota q1 ON q1.user_id = u.id AND q1.kind = '1h'
     LEFT JOIN trial_quota q3 ON q3.user_id = u.id AND q3.kind = '3d'
     WHERE EXISTS (SELECT 1 FROM trial_uses t WHERE t.user_id = u.id)
        OR EXISTS (SELECT 1 FROM trial_quota q WHERE q.user_id = u.id)
        ${q ? "AND (lower(u.username) LIKE ? OR lower(u.email) LIKE ? OR u.id = ?)" : ''}
     ORDER BY u.created_at DESC LIMIT 200`
  ).bind(
    cfg.t1h.quota, cfg.t3d.quota,
    ...(q ? [`%${q.toLowerCase()}%`, `%${q.toLowerCase()}%`, q] : [])
  ).all();

  return ok({
    accounts: (results || []).map((r) => ({
      userId: r.id,
      username: r.username,
      email: r.email && r.email.endsWith('@local') ? null : r.email,
      fullName: r.full_name,
      status: r.status,
      createdAt: r.created_at,
      totalUses: r.total_uses,
      t1h: {
        used: r.used_1h, quota: r.quota_1h, left: Math.max(0, r.quota_1h - r.used_1h),
        resets: r.reset_1h, banned: !!r.banned_1h,
      },
      t3d: {
        used: r.used_3d, quota: r.quota_3d, left: Math.max(0, r.quota_3d - r.used_3d),
        resets: r.reset_3d, banned: !!r.banned_3d,
      },
    })),
    cfg: {
      t1h: { quota: cfg.t1h.quota, minutes: cfg.t1h.sec / 60 },
      t3d: { quota: cfg.t3d.quota, days: cfg.t3d.sec / 86400 },
    },
  });
}

/** GET /api/admin/trial/uses?userId=... — lịch sử dùng thử. */
export async function adminTrialUses(env, request) {
  const { ok } = await import('../lib/http.js');
  const { requireAdminStrict } = await import('../lib/auth.js');
  await requireAdminStrict(env, request);

  const url = new URL(request.url);
  const userId = (url.searchParams.get('userId') || '').trim();
  const kind = normKind(url.searchParams.get('kind'));

  const where = [];
  const binds = [];
  if (userId) { where.push('user_id = ?'); binds.push(userId); }
  if (kind) { where.push('kind = ?'); binds.push(kind); }

  const { results } = await env.DB.prepare(
    `SELECT * FROM trial_uses
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY created_at DESC LIMIT 200`
  ).bind(...binds).all();

  const now = nowSec();
  return ok({
    uses: (results || []).map((r) => ({
      id: r.id,
      userId: r.user_id,
      kind: r.kind,
      key: r.lic_key,
      hwid: r.hwid ? r.hwid.slice(0, 8) + '…' : null,
      ip: r.ip,
      startedAt: r.started_at,
      expiresAt: r.expires_at,
      createdAt: r.created_at,
      // 'hold' = cấp rồi chưa kích hoạt
      state: r.ended_at ? 'ended'
        : !r.started_at ? 'hold'
        : r.expires_at > now ? 'active' : 'expired',
      isActive: !r.ended_at && r.expires_at > now,
      endReason: r.end_reason,
    })),
  });
}

/**
 * POST /api/admin/trial/reset
 * { user: "username|id", kinds: ["1h","3d"] | "all", reason: "...", revokeActive: true }
 */
export async function adminTrialReset(env, request) {
  const { ok, ApiError: AE } = await import('../lib/http.js');
  const { requireAdminStrict } = await import('../lib/auth.js');
  const { audit } = await import('./products.js');
  const admin = await requireAdminStrict(env, request);

  const body = await readBody(request);
  if (!body) throw new AE(400, 'JSON không hợp lệ', 'VALIDATION');

  const reason = String(body.reason || '').trim();
  if (reason.length < 10) {
    throw new AE(400, 'Nhập lý do reset (ít nhất 10 ký tự) để lưu nhật ký', 'VALIDATION');
  }

  const u = await findUser(env, body.user || body.userId);
  if (!u) throw new AE(404, 'Không tìm thấy tài khoản', 'NOT_FOUND');

  // Admin KHÔNG được tự reset mình
  if (u.id === admin.id) {
    throw new AE(403, 'Không thể tự reset dùng thử của chính mình', 'FORBIDDEN');
  }

  // Xác định loại cần reset
  let kinds;
  if (body.kinds === 'all' || body.kinds === undefined) {
    kinds = [KIND_1H, KIND_3D];
  } else if (Array.isArray(body.kinds)) {
    kinds = body.kinds.map(normKind).filter(Boolean);
  } else {
    kinds = [normKind(body.kinds)].filter(Boolean);
  }
  if (!kinds.length) throw new AE(400, 'Loại dùng thử không hợp lệ', 'VALIDATION');

  const revokeActive = body.revokeActive !== false; // mặc định true
  const cfg = await trialCfg(env);
  const now = nowSec();

  // Giới hạn: 3 lần / 30 ngày / tài khoản
  const recent = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM trial_resets WHERE user_id = ? AND at > ?'
  ).bind(u.id, now - 30 * 86400).first();
  if ((recent?.n || 0) >= 3 && !body.force) {
    throw new AE(429,
      `Đã reset ${recent.n} lần trong 30 ngày cho tài khoản này. `
      + 'Dùng "force" nếu thực sự cần.',
      'RESET_LIMIT');
  }

  // Giới hạn toàn hệ thống: 50 lần / 24h
  const globalRecent = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM trial_resets WHERE at > ?'
  ).bind(now - 86400).first();
  if ((globalRecent?.n || 0) >= 50) {
    throw new AE(429, 'Đã đạt giới hạn 50 lần reset/ngày toàn hệ thống', 'RESET_GLOBAL_LIMIT');
  }

  // Chụp trạng thái trước
  const before = {};
  for (const k of kinds) {
    const q = await getQuota(env, u.id, k, k === KIND_1H ? cfg.t1h.quota : cfg.t3d.quota);
    before[k] = q;
  }

  // Thu hồi license trial đang chạy
  const revoked = [];
  if (revokeActive) {
    for (const k of kinds) {
      const act = await env.DB.prepare(
        `SELECT * FROM trial_uses
         WHERE user_id = ? AND kind = ? AND ended_at IS NULL AND expires_at > ?`
      ).bind(u.id, k, now).all();
      for (const r of act.results || []) {
        await env.DB.prepare('UPDATE licenses SET revoked = 1 WHERE key = ?')
          .bind(r.lic_key).run();
        await env.DB.prepare(
          "UPDATE trial_uses SET ended_at = ?, end_reason = 'reset' WHERE id = ?"
        ).bind(now, r.id).run();
        revoked.push(r.lic_key);
      }
    }
  }

  // Reset bộ đếm: used = 0, reset_count + 1
  for (const k of kinds) {
    const quota = k === KIND_1H ? cfg.t1h.quota : cfg.t3d.quota;
    await env.DB.prepare(
      `INSERT INTO trial_quota
         (user_id, kind, used, quota, reset_count, last_reset_at, reset_by, created_at, updated_at)
       VALUES (?,?,0,?,1,?,?,?,?)
       ON CONFLICT(user_id, kind) DO UPDATE SET
         used = 0,
         reset_count = reset_count + 1,
         last_reset_at = ?,
         reset_by = ?,
         updated_at = ?`
    ).bind(u.id, k, quota, now, admin.id, now, now, now, admin.id, now).run();
  }

  // Chụp sau
  const after = {};
  for (const k of kinds) {
    after[k] = await getQuota(env, u.id, k, k === KIND_1H ? cfg.t1h.quota : cfg.t3d.quota);
  }

  // Ghi lịch sử
  const resetId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO trial_resets
       (id, user_id, kinds, reason, before_json, after_json, revoked_keys, admin_id, admin_name, at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).bind(resetId, u.id, kinds.join(','), reason,
    JSON.stringify(before), JSON.stringify(after),
    revoked.join(',') || null, admin.id,
    admin.username || admin.email || admin.id, now).run();

  await audit(env, admin.id, 'trial.reset', u.id, {
    kinds, reason, revoked, force: !!body.force,
  });

  return ok({
    reset: true,
    userId: u.id,
    username: u.username,
    kinds,
    before,
    after,
    revokedKeys: revoked,
    resetId,
  });
}

/** POST /api/admin/trial/grant — cấp thêm lượt (không cần reset). */
export async function adminTrialGrant(env, request) {
  const { ok, ApiError: AE } = await import('../lib/http.js');
  const { requireAdminStrict } = await import('../lib/auth.js');
  const { audit } = await import('./products.js');
  const admin = await requireAdminStrict(env, request);

  const body = await readBody(request);
  if (!body) throw new AE(400, 'JSON không hợp lệ', 'VALIDATION');

  const u = await findUser(env, body.user || body.userId);
  if (!u) throw new AE(404, 'Không tìm thấy tài khoản', 'NOT_FOUND');

  const kind = normKind(body.kind) || KIND_3D;
  const delta = Math.max(-100, Math.min(100, Number(body.delta) || 1));
  const cfg = await trialCfg(env);
  const now = nowSec();
  const baseQuota = kind === KIND_1H ? cfg.t1h.quota : cfg.t3d.quota;

  await env.DB.prepare(
    `INSERT INTO trial_quota (user_id, kind, used, quota, created_at, updated_at)
     VALUES (?,?,0,?,?,?)
     ON CONFLICT(user_id, kind) DO UPDATE SET
       quota = MAX(0, quota + ?), updated_at = ?`
  ).bind(u.id, kind, Math.max(0, baseQuota + delta), now, now, delta, now).run();

  const q = await getQuota(env, u.id, kind, baseQuota);
  await audit(env, admin.id, 'trial.grant', u.id, { kind, delta, quota: q.quota });

  return ok({ userId: u.id, kind, delta, ...q });
}

/** POST /api/admin/trial/ban — chặn thiết bị hoặc tài khoản. */
export async function adminTrialBan(env, request) {
  const { ok, ApiError: AE } = await import('../lib/http.js');
  const { requireAdminStrict } = await import('../lib/auth.js');
  const { audit } = await import('./products.js');
  const admin = await requireAdminStrict(env, request);

  const body = await readBody(request);
  if (!body) throw new AE(400, 'JSON không hợp lệ', 'VALIDATION');

  const scope = String(body.scope || '').trim();
  const value = String(body.value || '').trim();
  const reason = String(body.reason || '').trim() || 'Vi phạm điều khoản';
  const unban = body.unban === true;

  if (!['weak', 'ip', 'user'].includes(scope)) {
    throw new AE(400, 'scope phải là weak | ip | user', 'VALIDATION');
  }
  if (!value) throw new AE(400, 'Thiếu giá trị cần chặn', 'VALIDATION');

  const now = nowSec();

  if (unban) {
    await env.DB.prepare('DELETE FROM trial_bans WHERE scope = ? AND value = ?')
      .bind(scope, value).run();
    await audit(env, admin.id, 'trial.unban', value, { scope });
    return ok({ unbanned: true, scope, value });
  }

  await env.DB.prepare(
    `INSERT INTO trial_bans (scope, value, reason, at, by)
     VALUES (?,?,?,?,?)
     ON CONFLICT(scope, value) DO UPDATE SET reason = excluded.reason, at = excluded.at`
  ).bind(scope, value, reason, now, admin.id).run();

  // Nếu ban user -> chặn cả 2 loại trial
  if (scope === 'user') {
    for (const k of [KIND_1H, KIND_3D]) {
      await env.DB.prepare(
        `INSERT INTO trial_quota (user_id, kind, used, quota, banned_at, banned_reason, created_at, updated_at)
         VALUES (?,?,0,10,?,?,?,?)
         ON CONFLICT(user_id, kind) DO UPDATE SET banned_at = excluded.banned_at, banned_reason = excluded.banned_reason`
      ).bind(value, k, now, reason, now, now).run();
    }
  }

  await audit(env, admin.id, 'trial.ban', value, { scope, reason });
  return ok({ banned: true, scope, value, reason });
}

/** GET /api/admin/trial/resets — lịch sử reset. */
export async function adminTrialResets(env, request) {
  const { ok } = await import('../lib/http.js');
  const { requireAdminStrict } = await import('../lib/auth.js');
  await requireAdminStrict(env, request);

  const url = new URL(request.url);
  const userId = (url.searchParams.get('userId') || '').trim();

  const { results } = await env.DB.prepare(
    `SELECT r.*, u.username
     FROM trial_resets r LEFT JOIN users u ON u.id = r.user_id
     ${userId ? 'WHERE r.user_id = ?' : ''}
     ORDER BY r.at DESC LIMIT 100`
  ).bind(...(userId ? [userId] : [])).all();

  return ok({
    resets: (results || []).map((r) => ({
      id: r.id,
      userId: r.user_id,
      username: r.username,
      kinds: r.kinds,
      reason: r.reason,
      revokedKeys: r.revoked_keys ? r.revoked_keys.split(',') : [],
      adminName: r.admin_name,
      at: r.at,
    })),
  });
}
