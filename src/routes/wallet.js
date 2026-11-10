/** Ví điện tử: xem số dư, lịch sử giao dịch, tạo lệnh nạp tiền VietQR, webhook ngân hàng. */
import { ok, ApiError, readJson } from '../lib/http.js';
import { int, str } from '../lib/validate.js';
import { uuid, topupCode } from '../lib/crypto.js';
import { requireUser, requireAdmin } from '../lib/auth.js';
import { rateLimit, clientIp } from '../lib/ratelimit.js';
import { audit } from './products.js';

export async function getWallet(env, request) {
  const user = await requireUser(env, request);
  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get('page') || 1));
  const perPage = Math.min(50, Math.max(1, Number(url.searchParams.get('perPage') || 20)));

  const { results } = await env.DB.prepare(
    `SELECT * FROM wallet_transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`
  ).bind(user.id, perPage, (page - 1) * perPage).all();

  const total = await env.DB.prepare(
    `SELECT
       COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END),0) AS income,
       COALESCE(SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END),0) AS expense
     FROM wallet_transactions WHERE user_id = ? AND status = 'success'`
  ).bind(user.id).first();

  return ok({
    balance: user.balance,
    summary: { income: total?.income || 0, expense: total?.expense || 0 },
    transactions: (results || []).map((t) => ({
      id: t.id,
      type: t.type,
      amount: t.amount,
      balanceAfter: t.balance_after,
      status: t.status,
      reference: t.reference,
      description: t.description,
      createdAt: t.created_at,
    })),
    page,
    perPage,
  });
}

async function getBankSettings(env) {
  const { results } = await env.DB.prepare(
    "SELECT key, value FROM settings WHERE key IN ('bank_name','bank_account','bank_owner','topup_min','topup_max')"
  ).all();
  const map = {};
  for (const r of results || []) map[r.key] = r.value;
  return {
    bankName: map.bank_name || 'MB Bank',
    bankAccount: map.bank_account || '0000000000',
    bankOwner: map.bank_owner || 'CHU TAI KHOAN',
    min: Number(map.topup_min || 20000),
    max: Number(map.topup_max || 50000000),
  };
}

/** Tạo lệnh nạp tiền + thông tin VietQR để khách quét. */
export async function createTopup(env, request) {
  const user = await requireUser(env, request);
  const ip = clientIp(request);
  await rateLimit(env, `topup:${user.id}:${ip}`, 10, 600);

  const body = await readJson(request);
  const cfg = await getBankSettings(env);
  const amount = int(body.amount, 'amount', { min: cfg.min, max: cfg.max });
  // Làm tròn đến 1000đ để dễ đối soát
  const rounded = Math.round(amount / 1000) * 1000;

  const code = topupCode();
  const id = uuid();
  const now = Date.now();
  const expires = now + 30 * 60 * 1000;

  await env.DB.prepare(
    `INSERT INTO topups (id, code, user_id, amount, status, provider, created_at, expires_at)
     VALUES (?,?,?,?,'pending','sepay',?,?)`
  ).bind(id, code, user.id, rounded, now, expires).run();

  const memo = `NAP${code}`;
  // VietQR đã chuyển sang endpoint .svg (301 từ .png) — dùng trực tiếp để tránh redirect
  const bankSlug = cfg.bankName.replace(/\s+/g, '');
  const qrUrl =
    `https://img.vietqr.io/image/${encodeURIComponent(bankSlug)}-${encodeURIComponent(cfg.bankAccount)}-compact2.svg` +
    `?amount=${rounded}&addInfo=${encodeURIComponent(memo)}&accountName=${encodeURIComponent(cfg.bankOwner)}`;

  return ok({
    topup: {
      id,
      code,
      memo,
      amount: rounded,
      expiresAt: expires,
      status: 'pending',
      bank: {
        name: cfg.bankName,
        account: cfg.bankAccount,
        owner: cfg.bankOwner,
      },
      qrUrl,
    },
  }, 201);
}

export async function getTopup(env, request, topupId) {
  const user = await requireUser(env, request);
  const row = await env.DB.prepare('SELECT * FROM topups WHERE id = ? AND user_id = ?')
    .bind(topupId, user.id)
    .first();
  if (!row) throw new ApiError(404, 'Không tìm thấy lệnh nạp tiền', 'NOT_FOUND');
  return ok({
    topup: {
      id: row.id,
      code: row.code,
      memo: `NAP${row.code}`,
      amount: row.amount,
      status: row.status,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      paidAt: row.paid_at,
    },
  });
}

