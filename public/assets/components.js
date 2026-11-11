/** Các component tái sử dụng: header, footer, cart drawer, AI chat. */
import { state, notify, cartCount, cartSubtotal, updateCartQty, removeFromCart, clearCart, addToCart, loadUser, refreshBalance } from './state.js';
import { api, esc, fmtVnd, toast, navigate, copyText, confirmDialog, openModal } from './lib.js';
import { icon } from './icons.js';

/* ---------------- Header ---------------- */
export function renderHeader() {
  const u = state.user;
  const path = (location.hash.slice(1).split('?')[0]) || '/';
  const isActive = (p) => (p === '/' ? path === '/' : path.startsWith(p));

  const userArea = u
    ? `<button class="balance-chip" data-nav="/wallet" title="Số dư ví" aria-label="Số dư ví, mở trang nạp tiền">
         ${icon('wallet', { size: 14 })}
         <span id="balance-chip">${new Intl.NumberFormat('vi-VN').format(u.balance)}₫</span>
       </button>
       <button class="icon-btn" data-nav="/account" aria-label="Tài khoản">
         <span style="font-size:11.5px;font-weight:600">${esc((u.fullName || u.email || 'U')[0].toUpperCase())}</span>
       </button>
       ${u.role === 'admin' || u.role === 'staff'
         ? `<button class="icon-btn" data-nav="/admin" aria-label="Quản trị" title="Quản trị">${icon('sliders', { size: 15 })}</button>`
         : ''}
       <button class="icon-btn" id="btn-logout" aria-label="Đăng xuất" title="Đăng xuất">${icon('logout', { size: 15 })}</button>`
    : `<button class="btn btn-ghost btn-sm" data-nav="/login">Đăng nhập</button>
       <button class="btn btn-primary btn-sm" data-nav="/register">Đăng ký</button>`;

  return `
  <header class="header" id="main-header">
    <div class="header-inner">
      <button class="icon-btn nav-toggle" id="nav-toggle" aria-label="Mở menu điều hướng"
        aria-expanded="false" aria-controls="mobile-nav">
        ${icon('menu', { size: 16 })}
      </button>
      <a href="#/" class="logo" aria-label="MuaBanKey — trang chủ">
        <div class="logo-mark">${icon('key', { size: 16, stroke: 1.8 })}</div>
        <div class="logo-text">Mua<b>Ban</b>Key</div>
      </a>
      <nav class="nav" aria-label="Điều hướng chính">
        <a href="#/" class="nav-link ${isActive('/') ? 'active' : ''}">Trang chủ</a>
        <a href="#/products" class="nav-link ${isActive('/products') ? 'active' : ''}">Sản phẩm</a>
        <a href="#/orders" class="nav-link ${isActive('/orders') ? 'active' : ''}">Đơn hàng</a>
        <a href="#/wallet" class="nav-link ${isActive('/wallet') ? 'active' : ''}">Nạp tiền</a>
        <a href="#/support" class="nav-link ${isActive('/support') ? 'active' : ''}">Hỗ trợ</a>
      </nav>
      <div class="search-mini">
        ${icon('search', { size: 14 })}
        <input type="search" id="search-input" placeholder="Tìm sản phẩm..." aria-label="Tìm kiếm sản phẩm">
      </div>
      <div class="header-actions">
        <button class="icon-btn" id="btn-cart" aria-label="Giỏ hàng" title="Giỏ hàng">
          ${icon('cart', { size: 15 })}
          <span class="badge-dot" id="cart-badge" style="display:none" aria-hidden="true">0</span>
        </button>
        ${userArea}
      </div>
    </div>
    <div class="mobile-nav" id="mobile-nav">
      <nav aria-label="Điều hướng di động">
        <a href="#/" class="mobile-nav-link ${isActive('/') ? 'active' : ''}">${icon('home', { size: 15 })} Trang chủ</a>
        <a href="#/products" class="mobile-nav-link ${isActive('/products') ? 'active' : ''}">${icon('grid', { size: 15 })} Sản phẩm</a>
        <a href="#/orders" class="mobile-nav-link ${isActive('/orders') ? 'active' : ''}">${icon('receipt', { size: 15 })} Đơn hàng</a>
        <a href="#/wallet" class="mobile-nav-link ${isActive('/wallet') ? 'active' : ''}">${icon('wallet', { size: 15 })} Nạp tiền</a>
        <a href="#/support" class="mobile-nav-link ${isActive('/support') ? 'active' : ''}">${icon('help', { size: 15 })} Hỗ trợ</a>
      </nav>
    </div>
  </header>`;
}

