/**
 * Trang đơn hàng của tôi.
 *
 * Mô hình mới: app portable `xa_arena.exe`, khách đăng nhập bằng tài khoản web
 * là licence TỰ GẮN. Đơn hàng vì vậy KHÔNG in key ra màn hình nữa — chỉ còn
 * mã đơn, sản phẩm, số tiền, trạng thái, ngày và nút tải app.
 */

import {
  api, esc, fmtVnd, fmtNum, fmtDate, toast, navigate, loadingBlock,
  timeAgo, emptyBlock,
} from '../lib.js';

import { icon } from '../icons.js';

import { state } from '../state.js';

// tone + nhãn + icon cho từng trạng thái đơn.
/*
 * PHẢI phủ HẾT trạng thái backend ghi, nếu không `statusPill` rơi vào
 * fallback và in nguyên chuỗi tiếng Anh cho khách đọc.
 *
 * Đặc biệt `refund_pending_transfer`: backend TÁCH "quyết định hoàn" khỏi
 * "đã chuyển tiền". Đơn ở trạng thái này nghĩa là quyền đã thu hồi nhưng tiền
 * CHƯA tới tay khách — câu chữ phải nói đúng như vậy, không được ghi "đã hoàn".
 */
const STATUS_MAP = {
  pending: ['pill-yellow', 'Chờ chuyển khoản', 'clock'],
  expired: ['pill-gray', 'Hết hạn', 'clock'],
  processing: ['pill-blue', 'Đang giao', 'package'],
  paid: ['pill-blue', 'Đã thanh toán', 'card'],
  delivered: ['pill-green', 'Đã giao', 'checkCircle'],
  cancelled: ['pill-gray', 'Đã huỷ', 'ban'],
  refunding: ['pill-yellow', 'Đang xử lý hoàn', 'undo'],
  refund_pending_transfer: ['pill-yellow', 'Chờ chuyển tiền hoàn', 'clock'],
  refunded: ['pill-red', 'Đã hoàn tiền', 'undo'],
  /*
   * `refund_stuck` do cron ghi khi đơn hoàn tiền bị treo giữa chừng. Thiếu
   * nhãn thì statusPill rơi vào fallback và in nguyên chuỗi tiếng Anh
   * "refund_stuck" cho khách đọc.
   */
  refund_stuck: ['pill-yellow', 'Hoàn tiền chờ đối soát', 'clock'],
};

/**
 * Số đơn mỗi lần tải. Server chặn tối đa 50 (src/routes/orders.js: pageNum
 * perPage max 50), nên đây cũng là kích thước trang lớn nhất lấy được.
 */
const ORDERS_PER_PAGE = 50;

/** Nhãn trạng thái có icon — dùng chung cho danh sách và thông báo trong dòng hàng. */
function statusPill(status) {
  const [cls, label, ico] = STATUS_MAP[status] || ['pill-gray', status, 'help'];
  return `<span class="pill ${cls}">${icon(ico, { size: 11 })} ${esc(label)}</span>`;
}

export function renderOrders() {
  return `
  <div id="site-header"></div>
  <section class="section-sm">
    <div class="container">
      <nav class="pd-breadcrumb" aria-label="Đường dẫn">
        <a href="#/">Trang chủ</a><span>/</span><span>Đơn hàng</span>
      </nav>
      <div class="page-head">
        <div>
          <h1 class="page-title">Đơn hàng của tôi</h1>
          <p class="page-desc">Xem đơn đã mua, số tiền và trạng thái giao.</p>
        </div>
      </div>
      <div id="orders-content">${loadingBlock()}</div>
    </div>
  </section>
  <div id="site-footer"></div>`;
}

/**
 * HTML của MỘT đơn — tách riêng để dùng được cho cả trang 1 và các trang sau.
 *
 * Server chỉ trả `items[].keys` cho đơn 'delivered' (src/routes/orders.js:
 * `const keysVisible = o.status === 'delivered'`), nhưng ở đây CỐ Ý không đọc
 * `keys` nữa: khách dùng app bằng đăng nhập, không dùng key.
 */
function orderCard(o) {
  const items = Array.isArray(o.items) ? o.items : [];
  /* `manual` = sản phẩm giao tay (delivery_type 'manual'); đơn loại này không
   * tự gắn được vào app nên vẫn cần lối liên hệ hỗ trợ. */
  const manual = items.some((i) => i.manual);

  return `
      <article class="panel" aria-label="Đơn ${esc(o.code)}">
        <div class="order-head">
          <div>
            <div class="pill-row">
              <span class="order-code">${esc(o.code)}</span>
              ${statusPill(o.status)}
            </div>
            <div class="order-time">${esc(fmtDate(o.createdAt))} · ${esc(timeAgo(o.createdAt))}</div>
          </div>
          <div class="order-sum">
            <div class="amt">${fmtVnd(o.total)}</div>
            ${o.discount > 0 ? `<div class="disc">Đã giảm ${fmtVnd(o.discount)}</div>` : ''}
          </div>
        </div>

        <div class="order-body">
          ${items.map((i) => `
            <div class="line-item">
              <div class="line-head">
                <div class="line-name">${esc(i.name)} <span class="line-qty">× ${fmtNum(i.quantity)}</span></div>
                <div class="line-amt">${fmtVnd(i.lineTotal)}</div>
              </div>
              ${o.status === 'delivered'
                ? ''
                : o.status === 'pending'
                  ? `<div class="line-note warn">${icon('clock', { size: 12 })} Chờ thanh toán</div>`
                  : `<div class="line-note">${icon('progress', { size: 12 })} Đang xử lý giao hàng</div>`}
            </div>`).join('')}
        </div>

        ${o.status === 'pending' ? `
          <div class="order-foot">
            <button class="btn btn-primary btn-sm" data-pay="${esc(o.id)}">
              ${icon('card', { size: 13 })} Thanh toán ngay
            </button>
          </div>` : ''}

        ${o.status === 'delivered' ? `
          <div class="order-foot">
            <div class="line-note" style="margin-top:0;flex:1">
              ${icon('checkCircle', { size: 13 })} Đã giao — mở app và đăng nhập để dùng.
            </div>
            ${manual ? `<a class="btn btn-ghost btn-sm" href="#/support">
              ${icon('messageCircle', { size: 13 })} Nhận hàng giao tay
            </a>` : ''}
            <a class="btn btn-primary btn-sm" href="#/tai-ve">
              ${icon('download', { size: 13 })} Tải app
            </a>
          </div>` : ''}
      </article>`;
}

