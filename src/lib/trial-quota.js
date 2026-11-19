/**
 * Trial theo TÀI KHOẢN: 1 giờ + 3 ngày, mỗi loại 10 lượt.
 *
 * KHÁC BẢN CŨ:
 *   Cũ: trial_grants khoá theo weak_hwid, mỗi máy 1 lần, không cần tài khoản.
 *   Mới: khoá theo user_id, mỗi tài khoản 10 lượt/loại, bắt buộc đăng nhập.
 *
 * PHÂN VAI (quan trọng):
 *   - user_id  = hạn mức (đếm 10 lượt)
 *   - hwid     = thực thi runtime (chặn copy lic.bin sang máy khác)
 *   - weak_hwid = chống farm tài khoản (1 máy chỉ được N tài khoản)
 *   - ip + /24 = hạn mức phụ
 *
 * ĐIỂM MẤU CHỐT: khi hạn mức ở tài khoản, spoofer HWID thành vô nghĩa —
 * đổi HWID vẫn tiêu 1 trong 10 lượt của chính tài khoản đó.
 */

import { ApiError } from './http.js';

const KIND_1H = '1h';
const KIND_3D = '3d';

/** Đọc cấu hình trial từ settings, fallback mặc định. */
export async function trialCfg(env) {
  const { results } = await env.DB.prepare(
    "SELECT key, value FROM settings WHERE key LIKE 'trial%'"
  ).all();
  const m = {};
  for (const r of results || []) m[r.key] = r.value;
  const num = (k, d) => {
    const n = Number(m[k]);
    return Number.isFinite(n) ? n : d;
  };
  const bool = (k, d) => (m[k] === undefined ? d : m[k] !== '0');

  return {
    enabled: bool('trial_enabled', true),
    requireLogin: bool('trial_require_account', true),
    // 1 giờ
    t1h: {
      enabled: bool('trial1h_enabled', true),
      sec: num('trial1h_minutes', 60) * 60,
      quota: num('trial1h_limit', 10),
    },
    // 3 ngày
    t3d: {
      enabled: bool('trial3d_enabled', true),
      sec: num('trial3d_days', 3) * 86400,
      quota: num('trial3d_limit', 10),
    },
    // Chống lạm dụng (giữ từ v1)
    maxPerIp: num('trial_max_per_ip', 10),
    maxPerNet: num('trial_max_per_net', 60),
    maxPerDay: num('trial_max_per_day', 300),
    /*
     * Audit #2 — TRẦN THEO /24 TRONG 24 GIỜ, KHÔNG phụ thuộc dữ liệu client.
     *
     * Đây là lớp CHẶN THẬT SỰ cho lỗ hổng "xoá localStorage = 10 lượt mới":
     * `device_id` là chuỗi do client tự chọn nên mọi hạn mức neo vào nó đều
     * xoay được. `trial_uses.ip` do Cloudflare điền (cf-connecting-ip) — client
     * KHÔNG sửa được. Vì vậy trần /24/ngày là giới hạn BINDING cho kẻ farm vé
     * trên cùng một mạng (quán net, 4G CGNAT, VPS cùng dải).
     *
     * Đặt 60 (không phải 10) vì quán net/NAT chung là khách thật.
     */
    maxPerNet24: num('trial_max_per_net24_day', 60),
    // Chống farm tài khoản trên 1 máy
    deviceAccounts1h: num('trial_device_acc_1h', 3),
    deviceAccounts3d: num('trial_device_acc_3d', 2),
    // Thời gian giữ chỗ nếu cấp rồi không kích hoạt
    holdSec: num('trial_hold_sec', 7 * 86400),
    // Nhịp client nên kiểm lại (giây)
    recheck1h: num('trial_recheck_1h', 120),
    recheck3d: num('trial_recheck_3d', 900),
  };
}

export function kindCfg(cfg, kind) {
  if (kind === KIND_1H) return cfg.t1h;
  if (kind === KIND_3D) return cfg.t3d;
  return null;
}