export function bindHeader() {
  const header = document.getElementById('main-header');
  if (header) {
    const onScroll = () => header.classList.toggle('scrolled', window.scrollY > 10);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  document.querySelectorAll('[data-nav]').forEach((el) => {
    el.addEventListener('click', () => navigate(el.dataset.nav));
  });

  const cartBtn = document.getElementById('btn-cart');
  if (cartBtn) cartBtn.addEventListener('click', openCartDrawer);

  const logoutBtn = document.getElementById('btn-logout');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      try {
        await api('/api/auth/logout', { method: 'POST' });
        state.user = null;
        notify();
        toast('Đã đăng xuất', 'success');
        renderHeaderAndMount();
        navigate('/');
      } catch (e) {
        toast(e.message, 'error');
      }
    });
  }

  const search = document.getElementById('search-input');
  if (search) {
    search.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const q = search.value.trim();
        navigate(q ? `/products?q=${encodeURIComponent(q)}` : '/products');
      }
    });
  }

  /*
   * Menu di động. Trước đây .nav bị ẩn dưới 900px mà không có phương án thay
   * thế, nên trên điện thoại không có cách nào tới Đơn hàng / Nạp tiền / Hỗ trợ.
   * Menu đóng khi chọn một mục, bấm ngoài, hoặc nhấn Escape.
   */
  const navToggle = document.getElementById('nav-toggle');
  const mobileNav = document.getElementById('mobile-nav');
  if (navToggle && mobileNav) {
    const setOpen = (open) => {
      mobileNav.classList.toggle('open', open);
      navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      navToggle.setAttribute('aria-label', open ? 'Đóng menu điều hướng' : 'Mở menu điều hướng');
    };
    navToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      setOpen(!mobileNav.classList.contains('open'));
    });
    mobileNav.querySelectorAll('a').forEach((a) => {
      a.addEventListener('click', () => setOpen(false));
    });
    document.addEventListener('click', (e) => {
      if (!mobileNav.classList.contains('open')) return;
      if (mobileNav.contains(e.target) || navToggle.contains(e.target)) return;
      setOpen(false);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && mobileNav.classList.contains('open')) {
        setOpen(false);
        navToggle.focus();
      }
    });
  }

  const badge = document.getElementById('cart-badge');
  if (badge) {
    const n = cartCount();
    badge.textContent = n > 99 ? '99+' : String(n);
    badge.style.display = n > 0 ? 'grid' : 'none';
  }
}

export function renderHeaderAndMount() {
  const host = document.getElementById('site-header');
  if (host) {
    host.innerHTML = renderHeader();
    bindHeader();
  }
}

/* ---------------- Cart drawer ---------------- */
export function openCartDrawer() {
  let overlay = document.getElementById('drawer-overlay');
  let drawer = document.getElementById('cart-drawer');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'drawer-overlay';
    overlay.id = 'drawer-overlay';
    document.body.appendChild(overlay);
  }
  if (!drawer) {
    drawer = document.createElement('aside');
    drawer.className = 'drawer';
    drawer.id = 'cart-drawer';
    drawer.setAttribute('role', 'dialog');
    drawer.setAttribute('aria-label', 'Giỏ hàng');
    document.body.appendChild(drawer);
  }
  overlay.onclick = closeCartDrawer;
  renderCartDrawer(drawer);
  requestAnimationFrame(() => {
    overlay.classList.add('open');
    drawer.classList.add('open');
  });
  const closeBtn = drawer.querySelector('#close-cart');
  if (closeBtn) closeBtn.focus();
}

