/**
 * arena-installer.js — Phân phối bộ cài GỘP "XA ARENA".
 *
 *   GET /download/xa_arena.exe   -> tải EXE gộp từ R2
 *
 * ============================================================================
 * VÌ SAO CÓ FILE NÀY
 *
 * Trước đây khách phải cài 2 tool riêng (map sáng và thêm tài nguyên).
 * Nay một EXE duy nhất chứa cả hai; quyền bật chức năng nào do license
 * quyết định (xem src/routes/entitlement.js).
 *
 * TÁCH HOÀN TOÀN khỏi 2 bộ cài cũ: tên EXE, thư mục cài, shortcut đều
 * khác, nên cài song song không giẫm lên nhau trong giai đoạn chuyển tiếp.
 *
 * ============================================================================
 * F13 — VERSION/HASH KHÔNG CÒN VIẾT TAY
 *
 * Bản cũ có ba hằng số viết tay trong file này:
 *     export const EXE_VERSION = '3.1.0.0';
 *     export const EXE_SHA256  = '8AE4E0AB…';
 *     export const EXE_SIZE    = 23649280;
 *
 * Ba số đó KHÔNG có gì bảo đảm khớp file đang nằm trong R2. Đã có tình trạng
 * lệch thật: frontend còn fallback 3.0.2.0 trong khi source app và server đều
 * 3.1.0.0, và hash không ai kiểm.
 *
 * NAY: đọc `release/manifest.json` do `tool/release.mjs` sinh ra TỪ BYTES của
 * file đã build/ký. Không có hằng số nào phải sửa tay khi phát hành, và hash
 * trong manifest chính là hash đo được của file.
 *
 * Nếu manifest chưa tồn tại (môi trường dev), vẫn phải trả một giá trị —
 * nhưng đánh dấu rõ `verified: false` để trang tải KHÔNG hiện hash như thể đã
 * xác minh.
 * ============================================================================
 */

import { ApiError } from '../lib/http.js';

/** Thư mục cài RIÊNG của app gộp. */
const INSTALL_DIR = 'C:\\Program Files\\XArena\\_re\\arena';

export const EXE_NAME = 'xa_arena.exe';

/** Nhãn kênh phát hành mặc định. */
const DEFAULT_CHANNEL = 'stable';

/**
 * Manifest phát hành, nạp MỘT LẦN mỗi isolate.
 *
 * `import` tĩnh file JSON không dùng được trên mọi runtime Worker, nên dùng
 * `import ... with { type: 'json' }` không ổn định giữa các phiên bản. Thay
 * vào đó manifest được nhúng qua biến môi trường `RELEASE_MANIFEST` (chuỗi
 * JSON do pipeline set) — cách này không phụ thuộc bundler và cho phép đổi
 * bản phát hành mà không sửa mã.
 */
let cachedManifest = null;
let cacheKey = null;

function parseManifest(env) {
  const raw = env && env.RELEASE_MANIFEST;
  if (!raw) return null;
  const key = String(raw);
  if (cacheKey === key) return cachedManifest;
  try {
    const m = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!m || !m.version || !m.sha256) return null;
    cachedManifest = m;
    cacheKey = key;
    return m;
  } catch {
    return null;
  }
}

/**
 * Thông tin phát hành hiện hành.
 *
 * Trả về object LUÔN có `version`, `sha256`, `size` — nhưng `verified` nói rõ
 * con số đó có đến từ manifest thật hay không. Trang tải dùng cờ này để
 * không hiện hash như thông tin đã xác minh khi thực ra chưa có.
 */