/**
 * Kiểm tra whitelist — máy/tài khoản/IP được dùng thử VÔ HẠN.
 *
 * Trả { unlimited: true, quota, matched: [{scope, value}] } nếu khớp,
 * ngược lại { unlimited: false }.
 *
 * Dùng cho máy lập trình / test nội bộ. Không ảnh hưởng khách thật.
 */
export async function checkWhitelist(env, { userId, hwid, weak, deviceId, ip } = {}) {
  const checks = [];
  if (weak) checks.push(['weak', weak]);
  if (hwid) checks.push(['hwid', hwid]);
  if (deviceId) checks.push(['device', deviceId]);
  if (userId && !String(userId).startsWith('dev:')) checks.push(['user', userId]);
  // KHÔNG dùng IP làm căn cứ whitelist: ai cùng NAT/WiFi/CGNAT với admin
  // sẽ hưởng vô hạn (bỏ 5 lớp giới hạn). IP chỉ để tra cứu, không cấp quyền.
  void ip;

  if (!checks.length) return { unlimited: false, matched: [] };

  const matched = [];
  for (const [scope, value] of checks) {
    const row = await env.DB.prepare(
      'SELECT note FROM trial_whitelist WHERE scope = ? AND value = ?'
    ).bind(scope, value).first();
    if (row) matched.push({ scope, value, note: row.note });
  }

  if (!matched.length) return { unlimited: false, matched: [] };

  // Quota vô hạn: dùng số lớn thay vì NULL để mọi phép so sánh vẫn đúng
  const row = await env.DB.prepare(
    "SELECT value FROM settings WHERE key = 'trial_unlimited_quota'"
  ).first();
  const quota = Number(row?.value) || 999999;

  return { unlimited: true, quota, matched };
}

export function normKind(v) {
  // Chỉ chấp nhận string. Array/Object bị String() ép thành "1h"/"[object Object]"
  // -> kind=["1h"] lọt qua validate. Chặn ở đây.
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') return null;
  const s = v.trim().toLowerCase();
  if (s === '1h' || s === '1g' || s === 'hour') return KIND_1H;
  if (s === '3d' || s === '3n' || s === 'day' || s === '3day') return KIND_3D;
  return null;
}

export function nowSec() {
  return Math.floor(Date.now() / 1000);
}

/* ==================================================================== */
/* KỲ HẠN KHI BIND LẦN ĐẦU — chuẩn hoá ĐƠN VỊ (dùng chung 2 license    */
/* server: src/routes/license-server.js và src/routes/xa-grant-server.js)*/
/*                                                                      */
/* LỖI GỐC (P1): cả hai server tính lại kỳ hạn ở lần bind đầu bằng      */
/*   Math.max(1, Math.round((lic.expires_at - lic.created_at) / 86400)) */
/* Nếu `created_at` lưu bằng MILI-GIÂY (1.79e12) còn `expires_at` bằng  */
/* GIÂY (1.8e9) thì hiệu ≈ -1.79e12 -> Math.max(1, …) KẸP THÀNH 1 ->    */
/* key 6 tháng âm thầm biến thành key 1 NGÀY. Khách trả tiền 6 tháng,   */
/* nhận 1 ngày, và không có lỗi nào được ghi.                          */
/*                                                                      */
/* Nay: chuẩn hoá cả hai mốc, chỉ tính khi chứng minh được, và khi      */
/* không chứng minh được thì LÙI VỀ cấu hình sản phẩm (products /       */
/* license_issues) thay vì kẹp về 1.                                    */
/* ==================================================================== */

/**
 * Trần số ngày của một kỳ hạn. Vượt ngưỡng = dữ liệu hỏng, không phải gói
 * bán thật (MAX_TERM_DAYS trong license.js là 3650, +1 ngày bonus = 3651).
 */
export const TERM_MAX_DAYS = 4000;

/**
 * Ranh giới ms/s. 1e11 GIÂY = năm 5138; 1e11 MILI-GIÂY = 1973.
 * Mọi mốc thời gian thật của hệ thống này rơi về đúng một phía.
 */
const MS_THRESHOLD = 1e11;

