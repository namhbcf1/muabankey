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

/**
 * Đọc cấu hình Telegram.
 *
 * HAI KHÁI NIỆM TÁCH BIỆT — đây là điểm quan trọng nhất của file này:
 *
 *   adminChatId  : chat RIÊNG của chủ shop. CHỈ người trong chat này mới
 *                  bấm được nút Duyệt / Giao đơn / Thu hồi.
 *
 *   notifyChats  : danh sách chat NHẬN thông báo. Có thể gồm chat riêng
 *                  VÀ một/nhiều group. Group chỉ ĐỌC, không bấm được.
 *
 * VÌ SAO PHẢI TÁCH: trước đây chỉ có một giá trị `TG_CHAT_ID` dùng cho CẢ
 * hai việc. Nếu nhét group id vào đó thì tin nhắn tới group, nhưng cổng xác
 * thực lại so `from.id` (người bấm) với group id -> KHÔNG AI BẤM ĐƯỢC, kể cả
 * chủ shop. Ngược lại, nếu nới lỏng để "ai trong group cũng bấm được" thì
 * mọi thành viên group duyệt tiền được — thảm hoạ.
 *
 * Cấu hình:
 *   TG_CHAT_ID          chat riêng admin (bắt buộc, dùng để xác thực)
 *   TG_NOTIFY_CHAT_IDS  danh sách thêm, cách nhau dấu phẩy. Ví dụ:
 *                         -1001234567890          (một group)
 *                         -1001234567890,-1009... (nhiều group)
 *                       KHÔNG cần khai báo lại chat riêng — tự thêm vào.
 */
async function tgConfig(env) {
  let token = env.TG_BOT_TOKEN || '';
  let chatId = env.TG_CHAT_ID || '';
  let extraRaw = env.TG_NOTIFY_CHAT_IDS || '';
  let source = token && chatId ? 'secret' : '';

  if (!token || !chatId || !extraRaw) {
    try {
      const { results } = await env.DB.prepare(
        `SELECT key, value FROM settings
         WHERE key IN ('telegram_bot_token','telegram_chat_id','telegram_notify_chat_ids')`
      ).all();
      const m = {};
      for (const r of results || []) m[r.key] = r.value;
      if (!token && m.telegram_bot_token) { token = m.telegram_bot_token; source = 'settings'; }
      if (!chatId && m.telegram_chat_id) { chatId = m.telegram_chat_id; source = 'settings'; }
      if (!extraRaw && m.telegram_notify_chat_ids) {
        extraRaw = m.telegram_notify_chat_ids;
        source = source || 'settings';
      }
    } catch { /* ignore */ }
  }

  /*
   * Danh sách chat nhận thông báo: chat riêng LUÔN đứng đầu, sau đó các
   * chat/group khai báo thêm. Bỏ trùng, bỏ rỗng.
   *
   * Thứ tự quan trọng: chat riêng phải là phần tử [0] để tin nhắn có nút
   * bấm luôn tới tay admin trước — nếu group lỗi (bị kick, sai id) thì
   * admin vẫn nhận được.
   */
  const notifyChats = [];
  const push = (v) => {
    const s = String(v || '').trim();
    if (s && !notifyChats.includes(s)) notifyChats.push(s);
  };
  push(chatId);
  for (const part of String(extraRaw).split(',')) push(part);

  return {
    token,
    chatId,                 // chat riêng admin — dùng để XÁC THỰC người bấm
    notifyChats,            // nơi GỬI thông báo (riêng + group)
    configured: !!(token && notifyChats.length),
    source: source || 'none',
  };
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
      /*
       * LƯỚI AN TOÀN: log mọi lần gửi hỏng.
       *
       * Trước đây hàm trả {ok:false} nhưng mọi nơi gọi đều bọc
       * `try { ... } catch {}` nên lỗi bị nuốt hoàn toàn — admin không
       * nhận được thông báo mà không biết vì sao. Đã có lần Telegram từ
       * chối toàn bộ tin nhắn MarkdownV2 vì một dấu chấm không escape,
       * và không ai phát hiện cho tới khi khách phàn nàn.
       */
      console.error('[TG_FAIL]', method, data.description || `http_${res.status}`);
      return { ok: false, error: data.description || `http_${res.status}`, raw: data };
    }
    // Ghi lại lần gửi thành công: `wrangler tail` thấy được là admin biết
    // thông báo đã tới Telegram, không phải đoán.
    console.log('[TG_OK]', method, data.result?.message_id ?? '');
    return { ok: true, result: data.result };
  } catch (e) {    console.error('[TG_FAIL]', method, e.message || 'network');
    return { ok: false, error: e.message || 'network' };
  }
}

/**
 * Gửi MỘT tin tới MỌI chat nhận thông báo (chat riêng + group).
 *
 * QUY TẮC NÚT BẤM:
 *   - Chat riêng của admin: CÓ nút bấm (duyệt / giao / thu hồi).
 *   - Group: chỉ đọc. Nếu đính nút vào tin trong group, thành viên group bấm
 *     được -> ai cũng duyệt tiền được. Cổng xác thực ở wallet.js sẽ chặn,
 *     nhưng hiện nút bấm được-rồi-báo-"không có quyền" là trải nghiệm xấu và
 *     mời gọi dò thử. Nên group KHÔNG có nút.
 *
 * Trả { ok, sent: [chatId...], failed: [{chat, error}...] }.
 *
 * KHÔNG throw: một chat lỗi (bị kick khỏi group, sai id) không được làm hỏng
 * việc gửi cho các chat còn lại.
 */
