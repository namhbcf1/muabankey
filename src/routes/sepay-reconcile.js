/**
 * Đối soát SePay: kéo giao dịch từ API để tìm tiền vào mà webhook bỏ lỡ.
 *
 * CHỦ SHOP CHỐT:
 *   - Dùng 100% SePay
 *   - SePay chỉ hoạt động 00:00 - 12:00 (tự động xác nhận)
 *   - 12:00 - 24:00 admin duyệt tay qua Telegram
 *   - Hạn chế test bằng SePay (tiết kiệm 50 GD/tháng)
 */
import { ok, ApiError } from '../lib/http.js';
import { nowSec } from '../lib/trial-quota.js';
import { extractMemo, memoOf, confirmOrderPaid, paymentCfg } from './payments.js';

/* ------------------------------------------------------------------ */
/* Cửa sổ giờ tự động xác nhận                                         */
/* ------------------------------------------------------------------ */

/**
 * Giờ Việt Nam (UTC+7) hiện tại.
 * Workers chạy UTC nên phải cộng 7.
 */
export function vnHour(nowMs = Date.now()) {
  return new Date(nowMs + 7 * 3600 * 1000).getUTCHours();
}

/**
 * Có đang trong cửa sổ tự động xác nhận không?
 *
 * 00:00 - 11:59  -> tự động giao khi tiền vào
 * 12:00 - 23:59  -> KHÔNG tự giao, chờ admin duyệt Telegram
 *
 * Cấu hình qua settings: sepay_auto_from / sepay_auto_to (giờ, 0-23).
 * Tắt hoàn toàn: sepay_auto_enabled = 0
 */
export async function autoWindow(env) {
  const { results } = await env.DB.prepare(
    `SELECT key, value FROM settings
     WHERE key IN ('sepay_auto_enabled','sepay_auto_from','sepay_auto_to')`
  ).all();

  const m = {};
  for (const r of results || []) m[r.key] = r.value;

  const enabled = String(m.sepay_auto_enabled ?? '1') !== '0';
  const from = Number.isFinite(Number(m.sepay_auto_from)) ? Number(m.sepay_auto_from) : 0;
  const to = Number.isFinite(Number(m.sepay_auto_to)) ? Number(m.sepay_auto_to) : 12;

  const hour = vnHour();
  const inWindow = from <= to
    ? hour >= from && hour < to          // 00 -> 12
    : hour >= from || hour < to;         // 22 -> 06 (qua nửa đêm)

  return {
    enabled,
    from,
    to,
    hour,
    inWindow: enabled && inWindow,
  };
}

/* ------------------------------------------------------------------ */
/* Đối soát: kéo giao dịch từ API SePay                                */
/* ------------------------------------------------------------------ */

/**
 * GET /api/admin/sepay/reconcile?days=1
 *
 * Tìm giao dịch tiền vào trên SePay mà hệ thống chưa ghi nhận.
 * Dùng khi webhook chết/chậm. KHÔNG tự giao — chỉ liệt kê để admin quyết.
 */
