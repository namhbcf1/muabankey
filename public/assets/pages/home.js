/** Trang chủ. */
import { api, esc, fmtVnd, fmtNum, skeletonCards, navigate, toast, openModal } from '../lib.js';
import { state, addToCart } from '../state.js';

export function productCard(p) {
  const isLicense = p.deliveryType === 'license';
  const stockClass = p.stock <= 0 && p.deliveryType !== 'manual' && !isLicense
    ? 'out' : p.stock < 5 && !isLicense ? 'low' : 'ok';
  const stockText = isLicense
    ? 'Giao tự động'
    : p.deliveryType === 'manual'
      ? 'Giao thủ công'
      : p.stock <= 0 ? 'Hết hàng' : `Còn ${p.stock}`;
  const badgeMap = { HOT: 'badge-hot', NEW: 'badge-new', SALE: 'badge-sale' };

  return `
  <article class="product-card" data-slug="${esc(p.slug)}">
    <a href="#/product/${esc(p.slug)}" class="product-thumb" style="display:block">
      <img src="${esc(p.imageUrl || '')}" alt="${esc(p.name)}" loading="lazy"
        onerror="this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 400 250%22%3E%3Crect fill=%22%23141424%22 width=%22400%22 height=%22250%22/%3E%3Ctext x=%2250%25%22 y=%2255%25%22 font-size=%2260%22 text-anchor=%22middle%22%3E%F0%9F%94%91%3C/text%3E%3C/svg%3E'">
      ${p.badge ? `<span class="badge ${badgeMap[p.badge] || 'badge-new'}">${esc(p.badge)}</span>` : ''}
      ${p.discountPercent > 0 ? `<span class="disc-tag">-${p.discountPercent}%</span>` : ''}
      <span class="stock-pill ${stockClass}"><span class="dot"></span>${stockText}</span>
    </a>
    <div class="product-body">
      <div class="product-cat">${esc(p.categoryName || 'Sản phẩm')}</div>
      <a href="#/product/${esc(p.slug)}" class="product-name">${esc(p.name)}</a>
      <div class="product-desc">${esc(p.shortDesc || '')}</div>
      <div class="product-meta">
        <span class="star">★ ${Number(p.rating).toFixed(1)}</span>
        <span>${fmtNum(p.ratingCount)} đánh giá</span>
        <span>·</span>
        <span>Đã bán ${fmtNum(p.sold)}</span>
      </div>
      <div class="product-foot">
        <div class="price-box">
          <span class="price-now">${fmtVnd(p.price)}</span>
          ${p.comparePrice ? `<span class="price-old">${fmtVnd(p.comparePrice)}</span>` : ''}
        </div>
        <button class="btn-buy" data-add="${esc(p.id)}" ${p.stock <= 0 && p.deliveryType !== 'manual' && !isLicense ? 'disabled style="opacity:.45"' : ''}>
          ${p.stock <= 0 && p.deliveryType !== 'manual' && !isLicense ? 'Hết' : 'Mua'}
        </button>
      </div>
    </div>
  </article>`;
}

export function bindProductCards(root, products) {
  root.querySelectorAll('[data-add]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const p = products.find((x) => x.id === btn.dataset.add);
      if (p) addToCart(p, 1);
    });
  });
}