/**
 * Webhook nhận thông báo chuyển khoản (tương thích SePay / Casso / MB API).
 * Xác thực bằng header Authorization: Apikey <WEBHOOK_SECRET>.
 */
export async function sepayWebhook(env, request) {
  const secret = env.WEBHOOK_SECRET;
  if (!secret) throw new ApiError(503, 'Webhook chưa được cấu hình', 'NOT_CONFIGURED');

  const auth = request.headers.get('authorization') || '';
  const provided = auth.replace(/^(Apikey|Bearer)\s+/i, '').trim();
  const { timingSafeEqual } = await import('../lib/crypto.js');
  if (!timingSafeEqual(provided, secret)) {
    throw new ApiError(401, 'Sai khoá xác thực webhook', 'UNAUTHORIZED');
  }

  const body = await readJson(request);
  const content = String(body.content || body.description || body.transferContent || '');
  const amountIn = Number(body.transferAmount ?? body.amount ?? 0);
  const ref = String(body.referenceCode || body.transactionId || body.id || '');

  if (!content || !amountIn) throw new ApiError(400, 'Thiếu nội dung hoặc số tiền', 'VALIDATION');

  // Tìm mã NAP trong nội dung chuyển khoản
  const m = content.toUpperCase().match(/NAP([A-Z0-9]{5})/);
  if (!m) return ok({ matched: false, reason: 'NO_MEMO' });

  const code = m[1];
  const topup = await env.DB.prepare('SELECT * FROM topups WHERE code = ? LIMIT 1').bind(code).first();
  if (!topup) return ok({ matched: false, reason: 'TOPUP_NOT_FOUND' });
  if (topup.status === 'paid') return ok({ matched: true, duplicated: true, reason: 'ALREADY_PAID' });

  const now = Date.now();

  // ===== CHUYỂN THIẾU TIỀN: VẪN CỘNG PHẦN ĐÃ NHẬN =====
  // Trước đây đánh dấu 'expired' và bỏ qua -> khách mất tiền, shop giữ.
  if (amountIn < topup.amount) {
    const credited = Math.floor(amountIn);
    await env.DB.prepare("UPDATE topups SET status='partial', txn_ref = ? WHERE id = ?")
      .bind(ref, topup.id).run();
    await env.DB.prepare('UPDATE users SET balance = balance + ?, updated_at = ? WHERE id = ?')
      .bind(credited, now, topup.user_id).run();
    const balP = await env.DB.prepare('SELECT balance FROM users WHERE id = ?').bind(topup.user_id).first();
    await env.DB.prepare(
      `INSERT INTO wallet_transactions (id, user_id, type, amount, balance_after, status, reference, description, created_at)
       VALUES (?,?,'topup',?,?,'success',?,?,?)`
    ).bind(uuid(), topup.user_id, credited, balP.balance, ref || code,
      `Nạp một phần ${credited.toLocaleString('vi-VN')}đ / ${topup.amount.toLocaleString('vi-VN')}đ (${code})`, now).run();
    await audit(env, null, 'topup.partial', topup.id, { expected: topup.amount, received: amountIn });
    return ok({
      matched: true, reason: 'PARTIAL', expected: topup.amount,
      received: amountIn, credited, balance: balP.balance,
    });
  }

  // Chuyển thừa: cộng đúng số đã đặt, phần dư ghi nhận để đối soát
  const credited = topup.amount;
  const excess = Math.floor(amountIn) - topup.amount;

  await env.DB.prepare("UPDATE topups SET status='paid', txn_ref = ?, paid_at = ? WHERE id = ?")
    .bind(ref, now, topup.id).run();
  await env.DB.prepare('UPDATE users SET balance = balance + ?, updated_at = ? WHERE id = ?')
    .bind(credited, now, topup.user_id).run();

  const bal = await env.DB.prepare('SELECT balance FROM users WHERE id = ?').bind(topup.user_id).first();
  await env.DB.prepare(
    `INSERT INTO wallet_transactions (id, user_id, type, amount, balance_after, status, reference, description, created_at)
     VALUES (?,?,'topup',?,?,'success',?,?,?)`
  ).bind(uuid(), topup.user_id, credited, bal.balance, ref || code, `Nạp tiền qua chuyển khoản (${code})`, now).run();

  await audit(env, null, 'topup.paid', topup.id, { amount: credited, ref, excess: excess || 0 });
  return ok({
    matched: true, credited, balance: bal.balance,
    ...(excess > 0 ? { reason: 'OVERPAID', excess, note: 'Phần dư đã ghi nhận để đối soát' } : {}),
  });
}

