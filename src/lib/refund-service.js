/**
 * refund-service.js — MỘT dịch vụ hoàn tiền duy nhất cho web và Telegram.
 *
 * ============================================================================
 * F04 — VÌ SAO PHẢI GOM VỀ MỘT CHỖ
 *
 * Bản cũ có HAI bản cài đặt hoàn tiền khác nhau:
 *
 *   - Web    (orders.js adminRefund): ghi refund_ledger, thu hồi license,
 *            KHÔNG cộng ví, đặt đơn 'refunded' + admin_note.
 *   - Telegram (wallet.js refundOrder): ghi refund_ledger, thu hồi license,
 *            CỘNG users.balance, ghi wallet_transactions, đặt 'refunded'.
 *
 * Hệ quả đo được:
 *   1. Cùng một hành động "hoàn tiền" cho hai kết quả khác nhau trong sổ sách.
 *   2. Đường Telegram cộng vào `users.balance` — thứ đã bị bỏ cùng mô hình ví.
 *      Khách "được hoàn" bằng số dư không tiêu được, còn tiền thật trong ngân
 *      hàng của shop thì không ai đối soát.
 *   3. Cả hai đều có thể chốt 'refunded' mà KHÔNG chứng minh tiền thật đã
 *      chuyển cho khách. "Ghi yêu cầu" bị đánh đồng với "đã trả tiền".
 *
 * NAY: chỉ còn hàm `refundOrder()` ở file này. Web và Telegram chỉ là hai
 * adapter gọi vào, truyền `channel` để phân biệt nguồn thao tác trong sổ.
 *
 * ============================================================================
 * MÔ HÌNH TRẠNG THÁI — TIỀN THẬT LÀ MỘT CHUYỆN RIÊNG
 *
 *   requested  -> quyết định hoàn + đã thu hồi quyền/hàng
 *   completed   -> đã chuyển tiền thật cho khách (có chứng từ)
 *
 * `refund_ledger.state` chỉ có 'pending' (chưa chuyển tiền) và 'done' (đã
 * chuyển). Thao tác hoàn tiền KHÔNG được tự chốt 'done': phải có bước xác
 * nhận chuyển tiền kèm tham chiếu ngân hàng. Nhờ vậy dashboard đối soát được
 * "đã hứa hoàn" khác "đã hoàn".
 * ============================================================================
 */
import { nowSec } from './trial-quota.js';

/** Lý do hoàn tiền hợp lệ. */
export const REFUND_REASONS = [
  'customer_request', 'wrong_product', 'not_as_described',
  'duplicate_payment', 'overpaid', 'service_issue', 'admin_adjust',
];

/**
 * Hoàn tiền một đơn ở tầng NGHIỆP VỤ. Không biết gì về HTTP.
 *
 * Nguyên tắc chống trùng (giữ nguyên, không được nới):
 *   L1 `refund_ledger.order_id` là PRIMARY KEY -> mỗi đơn tối đa MỘT dòng.
 *      INSERT thành công = lượt này được phép đi tiếp. Trùng = đã có người
 *      hoàn rồi -> dừng. Kiểm ở tầng DB, không dựa vào `orders.status`.
 *   L2 Giành đơn bằng UPDATE có điều kiện
 *      (`status IN ('paid','delivered')` -> 'refunding', changes === 1).
 *   L3 Thu hồi quyền/license theo ĐÚNG đơn, không quét cả tài khoản.
 *
 * @param {object} env
 * @param {object} opts
 * @param {string} opts.orderId
 * @param {string} opts.channel      'web' | 'telegram' | 'system'
 * @param {string} [opts.actor]      người bấm (username/admin id)
 * @param {string} [opts.reason]     một giá trị trong REFUND_REASONS
 * @param {number} [opts.amount]     số tiền hoàn; mặc định = order.total
 * @param {boolean} [opts.markPaidOut] true = đã thật sự chuyển tiền (có chứng từ)
 * @param {string} [opts.bankRef]    tham chiếu chuyển khoản (bắt buộc khi markPaidOut)
 * @param {string} [opts.note]
 * @returns {Promise<{ok:boolean, code?:string, message?:string,
 *                    revoked?:object, amount?:number, state?:string}>}
 */
