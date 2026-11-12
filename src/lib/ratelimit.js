/** Rate limiter phân tán bằng KV, fallback D1. */
import { ApiError } from './http.js';

/**
 * @param {object} env
 * @param {string} key  khoá định danh (ip + route)
 * @param {number} limit  số request tối đa trong window
 * @param {number} windowSec  độ dài window (giây)
 * @param {object} [opts]
 * @param {boolean} [opts.failClosed] khi CẢ KV và D1 đều lỗi thì CHẶN (429)
 *   thay vì cho qua. Dùng cho endpoint nhạy cảm: đăng nhập, đăng ký, webhook.
 *   Mặc định false (fail-open) để hạ tầng đếm hỏng không chặn oan khách.
 */
export async function rateLimit(env, key, limit, windowSec, opts = {}) {
  const failClosed = opts.failClosed === true;
  const now = Math.floor(Date.now() / 1000);
  const windowAt = Math.floor(now / windowSec);
  const cacheKey = `rl:${key}:${windowAt}`;

  try {
    const raw = await env.CACHE.get(cacheKey);
    const count = raw ? Number(raw) : 0;
    if (count >= limit) {
      throw new ApiError(429, 'Bạn thao tác quá nhanh, vui lòng thử lại sau ít phút', 'RATE_LIMITED');
    }
    await env.CACHE.put(cacheKey, String(count + 1), { expirationTtl: Math.max(windowSec, 60) });
    return { count: count + 1, remaining: limit - count - 1 };
  } catch (e) {
    if (e instanceof ApiError) throw e;
    // KV lỗi -> dùng D1 làm fallback
    try {
      const row = await env.DB.prepare('SELECT count FROM rate_limits WHERE key = ? AND window_at = ?')
        .bind(key, windowAt)
        .first();
      const count = row ? row.count : 0;
      if (count >= limit) {
        throw new ApiError(429, 'Bạn thao tác quá nhanh, vui lòng thử lại sau ít phút', 'RATE_LIMITED');
      }
      await env.DB.prepare(
        `INSERT INTO rate_limits (key, window_at, count) VALUES (?,?,1)
         ON CONFLICT(key, window_at) DO UPDATE SET count = count + 1`
      )
        .bind(key, windowAt)
        .run();
      /*
       * Dọn khung CŨ của chính khoá này.
       *
       * Bảng khoá theo (key, window_at) nên mỗi phút lại sinh thêm một dòng
       * cho mỗi IP -> phình vô hạn nếu chỉ dựa vào cron. Xoá ngay tại đây thì
       * bảng chỉ còn khung hiện tại và khung trước (đệm an toàn cho request
       * đang chạy qua ranh giới khung).
       */
      await env.DB.prepare(
        'DELETE FROM rate_limits WHERE key = ? AND window_at < ?'
      ).bind(key, windowAt - 1).run();
      return { count: count + 1, remaining: limit - count - 1 };
    } catch (e2) {
      if (e2 instanceof ApiError) throw e2;
      /*
       * KV va D1 deu loi -> khong dem duoc.
       *   failClosed = true  -> CHAN (dung cho login/register/webhook: thà
       *                         khoá tạm còn hơn mở toang khi hạ tầng lỗi).
       *   failClosed = false -> cho qua (mặc định, để không chặn oan khách).
       */
      if (failClosed) {
        throw new ApiError(
          429,
          'Hệ thống đang bận, vui lòng thử lại sau ít phút',
          'RATE_LIMIT_UNAVAILABLE',
        );
      }
      // Không chặn người dùng khi hạ tầng đếm lỗi
      return { count: 0, remaining: limit, degraded: true };
    }
  }
}

export function clientIp(request) {
  return request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'unknown';
}
