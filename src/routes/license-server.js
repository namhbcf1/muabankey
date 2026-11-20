/**
 * License server cho client XArena — chạy CHUNG worker muabankey.
 *
 * Giao thức giữ nguyên 100% để client xa_nofog_pro.py/EXE không cần sửa:
 *   POST /api/activate  {key, hwid, app}  -> {ok, expires_at, plan, grace_hours, first_bind}
 *   POST /api/check     {key, hwid, app}  -> {ok, expires_at, ...}
 *   POST /api/rebind    {key, hwid}       -> {ok, rebinds_left}
 *   GET  /api/license/health
 *
 * Khác biệt so với bản cũ: chỉ một worker, một CSDL (muabankey-db).
 * Đã vá bug firstBind: apiCheck không gọi lại apiActivate nữa mà xử lý bind
 * trực tiếp, nên body không bị đọc hai lần.
 *
 * ============================================================================
 * TOKEN BẢO VỆ BẢNG OFFSET (mới)
 * ============================================================================
 * Bảng offset patch No Fog (MINIMAP/CORE/LEGACY: địa chỉ + byte gốc + byte vá)
 * KHÔNG còn nằm trong EXE. Server mã hoá bảng đó theo `gate` riêng của TỪNG
 * license và đặt vào payload token đã ký ECDSA P-256:
 *
 *     token = "xn1." + b64u(payload JSON) + "." + b64u(sig r||s)
 *
 *     payload = {
 *       v: 1, a: 'xa-nofog', k: <key>, h: <hwid>, p: <plan>,
 *       e: <expires_at>, n: <now giây>, g: <grace_hours>,
 *       ss: b64u(gate 16 byte),       <- khoá giải mã bảng
 *       sv: b64u(ciphertext bảng),    <- bảng đã mã hoá
 *     }
 *
 *   keystream(i) = SHA-256("xn-ks" || gate || u32be(i))   (32 byte / khối)
 *   ciphertext   = bảng JSON XOR keystream
 *
 * `gate` = SHA-256(key || 'xa-nofog-gate-v1')[:16] — deterministic nên KHÔNG
 * cần cột CSDL mới và key cũ đã bán dùng được ngay. Điều này KHÔNG làm yếu
 * thiết kế: thứ bảo vệ bảng là CHỮ KÝ, không phải bí mật của `gate`. Kẻ tấn
 * công biết `gate` vẫn cần chữ ký server mới mint được token hợp lệ.
 *
 * Vì sao bảng không nhúng vào binary: `gate` khác nhau cho từng license, mà
 * cùng một bản rõ với N khoá khác nhau sinh ra N ciphertext khác nhau — không
 * thể nhúng MỘT blob tĩnh phục vụ mọi key.
 */
import { json, ApiError } from '../lib/http.js';
import {
  SESSION_MOVED, MESSAGE_SESSION_MOVED,
  guardAccountDevice, deviceScope, ownerUserId, touchPaidLicence,
} from '../lib/account-device.js';

const MESSAGES = {
  not_found: 'Mã không tồn tại',
  revoked: 'Mã đã bị thu hồi',
  expired: 'Mã đã hết hạn',
  hwid_mismatch: 'Mã đã dùng trên máy khác',
  [SESSION_MOVED]: MESSAGE_SESSION_MOVED,
  reset: 'Mã đã bị reset, cần kích hoạt lại',
  rate_limit: 'Quá nhiều lần thử, thử lại sau',
  trial_expired: 'Đã hết hạn dùng thử',
  trial_only: 'Đây là mã dùng thử',
  wrong_product: 'Mã này thuộc sản phẩm khác',
  rebind_token_required: 'Cần mã đổi máy — lấy trên web tại mục License của tôi',
  invalid_token: 'Mã đổi máy không đúng',
  token_used: 'Mã đổi máy đã được dùng',
  token_expired: 'Mã đổi máy đã hết hạn',
};

/*
 * ============ CHÍNH SÁCH GRACE: HAI SẢN PHẨM KHÁC NHAU ============
 *
 * No Fog  (file NÀY)          : GRACE_HOURS = 0 -> bắt buộc online.
 * XAGrant (xa-grant-server.js) : GRACE_HOURS = 6 -> có cửa sổ offline 6 giờ.
 *
 * ĐÂY LÀ QUYẾT ĐỊNH SẢN PHẨM, CHƯA ĐƯỢC CHỦ SHOP CHỐT LẦN CUỐI.
 * Hai giá trị đang KHÁC NHAU CÓ CHỦ ĐÍCH và đã được xác nhận là khớp với
 * client tương ứng; việc "làm cho giống nhau" phải chờ chủ shop xác nhận.
 *
 * Vì sao 0 ở đây là ĐÚNG với client No Fog hiện tại — client KHÔNG đọc giá
 * trị grace server trả về, nó hard-code bắt buộc online:
 *
 *   tool/src/xa_config.py:127
 *       REQUIRE_ONLINE = True
 *   tool/src/xa_nofog_pro.py:1246-1249
 *       # Bắt buộc online: không có offline grace cho BẤT KỲ key nào.
 *       if REQUIRE_ONLINE:
 *           return 0
 *   tool/src/xa_nofog_pro.py:1262
 *       return st.get('grace_hours', 0) * 3600 - elapsed   # 0 = bat buoc online
 *
 * => Nếu server trả 6 giờ cho No Fog thì cũng KHÔNG nới được gì: _grace_left()
 *    trả 0 ngay ở nhánh REQUIRE_ONLINE, trước khi đọc grace_hours. Muốn nới
 *    phải sửa client + phát hành bản mới, không phải sửa một dòng ở server.
 *
 * Ngược lại XAGrant 6 giờ là cửa sổ THẬT vì client XAGrant đọc `g` trong token
 * đã ký và cho chạy tới n + c + g*3600 (tool/grant/xa_grant_sec.py:386-400).
 */
const GRACE_HOURS = 0;

/**
 * Tiền tố sản phẩm của No Fog trong bảng `products.license_prefix`.
 * Dùng để tra KỲ HẠN ĐÃ CẤU HÌNH khi không chứng minh được kỳ hạn từ dữ liệu
 * license (xem resolveTermDays trong ../lib/trial-quota.js).
 */
const PRODUCT_PREFIX = 'AOE1';

// Giới hạn số lần THẤT BẠI / IP / giờ.
// Trước đây 30 -> quán net 30 máy hoặc khách thử vài lần là bị chặn oan.
// Nay 500: vẫn chặn được brute-force key nhưng không ảnh hưởng NAT chung.
const RATE_LIMIT = 500;
const RATE_WINDOW = 3600;

/* ------------------------------------------------------------------ */
/* Token bảo vệ bảng offset                                           */
/* ------------------------------------------------------------------ */

/** Tên sản phẩm trong token. Client kiểm `payload.a` phải bằng giá trị này. */
const TOKEN_APP = 'xa-nofog';
const TOKEN_VERSION = 1;

/** Phiên bản bảng offset. Tăng khi đổi byte vá. */
const SITES_VERSION = 1;

/**
 * Bảng offset No Fog — TOÀN BỘ tri thức reverse-engineering của tool.
 *
 * Mỗi dòng: [key, group, va, byte_gốc_hex, byte_vá_hex]
 *
 * KHÔNG một byte nào trong đây xuất hiện dạng plaintext trong EXE: bảng được
 * mã hoá bằng khoá suy ra từ `gate` của từng license và chỉ gửi trong token
 * đã ký. Client không có token hợp lệ thì không biết vá vào đâu.
 *
 * GIỮ NGUYÊN đúng giá trị trong xa_nofog_pro.py (MINIMAP/CORE/LEGACY).
 */
