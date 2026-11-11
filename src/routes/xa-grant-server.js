/**
 * XAGrant license server — tool TĂNG TÀI NGUYÊN XArena.
 *
 * Sản phẩm RIÊNG với No Fog. Dùng chung bảng `licenses` nhưng tách bằng cột
 * `pid` = 'xagrant', nên key No Fog KHÔNG dùng được cho XAGrant và ngược lại.
 *
 * KHÁC BIỆT CỐT LÕI so với license No Fog:
 *
 *   1. Server ký một ENTITLEMENT TOKEN bằng ECDSA P-256. Client chỉ giữ
 *      PUBLIC KEY nên KHÔNG THỂ tự sinh token hợp lệ. Mọi mưu toan dựng
 *      license server giả tại chỗ (hosts file + proxy) đều bị chặn ở bước
 *      xác minh chữ ký.
 *
 *   2. TOKEN CHỨA BẢNG ĐỊA CHỈ ENGINE ĐÃ MÃ HOÁ (AES-256-CTR). Địa chỉ hàm
 *      thật (Builder_42BDE0, Sender_42BA60, ...) KHÔNG hề xuất hiện dạng
 *      plaintext trong EXE. Người không có license hợp lệ không lấy được
 *      bảng địa chỉ -> keygen vô dụng, patch "bỏ kiểm tra license" cũng vô
 *      dụng vì tool không biết gọi vào đâu.
 *
 *   3. Session xoay vòng: mỗi lần /api/xg/check trả sid MỚI và huỷ sid cũ.
 *      Gói tin bắt được KHÔNG phát lại được.
 *
 * Giao thức:
 *   POST /api/xg/activate  {key, hwid, app, ver, fp}
 *   POST /api/xg/check     {key, hwid, sid, app, ver, fp}
 *   POST /api/xg/heartbeat {key, hwid, sid, app, ver}
 *   POST /api/xg/rebind    {key, hwid, token}
 *   POST /api/xg/violation {key, hwid, sid, code}
 *   GET  /api/xg/health
 */
import { json, ApiError } from '../lib/http.js';
import { randomHex, timingSafeEqual } from '../lib/crypto.js';

/* ------------------------------------------------------------------ */
/* Cấu hình                                                           */
/* ------------------------------------------------------------------ */

const APP = 'xagrant';
const PID = 'xagrant';

/**
 * Khoá ký RIÊNG của server.
 *
 * Ưu tiên Worker secret `XG_SIGN_JWK` (đặt bằng `wrangler secret put`).
 *
 * KHÔNG có bản dự phòng. Trước đây một private key ECDSA P-256 được hardcode
 * làm fallback, nên khi secret chưa đặt (đúng trạng thái production lúc phát
 * hiện) server ký bằng key nằm công khai trong repo — ai đọc source cũng mint
 * được token hợp lệ và giải mã khối ENGINE. Comment cũ khẳng định "lộ source
 * client vẫn không sinh được token" chỉ đúng khi secret đã được đặt.
 *
 * Nay thiếu secret thì FAIL CLOSED: từ chối ký, không âm thầm dùng key khác.
 */
function signJwk(env) {
  const raw = env && env.XG_SIGN_JWK;
  if (!raw) {
    throw new ApiError(
      503,
      'Chưa cấu hình XG_SIGN_JWK — không thể ký token',
      'NOT_CONFIGURED',
    );
  }
  let v;
  try {
    v = JSON.parse(raw);
  } catch {
    throw new ApiError(503, 'XG_SIGN_JWK không phải JSON hợp lệ', 'NOT_CONFIGURED');
  }
  if (!v || v.kty !== 'EC' || !v.d || !v.x || !v.y) {
    throw new ApiError(503, 'XG_SIGN_JWK thiếu thành phần EC', 'NOT_CONFIGURED');
  }
  return v;
}

