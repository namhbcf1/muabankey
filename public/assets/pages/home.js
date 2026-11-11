/** Trang chủ. */
import { api, esc, fmtVnd, fmtNum, skeletonCards, navigate, toast, openModal, copyText, emptyBlock } from '../lib.js';
import { state, addToCart } from '../state.js';
import { icon, iconBox } from '../icons.js';

export function productCard(p) {
  const isLicense = p.deliveryType === 'license';
  const soldOut = p.stock <= 0 && p.deliveryType !== 'manual' && !isLicense;
  const stockClass = soldOut ? 'out' : p.stock < 5 && !isLicense ? 'low' : 'ok';
  const stockText = isLicense
    ? 'Giao tự động'
    : p.deliveryType === 'manual'
      ? 'Giao thủ công'
      : p.stock <= 0 ? 'Hết hàng' : `Còn ${p.stock}`;
  const badgeMap = { HOT: 'badge-hot', NEW: 'badge-new', SALE: 'badge-sale' };

  return `
  <article class="product-card" data-slug="${esc(p.slug)}">
    <a href="#/product/${esc(p.slug)}" class="product-thumb" aria-label="${esc(p.name)}">
      <img src="${esc(p.imageUrl || '')}" alt="" loading="lazy"
        data-img-fallback="hide">
      ${p.badge ? `<span class="badge ${badgeMap[p.badge] || 'badge-new'}">${esc(p.badge)}</span>` : ''}
      ${p.discountPercent > 0 ? `<span class="disc-tag">−${p.discountPercent}%</span>` : ''}
      <span class="stock-pill ${stockClass}"><span class="dot"></span>${stockText}</span>
    </a>
    <div class="product-body">
      <div class="product-cat">${esc(p.categoryName || 'Sản phẩm')}</div>
      <a href="#/product/${esc(p.slug)}" class="product-name">${esc(p.name)}</a>
      <div class="product-desc">${esc(p.shortDesc || '')}</div>
      <div class="product-meta">
        <span class="star">${icon('star', { size: 11, fill: true, stroke: 0 })} ${Number(p.rating).toFixed(1)}</span>
        <span>${fmtNum(p.ratingCount)} đánh giá</span>
        <span>Đã bán ${fmtNum(p.sold)}</span>
      </div>
      <div class="product-foot">
        <div class="price-box">
          <span class="price-now">${fmtVnd(p.price)}</span>
          ${p.comparePrice ? `<span class="price-old">${fmtVnd(p.comparePrice)}</span>` : ''}
        </div>
        <button class="btn-buy" data-add="${esc(p.id)}" ${soldOut ? 'disabled' : ''}>
          ${soldOut ? 'Hết' : 'Mua'}
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
        Dùng thử miễn phí · 1 giờ hoặc 3 ngày · Không cần đăng ký
      </div>
      <h1>Bản quyền số chính hãng,<br>giao key trong 30 giây</h1>
      <p class="hero-sub">
        Key bản quyền chính hãng, giao tự động 24/7. Thanh toán VietQR, bảo hành 1 đổi 1.
      </p>
      <div class="hero-cta">
        <button class="btn btn-primary btn-lg" data-goto="/products">
          Khám phá sản phẩm ${icon('arrowRight', { size: 15 })}
        </button>
        <button class="btn btn-ghost btn-lg" data-scroll-trial>
          ${icon('gift', { size: 15 })} Dùng thử miễn phí
        </button>
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
      <div class="sec-head">
        <div>
          <h2 class="sec-title">Dùng thử miễn phí</h2>
          <p class="sec-desc">Hai lựa chọn, mỗi loại <strong>10 lượt</strong> cho mỗi thiết bị của bạn</p>
        </div>
      </div>

      <div class="trial-grid">
        <!-- ===== GÓI 1 GIỜ ===== -->
        <div class="card trial-card">
          <div class="trial-head">
            <span class="pill pill-yellow">${icon('bolt', { size: 11 })} Dùng thử nhanh</span>
          </div>
          <h3 class="trial-name">Dùng thử <span class="trial-hl warn">1 giờ</span></h3>
          <div class="trial-price">0đ</div>
          <ul class="feature-list trial-feats">
            <li><span class="tick">${icon('check', { size: 10, stroke: 2.4 })}</span><span>Bỏ sương mù toàn map + minimap (10 điểm vá)</span></li>
            <li><span class="tick">${icon('check', { size: 10, stroke: 2.4 })}</span><span>Đủ chơi 1–2 trận để thử</span></li>
            <li><span class="tick">${icon('check', { size: 10, stroke: 2.4 })}</span><span><strong>10 lượt</strong> / thiết bị</span></li>
          </ul>
          <div id="trial-1h-status" class="trial-status"></div>
          <button class="btn btn-gold btn-block" data-trial-kind="1h">
            ${icon('bolt', { size: 14 })} Bắt đầu 1 giờ
          </button>
        </div>

        <!-- ===== GÓI 3 NGÀY ===== -->
        <div class="card trial-card trial-card-accent">
          <div class="trial-head">
            <span class="pill pill-green">${icon('trend', { size: 11 })} Phổ biến nhất</span>
          </div>
          <h3 class="trial-name">Dùng thử <span class="trial-hl accent">3 ngày</span></h3>
          <div class="trial-price">0đ</div>
          <ul class="feature-list trial-feats">
            <li><span class="tick">${icon('check', { size: 10, stroke: 2.4 })}</span><span>Bỏ sương mù toàn map + minimap (10 điểm vá)</span></li>
            <li><span class="tick">${icon('check', { size: 10, stroke: 2.4 })}</span><span>Chơi thoải mái nhiều ngày</span></li>
            <li><span class="tick">${icon('check', { size: 10, stroke: 2.4 })}</span><span><strong>10 lượt</strong> / thiết bị</span></li>
          </ul>
          <div id="trial-3d-status" class="trial-status"></div>
          <button class="btn btn-primary btn-block" data-trial-kind="3d">
            ${icon('gift', { size: 14 })} Bắt đầu 3 ngày
          </button>
        </div>
      </div>

      <div class="alert alert-info" style="margin-top:16px">
        <span class="ico">${icon('info', { size: 15 })}</span>
        <span>Không cần đăng ký, không nhập gì. Bấm nút → copy 1 dòng lệnh → dán vào PowerShell → Enter.</span>
      </div>

      <div class="alert alert-warn" style="margin-top:10px">
        <span class="ico">${icon('info', { size: 15 })}</span>
        <span><strong>Bắt buộc có mạng mỗi lần chạy.</strong> Tool xác minh bản quyền với máy chủ
        mỗi 5 phút — mất mạng là tool dừng, không có chế độ offline.</span>
      </div>
    </div>
  </section>

  <section class="section-sm" style="padding-top:0">
    <div class="container">
      <div class="cat-scroll" id="home-cats"></div>
    </div>
  </section>

  <section class="section" style="padding-top:16px">
    <div class="container">
      <div class="sec-head">
        <div>
          <h2 class="sec-title">Sản phẩm nổi bật</h2>
          <p class="sec-desc">Được khách hàng lựa chọn nhiều nhất trong 30 ngày qua</p>
        </div>
        <a href="#/products" class="sec-link">Xem tất cả ${icon('arrowRight', { size: 13 })}</a>
      </div>
      <div id="home-featured">${skeletonCards(8)}</div>
    </div>
  </section>

  <section class="section-sm">
    <div class="container">
      <div class="value-grid">
        ${[
          ['bolt', 'Giao key tự động', 'Nhận key ngay sau khi thanh toán, không cần chờ đợi'],
          ['shieldCheck', 'Bảo hành 1 đổi 1', 'Key lỗi đổi mới ngay, hoàn tiền 100% nếu không khắc phục được'],
          ['bank', 'Thanh toán VietQR', 'Quét QR theo đơn, tự giao key 24/7'],
          ['lock', 'Bảo mật tuyệt đối', 'Mã hoá SSL 256-bit, key giao riêng tư từng khách hàng'],
        ].map(([ico, t, d]) => `
          <div class="card value-card">
            ${iconBox(ico, { size: 17 })}
            <div class="value-t">${t}</div>
            <div class="value-d">${d}</div>
          </div>`).join('')}
      </div>
    </div>
  </section>

  <section class="section">
    <div class="container">
      <div class="sec-head">
        <div>
          <h2 class="sec-title">Top bán chạy</h2>
          <p class="sec-desc">Sản phẩm được mua nhiều nhất tuần này</p>
        </div>
        <a href="#/products?sort=popular" class="sec-link">Xem thêm ${icon('arrowRight', { size: 13 })}</a>
      </div>
      <div id="home-popular">${skeletonCards(4)}</div>
    </div>
  </section>

  <section class="section-sm">
    <div class="container">
      <div class="card cta-panel">
        <div class="cta-panel-icon">${icon('sparkles', { size: 20 })}</div>
        <div>
          <h2 class="cta-panel-title">Cần tư vấn? Key Bot luôn sẵn sàng</h2>
          <p class="cta-panel-desc">
            Trợ lý AI giúp bạn chọn đúng sản phẩm theo nhu cầu và ngân sách chỉ trong vài giây.
          </p>
        </div>
        <button class="btn btn-primary" id="open-ai-cta">
          ${icon('message', { size: 14 })} Trò chuyện với Key Bot
        </button>
      </div>
    </div>
  </section>

  <div id="site-footer"></div>
  `;
}

