/** MuaBanKey SPA — bộ định tuyến & khởi tạo. */
import { parseRoute, navigate, toast, loadingBlock, esc, bindImageFallbacks, bindScrollHints, closeAllModals } from './lib.js';
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

/** Bọc nội dung trang trong <main> nếu trang chưa tự làm. */
function ensureMain(app) {
  if (app.querySelector('main#main-content')) return;
  const main = document.createElement('main');
  main.id = 'main-content';
  main.tabIndex = -1;
  // Chuyển toàn bộ con hiện có vào <main>, giữ nguyên thứ tự và event listener.
  while (app.firstChild) main.appendChild(app.firstChild);
  app.appendChild(main);
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
    mountChrome(app);
    bindNotFound(app);
    window.scrollTo(0, 0);
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
      mountChrome(app);
      bindNotFound(app);
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
   * Bọc nội dung trong <main> NGAY sau khi render, trước mountChrome: skip
   * link `#main-content` cần đích tồn tại, và trình đọc màn hình cần landmark
   * nội dung chính (WCAG 1.3.1 + 2.4.1). Header/footer được render sau nên
   * nằm ngoài <main> — đúng cấu trúc.
   */
  ensureMain(app);
  mountChrome(app);
  window.scrollTo({ top: 0, behavior: 'instant' });

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
   * Trang có thể trả về hàm dọn dẹp (vd checkout phải clear poll timer).
   * Trước đây biến currentCleanup được khai báo và gọi nhưng KHÔNG trang nào
   * gán, nên poll 4s tiếp tục chạy sau khi rời trang.
   */
  try {
    let cleanup;
    if (matched.param) cleanup = await matched.mount(app, param, route.query || {});
    else cleanup = await matched.mount(app, route.query || {});
    if (typeof cleanup === 'function') currentCleanup = cleanup;
  } catch (e) {
    console.error('Mount error:', e);
    const contentHost = app.querySelector('.container') || app;
    if (app.querySelector('.empty-state') === null) {
      contentHost.insertAdjacentHTML('afterbegin',
        `<div class="alert alert-error"><span class="ico">${icon('alert', { size: 15 })}</span><span>${esc(e.message || 'Đã có lỗi xảy ra')}</span></div>`);
    }
  }

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