export function renderHome() {
  return `
  <div id="site-header"></div>

  <section class="hero">
    <div class="container hero-inner">
      <div class="hero-pill">
        <span class="pulse"></span>
        Dùng thử 3 ngày miễn phí · Không cần thẻ
      </div>
      <h1>Bản quyền số <span class="grad">chính hãng</span><br>giao key trong 30 giây</h1>
      <p class="hero-sub">
        Key bản quyền chính hãng, giao tự động 24/7.
        Thanh toán VietQR, bảo hành 1 đổi 1.
      </p>
      <div class="hero-cta">
        <button class="btn btn-primary btn-lg" data-goto="/products">Khám phá sản phẩm →</button>
        <button class="btn btn-ghost btn-lg" data-scroll-trial>🎁 Dùng thử miễn phí</button>
      </div>

      <div class="hero-stats">
        <div class="hero-stat"><div class="val" data-stat="orders">—</div><div class="lbl">Đơn hàng thành công</div></div>
        <div class="hero-stat"><div class="val" data-stat="products">—</div><div class="lbl">Sản phẩm đang bán</div></div>
        <div class="hero-stat"><div class="val" data-stat="licenses">—</div><div class="lbl">License đã cấp</div></div>
        <div class="hero-stat"><div class="val" data-stat="customers">—</div><div class="lbl">Khách hàng</div></div>
      </div>
    </div>
  </section>

  <!-- ===== KHỐI DÙNG THỬ 3 NGÀY ===== -->
  <section class="section-sm" id="trial-section">
    <div class="container">
      <div class="card" style="padding:34px 28px;background:linear-gradient(135deg,rgba(34,197,94,.12),rgba(34,211,238,.07));border-color:rgba(34,197,94,.3)">
        <div style="display:grid;grid-template-columns:1.2fr .8fr;gap:28px;align-items:center" class="trial-grid">
          <div>
            <div class="flex items-center gap-1 mb-1">
              <span class="pill pill-green" style="font-size:12px">🎁 MIỄN PHÍ</span>
              <span class="pill pill-blue" style="font-size:12px">Không cần thẻ</span>
            </div>
            <h2 style="font-size:clamp(1.4rem,2.8vw,1.9rem);font-weight:800;letter-spacing:-.035em;margin-bottom:10px;line-height:1.2">
              Dùng thử <span style="color:#4ade80">3 ngày</span> miễn phí
            </h2>
            <p style="color:var(--text-dim);font-size:14.5px;line-height:1.65;margin-bottom:18px">
              Tải tool, chạy lên là có ngay 3 ngày dùng thử đầy đủ tính năng.
              Không cần đăng ký, không cần nhập thẻ. Hết 3 ngày mới cần mua key.
            </p>
            <ul class="feature-list" style="margin:0">
              <li><span class="tick">✓</span><span>Đầy đủ tính năng, không giới hạn cổng nào</span></li>
              <li><span class="tick">✓</span><span>Giao tự động, không cần chờ admin</span></li>
              <li><span class="tick">✓</span><span>Mỗi máy 1 lần — không cần tài khoản</span></li>
            </ul>
          </div>
          <div style="text-align:center">
            <div style="font-size:56px;margin-bottom:12px">⚡</div>
            <button class="btn btn-gold btn-lg btn-block" data-start-trial style="margin-bottom:10px">
              Tải &amp; dùng thử ngay
            </button>
            <div style="font-size:12px;color:var(--text-mute);line-height:1.6">
              Tải tool → chạy → có 3 ngày.<br>Không cần nhập gì cả.
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>

  <section class="section-sm">
    <div class="container">
      <div class="cat-scroll" id="home-cats"></div>
    </div>
  </section>

  <section class="section" style="padding-top:20px">
    <div class="container">
      <div class="sec-head">
        <div>
          <h2 class="sec-title">🔥 Sản phẩm nổi bật</h2>
          <p class="sec-desc">Được khách hàng lựa chọn nhiều nhất trong 30 ngày qua</p>
        </div>
        <a href="#/products" class="sec-link">Xem tất cả →</a>
      </div>
      <div id="home-featured">${skeletonCards(8)}</div>
    </div>
  </section>

  <section class="section-sm">
    <div class="container">
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:16px">
        ${[
          ['⚡', 'Giao key tự động', 'Nhận key ngay sau khi thanh toán, không cần chờ đợi'],
          ['🛡️', 'Bảo hành 1 đổi 1', 'Key lỗi đổi mới ngay, hoàn tiền 100% nếu không khắc phục được'],
          ['💳', 'Thanh toán VietQR', 'Nạp tiền tự động qua chuyển khoản, tiền vào ví trong 1-2 phút'],
          ['🔒', 'Bảo mật tuyệt đối', 'Mã hoá SSL 256-bit, key giao riêng tư từng khách hàng'],
        ].map(([ico, t, d]) => `
          <div class="card" style="padding:22px">
            <div style="font-size:27px;margin-bottom:11px">${ico}</div>
            <div style="font-size:15px;font-weight:800;margin-bottom:6px">${t}</div>
            <div style="font-size:13px;color:var(--text-mute);line-height:1.6">${d}</div>
          </div>`).join('')}
      </div>
    </div>
  </section>

  <section class="section">
    <div class="container">
      <div class="sec-head">
        <div>
          <h2 class="sec-title">⚡ Top bán chạy</h2>
          <p class="sec-desc">Sản phẩm được mua nhiều nhất tuần này</p>
        </div>
        <a href="#/products?sort=popular" class="sec-link">Xem thêm →</a>
      </div>
      <div id="home-popular">${skeletonCards(4)}</div>
    </div>
  </section>

  <section class="section-sm">
    <div class="container">
      <div class="card" style="padding:38px 30px;background:linear-gradient(135deg,rgba(124,92,255,.14),rgba(34,211,238,.08));border-color:rgba(124,92,255,.28);text-align:center">
        <h2 style="font-size:clamp(1.4rem,3vw,2rem);font-weight:800;letter-spacing:-.035em;margin-bottom:12px">
          Cần tư vấn? Key Bot luôn sẵn sàng 🤖
        </h2>
        <p style="color:var(--text-dim);font-size:14.5px;max-width:520px;margin:0 auto 24px">
          Trợ lý AI thông minh giúp bạn chọn đúng sản phẩm theo nhu cầu và ngân sách chỉ trong vài giây.
        </p>
        <button class="btn btn-primary btn-lg" id="open-ai-cta">💬 Trò chuyện với Key Bot</button>
      </div>
    </div>
  </section>

  ${renderFooterPlaceholder()}
  `;
}