/* ============================================================
   ADMIN: QUẢN LÝ NẠP TIỀN
   Cần thiết vì webhook ngân hàng có thể chưa nối / bị lỗi /
   khách chuyển sai nội dung. Không có UI này thì admin phải
   sửa DB tay -> dễ sai sổ cái.
   ============================================================ */

/** GET /api/admin/topups?status=pending — danh sách lệnh nạp. */
export async function adminListTopups(env, request) {
  const { requireAdmin } = await import('../lib/auth.js');
  const { ok } = await import('../lib/http.js');
  await requireAdmin(env, request);

  const url = new URL(request.url);
  const status = url.searchParams.get('status') || '';
  const q = (url.searchParams.get('q') || '').trim();

  const where = ['1=1'];
  const binds = [];
  if (status) { where.push('t.status = ?'); binds.push(status); }
  if (q) { where.push('(t.code LIKE ? OR u.email LIKE ?)'); binds.push(`%${q}%`, `%${q}%`); }

  const { results } = await env.DB.prepare(
    `SELECT t.*, u.email, u.full_name, u.balance
     FROM topups t LEFT JOIN users u ON u.id = t.user_id
     WHERE ${where.join(' AND ')}
     ORDER BY t.created_at DESC LIMIT 200`
  ).bind(...binds).all();

  const stats = await env.DB.prepare(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending,
       SUM(CASE WHEN status='paid' THEN 1 ELSE 0 END) AS paid,
       SUM(CASE WHEN status='partial' THEN 1 ELSE 0 END) AS partial,
       SUM(CASE WHEN status='expired' THEN 1 ELSE 0 END) AS expired,
       COALESCE(SUM(CASE WHEN status='paid' THEN amount ELSE 0 END),0) AS total_amount
     FROM topups`
  ).first();

  return ok({
    topups: (results || []).map((t) => ({
      id: t.id,
      code: t.code,
      memo: `NAP${t.code}`,
      amount: t.amount,
      status: t.status,
      provider: t.provider,
      txnRef: t.txn_ref,
      email: t.email,
      customer: t.full_name,
      balance: t.balance,
      createdAt: t.created_at,
      expiresAt: t.expires_at,
      paidAt: t.paid_at,
    })),
    stats: {
      total: stats?.total || 0,
      pending: stats?.pending || 0,
      paid: stats?.paid || 0,
      partial: stats?.partial || 0,
      expired: stats?.expired || 0,
      totalAmount: stats?.total_amount || 0,
    },
  });
}

/**
 * POST /api/admin/topups/:id/approve
 * Admin xác nhận đã nhận được tiền (dùng khi webhook chưa nối
 * hoặc khách chuyển sai nội dung). Cộng tiền + ghi sổ cái đầy đủ.
 */
export async function adminApproveTopup(env, request, topupId) {
  const { requireAdmin } = await import('../lib/auth.js');
  const { ok, ApiError: AE } = await import('../lib/http.js');
  const { uuid } = await import('../lib/crypto.js');
  const admin = await requireAdmin(env, request);
  const body = await readJson(request).catch(() => ({}));

  const t = await env.DB.prepare('SELECT * FROM topups WHERE id = ?').bind(topupId).first();
  if (!t) throw new AE(404, 'Lệnh nạp không tồn tại', 'NOT_FOUND');
  if (t.status === 'paid') throw new AE(409, 'Lệnh nạp đã được duyệt rồi', 'BAD_STATE');

  // Số tiền thực nhận: cho admin nhập nếu khách chuyển khác
  let credited = t.amount;
  if (body.amount !== undefined) {
    credited = int(body.amount, 'amount', { min: 1000, max: 500_000_000 });
  }
  const note = str(body.note, 'note', { required: false, max: 300 }) || 'Admin duyệt tay';

  // Giành nguyên tử: chỉ 1 request duyệt được
  const claim = await env.DB.prepare(
    `UPDATE topups SET status = 'paid', paid_at = ?, txn_ref = COALESCE(txn_ref, ?)
     WHERE id = ? AND status != 'paid'`
  ).bind(Date.now(), 'ADMIN-' + admin.id.slice(0, 8), topupId).run();
  if (!claim.meta || claim.meta.changes !== 1) {
    throw new AE(409, 'Lệnh nạp đã được duyệt rồi', 'BAD_STATE');
  }

  const now = Date.now();
  await env.DB.prepare('UPDATE users SET balance = balance + ?, updated_at = ? WHERE id = ?')
    .bind(credited, now, t.user_id).run();

  const bal = await env.DB.prepare('SELECT balance FROM users WHERE id = ?').bind(t.user_id).first();
  await env.DB.prepare(
    `INSERT INTO wallet_transactions (id, user_id, type, amount, balance_after, status, reference, description, created_at)
     VALUES (?,?,'topup',?,?,'success',?,?,?)`
  ).bind(uuid(), t.user_id, credited, bal.balance, t.code,
    `Nạp tiền duyệt tay (${t.code}) — ${note}`, now).run();

  await audit(env, admin.id, 'topup.approve', topupId, { credited, note, by: admin.email });
  return ok({ id: topupId, credited, balance: bal.balance });
}

/** POST /api/admin/topups/:id/reject — huỷ lệnh nạp (không cộng tiền). */
export async function adminRejectTopup(env, request, topupId) {
  const { requireAdmin } = await import('../lib/auth.js');
  const { ok, ApiError: AE } = await import('../lib/http.js');
  const admin = await requireAdmin(env, request);
  const body = await readJson(request).catch(() => ({}));

  const t = await env.DB.prepare('SELECT * FROM topups WHERE id = ?').bind(topupId).first();
  if (!t) throw new AE(404, 'Lệnh nạp không tồn tại', 'NOT_FOUND');
  if (t.status === 'paid') throw new AE(409, 'Không thể huỷ lệnh đã thanh toán', 'BAD_STATE');

  await env.DB.prepare("UPDATE topups SET status='cancelled' WHERE id = ?").bind(topupId).run();
  await audit(env, admin.id, 'topup.reject', topupId,
    { note: str(body.note, 'note', { required: false, max: 300 }) || '' });
  return ok({ id: topupId });
}

/** Admin: điều chỉnh số dư thủ công. */
export async function adminAdjustBalance(env, request) {
  const admin = await requireAdmin(env, request);
  const body = await readJson(request);
  const userId = str(body.userId, 'userId', { max: 64 });
  const amount = int(body.amount, 'amount', { min: -1_000_000_000, max: 1_000_000_000 });
  const reason = str(body.reason, 'reason', { min: 2, max: 300 });
  if (amount === 0) throw new ApiError(400, 'Số tiền điều chỉnh phải khác 0', 'VALIDATION');

  const u = await env.DB.prepare('SELECT id, balance FROM users WHERE id = ?').bind(userId).first();
  if (!u) throw new ApiError(404, 'Người dùng không tồn tại', 'NOT_FOUND');

  const now = Date.now();
  // Atomic: tránh 2 request đồng thời cùng pass kiểm tra rồi làm số dư âm
  const up = amount < 0
    ? await env.DB.prepare(
        'UPDATE users SET balance = balance + ?, updated_at = ? WHERE id = ? AND balance + ? >= 0'
      ).bind(amount, now, userId, amount).run()
    : await env.DB.prepare(
        'UPDATE users SET balance = balance + ?, updated_at = ? WHERE id = ?'
      ).bind(amount, now, userId).run();

  if (!up.meta || up.meta.changes !== 1) {
    throw new ApiError(400, 'Số dư không đủ để trừ hoặc giao dịch đồng thời', 'CONFLICT');
  }
  const bal = await env.DB.prepare('SELECT balance FROM users WHERE id = ?').bind(userId).first();
  await env.DB.prepare(
    `INSERT INTO wallet_transactions (id, user_id, type, amount, balance_after, status, description, created_at)
     VALUES (?,?,?,?,?,'success',?,?)`
  ).bind(uuid(), userId, amount > 0 ? 'admin_credit' : 'admin_debit', amount, bal.balance,
    reason + (admin.email ? ` (bởi ${admin.email})` : ''), now).run();

  await audit(env, admin.id, 'wallet.adjust', userId, { amount, reason });
  return ok({ balance: bal.balance });
}
