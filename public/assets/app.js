/** MuaBanKey SPA — bộ định tuyến & khởi tạo. */
import { parseRoute, navigate, toast, loadingBlock, esc, bindImageFallbacks, bindScrollHints, closeAllModals, routeContext, isAborted } from './lib.js';
import { state, loadUser, loadCategories } from './state.js';
import { icon } from './icons.js';
import {
  renderHeader, bindHeader, renderFooter, renderAiWidget, bindAiWidget,
  hydrateFooterCategories,
} from './components.js';

import { renderHome, mountHome } from './pages/home.js';
import { renderProducts, mountProducts } from './pages/products.js';
import { renderProductDetail, mountProductDetail } from './pages/product-detail.js';
import { renderLogin, mountLogin, renderRegister, mountRegister } from './pages/auth.js';
import { renderCheckout, mountCheckout, buyNowById } from './pages/checkout.js';
import { renderAccount, mountAccount } from './pages/account.js';
import { renderOrders, mountOrders } from './pages/orders.js';
import { renderSupport, mountSupport } from './pages/support.js';
import { renderLicenses, mountLicenses } from './pages/licenses.js';
import { renderGuide, mountGuide } from './pages/guide.js';
import { renderDownload, mountDownload } from './pages/download.js';
/*
 * pages/admin.js KHÔNG còn import tĩnh ở đây.
 *
 * Trước đây nó nằm trong import tĩnh nên 100% khách (kể cả người chỉ vào
 * trang chủ) phải tải 78.644 B mã quản trị không bao giờ dùng tới. Nay chỉ
 * tải khi thật sự mở /admin (xem `load` trong ROUTES + nhánh lazy ở router).
 */

const ROUTES = [
  { pattern: /^\/$/, render: renderHome, mount: mountHome },
  { pattern: /^\/products$/, render: renderProducts, mount: mountProducts },  { pattern: /^\/product\/([^/]+)$/, render: renderProductDetail, mount: mountProductDetail, param: true },
  { pattern: /^\/login$/, render: renderLogin, mount: mountLogin },
  { pattern: /^\/register$/, render: renderRegister, mount: mountRegister },
  { pattern: /^\/checkout$/, render: renderCheckout, mount: mountCheckout },
  { pattern: /^\/account$/, render: renderAccount, mount: mountAccount },
  { pattern: /^\/orders$/, render: renderOrders, mount: mountOrders },
  // /wallet bỏ (không nạp tiền). Chuyển sang đơn hàng.
  { pattern: /^\/wallet$/, render: renderOrders, mount: mountOrders },
  // Trang thanh toán QR theo đơn.
  // PHẢI bọc mount: route có param:true nên app gọi mount(app, param, query)
  // trong khi mountCheckout(root, query) -> nếu truyền thẳng thì UUID thành
  // query, query.mode=undefined -> trang không biết phải mở QR của đơn nào.
  {
    pattern: /^\/order\/([^/]+)$/,
    render: renderCheckout,
    mount: (app, id) => mountCheckout(app, { mode: 'order', orderId: id }),
    param: true,
  },
  { pattern: /^\/licenses$/, render: renderLicenses, mount: mountLicenses },
  { pattern: /^\/support$/, render: renderSupport, mount: mountSupport },
  { pattern: /^\/huong-dan$/, render: renderGuide, mount: mountGuide },
  /*
   * /tai-ve — trang tải bộ cài. PUBLIC (không cần đăng nhập): khách còn
   * đang phân vân vẫn phải xem được version + hash trước khi quyết định
   * mua, và nút tải phải chạy ngay từ lần mở đầu tiên.
   */
  { pattern: /^\/tai-ve$/, render: renderDownload, mount: mountDownload },
  /*
   * /admin — NẠP THEO YÊU CẦU (code-split thủ công).
   * `load` trả {render, mount} đúng hợp đồng của route; router await nó
   * trước khi render nên phần còn lại của app không phải biết gì thêm.
   */
  {
    pattern: /^\/admin$/,
    load: async () => {
      const m = await import('./pages/admin.js');
      return { render: m.renderAdmin, mount: m.mountAdmin };
    },
  },
];

