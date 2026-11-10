/** Trang thanh toán. */
import { api, esc, fmtVnd, toast, navigate, loadingBlock, decodeKey, copyText, store, emptyBlock } from '../lib.js';
import { icon } from '../icons.js';
import { state, clearCart, refreshBalance, removeFromCart, saveCart } from '../state.js';

export function renderCheckout() {
  return `
  <div id="site-header"></div>
  <section class="section-sm">
    <div class="container">
      <nav class="pd-breadcrumb" aria-label="Đường dẫn">
        <a href="#/">Trang chủ</a>${icon('chevronRight', { size: 12, cls: 'crumb-sep' })}
        <span class="text-dim">Thanh toán</span>
      </nav>
      <div id="checkout-content">${loadingBlock('Đang chuẩn bị đơn hàng...')}</div>
    </div>
  </section>
  <div id="site-footer"></div>`;
}

export async function mountCheckout(root, query = {}) {
  const host = root.querySelector('#checkout-content');
  const mode = query.mode || '';

  if (!state.user) {
    const back = mode === 'buynow' ? '/checkout?mode=buynow' : '/checkout';
    navigate('/login?redirect=' + encodeURIComponent(back), { replace: true });
    return;
  }

  // ===== Chế độ MUA NGAY: chỉ thanh toán 1 sản phẩm, không đụng giỏ hàng =====
  let buyNowItems = null;
  if (mode === 'buynow') {
    buyNowItems = store.get('mbk_buynow', null);
    if (!buyNowItems || buyNowItems.length === 0) {
      navigate('/products', { replace: true });
      return;
    }
  }
  const items = buyNowItems || state.cart;

  if (items.length === 0) {
    host.innerHTML = emptyBlock({
      ico: 'cart',
      title: 'Giỏ hàng trống',
      desc: 'Thêm sản phẩm trước khi thanh toán.',
      action: '<a class="btn btn-primary btn-sm" href="#/products">Xem sản phẩm</a>',
    });
    return;
  }

  // ===== ĐỒNG BỘ GIÁ VỚI SERVER TRƯỚC KHI HIỂN THỊ =====
  // Trước đây giỏ hàng dùng giá lưu trong localStorage -> khách thấy 1.000đ
  // nhưng bị trừ 450.000đ. Nay luôn lấy giá thật từ server.
  host.innerHTML = loadingBlock('Đang kiểm tra giá...');
  const priceChanges = [];
  const removed = [];
  try {
    for (const item of [...items]) {
      try {
        const d = await api('/api/products/' + encodeURIComponent(item.slug || item.productId));
        const p = d.product;
        const drop = () => {
          if (buyNowItems) {
            buyNowItems = buyNowItems.filter((x) => x.productId !== item.productId);
            store.set('mbk_buynow', buyNowItems);
          } else {
            removeFromCart(item.productId);
          }
        };
        if (!p.active || (!p.inStock && p.deliveryType !== 'license' && p.deliveryType !== 'manual')) {
          removed.push({ name: item.name, reason: 'đã ngừng bán hoặc hết hàng' });
          drop();
          continue;
        }
        if (p.price !== item.price) {
          priceChanges.push({ name: p.name, from: item.price, to: p.price });
        }
        // Cập nhật lại giá + tồn kho thật
        item.price = p.price;
        item.name = p.name;
        item.stock = p.stock;
        item.deliveryType = p.deliveryType;
      } catch {
        removed.push({ name: item.name, reason: 'không còn tồn tại' });
        if (buyNowItems) {
          buyNowItems = buyNowItems.filter((x) => x.productId !== item.productId);
          store.set('mbk_buynow', buyNowItems);
        } else {
          removeFromCart(item.productId);
        }
      }
    }
    if (!buyNowItems) saveCart();
  } catch { /* mạng lỗi -> dùng giá cũ, server vẫn là nguồn sự thật */ }

  if (items.length === 0) {
    host.innerHTML = emptyBlock({
      ico: 'cart',
      title: 'Không còn sản phẩm hợp lệ',
      desc: removed.length
        ? removed.map((r) => `${r.name} (${r.reason})`).join(', ')
        : 'Giỏ hàng trống',
      action: '<a class="btn btn-primary btn-sm" href="#/products">Xem sản phẩm</a>',
    });
    return;
  }

  const subtotal = items.reduce((s, i) => s + i.price * i.quantity, 0);
  let discount = 0;
  let appliedCoupon = null;

  const priceNotice = (priceChanges.length || removed.length) ? `
    <div class="alert ${priceChanges.length ? 'alert-warn' : 'alert-info'} alert-block">
      <span class="ico">${icon(priceChanges.length ? 'alert' : 'info', { size: 15 })}</span>
      <span>
        ${removed.length ? `<strong>Đã xoá khỏi giỏ:</strong> ${removed.map((r) => esc(r.name) + ' (' + esc(r.reason) + ')').join('; ')}` : ''}
        ${removed.length && priceChanges.length ? '<br>' : ''}
        ${priceChanges.length
          ? `<strong>Giá đã thay đổi, vui lòng kiểm tra lại:</strong><br>` +
            priceChanges.map((c) => `${esc(c.name)}: <s>${fmtVnd(c.from)}</s> ${icon('arrowRight', { size: 11 })} <strong>${fmtVnd(c.to)}</strong>`).join('<br>')
          : ''}
      </span>
    </div>` : '';

  host.innerHTML = `
    ${priceNotice}
    <div class="checkout-grid">
      <div>
        <div class="panel">
          <h2 class="panel-title">${icon('bag', { size: 15 })} Sản phẩm trong đơn</h2>
          <div id="checkout-items" class="ck-items">
            ${items.map((i) => `
              <div class="ck-item">
                <span class="ck-item-thumb">
                  ${i.imageUrl ? `<img src="${esc(i.imageUrl)}" alt="" loading="lazy"
                    data-img-fallback="class">` : ''}
                  ${icon('package', { size: 18 })}
                </span>
                <div class="ck-item-main">
                  <div class="ck-item-name">${esc(i.name)}</div>
                  <div class="ck-item-meta">${fmtVnd(i.price)} × ${i.quantity}</div>
                </div>
                <div class="ck-item-total">${fmtVnd(i.price * i.quantity)}</div>
              </div>`).join('')}
          </div>
        </div>

        <div class="panel mt-2">
          <div class="panel-title ck-note-title">
            <label for="order-note">${icon('edit', { size: 15 })} Ghi chú đơn hàng</label>
          </div>
          <textarea class="textarea" id="order-note" placeholder="Yêu cầu đặc biệt (không bắt buộc)"
            maxlength="500" aria-label="Ghi chú đơn hàng"></textarea>
        </div>
      </div>

      <div>
        <div class="panel ck-summary">
          <h2 class="panel-title">${icon('wallet', { size: 15 })} Thanh toán</h2>

          <div class="summary-row"><span>Tạm tính</span><span id="sum-subtotal">${fmtVnd(subtotal)}</span></div>
          <div class="summary-row" id="sum-discount-row" hidden>
            <span>Giảm giá</span><span class="text-green" id="sum-discount">—</span>
          </div>
          <div class="summary-row total"><span>Tổng cộng</span><span class="val" id="sum-total">${fmtVnd(subtotal)}</span></div>

          <div class="ck-wallet">
            <div class="ck-wallet-row">
              <span class="ck-wallet-label">${icon('wallet', { size: 13 })} Số dư ví</span>
              <strong class="ck-wallet-val" id="wallet-balance">${fmtVnd(state.user.balance)}</strong>
            </div>
            <div class="ck-wallet-warn" id="balance-warning" role="status" hidden></div>
          </div>

          <button class="btn btn-primary btn-lg btn-block" id="btn-place-order">
            ${icon('lock', { size: 15 })}Xác nhận thanh toán
          </button>
          <button class="btn btn-ghost btn-block mt-1" id="btn-topup" hidden>
            ${icon('plus', { size: 15 })}Nạp thêm tiền
          </button>

          <div class="alert alert-info ck-secure">
            <span class="ico">${icon('shieldCheck', { size: 14 })}</span>
            <span>Giao dịch được xử lý qua kết nối mã hoá. Key hiển thị ngay sau khi trừ tiền từ ví.</span>
          </div>
        </div>
      </div>
    </div>
  `;

  // Mã giảm giá đã bị gỡ — không còn coupon trong hệ thống.
  // discount luôn = 0, appliedCoupon luôn = null.

  function updateTotals() {
    const total = subtotal - discount;
    host.querySelector('#sum-subtotal').textContent = fmtVnd(subtotal);
    const dRow = host.querySelector('#sum-discount-row');
    if (discount > 0) {
      dRow.hidden = false;
      host.querySelector('#sum-discount').textContent = '-' + fmtVnd(discount);
    } else {
      dRow.hidden = true;
    }
    host.querySelector('#sum-total').textContent = fmtVnd(total);

    const bal = state.user.balance;
    const warn = host.querySelector('#balance-warning');
    const topupBtn = host.querySelector('#btn-topup');
    if (bal < total) {
      warn.hidden = false;
      warn.textContent = `Thiếu ${fmtVnd(total - bal)}. Vui lòng nạp thêm tiền vào ví.`;
      topupBtn.hidden = false;
    } else {
      warn.hidden = true;
      topupBtn.hidden = true;
    }
  }

  const payBtn = host.querySelector('#btn-place-order');

  host.querySelector('#btn-topup').onclick = () => navigate('/wallet');
  updateTotals();

  payBtn.onclick = async () => {
    payBtn.disabled = true;
    payBtn.textContent = 'Đang xử lý...';
    try {
      const orderData = await api('/api/orders', {
        method: 'POST',
        body: {
          items: items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
          couponCode: appliedCoupon,
          note: host.querySelector('#order-note').value.trim() || null,
        },
      });

      const payData = await api(`/api/orders/${orderData.order.id}/pay`, { method: 'POST' });
      if (mode === 'buynow') { store.del('mbk_buynow'); } else { clearCart(); }
      if (state.user) state.user.balance = payData.balance;
      await refreshBalance();

      showSuccess(host, payData.order, orderData.order);
    } catch (e) {
      toast(e.message, 'error', 5000);
      if (e.code === 'INSUFFICIENT_BALANCE') {
        updateTotals();
        navigate('/wallet');
      }
      payBtn.disabled = false;
      payBtn.innerHTML = `${icon('lock', { size: 15 })}Xác nhận thanh toán`;
    }
  };
}

