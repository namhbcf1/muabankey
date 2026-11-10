/** Trang thanh toán. */
import { api, esc, fmtVnd, toast, navigate, loadingBlock, decodeKey, copyText, store } from '../lib.js';
import { state, cartSubtotal, clearCart, refreshBalance, removeFromCart, saveCart } from '../state.js';

export function renderCheckout() {
  return `
  <div id="site-header"></div>
  <section class="section-sm">
    <div class="container">
      <div class="pd-breadcrumb"><a href="#/">Trang chủ</a><span>/</span><span>Thanh toán</span></div>
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
    host.innerHTML = `<div class="empty-state">
      <div class="ico">🛒</div>
      <div class="t">Giỏ hàng trống</div>
      <div class="d">Thêm sản phẩm trước khi thanh toán</div>
      <button class="btn btn-primary btn-sm" onclick="location.hash='#/products'">Xem sản phẩm</button>
    </div>`;
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
    host.innerHTML = `<div class="empty-state">
      <div class="ico">🛒</div>
      <div class="t">Không còn sản phẩm hợp lệ</div>
      <div class="d">${removed.length ? removed.map((r) => esc(r.name) + ' (' + esc(r.reason) + ')').join(', ') : 'Giỏ hàng trống'}</div>
      <button class="btn btn-primary btn-sm" onclick="location.hash='#/products'">Xem sản phẩm</button>
    </div>`;
    return;
  }

  const subtotal = items.reduce((s, i) => s + i.price * i.quantity, 0);
  let discount = 0;
  let appliedCoupon = null;

  const priceNotice = (priceChanges.length || removed.length) ? `
    <div class="alert ${priceChanges.length ? 'alert-warn' : 'alert-info'}" style="margin-bottom:18px">
      <span class="ico">${priceChanges.length ? '⚠️' : 'ℹ️'}</span>
      <span>
        ${removed.length ? `<strong>Đã xoá khỏi giỏ:</strong> ${removed.map((r) => esc(r.name) + ' (' + esc(r.reason) + ')').join('; ')}<br>` : ''}
        ${priceChanges.length
          ? `<strong>Giá đã thay đổi, vui lòng kiểm tra lại:</strong><br>` +
            priceChanges.map((c) => `• ${esc(c.name)}: <s>${fmtVnd(c.from)}</s> → <strong>${fmtVnd(c.to)}</strong>`).join('<br>')
          : ''}
      </span>
    </div>` : '';

  host.innerHTML = `
    ${priceNotice}
    <div class="checkout-grid">
      <div>
        <div class="panel">
          <div class="panel-title">📦 Sản phẩm trong đơn</div>
          <div id="checkout-items" style="display:flex;flex-direction:column;gap:12px">
            ${items.map((i) => `
              <div class="flex justify-between items-center" style="gap:12px;padding:12px;border-radius:12px;background:rgba(255,255,255,.032);border:1px solid var(--border)">
                <div class="flex gap-1 items-center" style="min-width:0">
                  <img src="${esc(i.imageUrl || '')}" alt="" class="cart-thumb" style="width:48px;height:48px"
                    onerror="this.style.display='none'">
                  <div style="min-width:0">
                    <div style="font-size:13.5px;font-weight:800;margin-bottom:2px">${esc(i.name)}</div>
                    <div style="font-size:12.5px;color:var(--text-mute)">${fmtVnd(i.price)} × ${i.quantity}</div>
                  </div>
                </div>
                <div style="font-weight:800;font-size:14px;white-space:nowrap">${fmtVnd(i.price * i.quantity)}</div>
              </div>`).join('')}
          </div>
        </div>

        <div class="panel mt-2">
          <div class="panel-title" style="margin-bottom:10px">
            <label for="order-note" style="cursor:pointer">📝 Ghi chú đơn hàng</label>
          </div>
          <textarea class="textarea" id="order-note" placeholder="Yêu cầu đặc biệt (không bắt buộc)"
            maxlength="500" aria-label="Ghi chú đơn hàng"></textarea>
        </div>
      </div>

      <div>
        <div class="panel" style="position:sticky;top:calc(var(--header-h) + 20px)">
          <div class="panel-title">💳 Thanh toán</div>

          <div class="summary-row"><span>Tạm tính</span><span id="sum-subtotal">${fmtVnd(subtotal)}</span></div>
          <div class="summary-row" id="sum-discount-row" style="display:none">
            <span>Giảm giá</span><span class="text-green" id="sum-discount">—</span>
          </div>
          <div class="summary-row total"><span>Tổng cộng</span><span class="val" id="sum-total">${fmtVnd(subtotal)}</span></div>

          <div style="margin:18px 0;padding:14px;border-radius:12px;background:rgba(255,255,255,.035);border:1px solid var(--border)">
            <div class="flex justify-between items-center mb-1">
              <span style="font-size:12.5px;color:var(--text-mute)">Số dư ví</span>
              <strong style="font-size:14px;color:#4ade80" id="wallet-balance">${fmtVnd(state.user.balance)}</strong>
            </div>
            <div id="balance-warning" style="font-size:12.5px;color:#fbbf24;display:none;margin-top:6px"></div>
          </div>

          <button class="btn btn-primary btn-lg btn-block" id="btn-place-order">
            🔒 Xác nhận thanh toán
          </button>
          <button class="btn btn-ghost btn-block mt-1" id="btn-topup" style="display:none">
            💰 Nạp thêm tiền
          </button>

          <div class="alert alert-info mt-2" style="margin-bottom:0;font-size:12.5px">
            <span class="ico">🔒</span>
            <span>Thanh toán an toàn. Key được giao ngay lập tức sau khi trừ tiền từ ví.</span>
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
      dRow.style.display = 'flex';
      host.querySelector('#sum-discount').textContent = '-' + fmtVnd(discount);
    } else {
      dRow.style.display = 'none';
    }
    host.querySelector('#sum-total').textContent = fmtVnd(total);

    const bal = state.user.balance;
    const warn = host.querySelector('#balance-warning');
    const topupBtn = host.querySelector('#btn-topup');
    if (bal < total) {
      warn.style.display = 'block';
      warn.textContent = `⚠️ Thiếu ${fmtVnd(total - bal)}. Vui lòng nạp thêm tiền vào ví.`;
      topupBtn.style.display = 'flex';
    } else {
      warn.style.display = 'none';
      topupBtn.style.display = 'none';
    }
  }

  host.querySelector('#btn-topup').onclick = () => navigate('/wallet');
  updateTotals();

  const btn = host.querySelector('#btn-place-order');
  btn.onclick = async () => {
    btn.disabled = true;
    btn.textContent = 'Đang xử lý...';
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
      btn.disabled = false;
      btn.textContent = '🔒 Xác nhận thanh toán';
    }
  };
}