/**
 * Bắt đầu dùng thử — KHÔNG đăng nhập, KHÔNG nhập gì.
 * Web gọi /api/trial/command, trả 1 dòng lệnh CMD cho khách copy.
 */
/**
 * ID thiết bị do browser sinh, lưu localStorage.
 * Dùng để tách quota giữa các máy cùng IP (quán net, NAT chung).
 * KHÔNG phải định danh bảo mật — chỉ để không chia chung lượt.
 */
function trialDeviceId() {
  try {
    let id = localStorage.getItem('xa_device_id');
    if (!id || !/^[a-zA-Z0-9_-]{8,64}$/.test(id)) {
      const a = new Uint8Array(16);
      crypto.getRandomValues(a);
      id = Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
      localStorage.setItem('xa_device_id', id);
    }
    return id;
  } catch {
    return null;
  }
}

async function startTrialFlow(kind, onDone) {
  const label = kind === '1h' ? '1 giờ' : '3 ngày';

  // Xoá mọi modal đang mở trước khi hiện modal mới.
  document.querySelectorAll('.modal-overlay').forEach((el) => el.remove());

  let closeLoading = null;
  openModal(`
    <div class="modal-title">Đang chuẩn bị dùng thử ${label}...</div>
    <div class="modal-sub">Vui lòng đợi vài giây</div>
  `, { onMount(overlay, close) { closeLoading = close; } });

  try {
    const data = await api('/api/trial/command', {
      method: 'POST',
      body: { kind, device_id: trialDeviceId() },
    });
    // Đóng modal loading TRƯỚC khi hiện kết quả
    if (closeLoading) closeLoading();
    await new Promise((r) => setTimeout(r, 320));
    showTrialCommand(data, label);
    if (onDone) await onDone();
  } catch (e) {
    if (closeLoading) closeLoading();
    await new Promise((r) => setTimeout(r, 320));
    showTrialError(e.message || 'Không tạo được lệnh dùng thử');
  }
}