function showSuccess(host, order, created) {
  const paid = order.total != null ? order.total : (created ? created.total : 0);
  const sub = created ? created.subtotal : null;
  const disc = created ? created.discount : 0;
  const balAfter = state.user ? state.user.balance : null;

  host.innerHTML = `
    <div class="panel ck-done">
      <div class="ck-done-head">
        <span class="ck-done-badge" aria-hidden="true">${icon('check', { size: 26, stroke: 2.4 })}</span>
        <h2 class="ck-done-title">Thanh toán thành công</h2>
        <p class="ck-done-sub">
          Mã đơn hàng: <strong class="mono ck-done-code">${esc(order.code)}</strong>
        </p>

        <div class="ck-done-receipt">
          ${sub != null ? `<div class="ck-receipt-row"><span>Tạm tính</span><span>${fmtVnd(sub)}</span></div>` : ''}
          ${disc > 0 ? `<div class="ck-receipt-row text-green"><span>Giảm giá</span><span>−${fmtVnd(disc)}</span></div>` : ''}
          <div class="ck-receipt-row ck-receipt-total"><span>Đã trừ</span><span>${fmtVnd(paid)}</span></div>
          ${balAfter != null ? `<div class="ck-receipt-row ck-receipt-balance">
            <span>Số dư còn lại</span><span>${fmtVnd(balAfter)}</span></div>` : ''}
        </div>

        <p class="ck-done-note">
          ${order.status === 'delivered'
            ? 'Sản phẩm của bạn đã được giao bên dưới.'
            : 'Đơn hàng đang được xử lý. Chúng tôi sẽ giao trong 5–15 phút.'}
        </p>
      </div>

      <div class="ck-delivered">
        ${order.delivered.map((d) => `
          <section class="ck-delivered-item">
            <h3 class="ck-delivered-name">${icon('package', { size: 15 })} ${esc(d.name)}</h3>
            ${d.manual
              ? `<div class="alert alert-warn ck-alert-flat">
                   <span class="ico">${icon('clock', { size: 15 })}</span>
                   <span>Sản phẩm này cần giao thủ công. Chúng tôi sẽ liên hệ bạn qua email hoặc Telegram trong 5–15 phút.</span>
                 </div>`
              : d.license
                ? d.keys.map((raw) => {
                    const key = decodeKey(raw);
                    return `
                      <div class="key-box">
                        <span class="key-value">${esc(key)}</span>
                        <button type="button" class="key-copy" data-copy="${esc(key)}">
                          ${icon('copy', { size: 13 })}Sao chép
                        </button>
                      </div>
                      <div class="ck-license-hint">
                        <div class="ck-license-title">${icon('bolt', { size: 13 })} Lấy lệnh cài đặt</div>
                        <p class="ck-license-desc">
                          Vào <strong>License của tôi</strong> để lấy lệnh cài đặt riêng cho key này
                          (mỗi lệnh dùng một lần, hết hạn sau 24 giờ).
                        </p>
                        <a class="btn btn-primary btn-sm" href="#/licenses">
                          ${icon('key', { size: 13 })}Lấy lệnh cài đặt
                        </a>
                      </div>`;
                  }).join('')
                : d.keys.map((raw) => {
                    const key = decodeKey(raw);
                    return `
                      <div class="key-box">
                        <span class="key-value">${esc(key)}</span>
                        <button type="button" class="key-copy" data-copy="${esc(key)}">
                          ${icon('copy', { size: 13 })}Sao chép
                        </button>
                      </div>`;
                  }).join('')}
          </section>`).join('')}
      </div>

      <div class="alert alert-info ck-alert-flat">
        <span class="ico">${icon('info', { size: 15 })}</span>
        <span>Key cũng được lưu trong mục <strong>Đơn hàng</strong> và <strong>License của tôi</strong>. Vui lòng bảo mật key.</span>
      </div>

      <div class="ck-done-actions">
        <a class="btn btn-primary" href="#/licenses">${icon('key', { size: 14 })}Xem License</a>
        <a class="btn btn-ghost" href="#/orders">${icon('receipt', { size: 14 })}Đơn hàng</a>
        <a class="btn btn-ghost" href="#/products">Tiếp tục mua sắm</a>
      </div>
    </div>
  `;

  host.querySelectorAll('[data-copy]').forEach((b) => {
    b.onclick = async () => {
      const okCopy = await copyText(b.dataset.copy);
      toast(okCopy ? 'Đã sao chép' : 'Không thể sao chép, hãy chọn thủ công', okCopy ? 'success' : 'error');
    };
  });
}
