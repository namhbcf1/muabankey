/** Nghiệp vụ đơn hàng: tạo đơn, thanh toán ví, giao key tự động. */
import { ok, ApiError, readJson } from '../lib/http.js';
import { int, str, pageNum } from '../lib/validate.js';
import { uuid, orderCode } from '../lib/crypto.js';
import { requireUser, requireAdmin, requireAdminStrict } from '../lib/auth.js';
import { rateLimit, clientIp } from '../lib/ratelimit.js';
import { audit } from './products.js';
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
/**
 * Giao hàng cho đơn ĐÃ ĐƯỢC XÁC NHẬN THANH TOÁN.
 *
 * KHÔNG trừ ví (không còn ví). Chỉ:
 *   1. Kiểm tra sản phẩm còn tồn tại + đủ hàng
 *   2. Giữ key / cấp license / đánh dấu manual
 *   3. Cập nhật order_items.delivered_keys
 *
 * Trả { pendingManual, delivered } — hàm gọi (payments.js) tự chốt status.
 * Ném lỗi nếu không giao được -> payments.js đặt 'paid' + admin_note.
 */
export async function deliverOrderItems(env, order) {
  const orderId = order.id;

  const { results: items } = await env.DB.prepare(
    'SELECT * FROM order_items WHERE order_id = ?'
  ).bind(orderId).all();

  const planned = [];
  let pendingManual = false;

  // ===== BƯỚC 1: KIỂM TRA TRƯỚC KHI GIỮ HÀNG =====
  for (const item of items || []) {
    let product;
    try {
      // `pid` có ở DB production mới; fallback giữ tương thích schema cũ.
      product = await env.DB.prepare(
        'SELECT id, name, delivery_type, pid, license_prefix, license_days FROM products WHERE id = ?'
      ).bind(item.product_id).first();
    } catch (e) {
      if (!/no such column: pid/i.test(String(e?.message || e))) throw e;
      product = await env.DB.prepare(
        'SELECT id, name, delivery_type, license_prefix, license_days FROM products WHERE id = ?'
      ).bind(item.product_id).first();
    }

    if (!product) {
      throw new Error(`Sản phẩm "${item.product_name}" không còn tồn tại`);
    }

    // Dòng đã giao lần trước -> không giao lại
    const already = await safeParse(item.delivered_keys, env);
    if (already.length > 0) {
      if (product.delivery_type === 'manual') pendingManual = true;
      planned.push({ item, product, qty: item.quantity, kind: 'already', keys: already });
      continue;
    }

    if (product.delivery_type === 'manual') {
      pendingManual = true;
      planned.push({ item, product, qty: item.quantity, kind: 'manual' });
      continue;
    }

    if (product.delivery_type === 'license') {
      planned.push({ item, product, qty: item.quantity, kind: 'license' });
      continue;
    }

    /*
     * ĐÃ BỎ kiểu giao hàng 'key' / 'account' (kho key tĩnh).
     *
     * Shop chỉ bán license sinh động (`delivery_type='license'`) và giao tay
     * (`manual`). Bảng `product_keys` đã xoá cùng bảng kho key.
     *
     * Nếu dữ liệu cũ còn sót một sản phẩm kiểu 'key', ném lỗi RÕ RÀNG thay vì
     * giao nhầm — trước đây nhánh này âm thầm đọc kho rỗng rồi báo "không đủ
     * hàng", khách tưởng hết hàng trong khi thật ra kiểu giao hàng đã bị bỏ.
     */
    throw new Error(
      `"${item.product_name}" dùng kiểu giao hàng không còn hỗ trợ (${product.delivery_type})`
    );
  }

  // ===== BƯỚC 2: GIAO =====
  const delivered = [];

  /*
   * SỔ TÀI NGUYÊN ĐÃ GIAO TRONG CHÍNH REQUEST NÀY.
   *
   * VÌ SAO PHẢI GHI LẠI: vòng lặp dưới đây giao hàng LOẠT nhiều dòng. Dòng 1
   * (license 180k) có thể đã sinh license THẬT vào bảng `licenses` rồi dòng 2
   * (key kho 50k) mới thất bại. Không có sổ này thì khi catch chỉ còn biết
   * "đơn lỗi", không biết đã kịp tạo những gì để mà thu hồi.
   *
   * Đây chính là C7 tái phát qua đường race (xem AUDIT-REPORT.md): đơn đã
   * giao license, dòng sau fail -> hoàn tiền 100% nhưng license VẪN SỐNG và
   * khách đọc được. Lặp vòng = license miễn phí vô hạn.
   *
   * Chỉ ghi những gì REQUEST NÀY tạo ra — KHÔNG đụng dòng đã giao ở lần
   * trước (kind === 'already'), vì đó là hàng khách đã trả tiền từ trước.
   */
  const made = { licenses: [], items: [], soldCount: [], entitlements: [] };

  try {
    for (const p of planned) {
      const { item, product, qty, kind } = p;

      if (kind === 'already') {
        delivered.push({
          productId: item.product_id, name: item.product_name,
          keys: p.keys, manual: false,
        });
        continue;
      }

      if (kind === 'manual') {
        delivered.push({
          productId: item.product_id, name: item.product_name,
          keys: [], manual: true,
        });
        continue;
      }

      if (kind === 'license') {
        /*
         * CẤP QUYỀN THẲNG VÀO TÀI KHOẢN — KHÔNG SINH KEY CHO KHÁCH.
         *
         * Chủ shop chốt: "bỏ toàn bộ key trên hệ thống app và web đi. Mua
         * thì add luôn vào tài khoản."
         *
         * Trước đây bước này gọi deliverLicenseLine() để sinh N license +
         * ghi license_issues, rồi trả key cho khách dán vào app. Nay:
         *   1. Cộng hạn vào `account_entitlements` (nguồn sự thật)
         *   2. Sinh license nội bộ để làm vật mang token (app tự dùng,
         *      khách không thấy) — chỉ 1 license cho mỗi tính năng
         *   3. Ghi license_issues để giữ sổ đối soát doanh thu
         */
        const { grantFeature, featuresOfProduct } =
          await import('../lib/account-entitlement.js');
        const { deliverLicenseLine } = await import('./license.js');

        /*
         * ==================================================================
         * F02 — SỐ NGÀY PHẢI NHÂN VỚI QUANTITY
         *
         * LỖI CŨ: grantFeature(days) được gọi MỘT lần với số ngày của một đơn
         * vị, trong khi API vẫn nhận `quantity` tới 20 và `deliverLicenseLine`
         * sinh đúng `quantity` license. Khách mua 2 gói 30 ngày chỉ nhận 30
         * ngày quyền tài khoản — mất một nửa số tiền đã trả (bằng chứng:
         * orders.js:78 cho quantity tới 20, grantFeature không hề nhận qty).
         *
         * Nay: số ngày cấp = license_days × quantity. Sản phẩm bán gia hạn
         * thì quantity chính là số kỳ khách mua, nên đây là cách hiểu đúng.
         * ==================================================================
         */
        const unitDays = Number(product.license_days || 0);
        // unitDays = 0 nghĩa là vĩnh viễn -> nhân quantity vẫn là vĩnh viễn.
        const days = unitDays === 0 ? 0 : unitDays * Math.max(1, Number(qty) || 1);
        const feats = featuresOfProduct(product);

        // 1. Cộng hạn vào tài khoản (cộng dồn nếu đang còn hạn).
        //
        // `orderId` được truyền xuống làm khoá chống cấp trùng: mỗi đơn chỉ
        // cộng một lần cho mỗi tính năng, kể cả khi hàm này bị gọi lại (retry
        // sau lỗi mạng, admin bấm "giao bù", worker chết rồi chạy lại).
        for (const f of feats) {
          await grantFeature(env, {
            userId: order.user_id, feature: f, days,
            source: 'purchase', orderId,
            note: `${product.name} (${qty}×${unitDays ? ` ${unitDays} ngày` : ' vĩnh viễn'})`,
          });
        }

        // 2. Sinh license nội bộ làm vật mang token + ghi sổ đối soát
        const keys = await deliverLicenseLine(env, {
          order, orderId, userId: order.user_id, product, quantity: qty,
        });
        made.licenses.push(...keys);

        await env.DB.prepare('UPDATE order_items SET delivered_keys = ? WHERE id = ?')
          .bind(await sealKeys(env, keys), item.id).run();
        made.items.push(item.id);

        await env.DB.prepare('UPDATE products SET sold_count = sold_count + ? WHERE id = ?')
          .bind(qty, item.product_id).run();
        made.soldCount.push({ productId: item.product_id, qty });

        /*
         * `keys` KHÔNG trả về cho khách nữa — chỉ đánh dấu đã giao.
         * Khách thấy quyền trong app sau khi đăng nhập.
         */
        delivered.push({
          productId: item.product_id, name: item.product_name,
          keys: [], manual: false, accountGranted: true,
          features: feats, days,
        });
        continue;
      }

      /*
       * ĐÃ BỎ nhánh giao hàng kho key (`kind === 'key'`) cùng bảng
       * `product_keys`. Mọi sản phẩm hiện đều `delivery_type='license'`
       * hoặc `manual`, và bước KIỂM TRA ở trên đã chặn kiểu lạ.
       */
      throw new Error(`Kiểu giao hàng không hỗ trợ: ${kind}`);
    }
  } catch (err) {
    /*
     * ===== GIAO HÀNG LỖI -> THU HỒI NGAY NHỮNG GÌ VỪA GIAO =====
     *
     * TUYỆT ĐỐI KHÔNG BỎ KHỐI NÀY. Không rollback thì khách được cả tiền
     * (hoàn ở nơi gọi) lẫn license/key đã giao trước khi lỗi -> mất tiền thật
     * và license sống vô hạn. Đây là lỗi đã từng xảy ra thật (C7).
     *
     * Rollback phải chạy TRƯỚC khi ném lỗi ra ngoài để nơi gọi (payments.js)
     * không bao giờ thấy "giao lỗi" mà tài nguyên vẫn còn sống.
     */
    await rollbackDelivered(env, orderId, made);
    throw err;
  }

  return { pendingManual, delivered };
}

