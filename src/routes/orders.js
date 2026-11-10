/** Nghiệp vụ đơn hàng: tạo đơn, thanh toán ví, giao key tự động. */
import { ok, ApiError, readJson } from '../lib/http.js';
import { int, str } from '../lib/validate.js';
import { uuid, orderCode } from '../lib/crypto.js';
import { requireUser, requireAdmin } from '../lib/auth.js';
import { rateLimit, clientIp } from '../lib/ratelimit.js';
import { syncStock, audit } from './products.js';
import { deliverLicenseLine } from './license.js';

/** Trả lại lượt dùng coupon khi đơn không thành công. */
/**
 * Trả lại lượt dùng coupon.
 *
 * @param {string=} orderId Nếu có, đánh dấu order.coupon_released = 1 để
 *   cron không trả thêm lần nữa (gây used_count thấp hơn thực tế).
 */
export async function releaseCoupon(env, code, orderId) {
  if (!code) return;
  try {
    const upper = String(code).toUpperCase();

    // Nếu đã đánh dấu rồi thì bỏ qua (idempotent)
    if (orderId) {
      const o = await env.DB.prepare(
        'SELECT coupon_released FROM orders WHERE id = ?'
      ).bind(orderId).first();
      if (o?.coupon_released) return;
    }

    await env.DB.prepare(
      'UPDATE coupons SET used_count = MAX(0, used_count - 1) WHERE code = ?'
    ).bind(upper).run();

    if (orderId) {
      await env.DB.prepare(
        'UPDATE orders SET coupon_released = 1 WHERE id = ?'
      ).bind(orderId).run();
    }
  } catch { /* không chặn luồng chính */ }
}

/**
 * Mã giảm giá đã BỊ GỠ theo yêu cầu chủ shop.
 *
 * Mọi nỗ lực dùng coupon — qua UI hay gọi thẳng API — đều bị từ chối.
 * Giữ hàm để không phải sửa mọi nơi gọi, nhưng luôn trả 0 giảm giá.
 */
async function resolveCoupon(env, code, subtotal) {
  if (!code) return { discount: 0, coupon: null };
  throw new ApiError(400,
    'Cửa hàng không áp dụng mã giảm giá. Giá hiển thị là giá cuối cùng.',
    'COUPON_DISABLED');
}

export async function checkCoupon(env, request) {
  await requireUser(env, request);
  throw new ApiError(400,
    'Cửa hàng không áp dụng mã giảm giá.',
    'COUPON_DISABLED');
}

