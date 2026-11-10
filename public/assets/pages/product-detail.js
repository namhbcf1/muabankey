/** Trang chi tiết sản phẩm. */
import { api, esc, fmtVnd, fmtNum, fmtDate, toast, navigate, loadingBlock, store } from '../lib.js';
import { addToCart, state, notify } from '../state.js';
import { productCard, bindProductCards } from './home.js';

export function renderProductDetail() {
  return `
  <div id="site-header"></div>
  <section class="section-sm">
    <div class="container" id="pd-content">${loadingBlock('Đang tải sản phẩm...')}</div>
  </section>
  <div id="site-footer"></div>`;
}

export async function mountProductDetail(root, slug) {
  const host = root.querySelector('#pd-content');
  let data;
  try {
    data = await api('/api/products/' + encodeURIComponent(slug));
  } catch (e) {
    host.innerHTML = `<div class="empty-state">
      <div class="ico">🔍</div>
      <div class="t">Không tìm thấy sản phẩm</div>
      <div class="d">${esc(e.message)}</div>
      <button class="btn btn-primary btn-sm" onclick="location.hash='#/products'">Xem sản phẩm khác</button>
    </div>`;
    return;
  }

  const p = data.product;
  const isLicense = p.deliveryType === 'license';
  const inStock = p.stock > 0 || p.deliveryType === 'manual' || isLicense;
  const maxQty = isLicense ? 10 : Math.min(p.stock || 20, 20);

  host.innerHTML = `
    <div class="pd-breadcrumb">
      <a href="#/">Trang chủ</a><span>/</span>
      <a href="#/products?category=${esc(p.categorySlug || '')}">${esc(p.categoryName || 'Sản phẩm')}</a>
      <span>/</span><span style="color:var(--text)">${esc(p.name)}</span>
    </div>

    <div class="pd-grid">
      <div>
        <div class="pd-image">
          <img src="${esc(p.imageUrl || '')}" alt="${esc(p.name)}"
            onerror="this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 400 275%22%3E%3Crect fill=%22%23141424%22 width=%22400%22 height=%22275%22/%3E%3Ctext x=%2250%25%22 y=%2255%25%22 font-size=%2270%22 text-anchor=%22middle%22%3E%F0%9F%94%91%3C/text%3E%3C/svg%3E'">
        </div>

        <div class="info-strips">
          <div class="info-strip">
            <div class="ico">⚡</div>
            <div class="t">Giao tự động</div>
            <div class="d">Nhận key ngay sau thanh toán</div>
          </div>
          <div class="info-strip">
            <div class="ico">🛡️</div>
            <div class="t">Bảo hành ${p.warrantyDays} ngày</div>
            <div class="d">1 đổi 1 nếu key lỗi</div>
          </div>
          <div class="info-strip">
            <div class="ico">💳</div>
            <div class="t">VietQR</div>
            <div class="d">Nạp ví tự động 24/7</div>
          </div>
        </div>

        <div class="panel mt-3">
          <div class="panel-title">📋 Mô tả sản phẩm</div>
          <div style="font-size:14px;color:var(--text-dim);line-height:1.75;white-space:pre-wrap">${esc(p.description || p.shortDesc || 'Đang cập nhật...')}</div>
        </div>

        ${data.reviews && data.reviews.length ? `
        <div class="panel mt-3">
          <div class="panel-title">💬 Đánh giá từ khách hàng (${fmtNum(p.ratingCount)})</div>
          <div style="display:flex;flex-direction:column;gap:14px">
            ${data.reviews.map((r) => `
              <div style="padding:14px;border-radius:12px;background:rgba(255,255,255,.035);border:1px solid var(--border)">
                <div class="flex justify-between items-center mb-1" style="gap:10px">
                  <div style="font-size:13.5px;font-weight:800">${esc(r.author)}</div>
                  <div style="color:var(--gold);font-size:12.5px">${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</div>
                </div>
                <div style="font-size:13.5px;color:var(--text-dim);line-height:1.6">${esc(r.comment || '')}</div>
                <div style="font-size:11.5px;color:var(--text-mute);margin-top:6px">${fmtDate(r.createdAt)}</div>
              </div>`).join('')}
          </div>
        </div>` : ''}
      </div>

      <div>
        <div class="panel" style="position:sticky;top:calc(var(--header-h) + 20px)">
          <div class="flex gap-1 mb-2" style="flex-wrap:wrap">
            ${p.badge ? `<span class="badge ${p.badge === 'HOT' ? 'badge-hot' : p.badge === 'SALE' ? 'badge-sale' : 'badge-new'}" style="position:static">${esc(p.badge)}</span>` : ''}
            <span class="pill ${inStock ? 'pill-green' : 'pill-red'}">${inStock ? (isLicense ? '● Giao tự động' : `● Còn ${p.deliveryType === 'manual' ? 'hàng' : p.stock}`) : '● Hết hàng'}</span>
            <span class="pill pill-blue">${esc(p.durationLabel || 'Theo gói')}</span>
          </div>

          <h1 class="pd-title" style="font-size:clamp(1.4rem,2.6vw,1.9rem)">${esc(p.name)}</h1>

          <div class="pd-rating">
            <span style="color:var(--gold);font-size:15px">${'★'.repeat(Math.round(p.rating))}</span>
            <span><strong style="color:var(--text)">${Number(p.rating).toFixed(1)}</strong> (${fmtNum(p.ratingCount)} đánh giá)</span>
            <span>·</span><span>Đã bán ${fmtNum(p.sold)}</span>
          </div>

          <div class="pd-price">
            <span class="now">${fmtVnd(p.price)}</span>
            ${p.comparePrice ? `<span class="old">${fmtVnd(p.comparePrice)}</span>` : ''}
            ${p.discountPercent > 0 ? `<span class="save">Tiết kiệm ${p.discountPercent}%</span>` : ''}
          </div>

          ${p.features && p.features.length ? `
          <ul class="feature-list">
            ${p.features.map((f) => `<li><span class="tick">✓</span><span>${esc(f)}</span></li>`).join('')}
          </ul>` : ''}

          <div class="qty-row">
            <span class="label" style="margin:0">Số lượng</span>
            <div class="qty-ctrl">
              <button id="qty-dec" aria-label="Giảm">−</button>
              <input id="qty-val" type="text" value="1" inputmode="numeric" aria-label="Số lượng">
              <button id="qty-inc" aria-label="Tăng">+</button>
            </div>
            <span style="font-size:12.5px;color:var(--text-mute)">Tối đa ${maxQty}</span>
          </div>

          <div class="flex gap-1" style="flex-direction:column">
            <button class="btn btn-primary btn-lg btn-block" id="btn-add-cart" ${!inStock ? 'disabled' : ''}>
              🛒 ${inStock ? 'Thêm vào giỏ hàng' : 'Tạm hết hàng'}
            </button>
            <button class="btn btn-gold btn-block" id="btn-buy-now" ${!inStock ? 'disabled' : ''}>
              ⚡ Mua ngay
            </button>
          </div>

          <div class="alert alert-info mt-2" style="margin-bottom:0">
            <span class="ico">${isLicense ? '⚡' : '💡'}</span>
            <span>${isLicense
              ? 'Sau khi thanh toán, bạn nhận <strong>lệnh CMD cài đặt tự động</strong> — dán vào CMD là tool tự cài, kích hoạt và tạo shortcut Desktop.'
              : 'Sau khi thanh toán, key sẽ hiển thị ngay trong mục <strong>Đơn hàng</strong> và gửi về email của bạn.'}</span>
          </div>
        </div>
      </div>
    </div>

    ${data.related && data.related.length ? `
    <div class="mt-4">
      <div class="sec-head">
        <h2 class="sec-title" style="font-size:1.35rem">Sản phẩm liên quan</h2>
        <a href="#/products?category=${esc(p.categorySlug || '')}" class="sec-link">Xem tất cả →</a>
      </div>
      <div class="grid-products" id="related-grid">${data.related.map(productCard).join('')}</div>
    </div>` : ''}
  `;

  // Qty controls
  const qtyInput = host.querySelector('#qty-val');
  host.querySelector('#qty-inc').onclick = () => {
    qtyInput.value = Math.min(maxQty, (Number(qtyInput.value) || 1) + 1);
  };
  host.querySelector('#qty-dec').onclick = () => {
    qtyInput.value = Math.max(1, (Number(qtyInput.value) || 1) - 1);
  };
  qtyInput.addEventListener('change', () => {
    const v = Math.max(1, Math.min(maxQty, Number(qtyInput.value.replace(/\D/g, '')) || 1));
    qtyInput.value = v;
  });

  const getQty = () => Math.max(1, Math.min(maxQty, Number(qtyInput.value) || 1));

  const addBtn = host.querySelector('#btn-add-cart');
  if (addBtn) addBtn.onclick = () => addToCart(p, getQty());

  const buyBtn = host.querySelector('#btn-buy-now');
  if (buyBtn) {
    buyBtn.onclick = () => {
      // "Mua ngay" chỉ mua sản phẩm này, KHÔNG gộp với giỏ hàng hiện có
      const saved = state.cart.slice();
      const qty = getQty();
      if (!addToCart(p, qty)) return;
      const bought = state.cart.filter((i) => i.productId !== p.id);
      // Giữ lại các món khác trong giỏ, chỉ đưa sản phẩm này sang thanh toán
      store.set('mbk_cart', saved);
      state.cart = saved.slice();
      notify();
      store.set('mbk_buynow', [{ ...bought[0] }]);
      if (!state.user) {
        toast('Vui lòng đăng nhập để thanh toán', 'info');
        navigate('/login?redirect=/checkout?mode=buynow');
      } else {
        navigate('/checkout?mode=buynow');
      }
    };
  }

  const related = host.querySelector('#related-grid');
  if (related) bindProductCards(related, data.related);
}
