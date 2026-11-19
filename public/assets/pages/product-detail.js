/** Trang chi tiết sản phẩm. */
import { api, esc, fmtVnd, fmtNum, fmtDate, loadingBlock, emptyBlock } from '../lib.js';
import { icon } from '../icons.js';
import { buyNow, bindBuyNowCards } from './checkout.js';
import { productCard } from './home.js';

/*
 * MUA NGAY: không còn "Thêm vào giỏ", không còn chọn số lượng.
 * Một sản phẩm -> một nút -> thẳng tới mã QR (checkout.js tự tạo đơn).
 */

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
  const stockLabel = inStock
    ? (isLicense ? 'Giao tự động' : `Còn ${p.deliveryType === 'manual' ? 'hàng' : fmtNum(p.stock)}`)
    : 'Hết hàng';
  const badgeCls = p.badge === 'HOT' ? 'badge-hot' : p.badge === 'SALE' ? 'badge-sale' : 'badge-new';

  /*
   * Giá gạch chỉ đúng khi comparePrice CAO HƠN price. Dữ liệu cũ có sản phẩm
   * comparePrice thấp hơn price nên trang hiện "~~60.000đ~~ 90.000đ" (giảm giá
   * âm). Dùng đúng quy tắc server tính discountPercent (src/routes/products.js,
   * shapeProduct): chỉ khi compare_price > price mới có giảm giá, còn lại = 0.
   * Vì vậy chốt điều kiện comparePrice > price rồi mới vẽ giá gạch.
   */
  const hasCompare = Number(p.comparePrice) > Number(p.price);

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
            <div class="d">Licence tự gắn sau thanh toán</div>
          </div>
          <div class="info-strip">
            <div class="ico">${icon('shieldCheck', { size: 17 })}</div>
            <div class="t">Bảo hành ${fmtNum(p.warrantyDays)} ngày</div>
            <div class="d">Gắn lại nếu tool không chạy</div>
          </div>
          <div class="info-strip">
            <div class="ico">${icon('card', { size: 17 })}</div>
            <div class="t">VietQR</div>
            <div class="d">Quét QR, licence tự gắn vào tài khoản</div>
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
            ${hasCompare ? `<span class="old">${fmtVnd(p.comparePrice)}</span>` : ''}
            ${hasCompare && p.discountPercent > 0 ? `<span class="save">Tiết kiệm ${p.discountPercent}%</span>` : ''}
          </div>

          ${p.durationLabel ? `
          <p class="pd-term">
            Thời hạn: <strong>${esc(p.durationLabel)}</strong>
            ${isLicense ? ' · 1 licence dùng cho 1 máy' : ''}
          </p>` : ''}

          ${p.features && p.features.length ? `
          <ul class="feature-list">
            ${p.features.map((f) => `<li><span class="tick">${icon('check', { size: 11, stroke: 2.4 })}</span><span>${esc(f)}</span></li>`).join('')}
          </ul>` : ''}

          <div class="pd-actions">
            <button class="btn btn-primary btn-lg btn-block" id="btn-buy-now" ${!inStock ? 'disabled' : ''}>
              ${icon('bolt', { size: 16 })}${inStock ? 'Mua ngay' : 'Tạm hết hàng'}
            </button>
          </div>

          <div class="alert alert-info pd-note">
            <span class="ico">${icon(isLicense ? 'login' : 'info', { size: 15 })}</span>
            <span>${isLicense
              ? 'Thanh toán xong, mở <strong>XA ARENA</strong> và bấm <strong>Đăng nhập</strong> — licence tự gắn vào tài khoản. Không cần nhập mã, không cần cài đặt.'
              : 'Sau khi thanh toán, đơn hiện ngay trong mục <strong>Đơn hàng</strong> (xem lại bất cứ lúc nào).'}</span>
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

  // Mua ngay: một món, một cú bấm, thẳng tới mã QR (không qua giỏ hàng).
  const buyBtn = host.querySelector('#btn-buy-now');
  if (buyBtn) buyBtn.onclick = () => buyNow(p);

  const related = host.querySelector('#related-grid');
  if (related) bindBuyNowCards(related, data.related);
}
