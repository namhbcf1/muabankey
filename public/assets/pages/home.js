/** Trang chủ. */
import {
  api, esc, fmtVnd, fmtNum, skeletonCards, navigate, toast, openModal,
  emptyBlock, closeAllModals, fmtDate,
} from '../lib.js';
import { state } from '../state.js';
import { icon, iconBox } from '../icons.js';
import { TRIAL, TRIAL_BADGE, TRIAL_START_NOTE } from '../policy.js';

export function productCard(p) {
  const isLicense = p.deliveryType === 'license';
  const soldOut = p.stock <= 0 && p.deliveryType !== 'manual' && !isLicense;
  const stockClass = soldOut ? 'out' : p.stock < 5 && !isLicense ? 'low' : 'ok';
  const stockText = isLicense
    ? 'Giao tự động'
    : p.deliveryType === 'manual'
      ? 'Giao thủ công'
      : p.stock <= 0 ? 'Hết hàng' : `Còn ${p.stock}`;
  const badgeMap = { HOT: 'badge-hot', NEW: 'badge-new', SALE: 'badge-sale' , 'RẺ': 'badge-hot'};

  return `
  <article class="product-card">
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
        <span>${Number(p.ratingCount) > 0
          ? `${icon('star', { size: 11, fill: true, stroke: 0 })} ${Number(p.rating).toFixed(1)} · ${fmtNum(p.ratingCount)} đánh giá`
          : 'Chưa có đánh giá'}</span>
        <span>Đã bán ${fmtNum(p.sold)}</span>
      </div>
      <div class="product-foot">
        <div class="price-box">
          <span class="price-now">${fmtVnd(p.price)}</span>
          ${p.comparePrice ? `<span class="price-old">${fmtVnd(p.comparePrice)}</span>` : ''}
        </div>
        <button class="btn-buy" data-add="${esc(p.id)}" ${soldOut ? 'disabled' : ''}
          aria-label="${soldOut ? `Hết hàng: ${esc(p.name)}` : `Mua ${esc(p.name)}`}">
          ${soldOut ? 'Hết' : 'Mua'}
        </button>
      </div>
    </div>
  </article>`;
}

/*
 * `bindProductCards` đã xoá: thân hàm chỉ là no-op (`void (p, 1)`) từ khi giỏ
 * hàng bị gỡ. Nút mua được xử lý tập trung ở `bindBuyNow()` (app.js) qua pha
 * CAPTURE trên document, và `bindBuyNowCards()` (checkout.js) cho nút đã gắn
 * listener riêng.
 */

