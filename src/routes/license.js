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
} = {}) {
  const requested = Number(count) || 1;
  // Không âm thầm cắt số lượng — khách trả tiền cho N thì phải nhận đủ N.
  if (requested > MAX_LICENSE_BATCH) {
    throw new ApiError(400,
      `Tối đa ${MAX_LICENSE_BATCH} license mỗi lần (yêu cầu ${requested})`, 'TOO_MANY');
  }
  const n = Math.max(1, Math.trunc(requested));
  const term = Math.max(0, Math.min(MAX_TERM_DAYS, Number(days) || 0));
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
      `INSERT INTO licenses (key, plan, note, created_at, expires_at, max_rebind, pid, grace_h, app)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(key, String(plan).slice(0, 32), String(note).slice(0, 200),
      now, exp, Number(maxRebind) || 1, owner, grace, owner || '').run();
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
  const d = Math.max(1, Math.min(MAX_TERM_DAYS, Number(days) || 30));
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
  const rawDays = product.license_days;
  const days = (rawDays === null || rawDays === undefined) ? 30 : Math.max(0, Number(rawDays) || 0);

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
    return {
      ...(shapeLicense(lic) || { key: row.license_key, status: 'unknown' }),
      productName: row.product_name,
      orderCode: row.order_code,
      purchasedAt: row.created_at,
    };
  });
  return ok({ licenses: list, available: true });
}

/** Khách xin token đổi máy (dùng 1 lần, hết hạn sau 30 phút). */
export async function rebindMyLicense(env, request, key) {
  const { requireUser } = await import('../lib/auth.js');
  const { ok } = await import('../lib/http.js');
  const { rateLimit, clientIp } = await import('../lib/ratelimit.js');
  const { randomHex } = await import('../lib/crypto.js');
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

  // Sinh token dùng 1 lần — client EXE gửi kèm khi gọi /api/rebind
  const token = randomHex(24);
  const tokenHash = await sha256hex(token);
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `INSERT INTO rebind_tokens (token_hash, key, user_id, created_at, expires_at, used)
     VALUES (?,?,?,?,?,0)`
  ).bind(tokenHash, k, user.id, now, now + 1800).run();

  const tool = lic.pid === 'xagrant' || String(k).startsWith('XAGR-')
    ? 'xagrant' : 'nofog';
  const exePath = tool === 'xagrant'
    ? '"%ProgramFiles%\\XArena\\_re\\xagrant\\xa_grant.exe"'
    : '"%ProgramFiles%\\XArena\\_re\\chayduoc\\xa_nofog_pro.exe"';

  return ok({
    key: k,
    token,
    tool,
    expiresIn: 1800,
    rebindsLeft: (lic.max_rebind || 0) - (lic.rebinds || 0),
    // Lệnh chạy trên máy mới: client EXE tự gửi token
    command: `${exePath} --rebind "${k}" "${token}"`,
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
  await requireAdmin(env, request);

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

  return ok({
    available: true,
    licenses: (results || []).map(shapeLicense),
    stats: await licenseStats(env),
  });
}

export async function adminLicenseAction(env, request, key, action) {
  const { requireAdmin } = await import('../lib/auth.js');
  const { ok, ApiError: AE } = await import('../lib/http.js');
  const admin = await requireAdmin(env, request);

  const k = normKey(key);
  const lic = await readLicense(env, k);
  if (!lic) throw new AE(404, 'License không tồn tại', 'NOT_FOUND');

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
  const { requireAdmin } = await import('../lib/auth.js');
  const { ok, readJson } = await import('../lib/http.js');
  const { str, int } = await import('../lib/validate.js');
  const admin = await requireAdmin(env, request);
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

  const keys = await issueLicenses(env, {
    count, prefix, days, plan: prefix.toLowerCase(), note, maxRebind,
    pid: pidForPrefix(prefix),
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
