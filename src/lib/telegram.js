/**
 * Thông báo Telegram cho admin.
 *
 * Mục đích: có tiền vào là biết ngay trên điện thoại, kèm nút bấm
 * duyệt/từ chối — không cần mở web.
 *
 * Cấu hình (theo thứ tự ưu tiên):
 *   1. env.TG_BOT_TOKEN + env.TG_CHAT_ID  (wrangler secret — khuyến nghị)
 *   2. settings: telegram_bot_token + telegram_chat_id
 *
 * Bảo mật: KHÔNG bao giờ gửi bot token ra client. Chỉ dùng server-side.
 */

const TG_API = 'https://api.telegram.org';

/** Đọc cấu hình Telegram. */
async function tgConfig(env) {
  let token = env.TG_BOT_TOKEN || '';
  let chatId = env.TG_CHAT_ID || '';
  let source = token && chatId ? 'secret' : '';

  if (!token || !chatId) {
    try {
      const { results } = await env.DB.prepare(
        "SELECT key, value FROM settings WHERE key IN ('telegram_bot_token','telegram_chat_id')"
      ).all();
      const m = {};
      for (const r of results || []) m[r.key] = r.value;
      if (!token && m.telegram_bot_token) { token = m.telegram_bot_token; source = 'settings'; }
      if (!chatId && m.telegram_chat_id) { chatId = m.telegram_chat_id; source = 'settings'; }
    } catch { /* ignore */ }
  }

  return { token, chatId, configured: !!(token && chatId), source: source || 'none' };
}

