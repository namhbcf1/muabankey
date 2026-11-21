/**
 * ADMIN — QUẢN LÝ QUYỀN THEO TÀI KHOẢN.
 *
 * ============================================================================
 * VÌ SAO CÓ FILE NÀY
 *
 * Chủ shop: "bỏ toàn bộ key trên hệ thống app và web đi. Mua thì add luôn
 * vào tài khoản."
 *
 * Tab "License" cũ của trang quản trị vẫn thao tác trên bảng `licenses`
 * (mô hình key). Admin tạo license ở đó thì khách KHÔNG nhận được gì, vì
 * app đọc quyền từ `account_entitlements`.
 *
 * File này cung cấp API đúng cho mô hình mới:
 *   GET  /api/admin/accounts            -> danh sách tài khoản + quyền + hạn
 *   GET  /api/admin/accounts/:id        -> chi tiết một tài khoản
 *   POST /api/admin/accounts/:id/grant  -> cấp/gia hạn (tính năng + số ngày)
 *   POST /api/admin/accounts/:id/revoke -> thu hồi một tính năng
 * ============================================================================
 */
import { json, ApiError } from '../lib/http.js';
import { nowSec } from '../lib/trial-quota.js';

async function readBody(request) {
  const text = await request.text();
  if (!text) return {};
  try {
    const v = JSON.parse(text);
    return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
  } catch {
    return {};
  }
}

/**
 * GET /api/admin/accounts?q=&filter=
 *
 * Trả danh sách tài khoản kèm quyền đang có.
 *
 * `filter`:
 *   all      (mặc định) — mọi tài khoản có quyền hoặc có lượt dùng thử
 *   active   — chỉ tài khoản còn quyền
 *   trial    — chỉ tài khoản đang trong 1 ngày dùng thử
 *   expired  — chỉ tài khoản đã hết hạn
 */
export async function listAccounts(env, request) {
  const { requireAdmin } = await import('../lib/auth.js');
  await requireAdmin(env, request);

  const url = new URL(request.url);
  const q = (url.searchParams.get('q') || '').trim();
  const filter = (url.searchParams.get('filter') || 'all').trim();
  const now = nowSec();

  const binds = [];
  let where = '1=1';
  if (q) {
    where += ' AND (lower(u.username) LIKE ? OR u.id = ?)';
    binds.push(`%${q.toLowerCase()}%`, q);
  }

  /*
   * Lấy tài khoản CÓ quyền hoặc CÓ lượt dùng thử.
   * LEFT JOIN để tài khoản chưa có gì vẫn hiện khi tìm theo tên (admin cấp
   * tay cho khách mới).
   */
  const { results } = await env.DB.prepare(
    `SELECT u.id, u.username, u.status, u.created_at,
            e_n.expires_at AS nofog_exp, e_n.source AS nofog_src,
            e_g.expires_at AS grant_exp, e_g.source AS grant_src,
            t.started_at  AS trial_start, t.expires_at AS trial_exp,
            t.ended_at    AS trial_end, t.end_reason AS trial_reason
       FROM users u
       LEFT JOIN account_entitlements e_n
              ON e_n.user_id = u.id AND e_n.feature = 'nofog'
       LEFT JOIN account_entitlements e_g
              ON e_g.user_id = u.id AND e_g.feature = 'grant'
       LEFT JOIN trial_accounts t ON t.user_id = u.id
      WHERE ${where}
      ORDER BY u.created_at DESC
      LIMIT 300`
  ).bind(...binds).all();

  const shape = (exp, src) => {
    if (exp === null || exp === undefined) {
      return { active: false, expires_at: 0, forever: false, source: null, daysLeft: 0 };
    }
    const e = Number(exp);
    const forever = e === 0;
    const active = forever || e > now;
    return {
      active,
      expires_at: e,
      forever,
      source: src || null,
      daysLeft: forever ? 0 : (active ? Math.ceil((e - now) / 86400) : 0),
    };
  };

  let rows = (results || []).map((r) => {
    const nofog = shape(r.nofog_exp, r.nofog_src);
    const grant = shape(r.grant_exp, r.grant_src);

    let trial = null;
    if (r.trial_start) {
      const tExp = Number(r.trial_exp || 0);
      const ended = !!r.trial_end || tExp <= now;
      trial = {
        state: ended ? 'ended' : 'active',
        startedAt: Number(r.trial_start || 0),
        expiresAt: tExp,
        leftSec: ended ? 0 : Math.max(0, tExp - now),
        endReason: r.trial_reason || null,
      };
    }

    const hasAny = nofog.active || grant.active || !!trial;
    return {
      id: r.id,
      username: r.username || '',
      status: r.status,
      createdAt: r.created_at,
      nofog, grant, trial,
      hasAny,
      isTrial: !!trial && trial.state === 'active',
    };
  });

  // Lọc phía server (dữ liệu đã nằm trong 300 dòng)
  if (filter === 'active') rows = rows.filter((r) => r.nofog.active || r.grant.active);
  else if (filter === 'trial') rows = rows.filter((r) => r.isTrial);
  else if (filter === 'expired') {
    rows = rows.filter((r) => !r.nofog.active && !r.grant.active);
  } else {
    // 'all' — bỏ tài khoản không có gì, trừ khi đang tìm theo tên
    if (!q) rows = rows.filter((r) => r.hasAny);
  }

  return json({
    ok: true,
    now,
    filter,
    accounts: rows,
    stats: {
      total: rows.length,
      active: rows.filter((r) => r.nofog.active || r.grant.active).length,
      trial: rows.filter((r) => r.isTrial).length,
      nofog: rows.filter((r) => r.nofog.active).length,
      grant: rows.filter((r) => r.grant.active).length,
    },
  });
}