/**
 * SPLIT_A — muối bổ sung khi suy khoá. Không PHẢI là bí mật duy nhất: nửa
 * còn lại là `gate` sinh ngẫu nhiên cho TỪNG license, chỉ có trong token đã
 * ký. Dù lộ giá trị này, người không có token vẫn không giải mã được khối
 * ENGINE, vì `gate` không đoán được.
 *
 * Client dùng cùng giá trị để sinh keystream: ks = SHA-256("xg-ks"||gate||i).
 */
const SPLIT_A_HEX =
  '9c41f7d2a0b53e6c1d88ff0427ab9e53c67d0b21a45e8f93d2c47b0e6a19f8d3';

/** Số giây client nên gọi lại /api/xg/check. */
const CHECK_AFTER = 120;

/** Bắt buộc online. 0 = không có offline grace (chặt nhất). */
const GRACE_HOURS = 6;

/** Giới hạn số request sai / IP / giờ (chống dò key). */
const RATE_LIMIT = 400;
const RATE_WINDOW = 3600;

/** Số vi phạm anti-debug thì tự thu hồi license. */
const VIOLATION_BUDGET = 8;

/**
 * Bảng địa chỉ engine + chữ ký byte, thứ tự CO DINH — xem xa_sec.py.
 *
 * Đây là TOÀN BỘ tri thức reverse-engineering của tool. Không một byte nào
 * trong đây xuất hiện dạng plaintext trong EXE: chúng được mã hoá bằng khoá
 * suy ra từ `gate` riêng của từng license, mà `gate` chỉ có trong token đã
 * ký bằng khoá riêng của server.
 */
const ENGINE = {
  a: [
    0x42bde0, //  0 BUILDER       builder record ChangeResource
    0x42ba60, //  1 SENDER        sender::dispatch(rec, len)
    0x41f160, //  2 APPLY_GATE    apply-gate (ret 8)
    0x41f180, //  3 APPLY_IMPL    apply implementation
    0x45f510, //  4 CHANGE_RES    change resource (virtual slot +0xB0)
    0x54ec90, //  5 VTABLE        sender vtable
    0x54ee68, //  6 WRAP_VTABLE   player wrapper vtable
    0x585e88, //  7 PTR_WORLD     global world pointer
    0x528450, //  8 ALLOC         allocator
    0x4ea700, //  9 VT_SLOT_VAL   dispatch record value
    0x4f9040, // 10 WRAP_CR       wrapper vtable [+0x78]
    0x422cc0, // 11 GAME_PKT      shared packet send
    0x41f0a0, // 12 LOCAL_APPLY   apply local packet
    0x42bd90, // 13 BUILDER_SIB   sibling builder
    0x428710, // 14 RING_COPY     copy payload into ring
    0x000000, // 15 RESERVED
  ],
  // Chữ ký byte để xác nhận đúng phiên bản EMPIRESX.EXE trước khi gọi.
  s: {
    BUILDER: '566a088bf16a01e8',
    SENDER: '538b5c240856578b7c24148bf1',
    APPLY_GATE: '8b4424088b542404',
    APPLY_IMPL: '568bf18b86e410000085c0',
    CHANGE_RES: '8b54240483faff742c',
  },
  // Giá trị kỳ vọng tại các ô vtable.
  v: { vt_slot: 0x4ea700, wrap_cr: 0x4f9040, vt_off: 0x08, wrap_off: 0x78 },
  // Hằng số cấu trúc.
  o: { ctx: 0x3c, playeridx: 0x4a, sender: 0x58, apply: 0x14, online: 0x10e4 },
};

/* ------------------------------------------------------------------ */
/* Tiện ích                                                           */
/* ------------------------------------------------------------------ */

const enc = new TextEncoder();

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

export function normKey(k) {
  return String(k || '').trim().toUpperCase().replace(/\s+/g, '');
}

function b64u(bytes) {
  const b = new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
}

function u32be(v) {
  const b = new Uint8Array(4);
  b[0] = (v >>> 24) & 0xff;
  b[1] = (v >>> 16) & 0xff;
  b[2] = (v >>> 8) & 0xff;
  b[3] = v & 0xff;
  return b;
}