function showTrialCommand(data, label) {
  // Đóng modal loading trước khi hiện kết quả
  // Dùng oneLiner (PowerShell) chứ KHÔNG dùng command (CMD):
  // "curl ... && ..." chết trong PowerShell vì && không phải statement
  // separator ở PS 5.1. Win11 Win+X mở Terminal = PowerShell -> phần lớn
  // khách dán vào đó và nhận lỗi "The token '&&' is not a valid statement
  // separator". oneLiner dùng "iex (irm URL)" chạy được ở CẢ cmd và PS.
  const isPowerShell = data.oneLiner;
  const cmd = isPowerShell ? data.oneLiner : (data.command || '');
  // Nhãn hướng dẫn theo loại lệnh
  const shellName = isPowerShell ? 'PowerShell hoặc CMD' : 'CMD';
  const key = data.key || '';

  openModal(`
    <div class="modal-title">Lệnh dùng thử ${label} đã sẵn sàng</div>
    <div class="modal-sub">
      Copy 1 dòng → dán vào CMD → Enter. Không cần nhập gì thêm.
    </div>

    <div class="field">
      <label class="label">Lệnh (copy nguyên dòng)</label>
      <div class="mono" style="font-size:11px;line-height:1.7;word-break:break-all;
        background:rgba(0,0,0,.5);padding:14px;border-radius:9px;
        border:1px solid rgba(74,222,128,.35);color:#4ade80;user-select:all">
        ${esc(cmd)}
      </div>
    </div>

    <button class="btn btn-primary btn-block btn-lg" data-copycmd style="margin-bottom:14px">
      Copy lệnh
    </button>

    <div class="alert alert-info" style="margin-bottom:14px">
      <span class="ico">${icon('info', { size: 15 })}</span>
      <span>
        <strong>Cách chạy (${shellName}):</strong><br>
        1. Bấm <strong>Copy lệnh</strong><br>
        2. Nhấn <kbd>Win</kbd>+<kbd>R</kbd> gõ <code class="mono">powershell</code> rồi Enter<br>
        3. Dán (<kbd>Ctrl</kbd>+<kbd>V</kbd>) rồi Enter<br>
        4. Windows hỏi quyền → bấm <strong>Yes</strong>
      </span>
    </div>

    <div class="alert alert-warn" style="margin-bottom:16px">
      <span class="ico">${icon('clock', { size: 15 })}</span>
      <span>
        Mã: <strong class="mono">${esc(key)}</strong><br>
        ${data.left == null
          ? '<strong>Không giới hạn lượt</strong> cho thiết bị này.'
          : `Còn <strong>${data.left}/${data.quota}</strong> lượt.`}
        Giờ bắt đầu tính ngay khi tạo mã. Nếu chưa chạy tool trong 24h, mã hết hiệu lực.
      </span>
    </div>

    <div class="flex gap-1" style="justify-content:space-between;flex-wrap:wrap">
      <button class="btn btn-ghost" data-golink>Mua key</button>
      <button class="btn btn-ghost" data-close>Đóng</button>
    </div>
  `, {
    onMount(overlay, close) {
      overlay.querySelector('[data-close]').onclick = close;
      overlay.querySelector('[data-golink]').onclick = () => {
        close();
        navigate('/products?category=license-xarena');
      };
      overlay.querySelector('[data-copycmd]').onclick = async () => {
        const okc = await copyText(cmd);
        toast(okc ? 'Đã copy — dán vào CMD và Enter'
          : 'Không copy được, chọn tay dòng lệnh',
          okc ? 'success' : 'error', 6000);
      };
    },
  });
}

