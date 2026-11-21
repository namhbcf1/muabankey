/**
 * QUYỀN THEO TÀI KHOẢN — nguồn sự thật duy nhất.
 *
 * ============================================================================
 * CHỦ SHOP CHỐT
 *
 *   "Đăng nhập sẽ nhận trial cả map sáng cả tài nguyên vào tài khoản luôn,
 *    hạn là 1 ngày free. Bỏ toàn bộ key trên hệ thống app và web đi.
 *    Mua thì add luôn vào tài khoản."
 *
 * ============================================================================
 * MÔ HÌNH
 *
 *   account_entitlements (user_id, feature) -> expires_at
 *       feature = 'nofog'  (bỏ sương mù)
 *       feature = 'grant'  (cộng tài nguyên)
 *
 *   entitlement_grants  — SỔ BẤT BIẾN: mỗi lần cấp là một dòng.
 *
 *   - Khách KHÔNG có key. Không nhập, không giữ, không gõ sai.
 *   - Mua trên web -> cộng thẳng hạn vào dòng của tài khoản.
 *   - Dùng thử 1 ngày -> ĐẶT mốc tuyệt đối, không cộng dồn.
 *   - App chỉ cần đăng nhập, tự hỏi server quyền của mình.
 *
 * ============================================================================
 * HAI LỖI P0 ĐÃ SỬA Ở TẦNG NÀY (F01, F02, F03 trong kế hoạch)
 *
 * 1. F03 — MẤT NGÀY KHI GIA HẠN ĐỒNG THỜI.
 *    Bản cũ: `SELECT expires_at` rồi tính trong JS rồi UPSERT. Hai request
 *    đồng thời cùng đọc hạn cũ -> cả hai ghi "cũ + 30 ngày" -> mất 30 ngày
 *    của một lần mua. (Tái hiện được: hai lần mua 30 ngày chỉ cộng 30.)
 *    Nay: TOÀN BỘ phép cộng nằm TRONG một câu SQL
 *    (`MAX(COALESCE(expires_at,0), now) + days*86400`), nên D1 tự tuần tự
 *    hoá. Không còn khe đọc-rồi-ghi.
 *
 * 2. F01 — RESUME DÙNG THỬ CỘNG THÊM THỜI GIAN.
 *    Bản cũ: mỗi lần mở app lại gọi grantFeature(daysLeft) -> cộng dồn.
 *    Đo được: resume sau 60 giây làm hạn tăng thêm 86.340 giây.
 *    Nay: dùng thử đi qua `applyTrialEntitlement()` — ĐẶT mốc TUYỆT ĐỐI
 *    (idempotent), không bao giờ cộng, và không bao giờ RÚT NGẮN quyền đã
 *    mua.
 *
 * 3. F02 — HOÀN TIỀN KHÔNG THU HỒI ĐÚNG PHẦN ĐÃ CẤP.
 *    Bản cũ: không có sổ nên refund không biết đơn đã cộng bao nhiêu ngày.
 *    Nay: `revokeOrderGrants()` trừ ĐÚNG số ngày của đơn đó, không đụng các
 *    đơn khác của cùng tài khoản.
 * ============================================================================
 */

/** Hai tính năng bán được. */
export const FEATURE_NOFOG = 'nofog';
export const FEATURE_GRANT = 'grant';
export const ALL_FEATURES = [FEATURE_NOFOG, FEATURE_GRANT];

/** Nhãn hiển thị cho khách. */
export const FEATURE_LABEL = {
  nofog: 'Map sáng',
  grant: 'Tài nguyên',
};

const DAY_SEC = 86400;

function timeNow(now) {
  const n = Number(now);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : Math.floor(Date.now() / 1000);
}