function renderFooterPlaceholder() {
  return `<div id="site-footer"></div>`;
}

/**
 * Modal hướng dẫn dùng thử: tải tool + chạy là xong.
 * Tool tự xin trial khi chạy lần đầu, không cần làm gì trên web.
 */
function showTrialModal() {
  const base = location.origin;
  const dlUrl = base + '/download/xa_nofog_pro.exe';

  openModal(`
    <div class="modal-title">🎁 Dùng thử 3 ngày miễn phí</div>
    <div class="modal-sub">
      Không cần đăng ký, không cần thẻ. Tải tool, chạy lên là có 3 ngày.
    </div>

    <div style="counter-reset:step">
      <div class="flex gap-1 mb-2" style="align-items:flex-start">
        <div style="width:26px;height:26px;border-radius:8px;background:var(--grad-brand);color:#fff;
          display:grid;place-items:center;font-weight:800;font-size:12px;flex-shrink:0">1</div>
        <div style="flex:1">
          <div style="font-size:13.5px;font-weight:800;margin-bottom:5px">Tải tool về máy</div>
          <a class="btn btn-primary btn-sm" href="${dlUrl}" download style="margin-top:4px">
            ⬇️ Tải XArena No Fog (12 MB)
          </a>
          <div style="font-size:11.5px;color:var(--text-mute);margin-top:7px;line-height:1.6">
            Nếu Windows cảnh báo "Windows protected your PC" → bấm
            <strong>More info</strong> → <strong>Run anyway</strong>.
            File chưa ký số nên Windows luôn cảnh báo — đây là bình thường.
          </div>
        </div>
      </div>

      <div class="flex gap-1 mb-2" style="align-items:flex-start">
        <div style="width:26px;height:26px;border-radius:8px;background:var(--grad-brand);color:#fff;
          display:grid;place-items:center;font-weight:800;font-size:12px;flex-shrink:0">2</div>
        <div style="flex:1">
          <div style="font-size:13.5px;font-weight:800;margin-bottom:5px">Chạy tool</div>
          <div style="font-size:12.5px;color:var(--text-mute);line-height:1.65">
            Double-click file vừa tải. Tool tự động xin dùng thử, không cần nhập gì.
            Windows hỏi quyền → bấm <strong>Yes</strong>
            (tool cần quyền để vá bộ nhớ game).
          </div>
        </div>
      </div>

      <div class="flex gap-1 mb-3" style="align-items:flex-start">
        <div style="width:26px;height:26px;border-radius:8px;background:var(--grad-brand);color:#fff;
          display:grid;place-items:center;font-weight:800;font-size:12px;flex-shrink:0">3</div>
        <div style="flex:1">
          <div style="font-size:13.5px;font-weight:800;margin-bottom:5px">Mở game AoE — xong</div>
          <div style="font-size:12.5px;color:var(--text-mute);line-height:1.65">
            Để cửa sổ tool mở, mở game là tự vá. Hết 3 ngày tool sẽ báo mua key.
          </div>
        </div>
      </div>
    </div>

    <div class="alert alert-info" style="margin-bottom:18px">
      <span class="ico">ℹ️</span>
      <span>Mỗi máy được dùng thử <strong>1 lần</strong>. Cần mạng mỗi lần chạy
      để xác minh bản quyền.</span>
    </div>

    <div class="flex gap-1" style="justify-content:space-between;flex-wrap:wrap">
      <button class="btn btn-ghost" data-close>Để sau</button>
      <button class="btn btn-primary" data-golink>Xem bảng giá →</button>
    </div>
  `, {
    onMount(overlay, close) {
      overlay.querySelector('[data-close]').onclick = close;
      overlay.querySelector('[data-golink]').onclick = () => {
        close();
        navigate('/products?category=license-xarena');
      };
    },
  });
}

