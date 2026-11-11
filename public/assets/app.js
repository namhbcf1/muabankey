/** MuaBanKey SPA — bộ định tuyến & khởi tạo. */
import { parseRoute, navigate, toast, loadingBlock, esc, bindImageFallbacks, bindScrollHints } from './lib.js';
import { state, loadUser, loadCategories, refreshBalance } from './state.js';
import { icon } from './icons.js';
import {
  renderHeader, bindHeader, renderFooter, renderAiWidget, bindAiWidget,
} from './components.js';

import { renderHome, mountHome } from './pages/home.js';
import { renderProducts, mountProducts } from './pages/products.js';
import { renderProductDetail, mountProductDetail } from './pages/product-detail.js';
import { renderLogin, mountLogin, renderRegister, mountRegister } from './pages/auth.js';
import { renderCheckout, mountCheckout } from './pages/checkout.js';
import { renderAccount, mountAccount } from './pages/account.js';
import { renderOrders, mountOrders } from './pages/orders.js';
import { renderWallet, mountWallet } from './pages/wallet.js';
import { renderSupport, mountSupport } from './pages/support.js';
import { renderLicenses, mountLicenses } from './pages/licenses.js';
import { renderAdmin, mountAdmin } from './pages/admin.js';

const ROUTES = [
  { pattern: /^\/$/, render: renderHome, mount: mountHome },
  { pattern: /^\/products$/, render: renderProducts, mount: mountProducts },
  { pattern: /^\/product\/([^/]+)$/, render: renderProductDetail, mount: mountProductDetail, param: true },
  { pattern: /^\/login$/, render: renderLogin, mount: mountLogin },
  { pattern: /^\/register$/, render: renderRegister, mount: mountRegister },
  { pattern: /^\/checkout$/, render: renderCheckout, mount: mountCheckout },
  { pattern: /^\/account$/, render: renderAccount, mount: mountAccount },
  { pattern: /^\/orders$/, render: renderOrders, mount: mountOrders },
  { pattern: /^\/wallet$/, render: renderWallet, mount: mountWallet },
  { pattern: /^\/licenses$/, render: renderLicenses, mount: mountLicenses },
  { pattern: /^\/support$/, render: renderSupport, mount: mountSupport },
  { pattern: /^\/admin$/, render: renderAdmin, mount: mountAdmin },
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

function mountChrome(app) {
  // Header
  const headerHost = document.getElementById('site-header');
  if (headerHost) {
    headerHost.innerHTML = renderHeader();
    bindHeader();
  }
  // Footer
  const footerHost = document.getElementById('site-footer');
  if (footerHost) footerHost.innerHTML = renderFooter();

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

async function router() {
  const route = parseRoute();
  const app = document.getElementById('app');
  if (!app) return;

  // Đóng mọi overlay (giỏ hàng, modal) khi chuyển trang
  document.getElementById('drawer-overlay')?.classList.remove('open');
  document.getElementById('cart-drawer')?.classList.remove('open');
  document.querySelectorAll('.modal-overlay.open').forEach((m) => m.remove());

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

  app.innerHTML = matched.render(route.query || {}, param);
  mountChrome(app);
  window.scrollTo({ top: 0, behavior: 'instant' });

  try {
    if (matched.param) await matched.mount(app, param, route.query || {});
    else await matched.mount(app, route.query || {});
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

  // Cuộn tới anchor nếu có (#/support#warranty)
  if (route.anchor) {    const el = document.getElementById(route.anchor);
    if (el) setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150);
  }
  // Dọn toast cũ khi chuyển trang
  document.querySelectorAll('.toast-wrap .toast').forEach((t) => t.remove());
  // Đóng cart drawer
  document.getElementById('drawer-overlay')?.classList.remove('open');
  document.getElementById('cart-drawer')?.classList.remove('open');
}

/* ---------------- Khởi tạo ---------------- */
async function boot() {
  try {
    await Promise.all([loadUser(), loadCategories()]);
  } catch (e) {
    console.warn('Boot warning:', e);
  }

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

  if (!location.hash) history.replaceState(null, '', '#/');
  await router();

  // Xoá boot screen
  document.querySelector('.boot-screen')?.remove();

  // Refresh số dư định kỳ (60s) khi đã đăng nhập
  setInterval(() => {
    if (state.user && !document.hidden) refreshBalance();
  }, 60000);

  // Làm mới khi quay lại tab
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && state.user) refreshBalance();
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