let currentCleanup = null;
/** Ngữ cảnh sống theo route hiện tại (AbortController + disposers). */
let routeCtx = null;

/**
 * Ngữ cảnh của route đang hiển thị. Trang dùng `getRouteContext().signal`
 * cho mọi request và `.setInterval()` / `.listen()` cho mọi thứ cần dọn.
 */
export function getRouteContext() {
  return routeCtx;
}

function renderNotFound() {
  return `
  <div id="site-header"></div>
  <div class="nf-wrap">
    <div class="nf-inner">
      <div class="nf-eyebrow">${icon('search', { size: 13 })}<span>Lỗi 404</span></div>
      <h1 class="nf-title">Không tìm thấy trang</h1>
      <p class="nf-desc">Đường dẫn bạn truy cập không tồn tại hoặc đã bị di chuyển.</p>
      <div class="nf-actions">
        <button class="btn btn-primary" data-nf-home>${icon('arrowLeft', { size: 15 })} Về trang chủ</button>
        <button class="btn btn-ghost" data-nf-products>Xem sản phẩm</button>
      </div>
    </div>
  </div>
  <div id="site-footer"></div>`;
}

function bindNotFound(app) {
  app.querySelector('[data-nf-home]')?.addEventListener('click', () => navigate('/'));
  app.querySelector('[data-nf-products]')?.addEventListener('click', () => navigate('/products'));
}

/**
 * Chưa biết trạng thái đăng nhập -> hiện KHỐI CHỜ thay vì nút "Đăng nhập".
 *
 * Nếu vẽ thẳng nút "Đăng nhập" rồi 650ms sau thay bằng avatar, khách đã đăng
 * nhập sẽ thấy trạng thái SAI (nhấp nháy) — đúng lỗi cần tránh. Khối chờ nói
 * "chưa biết", không nói sai.
 *
 * Không sửa components.js (ngoài phạm vi) nên thay tại chỗ: bỏ 2 nút
 * login/register trong .header-actions rồi gắn một ô xám cùng kích thước.
 */
function paintAuthSkeleton(headerHost) {
  const area = headerHost.querySelector('.header-actions');
  if (!area) return;
  area.querySelectorAll('[data-nav="/login"], [data-nav="/register"]').forEach((el) => el.remove());
  const ph = document.createElement('span');
  ph.setAttribute('aria-hidden', 'true');
  ph.style.cssText =
    'display:inline-block;width:112px;height:28px;border-radius:8px;' +
    'background:rgba(148,163,184,.22)';
  area.appendChild(ph);
}

function mountChrome(app) {
  // Header
  const headerHost = document.getElementById('site-header');
  if (headerHost) {
    headerHost.innerHTML = renderHeader();
    bindHeader();
    // Chỉ lần đầu, khi /api/auth/me chưa trả lời.
    if (!state.authReady) paintAuthSkeleton(headerHost);
  }
  // Footer
  const footerHost = document.getElementById('site-footer');
  if (footerHost) {
    footerHost.innerHTML = renderFooter();
    // Cột "Sản phẩm" chỉ chứa danh mục THẬT SỰ có hàng (footer vẽ trước khi
    // nạp danh mục nên phải vá sau, không chặn lần vẽ đầu).
    hydrateFooterCategories().catch(() => { /* bỏ qua: footer vẫn dùng được */ });
  }

  // AI widget (một lần duy nhất)
  if (!document.getElementById('ai-fab')) {
    const wrap = document.createElement('div');
    wrap.innerHTML = renderAiWidget();
    document.body.appendChild(wrap);
    bindAiWidget();
  }

  /*
   * Skip link + landmark <main>. Đặt một lần ở đây để mọi route đều có, thay
   * vì sửa từng trang: người dùng bàn phím cần nhảy thẳng qua header
   * (WCAG 2.4.1) và trình đọc màn hình cần landmark nội dung chính (1.3.1).
   */
  if (!document.getElementById('skip-link')) {
    const skip = document.createElement('a');
    skip.id = 'skip-link';
    skip.className = 'skip-link';
    skip.href = '#main-content';
    skip.textContent = 'Bỏ qua điều hướng, tới nội dung chính';
    document.body.insertBefore(skip, document.body.firstChild);
  }

  void app;
}

