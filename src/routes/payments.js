/**

 * Thanh toán THEO ĐƠN: QR sinh theo giá đơn + xác nhận qua webhook/Telegram.

 *

 * YÊU CẦU CHỦ SHOP:

 *   "không nạp tiền vào hệ thống. khách quét QR tự sinh QR theo giá sản phẩm,

 *    nội dung cũng sinh theo. xong xác nhận trong telegram rồi giao key cho

 *    khách chứ không nhận nạp và giữ tiền."

 *

 * NGUYÊN TẮC:

 *   - Tiền vào THẲNG tài khoản ngân hàng shop. Không ví, không số dư.

 *   - Mỗi đơn 1 QR: số tiền = tổng đơn, nội dung = MBK + mã đơn (bỏ gạch).

 *   - Khớp tiền → tự giao (nếu bật) hoặc Telegram hỏi admin.

 *   - Chống cộng/giao trùng bằng 4 lớp.

 */

import { ok, ApiError, readJson } from '../lib/http.js';

import { nowSec } from '../lib/trial-quota.js';

/* ------------------------------------------------------------------ */

/* Cấu hình                                                            */

/* ------------------------------------------------------------------ */

/** Đọc cấu hình ngân hàng + cờ thanh toán. */

export async function paymentCfg(env) {
  const { results } = await env.DB.prepare(

    `SELECT key, value FROM settings

     WHERE key IN ('bank_name','bank_account','bank_owner',

                   'payment_auto_deliver','order_ttl_minutes',

                   'order_remind_minutes','payment_prefix',

                   'order_qr_min','order_qr_max','sepay_allow_missing_account')`

  ).all();

  const m = {};

  for (const r of results || []) m[r.key] = r.value;

  const num = (k, d) => {
    const n = Number(m[k]);

    return Number.isFinite(n) && n > 0 ? n : d;

  };

  return {

    bankName: m.bank_name || 'MBBank',

    bankAccount: m.bank_account || '',

    bankOwner: m.bank_owner || '',

    /*
     * Audit #14: mặc định TẮT = payload thiếu `accountNumber` bị coi là SAI
     * tài khoản (fail closed). Chỉ bật khi nhà cung cấp đổi cấu trúc payload
     * và chủ shop chấp nhận rủi ro bỏ lớp kiểm tài khoản.
     */
    allowMissingAccount: String(m.sepay_allow_missing_account ?? '0') === '1',

    // Mã ngân hàng cho VietQR (MBBank -> 'MB')

    bankSlug: 'MB',

    autoDeliver: String(m.payment_auto_deliver ?? '1') !== '0',

    ttlMinutes: num('order_ttl_minutes', 30),

    remindMinutes: num('order_remind_minutes', 30),

    prefix: (m.payment_prefix || 'MBK').toUpperCase().replace(/[^A-Z0-9]/g, '') || 'MBK',

    qrMin: num('order_qr_min', 0),

    qrMax: num('order_qr_max', 100000000),

  };

}

/**

 * Nội dung chuyển khoản từ mã đơn: 'MBK-ABC123' -> 'MBKABC123'.

 *

 * KHÔNG dấu gạch nối vì nhiều app ngân hàng tự cắt/đổi '-'.

 * Chỉ A-Z + 2-9 (alphabet orderCode đã loại I O 0 1).

 */

