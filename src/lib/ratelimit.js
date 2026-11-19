/**
 * Rate limiter cho Cloudflare Worker.
 *
 * VẤN ĐỀ CŨ (P0): mỗi lần gọi làm HAI vòng KV tuần tự — `CACHE.get` rồi
 * `CACHE.put`. KV có độ trễ ~60–200ms mỗi thao tác, nên mọi request /api/*
 * bị cộng thêm ~120–400ms chỉ để đếm. Ngoài ra read-modify-write trên KV
 * KHÔNG nguyên tử (2 isolate cùng đọc 5 -> cả hai ghi 6) nên vừa đắt vừa
 * đếm sai.
 *
 * THIẾT KẾ NAY — hai đường:
 *
 *  1) Đường THƯỜNG (failClosed = false, mặc định):
 *     Bộ đếm TRONG ISOLATE là chốt (0ms), KV chỉ để đồng bộ chéo isolate:
 *       - đọc KV tối đa 1 lần / giây / khoá  (READ_EVERY_MS)
 *       - ghi KV mỗi PUT_EVERY request / khoá
 *     => một đợt burst 5 request trong 1 giây = 1 get + 1 put (so với 10 op
 *        trước đây): giảm ~5x, tức ~0,2 op KV/request (ước tính).
 *
 *  2) Đường NHẠY CẢM (failClosed = true — login / register / trial claim):
 *     MỘT câu D1 `INSERT ... ON CONFLICT DO UPDATE ... RETURNING count`
 *     là NGUYÊN TỬ và đếm ĐÚNG toàn cục, không phụ thuộc isolate. Thay cho
 *     read-modify-write KV cũ vốn có thể đếm thiếu dưới tải song song.
 *     D1 lỗi -> lớp hai vẫn là KV (đọc rồi ghi) rồi mới chặn 429 như cũ.
 *
 * ĐÁNH ĐỔI — ĐỌC KỸ trước khi hạ limit:
 *   - Đường thường ĐẾM THIẾU giữa các isolate: giá trị ghi lên KV là bộ đếm
 *     của riêng isolate đó, không phải tổng toàn cục; các isolate khác chỉ
 *     thấy nó sau tối đa ~1 giây (+ độ trễ eventually-consistent của KV).
 *     Với limit lớn (200–3000/phút) sai số này không đổi hành vi thực tế;
 *     với limit nhỏ mà đếm thiếu là nguy hiểm -> dùng failClosed (D1).
 *   - KV vẫn only-best-effort: thiết kế cũ cũng không đảm bảo chính xác
 *     tuyệt đối, nên đây không phải là "mất" một đảm bảo đang có.
 */
import { ApiError } from './http.js';

const MSG_RATE = 'Bạn thao tác quá nhanh, vui lòng thử lại sau ít phút';
const MSG_BUSY = 'Hệ thống đang bận, vui lòng thử lại sau ít phút';

/** Đọc KV để đồng bộ chéo isolate: tối đa 1 lần / ngần này ms / khoá. */
const READ_EVERY_MS = 1000;
/** Ghi KV mỗi ngần này request / khoá. */
const PUT_EVERY = 5;
/** Trần số khoá sống trong 1 isolate (chống phình bộ nhớ). */
const MAX_BUCKETS = 4096;

/** cacheKey -> { count, puts, readAt, exp } */
const buckets = new Map();

function dropExpired(now) {
  for (const [k, b] of buckets) {
    if (b.exp <= now) buckets.delete(k);
  }
}

/**
 * Đếm NGUYÊN TỬ bằng D1: MỘT câu upsert + RETURNING -> 1 thao tác, đúng
 * toàn cục. Ngưỡng: cho qua đúng `limit` request đầu của khung.
 */
async function d1Bump(env, key, windowAt, limit) {
  const row = await env.DB.prepare(
    `INSERT INTO rate_limits (key, window_at, count) VALUES (?,?,1)
     ON CONFLICT(key, window_at) DO UPDATE SET count = count + 1
     RETURNING count`
  )
    .bind(key, windowAt)
    .first();
  const count = Number(row && row.count) || 1;
  if (count > limit) throw new ApiError(429, MSG_RATE, 'RATE_LIMITED');
  return { count, remaining: Math.max(0, limit - count) };
}

/** Đường nhạy cảm: D1 nguyên tử, KV là lớp dự phòng, cuối cùng mới chặn. */
async function strictLimit(env, key, windowAt, cacheKey, ttl, limit) {
  try {
    return await d1Bump(env, key, windowAt, limit);
  } catch (e) {
    if (e instanceof ApiError) throw e;
    // D1 lỗi -> lớp hai: KV (đọc rồi ghi) như trước đây.
  }
  try {
    const raw = await env.CACHE.get(cacheKey);
    const count = (raw ? Number(raw) : 0) + 1;
    if (count > limit) throw new ApiError(429, MSG_RATE, 'RATE_LIMITED');
    await env.CACHE.put(cacheKey, String(count), { expirationTtl: ttl });
    return { count, remaining: Math.max(0, limit - count) };
  } catch (e2) {
    if (e2 instanceof ApiError) throw e2;
    // Không đếm được ở cả hai lớp -> failClosed: CHẶN.
    throw new ApiError(429, MSG_BUSY, 'RATE_LIMIT_UNAVAILABLE');
  }
}