/**
 * POST /api/admin/accounts/:id/grant
 *
 * Body: { feature: 'nofog'|'grant'|'both', days: number, note?: string }
 *
 * `days = 0` -> vĩnh viễn.
 * Gia hạn CỘNG DỒN nếu tài khoản còn hạn (xem grantFeature).
 */
export async function grantAccount(env, request, userId) {
  const { requireAdminStrict } = await import('../lib/auth.js');
  const admin = await requireAdminStrict(env, request);

  const body = await readBody(request);
  const feature = String(body.feature || '').trim();
  const days = Number(body.days);
  const note = String(body.note || '').slice(0, 200);

  if (!['nofog', 'grant', 'both'].includes(feature)) {
    throw new ApiError(400, 'feature phải là nofog | grant | both', 'VALIDATION');
  }
  if (!Number.isFinite(days) || days < 0 || days > 3650) {
    throw new ApiError(400, 'days phải từ 0 (vĩnh viễn) đến 3650', 'VALIDATION');
  }

  const user = await env.DB.prepare('SELECT id, username FROM users WHERE id = ?')
    .bind(userId).first();
  if (!user) throw new ApiError(404, 'Tài khoản không tồn tại', 'NOT_FOUND');

  const { grantFeature, FEATURE_NOFOG, FEATURE_GRANT } =
    await import('../lib/account-entitlement.js');

  const targets = feature === 'both' ? [FEATURE_NOFOG, FEATURE_GRANT] : [feature];
  const done = [];
  for (const f of targets) {
    const r = await grantFeature(env, {
      userId, feature: f, days,
      source: 'admin', note: note || `Admin ${admin.username || admin.id} cấp`,
    });
    done.push(r);
  }

  // Ghi nhật ký
  try {
    const { audit } = await import('./products.js');
    await audit(env, admin.id, 'account.grant', userId,
      { feature, days, targets });
  } catch { /* không chặn */ }

  return json({
    ok: true, userId, username: user.username,
    granted: done.map((d) => ({
      feature: d.feature,
      expires_at: d.expiresAt,
      forever: d.expiresAt === 0,
    })),
  });
}

/**
 * POST /api/admin/accounts/:id/revoke
 *
 * Body: { feature: 'nofog'|'grant'|'both' }
 */
export async function revokeAccount(env, request, userId) {
  const { requireAdminStrict } = await import('../lib/auth.js');
  const admin = await requireAdminStrict(env, request);

  const body = await readBody(request);
  const feature = String(body.feature || '').trim();
  if (!['nofog', 'grant', 'both'].includes(feature)) {
    throw new ApiError(400, 'feature phải là nofog | grant | both', 'VALIDATION');
  }

  const { revokeFeature, FEATURE_NOFOG, FEATURE_GRANT } =
    await import('../lib/account-entitlement.js');

  const targets = feature === 'both' ? [FEATURE_NOFOG, FEATURE_GRANT] : [feature];
  for (const f of targets) await revokeFeature(env, userId, f);

  try {
    const { audit } = await import('./products.js');
    await audit(env, admin.id, 'account.revoke', userId, { feature });
  } catch { /* không chặn */ }

  return json({ ok: true, userId, revoked: targets });
}
