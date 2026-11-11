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
  const now = Date.now();

  const { results: items } = await env.DB.prepare(
    'SELECT * FROM order_items WHERE order_id = ?'
  ).bind(orderId).all();

  const planned = [];
  let pendingManual = false;

  // ===== BƯỚC 1: KIỂM TRA TRƯỚC KHI GIỮ HÀNG =====
  for (const item of items || []) {
    const product = await env.DB.prepare(
      'SELECT id, name, delivery_type, license_prefix, license_days FROM products WHERE id = ?'
    ).bind(item.product_id).first();

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

    // Hàng key: kiểm tra tồn kho
    const avail = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM product_keys WHERE product_id = ? AND status = 'available'"
    ).bind(item.product_id).first();
    if ((avail?.n || 0) < item.quantity) {
      throw new Error(
        `"${item.product_name}" không đủ hàng (cần ${item.quantity}, còn ${avail?.n || 0})`
      );
    }
    planned.push({ item, product, qty: item.quantity, kind: 'key' });
  }

  // ===== BƯỚC 2: GIAO =====
  const delivered = [];
  const { openSecret } = await import('../lib/secrets.js');

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
  const made = { licenses: [], keyIds: [], items: [], soldCount: [] };

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
        // deliverLicenseLine tự sinh ĐÚNG `quantity` license trong 1 lần gọi
        // và tự ghi license_issues. KHÔNG gọi trong vòng lặp: gọi N lần thì
        // mỗi lần lại sinh thêm N key -> mua 2 nhận 4, và license_issues
        // ghi trùng.
        const { deliverLicenseLine } = await import('./license.js');
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

        delivered.push({
          productId: item.product_id, name: item.product_name,
          keys, manual: false,
        });
        continue;
      }

      // kind === 'key'
      const { results: keys } = await env.DB.prepare(
        `SELECT id, secret FROM product_keys
         WHERE product_id = ? AND status = 'available'
         ORDER BY created_at ASC LIMIT ?`
      ).bind(item.product_id, qty).all();

      const secrets = [];
      for (const k of keys || []) {
        const up = await env.DB.prepare(
          `UPDATE product_keys SET status = 'sold', order_id = ?, delivered_at = ?
           WHERE id = ? AND status = 'available'`
        ).bind(orderId, now, k.id).run();
        if (up.meta && up.meta.changes === 1) {
          // CHỈ ghi nhận khi UPDATE thật sự đổi được dòng: đây là key mà
          // request này đã chiếm. Key bị request khác giành trước không
          // được đưa vào sổ, nếu không rollback sẽ trả nhầm hàng của đơn khác.
          made.keyIds.push(k.id);
          secrets.push(await openSecret(env, k.secret));
        }
      }

      if (secrets.length < qty) {
        // Race: trả key đã giữ về available rồi throw -> catch bên dưới
        // vẫn chạy rollback cho các dòng TRƯỚC đó.
        for (const kid of made.keyIds) {
          await env.DB.prepare(
            `UPDATE product_keys SET status = 'available', order_id = NULL, delivered_at = NULL
             WHERE id = ? AND order_id = ?`
          ).bind(kid, orderId).run();
        }
        throw new Error(`Giữ hàng thất bại cho "${item.product_name}", thử lại`);
      }

      await env.DB.prepare('UPDATE order_items SET delivered_keys = ? WHERE id = ?')
        .bind(await sealKeys(env, secrets), item.id).run();
      made.items.push(item.id);

      await env.DB.prepare('UPDATE products SET sold_count = sold_count + ? WHERE id = ?')
        .bind(qty, item.product_id).run();
      made.soldCount.push({ productId: item.product_id, qty });

      delivered.push({
        productId: item.product_id, name: item.product_name,
        keys: secrets, manual: false,
      });
      await syncStock(env, item.product_id);
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

  // 2. Trả key kho về available. Dùng status='sold' + order_id làm điều kiện
  //    để không "hồi sinh" một key mà người khác đã mua lại trong lúc này.
  for (const kid of made.keyIds) {
    try {
      await env.DB.prepare(
        `UPDATE product_keys
            SET status = 'available', order_id = NULL, delivered_at = NULL
          WHERE id = ? AND order_id = ? AND status = 'sold'`
      ).bind(kid, orderId).run();
    } catch { /* ignore */ }
  }

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

  // 5. Đồng bộ tồn kho để stock_count khớp số key available thật.
  for (const pid of new Set(made.soldCount.map((s) => s.productId))) {
    try { await syncStock(env, pid); } catch { /* ignore */ }
  }
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
    const keysVisible = o.status === 'delivered';
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
      // keys đã lọc theo trạng thái ở trên (chỉ 'delivered' mới lộ key)
      items: items.map((it) => ({ ...it, keys: keysVisible ? it.keys : [] })),
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
   * getOrder là đường ĐỌC CHI TIẾT một đơn — cũng phải áp cùng quy tắc với
   * listOrders: chỉ đơn 'delivered' mới trả keys. Nếu chỉ vá listOrders thì
   * kẻ tấn công đổi sang GET /api/orders/:id là lấy lại được key của đơn
   * chưa thanh toán. Hai đường phải cùng một luật.
   */
  const keysVisible = o.status === 'delivered';

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

  if (o.status === 'delivered') {
    return ok({ id: orderId, already: true });
  }

  // Chỉ giao đơn đã thanh toán
  if (!['paid', 'delivered'].includes(o.status)) {
    throw new ApiError(409,
      `Chỉ giao đơn đã thanh toán. Đơn này đang "${o.status}".`, 'BAD_STATE');
  }

  /*
   * P0: TRƯỚC ĐÂY hàm này chỉ UPDATE status='delivered' mà KHÔNG cấp key.
   * Khách trả tiền -> admin bấm "Giao" -> đơn báo "đã giao" nhưng
   * delivered_keys rỗng -> KHÁCH MẤT HÀNG. Đây là đường admin dùng để
   * cứu đơn giao lỗi, nên cứu sai cách còn tệ hơn không cứu.
   * Nay phải gọi deliverOrderItems() để thực sự cấp key/license.
   */
  const result = await deliverOrderItems(env, o);

  const finalStatus = result.pendingManual ? 'paid' : 'delivered';
  await env.DB.prepare(
    `UPDATE orders SET status = ?, delivered_at = ? WHERE id = ?`
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

  /*
   * ===== CHỐT SỔ HOÀN TIỀN (chống hoàn trùng ở tầng DB) =====
   *
   * Trạng thái đơn KHÔNG đủ tin cậy: worker có thể chết sau khi cộng tiền mà
   * trước khi đặt 'refunded', và cron cũ đưa đơn kẹt về 'paid' → admin bấm
   * Hoàn lần nữa. Đã xảy ra thật (MBK-L5W87H hoàn 70.000đ hai lần).
   *
   * refund_ledger.order_id là PRIMARY KEY nên mỗi đơn chỉ có tối đa MỘT dòng,
   * mãi mãi. INSERT thành công = lượt này được phép cộng tiền. INSERT trùng =
   * đã có lượt khác cộng rồi → dừng, không cộng nữa.
   */
  const claimToken = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  let ledgerOk = false;
  try {
    const led = await env.DB.prepare(
      `INSERT INTO refund_ledger
         (order_id, amount, user_id, order_code, state, claim_token, source, actor, at)
       VALUES (?, ?, ?, ?, 'pending', ?, 'web', ?, ?)`
    ).bind(orderId, o.total, o.user_id, o.code, claimToken, admin.id, Date.now()).run();
    ledgerOk = led.meta && led.meta.changes === 1;
  } catch {
    // Trùng PRIMARY KEY = đơn này đã có lượt hoàn tiền khác. Không cộng nữa.
    ledgerOk = false;
  }
  if (!ledgerOk) {
    throw new ApiError(
      409,
      'Đơn này đã được ghi sổ hoàn tiền. Kiểm tra lại lịch sử trước khi thao tác.',
      'ALREADY_REFUNDED',
    );
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

  /*
   * ===== CỘNG TIỀN + CHỐT SỔ TRONG MỘT TRANSACTION =====
   *
   * Bốn việc dưới đây PHẢI cùng thành công hoặc cùng không:
   *   1. cộng lại số dư ví khách
   *   2. ghi dòng 'refund' vào sổ cái (để SUM(wallet_transactions) = balance)
   *   3. đánh dấu refund_ledger.state = 'done'  <- DẤU HIỆU "ĐÃ CỘNG TIỀN"
   *   4. đặt đơn thành 'refunded'
   *
   * Vì sao state='done' là mấu chốt: worker chết giữa chừng là chuyện có
   * thật (CPU limit 30s, phía trên đã await hàng loạt lệnh thu hồi
   * key/license). Sổ ghi 'pending' = CHƯA cộng tiền, 'done' = ĐÃ cộng.
   * Không có cột này thì cron và admin không thể phân biệt "đơn kẹt trước
   * khi cộng" với "đơn kẹt sau khi cộng" — đoán sai một trong hai là mất
   * tiền thật (hoàn thiếu hoặc hoàn hai lần).
   *
   * env.DB.batch chạy như một transaction của D1 nên không có cửa sổ nào
   * để tiền đã cộng mà sổ vẫn 'pending'.
   */
  // KHÔNG cộng vào ví nữa: không còn trang nạp/tiêu số dư.
  // Hoàn tiền = chuyển khoản tay cho khách, ghi admin_note để đối soát.
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE refund_ledger SET state = 'done', revoked = ?,
       claim_token = NULL, at = ?
       WHERE order_id = ? AND state = 'pending' AND claim_token = ?`
    ).bind(revoked.keys + revoked.licenses, now, orderId, claimToken),
    env.DB.prepare(
      `UPDATE orders SET status = 'refunded',
              admin_note = ? WHERE id = ?`
    ).bind(`Hoàn tiền tay ${o.total}đ — chuyển khoản cho khách`, orderId),
  ]);

  await releaseCoupon(env, o.coupon_code, orderId);

  await audit(env, admin.id, 'order.refund', orderId, { total: o.total, revoked });
  return ok({ id: orderId, revoked });
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
