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
  if (ip && ip !== 'unknown') checks.push(['ip', ip]);

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
  const s = String(v || '').trim().toLowerCase();
  if (s === '1h' || s === '1g' || s === 'hour') return KIND_1H;
  if (s === '3d' || s === '3n' || s === 'day' || s === '3day') return KIND_3D;
  return null;
}

export function nowSec() {
  return Math.floor(Date.now() / 1000);
}

/** Sinh key trial ngẫu nhiên: TR-XXXX-XXXX-XXXX (khác bản cũ dùng hash HWID). */
export function trialKey() {
  const AB = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  const pick = (n) => {
    const b = new Uint8Array(n);
    crypto.getRandomValues(b);
    let s = '';
    for (let i = 0; i < n; i++) s += AB[b[i] % AB.length];
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
export async function deriveIds(parts) {
  const [guid, bios, cpu, vol] = parts.map((x) => String(x || '').trim().slice(0, 200));
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
export async function activeUse(env, userId, kind) {
  const now = nowSec();
  return env.DB.prepare(
    `SELECT * FROM trial_uses
     WHERE user_id = ? AND kind = ?
       AND ended_at IS NULL
       AND expires_at > ?
     ORDER BY created_at DESC LIMIT 1`
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