export async function refundOrder(env, opts = {}) {
  const {
    orderId, channel = 'web', actor = null, reason = 'customer_request',
    markPaidOut = false, bankRef = '', note = '',
  } = opts;

  if (!orderId) return { ok: false, code: 'BAD_REQUEST', message: 'Thiếu orderId' };
  const cleanReason = REFUND_REASONS.includes(String(reason)) ? String(reason) : 'admin_adjust';

  const order = await env.DB.prepare('SELECT * FROM orders WHERE id = ?')
    .bind(orderId).first();
  if (!order) return { ok: false, code: 'NOT_FOUND', message: 'Đơn hàng không tồn tại' };

  if (order.status === 'refunded') {
    return { ok: false, code: 'ALREADY_REFUNDED', message: 'Đơn đã được hoàn tiền' };
  }

  /*
   * CHỈ HOÀN ĐƠN ĐÃ THANH TOÁN.
   * Bản cũ cho hoàn cả đơn 'pending' -> đơn chưa trừ đồng nào vẫn được ghi
   * "đã hoàn", làm sổ tiền sai và mở đường cộng tiền khống.
   */
  if (!['paid', 'delivered', 'processing'].includes(order.status)) {
    return {
      ok: false, code: 'BAD_STATE',
      message: `Chỉ hoàn tiền đơn đã thanh toán. Đơn này đang ở trạng thái "${order.status}".`,
    };
  }

  if (markPaidOut && !String(bankRef || '').trim()) {
    return {
      ok: false, code: 'BANK_REF_REQUIRED',
      message: 'Chốt "đã hoàn tiền" phải kèm mã giao dịch chuyển khoản thật.',
    };
  }

  const now = Date.now();
  const nowS = nowSec();
  const amount = Math.floor(Number(opts.amount) || Number(order.total) || 0);

  /* ---- L2: giành đơn nguyên tử ---- */
  const claim = await env.DB.prepare(
    `UPDATE orders SET status = 'refunding', refund_started_at = ?
      WHERE id = ? AND status IN ('paid','delivered','processing')`
  ).bind(now, orderId).run();
  if (!claim.meta || claim.meta.changes !== 1) {
    return { ok: false, code: 'CLAIM_FAILED', message: 'Đơn đang được xử lý bởi thao tác khác' };
  }

  /* ---- L1: chốt sổ (mỗi đơn một dòng, mãi mãi) ---- */
  const claimToken = `${now}-${Math.random().toString(36).slice(2, 10)}`;
  const ledgerState = markPaidOut ? 'done' : 'pending';
  let ledgerOk = false;
  try {
    const led = await env.DB.prepare(
      `INSERT INTO refund_ledger
         (order_id, amount, user_id, order_code, state, claim_token, source, actor, at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      orderId, amount, order.user_id, order.code,
      ledgerState, claimToken, channel, actor || channel, now,
    ).run();
    ledgerOk = led.meta && led.meta.changes === 1;
  } catch {
    ledgerOk = false;
  }

  if (!ledgerOk) {
    // Nhả đơn để admin còn thao tác được ở kênh khác.
    await env.DB.prepare(
      `UPDATE orders SET status = ?, refund_started_at = NULL
        WHERE id = ? AND status = 'refunding'`
    ).bind(order.status, orderId).run().catch(() => {});
    return {
      ok: false, code: 'ALREADY_REFUNDED',
      message: 'Đơn này đã được ghi sổ hoàn tiền trước đó. Kiểm tra lại lịch sử.',
    };
  }

  /* ---- L3: thu hồi hàng + quyền, ĐÚNG PHẠM VI ĐƠN NÀY ---- */
  const revoked = { licenses: 0, features: [], grantRows: 0 };
  try {
    const { results: issues } = await env.DB.prepare(
      'SELECT license_key FROM license_issues WHERE order_id = ?'
    ).bind(orderId).all();
    for (const row of issues || []) {
      await env.DB.prepare('UPDATE licenses SET revoked = 1 WHERE key = ?')
        .bind(row.license_key).run();
      await env.DB.prepare(
        'INSERT INTO lic_events (key, hwid, kind, detail, ip, at) VALUES (?,?,?,?,?,?)'
      ).bind(row.license_key, null, 'revoke', `refund ${order.code} (${channel})`, '', nowS).run()
        .catch(() => {});
      revoked.licenses++;
    }
  } catch (e) {
    console.error('refund: revoke licenses', e && e.message);
  }

  /*
   * THU HỒI QUYỀN TÀI KHOẢN — PHẦN CÒN THIẾU CỦA F02.
   *
   * Bản cũ thu hồi license nhưng KHÔNG đảo nguồn quyền tài khoản. Khách được
   * hoàn tiền mà vẫn giữ nguyên số ngày đã cấp -> vừa có tiền vừa có quyền.
   * Nay trừ đúng số ngày của đơn này (không đụng các đơn khác).
   */
  try {
    const { revokeOrderGrants } = await import('./account-entitlement.js');
    const r = await revokeOrderGrants(env, orderId, { reason: `refund:${cleanReason}`, now: nowS });
    revoked.features = r.features;
    revoked.grantRows = r.revoked;
  } catch (e) {
    console.error('refund: revoke entitlements', e && e.message);
  }

  try {
    const { results: items } = await env.DB.prepare(
      'SELECT product_id, quantity FROM order_items WHERE order_id = ?'
    ).bind(orderId).all();
    for (const it of items || []) {
      await env.DB.prepare(
        'UPDATE products SET sold_count = MAX(0, sold_count - ?) WHERE id = ?'
      ).bind(it.quantity, it.product_id).run().catch(() => {});
    }
  } catch { /* không chặn */ }

  /* ---- Chốt sổ + trạng thái đơn ---- */
  const noteLine = [
    `Hoàn tiền qua ${channel}`,
    `${amount}đ`,
    `lý do: ${cleanReason}`,
    markPaidOut ? `đã chuyển (ref ${String(bankRef).slice(0, 60)})` : 'CHỜ CHUYỂN TIỀN',
    note ? String(note).slice(0, 160) : '',
  ].filter(Boolean).join(' · ');

  const finalStatus = markPaidOut ? 'refunded' : 'refund_pending_transfer';
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE refund_ledger
          SET state = ?, revoked = ?, claim_token = NULL, at = ?
        WHERE order_id = ? AND claim_token = ?`
    ).bind(ledgerState, revoked.licenses, now, orderId, claimToken),
    env.DB.prepare(
      'UPDATE orders SET status = ?, admin_note = ? WHERE id = ?'
    ).bind(finalStatus, noteLine.slice(0, 300), orderId),
  ]);

  // Trả lại lượt coupon (nếu có) — dùng chung hàm với luồng đơn.
  try {
    const { releaseCoupon } = await import('../routes/orders.js');
    await releaseCoupon(env, order.coupon_code, orderId);
  } catch { /* không chặn */ }

  return {
    ok: true,
    orderId,
    orderCode: order.code,
    amount,
    state: ledgerState,
    status: finalStatus,
    reason: cleanReason,
    channel,
    revoked,
  };
}

