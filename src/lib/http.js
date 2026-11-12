/** Tiện ích HTTP: response JSON, CORS, header bảo mật, lỗi có mã. */

/**
 * Header bảo mật cho MỌI phản hồi API.
 *
 * Trước đây bộ này thiếu HSTS + CSP và còn `X-XSS-Protection` — trong khi
 * bộ header cho HTML (public/_headers) có đủ. Hai bộ lệch nhau âm thầm.
 * `X-XSS-Protection` đã bị các trình duyệt hiện đại bỏ; từng có lỗi cho phép
 * kẻ tấn công lợi dụng chính bộ lọc đó, nên giá trị đúng là `0` (tắt hẳn).
 */
export const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  // API không bao giờ cần render gì -> CSP chặt nhất có thể.
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  'X-XSS-Protection': '0',
};

export class ApiError extends Error {
  constructor(status, message, code = null, details = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...SECURITY_HEADERS,
      ...extraHeaders,
    },
  });
}

export function ok(data = {}, status = 200) {
  return json({ ok: true, ...data }, status);
}

export function fail(status, message, code = null, details = null) {
  return json({ ok: false, error: message, code, ...(details ? { details } : {}) }, status);
}

export async function readJson(request, limitBytes = 1_000_000) {
  const len = Number(request.headers.get('content-length') || 0);
  if (len > limitBytes) throw new ApiError(413, 'Dữ liệu gửi lên quá lớn');
  const text = await request.text();
  if (text.length > limitBytes) throw new ApiError(413, 'Dữ liệu gửi lên quá lớn');
  if (!text) return {};
  try {
    const v = JSON.parse(text);
    if (v === null || typeof v !== 'object' || Array.isArray(v)) {
      throw new ApiError(400, 'Body phải là một JSON object');
    }
    return v;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(400, 'JSON không hợp lệ');
  }
}
