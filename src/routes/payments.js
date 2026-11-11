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

                   'order_qr_min','order_qr_max')`

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

 *   L2: claim orders.status 'pending'/'expired' -> 'processing' (changes === 1)

 *   L3: product_keys claim 'available' (trong deliverItems)

 *

 * Trả { ok, duplicated?, delivered?, order?, reason? }

 */

export async function confirmOrderPaid(env, {

  orderId, amount, source, txnRef, adminId, content, raw,

} = {}) {
  const now = nowSec();

  const order = await env.DB.prepare('SELECT * FROM orders WHERE id = ?')

    .bind(orderId).first();

  if (!order) return { ok: false, reason: 'ORDER_NOT_FOUND' };

  // Đã giao rồi -> không làm gì

  if (order.status === 'delivered') {

    return { ok: true, duplicated: true, reason: 'ALREADY_DELIVERED', order };

  }

  if (order.status === 'paid') {

    // Đã xác nhận tiền, đang chờ giao tay -> thử giao lại

    return await deliverAndFinish(env, order, { amount, source, adminId, now });

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

  const paid = Math.floor(Number(amount) || expected);

  // CỘNG DỒN: các lần chuyển trước đó cho cùng đơn.
  // Khách có thể chuyển thiếu rồi chuyển bù (90k + 90k = 180k).
  // Nếu chỉ so từng lần thì không bao giờ giao dù đã đủ tiền.
  const prev = await env.DB.prepare(
    `SELECT COALESCE(SUM(amount),0) AS s FROM payments
     WHERE order_id = ? AND state IN ('matched','wrong_amount')`
  ).bind(order.id).first();
  const prevPaid = Math.floor(Number(prev?.s) || 0);
  const totalPaid = prevPaid + paid;


  const state = paid >= expected ? 'matched'

    : paid > 0 ? 'wrong_amount' : 'matched';

  try {

    await env.DB.prepare(

      `INSERT INTO payments

         (id, order_id, order_code, amount, expected, method, txn_ref,

          content, state, confirmed_by, raw, at)

       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`

    ).bind(payId, order.id, order.code, paid, expected,

      source === 'sepay' ? 'sepay' : source === 'payos' ? 'payos' : 'manual',

      txnRef || null, content || null, state,

      source === 'sepay' || source === 'payos' ? source : (adminId || 'admin'),

      raw ? JSON.stringify(raw).slice(0, 4000) : null, now).run();

  } catch (e) {

    // UNIQUE txn_ref -> replay đồng thời

    if (String(e?.message || '').includes('UNIQUE')) {

      return { ok: true, duplicated: true, reason: 'CONCURRENT_REPLAY', order };

    }

    throw e;

  }

  // Thiếu tiền -> KHÔNG giao, chờ admin quyết

  if (totalPaid < expected) {
    // P0: TRƯỚC ĐÂY IM LẶNG — khách chuyển thiếu mà không ai biết.
    // Tiền vào ngân hàng thật, admin phải thấy để xử lý.
    try {
      const { notifyUnderpaid } = await import('../lib/telegram-pay.js');
      await notifyUnderpaid(env, order, {
        paid: totalPaid, expected, missing: expected - totalPaid,
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
  const claim = await env.DB.prepare(
    `UPDATE orders SET status = 'processing', paid_at = ?, confirmed_by = ?,
            processing_started_at = ?
     WHERE id = ? AND status IN ('pending','expired','processing','cancelled')`
  ).bind(now, source === 'sepay' || source === 'payos' ? source : (adminId || 'admin'),
    now, order.id).run();

  if (!claim.meta || claim.meta.changes !== 1) {

    return { ok: true, duplicated: true, reason: 'CLAIM_FAILED', order };

  }

  const fresh = await env.DB.prepare('SELECT * FROM orders WHERE id = ?')

    .bind(order.id).first();

  return await deliverAndFinish(env, fresh, {

    amount: totalPaid, source, adminId, now,

    excess: totalPaid > expected ? totalPaid - expected : 0,

  });

}

/**

 * Giao hàng + chốt trạng thái. Tách riêng để cả webhook lẫn admin dùng chung.

 */

async function deliverAndFinish(env, order, { amount, source, adminId, now, excess }) {
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

  ).bind(finalStatus, result.pendingManual ? null : now, order.id).run();

  const fresh = await env.DB.prepare('SELECT * FROM orders WHERE id = ?')

    .bind(order.id).first();

  // Thông báo Telegram (không chặn)

  try {
    const { notifyPaymentSuccess } = await import('../lib/telegram-pay.js');

    await notifyPaymentSuccess(env, fresh, { amount, source, adminId, excess });

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
  // Secret phụ CHỈ để kiểm thử tự động.
  const testSecret = env.WEBHOOK_SECRET_TEST;
  const okTest = testSecret ? timingSafeEqualStr(auth, `Apikey ${testSecret}`) : false;

  if (!okMain && !okTest) {

    throw new ApiError(401, 'Sai xác thực webhook', 'UNAUTHORIZED');

  }

  const body = await readJson(request);

  const cfg = await paymentCfg(env);

  // ===== CHỈ NHẬN TIỀN VÀO =====

  // SePay gửi cả giao dịch RA (transferType='out'). Không kiểm -> một lệnh

  // RÚT TIỀN có nội dung trùng mã đơn sẽ bị tính là ĐÃ THANH TOÁN.

  const ttype = String(body.transferType || 'in').toLowerCase();

  if (ttype !== 'in') {

    return ok({ matched: false, reason: 'NOT_INBOUND' });

  }

  // Đúng tài khoản nhận

  if (cfg.bankAccount && body.accountNumber

      && String(body.accountNumber) !== String(cfg.bankAccount)) {

    return ok({ matched: false, reason: 'WRONG_ACCOUNT' });

  }

  const amount = Math.floor(Number(body.transferAmount) || 0);

  if (amount <= 0) return ok({ matched: false, reason: 'ZERO_AMOUNT' });

  const content = String(body.content || body.description || '');

  const txnRef = String(body.referenceCode || body.id || '');

  const order = await findOrderByMemo(env, content, cfg.prefix);

  if (!order) {

    // Tiền vào nhưng không khớp đơn -> ghi lại để admin xử lý

    try {

      await env.DB.prepare(

        `INSERT INTO payments

           (id, order_id, order_code, amount, expected, method, txn_ref,

            content, state, confirmed_by, raw, at)

         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`

      ).bind(crypto.randomUUID(), null, null, amount, 0, 'sepay',

        txnRef || null, content, 'unmatched', 'sepay',

        JSON.stringify(body).slice(0, 4000), nowSec()).run();

    } catch { /* trùng txn_ref -> bỏ qua */ }

    try {
      const { notifyUnmatchedPayment } = await import('../lib/telegram-pay.js');

      await notifyUnmatchedPayment(env, { amount, content, txnRef, provider: 'sepay' });

    } catch { /* bỏ qua */ }

    // Trả 200 để SePay không retry vô ích

    return ok({ matched: false, reason: 'NO_ORDER_MATCH' });

  }

  const r = await confirmOrderPaid(env, {

    orderId: order.id,

    amount,

    source: 'sepay',

    txnRef,

    content,

    raw: body,

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

  const order = await findOrderByMemo(env, content, cfg.prefix);

  if (!order) {

    return ok({ matched: false, reason: 'NO_ORDER_MATCH' });

  }

  const r = await confirmOrderPaid(env, {

    orderId: order.id, amount, source: 'payos', txnRef, content, raw: d,

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

  // Admin có thể nhập số tiền thực nhận (mặc định = tổng đơn)
  const amount = Number(body.amount) > 0 ? Math.floor(Number(body.amount))
    : Number(order.total);

  const r = await confirmOrderPaid(env, {
    orderId,
    amount,
    source: 'admin',
    adminId: admin.username || admin.id,
    content: body.note || null,
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

  // Thống kê
  const stats = await env.DB.prepare(
    `SELECT state, COUNT(*) AS n, COALESCE(SUM(amount),0) AS total
     FROM payments GROUP BY state`
  ).all();

  const byState = {};
  for (const r of stats.results || []) {
    byState[r.state] = { count: r.n, total: r.total };
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
      at: p.at,
    })),
    stats: byState,
  });
}

