/**
 * Thống kê công khai cho trang chủ.
 *
 * Chỉ trả số liệu THẬT, không bịa. Nếu chưa có dữ liệu thì trả 0 —
 * frontend tự ẩn hoặc hiện "Đang cập nhật".
 *
 * Không lộ: doanh thu, số dư, thông tin khách hàng.
 *
 * Các câu SQL ở đây được DÙNG CHUNG với /api/home (products.js) để hai
 * đường không bao giờ đếm lệch nhau. Thứ tự trong STATS_SQL là hợp đồng:
 * statsStatements() và shapeStats() dựa vào đúng thứ tự đó.
 */
import { ok } from '../lib/http.js';

export const STATS_CACHE_KEY = 'stats:public:v1';

export const STATS_SQL = {
  // Chỉ đếm đơn đã giao thành công
  orders: "SELECT COUNT(*) n FROM orders WHERE status = 'delivered'",
  products: 'SELECT COUNT(*) n FROM products WHERE active = 1',
  // CHỈ đếm license ĐÃ KÍCH HOẠT (có hwid) — không đếm kho chưa bán.
  // Kho 4000 key chưa bán không phải "license đã cấp cho khách".
  licenses: "SELECT COUNT(*) n FROM licenses WHERE plan != 'trial' AND revoked = 0 AND hwid IS NOT NULL",
  // Chỉ đếm khách đã từng mua (có đơn delivered), bỏ qua tài khoản test
  customers: "SELECT COUNT(DISTINCT user_id) n FROM orders WHERE status = 'delivered'",
  // Tổng key đã giao (kể cả key từ kho)
  keysDelivered: "SELECT COALESCE(SUM(quantity), 0) n FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.status = 'delivered'",
};

/** 5 câu đếm đã prepare, ĐÚNG thứ tự STATS_SQL — dùng cho env.DB.batch(). */
export function statsStatements(env) {
  return Object.values(STATS_SQL).map((sql) => env.DB.prepare(sql));
}

/** Ghép payload thống kê từ object số đếm (thiếu -> 0). */
export function shapeStats(counts = {}) {
  const orders = Number(counts.orders) || 0;
  const products = Number(counts.products) || 0;
  const licenses = Number(counts.licenses) || 0;
  const customers = Number(counts.customers) || 0;
  const keysDelivered = Number(counts.keysDelivered) || 0;
  return {
    orders,
    products,
    licenses,
    customers,
    keysDelivered,
    // Cho frontend biết có nên hiện số không
    hasReal: orders > 0 || licenses > 0,
    updatedAt: Date.now(),
  };
}

/**
 * Ghép payload từ kết quả env.DB.batch() của statsStatements().
 * Mỗi phần tử batch là {results: [...]}; câu COUNT(*) luôn có đúng 1 dòng.
 */
export function shapeStatsFromBatch(rows) {
  const pick = (i, field = 'n') => {
    const r = rows && rows[i] && rows[i].results && rows[i].results[0];
    return r ? r[field] : 0;
  };
  return shapeStats({
    orders: pick(0),
    products: pick(1),
    licenses: pick(2),
    customers: pick(3),
    keysDelivered: pick(4),
  });
}

export async function publicStats(env) {
  // Cache 5 phút để không đếm DB mỗi lần khách vào trang chủ
  const cacheKey = STATS_CACHE_KEY;
  try {
    const cached = await env.CACHE.get(cacheKey);
    if (cached) return ok(JSON.parse(cached));
  } catch { /* KV lỗi -> tính lại */ }

  const one = async (sql, ...args) => {
    try {
      const r = await env.DB.prepare(sql).bind(...args).first();
      return Number(r?.n || 0);
    } catch {
      return 0;
    }
  };

  const [orders, products, licenses, customers, keysDelivered] = await Promise.all([
    one(STATS_SQL.orders),
    one(STATS_SQL.products),
    one(STATS_SQL.licenses),
    one(STATS_SQL.customers),
    one(STATS_SQL.keysDelivered),
  ]);

  const data = shapeStats({ orders, products, licenses, customers, keysDelivered });

  try {
    await env.CACHE.put(cacheKey, JSON.stringify(data), { expirationTtl: 300 });
  } catch { /* ignore */ }

  return ok(data);
}
