/**
 * payment-inbox.js — HỘP THƯ TIỀN VÀO BỀN VỮNG.
 *
 * ============================================================================
 * F07 — VÌ SAO PHẢI CÓ FILE NÀY
 *
 * Webhook ngân hàng là nguồn tiền DUY NHẤT không thể lấy lại được. Khi
 * provider gửi webhook, nếu hệ thống trả 200 thì provider KHÔNG BAO GIỜ gửi
 * lại. Vì vậy tiền chỉ an toàn khi nó được ghi vào một bảng BỀN VỮNG trước
 * khi trả 200.
 *
 * Bản cũ vi phạm ở nhiều nhánh (đo được bằng đọc code):
 *
 *   1. payments.js `confirmOrderPaid`:
 *        if (order.status === 'delivered') return {...}   <- TRƯỚC khi ghi sổ
 *      -> giao dịch thứ hai cho một đơn đã giao không vào sổ. Tiền vào ngân
 *         hàng mà sổ trống => admin không đối soát được.
 *
 *   2. `if (order.status === 'paid') return await deliverAndFinish(...)` —
 *      giao lại TRƯỚC khi kiểm `txn_ref`; paid-retry có nguy cơ giao trùng.
 *
 *   3. Nhánh ngoài cửa sổ giờ và nhánh không khớp đơn đều `catch {}` nuốt
 *      lỗi ghi sổ rồi vẫn trả 200.
 *
 * ============================================================================
 * NGUYÊN TẮC MỚI — "TIỀN TRƯỚC, QUYẾT ĐỊNH SAU"
 *
 *   B1. `recordInbound()` — INSERT vào `payment_inbox` với
 *       UNIQUE(provider, transaction_id). Đây là bước TỐI THIỂU phải thành
 *       công; nếu ném lỗi thì webhook trả 500 để provider gửi lại.
 *   B2. Chỉ sau khi có chứng từ bền vững mới quyết định khớp đơn/giao hàng.
 *   B3. `markProcessed()` ghi lại kết quả để đối soát và cho phép replay.
 *
 * Nhờ UNIQUE ở tầng DB, hai webhook đồng thời cùng một giao dịch chỉ có MỘT
 * dòng được ghi. Không cần khoá mềm, không có khe đua.
 * ============================================================================
 */

function secNow(now) {
  const n = Number(now);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : Math.floor(Date.now() / 1000);
}