function newId() {
  try {
    return crypto.randomUUID();
  } catch {
    return `g-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

/**
 * Đọc toàn bộ quyền của một tài khoản. Trả Map<feature, row>.
 *
 * Lỗi đọc (chưa migrate) -> Map rỗng. Hàm này chỉ để ĐỌC/TRÌNH BÀY; mọi phép
 * GHI đều nguyên tử ở SQL nên không phụ thuộc kết quả đọc.
 */
export async function loadEntitlements(env, userId) {
  const out = new Map();
  if (!userId) return out;
  try {
    const { results } = await env.DB.prepare(
      'SELECT * FROM account_entitlements WHERE user_id = ?'
    ).bind(userId).all();
    for (const r of results || []) out.set(String(r.feature), r);
  } catch { /* chưa migrate -> coi như chưa có quyền */ }
  return out;
}

/**
 * Quyền này còn hiệu lực không?
 *
 * expires_at = 0 nghĩa là VĨNH VIỄN (giữ đúng quy ước của bảng licenses).
 */
export function isActive(row, now) {
  if (!row) return false;
  const exp = Number(row.expires_at || 0);
  if (exp === 0) return true;          // vĩnh viễn
  return exp > now;
}

/* ================================================================== */
/* GHI SỔ CẤP QUYỀN                                                    */
/* ================================================================== */

/**
 * Ghi một dòng sổ cấp quyền, KHÔNG chặn luồng chính nếu bảng chưa có.
 *
 * `sourceId` quyết định tính idempotent:
 *   purchase -> orderId            (một đơn chỉ cấp một lần)
 *   trial    -> trial:<started_at> (một lượt thử chỉ ghi một lần)
 *   admin    -> admin:<uuid>       (mỗi thao tác admin là một lần cấp mới)
 */
async function insertGrantRow(env, {
  grantId, userId, feature, sourceType, sourceId, days, now, note,
  prevExpiresAt = 0, newExpiresAt = 0,
}) {
  try {
    await env.DB.prepare(
      `INSERT INTO entitlement_grants
         (grant_id, user_id, feature, source_type, source_id, days_added,
          prev_expires_at, new_expires_at, created_at, note)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      grantId, userId, feature, sourceType, sourceId ?? null,
      Math.max(0, Math.floor(Number(days) || 0)),
      Math.max(0, Math.floor(Number(prevExpiresAt) || 0)),
      Math.max(0, Math.floor(Number(newExpiresAt) || 0)),
      now, note || null,
    ).run();
  } catch { /* bảng sổ chưa migrate -> vẫn cấp quyền, chỉ mất lịch sử */ }
}

/* ================================================================== */
/* CẤP / GIA HẠN (đơn mua, admin)                                      */
/* ================================================================== */

/**
 * Cấp/gia hạn một tính năng cho tài khoản — NGUYÊN TỬ + IDEMPOTENT.
 *
 * `days = 0` -> vĩnh viễn.
 * Gia hạn CỘNG DỒN: nếu còn hạn thì cộng thêm, nếu đã hết thì tính từ bây giờ.
 * Đây là hành vi khách mong đợi khi mua thêm gói.
 *
 * ==========================================================================
 * VÌ SAO PHẢI ĐI QUA MỘT "CLAIM" TRONG SỔ
 *
 * Retry là chuyện có thật: webhook gọi lại, admin bấm "giao bù", worker chết
 * giữa chừng rồi request sau chạy lại `deliverOrderItems`. Nếu mỗi lần đều
 * cộng ngày thì một đơn 30 ngày có thể thành 60, 90, 120 ngày.
 *
 * Cách chống: INSERT dòng sổ (UNIQUE theo user+feature+source+source_id) và
 * UPDATE quyền nằm trong CÙNG một batch = một transaction. Câu UPDATE bị chặn
 * bởi `WHERE EXISTS (… grant_id …)`, nên:
 *   - lần đầu  : claim chèn được -> EXISTS đúng -> quyền được cộng;
 *   - lần retry: claim vi phạm UNIQUE -> EXISTS sai -> quyền KHÔNG đổi.
 * Không có cửa sổ nào để "đã cộng mà sổ chưa ghi" hoặc ngược lại.
 * ==========================================================================
 *
 * @param {object} env
 * @param {object} opts
 * @param {string} opts.userId
 * @param {string} opts.feature   'nofog' | 'grant'
 * @param {number} opts.days      số ngày; 0 = vĩnh viễn
 * @param {string} [opts.source]  'purchase' | 'admin' | 'trial'
 * @param {string} [opts.orderId] đơn gốc (khoá idempotency với source='purchase')
 * @param {string} [opts.sourceId] khoá idempotency; mặc định suy từ source
 * @param {string} [opts.note]
 * @param {number} [opts.now]     giờ giả cho kiểm thử
 * @returns {Promise<{userId:string, feature:string, expiresAt:number,
 *                    source:string, daysAdded:number, applied:boolean}>}
 */
