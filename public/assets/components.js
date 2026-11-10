/** Các component tái sử dụng: header, footer, cart drawer, AI chat. */
import { state, notify, cartCount, cartSubtotal, updateCartQty, removeFromCart, clearCart, addToCart, loadUser, refreshBalance } from './state.js';
import { api, esc, fmtVnd, toast, navigate, copyText, confirmDialog, openModal } from './lib.js';

/* ---------------- Header ---------------- */
export function renderHeader() {
  const u = state.user;
  const path = (location.hash.slice(1).split('?')[0]) || '/';
  const isActive = (p) => (p === '/' ? path === '/' : path.startsWith(p));

  const userArea = u
    ? `<div class="balance-chip" id="balance-chip" title="Số dư ví">💰 ${new Intl.NumberFormat('vi-VN').format(u.balance)}₫</div>
       <button class="icon-btn" data-nav="/account" title="Tài khoản">
         <span style="font-size:15px">${esc((u.fullName || u.email)[0].toUpperCase())}</span>
       </button>
       ${u.role === 'admin' || u.role === 'staff'
         ? `<button class="btn btn-ghost btn-sm" data-nav="/admin">⚙️ Quản trị</button>`
         : ''}
       <button class="btn btn-ghost btn-sm" id="btn-logout" title="Đăng xuất">⏻</button>`
    : `<button class="btn btn-ghost btn-sm" data-nav="/login">Đăng nhập</button>
       <button class="btn btn-primary btn-sm" data-nav="/register">Đăng ký</button>`;

  return `
  <header class="header" id="main-header">
    <div class="header-inner">
      <a href="#/" class="logo">
        <div class="logo-mark">🔑</div>
        <div class="logo-text">MuaBanKey</div>
      </a>
      <nav class="nav">
        <a href="#/" class="nav-link ${isActive('/') ? 'active' : ''}">Trang chủ</a>
        <a href="#/products" class="nav-link ${isActive('/products') ? 'active' : ''}">Sản phẩm</a>
        <a href="#/orders" class="nav-link ${isActive('/orders') ? 'active' : ''}">Đơn hàng</a>
        <a href="#/wallet" class="nav-link ${isActive('/wallet') ? 'active' : ''}">Nạp tiền</a>
        <a href="#/support" class="nav-link ${isActive('/support') ? 'active' : ''}">Hỗ trợ</a>
      </nav>
      <div class="search-mini">
        <span style="color:var(--text-mute);font-size:14px">🔍</span>
        <input type="search" id="search-input" placeholder="Tìm key, phần mềm..." aria-label="Tìm kiếm sản phẩm">
      </div>
      <div class="header-actions">
        <button class="icon-btn" id="btn-cart" title="Giỏ hàng">
          🛒<span class="badge-dot" id="cart-badge" style="display:none">0</span>
        </button>
        ${userArea}
      </div>
    </div>
  </header>`;
}