export function closeCartDrawer() {
  document.getElementById('drawer-overlay')?.classList.remove('open');
  document.getElementById('cart-drawer')?.classList.remove('open');
}

function renderCartDrawer(drawer) {
  const items = state.cart;
  const subtotal = cartSubtotal();

  drawer.innerHTML = `
    <div class="drawer-head">
      <div>
        <div class="drawer-title">${icon('cart', { size: 16 })} Giỏ hàng</div>
        <div style="font-size:12px;color:var(--text-mute);margin-top:2px">${items.length} sản phẩm</div>
      </div>
      <button class="icon-btn" id="close-cart" style="width:30px;height:30px" aria-label="Đóng giỏ hàng">
        ${icon('x', { size: 14 })}
      </button>
    </div>
    <div class="drawer-body" id="cart-body">
      ${items.length === 0
        ? `<div class="empty-state">
             <div class="ico">${icon('cart', { size: 28 })}</div>
             <div class="t">Giỏ hàng trống</div>
             <div class="d">Khám phá các sản phẩm bản quyền chất lượng</div>
             <button class="btn btn-primary btn-sm" data-nav-close="/products">Xem sản phẩm</button>
           </div>`
        : items.map((i) => `
            <div class="cart-item" data-pid="${esc(i.productId)}">
              <img class="cart-thumb" src="${esc(i.imageUrl || '')}" alt="" loading="lazy"
                data-img-fallback="class">
              <div class="cart-info">
                <div class="cart-name">${esc(i.name)}</div>
                <div class="cart-price">${fmtVnd(i.price)}</div>
                <div class="qty-ctrl" style="margin-top:7px;height:28px">
                  <button data-dec aria-label="Giảm số lượng" style="width:28px;height:26px">${icon('minus', { size: 12 })}</button>
                  <input value="${i.quantity}" data-qty readonly aria-label="Số lượng" style="width:34px;height:26px;font-size:12.5px">
                  <button data-inc aria-label="Tăng số lượng" style="width:28px;height:26px">${icon('plus', { size: 12 })}</button>
                </div>
              </div>
              <button class="cart-remove" data-rm aria-label="Xoá khỏi giỏ">${icon('x', { size: 14 })}</button>
            </div>`).join('')}
    </div>
    ${items.length > 0 ? `
    <div class="drawer-foot">
      <div class="summary-row"><span>Tạm tính</span><span>${fmtVnd(subtotal)}</span></div>
      <div class="summary-row total"><span>Tổng cộng</span><span class="val">${fmtVnd(subtotal)}</span></div>
      <button class="btn btn-primary btn-block mt-2" id="goto-checkout">
        Thanh toán ${icon('arrowRight', { size: 14 })}
      </button>
      <button class="btn btn-ghost btn-block mt-1" id="clear-cart" style="font-size:12.5px">Xoá giỏ hàng</button>
    </div>` : ''}
  `;

  drawer.querySelector('#close-cart').onclick = closeCartDrawer;

  drawer.querySelectorAll('[data-nav-close]').forEach((b) => {
    b.onclick = () => { closeCartDrawer(); navigate(b.dataset.navClose); };
  });

  if (items.length > 0) {
    drawer.querySelector('#goto-checkout').onclick = () => {
      closeCartDrawer();
      if (!state.user) {
        toast('Vui lòng đăng nhập để thanh toán', 'info');
        navigate('/login?redirect=/checkout');
      } else {
        navigate('/checkout');
      }
    };
    drawer.querySelector('#clear-cart').onclick = async () => {
      if (await confirmDialog('Xoá giỏ hàng?', 'Toàn bộ sản phẩm trong giỏ sẽ bị xoá.', 'Xoá hết')) {
        clearCart();
        renderCartDrawer(drawer);
      }
    };
  }

  drawer.querySelectorAll('.cart-item').forEach((row) => {
    const pid = row.dataset.pid;
    row.querySelector('[data-inc]').onclick = () => {
      const it = state.cart.find((i) => i.productId === pid);
      updateCartQty(pid, it.quantity + 1);
      renderCartDrawer(drawer);
    };
    row.querySelector('[data-dec]').onclick = () => {
      const it = state.cart.find((i) => i.productId === pid);
      updateCartQty(pid, it.quantity - 1);
      renderCartDrawer(drawer);
    };
    row.querySelector('[data-rm]').onclick = () => {
      removeFromCart(pid);
      renderCartDrawer(drawer);
    };
  });
}

