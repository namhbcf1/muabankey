/**
 * Thông báo Telegram cho THANH TOÁN THEO ĐƠN.
 * Không có số dư, không "cộng ví" — chỉ báo tiền vào + đơn.
 *
 * ===== VÌ SAO DÙNG HTML, KHÔNG DÙNG MarkdownV2 =====
 * MarkdownV2 bắt escape 18 ký tự (_ * [ ] ( ) ~ ` > # + - = | { } . !).
 * Chỉ cần MỘT dấu chấm sót trong chuỗi tiếng Việt cứng là Telegram trả
 * "Bad Request: can't parse entities" và TỪ CHỐI TOÀN BỘ tin nhắn —
 * không ném lỗi ra ngoài, chỉ trả ok:false mà code cũ bỏ qua.
 *
 * Thực tế đã xảy ra: mọi thông báo đều chết vì dòng
 *   '_Kiểm tra tài khoản ngân hàng rồi duyệt._'   <- dấu . cuối không escape
 *
 * HTML chỉ cần escape 3 ký tự & < > nên gần như không thể hỏng.
 */
import { tgConfig, tgCall, hEsc, vnd } from './telegram.js';

/** Tiền vào + đã tự giao thành công. */
export async function notifyPaymentSuccess(env, order, info = {}) {
  const cfg = await tgConfig(env);
  if (!cfg.token || !cfg.chatId) return;

  const lines = [
    '✅ <b>TIỀN VÀO — ĐÃ TỰ GIAO</b>',
    '',
    `Mã đơn : <code>${hEsc(order.code)}</code>`,
    `Số tiền: <b>${hEsc(vnd(info.amount || order.total))}</b>`,
    `Nguồn  : ${hEsc(info.source || 'webhook')}`,
  ];

  if (info.excess > 0) {
    lines.push(`⚠️ Thừa : <b>${hEsc(vnd(info.excess))}</b> — cần hoàn tay`);
  }
  if (info.adminId) {
    lines.push(`Admin  : ${hEsc(String(info.adminId).slice(0, 12))}`);
  }

  await tgCall(env, 'sendMessage', {
    chat_id: cfg.chatId,
    text: lines.join('\n'),
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [[
        { text: '🔄 Thu hồi', callback_data: `od:refund:${order.id}` },
      ]],
    },
  });
}

/** Tiền vào nhưng KHÔNG khớp đơn nào -> admin phải xử lý. */
export async function notifyUnmatchedPayment(env, { amount, content, txnRef, provider }) {
  const cfg = await tgConfig(env);
  if (!cfg.token || !cfg.chatId) return;

  const lines = [
    '⚠️ <b>TIỀN VÀO KHÔNG KHỚP ĐƠN</b>',
    '',
    `Số tiền: <b>${hEsc(vnd(amount))}</b>`,
    `Nội dung: <code>${hEsc(String(content || '').slice(0, 80))}</code>`,
    `Mã GD  : <code>${hEsc(String(txnRef || '').slice(0, 40))}</code>`,
    `Nguồn  : ${hEsc(provider || 'sepay')}`,
    '',
    '<i>Khách có thể ghi sai mã đơn. Kiểm tra và khớp tay trong admin.</i>',
  ];

  await tgCall(env, 'sendMessage', {
    chat_id: cfg.chatId,
    text: lines.join('\n'),
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [[
        { text: '📋 Xem thanh toán', callback_data: 'nav:payments' },
      ]],
    },
  });
}

/** Khách bấm "Tôi đã chuyển khoản" -> admin kiểm tra. */
export async function notifyPaymentClaim(env, order, user) {
  const cfg = await tgConfig(env);
  if (!cfg.token || !cfg.chatId) return;

  const lines = [
    '💰 <b>KHÁCH BÁO ĐÃ CHUYỂN KHOẢN</b>',
    '',
    `Mã đơn : <code>${hEsc(order.code)}</code>`,
    `Khách  : ${hEsc(user?.username || user?.email || '?')}`,
    `Cần thu: <b>${hEsc(vnd(order.total))}</b>`,
    '',
    '<i>Kiểm tra tài khoản ngân hàng rồi duyệt.</i>',
  ];

  await tgCall(env, 'sendMessage', {
    chat_id: cfg.chatId,
    text: lines.join('\n'),
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [[
        { text: '✅ Duyệt & giao key', callback_data: `py:ok:${order.id}` },
        { text: '❌ Chưa thấy tiền', callback_data: `py:no:${order.id}` },
      ]],
    },
  });
}

/** Đơn đã có tiền nhưng hết hàng -> admin biết để nhập thêm. */
export async function notifyOutOfStock(env, order, note) {
  const cfg = await tgConfig(env);
  if (!cfg.token || !cfg.chatId) return;

  const lines = [
    '📦 <b>ĐÃ CÓ TIỀN — HẾT HÀNG</b>',
    '',
    `Mã đơn: <code>${hEsc(order.code)}</code>`,
    `Tổng  : <b>${hEsc(vnd(order.total))}</b>`,
    `Lỗi   : ${hEsc(String(note || '').slice(0, 150))}`,
    '',
    '<i>Khách đã trả tiền. Cần nhập hàng để giao hoặc hoàn tiền tay.</i>',
  ];

  await tgCall(env, 'sendMessage', {
    chat_id: cfg.chatId,
    text: lines.join('\n'),
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [[
        { text: '✅ Đã nhập hàng — giao ngay', callback_data: `py:ok:${order.id}` },
        { text: '💸 Hoàn tiền tay', callback_data: `od:refund:${order.id}` },
      ]],
    },
  });
}

/** Khách chuyển THIẾU tiền — tiền đã vào ngân hàng, admin phải biết. */
export async function notifyUnderpaid(env, order, info = {}) {
  const cfg = await tgConfig(env);
  if (!cfg.token || !cfg.chatId) return;

  const paid = Number(info.paid) || 0;
  const expected = Number(info.expected) || Number(order.total) || 0;
  const missing = Number(info.missing) || (expected - paid);

  const lines = [
    '⚠️ <b>CHUYỂN THIẾU TIỀN</b>',
    '',
    `Mã đơn  : <code>${hEsc(order.code)}</code>`,
    `Cần thu : <b>${hEsc(vnd(expected))}</b>`,
    `Đã nhận : <b>${hEsc(vnd(paid))}</b>`,
    `Còn thiếu: <b>${hEsc(vnd(missing))}</b>`,
    '',
    '<i>Đơn vẫn chờ. Khách chuyển bù thì tự giao.</i>',
    '<i>Nếu muốn giao luôn: bấm Duyệt.</i>',
  ];

  await tgCall(env, 'sendMessage', {
    chat_id: cfg.chatId,
    text: lines.join('\n'),
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [[
        { text: '✅ Duyệt dù thiếu', callback_data: `py:ok:${order.id}` },
        { text: '❌ Chưa xử lý', callback_data: `py:no:${order.id}` },
      ]],
    },
  });
}
