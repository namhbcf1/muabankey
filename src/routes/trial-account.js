/**
 * DÙNG THỬ THEO TÀI KHOẢN — 1 NGÀY, CẢ MAP SÁNG + TÀI NGUYÊN.
 *
 * ============================================================================
 * VÌ SAO CÓ FILE NÀY
 *
 * Mô hình CŨ (đã bỏ): khách bấm "Dùng thử" trên web -> server cấp mã
 * TR-XXXX-XXXX-XXXX -> khách phải CHÉP MÃ rồi dán vào tool. Mỗi tài khoản
 * được 10 lượt 1 giờ + 10 lượt 3 ngày, mỗi sản phẩm một mã riêng.
 *
 * Vấn đề thực tế: mã TR- dài 12 ký tự dễ gõ sai, khách dán nhầm mã của sản
 * phẩm này vào sản phẩm kia, và phải làm 2 lần nếu muốn thử cả 2 tính năng.
 *
 * Mô hình MỚI (chủ shop chốt):
 *   * Mỗi TÀI KHOẢN mới được dùng thử ĐÚNG 1 NGÀY
 *   * Trong 1 ngày đó bật CẢ map sáng VÀ tài nguyên
 *   * KHÔNG cấp mã, KHÔNG bắt khách nhập key
 *   * Đồng hồ bắt đầu từ lần ĐẦU MỞ APP
 *
 * ============================================================================
 * CÁCH HOẠT ĐỘNG
 *
 *   1. App gọi POST /api/trial/session (kèm cookie phiên + mảng phần cứng)
 *   2. Server tạo dòng `trial_accounts` cho tài khoản (nếu chưa có)
 *   3. Server tạo 2 license NỘI BỘ (map sáng + tài nguyên), ký 2 token
 *   4. App lưu 2 token; khách không bao giờ thấy key
 *
 * Key của 2 license nội bộ KHÔNG trả về dạng "đây là key của bạn" — nó chỉ
 * nằm trong payload để app gọi /api/check và /api/xg/check khi cần làm mới
 * token. Đây là chi tiết kỹ thuật, không phải thứ khách phải quản lý.
 * ============================================================================
 */
import { json, ApiError } from '../lib/http.js';
import { rateLimit, clientIp } from '../lib/ratelimit.js';
import {
  trialCfg, nowSec, deriveIds, looksVirtual, checkWhitelist,
} from '../lib/trial-quota.js';

/** Số giây của một ngày. */
const DAY_SEC = 86400;

/** Trần số tài khoản được dùng thử trên CÙNG MỘT MÁY (chống farm). */
const MAX_ACCOUNTS_PER_DEVICE = 3;

/** Số lần đổi máy cho phép trong thời gian dùng thử. */
const MAX_TRIAL_REBINDS = 1;

/* ------------------------------------------------------------------ */
/* Sinh key nội bộ                                                     */
/* ------------------------------------------------------------------ */

/**
 * Bảng chữ cái không có cặp ký tự đọc nhầm (0/O, 1/I/L, 6/G, 8/B, 5/S, 2/Z).
 * Dùng chung tinh thần với trialKey() trong lib/trial-quota.js.
 */
const KEY_AB = '349BCDEFHJKLMNPQRTUWXY';

function pickChars(n) {
  const LIM = 256 - (256 % KEY_AB.length);
  const b = new Uint8Array(1);
  let s = '';
  while (s.length < n) {
    crypto.getRandomValues(b);
    if (b[0] < LIM) s += KEY_AB[b[0] % KEY_AB.length];
  }
  return s;
}

/**
 * Sinh key nội bộ theo tiền tố.
 *
 *   TR-...   -> license map sáng  (giữ đúng định dạng cũ để mọi đoạn mã
 *                                  nhận diện 'TR-' sẵn có vẫn hiểu)
 *   XAGR-... -> license tài nguyên
 */
function genKey(prefix) {
  return `${prefix}-${pickChars(4)}-${pickChars(4)}-${pickChars(4)}`;
}

/* ------------------------------------------------------------------ */
/* Helper                                                              */
/* ------------------------------------------------------------------ */

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