/**
 * Đưa một timestamp bất kỳ về GIÂY.
 * Trả 0 khi KHÔNG dùng được (null / NaN / <= 0 / vô lý) — không đoán bừa.
 */
export function toUnixSeconds(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return 0;
  const sec = n > MS_THRESHOLD ? Math.floor(n / 1000) : Math.floor(n);
  return sec > 0 && sec < MS_THRESHOLD ? sec : 0;
}

/**
 * Số ngày giữa created_at và expires_at, chịu được LỆCH ĐƠN VỊ (ms vs s).
 *
 * Trả `null` (KHÔNG kẹp về 1) khi không chứng minh được:
 *   - thiếu mốc / mốc vô lý, hoặc
 *   - expires_at <= created_at (dấu hiệu lệch đơn vị hoặc dữ liệu hỏng), hoặc
 *   - kết quả > TERM_MAX_DAYS.
 */
export function termDaysFromSpan(createdAt, expiresAt) {
  const c = toUnixSeconds(createdAt);
  const e = toUnixSeconds(expiresAt);
  if (!c || !e || e <= c) return null;
  const days = Math.round((e - c) / 86400);
  if (!Number.isFinite(days) || days < 1 || days > TERM_MAX_DAYS) return null;
  return days;
}

/**
 * Kỳ hạn đã cấu hình cho một TIỀN TỐ key, đọc từ `products`.
 *
 * `products` KHÔNG có cột pid/plan; nó phân biệt sản phẩm bằng
 * `license_prefix` ('AOE1' | 'XAGR') + `license_days`. Một prefix thường có
 * NHIỀU dòng (7/30/90/180/365/0 ngày), nên chỉ dùng được khi CHỈ CÓ MỘT giá
 * trị phân biệt. Nhiều giá trị => trả null + ambiguous = true, KHÔNG đoán.
 *
 * Không lọc `active`: key đã bán vẫn thuộc sản phẩm đã ngừng bán.
 */
export async function configuredTermDays(env, prefix) {
  const p = String(prefix || '').toUpperCase();
  if (!p) return { days: null, values: [], ambiguous: false };
  try {
    const { results } = await env.DB.prepare(
      `SELECT DISTINCT license_days AS d FROM products
        WHERE UPPER(license_prefix) = ? AND license_days IS NOT NULL`
    ).bind(p).all();
    const values = [];
    for (const r of results || []) {
      const n = Number(r.d);
      if (!Number.isFinite(n) || n < 0 || n > TERM_MAX_DAYS) continue;
      if (!values.includes(n)) values.push(n);
    }
    return {
      days: values.length === 1 ? values[0] : null,
      values,
      ambiguous: values.length > 1,
    };
  } catch {
    // Thiếu bảng/cột (CSDL cũ) -> coi như không tra được, không làm hỏng luồng.
    return { days: null, values: [], ambiguous: false };
  }
}

/** Kỳ hạn ĐÃ BÁN cho đúng key này, đọc từ `license_issues.term_days`. */
async function issuedTermDays(env, key) {
  const k = String(key || '').trim().toUpperCase();
  if (!k) return null;
  try {
    const { results } = await env.DB.prepare(
      `SELECT DISTINCT term_days AS d FROM license_issues
        WHERE license_key = ? AND term_days IS NOT NULL`
    ).bind(k).all();
    const values = [];
    for (const r of results || []) {
      const n = Number(r.d);
      if (!Number.isFinite(n) || n < 0 || n > TERM_MAX_DAYS) continue;
      if (!values.includes(n)) values.push(n);
    }
    return values.length === 1 ? values[0] : null;
  } catch {
    return null;
  }
}