/**
 * Thu hồi mọi tài nguyên mà MỘT request giao hàng vừa tạo ra.
 *
 * Nguyên tắc: chỉ hoàn tác đúng những gì có trong `made` (sổ do chính request
 * này ghi). Không quét theo order_id để tránh thu hồi nhầm hàng đã giao
 * thành công ở lần trước.
 *
 * Mỗi bước đều bọc try/catch riêng: một bước lỗi KHÔNG được chặn các bước
 * còn lại, nếu không sẽ để lại tài nguyên sống sót.
 */
async function rollbackDelivered(env, orderId, made) {
  const nowS = Math.floor(Date.now() / 1000);

  // 1. Thu hồi license vừa phát hành — dùng đúng cờ revoked mà adminRefund
  //    và license-server dùng để chặn client, cộng 1 dòng lic_events làm
  //    bằng chứng đối soát.
  for (const key of made.licenses) {
    try {
      await env.DB.prepare('UPDATE licenses SET revoked = 1 WHERE key = ?').bind(key).run();
      await env.DB.prepare(
        'INSERT INTO lic_events (key, hwid, kind, detail, ip, at) VALUES (?,?,?,?,?,?)'
      ).bind(key, null, 'revoke', 'giao hang loi - rollback', '', nowS).run();
    } catch { /* không để lỗi thu hồi che lỗi gốc */ }
  }

  // 2. (ĐÃ BỎ) Trả key kho về available — bảng `product_keys` không còn.

  // 3. Xoá delivered_keys của đúng các dòng vừa ghi. Giữ lại thì listOrders
  //    vẫn trả key cho khách dù đơn không thành công.
  for (const itemId of made.items) {
    try {
      await env.DB.prepare('UPDATE order_items SET delivered_keys = NULL WHERE id = ?')
        .bind(itemId).run();
    } catch { /* ignore */ }
  }

  // 4. Hoàn lại sold_count đã cộng.
  for (const s of made.soldCount) {
    try {
      await env.DB.prepare(
        'UPDATE products SET sold_count = MAX(0, sold_count - ?) WHERE id = ?'
      ).bind(s.qty, s.productId).run();
    } catch { /* ignore */ }
  }

  // 5. (ĐÃ BỎ) Đồng bộ tồn kho từ kho key — không còn kho key.
}