export async function mountOrders(root) {
  const host = root.querySelector('#orders-content');
  if (!state.user) { navigate('/login?redirect=/orders', { replace: true }); return; }

  /** Trang kế tiếp cần tải; tăng dần sau mỗi lần "Xem thêm". */
  let nextPage = 1;
  /** Còn trang sau hay không (server không trả total -> suy từ số đơn nhận được). */
  let hasMore = true;
  let loadingMore = false;
  const seen = new Set();

  /** Gắn sự kiện cho các nút trong `scope` (chỉ phần vừa thêm). */
  function bindOrderActions(scope) {
    scope.querySelectorAll('[data-pay]').forEach((b) => {
      b.onclick = () => {
        // Chuyển sang trang thanh toán QR của đơn (không trừ ví)
        navigate(`/order/${b.dataset.pay}`);
      };
    });
  }

  /**
   * Tải một trang đơn và nối thêm vào danh sách.
   *
   * LỖI ĐÃ SỬA: trước đây chỉ có MỘT lần gọi /api/orders?perPage=50 (mức tối đa
   * server cho phép) và không có phân trang, nên đơn thứ 51 trở đi KHÔNG BAO
   * GIỜ hiện ra với khách. Nay có nút "Xem thêm" tải trang kế tiếp.
   */
  async function loadMore() {
    if (loadingMore || !hasMore) return;
    loadingMore = true;
    const moreBtn = host.querySelector('[data-load-more]');
    if (moreBtn) {
      moreBtn.disabled = true;
      moreBtn.textContent = 'Đang tải...';
    }
    try {
      const data = await api(`/api/orders?perPage=${ORDERS_PER_PAGE}&page=${nextPage}`);
      const orders = data.orders || [];
      nextPage += 1;
      hasMore = orders.length >= ORDERS_PER_PAGE;

      const fresh = orders.filter((o) => !seen.has(o.id));
      fresh.forEach((o) => seen.add(o.id));

      if (nextPage === 2) {
        // Trang đầu tiên: dựng khung
        if (fresh.length === 0) {
          host.innerHTML = emptyBlock({
            ico: 'package',
            title: 'Chưa có đơn hàng nào',
            desc: 'Các đơn đã mua sẽ xuất hiện tại đây.',
            action: `<button class="btn btn-primary btn-sm" data-empty-go="/products">Xem sản phẩm</button>`,
          });
          host.querySelector('[data-empty-go]').onclick = () => navigate('/products');
          hasMore = false;
          return;
        }
        host.innerHTML = `<div class="stack" id="orders-list"></div>
          <div class="btn-row mt-2" style="justify-content:center"></div>`;
      }

      const list = host.querySelector('#orders-list');
      if (!list) return;
      if (fresh.length) {
        list.insertAdjacentHTML('beforeend', fresh.map(orderCard).join(''));
        bindOrderActions(list);
      }

      const bar = host.querySelector('.btn-row');
      if (hasMore) {
        if (bar && !bar.querySelector('[data-load-more]')) {
          bar.innerHTML = `<button class="btn btn-ghost" data-load-more>
            ${icon('chevronDown', { size: 14 })} Xem thêm đơn cũ hơn
          </button>`;
          bar.querySelector('[data-load-more]').onclick = loadMore;
        } else if (bar) {
          const b = bar.querySelector('[data-load-more]');
          if (b) { b.disabled = false; b.innerHTML = `${icon('chevronDown', { size: 14 })} Xem thêm đơn cũ hơn`; }
        }
      } else if (bar) {
        bar.innerHTML = list.children.length > ORDERS_PER_PAGE
          ? '<div class="text-dim" style="font-size:12.5px">Đã hiện hết đơn hàng.</div>'
          : '';
      }
    } catch (e) {
      if (nextPage === 1) {
        host.innerHTML = emptyBlock({ ico: 'alert', title: e.message || 'Không tải được đơn hàng' });
      } else {
        toast(e.message || 'Không tải thêm được đơn hàng', 'error');
        const b = host.querySelector('[data-load-more]');
        if (b) { b.disabled = false; b.innerHTML = `${icon('chevronDown', { size: 14 })} Xem thêm đơn cũ hơn`; }
      }
    } finally {
      loadingMore = false;
    }
  }

  await loadMore();
}