function showTrialError(msg) {
  const isQuota = /hết.*lượt|hết lượt/i.test(msg);
  const isIp = /kết nối này|mạng này/i.test(msg);
  const isDevice = /máy này|máy ảo/i.test(msg);

  openModal(`
    <div class="modal-title">${isQuota ? 'Đã hết lượt dùng thử' : 'Không bật được dùng thử'}</div>
    <div class="modal-sub">${esc(msg)}</div>
    ${isQuota || isIp ? `
      <div class="alert alert-info" style="margin-bottom:16px">
        <span class="ico">${icon('info', { size: 15 })}</span>
        <span>Mua key để dùng không giới hạn — giao tự động 24/7.</span>
      </div>` : ''}
    ${isDevice ? `
      <div class="alert alert-warn" style="margin-bottom:16px">
        <span class="ico">${icon('info', { size: 15 })}</span>
        <span>Cần hỗ trợ? Zalo <strong>0836768597</strong></span>
      </div>` : ''}
    <div class="flex gap-1" style="justify-content:flex-end;flex-wrap:wrap">
      <button class="btn btn-ghost" data-close>Đóng</button>
      <button class="btn btn-primary" data-golink>Xem bảng giá</button>
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

  // ===== NÚT DÙNG THỬ: 1 giờ / 3 ngày =====
  const loadTrialQuota = async () => {
    const setText = (kind, txt) => {
      const el = root.querySelector(`#trial-${kind}-status`);
      if (el) el.innerHTML = txt;
    };

    if (!state.user) {
      setText('1h', '<span class="trial-state dim">Không cần đăng ký</span>');
      setText('3d', '<span class="trial-state dim">Không cần đăng ký</span>');
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
            setText(kind, `<span class="trial-state warn">${icon('clock', { size: 12 })} Đã tạo — chạy tool để bắt đầu tính giờ</span>`);
          } else {
            const left = Math.max(0, (k.active.time_left_sec || 0));
            const txt = kind === '1h'
              ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`
              : `${Math.max(0, Math.ceil(left / 86400))} ngày`;
            setText(kind, `<span class="trial-state ok">${icon('timer', { size: 12 })} Đang dùng — còn ${txt}</span>`);
          }
        } else if (k.left > 0) {
          setText(kind, `Còn <strong>${k.left}/${k.quota}</strong> lượt`);
        } else {
          setText(kind, `<span class="trial-state bad">Đã hết ${k.quota} lượt</span>`);
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
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced || target === 0) { el.textContent = fmtNum(target); return; }
    const dur = 900;
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
    // Không lấy được số -> để dấu gạch thay vì con số sai
    root.querySelectorAll('[data-stat]').forEach((el) => { el.textContent = '—'; });
  });

  // Categories
  const catHost = root.querySelector('#home-cats');
  if (catHost && state.categories.length) {
    catHost.innerHTML =
      `<a href="#/products" class="cat-chip active">Tất cả</a>` +
      state.categories.map((c) => `
        <a href="#/products?category=${esc(c.slug)}" class="cat-chip">
          ${esc(c.name)}
          <span class="cnt">${c.productCount}</span>
        </a>`).join('');
  }

  // Featured
  try {
    const data = await api('/api/products/featured');
    const host = root.querySelector('#home-featured');
    if (data.products.length === 0) {
      host.innerHTML = emptyBlock({
        ico: 'package',
        title: 'Chưa có sản phẩm',
        desc: 'Danh mục đang được cập nhật. Vui lòng quay lại sau.',
      });
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
      // Không có dữ liệu bán -> ẩn cả khối thay vì hiện lưới rỗng
      popHost.closest('section').style.display = 'none';
    }
  } catch (e) {
    toast(e.message, 'error');
  }
}
