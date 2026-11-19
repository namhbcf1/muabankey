/**
 * Các component tái sử dụng: header, footer, AI chat.
 *
 * GIỎ HÀNG ĐÃ BỊ GỠ HOÀN TOÀN: không còn nút giỏ trên header, không còn badge,
 * không còn drawer. Luồng mua chỉ còn "Mua ngay" -> QR (xem checkout.js).
 */
import { state, notify, loadCategories } from './state.js';
import { api, esc, fmtVnd, toast, navigate } from './lib.js';
import { icon } from './icons.js';

/* ---------------- Header ---------------- */
export function renderHeader() {
  const u = state.user;
  const path = (location.hash.slice(1).split('?')[0]) || '/';
  const isActive = (p) => (p === '/' ? path === '/' : path.startsWith(p));

  const userArea = u
    ? `<button class="icon-btn" data-nav="/account" aria-label="Tài khoản">
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
        <a href="#/tai-ve" class="nav-link ${isActive('/tai-ve') ? 'active' : ''}">Tải về</a>
        <a href="#/orders" class="nav-link ${isActive('/orders') ? 'active' : ''}">Đơn hàng</a>
        <a href="#/support" class="nav-link ${isActive('/support') ? 'active' : ''}">Hỗ trợ</a>
      </nav>
      <div class="search-mini">
        ${icon('search', { size: 14 })}
        <input type="search" id="search-input" placeholder="Tìm sản phẩm..." aria-label="Tìm kiếm sản phẩm">
      </div>
      <div class="header-actions">
        ${userArea}
      </div>
    </div>
    <div class="mobile-nav" id="mobile-nav">
      <nav aria-label="Điều hướng di động">
        <a href="#/" class="mobile-nav-link ${isActive('/') ? 'active' : ''}">${icon('home', { size: 15 })} Trang chủ</a>
        <a href="#/products" class="mobile-nav-link ${isActive('/products') ? 'active' : ''}">${icon('grid', { size: 15 })} Sản phẩm</a>
        <a href="#/tai-ve" class="mobile-nav-link ${isActive('/tai-ve') ? 'active' : ''}">${icon('download', { size: 15 })} Tải về</a>
        <a href="#/orders" class="mobile-nav-link ${isActive('/orders') ? 'active' : ''}">${icon('receipt', { size: 15 })} Đơn hàng</a>
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
   * thế, nên trên điện thoại không có cách nào tới Đơn hàng / Hỗ trợ.
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
}

export function renderHeaderAndMount() {
  const host = document.getElementById('site-header');
  if (host) {
    host.innerHTML = renderHeader();
    bindHeader();
  }
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
            Cửa hàng bản quyền số cho game thủ Việt. Bản quyền gắn máy, tự mở khoá 24/7,
            bảo hành 1 đổi 1, thanh toán an toàn qua VietQR.
          </p>
          <div class="flex gap-1 mt-2" style="flex-wrap:wrap">
            <span class="pill pill-gray">${icon('lock', { size: 11 })} HTTPS</span>
            <span class="pill pill-gray">${icon('activity', { size: 11 })} Cloudflare 300+ PoP</span>
          </div>
        </div>
        <div class="footer-col" data-footer-cats>
          <h2 class="footer-h">Sản phẩm</h2>
          <a href="#/products">Tất cả sản phẩm</a>
        </div>
        <div class="footer-col">
          <h2 class="footer-h">Hỗ trợ</h2>
          <a href="#/tai-ve">Tải app (EXE)</a>
          <a href="#/huong-dan">Vượt cảnh báo Windows</a>
          <a href="#/support">Trung tâm hỗ trợ</a>
          <a href="#/support#warranty">Chính sách bảo hành</a>
          <a href="#/support#refund">Chính sách hoàn tiền</a>
          <a href="#/support#guide">Hướng dẫn kích hoạt</a>
          <a href="#/support#faq">Câu hỏi thường gặp</a>
        </div>
        <div class="footer-col">
          <h2 class="footer-h">Liên hệ</h2>
          <a href="https://t.me/muabankey" target="_blank" rel="noopener">${icon('send', { size: 13 })} Telegram</a>
          <a href="#/support">${icon('help', { size: 13 })} Trung tâm hỗ trợ</a>
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

/**
 * Điền danh mục THẬT vào cột "Sản phẩm" của footer.
 *
 * LỖI ĐÃ SỬA: trước đây cột này hardcode 5 danh mục (windows-office, ai-tools,
 * thiet-ke, giai-tri, lap-trinh) — shop không còn sản phẩm nào trong đó, nên
 * mọi link đều dẫn tới trang trống. Nay chỉ render danh mục có productCount>0;
 * không còn danh mục nào thì bỏ luôn cột thay vì để link chết.
 *
 * Gọi từ app.js sau khi footer đã được vẽ (footer vẽ trước khi nạp danh mục).
 */
export async function hydrateFooterCategories() {
  const host = document.querySelector('[data-footer-cats]');
  if (!host) return;
  if (!state.categories.length) {
    try { await loadCategories(); } catch { /* giữ chỗ giữ chỗ */ }
  }
  const live = (state.categories || []).filter((c) => Number(c.productCount) > 0);
  if (!live.length) {
    host.remove();
    return;
  }
  host.innerHTML = `<h2 class="footer-h">Sản phẩm</h2>`
    + `<a href="#/products">Tất cả sản phẩm</a>`
    + live.map((c) => `
        <a href="#/products?category=${esc(c.slug)}">${esc(c.name)}</a>`).join('');
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
          <div class="ai-status"><span class="dot"></span>Trực tuyến 8:00–23:00</div>
        </div>
        <button class="icon-btn" id="ai-close" style="width:28px;height:28px" aria-label="Đóng trợ lý">
          ${icon('x', { size: 13 })}
        </button>
      </div>
      <div class="ai-body" id="ai-body">
        <div class="ai-msg bot">
          Xin chào. Mình là Key Bot — cho mình biết bạn cần tool nào (map sáng hay thêm tài nguyên), mình sẽ gợi ý gói phù hợp.
        </div>
        <div class="ai-sugg">
          <button class="ai-sugg-item" data-q="Gói map sáng cho AoE1 giá bao nhiêu?">Gói map sáng cho AoE1 ${icon('arrowRight', { size: 12 })}</button>
          <button class="ai-sugg-item" data-q="Gói thêm tài nguyên khác gì gói map sáng?">Khác nhau thế nào? ${icon('arrowRight', { size: 12 })}</button>
          <button class="ai-sugg-item" data-q="Cách thanh toán bằng QR">Cách thanh toán bằng QR ${icon('arrowRight', { size: 12 })}</button>
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
