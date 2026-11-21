/**
 * Trang thanh toán QR — MUA NGAY, KHÔNG GIỎ HÀNG.
 *
 * Luồng duy nhất còn lại:
 *   bấm "Mua ngay" ở một sản phẩm -> mở trang này với ĐÚNG MỘT món
 *   (localStorage `mbk_buynow`) -> tự tạo đơn + hiện mã QR -> khách quét.
 *
 * Trang KHÔNG còn: sửa/xoá dòng hàng, đổi số lượng, mã giảm giá, ghi chú đơn,
 * bảng licence/key, panel "Cài đặt ngay". MÔ HÌNH KEYLESS: thanh toán xong chỉ
 * cần mở XA ARENA và bấm Đăng nhập — licence tự gắn từ tài khoản (HWID).
 */
import { api, esc, fmtVnd, toast, navigate, loadingBlock, store, emptyBlock } from '../lib.js';
import { icon } from '../icons.js';
import { state } from '../state.js';

/* ---------------- Mua ngay ---------------- */

/**
 * Dựng món "mua ngay" từ product API.
 *
 * `productId` (id thật) là thứ POST /api/orders cần; slug để tra lại giá.
 * Không dùng `state.cart` nữa nên mảng này luôn có đúng 1 phần tử.
 */
function toBuyItem(p, qty = 1) {
  return {
    productId: p.id,
    slug: p.slug,
    name: p.name,
    price: p.price,
    imageUrl: p.imageUrl || null,
    quantity: qty,
    deliveryType: p.deliveryType,
  };
}

/**
 * Lưu ĐÚNG một món rồi đi thẳng thanh toán (không qua giỏ, không qua bước phụ).
 * Chưa đăng nhập thì nhớ đường quay lại để sau khi đăng nhập vẫn vào đúng QR.
 */
export function buyNow(product) {
  store.set('mbk_buynow', [toBuyItem(product, 1)]);
  if (!state.user) {
    toast('Đăng nhập để thanh toán', 'info');
    /*
     * PHẢI encode: parseRoute tách query bằng `split('?')` nên dấu `?` thứ hai
     * không encode sẽ cắt mất `mode=buynow` -> đăng nhập xong quay về
     * /checkout rỗng và mất sản phẩm đã chọn.
     */
    navigate('/login?redirect=' + encodeURIComponent('/checkout?mode=buynow'));
    return;
  }
  navigate('/checkout?mode=buynow');
}

/**
 * "Mua ngay" khi chỉ có id (nút `data-add` do home.js vẽ, không kèm dữ liệu).
 * Tra giá thật từ server rồi mới sang trang QR.
 */
export async function buyNowById(productId) {
  try {
    const d = await api('/api/products/' + encodeURIComponent(productId));
    buyNow(d.product);
  } catch (e) {
    toast(e.message || 'Không mở được sản phẩm', 'error');
  }
}

/**
 * Gắn "Mua ngay" cho mọi nút `[data-add]` (nút mua trên thẻ sản phẩm) trong
 * `root`, thay cho addToCart của bindProductCards.
 *
 * `data-buy-bound="1"` là cờ báo cho handler capture ở app.js biết nút này đã
 * có listener riêng (không cần chặn sự kiện nữa).
 */
export function bindBuyNowCards(root, products) {
  root.querySelectorAll('[data-add]').forEach((btn) => {
    const id = btn.dataset.add;
    if (!id) return; // nút khác dùng data-add rỗng (trang quản trị)
    btn.dataset.buyBound = '1';
    if (!btn.disabled) btn.textContent = 'Mua ngay';
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const p = (products || []).find((x) => x.id === id);
      if (p) buyNow(p);
      else buyNowById(id);
    });
  });
}

/* ---------------- Trang thanh toán ---------------- */