/**
 * Bọc nội dung trang trong <main> — BỎ header/footer ra ngoài.
 *
 * ============================================================================
 * LỖI ĐÃ SỬA (audit web, severity high): <header> và <footer> NẰM TRONG <main>
 *
 * Bản cũ gọi `ensureMain(app)` TRƯỚC `mountChrome(app)`:
 *
 *     app.innerHTML = matched.render();
 *     ensureMain(app);     // chuyển MỌI con của #app vào <main>
 *     mountChrome(app);    // rồi đổ header/footer vào các placeholder
 *
 * `#site-header` và `#site-footer` nằm trong markup của trang, nên bước
 * ensureMain chuyển chúng VÀO <main>. Sau đó mountChrome đổ header/footer vào
 * chính hai placeholder đã nằm trong <main>. Kết quả DOM:
 *
 *     <main> <header>…</header> …nội dung… <footer>…</footer> </main>
 *
 * Đây là cấu trúc NGƯỢC với WCAG 1.3.1: trình đọc màn hình coi toàn bộ điều
 * hướng nằm trong vùng "nội dung chính", và landmark `banner`/`contentinfo`
 * mất tác dụng. Comment cũ trong code khẳng định "header/footer được render
 * sau nên nằm ngoài <main> — đúng cấu trúc" — điều đó SAI so với chính code.
 *
 * NAY: `ensureMain` chỉ chuyển các node KHÔNG PHẢI placeholder chrome vào
 * <main>, và tự chèn <main> vào đúng vị trí giữa header và footer.
 * ============================================================================
 */
const CHROME_IDS = new Set(['site-header', 'site-footer', 'skip-link']);

function isChromeNode(node) {
  if (!node || node.nodeType !== 1) return false;
  if (CHROME_IDS.has(node.id)) return true;
  // AI widget + toast + modal là overlay, không thuộc nội dung chính.
  if (node.id === 'ai-fab') return true;
  return false;
}

function ensureMain(app) {
  const existing = app.querySelector('main#main-content');
  if (existing) return existing;

  const main = document.createElement('main');
  main.id = 'main-content';
  main.tabIndex = -1;

  /*
   * Thu thập nội dung TRƯỚC khi di chuyển: vừa append vừa duyệt trên cùng một
   * danh sách con sẽ bỏ sót node (vì appendChild lấy node ra khỏi #app).
   */
  const content = [];
  for (const node of Array.from(app.childNodes)) {
    if (!isChromeNode(node)) content.push(node);
  }
  for (const node of content) main.appendChild(node);

  /*
   * Chèn <main> vào ĐÚNG VỊ TRÍ: ngay sau header (nếu trang có), trước footer.
   * Nếu không có header thì chèn ở đầu.
   */
  const headerEl = app.querySelector('#site-header');
  if (headerEl && headerEl.parentNode === app) {
    headerEl.insertAdjacentElement('afterend', main);
  } else {
    app.insertBefore(main, app.firstChild);
  }

  /* Footer phải đứng SAU <main> — đưa về cuối nếu nó bị kẹt phía trước. */
  const footerEl = app.querySelector('#site-footer');
  if (footerEl && footerEl.parentNode === app) {
    app.appendChild(footerEl);
  }

  return main;
}

/**
 * Tiêu đề trang theo route.
 *
 * Bản cũ không đặt `document.title` ở đâu cả, nên mọi trang đều mang tiêu đề
 * tĩnh của index.html. Hệ quả với người dùng thật: mở nhiều tab thì không
 * phân biệt được, bookmark lưu sai tên, và trình đọc màn hình đọc một câu
 * không liên quan tới nội dung đang xem.
 *
 * Bảng dưới đây cố ý đặt ở client (không phải server) vì SPA dùng hash router:
 * server không bao giờ thấy phần sau `#`.
 */
const TITLES = {
  '/': 'Một app, hai tính năng — map sáng & tài nguyên',
  '/products': 'Bảng giá',
  '/product': 'Chi tiết gói',
  '/login': 'Đăng nhập',
  '/register': 'Tạo tài khoản',
  '/checkout': 'Thanh toán',
  '/account': 'Tài khoản của tôi',
  '/orders': 'Đơn hàng của tôi',
  '/licenses': 'Quyền & thiết bị',
  '/support': 'Hỗ trợ',
  '/huong-dan': 'Hướng dẫn cài đặt',
  '/tai-ve': 'Tải app',
  '/admin': 'Quản trị',
};