/**
 * Đọc thông tin phần cứng client gửi lên và băm thành HWID.
 *
 * Nhận HAI kiểu để không phá client cũ:
 *   - raw parts (guid/bios/cpu/vol) -> server tự băm (ưu tiên)
 *   - hwid đã băm sẵn               -> chỉ kiểm định dạng
 */
async function idsFromBody(body) {
  const raw = [body.guid, body.bios, body.cpu, body.vol]
    .map((x) => String(x === undefined || x === null ? '' : x).trim());
  const filled = raw.filter((x) => x.length > 0);

  if (filled.length > 0) return await deriveIds(raw);

  const h = String(body.hwid || '').trim().toLowerCase();
  if (/^[0-9a-z]{16,128}$/.test(h)) {
    return { hwid: h, weak: h, bios: '', cpu: '' };
  }
  return null;
}

/** Ghi lịch sử để vận hành đối soát được (không chặn luồng chính). */
async function logEvent(env, key, hwid, kind, detail, ip) {
  try {
    await env.DB.prepare(
      'INSERT INTO lic_events (key, hwid, kind, detail, ip, at) VALUES (?,?,?,?,?,?)'
    ).bind(key || null, hwid || null, kind, detail || null, ip || null, nowSec()).run();
  } catch { /* bảng có thể chưa có */ }
}

/* ------------------------------------------------------------------ */
/* Tạo / lấy license nội bộ                                            */
/* ------------------------------------------------------------------ */

/**
 * Bảo đảm có license nội bộ cho một sản phẩm của lượt dùng thử.
 *
 * Trả về license row (đã đọc lại từ DB để có đủ trường `gate`, `app`...).
 *
 * `pid` = NULL cho map sáng, 'xagrant' cho tài nguyên — đây là thứ
 * entitlement.js dùng để quyết định bật chức năng nào.
 */
async function ensureLicense(env, { key, hwid, expiresAt, now, ip, userId, product }) {
  const pid = product === 'grant' ? 'xagrant' : null;
  const existing = await env.DB.prepare('SELECT * FROM licenses WHERE key = ?')
    .bind(key).first();

  if (existing) {
    /*
     * License đã có -> cập nhật hạn cho khớp trial_accounts.
     *
     * Vì sao phải cập nhật: nếu admin gia hạn lượt dùng thử (hoặc trial bị
     * reset rồi cấp lại), hạn trong licenses phải theo, nếu không token ký
     * ra sẽ mang hạn cũ và app tự khoá sớm.
     */
    if (Number(existing.expires_at || 0) !== Number(expiresAt)) {
      await env.DB.prepare(
        'UPDATE licenses SET expires_at = ?, revoked = 0 WHERE key = ?'
      ).bind(expiresAt, key).run();
      existing.expires_at = expiresAt;
      existing.revoked = 0;
    }
    return existing;
  }

  await env.DB.prepare(
    `INSERT INTO licenses
       (key, hwid, plan, pid, note, created_at, activated_at, expires_at,
        last_seen, last_ip, revoked, max_rebind, rebinds, source, app)
     VALUES (?,?, 'trial', ?, ?, ?, ?, ?, NULL, ?, 0, ?, 0, 'account-trial', ?)`
  ).bind(
    key, hwid, pid,
    `Dùng thử 1 ngày theo tài khoản ${userId}`,
    now, now, expiresAt, ip,
    MAX_TRIAL_REBINDS,
    product === 'grant' ? 'xagrant' : 'nofog',
  ).run();

  return await env.DB.prepare('SELECT * FROM licenses WHERE key = ?')
    .bind(key).first();
}

/* ------------------------------------------------------------------ */
/* POST /api/trial/session — bắt đầu hoặc tiếp tục lượt dùng thử       */
/* ------------------------------------------------------------------ */

/**
 * Body: { guid, bios, cpu, vol }  (hoặc { hwid } nếu client đã băm sẵn)
 *
 * Trả:
 * {
 *   ok: true,
 *   state: 'new' | 'resume',
 *   started_at, expires_at, left_sec,
 *   features: ['nofog', 'grant'],
 *   nofog: { key, token, expires_at, activated_at, grace_hours, plan, recheck_sec },
 *   grant: { key, token, expires_at, check_after, recheck_sec },
 *   now
 * }
 *
 * Mã lỗi:
 *   login_required        chưa đăng nhập
 *   trial_disabled        shop đang tắt dùng thử
 *   trial_used_before     tài khoản đã dùng thử (kể cả kiểu mã TR- cũ)
 *   trial_device_limit    máy này đã dùng thử cho quá nhiều tài khoản
 *   trial_denied_device   máy ảo
 *   trial_banned          thiết bị bị admin chặn
 *   trial_expired         lượt dùng thử đã hết
 *   hwid_unavailable      không đọc được phần cứng
 */