function showSuccess(host, order, created) {
  const paid = order.total != null ? order.total : (created ? created.total : 0);
  const sub = created ? created.subtotal : null;
  const disc = created ? created.discount : 0;
  const balAfter = state.user ? state.user.balance : null;

  host.innerHTML = `
    <div class="panel" style="max-width:680px;margin:0 auto;padding:38px 28px">
      <div style="text-align:center">
        <div style="font-size:56px;margin-bottom:12px">🎉</div>
        <h2 style="font-size:1.6rem;font-weight:800;letter-spacing:-.03em;margin-bottom:8px">Thanh toán thành công!</h2>
        <p style="color:var(--text-dim);font-size:14px;margin-bottom:16px">
          Mã đơn hàng: <strong class="mono" style="color:#a99cff">${esc(order.code)}</strong>
        </p>

        <div style="display:inline-block;text-align:left;padding:16px 22px;border-radius:14px;
                    background:rgba(34,197,94,.07);border:1px solid rgba(34,197,94,.3);margin-bottom:22px">
          ${sub != null ? `<div style="font-size:13px;color:var(--text-mute)">Tạm tính: ${fmtVnd(sub)}</div>` : ''}
          ${disc > 0 ? `<div style="font-size:13px;color:#4ade80">Giảm giá: −${fmtVnd(disc)}</div>` : ''}
          <div style="font-size:20px;font-weight:800;color:#4ade80;margin-top:4px">
            Đã trừ: ${fmtVnd(paid)}
          </div>
          ${balAfter != null ? `<div style="font-size:12.5px;color:var(--text-mute);margin-top:3px">
            Số dư còn lại: ${fmtVnd(balAfter)}</div>` : ''}
        </div>

        <p style="color:var(--text-mute);font-size:13px;margin-bottom:26px">
          ${order.status === 'delivered' ? 'Sản phẩm của bạn đã được giao bên dưới.' : 'Đơn hàng đang được xử lý, chúng tôi sẽ giao trong 5-15 phút.'}
        </p>
      </div>

      <div style="text-align:left">
        ${order.delivered.map((d) => `
          <div style="margin-bottom:20px">
            <div style="font-size:14px;font-weight:800;margin-bottom:8px">📦 ${esc(d.name)}</div>
            ${d.manual
              ? `<div class="alert alert-warn"><span class="ico">⏳</span><span>Sản phẩm này cần giao thủ công. Chúng tôi sẽ liên hệ bạn qua email/Telegram trong 5-15 phút.</span></div>`
              : d.license
                ? d.keys.map((raw) => {
                    const key = decodeKey(raw);
                    return `
                      <div class="key-box">
                        <div class="key-value">${esc(key)}</div>
                        <button class="key-copy" data-copy="${esc(key)}">📋 Key</button>
                      </div>
                      <div style="margin-top:10px;padding:15px;border-radius:12px;background:rgba(34,211,238,.07);border:1px solid rgba(34,211,238,.3)">
                        <div style="font-size:12.5px;font-weight:800;color:#67e8f9;margin-bottom:9px">
                          ⚡ LẤY LỆNH CÀI ĐẶT
                        </div>
                        <div style="font-size:12px;color:var(--text-mute);line-height:1.65;margin-bottom:11px">
                          Vào <strong>License của tôi</strong> để lấy lệnh cài đặt riêng cho key này
                          (mỗi lệnh dùng 1 lần, hết hạn sau 24 giờ).
                        </div>
                        <button class="btn btn-primary btn-sm" onclick="location.hash='#/licenses'">
                          🔑 Lấy lệnh cài đặt
                        </button>
                      </div>`;
                  }).join('')
                : d.keys.map((raw) => {
                    const key = decodeKey(raw);
                    return `
                      <div class="key-box">
                        <div class="key-value">${esc(key)}</div>
                        <button class="key-copy" data-copy="${esc(key)}">📋 Sao chép</button>
                      </div>`;
                  }).join('')}
          </div>`).join('')}
      </div>

      <div class="alert alert-info" style="text-align:left">
        <span class="ico">📄</span>
        <span>Key cũng được lưu trong mục <strong>Đơn hàng</strong> và <strong>License của tôi</strong>. Vui lòng bảo mật key.</span>
      </div>

      <div class="flex gap-1 mt-3" style="justify-content:center;flex-wrap:wrap">
        <button class="btn btn-primary" onclick="location.hash='#/licenses'">🔑 Xem License</button>
        <button class="btn btn-ghost" onclick="location.hash='#/orders'">📦 Đơn hàng</button>
        <button class="btn btn-ghost" onclick="location.hash='#/products'">Tiếp tục mua sắm</button>
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
