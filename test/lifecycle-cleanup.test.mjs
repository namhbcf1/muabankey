/**
 * lifecycle-cleanup.test.mjs — SPA: listener phải được GỠ, code chết phải đã xoá.
 *
 * Khoá lại F12 (SPA lifecycle) và F17 (dọn legacy). Mỗi mục đều có phần
 * "trạng thái cũ" để thấy đây không phải kiểm tra hình thức.
 *
 * Bối cảnh thật:
 *   - `bindHeader()` được gọi lại MỖI lần đăng nhập/đăng xuất (header thay
 *     bằng innerHTML). Listener gắn lên `window`/`document` không bị xoá theo
 *     node, nên mỗi lần refresh là cộng thêm một bộ, giữ tham chiếu tới header
 *     đã chết.
 *   - Giỏ hàng đã bị gỡ khỏi UI nhưng ~90 dòng module cart + 750 dòng CSS vẫn
 *     nằm trong bundle mà mọi khách phải tải.
 */
import { Suite } from './harness.mjs';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const S = new Suite('Vòng đời SPA & dọn code chết');

const components = readFileSync(join(ROOT, 'public/assets/components.js'), 'utf8');
const stateSrc = readFileSync(join(ROOT, 'public/assets/state.js'), 'utf8');
const homeSrc = readFileSync(join(ROOT, 'public/assets/pages/home.js'), 'utf8');
const cssSrc = readFileSync(join(ROOT, 'public/assets/style.css'), 'utf8');
const appSrc = readFileSync(join(ROOT, 'public/assets/app.js'), 'utf8');

/* ================================================================== */
/* F12 — Listener của header phải gỡ được                              */
/* ================================================================== */

S.section('F12: bindHeader gỡ listener trước khi gắn bộ mới');