/* ---------------- Footer ---------------- */
export function renderFooter() {
  return `
  <footer class="footer">
    <div class="container">
      <div class="footer-grid">
        <div class="footer-brand">
          <div class="logo">
            <div class="logo-mark">${icon('key', { size: 16, stroke: 1.8 })}</div>
            <div class="logo-text">Mua<b>Ban</b>Key</div>
          </div>
          <p class="footer-desc">
            Nền tảng mua bán bản quyền số hàng đầu Việt Nam. Key chính hãng, giao tự động 24/7,
            bảo hành 1 đổi 1, thanh toán an toàn qua VietQR.
          </p>
          <div class="flex gap-1 mt-2" style="flex-wrap:wrap">
            <span class="pill pill-gray">${icon('lock', { size: 11 })} HTTPS</span>
            <span class="pill pill-gray">${icon('activity', { size: 11 })} Cloudflare 300+ PoP</span>
          </div>
        </div>
        <div class="footer-col">
          <h2 class="footer-h">Sản phẩm</h2>
          <a href="#/products?category=windows-office">Windows &amp; Office</a>
          <a href="#/products?category=ai-tools">Công cụ AI</a>
          <a href="#/products?category=thiet-ke">Thiết kế</a>
          <a href="#/products?category=giai-tri">Giải trí</a>
          <a href="#/products?category=lap-trinh">Lập trình</a>
        </div>
        <div class="footer-col">
          <h2 class="footer-h">Hỗ trợ</h2>
          <a href="#/support">Trung tâm hỗ trợ</a>
          <a href="#/support#warranty">Chính sách bảo hành</a>
          <a href="#/support#refund">Chính sách hoàn tiền</a>
          <a href="#/support#guide">Hướng dẫn kích hoạt</a>
          <a href="#/support#faq">Câu hỏi thường gặp</a>
        </div>
        <div class="footer-col">
          <h2 class="footer-h">Liên hệ</h2>
          <a href="https://t.me/muabankey" target="_blank" rel="noopener">${icon('send', { size: 13 })} Telegram</a>
          <a href="https://zalo.me/0836768597" target="_blank" rel="noopener">${icon('messageCircle', { size: 13 })} Zalo</a>
          <a href="mailto:support@muabankey.vn">${icon('mail', { size: 13 })} support@muabankey.vn</a>
          <a href="#/account">${icon('user', { size: 13 })} Tài khoản</a>
        </div>
      </div>
      <div class="footer-bottom">
        <div>© ${new Date().getFullYear()} MuaBanKey. Toàn quyền được bảo lưu.</div>
        <div>Vận hành trên Cloudflare Edge — 300+ điểm hiện diện toàn cầu</div>
      </div>
    </div>
  </footer>`;
}