export function renderCheckout() {
  return `
  <div id="site-header"></div>
  <section class="section-sm">
    <div class="container">
      <nav class="pd-breadcrumb" aria-label="Đường dẫn">
        <a href="#/">Trang chủ</a>${icon('chevronRight', { size: 12, cls: 'crumb-sep' })}
        <span class="text-dim">Thanh toán</span>
      </nav>
      <div id="checkout-content">${loadingBlock('Đang chuẩn bị thanh toán...')}</div>
    </div>
  </section>
  <div id="site-footer"></div>`;
}

export async function mountCheckout(root, query = {}) {
  const host = root.querySelector('#checkout-content');
  const mode = query.mode || '';

  /*
   * Cleanup của màn QR: showQrPayment tạo interval poll 4s + đồng hồ đếm ngược
   * và TRẢ hàm dọn dẹp. Router chỉ gọi cleanup khi mount trả về hàm, nên mọi
   * `return` dưới đây đều đi qua `done()`.
   */
  let qrCleanup = null;
  const done = () => () => {
    if (typeof qrCleanup === 'function') {
      try { qrCleanup(); } catch { /* ignore */ }
      qrCleanup = null;
    }
  };

  if (!state.user) {
    // Nhớ đúng chỗ đang muốn tới: QR của đơn có sẵn, hoặc mua ngay 1 món.
    const back = (mode === 'order' && query.orderId)
      ? `/order/${query.orderId}`
      : '/checkout?mode=buynow';
    navigate('/login?redirect=' + encodeURIComponent(back), { replace: true });
    return;
  }

  // ===== XEM LẠI: mở QR của đơn có sẵn (#/order/<id>) — KHÔNG tạo đơn mới =====
  if (mode === 'order' && query.orderId) {
    host.innerHTML = loadingBlock('Đang tải mã thanh toán...');
    try {
      const qrData = await api(`/api/orders/${query.orderId}/qr`, { method: 'POST' });
      qrCleanup = showQrPayment(host, qrData, {
        code: qrData.order?.code, total: qrData.order?.total,
      });
    } catch (e) {
      host.innerHTML = emptyBlock({
        ico: 'alert',
        title: 'Không mở được mã thanh toán',
        desc: e.message || 'Đơn không tồn tại hoặc đã đóng.',
        action: '<a class="btn btn-primary btn-sm" href="#/orders">Về đơn hàng</a>',
      });
    }
    return done();
  }

  // ===== MUA NGAY: đúng MỘT món =====
  const stored = store.get('mbk_buynow', null);
  const picked = Array.isArray(stored) ? stored[0] : null;
  // Không còn món "mua ngay" nhưng vừa tạo đơn (khách F5) -> vào đơn đó.
  if (!picked) {
    const lastId = (() => { try { return store.get('mbk_lastorder'); }
                            catch (e) { return null; } })();
    if (lastId) {
      try { store.del('mbk_lastorder'); } catch (e) {}
      navigate('/order/' + lastId, { replace: true });
      return () => {};
    }
  }

  if (!picked) {
    // Không có món nào -> không có gì để thanh toán, về danh sách sản phẩm.
    navigate('/products', { replace: true });
    return;
  }

  // Giá LUÔN lấy từ server (giá trong localStorage có thể cũ).
  host.innerHTML = loadingBlock('Đang kiểm tra giá...');
  let product;
  try {
    const d = await api('/api/products/' + encodeURIComponent(picked.slug || picked.productId));
    product = d.product;
  } catch (e) {
    host.innerHTML = emptyBlock({
      ico: 'alert',
      title: 'Không mở được sản phẩm',
      desc: e.message || 'Sản phẩm không còn tồn tại.',
      action: '<a class="btn btn-primary btn-sm" href="#/products">Xem sản phẩm</a>',
    });
    return;
  }

  const sellable = product.active
    && (product.inStock || product.deliveryType === 'license' || product.deliveryType === 'manual');
  if (!sellable) {
    host.innerHTML = emptyBlock({
      ico: 'alert',
      title: 'Sản phẩm đã ngừng bán',
      desc: product.name || picked.name || '',
      action: '<a class="btn btn-primary btn-sm" href="#/products">Xem sản phẩm khác</a>',
    });
    return;
  }

  const item = toBuyItem(product, 1);

  host.innerHTML = `
    <div class="panel" style="max-width:520px;margin:0 auto;text-align:center">
      <h2 class="panel-title" style="justify-content:center">${icon('card', { size: 15 })} Thanh toán</h2>
      <div style="font-size:15px;font-weight:700;margin:12px 0 6px">${esc(product.name)}</div>
      <div style="font-size:22px;font-weight:800;color:#4ade80;margin-bottom:20px">${fmtVnd(product.price)}</div>
      <button class="btn btn-primary btn-lg btn-block" id="btn-place-order">
        ${icon('card', { size: 15 })}Tạo mã QR thanh toán
      </button>
    </div>
  `;

  /*
   * ĐƠN ĐÃ TẠO nhưng CHƯA lấy được mã QR.
   *
   * Tạo đơn và lấy QR nằm ở hai bước riêng: QR lỗi thì đơn vẫn tồn tại trên
   * server, nên phải giữ `createdOrder` để lấy lại mã của CHÍNH đơn đó thay vì
   * bấm lại và tạo đơn thứ hai (đơn trùng, tiền treo).
   */
  let createdOrder = null;

  const openQrForCreatedOrder = async () => {
    try {
      const qrData = await api(`/api/orders/${createdOrder.id}/qr`, { method: 'POST' });
      /*
       * Gán vào biến đóng kín `qrCleanup` (KHÔNG phải biến cục bộ): hàm này
       * chạy trong sự kiện click, tức là SAU khi mountCheckout đã trả về, nên
       * `return` ở đây không tới được router. Router giữ closure `done()`.
       */
      if (typeof qrCleanup === 'function') { try { qrCleanup(); } catch { /* ignore */ } }
      qrCleanup = showQrPayment(host, qrData, createdOrder);
      return true;
    } catch (e) {
      showQrRetry(e);
      return false;
    }
  };

  /** Màn hình "đơn đã tạo nhưng chưa có QR" — nút thử lại DÙNG LẠI đơn cũ. */
  function showQrRetry(err) {
    host.innerHTML = `
      <div class="panel" style="max-width:520px;margin:0 auto">
        <div class="alert alert-warn alert-block">
          <span class="ico">${icon('alert', { size: 15 })}</span>
          <span>
            <strong>Đơn #${esc(createdOrder.code || createdOrder.id)} đã tạo</strong> nhưng chưa lấy được mã QR.
            ${esc(err && err.message ? err.message : 'Có thể do mạng chập chờn.')}
            Đơn của bạn đã được ghi nhận — <strong>không cần đặt lại</strong>.
          </span>
        </div>
        <div class="btn-row">
          <button class="btn btn-primary" data-retry-qr>
            ${icon('refresh', { size: 14 })} Lấy lại mã QR
          </button>
          <a class="btn btn-ghost" href="#/orders">Đơn hàng của tôi</a>
        </div>
      </div>`;
    host.querySelector('[data-retry-qr]')?.addEventListener('click', async (ev) => {
      ev.currentTarget.disabled = true;
      host.innerHTML = loadingBlock('Đang lấy lại mã QR...');
      await openQrForCreatedOrder();
    });
  }

  const payBtn = host.querySelector('#btn-place-order');

  const createOrder = async () => {
    // Đã có đơn (QR lỗi lần trước) -> chỉ lấy lại mã, KHÔNG tạo đơn mới.
    if (createdOrder) {
      payBtn.disabled = true;
      await openQrForCreatedOrder();
      return;
    }

    payBtn.disabled = true;
    payBtn.textContent = 'Đang tạo mã QR...';
    try {
      const orderData = await api('/api/orders', {
        method: 'POST',
        body: { items: [{ productId: item.productId, quantity: item.quantity }] },
      });
      createdOrder = orderData.order;
      // Đơn đã ghi nhận -> xoá món "mua ngay" để không tạo đơn lần hai.
      store.del('mbk_buynow');
      // ----------------------------------------------------------------
      // NHỚ ĐƠN VỪA TẠO.
      //
      // LỖI ĐÃ SỬA: xoá `mbk_buynow` ngay sau khi tạo đơn là đúng (không
      // tạo đơn lần hai), NHƯNG nếu khách F5 giữa lúc quét mã thì trang
      // không còn gì để hiện → đẩy về danh sách sản phẩm, khách tưởng mất
      // đơn và mua lại → hai đơn chờ.
      //
      // Nay ghi nhớ id đơn để lần mở sau vào thẳng trang QR của đơn đó.
      // ----------------------------------------------------------------
      try {
        store.set('mbk_lastorder', createdOrder.id);
      } catch (e) {}
    } catch (e) {
      toast(e.message, 'error', 5000);
      payBtn.disabled = false;
      payBtn.innerHTML = `${icon('card', { size: 15 })}Tạo mã QR thanh toán`;
      return;
    }

    await openQrForCreatedOrder();
  };

  payBtn.onclick = createOrder;

  // QR hiện NGAY: khách chỉ bấm "Mua ngay" một lần, không phải bấm thêm bước nào.
  await createOrder();

  // Router gọi hàm này khi rời /checkout để dọn interval của màn QR.
  return done();
}