S.ok(
  /let headerDisposers = \[\]/.test(components),
  'components.js: có danh sách hàm gỡ (headerDisposers)',
);
S.ok(
  /function disposeHeader\(\)/.test(components),
  'components.js: có hàm disposeHeader()',
);
S.ok(
  /export function bindHeader\(\) \{\s*\n\s*disposeHeader\(\);/.test(components),
  'components.js: bindHeader() GỌI disposeHeader() TRƯỚC khi gắn listener',
);

/* Listener gắn lên window/document phải có đường gỡ tương ứng. */
S.ok(
  /removeEventListener\('scroll', onScroll\)/.test(components),
  'components.js: listener scroll trên window được removeEventListener',
);
S.ok(
  /removeEventListener\('click', onDocClick\)/.test(components),
  'components.js: listener click trên document được gỡ',
);
S.ok(
  /removeEventListener\('keydown', onDocKey\)/.test(components),
  'components.js: listener keydown trên document được gỡ',
);

/*
 * Đếm: số listener gắn lên window/document phải bằng số lần removeEventListener.
 * Đây là bất biến thật — thiếu một cặp là rò rỉ.
 */
const addGlobal = (components.match(/(?:window|document)\.addEventListener\(/g) || []).length;
const removeGlobal = (components.match(/(?:window|document)\.removeEventListener\(/g) || []).length;
S.ok(
  removeGlobal >= addGlobal,
  'số removeEventListener >= số addEventListener trên window/document',
  `add=${addGlobal}, remove=${removeGlobal}`,
);

/* ================================================================== */
/* F12 — AbortController cho request theo route                        */
/* ================================================================== */

S.section('F12: request huỷ được khi đổi route');

S.ok(/AbortController/.test(appSrc), 'app.js: dùng AbortController');
S.ok(
  /isAborted/.test(appSrc),
  'app.js: phân biệt lỗi do huỷ với lỗi thật (không hiện toast khi đã đổi trang)',
);
S.ok(
  /navSeq/.test(appSrc),
  'app.js: có số thứ tự điều hướng để bỏ lượt cũ',
);

/* ================================================================== */
/* F17 — Giỏ hàng đã xoá hẳn                                           */
/* ================================================================== */

S.section('F17: module giỏ hàng đã xoá');

const CART_FNS = [
  'cartCount', 'cartSubtotal', 'saveCart', 'addToCart',
  'updateCartQty', 'removeFromCart', 'clearCart', 'renderCartBadge',
];
for (const fn of CART_FNS) {
  S.ok(
    !new RegExp(`export function ${fn}\\b`).test(stateSrc),
    `state.js: KHÔNG còn export ${fn}()`,
  );
}
S.ok(!/state\.cart\b/.test(stateSrc), 'state.js: KHÔNG còn state.cart');
S.ok(!/state\.aiOpen\b/.test(stateSrc), 'state.js: KHÔNG còn state.aiOpen');

/* Không file JS nào còn GỌI các hàm đó. */
const { readdirSync } = await import('node:fs');
const jsFiles = [
  ...readdirSync(join(ROOT, 'public/assets')).filter((f) => f.endsWith('.js')).map((f) => `public/assets/${f}`),
  ...readdirSync(join(ROOT, 'public/assets/pages')).filter((f) => f.endsWith('.js')).map((f) => `public/assets/pages/${f}`),
];

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/(^|[^:\\])\/\/.*$/gm, '$1');
}

const callers = [];
for (const f of jsFiles) {
  const code = stripComments(readFileSync(join(ROOT, f), 'utf8'));
  for (const fn of CART_FNS) {
    if (new RegExp(`\\b${fn}\\s*\\(`).test(code)) callers.push(`${f}: ${fn}()`);
  }
}
S.ok(callers.length === 0, 'không file JS nào còn gọi hàm giỏ hàng', callers.join(', '));

/* bindProductCards no-op đã xoá. */
S.ok(
  !/export function bindProductCards/.test(homeSrc),
  'home.js: KHÔNG còn bindProductCards (thân hàm là no-op)',
);
S.ok(
  !/^\s*bindProductCards\(/m.test(homeSrc),
  'home.js: KHÔNG còn lời gọi bindProductCards',
);

/* ================================================================== */
/* F17 — CSS chết đã xoá                                               */
/* ================================================================== */

S.section('F17: CSS không còn class chết');

/*
 * Bóc comment CSS: khối giải thích ở cuối file cố ý nhắc tên class cũ
 * (".key-copy 24px") để ghi lại lịch sử sửa lỗi. Soát MÃ, không soát lời
 * giải thích.
 */
const cssCode = cssSrc.replace(/\/\*[\s\S]*?\*\//g, '');

const DEAD_CSS = [
  'cart-item', 'cart-thumb', 'cart-remove', 'cart-badge',
  'drawer-overlay', 'drawer-head', 'drawer-body',
  'qty-ctrl', 'qty-row',
  'key-box', 'key-value', 'key-copy',
  'ck-item', 'ck-summary', 'ck-receipt', 'ck-wallet',
  'balance-chip', 'badge-dot',
  'pd-review', 'summary-row', 'chip-row',
];

for (const cls of DEAD_CSS) {
  S.ok(
    !new RegExp(`\\.${cls}[\\s,{:.>]`).test(cssCode),
    `style.css: KHÔNG còn .${cls}`,
  );
}

/* Ngoặc nhọn phải cân bằng — bắt lỗi cắt CSS sai. */
const open = (cssSrc.match(/\{/g) || []).length;
const close = (cssSrc.match(/\}/g) || []).length;
S.eq(open, close, 'style.css: ngoặc { } cân bằng');

/* File CSS phải nhỏ hơn trước (89 KB -> dưới 85 KB) và vẫn còn nội dung. */
const cssBytes = Buffer.byteLength(cssSrc, 'utf8');
S.ok(cssBytes < 85_000, 'style.css: đã giảm dung lượng', `${cssBytes} B`);
S.ok(cssBytes > 50_000, 'style.css: vẫn còn đủ style (không xoá quá tay)', `${cssBytes} B`);

/* Class còn dùng KHÔNG được xoá nhầm. */
const LIVE = ['product-card', 'btn', 'container', 'header-inner', 'grid-products', 'qr-'];
const allJs = jsFiles.map((f) => readFileSync(join(ROOT, f), 'utf8')).join('\n')
  + readFileSync(join(ROOT, 'public/index.html'), 'utf8');
for (const cls of LIVE) {
  const usedInJs = allJs.includes(cls);
  if (!usedInJs) continue; // chỉ kiểm những class thật sự được dùng
  S.ok(
    new RegExp(`\\.${cls}`).test(cssSrc),
    `style.css: vẫn CÒN .${cls} (đang được dùng, không được xoá)`,
  );
}

/* ================================================================== */
/* F17 — Route trùng đăng ký đã gỡ                                     */
/* ================================================================== */

S.section('F17: không còn route đăng ký trùng');

const indexSrc = readFileSync(join(ROOT, 'src/index.js'), 'utf8');
const confirmPaymentHits = (stripComments(indexSrc).match(
  /r\.post\('\/api\/admin\/orders\/:id\/confirm-payment'/g
) || []).length;
S.eq(confirmPaymentHits, 1, 'index.js: confirm-payment chỉ đăng ký MỘT lần');

process.exit(S.summary() ? 0 : 1);
