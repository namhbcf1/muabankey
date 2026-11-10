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

/* ============================================================
   PAYOS WEBHOOK
   ============================================================ */

/**
 * Tính HMAC-SHA256 theo chuẩn payOS.
 *
 * Thuật toán (theo docs payOS):
 *   1. Sắp xếp key theo alphabet
 *   2. value = null/undefined -> ""
 *   3. value là array -> ksort từng phần tử rồi JSON.stringify
 *   4. Nối thành "key1=value1&key2=value2..."
 *   5. HMAC-SHA256(chuỗi, checksumKey) -> hex
 */
async function payosSignature(data, checksumKey) {
  const keys = Object.keys(data).sort();
  const parts = [];
  for (const k of keys) {
    let v = data[k];
    if (v === null || v === undefined || v === 'undefined' || v === 'null') {
      v = '';
    } else if (Array.isArray(v)) {
      v = JSON.stringify(v.map((el) => {
        if (el && typeof el === 'object' && !Array.isArray(el)) {
          const s = {};
          for (const kk of Object.keys(el).sort()) s[kk] = el[kk];
          return s;
        }
        return el;
      }));
    } else if (typeof v === 'object') {
      const s = {};
      for (const kk of Object.keys(v).sort()) s[kk] = v[kk];
      v = JSON.stringify(s);
    }
    parts.push(`${k}=${v}`);
  }
  const payload = parts.join('&');

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(checksumKey),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Đọc checksum key: ưu tiên Worker secret, sau đó tới settings. */
async function payosChecksumKey(env) {
  if (env.PAYOS_CHECKSUM_KEY) return env.PAYOS_CHECKSUM_KEY;
  try {
    const row = await env.DB.prepare(
      "SELECT value FROM settings WHERE key = 'payos_checksum_key'"
    ).first();
    return row?.value || '';
  } catch {
    return '';
  }
}

/**
 * POST /api/webhooks/payos
 * Nhận thông báo thanh toán từ payOS.
 *
 * payOS gửi:
 *   { code, desc, success, data: {...}, signature }
 * Signature tính trên `data`, không phải object ngoài.
 */
export async function payosWebhook(env, request) {
  const checksumKey = await payosChecksumKey(env);
  if (!checksumKey) {
    throw new ApiError(503, 'payOS chưa được cấu hình (thiếu checksum key)', 'NOT_CONFIGURED');
  }

  const body = await readJson(request);
  if (!body || typeof body !== 'object') {
    throw new ApiError(400, 'Body không hợp lệ', 'VALIDATION');
  }

  const data = body.data;
  const signature = String(body.signature || '');

  // ---- 1. Xác thực chữ ký ----
  if (!data || !signature) {
    throw new ApiError(400, 'Thiếu data hoặc signature', 'VALIDATION');
  }
  const expected = await payosSignature(data, checksumKey);
  const { timingSafeEqual } = await import('../lib/crypto.js');
  if (!timingSafeEqual(expected, signature)) {
    await audit(env, null, 'payos.invalid_signature', null, {
      orderCode: data.orderCode, ip: clientIp(request),
    });
    throw new ApiError(401, 'Chữ ký webhook không hợp lệ', 'UNAUTHORIZED');
  }

  // ---- 2. Kiểm tra trạng thái giao dịch ----
  // code "00" = thành công. Nếu khác -> ghi nhận nhưng không cộng tiền.
  const txCode = String(data.code || body.code || '');
  if (txCode !== '00') {
    return ok({ matched: false, reason: 'NOT_SUCCESS', code: txCode, desc: data.desc || body.desc });
  }

  const amountIn = Number(data.amount || 0);
  const ref = String(data.reference || data.paymentLinkId || `PAYOS-${data.orderCode}`);
  const content = String(data.description || '');

  if (!amountIn) return ok({ matched: false, reason: 'NO_AMOUNT' });

  // ---- 3. Khớp với topup ----
  // Ưu tiên mã NAP trong nội dung CK (QR tĩnh).
  // Nếu không có, thử khớp theo orderCode (payment link động).
  let topup = null;

  const m = content.toUpperCase().match(/NAP([A-Z0-9]{5})/);
  if (m) {
    topup = await env.DB.prepare('SELECT * FROM topups WHERE code = ? LIMIT 1')
      .bind(m[1]).first();
  }

  if (!topup && data.orderCode) {
    // Khớp theo payment link động: orderCode được lưu vào txn_ref khi tạo link
    topup = await env.DB.prepare(
      'SELECT * FROM topups WHERE txn_ref = ? LIMIT 1'
    ).bind(String(data.orderCode)).first();
  }

  if (!topup) {
    // Đối soát: ghi lại để admin xem, không chặn webhook (payOS sẽ retry)
    await audit(env, null, 'payos.unmatched', null, {
      orderCode: data.orderCode, amount: amountIn, content, ref,
    });
    return ok({ matched: false, reason: 'TOPUP_NOT_FOUND', content });
  }

  if (topup.status === 'paid') {
    return ok({ matched: true, duplicated: true, reason: 'ALREADY_PAID', code: topup.code });
  }

  const now = Date.now();

  // ---- 4. Cộng tiền ----
  if (amountIn < topup.amount) {
    // Chuyển thiếu -> cộng phần đã nhận
    const credited = Math.floor(amountIn);
    const claim = await env.DB.prepare(
      "UPDATE topups SET status='partial', txn_ref = ?, provider='payos' WHERE id = ? AND status != 'paid'"
    ).bind(ref, topup.id).run();
    if (!claim.meta || claim.meta.changes !== 1) {
      return ok({ matched: true, duplicated: true, reason: 'RACE_ALREADY_PAID' });
    }

    await env.DB.prepare('UPDATE users SET balance = balance + ?, updated_at = ? WHERE id = ?')
      .bind(credited, now, topup.user_id).run();
    const balP = await env.DB.prepare('SELECT balance FROM users WHERE id = ?')
      .bind(topup.user_id).first();
    await env.DB.prepare(
      `INSERT INTO wallet_transactions (id, user_id, type, amount, balance_after, status, reference, description, created_at)
       VALUES (?,?,'topup',?,?,'success',?,?,?)`
    ).bind(uuid(), topup.user_id, credited, balP.balance, ref,
      `Nạp một phần ${credited.toLocaleString('vi-VN')}đ / ${topup.amount.toLocaleString('vi-VN')}đ (${topup.code})`, now).run();
    await audit(env, null, 'topup.partial', topup.id, { expected: topup.amount, received: amountIn, via: 'payos' });
    // Thông báo Telegram (không chặn luồng nếu lỗi)
  try {
    const { notifyTopup } = await import('../lib/telegram.js');
    const u = await env.DB.prepare('SELECT email, full_name, balance FROM users WHERE id = ?')
      .bind(topup.user_id).first();
    await notifyTopup(env, {
      topup, email: u?.email, customer: u?.full_name,
      received: amountIn, via: 'payos', ref, balanceBefore: u?.balance, matched: true,
    });
  } catch (e) { console.error('tg notify:', e && e.message); }

    return ok({
      matched: true, reason: 'PARTIAL', expected: topup.amount,
      received: amountIn, credited, balance: balP.balance,
    });
  }

  const credited = topup.amount;
  const excess = Math.floor(amountIn) - topup.amount;

  const claim = await env.DB.prepare(
    "UPDATE topups SET status='paid', txn_ref = ?, paid_at = ?, provider='payos' WHERE id = ? AND status != 'paid'"
  ).bind(ref, now, topup.id).run();
  if (!claim.meta || claim.meta.changes !== 1) {
    return ok({ matched: true, duplicated: true, reason: 'RACE_ALREADY_PAID' });
  }

  await env.DB.prepare('UPDATE users SET balance = balance + ?, updated_at = ? WHERE id = ?')
    .bind(credited, now, topup.user_id).run();
  const bal = await env.DB.prepare('SELECT balance FROM users WHERE id = ?')
    .bind(topup.user_id).first();
  await env.DB.prepare(
    `INSERT INTO wallet_transactions (id, user_id, type, amount, balance_after, status, reference, description, created_at)
     VALUES (?,?,'topup',?,?,'success',?,?,?)`
  ).bind(uuid(), topup.user_id, credited, bal.balance, ref,
    `Nạp tiền qua payOS (${topup.code})`, now).run();

  await audit(env, null, 'topup.paid', topup.id, {
    amount: credited, ref, excess, via: 'payos', orderCode: data.orderCode,
  });

  // Thông báo Telegram (không chặn luồng nếu lỗi)
  try {
    const { notifyTopup } = await import('../lib/telegram.js');
    const u = await env.DB.prepare('SELECT email, full_name, balance FROM users WHERE id = ?')
      .bind(topup.user_id).first();
    await notifyTopup(env, {
      topup, email: u?.email, customer: u?.full_name,
      received: amountIn, via: 'payos', ref, balanceBefore: u?.balance, matched: true,
    });
  } catch (e) { console.error('tg notify:', e && e.message); }

  return ok({
    matched: true, credited, balance: bal.balance,
    ...(excess > 0 ? { reason: 'OVERPAID', excess, note: 'Phần dư đã ghi nhận để đối soát' } : {}),
  });
}

/** GET /api/webhooks/health — kiểm tra cấu hình webhook (không lộ secret). */
export async function webhookHealth(env) {
  const payosKey = await payosChecksumKey(env);
  const { tgConfig } = await import('../lib/telegram.js');
  const tg = await tgConfig(env).catch(() => ({ configured: false, source: 'none' }));
  return ok({
    sepay: {
      configured: !!env.WEBHOOK_SECRET,
      source: env.WEBHOOK_SECRET ? 'secret' : 'none',
      url: '/api/webhooks/sepay',
    },
    payos: {
      configured: !!payosKey,
      source: env.PAYOS_CHECKSUM_KEY ? 'secret' : (payosKey ? 'settings' : 'none'),
      url: '/api/webhooks/payos',
    },
    telegram: {
      configured: !!tg.configured,
      source: tg.source || 'none',
      webhookSecretSet: !!env.TG_WEBHOOK_SECRET,
      url: '/api/telegram/webhook',
    },
  });
}

/**
 * POST /api/admin/settings/payos — lưu checksum key vào settings.
 * (Khuyến nghị dùng `wrangler secret put PAYOS_CHECKSUM_KEY` để bảo mật hơn.)
 */
export async function adminSetPayosKey(env, request) {
  const admin = await requireAdmin(env, request);
  const body = await readJson(request);
  const key = String(body.checksumKey || '').trim();

  if (!key) {
    await env.DB.prepare("DELETE FROM settings WHERE key = 'payos_checksum_key'").run();
    await audit(env, admin.id, 'payos.key_cleared', null, {});
    return ok({ cleared: true });
  }
  if (key.length < 16) {
    throw new ApiError(400, 'Checksum key quá ngắn', 'VALIDATION');
  }

  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES ('payos_checksum_key', ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).bind(key, now).run();

  await audit(env, admin.id, 'payos.key_set', null, { len: key.length });
  return ok({ saved: true, source: 'settings' });
}

/* ============================================================
   TELEGRAM: duyệt nạp tiền bằng nút bấm
   ============================================================ */

/**
 * POST /api/telegram/webhook
 * Nhận callback từ Telegram khi admin bấm nút.
 *
 * Xử lý mọi loại nút: nạp tiền, đơn hàng, license, điều hướng.
 * Bảo mật: header `X-Telegram-Bot-Api-Secret-Token` + kiểm tra chat_id admin.
 */
export async function telegramWebhook(env, request) {
  const secret = env.TG_WEBHOOK_SECRET || '';
  const got = request.headers.get('x-telegram-bot-api-secret-token') || '';

  const { timingSafeEqual } = await import('../lib/crypto.js');
  if (!secret || !timingSafeEqual(got, secret)) {
    throw new ApiError(401, 'Sai secret token', 'UNAUTHORIZED');
  }

  const body = await readJson(request).catch(() => null);
  if (!body) return ok({ ignored: 'no_body' });

  const { tgAnswerCallback, tgCall } = await import('../lib/telegram.js');
  const { handleCallback } = await import('../lib/telegram-actions.js');

  // ---- Callback từ nút bấm ----
  const cq = body.callback_query;
  if (cq) {
    // Chỉ admin được bấm
    const allowed = String(env.TG_CHAT_ID || '').trim();
    const fromId = String(cq.from?.id || '');
    const msgChat = String(cq.message?.chat?.id || '');
    if (allowed && fromId !== allowed && msgChat !== allowed) {
      await tgAnswerCallback(env, cq.id, 'Bạn không có quyền', true);
      return ok({ denied: 'not_admin' });
    }

    const r = await handleCallback(env, cq, {
      DB: env.DB,
      uuid,
      audit,
      siteUrl: new URL(request.url).origin,
      deliverOrder: async (o) => {
        // Gọi thẳng DB thay vì qua route (route cần Request + session admin).
        // Điều kiện giống adminDeliverManual: chỉ giao đơn đã thanh toán.
        try {
          if (!['paid', 'delivered'].includes(o.status)) {
            return { ok: false, error: `Đơn đang "${o.status}", chỉ giao đơn đã thanh toán` };
          }
          const claim = await env.DB.prepare(
            "UPDATE orders SET status='delivered', delivered_at = ? WHERE id = ? AND status != 'delivered'"
          ).bind(Date.now(), o.id).run();
          if (!claim.meta || claim.meta.changes !== 1) {
            return { ok: false, error: 'Đơn đã được giao trước đó' };
          }
          return { ok: true };
        } catch (e) {
          return { ok: false, error: e.message };
        }
      },
      refundOrder: async (o) => {
        // Hoàn tiền: cộng lại ví + thu hồi license/key, giống adminRefund.
        try {
          if (!['paid', 'delivered'].includes(o.status)) {
            return { ok: false, error: `Đơn đang "${o.status}", không hoàn được` };
          }

          const claim = await env.DB.prepare(
            "UPDATE orders SET status='refunding' WHERE id = ? AND status IN ('paid','delivered')"
          ).bind(o.id).run();
          if (!claim.meta || claim.meta.changes !== 1) {
            return { ok: false, error: 'Đơn đã được xử lý bởi người khác' };
          }

          const now = Date.now();
          const amount = o.total;

          // Cộng tiền lại vào ví
          await env.DB.prepare('UPDATE users SET balance = balance + ?, updated_at = ? WHERE id = ?')
            .bind(amount, now, o.user_id).run();
          const bal = await env.DB.prepare('SELECT balance FROM users WHERE id = ?')
            .bind(o.user_id).first();

          await env.DB.prepare(
            `INSERT INTO wallet_transactions (id, user_id, type, amount, balance_after, status, reference, description, created_at)
             VALUES (?,?,'refund',?,?,'success',?,?,?)`
          ).bind(uuid(), o.user_id, amount, bal.balance, o.code,
            `Hoàn tiền đơn ${o.code} (qua Telegram)`, now).run();

          // Thu hồi license đã giao cho đơn này
          try {
            const lics = await env.DB.prepare(
              `SELECT license_key FROM license_issues WHERE order_id = ?`
            ).bind(o.id).all();
            for (const li of lics.results || []) {
              await env.DB.prepare('UPDATE licenses SET revoked = 1 WHERE key = ?')
                .bind(li.license_key).run();
            }
          } catch { /* bảng có thể không có order_id */ }

          // Thu hồi key đã giao
          try {
            await env.DB.prepare(
              "UPDATE product_keys SET status='available', order_id=NULL, delivered_at=NULL WHERE order_id = ?"
            ).bind(o.id).run();
          } catch { /* ignore */ }

          await env.DB.prepare("UPDATE orders SET status='refunded' WHERE id = ?")
            .bind(o.id).run();

          return { ok: true, refunded: amount };
        } catch (e) {
          return { ok: false, error: e.message };
        }
      },
    });

    return ok(r);
  }

  // ---- Lệnh text: /start hoặc /id để lấy chat_id ----
  const msg = body.message;
  if (msg) {
    const text = String(msg.text || '');
    if (text.startsWith('/start') || text.startsWith('/id')) {
      await tgCall(env, 'sendMessage', {
        chat_id: msg.chat.id,
        text: `Chat ID của bạn: \`${msg.chat.id}\`\n\nDán số này vào Cài đặt → Telegram Chat ID.`,
        parse_mode: 'MarkdownV2',
      });
      return ok({ sentChatId: true });
    }

    // /help — danh sách lệnh
    if (text.startsWith('/help')) {
      await tgCall(env, 'sendMessage', {
        chat_id: msg.chat.id,
        text: [
          '🤖 *MuaBanKey Bot*',
          '',
          'Bot tự động gửi thông báo khi:',
          '• Có tiền vào → nút Duyệt / Từ chối',
          '• Đơn cần giao tay → nút Giao / Hoàn tiền',
          '• Sắp hết hàng → nút Nhập key',
          '• License sắp hết hạn → nút +30 ngày / Thu hồi',
          '• Báo cáo doanh thu mỗi ngày',
          '',
          '/id — lấy chat ID',
          '/help — trợ giúp',
        ].join('\n'),
        parse_mode: 'MarkdownV2',
      });
      return ok({ sentHelp: true });
    }
  }

  return ok({ ignored: true });
}

export async function adminTelegramTest(env, request) {
  const admin = await requireAdmin(env, request);
  const { tgTest } = await import('../lib/telegram.js');
  const r = await tgTest(env);
  await audit(env, admin.id, 'telegram.test', null, { ok: r.ok, error: r.error || null });
  if (!r.ok) {
    throw new ApiError(400,
      r.error === 'not_configured'
        ? 'Chưa cấu hình bot token hoặc chat ID'
        : `Telegram trả lỗi: ${r.error}`,
      'TELEGRAM_ERROR');
  }
  return ok({ sent: true, config: r.config });
}

export async function adminTelegramStatus(env, request) {
  await requireAdmin(env, request);
  const { tgConfig } = await import('../lib/telegram.js');
  const cfg = await tgConfig(env);
  return ok({
    configured: cfg.configured,
    source: cfg.source,
    webhookSecretSet: !!env.TG_WEBHOOK_SECRET,
    botTokenHint: cfg.token ? cfg.token.slice(0, 8) + '…' : null,
    chatId: cfg.chatId ? String(cfg.chatId).slice(0, 4) + '…' : null,
  });
}

/** POST /api/admin/telegram/config — lưu bot token + chat id vào settings. */
export async function adminTelegramConfig(env, request) {
  const admin = await requireAdmin(env, request);
  const body = await readJson(request);
  const token = String(body.botToken || '').trim();
  const chatId = String(body.chatId || '').trim();

  const now = Date.now();
  const stmts = [];

  if (token === '' && chatId === '') {
    await env.DB.prepare(
      "DELETE FROM settings WHERE key IN ('telegram_bot_token','telegram_chat_id')"
    ).run();
    await audit(env, admin.id, 'telegram.config_cleared', null, {});
    return ok({ cleared: true });
  }

  if (token) {
    if (!/^\d{6,}:[A-Za-z0-9_-]{20,}$/.test(token)) {
      throw new ApiError(400, 'Bot token không đúng định dạng (số:chuỗi)', 'VALIDATION');
    }
    stmts.push(env.DB.prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES ('telegram_bot_token', ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    ).bind(token, now));
  }
  if (chatId) {
    if (!/^-?\d{5,20}$/.test(chatId)) {
      throw new ApiError(400, 'Chat ID phải là số (có thể âm với nhóm)', 'VALIDATION');
    }
    stmts.push(env.DB.prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES ('telegram_chat_id', ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    ).bind(chatId, now));
  }

  if (stmts.length) await env.DB.batch(stmts);
  await audit(env, admin.id, 'telegram.config_set', null, {
    hasToken: !!token, hasChatId: !!chatId,
  });
  return ok({ saved: true, hasToken: !!token, hasChatId: !!chatId });
}

/**
 * POST /api/webhooks/sepay
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
    // Guard: chỉ cộng nếu thực sự chuyển được sang 'partial'.
    // Thiếu guard -> webhook retry hoặc 2 webhook song song cộng tiền nhiều lần.
    const claimPartial = await env.DB.prepare(
      "UPDATE topups SET status='partial', txn_ref = ? WHERE id = ? AND status != 'paid'"
    ).bind(ref, topup.id).run();
    if (!claimPartial.meta || claimPartial.meta.changes !== 1) {
      return ok({ matched: true, duplicated: true, reason: 'RACE_ALREADY_PAID' });
    }
    await env.DB.prepare('UPDATE users SET balance = balance + ?, updated_at = ? WHERE id = ?')
      .bind(credited, now, topup.user_id).run();
    const balP = await env.DB.prepare('SELECT balance FROM users WHERE id = ?').bind(topup.user_id).first();
    await env.DB.prepare(
      `INSERT INTO wallet_transactions (id, user_id, type, amount, balance_after, status, reference, description, created_at)
       VALUES (?,?,'topup',?,?,'success',?,?,?)`
    ).bind(uuid(), topup.user_id, credited, balP.balance, ref || code,
      `Nạp một phần ${credited.toLocaleString('vi-VN')}đ / ${topup.amount.toLocaleString('vi-VN')}đ (${code})`, now).run();
    await audit(env, null, 'topup.partial', topup.id, { expected: topup.amount, received: amountIn });
    // Thông báo Telegram (không chặn luồng nếu lỗi)
  try {
    const { notifyTopup } = await import('../lib/telegram.js');
    const u = await env.DB.prepare('SELECT email, full_name, balance FROM users WHERE id = ?')
      .bind(topup.user_id).first();
    await notifyTopup(env, {
      topup, email: u?.email, customer: u?.full_name,
      received: amountIn, via: 'sepay', ref, balanceBefore: u?.balance, matched: true,
    });
  } catch (e) { console.error('tg notify:', e && e.message); }

    return ok({
      matched: true, reason: 'PARTIAL', expected: topup.amount,
      received: amountIn, credited, balance: balP.balance,
    });
  }

  // Chuyển thừa: cộng đúng số đã đặt, phần dư ghi nhận để đối soát
  const credited = topup.amount;
  const excess = Math.floor(amountIn) - topup.amount;

  const claimPaid = await env.DB.prepare(
    "UPDATE topups SET status='paid', txn_ref = ?, paid_at = ? WHERE id = ? AND status != 'paid'"
  ).bind(ref, now, topup.id).run();
  if (!claimPaid.meta || claimPaid.meta.changes !== 1) {
    return ok({ matched: true, duplicated: true, reason: 'RACE_ALREADY_PAID' });
  }
  await env.DB.prepare('UPDATE users SET balance = balance + ?, updated_at = ? WHERE id = ?')
    .bind(credited, now, topup.user_id).run();

  const bal = await env.DB.prepare('SELECT balance FROM users WHERE id = ?').bind(topup.user_id).first();
  await env.DB.prepare(
    `INSERT INTO wallet_transactions (id, user_id, type, amount, balance_after, status, reference, description, created_at)
     VALUES (?,?,'topup',?,?,'success',?,?,?)`
  ).bind(uuid(), topup.user_id, credited, bal.balance, ref || code, `Nạp tiền qua chuyển khoản (${code})`, now).run();

  await audit(env, null, 'topup.paid', topup.id, { amount: credited, ref, excess: excess || 0 });
  // Thông báo Telegram (không chặn luồng nếu lỗi)
  try {
    const { notifyTopup } = await import('../lib/telegram.js');
    const u = await env.DB.prepare('SELECT email, full_name, balance FROM users WHERE id = ?')
      .bind(topup.user_id).first();
    await notifyTopup(env, {
      topup, email: u?.email, customer: u?.full_name,
      received: amountIn, via: 'sepay', ref, balanceBefore: u?.balance, matched: true,
    });
  } catch (e) { console.error('tg notify:', e && e.message); }

  return ok({
    matched: true, credited, balance: bal.balance,
    ...(excess > 0 ? { reason: 'OVERPAID', excess, note: 'Phần dư đã ghi nhận để đối soát' } : {}),
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
    await env.DB.prepare("UPDATE topups SET status='partial', txn_ref = ? WHERE id = ? AND status != 'paid'")
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

  await env.DB.prepare("UPDATE topups SET status='paid', txn_ref = ?, paid_at = ? WHERE id = ? AND status != 'paid'")
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

  // ===== CHẶN DUYỆT LẠI =====
  // 'partial' = webhook đã cộng PHẦN ĐÃ NHẬN rồi. Duyệt tiếp sẽ cộng ĐỦ
  // -> cộng đôi. Đã xảy ra thật: topup JPEM7 cộng 150k cho lệnh 100k.
  if (t.status === 'paid') {
    throw new AE(409, 'Lệnh nạp đã được duyệt rồi', 'BAD_STATE');
  }
  if (t.status === 'partial') {
    // Tính phần còn thiếu thay vì cộng đủ lần nữa
    const { results: paidTx } = await env.DB.prepare(
      `SELECT COALESCE(SUM(amount),0) AS da_cong FROM wallet_transactions
       WHERE reference = ? AND type = 'topup' AND status = 'success'`
    ).bind(t.code).all();
    const daCong = paidTx?.[0]?.da_cong || 0;
    const conThieu = Math.max(0, t.amount - daCong);
    if (conThieu === 0) {
      throw new AE(409,
        `Lệnh này đã nhận đủ ${t.amount.toLocaleString('vi-VN')}đ trước đó.`,
        'BAD_STATE');
    }
    // Cho duyệt phần còn thiếu
    const notePartial = str(body.note, 'note', { required: false, max: 300 })
      || `Duyệt phần còn thiếu (đã nhận ${daCong.toLocaleString('vi-VN')}đ)`;
    const creditedPartial = body.amount !== undefined
      ? Math.min(int(body.amount, 'amount', { min: 1000, max: 500_000_000 }), conThieu)
      : conThieu;

    const claimP = await env.DB.prepare(
      `UPDATE topups SET status='paid', paid_at = ?, txn_ref = COALESCE(txn_ref, ?)
       WHERE id = ? AND status = 'partial'`
    ).bind(Date.now(), 'ADMIN-PARTIAL-' + admin.id.slice(0, 6), topupId).run();
    if (!claimP.meta || claimP.meta.changes !== 1) {
      throw new AE(409, 'Lệnh đã được duyệt bởi người khác', 'BAD_STATE');
    }

    const nowP = Date.now();
    await env.DB.prepare('UPDATE users SET balance = balance + ?, updated_at = ? WHERE id = ?')
      .bind(creditedPartial, nowP, t.user_id).run();
    const balP = await env.DB.prepare('SELECT balance FROM users WHERE id = ?').bind(t.user_id).first();
    await env.DB.prepare(
      `INSERT INTO wallet_transactions (id, user_id, type, amount, balance_after, status, reference, description, created_at)
       VALUES (?,?,'topup',?,?,'success',?,?,?)`
    ).bind(uuid(), t.user_id, creditedPartial, balP.balance, t.code,
      `Nạp phần còn thiếu (${t.code}) — ${notePartial}`, nowP).run();

    await audit(env, admin.id, 'topup.approve_partial', topupId,
      { credited: creditedPartial, daCong, note: notePartial });
    return ok({ id: topupId, credited: creditedPartial, balance: balP.balance,
      was_partial: true, already_received: daCong });
  }

  // Số tiền thực nhận: cho admin nhập nếu khách chuyển khác
  let credited = t.amount;
  if (body.amount !== undefined) {
    credited = int(body.amount, 'amount', { min: 1000, max: 500_000_000 });
    // CẢNH BÁO: nhập lệch quá nhiều so với số khách đặt là dấu hiệu nhầm.
    // Đã xảy ra thật: topup 20.000đ bị duyệt thành 500.000.000đ.
    const lech = credited - t.amount;
    if (Math.abs(lech) > t.amount * 10 && Math.abs(lech) > 1_000_000) {
      throw new AE(400,
        `Số tiền duyệt (${credited.toLocaleString('vi-VN')}đ) lệch quá nhiều so với `
        + `lệnh nạp (${t.amount.toLocaleString('vi-VN')}đ). `
        + `Kiểm tra lại app ngân hàng trước khi duyệt.`,
        'AMOUNT_MISMATCH');
    }
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

/* ============================================================
   ADMIN: QUẢN LÝ NẠP TIỀN
   Cần thiết vì webhook ngân hàng có thể chưa nối / bị lỗi /
   khách chuyển sai nội dung. Không có UI này thì admin phải
   sửa DB tay -> dễ sai sổ cái.
   ============================================================ */

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