export async function grantFeature(env, {
  userId, feature, days, source = 'purchase', orderId = null, note = '',
  sourceId = null, now,
}) {
  if (!userId || !ALL_FEATURES.includes(feature)) {
    throw new Error(`grantFeature: tham số không hợp lệ (${feature})`);
  }
  const t = timeNow(now);
  const d = Math.max(0, Math.floor(Number(days) || 0));

  const srcType = String(source || 'purchase');
  const grantId = newId();
  const idem = sourceId !== null && sourceId !== undefined
    ? String(sourceId)
    : (srcType === 'purchase' && orderId ? String(orderId) : `${srcType}:${grantId}`);

  // Hạn TRƯỚC khi cấp — chỉ để ghi sổ đối soát, không dùng cho quyết định.
  let prevExp = 0;
  try {
    const p = await env.DB.prepare(
      'SELECT expires_at FROM account_entitlements WHERE user_id = ? AND feature = ?'
    ).bind(userId, feature).first();
    prevExp = Number(p?.expires_at || 0);
  } catch { /* chưa migrate */ }

  /*
   * CÂU 1 — CLAIM. Trùng (user, feature, source_type, source_id) thì không
   * chèn được dòng nào, và `grant_id` của lượt này sẽ không tồn tại.
   */
  const claimSql = `INSERT INTO entitlement_grants
       (grant_id, user_id, feature, source_type, source_id, days_added,
        prev_expires_at, new_expires_at, created_at, note)
     SELECT ?, ?, ?, ?, ?, ?, ?, 0, ?, ?
      WHERE NOT EXISTS (
              SELECT 1 FROM entitlement_grants
               WHERE user_id = ? AND feature = ? AND source_type = ?
                 AND source_id IS ?
            )`;

  /*
   * CÂU 2 — CỘNG HẠN, chỉ chạy khi claim của CHÍNH lượt này tồn tại.
   *
   *   - days = 0            -> 0 (vĩnh viễn)
   *   - đang vĩnh viễn      -> giữ 0 (mua thêm hạn không làm giảm quyền)
   *   - còn hạn             -> hạn cũ + days
   *   - đã hết hạn          -> now + days
   *
   * Toàn bộ phép tính nằm trong SQL nên D1 tự tuần tự hoá: không còn khe
   * đọc-rồi-ghi của bản cũ (hai lần mua đồng thời từng mất 30 ngày).
   */
  const grantSql = `INSERT INTO account_entitlements
       (user_id, feature, expires_at, source, order_id, note, created_at, updated_at)
     SELECT ?, ?, CASE WHEN ? = 0 THEN 0 ELSE ? + ? * ${DAY_SEC} END,
            ?, ?, ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM entitlement_grants WHERE grant_id = ?)
     ON CONFLICT(user_id, feature) DO UPDATE SET
       expires_at = CASE
                      WHEN ? = 0 THEN 0
                      WHEN account_entitlements.expires_at = 0 THEN 0
                      ELSE MAX(COALESCE(account_entitlements.expires_at, 0), ?)
                           + ? * ${DAY_SEC}
                    END,
       source     = excluded.source,
       order_id   = COALESCE(excluded.order_id, account_entitlements.order_id),
       note       = excluded.note,
       updated_at = excluded.updated_at
     WHERE EXISTS (SELECT 1 FROM entitlement_grants WHERE grant_id = ?)`;

  try {
    await env.DB.batch([
      env.DB.prepare(claimSql).bind(
        grantId, userId, feature, srcType, idem, d, prevExp, t, note,
        userId, feature, srcType, idem,
      ),
      env.DB.prepare(grantSql).bind(
        userId, feature, d, t, d,
        srcType, orderId, note, t, t,
        grantId,
        d, t, d,
        grantId,
      ),
    ]);
  } catch (e) {
    /*
     * Sổ chưa migrate (hoặc bảng thiếu) -> vẫn phải cấp được quyền, nếu không
     * khách trả tiền mà không có gì. Chỉ mất tính idempotent, không mất quyền.
     */
    await env.DB.prepare(
      `INSERT INTO account_entitlements
         (user_id, feature, expires_at, source, order_id, note, created_at, updated_at)
       VALUES (?, ?, CASE WHEN ? = 0 THEN 0 ELSE ? + ? * ${DAY_SEC} END,
               ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, feature) DO UPDATE SET
         expires_at = CASE
                        WHEN ? = 0 THEN 0
                        WHEN account_entitlements.expires_at = 0 THEN 0
                        ELSE MAX(COALESCE(account_entitlements.expires_at, 0), ?)
                             + ? * ${DAY_SEC}
                      END,
         source     = excluded.source,
         order_id   = COALESCE(excluded.order_id, account_entitlements.order_id),
         note       = excluded.note,
         updated_at = excluded.updated_at`
    ).bind(
      userId, feature, d, t, d,
      srcType, orderId, note, t, t,
      d, t, d,
    ).run();
  }

  // Đọc lại hạn thật + biết lượt này có được áp hay không.
  let expiresAt = d === 0 ? 0 : t + d * DAY_SEC;
  let applied = true;
  try {
    const row = await env.DB.prepare(
      'SELECT expires_at FROM account_entitlements WHERE user_id = ? AND feature = ?'
    ).bind(userId, feature).first();
    if (row) expiresAt = Number(row.expires_at || 0);
    const mine = await env.DB.prepare(
      'SELECT 1 AS x FROM entitlement_grants WHERE grant_id = ?'
    ).bind(grantId).first();
    applied = !!mine;
  } catch { /* chưa migrate sổ */ }

  if (applied) {
    // Chỉ dòng của CHÍNH lượt này được cập nhật (tránh ghi đè dòng của lượt
    // khác đang chạy song song).
    try {
      await env.DB.prepare(
        `UPDATE entitlement_grants
            SET new_expires_at = ?, days_added = ?
          WHERE grant_id = ?`
      ).bind(
        Math.max(0, expiresAt), expiresAt === 0 ? 0 : d, grantId,
      ).run();
    } catch { /* chưa migrate sổ */ }
  }

  return {
    userId, feature, expiresAt, source: srcType,
    daysAdded: applied && expiresAt !== 0 ? d : 0,
    applied,
  };
}