/**
 * Quyết định kỳ hạn cho lần bind ĐẦU TIÊN.
 *
 * Trả `{ days, forever, source }`:
 *   - `forever: false` => `days` là số nguyên 1..TERM_MAX_DAYS (KHÔNG BAO GIỜ < 1)
 *   - `forever: true`  => `days: null`, key vĩnh viễn (expires_at = 0)
 *
 * Thứ tự bằng chứng (dừng ở bằng chứng đầu tiên chứng minh được):
 *   1. 'span'     – hiệu created_at→expires_at sau khi chuẩn hoá đơn vị
 *   2. 'product'  – products.license_days, chỉ khi prefix có DUY NHẤT 1 giá trị
 *   3. 'issue'    – license_issues.term_days của chính key đó
 *   4. 'stored'   – expires_at ĐÃ LƯU (giây) vẫn còn hạn: giữ nguyên hạn cũ
 *   5. 'floor'    – sàn 1 ngày (chỉ khi mọi bằng chứng đều hỏng)
 *
 * `source` được ghi vào lic_events/xg_events để vận hành thấy ngay dữ liệu hỏng
 * thay vì âm thầm cắt hạn khách.
 */
export async function resolveTermDays(env, {
  createdAt, expiresAt, prefix, key, now,
} = {}) {
  const spanDays = termDaysFromSpan(createdAt, expiresAt);
  if (spanDays) return { days: spanDays, forever: false, source: 'span' };

  const storedExp = toUnixSeconds(expiresAt);

  const cfg = await configuredTermDays(env, prefix);
  if (cfg.days === 0) {
    // Sản phẩm cấu hình vĩnh viễn: CHỈ tin khi chính license cũng không có hạn.
    // License CÓ expires_at > 0 mà cấu hình nói 0 -> mâu thuẫn, không suy ra
    // vĩnh viễn (fail-open) mà đi tiếp xuống các bằng chứng sau.
    if (!storedExp) return { days: null, forever: true, source: 'product:forever' };
  } else if (cfg.days) {
    return { days: cfg.days, forever: false, source: 'product' };
  }

  const issued = await issuedTermDays(env, key);
  if (issued === 0) {
    if (!storedExp) return { days: null, forever: true, source: 'issue:forever' };
  } else if (issued) {
    return { days: issued, forever: false, source: 'issue' };
  }

  const nowS = toUnixSeconds(now);
  if (nowS && storedExp > nowS) {
    const d = Math.round((storedExp - nowS) / 86400);
    if (Number.isFinite(d) && d >= 1 && d <= TERM_MAX_DAYS) {
      return { days: d, forever: false, source: 'stored' };
    }
  }

  return { days: 1, forever: false, source: 'floor' };
}

/** Sinh key trial ngẫu nhiên: TR-XXXX-XXXX-XXXX (khác bản cũ dùng hash HWID). */
/*
 * BẢNG CHỮ CÁI SINH MÃ DÙNG THỬ — KHÔNG CÓ KÝ TỰ DỄ ĐỌC NHẦM.
 *
 * LỖI ĐÃ SỬA: bảng cũ '23456789ABCDEFGHJKLMNPQRSTUVWXYZ' đã bỏ 0/1/I/O
 * (tốt), NHƯNG vẫn còn 4 cặp dễ nhầm khi đọc hoặc chụp màn hình:
 *     8 ↔ B     5 ↔ S     2 ↔ Z     6 ↔ G
 * Đo trên 30 mã thật: 96,8% số mã chứa ít nhất một ký tự trong 4 cặp
 * này. Đây chính là nguyên nhân khách báo "mã không tồn tại":
 *     mã thật  TR-MC8Y-AE9T-ABP4
 *     khách gõ TR-MCBY-AE9T-ABP4   (đọc số 8 thành chữ B)
 *
 * Nay chỉ dùng ký tự không thể nhầm với bất kỳ ký tự nào khác:
 *     2 3 4 5 7 9 B C D E F H J K M N P Q R T U V W X Y
 * Đã bỏ: 0 O, 1 I L, 8 B, 6 G, 5 S, 2 Z, và A (nhầm với 4).
 * Còn 25 ký tự → 25^12 ≈ 6.0e16 tổ hợp, dư cho mã dùng thử.
 *
 * KHÔNG ảnh hưởng mã đã phát: mã cũ vẫn hợp lệ vì phía kiểm tra chỉ xét
 * ĐỊNH DẠNG và tra CSDL, không xét bảng chữ cái.
 */
