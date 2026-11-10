/** Tiện ích HTTP: response JSON, CORS, header bảo mật, lỗi có mã. */

export const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
  'X-XSS-Protection': '1; mode=block',
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