const SITES = [
  // ---- viewport (CORE) ----
  ['T1', 'viewport', 0x514e0f, '85d17407', '90909090'],
  ['V3', 'viewport', 0x514f58, '7404', 'eb43'],
  ['V6', 'viewport', 0x516590, '518b442408', '33c0c21400'],
  // ---- minimap (MINIMAP) ----
  ['A', 'minimap', 0x42d521, '8a83b88d0000', 'b00190909090'],
  ['B', 'minimap', 0x42d547, '0f84e2030000', '909090909090'],
  ['C', 'minimap', 0x42dc63, '8a85b88d0000', 'b00190909090'],
  ['D', 'minimap', 0x42dc6d, '8a95b98d0000', 'b20190909090'],
  ['E', 'minimap', 0x42dca9, '8a85b98d0000', 'b00190909090'],
  ['M', 'minimap', 0x42dc93, 'b180', 'b10f'],
  ['N', 'minimap', 0x42dca7, 'b180', 'b10f'],
  // ---- legacy (chỉ dùng khi --full) ----
  ['F', 'legacy', 0x513df8, '8a81b88d0000', 'b00190909090'],
  ['I', 'legacy', 0x51c631, '8a81b88d0000', 'b00190909090'],
  ['J', 'legacy', 0x51c6b8, '8a81b88d0000', 'b00190909090'],
  ['K', 'legacy', 0x51d28e, '8a82b88d0000', 'b00190909090'],
  ['L', 'legacy', 0x51d3d7, '8a82b88d0000', 'b00190909090'],
  // O: 0x51FC6F nằm GIỮA lệnh -> địa chỉ đúng là 0x529BEA (xem xa_nofog_pro.py)
  ['O', 'legacy', 0x529bea, 'b280', 'b20f'],
  ['T2', 'legacy', 0x514eff, '0f853c010000', '909090909090'],
];

/** Nhóm mặc định khi chạy không tham số (viewport + minimap). */
const DEFAULT_GROUPS = ['viewport', 'minimap'];

/** Địa chỉ module game 32-bit; client kiểm lại trước khi ghi. */
const VA_MIN = 0x400000;
const VA_MAX = 0x08000000;

/**
 * Kiểm cấu trúc bảng lúc nạp module. Fail closed: bảng hỏng thì KHÔNG được
 * ký token, vì client sẽ ghi byte rác vào process game và làm crash game.
 */
function assertSites() {
  const keys = new Set();
  const addrs = new Set();
  for (const row of SITES) {
    if (!Array.isArray(row) || row.length !== 5) {
      throw new Error('bảng SITES: dòng sai định dạng');
    }
    const [key, group, va, orig, pat] = row;
    if (typeof key !== 'string' || !key) throw new Error('SITES: key sai');
    if (keys.has(key)) throw new Error('SITES: trùng key ' + key);
    keys.add(key);
    if (!DEFAULT_GROUPS.includes(group) && group !== 'legacy') {
      throw new Error('SITES: nhóm lạ ' + group);
    }
    if (!Number.isInteger(va) || va < VA_MIN || va >= VA_MAX) {
      throw new Error('SITES: địa chỉ ngoài miền ' + key);
    }
    if (addrs.has(va)) throw new Error('SITES: trùng địa chỉ ' + key);
    addrs.add(va);
    const o = String(orig).toLowerCase();
    const p = String(pat).toLowerCase();
    if (!/^[0-9a-f]+$/.test(o) || !/^[0-9a-f]+$/.test(p)) {
      throw new Error('SITES: byte không phải hex ' + key);
    }
    if (o.length !== p.length) {
      throw new Error('SITES: byte gốc/vá khác độ dài ' + key);
    }
    if (o.length % 2 !== 0 || o.length > 32) {
      throw new Error('SITES: độ dài byte lạ ' + key);
    }
    if (o === p) throw new Error('SITES: byte gốc bằng byte vá ' + key);
  }
  if (SITES.length === 0) throw new Error('SITES: bảng rỗng');
}
assertSites();

/**
 * Khoá ký RIÊNG của server (Worker secret `XN_SIGN_JWK`).
 *
 * Fail closed: thiếu secret thì từ chối ký, KHÔNG dùng key dự phòng hardcode.
 */
function signJwk(env) {
  const raw = env && env.XN_SIGN_JWK;
  if (!raw) {
    throw new ApiError(
      503,
      'Chưa cấu hình XN_SIGN_JWK — không thể ký token',
      'NOT_CONFIGURED',
    );
  }
  let v;
  try {
    v = JSON.parse(raw);
  } catch {
    throw new ApiError(503, 'XN_SIGN_JWK không phải JSON hợp lệ', 'NOT_CONFIGURED');
  }
  if (!v || v.kty !== 'EC' || !v.d || !v.x || !v.y) {
    throw new ApiError(503, 'XN_SIGN_JWK thiếu thành phần EC', 'NOT_CONFIGURED');
  }
  return v;
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

export function normKey(k) {
  return String(k || '').trim().toUpperCase().replace(/\s+/g, '');
}

/* ---------------------- token: mã hoá bảng offset --------------------- */

const enc = new TextEncoder();

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

async function sha256Bytes(data) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', data));
}

async function concatBytes(...arrs) {
  const len = arrs.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const a of arrs) {
    out.set(a, o);
    o += a.length;
  }
  return out;
}

/**
 * `gate` của MỘT license: SHA-256(key || 'xa-nofog-gate-v1')[:16].
 *
 * Deterministic nên KHÔNG cần cột CSDL mới, và mọi key đã bán (kể cả key cũ
 * chưa từng có `gate`) đều dùng được ngay.
 *
 * Vì sao đây KHÔNG phải là làm yếu thiết kế: thứ bảo vệ bảng offset là CHỮ
 * KÝ ECDSA, không phải bí mật của `gate`. Kẻ tấn công biết `gate` (vì nó suy
 * được từ key họ đang có) vẫn KHÔNG mint được token hợp lệ — thiếu khoá riêng
 * của server thì chữ ký sai và client từ chối trước khi giải mã.
 */
async function deriveGate(key) {
  const msg = enc.encode(normKey(key) + 'xa-nofog-gate-v1');
  const d = await sha256Bytes(msg);
  return d.slice(0, 16);
}

/**
 * Mã hoá bảng offset cho MỘT license.
 *
 *   ks(i)  = SHA-256("xn-ks" || gate || u32be(i))   32 byte mỗi khối
 *   cipher = plaintext XOR ks
 *
 * Stream cipher dựng trên SHA-256 (PRF); an toàn khi `gate` khác nhau cho từng
 * license. Cố ý không dùng AES để client Python không phải phụ thuộc thư viện
 * mã hoá nào (giảm bề mặt tấn công, build nhẹ, chạy được cả trên Win7).
 */
async function sealSites(gate) {
  const plain = enc.encode(JSON.stringify({
    v: SITES_VERSION,
    dg: DEFAULT_GROUPS,
    s: SITES,
  }));

  const ct = new Uint8Array(plain.length);
  const blocks = Math.ceil(plain.length / 32);
  for (let b = 0; b < blocks; b++) {
    const ks = await sha256Bytes(
      await concatBytes(enc.encode('xn-ks'), gate, u32be(b))
    );
    for (let j = 0; j < 32; j++) {
      const at = b * 32 + j;
      if (at >= plain.length) break;
      ct[at] = plain[at] ^ ks[j];
    }
  }
  return b64u(ct);
}

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
 * Chuẩn hoá chữ ký ECDSA về dạng "low-S" (s <= N/2).
 *
 * WebCrypto trả chữ ký không chuẩn hoá: khoảng một nửa số lần `s > N/2`.
 * Client Python từ chối `s > N/2` để chặn malleability (cùng một thông điệp
 * có hai chữ ký hợp lệ), nên nếu server không chuẩn hoá thì ~50% lượt kích
 * hoạt sẽ thất bại với `bad_sig` — lỗi ngẫu nhiên, cực khó tìm.
 *
 * Ở đây ta đổi (r, s) -> (r, N-s) khi s > N/2. Đây là phép biến đổi chuẩn
 * (BIP-62 / RFC 6979 §5): cả hai đều là chữ ký hợp lệ của cùng thông điệp,
 * chỉ khác cách mã hoá, nên chọn dạng nhỏ hơn là an toàn và làm token có
 * dạng chuẩn tất định.
 *
 * `sig` là raw r||s 64 byte (WebCrypto trả đúng định dạng này cho P-256).
 */