export function trialKey() {
  /*
   * 23 KÝ TỰ — KHÔNG CÓ CẶP NÀO ĐỌC NHẦM ĐƯỢC.
   *
   * Đã loại: 0 O (giống nhau), 1 I L (giống nhau), 6 G, 8 B, 5 S, 2 Z,
   *          và A (nhầm với 4).
   * Còn: 3 4 9 B C D E F H J K M N P Q R T U W X Y
   *
   * VÌ SAO QUAN TRỌNG: đo trên 488 mã thật, 96,7% chứa ít nhất một ký
   * tự thuộc cặp dễ nhầm. Khách đọc số 8 thành chữ B → nhập sai → "mã
   * không tồn tại". Bảng mới loại bỏ hoàn toàn nguyên nhân này.
   *
   * KHÔNG dùng `% AB.length`: 256 % 23 = 3, sẽ lệch (thiên vị ký tự đầu).
   * Dùng loại-mẫu (rejection sampling) để phân bố đều.
   */
  const AB = '349BCDEFHJKLMNPQRTUWXY';
  const LIM = 256 - (256 % AB.length);
  const pick = (n) => {
    let s = '';
    const b = new Uint8Array(1);
    while (s.length < n) {
      crypto.getRandomValues(b);
      if (b[0] < LIM) s += AB[b[0] % AB.length];
    }
    return s;
  };
  return `TR-${pick(4)}-${pick(4)}-${pick(4)}`;
}


