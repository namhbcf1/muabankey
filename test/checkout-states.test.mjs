/**
 * checkout-states.test.mjs — Trang thanh toán phải nói ĐÚNG sự thật.
 *
 * Khoá lỗi F11. Trạng thái cũ (`public/assets/pages/checkout.js`):
 *
 *     if (st === 'delivered' || st === 'paid') { showSuccess(...) }
 *
 * `paid` nghĩa là TIỀN ĐÃ VÀO, không phải QUYỀN ĐÃ CẤP. `paid` cũng chính là
 * trạng thái cron đẩy về khi worker chết giữa lúc giao, hoặc khi giao thất bại
 * và cần admin xử lý tay.
 *
 * Hệ quả thật: khách thấy "Thanh toán thành công — mở app là có", mở app không
 * thấy gì, rồi gọi hỗ trợ. Khách còn tưởng đã xong nên không bấm "Tôi đã
 * chuyển khoản" và không biết mình đang chờ xử lý.
 */
import { Suite } from './harness.mjs';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const S = new Suite('Trạng thái thanh toán');

const src = readFileSync(join(ROOT, 'public/assets/pages/checkout.js'), 'utf8');
const css = readFileSync(join(ROOT, 'public/assets/style.css'), 'utf8');

function stripComments(s) {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/(^|[^:\\])\/\/.*$/gm, '$1');
}
const code = stripComments(src);

/* ------------------------------------------------------------------ */
/* 1. TÁI HIỆN: gộp paid với delivered là sai                          */
/* ------------------------------------------------------------------ */

S.section('TÁI HIỆN: paid bị coi là đã cấp quyền');

/**
 * Bảng quyết định CŨ, sao chép nguyên văn điều kiện.
 * Trả về màn hình mà khách sẽ thấy.
 */
function oldScreen(status) {
  if (status === 'delivered' || status === 'paid') return 'SUCCESS';
  if (status === 'cancelled' || status === 'expired') return 'CLOSED';
  return 'WAITING';
}

S.eq(oldScreen('paid'), 'SUCCESS', 'CŨ: paid -> hiện "Thanh toán thành công" (SAI)');
S.eq(oldScreen('delivered'), 'SUCCESS', 'CŨ: delivered -> thành công (đúng)');
S.eq(oldScreen('processing'), 'WAITING', 'CŨ: processing -> không nói gì');

/* ------------------------------------------------------------------ */
/* 2. MÃ MỚI: bốn trạng thái tách bạch                                 */
/* ------------------------------------------------------------------ */

S.section('MỚI: bốn trạng thái riêng biệt');

S.ok(
  !/st === 'delivered' \|\| st === 'paid'/.test(code),
  'checkout.js: KHÔNG còn gộp `delivered || paid`',
);

S.ok(/st === 'delivered'/.test(code), "có nhánh riêng cho 'delivered'");
S.ok(/st === 'processing'/.test(code), "có nhánh riêng cho 'processing'");
S.ok(/st === 'paid'/.test(code), "có nhánh riêng cho 'paid'");
S.ok(/st\.startsWith\('refund'\)/.test(code), "có nhánh cho trạng thái 'refund*'");

/* Mỗi trạng thái phải nói đúng điều nó nghĩa là. */
S.ok(
  /Đã nhận được tiền của bạn/.test(code),
  "nhánh 'paid' nói ĐÃ NHẬN TIỀN (không nói đã cấp quyền)",
);
S.ok(
  /đang cấp quyền|hoàn tất cấp quyền/.test(code),
  "nhánh 'paid' nói rõ đang CHỜ cấp quyền",
);
S.ok(
  /Đã nhận được tiền — đang cấp quyền/.test(code),
  "nhánh 'processing' nói đang cấp quyền",
);
S.ok(
  /Đơn đã đóng/.test(code) && /đừng lo/.test(code),
  'nhánh cancelled/expired vẫn trấn an khách đã chuyển khoản',
);

/* Mã đơn phải được escape khi chèn vào HTML. */
S.ok(
  /esc\(order\.code\)/.test(code),
  'mã đơn được esc() trước khi chèn vào innerHTML',
);

/* ------------------------------------------------------------------ */
/* 3. Bảng quyết định MỚI — chạy thử                                   */
/* ------------------------------------------------------------------ */

S.section('Bảng quyết định mới');

