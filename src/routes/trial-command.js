/**
 * Cấp LỆNH CMD để khách dùng thử — KHÔNG cần nhập tài khoản, KHÔNG nhập key.
 *
 * LUỒNG:
 *   1. Khách vào web, bấm "Bắt đầu 1 giờ" / "Bắt đầu 3 ngày"
 *   2. Web gọi POST /api/trial/command → nhận 1 dòng lệnh CMD
 *   3. Khách mở CMD, dán lệnh, Enter → xong
 *
 * Bên trong:
 *   - Server sinh mã trial TR- (gắn quota theo tài khoản nếu có đăng nhập,
 *     hoặc theo thiết bị nếu không)
 *   - Nhúng mã + token vào .cmd, khách không phải gõ gì
 *
 * KHÔNG bắt đăng nhập: đây là yêu cầu của chủ shop.
 * Chống lạm dụng bằng: IP / subnet / ngày / số tài khoản trên 1 máy.
 */
import { json } from '../lib/http.js';
import {
  trialCfg, kindCfg, normKind, nowSec, trialKey,
  getQuota, consumeUse, refundUse, activeUse,
  deviceAccountCount, countRecent, deriveIds, looksVirtual, checkWhitelist,
  KIND_1H, KIND_3D,
} from '../lib/trial-quota.js';

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

function ipOf(request) {
  return request.headers.get('cf-connecting-ip') || 'unknown';
}

function siteBase(request) {
  const u = new URL(request.url);
  return u.origin;
}

async function sha256hex(text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}