export function renderHome() {
  return `
  <div id="site-header"></div>

  <section class="hero">
    <div class="container hero-inner">
      <div class="hero-pill">
        <span class="pulse"></span>
        ${TRIAL_BADGE}
      </div>
      <h1>Bỏ sương mù &amp; thêm tài nguyên<br>cho AoE XArena</h1>
      <p class="hero-sub">
        Một file duy nhất cho XArena: <strong>XA ARENA</strong> — xoá sương mù toàn map
        + minimap, kèm cộng vàng/gỗ/thịt ngay trong trận.
        Tải về, bấm đúp là chạy. <strong>Không cần key.</strong>
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

  <!-- ===== KHỐI DÙNG THỬ: THEO CHÍNH SÁCH policy.js ===== -->
  <section class="section-sm" id="trial-section">
    <div class="container">
      <div class="sec-head">
        <div>
          <h2 class="sec-title">Dùng thử miễn phí</h2>
          <p class="sec-desc">Mỗi tài khoản được dùng thử <strong>${TRIAL.days} ngày</strong>
            cho cả hai tính năng. Hạn mức do shop đặt:
            <strong data-trial-quota>nhiều lượt</strong> cho mỗi thiết bị.</p>
        </div>
      </div>

      <div class="trial-grid trial-grid-one">
        <!-- ===== GÓI DÙNG THỬ — MỘT NÚT, KHÔNG CHỌN GÌ ===== -->
        <div class="card trial-card trial-card-accent">
          <div class="trial-head">
            <span class="pill pill-yellow">${icon('bolt', { size: 11 })} Dùng thử nhanh</span>
          </div>
          <h3 class="trial-name">Dùng thử <span class="trial-hl warn">${TRIAL.days} ngày</span></h3>
          <div class="trial-price">0đ</div>
          <ul class="feature-list trial-feats">
            <li><span class="tick">${icon('check', { size: 10, stroke: 2.4 })}</span><span>Bật cả <strong>map sáng</strong> và <strong>tài nguyên</strong></span></li>
            <li><span class="tick">${icon('check', { size: 10, stroke: 2.4 })}</span><span><strong data-trial-quota>nhiều lượt</strong> / thiết bị</span></li>
            <li><span class="tick">${icon('check', { size: 10, stroke: 2.4 })}</span><span>Tự bật khi mở app — không nhập gì</span></li>
          </ul>
          <div id="trial-1h-status" class="trial-status"></div>
          <div class="trial-pick">
            <button class="btn btn-gold btn-block" data-trial-kind="1h" data-trial-product="nofog">
              ${icon('bolt', { size: 14 })} Bật dùng thử ${TRIAL.days} ngày
            </button>
          </div>
        </div>
      </div>

      <div class="alert alert-info" style="margin-top:16px">
        <span class="ico">${icon('info', { size: 15 })}</span>
        <span>Cần tạo tài khoản miễn phí (làm ngay trong app). ${TRIAL_START_NOTE},
          nên đăng ký hôm nay rồi mai mới cài vẫn còn đủ ${TRIAL.days} ngày.</span>
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
      <div class="cat-scroll" id="home-cats" role="group" aria-label="Lọc theo danh mục"></div>
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
          ['bolt', 'Mở khoá tự động', 'Mua xong, đăng nhập trong app là có ngay'],
          ['shieldCheck', 'Bảo hành 1 đổi 1', 'Lỗi là đổi mới, hoàn tiền 100% nếu không khắc phục được'],
          ['bank', 'Thanh toán VietQR', 'Quét QR theo đơn, tự mở khoá 24/7'],
          ['lock', 'Bảo mật tuyệt đối', 'Mã hoá SSL 256-bit, bản quyền gắn riêng từng máy'],
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
 * ID thiết bị (trình duyệt) để tính hạn mức dùng thử.
 *
 * Server đếm lượt theo (kind, product, device_id + IP) nên chuỗi này phải ổn
 * định giữa các lần tải trang. localStorage là chỗ duy nhất giữ được điều đó
 * mà không bắt khách đăng ký. Không tạo được ID thì gửi null — khi đó server
 * tự xử theo IP.
 */
function trialDeviceId() {
  try {
    let id = localStorage.getItem('xa_device_id');
    if (!id) {
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

/**
 * Bắt đầu dùng thử — KHÔNG đăng nhập, KHÔNG nhập gì.
 * Web gọi /api/trial/command (server vẫn sinh mã nội bộ), nhưng khách KHÔNG
 * bao giờ thấy mã đó: app XA ARENA tự nhận quyền theo máy (HWID) khi mở lần
 * đầu. Vì vậy bước cuối chỉ còn MỘT nút: tải app.
 *
 * Gói dài ngày (kind '3d') KHÔNG còn: server đặt trial3d_enabled=0, nên trang
 * chủ chỉ còn lựa chọn 1 giờ. Quảng cáo một gói không tồn tại là lỗi đã sửa.
 */
async function startTrialFlow(kind, onDone, product = 'nofog') {
  const label = `${TRIAL.days} ngày`;

  /*
   * Đóng modal cũ bằng CHÍNH hàm close() của nó.
   *
   * Trước đây chỗ này xoá thẳng các node .modal-overlay: xoá node thì listener
   * Escape trên document không được gỡ (rò rỉ) và focus không được trả về
   * phần tử đã mở modal (hỏng cho người dùng bàn phím).
   */
  closeAllModals();

  let closeLoading = null;
  openModal(`
    <div class="modal-title">Đang chuẩn bị dùng thử ${label}...</div>
    <div class="modal-sub">Vui lòng đợi vài giây</div>
  `, { onMount(overlay, close) { closeLoading = close; } });

  try {
    const data = await api('/api/trial/command', {
      method: 'POST',
      body: { kind, product, device_id: trialDeviceId() },
    });
    // Đóng modal loading TRƯỚC khi hiện kết quả
    if (closeLoading) closeLoading();
    await new Promise((r) => setTimeout(r, 320));
    showTrialReady(data, label);
    if (onDone) await onDone();
  } catch (e) {
    if (closeLoading) closeLoading();
    await new Promise((r) => setTimeout(r, 320));
    showTrialError(e.message || 'Không bật được dùng thử');
  }
}

function showTrialReady(data, label) {
  /*
   * KHÔNG hiện mã, KHÔNG nút copy.
   *
   * Khách không phải dán gì: app XA ARENA tự nhận quyền theo máy (HWID) khi
   * mở lần đầu. Còn đúng một việc — tải app.
   */
  const d = data || {};
  const leftN = Number(d.left);
  const quotaN = Number(d.quota);
  const quotaText = Number.isFinite(quotaN) && quotaN > 0
    ? `Còn <strong>${esc(String(Number.isFinite(leftN) ? leftN : 0))}/${esc(String(quotaN))}</strong> lượt cho máy này.`
    : '<strong>Không giới hạn lượt</strong> cho máy này.';

  openModal(`
    <div class="modal-title">Dùng thử ${esc(label)} đã bật</div>
    <div class="modal-sub">Tải app, bấm đúp. Thời gian dùng thử tự chạy.</div>

    <a class="btn btn-primary btn-block btn-lg" href="#/tai-ve" data-godl style="margin-bottom:14px">
      ${icon('download', { size: 15 })} Tải XA ARENA
    </a>

    <div class="alert alert-warn" style="margin-bottom:16px">
      <span class="ico">${icon('clock', { size: 15 })}</span>
      <span>
        ${quotaText}
        Đồng hồ bắt đầu từ lúc bạn mở app lần đầu. Hết giờ thì bấm
        <strong>Mua</strong> ngay trong app.
      </span>
    </div>

    <div class="flex gap-1" style="justify-content:flex-end;flex-wrap:wrap">
      <button class="btn btn-ghost" data-close>Đóng</button>
    </div>
  `, {
    onMount(overlay, close) {
      overlay.querySelector('[data-close]').onclick = close;
      overlay.querySelector('[data-godl]').onclick = (e) => {
        e.preventDefault();
        close();
        navigate('/tai-ve');
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
        <span>Mua bản quyền để dùng không giới hạn — mua xong đăng nhập trong app là có.</span>
      </div>` : ''}
    ${isDevice ? `
      <div class="alert alert-warn" style="margin-bottom:16px">
        <span class="ico">${icon('info', { size: 15 })}</span>
        <span>Cần hỗ trợ? Nhắn <strong>Telegram</strong> để được trả lời nhanh nhất.</span>
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

  /*
   * ========================================================================
   * LỖI ĐÃ SỬA (audit web, severity high): TRANG CHỦ GỌI 4 API TUẦN TỰ
   *
   * Bản cũ gọi lần lượt:
   *     await loadTrialQuota()   -> /api/trial/status
   *     api('/api/stats')        -> /api/stats
   *     await loadFeatured()     -> /api/products/featured
   *     (+ /api/auth/me, /api/categories từ hydrateState)
   *
   * Trong đó `await loadTrialQuota()` CHẶN `loadFeatured()` — một waterfall
   * thật: khách phải chờ /api/trial/status xong mới bắt đầu tải sản phẩm.
   * Cộng lại khoảng 1,6 giây trên mạng thường.
   *
   * Trong khi đó backend ĐÃ CÓ `/api/home` từ lâu: src/index.js:67 đăng ký
   * route, src/routes/products.js:266 gộp 12 câu lệnh vào MỘT env.DB.batch()
   * = một round-trip, kèm comment giải thích đúng mục tiêu này. Nhưng
   * `grep '/api/home'` trong toàn bộ public/ = 0 kết quả — frontend chưa bao
   * giờ nối vào. Tối ưu backend đã xong mà không ai dùng.
   *
   * NAY: MỘT request `/api/home` trả {categories, products, stats, trial}.
   * Không waterfall, không 4 round-trip.
   * ========================================================================
   */
  let bundle = null;
  try {
    bundle = await api('/api/home');
  } catch (e) {
    /*
     * Bundle lỗi -> KHÔNG để trang trống. Hiện lỗi + nút thử lại ở khối sản
     * phẩm, và các khối khác giữ dấu gạch thay vì số sai.
     */
    console.warn('home bundle:', e && e.message);
  }

  /* ---- 1. Dùng thử ---- */
  renderTrialState(root, bundle);
  root.querySelectorAll('[data-trial-kind]').forEach((b) => {
    b.onclick = () => startTrialFlow(b.dataset.trialKind,
      () => refreshTrialState(root), b.dataset.trialProduct || 'nofog');
  });

  /* ---- 2. Số liệu ---- */
  applyStats(root, bundle && bundle.stats);

  /* ---- 3. Danh mục ---- */
  applyCategories(root, (bundle && bundle.categories) || state.categories);

  /* ---- 4. Sản phẩm nổi bật ---- */
  await applyFeatured(root, bundle && bundle.products, bundle === null);
}

/**
 * Trạng thái dùng thử — đọc từ bundle của /api/home, KHÔNG gọi thêm.
 *
 * Server đã trả `trial` trong bundle nên khối này không cần request riêng.
 */
function renderTrialState(root, bundle) {
  const setText = (txt) => {
    const el = root.querySelector('#trial-1h-status');
    if (el) el.textContent = txt;
  };
  const setHtml = (html) => {
    const el = root.querySelector('#trial-1h-status');
    if (el) el.innerHTML = html;
  };

  const trialBlock = bundle && bundle.trial;

  // Chưa đăng nhập -> nói đúng điều kiện, không hứa "không cần đăng ký".
  if (!trialBlock) {
    setText(TRIAL.requiresAccount ? 'Cần đăng nhập để dùng thử' : '');
    return;
  }

  if (trialBlock.ok === false) {
    setText(trialBlock.msg || 'Dùng thử đang tạm đóng');
    return;
  }

  // Mô hình hiện hành trả `trial.state` + số giây còn lại.
  const stateName = String(trialBlock.state || '');
  if (stateName === 'active') {
    const left = Math.max(0, Number(trialBlock.left_sec || 0));
    const h = Math.floor(left / 3600);
    const m = Math.floor((left % 3600) / 60);
    setHtml(`<span class="trial-state ok">${icon('timer', { size: 12 })} `
      + `Đang dùng — còn ${h > 0 ? `${h} giờ ` : ''}${m} phút</span>`);
    return;
  }
  if (stateName === 'ended') {
    setHtml(`<span class="trial-state bad">Lượt dùng thử đã kết thúc</span>`);
    return;
  }
  if (stateName === 'available') {
    setHtml(`<span class="trial-state ok">${icon('check', { size: 12 })} `
      + `Sẵn sàng ${TRIAL.days} ngày — mở app để bắt đầu</span>`);
    return;
  }

  // Đường cũ: kinds['1h']
  const k = trialBlock.kinds?.['1h'];
  if (!k) { setText(''); return; }
  const q = Number(k.quota);
  if (Number.isFinite(q) && q > 0) {
    root.querySelectorAll('[data-trial-quota]').forEach((el) => {
      el.textContent = `${q} lượt`;
    });
  }
  if (k.active) {
    const activated = (k.active.activated_at || 0) > 0;
    if (!activated) {
      setHtml(`<span class="trial-state warn">${icon('clock', { size: 12 })} `
        + `Đã tạo — ${TRIAL_START_NOTE.toLowerCase()}</span>`);
    } else {
      const left = Math.max(0, (k.active.time_left_sec || 0));
      const txt = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
      setHtml(`<span class="trial-state ok">${icon('timer', { size: 12 })} `
        + `Đang dùng — còn ${txt}</span>`);
    }
    return;
  }
  if (Number(k.left) > 0) {
    setHtml(`Còn <strong>${Number(k.left)}/${Number(k.quota)}</strong> lượt`);
  } else {
    setHtml(`<span class="trial-state bad">Đã hết ${Number(k.quota)} lượt</span>`);
  }
}

/** Làm mới riêng trạng thái dùng thử (sau khi khách bấm nút). */
async function refreshTrialState(root) {
  try {
    const s = await api('/api/trial/session');
    renderTrialState(root, { trial: { ...s, ok: s.ok !== false } });
  } catch { /* giữ trạng thái cũ */ }
}

/** Số liệu thật — KHÔNG bịa số. */
function applyStats(root, stats) {
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

  if (!stats) {
    root.querySelectorAll('[data-stat]').forEach((el) => { el.textContent = '—'; });
    return;
  }
  const set = (name, val) => {
    const el = root.querySelector(`[data-stat="${name}"]`);
    if (el) animateCount(el, Number(val) || 0);
  };
  set('orders', stats.orders);
  set('products', stats.products);
  set('licenses', stats.licenses);
  set('customers', stats.customers);
}

/**
 * Chip danh mục — chỉ danh mục CÓ sản phẩm (không dẫn khách vào trang rỗng).
 * Bỏ hẳn khối nếu không có danh mục nào thay vì để lại khoảng trắng.
 */
function applyCategories(root, categories) {
  const catHost = root.querySelector('#home-cats');
  if (!catHost) return;
  const live = (categories || []).filter((c) => Number(c.productCount) > 0);
  catHost.innerHTML = live.length
    ? `<a href="#/products" class="cat-chip active">Tất cả</a>` +
      live.map((c) => `
      <a href="#/products?category=${esc(c.slug)}" class="cat-chip">
        ${esc(c.name)}
        <span class="cnt">${fmtNum(c.productCount)}</span>
      </a>`).join('')
    : '';
  const sec = catHost.closest('section');
  if (sec) sec.style.display = live.length ? '' : 'none';
}

/**
 * Sản phẩm nổi bật + top bán chạy — dùng `products` từ bundle.
 *
 * Lỗi mạng thì thay hẳn skeleton bằng thông báo + nút Thử lại (trước đây
 * lỗi chỉ hiện toast và 8 thẻ skeleton nằm lại vĩnh viễn).
 */
async function applyFeatured(root, products, bundleFailed) {
  const featuredHost = root.querySelector('#home-featured');
  if (!featuredHost) return;

  const paint = (list) => {
    if (!list.length) {
      featuredHost.innerHTML = emptyBlock({
        ico: 'package',
        title: 'Chưa có sản phẩm',
        desc: 'Danh mục đang được cập nhật. Vui lòng quay lại sau.',
      });
    } else {
      featuredHost.innerHTML = `<div class="grid-products">${list.map(productCard).join('')}</div>`;
    }

    const popHost = root.querySelector('#home-popular');
    if (!popHost) return;
    const popular = list.filter((p) => p.sold > 0).slice(0, 4);
    if (popular.length) {
      popHost.innerHTML = `<div class="grid-products">${popular.map(productCard).join('')}</div>`;
    } else {
      const sec = popHost.closest('section');
      if (sec) sec.style.display = 'none';
    }
  };

  const showError = (msg, title = 'Không tải được sản phẩm nổi bật') => {
    featuredHost.innerHTML = emptyBlock({
      ico: 'alert',
      title,
      desc: msg || 'Kiểm tra kết nối mạng rồi thử lại.',
      action: '<button class="btn btn-primary btn-sm" data-retry-featured>Thử lại</button>',
    });
    featuredHost.querySelector('[data-retry-featured]')?.addEventListener('click', async () => {
      featuredHost.innerHTML = skeletonCards(8);
      try {
        const d = await api('/api/products/featured');
        paint(d.products || []);
      } catch (err) {
        toast(err.message, 'error');
        showError(err.message, 'Vẫn không tải được sản phẩm');
      }
    });
  };

  if (bundleFailed) {
    showError('Không kết nối được máy chủ.');
    return;
  }
  paint(products || []);
}