/* ---------------- AI Chat ---------------- */
export function renderAiWidget() {
  return `
    <button class="ai-fab" id="ai-fab" aria-label="Mở trợ lý tư vấn" title="Trợ lý tư vấn">
      ${icon('sparkles', { size: 19 })}
    </button>
    <div class="ai-panel" id="ai-panel" role="dialog" aria-label="Trợ lý tư vấn">
      <div class="ai-head">
        <div class="ai-avatar">${icon('bot', { size: 17 })}</div>
        <div style="flex:1">
          <div class="ai-name">Key Bot</div>
          <div class="ai-status"><span class="dot"></span>Trực tuyến 24/7</div>
        </div>
        <button class="icon-btn" id="ai-close" style="width:28px;height:28px" aria-label="Đóng trợ lý">
          ${icon('x', { size: 13 })}
        </button>
      </div>
      <div class="ai-body" id="ai-body">
        <div class="ai-msg bot">
          Xin chào. Mình là Key Bot — cho mình biết bạn đang tìm phần mềm gì, mình sẽ gợi ý sản phẩm phù hợp nhất.
        </div>
        <div class="ai-sugg">
          <button class="ai-sugg-item" data-q="Tôi cần mua Windows 11 bản quyền">Mua Windows 11 bản quyền ${icon('arrowRight', { size: 12 })}</button>
          <button class="ai-sugg-item" data-q="Gói AI nào tốt nhất cho công việc?">Gói AI tốt nhất cho công việc ${icon('arrowRight', { size: 12 })}</button>
          <button class="ai-sugg-item" data-q="Hướng dẫn nạp tiền vào ví">Cách nạp tiền vào ví ${icon('arrowRight', { size: 12 })}</button>
        </div>
      </div>
      <div class="ai-input-row">
        <input class="ai-input" id="ai-input" placeholder="Nhập câu hỏi..." aria-label="Câu hỏi cho trợ lý">
        <button class="ai-send" id="ai-send" aria-label="Gửi">${icon('send', { size: 15 })}</button>
      </div>
    </div>`;
}

export function bindAiWidget() {
  const fab = document.getElementById('ai-fab');
  const panel = document.getElementById('ai-panel');
  const body = document.getElementById('ai-body');
  const input = document.getElementById('ai-input');
  const send = document.getElementById('ai-send');
  const close = document.getElementById('ai-close');
  if (!fab || !panel) return;

  const toggle = () => {
    panel.classList.toggle('open');
    if (panel.classList.contains('open')) setTimeout(() => input?.focus(), 220);
  };
  fab.onclick = toggle;
  if (close) close.onclick = () => panel.classList.remove('open');

  document.querySelectorAll('.ai-sugg-item').forEach((b) => {
    b.onclick = () => { input.value = b.dataset.q; sendMessage(); };
  });

  async function sendMessage() {
    const text = input.value.trim();
    if (!text || send.disabled) return;
    input.value = '';
    send.disabled = true;

    // Ẩn gợi ý
    body.querySelectorAll('.ai-sugg').forEach((s) => { s.style.display = 'none'; });

    body.insertAdjacentHTML('beforeend', `<div class="ai-msg user">${esc(text)}</div>`);
    const typingId = 'typing-' + Date.now();
    body.insertAdjacentHTML('beforeend',
      `<div class="ai-msg bot" id="${typingId}"><div class="typing"><span></span><span></span><span></span></div></div>`);
    body.scrollTop = body.scrollHeight;

    state.aiHistory.push({ role: 'user', content: text });

    try {
      const data = await api('/api/ai/chat', {
        method: 'POST',
        body: { message: text, history: state.aiHistory.slice(-6) },
      });
      document.getElementById(typingId)?.remove();
      body.insertAdjacentHTML('beforeend', `<div class="ai-msg bot">${esc(data.reply).replace(/\n/g, '<br>')}</div>`);
      state.aiHistory.push({ role: 'assistant', content: data.reply });

      if (data.suggestions && data.suggestions.length) {
        const sugg = document.createElement('div');
        sugg.className = 'ai-sugg';
        sugg.innerHTML = data.suggestions.map((s) => `
          <a class="ai-sugg-item" href="#/product/${esc(s.slug)}">
            ${esc(s.name)} <span class="p">${fmtVnd(s.price)}</span>
          </a>`).join('');
        body.appendChild(sugg);
        sugg.querySelectorAll('a').forEach((a) => {
          a.addEventListener('click', () => panel.classList.remove('open'));
        });
      }
    } catch (e) {
      document.getElementById(typingId)?.remove();
      body.insertAdjacentHTML('beforeend',
        `<div class="ai-msg bot">Xin lỗi, mình đang gặp sự cố kết nối. Bạn vui lòng thử lại hoặc liên hệ hỗ trợ qua Telegram nhé.</div>`);
    } finally {
      send.disabled = false;
      body.scrollTop = body.scrollHeight;
    }
  }

  send.onclick = sendMessage;
  input.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } };
}