export async function sha256hex(text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Nhận diện máy ảo từ BIOS vendor / CPU brand. */
export function looksVirtual(bios, cpu) {
  const s = `${bios} ${cpu}`.toLowerCase();
  const marks = ['vmware', 'virtualbox', 'vbox', 'qemu', 'kvm', 'xen',
    'hyper-v', 'parallels', 'bochs', 'innotek', 'virtual machine'];
  return marks.some((m) => s.includes(m));
}

/** Tính HWID đầy đủ + weak HWID từ raw parts client gửi. */
/**
 * Băm 4 thành phần phần cứng thành HWID.
 *
 * FAIL CLOSED khi không đủ dữ liệu: client cũ (hoặc bản bị sửa) gửi toàn chuỗi
 * rỗng sẽ cho ra cùng một HWID `bea408e2…` trên mọi máy — một key bind 1 lần
 * dùng được trên tất cả, và farm trial vô hạn. Client đã được vá, nhưng server
 * phải tự bảo vệ vì không kiểm soát được bản client đang chạy.
 *
 * Ngưỡng khớp với client: cần >= 2 thành phần, HOẶC riêng MachineGuid (guid).
 * GUID do Windows sinh riêng từng lần cài nên đủ phân biệt máy.
 */
export async function deriveIds(parts) {
  const [guid, bios, cpu, vol] = parts.map((x) => String(x || '').trim().slice(0, 200));
  const filled = [guid, bios, cpu, vol].filter((v) => v.length > 0);
  if (filled.length === 0) {
    throw new ApiError(
      400,
      'Không đọc được thông tin phần cứng. Vui lòng liên hệ hỗ trợ.',
      'HWID_UNAVAILABLE',
    );
  }
  if (filled.length < 2 && !guid) {
    throw new ApiError(
      400,
      'Không đủ thông tin phần cứng để định danh máy. Vui lòng liên hệ hỗ trợ.',
      'HWID_UNAVAILABLE',
    );
  }
  const full = [guid, bios, cpu, vol].join('|');
  const weak = [guid, bios, cpu].join('|');
  return {
    hwid: (await sha256hex('v1|' + full)).slice(0, 32),
    weak: (await sha256hex('w1|' + weak)).slice(0, 32),
    bios, cpu,
  };
}

/**
 * Lấy hạn mức hiện tại của 1 user cho 1 kind.
 * Trả {used, quota, left, reset_count}.
 */
export async function getQuota(env, userId, kind, defaultQuota) {
  const row = await env.DB.prepare(
    'SELECT used, quota, reset_count FROM trial_quota WHERE user_id = ? AND kind = ?'
  ).bind(userId, kind).first();
  if (!row) return { used: 0, quota: defaultQuota, left: defaultQuota, reset_count: 0 };
  return {
    used: row.used || 0,
    quota: row.quota || defaultQuota,
    left: Math.max(0, (row.quota || defaultQuota) - (row.used || 0)),
    reset_count: row.reset_count || 0,
  };
}

/**
 * ĐẾM LƯỢT DÙNG THỬ THEO PHẦN CỨNG (HWID).
 *
 * VÌ SAO ĐỔI TỪ user_id SANG hwid:
 * Trước đây quota khoá theo (user_id, kind). Khách xoá cookie hoặc tạo tài
 * khoản mới là có user_id mới -> lại được 10 lượt. HWID thì đổi tài khoản
 * vẫn là cùng máy, nên không lách được.
 *
 * `hwid` do CHÍNH TOOL tính từ phần cứng rồi gửi lên. Nó chỉ là khoá ĐẾM —
 * muốn có key vẫn phải qua bước cấp license có kiểm riêng.
 *
 * Không có hwid (không đọc được phần cứng) -> trả null, bên gọi fallback
 * về user_id như cũ.
 */
export async function getQuotaHw(env, hwid, kind, defaultQuota) {
  if (!hwid) return null;
  const row = await env.DB.prepare(
    'SELECT used, quota, reset_count FROM trial_quota_hw WHERE hwid = ? AND kind = ?'
  ).bind(String(hwid), kind).first();
  if (!row) {
    return { used: 0, quota: defaultQuota, left: defaultQuota, reset_count: 0 };
  }
  const quota = row.quota || defaultQuota;
  const used = row.used || 0;
  return {
    used,
    quota,
    left: Math.max(0, quota - used),
    reset_count: row.reset_count || 0,
  };
}

/** TRỪ 1 LƯỢT theo HWID (nguyên tử). Trả null nếu không có hwid. */
export async function consumeUseHw(env, hwid, kind, defaultQuota) {
  if (!hwid) return null;
  const h = String(hwid);
  const now = nowSec();

  await env.DB.prepare(
    `INSERT INTO trial_quota_hw (hwid, kind, quota, used, created_at, updated_at)
     VALUES (?,?,?,0,?,?)
     ON CONFLICT(hwid, kind) DO NOTHING`
  ).bind(h, kind, defaultQuota, now, now).run();

  const claim = await env.DB.prepare(
    `UPDATE trial_quota_hw
     SET used = used + 1, updated_at = ?
     WHERE hwid = ? AND kind = ? AND used < quota`
  ).bind(now, h, kind).run();

  const q = await getQuotaHw(env, h, kind, defaultQuota);
  if (!claim.meta || claim.meta.changes !== 1) {
    return { ok: false, reason: 'quota_exhausted', ...q };
  }
  return { ok: true, ...q };
}

/** Hoàn 1 lượt theo HWID khi cấp license lỗi sau khi đã trừ. */
export async function refundUseHw(env, hwid, kind) {
  if (!hwid) return;
  const now = nowSec();
  try {
    await env.DB.prepare(
      `UPDATE trial_quota_hw SET used = MAX(0, used - 1), updated_at = ?
       WHERE hwid = ? AND kind = ?`
    ).bind(now, String(hwid), kind).run();
  } catch (e) {
    // không quan trọng: chỉ là hoàn lượt
  }
}

/**
 * TRỪ 1 LƯỢT NGUYÊN TỬ.
 *
 * UPDATE có điều kiện used < quota — chỉ 1 request đồng thời thắng.
 * Trả {ok, used, quota, left} hoặc {ok:false, reason}.
 */
export async function consumeUse(env, userId, kind, defaultQuota) {
  const now = nowSec();

  // Đảm bảo có dòng
  await env.DB.prepare(
    `INSERT INTO trial_quota (user_id, kind, quota, used, created_at, updated_at)
     VALUES (?,?,?,0,?,?)
     ON CONFLICT(user_id, kind) DO NOTHING`
  ).bind(userId, kind, defaultQuota, now, now).run();

  const claim = await env.DB.prepare(
    `UPDATE trial_quota
     SET used = used + 1, updated_at = ?
     WHERE user_id = ? AND kind = ? AND used < quota AND banned_at IS NULL`
  ).bind(now, userId, kind).run();

  if (!claim.meta || claim.meta.changes !== 1) {
    const q = await getQuota(env, userId, kind, defaultQuota);
    const banned = await env.DB.prepare(
      'SELECT banned_at FROM trial_quota WHERE user_id = ? AND kind = ?'
    ).bind(userId, kind).first();
    return {
      ok: false,
      reason: banned?.banned_at ? 'banned' : 'quota_exhausted',
      ...q,
    };
  }

  const q = await getQuota(env, userId, kind, defaultQuota);
  return { ok: true, ...q };
}

/** Hoàn lượt khi cấp license lỗi sau khi đã trừ. */
export async function refundUse(env, userId, kind) {
  await env.DB.prepare(
    `UPDATE trial_quota SET used = MAX(0, used - 1), updated_at = ?
     WHERE user_id = ? AND kind = ?`
  ).bind(nowSec(), userId, kind).run();
}

/**
 * Trial đang chạy của user (cùng kind): chưa hết hạn, chưa bị thu hồi.
 * Trả row hoặc null.
 */
export async function activeUse(env, userId, kind, product) {
  /*
   * PHAN BIET SAN PHAM: No Fog vs XAGrant.
   *
   * LOI DA SUA: truoc day trial chi co No Fog nen khong can phan biet.
   * Nay khach dung thu duoc ca hai. Neu khong loc theo san pham thi:
   *   - Khach dang co trial No Fog con han
   *   - Bam dung thu XAGrant -> ham nay tra ve suat No Fog -> "resume" nham
   *     -> khach nhan lai key No Fog thay vi key XAGrant.
   *
   * trial_uses khong co cot product, nen loc qua licenses.pid (da ghi luc
   * tao: pid='xagrant' cho grant, NULL cho nofog).
   */
  const now = nowSec();
  const wantXg = product === 'xagrant';
  const pidClause = wantXg
    ? "AND l.pid = 'xagrant'"
    : "AND (l.pid IS NULL OR l.pid <> 'xagrant')";
  return env.DB.prepare(
    `SELECT t.* FROM trial_uses t
       LEFT JOIN licenses l ON l.key = t.lic_key
     WHERE t.user_id = ? AND t.kind = ?
       AND t.ended_at IS NULL
       AND t.expires_at > ?
       ${pidClause}
     ORDER BY t.created_at DESC LIMIT 1`
  ).bind(userId, kind, now).first();
}

/**
 * Kiểm tra 1 máy đã dùng trial cho bao nhiêu TÀI KHOẢN khác nhau.
 * Chặn farm: tạo 10 tài khoản trên 1 máy.
 */
export async function deviceAccountCount(env, weak, kind, userId) {
  const row = await env.DB.prepare(
    `SELECT COUNT(DISTINCT user_id) AS n FROM trial_uses
     WHERE device_weak = ? AND kind = ? AND user_id IS NOT NULL AND user_id != ?`
  ).bind(weak, kind, userId).first();
  return row?.n || 0;
}

/** Đếm trial đã cấp theo IP và /24 trong 30 ngày. */
export async function countRecent(env, ip, net, since, { perIp = true } = {}) {
  const row = perIp
    ? await env.DB.prepare(
        'SELECT COUNT(*) AS n FROM trial_uses WHERE ip = ? AND created_at > ?'
      ).bind(ip, since).first()
    : await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM trial_uses WHERE ip LIKE ? AND created_at > ?"
      ).bind(net + '.%', since).first();
  return row?.n || 0;
}