/**
 * Màn hình QR thanh toán: mã QR + số tiền + nội dung + thông tin ngân hàng +
 * đồng hồ đếm ngược. Poll 4s để tự phát hiện tiền vào (giữ nguyên như trước).
 */
export function showQrPayment(host, data, created) {
  const qr = data.qr || {};
  const order = data.order || {};
  const total = qr.amount || order.total || 0;
  const memo = qr.memo || '';
  const bank = qr.bank || {};
  let left = qr.secondsLeft || (qr.expiresAt ? qr.expiresAt - Math.floor(Date.now() / 1000) : 1800);

  host.innerHTML = `
    <div class="panel" style="max-width:520px;margin:0 auto">
      <div style="text-align:center;padding:6px 0 14px">
        <div style="font-size:15px;font-weight:800;letter-spacing:-.02em">Quét mã để thanh toán</div>
        <div style="font-size:12px;color:var(--text-mute);margin-top:4px">
          Mã đơn <strong class="mono">${esc(order.code || created?.code || '')}</strong>
        </div>
      </div>

      <div style="text-align:center;margin-bottom:14px">
        <img src="${esc(qr.url || '')}" alt="Mã QR thanh toán"
          style="width:100%;max-width:280px;border-radius:12px;background:#fff;padding:10px"
          data-qr-img>
      </div>

      <div style="background:rgba(74,222,128,.08);border:1px solid rgba(74,222,128,.3);
        border-radius:10px;padding:14px;margin-bottom:14px">
        <div class="flex justify-between" style="margin-bottom:8px">
          <span style="font-size:12px;color:var(--text-mute)">Số tiền</span>
          <strong style="font-size:17px;color:#4ade80">${fmtVnd(total)}</strong>
        </div>
        <div class="flex justify-between" style="align-items:center">
          <span style="font-size:12px;color:var(--text-mute)">Nội dung</span>
          <div class="flex gap-1" style="align-items:center">
            <strong class="mono" style="font-size:13px">${esc(memo)}</strong>
            <button class="btn btn-ghost btn-sm" data-copy-memo title="Copy nội dung">Copy</button>
          </div>
        </div>
      </div>

      <div style="font-size:12.5px;line-height:1.9;color:var(--text-dim);margin-bottom:14px">
        <div><strong>Ngân hàng:</strong> ${esc(bank.name || '')}</div>
        <div><strong>Số TK:</strong> <span class="mono">${esc(bank.account || '')}</span></div>
        <div><strong>Chủ TK:</strong> ${esc(bank.owner || '')}</div>
      </div>

      <div id="qr-status" style="text-align:center;padding:12px;border-radius:10px;
        background:rgba(255,255,255,.04)">
        <div style="font-size:13px;font-weight:700;color:#fbbf24">
          ⏳ Đang chờ thanh toán
        </div>
        <div style="font-size:12px;color:var(--text-mute);margin-top:6px">
          Còn <strong id="qr-countdown">--:--</strong>
        </div>
      </div>
    </div>
  `;

  // Copy nội dung chuyển khoản
  const copyBtn = host.querySelector('[data-copy-memo]');
  if (copyBtn) {
    copyBtn.onclick = async () => {
      const { copyText } = await import('../lib.js');
      const okc = await copyText(memo);
      toast(okc ? 'Đã copy nội dung' : 'Không copy được',
        okc ? 'success' : 'error');
    };
  }

  // Ảnh QR lỗi -> hiện hướng dẫn chuyển khoản tay
  const img = host.querySelector('[data-qr-img]');
  if (img) {
    img.onerror = () => {
      img.style.display = 'none';
      const note = document.createElement('div');
      note.className = 'alert alert-warn';
      note.innerHTML = '<span class="ico">⚠️</span><span>Không tải được mã QR. '
        + 'Bạn chuyển khoản tay theo thông tin bên dưới, giữ nguyên nội dung.</span>';
      img.parentElement.appendChild(note);
    };
  }

  const cdEl = host.querySelector('#qr-countdown');
  const stEl = host.querySelector('#qr-status');
  let pollTimer = null;
  let cdTimer = null;
  let stopped = false;

  const tick = () => {
    if (stopped) return;
    if (left <= 0) {
      cdEl.textContent = '00:00';
      stEl.innerHTML = '<div style="font-size:13px;font-weight:700;color:#f87171">'
        + '⌛ Mã QR hết hạn</div>'
        + '<div style="font-size:12px;color:var(--text-mute);margin-top:6px">'
        + 'Vẫn chuyển khoản được — hệ thống sẽ tự khớp. Hoặc <a href="#/orders">tạo lại mã</a>.</div>';
      clearInterval(cdTimer);
      return;
    }
    left--;
    const m = Math.floor(left / 60);
    const sec = left % 60;
    cdEl.textContent = `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  };
  cdTimer = setInterval(tick, 1000);
  tick();

  /*
   * ===== PHÂN BIỆT 4 TRẠNG THÁI — KHÔNG gộp "đã thu tiền" với "đã cấp quyền" =====
   *
   * Bản cũ:
   *     if (st === 'delivered' || st === 'paid') { showSuccess(...) }
   * coi `paid` và `delivered` là MỘT. Nhưng `paid` nghĩa là TIỀN ĐÃ VÀO, còn
   * quyền có được cấp hay chưa thì chưa biết — `paid` cũng là trạng thái mà
   * cron đẩy về khi worker chết giữa lúc giao, hoặc khi giao thất bại và cần
   * admin xử lý tay.
   *
   * Hệ quả thật: khách thấy "Thanh toán thành công — mở app là có", mở app
   * không thấy gì, rồi gọi hỗ trợ. Tệ hơn: khách tưởng đã xong nên không bấm
   * "Tôi đã chuyển khoản" và không biết mình đang chờ xử lý.
   *
   * Nay bốn trạng thái riêng, mỗi cái nói đúng sự thật:
   *   delivered / active  -> quyền ĐÃ cấp        -> màn thành công
   *   processing          -> đang cấp quyền      -> chờ, tự cập nhật
   *   paid                -> tiền đã nhận, CHƯA cấp -> nói rõ đang chờ xử lý
   *   refund*             -> cần hỗ trợ
   */
  const poll = async () => {
    if (stopped) return;
    try {
      const o = await api(`/api/orders/${order.id}`);
      const st = o.order?.status;

      if (st === 'delivered') {
        stopped = true;
        clearInterval(pollTimer);
        clearInterval(cdTimer);
        showSuccess(host, o.order);
        return;
      }

      if (st === 'processing') {
        stEl.innerHTML = '<div class="ck-st ck-st-wait">'
          + '<strong>Đã nhận được tiền — đang cấp quyền…</strong>'
          + '<span>Thường chỉ mất vài giây. Trang này tự cập nhật.</span></div>';
        return;
      }

      if (st === 'paid') {
        /*
         * Tiền đã vào nhưng quyền chưa cấp (giao thất bại, hoặc worker chết
         * giữa chừng và cron đẩy về đây). KHÔNG được nói "thành công".
         */
        stEl.innerHTML = '<div class="ck-st ck-st-warn">'
          + '<strong>Đã nhận được tiền của bạn</strong>'
          + '<span>Hệ thống đang hoàn tất cấp quyền. Nếu quá 15 phút chưa thấy '
          + 'trong app, hãy gửi mã đơn <b>' + esc(order.code) + '</b> cho hỗ trợ.</span>'
          + '<a class="btn btn-ghost btn-sm" href="#/support">Liên hệ hỗ trợ</a></div>';
        return;
      }

      if (st === 'cancelled' || st === 'expired') {
        stopped = true;
        clearInterval(pollTimer);
        clearInterval(cdTimer);
        stEl.innerHTML = '<div class="ck-st ck-st-err">'
          + '<strong>Đơn đã đóng</strong>'
          + '<span>Nếu bạn đã chuyển khoản, đừng lo — gửi mã đơn <b>'
          + esc(order.code) + '</b> cho hỗ trợ để được cấp quyền.</span>'
          + '<a class="btn btn-ghost btn-sm" href="#/support">Liên hệ hỗ trợ</a></div>';
        return;
      }

      if (typeof st === 'string' && st.startsWith('refund')) {
        stopped = true;
        clearInterval(pollTimer);
        clearInterval(cdTimer);
        stEl.innerHTML = '<div class="ck-st ck-st-warn">'
          + '<strong>Đơn đang được hoàn tiền</strong>'
          + '<span>Bộ phận hỗ trợ sẽ liên hệ. Mã đơn <b>' + esc(order.code) + '</b>.</span></div>';
      }
    } catch { /* mạng lỗi -> thử lại */ }
  };
  pollTimer = setInterval(poll, 4000);

  /*
   * Trả hàm dọn dẹp cho router. Thiếu nó thì poll 4s và đồng hồ đếm ngược
   * tiếp tục chạy sau khi khách rời trang, gọi API liên tục và giữ DOM cũ.
   */
  return () => {
    clearInterval(pollTimer);
    clearInterval(cdTimer);
  };
}

/**
 * Thanh toán xong: MỘT câu + MỘT nút tải app. Không key, không licence, không
 * hướng dẫn cài đặt.
 */
function showSuccess(host, order) {
  host.innerHTML = `
    <div class="panel ck-done">
      <div class="ck-done-head">
        <span class="ck-done-badge" aria-hidden="true">${icon('check', { size: 26, stroke: 2.4 })}</span>
        <h2 class="ck-done-title">Thanh toán thành công</h2>
        <p class="ck-done-sub">
          Mã đơn hàng: <strong class="mono ck-done-code">${esc(order.code)}</strong>
        </p>
        <p class="ck-done-note">
          Thanh toán xong — mở XA ARENA, bấm Đăng nhập là có.
        </p>
      </div>
      <div class="ck-done-actions">
        <a class="btn btn-primary" href="#/tai-ve">${icon('download', { size: 14 })}Tải XA ARENA</a>
      </div>
    </div>
  `;
}