function randomHex(n) {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

/**
 * POST /api/trial/command { kind, guid, bios, cpu, vol, user }
 *
 * Trả 1 dòng lệnh CMD + mã trial. Khách chỉ cần dán vào CMD.
 */
export async function apiTrialCommand(env, request) {
  const ip = ipOf(request);

  // Body PHẢI parse được. Trước đây body rỗng/JSON hỏng -> {} -> vẫn cấp key.
  const raw = await readBody(request);
  if (!raw) {
    return json({
      ok: false, code: 'bad_request',
      msg: 'Dữ liệu gửi lên không hợp lệ',
    }, 400);
  }
  const body = raw;

  const cfg = await trialCfg(env);
  if (!cfg.enabled) {
    return json({ ok: false, code: 'trial_disabled', msg: 'Dùng thử đang tạm đóng' }, 403);
  }

  // kind PHẢI hợp lệ. Trước đây kind sai -> âm thầm dùng 3 ngày.
  if (body.kind !== undefined && body.kind !== null) {
    if (!normKind(body.kind)) {
      return json({
        ok: false, code: 'trial_kind_invalid',
        msg: 'Gói dùng thử không hợp lệ (chỉ có: 1h, 3d)',
      }, 400);
    }
  }
  const kind = normKind(body.kind) || KIND_3D;
  const kc = kindCfg(cfg, kind);
  if (!kc || !kc.enabled) {
    return json({ ok: false, code: 'trial_kind_invalid', msg: `Gói ${kind} không khả dụng` }, 400);
  }
  const label = kind === KIND_1H ? '1 giờ' : '3 ngày';

  // Rate limit riêng cho endpoint này.
  // Trước đây /api/trial/command KHÔNG có rate limit -> 200 request = 200 mã.
  try {
    const { rateLimit } = await import('../lib/ratelimit.js');
    await rateLimit(env, `tcmd:${ip}`, 150, 3600);
  } catch (e) {
    if (e && e.code === 'RATE_LIMITED') {
      return json({
        ok: false, code: 'rate_limit',
        msg: 'Bạn thao tác quá nhanh, thử lại sau ít phút',
      }, 429);
    }
    throw e;
  }

  // ---- Danh tính: ưu tiên tài khoản, fallback thiết bị ----
  let userId = null;
  let userLabel = null;
  try {
    const { getSessionUser } = await import('../lib/auth.js');
    const u = await getSessionUser(env, request);
    if (u) {
      userId = u.id;
      userLabel = u.username || u.email;
    }
  } catch { /* không có session */ }

  // Nếu không đăng nhập: neo theo thiết bị (nếu biết) hoặc IP
  let ids = null;
  const _p = [body.guid, body.bios, body.cpu, body.vol].map((x) =>
    String(x === undefined || x === null ? '' : x).trim());
  const _anySent = [body.guid, body.bios, body.cpu, body.vol].some(
    (x) => x !== undefined && x !== null);
  const _nonEmpty = _p.filter((x) => x.length > 0);

  // Gửi parts nhưng TẤT CẢ rỗng -> từ chối.
  // {guid:"",bios:"",cpu:"",vol:""} cho ra weak = sha256("w1|||") = HẰNG SỐ
  // -> mọi khách dùng chung 1 license (lỗ hổng identity collision).
  if (_anySent && _nonEmpty.length === 0) {
    return json({
      ok: false, code: 'bad_request',
      msg: 'Thông tin máy rỗng — chạy tool trực tiếp, đừng gọi API tay',
    }, 400);
  }

  const hasParts = _nonEmpty.length > 0;
  if (hasParts) {
    // Phải có ít nhất GUID hoặc BIOS/CPU thật sự, không chỉ volume serial
    if (!_p[0] && !_p[1] && !_p[2]) {
      return json({
        ok: false, code: 'bad_request',
        msg: 'Thiếu thông tin máy — chạy tool trực tiếp, đừng gọi API tay',
      }, 400);
    }
    ids = await deriveIds(_p);
    if (looksVirtual(ids.bios, ids.cpu)) {
      return json({
        ok: false, code: 'trial_denied_device',
        msg: 'Không hỗ trợ dùng thử trên máy ảo',
      }, 403);
    }
  }

  let deviceHash = null;
  if (!userId) {
    // Web không đọc được phần cứng. Neo danh tính theo thứ tự:
    //   1. device_id (localStorage) — NHƯNG phải gắn với IP
    //   2. weak HWID nếu có guid/bios
    //   3. IP
    //
    // QUAN TRỌNG: trước đây device_id đứng một mình -> khách xoá localStorage
    // hoặc gửi chuỗi ngẫu nhiên là "máy mới" -> 10 lượt mới. Test thật:
    // 15+ mã trong 1 phiên. Nay ghép device_id với IP nên đổi device_id
    // vẫn bị chặn bởi trần IP/ngày.
    let anchor;
    if (body.device_id) {
      const did = String(body.device_id).trim().slice(0, 64);
      if (/^[a-zA-Z0-9_-]{8,64}$/.test(did)) {
        deviceHash = (await sha256hex('d1|' + did)).slice(0, 32);
        // Ghép IP để không thể xoay device_id vô hạn trên cùng kết nối
        anchor = (await sha256hex('di|' + did + '|' + ip)).slice(0, 32);
        deviceHash = anchor;
      }
    }
    if (!anchor && ids && ids.weak) {
      anchor = ids.weak;
    }
    if (!anchor) {
      // Không có device_id và không có HWID -> dùng IP
      anchor = 'ip:' + ip;
    }
    userId = 'dev:' + anchor;
    userLabel = 'thiết bị';
  }

  // ---- WHITELIST: máy/tài khoản dev dùng vô hạn ----
  const wl = await checkWhitelist(env, {
    userId,
    hwid: ids ? ids.hwid : null,
    weak: ids ? ids.weak : null,
    deviceId: deviceHash,
    ip,
  });

  // ---- Đang có trial cùng loại → resume, không trừ lượt ----
  const active = await activeUse(env, userId, kind);
  if (active) {
    const q = wl.unlimited
      ? { left: wl.quota, quota: wl.quota, used: 0 }
      : await getQuota(env, userId, kind, kc.quota);
    return await issueCommand(env, request, {
      key: active.lic_key, kind, label, cfg, kc,
      left: q.left, quota: q.quota, used: q.used,
      resumed: true, userLabel, unlimited: wl.unlimited,
    });
  }

  // ---- Hạn mức IP / subnet / ngày (BỎ QUA nếu whitelist) ----
  if (!wl.unlimited && ip !== 'unknown') {
    const net = String(ip).split('.').slice(0, 3).join('.');
    const nIp = await countRecent(env, ip, net, nowSec() - 86400, { perIp: true });
    if (nIp >= cfg.maxPerIp) {
      return json({
        ok: false, code: 'trial_ip_limit',
        msg: 'Kết nối này đã dùng hết lượt dùng thử hôm nay. Thử lại ngày mai.',
      }, 429);
    }
    if (net.split('.').length === 3) {
      const nNet = await countRecent(env, ip, net, nowSec() - 30 * 86400, { perIp: false });
      if (nNet >= cfg.maxPerNet) {
        return json({
          ok: false, code: 'trial_ip_limit',
          msg: 'Mạng này đã dùng hết lượt dùng thử.',
        }, 429);
      }
    }
  }

  // ---- Hạn mức toàn hệ thống / ngày (BỎ QUA nếu whitelist) ----
  if (!wl.unlimited) {
    const nDay = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM trial_uses WHERE created_at > ?'
    ).bind(nowSec() - 86400).first();
    if ((nDay?.n || 0) >= cfg.maxPerDay) {
      return json({
        ok: false, code: 'trial_global_limit',
        msg: 'Hệ thống đạt giới hạn dùng thử hôm nay, thử lại ngày mai.',
      }, 429);
    }
  }

  // ---- Chống farm: 1 máy nhiều "tài khoản" (BỎ QUA nếu whitelist) ----
  if (!wl.unlimited && ids && ids.weak) {
    const maxAcc = kind === KIND_1H ? cfg.deviceAccounts1h : cfg.deviceAccounts3d;
    const accCount = await deviceAccountCount(env, ids.weak, kind, userId);
    if (accCount >= maxAcc) {
      return json({
        ok: false, code: 'trial_device_limit',
        msg: 'Máy này đã dùng thử cho nhiều tài khoản khác. '
          + 'Mua key để dùng không giới hạn.',
      }, 403);
    }
  }

  // ---- Trừ lượt (BỎ QUA nếu whitelist) ----
  let quota;
  if (wl.unlimited) {
    quota = { ok: true, used: 0, quota: wl.quota, left: wl.quota };
  } else {
    quota = await consumeUse(env, userId, kind, kc.quota);
    if (!quota.ok) {
      return json({
        ok: false, code: 'trial_quota_exhausted',
        msg: `Đã dùng hết ${quota.quota} lượt dùng thử ${label}. Mua key để tiếp tục.`,
        used: quota.used, quota: quota.quota, left: 0,
      }, 403);
    }
  }

  // Tạo mã + grant
  const key = trialKey();
  const useId = crypto.randomUUID();
  const now = nowSec();
  // CHỦ SHOP CHỐT: thời gian dùng thử tính NGAY TỪ LÚC TẠO MÃ,
  // không phải từ lúc chạy tool. Đơn giản, không phụ thuộc client.
  const expiresAt = now + kc.sec;
  const hwid = ids ? ids.hwid : null;
  const weak = ids ? ids.weak : null;

  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO licenses
           (key, hwid, plan, note, created_at, activated_at, expires_at,
            last_seen, last_ip, revoked, max_rebind, rebinds, source)
         VALUES (?,?, 'trial', ?,?, ?, ?, NULL, ?, 0, 0, 0, 'trial')`
      ).bind(key, hwid, `Trial ${kind} - ${userLabel || 'web'}`,
        now, now, expiresAt, ip),
      env.DB.prepare(
        `INSERT INTO trial_uses
           (id, user_id, kind, lic_key, hwid, device_weak, ip, ua,
            started_at, expires_at, created_at)
         VALUES (?,?,?,?,?,?,?,?, ?, ?, ?)`
      ).bind(useId, userId, kind, key, hwid, weak,
        ip, (request.headers.get('user-agent') || '').slice(0, 200),
        now, expiresAt, now),
    ]);
  } catch (e) {
    await refundUse(env, userId, kind);
    console.error('trial command issue:', e && e.message);
    return json({ ok: false, code: 'server_error', msg: 'Không tạo được mã dùng thử' }, 500);
  }

  return await issueCommand(env, request, {
    key, kind, label, cfg, kc,
    left: quota.left, quota: quota.quota, used: quota.used,
    resumed: false, userLabel, unlimited: wl.unlimited,
  });
}

/** Sinh token + lệnh CMD cho mã trial vừa cấp. */
async function issueCommand(env, request, { key, kind, label, cfg, kc, left, quota, used, resumed, userLabel, unlimited }) {
  const token = randomHex(24);
  const tokenHash = await sha256hex(token);
  const now = nowSec();

  // Dùng chung bảng install_tokens — token này cho phép tải + kích hoạt
  await env.DB.prepare(
    `INSERT INTO install_tokens (token_hash, key, user_id, created_at, expires_at)
     VALUES (?,?,?,?,?)`
  ).bind(tokenHash, key, 'trial-web', now, now + 86400).run();

  const base = siteBase(request);
  const cmdUrl = `${base}/i/${key}.cmd?t=${token}`;

  // MỘT DÒNG, khách chỉ dán vào CMD và Enter. Không nhập gì.
  const command = `curl -L -o "%TEMP%\\xa.cmd" "${cmdUrl}" && "%TEMP%\\xa.cmd"`;

  return json({
    ok: true,
    key,
    kind,
    label,
    resumed,
    // Không trả "unlimited"/quota nội bộ ra cho khách:
    // trước đây response công khai lộ quota:999999 và unlimited:true
    // -> khách thấy "999999 lượt" (vô lý) và biết ai trong whitelist.
    left: unlimited ? null : left,
    quota: unlimited ? null : quota,
    command,
    oneLiner: `powershell -NoProfile -ExecutionPolicy Bypass -Command "iex (irm ${base}/i/${key}.ps1?t=${token})"`,
    cmdUrl,
    downloadUrl: `${base}/download/xa_nofog_pro.exe`,
    expiresIn: 86400,
    minutes: Math.round(kc.sec / 60),
    days: Math.round(kc.sec / 86400),
    userLabel,
    hint: 'Mở CMD (Win+R → cmd) → dán lệnh → Enter → bấm Yes khi Windows hỏi quyền.',
  });
}