/** Tạo đơn hàng ở trạng thái pending. */
export async function createOrder(env, request) {
  const user = await requireUser(env, request);
  const ip = clientIp(request);
  await rateLimit(env, `order:${user.id}:${ip}`, 20, 600);

  const body = await readJson(request);
  if (!Array.isArray(body.items) || body.items.length === 0) {
    throw new ApiError(400, 'Giỏ hàng trống', 'VALIDATION');
  }
  if (body.items.length > 20) throw new ApiError(400, 'Tối đa 20 sản phẩm mỗi đơn', 'VALIDATION');

  // Gộp item theo product + kiểm tra tồn kho
  const merged = new Map();
  for (const it of body.items) {
    const pid = str(it.productId, 'productId', { max: 64 });
    const qty = int(it.quantity ?? 1, 'quantity', { min: 1, max: 20 });
    merged.set(pid, (merged.get(pid) || 0) + qty);
  }

  // Chặn tổng số lượng sau khi gộp (trước đây 20 dòng x 20 = 400 vẫn lọt)
  let totalQty = 0;
  for (const q of merged.values()) {
    if (q > 20) {
      throw new ApiError(400, `Mỗi sản phẩm tối đa 20 cái (bạn chọn ${q})`, 'VALIDATION');
    }
    totalQty += q;
  }
  if (totalQty > 20) {
    throw new ApiError(400, `Tổng số lượng tối đa 20 sản phẩm mỗi đơn (bạn chọn ${totalQty})`, 'VALIDATION');
  }

  const lines = [];
  let subtotal = 0;
  for (const [pid, qty] of merged) {
    const p = await env.DB.prepare(
      'SELECT id, name, price, stock_count, delivery_type, active FROM products WHERE id = ?'
    )
      .bind(pid)
      .first();
    if (!p || !p.active) throw new ApiError(400, 'Sản phẩm không tồn tại hoặc đã ngừng bán', 'NOT_FOUND');
    // 'license' sinh key động nên không giới hạn tồn kho
    if (p.delivery_type !== 'manual' && p.delivery_type !== 'license' && p.stock_count < qty) {
      throw new ApiError(400, `"${p.name}" chỉ còn ${p.stock_count} sản phẩm trong kho`, 'OUT_OF_STOCK');
    }
    const lineTotal = p.price * qty;
    subtotal += lineTotal;
    lines.push({ product: p, qty, unitPrice: p.price, lineTotal });
  }

  const couponCode = body.couponCode ? str(body.couponCode, 'couponCode', { max: 40 }) : null;
  const { discount, coupon } = await resolveCoupon(env, couponCode, subtotal);
  const total = subtotal - discount;

  if (total < 0) throw new ApiError(400, 'Tổng tiền không hợp lệ', 'VALIDATION');
  if (total === 0 && subtotal > 0) throw new ApiError(400, 'Tổng tiền không hợp lệ', 'VALIDATION');
  if (subtotal <= 0) throw new ApiError(400, 'Đơn hàng phải có giá trị lớn hơn 0', 'VALIDATION');

  const orderId = uuid();
  const code = orderCode();
  const now = Date.now();

  const stmts = [
    env.DB.prepare(
      `INSERT INTO orders (id, code, user_id, status, subtotal, discount, total, coupon_code, payment_method, note, created_at)
       VALUES (?,?,?,'pending',?,?,?,?,'wallet',?,?)`
    ).bind(orderId, code, user.id, subtotal, discount, total, coupon ? coupon.code : null,
      str(body.note, 'note', { required: false, max: 500 }) || null, now),
    ...lines.map((l) =>
      env.DB.prepare(
        `INSERT INTO order_items (id, order_id, product_id, product_name, unit_price, quantity, line_total)
         VALUES (?,?,?,?,?,?,?)`
      ).bind(uuid(), orderId, l.product.id, l.product.name, l.unitPrice, l.qty, l.lineTotal)
    ),
  ];

  if (coupon) {
    stmts.push(
      env.DB.prepare('UPDATE coupons SET used_count = used_count + 1 WHERE id = ?').bind(coupon.id)
    );
  }

  await env.DB.batch(stmts);

  return ok({
    order: {
      id: orderId,
      code,
      subtotal,
      discount,
      total,
      status: 'pending',
      items: lines.map((l) => ({
        productId: l.product.id,
        name: l.product.name,
        unitPrice: l.unitPrice,
        quantity: l.qty,
        lineTotal: l.lineTotal,
      })),
    },
  }, 201);
}

/**
 * Thanh toán đơn bằng số dư ví và giao key ngay lập tức.
 * Toàn bộ key được reserve bằng UPDATE có điều kiện để tránh bán trùng.
 */