export async function listOrders(env, request) {
  const user = await requireUser(env, request);
  const url = new URL(request.url);
  const page = pageNum(url.searchParams.get('page'), 1);
  const perPage = pageNum(url.searchParams.get('perPage'), 10, { max: 50 });

  const { results } = await env.DB.prepare(
    `SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`
  ).bind(user.id, perPage, (page - 1) * perPage).all();

  const rows = results || [];
  if (rows.length === 0) return ok({ orders: [] });

  // 1 query lấy TOÀN BỘ item của trang này (thay vì 1 query mỗi đơn -> N+1)
  const ids = rows.map((o) => o.id);
  const placeholders = ids.map(() => '?').join(',');
  const { results: allItems } = await env.DB.prepare(
    `SELECT oi.order_id, oi.product_id, oi.product_name, oi.unit_price,
            oi.quantity, oi.line_total, oi.delivered_keys,
            COALESCE(p.delivery_type, 'manual') AS delivery_type
       FROM order_items oi
       LEFT JOIN products p ON p.id = oi.product_id
      WHERE oi.order_id IN (${placeholders})`
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
      deliveryType: i.delivery_type,
      manual: i.delivery_type === 'manual',
      license: i.delivery_type === 'license',
      keys: await safeParse(i.delivered_keys, env),
    });
  }

  const orders = rows.map((o) => {
    /*
     * ===== KHÔNG LỘ KEY CỦA ĐƠN CHƯA GIAO XONG =====
     *
     * `order_items.delivered_keys` là hàng ĐÃ GIAO THẬT (đã trừ tiền). Nhưng
     * đơn có thể đang 'pending' (chưa trả đồng nào) hoặc 'paid'/'processing'
     * (lỗi giữa chừng) mà một vài dòng đã kịp ghi keys. Trả nguyên `keys`
     * cho mọi trạng thái nghĩa là khách đọc được license/key của đơn chưa
     * trả tiền — đúng lỗ hổng đã bị khai thác (lấy license miễn phí vô hạn
     * qua GET /api/orders).
     *
     * Chỉ đơn 'delivered' mới là "đã giao xong, tiền đã vào", lúc đó keys là
     * của khách. Mọi trạng thái khác trả mảng rỗng để frontend hiện
     * "Đang xử lý giao hàng" (nhánh sẵn có trong public/assets/pages/orders.js).
     */
    const items = itemsByOrder.get(o.id) || [];
    return {
      id: o.id,
      code: o.code,
      status: o.status,
      subtotal: o.subtotal,
      discount: o.discount,
      total: o.total,
      couponCode: o.coupon_code,
      createdAt: o.created_at,
      /*
       * KHÔNG TRẢ KEY — quyền nằm ở tài khoản.
       * `delivered_keys` chỉ dùng nội bộ để đối soát.
       */
      items: items.map((it) => ({ ...it, keys: [] })),
    };
  });
  return ok({ orders });
}