/**
 * @param {object} env
 * @param {string} key  khoá định danh (ip + route)
 * @param {number} limit  số request tối đa trong window
 * @param {number} windowSec  độ dài window (giây)
 * @param {object} [opts]
 * @param {boolean} [opts.failClosed] khi KHÔNG đếm được thì CHẶN (429) thay vì
 *   cho qua. Dùng cho endpoint nhạy cảm: đăng nhập, đăng ký, trial claim.
 *   Đường này đếm bằng D1 nguyên tử nên chính xác toàn cục.
 *   Mặc định false (fail-open) để hạ tầng đếm hỏng không chặn oan khách.
 */
export async function rateLimit(env, key, limit, windowSec, opts = {}) {
  const failClosed = opts.failClosed === true;
  const nowS = Math.floor(Date.now() / 1000);
  const windowAt = Math.floor(nowS / windowSec);
  const cacheKey = `rl:${key}:${windowAt}`;
  const ttl = Math.max(windowSec, 60);

  if (failClosed) return strictLimit(env, key, windowAt, cacheKey, ttl, limit);

  /* ---------- Đường thường: bộ đếm trong isolate ---------- */
  const now = Date.now();
  let b = buckets.get(cacheKey);
  if (!b) {
    if (buckets.size >= MAX_BUCKETS) dropExpired(now);
    if (buckets.size >= MAX_BUCKETS) {
      /*
       * Quá nhiều khoá đang sống trong isolate này. KHÔNG đuổi bucket còn hạn:
       * đuổi = xoá bộ đếm của chính kẻ đang tấn công (tự reset rate limit).
       * Thay vào đó request này đi đường D1 nguyên tử.
       */
      try {
        return await d1Bump(env, key, windowAt, limit);
      } catch (e) {
        if (e instanceof ApiError) throw e;
        return { count: 0, remaining: limit, degraded: true };
      }
    }
    b = { count: 0, puts: 0, readAt: 0, exp: (windowAt + 1) * windowSec * 1000 };
    buckets.set(cacheKey, b);
  }

  /*
   * Đồng bộ chéo isolate: tối đa 1 lần mỗi READ_EVERY_MS cho mỗi khoá.
   * KHÔNG đọc mỗi request nữa — đó chính là 50% chi phí cũ.
   */
  let kvOk = true;
  if (now - b.readAt >= READ_EVERY_MS) {
    b.readAt = now;
    try {
      const raw = await env.CACHE.get(cacheKey);
      const remote = raw ? Number(raw) : 0;
      if (Number.isFinite(remote) && remote > b.count) b.count = remote;
    } catch {
      // KV đọc lỗi: bộ đếm trong isolate vẫn đúng cho isolate này.
      kvOk = false;
    }
  }

  // Tăng NGAY (đồng bộ) -> trong một burst, mọi request đều được tính.
  b.count += 1;
  if (b.count > limit) throw new ApiError(429, MSG_RATE, 'RATE_LIMITED');

  b.puts += 1;
  if (!kvOk || b.puts >= PUT_EVERY) {
    b.puts = 0;
    try {
      await env.CACHE.put(cacheKey, String(b.count), { expirationTtl: ttl });
    } catch {
      // KV ghi lỗi -> D1 (nguyên tử) giữ mốc toàn cục; nếu D1 cũng lỗi thì
      // fail-open: không chặn khách vì hạ tầng đếm hỏng.
      try {
        const r = await d1Bump(env, key, windowAt, limit);
        if (r.count > b.count) b.count = r.count;
      } catch (e) {
        if (e instanceof ApiError) throw e;
        return {
          count: b.count,
          remaining: Math.max(0, limit - b.count),
          degraded: true,
        };
      }
    }
  }

  return { count: b.count, remaining: Math.max(0, limit - b.count) };
}

export function clientIp(request) {
  return request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'unknown';
}

/* ------------------------------------------------------------------ */
/* BỘ ĐẾM D1 DÙNG CHUNG (audit #11)                                   */
/*                                                                    */
/* Vì sao cần: bộ đếm "sai mật khẩu N lần thì khoá tài khoản" ở        */
/* auth.js trước đây là READ-MODIFY-WRITE trên KV — hai request đồng   */
/* thời cùng đọc count=5 rồi cùng ghi 6, nên kẻ tấn công gửi song song */
/* dò được nhiều hơn ngưỡng. Nay dùng bảng `rate_limits` (đã có sẵn,   */
/* có PRIMARY KEY (key, window_at)) với một câu UPSERT NGUYÊN TỬ.      */
/*                                                                    */
/* Cách dùng đúng:                                                     */
/*   - ĐỌC (không tăng): counterPeek()                                */
/*   - TĂNG nguyên tử: rateLimit(env, key, limit-1, windowSec,         */
/*     { failClosed: true }) — tự ném RATE_LIMITED khi vượt ngưỡng.   */
/*   - XOÁ khi thành công: counterClear()                              */
/* ------------------------------------------------------------------ */

/** Chỉ số khung hiện tại — phải khớp công thức trong rateLimit(). */
export function windowIndex(windowSec) {
  return Math.floor(Math.floor(Date.now() / 1000) / windowSec);
}

/** Đọc bộ đếm của khung hiện tại (KHÔNG tăng). Lỗi D1 -> ném ra cho bên gọi. */
export async function counterPeek(env, key, windowSec) {
  const row = await env.DB.prepare(
    'SELECT count FROM rate_limits WHERE key = ? AND window_at = ?'
  ).bind(String(key), windowIndex(windowSec)).first();
  return Number(row && row.count) || 0;
}

/** Xoá bộ đếm của khung hiện tại (dùng khi đăng nhập THÀNH CÔNG). */
export async function counterClear(env, key, windowSec) {
  await env.DB.prepare(
    'DELETE FROM rate_limits WHERE key = ? AND window_at = ?'
  ).bind(String(key), windowIndex(windowSec)).run();
}