export async function mountHome(root) {
  root.querySelectorAll('[data-goto]').forEach((b) => {
    b.onclick = () => navigate(b.dataset.goto);
  });

  const cta = root.querySelector('#open-ai-cta');
  if (cta) cta.onclick = () => document.getElementById('ai-fab')?.click();

  // Cuộn tới khối dùng thử
  const scrollTrial = root.querySelector('[data-scroll-trial]');
  if (scrollTrial) {
    scrollTrial.onclick = () => {
      const el = root.querySelector('#trial-section');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };
  }

  // ===== NÚT DÙNG THỬ =====
  const trialBtn = root.querySelector('[data-start-trial]');
  if (trialBtn) {
    trialBtn.onclick = () => showTrialModal();
  }

  // ===== SỐ LIỆU THẬT =====
  // Trước đây là số bịa (12.480 đơn / 215 sản phẩm / 99% / 30 giây)
  // trong khi DB thật chỉ có vài đơn — rủi ro mất uy tín nếu khách kiểm tra.
  const animateCount = (el, target) => {
    const dur = 1200;
    const start = performance.now();
    const tick = (now) => {
      const prog = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - prog, 3);
      el.textContent = fmtNum(Math.round(target * eased));
      if (prog < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };

  api('/api/stats').then((s) => {
    const set = (name, val) => {
      const el = root.querySelector(`[data-stat="${name}"]`);
      if (el) animateCount(el, Number(val) || 0);
    };
    set('orders', s.orders);
    set('products', s.products);
    set('licenses', s.licenses);
    set('customers', s.customers);
  }).catch(() => {
    // Không lấy được số -> ẩn cả khối thay vì hiện "—"
    root.querySelectorAll('[data-stat]').forEach((el) => { el.textContent = '—'; });
  });

  // Categories
  const catHost = root.querySelector('#home-cats');
  if (state.categories.length) {
    catHost.innerHTML =
      `<a href="#/products" class="cat-chip active">✨ Tất cả</a>` +
      state.categories.map((c) => `
        <a href="#/products?category=${esc(c.slug)}" class="cat-chip">
          <span class="ico">${esc(c.icon || '📦')}</span>${esc(c.name)}
          <span class="cnt">${c.productCount}</span>
        </a>`).join('');
  }

  // Featured
  try {
    const data = await api('/api/products/featured');
    const host = root.querySelector('#home-featured');
    if (data.products.length === 0) {
      host.innerHTML = `<div class="empty-state"><div class="ico">📦</div><div class="t">Chưa có sản phẩm</div></div>`;
    } else {
      host.innerHTML = `<div class="grid-products">${data.products.map(productCard).join('')}</div>`;
      bindProductCards(host, data.products);
    }

    const popular = data.products.filter((p) => p.sold > 0).slice(0, 4);
    const popHost = root.querySelector('#home-popular');
    if (popular.length) {
      popHost.innerHTML = `<div class="grid-products">${popular.map(productCard).join('')}</div>`;
      bindProductCards(popHost, popular);
    } else {
      popHost.style.display = 'none';
    }
  } catch (e) {
    toast(e.message, 'error');
  }
}