function newId() {
  try { return crypto.randomUUID(); } catch {
    return `pi-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

/**
 * Ghi một khoản tiền vào vào hộp thư bền vững.
 *
 * HÀM NÀY NÉM LỖI khi không ghi được — bên gọi PHẢI để lỗi lan ra tới
 * response webhook (trả 5xx) để provider gửi lại. Nuốt lỗi ở đây = mất tiền.
 *
 * @param {object} env
 * @param {object} opts
 * @param {'sepay'|'payos'} opts.provider
 * @param {string} opts.transactionId  mã giao dịch phía provider (rỗng = không hợp lệ)
 * @param {number} opts.amount
 * @param {string} [opts.content]
 * @param {string} [opts.accountNumber]
 * @param {string} [opts.transferType]
 * @param {boolean} [opts.isTest]
 * @param {object} [opts.raw]
 * @param {number} [opts.now]
 * @returns {Promise<{recorded:boolean, duplicated:boolean, inboxId:string|null,
 *                    state:string}>}
 */
export async function recordInbound(env, opts = {}) {
  const provider = String(opts.provider || '').trim().toLowerCase();
  const txnId = String(opts.transactionId || '').trim();

  // Không có mã giao dịch thì KHÔNG thể chống trùng -> từ chối ghi im lặng.
  if (!txnId) {
    return { recorded: false, duplicated: false, inboxId: null, state: 'no_txn_id' };
  }
  if (!provider) throw new Error('recordInbound: thiếu provider');

  const amount = Math.floor(Number(opts.amount) || 0);
  const now = secNow(opts.now);
  const inboxId = newId();
  const isTest = opts.isTest ? 1 : 0;

  try {
    await env.DB.prepare(
      `INSERT INTO payment_inbox
         (id, provider, transaction_id, account_number, amount, content,
          transfer_type, is_test, state, raw, received_at)
       VALUES (?,?,?,?,?,?,?,?,'received',?,?)`
    ).bind(
      inboxId, provider, txnId,
      opts.accountNumber ? String(opts.accountNumber).slice(0, 60) : null,
      amount,
      opts.content ? String(opts.content).slice(0, 500) : null,
      opts.transferType ? String(opts.transferType).slice(0, 10) : null,
      isTest,
      opts.raw ? JSON.stringify(opts.raw).slice(0, 4000) : null,
      now,
    ).run();
    return { recorded: true, duplicated: false, inboxId, state: 'received' };
  } catch (e) {
    const msg = String(e?.message || e);
    /*
     * Vi phạm UNIQUE = giao dịch này đã được ghi ở lần webhook trước.
     * Đây KHÔNG phải lỗi: provider gửi lại là chuyện bình thường. Nhưng phải
     * phân biệt rõ với lỗi hạ tầng — chỉ UNIQUE mới được coi là trùng.
     */
    if (/UNIQUE|PRIMARY KEY/i.test(msg)) {
      let existing = null;
      try {
        existing = await env.DB.prepare(
          'SELECT id, state FROM payment_inbox WHERE provider = ? AND transaction_id = ?'
        ).bind(provider, txnId).first();
      } catch { /* bỏ qua */ }
      return {
        recorded: true, duplicated: true,
        inboxId: existing?.id || null,
        state: existing?.state || 'received',
      };
    }
    throw e;   // lỗi thật -> để webhook trả 5xx cho provider retry
  }
}

/**
 * Ghi kết quả xử lý một khoản tiền đã vào hộp thư.
 *
 * Không bao giờ ném lỗi: ghi nhận kết quả phụ không được làm hỏng luồng giao
 * hàng (tiền đã có chứng từ bền vững rồi).
 */
export async function markProcessed(env, inboxId, {
  state, orderId = null, orderCode = null, deliverState = 'none', note = null, now,
} = {}) {
  if (!inboxId) return;
  const t = secNow(now);
  const nextState = String(state || 'matched');
  try {
    await env.DB.prepare(
      `UPDATE payment_inbox
          SET state = ?, order_id = COALESCE(?, order_id),
              order_code = COALESCE(?, order_code),
              deliver_state = ?, processed_at = ?, attempts = attempts + 1,
              note = COALESCE(?, note)
        WHERE id = ?`
    ).bind(
      nextState,
      orderId ? String(orderId) : null,
      orderCode ? String(orderCode) : null,
      String(deliverState || 'none'),
      t,
      note ? String(note).slice(0, 300) : null,
      inboxId,
    ).run();
  } catch { /* không chặn luồng chính */ }
}

/**
 * Đối soát: các khoản tiền vào CHƯA xử lý xong.
 *
 * Đây là danh sách admin phải nhìn mỗi ngày. Trước đây những khoản này chỉ
 * nằm rải rác ở `payments.state='unmatched'` (khi ghi được) hoặc BIẾN MẤT
 * hoàn toàn (khi ghi lỗi bị nuốt).
 */
export async function listUnresolved(env, limit = 100) {
  try {
    const { results } = await env.DB.prepare(
      `SELECT id, provider, transaction_id, amount, content, state,
              deliver_state, order_id, order_code, received_at, attempts, note
         FROM payment_inbox
        WHERE state IN ('received','unmatched','wrong_amount','wrong_account')
           OR deliver_state = 'failed'
        ORDER BY received_at DESC
        LIMIT ?`
    ).bind(Math.max(1, Math.min(500, Number(limit) || 100))).all();
    return results || [];
  } catch {
    return [];
  }
}

/** Tra một khoản tiền đã ghi theo mã giao dịch provider. */
export async function findByTxn(env, provider, transactionId) {
  try {
    return await env.DB.prepare(
      'SELECT * FROM payment_inbox WHERE provider = ? AND transaction_id = ?'
    ).bind(String(provider), String(transactionId)).first();
  } catch {
    return null;
  }
}

/**
 * Tổng tiền THẬT đã ghi cho một đơn, đọc từ hộp thư.
 *
 * Dùng để kiểm "đã đủ tiền chưa" mà không phụ thuộc `payments` (bảng cũ có
 * thể thiếu dòng do lỗi ghi sổ đã bị nuốt trước đây).
 */
export async function sumForOrder(env, orderId) {
  try {
    const row = await env.DB.prepare(
      `SELECT COALESCE(SUM(amount),0) AS s FROM payment_inbox
        WHERE order_id = ? AND is_test = 0
          AND state IN ('matched','wrong_amount')
          AND transfer_type IN ('in','')`
    ).bind(String(orderId)).first();
    return Math.floor(Number(row?.s) || 0);
  } catch {
    return 0;
  }
}