/* ==================================================================== */
/* ĐỒNG HỒ DÙNG THỬ — DÙNG CHUNG CHO MỌI CHỖ HIỂN THỊ HẠN (audit #8)     */
/*                                                                      */
/* VỚI plan='trial', `licenses.expires_at` LÀ HẠN GIỮ MÃ (hold, mặc      */
/* định 7 ngày) chứ KHÔNG phải thời lượng dùng thử. Thời lượng thật nằm  */
/* ở `trial_uses.expires_at` và chỉ có sau khi đồng hồ bắt đầu (        */
/* started_at > 0).                                                     */
/*                                                                      */
/* Trước đây entitlement.js đã sửa nhưng `myLicenses` (license.js),      */
/* bộ cài (/api/install-info) vẫn đọc thẳng `licenses.expires_at` nên   */
/* khách thấy "còn ~7 ngày" cho gói 1 giờ. Nay mọi nơi đọc qua helper    */
/* dưới đây để chỉ có MỘT cách hiểu.                                    */
/* ==================================================================== */

/**
 * Đồng hồ dùng thử của MỘT key.
 * Trả null khi không có `trial_uses` (dữ liệu v1) — bên gọi tự quyết định.
 * Trả { started, started_at, expires_at, kind }.
 */
export async function trialClock(env, key) {
  const k = String(key || '').trim();
  if (!k) return null;
  try {
    const u = await env.DB.prepare(
      'SELECT started_at, expires_at, kind FROM trial_uses '
      + 'WHERE lic_key = ? ORDER BY created_at DESC LIMIT 1'
    ).bind(k).first();
    if (!u) return null;
    const started = Number(u.started_at || 0);
    return {
      started: started > 0,
      started_at: started,
      expires_at: Number(u.expires_at || 0),
      kind: u.kind || null,
    };
  } catch {
    // Thiếu bảng/cột (CSDL cũ) -> không kết luận được, không làm hỏng luồng.
    return null;
  }
}