export async function startSession(env, request) {
  const ip = clientIp(request);
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
      msg: 'Đăng nhập để dùng thử miễn phí 1 ngày.',
    }, 401);
  }

  // ---- 2. Cấu hình ----
  const cfg = await trialCfg(env);
  if (!cfg.enabled) {
    return json({
      ok: false, code: 'trial_disabled',
      msg: 'Dùng thử đang tạm đóng. Vui lòng quay lại sau.',
    }, 403);
  }

  // ---- 3. Chống lạm dụng ----
  try {
    await rateLimit(env, `trialacc:${ip}`, 60, 3600, { failClosed: true });
    await rateLimit(env, `trialacc:u:${user.id}`, 30, 3600, { failClosed: true });
  } catch (e) {
    if (e && e.code === 'RATE_LIMITED') {
      return json({
        ok: false, code: 'rate_limit',
        msg: 'Bạn thao tác quá nhanh, thử lại sau ít phút.',
      }, 429);
    }
    throw e;
  }

  // ---- 4. Định danh máy ----
  const ids = await idsFromBody(body);
  if (!ids) {
    return json({
      ok: false, code: 'hwid_unavailable',
      msg: 'Không đọc được thông tin phần cứng. Chạy lại app.',
    }, 400);
  }

  // ---- 5. Whitelist (máy dev bỏ qua mọi chặn) ----
  const wl = await checkWhitelist(env, {
    userId: user.id, hwid: ids.hwid, weak: ids.weak, ip,
  });

  // ---- 6. Máy ảo ----
  if (!wl.unlimited && (ids.bios || ids.cpu) && looksVirtual(ids.bios, ids.cpu)) {
    await logEvent(env, '-', ids.hwid, 'trial_deny', 'virtual machine', ip);
    return json({
      ok: false, code: 'trial_denied_device',
      msg: 'Không hỗ trợ dùng thử trên máy ảo.',
    }, 403);
  }

  // ---- 7. Thiết bị bị admin chặn ----
  if (!wl.unlimited) {
    try {
      for (const [scope, value] of [['weak', ids.weak], ['hwid', ids.hwid]]) {
        if (!value) continue;
        const ban = await env.DB.prepare(
          'SELECT reason FROM trial_bans WHERE scope = ? AND value = ? LIMIT 1'
        ).bind(scope, value).first();
        if (ban) {
          await logEvent(env, '-', ids.hwid, 'trial_banned', ban.reason || '', ip);
          return json({
            ok: false, code: 'trial_banned',
            msg: 'Thiết bị này không được dùng thử. Liên hệ hỗ trợ nếu cần.',
          }, 403);
        }
      }
    } catch { /* chưa có bảng -> bỏ qua, không chặn oan */ }
  }

  const now = nowSec();
  const ua = (request.headers.get('user-agent') || '').slice(0, 200);

  // ---- 8. Tra lượt dùng thử của tài khoản ----
  let row = await env.DB.prepare(
    'SELECT * FROM trial_accounts WHERE user_id = ?'
  ).bind(user.id).first();

  let state = 'resume';

  if (!row) {
    // ===== TÀI KHOẢN CHƯA TỪNG DÙNG THỬ =====

    /*
     * Chặn tài khoản đã dùng thử KIỂU CŨ (mã TR-).
     *
     * Chủ shop chốt: "chỉ tài khoản CHƯA từng dùng thử". Người đã dùng mã
     * TR- trước đây không được nhận thêm 1 ngày, nếu không sẽ thành kẽ hở
     * để dùng thử 2 lần.
     */
    let usedBefore = false;
    try {
      const old = await env.DB.prepare(
        'SELECT 1 AS x FROM trial_uses WHERE user_id = ? LIMIT 1'
      ).bind(user.id).first();
      usedBefore = !!old;
    } catch { /* chưa có bảng -> coi như chưa dùng */ }

    if (usedBefore && !wl.unlimited) {
      return json({
        ok: false, code: 'trial_used_before',
        msg: 'Tài khoản này đã dùng thử rồi. Mua license để tiếp tục dùng.',
      }, 403);
    }

    // Chống farm: 1 máy chỉ được dùng thử cho N tài khoản
    if (!wl.unlimited && ids.weak) {
      const n = await env.DB.prepare(
        `SELECT COUNT(*) AS n FROM trial_accounts
          WHERE device_weak = ? AND user_id != ?`
      ).bind(ids.weak, user.id).first();
      if ((n?.n || 0) >= MAX_ACCOUNTS_PER_DEVICE) {
        await logEvent(env, '-', ids.hwid, 'trial_deny',
          `device has ${n.n} trial accounts`, ip);
        return json({
          ok: false, code: 'trial_device_limit',
          msg: `Máy này đã dùng thử cho ${MAX_ACCOUNTS_PER_DEVICE} tài khoản khác. `
            + 'Mỗi máy chỉ được dùng thử cho một số tài khoản nhất định.',
        }, 403);
      }
    }

    /*
     * ĐỒNG HỒ BẮT ĐẦU TỪ LẦN ĐẦU MỞ APP — chính là lần gọi endpoint này.
     *
     * Chủ shop chốt: "tính từ lần đầu mở app", không phải lúc đăng ký, để
     * khách đăng ký hôm nay rồi mai mới cài vẫn còn đủ 1 ngày.
     */
    const days = Number(cfg.accountDays) || 1;
    const expiresAt = now + days * DAY_SEC;

    await env.DB.prepare(
      `INSERT INTO trial_accounts
         (user_id, state, created_at, started_at, expires_at,
          hwid, device_weak, ip, ua, rebinds, updated_at)
       VALUES (?, 'active', ?, ?, ?, ?, ?, ?, ?, 0, ?)`
    ).bind(user.id, now, now, expiresAt, ids.hwid, ids.weak, ip, ua, now).run();

    row = await env.DB.prepare(
      'SELECT * FROM trial_accounts WHERE user_id = ?'
    ).bind(user.id).first();

    state = 'new';
    await logEvent(env, '-', ids.hwid, 'trial_account_start',
      `${days} ngày, cả 2 tính năng`, ip);
  } else {
    // ===== TÀI KHOẢN ĐÃ CÓ LƯỢT DÙNG THỬ =====

    if (row.ended_at) {
      return json({
        ok: false, code: 'trial_expired',
        msg: row.end_reason === 'reset'
          ? 'Lượt dùng thử đã được đặt lại. Liên hệ hỗ trợ nếu cần.'
          : 'Lượt dùng thử 1 ngày đã kết thúc. Mua license để tiếp tục.',
        now, expires_at: row.expires_at || 0,
      }, 403);
    }

    if (Number(row.expires_at || 0) <= now) {
      await env.DB.prepare(
        "UPDATE trial_accounts SET state = 'ended', ended_at = ?, end_reason = 'expired', updated_at = ? WHERE user_id = ?"
      ).bind(now, now, user.id).run();
      await env.DB.prepare(
        'UPDATE licenses SET revoked = 1 WHERE key IN (?, ?)'
      ).bind(row.nofog_key || '', row.grant_key || '').run().catch(() => {});
      await logEvent(env, row.nofog_key, ids.hwid, 'trial_account_expired', '', ip);
      return json({
        ok: false, code: 'trial_expired',
        msg: 'Lượt dùng thử 1 ngày đã kết thúc. Mua license để tiếp tục.',
        now, expires_at: row.expires_at,
      }, 403);
    }

    /*
     * ĐỔI MÁY TRONG LÚC DÙNG THỬ.
     *
     * Chỉ cho 1 lần (MAX_TRIAL_REBINDS) — đủ để khách cài lại Windows
     * (MachineGuid đổi) nhưng không đủ để chia sẻ cho cả lớp.
     */
    if (row.hwid && ids.hwid && String(row.hwid) !== String(ids.hwid)) {
      const used = Number(row.rebinds || 0);
      if (used >= MAX_TRIAL_REBINDS) {
        return json({
          ok: false, code: 'hwid_mismatch',
          msg: 'Lượt dùng thử này đã gắn với máy khác. '
            + 'Mua license để dùng trên máy này.',
          now,
        }, 403);
      }
      await env.DB.prepare(
        `UPDATE trial_accounts
            SET hwid = ?, rebinds = rebinds + 1, updated_at = ?
          WHERE user_id = ? AND COALESCE(rebinds, 0) < ?`
      ).bind(ids.hwid, now, user.id, MAX_TRIAL_REBINDS).run();
      await env.DB.prepare(
        'UPDATE licenses SET hwid = ? WHERE key IN (?, ?)'
      ).bind(ids.hwid, row.nofog_key || '', row.grant_key || '').run().catch(() => {});
      await logEvent(env, row.nofog_key, ids.hwid, 'trial_account_rebind',
        `${String(row.hwid).slice(0, 8)}… -> ${String(ids.hwid).slice(0, 8)}…`, ip);
      row.hwid = ids.hwid;
    }
  }

  // ---- 9. Bảo đảm có 2 license nội bộ ----
  const expiresAt = Number(row.expires_at);

  let nofogKey = row.nofog_key;
  let grantKey = row.grant_key;

  if (!nofogKey) {
    nofogKey = genKey('TR');
    await env.DB.prepare(
      'UPDATE trial_accounts SET nofog_key = ?, updated_at = ? WHERE user_id = ?'
    ).bind(nofogKey, now, user.id).run();
  }
  if (!grantKey) {
    grantKey = genKey('XAGR');
    await env.DB.prepare(
      'UPDATE trial_accounts SET grant_key = ?, updated_at = ? WHERE user_id = ?'
    ).bind(grantKey, now, user.id).run();
  }

  const nofogLic = await ensureLicense(env, {
    key: nofogKey, hwid: ids.hwid, expiresAt, now, ip,
    userId: user.id, product: 'nofog',
  });
  const grantLic = await ensureLicense(env, {
    key: grantKey, hwid: ids.hwid, expiresAt, now, ip,
    userId: user.id, product: 'grant',
  });

  if (!nofogLic || !grantLic) {
    return json({
      ok: false, code: 'server_error',
      msg: 'Không tạo được lượt dùng thử. Thử lại sau.',
    }, 500);
  }

  // ---- 10. Ký token cho cả hai sản phẩm ----
  const { buildToken } = await import('./license-server.js');
  const { issueSession } = await import('./xa-grant-server.js');

  let nofogTok = '';
  let grantTok = '';
  try {
    const t = await buildToken(env, nofogLic, nofogKey, ids.hwid);
    nofogTok = t.token;
  } catch (e) {
    console.error('trial: mint nofog token', e && e.message);
  }
  try {
    const s = await issueSession(env, grantLic, grantKey, ids.hwid, ip,
      body.fp, ua);
    grantTok = s.token;
  } catch (e) {
    console.error('trial: mint grant token', e && e.message);
  }

  const leftSec = Math.max(0, expiresAt - now);

  /*
   * GHI QUYỀN VÀO TÀI KHOẢN.
   *
   * Chủ shop chốt: "đăng nhập sẽ nhận trial cả map sáng cả tài nguyên vào
   * TÀI KHOẢN luôn". Nên lượt dùng thử không chỉ nằm ở `trial_accounts`
   * (bảng kỹ thuật) mà còn ghi thẳng vào `account_entitlements` — nguồn
   * sự thật mà app và web cùng đọc.
   *
   * Ghi bằng `source='trial'` để phân biệt với gói mua: nếu khách mua sau
   * đó, grantFeature() sẽ cộng dồn đè lên đúng dòng này.
   */
  try {
    const { grantFeature, FEATURE_NOFOG, FEATURE_GRANT } =
      await import('../lib/account-entitlement.js');
    const daysLeft = Math.max(0, (expiresAt - now) / 86400);
    for (const f of [FEATURE_NOFOG, FEATURE_GRANT]) {
      await grantFeature(env, {
        userId: user.id, feature: f, days: daysLeft,
        source: 'trial', note: 'Dùng thử 1 ngày',
      });
    }
  } catch (e) {
    console.error('trial: ghi account_entitlements', e && e.message);
  }

  await env.DB.prepare(
    'UPDATE licenses SET last_seen = ?, last_ip = ? WHERE key IN (?, ?)'
  ).bind(now, ip, nofogKey, grantKey).run().catch(() => {});

  return json({
    ok: true,
    state,
    started_at: Number(row.started_at || now),
    expires_at: expiresAt,
    left_sec: leftSec,
    days: Math.max(1, Math.round(leftSec / DAY_SEC)),
    /*
     * `features` là quyền THẬT của tài khoản (đọc từ account_entitlements),
     * không phải danh sách cố định. Nhờ vậy khách đã mua gói tài nguyên
     * trước khi dùng thử vẫn thấy đúng.
     */
    features: await currentFeatures(env, user.id, now),
    unlimited: wl.unlimited || false,
    now,
    nofog: {
      key: nofogKey,
      token: nofogTok,
      plan: 'trial',
      expires_at: expiresAt,
      activated_at: Number(row.started_at || now),
      grace_hours: 0,
      recheck_sec: 300,
    },
    grant: {
      key: grantKey,
      token: grantTok,
      plan: 'trial',
      expires_at: expiresAt,
      recheck_sec: 120,
    },
  });
}

