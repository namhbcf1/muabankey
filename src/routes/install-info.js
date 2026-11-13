/**
 * API cho BỘ CÀI GUI (xa_setup.exe).
 *
 * VÌ SAO CẦN ENDPOINT NÀY:
 *   Luồng cũ bắt khách dán một dòng PowerShell:
 *       powershell -NoProfile -ExecutionPolicy Bypass -Command "iex (irm https://.../i/<KEY>.ps1?t=<TOKEN>)"
 *   Với khách thường, dán lệnh vào Win+R rồi bấm Yes là đủ khó để họ bỏ cuộc.
 *   Nhiều máy còn chặn `ExecutionPolicy` hoặc AV cảnh báo "script PowerShell
 *   tải từ internet" -> tỉ lệ cài hỏng cao.
 *
 *   Bộ cài GUI (một file .exe, bấm đúp là chạy) chỉ cần khách dán TOKEN hoặc
 *   KEY, rồi gọi endpoint này để lấy đúng thông tin cần thiết.
 *
 * BẢO MẬT:
 *   Endpoint KHÔNG trả gì nếu không có token hợp lệ còn hạn (hoặc session
 *   đăng nhập sở hữu key). Cùng mức bảo vệ như /i/<KEY>.ps1 hiện tại —
 *   không mở thêm đường nào để lấy EXE mà không có license.
 */
import { json, ApiError } from '../lib/http.js';
import { normKey } from './license.js';
import {
  EXE_NAME as XG_EXE_NAME,
  EXE_SHA256 as XG_SHA256,
  EXE_SIZE as XG_SIZE,
} from './xa-grant-installer.js';
import {
  EXE_NAME as NF_EXE_NAME,
  EXE_SHA256 as NF_SHA256,
  EXE_SIZE as NF_SIZE,
  EXE_VERSION as NF_VERSION,
  APP_NAME as NF_APP_NAME,
} from './installer.js';

/** Thư mục cài — PHẢI khớp installer.js / xa-grant-installer.js. */
const DIRS = {
  nofog: 'C:\\Program Files\\XArenaNoFog\\_re\\chayduoc',
  xagrant: 'C:\\Program Files\\XArena\\_re\\xagrant',
};

function siteBase(request) {
  const u = new URL(request.url);
  /*
   * LUÔN https cho URL tải file.
   *
   * Vì sao không dùng thẳng `u.protocol`: nếu request vào qua http (dev,
   * health check nội bộ, hoặc proxy đặt sai), bộ cài sẽ tải EXE qua http.
   * Hash vẫn chặn được kẻ sửa file, nhưng https là lớp bảo vệ rẻ tiền và
   * không có lý do gì để mất nó — trang production luôn có TLS.
   */
  const proto = (u.hostname === 'localhost' || u.hostname === '127.0.0.1')
    ? u.protocol : 'https:';
  return `${proto}//${u.host}`;
}

