/**
 * Cầu nối bán license XArena.
 *
 * Shop ghi trực tiếp vào bảng `licenses` trong muabankey-db — cùng CSDL mà
 * API /api/activate và /api/check đọc, nên key bán ra có hiệu lực ngay.
 *
 * Quy ước:
 *   - Khoá: `<PREFIX>-XXXX-XXXX-XXXX`, bảng chữ '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
 *   - expires_at: unix GIÂY, 0 = vĩnh viễn
 */
import { ApiError } from '../lib/http.js';
import { uuid } from '../lib/crypto.js';

const KEY_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const MAX_TERM_DAYS = 3650;

function pick(n) {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  let s = '';
  for (let i = 0; i < n; i++) s += KEY_ALPHABET[b[i] % KEY_ALPHABET.length];
  return s;
}

export function newLicenseKey(prefix = 'AOE1') {
  const p = String(prefix || 'AOE1').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'AOE1';
  return `${p}-${pick(4)}-${pick(4)}-${pick(4)}`;
}

export function normKey(k) {
  return String(k || '').trim().toUpperCase().replace(/\s+/g, '');
}

export function nowSec() {
  return Math.floor(Date.now() / 1000);
}

/**
 * Cấp `count` license vào DB.
 * @returns {Promise<string[]>} danh sách key đã tạo
 */
export const MAX_LICENSE_BATCH = 100;

/**
 * Tiền tố key -> định danh sản phẩm (`licenses.pid`).
 *
 * Bắt buộc phải có: XAGrant từ chối mọi key không phải của nó, nên key bán ra
 * từ shop phải mang đúng pid ngay lúc sinh. No Fog giữ pid NULL để tương thích
 * dữ liệu cũ (client No Fog không đọc cột này).
 */
export const PREFIX_PID = { XAGR: 'xagrant' };

export function pidForPrefix(prefix) {
  return PREFIX_PID[String(prefix || '').toUpperCase()] || null;
}