/** Quyền đang bật của tài khoản (đọc từ account_entitlements). */
async function currentFeatures(env, userId, now) {
  try {
    const { shapeAccountEntitlements } = await import('../lib/account-entitlement.js');
    const s = await shapeAccountEntitlements(env, userId, now);
    return s.features;
  } catch {
    return ['nofog', 'grant'];
  }
}

/* ------------------------------------------------------------------ */
/* POST /api/account/token — cấp token theo QUYỀN TÀI KHOẢN           */
/* ------------------------------------------------------------------ */

/**
 * Khách ĐÃ MUA (hoặc đang dùng thử) gọi endpoint này để lấy token.
 *
 * Vì sao cần riêng: /api/trial/session chỉ lo DÙNG THỬ (tạo dòng
 * trial_accounts, chặn dùng lại). Khách đã mua không có dòng đó, nên cần
 * một đường chỉ ĐỌC quyền từ `account_entitlements` rồi ký token.
 *
 * Body: { guid, bios, cpu, vol } hoặc { hwid }
 * Trả: { ok, features, nofog:{token,...}, grant:{token,...}, now }
 */
export async function issueAccountToken(env, request) {
  const ip = clientIp(request);
  const body = await readBody(request);
  if (!body) {
    return json({ ok: false, code: 'bad_request', msg: 'JSON không hợp lệ' }, 400);
  }

  const { getSessionUser } = await import('../lib/auth.js');
  const user = await getSessionUser(env, request);
  if (!user) {
    return json({
      ok: false, code: 'login_required',
      msg: 'Đăng nhập để dùng app.',
    }, 401);
  }

  try {
    await rateLimit(env, `acctok:${ip}`, 240, 3600, { failClosed: true });
  } catch (e) {
    if (e && e.code === 'RATE_LIMITED') {
      return json({ ok: false, code: 'rate_limit', msg: 'Thao tác quá nhanh.' }, 429);
    }
    throw e;
  }

  const ids = await idsFromBody(body);
  if (!ids) {
    return json({
      ok: false, code: 'hwid_unavailable',
      msg: 'Không đọc được thông tin phần cứng. Chạy lại app.',
    }, 400);
  }

  const now = nowSec();
  const { shapeAccountEntitlements } = await import('../lib/account-entitlement.js');
  const acc = await shapeAccountEntitlements(env, user.id, now);

  if (!acc.features.length) {
    return json({
      ok: false, code: 'no_entitlement',
      msg: 'Tài khoản chưa có quyền. Dùng thử 1 ngày hoặc mua license.',
      features: [], trial: acc.trial, now,
    }, 403);
  }

  /*
   * Lấy license nội bộ làm VẬT MANG TOKEN.
   *
   * Khách không thấy key này. Nếu tài khoản đã có dòng trial_accounts thì
   * dùng lại đúng key đó (để không sinh thêm rác); nếu chưa thì tạo cặp mới
   * gắn vào trial_accounts để lần sau dùng lại.
   */
  let ta = await env.DB.prepare(
    'SELECT * FROM trial_accounts WHERE user_id = ?'
  ).bind(user.id).first();

  const nofogExp = acc.nofog.active ? (acc.nofog.expires_at || 0) : 0;
  const grantExp = acc.grant.active ? (acc.grant.expires_at || 0) : 0;

  let nofogKey = ta?.nofog_key || null;
  let grantKey = ta?.grant_key || null;

  if (!ta) {
    // Chưa có dòng nào -> tạo "vỏ" để giữ cặp key nội bộ
    nofogKey = genKey('TR');
    grantKey = genKey('XAGR');
    await env.DB.prepare(
      `INSERT INTO trial_accounts
         (user_id, state, created_at, started_at, expires_at, hwid, device_weak,
          ip, ua, nofog_key, grant_key, rebinds, updated_at)
       VALUES (?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`
    ).bind(
      user.id, now, now,
      Math.max(nofogExp, grantExp) || now + DAY_SEC,
      ids.hwid, ids.weak, ip,
      (request.headers.get('user-agent') || '').slice(0, 200),
      nofogKey, grantKey, now,
    ).run();
    ta = await env.DB.prepare('SELECT * FROM trial_accounts WHERE user_id = ?')
      .bind(user.id).first();
  } else {
    if (!nofogKey) {
      nofogKey = genKey('TR');
      await env.DB.prepare('UPDATE trial_accounts SET nofog_key = ? WHERE user_id = ?')
        .bind(nofogKey, user.id).run();
    }
    if (!grantKey) {
      grantKey = genKey('XAGR');
      await env.DB.prepare('UPDATE trial_accounts SET grant_key = ? WHERE user_id = ?')
        .bind(grantKey, user.id).run();
    }
  }

  const out = {
    ok: true, now, features: acc.features,
    nofog: null, grant: null,
  };

  // ---- Map sáng ----
  if (acc.hasNofog && nofogKey) {
    const lic = await ensureLicense(env, {
      key: nofogKey, hwid: ids.hwid,
      expiresAt: acc.nofog.forever ? 0 : nofogExp,
      now, ip, userId: user.id, product: 'nofog',
    });
    try {
      const { buildToken } = await import('./license-server.js');
      const t = await buildToken(env, lic, nofogKey, ids.hwid);
      out.nofog = {
        token: t.token, plan: lic.plan || 'aoe1',
        expires_at: lic.expires_at || 0,
        activated_at: lic.activated_at || now,
        grace_hours: 0, recheck_sec: 300,
      };
    } catch (e) {
      console.error('acct token nofog', e && e.message);
    }
  }

  // ---- Tài nguyên ----
  if (acc.hasGrant && grantKey) {
    const lic = await ensureLicense(env, {
      key: grantKey, hwid: ids.hwid,
      expiresAt: acc.grant.forever ? 0 : grantExp,
      now, ip, userId: user.id, product: 'grant',
    });
    try {
      const { issueSession } = await import('./xa-grant-server.js');
      const s = await issueSession(env, lic, grantKey, ids.hwid, ip,
        body.fp, (request.headers.get('user-agent') || '').slice(0, 200));
      out.grant = {
        token: s.token, plan: lic.plan || 'xagrant',
        expires_at: lic.expires_at || 0, recheck_sec: 120,
      };
    } catch (e) {
      console.error('acct token grant', e && e.message);
    }
  }

  return json(out);
}

