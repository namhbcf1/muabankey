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
 *   - Khách KHÔNG có key. Không nhập, không giữ, không gõ sai.
 *   - Mua trên web -> cộng thẳng hạn vào dòng của tài khoản.
 *   - Dùng thử 1 ngày -> cũng ghi vào đây với source='trial'.
 *   - App chỉ cần đăng nhập, tự hỏi server quyền của mình.
 *
 * `licenses` VẪN tồn tại nhưng chỉ là VẬT MANG TOKEN nội bộ (token phải ký
 * trên một "key" vì định dạng token đã cố định). Khách không bao giờ thấy
 * giá trị đó, và nó được sinh/xoay tự động.
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

/** Đọc toàn bộ quyền của một tài khoản. Trả Map<feature, row>. */
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

/**
 * Cấp/gia hạn một tính năng cho tài khoản.
 *
 * `days = 0` -> vĩnh viễn.
 * Gia hạn CỘNG DỒN: nếu còn hạn thì cộng thêm, nếu đã hết thì tính từ bây giờ.
 * Đây là hành vi khách mong đợi khi mua thêm gói.
 */
export async function grantFeature(env, {
  userId, feature, days, source = 'purchase', orderId = null, note = '',
}) {
  if (!userId || !ALL_FEATURES.includes(feature)) {
    throw new Error(`grantFeature: tham số không hợp lệ (${feature})`);
  }
  const now = Math.floor(Date.now() / 1000);
  const d = Number(days) || 0;

  const cur = await env.DB.prepare(
    'SELECT expires_at FROM account_entitlements WHERE user_id = ? AND feature = ?'
  ).bind(userId, feature).first();

  let expiresAt;
  if (d === 0) {
    // Vĩnh viễn: nếu đã vĩnh viễn thì giữ 0; nếu đang có hạn thì nâng lên 0.
    expiresAt = 0;
  } else {
    const curExp = Number(cur?.expires_at ?? 0);
    if (cur && curExp === 0) {
      // Đang vĩnh viễn -> mua thêm hạn không làm giảm quyền
      expiresAt = 0;
    } else {
      // Cộng dồn từ hạn cũ nếu còn, ngược lại tính từ bây giờ
      const base = curExp > now ? curExp : now;
      expiresAt = base + d * 86400;
    }
  }

  await env.DB.prepare(
    `INSERT INTO account_entitlements
       (user_id, feature, expires_at, source, order_id, note, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?)
     ON CONFLICT(user_id, feature) DO UPDATE SET
       expires_at = excluded.expires_at,
       source     = excluded.source,
       order_id   = COALESCE(excluded.order_id, account_entitlements.order_id),
       note       = excluded.note,
       updated_at = excluded.updated_at`
  ).bind(userId, feature, expiresAt, source, orderId, note, now, now).run();

  return { userId, feature, expiresAt, source };
}

/** Thu hồi quyền (admin). */
export async function revokeFeature(env, userId, feature) {
  await env.DB.prepare(
    'DELETE FROM account_entitlements WHERE user_id = ? AND feature = ?'
  ).bind(userId, feature).run();
}

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
  const rows = await loadEntitlements(env, userId);

  const shape = (f) => {
    const r = rows.get(f);
    if (!r) return { active: false, expires_at: 0, forever: false, source: null, daysLeft: 0 };
    const exp = Number(r.expires_at || 0);
    const forever = exp === 0;
    const active = isActive(r, now);
    return {
      active,
      expires_at: exp,
      forever,
      source: r.source || null,
      daysLeft: forever ? 0 : (active ? Math.ceil((exp - now) / 86400) : 0),
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
      const expired = !!tr.ended_at || Number(tr.expires_at || 0) <= now;
      trial = {
        state: expired ? 'ended' : 'active',
        started_at: Number(tr.started_at || 0),
        expires_at: Number(tr.expires_at || 0),
        left_sec: expired ? 0 : Math.max(0, Number(tr.expires_at) - now),
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