export async function payOrder(env, request, orderId) {
  const user = await requireUser(env, request);
  await rateLimit(env, `pay:${user.id}`, 30, 300);

  const order = await env.DB.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ? LIMIT 1')
    .bind(orderId, user.id)
    .first();
  if (!order) throw new ApiError(404, 'Đơn hàng không tồn tại', 'NOT_FOUND');
  if (order.status === 'delivered' || order.status === 'paid') {
    throw new ApiError(409, 'Đơn hàng đã được thanh toán', 'ALREADY_PAID');
  }
  if (order.status === 'processing') {
    throw new ApiError(409, 'Đơn hàng đang được xử lý, vui lòng chờ', 'PROCESSING');
  }
  if (order.status !== 'pending') throw new ApiError(409, 'Đơn hàng không ở trạng thái chờ thanh toán', 'BAD_STATE');

  // ===== GIÀNH ĐƠN NGUYÊN TỬ =====
  // Nhiều request đồng thời có thể cùng đọc status='pending' rồi cùng trừ tiền.
  // UPDATE có điều kiện dưới đây đảm bảo CHỈ MỘT request chuyển được pending -> processing.
  const claimAt = Date.now();
  const claim = await env.DB.prepare(
    `UPDATE orders SET status = 'processing', paid_at = ?, processing_started_at = ?
     WHERE id = ? AND status = 'pending'`
  ).bind(claimAt, claimAt, orderId).run();
  if (!claim.meta || claim.meta.changes !== 1) {
    throw new ApiError(409, 'Đơn hàng đã được thanh toán', 'ALREADY_PAID');
  }

  const fresh = await env.DB.prepare('SELECT balance FROM users WHERE id = ?').bind(user.id).first();
  if (!fresh || fresh.balance < order.total) {
    // Nhả đơn về pending để khách nạp thêm rồi thử lại
    await env.DB.prepare(
      `UPDATE orders SET status = 'pending', paid_at = NULL WHERE id = ? AND status = 'processing'`
    ).bind(orderId).run();
    throw new ApiError(400, 'Số dư ví không đủ. Vui lòng nạp thêm tiền.', 'INSUFFICIENT_BALANCE', {
      balance: fresh ? fresh.balance : 0,
      required: order.total,
      missing: order.total - (fresh ? fresh.balance : 0),
    });
  }

  const { results: items } = await env.DB.prepare(
    'SELECT * FROM order_items WHERE order_id = ?'
  ).bind(orderId).all();

  // ===== KIỂM TRA SẢN PHẨM TỒN TẠI / ĐỦ HÀNG TRƯỚC KHI TRỪ TIỀN =====
  // Trước đây trừ tiền xong mới kiểm tra -> sản phẩm bị xoá thì throw
  // PRODUCT_GONE mà KHÔNG hoàn tiền, cũng không ghi sổ cái.
  // Đã xảy ra thật: MBK-3KWKLR mất 123.000đ không dấu vết.
  const planned = [];
  let allDelivered = true;

  for (const item of items || []) {
    const product = await env.DB.prepare(
      'SELECT id, name, delivery_type, license_prefix, license_days FROM products WHERE id = ?'
    ).bind(item.product_id).first();

    if (!product) {
      // Chưa trừ tiền -> chỉ cần nhả đơn, không cần hoàn
      await env.DB.prepare(
        "UPDATE orders SET status='pending', paid_at=NULL, note = ? WHERE id = ? AND status='processing'"
      ).bind(`Sản phẩm đã bị xoá: ${item.product_name}`, orderId).run();
      await releaseCoupon(env, order.coupon_code, orderId);
      throw new ApiError(409,
        `Sản phẩm "${item.product_name}" không còn tồn tại. Chưa trừ tiền, vui lòng đặt lại đơn.`,
        'PRODUCT_GONE');
    }

    // Dòng đã giao ở lần trước (đơn bị trả về pending) -> không giao lại
    const already = safeParse(item.delivered_keys);
    if (already.length > 0) {
      if (product.delivery_type === 'manual') allDelivered = false;
      planned.push({ item, product, qty: item.quantity, kind: 'already', keys: already });
      continue;
    }

    if (product.delivery_type === 'manual') {
      allDelivered = false;
      planned.push({ item, product, qty: item.quantity, kind: 'manual' });
      continue;
    }

    if (product.delivery_type === 'license') {
      planned.push({ item, product, qty: item.quantity, kind: 'license' });
      continue;
    }

    // Hàng key: kiểm tra tồn kho trước
    const avail = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM product_keys WHERE product_id = ? AND status = 'available'"
    ).bind(item.product_id).first();
    if ((avail?.n || 0) < item.quantity) {
      await env.DB.prepare(
        "UPDATE orders SET status='pending', paid_at=NULL, note = ? WHERE id = ? AND status='processing'"
      ).bind(`Hết hàng: ${item.product_name}`, orderId).run();
      await releaseCoupon(env, order.coupon_code, orderId);
      throw new ApiError(409,
        `Sản phẩm "${item.product_name}" chỉ còn ${avail?.n || 0}. Chưa trừ tiền, vui lòng đặt lại đơn.`,
        'OUT_OF_STOCK');
    }
    planned.push({ item, product, qty: item.quantity, kind: 'key' });
  }

  // ===== TRỪ TIỀN (sau khi đã chắc chắn giao được) =====
  const debit = await env.DB.prepare(
    'UPDATE users SET balance = balance - ?, updated_at = ? WHERE id = ? AND balance >= ?'
  )
    .bind(order.total, Date.now(), user.id, order.total)
    .run();
  if (!debit.meta || debit.meta.changes !== 1) {
    await env.DB.prepare(
      `UPDATE orders SET status = 'pending', paid_at = NULL WHERE id = ? AND status = 'processing'`
    ).bind(orderId).run();
    throw new ApiError(400, 'Số dư không đủ hoặc giao dịch đồng thời. Vui lòng thử lại.', 'CONFLICT');
  }

  // Từ đây tiền ĐÃ TRỪ. Mọi lỗi phải hoàn tiền + ghi sổ.
  const now = Date.now();
  const delivered = [];

  try {
    // ===== BƯỚC 3: GIAO HÀNG =====
    for (const plan of planned) {
      const { item, product, qty, kind } = plan;

      if (kind === 'manual') {
        delivered.push({
          productId: item.product_id, name: item.product_name, keys: [], manual: true,
        });
        continue;
      }

      if (kind === 'already') {
        delivered.push({
          productId: item.product_id, name: item.product_name,
          keys: plan.keys, license: product.delivery_type === 'license',
          manual: false,
        });
        continue;
      }

      if (kind === 'license') {
        const licKeys = await deliverLicenseLine(env, {
          order, orderId, userId: user.id, product, quantity: qty,
        });
        await env.DB.prepare('UPDATE order_items SET delivered_keys = ? WHERE id = ?')
          .bind(JSON.stringify(licKeys), item.id).run();
        await env.DB.prepare('UPDATE products SET sold_count = sold_count + ? WHERE id = ?')
          .bind(qty, item.product_id).run();
        delivered.push({
          productId: item.product_id, name: item.product_name,
          keys: licKeys.map((k) => btoaSafe(k)), raw: licKeys, license: true,
        });
        continue;
      }

      // Lấy & giữ key hàng loạt
      const { results: keys } = await env.DB.prepare(
        `SELECT id, secret FROM product_keys
         WHERE product_id = ? AND status = 'available'
         ORDER BY created_at ASC LIMIT ?`
      ).bind(item.product_id, qty).all();

      const secrets = [];
      for (const k of keys || []) {
        const up = await env.DB.prepare(
          `UPDATE product_keys SET status='sold', order_id=?, delivered_at=?
           WHERE id = ? AND status='available'`
        ).bind(orderId, now, k.id).run();
        if (up.meta && up.meta.changes === 1) secrets.push(k.secret);
      }

      if (secrets.length < qty) {
        // Race hiếm: trả lại key đã giữ rồi throw -> catch bên ngoài hoàn tiền
        for (const k of keys || []) {
          await env.DB.prepare(
            `UPDATE product_keys SET status='available', order_id=NULL, delivered_at=NULL
             WHERE id = ? AND order_id = ?`
          ).bind(k.id, orderId).run();
        }
        throw new ApiError(409, 'Có lỗi khi giữ hàng, đã hoàn tiền. Vui lòng thử lại.', 'CONFLICT');
      }

      await env.DB.prepare('UPDATE order_items SET delivered_keys = ? WHERE id = ?')
        .bind(JSON.stringify(secrets), item.id).run();
      await env.DB.prepare('UPDATE products SET sold_count = sold_count + ? WHERE id = ?')
        .bind(qty, item.product_id).run();
      delivered.push({ productId: item.product_id, name: item.product_name, keys: secrets, manual: false });
      await syncStock(env, item.product_id);
    }
  } catch (err) {
    // ===== GIAO HÀNG LỖI -> HOÀN TIỀN NGAY, GHI SỔ ĐẦY ĐỦ =====
    // Đây là chỗ trước đây bỏ sót: throw mà không hoàn tiền.
    await env.DB.prepare('UPDATE users SET balance = balance + ?, updated_at = ? WHERE id = ?')
      .bind(order.total, Date.now(), user.id).run();
    await env.DB.prepare(
      "UPDATE orders SET status='pending', paid_at=NULL WHERE id = ? AND status='processing'"
    ).bind(orderId).run();
    await releaseCoupon(env, order.coupon_code, orderId);

    // Ghi sổ hoàn tiền để sổ cái khớp (debit ở trên + credit ở đây = 0)
    try {
      const balNow = await env.DB.prepare('SELECT balance FROM users WHERE id = ?')
        .bind(user.id).first();
      await env.DB.prepare(
        `INSERT INTO wallet_transactions
           (id, user_id, type, amount, balance_after, status, reference, description, created_at)
         VALUES (?,?,'refund',?,?,'success',?,?,?)`
      ).bind(uuid(), user.id, order.total, balNow.balance, order.code,
        `Hoàn tiền do lỗi giao hàng đơn ${order.code}`, Date.now()).run();
    } catch { /* không để lỗi ghi sổ che lỗi gốc */ }

    await audit(env, null, 'order.deliver_failed_refund', orderId, {
      amount: order.total, error: err.message,
    });
    throw err;
  }

  const finalStatus = allDelivered ? 'delivered' : 'paid';
  await env.DB.prepare(
    `UPDATE orders SET status = ?, paid_at = COALESCE(paid_at, ?), delivered_at = ?, ledger_written = 1 WHERE id = ?`
  ).bind(finalStatus, now, allDelivered ? now : null, orderId).run();

  const balRow = await env.DB.prepare('SELECT balance FROM users WHERE id = ?').bind(user.id).first();
  await env.DB.prepare(
    `INSERT INTO wallet_transactions (id, user_id, type, amount, balance_after, status, reference, description, created_at)
     VALUES (?,?,'purchase',?,?,'success',?,?,?)`
  ).bind(uuid(), user.id, -order.total, balRow.balance, order.code, `Thanh toán đơn ${order.code}`, now).run();

  await audit(env, user.id, 'order.pay', orderId, { total: order.total, status: finalStatus });

  return ok({
    order: {
      id: orderId,
      code: order.code,
      status: finalStatus,
      total: order.total,
      delivered,
    },
    balance: balRow.balance,
  });
}