const SITE = 'XA ARENA';

function routeTitleKey(path) {
  if (path === '/') return '/';
  if (/^\/product\/[^/]+$/.test(path)) return '/product';
  if (/^\/order\/[^/]+$/.test(path)) return '/checkout';
  if (path === '/wallet') return '/orders';
  return Object.prototype.hasOwnProperty.call(TITLES, path) ? path : null;
}

let lastTitleSet = '';

function applyRouteTitle(route, param, matched) {
  const key = routeTitleKey(route.path);
  const base = key ? TITLES[key] : null;
  let title;
  if (!base) {
    title = `Không tìm thấy trang · ${SITE}`;
  } else if (key === '/product' && param) {
    // Tên sản phẩm thật được ghi đè sau khi trang nạp xong (xem setPageTitle).
    title = `${base} · ${SITE}`;
  } else {
    title = `${base} · ${SITE}`;
  }
  document.title = title;
  lastTitleSet = title;
  void matched;
}

/**
 * Cho trang tự đặt tiêu đề chi tiết hơn (vd tên sản phẩm) sau khi có dữ liệu.
 * Chỉ nhận khi người dùng chưa chuyển sang route khác trong lúc nạp.
 */
export function setPageTitle(detail) {
  const d = String(detail || '').trim();
  if (!d) return;
  document.title = `${d} · ${SITE}`;
  lastTitleSet = document.title;
}

/**
 * Đưa focus vào <main> khi THẬT SỰ đổi trang.
 *
 * Vì sao cần: SPA thay toàn bộ `#app` bằng `innerHTML`, nên node đang giữ focus
 * (link vừa bấm) bị xoá khỏi DOM. Trình duyệt đẩy focus về <body>, và người
 * dùng bàn phím phải Tab lại từ đầu trang — họ không biết mình vừa đi đâu.
 *
 * Không làm ở lần tải đầu tiên: lúc đó focus nên ở đầu tài liệu.
 * Không cướp focus khi người dùng đang gõ trong một ô nhập (ví dụ ô tìm kiếm
 * tự điều hướng) — trường hợp đó do trang tự xử lý.
 */
let hasRenderedOnce = false;

function focusMainIfNavigating() {
  const first = !hasRenderedOnce;
  hasRenderedOnce = true;
  if (first) return;

  const active = document.activeElement;
  if (active) {
    const tag = String(active.tagName || '').toLowerCase();
    const isTyping = tag === 'input' || tag === 'textarea' || tag === 'select'
      || active.isContentEditable;
    // Ô nhập còn nằm trong DOM = trang cố ý giữ focus (xem products.js).
    if (isTyping && document.body.contains(active)) return;
  }

  const main = document.getElementById('main-content');
  if (main) {
    try { main.focus({ preventScroll: true }); } catch { /* trình duyệt cũ */ }
  }
}

/** Lấy tiêu đề hiện tại — dùng cho kiểm thử. */
export function currentPageTitle() {
  return lastTitleSet;
}

/**
 * Số thứ tự điều hướng. router() giờ có 2 điểm await (lazy chunk + nạp auth)
 * nên nếu khách bấm link trong lúc còn đang nạp, lượt cũ phải TỰ BỎ thay vì
 * mount chồng lên trang mới.
 */
let navSeq = 0;

