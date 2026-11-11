/**
 * Thông báo Telegram cho THANH TOÁN THEO ĐƠN.
 * Không có số dư, không "cộng ví" — chỉ báo tiền vào + đơn.
 */
import { tgConfig, tgCall, mdEsc, vnd } from './telegram.js';

/** Tiền vào + đã tự giao thành công. */
export async function notifyPaymentSuccess(env, order, info = {}) {
  const cfg = await tgConfig(env);
  if (!cfg.token || !cfg.chatId) return;

  const lines = [
    '✅ *TIỀN VÀO — ĐÃ TỰ GIAO*',
    '',
    `Mã đơn : \`${mdEsc(order.code)}\``,
    `Số tiền: *${mdEsc(vnd(info.amount || order.total))}*`,
    `Nguồn  : ${mdEsc(info.source || 'webhook')}`,
  ];

  if (info.excess > 0) {
    lines.push(`⚠️ Thừa : *${mdEsc(vnd(info.excess))}* — cần hoàn tay`);
  }
  if (info.adminId) {
    lines.push(`Admin  : ${mdEsc(String(info.adminId).slice(0, 12))}`);
  }

  await tgCall(env, 'sendMessage', {
    chat_id: cfg.chatId,
    text: lines.join('\n'),
    parse_mode: 'MarkdownV2',
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
    '⚠️ *TIỀN VÀO KHÔNG KHỚP ĐƠN*',
    '',
    `Số tiền: *${mdEsc(vnd(amount))}*`,
    `Nội dung: \`${mdEsc(String(content || '').slice(0, 80))}\``,
    `Mã GD  : \`${mdEsc(String(txnRef || '').slice(0, 40))}\``,
    `Nguồn  : ${mdEsc(provider || 'sepay')}`,
    '',
    '_Khách có thể ghi sai mã đơn. Kiểm tra và khớp tay trong admin._',
  ];

  await tgCall(env, 'sendMessage', {
    chat_id: cfg.chatId,
    text: lines.join('\n'),
    parse_mode: 'MarkdownV2',
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
    '💰 *KHÁCH BÁO ĐÃ CHUYỂN KHOẢN*',
    '',
    `Mã đơn : \`${mdEsc(order.code)}\``,
    `Khách   : ${mdEsc(user?.username || user?.email || '?')}`,
    `Cần thu : *${mdEsc(vnd(order.total))}*`,
    '',
    '_Kiểm tra tài khoản ngân hàng rồi duyệt._',
  ];

  await tgCall(env, 'sendMessage', {
    chat_id: cfg.chatId,
    text: lines.join('\n'),
    parse_mode: 'MarkdownV2',
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
    '📦 *ĐÃ CÓ TIỀN — HẾT HÀNG*',
    '',
    `Mã đơn : \`${mdEsc(order.code)}\``,
    `Tổng   : *${mdEsc(vnd(order.total))}*`,
    `Lỗi    : ${mdEsc(String(note || '').slice(0, 150))}`,
    '',
    '_Khách đã trả tiền. Cần nhập hàng để giao hoặc hoàn tiền tay._',
  ];

  await tgCall(env, 'sendMessage', {
    chat_id: cfg.chatId,
    text: lines.join('\n'),
    parse_mode: 'MarkdownV2',
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
    '⚠️ *CHUYỂN THIẾU TIỀN*',
    '',
    `Mã đơn : \`${mdEsc(order.code)}\``,
    `Cần thu : *${mdEsc(vnd(expected))}*`,
    `Đã nhận : *${mdEsc(vnd(paid))}*`,
    `Còn thiếu: *${mdEsc(vnd(missing))}*`,
    '',
    '_Đơn vẫn chờ. Khách chuyển bù thì tự giao._',
    '_Nếu muốn giao luôn: bấm Duyệt._',
  ];

  await tgCall(env, 'sendMessage', {
    chat_id: cfg.chatId,
    text: lines.join('\n'),
    parse_mode: 'MarkdownV2',
    reply_markup: {
      inline_keyboard: [[
        { text: '✅ Duyệt dù thiếu', callback_data: `py:ok:${order.id}` },
        { text: '❌ Chưa xử lý', callback_data: `py:no:${order.id}` },
      ]],
    },
  });
}