const P256_N = BigInt(
  '0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551'
);
const P256_HALF_N = P256_N >> 1n;

function toLowS(sig) {
  const b = new Uint8Array(sig);
  if (b.length !== 64) return b;
  const s = BigInt('0x' + Array.from(b.slice(32))
    .map((x) => x.toString(16).padStart(2, '0')).join(''));
  if (s <= P256_HALF_N) return b;
  const flipped = P256_N - s;
  const hex = flipped.toString(16).padStart(64, '0');
  for (let i = 0; i < 32; i++) {
    b[32 + i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return b;
}

/** Tạo token `xn1.<payload>.<sig>` đã ký ECDSA P-256 (chuẩn hoá low-S). */
async function mintToken(env, payload) {
  const body = 'xn1.' + b64u(enc.encode(JSON.stringify(payload)));
  const raw = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, await signKey(env), enc.encode(body)
  );
  return body + '.' + b64u(toLowS(raw));
}

/**
 * Token hoàn chỉnh cho một license.
 *
 * Trả `{ token, gate_hex }`. `token` là chuỗi client cần; `gate_hex` chỉ để
 * log/health, KHÔNG trả cho client (client lấy gate TỪ token đã ký).
 *
 * XUẤT RA NGOÀI (`export`) để đường dùng thử theo tài khoản
 * (src/routes/trial-account.js) ký được token mà không phải dựng lại toàn bộ
 * logic mã hoá bảng cổng ở một chỗ thứ hai.
 */
export async function buildToken(env, lic, key, hwid) {
  const gate = await deriveGate(key);
  const sealed = await sealSites(gate);
  const payload = {
    v: TOKEN_VERSION,          // phiên bản định dạng token
    a: TOKEN_APP,              // sản phẩm: client kiểm phải bằng 'xa-nofog'
    sver: SITES_VERSION,       // phiên bản bảng offset
    k: key,
    h: hwid,
    p: lic.plan || 'aoe1',
    e: lic.expires_at || 0,
    n: nowSec(),               // giờ server -> client neo đồng hồ
    g: lic.plan === 'trial' ? 0 : GRACE_HOURS,
    ss: b64u(gate),            // gate 16 byte -> khoá giải mã bảng
    sv: sealed,                // bảng offset đã mã hoá
  };
  const token = await mintToken(env, payload);
  return {
    token,
    gate_hex: Array.from(gate, (b) => b.toString(16).padStart(2, '0')).join(''),
  };
}

/* ------------------------------ helpers ------------------------------ */

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
    // Dọn định kỳ để bảng không phình
    if (Math.random() < 0.02) {
      await env.DB.prepare('DELETE FROM lic_attempts WHERE at < ?')
        .bind(nowSec() - 7 * 86400).run();
    }
  } catch { /* không chặn luồng chính */ }
}

async function logEvent(env, key, hwid, kind, detail, ip) {
  try {
    await env.DB.prepare(
      'INSERT INTO lic_events (key, hwid, kind, detail, ip, at) VALUES (?,?,?,?,?,?)'
    ).bind(key, hwid || null, kind, detail || null, ip || null, nowSec()).run();
  } catch { /* ignore */ }
}

async function getLicense(env, key) {
  return await env.DB.prepare('SELECT * FROM licenses WHERE key = ?').bind(key).first();
}

/**
 * License này là BẢN DÙNG THỬ? (`plan = 'trial'`)
 *
 * ĐÂY LÀ ĐƯỜNG PHÂN CHIA DUY NHẤT giữa hai chính sách:
 *   trial  -> khoá theo MÁY   (hwid_mismatch, cửa sổ đổi máy)
 *   đã mua -> khoá theo TÀI KHOẢN (không xét máy; xem account-device.js)
 */
export function isTrialLicence(lic) {
  /*
   * ---------------------------------------------------------------------
   * KEY NÀO KHOÁ THEO MÁY?
   *
   * 1. Dùng thử (plan='trial')  -> LUÔN khoá máy.
   * 2. Key có cờ bind_hwid = 1  -> khoá máy. Đây là key KHÔNG có chủ tài
   *    khoản (admin tạo tay / bán lẻ). Nếu không khoá máy thì key đó không
   *    bị ràng buộc bởi gì cả — ai có key cũng dùng, chia sẻ vô hạn.
   * 3. Key mua qua đơn hàng (bind_hwid = 0/NULL) -> theo TÀI KHOẢN.
   *
   * Dữ liệu cũ (NULL) giữ nguyên hành vi trước đây để không khoá oan
   * khách đã mua.
   * ---------------------------------------------------------------------
   */
  if (!lic) return false;
  if (String(lic.plan || '').toLowerCase() === 'trial') return true;
  const b = lic.bind_hwid;
  return b === 1 || b === '1' || b === true;
}

function judge(lic, hwid, now, hwid2) {
  if (!lic) return { ok: false, code: 'not_found' };
  if (lic.revoked) return { ok: false, code: 'revoked' };
  if (lic.expires_at && lic.expires_at > 0 && lic.expires_at < now) {
    return { ok: false, code: 'expired', expires_at: lic.expires_at };
  }

  /*
   * ==========================================================================
   * ĐÃ TRẢ TIỀN -> KHÔNG KHOÁ THEO MÁY NỮA
   *
   * YÊU CẦU CHỦ SHOP: "mua rồi thì đổi máy nào cũng được... không theo gì nữa
   * mà theo tài khoản".
   *
   * Trước đây: `lic.hwid` là máy ĐƯỢC PHÉP dùng; khác -> `hwid_mismatch`
   * (trừ khi `rebind_until` đang mở). Hệ quả: khách đổi máy / cài lại Windows
   * (GUID đổi) là chết, phải chờ admin reset.
   *
   * Nay: mọi license KHÔNG phải trial đều đi qua đây với `paid: true`.
   * `licenses.hwid` giữ nguyên trong CSDL nhưng chỉ còn nghĩa "máy dùng GẦN
   * NHẤT" — ghi để hiển thị/chẩn đoán, KHÔNG so sánh để chặn.
   *
   * Việc "một tài khoản không được chạy nhiều máy cùng lúc" KHÔNG biến mất —
   * nó chuyển sang `guardAccountDevice()` (bảng account_devices), áp cho MỌI
   * đường cấp token, kể cả bản trả phí.
   * ==========================================================================
   */
  if (!isTrialLicence(lic)) {
    // `firstBind` giữ ĐÚNG nghĩa cũ: license chưa từng gắn máy nào.
    // Nhưng với bản trả phí nó KHÔNG còn bắt mã đổi máy — bindFirstTime không
    // được gọi cho đường này nữa (xem touchPaidLicence).
    if (!lic.hwid) return { ok: true, paid: true, firstBind: true };
    return { ok: true, paid: true };
  }

  /* ------------------------------------------------------------------ */
  /* DƯỚI ĐÂY LÀ NGUYÊN VĂN CHÍNH SÁCH CỦA BẢN DÙNG THỬ — KHÔNG ĐỔI.    */
  /* ------------------------------------------------------------------ */
  if (!lic.hwid) return { ok: true, firstBind: true };
  /*
   * ------------------------------------------------------------------
   * CHẤP NHẬN NHIỀU CÔNG THỨC HWID — KHÔNG KHOÁ OAN KHÁCH THẬT.
   *
   * LỖI ĐÃ SỬA: `lic.hwid` được bind bằng một trong 6 công thức HWID có
   * trong mã nguồn (có/không tiền tố, serial mainboard vs BIOS, ...).
   * Trước đây chỉ so MỘT giá trị nên license bind bằng công thức cũ bị
   * `hwid_mismatch` vĩnh viễn dù vẫn đúng máy đó — đo được trên
   * production: AOE1-CLAF-QDAE-AHKJ bị từ chối ngay hôm nay.
   *
   * Nay: máy có thể gửi tới 2 hash (mỗi module tính một kiểu); khớp MỘT
   * trong số đó là qua.
   * ------------------------------------------------------------------
   */
  const want = String(lic.hwid || '').trim().toLowerCase();
  const cands = [hwid, hwid2]
    .map((x) => String(x || '').trim().toLowerCase())
    .filter(Boolean);
  const matched = cands.some((c) => c === want);

  if (!matched) {
    /*
     * CỬA SỔ ĐỔI MÁY — KHÔNG CẦN MÃ HEX.
     *
     * LỖI ĐÃ SỬA: trước đây hàm này chặn `hwid_mismatch` NGAY, nên dù khách
     * đã bấm "Đổi máy" trên web (rebind_until đang mở) thì máy mới vẫn bị
     * từ chối — cửa sổ không bao giờ được xét tới.
     *
     * Nay: nếu rebind_until > now thì coi như lần bind đầu -> đi tiếp vào
     * bindFirstTime, nơi cửa sổ được kiểm và đóng lại.
     */
    const windowOpen = !!(lic.rebind_until && Number(lic.rebind_until) > now);
    if (windowOpen) return { ok: true, firstBind: true };
    return { ok: false, code: 'hwid_mismatch' };
  }
  return { ok: true };
}