/* ------------------------------------------------------------------ */
/* GET /api/trial/session — xem trạng thái, KHÔNG bắt đầu đồng hồ      */
/* ------------------------------------------------------------------ */

export async function sessionStatus(env, request) {
  const { getSessionUser } = await import('../lib/auth.js');
  const user = await getSessionUser(env, request);
  if (!user) {
    return json({ ok: false, code: 'login_required' }, 401);
  }

  const cfg = await trialCfg(env);
  const now = nowSec();

  const row = await env.DB.prepare(
    'SELECT * FROM trial_accounts WHERE user_id = ?'
  ).bind(user.id).first();

  if (!row) {
    /*
     * Chưa dùng thử. Chỉ BÁO là còn lượt, KHÔNG tạo dòng và KHÔNG chạy
     * đồng hồ — đồng hồ chỉ chạy khi app thật sự mở (POST).
     */
    return json({
      ok: true,
      state: 'available',
      enabled: cfg.enabled,
      days: Number(cfg.accountDays) || 1,
      features: ['nofog', 'grant'],
      now,
    });
  }

  const expired = !!row.ended_at || Number(row.expires_at || 0) <= now;
  return json({
    ok: true,
    state: expired ? 'ended' : 'active',
    enabled: cfg.enabled,
    started_at: Number(row.started_at || 0),
    expires_at: Number(row.expires_at || 0),
    left_sec: expired ? 0 : Math.max(0, Number(row.expires_at) - now),
    features: ['nofog', 'grant'],
    end_reason: row.end_reason || null,
    now,
  });
}

