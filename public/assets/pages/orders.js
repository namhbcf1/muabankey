/** Trang đơn hàng của tôi. */
import {
  api, esc, fmtVnd, fmtNum, fmtDate, toast, navigate, loadingBlock,
  copyText, timeAgo, decodeKey, emptyBlock,
} from '../lib.js';
import { icon } from '../icons.js';
import { state } from '../state.js';

// tone + nhãn + icon cho từng trạng thái đơn.
const STATUS_MAP = {
  pending: ['pill-yellow', 'Chờ thanh toán', 'clock'],
  paid: ['pill-blue', 'Đã thanh toán', 'card'],
  delivered: ['pill-green', 'Đã giao', 'checkCircle'],
  cancelled: ['pill-gray', 'Đã huỷ', 'ban'],
  refunded: ['pill-red', 'Đã hoàn tiền', 'undo'],
};

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
          <p class="page-desc">Xem lại key đã mua và trạng thái từng đơn.</p>
        </div>
      </div>
      <div id="orders-content">${loadingBlock()}</div>
    </div>
  </section>
  <div id="site-footer"></div>`;
}

export async function mountOrders(root) {
  const host = root.querySelector('#orders-content');
  if (!state.user) { navigate('/login?redirect=/orders', { replace: true }); return; }

  try {
    const data = await api('/api/orders?perPage=50');
    if (data.orders.length === 0) {
      host.innerHTML = emptyBlock({
        ico: 'package',
        title: 'Chưa có đơn hàng nào',
        desc: 'Các đơn đã mua và key đi kèm sẽ xuất hiện tại đây.',
        action: `<button class="btn btn-primary btn-sm" data-empty-go="/products">Xem sản phẩm</button>`,
      });
      host.querySelector('[data-empty-go]').onclick = () => navigate('/products');
      return;
    }

    host.innerHTML = `<div class="stack">${data.orders.map((o) => {
      const allKeys = o.items.flatMap((i) => i.keys);
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
          ${o.items.map((i) => `
            <div class="line-item">
              <div class="line-head">
                <div class="line-name">${esc(i.name)} <span class="line-qty">× ${fmtNum(i.quantity)}</span></div>
                <div class="line-amt">${fmtVnd(i.lineTotal)}</div>
              </div>
              ${i.keys.length
                ? i.keys.map((k) => {
                    const key = decodeKey(k);
                    const isLic = /^[A-Z0-9]+-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/i.test(key);
                    /*
                     * Key kiểu "account" lưu dạng base64("email|mật khẩu"). Hiển
                     * thị nguyên chuỗi thì khách phải tự tách dấu "|" mới đăng
                     * nhập được. Tách sẵn thành 2 dòng có nút sao chép riêng.
                     */
                    const parts = !isLic && key.includes('|') ? key.split('|') : null;
                    return `
                  <div class="key-box">
                    ${parts
                      ? `<div class="cred">
                           <div class="cred-row">
                             <span class="cred-k">Tài khoản</span>
                             <span class="cred-v mono">${esc(parts[0])}</span>
                             <button class="key-copy" data-copy="${esc(parts[0])}" aria-label="Sao chép tài khoản">
                               ${icon('copy', { size: 12 })}
                             </button>
                           </div>
                           <div class="cred-row">
                             <span class="cred-k">Mật khẩu</span>
                             <span class="cred-v mono">${esc(parts.slice(1).join('|'))}</span>
                             <button class="key-copy" data-copy="${esc(parts.slice(1).join('|'))}" aria-label="Sao chép mật khẩu">
                               ${icon('copy', { size: 12 })}
                             </button>
                           </div>
                         </div>`
                      : `<div class="key-value">${esc(key)}</div>
                         <button class="key-copy" data-copy="${esc(key)}">
                           ${icon('copy', { size: 12 })} Sao chép
                         </button>`}
                  </div>
                  ${isLic ? `<div class="line-note mono">
                    ${icon('bolt', { size: 12 })} Lệnh cài:
                    <a href="#/licenses" class="text-dim">xem tại License của tôi</a>
                  </div>` : ''}`;
                  }).join('')
                : o.status === 'pending'
                  ? `<div class="line-note warn">${icon('clock', { size: 12 })} Chờ thanh toán để nhận key</div>`
                  : `<div class="line-note">${icon('progress', { size: 12 })} Đang xử lý giao hàng</div>`}
            </div>`).join('')}
        </div>

        ${o.status === 'pending' ? `
          <div class="order-foot">
            <button class="btn btn-primary btn-sm" data-pay="${esc(o.id)}">
              ${icon('card', { size: 13 })} Thanh toán ngay
            </button>
          </div>` : ''}

        ${allKeys.length > 0 ? `
          <div class="order-foot">
            <button class="btn btn-ghost btn-sm" data-copy-all="${esc(JSON.stringify(allKeys.map((k) => decodeKey(k))))}">
              ${icon('copy', { size: 13 })} Sao chép tất cả key
            </button>
            <a class="btn btn-ghost btn-sm" href="mailto:?subject=Key%20${encodeURIComponent(o.code)}&body=${encodeURIComponent(allKeys.map((k) => decodeKey(k)).join('\n'))}">
              ${icon('mail', { size: 13 })} Gửi qua email
            </a>
          </div>` : ''}
      </article>`;
    }).join('')}</div>`;

    host.querySelectorAll('[data-copy]').forEach((b) => {
      b.onclick = async () => {
        const ok = await copyText(b.dataset.copy);
        toast(ok ? 'Đã sao chép key' : 'Không thể sao chép', ok ? 'success' : 'error');
      };
    });

    host.querySelectorAll('[data-copy-all]').forEach((b) => {
      b.onclick = async () => {
        const keys = JSON.parse(b.dataset.copyAll).join('\n');
        const ok = await copyText(keys);
        toast(ok ? 'Đã sao chép tất cả key' : 'Không thể sao chép', ok ? 'success' : 'error');
      };
    });

    host.querySelectorAll('[data-pay]').forEach((b) => {
      b.onclick = async () => {
        b.disabled = true;
        b.textContent = 'Đang xử lý...';
        try {
          await api(`/api/orders/${b.dataset.pay}/pay`, { method: 'POST' });
          toast('Thanh toán thành công!', 'success');
          window.dispatchEvent(new CustomEvent('app:refresh-header'));
          await mountOrders(root);
        } catch (e) {
          toast(e.message, 'error', 5000);
          b.disabled = false;
          b.innerHTML = `${icon('card', { size: 13 })} Thanh toán ngay`;
        }
      };
    });
  } catch (e) {
    host.innerHTML = emptyBlock({ ico: 'alert', title: e.message || 'Không tải được đơn hàng' });
  }
}