export function releaseInfo(env) {
  const m = parseManifest(env);
  if (m) {
    return {
      version: String(m.version),
      sha256: String(m.sha256).toUpperCase(),
      size: Number(m.size) || 0,
      channel: String(m.channel || DEFAULT_CHANNEL),
      minSupportedVersion: String(m.minSupportedVersion || '0.0.0.0'),
      signedBy: m.signedBy || null,
      notes: m.notes || '',
      builtAt: m.builtAt || null,
      /** true = số liệu đến từ manifest sinh ra từ bytes của file thật */
      verified: true,
    };
  }

  /*
   * Chưa có manifest: KHÔNG bịa hash. Trả chuỗi rỗng + verified:false để
   * frontend hiện "chưa xác minh" thay vì một hash trông như thật.
   */
  return {
    version: String((env && env.RELEASE_VERSION) || '0.0.0.0'),
    sha256: '',
    size: 0,
    channel: String((env && env.RELEASE_CHANNEL) || DEFAULT_CHANNEL),
    minSupportedVersion: '0.0.0.0',
    signedBy: null,
    notes: '',
    builtAt: null,
    verified: false,
  };
}

/**
 * Tải EXE gộp từ R2.
 * Hỗ trợ HTTP Range để resume khi mạng đứt.
 */
export async function downloadArenaExe(env, request) {
  if (!env.MEDIA) {
    throw new ApiError(503, 'Chưa cấu hình R2', 'NOT_CONFIGURED');
  }

  const range = request.headers.get('range');
  const obj = await env.MEDIA.get(
    `files/${EXE_NAME}`, range ? { range: request.headers } : {});
  if (!obj) {
    throw new ApiError(404, 'Không tìm thấy bộ cài', 'NOT_FOUND');
  }

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('Content-Type', 'application/octet-stream');
  headers.set('Content-Disposition', `attachment; filename="${EXE_NAME}"`);
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Cache-Control', 'no-cache');
  headers.set('ETag', obj.httpEtag);
  headers.set('X-Content-Type-Options', 'nosniff');

  /*
   * Công bố hash của CHÍNH lần tải này khi server biết.
   *
   * R2 không tự cho hash SHA-256; manifest là nguồn. Header này giúp khách
   * kiểm ngay sau khi tải mà không phải mở trang khác.
   */
  const info = releaseInfo(env);
  if (info.verified && info.sha256) {
    headers.set('X-Release-Sha256', info.sha256);
    headers.set('X-Release-Version', info.version);
  }

  // CHỈ trả 206 khi client THỰC SỰ xin Range. Miniflare (local) luôn điền
  // obj.range kể cả khi không xin, nên phải kiểm tra `range` trước.
  if (range && obj.range) {
    const start = obj.range.offset || 0;
    const len = obj.range.length ?? (obj.size - start);
    headers.set('Content-Range', `bytes ${start}-${start + len - 1}/${obj.size}`);
    headers.set('Content-Length', String(len));
    return new Response(obj.body, { status: 206, headers });
  }

  if (obj.size != null) headers.set('Content-Length', String(obj.size));
  return new Response(obj.body, { status: 200, headers });
}

/** Dữ liệu phiên bản cho /api/app/version. */
export function arenaVersionData(request, env) {
  const u = new URL(request.url);
  const base = `${u.protocol}//${u.host}`;
  const info = releaseInfo(env);
  return {
    name: 'XA ARENA',
    filename: EXE_NAME,
    version: info.version,
    sha256: info.sha256,
    size: info.size,
    sizeText: humanSize(info.size),
    url: `/download/${EXE_NAME}`,
    urlAbsolute: `${base}/download/${EXE_NAME}`,
    platform: 'Windows 10 / 11 (64-bit)',
    installDir: INSTALL_DIR,
    channel: info.channel,
    minSupportedVersion: info.minSupportedVersion,
    signedBy: info.signedBy,
    notes: info.notes,
    builtAt: info.builtAt,
    /*
     * `verified=false` nghĩa là server CHƯA có manifest sinh từ bytes của
     * file đang phát hành. Trang tải phải hiện "chưa xác minh" thay vì một
     * hash trông như đã kiểm.
     */
    verified: info.verified,
  };
}

function humanSize(n) {
  const v = Number(n) || 0;
  if (v >= 1048576) return `${(v / 1048576).toFixed(1)} MB`;
  if (v >= 1024) return `${Math.round(v / 1024)} KB`;
  return `${v} B`;
}