/** Gọi Telegram Bot API. Trả {ok, error}. Không bao giờ throw. */
async function tgCall(env, method, payload) {
  const cfg = await tgConfig(env);
  if (!cfg.configured) return { ok: false, error: 'not_configured' };

  try {
    // Re-check source: nếu token từ settings, đọc lại (không cache trong payload)
    const url = `${TG_API}/bot${cfg.token}/${method}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      return { ok: false, error: data.description || `http_${res.status}`, raw: data };
    }
    return { ok: true, result: data.result };
  } catch (e) {
    return { ok: false, error: e.message || 'network' };
  }
}

/**
 * Escape ký tự đặc biệt cho MarkdownV2.
 *
 * Danh sách chính thức (Telegram docs):
 *   _ * [ ] ( ) ~ ` > # + - = | { } . !
 * và dấu gạch chéo ngược \ phải escape TRƯỚC TIÊN, nếu không các
 * dấu \ vừa thêm sẽ bị escape lần 2.
 */
function mdEsc(s) {
  return String(s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
}

/** Định dạng tiền VN. */
function vnd(n) {
  return Number(n || 0).toLocaleString('vi-VN') + 'đ';
}

/**
 * Bắn thông báo nạp tiền kèm nút Duyệt / Từ chối.
 *
 * @param {object} opts
 *   - topup: {id, code, amount, user_id}
 *   - email, customer: thông tin khách
 *   - received: số tiền thực nhận từ webhook (nếu có)
 *   - via: 'sepay' | 'payos' | 'manual'
 *   - ref: mã giao dịch ngân hàng
 *   - balanceBefore: số dư hiện tại của khách
 */
export async function notifyTopup(env, opts) {
  const { topup, email, customer, received, via, ref, balanceBefore, matched } = opts;

  const cfg = await tgConfig(env);
  if (!cfg.configured) return { ok: false, error: 'not_configured' };

  const lines = [
    matched ? '💰 *TIỀN ĐÃ VÀO — CẦN DUYỆT*' : '💳 *LỆNH NẠP MỚI*',
    '',
    `Khách: ${mdEsc(customer || email || 'không rõ')}`,
    `Mã nạp: *NAP${mdEsc(topup.code)}*`,
    `Số tiền: *${mdEsc(vnd(topup.amount))}*`,
  ];

  if (received !== undefined && received !== topup.amount) {
    lines.push(`Thực nhận: *${mdEsc(vnd(received))}*`);
    if (received < topup.amount) {
      lines.push(`⚠️ _Chuyển thiếu ${mdEsc(vnd(topup.amount - received))}_`);
    } else {
      lines.push(`ℹ️ _Thừa ${mdEsc(vnd(received - topup.amount))}_`);
    }
  }

  if (via) lines.push(`Nguồn: ${mdEsc(via === 'payos' ? 'payOS' : via === 'sepay' ? 'SePay' : 'tay')}`);
  if (ref) lines.push(`Mã GD: \`${mdEsc(String(ref).slice(0, 40))}\``);
  if (balanceBefore !== undefined) {
    lines.push(`Số dư hiện tại: ${mdEsc(vnd(balanceBefore))}`);
  }
  lines.push('');
  lines.push(matched
    ? '_Bấm Duyệt để cộng tiền vào ví_'
    : '_Khách chưa chuyển khoản — bấm Từ chối nếu cần_');

  const text = lines.join('\n');

  // Inline keyboard: 2 nút
  const keyboard = {
    inline_keyboard: [[
      { text: `✅ Duyệt ${vnd(topup.amount)}`, callback_data: `tp:ok:${topup.id}` },
      { text: '❌ Từ chối', callback_data: `tp:no:${topup.id}` },
    ]],
  };

  const r = await tgCall(env, 'sendMessage', {
    chat_id: cfg.chatId,
    text,
    parse_mode: 'MarkdownV2',
    reply_markup: keyboard,
    disable_web_page_preview: true,
  });

  // Đánh dấu đã thông báo (tránh spam)
  if (r.ok) {
    try {
      await env.DB.prepare(
        "UPDATE topups SET notified_at = ? WHERE id = ?"
      ).bind(Date.now(), topup.id).run();
      await env.DB.prepare(
        "UPDATE topups SET tg_message_id = ? WHERE id = ?"
      ).bind(r.result?.message_id || 0, topup.id).run();
    } catch { /* cột có thể chưa có — bỏ qua */ }
  }

  return r;
}

/**
 * Thông báo đơn hàng mới (mua trực tiếp, không qua ví).
 */
export async function notifyOrder(env, opts) {
  const { order, email, items } = opts;
  const cfg = await tgConfig(env);
  if (!cfg.configured) return { ok: false, error: 'not_configured' };

  const lines = [
    '🛒 *ĐƠN HÀNG MỚI*',
    '',
    `Mã đơn: \`${mdEsc(order.code)}\``,
    `Khách: ${mdEsc(email || 'không rõ')}`,
    `Tổng: *${mdEsc(vnd(order.total))}*`,
  ];
  if (items?.length) {
    lines.push('');
    for (const it of items.slice(0, 8)) {
      lines.push(`• ${mdEsc(it.name)} × ${it.quantity}`);
    }
  }
  lines.push('');
  lines.push('_Đơn đã thanh toán bằng ví — key giao tự động_');

  return tgCall(env, 'sendMessage', {
    chat_id: cfg.chatId,
    text: lines.join('\n'),
    parse_mode: 'MarkdownV2',
    disable_web_page_preview: true,
  });
}

/**
 * Heartbeat: kiểm tra bot còn sống + gửi tin thử.
 * Dùng khi admin bấm "Gửi tin thử" trong Cài đặt.
 */
export async function tgTest(env) {
  const cfg = await tgConfig(env);
  if (!cfg.configured) {
    return { ok: false, error: 'not_configured', config: cfg };
  }

  // CẨN THẬN: mọi ký tự literal cũng phải escape trong MarkdownV2.
  // Dấu "." cuối câu, "-" trong ngày tháng, ":" trong giờ... đều reserved.
  const text = [
    '✅ *KẾT NỐI THÀNH CÔNG*',
    '',
    mdEsc('MuaBanKey đã gửi được thông báo về Telegram.'),
    '',
    `_Nguồn cấu hình: ${mdEsc(cfg.source)}_`,
    `_Thời gian: ${mdEsc(new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }))}_`,
  ].join('\n');

  const r = await tgCall(env, 'sendMessage', {
    chat_id: cfg.chatId,
    text,
    parse_mode: 'MarkdownV2',
    disable_web_page_preview: true,
  });

  return { ...r, config: { configured: cfg.configured, source: cfg.source } };
}

/**
 * Sửa tin nhắn gốc sau khi admin bấm nút (ghi kết quả vào tin).
 */
export async function tgUpdateMessage(env, chatId, messageId, text, extra = {}) {
  return tgCall(env, 'editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: 'MarkdownV2',
    disable_web_page_preview: true,
    ...extra,
  });
}

/** Trả lời callback query (bắt buộc, nếu không Telegram hiện loading mãi). */
export async function tgAnswerCallback(env, callbackQueryId, text, showAlert = false) {
  return tgCall(env, 'answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    text,
    show_alert: showAlert,
  });
}

export { tgConfig, tgCall, mdEsc, vnd };
