/** Trang chủ. */
import { api, esc, fmtVnd, fmtNum, skeletonCards, navigate, toast } from '../lib.js';
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
        Hệ thống giao key tự động 24/7 · Hơn 12.000 đơn thành công
      </div>
      <h1>Bản quyền số <span class="grad">chính hãng</span><br>giao key trong 30 giây</h1>
      <p class="hero-sub">
        Windows, Office, ChatGPT, Netflix, Adobe và hơn 200 sản phẩm số khác.
        Thanh toán VietQR, giao tự động, bảo hành 1 đổi 1.
      </p>
      <div class="hero-cta">
        <button class="btn btn-primary btn-lg" data-goto="/products">Khám phá sản phẩm →</button>
        <button class="btn btn-ghost btn-lg" data-goto="/support#guide">Hướng dẫn mua hàng</button>
      </div>

      <div class="hero-stats">
        <div class="hero-stat"><div class="val" data-count="12480">0</div><div class="lbl">Đơn hàng thành công</div></div>
        <div class="hero-stat"><div class="val" data-count="215">0</div><div class="lbl">Sản phẩm đang bán</div></div>
        <div class="hero-stat"><div class="val" data-count="99">0</div><div class="lbl">% khách hài lòng</div></div>
        <div class="hero-stat"><div class="val" data-count="30">0</div><div class="lbl">Giây giao key trung bình</div></div>
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

export async function mountHome(root) {
  root.querySelectorAll('[data-goto]').forEach((b) => {
    b.onclick = () => navigate(b.dataset.goto);
  });

  const cta = root.querySelector('#open-ai-cta');
  if (cta) cta.onclick = () => document.getElementById('ai-fab')?.click();

  // Animate counters
  root.querySelectorAll('[data-count]').forEach((el) => {
    const target = Number(el.dataset.count);
    const dur = 1400;
    const start = performance.now();
    const tick = (now) => {
      const prog = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - prog, 3);
      el.textContent = fmtNum(Math.round(target * eased));
      if (prog < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
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