/* ================================================================== */
/* DÙNG THỬ — ĐẶT MỐC TUYỆT ĐỐI (idempotent)                           */
/* ================================================================== */

/**
 * Ghi quyền dùng thử theo MỐC TUYỆT ĐỐI.
 *
 * KHÁC grantFeature ở chỗ CỐT LÕI:
 *   - KHÔNG cộng dồn. Gọi 1 lần hay 100 lần đều cho cùng một hạn.
 *   - KHÔNG rút ngắn quyền đã mua: nếu tài khoản đang có hạn mua dài hơn thì
 *     giữ nguyên hạn mua.
 *   - KHÔNG biến quyền vĩnh viễn thành có hạn.
 *
 * Đây chính là bản sửa của F01: trước kia mỗi lần resume lại gọi
 * grantFeature(daysLeft) và cộng thêm thời gian.
 *
 * @param {object} env
 * @param {object} opts
 * @param {string} opts.userId
 * @param {string} opts.feature
 * @param {number} opts.expiresAt  mốc hết hạn TUYỆT ĐỐI (unix giây)
 * @param {string} [opts.trialToken] khoá idempotent của lượt thử
 * @param {string} [opts.note]
 * @param {number} [opts.now]
 */
export async function applyTrialEntitlement(env, {
  userId, feature, expiresAt, trialToken = null, note = 'Dùng thử', now,
}) {
  if (!userId || !ALL_FEATURES.includes(feature)) {
    throw new Error(`applyTrialEntitlement: tham số không hợp lệ (${feature})`);
  }
  const t = timeNow(now);
  const target = Math.floor(Number(expiresAt) || 0);
  if (target <= 0) throw new Error('applyTrialEntitlement: expiresAt phải > 0');

  const idem = `trial:${trialToken || target}`;

  const row = await env.DB.prepare(
    `INSERT INTO account_entitlements
       (user_id, feature, expires_at, source, order_id, note, created_at, updated_at)
     VALUES (?, ?, ?, 'trial', NULL, ?, ?, ?)
     ON CONFLICT(user_id, feature) DO UPDATE SET
       expires_at = CASE
                      -- Đang vĩnh viễn: tuyệt đối không hạ xuống có hạn
                      WHEN account_entitlements.expires_at = 0 THEN 0
                      -- Quyền đã mua/admin còn dài hơn: giữ nguyên
                      WHEN account_entitlements.source <> 'trial'
                           AND account_entitlements.expires_at >= ? THEN account_entitlements.expires_at
                      -- Còn lại: ĐẶT mốc tuyệt đối, không cộng
                      ELSE ?
                    END,
       source     = CASE
                      WHEN account_entitlements.expires_at = 0 THEN account_entitlements.source
                      WHEN account_entitlements.source <> 'trial'
                           AND account_entitlements.expires_at >= ? THEN account_entitlements.source
                      ELSE excluded.source
                    END,
       order_id   = CASE
                      WHEN account_entitlements.expires_at = 0 THEN account_entitlements.order_id
                      WHEN account_entitlements.source <> 'trial'
                           AND account_entitlements.expires_at >= ? THEN account_entitlements.order_id
                      ELSE NULL
                    END,
       note       = excluded.note,
       updated_at = excluded.updated_at
     RETURNING expires_at`
  ).bind(
    userId, feature, target, note, t, t,   // VALUES: 6 dấu ?
    target, target,                        // expires_at CASE: so sánh, đặt mốc
    target,                                // source CASE: ngưỡng so sánh
    target,                                // order_id CASE: ngưỡng so sánh
  ).first();

  const finalExp = row && row.expires_at !== null && row.expires_at !== undefined
    ? Number(row.expires_at) : target;

  // Sổ: MỘT dòng cho mỗi lượt thử (idempotent theo trialToken).
  await insertGrantRow(env, {
    grantId: newId(), userId, feature,
    sourceType: 'trial', sourceId: idem,
    days: Math.max(0, Math.round((finalExp - t) / DAY_SEC)),
    now: t, note,
    prevExpiresAt: 0, newExpiresAt: finalExp,
  });

  return { userId, feature, expiresAt: finalExp, source: 'trial' };
}