function publicLic(lic, extra = {}) {
  const isTrial = lic && lic.plan === 'trial';
  return {
    ok: true,
    // ===== SERVER-AUTHORITATIVE TIME =====
    // Client KHÔNG được tự quyết định "còn hạn hay không" bằng đồng hồ máy.
    // Trả giờ server trong MỌI response để client neo vào monotonic clock.
    now: nowSec(),
    expires_at: lic.expires_at,
    activated_at: lic.activated_at,
    plan: lic.plan,
    forever: !lic.expires_at,
    // Trial KHONG co offline grace (rut mang = khong chay duoc)
    grace_hours: isTrial ? 0 : GRACE_HOURS,
    trial: isTrial,
    ...extra,
  };
}

/**
 * Gói phản hồi THÀNH CÔNG: metadata license + `token` đã ký.
 *
 * `token` là thứ DUY NHẤT chứa bảng offset. Không có nó, client không biết
 * vá byte nào vào địa chỉ nào -> tool không hoạt động. Vì vậy token được cấp
 * ở mọi phản hồi thành công (activate / check / trial), kể cả key vừa bind.
 */
async function okWithToken(env, lic, key, hwid, extra = {}) {
  // Ký lỗi (thiếu secret) -> ApiError 503, KHÔNG trả license "nửa vời".
  const t = await buildToken(env, lic, key, hwid);
  return json(publicLic(lic, { ...extra, token: t.token }));
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

function ipOf(request) {
  return request.headers.get('cf-connecting-ip') || 'unknown';
}

/**
 * Gắn máy cho license lần đầu + bắt đầu tính hạn từ BÂY GIỜ.
 *
 * VẤN ĐỀ ĐÃ SỬA: trước đây hàm này bind bất kỳ ai khi `hwid IS NULL`.
 * Admin reset HWID -> cửa mở cho TẤT CẢ. Máy cũ (tool chạy nền, /api/check
 * mỗi 30 phút) sẽ thắng máy mới -> khách đổi máy không bao giờ được.
 *
 * NAY: nếu license đã từng được bind (activated_at IS NOT NULL) thì
 * "hwid = NULL" nghĩa là ĐANG CHỜ ĐỔI MÁY -> bắt buộc phải có
 * rebind_token. Máy cũ không có token -> bị chặn.
 */
async function bindFirstTime(env, lic, key, hwid, ip, now, token) {
  // reset_pending=1: admin vừa reset -> BẮT BUỘC có token.
  // activated_at != null: key đã từng dùng -> cũng cần token (đổi máy).
  /*
   * CỬA SỔ ĐỔI MÁY — KHÔNG CẦN MÃ HEX.
   *
   * Khách bấm "Đổi máy" trên web (đã đăng nhập) -> route rebind đặt
   * `licenses.rebind_until = now + 30 phút`. Trong cửa sổ đó máy mới chỉ
   * cần dán KEY là kích hoạt được.
   *
   * Bảo mật tương đương mã dùng-1-lần cũ: chỉ chủ tài khoản (đã đăng nhập)
   * mới mở được cửa sổ. Cửa sổ tự đóng sau 30 phút HOẶC ngay khi máy mới
   * kích hoạt xong (rebind_until = NULL), nên không dùng lại được.
   */
  const windowOpen = !!(lic.rebind_until && Number(lic.rebind_until) > now);
  const needToken = (!!lic.activated_at || !!lic.reset_pending) && !windowOpen;

  if (windowOpen && lic.activated_at) {
    await env.DB.prepare(
      `UPDATE licenses SET hwid = ?, last_seen = ?, last_ip = ?,
              rebind_until = NULL,
              rebinds = COALESCE(rebinds, 0) + 1
       WHERE key = ?`
    ).bind(hwid, now, ip, key).run();

    lic.hwid = hwid;
    lic.rebind_until = null;
    await logEvent(env, key, hwid, 'rebind', 'hwid changed (key window)', ip);
    return {
      ok: true,
      rebind: true,
      days: lic.expires_at > 0
        ? Math.max(0, Math.round((lic.expires_at - now) / 86400)) : 0,
    };
  }

  if (needToken) {
    if (!token) {
      await logEvent(env, key, hwid, 'deny', 'rebind needs token', ip);
      return { ok: false, code: 'rebind_token_required' };
    }
    const tokenHash = await sha256hex(token);
    const row = await env.DB.prepare(
      'SELECT * FROM rebind_tokens WHERE token_hash = ? LIMIT 1'
    ).bind(tokenHash).first();
    if (!row) {
      await logEvent(env, key, hwid, 'deny', 'invalid rebind token', ip);
      return { ok: false, code: 'invalid_token' };
    }
    if (row.used) return { ok: false, code: 'token_used' };
    if (row.expires_at < now) return { ok: false, code: 'token_expired' };
    if (row.key !== key) return { ok: false, code: 'invalid_token' };

    await env.DB.prepare('UPDATE rebind_tokens SET used = 1 WHERE token_hash = ?')
      .bind(tokenHash).run();

    // Đổi máy: GIỮ NGUYÊN activated_at + expires_at, chỉ đổi HWID
    await env.DB.prepare(
      `UPDATE licenses SET hwid = ?, last_seen = ?, last_ip = ?,
              reset_pending = 0, reset_at = NULL,
              rebinds = COALESCE(rebinds, 0) + 1
       WHERE key = ?`
    ).bind(hwid, now, ip, key).run();

    lic.hwid = hwid;
    lic.reset_pending = 0;
    await logEvent(env, key, hwid, 'rebind', 'hwid changed (token)', ip);
    return {
      ok: true,
      rebind: true,
      days: lic.expires_at > 0 ? Math.max(0, Math.round((lic.expires_at - now) / 86400)) : 0,
    };
  }

  // Lần kích hoạt ĐẦU TIÊN: tính hạn từ bây giờ
  //
  // LỖI ĐÃ SỬA (P1): bản cũ là
  //   const days = lic.expires_at > 0
  //     ? Math.max(1, Math.round((lic.expires_at - lic.created_at) / 86400))
  //     : 0;
  // `created_at` lưu bằng MILI-GIÂY còn `expires_at` bằng GIÂY -> hiệu
  // ≈ -1.79e12 -> Math.max(1, …) KẸP THÀNH 1 -> key 6 tháng thành 1 NGÀY,
  // không lỗi, không log. Nay dùng helper chuẩn hoá đơn vị và lùi về kỳ hạn
  // đã cấu hình thay vì kẹp về 1.
  const { resolveTermDays } = await import('../lib/trial-quota.js');
  const term = await resolveTermDays(env, {
    createdAt: lic.created_at,
    expiresAt: lic.expires_at,
    prefix: PRODUCT_PREFIX,
    key,
    now,
  });
  const days = term.forever ? 0 : term.days;
  const exp = term.forever ? 0 : now + days * 86400;
  await env.DB.prepare(
    `UPDATE licenses SET hwid = ?, activated_at = ?, expires_at = ?,
            last_seen = ?, last_ip = ? WHERE key = ?`
  ).bind(hwid, now, exp, now, ip, key).run();
  await logEvent(env, key, hwid, 'activate',
    'first bind, ' + (term.forever ? 'forever' : days + 'd') + ' [' + term.source + ']', ip);
  lic.expires_at = exp;
  lic.activated_at = now;
  lic.hwid = hwid;
  return { ok: true, days, rebind: false };
}

/* ------------------------------ handlers ------------------------------ */

/**
 * License này có PHẢI của sản phẩm map sáng không?
 *
 * LÝ DO: `buildToken()` luôn gắn `a:'xa-nofog'` và kèm `ss`+`sv` (bảng
 * cổng vá). Nếu key của sản phẩm TÀI NGUYÊN đi qua đây, khách chỉ mua
 * tăng tài nguyên vẫn nhận được:
 *   1. quyền dùng map sáng miễn phí suốt kỳ hạn, VÀ
 *   2. toàn bộ bảng địa chỉ/cổng vá — tức tài sản reverse-engineering
 *      bị lộ vĩnh viễn.
 *
 * Đây là ranh giới sản phẩm, phải chặn ở MỌI endpoint cấp token map sáng.
 */
function isGrantProduct(lic) {
  return String((lic && lic.pid) || '').toLowerCase() === 'xagrant';
}

/**
 * ĐƯỜNG ĐI CHUNG cho license ĐÃ TRẢ TIỀN — dùng cho cả /api/activate và
 * /api/check.
 *
 * Hai việc, đúng thứ tự:
 *
 *   1. `guardAccountDevice()` — luật "1 tài khoản = 1 máy tại một thời điểm".
 *      Áp cho CẢ bản trả phí (chính là chỗ thay thế cho việc khoá HWID vừa bỏ).
 *      `mode='activate'`  -> máy mới CHIẾM quyền, máy cũ chết ở lần check sau.
 *      `mode='check'`     -> khác máy thì TỪ CHỐI `session_moved`.
 *
 *   2. `touchPaidLicence()` — ghi "máy dùng gần nhất" vào `licenses.hwid`
 *      (KHÔNG chặn), và nếu đây là lần kích hoạt ĐẦU TIÊN thì tính kỳ hạn.
 *
 * @returns {{ok:true, first:boolean, moved:boolean, enforced:boolean}
 *          | {ok:false, code:string, msg:string}}
 */
async function paidLicencePipeline(env, lic, key, hwid, ip, now, mode,
                                     request) {
  const scope = deviceScope('nofog');
  const owner = await ownerUserId(env, key);

  // ------------------------------------------------------------------
  // CÓ PHIÊN ĐĂNG NHẬP = KHÁCH CHỦ ĐỘNG ĐĂNG NHẬP TRÊN MÁY NÀY.
  //
  // Cho chiếm máy NGAY (mode 'login'), không bắt chờ 5 phút. Không có
  // phiên thì là app tự hỏi lại định kỳ (mode 'check') -> không được cướp
  // của máy đang chạy, nếu không hai máy giành nhau liên tục.
  // ------------------------------------------------------------------
  let guardMode = mode;
  if (mode === 'check' && request) {
    try {
      const { getSessionUser } = await import('../lib/auth.js');
      const u = await getSessionUser(env, request);
      if (u && u.id === owner) guardMode = 'login';
    } catch { /* không đọc được phiên -> giữ 'check' (an toàn) */ }
  }

  const g = await guardAccountDevice(env, {
    userId: owner, scope, hwid, key, ip, mode: guardMode, now,
  });

  if (!g.ok) {
    await logEvent(env, key, hwid, 'deny', 'account device: ' + g.code, ip);
    return {
      ok: false,
      code: g.code,
      msg: g.msg || MESSAGES[g.code] || g.code,
      active_since: g.active_since || 0,
    };
  }
  if (g.moved) {
    await logEvent(env, key, hwid, 'device_move',
      'account moved: ' + String(g.previous_hwid || '').slice(0, 12) + '… -> này', ip);
  }

  const t = await touchPaidLicence(env, lic, {
    key, hwid, ip, now, prefix: PRODUCT_PREFIX,
  });

  await logEvent(env, key, hwid, mode === 'activate' ? 'activate' : 'check',
    t.first
      ? 'paid first activation, ' + (t.forever ? 'forever' : t.days + 'd')
        + ' [' + t.source + ']'
      : 'paid, account-bound (no hwid lock)', ip);

  return { ok: true, first: !!t.first, moved: !!g.moved, enforced: !!g.enforced };
}


export async function apiActivate(env, request) {
  const ip = ipOf(request);
  const b = await readBody(request);
  if (!b) return json({ ok: false, code: 'bad_request', msg: 'JSON không hợp lệ' }, 400);

  const key = normKey(b.key);
  const hwid = String(b.hwid || '').trim();
  /*
   * LỖI ĐÃ SỬA (phát hiện khi làm lại đường license): hàm này gọi
   * `judge(lic, hwid, now, hwid2)` nhưng `hwid2` CHƯA BAO GIỜ được khai báo
   * -> mọi lượt gọi tới dòng đó ném ReferenceError (500), tức /api/activate
   * chết ở production. Khai báo đúng như apiCheck.
   */
  const hwid2 = String(b.hwid2 || '').trim();

  if (!key || !hwid) {
    return json({ ok: false, code: 'bad_request', msg: 'Thiếu mã hoặc HWID' }, 400);
  }
  if (hwid.length < 8 || hwid.length > 128) {
    return json({ ok: false, code: 'bad_request', msg: 'HWID không hợp lệ' }, 400);
  }
  if (!(await rateOk(env, ip))) {
    await logAttempt(env, ip, false);
    return json({ ok: false, code: 'rate_limit', msg: MESSAGES.rate_limit }, 429);
  }

  const lic = await getLicense(env, key);
  const now = nowSec();

  // Trial key KHÔNG kích hoạt được qua /api/activate (chỉ qua /api/trial/start).
  // Nếu cho phép, 1 key trial share ra 100 máy đều activate được.
  if (lic && lic.plan === 'trial') {
    await logEvent(env, key, hwid, 'deny', 'trial key via activate', ip);
    return json({
      ok: false, code: 'trial_only',
      msg: 'Đây là mã dùng thử, không kích hoạt được theo cách này',
    }, 403);
  }

  // RANH GIỚI SẢN PHẨM: key tài nguyên KHÔNG được nhận token map sáng.
  if (isGrantProduct(lic)) {
    await logEvent(env, key, hwid, 'deny', 'grant key via nofog activate', ip);
    return json({
      ok: false, code: 'wrong_product',
      msg: 'Đây là mã tăng tài nguyên, không dùng cho map sáng.',
    }, 403);
  }

  const v = judge(lic, hwid, now, hwid2);

  if (!v.ok) {
    await logAttempt(env, ip, false);
    await logEvent(env, key, hwid, 'deny', v.code, ip);
    return json({
      ok: false, code: v.code, msg: MESSAGES[v.code] || v.code,
      now: now,   // server-authoritative time
      expires_at: v.expires_at || 0,
    }, 403);
  }

  /*
   * ===== ĐÃ TRẢ TIỀN: KHÔNG BIND MÁY, CHỈ GIỮ "1 NICK 1 MÁY" =====
   *
   * `bindFirstTime()` (mã đổi máy, rebind_until, rebind_tokens) KHÔNG còn
   * được dùng cho đường này: nó tồn tại để chặn "cùng một key chạy hai máy",
   * mà luật mới đã chuyển việc đó sang account_devices.
   */
  if (v.paid) {
    const r = await paidLicencePipeline(env, lic, key, hwid, ip, now, 'activate');
    if (!r.ok) {
      await logAttempt(env, ip, false);
      return json({
        ok: false, code: r.code, msg: r.msg,
        now, active_since: r.active_since || 0,
      }, 403);
    }
    await logAttempt(env, ip, true);
    return okWithToken(env, lic, key, hwid, {
      first_bind: !!r.first,
      binding: 'account',
      device_moved: !!r.moved,
    });
  }

  if (v.firstBind) {
    // Truyền token để bindFirstTime biết đây là đổi máy hay kích hoạt lần đầu
    const br = await bindFirstTime(env, lic, key, hwid, ip, now, b.token);
    if (!br.ok) {
      await logAttempt(env, ip, false);
      return json({
        ok: false, code: br.code,
        msg: MESSAGES[br.code] || 'Cần mã đổi máy hợp lệ',
        now,
      }, 403);
    }
  } else {
    await env.DB.prepare(
      'UPDATE licenses SET last_seen = ?, last_ip = ? WHERE key = ?'
    ).bind(now, ip, key).run();
    await logEvent(env, key, hwid, 'activate', 'same hwid', ip);
  }

  await logAttempt(env, ip, true);
  return okWithToken(env, lic, key, hwid, { first_bind: !!v.firstBind });
}

export async function apiCheck(env, request) {
  const ip = ipOf(request);
  const b = await readBody(request);
  if (!b) return json({ ok: false, code: 'bad_request', msg: 'JSON không hợp lệ' }, 400);

  const key = normKey(b.key);
  const hwid = String(b.hwid || '').trim();
  // Hash thứ hai (module tài nguyên tính khác) — dùng để không khoá
  // oan license bind bằng công thức khác.
  const hwid2 = String(b.hwid2 || '').trim();
  if (!key || !hwid) return json({ ok: false, code: 'bad_request' }, 400);
  if (!(await rateOk(env, ip))) {
    return json({ ok: false, code: 'rate_limit', msg: MESSAGES.rate_limit }, 429);
  }

  const lic = await getLicense(env, key);
  const now = nowSec();

  // ===== NHÁNH RIÊNG CHO TRIAL =====
  // Trial KHÔNG dùng bindFirstTime: hạn đã được tính sẵn lúc cấp,
  // và cần trả thêm quota + nhịp recheck cho client.
  if (lic && lic.plan === 'trial') {
    return trialCheck(env, request, lic, key, hwid, ip, now, hwid2);
  }

  // RANH GIỚI SẢN PHẨM (xem isGrantProduct).
  if (isGrantProduct(lic)) {
    await logEvent(env, key, hwid, 'deny', 'grant key via nofog check', ip);
    return json({
      ok: false, code: 'wrong_product',
      msg: 'Đây là mã tăng tài nguyên, không dùng cho map sáng.',
    }, 403);
  }

  const v = judge(lic, hwid, now, hwid2);

  if (!v.ok) {
    await logAttempt(env, ip, false);
    await logEvent(env, key, hwid, 'deny', v.code, ip);
    return json({
      ok: false, code: v.code, msg: MESSAGES[v.code] || v.code,
      now: now,   // server-authoritative time
      expires_at: v.expires_at || 0,
    }, 403);
  }

  // Bản cũ gọi lại apiActivate ở đây -> body đã bị đọc -> 400.
  // Nay xử lý bind trực tiếp.
  /*
   * ===== ĐÃ TRẢ TIỀN: KHÔNG XÉT MÁY, CHỈ GIỮ "1 NICK 1 MÁY" =====
   *
   * Đây là chỗ MÁY CŨ BỊ ĐÁ: máy đang dùng là M1, tài khoản chạy `activate`
   * trên M2 -> account_devices trỏ sang M2 -> lần `check` kế tiếp của M1 rơi
   * vào nhánh `!r.ok` dưới đây và nhận `session_moved`.
   */
  if (v.paid) {
    const r = await paidLicencePipeline(env, lic, key, hwid, ip, now, 'check',
                                   request);
    if (!r.ok) {
      await logAttempt(env, ip, false);
      return json({
        ok: false, code: r.code, msg: r.msg,
        now, active_since: r.active_since || 0,
      }, 403);
    }
    await logAttempt(env, ip, true);
    return okWithToken(env, lic, key, hwid, {
      first_bind: !!r.first,
      binding: 'account',
      device_moved: !!r.moved,
    });
  }

  if (v.firstBind) {
    // license từng bị reset -> cần token đổi máy, tránh máy cũ tự bind lại
    const br = await bindFirstTime(env, lic, key, hwid, ip, now, b.token);
    if (!br.ok) {
      await logAttempt(env, ip, false);
      return json({
        ok: false, code: br.code,
        msg: MESSAGES[br.code] || 'Cần mã đổi máy hợp lệ',
        now,
      }, 403);
    }
    await logAttempt(env, ip, true);
    return okWithToken(env, lic, key, hwid,
      { first_bind: true, rebound: !!br.rebind });
  }

  await env.DB.prepare(
    'UPDATE licenses SET last_seen = ?, last_ip = ? WHERE key = ?'
  ).bind(now, ip, key).run();
  await logAttempt(env, ip, true);
  await logEvent(env, key, hwid, 'check', null, ip);

  return okWithToken(env, lic, key, hwid);
}

/**
 * Kiểm tra trial: bắt đầu đồng hồ ở lần check ĐẦU TIÊN, trả quota + recheck.
 *
 * `hwid2` được nhận vào (trước đây hàm này dùng biến `hwid2` mà KHÔNG khai
 * báo -> ReferenceError ở nhánh dữ liệu trial v1 bên dưới).
 */
async function trialCheck(env, request, lic, key, hwid, ip, now, hwid2) {
  /*
   * RANH GIỚI SẢN PHẨM — ĐẶT Ở DÒNG ĐẦU TIÊN.
   *
   * LỖI ĐÃ SỬA: guard trước đó nằm GIỮA hàm, sau nhánh `if (!use)`.
   * Nhánh đó (dữ liệu trial cũ v1, không có `trial_uses`) gọi
   * okWithToken() TRƯỚC guard, nên key `pid='xagrant'` vẫn nhận được
   * token `xn1.` kèm bảng cổng map sáng.
   *
   * Nay chặn ngay đầu hàm, không nhánh nào lọt.
   */
  if (isGrantProduct(lic)) {
    await logEvent(env, key, hwid, 'deny',
      'grant key via nofog trialCheck', ip);
    return json({
      ok: false, code: 'wrong_product',
      msg: 'Đây là mã tăng tài nguyên, không dùng cho map sáng.',
      now,
    }, 403);
  }


  /*
   * ===== AUDIT #3: MÃ DÙNG THỬ ĐÃ BỊ THU HỒI THÌ KHÔNG ĐƯỢC ĐÚC TOKEN =====
   *
   * LỖI GỐC: `judge()` (dùng cho key trả phí) có kiểm `lic.revoked`, nhưng
   * `trialCheck()` thì KHÔNG — nó chỉ đọc `trial_uses`. Admin bấm "Thu hồi"
   * trong trang quản trị chỉ đặt `licenses.revoked = 1` (KHÔNG đụng
   * `trial_uses`), nên mã trial đã bị thu hồi vẫn mint token `xn1.` và chạy
   * bình thường tới hết hạn: lệnh thu hồi hoàn toàn vô hiệu với đường trial.
   *
   * Nay chặn ngay đầu hàm (sau ranh giới sản phẩm), trước khi trả bất kỳ
   * thông tin hay token nào, và ghi lic_events để vận hành thấy.
   */
  if (lic.revoked) {
    await logEvent(env, key, hwid, 'deny', 'trial revoked', ip);
    return json({
      ok: false,
      code: 'revoked',
      msg: MESSAGES.revoked || 'Mã đã bị thu hồi',
      now,
    }, 403);
  }

  const { trialCfg, getQuota, publicUse, normKind, KIND_1H, KIND_3D } =
    await import('../lib/trial-quota.js');

  // Tìm grant tương ứng
  const use = await env.DB.prepare(
    'SELECT * FROM trial_uses WHERE lic_key = ? LIMIT 1'
  ).bind(key).first();

  if (!use) {
    // License trial tồn tại nhưng không có grant -> dữ liệu cũ (v1)
    // Cho chạy nếu license còn hạn, nhưng không có quota.
    const v = judge(lic, hwid, now, hwid2);
    if (!v.ok) {
      return json({
        ok: false, code: v.code, msg: MESSAGES[v.code] || v.code,
        now, expires_at: v.expires_at || 0,
      }, 403);
    }
    return okWithToken(env, lic, key, hwid, { legacy_trial: true });
  }

  // Đã bị thu hồi / dừng
  if (use.ended_at) {
    await logEvent(env, key, hwid, 'deny', `trial ${use.end_reason || 'ended'}`, ip);
    return json({
      ok: false, code: 'trial_expired',
      msg: use.end_reason === 'reset'
        ? 'Lượt dùng thử đã được đặt lại'
        : 'Lượt dùng thử đã kết thúc',
      now, expires_at: use.expires_at || 0,
    }, 403);
  }

  /*
   * ------------------------------------------------------------------
   * KEY TÀI NGUYÊN KHÔNG ĐƯỢC NHẬN TOKEN MAP SÁNG.
   *
   * LỖ HỔNG ĐÃ SỬA: `trialCheck()` không kiểm sản phẩm. Một key
   * `pid='xagrant'` (chỉ mua tăng tài nguyên) vẫn được cấp token `xn1.`
   * kèm bảng cổng — nghĩa là dùng map sáng MIỄN PHÍ.
   *
   * Đã chứng minh bằng HTTP thật: /api/check cho TR-23JZ… trả về token
   * xn1. dù entitlement chỉ có ['grant'].
   *
   * Nay chặn ở đây để key tài nguyên không lấy được token map sáng.
   * ------------------------------------------------------------------
   */
  if (String(lic.pid || '').toLowerCase() === 'xagrant') {
    await logEvent(env, key, hwid, 'deny', 'grant key via nofog check', ip);
    return json({
      ok: false, code: 'wrong_product',
      msg: 'Đây là mã tăng tài nguyên, không dùng cho map sáng.',
      now,
    }, 403);
  }

  // HWID không khớp -> chặn copy lic.bin
  if (use.hwid && use.hwid !== hwid) {
    await logEvent(env, key, hwid, 'deny', 'trial hwid mismatch', ip);
    return json({
      ok: false, code: 'hwid_mismatch',
      msg: 'Mã dùng thử đã gắn với máy khác',
      now,
    }, 403);
  }

  // ===== BẮT ĐẦU ĐỒNG HỒ Ở LẦN CHECK ĐẦU TIÊN =====
  if (!use.started_at) {
    /*
     * KIỂM HẠN GIỮ (hold) TRƯỚC KHI KHỞI ĐỘNG ĐỒNG HỒ.
     *
     * Trước đây nhánh này KHÔNG kiểm `expires_at`, nên một grant đã hết hạn
     * giữ chỗ từ nhiều tháng vẫn được "hồi sinh" thành 1 giờ / 3 ngày mới.
     * Hệ quả: mã dùng thử không bao giờ chết thật, `trial_hold_sec` thành
     * trang trí, và ai giữ mã cũ đều dùng lại được vô hạn.
     *
     * Nay: hết hạn giữ -> từ chối, không cấp thời gian mới.
     */
    if (use.expires_at && use.expires_at > 0 && use.expires_at < now) {
      await env.DB.prepare(
        `UPDATE trial_uses SET ended_at = ?, end_reason = 'hold_expired'
         WHERE id = ? AND ended_at IS NULL`
      ).bind(now, use.id).run().catch(() => {});
      return json({
        ok: false, code: 'trial_expired',
        msg: MESSAGES.trial_expired || 'Đã hết hạn dùng thử',
      }, 403);
    }

    const cfg = await trialCfg(env);
    const kind = normKind(use.kind) || KIND_3D;
    const secs = kind === KIND_1H ? cfg.t1h.sec : cfg.t3d.sec;
    const startedAt = now;
    const expiresAt = now + secs;

    // Ghi HWID ngay lần check đầu tiên.
    // Trước đây trial cấp qua web có hwid=NULL và KHÔNG BAO GIỜ được ghi
    // -> máy nào gọi /api/check đầu tiên sẽ chiếm license vĩnh viễn,
    // ai có mã TR- đều dùng được. Nay bind đúng như key trả phí.
    await env.DB.prepare(
      `UPDATE trial_uses SET started_at = ?, expires_at = ?,
              hwid = COALESCE(hwid, ?) WHERE id = ? AND started_at IS NULL`
    ).bind(startedAt, expiresAt, hwid, use.id).run();
    await env.DB.prepare(
      `UPDATE licenses SET activated_at = ?, expires_at = ?,
              hwid = COALESCE(hwid, ?) WHERE key = ?`
    ).bind(startedAt, expiresAt, hwid, key).run();

    const fresh = await env.DB.prepare('SELECT * FROM trial_uses WHERE id = ?')
      .bind(use.id).first();

    await logEvent(env, key, hwid, 'trial_activate', `${kind} ${secs}s`, ip);

    // Phải cấp token ngay: trial cũng cần bảng offset để vá. Gắn hạn mới vào
    // lic để chữ ký phủ đúng `expires_at` vừa ghi.
    lic.expires_at = expiresAt;
    lic.activated_at = startedAt;
    const t = await buildToken(env, lic, key, hwid);
    return json({
      ...publicUse(fresh, cfg, kind),
      trial_kind_state: 'activated',
      now,
      token: t.token,
    });
  }

  // Đã kích hoạt -> kiểm hạn
  if (use.expires_at && use.expires_at <= now) {
    await env.DB.prepare(
      "UPDATE trial_uses SET ended_at = ?, end_reason = 'expired' WHERE id = ? AND ended_at IS NULL"
    ).bind(now, use.id).run();
    await logEvent(env, key, hwid, 'deny', 'trial expired', ip);
    return json({
      ok: false, code: 'trial_expired',
      msg: 'Lượt dùng thử đã hết hạn',
      now, expires_at: use.expires_at,
    }, 403);
  }

  // Còn hạn -> trả trạng thái + quota
  const cfg = await trialCfg(env);
  const kind = normKind(use.kind) || KIND_3D;
  const quota = use.user_id
    ? await getQuota(env, use.user_id, kind, kind === KIND_1H ? cfg.t1h.quota : cfg.t3d.quota)
    : null;

  await env.DB.prepare(
    'UPDATE licenses SET last_seen = ?, last_ip = ? WHERE key = ?'
  ).bind(now, ip, key).run();

  // Token mới mỗi lần check: gói tin bắt được KHÔNG phát lại được, và client
  // luôn có bảng offset khớp phiên bản mới nhất.
  const t = await buildToken(env, lic, key, hwid);
  return json({
    ...publicUse(use, cfg, kind),
    trial_kind_state: 'active',
    now,
    token: t.token,
    ...(quota ? { used: quota.used, quota: quota.quota, left: quota.left } : {}),
  });
}

export async function apiRebind(env, request) {
  const ip = ipOf(request);
  /*
   * AUDIT #10: /api/rebind là endpoint CÔNG KHAI (client EXE gọi, không cần
   * đăng nhập) và trước đây KHÔNG có rate limit theo route — chỉ có limit
   * toàn cục 3000/phút, tức là dò key/đổi HWID thoải mái. Đây là bề mặt
   * đoán key, nên thêm trần theo IP.
   *
   * 60 lần / 10 phút / IP: khách thật đổi máy vài lần trong đời; 60 lần vẫn
   * dư cho quán net chung IP. Vượt -> 429 (bên gọi trả JSON sạch).
   */
  try {
    const { rateLimit } = await import('../lib/ratelimit.js');
    await rateLimit(env, `apirebind:${ip}`, 60, 600);
  } catch (e) {
    if (e && e.code === 'RATE_LIMITED') {
      return json({
        ok: false, code: 'rate_limit',
        msg: MESSAGES.rate_limit || 'Quá nhiều lần thử, thử lại sau',
      }, 429);
    }
    throw e;
  }
  const b = await readBody(request);
  if (!b) return json({ ok: false, code: 'bad_request' }, 400);

  const key = normKey(b.key);
  const hwid = String(b.hwid || '').trim();
  if (!key || !hwid) return json({ ok: false, code: 'bad_request' }, 400);

  // ===== BẢO VỆ: /api/rebind là endpoint CÔNG KHAI mà client EXE gọi.
  // Trước đây ai biết key là đổi được HWID -> chiếm license người khác.
  // Nay yêu cầu:
  //   - hoặc đăng nhập web và sở hữu key,
  //   - hoặc có rebind token do chủ key xin từ trang cá nhân.
  const { getSessionUser } = await import('../lib/auth.js');
  const user = await getSessionUser(env, request);

  if (user) {
    const owns = await env.DB.prepare(
      'SELECT 1 AS x FROM license_issues WHERE user_id = ? AND license_key = ? LIMIT 1'
    ).bind(user.id, key).first();
    if (!owns) {
      await logEvent(env, key, hwid, 'deny', 'rebind: not owner', ip);
      return json({ ok: false, code: 'forbidden', msg: 'Bạn không sở hữu mã này' }, 403);
    }
  } else {
    // Không có session: chấp nhận nếu client gửi kèm rebind token hợp lệ
    const token = String(b.token || request.headers.get('x-rebind-token') || '').trim();
    if (!token) {
      await logEvent(env, key, hwid, 'deny', 'rebind: no auth', ip);
      return json({ ok: false, code: 'unauthorized', msg: 'Cần đăng nhập để đổi máy' }, 401);
    }
    const row = await env.DB.prepare(
      `SELECT 1 AS x FROM rebind_tokens
       WHERE key = ? AND token_hash = ? AND used = 0 AND expires_at > ? LIMIT 1`
    ).bind(key, await sha256hex(token), nowSec()).first();
    if (!row) {
      await logEvent(env, key, hwid, 'deny', 'rebind: bad token', ip);
      return json({ ok: false, code: 'unauthorized', msg: 'Mã đổi máy không hợp lệ' }, 401);
    }
    // Token dùng 1 lần
    await env.DB.prepare('UPDATE rebind_tokens SET used = 1 WHERE key = ? AND token_hash = ?')
      .bind(key, await sha256hex(token)).run();
  }

  /*
   * ==========================================================================
   * BẢN ĐÃ TRẢ TIỀN: /api/rebind THÀNH NO-OP (vẫn 200, KHÔNG 404)
   *
   * Chọn "no-op trả lời được" thay vì xoá endpoint vì hai lý do:
   *   1. client EXE đã phát hành còn gọi `/api/rebind` (xa_nofog_pro.py
   *      `--rebind`); 404 sẽ bị hiểu là "server lỗi" và khách mở ticket.
   *   2. Có thể còn bản cài cũ chạy vòng "đổi máy" tự động.
   *
   * Nhưng KHÔNG còn tác dụng gì: đổi máy giờ chỉ cần `activate` ở máy mới
   * (xem paidLicencePipeline). Số lượt đổi máy không còn ý nghĩa -> trả
   * `rebinds_left: null` thay vì một con số gây hiểu nhầm.
   *
   * Vẫn GIỮ kiểm tra quyền sở hữu ở trên: no-op không được biến thành đường
   * dò key/đọc hạn license của người khác.
   * ==========================================================================
   */
  const licRebind = await getLicense(env, key);
  if (licRebind && !isTrialLicence(licRebind)) {
    const nowR = nowSec();
    await env.DB.prepare(
      'UPDATE licenses SET hwid = ?, last_seen = ?, last_ip = ? WHERE key = ?'
    ).bind(hwid, nowR, ip, key).run();
    await logEvent(env, key, hwid, 'rebind_noop',
      'paid licence: account-bound, rebind not needed', ip);
    return json({
      ok: true,
      binding: 'account',
      rebinds_left: null,
      rebind_needed: false,
      expires_at: licRebind.expires_at,
      msg: 'License của bạn đi theo tài khoản — không cần đổi máy. '
        + 'Chỉ cần kích hoạt lại trên máy mới.',
    });
  }

  // ===== ATOMIC: tránh TOCTOU, chỉ update khi còn lượt
  const now = nowSec();
  const up = await env.DB.prepare(
    `UPDATE licenses SET hwid = ?, rebinds = rebinds + 1, last_seen = ?, last_ip = ?
     WHERE key = ? AND revoked = 0 AND rebinds < max_rebind`
  ).bind(hwid, now, ip, key).run();

  if (!up.meta || up.meta.changes !== 1) {
    const lic = await getLicense(env, key);
    if (!lic) return json({ ok: false, code: 'not_found' }, 404);
    if (lic.revoked) return json({ ok: false, code: 'revoked' }, 403);
    return json({ ok: false, code: 'rebind_limit', msg: 'Hết số lần đổi máy' }, 403);
  }

  await logEvent(env, key, hwid, 'rebind', 'to ' + hwid, ip);
  const lic = await getLicense(env, key);
  return json({
    ok: true,
    rebinds_left: Math.max(0, (lic.max_rebind || 0) - (lic.rebinds || 0)),
    expires_at: lic.expires_at,
  });
}

/** SHA-256 hex, dùng cho rebind token. */
async function sha256hex(text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function apiHealth(env) {
  const total = await env.DB.prepare('SELECT COUNT(*) AS n FROM licenses').first();
  // `token_ready` = đã có khoá ký chưa. Chưa có thì client sẽ nhận 503 khi
  // kích hoạt -> biết ngay nguyên nhân thay vì đoán.
  let tokenReady = false;
  try { signJwk(env); tokenReady = true; } catch { tokenReady = false; }
  return json({
    ok: true,
    at: nowSec(),
    licenses: total?.n || 0,
    server: 'muabankey',
    token_ready: tokenReady,
    sites_version: SITES_VERSION,
    sites_count: SITES.length,
  });
}

/* ------------------------------------------------------------------ */
/* Xuất nội bộ cho TEST + script sinh hằng số                         */
/*                                                                    */
/* Không phải endpoint: chỉ để script test mint token offline và đối  */
/* chiếu bảng SITES với client mà không cần CSDL.                     */
/* ------------------------------------------------------------------ */
export const __test = {
  SITES,
  DEFAULT_GROUPS,
  SITES_VERSION,
  TOKEN_APP,
  deriveGate,
  sealSites,
  buildToken,
  mintToken,
  signJwk,
  assertSites,
};
