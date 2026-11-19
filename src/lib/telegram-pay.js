/**
 * Thông báo Telegram cho THANH TOÁN THEO ĐƠN (admin nhận).
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
 * Mọi lời gọi trong file này PHẢI kèm `parse_mode: 'HTML'` (xem tgBroadcast).
 *
 * ===== CHỮ TO HƠN TRONG TELEGRAM =====
 * YÊU CẦU CHỦ SHOP:
 *   "cái thông báo cho admin khi đã chuyển khoản cũng to lên ít chữ linh tinh thôi"
 *
 * Telegram Bot API KHÔNG có thẻ cỡ chữ: không `<h1>`, không `font-size`,
 * không `<big>`. Chỉ có <b> (đậm), <i>, <code>, <pre>.
 * Nên "to" ở đây = SỐ TIỀN đứng MỘT MÌNH trên dòng đầu, in đậm, không có
 * chữ nào khác trên dòng đó. Mọi tin dưới đây theo đúng một khuôn:
 *
 *   💰 <b>180.000đ</b>            <- số tiền, to nhất, luôn ở dòng 1
 *   ai chuyển (tên khách / nội dung CK ngân hàng)
 *   đơn nào + trạng thái
 *   [cảnh báo thiếu/thừa nếu có]
 *   Mã GD ...                     <- mã giao dịch ngân hàng, dòng CUỐI, chữ thường
 *
 * Tối đa 6 dòng. Không GUID, không id nội bộ, không giờ:phút:giây, không
 * chữ tiếng Anh, không tên kênh thanh toán ("SePay"/"webhook"/"admin") —
 * chủ shop không cần biết máy móc, chỉ cần biết TIỀN và ĐƠN.
 *
 * BẢO MẬT: đây là tin cho ADMIN nên tên khách / nội dung CK là được phép.
 * Tuyệt đối KHÔNG đưa key license, token, mật khẩu, UUID nội bộ vào tin.
 */
import { tgConfig, tgBroadcast, hEsc, vnd } from './telegram.js';

/* ------------------------------------------------------------------ */
/* Khuôn chung                                                         */
/* ------------------------------------------------------------------ */

/**
 * Dòng SỐ TIỀN — luôn là dòng đầu tiên, luôn đứng một mình.
 * @param {number} amount
 * @param {string} emoji 💰 tiền vào · ⚠️ bất thường · 📦 lỗi giao
 */
function moneyLine(amount, emoji = '💰') {
  return `${emoji} <b>${hEsc(vnd(amount))}</b>`;
}

/**
 * Dòng mã giao dịch ngân hàng — đặt CUỐI, chữ thường, không bọc thẻ để
 * không tranh mắt với số tiền. Đây là thứ duy nhất chủ shop cần để dò sao kê.
 */
function refLine(txnRef) {
  const ref = String(txnRef || '').trim();
  return ref ? [`Mã GD ${hEsc(ref)}`] : [];
}

/** Nội dung CK / tên người chuyển — cắt ngắn, bỏ khoảng trắng thừa. */
function whoText(s, max = 60) {
  return String(s || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/* ------------------------------------------------------------------ */
/* 1. Tiền vào + đã tự giao key                                        */
/* ------------------------------------------------------------------ */
export async function notifyPaymentSuccess(env, order, info = {}) {
  const cfg = await tgConfig(env);
  if (!cfg.token || !cfg.chatId) return;

  const amount = Number(info.amount) || Number(order.total) || 0;
  const excess = Number(info.excess) || 0;
  const pendingManual = info.pendingManual === true;

  const lines = [
    moneyLine(amount),
    `Đơn <code>${hEsc(order.code)}</code> — `
      + (pendingManual ? 'đã nhận tiền, chờ giao tay' : 'đã tự giao key'),
  ];

  // Chỉ hiện khi THỰC SỰ thừa tiền: đây là việc phải làm (hoàn tay), không phải chữ trang trí.
  if (excess > 0) lines.push(`⚠️ Thừa <b>${hEsc(vnd(excess))}</b> — hoàn tay`);

  lines.push(...refLine(info.txnRef));

  await tgBroadcast(env, lines.join('\n'), {
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [[
        { text: '🔄 Thu hồi', callback_data: `od:refund:${order.id}` },
      ]],
    },
  });
}

/* ------------------------------------------------------------------ */
/* 2. Tiền vào nhưng KHÔNG khớp đơn nào — ca nguy hiểm nhất            */
/* ------------------------------------------------------------------ */
/**
 * Ca chủ shop CẦN THẤY NHẤT: tiền đã vào ngân hàng mà không gắn được đơn.
 * Tin phải nói đủ 3 thứ: SỐ TIỀN, NỘI DUNG CK y như ngân hàng nhận, và
 * "KHÔNG KHỚP ĐƠN — KIỂM TRA TAY". Không có nút nào gán được hộ, nên chữ
 * cảnh báo phải tự đứng một dòng, in đậm.
 */
export async function notifyUnmatchedPayment(env, { amount, content, txnRef }) {
  const cfg = await tgConfig(env);
  if (!cfg.token || !cfg.chatId) return;

  const memo = whoText(content, 80);

  const lines = [
    moneyLine(amount, '⚠️'),
    '<b>KHÔNG KHỚP ĐƠN — KIỂM TRA TAY</b>',
    memo ? `Nội dung: <code>${hEsc(memo)}</code>` : 'Nội dung: <i>(ngân hàng không gửi nội dung)</i>',
    ...refLine(txnRef),
  ];

  await tgBroadcast(env, lines.join('\n'), {
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [[
        { text: '📋 Xem thanh toán', callback_data: 'nav:payments' },
      ]],
    },
  });
}

