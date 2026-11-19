/**
 * entitlement.js — QUYỀN DÙNG CHỨC NĂNG suy ra TỪ LICENSE.
 *
 * ============================================================================
 * BỐI CẢNH
 *
 * Trước đây có 2 tool riêng: "XA NOFOG" (bỏ sương mù) và "XA GRANT" (thêm
 * tài nguyên). Nay gộp thành MỘT app. App phải biết ngay từ license khách
 * được bật chức năng nào:
 *
 *   mua MAP SÁNG        -> chỉ bật được "Bật map sáng"
 *   mua THÊM TÀI NGUYÊN -> chỉ bật được "Cộng tài nguyên"
 *   mua CẢ HAI          -> bật được cả hai
 *
 * Nguồn sự thật DUY NHẤT là cột `licenses.pid`:
 *   pid = 'xagrant'                        -> quyền 'grant'
 *   pid = NULL / '' / 'aoe1'               -> quyền 'nofog'
 *   pid khác (lạ)                          -> KHÔNG quyền gì (fail closed)
 *
 * Một khách có CẢ HAI quyền chỉ khi sở hữu 2 license khác nhau (mỗi loại một
 * cái) — không có license nào tự cho cả hai.
 * ============================================================================
 */

import { json } from '../lib/http.js';

/** Tên chức năng hợp lệ. KHÔNG bao giờ trả tên ngoài danh sách này. */
export const FEATURE_NOFOG = 'nofog';
export const FEATURE_GRANT = 'grant';
export const ALL_FEATURES = [FEATURE_GRANT, FEATURE_NOFOG];   // đã sắp xếp

const PID_GRANT = 'xagrant';
const PID_NOFOG = 'aoe1';

/**
 * Quyền của MỘT license. Hàm THUẦN — không đọc DB, test được độc lập.
 *
 * @param {object|null} lic  dòng licenses (cần `pid`)
 * @returns {string[]}       mảng tên chức năng, đã sắp xếp
 */
export function featureKeysFor(lic) {
  if (!lic) return [];
  const pid = String(lic.pid == null ? '' : lic.pid).trim().toLowerCase();

  // --- Thêm tài nguyên: CHỈ khi pid đúng 'xagrant' ---
  if (pid === PID_GRANT) {
    return [FEATURE_GRANT];
  }

  // --- Bỏ sương mù: pid rỗng, 'aoe1', hoặc bất kỳ giá trị KHÔNG phải xagrant
  //     nhưng cũng KHÔNG phải rác lạ. Chỉ nhận đúng 3 dạng đã biết. ---
  if (pid === '' || pid === PID_NOFOG) {
    return [FEATURE_NOFOG];
  }

  // --- pid lạ: FAIL CLOSED, không cấp quyền gì ---
  return [];
}

/** now tính bằng GIÂY (epoch), giống phần còn lại của hệ thống. */
function nowSec() {
  return Math.floor(Date.now() / 1000);
}

/**
 * Một license -> dạng hiển thị cho app.
 * Dùng chung cho /api/entitlement và /api/licenses/mine để KHÔNG lệch nhau.
 */
