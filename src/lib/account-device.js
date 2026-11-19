/**
 * account-device.js — "MỘT TÀI KHOẢN = MỘT MÁY TẠI MỘT THỜI ĐIỂM"
 *
 * ============================================================================
 * YÊU CẦU CỦA CHỦ SHOP (nguyên văn)
 *
 *   "trial cho free nhưng chỉ được 10 lần 1 máy ... nhưng mà mua rồi thì đổi
 *    máy nào cũng được nhưng mà kiểm soát là chỉ 1 nick 1 máy 1 thời điểm
 *    đăng nhập nhiều lần nhiều máy 1 nick để dùng thì không cho phép"
 *
 * Chia thành 3 luật, mỗi luật nằm ở một chỗ:
 *
 *   1. TRIAL  — khoá theo PHẦN CỨNG (hwid), 10 lượt / MÁY.
 *               -> trial_quota_hw (khoá `(hwid, kind:product)`) + judge() của
 *                  license-server/xa-grant-server. KHÔNG đổi trong file này.
 *   2. ĐÃ MUA — KHÔNG khoá theo máy nữa, đi theo TÀI KHOẢN.
 *               -> judge() trả `paid: true` và bỏ hẳn nhánh `hwid_mismatch`.
 *                  `licenses.hwid` chỉ còn là "máy dùng gần nhất" (hiển thị).
 *   3. 1 NICK = 1 MÁY TẠI MỘT THỜI ĐIỂM  <-- FILE NÀY
 *
 * ----------------------------------------------------------------------------
 * VÌ SAO PHẢI KIỂM Ở SERVER, VÀ KIỂM BẰNG CÁI GÌ
 *
 * Client EXE **không gửi cookie** khi gọi /api/check hay /api/xg/check (xem
 * tool/app/xa_arena_api.py:1102 — body chỉ có {key, hwid}). Vì vậy KHÔNG thể
 * dựa vào `mbk_session` để biết "ai đang gọi": phần lớn request licence không
 * có session nào.
 *
 * Nguồn sự thật dùng được là `license_issues` — bảng ghi việc BÁN key cho
 * user nào (`license_key`, `user_id`). Đây chính là "nick" mà chủ shop nói.
 *
 * ĐÃ CÂN NHẮC VÀ LOẠI `sessions`: bảng đó chỉ có
 * `(token_hash, user_id, created_at, expires_at, ip, ua)` — KHÔNG có cột máy
 * nào, và mỗi lần đăng nhập web là một dòng. Dùng nó làm "thiết bị đang hoạt
 * động" sẽ (a) phải thêm cột vẫn cần migrate y như bảng mới, và (b) khoá oan
 * khách mở web trên nhiều máy — việc hoàn toàn hợp pháp. Nên tách bằng bảng
 * riêng `account_devices`.
 *
 * ----------------------------------------------------------------------------
 * PHẠM VI (scope): THEO TÀI KHOẢN + SẢN PHẨM, KHÔNG PHẢI CHỈ TÀI KHOẢN
 *
 * Đây là quyết định kỹ thuật bắt buộc, có lý do đo được:
 *
 *   Máy tính TIÊU CHUẨN này tính HAI HWID KHÁC NHAU cho hai module:
 *     xa_nofog_pro.compute_hwid()   -> 775c3fd3…   (map sáng)
 *     xa_grant._guard_safe_hwid()   -> d512bc5a…   (tài nguyên)
 *
 *   Nếu gộp một ô "máy đang hoạt động" cho cả tài khoản thì khách sở hữu CẢ
 *   HAI sản phẩm trên CÙNG MỘT MÁY sẽ tự đá nhau: /api/check ghi HWID #1,
 *   rồi /api/xg/check thấy HWID #2 -> tưởng "máy khác" -> đá máy kia. Hai
 *   tool gọi luân phiên -> đá qua đá lại, cả hai cùng chết.
 *
 *   Vì vậy mỗi (user, sản phẩm) có đúng MỘT máy đang hoạt động. Hệ quả: một
 *   nick vẫn có thể chạy map sáng trên PC1 và tài nguyên trên PC2 cùng lúc.
 *   Muốn chặt hơn (đúng nghĩa "1 nick 1 máy") thì đổi DEVICE_SCOPE = 'user',
 *   KHÔNG cần migrate lại (cột `scope` đã có) — nhưng phải chấp nhận đá nhau
 *   ở trường hợp hai sản phẩm trên một máy, trừ khi client gửi thêm một mã
 *   máy chung cho cả hai module (việc đó phải sửa `tool/`).
 *
 * ----------------------------------------------------------------------------
 * CÁCH CHẶN
 *
 *   `check`    (đang dùng bình thường) : khác máy -> TỪ CHỐI `session_moved`.
 *   `activate` (cài lại / đổi máy)     : khác máy -> CHIẾM QUYỀN, máy cũ chết.
 *
 * Vì sao không cho `check` chiếm quyền: nếu cho, hai máy gọi luân phiên sẽ
 * đá qua đá lại mỗi 30 phút và CẢ HAI cùng dùng được — luật thành vô nghĩa.
 * Đổi máy là hành động CHỦ ĐỘNG (chạy lại bộ cài/bấm kích hoạt), nên
 * `activate` mới là chỗ đổi chủ.
 *
 * FAIL-OPEN khi thiếu bảng: nếu CSDL chưa chạy migration, mọi request vẫn
 * được cho qua (`enforced: false`) — thà chưa bật được luật mới còn hơn khoá
 * sạch khách đã trả tiền. Khi đó route ghi log để vận hành thấy.
 * ============================================================================
 */