export async function listOrders(env, request) {
  const user = await requireUser(env, request);
  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get('page') || 1));
  const perPage = Math.min(50, Math.max(1, Number(url.searchParams.get('perPage') || 10)));

  const { results } = await env.DB.prepare(
    `SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`
  ).bind(user.id, perPage, (page - 1) * perPage).all();

  const rows = results || [];
  if (rows.length === 0) return ok({ orders: [] });

  // 1 query lấy TOÀN BỘ item của trang này (thay vì 1 query mỗi đơn -> N+1)
  const ids = rows.map((o) => o.id);
  const placeholders = ids.map(() => '?').join(',');
  const { results: allItems } = await env.DB.prepare(
    `SELECT order_id, product_id, product_name, unit_price, quantity, line_total, delivered_keys
     FROM order_items WHERE order_id IN (${placeholders})`
  ).bind(...ids).all();

  const itemsByOrder = new Map();
  for (const i of allItems || []) {
    if (!itemsByOrder.has(i.order_id)) itemsByOrder.set(i.order_id, []);
    itemsByOrder.get(i.order_id).push({
      productId: i.product_id,
      name: i.product_name,
      unitPrice: i.unit_price,
      quantity: i.quantity,
      lineTotal: i.line_total,
      keys: safeParse(i.delivered_keys),
    });
  }

  const orders = rows.map((o) => ({
    id: o.id,
    code: o.code,
    status: o.status,
    subtotal: o.subtotal,
    discount: o.discount,
    total: o.total,
    couponCode: o.coupon_code,
    createdAt: o.created_at,
    items: itemsByOrder.get(o.id) || [],
  }));
  return ok({ orders });
}