/* ------------------------------------------------------------------ */
/* 3. Tiền vào cần admin duyệt / khách báo đã chuyển khoản             */
/* ------------------------------------------------------------------ */
/**
 * HAI ca dùng chung một khuôn, phân biệt bằng `info.confirmed`:
 *
 *   confirmed = true   — webhook NGÂN HÀNG báo tiền đã vào, chỉ chờ admin
 *                        bấm duyệt (ca 12:00–23:59 theo cửa sổ giờ).
 *                        Số tiền = số TIỀN THỰC NHẬN.
 *   confirmed = false  — khách tự bấm "Tôi đã chuyển khoản". Chưa có gì
 *                        chắc chắn, số tiền = số tiền ĐƠN (cần thu).
 *
 * @param {object} info { confirmed, amount, content, txnRef }
 */
export async function notifyPaymentClaim(env, order, user, info = {}) {
  const cfg = await tgConfig(env);
  if (!cfg.token || !cfg.chatId) return;

  const confirmed = info.confirmed === true;
  const amount = Number(info.amount) > 0 ? Number(info.amount) : (Number(order.total) || 0);
  const payer = whoText(user?.full_name || user?.username, 32);
  const memo = whoText(info.content, 60);

  const lines = confirmed
    ? [
        moneyLine(amount),
        `Đơn <code>${hEsc(order.code)}</code> — chờ duyệt`,
      ]
    : [
        moneyLine(amount, '🙋'),
        '<b>KHÁCH BÁO ĐÃ CHUYỂN KHOẢN</b>',
        `Đơn <code>${hEsc(order.code)}</code>${payer ? ` · ${hEsc(payer)}` : ''}`,
      ];

  if (confirmed && memo) lines.push(`Nội dung: <code>${hEsc(memo)}</code>`);
  lines.push(...refLine(info.txnRef));

  await tgBroadcast(env, lines.join('\n'), {
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [[
        { text: '✅ Duyệt & giao key', callback_data: `py:ok:${order.id}` },
        { text: '❌ Chưa thấy tiền', callback_data: `py:no:${order.id}` },
      ]],
    },
  });
}

/* ------------------------------------------------------------------ */
/* 4. Đã có tiền nhưng CHƯA giao được (hết key / lỗi cửa hàng)         */
/* ------------------------------------------------------------------ */
/**
 * `note` là thông báo lỗi KỸ THUẬT (thường là tiếng Anh, có thể kèm id nội
 * bộ). Không đưa vào tin nhắn nữa: nó chính là "chữ linh tinh" chủ shop
 * phàn nàn. Chuyển sang log để `wrangler tail` vẫn thấy, còn thông tin đó
 * cũng đã được ghi vào `orders.admin_note` (payments.js, nhánh DELIVER_FAILED).
 */
export async function notifyOutOfStock(env, order, note, info = {}) {
  const cfg = await tgConfig(env);
  if (!cfg.token || !cfg.chatId) return;

  if (note) {
    console.error('[PAY_DELIVER_FAIL]', order?.code || '', String(note).slice(0, 200));
  }

  const amount = Number(info.amount) || Number(order.total) || 0;

  const lines = [
    moneyLine(amount, '📦'),
    `Đơn <code>${hEsc(order.code)}</code> — <b>tiền đã vào, chưa giao được</b>`,
    ...refLine(info.txnRef),
  ];

  await tgBroadcast(env, lines.join('\n'), {
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [[
        { text: '✅ Đã nhập hàng — giao ngay', callback_data: `py:ok:${order.id}` },
        { text: '💸 Hoàn tiền tay', callback_data: `od:refund:${order.id}` },
      ]],
    },
  });
}

/* ------------------------------------------------------------------ */
/* 5. Chuyển THIẾU tiền                                                */
/* ------------------------------------------------------------------ */
export async function notifyUnderpaid(env, order, info = {}) {
  const cfg = await tgConfig(env);
  if (!cfg.token || !cfg.chatId) return;

  const paid = Number(info.paid) || 0;
  const expected = Number(info.expected) || Number(order.total) || 0;
  const missing = Number(info.missing) || Math.max(0, expected - paid);

  const lines = [
    moneyLine(paid, '⚠️'),
    `Thiếu <b>${hEsc(vnd(missing))}</b> · cần thu ${hEsc(vnd(expected))}`,
    `Đơn <code>${hEsc(order.code)}</code> — chưa giao`,
    ...refLine(info.txnRef),
  ];

  await tgBroadcast(env, lines.join('\n'), {
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [[
        { text: '✅ Duyệt dù thiếu', callback_data: `py:ok:${order.id}` },
        { text: '❌ Chưa xử lý', callback_data: `py:no:${order.id}` },
      ]],
    },
  });
}