async function router() {
  const seq = ++navSeq;
  const route = parseRoute();
  const app = document.getElementById('app');
  if (!app) return;

  /*
   * Giỏ hàng ĐÃ BỊ GỠ HOÀN TOÀN. Link cũ (#/cart trong bookmark, tin nhắn cũ)
   * được đưa thẳng về danh sách sản phẩm thay vì trả 404.
   */
  if (route.path === '/cart') {
    navigate('/products', { replace: true });
    return;
  }

  // Đóng mọi modal khi chuyển trang. Modal phải đóng qua close() của nó: xoá
  // node trực tiếp sẽ bỏ sót listener Escape trên document và không trả focus.
  closeAllModals();

  /*
   * ========================================================================
   * F12 — DỌN SẠCH TRANG CŨ TRƯỚC KHI RỜI
   *
   * `routeCtx.dispose()` làm hai việc:
   *   1. `abort()` mọi fetch của trang cũ -> phản hồi về muộn không ghi đè
   *      DOM của trang mới;
   *   2. chạy mọi hàm dọn trang đăng ký (clearInterval của poll 4 giây, gỡ
   *      listener trên window/document).
   *
   * Bản cũ chỉ gọi `currentCleanup` — và biến đó CHỈ được gán nếu trang trả
   * về một hàm. Các trang dùng setInterval/addEventListener mà quên trả về
   * là rò rỉ im lặng. Nay `routeContext` là chỗ duy nhất để đăng ký.
   * ========================================================================
   */
  if (routeCtx) {
    try { routeCtx.dispose(); } catch { /* không chặn điều hướng */ }
    routeCtx = null;
  }
  routeCtx = routeContext();
  const ctx = routeCtx;

  if (currentCleanup) {
    try { currentCleanup(); } catch { /* ignore */ }
    currentCleanup = null;
  }

  let matched = null;
  let param = null;
  for (const r of ROUTES) {
    const m = route.path.match(r.pattern);
    if (m) { matched = r; param = m[1] ? decodeURIComponent(m[1]) : null; break; }
  }

  if (!matched) {
    app.innerHTML = renderNotFound();
    /* 404 cũng phải đi qua ensureMain để giữ đúng cấu trúc landmark. */
    ensureMain(app);
    mountChrome(app);
    bindNotFound(app);
    document.title = `Không tìm thấy trang · ${SITE}`;
    window.scrollTo(0, 0);
    focusMainIfNavigating();
    return;
  }

  /*
   * Route nạp theo yêu cầu (hiện chỉ /admin). Chỉ tải chunk khi vào đúng
   * trang; lỗi mạng/chunk -> trang 404 sạch thay vì trắng màn hình.
   */
  if (typeof matched.load === 'function') {
    try {
      matched = { ...matched, ...(await matched.load()) };
    } catch (e) {
      console.error('Route load error:', e);
      app.innerHTML = renderNotFound();
      ensureMain(app);
      mountChrome(app);
      bindNotFound(app);
      document.title = `Không tìm thấy trang · ${SITE}`;
      window.scrollTo(0, 0);
      return;
    }
    if (seq !== navSeq) return; // đã có điều hướng mới hơn
  }

  /*
   * VẼ SHELL NGAY (P0): markup của mọi trang là HTML tĩnh, không phụ thuộc
   * /api/auth/me. Trước đây boot chờ auth+danh mục (~650ms) rồi mới vẽ nên
   * khách nhìn màn hình chờ suốt thời gian đó.
   */
  app.innerHTML = matched.render(route.query || {}, param);
  /*
   * Bọc nội dung trong <main> SAU khi render và TRƯỚC mountChrome.
   *
   * `ensureMain` giờ bỏ header/footer ra ngoài <main> (xem giải thích dài
   * trong hàm), nên thứ tự ensureMain -> mountChrome là an toàn: <main> được
   * chèn giữa hai placeholder, rồi header/footer được đổ vào đúng chỗ của
   * chúng ở ngoài <main>.
   */
  ensureMain(app);
  mountChrome(app);
  window.scrollTo({ top: 0, behavior: 'instant' });

  /*
   * ========================================================================
   * TIÊU ĐỀ TRANG + THÔNG BÁO CHUYỂN TRANG (audit web, severity medium)
   *
   * LỖI CŨ: SPA KHÔNG BAO GIỜ cập nhật `document.title` (grep toàn bộ assets/
   * không có kết quả nào) và KHÔNG quản lý focus khi đổi route.
   *
   * Hệ quả:
   *   • Mọi route dùng chung tiêu đề của index.html → lịch sử trình duyệt,
   *     bookmark và tab đều giống nhau; SEO kém; screen reader đọc sai tên
   *     trang.
   *   • Người dùng bàn phím/trình đọc màn hình bấm link xong KHÔNG biết đã
   *     chuyển trang, vì focus vẫn nằm ở link vừa bấm trong DOM đã bị xoá.
   *
   * Nay: đặt `document.title` theo route và đưa focus vào <main> (WCAG 2.4.3
   * Focus Order). Không cuộn thêm vì đã scrollTo ở trên.
   * ========================================================================
   */
  applyRouteTitle(route, param, matched);
  focusMainIfNavigating();

  /*
   * Nạp auth + danh mục SAU khi đã vẽ (không chặn lần vẽ đầu).
   * Ở lần điều hướng sau, promise này đã xong nên không chờ gì cả.
   *
   * Vì sao vẫn phải await TRƯỚC mount(): các trang orders/licenses/account/
   * admin/checkout đọc state.user ngay trong mount và tự chuyển sang /login
   * nếu null -> chạy mount trước khi auth xong sẽ đá khách đã đăng nhập ra
   * trang đăng nhập. Đổi đúng thứ tự: shell trước, auth sau, nội dung cuối.
   */
  await hydrateState();
  if (seq !== navSeq) return; // khách đã chuyển trang trong lúc nạp auth

  /*
   * Truyền `ctx` xuống trang qua tham số thứ ba của mount.
   *
   * Trang nào nhận `ctx` thì dùng `ctx.signal` cho mọi request và
   * `ctx.setInterval()` / `ctx.listen()` cho mọi thứ cần dọn — router tự
   * dispose khi rời trang nên không còn rò rỉ.
   *
   * Trang cũ chưa nhận `ctx` vẫn chạy bình thường (tham số thừa bị bỏ qua);
   * hàm cleanup mà trang trả về vẫn được giữ như trước.
   */
  try {
    let cleanup;
    if (matched.param) {
      cleanup = await matched.mount(app, param, route.query || {}, ctx);
    } else {
      cleanup = await matched.mount(app, route.query || {}, ctx);
    }
    if (typeof cleanup === 'function') currentCleanup = cleanup;
  } catch (e) {
    /*
     * Lỗi do HUỶ (khách vừa chuyển trang) không phải sự cố — không hiện
     * thông báo lỗi trên trang mới.
     */
    if (isAborted(e) || seq !== navSeq) return;
    console.error('Mount error:', e);
    const contentHost = app.querySelector('.container') || app;
    if (app.querySelector('.empty-state') === null) {
      contentHost.insertAdjacentHTML('afterbegin',
        `<div class="alert alert-error"><span class="ico">${icon('alert', { size: 15 })}</span><span>${esc(e.message || 'Đã có lỗi xảy ra')}</span></div>`);
    }
  }

  // Đã có điều hướng mới hơn trong lúc mount -> không gắn gì vào DOM cũ.
  if (seq !== navSeq) return;

  /*
   * Gắn fallback ảnh sau khi trang render xong. CSP đặt `script-src 'self'`
   * nên không thể dùng thuộc tính onerror trong HTML; đây là chỗ duy nhất
   * đảm bảo mọi <img data-img-fallback> đều có xử lý lỗi.
   */
  bindImageFallbacks(app);
  bindScrollHints(app);
  labelBuyButtons(app);

  // Cuộn tới anchor nếu có (#/support#warranty)
  if (route.anchor) {    const el = document.getElementById(route.anchor);
    if (el) setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150);
  }
  // Dọn toast cũ khi chuyển trang
  document.querySelectorAll('.toast-wrap .toast').forEach((t) => t.remove());
}

