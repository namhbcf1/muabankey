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
 * ============================================================================
 */

import { ApiError } from '../lib/http.js';

/** Thư mục cài RIÊNG của app gộp. */
const INSTALL_DIR = 'C:\\Program Files\\XArena\\_re\\arena';

export const EXE_NAME = 'xa_arena.exe';

/*
 * PHIÊN BẢN — DÙNG CHO TỰ ĐỘNG CẬP NHẬT.
 *
 * Client so APP_VERSION của nó với số này. Server lớn hơn -> client tự
 * tải bản mới và thay file. PHAI TANG SO NAY MOI LAN BUILD.
 */
export const EXE_VERSION = '3.0.2.0';

/* Do dai + bam cua ban phat hanh hien tai. Cap nhat moi lan build. */
export const EXE_SHA256 = 'D74DC26EB2C19E10FEA191D6A266EC3D778ED3DACA1C8112505AFD864E7E5584';
export const EXE_SIZE = 23311872;

export const APP_NAME = 'XA ARENA';

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
export function arenaVersionData(request) {
  const u = new URL(request.url);
  const base = `${u.protocol}//${u.host}`;
  return {
    name: APP_NAME,
    filename: EXE_NAME,
    version: EXE_VERSION,
    sha256: EXE_SHA256,
    size: EXE_SIZE,
    sizeText: humanSize(EXE_SIZE),
    url: `/download/${EXE_NAME}`,
    urlAbsolute: `${base}/download/${EXE_NAME}`,
    platform: 'Windows 10 / 11 (64-bit)',
    installDir: INSTALL_DIR,
  };
}

function humanSize(n) {
  const v = Number(n) || 0;
  if (v >= 1048576) return `${(v / 1048576).toFixed(1)} MB`;
  if (v >= 1024) return `${Math.round(v / 1024)} KB`;
  return `${v} B`;
}