/** Mã lỗi trả cho máy bị đá. Client hiện "Tài khoản đang dùng ở máy khác". */
export const SESSION_MOVED = 'session_moved';

/** Câu hiển thị cho khách. */
export const MESSAGE_SESSION_MOVED =
  'Tài khoản đang được dùng ở máy khác. Máy này đã bị ngắt — '
  + 'bấm Kích hoạt lại trên máy bạn muốn dùng.';

/**
 * Phạm vi khoá thiết bị.
 *   'product' (mặc định) — mỗi (tài khoản, sản phẩm) một máy. Xem đầu file.
 *   'user'               — mỗi tài khoản một máy, bất kể sản phẩm.
 */
export const DEVICE_SCOPE = 'product';

/** Chuẩn hoá HWID để so sánh (client gửi chữ HOA/thường lẫn lộn). */
export function normHwid(v) {
  return String(v == null ? '' : v).trim().toLowerCase();
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

/**
 * Khoá phạm vi của một sản phẩm.
 * @param {string} product 'nofog' | 'xagrant'
 */
export function deviceScope(product) {
  if (DEVICE_SCOPE === 'user') return 'all';
  return String(product || '').trim().toLowerCase() === 'xagrant'
    ? 'xagrant'
    : 'nofog';
}

/**
 * Tài khoản sở hữu một license key, đọc từ `license_issues`.
 *
 * Trả null khi: key không có trong `license_issues` (key do admin tạo tay,
 * key dùng thử), hoặc CSDL cũ chưa có bảng. Null = KHÔNG áp luật 1 nick 1 máy
 * (không có "nick" nào để áp).
 */
export async function ownerUserId(env, key) {
  const k = String(key || '').trim().toUpperCase();
  if (!k) return null;
  try {
    const row = await env.DB.prepare(
      `SELECT user_id FROM license_issues
        WHERE license_key = ? ORDER BY created_at DESC LIMIT 1`
    ).bind(k).first();
    const uid = row && row.user_id ? String(row.user_id).trim() : '';
    return uid || null;
  } catch {
    return null;
  }
}

async function readDevice(env, userId, scope) {
  return await env.DB.prepare(
    `SELECT user_id, scope, active_hwid, active_since, last_seen
       FROM account_devices WHERE user_id = ? AND scope = ? LIMIT 1`
  ).bind(userId, scope).first();
}

/**
 * Kiểm + cập nhật "máy đang hoạt động" của một tài khoản.
 *
 * @param {object}  env
 * @param {object}  opts
 * @param {string}  opts.userId  chủ key (từ ownerUserId) — null = bỏ qua
 * @param {string}  opts.scope   từ deviceScope()
 * @param {string}  opts.hwid    HWID máy đang gọi
 * @param {string}  [opts.key]   license key, để tra log
 * @param {string}  [opts.ip]
 * @param {'check'|'activate'} [opts.mode='check']
 * @param {number}  [opts.now]
 *
 * @returns {Promise<{ok:boolean, enforced:boolean, moved?:boolean,
 *                    code?:string, msg?:string, active_since?:number,
 *                    reason?:string}>}
 */
export async function guardAccountDevice(env, {
  userId, scope, hwid, key, ip, mode = 'check', now,
} = {}) {
  const t = Number.isFinite(Number(now)) ? Number(now) : nowSec();
  const uid = String(userId || '').trim();
  const h = normHwid(hwid);
  const sc = scope || deviceScope('nofog');

  // Không biết chủ key hoặc máy không khai HWID -> không có gì để áp.
  if (!uid || !h) return { ok: true, enforced: false, reason: 'anonymous' };

  /*
   * CÔNG TẮC TẮT SẴN CHO VẬN HÀNH: đặt biến môi trường (wrangler var/secret)
   * ACCOUNT_DEVICE_DISABLED = '1' là luật 1-nick-1-máy tắt NGAY, không cần
   * deploy lại code. Mặc định (không đặt) = BẬT.
   *
   * Vì sao cần: nếu luật mới gây sự cố diện rộng (ví dụ khách đổi máy hàng
   * loạt trong một buổi khuyến mãi), chủ shop cần một đường lùi tức thời mà
   * vẫn giữ nguyên phần "bản trả phí không khoá máy".
   */
  if (String((env && env.ACCOUNT_DEVICE_DISABLED) || '') === '1') {
    return { ok: true, enforced: false, reason: 'disabled' };
  }

  let row;
  try {
    row = await readDevice(env, uid, sc);
  } catch {
    // Chưa migrate -> fail-open (xem đầu file).
    return { ok: true, enforced: false, reason: 'table_missing' };
  }

  if (!row) {
    try {
      await env.DB.prepare(
        `INSERT INTO account_devices
           (user_id, scope, active_hwid, active_since, last_seen, last_key, last_ip, moves)
         VALUES (?,?,?,?,?,?,?,0)
         ON CONFLICT(user_id, scope) DO NOTHING`
      ).bind(uid, sc, h, t, t, key || null, ip || null).run();
      row = await readDevice(env, uid, sc);
    } catch {
      return { ok: true, enforced: false, reason: 'table_missing' };
    }
    // Hai máy cùng tạo dòng đầu tiên: đứa thua ON CONFLICT sẽ đọc được dòng
    // của đứa kia và đi tiếp vào nhánh "khác máy" bên dưới.
    if (!row) return { ok: true, enforced: false, reason: 'unavailable' };
  }

  if (normHwid(row.active_hwid) === h) {
    try {
      await env.DB.prepare(
        `UPDATE account_devices
            SET last_seen = ?, last_key = ?, last_ip = ?
          WHERE user_id = ? AND scope = ?`
      ).bind(t, key || null, ip || null, uid, sc).run();
    } catch { /* cập nhật nhịp tim lỗi không được chặn khách */ }
    return { ok: true, enforced: true, current: true };
  }

  // ---- KHÁC MÁY ----
  /*
   * ---------------------------------------------------------------------
   * KHI NÀO MÁY MỚI ĐƯỢC CHIẾM QUYỀN?
   *
   * 1. `activate`  -> LUÔN được. Đây là đường đăng nhập / kích hoạt chủ động,
   *    khách bấm nên biết mình đang đổi máy.
   * 2. `check`     -> CHỈ được khi máy cũ đã IM quá GRACE_SEC (mặc định 5
   *    phút). Lý do: app đã có key sẵn nên khi mở trên máy mới nó gọi
   *    `check`, không gọi `activate`. Nếu `check` không bao giờ chiếm được
   *    thì khách ĐỔI MÁY KHÔNG BAO GIỜ DÙNG ĐƯỢC (đo thật: máy B bị
   *    `session_moved` vĩnh viễn) — trái yêu cầu "đổi máy nào cũng được".
   *
   *    Nhưng nếu máy cũ VẪN ĐANG CHẠY (gửi nhịp tim đều) thì KHÔNG cho
   *    cướp — đúng yêu cầu "không cho 1 nick dùng nhiều máy cùng lúc".
   *
   * Một câu UPDATE duy nhất, không đọc-rồi-ghi -> không có khe TOCTOU.
   * ---------------------------------------------------------------------
   */
  const GRACE_SEC = 300;
  const staleFor = t - Number(row.last_seen || 0);
  /*
   * 'login' = khách VỪA ĐĂNG NHẬP trên máy này (có phiên hợp lệ) -> được
   * chiếm máy ngay. Đây là hành vi CÓ Ý THỨC: khách mở app, đăng nhập,
   * nghĩa là họ muốn dùng ở máy này. Không bắt họ chờ 5 phút.
   *
   * 'check' = app đã có key sẵn, tự hỏi lại định kỳ -> KHÔNG được cướp
   * của máy đang chạy, nếu không hai máy sẽ giành nhau liên tục.
   */
  const mayTakeOver = (mode === 'activate' || mode === 'login')
    || (staleFor >= GRACE_SEC && Number(row.last_seen || 0) > 0);

  if (mayTakeOver) {
    try {
      await env.DB.prepare(
        `UPDATE account_devices
            SET active_hwid = ?, active_since = ?, last_seen = ?,
                last_key = ?, last_ip = ?, moves = COALESCE(moves, 0) + 1
          WHERE user_id = ? AND scope = ?`
      ).bind(h, t, t, key || null, ip || null, uid, sc).run();
    } catch {
      return { ok: true, enforced: false, reason: 'table_missing' };
    }
    return {
      ok: true,
      enforced: true,
      moved: true,
      previous_hwid: row.active_hwid || null,
      previous_since: Number(row.active_since || 0),
      active_since: t,
    };
  }

  return {
    ok: false,
    enforced: true,
    code: SESSION_MOVED,
    msg: MESSAGE_SESSION_MOVED,
    active_since: Number(row.active_since || 0),
  };
}

/**
 * Ghi nhận "máy dùng gần nhất" cho license ĐÃ TRẢ TIỀN — KHÔNG chặn gì.
 *
 * `licenses.hwid` đổi nghĩa: trước đây là "máy ĐƯỢC PHÉP dùng" (bind), nay là
 * "máy dùng GẦN NHẤT" (hiển thị + chẩn đoán). Chỉ ghi, không so sánh.
 *
 * Lần kích hoạt ĐẦU TIÊN (activated_at IS NULL) vẫn phải tính kỳ hạn, giống
 * hệt nhánh "kích hoạt lần đầu" cũ trong bindFirstTime — nếu không, key mua
 * về sẽ có expires_at là hạn giữ chỗ/0 và khách mất hạn thật.
 *
 * @returns {Promise<{first:boolean, days?:number, forever?:boolean,
 *                    source?:string}>}
 */
export async function touchPaidLicence(env, lic, {
  key, hwid, ip, now, prefix,
} = {}) {
  const t = Number.isFinite(Number(now)) ? Number(now) : nowSec();

  if (lic && lic.activated_at) {
    await env.DB.prepare(
      `UPDATE licenses SET hwid = ?, last_seen = ?, last_ip = ? WHERE key = ?`
    ).bind(hwid, t, ip || null, key).run();
    lic.hwid = hwid;
    lic.last_seen = t;
    lic.last_ip = ip || null;
    return { first: false };
  }

  const { resolveTermDays } = await import('./trial-quota.js');
  const term = await resolveTermDays(env, {
    createdAt: lic ? lic.created_at : 0,
    expiresAt: lic ? lic.expires_at : 0,
    prefix,
    key,
    now: t,
  });
  const days = term.forever ? 0 : term.days;
  const exp = term.forever ? 0 : t + days * 86400;

  await env.DB.prepare(
    `UPDATE licenses SET hwid = ?, activated_at = ?, expires_at = ?,
            last_seen = ?, last_ip = ? WHERE key = ?`
  ).bind(hwid, t, exp, t, ip || null, key).run();

  if (lic) {
    lic.hwid = hwid;
    lic.activated_at = t;
    lic.expires_at = exp;
    lic.last_seen = t;
    lic.last_ip = ip || null;
  }
  return { first: true, days, forever: !!term.forever, source: String(term.source || '') };
}