export async function getOrder(env, request, orderId) {
  const user = await requireUser(env, request);
  const o = await env.DB.prepare('SELECT * FROM orders WHERE (id = ? OR code = ?) AND user_id = ? LIMIT 1')
    .bind(orderId, orderId, user.id)
    .first();
  if (!o) throw new ApiError(404, 'Đơn hàng không tồn tại', 'NOT_FOUND');

  /*
   * JOIN products để lấy `delivery_type`: frontend cần biết dòng nào là
   * license (hiện hướng dẫn lấy lệnh cài đặt) và dòng nào giao tay (hiện
   * "chờ 5–15 phút"). Thiếu field này thì cả hai nhánh UI thành code chết và
   * khách mua license không biết bước tiếp theo.
   * LEFT JOIN: sản phẩm có thể đã bị xoá, đơn cũ vẫn phải đọc được.
   */
  const { results: items } = await env.DB.prepare(
    `SELECT oi.product_id, oi.product_name, oi.unit_price, oi.quantity,
            oi.line_total, oi.delivered_keys,
            COALESCE(p.delivery_type, 'manual') AS delivery_type
       FROM order_items oi
       LEFT JOIN products p ON p.id = oi.product_id
      WHERE oi.order_id = ?`
  ).bind(o.id).all();

  /*
   * KHÔNG BAO GIỜ TRẢ KEY NỮA — QUYỀN NẰM Ở TÀI KHOẢN.
   *
   * Chủ shop chốt: "bỏ toàn bộ key trên hệ thống app và web đi".
   *
   * Trước đây nhánh này trả `keys` cho đơn 'delivered' để khách dán vào
   * app. Nay khách chỉ cần đăng nhập, app tự lấy quyền — trả key ra chỉ
   * làm lộ mã nội bộ và gợi ý sai rằng khách phải giữ nó.
   *
   * `delivered_keys` vẫn nằm trong DB để đối soát nội bộ, nhưng KHÔNG ra
   * khỏi server.
   */
  const keysVisible = false;
  void keysVisible;

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
      /*
       * `safeParse` là async (phải giải mã AES trước khi parse), nên dùng
       * Promise.all thay `.map` đồng bộ — nếu không sẽ trả về Promise object.
       */
      items: await Promise.all((items || []).map(async (i) => ({
        productId: i.product_id,
        name: i.product_name,
        unitPrice: i.unit_price,
        quantity: i.quantity,
        lineTotal: i.line_total,
        deliveryType: i.delivery_type,
        manual: i.delivery_type === 'manual',
        license: i.delivery_type === 'license',
        keys: keysVisible ? await safeParse(i.delivered_keys, env) : [],
      }))),
    },
  });
}