/* ================================================================== */
/* THU HỒI                                                             */
/* ================================================================== */

/** Thu hồi quyền (admin). Xoá dòng quyền và đóng mọi grant còn mở. */
export async function revokeFeature(env, userId, feature, {
  reason = 'admin', actor = null, now,
} = {}) {
  const t = timeNow(now);
  await env.DB.prepare(
    'DELETE FROM account_entitlements WHERE user_id = ? AND feature = ?'
  ).bind(userId, feature).run();
  try {
    await env.DB.prepare(
      `UPDATE entitlement_grants
          SET revoked_at = ?, revoke_reason = ?
        WHERE user_id = ? AND feature = ? AND revoked_at IS NULL`
    ).bind(t, String(reason || 'admin').slice(0, 200), userId, feature).run();
  } catch { /* chưa migrate sổ */ }
  if (actor) {
    try {
      await env.DB.prepare(
        'INSERT INTO audit_logs (id, actor_id, action, target, meta, ip, created_at) VALUES (?,?,?,?,?,?,?)'
      ).bind(newId(), actor, 'account.revoke_feature', `${userId}:${feature}`,
        JSON.stringify({ reason }), null, t).run();
    } catch { /* bảng audit có thể chưa có */ }
  }
}

/**
 * Thu hồi ĐÚNG PHẦN quyền mà MỘT ĐƠN đã cấp (F02).
 *
 * VÌ SAO KHÔNG ĐƠN GIẢN LÀ XOÁ DÒNG: khách có thể đã mua A (30 ngày) rồi mua
 * B (30 ngày). Hoàn đơn A mà xoá cả dòng thì khách mất luôn 30 ngày của B —
 * sai theo hướng có lợi cho shop nhưng vẫn là sai, và khách sẽ khiếu nại.
 * Xoá không gì cả thì khách giữ miễn phí 30 ngày của A.
 *
 * Đúng: trừ đúng `days_added` của các grant thuộc đơn đó; nếu phần còn lại
 * không dương thì đặt về `now` (hết hạn ngay, dòng vẫn còn để đối soát).
 *
 * @returns {Promise<{revoked:number, features:string[]}>}
 */
