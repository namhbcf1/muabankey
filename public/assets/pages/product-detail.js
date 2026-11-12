/** Trang chi tiết sản phẩm. */
import { api, esc, fmtVnd, fmtNum, fmtDate, toast, navigate, loadingBlock, store, emptyBlock } from '../lib.js';
import { icon } from '../icons.js';
import { addToCart, state, notify } from '../state.js';
import { productCard, bindProductCards } from './home.js';

/** Dải sao dùng SVG — trước đây là ký tự sao phụ thuộc font hệ thống. */
function ratingStars(value, size = 13) {
  const rounded = Math.round(Number(value) || 0);
  return `<span class="pd-stars" role="img" aria-label="${rounded} trên 5 sao">${
    Array.from({ length: 5 }, (_, i) => icon('star', {
      size,
      fill: i < rounded,
      cls: i < rounded ? 'star-on' : 'star-off',
      stroke: i < rounded ? 1.2 : 1.4,
    })).join('')
  }</span>`;
}

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
    host.innerHTML = emptyBlock({
      ico: 'search',
      title: 'Không tìm thấy sản phẩm',
      desc: e.message,
      action: '<a class="btn btn-primary btn-sm" href="#/products">Xem sản phẩm khác</a>',
    });
    return;
  }

  const p = data.product;
  const isLicense = p.deliveryType === 'license';
  const inStock = p.stock > 0 || p.deliveryType === 'manual' || isLicense;
  const maxQty = isLicense ? 10 : Math.min(p.stock || 20, 20);
  const stockLabel = inStock
    ? (isLicense ? 'Giao tự động' : `Còn ${p.deliveryType === 'manual' ? 'hàng' : fmtNum(p.stock)}`)
    : 'Hết hàng';
  const badgeCls = p.badge === 'HOT' ? 'badge-hot' : p.badge === 'SALE' ? 'badge-sale' : 'badge-new';

  host.innerHTML = `
    <nav class="pd-breadcrumb" aria-label="Đường dẫn">
      <a href="#/">Trang chủ</a>${icon('chevronRight', { size: 12, cls: 'crumb-sep' })}
      <a href="#/products?category=${esc(p.categorySlug || '')}">${esc(p.categoryName || 'Sản phẩm')}</a>
      ${icon('chevronRight', { size: 12, cls: 'crumb-sep' })}
      <span class="text-dim">${esc(p.name)}</span>
    </nav>

    <div class="pd-grid">
      <div>
        <div class="pd-image">
          ${p.imageUrl
            ? `<img src="${esc(p.imageUrl)}" alt="${esc(p.name)}" data-img-fallback="class">`
            : ''}
          <span class="pd-image-fallback" aria-hidden="true">${icon('package', { size: 34 })}</span>
        </div>

        <div class="info-strips">
          <div class="info-strip">
            <div class="ico">${icon('bolt', { size: 17 })}</div>
            <div class="t">Giao tự động</div>
            <div class="d">Nhận key ngay sau thanh toán</div>
          </div>
          <div class="info-strip">
            <div class="ico">${icon('shieldCheck', { size: 17 })}</div>
            <div class="t">Bảo hành ${fmtNum(p.warrantyDays)} ngày</div>
            <div class="d">Đổi mới nếu key không hoạt động</div>
          </div>
          <div class="info-strip">
            <div class="ico">${icon('card', { size: 17 })}</div>
            <div class="t">VietQR</div>
            <div class="d">Quét QR thanh toán, tự giao key ngay</div>
          </div>
        </div>

        <div class="panel mt-3">
          <h2 class="panel-title">${icon('file', { size: 15 })} Mô tả sản phẩm</h2>
          <div class="pd-desc">${esc(p.description || p.shortDesc || 'Đang cập nhật.')}</div>
        </div>

        ${data.reviews && data.reviews.length ? `
        <div class="panel mt-3">
          <h2 class="panel-title">${icon('messageCircle', { size: 15 })} Đánh giá từ khách hàng
            <span class="pd-count">${fmtNum(p.ratingCount)}</span>
          </h2>
          <div class="pd-reviews">
            ${data.reviews.map((r) => `
              <article class="pd-review">
                <header class="pd-review-head">
                  <span class="pd-review-author">${esc(r.author)}</span>
                  ${ratingStars(r.rating, 12)}
                </header>
                <p class="pd-review-body">${esc(r.comment || '')}</p>
                <time class="pd-review-time">${fmtDate(r.createdAt)}</time>
              </article>`).join('')}
          </div>
        </div>` : ''}
      </div>

      <div>
        <div class="panel pd-buy">
          <div class="pd-flags">
            ${p.badge ? `<span class="badge ${badgeCls} pd-badge-inline">${esc(p.badge)}</span>` : ''}
            <span class="pill ${inStock ? 'pill-green' : 'pill-red'}">
              <span class="dot"></span>${stockLabel}
            </span>
            ${p.durationLabel ? `<span class="pill pill-gray">${esc(p.durationLabel)}</span>` : ''}
          </div>

          <h1 class="pd-title">${esc(p.name)}</h1>

          <div class="pd-rating">
            ${Number(p.ratingCount) > 0
              ? `${ratingStars(p.rating)}
                 <span><strong class="text-strong">${Number(p.rating).toFixed(1)}</strong> (${fmtNum(p.ratingCount)} đánh giá)</span>
                 <span class="pd-dot" aria-hidden="true">·</span>`
              : ''}
            <span>Đã bán ${fmtNum(p.sold)}</span>
          </div>

          <div class="pd-price">
            <span class="now">${fmtVnd(p.price)}</span>
            ${p.comparePrice ? `<span class="old">${fmtVnd(p.comparePrice)}</span>` : ''}
            ${p.discountPercent > 0 ? `<span class="save">Tiết kiệm ${p.discountPercent}%</span>` : ''}
          </div>

          ${p.features && p.features.length ? `
          <ul class="feature-list">
            ${p.features.map((f) => `<li><span class="tick">${icon('check', { size: 11, stroke: 2.4 })}</span><span>${esc(f)}</span></li>`).join('')}
          </ul>` : ''}

          <div class="qty-row">
            <label class="label pd-qty-label" for="qty-val">Số lượng</label>
            <div class="qty-ctrl">
              <button type="button" id="qty-dec" aria-label="Giảm số lượng">${icon('minus', { size: 14 })}</button>
              <input id="qty-val" type="text" value="1" inputmode="numeric" aria-label="Số lượng">
              <button type="button" id="qty-inc" aria-label="Tăng số lượng">${icon('plus', { size: 14 })}</button>
            </div>
            <span class="pd-qty-max">Tối đa ${maxQty}</span>
          </div>

          <div class="pd-actions">
            <button class="btn btn-primary btn-lg btn-block" id="btn-add-cart" ${!inStock ? 'disabled' : ''}>
              ${icon('cart', { size: 16 })}${inStock ? 'Thêm vào giỏ hàng' : 'Tạm hết hàng'}
            </button>
            <button class="btn btn-ghost btn-block" id="btn-buy-now" ${!inStock ? 'disabled' : ''}>
              ${icon('bolt', { size: 15 })}Mua ngay
            </button>
          </div>

          <div class="alert alert-info pd-note">
            <span class="ico">${icon(isLicense ? 'key' : 'info', { size: 15 })}</span>
            <span>${isLicense
              ? 'Sau khi thanh toán, bạn nhận <strong>lệnh CMD cài đặt tự động</strong>. Dán vào CMD để tool tự cài, kích hoạt và tạo shortcut trên Desktop.'
              : 'Sau khi thanh toán, key hiển thị ngay trong mục <strong>Đơn hàng</strong> và hiển thị ngay trong mục Đơn hàng (xem lại bất cứ lúc nào).'}</span>
          </div>
        </div>
      </div>
    </div>

    ${data.related && data.related.length ? `
    <div class="mt-4">
      <div class="sec-head">
        <h2 class="sec-title pd-related-title">Sản phẩm liên quan</h2>
        <a href="#/products?category=${esc(p.categorySlug || '')}" class="sec-link">
          Xem tất cả${icon('arrowRight', { size: 13 })}
        </a>
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
      // "Mua ngay" chỉ mua sản phẩm này, KHÔNG gộp với giỏ hàng hiện có.
      const saved = state.cart.slice();
      const qty = getQty();

      // Lấy đúng item VỪA thêm (không phụ thuộc addToCart có ghi vào state.cart
      // hay không). Trước đây dùng state.cart.filter(i => i.productId !== p.id)
      // rồi lấy [0] -> đó là món KHÁC hoặc undefined -> giỏ thanh toán rỗng.
      const item = {
        productId: p.id,
        slug: p.slug,
        name: p.name,
        price: p.price,
        // checkout.js đọc i.imageUrl (KHONG phai i.image) -> phai set dung ten
        imageUrl: p.imageUrl || p.image || p.thumbnail || null,
        quantity: qty,
        deliveryType: p.deliveryType,
        licenseDays: p.licenseDays,
      };

      if (!state.user) {
        // Chưa đăng nhập: giữ cart cũ, chỉ lưu buynow để dùng sau khi login
        store.set('mbk_buynow', [item]);
        toast('Vui lòng đăng nhập để thanh toán', 'info');
        /*
     * PHẢI encode: parseRoute tách query bằng `split('?')` nên dấu `?` thứ hai
     * không encode sẽ cắt mất `mode=buynow`. Khách vãng lai bấm "Mua ngay",
     * đăng nhập xong quay về /checkout rỗng → mất sản phẩm đã chọn.
     */
    navigate('/login?redirect=' + encodeURIComponent('/checkout?mode=buynow'));
        return;
      }

      // Đã đăng nhập: khôi phục cart cũ rồi sang checkout riêng
      store.set('mbk_cart', saved);
      state.cart = saved.slice();
      notify();
      store.set('mbk_buynow', [item]);
      navigate('/checkout?mode=buynow');
    };
  }

  const related = host.querySelector('#related-grid');
  if (related) bindProductCards(related, data.related);
}