/**
 * Mã hoá mảng key trước khi ghi vào `order_items.delivered_keys`.
 *
 * VÌ SAO: key khách đã mua trước đây lưu plaintext dạng JSON
 * (`["AOE1-LSR4-R869-Z77C"]`). Ai đọc được DB là có toàn bộ key đã bán —
 * đúng loại dữ liệu không được để lộ. Nay bọc AES-256-GCM qua KEY_ENC.
 *
 * Định dạng lưu: chuỗi có tiền tố `enc1:` chứa base64(iv+ct+tag) của JSON.
 * Giá trị không có tiền tố được coi là dữ liệu cũ và đọc thẳng — nhờ vậy
 * không phải migrate một lần toàn bộ bảng.
 */
async function sealKeys(env, keys) {
  const json = JSON.stringify(Array.isArray(keys) ? keys : []);
  const { sealSecret } = await import('../lib/secrets.js');
  return sealSecret(env, json);
}

async function safeParse(stored, env) {
  if (!stored) return [];
  let raw = stored;
  // Dữ liệu mã hoá: giải mã trước rồi mới parse.
  if (typeof stored === 'string' && stored.startsWith('enc1:')) {
    if (!env) return [];
    try {
      const { openSecret } = await import('../lib/secrets.js');
      raw = await openSecret(env, stored);
    } catch {
      return [];
    }
  }
  try {
    const v = JSON.parse(raw);
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
  const admin = await requireAdmin(env, request);
  /*
   * AUDIT #12: danh sách đơn trả email khách — PII. Staff giữ đủ các trường
   * VẬN HÀNH (mã đơn, trạng thái, số tiền, ngày tạo, tên hiển thị) nhưng email
   * bị che; admin thật vẫn thấy đầy đủ. Nhờ vậy một tài khoản hỗ trợ không tải
   * được cả danh sách email khách hàng qua API này.
   */
  const { isStaffViewer, maskEmail } = await import('../lib/pii.js');
  const staffView = isStaffViewer(admin);
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
    where.push('(o.code LIKE ? OR u.email LIKE ? OR u.username LIKE ?)');
    binds.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  const { results } = await env.DB.prepare(
    `SELECT o.*, u.email, u.username, u.full_name FROM orders o JOIN users u ON u.id = o.user_id
     WHERE ${where.join(' AND ')} ORDER BY o.created_at DESC LIMIT 200`
  ).bind(...binds).all();
  return ok({
    orders: (results || []).map((o) => ({
      id: o.id,
      code: o.code,
      /*
       * `email` KHÔNG được chứa địa chỉ nội bộ `u-<uuid>@invalid`.
       *
       * auth.register ghi email nội bộ đó cho mọi tài khoản mới; hiện nguyên
       * chuỗi UUID ra trang admin chỉ làm rối mắt mà không cho biết khách là
       * ai. Ưu tiên username (tên đăng nhập thật), rồi tới full_name.
       * Chỉ trả email khi đó là địa chỉ thật (dữ liệu cũ trước khi bỏ email).
       */
      email: (typeof o.email === 'string' && o.email.endsWith('@invalid'))
        ? (o.username || null)
        : (staffView ? maskEmail(o.email) : o.email),
      customer: o.full_name || o.username || null,
      status: o.status,
      total: o.total,
      createdAt: o.created_at,
    })),
  });
}

export async function adminDeliverManual(env, request, orderId) {
  /*
   * CHỈ admin thật: route này CẤP HÀNG THẬT cho khách (key/license). `staff`
   * mà gọi được thì một tài khoản nhân viên tự tạo đơn rồi tự giao hàng
   * miễn phí, hoặc giao bù cho đơn chưa thanh toán.
   */
  const admin = await requireAdminStrict(env, request);
  const o = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(orderId).first();
  if (!o) throw new ApiError(404, 'Đơn hàng không tồn tại', 'NOT_FOUND');

  // Chỉ giao đơn đã thanh toán
  if (!['paid', 'delivered'].includes(o.status)) {
    throw new ApiError(409,
      `Chỉ giao đơn đã thanh toán. Đơn này đang "${o.status}".`, 'BAD_STATE');
  }

  /*
   * ĐƠN ĐÃ 'delivered' NHƯNG RỖNG KEY -> PHẢI CHO SỬA.
   *
   * Trước đây hàm này trả ngay {already:true} khi status='delivered'. Nhưng
   * chính lỗi "delivered mà 0 key" lại tạo ra trạng thái đó, nên đường cứu
   * duy nhất của admin lại từ chối đúng những đơn cần cứu. Đã có thật trên
   * production: 4 đơn 'delivered' với delivered_keys NULL.
   *
   * Nay: nếu đơn đã 'delivered' mà CHƯA có key nào thì vẫn đi tiếp để cấp bù.
   * deliverOrderItems() tự bỏ qua dòng đã giao (kind='already') nên gọi lại
   * không sinh trùng.
   */
  if (o.status === 'delivered') {
    const pending = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM order_items
        WHERE order_id = ?
          AND (delivered_keys IS NULL OR delivered_keys = '' OR delivered_keys = '[]')`
    ).bind(orderId).first();
    if (!(pending?.n > 0)) {
      return ok({ id: orderId, already: true });
    }
    // còn dòng rỗng -> rơi xuống dưới để cấp bù
  }

  /*
   * GIÀNH ĐƠN NGUYÊN TỬ trước khi giao.
   *
   * Trước đây đọc-rồi-ghi không có khoá: admin bấm 2 lần, hoặc bấm trên web
   * cùng lúc bấm trên Telegram -> cả hai cùng chạy deliverOrderItems():
   *   - dòng license: sinh 2 license SỐNG, delivered_keys bị ghi đè -> khách
   *     giữ 1 bộ, ngoài đời tồn tại 2 bộ;
   *   - dòng key kho: mỗi request giữ một lô key KHÁC nhau, lô thứ nhất bị
   *     mồ côi ở trạng thái 'sold' -> mất hàng thật.
   * adminRefund đã dùng đúng mẫu claim này; ở đây còn thiếu.
   */
  const claim = await env.DB.prepare(
    `UPDATE orders SET status = 'processing', processing_started_at = ?
      WHERE id = ? AND status IN ('paid','delivered')`
  ).bind(Date.now(), orderId).run();
  if (!claim.meta || claim.meta.changes !== 1) {
    throw new ApiError(409,
      'Đơn đang được xử lý bởi thao tác khác, thử lại sau.', 'BAD_STATE');
  }

  let result;
  try {
    result = await deliverOrderItems(env, o);
  } catch (e) {
    // Giao lỗi -> trả đơn về 'paid' để admin còn đường cứu.
    await env.DB.prepare(
      `UPDATE orders SET status = 'paid', processing_started_at = NULL
        WHERE id = ? AND status = 'processing'`
    ).bind(orderId).run();
    throw e;
  }

  const finalStatus = result.pendingManual ? 'paid' : 'delivered';
  await env.DB.prepare(
    `UPDATE orders SET status = ?, delivered_at = ?, processing_started_at = NULL
      WHERE id = ? AND status = 'processing'`
  ).bind(finalStatus, result.pendingManual ? null : Date.now(), orderId).run();

  await audit(env, admin.id, 'order.manual_deliver', orderId, {
    delivered: (result.delivered || []).length,
    pendingManual: !!result.pendingManual,
  });

  return ok({
    id: orderId,
    status: finalStatus,
    delivered: result.delivered || [],
    pendingManual: !!result.pendingManual,
  });
}

/**
 * POST /api/admin/orders/:id/refund — hoàn tiền (admin web).
 *
 * ==========================================================================
 * F04 — CHỈ CÒN MỘT BẢN CÀI ĐẶT HOÀN TIỀN
 *
 * Toàn bộ nghiệp vụ hoàn tiền nằm trong `src/lib/refund-service.js`. Hàm này
 * chỉ làm ba việc của tầng HTTP: xác thực admin, đọc body, dịch kết quả sang
 * response. Đường Telegram (wallet.js) gọi CÙNG hàm đó với channel khác.
 *
 * Nhờ vậy web và Telegram không thể lệch nhau nữa — trước đây web ghi
 * admin_note còn Telegram cộng `users.balance` (ví đã bỏ).
 * ==========================================================================
 */
export async function adminRefund(env, request, orderId) {
  /*
   * CHỈ admin thật: hoàn tiền = quyết định mất tiền thật (chuyển khoản tay
   * cho khách) + thu hồi license/quyền. `staff` không được có quyền này.
   */
  const admin = await requireAdminStrict(env, request);
  const body = await readJson(request).catch(() => ({}));

  const { refundOrder } = await import('../lib/refund-service.js');
  const r = await refundOrder(env, {
    orderId,
    channel: 'web',
    actor: admin.username || admin.id,
    reason: body.reason || 'admin_adjust',
    amount: body.amount,
    /*
     * `markPaidOut` chỉ bật khi admin xác nhận ĐÃ chuyển tiền và có mã giao
     * dịch ngân hàng. Mặc định là CHƯA: sổ ghi 'pending', đơn chuyển sang
     * 'refund_pending_transfer', và dashboard đối soát sẽ nhắc cho tới khi
     * có chứng từ. Đây là chỗ sửa lỗi "ghi yêu cầu = đã trả tiền".
     */
    markPaidOut: body.paidOut === true,
    bankRef: body.bankRef || '',
    note: body.note || '',
  });

  if (!r.ok) {
    const status = r.code === 'NOT_FOUND' ? 404
      : r.code === 'BAD_REQUEST' ? 400
        : 409;
    throw new ApiError(status, r.message || 'Không hoàn được đơn này', r.code || 'REFUND_FAILED');
  }

  await audit(env, admin.id, 'order.refund', orderId, {
    amount: r.amount, revoked: r.revoked, state: r.state, reason: r.reason,
  });

  return ok({
    id: orderId,
    amount: r.amount,
    state: r.state,
    status: r.status,
    revoked: r.revoked,
    /** true = đã chốt "đã chuyển tiền"; false = mới ghi yêu cầu hoàn */
    paidOut: r.state === 'done',
  });
}

/**
 * POST /api/admin/orders/:id/refund/complete — chốt đã chuyển tiền hoàn.
 *
 * Body: { bankRef, amount? }
 * Đây là bước còn thiếu khiến sổ sách không đối soát được: trước đây bấm
 * "Hoàn" là đơn thành 'refunded' ngay, dù tiền chưa hề rời tài khoản shop.
 */
export async function adminCompleteRefund(env, request, orderId) {
  const admin = await requireAdminStrict(env, request);
  const body = await readJson(request).catch(() => ({}));

  const { completeRefundTransfer } = await import('../lib/refund-service.js');
  const r = await completeRefundTransfer(env, {
    orderId,
    bankRef: body.bankRef,
    amount: body.amount,
    actor: admin.username || admin.id,
  });

  if (!r.ok) {
    const status = r.code === 'NOT_FOUND' ? 404 : 409;
    throw new ApiError(status, r.message || 'Không chốt được khoản hoàn', r.code);
  }

  await audit(env, admin.id, 'order.refund_complete', orderId, {
    amount: r.amount, bankRef: r.bankRef,
  });

  return ok({ id: orderId, amount: r.amount, state: 'done' });
}

/**
 * POST /api/admin/migrate-delivered-keys — mã hoá key đã giao còn plaintext.
 *
 * Chạy MỘT LẦN sau khi bật KEY_ENC. Idempotent: dòng đã mã hoá (tiền tố
 * `enc1:`) bị bỏ qua, nên gọi lại nhiều lần không hỏng dữ liệu.
 *
 * Phải chạy TRONG Worker vì KEY_ENC là secret chỉ Worker đọc được.
 * Chỉ admin thật.
 */
export async function adminMigrateDeliveredKeys(env, request) {
  const { requireAdminStrict } = await import('../lib/auth.js');
  const admin = await requireAdminStrict(env, request);
  const body = await readJson(request).catch(() => ({}));
  if (body.confirm !== true) {
    throw new ApiError(
      400,
      'Gửi {"confirm":true} để xác nhận mã hoá toàn bộ key đã giao',
      'CONFIRM_REQUIRED',
    );
  }

  const { results } = await env.DB.prepare(
    `SELECT id, delivered_keys FROM order_items
      WHERE delivered_keys IS NOT NULL AND delivered_keys <> '[]'
        AND delivered_keys NOT LIKE 'enc1:%'
      LIMIT 500`
  ).all();

  let done = 0;
  let skipped = 0;
  for (const row of results || []) {
    try {
      const arr = JSON.parse(row.delivered_keys);
      if (!Array.isArray(arr)) { skipped++; continue; }
      await env.DB.prepare('UPDATE order_items SET delivered_keys = ? WHERE id = ?')
        .bind(await sealKeys(env, arr), row.id).run();
      done++;
    } catch {
      // Dòng hỏng định dạng: để nguyên, không làm mất dữ liệu.
      skipped++;
    }
  }

  const left = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM order_items
      WHERE delivered_keys IS NOT NULL AND delivered_keys <> '[]'
        AND delivered_keys NOT LIKE 'enc1:%'`
  ).first();

  await audit(env, admin.id, 'security.migrate_keys', 'order_items', { done, skipped });

  return ok({
    encrypted: done,
    skipped,
    remaining: left?.n ?? null,
    note: (left?.n ?? 0) > 0 ? 'Còn dòng chưa mã hoá — gọi lại để xử lý tiếp' : 'Hoàn tất',
  });
}