async function sha256hex(text) {
  const d = await crypto.subtle.digest(
    'SHA-256', new TextEncoder().encode(text)
  );
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Tìm license từ token cài đặt hoặc từ session đăng nhập.
 *
 * Trả { lic, via } hoặc ném ApiError 401/403.
 */
async function resolveLicense(env, request, keyRaw, token) {
  const key = normKey(keyRaw);

  // --- Đường 1: session đăng nhập sở hữu key (hoặc admin) ---
  const { getSessionUser } = await import('../lib/auth.js');
  const user = await getSessionUser(env, request).catch(() => null);
  if (user) {
    const lic = await env.DB.prepare('SELECT * FROM licenses WHERE key = ?')
      .bind(key).first();
    if (!lic) throw new ApiError(404, 'Mã không tồn tại', 'NOT_FOUND');

    if (user.role === 'admin' || user.role === 'staff') {
      return { lic, via: 'session-admin' };
    }
    const owns = await env.DB.prepare(
      'SELECT 1 AS x FROM license_issues WHERE user_id = ? AND license_key = ? LIMIT 1'
    ).bind(user.id, key).first();
    if (!owns) {
      throw new ApiError(403, 'Bạn không sở hữu mã này', 'FORBIDDEN');
    }
    return { lic, via: 'session-owner' };
  }

  // --- Đường 2: install token (48 hex, TTL 24h) ---
  if (!token) {
    throw new ApiError(401,
      'Cần đăng nhập hoặc dán mã cài đặt (token) để lấy bộ cài.',
      'UNAUTHORIZED');
  }
  if (!/^[0-9a-f]{48}$/i.test(token)) {
    throw new ApiError(400, 'Mã cài đặt phải là 48 ký tự hex', 'VALIDATION');
  }

  const th = await sha256hex(token.toLowerCase());
  const now = Math.floor(Date.now() / 1000);
  const row = await env.DB.prepare(
    `SELECT key FROM install_tokens
     WHERE token_hash = ? AND expires_at > ? LIMIT 1`
  ).bind(th, now).first();
  if (!row) {
    throw new ApiError(401,
      'Mã cài đặt không đúng hoặc đã hết hạn (hạn 24 giờ).',
      'UNAUTHORIZED');
  }
  if (normKey(row.key) !== key) {
    throw new ApiError(401,
      'Mã cài đặt này thuộc về license khác.', 'UNAUTHORIZED');
  }

  const lic = await env.DB.prepare('SELECT * FROM licenses WHERE key = ?')
    .bind(key).first();
  if (!lic) throw new ApiError(404, 'Mã không tồn tại', 'NOT_FOUND');
  return { lic, via: 'install-token' };
}

/**
 * GET /api/install-info?key=<KEY>&t=<TOKEN>[&app=nofog|xagrant]
 *
 * Trả mọi thứ bộ cài GUI cần: tên file, URL tải, SHA-256, kích thước,
 * thư mục cài, tên shortcut. KHÔNG trả bảng địa chỉ (bảng đó chỉ có trong
 * token license do /api/activate cấp, sau khi tool chạy).
 */
export async function installInfo(env, request) {
  const url = new URL(request.url);
  const keyRaw = url.searchParams.get('key') || '';
  const token = (url.searchParams.get('t') || '').trim();
  const appWanted = (url.searchParams.get('app') || '').toLowerCase();

  if (!keyRaw) {
    throw new ApiError(400, 'Thiếu tham số key', 'VALIDATION');
  }

  const { lic } = await resolveLicense(env, request, keyRaw, token);

  if (lic.revoked) {
    throw new ApiError(403, 'Mã đã bị thu hồi. Liên hệ hỗ trợ.', 'REVOKED');
  }
  const now = Math.floor(Date.now() / 1000);
  if (lic.expires_at && lic.expires_at > 0 && lic.expires_at < now) {
    throw new ApiError(403, 'Mã đã hết hạn. Liên hệ hỗ trợ.', 'EXPIRED');
  }

  // Sản phẩm nào? Ưu tiên tham số, sau đó suy từ cột pid/plan.
  let app = appWanted;
  if (app !== 'nofog' && app !== 'xagrant') {
    const pid = String(lic.pid || '').toLowerCase();
    const plan = String(lic.plan || '').toLowerCase();
    app = (pid === 'xagrant' || plan === 'xagrant') ? 'xagrant' : 'nofog';
  }

  // Chặn dùng sai sản phẩm: key XAGrant không cài được bộ No Fog.
  const isXg = String(lic.pid || '').toLowerCase() === 'xagrant'
    || String(lic.plan || '').toLowerCase() === 'xagrant';
  if (app === 'nofog' && isXg) app = 'xagrant';
  if (app === 'xagrant' && !isXg) {
    throw new ApiError(409,
      'Mã này là của sản phẩm khác, không cài được bộ XA THÊM TÀI NGUYÊN.',
      'WRONG_PRODUCT');
  }

  const base = siteBase(request);

  if (app === 'xagrant') {
    return json({
      ok: true,
      app: 'xagrant',
      key: normKey(lic.key),
      name: 'XA THÊM TÀI NGUYÊN',
      exeName: XG_EXE_NAME,
      exeUrl: `${base}/download/${XG_EXE_NAME}`,
      sha256: XG_SHA256,
      size: XG_SIZE,
      installDir: DIRS.xagrant,
      shortcutName: 'XA Grant',
      license: {
        expires_at: lic.expires_at || 0,
        forever: !lic.expires_at,
        plan: lic.plan || 'xagrant',
      },
    });
  }

  return json({
    ok: true,
    app: 'nofog',
    key: normKey(lic.key),
    name: NF_APP_NAME,
    version: NF_VERSION,
    exeName: NF_EXE_NAME,
    exeUrl: `${base}/download/${NF_EXE_NAME}`,
    sha256: NF_SHA256,
    size: NF_SIZE,
    installDir: DIRS.nofog,
    shortcutName: 'XARENA MAP SÁNG',
    license: {
      expires_at: lic.expires_at || 0,
      forever: !lic.expires_at,
      plan: lic.plan || 'aoe1',
    },
  });
}

/**
 * GET /download/xa_setup.exe
 *
 * Bộ cài GUI. CÔNG KHAI có chủ ý: khách tải được bộ cài trước, rồi mới dán
 * mã cài đặt vào. Bộ cài không chứa gì bí mật — mọi thứ nó cần (URL EXE,
 * SHA-256) đều lấy từ server sau khi đã xác thực license.
 *
 * Nếu ẩn file này sau auth thì khách phải đăng nhập rồi mới tải được
 * installer — thêm một bước mà không tăng bảo mật thật.
 */
export async function downloadSetup(env, request) {
  if (!env.MEDIA) {
    throw new ApiError(503, 'Chưa cấu hình R2', 'NOT_CONFIGURED');
  }
  const NAME = 'xa_setup.exe';
  const range = request.headers.get('range');
  const obj = await env.MEDIA.get(
    `files/${NAME}`, range ? { range: request.headers } : {}
  );
  if (!obj) throw new ApiError(404, 'Không tìm thấy bộ cài', 'NOT_FOUND');

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('Content-Type', 'application/octet-stream');
  headers.set('Content-Disposition', `attachment; filename="${NAME}"`);
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Cache-Control', 'no-cache');
  headers.set('ETag', obj.httpEtag);
  headers.set('X-Content-Type-Options', 'nosniff');

  // Chỉ trả 206 khi client THỰC SỰ xin Range (Miniflare luôn điền obj.range).
  if (range && obj.range) {
    const offset = obj.range.offset || 0;
    const length = obj.range.length !== undefined
      ? obj.range.length : obj.size - offset;
    headers.set('Content-Range',
      `bytes ${offset}-${offset + length - 1}/${obj.size}`);
    headers.set('Content-Length', String(length));
    return new Response(obj.body, { status: 206, headers });
  }

  headers.set('Content-Length', String(obj.size));
  return new Response(obj.body, { status: 200, headers });
}

/**
 * SHA-256 + kích thước bộ cài.
 *
 * PHẢI công bố công khai: khách tải một file .exe chạy quyền Administrator,
 * nên họ cần cách kiểm nó không bị thay. Trước đây endpoint này chỉ trả
 * tên/phiên bản, không có hash nào -> không thể đối chiếu.
 *
 * Cập nhật sau mỗi lần build (tool/setup/build-setup.ps1 in ra giá trị này).
 */
export const SETUP_VERSION = '2.0.0';
export const SETUP_SHA256 =
  '1204809C453BE0E63944F47113E3CC2101E585A91AC9DE7D0AB5BC36FE2F7282';
export const SETUP_SIZE = 9446400;

/**
 * GET /api/setup/version — metadata bộ cài (để trang /tai-ve hiển thị).
 */
export async function setupVersion(env) {
  void env;
  return json({
    ok: true,
    name: 'Bộ cài XArena',
    filename: 'xa_setup.exe',
    version: SETUP_VERSION,
    sha256: SETUP_SHA256,
    size: SETUP_SIZE,
    sizeText: `${(SETUP_SIZE / 1048576).toFixed(1)} MB`,
    url: '/download/xa_setup.exe',
    urlAbsolute: 'https://xienhl.com/download/xa_setup.exe',
    platform: 'Windows 10 / 11 (64-bit)',
    note: 'Một file .exe, bấm đúp để cài. Không cần PowerShell hay CMD.',
  });
}

/**
 * GET /api/install-info/resolve?t=<TOKEN>
 *
 * Dùng khi khách CHỈ có token mà không nhớ key (bộ cài GUI nhận token trước).
 * Trả kèm `key` để bộ cài gọi tiếp installInfo, hoặc trả thẳng thông tin.
 */
export async function installResolve(env, request) {
  const url = new URL(request.url);
  const token = (url.searchParams.get('t') || '').trim().toLowerCase();
  if (!/^[0-9a-f]{48}$/.test(token)) {
    throw new ApiError(400, 'Mã cài đặt phải là 48 ký tự hex', 'VALIDATION');
  }

  const th = await sha256hex(token);
  const now = Math.floor(Date.now() / 1000);
  const row = await env.DB.prepare(
    `SELECT key FROM install_tokens
     WHERE token_hash = ? AND expires_at > ? LIMIT 1`
  ).bind(th, now).first();

  if (!row) {
    throw new ApiError(401,
      'Mã cài đặt không đúng hoặc đã hết hạn (hạn 24 giờ).',
      'UNAUTHORIZED');
  }

  // Chuyển tiếp sang installInfo (dùng chung một đường xác thực).
  const u = new URL(request.url);
  u.searchParams.set('key', normKey(row.key));
  return installInfo(env, new Request(u.toString(), { headers: request.headers }));
}