export function bindHeader() {
  const header = document.getElementById('main-header');
  window.addEventListener('scroll', () => {
    if (header) header.classList.toggle('scrolled', window.scrollY > 10);
  }, { passive: true });

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
    document.body.appendChild(drawer);
  }
  overlay.onclick = closeCartDrawer;
  renderCartDrawer(drawer);
  requestAnimationFrame(() => {
    overlay.classList.add('open');
    drawer.classList.add('open');
  });
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
        <div class="drawer-title">🛒 Giỏ hàng</div>
        <div style="font-size:12.5px;color:var(--text-mute);margin-top:2px">${items.length} sản phẩm</div>
      </div>
      <button class="icon-btn" id="close-cart" style="width:36px;height:36px">✕</button>
    </div>
    <div class="drawer-body" id="cart-body">
      ${items.length === 0
        ? `<div class="empty-state">
             <div class="ico">🛒</div>
             <div class="t">Giỏ hàng trống</div>
             <div class="d">Khám phá các sản phẩm bản quyền chất lượng</div>
             <button class="btn btn-primary btn-sm" data-nav-close="/products">Xem sản phẩm</button>
           </div>`
        : items.map((i) => `
            <div class="cart-item" data-pid="${esc(i.productId)}">
              <img class="cart-thumb" src="${esc(i.imageUrl || '')}" alt="" loading="lazy"
                onerror="this.style.background='#1a1a2e';this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22%3E%3Ctext y=%22.9em%22 font-size=%2290%22%3E%F0%9F%94%91%3C/text%3E%3C/svg%3E'">
              <div class="cart-info">
                <div class="cart-name">${esc(i.name)}</div>
                <div class="cart-price">${fmtVnd(i.price)}</div>
                <div class="qty-ctrl" style="margin-top:7px;transform:scale(.86);transform-origin:left">
                  <button data-dec>−</button>
                  <input value="${i.quantity}" data-qty readonly aria-label="Số lượng">
                  <button data-inc>+</button>
                </div>
              </div>
              <button class="cart-remove" data-rm title="Xoá">✕</button>
            </div>`).join('')}
    </div>
    ${items.length > 0 ? `
    <div class="drawer-foot">
      <div class="summary-row"><span>Tạm tính</span><span>${fmtVnd(subtotal)}</span></div>
      <div class="summary-row total"><span>Tổng cộng</span><span class="val">${fmtVnd(subtotal)}</span></div>
      <button class="btn btn-primary btn-block mt-2" id="goto-checkout">Thanh toán ngay →</button>
      <button class="btn btn-ghost btn-block mt-1" id="clear-cart" style="font-size:13px">Xoá giỏ hàng</button>
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
          <div class="logo"><div class="logo-mark">🔑</div><div class="logo-text">MuaBanKey</div></div>
          <p class="footer-desc">
            Nền tảng mua bán bản quyền số hàng đầu Việt Nam. Key chính hãng, giao tự động 24/7,
            bảo hành 1 đổi 1, thanh toán an toàn qua VietQR.
          </p>
          <div class="flex gap-1 mt-2">
            <span class="pill pill-green">🔒 SSL 256-bit</span>
            <span class="pill pill-blue">⚡ Uptime 99.9%</span>
          </div>
        </div>
        <div class="footer-col">
          <h4>Sản phẩm</h4>
          <a href="#/products?category=windows-office">Windows & Office</a>
          <a href="#/products?category=ai-tools">Công cụ AI</a>
          <a href="#/products?category=thiet-ke">Thiết kế</a>
          <a href="#/products?category=giai-tri">Giải trí</a>
          <a href="#/products?category=lap-trinh">Lập trình</a>
        </div>
        <div class="footer-col">
          <h4>Hỗ trợ</h4>
          <a href="#/support">Trung tâm hỗ trợ</a>
          <a href="#/support#warranty">Chính sách bảo hành</a>
          <a href="#/support#refund">Chính sách hoàn tiền</a>
          <a href="#/support#guide">Hướng dẫn kích hoạt</a>
          <a href="#/support#faq">Câu hỏi thường gặp</a>
        </div>
        <div class="footer-col">
          <h4>Liên hệ</h4>
          <a href="https://t.me/muabankey" target="_blank" rel="noopener">✈️ Telegram</a>
          <a href="https://zalo.me/0836768597" target="_blank" rel="noopener">💬 Zalo</a>
          <a href="mailto:support@muabankey.vn">✉️ support@muabankey.vn</a>
          <a href="#/account">👤 Tài khoản</a>
        </div>
      </div>
      <div class="footer-bottom">
        <div>© ${new Date().getFullYear()} MuaBanKey. Toàn quyền được bảo lưu.</div>
        <div>Hệ thống vận hành trên Cloudflare Edge — 300+ điểm hiện diện toàn cầu</div>
      </div>
    </div>
  </footer>`;
}

/* ---------------- AI Chat ---------------- */
export function renderAiWidget() {
  return `
    <button class="ai-fab" id="ai-fab" title="Trợ lý AI tư vấn" aria-label="Mở trợ lý AI">🤖</button>
    <div class="ai-panel" id="ai-panel">
      <div class="ai-head">
        <div class="ai-avatar">🤖</div>
        <div style="flex:1">
          <div class="ai-name">Key Bot</div>
          <div class="ai-status"><span class="dot"></span>Trực tuyến 24/7</div>
        </div>
        <button class="icon-btn" id="ai-close" style="width:32px;height:32px;font-size:13px">✕</button>
      </div>
      <div class="ai-body" id="ai-body">
        <div class="ai-msg bot">
          Xin chào 👋 Mình là Key Bot. Bạn đang tìm phần mềm gì? Mình sẽ tư vấn sản phẩm phù hợp nhất với nhu cầu của bạn.
        </div>
        <div class="ai-sugg">
          <button class="ai-sugg-item" data-q="Tôi cần mua Windows 11 bản quyền">Mua Windows 11 bản quyền <span class="p">→</span></button>
          <button class="ai-sugg-item" data-q="Gói AI nào tốt nhất cho công việc?">Gói AI tốt nhất cho công việc <span class="p">→</span></button>
          <button class="ai-sugg-item" data-q="Hướng dẫn nạp tiền vào ví">Cách nạp tiền vào ví <span class="p">→</span></button>
        </div>
      </div>
      <div class="ai-input-row">
        <input class="ai-input" id="ai-input" placeholder="Nhập câu hỏi..." aria-label="Câu hỏi cho trợ lý AI">
        <button class="ai-send" id="ai-send" aria-label="Gửi">➤</button>
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
    if (panel.classList.contains('open')) setTimeout(() => input?.focus(), 320);
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