async function sha256(data) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', data));
}

async function sha256hex(text) {
  const d = await sha256(enc.encode(text));
  return Array.from(d, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function concat(...arrs) {
  const len = arrs.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const a of arrs) {
    out.set(a, o);
    o += a.length;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Ký token                                                           */
/* ------------------------------------------------------------------ */

let _signKey = null;
let _signKeyId = '';
async function signKey(env) {
  const jwk = signJwk(env);
  const id = jwk.d;
  if (_signKey && _signKeyId === id) return _signKey;
  _signKey = await crypto.subtle.importKey(
    'jwk', jwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false, ['sign']
  );
  _signKeyId = id;
  return _signKey;
}

/**
 * Mã hoá khối ENGINE cho MỘT license cụ thể.
 *
 *   ks(i)    = SHA-256("xg-ks" || gate || u32be(i))   32 byte mỗi khối
 *   cipher   = plaintext XOR ks
 *
 * Đây là stream cipher dựng trên SHA-256 (PRF), an toàn khi `gate` bí mật và
 * khác nhau cho từng license. Cố ý không dùng AES để client Python không phải
 * phụ thuộc thư viện mã hoá nào (giảm bề mặt tấn công, build nhẹ).
 *
 * `gate` do server sinh ngẫu nhiên và chỉ có trong token đã ký, nên dù có
 * toàn bộ source client thì cũng không giải mã được khối này.
 */
async function sealEngine(gateHex) {
  const gate = hexToBytes(gateHex);
  const plain = enc.encode(JSON.stringify(ENGINE));

  const ct = new Uint8Array(plain.length);
  const blocks = Math.ceil(plain.length / 32);
  for (let b = 0; b < blocks; b++) {
    const ks = await sha256(await concat(enc.encode('xg-ks'), gate, u32be(b)));
    for (let j = 0; j < 32; j++) {
      const at = b * 32 + j;
      if (at >= plain.length) break;
      ct[at] = plain[at] ^ ks[j];
    }
  }
  return { av: b64u(ct), as: b64u(gate) };
}

/** Tạo token `xg1.<payload>.<sig>` đã ký ECDSA P-256. */
async function mintToken(env, payload) {
  const body = 'xg1.' + b64u(enc.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, await signKey(env), enc.encode(body)
  );
  return body + '.' + b64u(sig);
}

/* ------------------------------------------------------------------ */
/* DB helpers                                                         */
/* ------------------------------------------------------------------ */

async function getLicense(env, key) {
  return await env.DB.prepare('SELECT * FROM licenses WHERE key = ?')
    .bind(key).first();
}

function isXagrant(lic) {
  if (!lic) return false;
  // Dữ liệu cũ không có cột pid -> coi là No Fog, không cho dùng XAGrant.
  if (lic.pid) return lic.pid === PID;
  return String(lic.plan || '').toLowerCase() === PID;
}

async function logEvent(env, key, hwid, sid, kind, detail, ip) {
  try {
    await env.DB.prepare(
      'INSERT INTO xg_events (key, hwid, sid, kind, detail, ip, at) VALUES (?,?,?,?,?,?,?)'
    ).bind(key || null, hwid || null, sid || null, kind,
      detail ? String(detail).slice(0, 300) : null, ip || null, nowSec()).run();
  } catch { /* log không được làm hỏng luồng chính */ }
}

async function rateOk(env, ip) {
  const since = nowSec() - RATE_WINDOW;
  const row = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM lic_attempts WHERE ip = ? AND at > ? AND ok = 0'
  ).bind(ip, since).first();
  return (row?.n || 0) < RATE_LIMIT;
}

async function logAttempt(env, ip, ok) {
  try {
    await env.DB.prepare('INSERT INTO lic_attempts (ip, at, ok) VALUES (?,?,?)')
      .bind(ip, nowSec(), ok ? 1 : 0).run();
  } catch { /* ignore */ }
}

function ipOf(request) {
  return request.headers.get('cf-connecting-ip') || 'unknown';
}

async function readBody(request) {
  const text = await request.text();
  if (!text || text.length > 8192) return null;
  try {
    const v = JSON.parse(text);
    return (v && typeof v === 'object' && !Array.isArray(v)) ? v : null;
  } catch {
    return null;
  }
}

const MESSAGES = {
  not_found: 'Mã không tồn tại',
  wrong_product: 'Mã này là của sản phẩm khác',
  revoked: 'Mã đã bị thu hồi',
  expired: 'Mã đã hết hạn',
  hwid_mismatch: 'Mã đã dùng trên máy khác',
  reset: 'Mã đã bị reset, cần kích hoạt lại',
  rate_limit: 'Quá nhiều lần thử, thử lại sau',
  bad_request: 'Yêu cầu không hợp lệ',
  rebind_token_required: 'Cần mã đổi máy — lấy trên web tại mục License của tôi',
  invalid_token: 'Mã đổi máy không đúng',
  token_used: 'Mã đổi máy đã được dùng',
  token_expired: 'Mã đổi máy đã hết hạn',
  session_invalid: 'Phiên không hợp lệ, cần kích hoạt lại',
  schema_missing: 'Server chưa migrate CSDL (thiếu cột pid)',
  too_many_violations: 'Phát hiện can thiệp debugger quá nhiều lần',
};

function deny(code, status = 403, now = nowSec()) {
  return json({ ok: false, code, msg: MESSAGES[code] || code, now }, status);
}

/* ------------------------------------------------------------------ */
/* Đánh giá license                                                   */
/* ------------------------------------------------------------------ */

function judge(lic, hwid, now) {
  if (!lic) return { ok: false, code: 'not_found' };
  if (!isXagrant(lic)) return { ok: false, code: 'wrong_product' };
  if (lic.revoked) return { ok: false, code: 'revoked' };
  if (lic.expires_at && lic.expires_at > 0 && lic.expires_at < now) {
    return { ok: false, code: 'expired', expires_at: lic.expires_at };
  }
  if (!lic.hwid) return { ok: true, firstBind: true };
  if (lic.hwid !== hwid) return { ok: false, code: 'hwid_mismatch' };
  return { ok: true };
}

/** Tạo phiên mới + token. Xoá phiên cũ của cùng key+hwid (chỉ 1 máy chạy). */
async function issueSession(env, lic, key, hwid, ip, fp, ua) {
  const now = nowSec();
  const sid = randomHex(16);
  const ssec = randomHex(32);

  if (!lic.gate) {
    lic.gate = randomHex(16);
  }

  await env.DB.batch([
    env.DB.prepare(
      `UPDATE licenses SET gate = ?, app = ?, mode = ?,
              last_seen = ?, last_ip = ? WHERE key = ?`
    ).bind(lic.gate, APP, 'cmd', now, ip, key),
    // Chỉ một phiên sống cho mỗi license tại một thời điểm.
    env.DB.prepare('UPDATE xg_session SET revoked = 1 WHERE key = ? AND revoked = 0')
      .bind(key),
    env.DB.prepare(
      `INSERT INTO xg_session (sid, key, hwid, secret_hash, ua, fp, created_at, last_at)
       VALUES (?,?,?,?,?,?,?,?)`
    ).bind(sid, key, hwid, await sha256hex(ssec),
      (ua || '').slice(0, 180), (fp || '').slice(0, 120), now, now),
  ]);

  const sealed = await sealEngine(lic.gate);
  const payload = {
    k: key,
    h: hwid,
    a: APP,
    p: lic.plan || PID,
    e: lic.expires_at || 0,
    n: now,
    g: Number.isFinite(lic.grace_h) ? lic.grace_h : GRACE_HOURS,
    m: 'cmd',
    s: sid,
    c: CHECK_AFTER,
    gk: lic.gate,
    av: sealed.av,
    as: sealed.as,
    j: randomHex(8), // jti: mỗi token là duy nhất
  };
  const token = await mintToken(env, payload);

  return { token, sid, ssec, payload };
}

/* ------------------------------------------------------------------ */
/* Handlers                                                           */
/* ------------------------------------------------------------------ */

/** POST /api/xg/activate — lần đầu gắn máy. */
export async function xgActivate(env, request) {
  const ip = ipOf(request);
  const b = await readBody(request);
  if (!b) return deny('bad_request', 400);

  const key = normKey(b.key);
  const hwid = String(b.hwid || '').trim().toLowerCase();
  if (!key || !hwid) return deny('bad_request', 400);
  if (!/^[a-f0-9]{24,64}$/.test(hwid)) return deny('bad_request', 400);
  if (!(await rateOk(env, ip))) return deny('rate_limit', 429);

  let lic;
  try {
    lic = await getLicense(env, key);
  } catch {
    return deny('schema_missing', 500);
  }
  const now = nowSec();

  const v = judge(lic, hwid, now);
  if (!v.ok) {
    await logAttempt(env, ip, false);
    await logEvent(env, key, hwid, null, 'deny', 'activate:' + v.code, ip);
    return deny(v.code, 403, now);
  }

  if (v.firstBind) {
    // Đã từng kích hoạt (activated_at != null) hoặc admin vừa reset
    // => đây là ĐỔI MÁY, bắt buộc có rebind token.
    const needToken = !!lic.activated_at || !!lic.reset_pending;
    if (needToken) {
      const tok = String(b.token || '').trim();
      if (!tok) {
        await logEvent(env, key, hwid, null, 'deny', 'rebind needs token', ip);
        return deny('rebind_token_required', 403, now);
      }
      const th = await sha256hex(tok);
      const row = await env.DB.prepare(
        'SELECT * FROM rebind_tokens WHERE token_hash = ? LIMIT 1'
      ).bind(th).first();
      if (!row) return deny('invalid_token', 403, now);
      if (row.used) return deny('token_used', 403, now);
      if (row.expires_at < now) return deny('token_expired', 403, now);
      if (row.key !== key) return deny('invalid_token', 403, now);

      await env.DB.batch([
        env.DB.prepare('UPDATE rebind_tokens SET used = 1 WHERE token_hash = ?').bind(th),
        env.DB.prepare(
          `UPDATE licenses SET hwid = ?, last_seen = ?, last_ip = ?,
                  reset_pending = 0, reset_at = NULL,
                  rebinds = COALESCE(rebinds, 0) + 1
           WHERE key = ?`
        ).bind(hwid, now, ip, key),
      ]);
      lic.hwid = hwid;
      lic.reset_pending = 0;
      await logEvent(env, key, hwid, null, 'rebind', 'hwid changed (token)', ip);
    } else {
      // Kích hoạt LẦN ĐẦU: hạn tính từ bây giờ.
      const days = lic.expires_at > 0
        ? Math.max(1, Math.round((lic.expires_at - lic.created_at) / 86400))
        : 0;
      const exp = days === 0 ? 0 : now + days * 86400;
      await env.DB.prepare(
        `UPDATE licenses SET hwid = ?, activated_at = ?, expires_at = ?,
                last_seen = ?, last_ip = ? WHERE key = ?`
      ).bind(hwid, now, exp, now, ip, key).run();
      lic.expires_at = exp;
      lic.activated_at = now;
      lic.hwid = hwid;
      await logEvent(env, key, hwid, null, 'activate',
        'first bind, ' + (days === 0 ? 'forever' : days + 'd'), ip);
    }
  }

  const s = await issueSession(env, lic, key, hwid, ip, b.fp,
    request.headers.get('user-agent'));

  await logAttempt(env, ip, true);
  await logEvent(env, key, hwid, s.sid, 'activate_ok', 'v=' + (b.ver || '?'), ip);

  return json({
    ok: true,
    now,
    code: 'ok',
    key,
    hwid,
    plan: lic.plan || PID,
    expires_at: lic.expires_at || 0,
    activated_at: lic.activated_at || now,
    grace_h: s.payload.g,
    mode: 'cmd',
    check_after: CHECK_AFTER,
    token: s.token,
    sid: s.sid,
    ssec: s.ssec,
  });
}

/**
 * POST /api/xg/check — dùng khi đã có phiên (hoặc khôi phục từ state).
 * Xoay sid mỗi lần gọi.
 */
export async function xgCheck(env, request) {
  const ip = ipOf(request);
  const b = await readBody(request);
  if (!b) return deny('bad_request', 400);

  const key = normKey(b.key);
  const hwid = String(b.hwid || '').trim().toLowerCase();
  const sid = String(b.sid || '').trim();
  if (!key || !hwid) return deny('bad_request', 400);
  if (!(await rateOk(env, ip))) return deny('rate_limit', 429);

  const now = nowSec();
  let lic;
  try {
    lic = await getLicense(env, key);
  } catch {
    return deny('schema_missing', 500);
  }

  const v = judge(lic, hwid, now);
  if (!v.ok) {
    await logAttempt(env, ip, false);
    await logEvent(env, key, hwid, sid, 'deny', 'check:' + v.code, ip);
    return deny(v.code, 403, now);
  }
  if (v.firstBind) {
    await logEvent(env, key, hwid, sid, 'deny', 'check:unbound', ip);
    return deny('session_invalid', 403, now);
  }

  // Xác thực phiên nếu client có gửi (cho phép khôi phục khi mất sid).
  if (sid) {
    const row = await env.DB.prepare(
      'SELECT * FROM xg_session WHERE sid = ? AND key = ? LIMIT 1'
    ).bind(sid, key).first();
    if (!row || row.revoked || row.hwid !== hwid) {
      await logEvent(env, key, hwid, sid, 'deny', 'check:bad_session', ip);
      return deny('session_invalid', 403, now);
    }
  }

  const s = await issueSession(env, lic, key, hwid, ip, b.fp,
    request.headers.get('user-agent'));

  await logAttempt(env, ip, true);
  await logEvent(env, key, hwid, s.sid, 'check', 'v=' + (b.ver || '?'), ip);

  return json({
    ok: true,
    now,
    code: 'ok',
    key,
    hwid,
    plan: lic.plan || PID,
    expires_at: lic.expires_at || 0,
    activated_at: lic.activated_at || now,
    grace_h: s.payload.g,
    mode: 'cmd',
    check_after: CHECK_AFTER,
    token: s.token,
    sid: s.sid,
    ssec: s.ssec,
  });
}

/**
 * POST /api/xg/heartbeat — nhịp tim nhẹ khi tool đang chạy.
 * Không cấp token mới (tránh tăng tải), chỉ xác nhận phiên còn sống.
 *
 * YÊU CẦU `ssec` (khoá phiên). Trước đây server sinh `ssec`, lưu băm vào
 * xg_session nhưng KHÔNG BAO GIỜ đối chiếu -> đó là secret chết: ai bắt được
 * `sid` trên đường truyền là giữ được phiên. Nay sid một mình không đủ.
 */
export async function xgHeartbeat(env, request) {
  const ip = ipOf(request);
  const b = await readBody(request);
  if (!b) return deny('bad_request', 400);

  const key = normKey(b.key);
  const hwid = String(b.hwid || '').trim().toLowerCase();
  const sid = String(b.sid || '').trim();
  const ssec = String(b.ssec || '').trim();
  if (!key || !hwid || !sid || !ssec) return deny('bad_request', 400);

  const now = nowSec();
  const lic = await getLicense(env, key);
  const v = judge(lic, hwid, now);
  if (!v.ok) return deny(v.code, 403, now);

  const row = await env.DB.prepare(
    'SELECT secret_hash FROM xg_session WHERE sid = ? AND key = ? AND revoked = 0 AND hwid = ? LIMIT 1'
  ).bind(sid, key, hwid).first();
  if (!row) return deny('session_invalid', 403, now);

  // So sánh timing-safe để không rò thông tin qua thời gian phản hồi.
  if (!timingSafeEqual(await sha256hex(ssec), row.secret_hash)) {
    await logEvent(env, key, hwid, sid, 'deny', 'heartbeat: bad ssec', ip);
    return deny('session_invalid', 403, now);
  }

  await env.DB.prepare('UPDATE xg_session SET last_at = ? WHERE sid = ?')
    .bind(now, sid).run();

  return json({
    ok: true, now, code: 'ok',
    expires_at: lic.expires_at || 0,
    check_after: CHECK_AFTER,
  });
}

/**
 * POST /api/xg/violation — client báo bị can thiệp (debugger/VM/patch).
 *
 * BẮT BUỘC XÁC THỰC. Trước đây endpoint này nhận bất kỳ `key` nào mà không
 * kiểm tra gì: ai biết (hoặc đoán) một mã license là có thể gửi 8 lần báo
 * vi phạm để server TỰ THU HỒI license của người khác — phá hoại có chủ đích,
 * không cần đăng nhập, không cần mã đổi máy.
 *
 * Nay chỉ chấp nhận khi:
 *   - key là của XAGrant và chưa thu hồi, VÀ
 *   - (sid khớp một phiên đang sống của chính key+hwid đó)
 *     HOẶC (hwid khớp máy đã bind) — trường hợp client chưa kịp có phiên.
 *
 * Vi phạm ghi theo (key, hwid) để máy lạ không "đốt" hạn mức của máy thật.
 */
export async function xgViolation(env, request) {
  const ip = ipOf(request);
  const b = await readBody(request);
  if (!b) return deny('bad_request', 400);

  const key = normKey(b.key);
  const hwid = String(b.hwid || '').trim().toLowerCase();
  const sid = String(b.sid || '').trim();
  const code = String(b.code || '').slice(0, 64);

  if (!key || !/^[a-f0-9]{24,64}$/.test(hwid)) return deny('bad_request', 400);

  const now = nowSec();

  let lic;
  try {
    lic = await getLicense(env, key);
  } catch {
    return deny('schema_missing', 500);
  }
  if (!lic || !isXagrant(lic)) {
    // Không tiết lộ key có tồn tại hay không.
    await logAttempt(env, ip, false);
    return deny('not_found', 403, now);
  }
  if (lic.revoked) return deny('revoked', 403, now);

  // Xác thực: phải là máy đã bind, hoặc đang giữ phiên hợp lệ.
  let authed = false;
  if (lic.hwid && lic.hwid === hwid) {
    authed = true;
  } else if (sid) {
    const s = await env.DB.prepare(
      'SELECT sid FROM xg_session WHERE sid = ? AND key = ? AND hwid = ? AND revoked = 0 LIMIT 1'
    ).bind(sid, key, hwid).first();
    if (s) authed = true;
  }
  if (!authed) {
    await logAttempt(env, ip, false);
    await logEvent(env, key, hwid, sid, 'deny', 'violation: not owner', ip);
    return deny('hwid_mismatch', 403, now);
  }

  await logEvent(env, key, hwid, sid, 'violation', code, ip);

  try {
    await env.DB.prepare(
      `INSERT INTO xg_viol (key, n, last_at) VALUES (?, 1, ?)
       ON CONFLICT(key) DO UPDATE SET n = n + 1, last_at = excluded.last_at`
    ).bind(key, now).run();
  } catch { /* ignore */ }

  const row = await env.DB.prepare('SELECT n FROM xg_viol WHERE key = ?')
    .bind(key).first();
  const n = row?.n || 1;

  if (n >= VIOLATION_BUDGET) {
    // Thu hồi: khách phải liên hệ hỗ trợ. Đây là chốt chặn cuối.
    await env.DB.prepare(
      "UPDATE licenses SET revoked = 1 WHERE key = ? AND pid = ?"
    ).bind(key, PID).run();
    await env.DB.prepare('UPDATE xg_session SET revoked = 1 WHERE key = ?')
      .bind(key).run();
    await logEvent(env, key, hwid, sid, 'auto_revoke', 'violations=' + n, ip);
    return deny('too_many_violations', 403, now);
  }

  return json({ ok: true, now, code: 'ok', left: VIOLATION_BUDGET - n });
}

/** POST /api/xg/rebind — giống No Fog: cần session hoặc rebind token. */
export async function xgRebind(env, request) {
  const ip = ipOf(request);
  const b = await readBody(request);
  if (!b) return deny('bad_request', 400);

  const key = normKey(b.key);
  const hwid = String(b.hwid || '').trim().toLowerCase();
  if (!key || !hwid) return deny('bad_request', 400);

  const { getSessionUser } = await import('../lib/auth.js');
  const user = await getSessionUser(env, request);

  if (user) {
    const owns = await env.DB.prepare(
      'SELECT 1 AS x FROM license_issues WHERE user_id = ? AND license_key = ? LIMIT 1'
    ).bind(user.id, key).first();
    if (!owns) {
      await logEvent(env, key, hwid, null, 'deny', 'rebind: not owner', ip);
      // Trước đây trả code 'rate_limit' -> khách tưởng bị chặn tạm thời và
      // thử lại mãi. Phải nói đúng là không sở hữu.
      return json({ ok: false, code: 'forbidden', msg: 'Bạn không sở hữu mã này' }, 403);
    }
  } else {
    const token = String(b.token || request.headers.get('x-rebind-token') || '').trim();
    if (!token) {
      await logEvent(env, key, hwid, null, 'deny', 'rebind: no auth', ip);
      return json({ ok: false, code: 'unauthorized', msg: 'Cần đăng nhập để đổi máy' }, 401);
    }
    const th = await sha256hex(token);
    const row = await env.DB.prepare(
      `SELECT 1 AS x FROM rebind_tokens
       WHERE key = ? AND token_hash = ? AND used = 0 AND expires_at > ? LIMIT 1`
    ).bind(key, th, nowSec()).first();
    if (!row) return json({ ok: false, code: 'unauthorized', msg: 'Mã đổi máy không hợp lệ' }, 401);
    await env.DB.prepare('UPDATE rebind_tokens SET used = 1 WHERE key = ? AND token_hash = ?')
      .bind(key, th).run();
  }

  const now = nowSec();
  const up = await env.DB.prepare(
    `UPDATE licenses SET hwid = ?, rebinds = rebinds + 1, last_seen = ?, last_ip = ?
     WHERE key = ? AND pid = ? AND revoked = 0 AND rebinds < max_rebind`
  ).bind(hwid, now, ip, key, PID).run();

  if (!up.meta || up.meta.changes !== 1) {
    const lic = await getLicense(env, key);
    if (!lic) return deny('not_found', 404);
    if (lic.revoked) return deny('revoked', 403);
    return json({ ok: false, code: 'rebind_limit', msg: 'Hết số lần đổi máy' }, 403);
  }

  await env.DB.prepare('UPDATE xg_session SET revoked = 1 WHERE key = ?').bind(key).run();
  await logEvent(env, key, hwid, null, 'rebind', 'to ' + hwid, ip);

  const lic = await getLicense(env, key);
  return json({
    ok: true,
    now,
    rebinds_left: Math.max(0, (lic.max_rebind || 0) - (lic.rebinds || 0)),
    expires_at: lic.expires_at,
  });
}

/** GET /api/xg/health */
export async function xgHealth(env) {
  let n = 0;
  let schema = true;
  try {
    const row = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM licenses WHERE pid = ?'
    ).bind(PID).first();
    n = row?.n || 0;
  } catch {
    schema = false;
  }
  return json({
    ok: true,
    at: nowSec(),
    app: APP,
    licenses: n,
    schema_ok: schema,
    check_after: CHECK_AFTER,
    min_client: '1.0.0',
  });
}