/* ---------------- Mua ngay (không còn giỏ hàng) ---------------- */

/**
 * Nút mua trên thẻ sản phẩm (do home.js vẽ) luôn ghi đúng luồng: "Mua ngay".
 * home.js nằm ngoài phạm vi sửa nên nhãn được chuẩn hoá ở đây, sau khi trang
 * đã mount xong (mọi trang đều nạp danh sách trong chính mount của nó).
 */
function labelBuyButtons(root) {
  root.querySelectorAll('[data-add]').forEach((btn) => {
    if (!btn.dataset.add || btn.disabled) return;
    btn.textContent = 'Mua ngay';
  });
}

/**
 * Bắt cú bấm "Mua" ở pha CAPTURE trên document.
 *
 * Thẻ sản phẩm của home.js gắn `data-add="<id>"` và bindProductCards() gắn
 * addToCart cho chúng. Giỏ hàng đã bị gỡ, nên mọi nút chưa được trang tự gắn
 * luồng mua (`data-buy-bound="1"`, xem bindBuyNowCards trong checkout.js) đều
 * được chuyển thẳng sang "Mua ngay". stopPropagation ở pha capture khiến
 * listener addToCart không bao giờ chạy.
 */
function bindBuyNow() {
  document.addEventListener('click', (e) => {
    const el = e.target && e.target.closest ? e.target.closest('[data-add]') : null;
    if (!el || el.disabled || !el.dataset.add || el.dataset.buyBound === '1') return;
    e.preventDefault();
    e.stopPropagation();
    buyNowById(el.dataset.add);
  }, true);
}