/**
 * Chốt "đã chuyển tiền thật" cho một khoản hoàn đang chờ.
 *
 * Tách khỏi `refundOrder` vì đây là hành động KHÁC: quyết định hoàn (đã làm)
 * và chuyển tiền (làm sau, khi có chứng từ ngân hàng).
 *
 * @returns {Promise<{ok:boolean, code?:string, message?:string}>}
 */
export async function completeRefundTransfer(env, {
  orderId, bankRef, actor = null, amount = null,
}) {
  const ref = String(bankRef || '').trim();
  if (!ref) {
    return { ok: false, code: 'BANK_REF_REQUIRED', message: 'Thiếu mã giao dịch chuyển khoản' };
  }

  const ledger = await env.DB.prepare(
    'SELECT * FROM refund_ledger WHERE order_id = ?'
  ).bind(orderId).first();
  if (!ledger) {
    return { ok: false, code: 'NOT_FOUND', message: 'Đơn này chưa có sổ hoàn tiền' };
  }
  if (ledger.state === 'done') {
    return { ok: false, code: 'ALREADY_DONE', message: 'Khoản hoàn này đã được chốt trước đó' };
  }

  const now = Date.now();
  const finalAmount = Math.floor(Number(amount) || Number(ledger.amount) || 0);

  const upd = await env.DB.prepare(
    `UPDATE refund_ledger
        SET state = 'done', claim_token = NULL, at = ?,
            actor = COALESCE(?, actor)
      WHERE order_id = ? AND state = 'pending'`
  ).bind(now, actor ? `${actor}|${ref.slice(0, 80)}` : ref.slice(0, 80), orderId).run();

  if (!upd.meta || upd.meta.changes !== 1) {
    return { ok: false, code: 'ALREADY_DONE', message: 'Khoản hoàn này đã được chốt trước đó' };
  }

  await env.DB.prepare(
    `UPDATE orders
        SET status = 'refunded',
            admin_note = COALESCE(admin_note, '') || ?
      WHERE id = ? AND status IN ('refund_pending_transfer','refunding','paid','delivered')`
  ).bind(` · đã chuyển ${finalAmount}đ (ref ${ref.slice(0, 60)})`, orderId).run();

  return { ok: true, orderId, amount: finalAmount, bankRef: ref, state: 'done' };
}

/** Các khoản hoàn đã hứa nhưng CHƯA chuyển tiền (dashboard đối soát). */
export async function listPendingRefunds(env, limit = 100) {
  try {
    const { results } = await env.DB.prepare(
      `SELECT r.order_id, r.amount, r.order_code, r.source, r.actor, r.at,
              o.status AS order_status, u.username
         FROM refund_ledger r
         LEFT JOIN orders o ON o.id = r.order_id
         LEFT JOIN users u ON u.id = r.user_id
        WHERE r.state = 'pending'
        ORDER BY r.at DESC
        LIMIT ?`
    ).bind(Math.max(1, Math.min(500, Number(limit) || 100))).all();
    return results || [];
  } catch {
    return [];
  }
}