export async function revokeOrderGrants(env, orderId, {
  reason = 'refund', now,
} = {}) {
  const t = timeNow(now);
  if (!orderId) return { revoked: 0, features: [] };

  let rows = [];
  try {
    const r = await env.DB.prepare(
      `SELECT grant_id, feature, days_added
         FROM entitlement_grants
        WHERE source_type = 'purchase' AND source_id = ? AND revoked_at IS NULL`
    ).bind(String(orderId)).all();
    rows = r.results || [];
  } catch {
    return { revoked: 0, features: [] };
  }
  if (!rows.length) return { revoked: 0, features: [] };

  /*
   * Gộp theo tính năng. `permanent` = có grant vĩnh viễn (days_added = 0) ->
   * phải thu hồi TOÀN BỘ tính năng đó, không thể trừ theo ngày.
   */
  const per = new Map();
  for (const r of rows) {
    const f = String(r.feature);
    const cur = per.get(f) || { days: 0, permanent: false };
    const d = Number(r.days_added || 0);
    if (d === 0) cur.permanent = true;
    else cur.days += d;
    per.set(f, cur);
  }

  const features = [];
  for (const [feature, info] of per) {
    try {
      /*
       * MỘT câu UPDATE nguyên tử, áp cho ĐÚNG tài khoản đã nhận grant của đơn
       * này (USER_ID lấy từ chính sổ, không từ tham số bên ngoài):
       *
       *   - grant vĩnh viễn của đơn này -> đặt hết hạn ngay tại `now`
       *   - quyền đang vĩnh viễn (0) và đơn này KHÔNG cấp vĩnh viễn -> giữ 0
       *   - trừ xong <= now            -> đặt = now (hết hạn ngay)
       *   - còn lại                    -> trừ đúng số ngày của đơn
       */
      const sub = info.days * DAY_SEC;
      await env.DB.prepare(
        `UPDATE account_entitlements
            SET expires_at = CASE
                  WHEN ? = 1 THEN ?
                  WHEN expires_at = 0 THEN 0
                  WHEN expires_at - ? <= ? THEN ?
                  ELSE expires_at - ?
                END,
                updated_at = ?
          WHERE feature = ?
            AND user_id IN (
                  SELECT user_id FROM entitlement_grants
                   WHERE source_type = 'purchase' AND source_id = ?
                )`
      ).bind(
        info.permanent ? 1 : 0, t,
        sub, t, t,
        sub,
        t, feature, String(orderId),
      ).run();
      features.push(feature);
    } catch { /* chưa migrate sổ */ }
  }

  try {
    await env.DB.prepare(
      `UPDATE entitlement_grants
          SET revoked_at = ?, revoke_reason = ?
        WHERE source_type = 'purchase' AND source_id = ? AND revoked_at IS NULL`
    ).bind(t, String(reason || 'refund').slice(0, 200), String(orderId)).run();
  } catch { /* chưa migrate sổ */ }

  return { revoked: rows.length, features };
}

