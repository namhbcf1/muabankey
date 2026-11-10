// Gửi tin mẫu Telegram — dùng mdEsc thật để không lỗi.
function mdEsc(s) {
  return String(s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
}
function vnd(n) { return Number(n || 0).toLocaleString('vi-VN') + 'đ'; }

const TOKEN = '9204549517:AAFrpYm_0By5c-oePkpxgyPcrW0DDT5gtnA';
const CHAT = '1427044674';

async function send(label, text, keyboard) {
  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: CHAT, text, parse_mode: 'MarkdownV2',
      disable_web_page_preview: true, reply_markup: { inline_keyboard: keyboard },
    }),
  });
  const d = await r.json();
  console.log(`  ${label.padEnd(16)} ${d.ok ? '✅ OK' : '❌ ' + d.description}`);
}

async function main() {
  // 1. Đơn hàng cần giao
  const t1 = [
    '📦 *ĐƠN CẦN GIAO TAY*',
    '',
    `Mã đơn: \`${mdEsc('MBK-DEMO01')}\``,
    `Khách: ${mdEsc('khach@gmail.com')}`,
    `Tổng: *${mdEsc(vnd(180000))}*`,
    '',
    `• ${mdEsc('XArena No Fog — Gói Tháng')} × 1`,
    '',
    '_Bấm Giao đơn sau khi đã gửi key cho khách_',
  ].join('\n');
  await send('Đơn hàng', t1, [[
    { text: '📦 Giao đơn', callback_data: 'od:deliver:demo' },
    { text: '💸 Hoàn tiền', callback_data: 'od:refundreq:demo' },
  ]]);

  // 2. Sắp hết hàng
  const t2 = [
    '⚠️ *SẮP HẾT HÀNG*', '',
    `• ${mdEsc('Canva Pro')}: *2* còn lại`,
    `• ${mdEsc('ExpressVPN')}: *2* còn lại`,
    `• ${mdEsc('Office 2021 Pro Plus')}: *3* còn lại`,
    `• ${mdEsc('Windows 11 Pro Retail')}: *4* còn lại`,
    '', '_Nhập thêm key để không gián đoạn bán hàng_',
  ].join('\n');
  await send('Sắp hết hàng', t2, [[
    { text: '🔑 Nhập key', callback_data: 'nav:keys' },
    { text: '🛍️ Xem sản phẩm', callback_data: 'nav:products' },
  ]]);

  // 3. License sắp hết hạn
  const KEY = 'AOE1-XXXX-YYYY-ZZZZ';
  const t3 = [
    '⏰ *LICENSE SẮP HẾT HẠN*', '',
    `• \`${mdEsc(KEY)}\` — còn *3* ngày`,
    '', '_Khách có thể gia hạn để không mất quyền dùng_',
  ].join('\n');
  await send('License hết hạn', t3, [[
    { text: '⏳ +30 ngày', callback_data: `ls:ext30:${KEY}` },
    { text: '🚫 Thu hồi', callback_data: `ls:revoke:${KEY}` },
  ]]);

  // 4. Báo cáo ngày
  const t4 = [
    '📊 *BÁO CÁO HÔM NAY*', '',
    'Đơn hàng: *4*',
    `Doanh thu: *${mdEsc(vnd(1290000))}*`,
    'Khách mới: *3*',
    'Key đã giao: *5*',
    'Dùng thử: *7*',
    '', '_Báo cáo tự động hằng ngày_',
  ].join('\n');
  await send('Báo cáo', t4, [[
    { text: '📊 Dashboard', callback_data: 'nav:dashboard' },
    { text: '📦 Đơn hàng', callback_data: 'nav:orders' },
  ]]);
}

main();
