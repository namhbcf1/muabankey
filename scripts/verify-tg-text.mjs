// Kiểm tra TOÀN BỘ chuỗi gửi Telegram có ký tự reserved chưa escape.
import { readFileSync } from 'node:fs';

const src = readFileSync('src/lib/telegram.js', 'utf8');

// Trích các template literal / string literal trong các hàm notify
// Rồi mô phỏng mdEsc và tìm ký tự reserved còn lọt.

function mdEsc(s) {
  return String(s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
}
function vnd(n) { return Number(n || 0).toLocaleString('vi-VN') + 'đ'; }

// Mô phỏng notifyTopup
function buildTopup(o) {
  const { topup, email, customer, received, via, ref, balanceBefore, matched } = o;
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
  if (balanceBefore !== undefined) lines.push(`Số dư hiện tại: ${mdEsc(vnd(balanceBefore))}`);
  lines.push('');
  lines.push(matched
    ? '_Bấm Duyệt để cộng tiền vào ví_'
    : '_Khách chưa chuyển khoản — bấm Từ chối nếu cần_');
  return lines.join('\n');
}

function buildOrder(o) {
  const { order, email, items } = o;
  const lines = [
    '🛒 *ĐƠN HÀNG MỚI*',
    '',
    `Mã đơn: \`${mdEsc(order.code)}\``,
    `Khách: ${mdEsc(email || 'không rõ')}`,
    `Tổng: *${mdEsc(vnd(order.total))}*`,
  ];
  if (items?.length) {
    lines.push('');
    for (const it of items.slice(0, 8)) lines.push(`• ${mdEsc(it.name)} × ${it.quantity}`);
  }
  lines.push('');
  lines.push('_Đơn đã thanh toán bằng ví — key giao tự động_');
  return lines.join('\n');
}

// Ký tự reserved THẬT SỰ phải escape ngoài markup
// (* _ ` [ ] là markup khi cặp đôi; ở đây ta coi chúng là markup)
const MUST_ESCAPE = '._!-+={}()~>#|';

function findIssues(text, label) {
  const issues = [];
  text.split('\n').forEach((line, i) => {
    let j = 0;
    while (j < line.length) {
      const ch = line[j];
      if (ch === '\\') { j += 2; continue; }
      // bỏ qua markup char
      if ('*_`[]'.includes(ch)) { j++; continue; }
      if (MUST_ESCAPE.includes(ch)) {
        issues.push(`  ${label} dòng ${i + 1}: "${ch}" @${j} — ${line.slice(Math.max(0, j - 12), j + 12)}`);
      }
      j++;
    }
  });
  return issues;
}

console.log('\n=== notifyTopup ===');
const t1 = buildTopup({
  topup: { id: 'x', code: 'ABC12', amount: 200000 },
  email: 'a@b.com', customer: 'Nam', received: 200000,
  via: 'payos', ref: 'FT230204212323', balanceBefore: 100000, matched: true,
});
console.log(t1);
const i1 = findIssues(t1, 'topup');
console.log('\nKý tự reserved chưa escape:');
console.log(i1.length ? i1.join('\n') : '  (không có)');

console.log('\n=== notifyOrder ===');
const t2 = buildOrder({
  order: { code: 'MBK-ABC12', total: 180000 },
  email: 'a@b.com',
  items: [{ name: 'XArena No Fog — Gói Tháng', quantity: 1 }],
});
console.log(t2);
const i2 = findIssues(t2, 'order');
console.log('\nKý tự reserved chưa escape:');
console.log(i2.length ? i2.join('\n') : '  (không có)');

// Thử gửi thật lên Telegram
const TOKEN = process.env.TG_TOKEN || '9204549517:AAFrpYm_0By5c-oePkpxgyPcrW0DDT5gtnA';
const CHAT = process.env.TG_CHAT || '1427044674';

async function sendReal() {
  console.log('\n=== GỬI THẬT LÊN TELEGRAM ===');
  for (const [label, text] of [['topup', t1], ['order', t2]]) {
    const r = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: CHAT, text, parse_mode: 'MarkdownV2', disable_web_page_preview: true }),
    });
    const d = await r.json();
    console.log(`  ${label}: ${d.ok ? '✅ OK' : '❌ ' + d.description}`);
  }
}
sendReal();