/* ------------------------------------------------------------------ */
/* Admin                                                               */
/* ------------------------------------------------------------------ */

/** GET /api/admin/trial/account-trials — danh sách lượt dùng thử theo tài khoản. */
export async function adminListAccountTrials(env, request) {
  const { requireAdmin } = await import('../lib/auth.js');
  await requireAdmin(env, request);

  const url = new URL(request.url);
  const q = (url.searchParams.get('q') || '').trim();
  const now = nowSec();

  const binds = [];
  let where = '1=1';
  if (q) {
    where += ' AND (u.username LIKE ? OR t.user_id LIKE ?)';
    binds.push(`%${q}%`, `%${q}%`);
  }

  const { results } = await env.DB.prepare(
    `SELECT t.*, u.username
       FROM trial_accounts t
       LEFT JOIN users u ON u.id = t.user_id
      WHERE ${where}
      ORDER BY t.started_at DESC
      LIMIT 300`
  ).bind(...binds).all();

  return json({
    ok: true,
    now,
    trials: (results || []).map((r) => ({
      userId: r.user_id,
      username: r.username || '',
      state: r.ended_at || Number(r.expires_at || 0) <= now ? 'ended' : 'active',
      startedAt: Number(r.started_at || 0),
      expiresAt: Number(r.expires_at || 0),
      leftSec: Math.max(0, Number(r.expires_at || 0) - now),
      hwid: r.hwid || '',
      ip: r.ip || '',
      rebinds: Number(r.rebinds || 0),
      endReason: r.end_reason || null,
      nofogKey: r.nofog_key || '',
      grantKey: r.grant_key || '',
    })),
  });
}

