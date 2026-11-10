import { readFileSync, writeFileSync } from 'node:fs';

const f = 'src/routes/orders.js';
let c = readFileSync(f, 'utf8');
const report = [];

// 1. Thêm hàm releaseCoupon
const couponHelper = `
/** Trả lại lượt dùng coupon khi đơn không thành công. */
export async function releaseCoupon(env, code) {
  if (!code) return;
  try {
    await env.DB.prepare(
      'UPDATE coupons SET used_count = MAX(0, used_count - 1) WHERE code = ?'
    ).bind(String(code).toUpperCase()).run();
  } catch { /* không chặn luồng chính */ }
}
`;

if (!c.includes('export async function releaseCoupon')) {
  c = c.replace(/\/\*\* Lấy & kiểm tra coupon, trả về số tiền giảm\. \*\//, couponHelper.trim() + '\n\n/** Lấy & kiểm tra coupon, trả về số tiền giảm. */');
  report.push('✓ thêm releaseCoupon');
}

// 2. Gọi releaseCoupon ở các nhánh thất bại trong payOrder
const failPaths = [
  ["      ).bind(`Hết hàng: ${item.product_name}`, orderId).run();",
   "      ).bind(`Hết hàng: ${item.product_name}`, orderId).run();\n      await releaseCoupon(env, order.coupon_code);"],
  ["      ).bind(orderId).run();\n      throw new ApiError(409, 'Có lỗi khi giữ hàng, đã hoàn tiền. Vui lòng thử lại.', 'CONFLICT');",
   "      ).bind(orderId).run();\n      await releaseCoupon(env, order.coupon_code);\n      throw new ApiError(409, 'Có lỗi khi giữ hàng, đã hoàn tiền. Vui lòng thử lại.', 'CONFLICT');"],
];

for (const [from, to] of failPaths) {
  if (c.includes(from) && !c.includes(to)) {
    c = c.split(from).join(to);
    report.push(`✓ releaseCoupon tại: ${from.trim().slice(0, 40)}`);
  }
}

// 3. Hoàn coupon khi admin refund
const refundAnchor = "  await env.DB.prepare(\"UPDATE orders SET status='refunded' WHERE id = ?\").bind(orderId).run();";
if (c.includes(refundAnchor) && !c.includes('releaseCoupon(env, o.coupon_code)')) {
  c = c.replace(refundAnchor,
    "  await env.DB.prepare(\"UPDATE orders SET status='refunded' WHERE id = ?\").bind(orderId).run();\n  await releaseCoupon(env, o.coupon_code);");
  report.push('✓ releaseCoupon khi refund');
}

writeFileSync(f, c, 'utf8');
console.log(report.join('\n') || 'không có thay đổi');
console.log('\nreleaseCoupon có mặt:', c.includes('export async function releaseCoupon'));
console.log('số lần gọi:', (c.match(/await releaseCoupon/g) || []).length);
