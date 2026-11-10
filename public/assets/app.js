/** MuaBanKey SPA — bộ định tuyến & khởi tạo. */
import { parseRoute, navigate, toast, loadingBlock } from './lib.js';
import { state, loadUser, loadCategories, refreshBalance } from './state.js';
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

function renderNotFound(app) {
  return `
  <div id="site-header"></div>
  <div class="container section" style="text-align:center;min-height:60vh;display:grid;place-items:center">
    <div>
      <div style="font-size:80px;margin-bottom:16px">🔍</div>
      <h1 style="font-size:2rem;font-weight:800;letter-spacing:-.03em;margin-bottom:10px">Không tìm thấy trang</h1>
      <p style="color:var(--text-dim);margin-bottom:24px">Đường dẫn bạn truy cập không tồn tại hoặc đã bị di chuyển.</p>
      <button class="btn btn-primary" onclick="location.hash='#/'">← Về trang chủ</button>
    </div>
  </div>
  <div id="site-footer"></div>`;
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

  void app;
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
    app.innerHTML = renderNotFound(app);
    mountChrome(app);
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
        `<div class="alert alert-error"><span class="ico">⚠️</span><span>${e.message || 'Đã có lỗi xảy ra'}</span></div>`);
    }
  }

  // Cuộn tới anchor nếu có (#/support#warranty)
  if (route.anchor) {
    const el = document.getElementById(route.anchor);
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