/**
 * POST /api/admin/trial/account-reset { userId, days? }
 *
 * Cấp lại lượt dùng thử cho một tài khoản (khách khiếu nại, máy hỏng...).
 * Mặc định gia thêm `days` ngày kể từ BÂY GIỜ.
 */
export async function adminResetAccountTrial(env, request) {
  const { requireAdminStrict } = await import('../lib/auth.js');
  const admin = await requireAdminStrict(env, request);
  const body = await readBody(request);
  const userId = String(body?.userId || '').trim();
  if (!userId) {
    throw new ApiError(400, 'Thiếu userId', 'VALIDATION');
  }

  const days = Math.max(1, Math.min(365, Number(body?.days) || 1));
  const now = nowSec();
  const expiresAt = now + days * DAY_SEC;

  const row = await env.DB.prepare(
    'SELECT * FROM trial_accounts WHERE user_id = ?'
  ).bind(userId).first();

  if (!row) {
    // Chưa từng dùng thử -> tạo mới luôn
    await env.DB.prepare(
      `INSERT INTO trial_accounts
         (user_id, state, created_at, started_at, expires_at, rebinds, updated_at)
       VALUES (?, 'active', ?, ?, ?, 0, ?)`
    ).bind(userId, now, now, expiresAt, now).run();
  } else {
    await env.DB.prepare(
      `UPDATE trial_accounts
          SET state = 'active', started_at = ?, expires_at = ?,
              ended_at = NULL, end_reason = NULL, rebinds = 0, updated_at = ?
        WHERE user_id = ?`
    ).bind(now, expiresAt, now, userId).run();
    // Mở lại license nội bộ nếu đã bị thu hồi
    await env.DB.prepare(
      'UPDATE licenses SET revoked = 0, expires_at = ? WHERE key IN (?, ?)'
    ).bind(expiresAt, row.nofog_key || '', row.grant_key || '').run().catch(() => {});
  }

  await logEvent(env, row?.nofog_key || null, null, 'trial_account_reset',
    `admin ${admin.id} cấp ${days} ngày`, null);

  return json({ ok: true, userId, expiresAt, days });
}
