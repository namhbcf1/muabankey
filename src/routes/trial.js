/**
 * Trial 3 ngày miễn phí theo HWID.
 *
 * THIẾT KẾ:
 *  - Trial là một license THẬT trong bảng `licenses` với plan='trial'
 *    → /api/check chạy nguyên logic cũ, client không cần sửa gì.
 *  - Bảng `trial_grants` là MỎ NEO chống reset: khoá theo `weak_hwid`
 *    (bỏ volume serial — thứ đổi được bằng 1 lệnh), nên:
 *       • xoá lic.bin         → server trả lại đúng trial cũ
 *       • đổi volume serial   → vẫn nhận ra, trả trial cũ
 *       • trial đã hết hạn    → từ chối, KHÔNG cấp mới
 *  - Server TỰ TÍNH hwid từ raw parts client gửi, không tin hwid client.
 *    (Trước đây POST /api/activate nhận hwid trần → curl 10 giây farm
 *    được trial vô hạn bằng HWID ngẫu nhiên.)
 *  - grace_hours = 0: trial phải có mạng. Nếu cho grace 24h thì rút mạng
 *    là 3 ngày thành 4 ngày, và mọi mã lỗi lạ đều rơi vào nhánh grace.
 */
import { json } from '../lib/http.js';

const TRIAL_PREFIX = 'TR-';
const DEFAULT_DAYS = 3;
const DEFAULT_MAX_PER_IP = 3;
const DEFAULT_MAX_PER_NET = 12;
const DEFAULT_MAX_PER_DAY = 200;

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function ipOf(request) {
  return request.headers.get('cf-connecting-ip') || 'unknown';
}

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

async function sha256hex(text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Đọc cấu hình trial từ settings, fallback mặc định. */
async function trialCfg(env) {
  const { results } = await env.DB.prepare(
    `SELECT key, value FROM settings WHERE key LIKE 'trial_%'`
  ).all();
  const m = {};
  for (const r of results || []) m[r.key] = r.value;
  const num = (k, d) => {
    const n = Number(m[k]);
    return Number.isFinite(n) ? n : d;
  };
  return {
    enabled: m.trial_enabled !== '0',
    days: num('trial_days', DEFAULT_DAYS),
    maxPerIp: num('trial_max_per_ip', DEFAULT_MAX_PER_IP),
    maxPerNet: num('trial_max_per_net', DEFAULT_MAX_PER_NET),
    maxPerDay: num('trial_max_per_day', DEFAULT_MAX_PER_DAY),
  };
}

async function logAttempt(env, weak, hwid, ip, action, detail) {
  try {
    await env.DB.prepare(
      'INSERT INTO trial_attempts (weak, hwid, ip, action, detail, at) VALUES (?,?,?,?,?,?)'
    ).bind(weak || null, hwid || null, ip, action, detail || null, nowSec()).run();
  } catch { /* không chặn luồng chính */ }
}

async function logEvent(env, key, hwid, kind, detail, ip) {
  try {
    await env.DB.prepare(
      'INSERT INTO lic_events (key, hwid, kind, detail, ip, at) VALUES (?,?,?,?,?,?)'
    ).bind(key, hwid || null, kind, detail || null, ip || null, nowSec()).run();
  } catch { /* ignore */ }
}

/** Nhận diện máy ảo từ BIOS vendor / CPU brand. */
function looksVirtual(bios, cpu) {
  const s = `${bios} ${cpu}`.toLowerCase();
  const marks = ['vmware', 'virtualbox', 'vbox', 'qemu', 'kvm', 'xen',
    'hyper-v', 'parallels', 'bochs', 'innotek', 'virtual machine'];
  return marks.some((m) => s.includes(m));
}

/**
 * Tính HWID + weak HWID từ raw parts.
 * weak = bỏ volume serial (đổi được bằng phần mềm).
 */
async function deriveIds(parts) {
  const [guid, bios, cpu, vol] = parts.map((x) => String(x || '').trim().slice(0, 200));
  const full = [guid, bios, cpu, vol].join('|');
  const weak = [guid, bios, cpu].join('|');
  return {
    hwid: (await sha256hex('v1|' + full)).slice(0, 32),
    weak: (await sha256hex('w1|' + weak)).slice(0, 32),
    bios, cpu,
  };
}

function trialKeyFor(weak) {
  return TRIAL_PREFIX + String(weak).slice(0, 16).toUpperCase();
}

function publicTrial(lic, now, kind) {
  return {
    ok: true,
    key: lic.key,
    plan: 'trial',
    trial: true,
    trial_kind: kind,
    expires_at: lic.expires_at,
    activated_at: lic.activated_at,
    days_left: Math.max(0, Math.ceil((lic.expires_at - now) / 86400)),
    grace_hours: 0,
  };
}

/** Đếm trial đã cấp trong 30 ngày theo IP và theo /24. */
async function countRecent(env, ip, net, since, { perIp = true } = {}) {
  const row = perIp
    ? await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM trial_attempts WHERE action='start' AND ip = ? AND at > ?"
      ).bind(ip, since).first()
    : await env.DB.prepare(
        `SELECT COUNT(*) AS n FROM trial_attempts
         WHERE action='start' AND ip LIKE ? AND at > ?`
      ).bind(net + '.%', since).first();
  return row?.n || 0;
}

