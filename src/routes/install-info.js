/**
 * API thông tin tải app (xa_arena.exe — một file duy nhất).
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
  EXE_NAME as ARENA_EXE_NAME, EXE_SHA256 as ARENA_SHA256,
  EXE_SIZE as ARENA_SIZE, EXE_VERSION as ARENA_VERSION,
  APP_NAME as ARENA_APP_NAME,
} from './arena-installer.js';
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
  /*
   * Thư mục của APP GỘP. Từ nay bộ cài đặt bản này cho MỌI license
   * (map sáng, tài nguyên, hay cả hai) — khách chỉ tải và cài MỘT lần.
   * Hai thư mục trên giữ lại để khách cũ gỡ cài đặt được.
   */
  arena: 'C:\\Program Files\\XArena\\_re\\arena',
};

/**
 * Khối thông tin cài đặt của APP GỘP.
 * Dùng chung cho mọi license để bộ cài chỉ có một đường duy nhất.
 */
function arenaBlock(base) {
  return {
    app: 'arena',
    name: ARENA_APP_NAME,
    version: ARENA_VERSION,
    exeName: ARENA_EXE_NAME,
    exeUrl: `${base}/download/${ARENA_EXE_NAME}`,
    sha256: ARENA_SHA256,
    size: ARENA_SIZE,
    installDir: DIRS.arena,
    shortcutName: 'XA ARENA',
  };
}

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

  // --- Đường 2: LICENSE KEY trực tiếp ---
  //
  // CHỦ SHOP CHỐT: "chỉ một loại key thôi, bỏ cái Mã cài đặt".
  //
  // Khách đã mua key thì KEY ĐÓ chính là chứng từ. Bắt thêm một mã 48 ký tự
  // na ná giống key chỉ làm khách rối và dán nhầm.
  //
  // Vì sao bỏ mã cài đặt vẫn an toàn:
  //   1. Key không tồn tại -> 404. Bị thu hồi -> 403. Hết hạn -> 403.
  //   2. Tool vẫn phải kích hoạt đúng key đó, và license gắn HWID 1 máy.
  //   3. Tải được EXE không có nghĩa là chạy được — EXE đòi license hợp lệ.
  // Nên lộ key không mở thêm đường nào: người có key vốn đã có quyền dùng.
  const licByKey = await env.DB.prepare(
    'SELECT * FROM licenses WHERE key = ?'
  ).bind(key).first();
  if (licByKey) {
    return { lic: licByKey, via: 'license-key' };
  }

  // --- Đường 3: install token (48 hex) — chỉ để link CŨ đã phát hành
  //     trước đây vẫn dùng được. Không còn là đường chính.
  if (!token) {
    /*
     * ------------------------------------------------------------------
     * MÃ DÙNG THỬ ĐÃ BỊ DỌN / HẾT HẠN GIỮ MÃ.
     *
     * LỖI ĐÃ SỬA: khách lấy mã trial trên web, để lâu (quá hạn giữ mã
     * 7 ngày) hoặc mã đã bị cron dọn, rồi mới nhập vào bộ cài → trước
     * đây chỉ nhận "Mã license không tồn tại", tưởng shop bán key sai
     * và khiếu nại.
     *
     * Nay tra thêm `trial_uses` (dấu vết mã đã cấp) để nói đúng lý do,
     * kèm hướng dẫn lấy mã mới.
     * ------------------------------------------------------------------
     */
    if (String(key || '').toUpperCase().startsWith('TR-')) {
      let tu = null;
      try {
        tu = await env.DB.prepare(
          'SELECT kind, started_at, ended_at, expires_at '
          + 'FROM trial_uses WHERE lic_key = ? LIMIT 1'
        ).bind(key).first();
      } catch {
        tu = null;
      }
      if (tu) {
        const nowS = Math.floor(Date.now() / 1000);
        const why = tu.ended_at
          ? 'Lượt dùng thử này đã kết thúc.'
          : (tu.expires_at && tu.expires_at < nowS
            ? 'Mã dùng thử đã hết hạn.'
            : 'Mã dùng thử không còn hiệu lực.');
        throw new ApiError(
          403,
          why + ' Vào xienhl.com lấy mã dùng thử mới rồi nhập lại.',
          'TRIAL_EXPIRED');
      }
      throw new ApiError(
        404,
        'Mã dùng thử không đúng hoặc đã hết hạn. '
        + 'Vào xienhl.com lấy mã mới rồi nhập lại.',
        'TRIAL_NOT_FOUND');
    }
    throw new ApiError(404, 'Mã license không tồn tại', 'NOT_FOUND');
  }
  if (!/^[0-9a-f]{48}$/i.test(token)) {
    throw new ApiError(400, 'Mã không hợp lệ. Dùng license key dạng AOE1-XXXX-XXXX-XXXX', 'VALIDATION');
  }

  const th = await sha256hex(token.toLowerCase());
  const now = Math.floor(Date.now() / 1000);
  const row = await env.DB.prepare(
    `SELECT key FROM install_tokens
     WHERE token_hash = ? AND expires_at > ? LIMIT 1`
  ).bind(th, now).first();
  if (!row) {
    throw new ApiError(401,
      'License key không tồn tại hoặc đã hết hạn.',
      'UNAUTHORIZED');
  }
  if (normKey(row.key) !== key) {
    throw new ApiError(401,
      'Mã này thuộc về license khác.', 'UNAUTHORIZED');
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

  /*
   * AUDIT #10: /api/install-info là bề mặt ĐOÁN KEY — nhận `?key=` trực tiếp,
   * không cần đăng nhập, và trả về plan/hạn/quyền của key nếu tồn tại (kể cả
   * thông tin tải bộ cài). Trước đây chỉ có trần toàn cục 3000/phút/IP.
   *
   * 120 lượt / phút / IP: bộ cài gọi lại vài lần cho mỗi lần cài (đổi app,
   * kiểm lại trước khi chạy), và quán net dùng chung IP — phải rộng. Mục tiêu
   * là chặn dò hàng loạt, không chặn khách thật.
   */
  try {
    const { rateLimit, clientIp } = await import('../lib/ratelimit.js');
    await rateLimit(env, `ii:${clientIp(request)}`, 120, 60);
  } catch (e) {
    if (e && e.code === 'RATE_LIMITED') {
      throw new ApiError(429, 'Quá nhiều yêu cầu, vui lòng thử lại sau ít phút', 'RATE_LIMITED');
    }
    throw e;
  }

  const { lic } = await resolveLicense(env, request, keyRaw, token);

  /*
   * ------------------------------------------------------------------
   * MÃ DÙNG THỬ KHÁC KEY TRẢ PHÍ — THÔNG BÁO PHẢI KHÁC.
   *
   * LỖI ĐÃ SỬA: cả hai trường hợp đều trả "Liên hệ hỗ trợ". Với key
   * trả phí thì đúng; với mã dùng thử thì SAI và làm khách bị kẹt:
   * họ chỉ cần bấm lại nút "Thử MAP SÁNG" / "Thêm tài nguyên" trên
   * xienhl.com để lấy mã mới (mỗi máy còn 10 lượt).
   *
   * Nay: mã dùng thử hết hạn/hết hạn giữ -> hướng dẫn lấy mã mới.
   * ------------------------------------------------------------------
   */
  const isTrialLic = String(lic.plan || '').toLowerCase() === 'trial'
    || String(lic.source || '').toLowerCase() === 'trial';

  if (lic.revoked) {
    if (isTrialLic) {
      throw new ApiError(
        403,
        'Mã dùng thử này đã bị thu hồi. '
        + 'Vào xienhl.com bấm "Thử MAP SÁNG" (hoặc "Thử THÊM TÀI NGUYÊN") '
        + 'để lấy mã mới.',
        'TRIAL_REVOKED');
    }
    throw new ApiError(403, 'Mã đã bị thu hồi. Liên hệ hỗ trợ.', 'REVOKED');
  }
  const now = Math.floor(Date.now() / 1000);
  if (lic.expires_at && lic.expires_at > 0 && lic.expires_at < now) {
    if (isTrialLic) {
      throw new ApiError(
        403,
        'Lượt dùng thử 1 giờ của mã này đã hết. '
        + 'Vào xienhl.com bấm "Thử MAP SÁNG" (hoặc "Thử THÊM TÀI NGUYÊN") '
        + 'để lấy mã mới — mỗi máy còn nhiều lượt.',
        'TRIAL_EXPIRED');
    }
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

  /*
   * ===== AUDIT #8: HẠN TRẢ VỀ PHẢI LÀ ĐỒNG HỒ DÙNG THỬ, KHÔNG PHẢI HẠN GIỮ =====
   *
   * Với plan='trial', `licenses.expires_at` là HẠN GIỮ MÃ (7 ngày) — bộ cài
   * đọc thẳng trường này nên hiện gói 1 GIỜ thành "còn ~7 ngày". Thời lượng
   * thật nằm ở `trial_uses.expires_at` và chỉ có sau khi đồng hồ chạy.
   *
   * Ở đây đồng hồ CHƯA chạy (audit #6: không bật đồng hồ lúc tải bộ cài), nên:
   *   - đã chạy  -> trả hạn THẬT
   *   - chưa chạy-> giữ hạn giữ chỗ (để bộ cài còn biết mã chưa chết) nhưng
   *                 gắn cờ trial_pending để UI không hiểu thành thời lượng.
   */
  const isTrialPlan = String(lic.plan || '').toLowerCase() === 'trial';
  let licExpires = lic.expires_at || 0;
  let trialPending = false;
  if (isTrialPlan) {
    const { trialClock } = await import('../lib/trial-quota.js');
    const clock = await trialClock(env, lic.key);
    if (clock && clock.started && clock.expires_at > 0) {
      licExpires = clock.expires_at;
    } else if (clock) {
      trialPending = true;
    }
  }

  if (app === 'xagrant') {
    return json({
      ok: true,
      app: 'xagrant',
      key: normKey(lic.key),
      /*
       * Cài APP GỘP (chứa cả map sáng + tài nguyên).
       * Khách mua tài nguyên cũng nhận cùng một EXE; app tự ẩn phần
       * không có quyền. Nhờ vậy chỉ cần tải và cài MỘT lần.
       */
      ...arenaBlock(base),
      productApp: 'xagrant',
      license: {
        expires_at: licExpires,
        forever: !licExpires,
        plan: lic.plan || 'xagrant',
        trial: isTrialPlan,
        trial_pending: trialPending,
      },
    });
  }

  return json({
    ok: true,
    app: 'nofog',
    key: normKey(lic.key),
    /* Cài APP GỘP — xem chú thích ở nhánh xagrant phía trên. */
    ...arenaBlock(base),
    productApp: 'nofog',
    license: {
      expires_at: licExpires,
      forever: !licExpires,
      plan: lic.plan || 'aoe1',
      trial: isTrialPlan,
      trial_pending: trialPending,
    },
  });
}

/**
 * GET /download/xa_arena.exe
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
  const NAME = 'xa_arena.exe';
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
export const SETUP_VERSION = '2.6.0';
export const SETUP_SHA256 =
  '424AB76350ACC825B4EFBE56954A7D9FAC1F23392EBE73BE3C82B11422C4B4C7';
export const SETUP_SIZE = 20625920;

/**
 * GET /api/setup/version — metadata bộ cài (để trang /tai-ve hiển thị).
 */
export async function setupVersion(env) {
  void env;
  return json({
    ok: true,
    name: 'Bộ cài XArena',
    filename: 'xa_arena.exe',
    version: SETUP_VERSION,
    sha256: SETUP_SHA256,
    size: SETUP_SIZE,
    sizeText: `${(SETUP_SIZE / 1048576).toFixed(1)} MB`,
    url: '/download/xa_arena.exe',
    urlAbsolute: 'https://xienhl.com/download/xa_arena.exe',
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
    throw new ApiError(400, 'Mã không hợp lệ. Dùng license key dạng AOE1-XXXX-XXXX-XXXX', 'VALIDATION');
  }

  const th = await sha256hex(token);
  const now = Math.floor(Date.now() / 1000);
  const row = await env.DB.prepare(
    `SELECT key FROM install_tokens
     WHERE token_hash = ? AND expires_at > ? LIMIT 1`
  ).bind(th, now).first();

  if (!row) {
    throw new ApiError(401,
      'License key không tồn tại hoặc đã hết hạn.',
      'UNAUTHORIZED');
  }

  // Chuyển tiếp sang installInfo (dùng chung một đường xác thực).
  const u = new URL(request.url);
  u.searchParams.set('key', normKey(row.key));
  return installInfo(env, new Request(u.toString(), { headers: request.headers }));
}
