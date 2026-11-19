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
  getQuota, consumeUse, refundUse,
  getQuotaHw, consumeUseHw, refundUseHw,
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
  /*
   * SAN PHAM: 'nofog' (XARENA MAP SANG) hoac 'xagrant' (XA THEM TAI NGUYEN).
   * Mac dinh nofog de khong pha vo client cu chua gui truong nay.
   *
   * Truoc day trial CHI co No Fog, khach mua grant khong dung thu duoc.
   */
  const rawProduct = String(body.product || body.app || '').trim().toLowerCase();
  const product = (rawProduct === 'xagrant' || rawProduct === 'xg'
                   || rawProduct === 'grant') ? 'xagrant' : 'nofog';
  const productPid = product === 'xagrant' ? 'xagrant' : null;
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
    //   1. weak HWID (server tự băm từ parts) — KHÔNG phụ thuộc chuỗi client chọn
    //   2. device_id (localStorage) — chỉ dùng khi KHÔNG có phần cứng, và phải
    //      ghép IP
    //   3. IP
    //
    // QUAN TRỌNG: trước đây device_id đứng một mình -> khách xoá localStorage
    // hoặc gửi chuỗi ngẫu nhiên là "máy mới" -> 10 lượt mới. Test thật:
    // 15+ mã trong 1 phiên.
    //
    // AUDIT #2: device_id là CHUỖI DO CLIENT CHỌN, nên mọi hạn mức neo vào nó
    // đều xoay được (xoá localStorage = bucket mới). Nay đảo thứ tự: khi khách
    // có gửi parts thì neo THẲNG vào `weak` (server băm guid|bios|cpu).
    // `weak` KHÔNG chứa volume serial, nên chỉ xoay `vol` (cách làm phổ biến
    // để lách HWID) cũng không tạo bucket mới.
    //
    // Giới hạn nào THẬT SỰ BINDING (nói rõ để vận hành khỏi đoán):
    //   - Có phần cứng   -> hạn mức hwid (trial_quota_hw) + trần /24/ngày.
    //   - Không phần cứng -> trần /24/ngày (cfg.maxPerNet24) là BINDING; IP
    //     (cfg.maxPerIp) và trần ngày toàn hệ thống là lớp phụ.
    // Nhờ vậy xoá localStorage chỉ đổi `device_id` — bucket và trần IP không đổi.
    let anchor = null;
    if (ids && ids.weak) {
      anchor = 'hw:' + ids.weak;
    }
    if (body.device_id) {
      const did = String(body.device_id).trim().slice(0, 64);
      if (/^[a-zA-Z0-9_-]{8,64}$/.test(did)) {
        // Giữ NGUYÊN công thức cũ cho whitelist scope='device' (đã phát hành).
        deviceHash = (await sha256hex('di|' + did + '|' + ip)).slice(0, 32);
        if (!anchor) {
          // Không có phần cứng: đây chỉ là chuỗi client tự chọn, ghép IP để
          // bớt xoay vòng. Trần /24 + trần ngày bên dưới mới là chốt thật.
          anchor = deviceHash;
        }
      }
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

  /*
   * ------------------------------------------------------------------
   * MỖI LẦN BẤM = MỘT MÃ MỚI. KHÔNG TRẢ LẠI MÃ CŨ.
   *
   * LỖI ĐÃ SỬA: trước đây nếu thiết bị đang có trial cùng loại còn hạn
   * thì API trả lại CHÍNH MÃ ĐÓ (`resumed: true`). Đo được: bấm 3 lần
   * được đúng 1 mã. Chủ shop yêu cầu mã nào cũng phải mới.
   *
   * Nay: bỏ hoàn toàn nhánh resume ở đây. Mỗi lần gọi đều cấp mã mới và
   * trừ 1 lượt (đúng như cảm nhận của khách: bấm là có mã).
   *
   * Mã cũ KHÔNG bị huỷ — khách đã lỡ dùng thì vẫn dùng tiếp tới hết giờ.
   * ------------------------------------------------------------------
   */
  // (đã bỏ resume — luôn cấp mã mới bên dưới)

  // ---- Hạn mức IP / subnet / ngày (BỎ QUA nếu whitelist) ----
  //
  // Thứ tự dưới đây là thứ tự CHẶT DẦN. `trial_uses.ip` do Cloudflare điền
  // (cf-connecting-ip) nên ba bộ đếm này KHÔNG phụ thuộc bất kỳ dữ liệu nào
  // client gửi lên — đây là các lớp chặn farm thật sự (audit #2).
  if (!wl.unlimited && ip !== 'unknown') {
    const net = String(ip).split('.').slice(0, 3).join('.');
    // (a) Trần theo ĐÚNG IP trong 24h.
    const nIp = await countRecent(env, ip, net, nowSec() - 86400, { perIp: true });
    if (nIp >= cfg.maxPerIp) {
      return json({
        ok: false, code: 'trial_ip_limit',
        msg: 'Kết nối này đã dùng hết lượt dùng thử hôm nay. Thử lại ngày mai.',
      }, 429);
    }
    if (net.split('.').length === 3) {
      /*
       * (b) TRẦN /24 TRONG 24 GIỜ — cấu hình MỚI `trial_max_per_net24_day`
       *     (mặc định 60).
       *
       * Vì sao cần: trước đây chỉ có trần /24 trong 30 NGÀY (mục c). Kẻ farm
       * đổi IP trong cùng /24 (hoặc dùng CGNAT/4G) vẫn lấy được 60 mã/30 ngày
       * rồi xoay tiếp; còn hạn mức 10 lượt thì neo vào `device_id` — chuỗi
       * client tự chọn, xoá localStorage là bucket mới.
       *
       * Nay: 60 mã / 24 giờ / /24. Đây là trần BINDING cho mọi client không
       * gửi được phần cứng thật.
       */
      const nNet24 = await countRecent(env, ip, net, nowSec() - 86400, { perIp: false });
      if (nNet24 >= cfg.maxPerNet24) {
        return json({
          ok: false, code: 'trial_net_limit',
          msg: 'Mạng này đã dùng hết lượt dùng thử trong 24 giờ. Thử lại ngày mai.',
        }, 429);
      }
      // (c) Trần /24 trong 30 ngày (chống farm trường kỳ trên cùng dải mạng).
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
  //
  // ĐÃ KIỂM CHỨNG (audit #2): trần này có hiệu lực thật — nó đếm trên bảng
  // `trial_uses` mà chính route này vừa ghi, và KHÔNG lọc theo bất kỳ dữ liệu
  // client nào. Giới hạn đã biết: đây là đọc rồi mới ghi (không nguyên tử),
  // nên một cụm request ĐỒNG THỜI có thể vượt trần vài đơn vị; trần /24 và
  // trần theo IP ở trên (cũng dạng đếm) thu hẹp đúng cụm đó. Sai số này
  // không cho phép farm số lượng lớn.
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
  //
  // ĐẾM THEO PHẦN CỨNG TRƯỚC: HWID là khoá chính. Khách xoá cookie hoặc
  // tạo tài khoản mới vẫn là cùng máy -> không lấy thêm được lượt.
  // Không có HWID (không đọc được phần cứng) -> fallback user_id như cũ.
  let quota;
  let quotaByHw = false;
  /*
   * ------------------------------------------------------------------
   * KHOÁ HẠN MỨC LÀ **MÁY** (hwid), KHÔNG PHẢI TÀI KHOẢN.
   *
   * `quotaKind` phải khai báo Ở ĐÂY (ngoài khối else) — trước đây nó là
   * `const` bên trong khối else nên khối `catch` bên dưới không thấy, và
   * nhánh hoàn lượt khi ghi CSDL lỗi ném ReferenceError thay vì hoàn lượt
   * (khách bị trừ oan 1 lượt dùng thử).
   * ------------------------------------------------------------------
   */
  const quotaKind = product === 'xagrant' ? `${kind}:xagrant`
                                           : `${kind}:nofog`;
  if (wl.unlimited) {
    quota = { ok: true, used: 0, quota: wl.quota, left: wl.quota };
  } else {
    // ------------------------------------------------------------------
  // QUOTA TÁCH RIÊNG THEO SẢN PHẨM.
  //
  // LỖI ĐÃ SỬA: `trial_quota_hw` khoá bằng (hwid, kind) — KHÔNG có sản
  // phẩm. Nên 10 lượt dùng thử bị CHIA SẺ giữa map sáng và tài nguyên:
  // thử map sáng 7 lượt thì tài nguyên chỉ còn 3.
  // Chủ shop yêu cầu "giới hạn tài nguyên 10 lần" — tức mỗi sản phẩm
  // phải có 10 lượt riêng.
  //
  // Nay ghép sản phẩm vào khoá: '1h:nofog' / '1h:xagrant'.
  //
  // NGƯỜI DÙNG KHÔNG NẰM TRONG KHOÁ: `consumeUseHw(env, hwid, ...)` chỉ nhận
  // (hwid, kind). Đăng nhập bằng tài khoản khác trên CÙNG MÁY vẫn tiêu
  // chung 10 lượt của máy đó — đúng yêu cầu "chỉ được 10 lần 1 máy".
  // ------------------------------------------------------------------
  const hwidForQuota = (ids && ids.hwid) ? String(ids.hwid) : '';
    if (hwidForQuota) {
      const qhw = await consumeUseHw(env, hwidForQuota, quotaKind,
                                     kc.quota);
      if (qhw) {
        quota = qhw;
        quotaByHw = true;
      }
    }
    if (!quota) {
      quota = await consumeUse(env, userId, kind, kc.quota);
    }
    if (!quota.ok) {
      return json({
        ok: false, code: 'trial_quota_exhausted',
        msg: `Máy này đã dùng hết ${quota.quota} lượt ${label}. Mua key để tiếp tục.`,
        used: quota.used, quota: quota.quota, left: 0,
      }, 403);
    }
  }

  // Tạo mã + grant
  const key = trialKey();
  const useId = crypto.randomUUID();
  const now = nowSec();
  /*
   * ĐỒNG HỒ BẮT ĐẦU TỪ LÚC **TẢI**, KHÔNG phải lúc tạo mã.
   *
   * Trước đây: `expiresAt = now + kc.sec` và `activated_at = now` ngay khi
   * tạo -> khách mất 15 phút đọc hướng dẫn là chỉ còn 45 phút dùng thử.
   * Tệ hơn: nếu khách tải bộ cài rồi mới cài, thời gian chờ tải (7-9 MB)
   * cũng bị trừ vào 1 giờ.
   *
   * Nay: grant vào trạng thái GIỮ (hold) như đường đăng nhập:
   *   started_at = NULL, expires_at = now + holdSec
   * Đồng hồ thật bắt đầu ở nơi BIẾT HWID của máy khách — /api/trial/claim
   * (trial.js) hoặc /api/check (license-server.js) — KHÔNG phải lúc tải bộ
   * cài nữa: handler tải bộ cài không biết HWID nên trước đây nó bật đồng hồ
   * mà vẫn để hwid = NULL (mã chia sẻ được, audit #6).
   *
   * Giữ (hold) vẫn có hạn để mã không tồn tại vĩnh viễn.
   */
  const holdUntil = now + cfg.holdSec;
  const hwid = ids ? ids.hwid : null;
  const weak = ids ? ids.weak : null;

  try {
    await env.DB.batch([
      /*
       * max_rebind = 1 (audit #5): mã dùng thử cũng phải có ĐÚNG 1 lượt đổi
       * máy. Trước đây 0 -> khách cài lại Windows (GUID đổi) là mã chết vĩnh
       * viễn, không có đường cứu nào; trong khi luồng đổi máy của web vẫn
       * hiển thị "còn 0 lượt". 1 lượt là đủ cho một lần cài lại máy và vẫn
       * chặn chia sẻ mã.
       */
      env.DB.prepare(
        `INSERT INTO licenses
           (key, hwid, plan, pid, note, created_at, activated_at, expires_at,
            last_seen, last_ip, revoked, max_rebind, rebinds, source, app)
         VALUES (?,?, 'trial', ?, ?,?, NULL, ?, NULL, ?, 0, 1, 0, 'trial', ?)`
      ).bind(key, hwid, productPid,
        `Trial ${kind} - ${product} - ${userLabel || 'web'}`,
        now, holdUntil, ip, product),
      env.DB.prepare(
        `INSERT INTO trial_uses
           (id, user_id, kind, lic_key, hwid, device_weak, ip, ua,
            started_at, expires_at, created_at)
         VALUES (?,?,?,?,?,?,?,?, NULL, ?, ?)`
      ).bind(useId, userId, kind, key, hwid, weak,
        ip, (request.headers.get('user-agent') || '').slice(0, 200),
        holdUntil, now),
    ]);
  } catch (e) {
    if (quotaByHw && ids && ids.hwid) {
      await refundUseHw(env, ids.hwid, quotaKind);
    } else {
      await refundUse(env, userId, kind);
    }
    console.error('trial command issue:', e && e.message);
    return json({ ok: false, code: 'server_error', msg: 'Không tạo được mã dùng thử' }, 500);
  }

  return await issueCommand(env, request, {
    key, kind, label, cfg, kc,
    left: quota.left, quota: quota.quota, used: quota.used,
    resumed: false, userLabel, unlimited: wl.unlimited, product,
    quotaByHw: quotaByHw,
  });
}

/** Sinh token + lệnh CMD cho mã trial vừa cấp. */
async function issueCommand(env, request, { key, kind, label, cfg, kc, left,
                                              quota, used, resumed, userLabel,
                                              unlimited, product,
                                              quotaByHw }) {
  /*
   * KHÔNG sinh mã hex nào nữa.
   *
   * CHỦ SHOP CHỐT: khách chỉ dùng MỘT chuỗi = license key
   * (TR-XXXX-XXXX-XXXX cho dùng thử).
   *
   * LỖI ĐÃ SỬA: trước đây hàm này sinh token 48 hex, ghi vào install_tokens,
   * rồi trả `token`, `command`, `oneLiner`, `cmdUrl` ra cho khách. Khách thấy
   * mã hex ở modal dùng thử nhưng lại thấy key ở trang Đơn hàng -> dán nhầm.
   *
   * Nay: bộ cài nhận key trực tiếp qua /api/install-info?key=... nên KHÔNG
   * cần token nữa. Bớt hẳn một dòng trong install_tokens mỗi lần dùng thử.
   */
  const base = siteBase(request);
  const isXg = product === 'xagrant';

  return json({
    ok: true,
    key,
    kind,
    label,
    resumed,
    product: isXg ? 'xagrant' : 'nofog',
    app: isXg ? 'xagrant' : 'nofog',
    // KHÔNG còn bộ cài. Một file duy nhất: xa_arena.exe.
    setupUrl: `${base}/download/xa_arena.exe`,
    appUrl: `${base}/download/xa_arena.exe`,
    // Không trả "unlimited"/quota nội bộ ra cho khách:
    // trước đây response công khai lộ quota:999999 và unlimited:true
    // -> khách thấy "999999 lượt" (vô lý) và biết ai trong whitelist.
    left: unlimited ? null : left,
    quota: unlimited ? null : quota,
    // Cho tool biết đếm theo phần cứng hay theo tài khoản
    quota_by: quotaByHw ? 'hwid' : 'account',
    downloadUrl: `${base}/download/xa_arena.exe`,
    minutes: Math.round(kc.sec / 60),
    days: Math.round(kc.sec / 86400),
    userLabel,
    hint: 'Tải bộ cài, dán key ở trên vào ô rồi bấm Cài đặt. Không cần CMD.',
  });
}
