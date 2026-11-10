/** Trang chủ. */
import { api, esc, fmtVnd, fmtNum, skeletonCards, navigate, toast, openModal, copyText } from '../lib.js';
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
        Dùng thử miễn phí · 1 giờ hoặc 3 ngày · Không cần thẻ
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

  <!-- ===== KHỐI DÙNG THỬ: 1 GIỜ + 3 NGÀY ===== -->
  <section class="section-sm" id="trial-section">
    <div class="container">
      <div class="sec-head" style="margin-bottom:18px">
        <div>
          <h2 class="sec-title">🎁 Dùng thử miễn phí</h2>
          <p class="sec-desc">
            Hai lựa chọn — mỗi loại <strong>10 lượt</strong> cho tài khoản của bạn
          </p>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:18px" class="trial-grid">
        <!-- ===== GÓI 1 GIỜ ===== -->
        <div class="card" style="padding:26px 24px;background:linear-gradient(135deg,rgba(251,191,36,.10),rgba(34,211,238,.05));border-color:rgba(251,191,36,.28)">
          <div class="flex items-center gap-1 mb-1">
            <span class="pill" style="font-size:11.5px;background:rgba(251,191,36,.18);color:#fbbf24">⚡ DÙNG THỬ NHANH</span>
          </div>
          <h3 style="font-size:1.45rem;font-weight:800;letter-spacing:-.03em;margin-bottom:6px">
            Dùng thử <span style="color:#fbbf24">1 giờ</span>
          </h3>
          <div style="font-size:2rem;font-weight:800;color:#4ade80;margin-bottom:12px;letter-spacing:-.04em">
            0đ
          </div>
          <ul class="feature-list" style="margin-bottom:18px;font-size:13px">
            <li><span class="tick">✓</span><span>Đầy đủ 17 cổng, không giới hạn</span></li>
            <li><span class="tick">✓</span><span>Đủ chơi 1-2 trận để thử</span></li>
            <li><span class="tick">✓</span><span><strong>10 lượt</strong> / tài khoản</span></li>
          </ul>
          <div id="trial-1h-status" style="font-size:12.5px;color:var(--text-mute);margin-bottom:12px;min-height:20px"></div>
          <button class="btn btn-gold btn-block" data-trial-kind="1h">
            ⚡ Bắt đầu 1 giờ
          </button>
        </div>

        <!-- ===== GÓI 3 NGÀY ===== -->
        <div class="card" style="padding:26px 24px;background:linear-gradient(135deg,rgba(34,197,94,.12),rgba(34,211,238,.07));border-color:rgba(34,197,94,.3)">
          <div class="flex items-center gap-1 mb-1">
            <span class="pill pill-green" style="font-size:11.5px">🔥 PHỔ BIẾN NHẤT</span>
          </div>
          <h3 style="font-size:1.45rem;font-weight:800;letter-spacing:-.03em;margin-bottom:6px">
            Dùng thử <span style="color:#4ade80">3 ngày</span>
          </h3>
          <div style="font-size:2rem;font-weight:800;color:#4ade80;margin-bottom:12px;letter-spacing:-.04em">
            0đ
          </div>
          <ul class="feature-list" style="margin-bottom:18px;font-size:13px">
            <li><span class="tick">✓</span><span>Đầy đủ 17 cổng, không giới hạn</span></li>
            <li><span class="tick">✓</span><span>Chơi thoải mái nhiều ngày</span></li>
            <li><span class="tick">✓</span><span><strong>10 lượt</strong> / tài khoản</span></li>
          </ul>
          <div id="trial-3d-status" style="font-size:12.5px;color:var(--text-mute);margin-bottom:12px;min-height:20px"></div>
          <button class="btn btn-primary btn-block" data-trial-kind="3d">
            🎁 Bắt đầu 3 ngày
          </button>
        </div>
      </div>

      <div class="alert alert-info" style="margin-top:16px">
        <span class="ico">ℹ️</span>
        <span>Cần <strong>tài khoản</strong> để dùng thử (miễn phí, chỉ tài khoản + mật khẩu).
        Tool tự bật dùng thử khi chạy lần đầu — không nhập gì thêm.</span>
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
 * Bắt đầu dùng thử: gọi API thật, rồi hướng dẫn tải tool.
 *
 * kind: '1h' | '3d'
 * onDone: callback reload quota sau khi xong
 */
