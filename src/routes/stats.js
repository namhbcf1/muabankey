/**
 * Thống kê công khai cho trang chủ.
 *
 * Chỉ trả số liệu THẬT, không bịa. Nếu chưa có dữ liệu thì trả 0 —
 * frontend tự ẩn hoặc hiện "Đang cập nhật".
 *
 * Không lộ: doanh thu, số dư, thông tin khách hàng.
 */
import { ok } from '../lib/http.js';

export async function publicStats(env) {
  // Cache 5 phút để không đếm DB mỗi lần khách vào trang chủ
  const cacheKey = 'stats:public:v1';
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
    // Chỉ đếm đơn đã giao thành công
    one("SELECT COUNT(*) n FROM orders WHERE status = 'delivered'"),
    one("SELECT COUNT(*) n FROM products WHERE active = 1"),
    // CHỈ đếm license ĐÃ KÍCH HOẠT (có hwid) — không đếm kho chưa bán.
    // Kho 4000 key chưa bán không phải "license đã cấp cho khách".
    one("SELECT COUNT(*) n FROM licenses WHERE plan != 'trial' AND revoked = 0 AND hwid IS NOT NULL"),
    // Chỉ đếm khách đã từng mua (có đơn delivered), bỏ qua tài khoản test
    one(`SELECT COUNT(DISTINCT user_id) n FROM orders WHERE status = 'delivered'`),
    // Tổng key đã giao (kể cả key từ kho)
    one("SELECT COALESCE(SUM(quantity), 0) n FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.status = 'delivered'"),
  ]);

  const data = {
    orders,
    products,
    licenses,
    customers,
    keysDelivered,
    // Cho frontend biết có nên hiện số không
    hasReal: orders > 0 || licenses > 0,
    updatedAt: Date.now(),
  };

  try {
    await env.CACHE.put(cacheKey, JSON.stringify(data), { expirationTtl: 300 });
  } catch { /* ignore */ }

  return ok(data);
}