export async function issueLicenses(env, {
  count = 1,
  prefix = 'AOE1',
  days = 30,
  plan = 'aoe1',
  note = '',
  maxRebind = 1,
  pid = null,
  graceH = null,
  // 1 = khoá theo MÁY (key không có chủ tài khoản), 0/NULL = theo tài khoản.
  bindHwid = null,
} = {}) {
  const requested = Number(count) || 1;
  // Không âm thầm cắt số lượng — khách trả tiền cho N thì phải nhận đủ N.
  if (requested > MAX_LICENSE_BATCH) {
    throw new ApiError(400,
      `Tối đa ${MAX_LICENSE_BATCH} license mỗi lần (yêu cầu ${requested})`, 'TOO_MANY');
  }
  const n = Math.max(1, Math.trunc(requested));
  /*
   * LỖI ĐÃ SỬA: `Number(days) || 0` — nếu `days` không phải số thì
   * `Number(days)` = NaN, và `NaN || 0` = 0. Mà `term === 0` nghĩa là
   * VĨNH VIỄN. Nên chỉ cần truyền days='30 ngày' là mọi license sinh ra
   * thành vĩnh viễn miễn phí.
   *
   * Nay: không phải số -> BÁO LỖI, không đoán bừa thành vĩnh viễn.
   * Chỉ khi `days` đúng bằng 0 (hoặc bỏ trống) mới là vĩnh viễn.
   */
  let term;
  if (days === null || days === undefined || days === '') {
    term = 0;                                   // bỏ trống = vĩnh viễn
  } else {
    const nd = Number(days);
    if (!Number.isFinite(nd)) {
      throw new ApiError(400,
        'Số ngày không hợp lệ: ' + String(days).slice(0, 40), 'BAD_TERM');
    }
    term = Math.max(0, Math.min(MAX_TERM_DAYS, Math.trunc(nd)));
  }
  const forever = term === 0;
  const now = nowSec();
  // Cộng 1 ngày bonus để hạn không bị hụt so với nhãn gói
  const exp = forever ? 0 : now + (term + 1) * 86400;
  const owner = pid || pidForPrefix(prefix);
  const grace = graceH === null ? (owner === 'xagrant' ? 6 : 0) : Number(graceH) || 0;
  const made = [];

  for (let i = 0; i < n; i++) {
    let key = newLicenseKey(prefix);
    for (let t = 0; t < 5; t++) {
      const dup = await env.DB.prepare('SELECT 1 AS x FROM licenses WHERE key = ?')
        .bind(key).first();
      if (!dup) break;
      key = newLicenseKey(prefix);
    }
    await env.DB.prepare(
      `INSERT INTO licenses (key, plan, note, created_at, expires_at, max_rebind, pid, grace_h, app, bind_hwid)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(key, String(plan).slice(0, 32), String(note).slice(0, 200),
      now, exp, Number(maxRebind) || 1, owner, grace, owner || '',
      bindHwid === 1 ? 1 : (bindHwid === 0 ? 0 : null)).run();
    made.push(key);
  }
  return made;
}

/** Đọc trạng thái license. */
export async function readLicense(env, key) {
  return await env.DB.prepare('SELECT * FROM licenses WHERE key = ?')
    .bind(normKey(key)).first();
}

/** Thu hồi / mở thu hồi. */
export async function setRevoked(env, key, revoked) {
  await env.DB.prepare('UPDATE licenses SET revoked = ? WHERE key = ?')
    .bind(revoked ? 1 : 0, normKey(key)).run();
}

/** Reset máy: xoá HWID + mốc kích hoạt để key bind lại từ đầu. */
export /**
 * Admin reset HWID để khách đổi máy.
 *
 * QUAN TRỌNG: đánh dấu reset_pending = 1.
 * Trước đây xoá activated_at -> hệ thống tưởng key chưa từng bind -> bind
 * bất kỳ ai (máy cũ chạy nền thắng máy mới), và còn tặng thêm hạn dùng.
 * Nay reset_pending=1 buộc phải có rebind token mới bind được.
 *
 * activated_at GIỮ NGUYÊN để không tính lại hạn.
 */
async function resetHwid(env, key) {
  const k = normKey(key);
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `UPDATE licenses SET hwid = NULL, reset_pending = 1, reset_at = ?, rebinds = 0
     WHERE key = ?`
  ).bind(now, k).run();
}

/** Gia hạn thêm số ngày (bỏ qua key vĩnh viễn). */
export async function extendLicense(env, key, days) {
  const lic = await readLicense(env, key);
  if (!lic) throw new ApiError(404, 'License không tồn tại', 'NOT_FOUND');
  if (!lic.expires_at) return { note: 'vinh vien' };
  // Khong phai so -> BAO LOI thay vi am tham cong 30 ngay.
  const _nd = Number(days);
  if (!Number.isFinite(_nd)) {
    throw new ApiError(400, 'So ngay khong hop le', 'BAD_TERM');
  }
  const d = Math.max(1, Math.min(MAX_TERM_DAYS, Math.trunc(_nd)));
  const base = Math.max(nowSec(), lic.expires_at || 0);
  await env.DB.prepare('UPDATE licenses SET expires_at = ? WHERE key = ?')
    .bind(base + d * 86400, normKey(key)).run();
  return { expiresAt: base + d * 86400 };
}

/** Ghi nhật ký phát hành vào DB của shop. */
export async function recordIssue(env, { orderId, userId, productId, keys, termDays, expiresAt }) {
  const now = Date.now();
  const stmts = keys.map((k) => env.DB.prepare(
    `INSERT INTO license_issues (id, order_id, user_id, product_id, license_key, term_days, expires_at, created_at)
     VALUES (?,?,?,?,?,?,?,?)`
  ).bind(uuid(), orderId, userId, productId, k, termDays, expiresAt, now));
  for (let i = 0; i < stmts.length; i += 25) {
    await env.DB.batch(stmts.slice(i, i + 25));
  }
}

/**
 * Giao license cho một dòng đơn hàng.
 * Trả về mảng key để hiển thị cho khách.
 */
export async function deliverLicenseLine(env, { order, orderId, userId, product, quantity }) {
  const prefix = product.license_prefix || 'AOE1';
  // QUAN TRỌNG: license_days = 0 nghĩa là VĨNH VIỄN.
  // Trước đây dùng `|| 30` nên 0 bị đổi thành 30 -> khách mua gói Vĩnh Viễn
  // (1.290.000đ) chỉ nhận license 31 ngày.
  //
  // LỖI THỨ HAI (đã sửa): `Math.max(0, Number(rawDays) || 0)`.
  // `Number('30 ngày')` = NaN -> `NaN || 0` = 0 -> CẤP LICENSE VĨNH VIỄN.
  // Chỉ cần cột license_days bị nhập thành chữ là mọi đơn của sản phẩm đó
  // thành vĩnh viễn miễn phí. Nay: không phải số -> BÁO LỖI, không đoán bừa.
  const rawDays = product.license_days;
  let days;
  if (rawDays === null || rawDays === undefined) {
    days = 30;
  } else {
    const nd = Number(rawDays);
    if (!Number.isFinite(nd)) {
      throw new ApiError(500,
        'Cấu hình sản phẩm sai: license_days không phải số',
        'BAD_PRODUCT_CONFIG');
    }
    days = Math.max(0, Math.floor(nd));     // 0 = vĩnh viễn
  }

  const keys = await issueLicenses(env, {
    count: quantity,
    prefix,
    days,
    plan: prefix.toLowerCase(),
    note: `Don ${order.code} - ${product.name}`.slice(0, 200),
    maxRebind: 1,
    pid: pidForPrefix(prefix),
  });
  await recordIssue(env, {
    orderId,
    userId,
    productId: product.id,
    keys,
    termDays: days,
    expiresAt: days === 0 ? 0 : nowSec() + (days + 1) * 86400,
  });
  return keys;
}

/** Thống kê license cho dashboard admin. */
export async function licenseStats(env) {
  const now = nowSec();
  const one = async (sql, ...a) =>
    (await env.DB.prepare(sql).bind(...a).first())?.n || 0;
  return {
    total: await one('SELECT COUNT(*) n FROM licenses'),
    active: await one(
      'SELECT COUNT(*) n FROM licenses WHERE revoked=0 AND (expires_at=0 OR expires_at>?) AND hwid IS NOT NULL',
      now),
    unbound: await one('SELECT COUNT(*) n FROM licenses WHERE revoked=0 AND hwid IS NULL'),
    revoked: await one('SELECT COUNT(*) n FROM licenses WHERE revoked=1'),
    forever: await one('SELECT COUNT(*) n FROM licenses WHERE expires_at=0'),
    expiring7d: await one(
      'SELECT COUNT(*) n FROM licenses WHERE revoked=0 AND expires_at>0 AND expires_at BETWEEN ? AND ?',
      now, now + 7 * 86400),
  };
}

export function shapeLicense(lic) {
  if (!lic) return null;
  const now = nowSec();
  let status = 'active';
  if (lic.revoked) status = 'revoked';
  else if (lic.expires_at > 0 && lic.expires_at < now) status = 'expired';
  else if (!lic.hwid) status = 'unbound';
  else if (lic.expires_at === 0) status = 'forever';
  else if (lic.expires_at - now < 7 * 86400) status = 'expiring';
  return {
    key: lic.key,
    plan: lic.plan,
    note: lic.note,
    status,
    // Tool sở hữu key: 'xagrant' | 'nofog'. UI dùng để chọn đúng endpoint
    // cài đặt và đúng câu lệnh đổi máy.
    tool: lic.pid || (String(lic.key || '').startsWith('XAGR-') ? 'xagrant' : 'nofog'),
    bound: !!lic.hwid,
    // resetPending: admin vừa reset, đang chờ khách đổi máy bằng token.
    // Admin UI dùng cờ này để hiện badge "Đang chờ đổi máy".
    resetPending: !!lic.reset_pending,
    resetAt: lic.reset_at || null,
    hwidMasked: lic.hwid ? lic.hwid.slice(0, 10) + '…' : null,
    forever: lic.expires_at === 0,
    createdAt: lic.created_at,
    activatedAt: lic.activated_at,
    expiresAt: lic.expires_at,
    lastSeen: lic.last_seen,
    rebinds: lic.rebinds || 0,
    maxRebind: lic.max_rebind || 0,
  };
}

/* ==================== Khách hàng tự quản lý license ==================== */

/** Danh sách license khách đã mua kèm trạng thái sống. */
export async function myLicenses(env, request) {
  const { entitlementFieldsFor } = await import('./entitlement.js');
  const nowSec = Math.floor(Date.now() / 1000);
  const { requireUser } = await import('../lib/auth.js');
  const { ok } = await import('../lib/http.js');
  const user = await requireUser(env, request);

  const { results } = await env.DB.prepare(
    `SELECT li.license_key, li.product_id, li.term_days, li.created_at, li.order_id,
            p.name AS product_name, o.code AS order_code,
            l.key AS l_key, l.plan AS l_plan, l.note AS l_note, l.hwid AS l_hwid,
            l.revoked AS l_revoked,
            l.expires_at AS l_expires_at, l.activated_at AS l_activated_at,
            l.last_seen AS l_last_seen, l.rebinds AS l_rebinds, l.max_rebind AS l_max_rebind,
            l.pid AS l_pid
     FROM license_issues li
     LEFT JOIN products p ON p.id = li.product_id
     LEFT JOIN orders o ON o.id = li.order_id
     LEFT JOIN licenses l ON l.key = li.license_key
     WHERE li.user_id = ? ORDER BY li.created_at DESC LIMIT 200`
  ).bind(user.id).all();

  /*
   * ===== AUDIT #8: HẠN HIỂN THỊ CỦA MÃ DÙNG THỬ PHẢI LÀ ĐỒNG HỒ THẬT =====
   *
   * Với `plan='trial'`, `licenses.expires_at` là HẠN GIỮ MÃ (hold, mặc định
   * 7 ngày) chứ không phải thời lượng dùng thử. Đồng hồ thật nằm ở
   * `trial_uses.expires_at` và chỉ có sau khi khách chạy tool lần đầu.
   *
   * Trước đây trang "License của tôi" đọc thẳng `licenses.expires_at` nên gói
   * dùng thử 1 GIỜ hiện "còn ~7 ngày" — khách tưởng còn 7 ngày, hết 1 giờ thì
   * khiếu nại. entitlement.js đã sửa đúng; nay áp cùng cách ở đây.
   *
   * MỘT câu SQL cho tất cả key trial (không N+1), xem trialClockMap().
   */
  const { trialClockMap } = await import('../lib/trial-quota.js');
  const trialKeys = (results || [])
    .filter((r) => String(r.l_plan || '').toLowerCase() === 'trial' && r.l_key)
    .map((r) => r.l_key);
  const trialClocks = trialKeys.length ? await trialClockMap(env, trialKeys) : new Map();

  const list = (results || []).map((row) => {
    // JOIN sẵn bảng licenses -> 1 query duy nhất, không N+1
    const lic = row.l_key ? {
      key: row.l_key,
      plan: row.l_plan,
      note: row.l_note,
      hwid: row.l_hwid,
      revoked: row.l_revoked,
      expires_at: row.l_expires_at,
      activated_at: row.l_activated_at,
      last_seen: row.l_last_seen,
      rebinds: row.l_rebinds,
      max_rebind: row.l_max_rebind,
      pid: row.l_pid,
    } : null;
    /*
     * QUYỀN DÙNG CHỨC NĂNG — web và app dùng CHUNG một logic.
     *
     * Thêm từ khi gộp 2 tool thành 1 app: app cần biết license này cho
     * phép "bật map sáng" hay "cộng tài nguyên" để hiện/ẩn phần chức năng.
     * Nguồn sự thật duy nhất là src/routes/entitlement.js.
     */
    /*
     * Hạn dùng THẬT để hiển thị/tính quyền (audit #8). Với trial:
     *   - đã bắt đầu  -> dùng `trial_uses.expires_at`
     *   - chưa bắt đầu-> 0 + cờ trialPending (UI hiện "chờ kích hoạt"),
     *                    KHÔNG hiện hạn giữ 7 ngày như thời lượng dùng thử
     *   - dữ liệu v1 không có trial_uses -> giữ hạn cũ (không đoán bừa)
     */
    const isTrialRow = String(row.l_plan || '').toLowerCase() === 'trial';
    const clock = isTrialRow ? trialClocks.get(String(row.l_key || '')) : null;
    let effExpires = row.l_expires_at;
    let trialPending = false;
    let trialStarted = false;
    if (isTrialRow) {
      if (clock && clock.started) {
        effExpires = clock.expires_at || 0;
        trialStarted = true;
      } else if (clock) {
        effExpires = 0;
        trialPending = true;
      }
      // clock == null: dữ liệu cũ, giữ effExpires = licenses.expires_at
    }

    const ent = entitlementFieldsFor({
      key: row.l_key,
      pid: row.l_pid,
      plan: row.l_plan,
      expires_at: effExpires,
      revoked: row.l_revoked,
      hwid: row.l_hwid,
    }, nowSec);

    /*
     * shapeLicense() đọc hạn từ object `lic` -> truyền hạn ĐÃ HIỆU CHỈNH để
     * `status`/`forever`/`expiresAt` không nói sai về trial.
     */
    const shaped = shapeLicense(lic && { ...lic, expires_at: effExpires })
      || { key: row.license_key, status: 'unknown' };
    if (trialPending) {
      // Chưa kích hoạt: KHÔNG phải "vĩnh viễn", cũng chưa phải "còn hạn".
      shaped.status = 'trial_pending';
      shaped.forever = false;
      shaped.expiresAt = 0;
    }

    return {
      ...shaped,
      productName: row.product_name,
      orderCode: row.order_code,
      purchasedAt: row.created_at,
      features: ent.features,
      hasNofog: ent.hasNofog,
      hasGrant: ent.hasGrant,
      active: ent.active,
      forever: trialPending ? false : ent.forever,
      hwidBound: ent.hwidBound,
      // Trial: nói rõ đồng hồ đã chạy hay chưa (UI dùng để hiện "chờ kích hoạt")
      isTrial: isTrialRow,
      trialStarted,
      trialPending,
    };
  });
  return ok({ licenses: list, available: true });
}

/** Khách xin token đổi máy (dùng 1 lần, hết hạn sau 30 phút). */
export async function rebindMyLicense(env, request, key) {
  const { requireUser } = await import('../lib/auth.js');
  const { ok } = await import('../lib/http.js');
  const { rateLimit, clientIp } = await import('../lib/ratelimit.js');
  const user = await requireUser(env, request);

  const k = normKey(key);

  // ===== THỨ TỰ QUAN TRỌNG: kiểm quyền + quota TRƯỚC rate limit =====
  // Trước đây rateLimit(5/giờ) đứng trước -> khách bấm vài lần là bị 429
  // "thao tác quá nhanh" thay vì thấy lý do thật (hết lượt / không sở hữu).
  const owns = await env.DB.prepare(
    'SELECT 1 AS x FROM license_issues WHERE user_id = ? AND license_key = ? LIMIT 1'
  ).bind(user.id, k).first();
  if (!owns) throw new ApiError(403, 'Bạn không sở hữu license này', 'FORBIDDEN');

  const lic = await readLicense(env, k);
  if (!lic) throw new ApiError(404, 'License không tồn tại', 'NOT_FOUND');
  if (lic.revoked) throw new ApiError(403, 'License đã bị thu hồi', 'REVOKED');

  // Admin reset -> luôn cho lấy token (đó chính là mục đích reset)
  const isReset = !!lic.reset_pending;
  const maxRebind = lic.max_rebind || 0;
  const used = lic.rebinds || 0;

  if (!isReset && used >= maxRebind) {
    throw new ApiError(403,
      `Đã hết ${maxRebind} lượt đổi máy. Liên hệ hỗ trợ nếu cần đổi thêm.`,
      'REBIND_LIMIT');
  }

  // Rate limit đặt SAU khi đã chắc chắn được phép -> nới lên 20/giờ
  await rateLimit(env, `rebind:${user.id}:${clientIp(request)}`, 100, 3600);

  /*
   * MỞ CỬA SỔ ĐỔI MÁY — KHÔNG SINH MÃ HEX.
   *
   * LỖI ĐÃ SỬA: trước đây route này sinh một mã 48 ký tự hex (hạn 30 phút,
   * dùng 1 lần) rồi trả kèm dòng lệnh CMD:
   *     "C:\...\xa_nofog_pro.exe" --rebind "KEY" "<48 hex>"
   * Khách phải chép mã hex đó và mở CMD trên máy mới — trái với yêu cầu
   * "chỉ dùng key, không dùng CMD".
   *
   * Nay: chỉ đặt `rebind_until = now + 30 phút` trên license. Máy mới mở
   * tool, dán KEY, bấm Cài đặt là xong. Cửa sổ tự đóng sau 30 phút hoặc
   * ngay khi máy mới kích hoạt (xem bindFirstTime trong license-server.js
   * và xa-grant-server.js).
   *
   * Chỉ chủ tài khoản đã đăng nhập mới gọi được route này, nên bảo mật
   * tương đương mã dùng-1-lần cũ. Lượt đổi máy vẫn bị giới hạn bởi max_rebind.
   */
  const now = Math.floor(Date.now() / 1000);
  const until = now + 1800;
  await env.DB.prepare(
    'UPDATE licenses SET rebind_until = ? WHERE key = ?'
  ).bind(until, k).run();

  const tool = lic.pid === 'xagrant' || String(k).startsWith('XAGR-')
    ? 'xagrant' : 'nofog';

  return ok({
    key: k,
    tool,
    // Không còn `token` và `command`: khách chỉ cần KEY.
    expiresIn: 1800,
    expiresAt: until,
    rebindsLeft: (lic.max_rebind || 0) - (lic.rebinds || 0),
    setupUrl: '/download/xa_arena.exe',
    /* MỘT app duy nhất: dù license là map sáng hay tài nguyên, khách
     * cũng tải cùng một EXE. Quyền bật gì do license quyết định. */
    downloadUrl: '/download/xa_arena.exe',
  });
}

async function sha256hex(text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}

/* ==================== Admin quản trị license ==================== */

export async function adminLicenses(env, request) {
  const { requireAdmin } = await import('../lib/auth.js');
  const { ok } = await import('../lib/http.js');
  const { isStaffViewer, maskKey, maskHwid } = await import('../lib/pii.js');
  const admin = await requireAdmin(env, request);

  const url = new URL(request.url);
  const q = (url.searchParams.get('q') || '').trim();

  const { results } = q
    ? await env.DB.prepare(
        `SELECT * FROM licenses WHERE key LIKE ? OR note LIKE ? OR hwid LIKE ?
         ORDER BY created_at DESC LIMIT 300`
      ).bind(`%${q}%`, `%${q}%`, `%${q}%`).all()
    : await env.DB.prepare(
        'SELECT * FROM licenses ORDER BY created_at DESC LIMIT 300'
      ).all();

  /*
   * AUDIT #12: `staff` KHÔNG được đọc toàn bộ key + HWID của shop.
   *
   * Trước đây route này dùng requireAdmin (staff cũng qua) và trả nguyên bảng
   * `licenses`: một tài khoản hỗ trợ là có TRỌN KHO KEY — đủ để bán lại, hoặc
   * chiếm license của khách (mọi key đều kèm HWID để biết key nào đang sống).
   *
   * Nay: staff vẫn thấy đủ trường VẬN HÀNH (plan, status, hạn, số lượt đổi
   * máy, đã bind máy hay chưa, note, ngày tạo) nhưng key và HWID bị che. Việc
   * tra cứu `?q=` vẫn chạy trên dữ liệu thật nên staff vẫn tìm được khi khách
   * đọc key/hwid cho họ. Muốn xem đầy đủ phải là admin.
   */
  const staffView = isStaffViewer(admin);

  return ok({
    available: true,
    licenses: (results || []).map((r) => {
      const s = shapeLicense(r);
      if (!s) return s;
      if (staffView) {
        return { ...s, key: maskKey(s.key), hwidMasked: maskHwid(r.hwid), masked: true };
      }
      return s;
    }),
    stats: await licenseStats(env),
  });
}

export async function adminLicenseAction(env, request, key, action) {
  const { requireAdminStrict } = await import('../lib/auth.js');
  const { ok, ApiError: AE } = await import('../lib/http.js');
  /*
   * CHỈ admin thật: thu hồi / mở khoá / reset máy / reset lượt đổi máy /
   * gia hạn +30 ngày trên license của KHÁCH. `staff` làm được thì một tài
   * khoản nhân viên tự cấp cho mình license vĩnh viễn hoặc gia hạn vô hạn.
   * Trước đây route này dùng requireAdmin (staff cũng qua).
   */
  const admin = await requireAdminStrict(env, request);

  const k = normKey(key);
  const lic = await readLicense(env, k);
  if (!lic) throw new AE(404, 'License không tồn tại', 'NOT_FOUND');

  /*
   * AUDIT #9: KHÔNG gia hạn mã dùng thử.
   *
   * `extend` cộng 30 ngày vào `licenses.expires_at`. Với plan='trial' thì
   * trường đó là HẠN GIỮ MÃ (7 ngày), không phải thời lượng dùng thử — đồng hồ
   * thật nằm ở `trial_uses.expires_at`. Nên bấm "Gia hạn" trên mã trial:
   *   • KHÔNG kéo dài được lượt dùng thử (đồng hồ trial_uses không đổi), và
   *   • lại THỔI PHỒNG `entitlement`: license còn hạn 30 ngày -> khách thấy
   *     như vừa được gia hạn thật, vài giờ sau lại báo hết hạn -> khiếu nại.
   * Đây là thao tác vô nghĩa gây hiểu sai, nên chặn hẳn và nói rõ lý do.
   */
  if (action === 'extend' && String(lic.plan || '').toLowerCase() === 'trial') {
    throw new AE(400,
      'Đây là license dùng thử — không gia hạn được. Khách cần dùng tiếp thì mua gói chính thức.',
      'TRIAL_NOT_EXTENDABLE');
  }

  if (action === 'revoke') await setRevoked(env, k, true);
  else if (action === 'unrevoke') await setRevoked(env, k, false);
  else if (action === 'reset-hwid') await resetHwid(env, k);
  else if (action === 'reset-rebinds') {
    // Cấp lại lượt đổi máy mà KHÔNG cần reset HWID.
    // Dùng khi khách đã hết 1/1 lượt nhưng vẫn giữ máy hiện tại.
    await env.DB.prepare('UPDATE licenses SET rebinds = 0 WHERE key = ?').bind(k).run();
  } else if (action === 'extend') await extendLicense(env, k, 30);
  else throw new AE(400, 'Hành động không hợp lệ', 'VALIDATION');

  await env.DB.prepare(
    'INSERT INTO lic_events (key, hwid, kind, detail, ip, at) VALUES (?,?,?,?,?,?)'
  ).bind(k, lic.hwid || null, action, `by ${admin.email}`, '', nowSec()).run();

  return ok({ key: k, action, license: shapeLicense(await readLicense(env, k)) });
}

/** Admin tạo license thủ công. */
export async function adminIssueLicenses(env, request) {
  const { requireAdminStrict } = await import('../lib/auth.js');
  const { ok, readJson } = await import('../lib/http.js');
  const { str, int } = await import('../lib/validate.js');
  /*
   * CHỈ admin thật: route này ĐÚC license mới với số lượng (tới 100),
   * số ngày (tới 3650, hoặc 0 = vĩnh viễn) và gán luôn cho userId bất kỳ.
   * Đây là đường tạo hàng từ không khí — staff không được có quyền này.
   */
  const admin = await requireAdminStrict(env, request);
  const body = await readJson(request);

  const count = int(body.count ?? 1, 'count', { min: 1, max: 100 });
  const days = int(body.days ?? 30, 'days', { min: 0, max: 3650 });
  const prefix = str(body.prefix ?? 'AOE1', 'prefix', { min: 1, max: 8 });
  const note = str(body.note, 'note', { required: false, max: 200 }) || `Tạo bởi ${admin.email}`;

  // userId: gán key cho khách cụ thể (key tặng / bù lỗi).
  // Trước đây không ghi license_issues -> khách không thấy key trong
  // "License của tôi", không có nút Đổi máy, không lấy được lệnh cài.
  const userId = str(body.userId, 'userId', { required: false, max: 64 }) || null;
  const maxRebind = int(body.maxRebind ?? 1, 'maxRebind', { min: 0, max: 99 });

  // Sản phẩm để ghi license_issues. Mặc định đoán theo tiền tố khoá:
  // AOE1 -> gói tháng No Fog, XAGR -> gói tháng XAGrant. Trước đây LUÔN
  // ghi 'p-lic-month', nên key XAGrant tặng tay hiện trong "License của tôi"
  // với tên sản phẩm No Fog -> khách bấm nhầm bộ cài.
  // Admin có thể chỉ định rõ bằng body.productId.
  const PREFIX_PRODUCT = {
    AOE1: 'p-lic-month',
    XAGR: 'p-xg-month',
  };
  const requestedProduct = str(body.productId, 'productId', { required: false, max: 64 });
  let productId = requestedProduct || PREFIX_PRODUCT[prefix.toUpperCase()] || 'p-lic-month';
  {
    // Chỉ nhận productId tồn tại và đúng kiểu giao license.
    const p = await env.DB.prepare(
      "SELECT id FROM products WHERE id = ? AND delivery_type = 'license'"
    ).bind(productId).first();
    if (!p) productId = PREFIX_PRODUCT[prefix.toUpperCase()] || 'p-lic-month';
  }

  // ------------------------------------------------------------------
  // KEY KHÔNG CÓ CHỦ -> PHẢI KHOÁ MÁY.
  //
  // LỖ HỔNG ĐÃ SỬA: sau khi "đã mua thì theo tài khoản", key không có
  // license_issues (admin tạo tay / bán lẻ) không bị khoá bởi gì cả —
  // ai có key cũng dùng được và chia sẻ vô hạn.
  //
  // Nay: thiếu userId thì ghi bind_hwid=1 để khoá theo MÁY.
  // Có userId thì bind_hwid=0 (theo tài khoản, đổi máy được).
  // ------------------------------------------------------------------
  const bindHwid = userId ? 0 : 1;
  const keys = await issueLicenses(env, {
    count, prefix, days, plan: prefix.toLowerCase(), note, maxRebind,
    pid: pidForPrefix(prefix), bindHwid,
  });

  // Ghi license_issues để khách thấy trong trang cá nhân
  let assigned = 0;
  if (userId && keys.length) {
    const target = await env.DB.prepare('SELECT id FROM users WHERE id = ?')
      .bind(userId).first();
    if (!target) {
      return ok({ keys, count: keys.length, days, warning: 'userId không tồn tại' }, 207);
    }
    const now = Math.floor(Date.now() / 1000);
    const expAt = days === 0 ? 0 : now + (days + 1) * 86400;
    for (const k of keys) {
      try {
        await env.DB.prepare(
          `INSERT INTO license_issues
             (id, order_id, user_id, product_id, license_key, term_days, expires_at, created_at)
           VALUES (?,?,?,?,?,?,?,?)`
        ).bind(crypto.randomUUID(), 'ADMIN-GIFT', userId, productId,
          k, days, expAt, now).run();
        assigned++;
      } catch { /* bảng có thể thiếu cột — bỏ qua */ }
    }
  }

  return ok({ keys, count: keys.length, days, assigned, userId });
}