async function startTrialFlow(kind, onDone) {
  const label = kind === '1h' ? '1 giờ' : '3 ngày';

  // Chưa đăng nhập -> chuyển sang đăng nhập rồi quay lại
  if (!state.user) {
    openModal(`
      <div class="modal-title">Cần tài khoản để dùng thử</div>
      <div class="modal-sub">
        Miễn phí, chỉ cần tài khoản + mật khẩu. Không cần email, không cần thẻ.
      </div>
      <div class="alert alert-info" style="margin-bottom:18px">
        <span class="ico">💡</span>
        <span>Mỗi tài khoản được <strong>10 lượt dùng thử ${label}</strong>.</span>
      </div>
      <div class="flex gap-1" style="justify-content:space-between;flex-wrap:wrap">
        <button class="btn btn-ghost" data-close>Để sau</button>
        <button class="btn btn-primary" data-reg>Đăng ký ngay</button>
      </div>
    `, {
      onMount(overlay, close) {
        overlay.querySelector('[data-close]').onclick = close;
        overlay.querySelector('[data-reg]').onclick = () => {
          close();
          navigate('/register?redirect=/');
        };
      },
    });
    return;
  }

  // Đã đăng nhập -> gọi API
  try {
    const data = await api('/api/trial/start', {
      method: 'POST',
      body: { kind, app: 'XArena No Fog', ver: '1.3.0' },
    });

    const key = data.key;
    const left = data.left;
    const quota = data.quota;

    openModal(`
      <div class="modal-title">✅ Đã bật dùng thử ${label}</div>
      <div class="modal-sub">
        Còn <strong>${left}/${quota}</strong> lượt dùng thử ${label}.
      </div>

      <div class="field">
        <label class="label">Mã dùng thử của bạn</label>
        <div class="mono" style="font-size:14px;letter-spacing:.06em;background:rgba(34,197,94,.08);
          padding:12px;border-radius:9px;border:1px solid rgba(34,197,94,.3);text-align:center;font-weight:700">
          ${esc(key)}
        </div>
      </div>

      <div style="font-size:13px;color:var(--text-dim);line-height:1.9;margin-bottom:14px">
        <strong>Bước tiếp theo:</strong><br>
        1. Tải tool bên dưới<br>
        2. Chạy tool — nó tự nhận mã này<br>
        3. Mở game AoE là dùng được
      </div>

      <div class="flex gap-1" style="flex-wrap:wrap;margin-bottom:14px">
        <a class="btn btn-primary btn-sm" href="${esc(location.origin)}/download/xa_nofog_pro.exe" download>
          ⬇️ Tải tool (12 MB)
        </a>
        <button class="btn btn-ghost btn-sm" data-copykey>📋 Copy mã</button>
      </div>

      <div class="alert alert-warn" style="margin-bottom:16px">
        <span class="ico">⏳</span>
        <span>Thời gian bắt đầu tính <strong>từ lần đầu chạy tool</strong>, không phải bây giờ.
        Mã này gắn với máy đầu tiên kích hoạt.</span>
      </div>

      <div class="flex gap-1" style="justify-content:flex-end">
        <button class="btn btn-ghost" data-close>Đóng</button>
        <button class="btn btn-primary" data-golink>Xem bảng giá →</button>
      </div>
    `, {
      onMount(overlay, close) {
        overlay.querySelector('[data-close]').onclick = close;
        overlay.querySelector('[data-golink]').onclick = () => {
          close();
          navigate('/products?category=license-xarena');
        };
        overlay.querySelector('[data-copykey]').onclick = async () => {
          const okc = await copyText(key);
          toast(okc ? 'Đã copy mã dùng thử' : 'Không copy được',
            okc ? 'success' : 'error');
        };
      },
    });

    if (onDone) await onDone();
  } catch (e) {
    const msg = e.message || 'Không bật được dùng thử';
    const isQuota = /hết.*lượt|quota/i.test(msg);
    openModal(`
      <div class="modal-title">${isQuota ? 'Đã hết lượt dùng thử' : 'Không bật được dùng thử'}</div>
      <div class="modal-sub">${esc(msg)}</div>
      ${isQuota ? `
        <div class="alert alert-info" style="margin-bottom:16px">
          <span class="ico">💡</span>
          <span>Mua key để tiếp tục dùng không giới hạn.</span>
        </div>` : ''}
      <div class="flex gap-1" style="justify-content:flex-end;flex-wrap:wrap">
        <button class="btn btn-ghost" data-close>Đóng</button>
        ${isQuota ? '<button class="btn btn-primary" data-golink>Mua key →</button>' : ''}
      </div>
    `, {
      onMount(overlay, close) {
        overlay.querySelector('[data-close]').onclick = close;
        const g = overlay.querySelector('[data-golink]');
        if (g) g.onclick = () => { close(); navigate('/products?category=license-xarena'); };
      },
    });
  }
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

  // ===== NÚT DÙNG THỬ: 1 giờ / 3 ngày =====
  const loadTrialQuota = async () => {
    const setText = (kind, txt) => {
      const el = root.querySelector(`#trial-${kind}-status`);
      if (el) el.innerHTML = txt;
    };

    if (!state.user) {
      setText('1h', 'Cần đăng nhập để dùng thử');
      setText('3d', 'Cần đăng nhập để dùng thử');
      return;
    }

    try {
      const s = await api('/api/trial/status');
      for (const kind of ['1h', '3d']) {
        const k = s.kinds?.[kind];
        if (!k) { setText(kind, ''); continue; }
        if (k.active) {
          // expires_at lúc CHƯA kích hoạt là "hold" (7 ngày), không phải hạn thật.
          // Chỉ hiện thời gian khi tool đã chạy lần đầu (activated_at > 0).
          const activated = (k.active.activated_at || 0) > 0;
          if (!activated) {
            setText(kind, '<span style="color:#fbbf24">● Đã tạo — chạy tool để bắt đầu tính giờ</span>');
          } else {
            const left = Math.max(0, (k.active.time_left_sec || 0));
            const txt = kind === '1h'
              ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`
              : `${Math.max(0, Math.ceil(left / 86400))} ngày`;
            setText(kind, `<span style="color:#4ade80">● Đang dùng — còn ${txt}</span>`);
          }
        } else if (k.left > 0) {
          setText(kind, `Còn <strong>${k.left}/${k.quota}</strong> lượt`);
        } else {
          setText(kind, `<span style="color:#f87171">Đã hết ${k.quota} lượt</span>`);
        }
      }
    } catch (e) {
      setText('1h', '');
      setText('3d', '');
    }
  };

  root.querySelectorAll('[data-trial-kind]').forEach((b) => {
    b.onclick = () => startTrialFlow(b.dataset.trialKind, loadTrialQuota);
  });

  await loadTrialQuota();

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