export function memoOf(orderCode, prefix = 'MBK') {
  const body = String(orderCode || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

  const p = String(prefix).toUpperCase();

  const withoutPrefix = body.startsWith(p) ? body.slice(p.length) : body;

  return p + withoutPrefix;

}

/**

 * Chuẩn hoá nội dung CK từ ngân hàng để tìm mã đơn.

 * 'mbk 3kw klr', 'MBK-3KWKLR', 'CK MBK3KWKLR mua key' đều ra 'MBK3KWKLR'.

 */

export function extractMemo(content, prefix = 'MBK') {
  const s = String(content || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

  const p = String(prefix).toUpperCase();

  const i = s.indexOf(p);

  if (i < 0) return null;

  const rest = s.slice(i + p.length);

  if (rest.length < 4) return null;

  return p + rest.slice(0, 12);

}

/** URL ảnh VietQR (SVG — PNG bị 301). */

export function qrUrl(cfg, amount, memo) {
  const acc = encodeURIComponent(cfg.bankAccount);

  const slug = encodeURIComponent(cfg.bankSlug);

  const q = new URLSearchParams({

    amount: String(Math.round(amount)),

    addInfo: memo,

  });

  return `https://img.vietqr.io/image/${slug}-${acc}-compact2.svg?${q.toString()}`;

}

/* ------------------------------------------------------------------ */

/* QR theo đơn                                                         */

/* ------------------------------------------------------------------ */

/**

 * POST /api/orders/:id/qr

 *

 * Tạo/chỉnh QR cho đơn. KHÔNG trừ tiền ai — chỉ trả thông tin để khách quét.

 * Idempotent: gọi lại trả cùng QR nếu còn hạn.

 */

export async function createOrderQr(env, request, orderId) {
  const { requireUser } = await import('../lib/auth.js');

  const user = await requireUser(env, request);

  const cfg = await paymentCfg(env);

  if (!cfg.bankAccount) {

    throw new ApiError(503,

      'Shop chưa cấu hình tài khoản ngân hàng. Vui lòng liên hệ hỗ trợ.',

      'NO_BANK');

  }

  const order = await env.DB.prepare(

    'SELECT * FROM orders WHERE id = ? AND user_id = ?'

  ).bind(orderId, user.id).first();

  if (!order) throw new ApiError(404, 'Không tìm thấy đơn hàng', 'NOT_FOUND');

  if (['delivered', 'paid'].includes(order.status)) {

    throw new ApiError(409, 'Đơn này đã thanh toán rồi', 'ALREADY_PAID');

  }

  if (['cancelled', 'refunded', 'expired'].includes(order.status)) {

    throw new ApiError(409,

      'Đơn đã huỷ hoặc hết hạn. Vui lòng đặt đơn mới.', 'ORDER_CLOSED');

  }

  const amount = Number(order.total) || 0;

  if (amount < cfg.qrMin || amount > cfg.qrMax) {

    throw new ApiError(400,

      `Số tiền đơn phải từ ${cfg.qrMin}đ đến ${cfg.qrMax}đ`, 'AMOUNT_RANGE');

  }

  const now = nowSec();

  const memo = memoOf(order.code, cfg.prefix);

  // Còn hạn -> trả lại QR cũ (idempotent)

  if (order.qr_expires_at && order.qr_expires_at > now && order.payment_ref === memo) {

    return ok({

      order: { id: order.id, code: order.code, total: amount, status: order.status },

      qr: {

        url: qrUrl(cfg, amount, memo),

        amount,

        memo,

        bank: { name: cfg.bankName, account: cfg.bankAccount, owner: cfg.bankOwner },

        expiresAt: order.qr_expires_at,

        secondsLeft: order.qr_expires_at - now,

      },

    });

  }

  // Tạo mới (hoặc làm mới) hạn QR

  const expiresAt = now + cfg.ttlMinutes * 60;

  await env.DB.prepare(

    `UPDATE orders SET payment_method = 'qr', payment_ref = ?,

            qr_expires_at = ?, status = CASE WHEN status = 'expired' THEN 'pending' ELSE status END

     WHERE id = ? AND status IN ('pending','expired')`

  ).bind(memo, expiresAt, order.id).run();

  const fresh = await env.DB.prepare('SELECT * FROM orders WHERE id = ?')

    .bind(order.id).first();

  return ok({

    order: {

      id: fresh.id, code: fresh.code, total: amount,

      status: fresh.status, expiresAt,

    },

    qr: {

      url: qrUrl(cfg, amount, memo),

      amount,

      memo,

      bank: { name: cfg.bankName, account: cfg.bankAccount, owner: cfg.bankOwner },

      expiresAt,

      secondsLeft: expiresAt - now,

    },

  });

}

/**

 * POST /api/orders/:id/claimed — khách báo "tôi đã chuyển khoản".

 * KHÔNG tự giao. Chỉ ghi nhận + báo Telegram để admin kiểm tra.

 */

export async function claimOrderPaid(env, request, orderId) {
  const { requireUser } = await import('../lib/auth.js');

  const user = await requireUser(env, request);

  const order = await env.DB.prepare(

    'SELECT * FROM orders WHERE id = ? AND user_id = ?'

  ).bind(orderId, user.id).first();

  if (!order) throw new ApiError(404, 'Không tìm thấy đơn hàng', 'NOT_FOUND');

  if (['delivered', 'paid'].includes(order.status)) {

    return ok({ already: true, status: order.status });

  }

  if (!['pending', 'expired'].includes(order.status)) {

    throw new ApiError(409, 'Đơn không ở trạng thái chờ thanh toán', 'BAD_STATE');

  }

  // Chống spam: 1 lần / 2 phút / đơn

  const recent = await env.DB.prepare(

    `SELECT COUNT(*) AS n FROM payments

     WHERE order_id = ? AND state = 'claimed' AND at > ?`

  ).bind(order.id, nowSec() - 120).first();

 // Chống spam theo USER: tối đa 3 đơn / 10 phút.
 // Trước đây chỉ theo đơn -> 1 tài khoản bấm 8 đơn = 8 tin Telegram.
 const userRecent = await env.DB.prepare(
   `SELECT COUNT(*) AS n FROM payments p
    JOIN orders o ON o.id = p.order_id
    WHERE o.user_id = ? AND p.state = 'claimed' AND p.at > ?`
 ).bind(user.id, nowSec() - 600).first();
 if ((userRecent?.n || 0) >= 3) {
   throw new ApiError(429,
     'Bạn đã báo nhiều lần. Vui lòng chờ admin kiểm tra hoặc nhắn Zalo 0836768597.',
     'TOO_MANY_CLAIMS');
 }

  if ((recent?.n || 0) > 0) {

    return ok({ already: true, reason: 'Vừa báo rồi, admin đang kiểm tra.' });

  }

  const paid = await env.DB.prepare(

    `INSERT INTO payments

       (id, order_id, order_code, amount, expected, method, content, state, confirmed_by, at)

     VALUES (?,?,?,?,'0','claim',?,'claimed',?,?)`

  ).bind(crypto.randomUUID(), order.id, order.code, 0, order.code,

    user.username || user.id, nowSec()).run();

  // Báo Telegram (không chặn nếu lỗi)

  try {
    const { notifyPaymentClaim } = await import('../lib/telegram-pay.js');

    await notifyPaymentClaim(env, order, user);

  } catch { /* bỏ qua */ }

  return ok({

    claimed: true,

    msg: 'Đã ghi nhận. Admin sẽ kiểm tra và giao key trong ít phút. '

      + 'Nếu quá 15 phút chưa nhận được, liên hệ Zalo 0836768597.',

  });

}

/* ------------------------------------------------------------------ */

/* Xác nhận thanh toán — MỘT hàm duy nhất                              */

/* ------------------------------------------------------------------ */

/**

 * Xác nhận đơn đã được trả tiền và giao hàng.

 *

 * MỌI đường (webhook, Telegram, admin web) PHẢI gọi hàm này.

 * Chống trùng 3 lớp:

 *   L1: payments.txn_ref UNIQUE (webhook replay)

 *   L2: claim orders.status 'pending'/'expired'/'cancelled' -> 'processing'
 *       (WHERE ... AND status IN (...), changes === 1).
 *       'processing' KHÔNG nằm trong tập này — xem chú thích dài ngay trên
 *       câu UPDATE giành đơn (audit #1: giành lại 'processing' = giao 2 lần).

 *   L3: product_keys claim 'available' (trong deliverItems)

 *

 * Trả { ok, duplicated?, delivered?, order?, reason? }

 */

/**
 * Ghi một khoản tiền vào sổ khi đường đi KHÔNG phải webhook (admin bấm tay,
 * Telegram xác nhận). Dùng chung `payment_inbox` để chỉ có MỘT nơi tra cứu
 * "tiền đã vào chưa".
 *
 * Không ném lỗi: đường này đã có `payments` làm sổ cũ, hỏng hộp thư không
 * được chặn thao tác của admin.
 */
async function journalManualInbound(env, {
  order, amount, source, txnRef, content, raw, isTest, state = 'matched', note = null,
}) {
  try {
    const { recordInbound, markProcessed } = await import('../lib/payment-inbox.js');
    const provider = source === 'sepay' || source === 'payos' ? source : 'manual';
    // Khoá chống trùng: ưu tiên txnRef thật; nếu không có thì sinh khoá nội
    // bộ theo đơn + thời điểm để KHÔNG chặn nhầm các lần xác nhận khác nhau.
    const txnId = String(txnRef || `manual-${order.id}-${Date.now()}`);
    const r = await recordInbound(env, {
      provider, transactionId: txnId,
      amount: Math.floor(Number(amount) || 0),
      content: content || `manual confirm ${order.code}`,
      transferType: 'in', isTest, raw,
    });
    if (r.recorded && !r.duplicated) {
      await markProcessed(env, r.inboxId, {
        state, orderId: order.id, orderCode: order.code,
        deliverState: 'none', note,
      });
    }
    return r;
  } catch (e) {
    console.error('journalManualInbound:', e && e.message);
    return null;
  }
}

export async function confirmOrderPaid(env, opts = {}) {
  const { orderId, amount, source, txnRef, adminId, content, raw } = opts;
  let { isTest } = opts;
  /*
   * `journaled: true` = bên gọi (webhook) ĐÃ ghi chứng từ bền vững vào
   * `payment_inbox` trước khi tới đây. Khi đó hàm này KHÔNG được return sớm
   * vì lý do "đơn đã giao" mà bỏ qua phần ghi nhận tiền — chứng từ đã có,
   * việc còn lại chỉ là quyết định giao.
   */
  const journaled = opts.journaled === true;

  /*
   * isTest có thể undefined khi admin duyệt tay (không qua webhook).
   * Tự nhận diện qua txnRef để không bị ReferenceError.
   */
  if (isTest === undefined) {
    const ref = String(txnRef || '');
    isTest = /^(TEST|PROBE|SHORT|TOPUP|OVER|TWICE|MULTI|OUT|WRONGACC|NOMATCH|SAME|TWO|AGAIN|EXP|CAN|OOS|APPROVE|E2E)/i.test(ref);
  }
  const now = nowSec();

  const order = await env.DB.prepare('SELECT * FROM orders WHERE id = ?')

    .bind(orderId).first();

  if (!order) return { ok: false, reason: 'ORDER_NOT_FOUND' };

  /*
   * ========================================================================
   * F07 — TRƯỚC ĐÂY RETURN Ở ĐÂY LÀ MẤT CHỨNG TỪ TIỀN
   *
   * Bản cũ:
   *     if (order.status === 'delivered') return { duplicated: true, ... };
   *
   * Hàm này trả về TRƯỚC khi ghi `payments`/hộp thư. Với webhook, điều đó
   * nghĩa là: khách chuyển thêm một khoản cho đơn đã giao -> tiền vào ngân
   * hàng, webhook trả 200, và KHÔNG có dòng nào trong sổ. Admin không biết
   * khoản tiền đó tồn tại.
   *
   * NAY: vẫn không giao hàng lần hai (đúng), nhưng KHÔNG được im lặng. Nếu
   * chưa có chứng từ (`journaled` false — đường admin bấm tay hoặc Telegram)
   * thì phải ghi nhận khoản tiền dư vào sổ trước khi trả lời.
   * ========================================================================
   */
  if (order.status === 'delivered') {
    if (!journaled && Number(amount) > 0) {
      await journalManualInbound(env, {
        order, amount, source, txnRef, content, raw, isTest,
        state: 'matched', note: 'excess payment on already-delivered order',
      });
    }
    return { ok: true, duplicated: true, reason: 'ALREADY_DELIVERED', order };
  }

  if (order.status === 'paid') {

    // Đã xác nhận tiền, đang chờ giao tay -> thử giao lại
    return await deliverAndFinish(env, order, { amount, source, adminId, now, txnRef });

  }

  // Nhận cả 'cancelled': tiền về muộn vẫn phải ghi sổ + báo admin,

  // KHÔNG được im lặng bỏ qua (khách mất tiền thật).

  if (!['pending', 'expired', 'processing', 'cancelled'].includes(order.status)) {

    return { ok: false, reason: `BAD_STATE:${order.status}` };

  }

  // L1: chống replay webhook

  if (txnRef) {
    const dup = await env.DB.prepare(

      'SELECT id, order_id FROM payments WHERE txn_ref = ? LIMIT 1'

    ).bind(txnRef).first();

    if (dup) {

      return {

        ok: true, duplicated: true,

        reason: dup.order_id === orderId ? 'WEBHOOK_REPLAY' : 'TXN_USED_OTHER_ORDER',

        order,

      };

    }

  }

  // Ghi sổ payment (dù khớp hay không, phải có chứng từ)

  const payId = crypto.randomUUID();

  const expected = Number(order.total) || 0;

  /*
   * CỘNG DỒN: các lần chuyển trước đó cho cùng đơn.
   * Khách có thể chuyển thiếu rồi chuyển bù (90k + 90k = 180k).
   * Nếu chỉ so từng lần thì không bao giờ giao dù đã đủ tiền.
   *
   * PHẢI TÍNH TRƯỚC `paid` — xem khối "ratify" bên dưới.
   */
  const prev = await env.DB.prepare(
    `SELECT COALESCE(SUM(amount),0) AS s FROM payments
     WHERE order_id = ? AND state IN ('matched','wrong_amount')`
  ).bind(order.id).first();
  const prevPaid = Math.floor(Number(prev?.s) || 0);

  /*
   * ===== `ratify`: ADMIN DUYỆT TIỀN ĐÃ CÓ TRONG SỔ =====
   *
   * LỖI THẬT ĐÃ XẢY RA (đo được trên production):
   *   Ngoài cửa sổ giờ, webhook SePay GHI SỔ 180.000đ (confirmed_by=
   *   'sepay-window') rồi trả AWAITING_ADMIN_APPROVAL. Admin bấm "Đã nhận
   *   tiền" → adminConfirmPayment gọi confirmOrderPaid(amount = order.total)
   *   → `prev` = 180.000, `paid` = 180.000, totalPaid = 360.000. Kết quả:
   *     • sổ ghi 360.000đ cho một đơn 180.000đ khách chỉ chuyển 180.000đ;
   *     • API trả `excess: 180000` → Telegram báo "Thừa 180.000đ — cần
   *       hoàn tay" trong khi thực tế KHÔNG thừa đồng nào.
   *   Đơn MBK-WGWDM7 / MBK-YLCB36 đã dính đúng lỗi này.
   *
   * Quy tắc đúng: `payments` là SỔ TIỀN ĐÃ NHẬN, không phải sổ quyết định.
   *   • prevPaid > 0  → đã có chứng từ tiền cho đơn này. Admin bấm duyệt chỉ
   *     là QUYẾT ĐỊNH giao hàng, KHÔNG phải thêm một khoản tiền mới.
   *     → không ghi thêm dòng nào.
   *   • prevPaid = 0  → webhook trượt hoàn toàn, admin tự thấy tiền trong app
   *     ngân hàng. Đây CHÍNH LÀ đường cứu của endpoint này → phải ghi sổ
   *     đúng số tiền admin xác nhận.
   *
   * `ratify` chỉ bật khi bên gọi KHÔNG nhập số tiền cụ thể. Admin gõ tay một
   * con số khác = đang khai một khoản tiền MỚI (ví dụ khách chuyển bù), khi đó
   * phải ghi sổ bình thường.
   */
  const ratify = opts.ratify === true && prevPaid > 0;

  /*
   * ===== P0 — KHÔNG được suy số tiền từ `expected` khi đã có con số =====
   *
   * Bản cũ: `Math.floor(Number(amount) || expected)`.
   *
   * Toán tử `||` coi 0 / NaN / '' là "không có giá trị" rồi thay bằng
   * `expected`. Với webhook PayOS thiếu `amount`, hoặc amount = 0, dòng này
   * biến "0 đồng" thành "đúng bằng giá đơn" -> state = 'matched' -> giành đơn
   * -> GIAO HÀNG ĐẦY ĐỦ mà không có đồng nào vào.
   *
   * Nay: chỉ dùng con số bên gọi truyền vào; không hợp lệ thì là 0. `expected`
   * chỉ dùng để SO SÁNH, không bao giờ dùng để THAY THẾ số tiền đã nhận.
   */
  const amountNum = Number(amount);
  const paid = ratify ? 0
    : (Number.isFinite(amountNum) && amountNum > 0 ? Math.floor(amountNum) : 0);

  const totalPaid = prevPaid + paid;

  const state = paid >= expected ? 'matched'

    : paid > 0 ? 'wrong_amount' : 'matched';

  // ratify: tiền đã có chứng từ trong sổ -> KHÔNG ghi thêm dòng trùng.
  if (paid > 0) {
    try {

      await env.DB.prepare(

        `INSERT INTO payments

           (id, order_id, order_code, amount, expected, method, txn_ref,

            content, state, confirmed_by, raw, at, is_test)

         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`

      ).bind(payId, order.id, order.code, paid, expected,

        source === 'sepay' ? 'sepay' : source === 'payos' ? 'payos' : 'manual',

        txnRef || null, content || null, state,

        source === 'sepay' || source === 'payos' ? source : (adminId || 'admin'),

        raw ? JSON.stringify(raw).slice(0, 4000) : null, now,
        isTest ? 1 : 0).run();

    } catch (e) {

      // UNIQUE txn_ref -> replay đồng thời

      if (String(e?.message || '').includes('UNIQUE')) {

        return { ok: true, duplicated: true, reason: 'CONCURRENT_REPLAY', order };

      }

      throw e;

    }
  }

  // Thiếu tiền -> KHÔNG giao, chờ admin quyết.
  //
  // ratify = admin đã nhìn sao kê và bấm duyệt tay -> KHÔNG chặn vì thiếu,
  // nếu không thì nút "Đã nhận tiền" vô dụng đúng lúc cần nhất.
  if (totalPaid < expected && !ratify) {
    // P0: TRƯỚC ĐÂY IM LẶNG — khách chuyển thiếu mà không ai biết.
    // Tiền vào ngân hàng thật, admin phải thấy để xử lý.
    try {
      const { notifyUnderpaid } = await import('../lib/telegram-pay.js');
      await notifyUnderpaid(env, order, {
        paid: totalPaid, expected, missing: expected - totalPaid, txnRef,
      });
    } catch { /* bỏ qua */ }


    return {

      ok: true, underpaid: true,

      reason: 'UNDERPAID',

      order,

      paid, expected,

      missing: expected - totalPaid,

    };

  }

  // L2: claim nguyên tử
  /*
   * BẮT BUỘC set `processing_started_at` cùng lúc với status='processing'.
   * Cron dọn đơn kẹt (src/index.js) lọc theo `processing_started_at IS NOT NULL
   * AND processing_started_at < ?`; thiếu mốc này thì đơn kẹt ở 'processing'
   * (worker chết giữa chừng) sẽ KHÔNG BAO GIỜ được dọn — khách đã trả tiền
   * nhưng đơn treo vĩnh viễn.
   */
  /*
   * ===== MỐC THỜI GIAN: MILI-GIÂY =====
   *
   * `orders.created_at` là MILI-GIÂY (Date.now()), và cron dọn đơn kẹt so
   * `processing_started_at < ?` với `now - 10*60*1000` (mili-giây).
   *
   * Trước đây hai cột này ghi `nowSec()` (GIÂY). Hệ quả thật:
   *   • paid_at/delivered_at lệch 1000 lần so với created_at (UI hiện năm 1970);
   *   • `processing_started_at` (1.79e9) LUÔN nhỏ hơn mốc mili-giây (1.79e12),
   *     nên cron coi MỌI đơn 'processing' là kẹt quá 10 phút và reset về 'paid'
   *     ngay ở lần chạy kế tiếp — kể cả đơn vừa bắt đầu xử lý.
   */
  /*
   * ===== SỬA LỖI NGHIÊM TRỌNG (audit #1): 'processing' KHÔNG ĐƯỢC nằm
   *       trong tập trạng thái cho phép GIÀNH đơn =====
   *
   * LỖI GỐC: tập cũ là ('pending','expired','processing','cancelled').
   * 'processing' = ĐÃ GIÀNH được đơn và ĐANG giao. Vì nó vẫn nằm trong tập
   * cho phép, hai request ĐỒNG THỜI (khác txn_ref nên L1 txn_ref UNIQUE
   * không chặn được) đều nhận changes === 1:
   *     • request A: pending -> processing, giao hàng
   *     • request B: processing -> processing, changes === 1 -> GIAO HÀNG LẦN 2
   * => khách nhận 2 license/2 key cho 1 lần trả tiền. Đây là đua THẬT, không
   *    phải rủi ro lý thuyết: khách chuyển thiếu rồi chuyển bù (2 txn_ref
   *    khác nhau cho cùng một đơn) hoặc admin bấm "Đã nhận tiền" đúng lúc
   *    webhook đang xử lý đều tạo ra cặp đua này.
   *
   * NAY: chỉ ('pending','expired','cancelled') mới giành được đơn.
   *   - 'processing' = đã có người giữ -> request thứ hai KHÔNG giao hàng.
   *   - Đường hồi phục khi worker chết giữa chừng vẫn nguyên: cron
   *     (src/index.js) đưa đơn 'processing' kẹt quá 10 phút về 'paid', rồi
   *     admin bấm "Đã nhận tiền" -> đi nhánh order.status === 'paid' ở trên
   *     (deliverAndFinish); nhánh đó KHÔNG dùng câu UPDATE này.
   *   - Không caller nào khác phụ thuộc việc giành lại đơn 'processing':
   *     orders.js (adminDeliverManual) giành bằng
   *     `WHERE status IN ('paid','delivered')`, wallet.js tương tự — cả hai
   *     độc lập với tập trạng thái ở đây.
   *
   * Đánh đổi có chủ ý: request thua cuộc vẫn GHI SỔ payment ở trên (tiền vào
   * ngân hàng là thật, không được giấu), nhưng KHÔNG giao hàng lần hai.
   */
  const claim = await env.DB.prepare(
    `UPDATE orders SET status = 'processing', paid_at = ?, confirmed_by = ?,
            processing_started_at = ?
     WHERE id = ? AND status IN ('pending','expired','cancelled')`
  ).bind(now * 1000, source === 'sepay' || source === 'payos' ? source : (adminId || 'admin'),
    now * 1000, order.id).run();

  if (!claim.meta || claim.meta.changes !== 1) {
    /*
     * Thua cuộc giành đơn = đã có request khác đang giao (hoặc vừa giao xong).
     * KHÔNG giao lần hai. Phân biệt rõ hai nguyên nhân để vận hành đọc log:
     *   - 'processing' -> ORDER_IN_PROGRESS (đúng nghĩa đua, không phải lỗi)
     *   - còn lại      -> CLAIM_FAILED (ai đó vừa chốt trạng thái khác)
     */
    const cur = await env.DB.prepare('SELECT status FROM orders WHERE id = ?')
      .bind(order.id).first();
    return {
      ok: true, duplicated: true,
      reason: cur?.status === 'processing' ? 'ORDER_IN_PROGRESS' : 'CLAIM_FAILED',
      state: cur?.status || null,
      order,
    };

  }

  const fresh = await env.DB.prepare('SELECT * FROM orders WHERE id = ?')

    .bind(order.id).first();

  return await deliverAndFinish(env, fresh, {

    amount: totalPaid, source, adminId, now,

    /*
     * txnRef chỉ được CHUYỂN TIẾP xuống lớp thông báo (Telegram) để chủ shop
     * dò sao kê. Không dùng vào bất kỳ quyết định nào ở dưới → không đổi
     * luồng giành đơn / giao hàng.
     */
    txnRef,

    excess: totalPaid > expected ? totalPaid - expected : 0,

  });

}

/**

 * Giao hàng + chốt trạng thái. Tách riêng để cả webhook lẫn admin dùng chung.

 */

async function deliverAndFinish(env, order, { amount, source, adminId, now, excess, txnRef }) {
  const { deliverOrderItems } = await import('./orders.js');

  let result;

  try {

    result = await deliverOrderItems(env, order);

  } catch (e) {

    // Giao lỗi: giữ 'paid' (đã có tiền), KHÔNG hoàn ví (không có ví)

    await env.DB.prepare(

      `UPDATE orders SET status = 'paid', admin_note = ?

       WHERE id = ? AND status = 'processing'`

    ).bind(`Giao lỗi: ${String(e?.message || e).slice(0, 200)}`, order.id).run();

    // P0: TRƯỚC ĐÂY IM LẶNG — admin không biết khách đã trả tiền
    // mà chưa nhận hàng. Khách thấy "đang xử lý" vô hạn.
    try {
      const { notifyOutOfStock } = await import('../lib/telegram-pay.js');
      await notifyOutOfStock(env, order,
        String(e?.message || e).slice(0, 150), { amount, txnRef });
    } catch { /* bỏ qua */ }

    return {

      ok: false,

      reason: 'DELIVER_FAILED',

      order,

      error: String(e?.message || e).slice(0, 200),

    };

  }

  const finalStatus = result.pendingManual ? 'paid' : 'delivered';

  await env.DB.prepare(

    `UPDATE orders SET status = ?, delivered_at = ?

     WHERE id = ? AND status IN ('processing','paid')`

  ).bind(finalStatus, result.pendingManual ? null : now * 1000, order.id).run();

  const fresh = await env.DB.prepare('SELECT * FROM orders WHERE id = ?')

    .bind(order.id).first();

  // Thông báo Telegram (không chặn)
  //
  // Chỉ truyền ĐÚNG những gì tin nhắn cần: số tiền, đơn, mã GD ngân hàng và
  // trạng thái giao. `source`/`adminId` đã bỏ khỏi tin — chúng là chi tiết
  // máy móc, không giúp chủ shop đối soát.
  try {
    const { notifyPaymentSuccess } = await import('../lib/telegram-pay.js');

    await notifyPaymentSuccess(env, fresh, {
      amount, excess, txnRef,
      pendingManual: !!result.pendingManual,
    });

  } catch { /* bỏ qua */ }

  return {

    ok: true,

    delivered: finalStatus === 'delivered',

    pendingManual: !!result.pendingManual,

    order: fresh,

    excess: excess || 0,

  };

}

/* ------------------------------------------------------------------ */

/* Webhook SePay / PayOS — khớp THEO MÃ ĐƠN                            */

/* ------------------------------------------------------------------ */

/** Tìm đơn theo nội dung CK. */

async function findOrderByMemo(env, content, prefix) {
  const memo = extractMemo(content, prefix);

  if (!memo) return null;

  // payment_ref lưu đúng memo, tìm trực tiếp

  let o = await env.DB.prepare(

    'SELECT * FROM orders WHERE payment_ref = ? LIMIT 1'

  ).bind(memo).first();

  if (o) return o;

  // Fallback: so khớp theo code bỏ gạch (đơn cũ chưa có payment_ref)

  const withDash = memo.slice(prefix.length);

  o = await env.DB.prepare(

    `SELECT * FROM orders WHERE REPLACE(UPPER(code), '-', '') = ?

     ORDER BY created_at DESC LIMIT 1`

  ).bind(memo).first();

  if (o) return o;

  // Fallback 2: 'MBK' + 6 ký tự -> thử ghép lại có gạch

  if (withDash.length >= 6) {
    const guess = `MBK-${withDash.slice(0, 6)}`;

    o = await env.DB.prepare('SELECT * FROM orders WHERE code = ? LIMIT 1')

      .bind(guess).first();

  }

  return o || null;

}

/** POST /api/webhooks/sepay */

export async function sepayWebhook(env, request) {
  const secret = env.WEBHOOK_SECRET;

  if (!secret) throw new ApiError(503, 'Webhook chưa được cấu hình', 'NO_SECRET');

  const auth = request.headers.get('authorization') || '';

  const okMain = timingSafeEqualStr(auth, `Apikey ${secret}`);

  /*
   * ĐÃ XOÁ CỬA HẬU `WEBHOOK_SECRET_TEST`.
   *
   * Bản trước chấp nhận THÊM một secret phụ lấy từ `env.WEBHOOK_SECRET_TEST`:
   *   const okTest = testSecret ? timingSafeEqualStr(auth,'Apikey '+testSecret) : false;
   *   if (!okMain && !okTest) throw 401
   * Nghĩa là ai biết chuỗi đó là tự ký được webhook "tiền vào" và đúc
   * license/key vô hạn mà không cần chuyển một đồng nào.
   *
   * Đã xảy ra THẬT trên production (qa/results-G.json G1): đơn MBK-2S924V trị
   * giá 1.290.000đ được giao license VĨNH VIỄN AOE1-UW6N-2X2W-HXRE trong khi
   * tài khoản ngân hàng không nhận được đồng nào.
   *
   * Kiểm thử tự động phải chạy trên worker RIÊNG (wrangler.audit.toml) và dùng
   * chính WEBHOOK_SECRET của môi trường đó — không mở thêm cửa trên production.
   */
  if (!okMain) {
    throw new ApiError(401, 'Sai xác thực webhook', 'UNAUTHORIZED');
  }

  const body = await readJson(request);

  const cfg = await paymentCfg(env);

  // ===== CHỈ NHẬN TIỀN VÀO =====

  // SePay gửi cả giao dịch RA (transferType='out'). Không kiểm -> một lệnh

  // RÚT TIỀN có nội dung trùng mã đơn sẽ bị tính là ĐÃ THANH TOÁN.

  const ttype = String(body.transferType || 'in').toLowerCase();

  const accountNumber = String(body.accountNumber ?? '').trim();
  const amount = Math.floor(Number(body.transferAmount) || 0);
  /*
   * NHẬN DIỆN GIAO DỊCH TEST để KHÔNG tính vào hạn mức 50 GD/tháng.
   * Chủ shop: "hạn chế test bằng sepay". Test tự động dùng mã
   * referenceCode bắt đầu bằng các tiền tố dưới đây.
   */
  const txnRefRaw = String(body.referenceCode || body.id || '');
  const isTest = /^(TEST|PROBE|SHORT|TOPUP|OVER|TWICE|MULTI|OUT|WRONGACC|NOMATCH|SAME|TWO|AGAIN|EXP|CAN|OOS|APPROVE|E2E)/i.test(txnRefRaw);

  const content = String(body.content || body.description || '');

  const txnRef = String(body.referenceCode || body.id || '');

  /* ================================================================== */
  /* B1 — GHI SỔ BỀN VỮNG *TRƯỚC MỌI NHÁNH RETURN* (F07)                */
  /* ================================================================== */
  /*
   * PHẢI nằm ở đây, ngay sau khi xác thực và đọc payload, TRƯỚC mọi `return`
   * (tiền ra, sai tài khoản, số tiền <= 0, không khớp đơn, ngoài cửa sổ giờ).
   *
   * Vì sao: webhook trả 200 thì provider KHÔNG gửi lại. Bản cũ có 4 nhánh
   * return trước khi ghi `payments`, và cả 4 đều trả 200 -> tiền vào ngân
   * hàng mà sổ trống, admin không có dấu vết nào để đối soát.
   *
   * recordInbound() NÉM LỖI khi không ghi được -> lỗi lan tới fetch() của
   * Worker -> trả 500 -> provider gửi lại. Đó là hành vi đúng: thà provider
   * retry còn hơn mất chứng từ tiền.
   *
   * Ngoại lệ: giao dịch RA (transferType='out') và mã test không có
   * `referenceCode` thì vẫn ghi (để có audit) nhưng trạng thái 'ignored'.
   */
  const { recordInbound, markProcessed } = await import('../lib/payment-inbox.js');

  const inbox = await recordInbound(env, {
    provider: 'sepay',
    transactionId: txnRef,
    amount,
    content,
    accountNumber,
    transferType: ttype,
    isTest,
    raw: body,
  });

  if (!inbox.recorded) {
    /*
     * Không có mã giao dịch -> không thể chống trùng, nhưng KHÔNG được im
     * lặng: trả 400 kèm lý do để provider/lỗi cấu hình lộ ra, và vẫn không
     * ghi sổ (không có khoá chống trùng thì ghi là mở đường cộng trùng).
     */
    return ok({ matched: false, reason: 'MISSING_TXN_ID' });
  }

  if (inbox.duplicated) {
    // Provider gửi lại cùng giao dịch — không báo Telegram lần nữa.
    return ok({
      matched: false, duplicated: true, reason: 'WEBHOOK_REPLAY',
      inbox_state: inbox.state,
    });
  }

  if (ttype !== 'in') {
    await markProcessed(env, inbox.inboxId, { state: 'ignored', note: 'transferType != in' });
    return ok({ matched: false, reason: 'NOT_INBOUND' });
  }

  if (amount <= 0) {
    await markProcessed(env, inbox.inboxId, { state: 'ignored', note: 'amount <= 0' });
    return ok({ matched: false, reason: 'ZERO_AMOUNT' });
  }

  // Đúng tài khoản nhận
  //
  /*
   * ===== FAIL CLOSED KHI THIẾU accountNumber (audit #14) =====
   *
   * LỖI GỐC: `cfg.bankAccount && body.accountNumber && ...` — nếu payload
   * KHÔNG có `accountNumber` thì phép kiểm bị BỎ QUA HOÀN TOÀN và giao dịch
   * vẫn được coi là "đúng tài khoản". Nghĩa là ai gửi được một request webhook
   * hợp lệ (hoặc SePay đổi cấu trúc payload) là bỏ qua được lớp kiểm tài khoản.
   *
   * NAY: thiếu `accountNumber` = KHÔNG chứng minh được tiền vào đúng tài khoản
   * -> coi như SAI tài khoản (không giao hàng). Muốn nới, admin bật cấu hình
   * `sepay_allow_missing_account=1` (dùng khi nhà cung cấp đổi payload).
   *
   * Tiền vào sai tài khoản KHÔNG bị mất dấu: đã ghi vào payment_inbox ở B1,
   * webhook trả 200 (không retry vô ích) và admin đối soát được.
   */
  if (cfg.bankAccount) {
    let wrongAccount = false;
    if (!accountNumber) {
      wrongAccount = !cfg.allowMissingAccount;
    } else if (accountNumber !== String(cfg.bankAccount)) {
      wrongAccount = true;
    }
    if (wrongAccount) {
      await markProcessed(env, inbox.inboxId, {
        state: 'wrong_account',
        note: accountNumber ? 'account mismatch' : 'missing accountNumber',
      });
      return ok({ matched: false, reason: 'WRONG_ACCOUNT', detail: 'missing_accountNumber' });
    }
  }

  const order = await findOrderByMemo(env, content, cfg.prefix);

  if (!order) {

    // Tiền vào nhưng không khớp đơn -> đã có chứng từ ở payment_inbox (B1).
    // Vẫn ghi thêm vào `payments` để trang Sổ tiền vào cũ hiển thị liên tục.

    try {

      await env.DB.prepare(

        `INSERT INTO payments

           (id, order_id, order_code, amount, expected, method, txn_ref,

            content, state, confirmed_by, raw, at, is_test)

         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`

      ).bind(crypto.randomUUID(), null, null, amount, 0, 'sepay',

        txnRef || null, content, 'unmatched', 'sepay',

        JSON.stringify(body).slice(0, 4000), nowSec(), isTest ? 1 : 0).run();

    } catch (e) {
      /*
       * Trùng txn_ref = webhook replay -> bỏ qua. Lỗi khác phải LOG, nhưng
       * KHÔNG còn làm mất dấu tiền: chứng từ đã nằm ở payment_inbox.
       */
      const msg = String(e?.message || e);
      if (!msg.includes('UNIQUE')) {
        console.error('webhook unmatched INSERT:', msg);
      }
    }

    await markProcessed(env, inbox.inboxId, {
      state: 'unmatched', note: 'no order matched memo',
    });

    try {
      const { notifyUnmatchedPayment } = await import('../lib/telegram-pay.js');

      /*
       * `provider` không còn được truyền: tin nhắn không hiện tên kênh thanh
       * toán nữa (chữ máy móc, không giúp đối soát). Chỉ giữ số tiền, nội
       * dung CK và mã GD ngân hàng.
       */
      await notifyUnmatchedPayment(env, { amount, content, txnRef });

    } catch { /* bỏ qua */ }

    // Trả 200 để SePay không retry vô ích

    return ok({ matched: false, reason: 'NO_ORDER_MATCH' });

  }


  /*
   * CỬA SỔ GIỜ TỰ ĐỘNG XÁC NHẬN (chủ shop chốt):
   *   00:00 - 11:59  -> tự động giao ngay
   *   12:00 - 23:59  -> GHI NHẬN tiền + báo Telegram, admin duyệt tay
   *
   * Lý do: admin muốn kiểm soát buổi chiều, và giảm hạn mức free.
   */
  const { autoWindow } = await import('./sepay-reconcile.js');
  const win = await autoWindow(env);

  if (!win.inWindow) {
    // Ngoài cửa sổ: ghi sổ + báo Telegram, KHÔNG giao.
    //
    // `expected`/`state` phải tính Ở ĐÂY (không phải trong confirmOrderPaid,
    // hàm đó không được gọi trên nhánh này). Bản trước hardcode 'matched' nên
    // khách chuyển THIẾU tiền buổi chiều vẫn bị ghi sổ là "khớp đủ" — admin
    // nhìn sổ tưởng đủ tiền rồi duyệt giao hàng.
    const expected = Number(order.total) || 0;
    const state = amount >= expected ? 'matched' : 'wrong_amount';
    /*
     * CHỐNG REPLAY Ở NHÁNH BUỔI CHIỀU.
     *
     * Trước đây mọi lỗi INSERT đều bị `catch {}` nuốt, nên không phân biệt
     * được "đã ghi rồi" với "ghi hỏng". SePay gửi lại cùng một giao dịch là
     * chuyện bình thường (retry khi webhook timeout) -> mỗi lần gửi lại lại
     * bắn thêm một tin Telegram cho admin, và response vẫn nói như lần đầu.
     * Nay: kiểm txn_ref trước, và trả `duplicated: true` để bên gọi biết.
     */
    let duplicated = false;
    if (txnRef) {
      const seen = await env.DB.prepare(
        'SELECT id FROM payments WHERE txn_ref = ? LIMIT 1'
      ).bind(txnRef).first();
      duplicated = !!seen;
    }

    if (!duplicated) {
      try {
        await env.DB.prepare(
          `INSERT INTO payments
             (id, order_id, order_code, amount, expected, method, txn_ref,
              content, state, confirmed_by, raw, at, is_test)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
        ).bind(crypto.randomUUID(), order.id, order.code, amount,
          expected, 'sepay', txnRef || null, content || null,
          state, 'sepay-window',
          JSON.stringify(body).slice(0, 3000), nowSec(), isTest ? 1 : 0).run();
      } catch (e) {
        // Lỗi ghi sổ buổi chiều = tiền vào mà không ai biết. Phải log.
        const msg = String(e?.message || e);
        if (msg.includes('UNIQUE')) {
          // Đua nhau cùng lúc: request khác đã ghi trước -> coi là trùng.
          duplicated = true;
        } else {
          console.error('webhook window INSERT:', msg);
        }
      }
    }

    if (!duplicated) {
      /*
       * Ngoài cửa sổ giờ: TIỀN ĐÃ VÀO THẬT (webhook ngân hàng báo), chỉ chờ
       * admin duyệt. Trước đây chỗ này gọi notifyPaymentClaim với tên giả
       * `{ username: 'SePay ngoai gio tu dong' }` → tin nhắn hiện
       * "Khách: SePay ngoai gio tu dong" (chữ vô nghĩa, không dấu) và KHÔNG
       * hiện số tiền thực nhận. Nay truyền số tiền + nội dung CK + mã GD thật.
       */
      try {
        const { notifyPaymentClaim } = await import('../lib/telegram-pay.js');
        await notifyPaymentClaim(env, order, null, {
          confirmed: true, amount, content, txnRef,
        });
      } catch { /* bỏ qua */ }
    }

    await markProcessed(env, inbox.inboxId, {
      state: amount >= expected ? 'matched' : 'wrong_amount',
      orderId: order.id, orderCode: order.code,
      deliverState: 'none',
      note: 'awaiting admin approval (outside auto window)',
    });

    return ok({
      matched: true,
      order: order.code,
      delivered: false,
      duplicated,
      reason: 'AWAITING_ADMIN_APPROVAL',
      window: { from: win.from, to: win.to, hour: win.hour },
    });
  }

  const r = await confirmOrderPaid(env, {

    orderId: order.id,

    amount,

    source: 'sepay',

    txnRef,

    content,

    raw: body,

    /* Đã có chứng từ bền vững ở B1 -> confirmOrderPaid không phải ghi lại. */
    journaled: true,

  });

  /*
   * Ghi kết quả xử lý vào hộp thư. `deliverState` là thứ admin dùng để biết
   * khoản tiền này đã thành hàng chưa — trước đây thông tin đó chỉ suy ra
   * được từ `orders.status`, mà status có thể bị cron đổi.
   */
  await markProcessed(env, inbox.inboxId, {
    state: r.underpaid ? 'wrong_amount' : (r.ok ? 'matched' : 'received'),
    orderId: order.id,
    orderCode: order.code,
    deliverState: r.delivered ? 'delivered'
      : r.pendingManual ? 'pending_manual'
        : r.ok ? 'none' : 'failed',
    note: r.reason || r.error || null,
  });

  return ok({

    matched: true,

    order: order.code,

    duplicated: !!r.duplicated,

    delivered: !!r.delivered,

    underpaid: !!r.underpaid,

    reason: r.reason || null,

  });

}

/** POST /api/webhooks/payos */

export async function payosWebhook(env, request) {
  const { payosSignature, payosChecksumKey } = await import('./wallet.js');

  const body = await readJson(request);

  const key = await payosChecksumKey(env);

  if (!key) throw new ApiError(503, 'Chưa cấu hình payOS', 'NO_KEY');

  /*
   * `payosSignature` là async (nó băm HMAC-SHA256 qua WebCrypto). Thiếu
   * `await` thì `sig` là một Promise; `String(promise)` = "[object Promise]"
   * nên phép so sánh luôn sai và MỌI thanh toán payOS bị trả 401.
   */
  const sig = await payosSignature(body.data || {}, key);

  if (!timingSafeEqualStr(String(body.signature || ''), sig)) {

    throw new ApiError(401, 'Sai chữ ký webhook', 'UNAUTHORIZED');

  }

  const d = body.data || {};

  const cfg = await paymentCfg(env);

  const content = String(d.description || d.desc || '');

  const amount = Math.floor(Number(d.amount) || 0);

  const txnRef = String(d.reference || d.paymentLinkId || '');

  /* ================================================================== */
  /* B1 — GHI SỔ BỀN VỮNG TRƯỚC MỌI NHÁNH RETURN (F07)                  */
  /* ================================================================== */
  /*
   * payOS cũng có nhánh `return ok({matched:false, reason:'NO_ORDER_MATCH'})`
   * trước khi ghi bất cứ thứ gì -> tiền vào mà không có chứng từ. Nay dùng
   * chung hộp thư với SePay, khoá chống trùng là (provider, transaction_id).
   */
  const { recordInbound, markProcessed } = await import('../lib/payment-inbox.js');

  const inbox = await recordInbound(env, {
    provider: 'payos',
    transactionId: txnRef || String(d.orderCode ?? ''),
    amount,
    content,
    accountNumber: d.accountNumber ? String(d.accountNumber) : '',
    transferType: 'in',
    raw: d,
  });

  if (!inbox.recorded) {
    return ok({ matched: false, reason: 'MISSING_TXN_ID' });
  }
  if (inbox.duplicated) {
    return ok({ matched: false, duplicated: true, reason: 'WEBHOOK_REPLAY' });
  }

  if (amount <= 0) {
    await markProcessed(env, inbox.inboxId, { state: 'ignored', note: 'amount <= 0' });
    return ok({ matched: false, reason: 'ZERO_AMOUNT' });
  }

  /*
   * ===== P0 — PHẢI kiểm mã kết quả của payOS =====
   *
   * payOS trả `code` cho BIẾT giao dịch thành công hay không. Bản cũ không
   * kiểm: webhook của một payment link đã HUỶ hoặc THẤT BẠI nhưng
   * `description` vẫn chứa mã đơn sẽ bị coi là đã thanh toán -> giao hàng
   * miễn phí. Bản `payosWebhook` cũ trong wallet.js CÓ kiểm điều này, nhưng
   * bản được route là bản ở đây.
   *
   * '00' là mã thành công của payOS. Chấp nhận chuỗi rỗng khi provider không
   * gửi `code`, nhưng TUYỆT ĐỐI từ chối mọi mã khác.
   */
  const resultCode = d.code !== undefined && d.code !== null ? String(d.code) : '';
  if (resultCode !== '' && resultCode !== '00') {
    await markProcessed(env, inbox.inboxId, {
      state: 'ignored',
      note: `payos code=${resultCode} (khong phai giao dich thanh cong)`,
    });
    return ok({ matched: false, reason: 'NOT_SUCCESS', code: resultCode });
  }

  const order = await findOrderByMemo(env, content, cfg.prefix);

  if (!order) {
    await markProcessed(env, inbox.inboxId, {
      state: 'unmatched', note: 'no order matched memo',
    });
    return ok({ matched: false, reason: 'NO_ORDER_MATCH' });
  }

  const r = await confirmOrderPaid(env, {

    orderId: order.id, amount, source: 'payos', txnRef, content, raw: d,

    journaled: true,

  });

  await markProcessed(env, inbox.inboxId, {
    state: r.underpaid ? 'wrong_amount' : (r.ok ? 'matched' : 'received'),
    orderId: order.id,
    orderCode: order.code,
    deliverState: r.delivered ? 'delivered'
      : r.pendingManual ? 'pending_manual'
        : r.ok ? 'none' : 'failed',
    note: r.reason || r.error || null,
  });

  return ok({

    matched: true,

    order: order.code,

    duplicated: !!r.duplicated,

    delivered: !!r.delivered,

    reason: r.reason || null,

  });

}

/* ------------------------------------------------------------------ */

/* Helpers                                                             */

/* ------------------------------------------------------------------ */

function timingSafeEqualStr(a, b) {
  const x = String(a || '');

  const y = String(b || '');

  if (x.length !== y.length) return false;

  let diff = 0;

  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);

  return diff === 0;

}

/* ------------------------------------------------------------------ */
/* ADMIN                                                               */
/* ------------------------------------------------------------------ */

/**
 * POST /api/admin/orders/:id/confirm-payment
 *
 * Admin xác nhận đã thấy tiền trong sao kê -> giao key.
 * Đây là ĐƯỜNG CỨU khi webhook trượt (SePay chết, khách ghi sai
 * nội dung, khách chuyển tay). Trước đây KHÔNG CÓ endpoint này
 * -> đơn kẹt 'pending' vĩnh viễn dù tiền đã vào ngân hàng.
 */
export async function adminConfirmPayment(env, request, orderId) {
  const { requireAdminStrict } = await import('../lib/auth.js');
  const admin = await requireAdminStrict(env, request);
  const body = await readJson(request).catch(() => ({}));

  const order = await env.DB.prepare('SELECT * FROM orders WHERE id = ?')
    .bind(orderId).first();
  if (!order) throw new ApiError(404, 'Không tìm thấy đơn', 'NOT_FOUND');

  if (order.status === 'delivered') {
    throw new ApiError(409, 'Đơn đã giao rồi', 'ALREADY_DELIVERED');
  }

  /*
   * Admin có thể nhập số tiền thực nhận (mặc định = tổng đơn).
   *
   * `ratify: true` chỉ khi admin KHÔNG gõ số tiền — nghĩa là "tôi đã nhìn thấy
   * tiền trong sao kê và đồng ý giao", KHÔNG phải "có thêm một khoản tiền mới".
   * Nếu webhook đã ghi sổ (nhánh ngoài cửa sổ giờ ghi `confirmed_by=
   * 'sepay-window'`) mà vẫn ghi thêm dòng nữa thì tiền bị đếm hai lần
   * (sổ 360.000đ cho đơn 180.000đ) và Telegram báo "thừa" sai cho admin.
   * Khi sổ CHƯA có dòng nào (webhook trượt hẳn) thì confirmOrderPaid tự ghi
   * đúng số tiền — đường cứu vẫn nguyên vẹn.
   *
   * Admin gõ tay một con số = đang khai một khoản tiền MỚI (khách chuyển bù),
   * khi đó KHÔNG ratify để dòng tiền mới vẫn được ghi sổ.
   */
  const explicitAmount = Number(body.amount) > 0;
  const amount = explicitAmount ? Math.floor(Number(body.amount))
    : Number(order.total);

  const r = await confirmOrderPaid(env, {
    orderId,
    amount,
    source: 'admin',
    adminId: admin.username || admin.id,
    content: body.note || null,
    ratify: !explicitAmount,
  });

  if (!r.ok) {
    throw new ApiError(400,
      `Không giao được: ${r.reason || r.error || 'lỗi không rõ'}`,
      'DELIVER_FAILED');
  }

  await env.DB.prepare(
    `UPDATE orders SET admin_note = ? WHERE id = ?`
  ).bind(String(body.note || `Xác nhận tay bởi ${admin.username || admin.id}`)
    .slice(0, 300), orderId).run();

  return ok({
    order: r.order,
    delivered: !!r.delivered,
    pendingManual: !!r.pendingManual,
    duplicated: !!r.duplicated,
    excess: r.excess || 0,
    underpaid: !!r.underpaid,
  });
}

/** GET /api/admin/payments — sổ tiền vào. */
export async function adminListPayments(env, request) {
  const { requireAdminStrict } = await import('../lib/auth.js');
  await requireAdminStrict(env, request);

  const url = new URL(request.url);
  const state = url.searchParams.get('state') || '';
  const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 200);

  const where = state ? 'WHERE p.state = ?' : '';
  const params = state ? [state, limit] : [limit];

  const { results } = await env.DB.prepare(
    `SELECT p.*, o.code AS order_code, o.status AS order_status,
            o.total AS order_total, u.username
     FROM payments p
     LEFT JOIN orders o ON o.id = p.order_id
     LEFT JOIN users u ON u.id = o.user_id
     ${where}
     ORDER BY p.at DESC
     LIMIT ?`
  ).bind(...params).all();

  /*
   * Thống kê cho thẻ số liệu đầu tab "Chờ thanh toán".
   *
   * PHẢI TÁCH TIỀN THẬT KHỎI GIAO DỊCH TEST.
   *
   * Trước đây chỉ `GROUP BY state` trên TOÀN BỘ bảng payments, nên thẻ
   * "Tổng đã khớp" hiện 19.660.000đ trong khi tiền thật chỉ 1.150.000đ —
   * 18.510.000đ là giao dịch thử của chính hệ thống (is_test=1). Cùng lý do,
   * số "giao dịch tiền vào KHÔNG khớp đơn" bị đội lên gấp 6 lần.
   *
   * Admin dùng đúng những con số này để quyết định có phải kiểm sao kê hay
   * không. Số ảo ở đây làm loãng cảnh báo thật và khiến không ai còn tin
   * cảnh báo nữa.
   *
   * `stats`      = CHỈ tiền thật (is_test=0) — dùng cho cảnh báo + số liệu.
   * `statsAll`   = gồm cả test — chỉ để đối soát nội bộ, không hiện mặc định.
   */
  const stats = await env.DB.prepare(
    `SELECT state, COUNT(*) AS n, COALESCE(SUM(amount),0) AS total
     FROM payments
     WHERE COALESCE(is_test,0) = 0
     GROUP BY state`
  ).all();

  const statsAll = await env.DB.prepare(
    `SELECT state, COUNT(*) AS n, COALESCE(SUM(amount),0) AS total
     FROM payments GROUP BY state`
  ).all();

  const byState = {};
  for (const r of stats.results || []) {
    byState[r.state] = { count: r.n, total: r.total };
  }

  const byStateAll = {};
  for (const r of statsAll.results || []) {
    byStateAll[r.state] = { count: r.n, total: r.total };
  }

  return ok({
    payments: (results || []).map((p) => ({
      id: p.id,
      orderId: p.order_id,
      orderCode: p.order_code,
      orderStatus: p.order_status,
      username: p.username,
      amount: p.amount,
      expected: p.expected,
      state: p.state,
      method: p.method,
      txnRef: p.txn_ref,
      content: p.content,
      confirmedBy: p.confirmed_by,
      isTest: !!p.is_test,
      at: p.at,
    })),
    stats: byState,
    statsAll: byStateAll,
  });
}