/* ---------------- Khởi tạo ---------------- */

/**
 * Nạp trạng thái mà header + các trang cần (auth, danh mục) — MỘT LẦN.
 *
 * Không chặn lần vẽ đầu: router vẽ shell trước rồi mới await promise này.
 * loadUser() và loadCategories() chạy SONG SONG (trước đây cũng vậy, nhưng
 * cả hai đều bị chờ TRƯỚC khi vẽ).
 */
let hydration = null;
function hydrateState() {
  if (!hydration) {
    hydration = Promise.all([loadUser(), loadCategories()])
      .catch((e) => console.warn('Boot warning:', e))
      .then(() => {
        // Auth xong -> thay skeleton bằng trạng thái thật.
        const headerHost = document.getElementById('site-header');
        if (headerHost) {
          headerHost.innerHTML = renderHeader();
          bindHeader();
        }
      });
  }
  return hydration;
}

async function boot() {
  // Bắt đầu nạp auth + danh mục NGAY, song song với việc vẽ shell bên dưới.
  const hydrated = hydrateState();

  // Refresh header khi đăng nhập/đăng xuất
  window.addEventListener('app:refresh-header', () => {
    const headerHost = document.getElementById('site-header');
    if (headerHost) {
      headerHost.innerHTML = renderHeader();
      bindHeader();
    }
  });

  // Router
  window.addEventListener('hashchange', router);
  // "Mua ngay" cho mọi nút mua chưa được trang tự gắn (xem bindBuyNow).
  bindBuyNow();

  if (!location.hash) history.replaceState(null, '', '#/');

  /*
   * Trước đây: boot chờ /api/auth/me + /api/categories (~650ms) rồi mới gọi
   * router() => khách nhìn .boot-screen (position:fixed, z-index 9999) suốt
   * thời gian đó. Nay router() được gọi ngay: nó thay #app bằng markup trang
   * ở nhịp đồng bộ đầu tiên (trừ route lazy /admin), nên .boot-screen bị
   * chính lần vẽ đó xoá và nội dung hiện ra ở ~0ms.
   */
  const nav = router();
  await nav;
  await hydrated;

  // Xoá boot screen (nếu router chưa kịp thay #app)
  document.querySelector('.boot-screen')?.remove();

  /*
   * Làm mới phiên đăng nhập định kỳ + khi quay lại tab.
   *
   * Trước đây chỗ này là `setInterval(() => {}, 60000)` và một listener
   * `visibilitychange` rỗng — code chết, chỉ tốn một timer vĩnh viễn. Nay làm
   * thật: hỏi lại /api/auth/me để header biết phiên còn hiệu lực hay đã hết
   * hạn ở tab khác, và cập nhật số liệu trong state.user.
   */
  const sessionKey = () => (state.user ? (state.user.id || state.user.email || 'user') : null);

  const refreshSession = async () => {
    if (document.hidden) return;
    const before = sessionKey();
    await loadUser(); // tự nuốt 401, không ném lỗi
    if (before !== sessionKey()) {
      window.dispatchEvent(new CustomEvent('app:refresh-header'));
    }
  };

  setInterval(refreshSession, 60000);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshSession();
  });
}

boot();

/* Global error handler */
window.addEventListener('unhandledrejection', (e) => {
  if (e.reason && e.reason.message && e.reason.status) {
    toast(e.reason.message, 'error');
    e.preventDefault();
  }
});

export { navigate, loadingBlock };