export async function reconcileSePay(env, request) {
  const { requireAdminStrict } = await import('../lib/auth.js');
  await requireAdminStrict(env, request);

  const token = env.SEPAY_API_TOKEN;
  if (!token) {
    throw new ApiError(503,
      'Chưa cấu hình SEPAY_API_TOKEN. Không đối soát được.',
      'NO_TOKEN');
  }

  const url = new URL(request.url);
  const days = Math.min(Number(url.searchParams.get('days')) || 1, 30);

  // SePay API: lấy giao dịch, phân trang tối đa 100/lần
  let txns = [];
  let page = 1;
  let err = null;

  try {
    while (page <= 5) {
      const api = new URL('https://my.sepay.vn/userapi/transactions/list');
      api.searchParams.set('limit', '100');
      api.searchParams.set('page', String(page));

      const r = await fetch(api.toString(), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) {
        err = `SePay API ${r.status}`;
        break;
      }
      const j = await r.json();
      const list = j.transactions || [];
      if (!list.length) break;
      txns = txns.concat(list);
      if (list.length < 100) break;
      page++;
    }
  } catch (e) {
    err = String(e?.message || e).slice(0, 200);
  }

  if (err) {
    return ok({ error: err, checked: 0, missing: [] });
  }

  const cfg = await paymentCfg(env);
  const since = nowSec() - days * 86400;

  // Chỉ lấy tiền VÀO trong khoảng thời gian
  const inbound = txns.filter((t) => {
    const amt = Number(t.amount_in) || 0;
    if (amt <= 0) return false;
    const ts = Math.floor(new Date(t.transaction_date || 0).getTime() / 1000);
    return ts >= since;
  });

  // Đối chiếu với payments
  const missing = [];
  for (const t of inbound) {
    const ref = String(t.reference_number || t.id || '');
    const content = String(t.transaction_content || '');

    // Đã ghi nhận chưa?
    const known = await env.DB.prepare(
      'SELECT id FROM payments WHERE txn_ref = ? LIMIT 1'
    ).bind(ref).first();
    if (known) continue;

    // Khớp đơn nào?
    const memo = extractMemo(content, cfg.prefix);
    let order = null;
    if (memo) {
      order = await env.DB.prepare(
        'SELECT id, code, status, total FROM orders WHERE payment_ref = ? LIMIT 1'
      ).bind(memo).first();
    }

    missing.push({
      txnRef: ref,
      amount: Number(t.amount_in),
      content,
      date: t.transaction_date,
      memo,
      orderCode: order?.code || null,
      orderId: order?.id || null,
      orderStatus: order?.status || null,
      orderTotal: order?.total || null,
      canDeliver: !!(order && ['pending', 'expired', 'paid'].includes(order.status)),
    });
  }

  return ok({
    checked: inbound.length,
    missing,
    window: await autoWindow(env),
  });
}

/**
 * POST /api/admin/sepay/sync  { txnRef }
 *
 * Ghi nhận 1 giao dịch SePay bị bỏ lỡ + giao key nếu khớp đơn.
 */
export async function syncSePayTxn(env, request) {
  const { requireAdminStrict } = await import('../lib/auth.js');
  const admin = await requireAdminStrict(env, request);
  const body = await request.json().catch(() => ({}));

  const txnRef = String(body.txnRef || '').trim();
  const amount = Math.floor(Number(body.amount) || 0);
  const content = String(body.content || '');

  if (!txnRef || amount <= 0) {
    throw new ApiError(400, 'Thiếu mã giao dịch hoặc số tiền', 'BAD_INPUT');
  }

  const cfg = await paymentCfg(env);
  const memo = extractMemo(content, cfg.prefix);

  if (!memo) {
    throw new ApiError(400,
      `Nội dung "${content.slice(0, 40)}" không chứa mã đơn. Không khớp được.`,
      'NO_MEMO');
  }

  const order = await env.DB.prepare(
    'SELECT * FROM orders WHERE payment_ref = ? LIMIT 1'
  ).bind(memo).first();

  if (!order) {
    throw new ApiError(404, `Không tìm thấy đơn cho mã ${memo}`, 'NO_ORDER');
  }

  const r = await confirmOrderPaid(env, {
    orderId: order.id,
    amount,
    source: 'sepay',
    txnRef,
    content,
    adminId: admin.username || admin.id,
  });

  return ok({
    order: r.order,
    delivered: !!r.delivered,
    duplicated: !!r.duplicated,
    underpaid: !!r.underpaid,
    reason: r.reason || null,
  });
}

/* ------------------------------------------------------------------ */
/* Thống kê hạn mức                                                    */
/* ------------------------------------------------------------------ */

/**
 * GET /api/admin/sepay/quota
 *
 * Đếm số giao dịch SePay đã dùng trong tháng (tối đa 50 free).
 */
export async function sepayQuota(env, request) {
  const { requireAdminStrict } = await import('../lib/auth.js');
  await requireAdminStrict(env, request);

  const now = new Date();
  const monthStart = Math.floor(
    new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000
  );

  // KHÔNG tính giao dịch test vào hạn mức 50 GD/tháng
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM payments
     WHERE method = 'sepay' AND at >= ? AND COALESCE(is_test,0) = 0`
  ).bind(monthStart).first();

  const testRow = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM payments
     WHERE method = 'sepay' AND at >= ? AND COALESCE(is_test,0) = 1`
  ).bind(monthStart).first();

  const used = row?.n || 0;
  const limit = 50;

  // Còn bao nhiêu ngày trong tháng
  const daysLeft = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
    - now.getDate();

  return ok({
    used,
    usedByTest: testRow?.n || 0,
    limit,
    remaining: Math.max(0, limit - used),
    percent: Math.round((used / limit) * 100),
    daysLeft,
    overLimit: used > limit,
    window: await autoWindow(env),
  });
}