/* ================================================================== */
/* ĐỌC / TRÌNH BÀY                                                     */
/* ================================================================== */

/**
 * Chuyển đổi `delivery_type` + `license_days` của sản phẩm sang danh sách
 * tính năng được cấp.
 *
 * Shop hiện chỉ bán 2 loại:
 *   - Gói "map sáng"   -> license_prefix AOE1, pid rỗng  -> feature nofog
 *   - Gói "tài nguyên" -> license_prefix XAGR, pid xagrant -> feature grant
 */
export function featuresOfProduct(product) {
  const pid = String(product?.pid || '').toLowerCase();
  const prefix = String(product?.license_prefix || '').toUpperCase();
  if (pid === 'xagrant' || prefix === 'XAGR') return [FEATURE_GRANT];
  return [FEATURE_NOFOG];
}

/**
 * Quyền của tài khoản dưới dạng client cần.
 *
 * Trả:
 *   {
 *     features: ['nofog', 'grant'],
 *     hasNofog: bool, hasGrant: bool,
 *     nofog: { active, expires_at, forever, source, daysLeft },
 *     grant: { ... },
 *     trial: { ... }   // trạng thái dùng thử
 *   }
 */
export async function shapeAccountEntitlements(env, userId, now) {
  const t = timeNow(now);
  const rows = await loadEntitlements(env, userId);

  const shape = (f) => {
    const r = rows.get(f);
    if (!r) return { active: false, expires_at: 0, forever: false, source: null, daysLeft: 0 };
    const exp = Number(r.expires_at || 0);
    const forever = exp === 0;
    const active = isActive(r, t);
    return {
      active,
      expires_at: exp,
      forever,
      source: r.source || null,
      daysLeft: forever ? 0 : (active ? Math.ceil((exp - t) / DAY_SEC) : 0),
    };
  };

  const nofog = shape(FEATURE_NOFOG);
  const grant = shape(FEATURE_GRANT);

  const features = [];
  if (nofog.active) features.push(FEATURE_NOFOG);
  if (grant.active) features.push(FEATURE_GRANT);

  // Trạng thái dùng thử (để web hiện "còn X ngày dùng thử")
  let trial = null;
  try {
    const tr = await env.DB.prepare(
      'SELECT state, started_at, expires_at, ended_at, end_reason FROM trial_accounts WHERE user_id = ?'
    ).bind(userId).first();
    if (tr) {
      const expired = !!tr.ended_at || Number(tr.expires_at || 0) <= t;
      trial = {
        state: expired ? 'ended' : 'active',
        started_at: Number(tr.started_at || 0),
        expires_at: Number(tr.expires_at || 0),
        left_sec: expired ? 0 : Math.max(0, Number(tr.expires_at) - t),
        end_reason: tr.end_reason || null,
      };
    } else {
      trial = { state: 'available', started_at: 0, expires_at: 0, left_sec: 0 };
    }
  } catch { /* chưa migrate */ }

  return {
    features,
    hasNofog: nofog.active,
    hasGrant: grant.active,
    nofog,
    grant,
    trial,
  };
}

/** Lịch sử cấp quyền của một tài khoản (cho admin/đối soát). */
export async function listGrants(env, userId, limit = 100) {
  try {
    const { results } = await env.DB.prepare(
      `SELECT grant_id, feature, source_type, source_id, days_added,
              prev_expires_at, new_expires_at, created_at, revoked_at, note
         FROM entitlement_grants
        WHERE user_id = ?
        ORDER BY created_at DESC
        LIMIT ?`
    ).bind(userId, Math.max(1, Math.min(500, Number(limit) || 100))).all();
    return results || [];
  } catch {
    return [];
  }
}