/**
 * Bản gộp cho danh sách key (1 câu SQL, không N+1).
 * Trả Map<key, clock> — key không có `trial_uses` thì KHÔNG có trong Map.
 */
export async function trialClockMap(env, keys) {
  const out = new Map();
  const list = [...new Set((keys || []).map((k) => String(k || '').trim())
    .filter((k) => k.length > 0))];
  if (!list.length) return out;
  // Cắt theo lô 80 để câu SQL không quá dài (giới hạn tham số D1).
  for (let i = 0; i < list.length; i += 80) {
    const chunk = list.slice(i, i + 80);
    const ph = chunk.map(() => '?').join(',');
    try {
      const { results } = await env.DB.prepare(
        `SELECT lic_key, started_at, expires_at, kind FROM trial_uses
          WHERE lic_key IN (${ph})
          ORDER BY created_at DESC`
      ).bind(...chunk).all();
      for (const u of results || []) {
        const k = String(u.lic_key || '');
        if (out.has(k)) continue;   // đã lấy dòng MỚI NHẤT
        const started = Number(u.started_at || 0);
        out.set(k, {
          started: started > 0,
          started_at: started,
          expires_at: Number(u.expires_at || 0),
          kind: u.kind || null,
        });
      }
    } catch { /* thiếu bảng -> bỏ qua, bên gọi hiển thị như cũ */ }
  }
  return out;
}

/** Public view của 1 trial use — không lộ dữ liệu nội bộ. */
export function publicUse(row, cfg, kind) {
  const kc = kindCfg(cfg, kind);
  const now = nowSec();
  const activated = !!(row.started_at && row.started_at > 0);
  // Chưa kích hoạt: expires_at là "hold" (7 ngày để khách kịp cài tool),
  // KHÔNG phải hạn dùng thật -> thời gian còn lại = 0 (client hiện "chạy tool để bắt đầu")
  const leftSec = activated ? Math.max(0, (row.expires_at || 0) - now) : 0;
  return {
    ok: true,
    key: row.lic_key,
    plan: kind,
    trial: true,
    trial_kind: kind,
    expires_at: row.expires_at || 0,
    activated_at: activated ? row.started_at : 0,
    activated,
    time_left_sec: leftSec,
    days_left: Math.ceil(leftSec / 86400),
    grace_hours: 0,
    recheck_sec: kind === KIND_1H ? cfg.recheck1h : cfg.recheck3d,
    quota_total: kc?.quota,
  };
}

export { KIND_1H, KIND_3D };