/**
 * POST /api/trial/start
 * Body: { guid, bios, cpu, vol, app, ver }
 *   → server tự băm ra hwid. Client KHÔNG gửi hwid trực tiếp.
 *   (Vẫn nhận `hwid` nếu client cũ, nhưng khi đó coi như weak = hwid.)
 */
export async function apiTrialStart(env, request) {
  const ip = ipOf(request);
  const ua = (request.headers.get('user-agent') || '').slice(0, 200);
  const b = await readBody(request);
  if (!b) {
    return json({ ok: false, code: 'bad_request', msg: 'JSON không hợp lệ' }, 400);
  }

  const cfg = await trialCfg(env);
  if (!cfg.enabled) {
    return json({ ok: false, code: 'trial_disabled', msg: 'Dùng thử đang tạm đóng' }, 403);
  }

  // ---- 1. Tính ID ----
  let ids;
  if (b.guid !== undefined || b.bios !== undefined || b.cpu !== undefined) {
    ids = await deriveIds([b.guid, b.bios, b.cpu, b.vol]);
  } else {
    // Client cũ chỉ gửi hwid → dùng làm cả hwid và weak (kém an toàn hơn)
    const raw = String(b.hwid || '').trim().toLowerCase();
    if (!/^[0-9a-z]{16,128}$/.test(raw)) {
      return json({ ok: false, code: 'bad_request', msg: 'Thiếu thông tin máy' }, 400);
    }
    ids = { hwid: raw, weak: raw, bios: '', cpu: '' };
  }

  // ---- 2. Chặn máy ảo ----
  if (looksVirtual(ids.bios, ids.cpu)) {
    await logAttempt(env, ids.weak, ids.hwid, ip, 'denied_device', 'virtual machine');
    return json({
      ok: false, code: 'trial_denied_device',
      msg: 'Không hỗ trợ dùng thử trên máy ảo',
    }, 403);
  }

  // ---- 3. Thiết bị bị chặn thủ công ----
  const banned = await env.DB.prepare(
    'SELECT reason FROM banned_devices WHERE weak_hwid = ?'
  ).bind(ids.weak).first();
  if (banned) {
    await logAttempt(env, ids.weak, ids.hwid, ip, 'denied_device', 'banned');
    return json({
      ok: false, code: 'trial_denied_device',
      msg: 'Thiết bị này bị chặn dùng thử',
    }, 403);
  }

  const now = nowSec();
  const key = trialKeyFor(ids.weak);

  // ---- 4. Đã có trial cho máy này? ----
  const grant = await env.DB.prepare(
    'SELECT * FROM trial_grants WHERE weak_hwid = ?'
  ).bind(ids.weak).first();

  if (grant) {
    const lic = await env.DB.prepare('SELECT * FROM licenses WHERE key = ?')
      .bind(grant.lic_key).first();

    if (!lic || lic.revoked) {
      await logAttempt(env, ids.weak, ids.hwid, ip, 'denied_expired', 'revoked');
      return json({
        ok: false, code: 'trial_expired',
        msg: `Máy này đã dùng hết ${cfg.days} ngày dùng thử`,
      }, 403);
    }
    if (lic.expires_at && lic.expires_at < now) {
      await logAttempt(env, ids.weak, ids.hwid, ip, 'denied_expired', 'time up');
      return json({
        ok: false, code: 'trial_expired',
        msg: `Máy này đã dùng hết ${cfg.days} ngày dùng thử`,
        expires_at: lic.expires_at,
      }, 403);
    }
    // Cùng máy nhưng HWID khác (đổi volume serial) → vẫn cho tiếp
    if (lic.hwid !== ids.hwid) {
      try {
        await env.DB.prepare(
          'UPDATE licenses SET hwid = ?, last_seen = ?, last_ip = ? WHERE key = ?'
        ).bind(ids.hwid, now, ip, lic.key).run();
        await env.DB.prepare(
          'UPDATE trial_grants SET hwid = ?, suspect = 1, last_at = ? WHERE weak_hwid = ?'
        ).bind(ids.hwid, now, ids.weak).run();
        await logAttempt(env, ids.weak, ids.hwid, ip, 'resume', 'hwid changed');
      } catch { /* ignore */ }
    } else {
      await env.DB.prepare(
        'UPDATE trial_grants SET resume_count = resume_count + 1, last_at = ? WHERE weak_hwid = ?'
      ).bind(now, ids.weak).run();
      await env.DB.prepare(
        'UPDATE licenses SET last_seen = ?, last_ip = ? WHERE key = ?'
      ).bind(now, ip, lic.key).run();
      await logAttempt(env, ids.weak, ids.hwid, ip, 'resume', 'same device');
    }

    const fresh = await env.DB.prepare('SELECT * FROM licenses WHERE key = ?')
      .bind(grant.lic_key).first();
    return json(publicTrial(fresh, now, 'resume'));
  }

  // ---- 5. Máy mới: kiểm hạn mức ----
  const since30d = now - 30 * 86400;
  const net = String(ip).split('.').slice(0, 3).join('.');

  if (ip !== 'unknown') {
    const nIp = await countRecent(env, ip, net, since30d, { perIp: true });
    if (nIp >= cfg.maxPerIp) {
      await logAttempt(env, ids.weak, ids.hwid, ip, 'denied_ip', `ip count ${nIp}`);
      return json({
        ok: false, code: 'trial_limit',
        msg: 'Kết nối này đã dùng hết lượt dùng thử',
      }, 429);
    }
    if (net.split('.').length === 3) {
      const nNet = await countRecent(env, ip, net, since30d, { perIp: false });
      if (nNet >= cfg.maxPerNet) {
        await logAttempt(env, ids.weak, ids.hwid, ip, 'denied_ip', `net count ${nNet}`);
        return json({
          ok: false, code: 'trial_limit',
          msg: 'Mạng này đã dùng hết lượt dùng thử',
        }, 429);
      }
    }
  }

  const nDay = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM trial_attempts WHERE action='start' AND at > ?"
  ).bind(now - 86400).first();
  if ((nDay?.n || 0) >= cfg.maxPerDay) {
    await logAttempt(env, ids.weak, ids.hwid, ip, 'denied_global', `day ${nDay?.n}`);
    return json({
      ok: false, code: 'trial_limit',
      msg: 'Hệ thống đã đạt giới hạn dùng thử hôm nay, vui lòng thử lại mai',
    }, 429);
  }

  // ---- 6. Tạo trial ----
  const exp = now + cfg.days * 86400;
  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO licenses
           (key, hwid, plan, note, created_at, activated_at, expires_at,
            last_seen, last_ip, revoked, max_rebind, rebinds)
         VALUES (?,?, 'trial', ?,?,?,?,?,?,0,0,0)`
      ).bind(key, ids.hwid, `Dung thu ${cfg.days} ngay`, now, now, exp, now, ip),
      env.DB.prepare(
        `INSERT INTO trial_grants
           (weak_hwid, lic_key, hwid, ip_first, ua_first, first_at, expires_at, last_at)
         VALUES (?,?,?,?,?,?,?,?)`
      ).bind(ids.weak, key, ids.hwid, ip, ua, now, exp, now),
    ]);
  } catch (e) {
    // Đua nhau: request khác vừa tạo → đọc lại
    const again = await env.DB.prepare('SELECT * FROM licenses WHERE key = ?')
      .bind(key).first();
    if (again) return json(publicTrial(again, now, 'resume'));
    console.error('trial insert:', e && e.message);
    return json({ ok: false, code: 'server_error', msg: 'Không tạo được dùng thử' }, 500);
  }

  await logAttempt(env, ids.weak, ids.hwid, ip, 'start', `${cfg.days}d`);
  await logEvent(env, key, ids.hwid, 'trial_start', `${cfg.days}d`, ip);

  const lic = await env.DB.prepare('SELECT * FROM licenses WHERE key = ?').bind(key).first();
  return json(publicTrial(lic, now, 'new'));
}

/** GET /api/trial/status?weak=... — kiểm tra máy đã dùng trial chưa. */
export async function apiTrialStatus(env, request) {
  const url = new URL(request.url);
  const weak = String(url.searchParams.get('weak') || '').trim().toLowerCase();
  if (!/^[0-9a-z]{16,128}$/.test(weak)) {
    return json({ ok: false, code: 'bad_request' }, 400);
  }
  const g = await env.DB.prepare(
    'SELECT lic_key, first_at, expires_at, converted_key FROM trial_grants WHERE weak_hwid = ?'
  ).bind(weak).first();
  if (!g) return json({ ok: true, used: false });
  const now = nowSec();
  return json({
    ok: true,
    used: true,
    expired: !!(g.expires_at && g.expires_at < now),
    expires_at: g.expires_at,
    days_left: g.expires_at ? Math.max(0, Math.ceil((g.expires_at - now) / 86400)) : 0,
  });
}