export async function getOrder(env, request, orderId) {
  const user = await requireUser(env, request);
  const o = await env.DB.prepare('SELECT * FROM orders WHERE (id = ? OR code = ?) AND user_id = ? LIMIT 1')
    .bind(orderId, orderId, user.id)
    .first();
  if (!o) throw new ApiError(404, 'Đơn hàng không tồn tại', 'NOT_FOUND');

  const { results: items } = await env.DB.prepare(
    'SELECT product_id, product_name, unit_price, quantity, line_total, delivered_keys FROM order_items WHERE order_id = ?'
  ).bind(o.id).all();

  return ok({
    order: {
      id: o.id,
      code: o.code,
      status: o.status,
      subtotal: o.subtotal,
      discount: o.discount,
      total: o.total,
      createdAt: o.created_at,
      paidAt: o.paid_at,
      items: (items || []).map((i) => ({
        productId: i.product_id,
        name: i.product_name,
        unitPrice: i.unit_price,
        quantity: i.quantity,
        lineTotal: i.line_total,
        keys: safeParse(i.delivered_keys),
      })),
    },
  });
}

function safeParse(s) {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/** Base64 an toàn cho chuỗi ASCII (dùng chung định dạng với key thường). */
function btoaSafe(s) {
  try {
    return btoa(unescape(encodeURIComponent(s)));
  } catch {
    return btoa(String(s));
  }
}

/* ---------------- Admin: quản lý đơn ---------------- */

export async function adminListOrders(env, request) {
  await requireAdmin(env, request);
  const url = new URL(request.url);
  const status = url.searchParams.get('status') || '';
  const q = (url.searchParams.get('q') || '').trim();
  const binds = [];
  const where = ['1=1'];
  if (status) {
    where.push('o.status = ?');
    binds.push(status);
  }
  if (q) {
    where.push('(o.code LIKE ? OR u.email LIKE ?)');
    binds.push(`%${q}%`, `%${q}%`);
  }
  const { results } = await env.DB.prepare(
    `SELECT o.*, u.email, u.full_name FROM orders o JOIN users u ON u.id = o.user_id
     WHERE ${where.join(' AND ')} ORDER BY o.created_at DESC LIMIT 200`
  ).bind(...binds).all();
  return ok({
    orders: (results || []).map((o) => ({
      id: o.id,
      code: o.code,
      email: o.email,
      customer: o.full_name,
      status: o.status,
      total: o.total,
      createdAt: o.created_at,
    })),
  });
}

export async function adminDeliverManual(env, request, orderId) {
  const admin = await requireAdmin(env, request);
  const o = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(orderId).first();
  if (!o) throw new ApiError(404, 'Đơn hàng không tồn tại', 'NOT_FOUND');
  // Chỉ giao đơn đã thanh toán — trước đây giao được cả đơn pending
  if (!['paid', 'delivered'].includes(o.status)) {
    throw new ApiError(409,
      `Chỉ giao đơn đã thanh toán. Đơn này đang "${o.status}".`, 'BAD_STATE');
  }
  await env.DB.prepare("UPDATE orders SET status='delivered', delivered_at = ? WHERE id = ?")
    .bind(Date.now(), orderId).run();
  await audit(env, admin.id, 'order.manual_deliver', orderId, {});
  return ok({ id: orderId });
}

export async function adminRefund(env, request, orderId) {
  const admin = await requireAdmin(env, request);
  const o = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(orderId).first();
  if (!o) throw new ApiError(404, 'Đơn hàng không tồn tại', 'NOT_FOUND');
  if (o.status === 'refunded') throw new ApiError(409, 'Đơn đã được hoàn tiền', 'BAD_STATE');

  // ===== CHỈ HOÀN TIỀN ĐƠN ĐÃ THANH TOÁN =====
  // Trước đây refund được cả đơn 'pending' (chưa trừ đồng nào) -> cộng tiền khống.
  if (!['paid', 'delivered'].includes(o.status)) {
    throw new ApiError(409,
      `Chỉ hoàn tiền đơn đã thanh toán. Đơn này đang ở trạng thái "${o.status}".`, 'BAD_STATE');
  }

  // ===== GIÀNH ĐƠN NGUYÊN TỬ =====
  // Nhiều request refund đồng thời đều pass kiểm tra và cộng tiền nhiều lần.
  const claim = await env.DB.prepare(
    `UPDATE orders SET status = 'refunding', refund_started_at = ?
     WHERE id = ? AND status IN ('paid','delivered')`
  ).bind(Date.now(), orderId).run();
  if (!claim.meta || claim.meta.changes !== 1) {
    throw new ApiError(409, 'Đơn đã được hoàn tiền', 'BAD_STATE');
  }

  const now = Date.now();

  // ===== THU HỒI HÀNG ĐÃ GIAO =====
  // Hoàn tiền mà giữ key thì khách được cả tiền lẫn hàng.
  const revoked = { keys: 0, licenses: 0 };
  try {
    // 1. Thu hồi license đã phát hành cho đơn này
    const { results: issues } = await env.DB.prepare(
      'SELECT license_key FROM license_issues WHERE order_id = ?'
    ).bind(orderId).all();
    for (const row of issues || []) {
      await env.DB.prepare('UPDATE licenses SET revoked = 1 WHERE key = ?')
        .bind(row.license_key).run();
      await env.DB.prepare(
        'INSERT INTO lic_events (key, hwid, kind, detail, ip, at) VALUES (?,?,?,?,?,?)'
      ).bind(row.license_key, null, 'revoke', `refund ${o.code}`, '', Math.floor(now / 1000)).run();
      revoked.licenses++;
    }

    // 2. Thu hồi key kho đã giao (đưa về disabled, không bán lại được)
    const { results: soldKeys } = await env.DB.prepare(
      "SELECT id, product_id FROM product_keys WHERE order_id = ? AND status = 'sold'"
    ).bind(orderId).all();
    const affectedProducts = new Set();
    for (const k of soldKeys || []) {
      await env.DB.prepare("UPDATE product_keys SET status='disabled' WHERE id = ?")
        .bind(k.id).run();
      affectedProducts.add(k.product_id);
      revoked.keys++;
    }
    for (const pid of affectedProducts) {
      await syncStock(env, pid);
    }

    // 3. Giảm sold_count tương ứng
    const { results: items } = await env.DB.prepare(
      'SELECT product_id, quantity FROM order_items WHERE order_id = ?'
    ).bind(orderId).all();
    for (const it of items || []) {
      await env.DB.prepare(
        'UPDATE products SET sold_count = MAX(0, sold_count - ?) WHERE id = ?'
      ).bind(it.quantity, it.product_id).run();
    }
  } catch (e) {
    console.error('Refund revoke error:', e && e.message);
  }

  await env.DB.prepare('UPDATE users SET balance = balance + ?, updated_at = ? WHERE id = ?')
    .bind(o.total, now, o.user_id).run();
  await env.DB.prepare("UPDATE orders SET status='refunded' WHERE id = ?").bind(orderId).run();
  await releaseCoupon(env, o.coupon_code, orderId);

  const bal = await env.DB.prepare('SELECT balance FROM users WHERE id = ?').bind(o.user_id).first();
  await env.DB.prepare(
    `INSERT INTO wallet_transactions (id, user_id, type, amount, balance_after, status, reference, description, created_at)
     VALUES (?,?,'refund',?,?,'success',?,?,?)`
  ).bind(uuid(), o.user_id, o.total, bal.balance, o.code,
    `Hoàn tiền đơn ${o.code}${revoked.licenses ? ` (thu hồi ${revoked.licenses} license)` : ''}`,
    now).run();

  await audit(env, admin.id, 'order.refund', orderId, { total: o.total, revoked });
  return ok({ id: orderId, revoked });
}