/** Mô phỏng đúng nhánh của poll() sau khi sửa. */
function newScreen(status) {
  if (status === 'delivered') return 'SUCCESS';
  if (status === 'processing') return 'PROCESSING';
  if (status === 'paid') return 'PAID_NOT_GRANTED';
  if (status === 'cancelled' || status === 'expired') return 'CLOSED';
  if (typeof status === 'string' && status.startsWith('refund')) return 'REFUND';
  return 'WAITING';
}

S.eq(newScreen('delivered'), 'SUCCESS', 'delivered -> màn thành công (quyền đã cấp)');
S.eq(newScreen('paid'), 'PAID_NOT_GRANTED', 'paid -> CHỜ cấp quyền (không phải thành công)');
S.eq(newScreen('processing'), 'PROCESSING', 'processing -> đang cấp quyền');
S.eq(newScreen('cancelled'), 'CLOSED', 'cancelled -> đơn đóng');
S.eq(newScreen('expired'), 'CLOSED', 'expired -> đơn đóng');
S.eq(newScreen('refunding'), 'REFUND', 'refunding -> đang hoàn tiền');
S.eq(newScreen('refund_stuck'), 'REFUND', 'refund_stuck -> đang hoàn tiền');
S.eq(newScreen('pending'), 'WAITING', 'pending -> vẫn chờ');

/* Bất biến quan trọng nhất: paid KHÔNG được ra màn thành công. */
S.ok(
  newScreen('paid') !== 'SUCCESS',
  'paid KHÔNG BAO GIỜ ra màn "thành công"',
);

/* ------------------------------------------------------------------ */
/* 4. CSS: dùng biến theme, không hardcode màu                         */
/* ------------------------------------------------------------------ */

S.section('CSS trạng thái dùng biến theme');

S.ok(/\.ck-st-wait/.test(css), 'có .ck-st-wait');
S.ok(/\.ck-st-warn/.test(css), 'có .ck-st-warn');
S.ok(/\.ck-st-err/.test(css), 'có .ck-st-err');

/*
 * Khối trạng thái KHÔNG được dùng mã màu viết cứng — đó là lý do bản cũ
 * không đổi theo theme và lệch tông.
 */
const statusBlock = css.slice(css.indexOf('.ck-st{'));
const statusCss = statusBlock.slice(0, statusBlock.indexOf('/* ===') > 0 ? statusBlock.indexOf('/* ===') : 2000);
S.ok(
  !/#[0-9a-fA-F]{3,8}\b/.test(statusCss),
  'CSS trạng thái: không có mã màu #hardcode',
);
S.ok(
  /var\(--info-line\)/.test(css) && /var\(--warn-line\)/.test(css) && /var\(--danger-line\)/.test(css),
  'CSS trạng thái: dùng biến màu ngữ nghĩa của theme',
);

/* ------------------------------------------------------------------ */
/* 5. Biến --ok / --warning phải tồn tại                               */
/* ------------------------------------------------------------------ */

S.section('Biến CSS còn thiếu đã được khai báo');

/*
 * `account.js` dùng var(--ok) / var(--warning) nhưng hai biến này chưa bao
 * giờ tồn tại -> trình duyệt bỏ qua, mất màu trạng thái hạn dùng.
 */
const rootBlock = css.slice(0, css.indexOf('}', css.indexOf(':root')));
S.ok(/--ok\s*:/.test(rootBlock), ':root đã khai báo --ok');
S.ok(/--warning\s*:/.test(rootBlock), ':root đã khai báo --warning');

/* Mọi var(--x) được dùng trong JS phải tồn tại trong CSS. */
const { readdirSync } = await import('node:fs');
const jsFiles = readdirSync(join(ROOT, 'public/assets/pages')).filter((f) => f.endsWith('.js'));
const usedVars = new Set();
for (const f of jsFiles) {
  const js = readFileSync(join(ROOT, 'public/assets/pages', f), 'utf8');
  for (const m of js.matchAll(/var\(--([a-z0-9-]+)\)/g)) usedVars.add(m[1]);
}
const missing = [...usedVars].filter((v) => !new RegExp(`--${v}\\s*:`).test(css));
S.ok(
  missing.length === 0,
  'mọi var(--x) dùng trong pages/*.js đều được khai báo trong CSS',
  missing.length ? `thiếu: ${missing.join(', ')}` : '',
);

process.exit(S.summary() ? 0 : 1);