export function shapeEntitlement(lic, now, clientHwid, clientHwid2) {
  if (!lic) return null;
  const t = Number.isFinite(Number(now)) ? Number(now) : nowSec();
  const exp = Number(lic.expires_at || 0);
  const forever = exp === 0;
  const revoked = !!lic.revoked;
  const active = !revoked && (forever || exp > t);
  const features = featureKeysFor(lic);
  /*
   * TRIAL vs ĐÃ MUA — HAI CHÍNH SÁCH KHÁC NHAU.
   *
   *   trial  : khoá theo MÁY. Máy khác -> `hwid_match: false` -> mất quyền.
   *   đã mua : khoá theo TÀI KHOẢN. KHÔNG BAO GIỜ trả `hwid_match: false`,
   *            vì khách đổi máy là hợp pháp. `licenses.hwid` chỉ còn là
   *            "máy dùng gần nhất".
   */
  const isTrial = String(lic.plan || '').toLowerCase() === 'trial';

  /*
   * HWID CỦA MÁY KHÁCH vs HWID ĐÃ GHI TRONG LICENSE.
   *
   * `hwid_bound` chỉ nói license ĐÃ ghi nhận một máy nào đó — không nói
   * có phải máy này. Thiếu phân biệt này thì app hiện "Còn 26 ngày" cho
   * license của máy khác.
   *
   * null = không kết luận được (client chưa gửi HWID).
   */
  const ch = String(clientHwid || '').trim().toLowerCase();
  const ch2 = String(clientHwid2 || '').trim().toLowerCase();
  const lh = String(lic.hwid || '').trim().toLowerCase();
  let hwidMatch = null;
  if ((ch || ch2) && lh) {
    /*
     * CHỈ kết luận khi license ĐÃ BIND (lh khác rỗng).
     *
     * LỖI ĐÃ SỬA: trước đây `!!lh && lh === ch` trả FALSE khi license
     * CHƯA bind (lh = ''). FALSE bị hiểu là "bind máy khác" nên
     * unionFeatures() loại bỏ quyền -> key mới mua KHÔNG dùng được.
     *
     * Nay: chưa bind -> null (chưa biết, không loại quyền).
     */
    /*
     * MÁY NÀY TÍNH HAI HWID KHÁC NHAU:
     *   xa_nofog_pro.compute_hwid()  -> 775c3fd3...
     *   xa_grant._guard_safe_hwid()  -> d512bc5a...
     *
     * License map sáng bind bằng HWID thứ nhất, license tài nguyên bind
     * bằng HWID thứ hai. Chỉ nhận một cái thì nửa số license bị coi là
     * "sai máy" -> mất quyền oan.
     *
     * Nay khớp MỘT TRONG HAI là đủ.
     */
    hwidMatch = (lh === ch) || (!!ch2 && lh === ch2);
  }

  /*
   * BẢN ĐÃ TRẢ TIỀN: hạ `false` xuống `null`.
   *
   * Vì sao không để `false`: `unionFeatures()` loại license khi
   * `hwid_match === false`, nên một khách ĐÃ MUA đổi máy sẽ bị cắt quyền
   * trên web/app — trái yêu cầu "mua rồi thì đổi máy nào cũng được".
   *
   * `true` vẫn giữ khi đúng máy gần nhất, để app ưu tiên đúng key
   * (`_pick_key`: True > None > False) và chọn đúng license cần kích hoạt.
   */
  if (!isTrial) {
    hwidMatch = hwidMatch === true ? true : null;
  }

  return {
    key: lic.key || '',
    pid: lic.pid == null ? null : String(lic.pid),
    plan: lic.plan || '',
    expires_at: exp,
    forever,
    revoked,
    active,
    // 'hwid' = khoá theo máy (trial) | 'account' = đi theo tài khoản (đã mua)
    binding: isTrial ? 'hwid' : 'account',
    // `hwid_bound` = ĐÃ ghi nhận máy (chỉ để hiển thị). Với bản trả phí đây
    // KHÔNG phải điều kiện để dùng.
    hwid_bound: !!lh,
    hwid_recorded: !!lh,
    hwid_match: hwidMatch,
    features,
    hasNofog: features.indexOf(FEATURE_NOFOG) >= 0,
    hasGrant: features.indexOf(FEATURE_GRANT) >= 0,
  };
}

/** Gộp quyền từ nhiều license (chỉ tính license còn hiệu lực). */
export function unionFeatures(views) {
  const set = new Set();
  for (const v of views || []) {
    if (!v) continue;
    if (!v.active) continue;
    /*
     * License gắn MÁY KHÁC thì KHÔNG cấp quyền — nhưng điều này CHỈ còn xảy
     * ra với bản DÙNG THỬ (plan='trial').
     *
     * Bản đã trả phí không bao giờ nhận `hwid_match === false` nữa (xem
     * shapeEntitlement), vì khách đã mua được đổi máy tuỳ ý và chỉ bị chặn
     * đồng thời bởi luật "1 tài khoản = 1 máy" ở server license.
     * (hwid_match === null: chưa kết luận được -> tạm tính)
     */
    if (v.hwid_match === false) continue;
    for (const f of v.features || []) set.add(f);
  }
  // Giữ thứ tự ổn định
  const out = ALL_FEATURES.filter((f) => set.has(f));
  return {
    features: out,
    hasNofog: out.indexOf(FEATURE_NOFOG) >= 0,
    hasGrant: out.indexOf(FEATURE_GRANT) >= 0,
  };
}

/**
 * GET /api/entitlement            (cần đăng nhập)
 * GET /api/entitlement?key=XXX    (không cần đăng nhập, chỉ 1 key)
 *
 * Trả quyền của khách để app quyết định hiện/ẩn chức năng.
 */
