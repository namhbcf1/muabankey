/** Trang đơn hàng của tôi. */
import { api, esc, fmtVnd, fmtDate, toast, navigate, loadingBlock, copyText, timeAgo, decodeKey } from '../lib.js';
import { state } from '../state.js';

const STATUS_MAP = {
  pending: ['pill-yellow', '⏳ Chờ thanh toán'],
  paid: ['pill-blue', '💳 Đã thanh toán'],
  delivered: ['pill-green', '✅ Đã giao'],
  cancelled: ['pill-gray', '✕ Đã huỷ'],
  refunded: ['pill-red', '↩️ Đã hoàn tiền'],
};

export function renderOrders() {
  return `
  <div id="site-header"></div>
  <section class="section-sm">
    <div class="container">
      <div class="pd-breadcrumb"><a href="#/">Trang chủ</a><span>/</span><span>Đơn hàng</span></div>
      <div class="sec-head" style="margin-bottom:22px">
        <div><h1 class="sec-title">Đơn hàng của tôi</h1>
        <p class="sec-desc">Xem lại key đã mua và trạng thái đơn hàng</p></div>
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
      host.innerHTML = `<div class="empty-state">
        <div class="ico">📦</div>
        <div class="t">Chưa có đơn hàng nào</div>
        <div class="d">Khám phá các sản phẩm bản quyền chất lượng của chúng tôi</div>
        <button class="btn btn-primary btn-sm" onclick="location.hash='#/products'">Mua sắm ngay</button>
      </div>`;
      return;
    }

    host.innerHTML = data.orders.map((o) => {
      const [cls, label] = STATUS_MAP[o.status] || ['pill-gray', o.status];
      const allKeys = o.items.flatMap((i) => i.keys);
      return `
      <div class="panel mb-2">
        <div class="flex justify-between items-center mb-2" style="flex-wrap:wrap;gap:12px">
          <div>
            <div class="flex items-center gap-1" style="flex-wrap:wrap">
              <strong class="mono" style="font-size:15px;color:#a99cff">${esc(o.code)}</strong>
              <span class="pill ${cls}">${label}</span>
            </div>
            <div style="font-size:12.5px;color:var(--text-mute);margin-top:5px">
              ${fmtDate(o.createdAt)} · ${timeAgo(o.createdAt)}
            </div>
          </div>
          <div style="text-align:right">
            <div style="font-size:17px;font-weight:800">${fmtVnd(o.total)}</div>
            ${o.discount > 0 ? `<div style="font-size:12px;color:#4ade80">Đã giảm ${fmtVnd(o.discount)}</div>` : ''}
          </div>
        </div>

        <div style="border-top:1px solid var(--border);padding-top:14px">
          ${o.items.map((i) => `
            <div style="margin-bottom:12px">
              <div class="flex justify-between items-center" style="gap:10px;flex-wrap:wrap">
                <div style="font-size:13.5px;font-weight:700">${esc(i.name)} <span style="color:var(--text-mute);font-weight:600">× ${i.quantity}</span></div>
                <div style="font-size:13px;color:var(--text-dim)">${fmtVnd(i.lineTotal)}</div>
              </div>
              ${i.keys.length
                ? i.keys.map((k) => {
                    const key = decodeKey(k);
                    const isLic = /^[A-Z0-9]+-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/i.test(key);
                    return `
                  <div class="key-box">
                    <div class="key-value">${esc(key)}</div>
                    <button class="key-copy" data-copy="${esc(key)}">📋 Sao chép</button>
                  </div>
                  ${isLic ? `<div class="mono" style="font-size:11px;color:var(--text-mute);padding:6px 2px 0">
                    ⚡ Lệnh cài: <a href="#/licenses" style="color:#67e8f9">xem tại License của tôi</a>
                  </div>` : ''}`;
                  }).join('')
                : o.status === 'pending'
                  ? `<div style="font-size:12.5px;color:#fbbf24;margin-top:6px">⏳ Chờ thanh toán để nhận key</div>`
                  : `<div style="font-size:12.5px;color:var(--text-mute);margin-top:6px">⏳ Đang xử lý giao hàng</div>`}
            </div>`).join('')}
        </div>

        ${o.status === 'pending' ? `
          <div class="flex gap-1 mt-2">
            <button class="btn btn-primary btn-sm" data-pay="${esc(o.id)}">💳 Thanh toán ngay</button>
          </div>` : ''}

        ${allKeys.length > 0 ? `
          <div class="flex gap-1 mt-2">
            <button class="btn btn-ghost btn-sm" data-copy-all="${esc(JSON.stringify(allKeys.map((k) => decodeKey(k))))}">📋 Sao chép tất cả key</button>
            <a class="btn btn-ghost btn-sm" href="mailto:?subject=Key%20${encodeURIComponent(o.code)}&body=${encodeURIComponent(allKeys.map((k) => decodeKey(k)).join('\n'))}">✉️ Gửi qua email</a>
          </div>` : ''}
      </div>`;
    }).join('');

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
          b.textContent = '💳 Thanh toán ngay';
        }
      };
    });
  } catch (e) {
    host.innerHTML = `<div class="empty-state"><div class="ico">⚠️</div><div class="t">${esc(e.message)}</div></div>`;
  }
}