async function tgBroadcast(env, text, opts = {}) {
  const {
    parse_mode = 'MarkdownV2',
    reply_markup = null,
    disable_web_page_preview = true,
    buttonsOnlyForAdmin = true,
  } = opts;

  const cfg = await tgConfig(env);
  if (!cfg.configured) {
    return { ok: false, error: 'not_configured', sent: [], failed: [] };
  }

  const sent = [];
  const failed = [];

  for (const chat of cfg.notifyChats) {
    const isAdminChat = chat === cfg.chatId;
    const payload = {
      chat_id: chat,
      text,
      parse_mode,
      disable_web_page_preview,
    };
    // Chỉ chat riêng admin mới được đính nút bấm
    if (reply_markup && (!buttonsOnlyForAdmin || isAdminChat)) {
      payload.reply_markup = reply_markup;
    }

    const r = await tgCall(env, 'sendMessage', payload);
    if (r.ok) sent.push(chat);
    else failed.push({ chat, error: r.error });
  }

  if (failed.length) {
    console.error('[TG_BROADCAST_PARTIAL]',
      'sent=' + sent.length, 'failed=' + JSON.stringify(failed));
  }

  // ok=true nếu ít nhất một chat nhận được — tránh việc group hỏng làm
  // tưởng cả thông báo hỏng trong khi admin vẫn nhận được.
  return { ok: sent.length > 0, sent, failed };
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
 * Escape cho parse_mode HTML.
 *
 * Chỉ cần 3 ký tự: & < >
 * Không giống MarkdownV2 — ở đó phải escape 18 ký tự và một dấu chấm
 * sót trong chuỗi cứng là Telegram từ chối TOÀN BỘ tin nhắn với lỗi
 * "can't parse entities". Đó chính là lỗi đã làm mọi thông báo thanh
 * toán im lặng suốt thời gian qua.
 */
function hEsc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Tên hiển thị của khách. Bỏ email nội bộ `u-<uuid>@invalid` (không có nghĩa). */
function payerName(customer, email) {
  const name = String(customer || '').trim();
  if (name) return name;
  const mail = String(email || '').trim();
  if (mail && !mail.endsWith('@invalid')) return mail;
  return 'Khách';
}

/**
 * Bắn thông báo NẠP TIỀN kèm nút Duyệt / Từ chối.
 *
 * Luồng ví là luồng CŨ (shop đã chuyển sang thanh toán theo đơn ở
 * telegram-pay.js), nhưng webhook ví vẫn còn đường gọi tới đây. Giữ nguyên
 * khuôn mới cho đồng bộ: SỐ TIỀN to nhất ở dòng đầu, tối đa 5 dòng, mã giao
 * dịch ngân hàng ở dòng cuối.
 *
 * Đã bỏ khỏi tin (đều là "chữ linh tinh" với chủ shop):
 *   "Nguồn: SePay/payOS/tay", "Số dư hiện tại" (ví đã bỏ),
 *   "Bấm Duyệt để cộng tiền vào ví" (nút bấm đã nói rồi).
 *
 * @param {object} opts
 *   - topup: {id, code, amount, user_id}
 *   - email, customer: thông tin khách
 *   - received: số tiền thực nhận từ webhook (nếu có)
 *   - ref: mã giao dịch ngân hàng
 *   - matched: tiền đã vào thật hay chỉ là lệnh nạp mới
 */
export async function notifyTopup(env, opts) {
  const { topup, email, customer, received, ref, matched } = opts;

  const cfg = await tgConfig(env);
  if (!cfg.configured) return { ok: false, error: 'not_configured' };

  const expected = Number(topup.amount) || 0;
  const got = (received === undefined || received === null)
    ? expected : Math.floor(Number(received) || 0);

  const lines = [
    `💰 <b>${hEsc(vnd(got))}</b>`,
    `${hEsc(payerName(customer, email))} · <code>NAP${hEsc(String(topup.code))}</code>`,
    matched ? 'Tiền đã vào — chờ duyệt' : 'Khách tạo lệnh nạp',
  ];

  if (matched && got !== expected) {
    const diff = Math.abs(expected - got);
    lines.push(got < expected
      ? `⚠️ Thiếu <b>${hEsc(vnd(diff))}</b> · cần ${hEsc(vnd(expected))}`
      : `⚠️ Thừa <b>${hEsc(vnd(diff))}</b> — hoàn tay`);
  }

  const refText = String(ref || '').trim();
  if (refText) lines.push(`Mã GD ${hEsc(refText)}`);

  // Inline keyboard: 2 nút
  const keyboard = {
    inline_keyboard: [[
      { text: `✅ Duyệt ${vnd(topup.amount)}`, callback_data: `tp:ok:${topup.id}` },
      { text: '❌ Từ chối', callback_data: `tp:no:${topup.id}` },
    ]],
  };

  const r = await tgBroadcast(env, lines.join('\n'), {
    parse_mode: 'HTML',
    reply_markup: keyboard,
  });

  // Đánh dấu đã thông báo (tránh spam)
  if (r.ok) {
    try {
      await env.DB.prepare(
        "UPDATE topups SET notified_at = ? WHERE id = ?"
      ).bind(Date.now(), topup.id).run();
      await env.DB.prepare(
        "UPDATE topups SET tg_message_id = ? WHERE id = ?"
      ).bind(0, topup.id).run();
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

  return tgBroadcast(env, lines.join('\n'));
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

  const r = await tgBroadcast(env, text);

  return {
    ...r,
    config: {
      configured: cfg.configured,
      source: cfg.source,
      notifyChats: cfg.notifyChats.length,
    },
  };
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

export { tgConfig, tgCall, tgBroadcast, mdEsc, hEsc, vnd };