export async function buildEntitlement(env, request) {
  /*
   * VỚI LICENSE DÙNG THỬ, `licenses.expires_at` LÀ HẠN GIỮ MÃ (7 ngày),
   * KHÔNG phải thời lượng dùng thử. Thời lượng thật nằm ở
   * `trial_uses.expires_at` (chỉ có sau khi đồng hồ bắt đầu).
   *
   * LỖI ĐÃ SỬA: trước đây trả thẳng `lic.expires_at` nên dùng thử 1 giờ
   * hiện "Còn 6 ngày". Khách tưởng còn 7 ngày, hết 1 giờ thì khiếu nại.
   */
  async function trialClockFor(key) {
    try {
      const u = await env.DB.prepare(
        'SELECT started_at, expires_at, kind FROM trial_uses '
        + 'WHERE lic_key = ? ORDER BY created_at DESC LIMIT 1'
      ).bind(key).first();
      return u || null;
    } catch {
      return null;
    }
  }

  const url = new URL(request.url);
  const qKey = (url.searchParams.get('key') || '').trim();
  // HWID của máy khách — dùng để biết license có bind ĐÚNG máy này không.
  const qHwid = (url.searchParams.get('hwid') || '').trim();
  // HWID thứ hai: module tài nguyên tính khác module map sáng.
  const qHwid2 = (url.searchParams.get('hwid2') || '').trim();
  const now = nowSec();

  const { getSessionUser } = await import('../lib/auth.js');
  const user = await getSessionUser(env, request).catch(() => null);

  // ---------- Đường 1: đã đăng nhập -> TẤT CẢ key của họ ----------
  if (user) {
    const { results } = await env.DB.prepare(
      `SELECT li.license_key AS key,
              COALESCE(l.pid, '') AS pid,
              COALESCE(l.plan, '') AS plan,
              COALESCE(l.expires_at, 0) AS expires_at,
              COALESCE(l.revoked, 0) AS revoked,
              l.hwid AS hwid
         FROM license_issues li
         LEFT JOIN licenses l ON l.key = li.license_key
        WHERE li.user_id = ?
        ORDER BY li.created_at DESC LIMIT 200`
    ).bind(user.id).all();

    const views = (results || [])
      .map((r) => shapeEntitlement({
        key: r.key, pid: r.pid, plan: r.plan,
        expires_at: r.expires_at, revoked: r.revoked, hwid: r.hwid,
      }, now, qHwid, qHwid2))
      .filter(Boolean);

    /*
     * ===== AUDIT #8: ĐƯỜNG "ĐÃ ĐĂNG NHẬP" CŨNG PHẢI DÙNG ĐỒNG HỒ THẬT =====
     *
     * Bản sửa trước chỉ áp cho đường 2 (chỉ có key) — đường 1 (session, tức
     * trang web của khách) vẫn trả thẳng `licenses.expires_at`, mà với
     * plan='trial' đó là HẠN GIỮ MÃ (7 ngày). Khách đang đăng nhập vì thế vẫn
     * thấy gói 1 giờ "còn ~7 ngày" trong khi khách không đăng nhập lại thấy
     * đúng. Nay áp cùng một cách cho cả hai đường.
     *
     * Một câu SQL cho toàn bộ key trial (trialClockMap), không N+1.
     * Chưa bắt đầu đồng hồ -> expires_at = 0 + trial_started=false (không hứa
     * hạn nào), vẫn giữ quyền vì khách sở hữu key.
     */
    const { trialClockMap } = await import('../lib/trial-quota.js');
    const trialKeys = views
      .filter((v) => String(v.plan || '').toLowerCase() === 'trial')
      .map((v) => v.key);
    if (trialKeys.length) {
      const clocks = await trialClockMap(env, trialKeys);
      for (const v of views) {
        if (String(v.plan || '').toLowerCase() !== 'trial') continue;
        const cl = clocks.get(String(v.key || ''));
        v.is_trial = true;
        if (cl && cl.started && cl.expires_at > 0) {
          v.expires_at = cl.expires_at;
          v.trial_started = true;
          v.forever = false;
          v.active = !v.revoked && v.expires_at > now;
        } else if (cl) {
          v.trial_started = false;
          v.expires_at = 0;
          v.forever = false;
          v.active = !v.revoked;
        }
        // cl == null: dữ liệu trial v1 không có trial_uses -> giữ nguyên hạn cũ
      }
    }

    const u = unionFeatures(views);
    return json({
      ok: true,
      now,
      via: 'session',
      user: { id: user.id, username: user.username || '' },
      licenses: views,
      features: u.features,
      hasNofog: u.hasNofog,
      hasGrant: u.hasGrant,
    });
  }

  // ---------- Đường 2: chỉ có key (không đăng nhập) ----------
  if (qKey) {
    /*
     * AUDIT #10: /api/entitlement?key= là bề mặt ĐOÁN KEY công khai (không cần
     * đăng nhập, trả về plan/hạn/quyền của bất kỳ key nào tồn tại). Trước đây
     * chỉ có trần toàn cục 3000/phút/IP.
     *
     * 120 lượt / phút / IP: app gọi endpoint này mỗi lần bật tool (có thể kèm
     * hwid + hwid2), nên phải rộng; 120/phút vẫn chặn được dò hàng loạt.
     */
    try {
      const { rateLimit, clientIp } = await import('../lib/ratelimit.js');
      await rateLimit(env, `ent:${clientIp(request)}`, 120, 60);
    } catch (e) {
      if (e && e.code === 'RATE_LIMITED') {
        return json({
          ok: false, code: 'RATE_LIMITED',
          error: 'Quá nhiều yêu cầu, vui lòng thử lại sau ít phút',
        }, 429);
      }
      throw e;
    }

    // Chuẩn hoá giống normKey của web để khách dán chữ thường vẫn được
    const { normKey } = await import('./license.js').catch(() => ({}));
    const k = typeof normKey === 'function' ? normKey(qKey) : qKey.toUpperCase();

    const row = await env.DB.prepare(
      `SELECT key, COALESCE(pid,'') AS pid, COALESCE(plan,'') AS plan,
              COALESCE(expires_at,0) AS expires_at,
              COALESCE(revoked,0) AS revoked, hwid
         FROM licenses WHERE key = ?`
    ).bind(k).first();

    if (!row) {
      return json({ ok: false, code: 'NOT_FOUND',
        error: 'Mã license không tồn tại' }, 404);
    }

    // CHỈ trả đúng 1 key này — không lộ key khác của chủ sở hữu
    const view = shapeEntitlement(row, now, qHwid, qHwid2);

    // Dùng thử: thay hạn giữ mã bằng hạn THẬT của đồng hồ dùng thử.
    if (view && String(view.plan || '').toLowerCase() === 'trial') {
      const tu = await trialClockFor(view.key);
      view.is_trial = true;
      if (tu && tu.started_at > 0) {
        view.expires_at = Number(tu.expires_at || 0);
        view.trial_started = true;
        view.active = Number(tu.expires_at || 0) > now;
        view.forever = false;
      } else {
        // Chưa bắt đầu -> không hứa hạn nào
        view.trial_started = false;
        view.expires_at = 0;
        view.forever = false;
        view.active = !view.revoked;
      }
    }
    const u = unionFeatures([view]);
    return json({
      ok: true,
      now,
      via: 'key',
      user: null,
      licenses: [view],
      features: u.features,
      hasNofog: u.hasNofog,
      hasGrant: u.hasGrant,
    });
  }

  return json({
    ok: false,
    code: 'NEED_LOGIN_OR_KEY',
    error: 'Cần đăng nhập hoặc dán license key',
  }, 401);
}

/**
 * Dùng trong myLicenses: mỗi item đã có sẵn dữ liệu license phẳng.
 * Trả các trường quyền để web VÀ app dùng cùng một logic.
 */
export function entitlementFieldsFor(flat, now, clientHwid) {
  const v = shapeEntitlement({
    key: flat && flat.key,
    pid: flat && flat.pid,
    plan: flat && flat.plan,
    expires_at: flat && flat.expires_at,
    revoked: flat && flat.revoked,
    hwid: flat && flat.hwid,
  }, now, clientHwid);
  if (!v) {
    return {
      features: [], hasNofog: false, hasGrant: false,
      active: false, forever: false, hwidBound: false,
    };
  }
  return {
    features: v.features,
    hasNofog: v.hasNofog,
    hasGrant: v.hasGrant,
    active: v.active,
    forever: v.forever,
    binding: v.binding,
    hwidBound: v.hwid_bound,
    hwidMatch: v.hwid_match,
  };
}
