/**
 * Trang quản trị (admin).
 *
 * Toàn bộ giao diện dùng icon SVG (`icon()`) và class trong style.css; chỉ còn
 * đúng một inline style là `width` của `.bar-fill` vì đó là giá trị động.
 * Logic nghiệp vụ (endpoint, method, body, điều kiện trạng thái, phân quyền,
 * luồng xác nhận) giữ nguyên so với bản trước khi đại tu giao diện.
 */
import { api, esc, fmtVnd, fmtNum, fmtDate, toast, navigate, openModal, confirmDialog, loadingBlock, debounce, copyText } from '../lib.js';
import { icon } from '../icons.js';
import { state } from '../state.js';

const NAV = [
  ['dashboard', 'grid', 'Tổng quan'],
  ['orders', 'package', 'Đơn hàng'],
  ['topups', 'coins', 'Chờ thanh toán'],
  ['products', 'bag', 'Sản phẩm'],
  ['keys', 'key', 'Kho key'],
  ['licenses', 'ticket', 'License'],
  ['trial', 'gift', 'Dùng thử'],
  ['whitelist', 'star', 'Vô hạn'],
  ['users', 'users', 'Người dùng'],
  ['settings', 'settings', 'Cài đặt'],
  ['logs', 'log', 'Nhật ký'],
];

/** Nhãn hiển thị cho trạng thái đơn. Giá trị dữ liệu vẫn là khoá tiếng Anh. */
const ORDER_LABEL = {
  pending: 'Chờ xử lý',
  paid: 'Đã thanh toán',
  delivered: 'Đã giao',
  cancelled: 'Đã huỷ',
  refunded: 'Đã hoàn',
};

export function renderAdmin(query) {
  const tab = query.tab || 'dashboard';
  return `
  <div id="site-header"></div>
  <section class="section-sm">
    <div class="container container-wide">
      <div class="page-head">
        <div>
          <h1 class="page-title">Quản trị hệ thống</h1>
          <p class="page-desc">Quản lý đơn hàng, sản phẩm, kho key và người dùng.</p>
        </div>
      </div>
      <div class="admin-layout">
        <nav class="admin-nav" aria-label="Khu vực quản trị">
          ${NAV.map(([k, ico, label]) => `
            <button type="button" class="admin-nav-item ${tab === k ? 'active' : ''}" data-tab="${k}"
              ${tab === k ? 'aria-current="page"' : ''}>
              <span class="ico">${icon(ico, { size: 16 })}</span>${label}
            </button>`).join('')}
        </nav>
        <div id="admin-content">${loadingBlock()}</div>
      </div>
    </div>
  </section>
  <div id="site-footer"></div>`;
}

export async function mountAdmin(root, query) {
  if (!state.user) { navigate('/login?redirect=/admin', { replace: true }); return; }
  if (state.user.role !== 'admin' && state.user.role !== 'staff') {
    root.querySelector('#admin-content').innerHTML =
      `<div class="empty-state"><div class="ico">${icon('ban', { size: 26 })}</div>
        <div class="t">Không có quyền truy cập</div></div>`;
    return;
  }

  const tab = query.tab || 'dashboard';
  root.querySelectorAll('[data-tab]').forEach((b) => {
    b.onclick = () => navigate('/admin?tab=' + b.dataset.tab);
  });

  const host = root.querySelector('#admin-content');
  try {
    if (tab === 'dashboard') await renderDashboard(host);
    else if (tab === 'orders') await renderOrders(host);
    else if (tab === 'topups') await renderTopups(host);
    else if (tab === 'products') await renderProducts(host);
    else if (tab === 'keys') await renderKeys(host, query);
    else if (tab === 'licenses') await renderLicenses(host);
    else if (tab === 'trial') await renderTrial(host);
    else if (tab === 'whitelist') await renderWhitelist(host);
    else if (tab === 'users') await renderUsers(host);
    else if (tab === 'settings') await renderSettings(host);
    else if (tab === 'logs') await renderLogs(host);
  } catch (e) {
    host.innerHTML = `<div class="empty-state"><div class="ico">${icon('alert', { size: 26 })}</div>
      <div class="t">${esc(e.message)}</div></div>`;
  }
}

/* ---------------- Dashboard ---------------- */
async function renderDashboard(host) {
  const d = await api('/api/admin/dashboard');
  const s = d.stats;
  const maxRevenue = Math.max(1, ...d.topProducts.map((p) => p.revenue));

  host.innerHTML = `
    <div class="stat-grid">
      ${[
        ['bank', fmtVnd(s.revenue), 'Tổng doanh thu', `+${fmtVnd(s.revenueToday)} hôm nay`, ''],
        ['package', fmtNum(s.orders), 'Tổng đơn hàng', `+${s.ordersToday} hôm nay`, ''],
        ['users', fmtNum(s.users), 'Người dùng', `+${s.usersToday} hôm nay`, ''],
        ['clock', fmtNum(s.pendingOrders), 'Đơn chờ xử lý',
          s.pendingOrders > 0 ? 'Cần xử lý' : 'Đã xử lý hết', s.pendingOrders > 0 ? '' : 'dim'],
        ['alert', fmtNum(s.lowStock), 'Sản phẩm sắp hết', 'Dưới 5 key', 'dim'],
        ['trend', fmtVnd(s.revenueMonth), 'Doanh thu 30 ngày', `Tuần: ${fmtVnd(s.revenueWeek)}`, ''],
      ].map(([ico, v, l, d2, tone]) => `
        <div class="stat-card">
          <div class="ico">${icon(ico, { size: 16 })}</div>
          <div class="v">${v}</div>
          <div class="l">${l}</div>
          <div class="d${tone ? ' ' + tone : ''}">${d2}</div>
        </div>`).join('')}
    </div>

    <div class="adm-split">
      <div class="panel">
        <div class="panel-title">${icon('trophy', { size: 15 })} Top sản phẩm bán chạy</div>
        ${d.topProducts.length === 0
          ? `<div class="empty-state adm-empty-sm"><div class="t">Chưa có dữ liệu</div></div>`
          : `<div class="bar-chart">
              ${d.topProducts.map((p) => `
                <div class="bar-row">
                  <span class="adm-bar-name">${esc(p.name)}</span>
                  <span class="adm-bar-meta">${p.qty} · ${fmtVnd(p.revenue)}</span>
                  <div class="bar-track"><div class="bar-fill" style="width:${Math.round((p.revenue / maxRevenue) * 100)}%"></div></div>
                </div>`).join('')}
            </div>`}
      </div>

      <div class="panel">
        <div class="panel-title">${icon('receipt', { size: 15 })} Đơn hàng gần đây</div>
        <div class="adm-recent">
          ${d.recentOrders.map((o) => `
            <div class="adm-recent-row">
              <div class="adm-recent-main">
                <div class="adm-recent-code mono">${esc(o.code)}</div>
                <div class="adm-recent-mail">${esc(o.email)}</div>
              </div>
              <div class="adm-recent-side">
                <div class="adm-recent-amt">${fmtVnd(o.total)}</div>
                <div class="adm-recent-status">${esc(ORDER_LABEL[o.status] || o.status)}</div>
              </div>
            </div>`).join('')}
        </div>
      </div>
    </div>
  `;
}

/* ---------------- Orders ---------------- */
async function renderOrders(host) {
  let statusFilter = '';
  const load = async () => {
    const d = await api('/api/admin/orders' + (statusFilter ? '?status=' + statusFilter : ''));
    host.innerHTML = `
      <div class="panel">
        <div class="adm-panel-head">
          <div class="panel-title">${icon('package', { size: 15 })} Đơn hàng (${d.orders.length})</div>
          <div class="adm-toolbar">
            <label class="sr-only" for="order-status-filter">Lọc theo trạng thái đơn</label>
            <select class="select" id="order-status-filter">
              <option value="">Tất cả trạng thái</option>
              ${['pending', 'paid', 'delivered', 'cancelled', 'refunded'].map((s) =>
                `<option value="${s}"${statusFilter === s ? ' selected' : ''}>${esc(ORDER_LABEL[s] || s)}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="table-wrap adm-table-wrap">
          <table class="adm-table">
            <thead><tr>
              <th scope="col">Mã đơn</th>
              <th scope="col">Khách hàng</th>
              <th scope="col" class="adm-num">Tổng tiền</th>
              <th scope="col">Trạng thái</th>
              <th scope="col">Thời gian</th>
              <th scope="col">Thao tác</th>
            </tr></thead>
            <tbody>
              ${d.orders.length === 0
                ? `<tr><td colspan="6" class="adm-empty">Không có đơn hàng</td></tr>`
                : d.orders.map((o) => {
                  const cls = o.status === 'delivered' ? 'pill-green'
                    : o.status === 'pending' ? 'pill-yellow'
                      : o.status === 'refunded' ? 'pill-red' : 'pill-blue';
                  return `<tr>
                    <td><span class="mono adm-code-inline">${esc(o.code)}</span></td>
                    <td>
                      <div class="adm-cell-main">${esc(o.customer || '—')}</div>
                      <div class="adm-cell-sub">${esc(o.email)}</div>
                    </td>
                    <td class="adm-num"><strong>${fmtVnd(o.total)}</strong></td>
                    <td><span class="pill ${cls}">${esc(ORDER_LABEL[o.status] || o.status)}</span></td>
                    <td class="adm-cell-sub">${fmtDate(o.createdAt)}</td>
                    <td>
                      <div class="adm-actions">
                        ${o.status === 'paid'
                          ? `<button type="button" class="btn btn-ghost btn-sm" data-deliver="${esc(o.id)}">${icon('check', { size: 13 })} Giao</button>`
                          : ''}
                        ${['paid', 'delivered'].includes(o.status)
                          ? `<button type="button" class="btn btn-danger btn-sm" data-refund="${esc(o.id)}">${icon('undo', { size: 13 })} Hoàn</button>`
                          : ''}
                      </div>
                    </td>
                  </tr>`;
                }).join('')}
            </tbody>
          </table>
        </div>
      </div>`;

    host.querySelector('#order-status-filter').onchange = (e) => {
      statusFilter = e.target.value;
      load();
    };

    host.querySelectorAll('[data-deliver]').forEach((b) => {
      b.onclick = async () => {
        try {
          await api(`/api/admin/orders/${b.dataset.deliver}/deliver`, { method: 'POST' });
          toast('Đã đánh dấu giao hàng', 'success');
          load();
        } catch (e) { toast(e.message, 'error'); }
      };
    });

    host.querySelectorAll('[data-refund]').forEach((b) => {
      b.onclick = async () => {
        if (!await confirmDialog('Hoàn tiền đơn hàng?', 'Số tiền sẽ được cộng lại vào ví khách hàng.', 'Hoàn tiền')) return;
        try {
          await api(`/api/admin/orders/${b.dataset.refund}/refund`, { method: 'POST' });
          toast('Đã hoàn tiền', 'success');
          load();
        } catch (e) { toast(e.message, 'error'); }
      };
    });
  };
  await load();
}

/* ---------------- Đơn chờ thanh toán ---------------- */
const TOPUP_STATUS = {
  pending: ['pill-yellow', 'Chờ duyệt', 'clock'],
  paid: ['pill-green', 'Đã nhận', 'check'],
  partial: ['pill-blue', 'Một phần', 'progress'],
  expired: ['pill-gray', 'Hết hạn', 'x'],
  cancelled: ['pill-red', 'Đã huỷ', 'ban'],
};

async function renderTopups(host) {
  let filter = 'pending';
  const load = async () => {
    const d = await api('/api/admin/topups' + (filter ? '?status=' + filter : ''));
    const s = d.stats || {};

    host.innerHTML = `
      <div class="stat-grid">
        ${[
          ['chart', fmtNum(s.total || 0), 'Tổng lệnh nạp'],
          ['clock', fmtNum(s.pending || 0), 'Chờ duyệt'],
          ['check', fmtNum(s.paid || 0), 'Đã nhận'],
          ['coins', fmtVnd(s.totalAmount || 0), 'Tổng đã nạp'],
        ].map(([ico, v, l]) => `
          <div class="stat-card">
            <div class="ico">${icon(ico, { size: 16 })}</div>
            <div class="v">${v}</div>
            <div class="l">${l}</div>
          </div>`).join('')}
      </div>

      ${s.pending > 0 ? `
      <div class="alert alert-warn">
        <span class="ico">${icon('alert', { size: 15 })}</span>
        <span>Có <strong>${s.pending}</strong> lệnh nạp đang chờ.
        Mở app ngân hàng, đối chiếu nội dung <code class="mono">NAPxxxxx</code>,
        rồi bấm <strong>Duyệt</strong>.</span>
      </div>` : ''}

      <div class="panel">
        <div class="adm-panel-head">
          <div class="panel-title">${icon('coins', { size: 15 })} Lệnh nạp tiền (${d.topups.length})</div>
          <div class="adm-toolbar">
            <label class="sr-only" for="tp-filter">Lọc theo trạng thái lệnh nạp</label>
            <select class="select" id="tp-filter">
              <option value="">Tất cả</option>
              ${['pending', 'paid', 'partial', 'expired', 'cancelled'].map((k) =>
                `<option value="${k}"${filter === k ? ' selected' : ''}>${esc(TOPUP_STATUS[k][1])}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="table-wrap adm-table-wrap">
          <table class="adm-table">
            <thead><tr>
              <th scope="col">Nội dung CK</th>
              <th scope="col" class="adm-num">Số tiền</th>
              <th scope="col">Khách</th>
              <th scope="col">Trạng thái</th>
              <th scope="col">Tạo</th>
              <th scope="col">Thao tác</th>
            </tr></thead>
            <tbody>
              ${d.topups.length === 0
                ? `<tr><td colspan="6" class="adm-empty">Không có lệnh nạp</td></tr>`
                : d.topups.map((t) => {
                  const [cls, label, icoName] = TOPUP_STATUS[t.status] || ['pill-gray', t.status, 'help'];
                  return `<tr>
                    <td>
                      <button type="button" class="adm-copy mono" data-copy-memo="${esc(t.memo)}"
                        title="Bấm để sao chép nội dung chuyển khoản">${esc(t.memo)}</button>
                    </td>
                    <td class="adm-num"><strong>${fmtVnd(t.amount)}</strong></td>
                    <td>
                      <div class="adm-cell-main">${esc(t.customer || '—')}</div>
                      <div class="adm-cell-sub">${esc(t.email || '')}</div>
                    </td>
                    <td><span class="pill ${cls}">${icon(icoName, { size: 11 })} ${esc(label)}</span></td>
                    <td class="adm-cell-sub">${fmtDate(t.createdAt)}</td>
                    <td>
                      <div class="adm-actions">
                        ${t.status !== 'paid'
                          ? `<button type="button" class="btn btn-primary btn-sm" data-approve="${esc(t.id)}" data-amt="${esc(t.amount)}">${icon('check', { size: 13 })} Duyệt</button>`
                          : ''}
                        ${['pending', 'expired'].includes(t.status)
                          ? `<button type="button" class="btn btn-ghost btn-sm" data-reject="${esc(t.id)}">Huỷ</button>`
                          : ''}
                      </div>
                    </td>
                  </tr>`;
                }).join('')}
            </tbody>
          </table>
        </div>
      </div>`;

    host.querySelector('#tp-filter').onchange = (e) => {
      filter = e.target.value;
      load();
    };

    host.querySelectorAll('[data-copy-memo]').forEach((el) => {
      el.onclick = async () => {
        const { copyText } = await import('../lib.js');
        const okc = await copyText(el.dataset.copyMemo);
        toast(okc ? 'Đã copy nội dung CK: ' + el.dataset.copyMemo : 'Không copy được',
          okc ? 'success' : 'error');
      };
    });

    host.querySelectorAll('[data-approve]').forEach((b) => {
      b.onclick = () => {
        openModal(`
          <div class="modal-title">Duyệt lệnh nạp</div>
          <div class="modal-sub">
            Chỉ duyệt sau khi đã <strong>tự kiểm tra app ngân hàng</strong> và thấy
            giao dịch với đúng nội dung này.
          </div>
          <div class="field">
            <label class="label" for="ap-amt">Số tiền cộng vào ví (₫)</label>
            <input class="input" id="ap-amt" type="number" value="${b.dataset.amt}">
            <div class="form-hint">Sửa nếu khách chuyển số khác.</div>
          </div>
          <div class="field">
            <label class="label" for="ap-note">Ghi chú</label>
            <input class="input" id="ap-note" placeholder="VD: MB 1234 500k luc 18:30">
          </div>
          <div class="adm-actions-end">
            <button type="button" class="btn btn-ghost" data-cancel>Huỷ</button>
            <button type="button" class="btn btn-primary" data-ok>${icon('check', { size: 14 })} Xác nhận đã nhận tiền</button>
          </div>
        `, {
          onMount(overlay, close) {
            overlay.querySelector('[data-cancel]').onclick = close;
            overlay.querySelector('[data-ok]').onclick = async () => {
              const body = {
                amount: Number(overlay.querySelector('#ap-amt').value) || undefined,
                note: overlay.querySelector('#ap-note').value.trim() || undefined,
              };
              try {
                const r = await api(`/api/admin/topups/${b.dataset.approve}/approve`, {
                  method: 'POST', body,
                });
                toast(`Đã cộng ${fmtVnd(r.credited)} vào ví`, 'success', 5000);
                close();
                load();
              } catch (e) { toast(e.message, 'error'); }
            };
          },
        });
      };
    });

    host.querySelectorAll('[data-reject]').forEach((b) => {
      b.onclick = async () => {
        if (!await confirmDialog('Huỷ lệnh nạp?', 'Không cộng tiền. Chỉ dùng khi chắc chắn không có giao dịch.', 'Huỷ lệnh')) return;
        try {
          await api(`/api/admin/topups/${b.dataset.reject}/reject`, { method: 'POST', body: {} });
          toast('Đã huỷ lệnh nạp', 'success');
          load();
        } catch (e) { toast(e.message, 'error'); }
      };
    });
  };
  await load();
}

/* ---------------- Products ---------------- */
async function renderProducts(host) {
  const d = await api('/api/admin/products');
  host.innerHTML = `
    <div class="panel">
      <div class="adm-panel-head">
        <div class="panel-title">${icon('bag', { size: 15 })} Sản phẩm (${d.products.length})</div>
        <button type="button" class="btn btn-primary btn-sm" id="add-product">${icon('plus', { size: 14 })} Thêm sản phẩm</button>
      </div>
      <div class="table-wrap adm-table-wrap">
        <table class="adm-table">
          <thead><tr>
            <th scope="col">Sản phẩm</th>
            <th scope="col" class="adm-num">Giá</th>
            <th scope="col" class="adm-num">Tồn kho</th>
            <th scope="col" class="adm-num">Đã bán</th>
            <th scope="col">Trạng thái</th>
            <th scope="col">Thao tác</th>
          </tr></thead>
          <tbody>
            ${d.products.length === 0
              ? `<tr><td colspan="6" class="adm-empty">Chưa có sản phẩm</td></tr>`
              : d.products.map((p) => `
              <tr>
                <td>
                  <div class="adm-cell-strong">${esc(p.name)}</div>
                  <div class="mono adm-cell-sub">${esc(p.slug)}</div>
                </td>
                <td class="adm-num">
                  <strong>${fmtVnd(p.price)}</strong>
                  ${p.comparePrice ? `<div class="adm-price-old">${fmtVnd(p.comparePrice)}</div>` : ''}
                </td>
                <td class="adm-num"><span class="pill ${p.stock > 5 ? 'pill-green' : p.stock > 0 ? 'pill-yellow' : 'pill-red'}">${p.stock}</span></td>
                <td class="adm-num">${fmtNum(p.sold)}</td>
                <td><span class="pill ${p.active ? 'pill-green' : 'pill-gray'}">${p.active ? 'Đang bán' : 'Ẩn'}</span></td>
                <td>
                  <div class="adm-actions">
                    <button type="button" class="btn btn-ghost btn-sm" data-keys="${esc(p.id)}">${icon('key', { size: 13 })} Key</button>
                    <button type="button" class="btn btn-ghost btn-sm" data-edit="${esc(p.id)}">${icon('edit', { size: 13 })} Sửa</button>
                    <button type="button" class="btn btn-danger btn-sm" data-del="${esc(p.id)}">Ẩn</button>
                  </div>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;

  host.querySelector('#add-product').onclick = () => openProductEditor(host, null);

  host.querySelectorAll('[data-keys]').forEach((b) => {
    b.onclick = () => navigate('/admin?tab=keys&product=' + b.dataset.keys);
  });

  host.querySelectorAll('[data-edit]').forEach((b) => {
    b.onclick = () => openProductEditor(host, d.products.find((x) => x.id === b.dataset.edit));
  });

  host.querySelectorAll('[data-del]').forEach((b) => {
    b.onclick = async () => {
      if (!await confirmDialog('Ẩn sản phẩm?', 'Sản phẩm sẽ không hiển thị với khách hàng.', 'Ẩn')) return;
      try {
        await api('/api/admin/products/' + b.dataset.del, { method: 'DELETE' });
        toast('Đã ẩn sản phẩm', 'success');
        renderProducts(host);
      } catch (e) { toast(e.message, 'error'); }
    };
  });
}

function openProductEditor(host, p) {
  const isEdit = !!p;
  const cats = state.categories.map((c) =>
    `<option value="${esc(c.id)}"${p && p.categoryId === c.id ? ' selected' : ''}>${esc(c.name)}</option>`).join('');

  openModal(`
    <div class="modal-title">${isEdit ? 'Sửa' : 'Thêm'} sản phẩm</div>
    <div class="modal-sub">Thông tin hiển thị trên trang bán hàng</div>
    <div class="field"><label class="label" for="ed-name">Tên sản phẩm <span class="req">*</span></label>
      <input class="input" id="ed-name" value="${esc(p ? p.name : '')}"></div>
    <div class="field"><label class="label" for="ed-cat">Danh mục</label>
      <select class="select adm-select-full" id="ed-cat">${cats}</select></div>
    <div class="field"><label class="label" for="ed-short">Mô tả ngắn</label>
      <input class="input" id="ed-short" value="${esc(p ? p.shortDesc || '' : '')}"></div>
    <div class="field"><label class="label" for="ed-desc">Mô tả chi tiết</label>
      <textarea class="textarea" id="ed-desc">${esc(p ? p.description || '' : '')}</textarea></div>
    <div class="field"><label class="label" for="ed-img">URL hình ảnh</label>
      <input class="input" id="ed-img" value="${esc(p ? p.imageUrl || '' : '')}" placeholder="https://..."></div>
    <div class="adm-form-row">
      <div class="field"><label class="label" for="ed-price">Giá bán (₫) <span class="req">*</span></label>
        <input class="input" id="ed-price" type="number" value="${p ? p.price : 0}"></div>
      <div class="field"><label class="label" for="ed-cprice">Giá gốc (₫)</label>
        <input class="input" id="ed-cprice" type="number" value="${p && p.comparePrice ? p.comparePrice : ''}"></div>
    </div>
    <div class="adm-form-row">
      <div class="field"><label class="label" for="ed-warranty">Bảo hành (ngày)</label>
        <input class="input" id="ed-warranty" type="number" value="${p ? p.warrantyDays : 0}"></div>
      <div class="field"><label class="label" for="ed-duration">Thời hạn</label>
        <input class="input" id="ed-duration" value="${esc(p ? p.durationLabel || '' : '')}" placeholder="1 năm"></div>
    </div>
    <div class="field"><label class="label" for="ed-badge">Nhãn (HOT/NEW/SALE)</label>
      <input class="input" id="ed-badge" value="${esc(p && p.badge ? p.badge : '')}"></div>
    <div class="field"><label class="label" for="ed-features">Tính năng (mỗi dòng 1 mục)</label>
      <textarea class="textarea" id="ed-features">${esc(p && p.features ? p.features.join('\n') : '')}</textarea></div>
    <div class="adm-form-row">
      <div class="field"><label class="label" for="ed-delivery">Kiểu giao hàng</label>
        <select class="select adm-select-full" id="ed-delivery">
          ${[['key', 'Key có sẵn (kho)'], ['account', 'Tài khoản (kho)'], ['license', 'License sinh tự động'], ['manual', 'Giao thủ công']]
            .map(([v, t]) => `<option value="${v}"${(p ? p.deliveryType : 'key') === v ? ' selected' : ''}>${t}</option>`).join('')}
        </select></div>
      <div class="field"><label class="label" for="ed-licprefix">Tiền tố license</label>
        <input class="input" id="ed-licprefix" value="${esc(p && p.licensePrefix ? p.licensePrefix : 'AOE1')}" placeholder="AOE1"></div>
      <div class="field"><label class="label" for="ed-licdays">Số ngày (0 = vĩnh viễn)</label>
        <input class="input" id="ed-licdays" type="number" value="${p && p.licenseDays !== undefined ? p.licenseDays : 30}"></div>
    </div>
    <div class="adm-check-row">
      <label class="adm-check" for="ed-active">
        <input type="checkbox" id="ed-active" ${!p || p.active ? 'checked' : ''}> Đang bán
      </label>
      <label class="adm-check" for="ed-featured">
        <input type="checkbox" id="ed-featured" ${p && p.featured ? 'checked' : ''}> Nổi bật
      </label>
    </div>
    <div class="adm-actions-end">
      <button type="button" class="btn btn-ghost" data-cancel>Huỷ</button>
      <button type="button" class="btn btn-primary" data-save>${isEdit ? 'Lưu' : 'Tạo'}</button>
    </div>
  `, {
    onMount(overlay, close) {
      overlay.querySelector('[data-cancel]').onclick = close;
      overlay.querySelector('[data-save]').onclick = async () => {
        const body = {
          name: overlay.querySelector('#ed-name').value.trim(),
          categoryId: overlay.querySelector('#ed-cat').value || null,
          shortDesc: overlay.querySelector('#ed-short').value.trim(),
          description: overlay.querySelector('#ed-desc').value.trim(),
          imageUrl: overlay.querySelector('#ed-img').value.trim(),
          price: Number(overlay.querySelector('#ed-price').value) || 0,
          comparePrice: Number(overlay.querySelector('#ed-cprice').value) || null,
          warrantyDays: Number(overlay.querySelector('#ed-warranty').value) || 0,
          durationLabel: overlay.querySelector('#ed-duration').value.trim(),
          badge: overlay.querySelector('#ed-badge').value.trim() || null,
          features: overlay.querySelector('#ed-features').value.split('\n').map((s) => s.trim()).filter(Boolean),
          active: overlay.querySelector('#ed-active').checked,
          featured: overlay.querySelector('#ed-featured').checked,
          deliveryType: overlay.querySelector('#ed-delivery').value,
          licensePrefix: overlay.querySelector('#ed-licprefix').value.trim() || null,
          licenseDays: Number(overlay.querySelector('#ed-licdays').value) || 0,
        };
        if (!body.name) { toast('Vui lòng nhập tên sản phẩm', 'error'); return; }
        try {
          if (isEdit) await api('/api/admin/products/' + p.id, { method: 'PATCH', body });
          else await api('/api/admin/products', { method: 'POST', body });
          toast(isEdit ? 'Đã cập nhật' : 'Đã tạo sản phẩm', 'success');
          close();
          renderProducts(host);
        } catch (e) { toast(e.message, 'error'); }
      };
    },
  });
}

/* ---------------- Keys ---------------- */
async function renderKeys(host, query) {
  const productId = query.product || '';
  const d = await api('/api/admin/products');

  host.innerHTML = `
    <div class="panel">
      <div class="panel-title">${icon('key', { size: 15 })} Quản lý kho key</div>
      <div class="field">
        <label class="label" for="key-product">Chọn sản phẩm</label>
        <select class="select adm-select-full" id="key-product">
          <option value="">— Chọn sản phẩm —</option>
          ${d.products.map((p) => `<option value="${esc(p.id)}"${productId === p.id ? ' selected' : ''}>${esc(p.name)} (${p.stock} key)</option>`).join('')}
        </select>
      </div>
      <div id="key-list"></div>
    </div>`;

  const sel = host.querySelector('#key-product');
  sel.onchange = () => navigate('/admin?tab=keys&product=' + sel.value);
  if (productId) await loadKeys(host, productId);
}

async function loadKeys(host, productId) {
  const listHost = host.querySelector('#key-list');
  listHost.innerHTML = loadingBlock();
  try {
    const d = await api(`/api/admin/products/${productId}/keys`);
    listHost.innerHTML = `
      <div class="alert alert-info">
        <span class="ico">${icon('chart', { size: 15 })}</span>
        <span>Tổng <strong>${d.keys.length}</strong> key ·
          Còn hàng: <strong class="text-green">${d.keys.filter((k) => k.status === 'available').length}</strong> ·
          Đã bán: <strong>${d.keys.filter((k) => k.status === 'sold').length}</strong></span>
      </div>
      <div class="panel adm-panel-soft">
        <div class="panel-title adm-panel-title-sm">${icon('plus', { size: 14 })} Thêm key hàng loạt</div>
        <label class="sr-only" for="new-keys">Danh sách key mới, mỗi dòng một key</label>
        <textarea class="textarea adm-textarea-keys" id="new-keys"
          placeholder="Mỗi dòng 1 key...&#10;XXXXX-XXXXX-XXXXX&#10;YYYYY-YYYYY-YYYYY"></textarea>
        <div class="adm-inline-row">
          <input class="input" id="key-note" placeholder="Ghi chú (loại key, lô...)" aria-label="Ghi chú cho lô key">
          <button type="button" class="btn btn-primary" id="btn-add-keys">Thêm key</button>
        </div>
      </div>
      <div class="table-wrap adm-table-wrap mt-2">
        <table class="adm-table">
          <thead><tr>
            <th scope="col">Key (đã che)</th>
            <th scope="col">Ghi chú</th>
            <th scope="col">Trạng thái</th>
            <th scope="col">Tạo</th>
            <th scope="col">Thao tác</th>
          </tr></thead>
          <tbody>
            ${d.keys.length === 0
              ? `<tr><td colspan="5" class="adm-empty">Chưa có key nào</td></tr>`
              : d.keys.map((k) => `
                <tr>
                  <td><span class="mono adm-mono-sm">${esc(k.masked)}</span></td>
                  <td class="adm-cell-sub">${esc(k.note || '—')}</td>
                  <td><span class="pill ${k.status === 'available' ? 'pill-green' : k.status === 'sold' ? 'pill-blue' : 'pill-gray'}">${esc(k.status)}</span></td>
                  <td class="adm-cell-sub">${fmtDate(k.created_at)}</td>
                  <td>${k.status === 'available'
                    ? `<button type="button" class="btn btn-danger btn-sm" data-delkey="${esc(k.id)}">Xoá</button>`
                    : ''}</td>
                </tr>`).join('')}
          </tbody>
        </table>
      </div>`;

    listHost.querySelector('#btn-add-keys').onclick = async () => {
      const keys = listHost.querySelector('#new-keys').value;
      const note = listHost.querySelector('#key-note').value.trim();
      if (!keys.trim()) { toast('Vui lòng nhập key', 'error'); return; }
      try {
        const res = await api(`/api/admin/products/${productId}/keys`, {
          method: 'POST',
          body: { keys, note },
        });
        toast(`Đã thêm ${res.added} key`, 'success');
        loadKeys(host, productId);
      } catch (e) { toast(e.message, 'error'); }
    };

    listHost.querySelectorAll('[data-delkey]').forEach((b) => {
      b.onclick = async () => {
        if (!await confirmDialog('Xoá key này?', 'Key sẽ bị vô hiệu hoá.', 'Xoá')) return;
        try {
          await api('/api/admin/keys/' + b.dataset.delkey, { method: 'DELETE' });
          toast('Đã xoá key', 'success');
          loadKeys(host, productId);
        } catch (e) { toast(e.message, 'error'); }
      };
    });
  } catch (e) {
    listHost.innerHTML = `<div class="empty-state"><div class="ico">${icon('alert', { size: 26 })}</div>
      <div class="t">${esc(e.message)}</div></div>`;
  }
}

/* ---------------- Licenses ---------------- */
const LIC_STATUS = {
  active: ['pill-green', 'Hoạt động'],
  forever: ['pill-green', 'Vĩnh viễn'],
  expiring: ['pill-yellow', 'Sắp hết hạn'],
  unbound: ['pill-blue', 'Chưa kích hoạt'],
  expired: ['pill-red', 'Hết hạn'],
  revoked: ['pill-red', 'Thu hồi'],
  unknown: ['pill-gray', 'Không rõ'],
};

async function renderLicenses(host) {
  let q = '';
  const load = async () => {
    const d = await api('/api/admin/licenses' + (q ? '?q=' + encodeURIComponent(q) : ''));
    if (!d.available) {
      host.innerHTML = `<div class="alert alert-warn"><span class="ico">${icon('alert', { size: 15 })}</span>
        <span>Chưa cấu hình binding <code class="mono">LICENSE_DB</code>. Thêm D1 <code>xa_license</code> vào wrangler.toml rồi deploy lại.</span></div>`;
      return;
    }
    const s = d.stats || {};
    host.innerHTML = `
      <div class="stat-grid">
        ${[
          ['ticket', fmtNum(s.total || 0), 'Tổng license'],
          ['check', fmtNum(s.active || 0), 'Đang hoạt động'],
          ['unlock', fmtNum(s.unbound || 0), 'Chưa kích hoạt'],
          ['infinity', fmtNum(s.forever || 0), 'Vĩnh viễn'],
          ['ban', fmtNum(s.revoked || 0), 'Đã thu hồi'],
          ['clock', fmtNum(s.expiring7d || 0), 'Hết hạn 7 ngày'],
        ].map(([ico, v, l]) => `
          <div class="stat-card">
            <div class="ico">${icon(ico, { size: 16 })}</div>
            <div class="v">${v}</div>
            <div class="l">${l}</div>
          </div>`).join('')}
      </div>

      <div class="panel mb-2">
        <div class="panel-title adm-panel-title-sm">${icon('plus', { size: 14 })} Tạo license thủ công</div>
        <div class="adm-form-row">
          <div class="field adm-field-narrow"><label class="label" for="lc-count">Số lượng</label>
            <input class="input" id="lc-count" type="number" value="1"></div>
          <div class="field adm-field-narrow"><label class="label" for="lc-days">Số ngày</label>
            <input class="input" id="lc-days" type="number" value="30"></div>
          <div class="field adm-field-narrow"><label class="label" for="lc-prefix">Tiền tố</label>
            <input class="input" id="lc-prefix" value="AOE1"></div>
          <div class="field adm-field-grow"><label class="label" for="lc-note">Ghi chú</label>
            <input class="input" id="lc-note" placeholder="Tặng khách, bù lỗi..."></div>
          <div class="field adm-field-action">
            <button type="button" class="btn btn-primary" id="lc-create">Tạo</button>
          </div>
        </div>
        <pre id="lc-out" class="mono adm-pre"></pre>
      </div>

      <div class="panel">
        <div class="adm-panel-head">
          <div class="panel-title">${icon('ticket', { size: 15 })} Danh sách license (${d.licenses.length})</div>
          <div class="search-mini adm-search">
            ${icon('search', { size: 14 })}
            <label class="sr-only" for="lc-q">Tìm license</label>
            <input id="lc-q" placeholder="Tìm key / ghi chú / HWID" value="${esc(q)}">
          </div>
        </div>
        <div class="table-wrap adm-table-wrap">
          <table class="adm-table">
            <thead><tr>
              <th scope="col">Key</th>
              <th scope="col">Trạng thái</th>
              <th scope="col">Hết hạn</th>
              <th scope="col">Máy</th>
              <th scope="col">Ghi chú</th>
              <th scope="col">Thao tác</th>
            </tr></thead>
            <tbody>
              ${d.licenses.length === 0
                ? `<tr><td colspan="6" class="adm-empty">Chưa có license</td></tr>`
                : d.licenses.map((l) => {
                  const [cls, label] = LIC_STATUS[l.status] || LIC_STATUS.unknown;
                  return `<tr>
                    <td><span class="mono adm-mono-key">${esc(l.key)}</span></td>
                    <td><span class="pill ${cls}">${esc(label)}</span></td>
                    <td class="adm-cell-sub">${l.forever ? 'Vĩnh viễn' : l.expiresAt ? fmtDate(l.expiresAt * 1000) : '—'}</td>
                    <td class="mono adm-mono-sm">${l.bound ? esc(l.hwidMasked) : '—'}</td>
                    <td class="adm-note-cell">${esc(l.note || '')}</td>
                    <td>
                      <div class="adm-actions">
                        <button type="button" class="btn btn-ghost btn-sm" data-act="reset-hwid" data-key="${esc(l.key)}">Reset máy</button>
                        ${l.rebinds >= l.maxRebind
                          ? `<button type="button" class="btn btn-ghost btn-sm" data-act="reset-rebinds" data-key="${esc(l.key)}">Cấp lại lượt đổi</button>`
                          : ''}
                        <button type="button" class="btn btn-ghost btn-sm" data-act="extend" data-key="${esc(l.key)}">+30d</button>
                        <button type="button" class="btn ${l.status === 'revoked' ? 'btn-ghost' : 'btn-danger'} btn-sm" data-act="${l.status === 'revoked' ? 'unrevoke' : 'revoke'}" data-key="${esc(l.key)}">${l.status === 'revoked' ? 'Mở' : 'Thu hồi'}</button>
                      </div>
                      ${l.resetPending
                        ? `<div class="adm-pending-note">${icon('clock', { size: 11 })} Đang chờ khách đổi máy</div>`
                        : ''}
                    </td>
                  </tr>`;
                }).join('')}
            </tbody>
          </table>
        </div>
      </div>`;

    const qInput = host.querySelector('#lc-q');
    // Lọc ngay khi gõ (debounce 400ms) — giống tab Dùng thử.
  // Trước đây chỉ chạy khi nhấn Enter -> gõ chữ bảng không đổi, tưởng hỏng.
  let qTimer = null;
  qInput.oninput = () => {
    clearTimeout(qTimer);
    qTimer = setTimeout(() => {
      q = qInput.value.trim();
      load();
    }, 400);
  };
  // Enter lọc ngay không cần chờ
  qInput.onkeydown = (e) => {
    if (e.key === 'Enter') {
      clearTimeout(qTimer);
      q = qInput.value.trim();
      load();
    }
  };

    host.querySelector('#lc-create').onclick = async () => {
      const body = {
        count: Number(host.querySelector('#lc-count').value) || 1,
        days: Number(host.querySelector('#lc-days').value) || 0,
        prefix: host.querySelector('#lc-prefix').value.trim() || 'AOE1',
        note: host.querySelector('#lc-note').value.trim() || undefined,
      };
      try {
        const r = await api('/api/admin/licenses', { method: 'POST', body });
        host.querySelector('#lc-out').textContent = 'Đã tạo:\n' + r.keys.join('\n');
        toast(`Đã tạo ${r.count} license`, 'success');
        q = '';
        await load();
      } catch (e) { toast(e.message, 'error'); }
    };

    host.querySelectorAll('[data-act]').forEach((b) => {
      b.onclick = async () => {
        const act = b.dataset.act;
        if (act === 'revoke' && !await confirmDialog('Thu hồi license?', 'Client sẽ bị từ chối kích hoạt ngay lập tức.', 'Thu hồi')) return;
        b.disabled = true;
        try {
          await api(`/api/admin/licenses/${encodeURIComponent(b.dataset.key)}/${act}`, { method: 'POST' });
          toast('Đã thực hiện: ' + act, 'success');
          await load();
        } catch (e) {
          toast(e.message, 'error');
          b.disabled = false;
        }
      };
    });
  };
  await load();
}



/* ---------------- Whitelist: dùng thử vô hạn ---------------- */
async function renderWhitelist(host) {
  const SCOPE_LABEL = {
    weak: 'Weak HWID (máy)',
    hwid: 'HWID đầy đủ',
    device: 'Device ID (browser)',
    user: 'Tài khoản',
    ip: 'Địa chỉ IP',
  };

  const load = async () => {
    const d = await api('/api/admin/trial/whitelist');
    const entries = d.entries || [];

    host.innerHTML = `
      <div class="panel">
        <div class="panel-title">${icon('star', { size: 15 })} Dùng thử vô hạn (${entries.length})</div>
        <p class="sec-desc" style="margin-bottom:16px">
          Máy / tài khoản trong danh sách này <strong>không bị giới hạn số lượt</strong>.
          Dùng cho máy lập trình, test nội bộ. Khách thật không ảnh hưởng.
        </p>

        <div class="flex gap-1 mb-2" style="flex-wrap:wrap">
          <button class="btn btn-primary btn-sm" data-add>+ Thêm</button>
          <button class="btn btn-ghost btn-sm" data-thisdev>${icon('star', { size: 13 })} Whitelist máy tôi đang dùng</button>
        </div>

        ${entries.length === 0 ? `
          <div style="text-align:center;padding:32px;color:var(--text-mute)">
            Chưa có mục nào
          </div>` : `
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>Loại</th><th>Giá trị</th><th>Ghi chú</th><th></th></tr>
            </thead>
            <tbody>
              ${entries.map((e) => `
                <tr>
                  <td><span class="pill pill-blue" style="font-size:10.5px">${esc(SCOPE_LABEL[e.scope] || e.scope)}</span></td>
                  <td class="mono" style="font-size:11px;word-break:break-all">${esc(e.value)}</td>
                  <td style="font-size:12px;color:var(--text-mute)">${esc(e.note || '')}</td>
                  <td>
                    <button class="btn btn-danger btn-sm"
                      data-del data-scope="${esc(e.scope)}" data-value="${esc(e.value)}">Xoá</button>
                  </td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>`}
      </div>
    `;

    // Thêm
    host.querySelector('[data-add]').onclick = () => {
      openModal(`
        <div class="modal-title">Thêm vào whitelist</div>
        <div class="modal-sub">Máy này sẽ dùng thử vô hạn lần</div>

        <div class="field">
          <label class="label">Loại</label>
          <select class="select" id="wl-scope">
            <option value="weak">Weak HWID (máy — ổn định nhất)</option>
            <option value="hwid">HWID đầy đủ</option>
            <option value="device">Device ID (browser)</option>
            <option value="user">Tài khoản (username hoặc ID)</option>
            <option value="ip">Địa chỉ IP</option>
          </select>
        </div>

        <div class="field">
          <label class="label">Giá trị</label>
          <input class="input mono" id="wl-value" placeholder="Dán giá trị vào đây">
          <div class="form-hint" id="wl-hint">
            Chạy <code>xa_nofog_pro.exe --status</code> để xem HWID máy.
          </div>
        </div>

        <div class="field">
          <label class="label">Ghi chú</label>
          <input class="input" id="wl-note" placeholder="VD: Máy test của tôi">
        </div>

        <div class="flex gap-1" style="justify-content:flex-end">
          <button class="btn btn-ghost" data-cancel>Huỷ</button>
          <button class="btn btn-primary" data-ok>Thêm</button>
        </div>
      `, {
        onMount(overlay, close) {
          const hint = overlay.querySelector('#wl-hint');
          overlay.querySelector('#wl-scope').onchange = (e) => {
            const v = e.target.value;
            hint.innerHTML = v === 'ip'
              ? 'IP công cộng của bạn (xem tại whatismyip.com)'
              : v === 'user'
                ? 'Username hoặc user ID'
                : 'Chạy <code>xa_nofog_pro.exe --status</code> để xem HWID máy';
          };
          overlay.querySelector('[data-cancel]').onclick = close;
          overlay.querySelector('[data-ok]').onclick = async () => {
            const scope = overlay.querySelector('#wl-scope').value;
            const value = overlay.querySelector('#wl-value').value.trim();
            const note = overlay.querySelector('#wl-note').value.trim();
            if (!value) { toast('Nhập giá trị', 'error'); return; }
            try {
              await api('/api/admin/trial/whitelist', {
                method: 'POST',
                body: { scope, value, note },
              });
              toast('Đã thêm vào whitelist', 'success');
              close();
              await load();
            } catch (e) { toast(e.message, 'error', 6000); }
          };
        },
      });
    };

    // Whitelist máy đang dùng (theo IP)
    host.querySelector('[data-thisdev]').onclick = async () => {
      try {
        const r = await api('/api/admin/trial/whitelist/this-device', { method: 'POST' });
        if (r.added) {
          toast(`Đã whitelist IP ${r.value}`, 'success', 6000);
          await load();
        } else {
          toast('Không lấy được IP', 'error');
        }
      } catch (e) { toast(e.message, 'error', 6000); }
    };

    // Xoá
    host.querySelectorAll('[data-del]').forEach((b) => {
      b.onclick = async () => {
        if (!confirm(`Xoá "${b.dataset.value}" khỏi whitelist?`)) return;
        try {
          await api(`/api/admin/trial/whitelist?scope=${encodeURIComponent(b.dataset.scope)}&value=${encodeURIComponent(b.dataset.value)}`,
            { method: 'DELETE' });
          toast('Đã xoá', 'success');
          await load();
        } catch (e) { toast(e.message, 'error', 6000); }
      };
    });
  };

  await load();
}

/* ---------------- Trial (dùng thử) ---------------- */
async function renderTrial(host) {
  let filter = '';

  const load = async () => {
    const d = await api('/api/admin/trial/accounts' + (filter ? '?q=' + encodeURIComponent(filter) : ''));
    const cfg = d.cfg || {};
    const accounts = d.accounts || [];

    const quota1h = cfg.t1h?.quota ?? 10;
    const quota3d = cfg.t3d?.quota ?? 10;

    // Thống kê
    const totalAccounts = accounts.length;
    const used1h = accounts.reduce((s, a) => s + (a.t1h?.used || 0), 0);
    const used3d = accounts.reduce((s, a) => s + (a.t3d?.used || 0), 0);

    host.innerHTML = `
      <div class="stat-grid">
        ${[
          ['users', fmtNum(totalAccounts), 'Tài khoản đã dùng thử'],
          ['timer', fmtNum(used1h), 'Lượt 1 giờ đã dùng'],
          ['calendar', fmtNum(used3d), 'Lượt 3 ngày đã dùng'],
          ['coins', `${quota1h} + ${quota3d}`, 'Lượt/tài khoản'],
        ].map(([ico, v, l]) => `
          <div class="stat-card">
            <div class="ico">${icon(ico, { size: 16 })}</div>
            <div class="v">${v}</div>
            <div class="l">${l}</div>
          </div>`).join('')}
      </div>

      <div class="panel">
        <div class="adm-panel-head">
          <div class="panel-title">${icon('gift', { size: 15 })} Dùng thử (${accounts.length})</div>
          <div class="adm-toolbar">
            <label class="sr-only" for="tq-search">Tìm tài khoản dùng thử</label>
            <input class="input adm-input-search" id="tq-search" placeholder="Tìm tài khoản..."
              value="${esc(filter)}">
            <button type="button" class="btn btn-ghost btn-sm" id="tq-reload"
              aria-label="Tải lại danh sách" title="Tải lại">${icon('refresh', { size: 14 })}</button>
          </div>
        </div>

        ${accounts.length === 0 ? `
          <div class="empty-state adm-empty-sm">
            <div class="ico">${icon('inbox', { size: 26 })}</div>
            <div class="t">Chưa có ai dùng thử</div>
          </div>` : `
        <div class="table-wrap adm-table-wrap">
          <table class="adm-table">
            <thead>
              <tr>
                <th scope="col">Tài khoản</th>
                <th scope="col">${icon('timer', { size: 12 })} 1 giờ</th>
                <th scope="col">${icon('calendar', { size: 12 })} 3 ngày</th>
                <th scope="col" class="adm-num">Tổng lượt</th>
                <th scope="col">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              ${accounts.map((a) => `
                <tr>
                  <td>
                    <div class="adm-cell-strong">${esc(a.username || a.email || a.userId.slice(0, 8))}</div>
                    <div class="adm-cell-sub">${esc(a.fullName || '')}</div>
                    ${a.status !== 'active' ? `<span class="pill pill-red adm-pill-sm">${esc(a.status)}</span>` : ''}
                  </td>
                  <td>
                    <div class="adm-count">
                      <strong>${a.t1h.used}/${a.t1h.quota}</strong>
                      ${a.t1h.left > 0
                        ? `<span class="adm-count-left">(còn ${a.t1h.left})</span>`
                        : `<span class="adm-count-out">(hết)</span>`}
                    </div>
                    ${a.t1h.banned ? '<span class="pill pill-red adm-pill-sm">Bị chặn</span>' : ''}
                    ${a.t1h.resets > 0 ? `<div class="adm-reset-count">đã reset ${a.t1h.resets} lần</div>` : ''}
                  </td>
                  <td>
                    <div class="adm-count">
                      <strong>${a.t3d.used}/${a.t3d.quota}</strong>
                      ${a.t3d.left > 0
                        ? `<span class="adm-count-left">(còn ${a.t3d.left})</span>`
                        : `<span class="adm-count-out">(hết)</span>`}
                    </div>
                    ${a.t3d.banned ? '<span class="pill pill-red adm-pill-sm">Bị chặn</span>' : ''}
                    ${a.t3d.resets > 0 ? `<div class="adm-reset-count">đã reset ${a.t3d.resets} lần</div>` : ''}
                  </td>
                  <td class="num adm-cell-sub">${a.totalUses}</td>
                  <td>
                    <div class="adm-actions">
                      ${(a.t1h.used > 0 || a.t3d.used > 0)
                        ? `<button type="button" class="btn btn-primary btn-sm" data-reset="${esc(a.userId)}" data-name="${esc(a.username || a.email || '')}">${icon('refresh', { size: 13 })} Reset</button>`
                        : ''}
                      <button type="button" class="btn btn-ghost btn-sm" data-uses="${esc(a.userId)}">${icon('log', { size: 13 })} Lịch sử</button>
                    </div>
                  </td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>`}
      </div>
    `;

    const searchEl = host.querySelector('#tq-search');
    let timer = null;
    if (searchEl) {
      searchEl.oninput = () => {
        clearTimeout(timer);
        timer = setTimeout(() => { filter = searchEl.value.trim(); load(); }, 400);
      };
    }
    host.querySelector('#tq-reload').onclick = load;

    // Reset trial
    host.querySelectorAll('[data-reset]').forEach((b) => {
      b.onclick = () => {
        const uid = b.dataset.reset;
        const name = b.dataset.name;
        openModal(`
          <div class="modal-title">${icon('refresh', { size: 16 })} Reset dùng thử</div>
          <div class="modal-sub">Tài khoản: <strong>${esc(name)}</strong></div>

          <div class="alert alert-warn">
            <span class="ico">${icon('alert', { size: 15 })}</span>
            <span>Reset sẽ đưa lượt đã dùng về <strong>0</strong> và
            <strong>thu hồi</strong> license dùng thử đang chạy. Lịch sử vẫn được giữ.</span>
          </div>

          <div class="field">
            <label class="label" for="rs-kinds">Reset loại nào?</label>
            <select class="select adm-select-full" id="rs-kinds">
              <option value="all">Cả hai (1 giờ + 3 ngày)</option>
              <option value="1h">Chỉ 1 giờ</option>
              <option value="3d">Chỉ 3 ngày</option>
            </select>
          </div>

          <div class="field">
            <label class="label" for="rs-reason">Lý do <span class="req">*</span></label>
            <input class="input" id="rs-reason" placeholder="VD: Khách báo lỗi không dùng được, đã xác minh">
            <div class="form-hint">Bắt buộc, lưu vào nhật ký để đối soát sau.</div>
          </div>

          <div class="field adm-check-field">
            <label class="adm-check" for="rs-revoke">
              <input type="checkbox" id="rs-revoke" checked>
              <span>Thu hồi license dùng thử đang chạy</span>
            </label>
          </div>

          <div class="adm-actions-end">
            <button type="button" class="btn btn-ghost" data-cancel>Huỷ</button>
            <button type="button" class="btn btn-primary" data-ok>Xác nhận reset</button>
          </div>
        `, {
          onMount(overlay, close) {
            overlay.querySelector('[data-cancel]').onclick = close;
            overlay.querySelector('[data-ok]').onclick = async () => {
              const reason = overlay.querySelector('#rs-reason').value.trim();
              if (reason.length < 10) {
                toast('Nhập lý do ít nhất 10 ký tự', 'error');
                return;
              }
              const kindsVal = overlay.querySelector('#rs-kinds').value;
              try {
                const r = await api('/api/admin/trial/reset', {
                  method: 'POST',
                  body: {
                    userId: uid,
                    kinds: kindsVal === 'all' ? 'all' : [kindsVal],
                    reason,
                    revokeActive: overlay.querySelector('#rs-revoke').checked,
                  },
                });
                toast(`Đã reset. Thu hồi ${(r.revokedKeys || []).length} license.`, 'success', 6000);
                close();
                load();
              } catch (e) { toast(e.message, 'error', 7000); }
            };
          },
        });
      };
    });

    // Lịch sử
    host.querySelectorAll('[data-uses]').forEach((b) => {
      b.onclick = async () => {
        const uid = b.dataset.uses;
        const d2 = await api('/api/admin/trial/uses?userId=' + encodeURIComponent(uid));
        const uses = d2.uses || [];
        const stateCls = { active: 'pill-green', expired: 'pill-gray', ended: 'pill-gray', hold: 'pill-yellow' };

        openModal(`
          <div class="modal-title">${icon('log', { size: 16 })} Lịch sử dùng thử</div>
          <div class="modal-sub">${uses.length} lần</div>
          <div class="table-wrap adm-table-wrap adm-scroll">
            <table class="adm-table">
              <thead><tr>
                <th scope="col">Loại</th>
                <th scope="col">Mã</th>
                <th scope="col">Trạng thái</th>
                <th scope="col">Bắt đầu</th>
              </tr></thead>
              <tbody>
                ${uses.length === 0
                  ? '<tr><td colspan="4" class="adm-empty">Chưa có</td></tr>'
                  : uses.map((u) => `
                    <tr>
                      <td><strong>${esc(u.kind === '1h' ? '1 giờ' : '3 ngày')}</strong></td>
                      <td class="mono adm-mono-sm">${esc(u.key)}</td>
                      <td><span class="pill ${stateCls[u.state] || 'pill-gray'} adm-pill-sm">${esc(u.state)}</span></td>
                      <td class="adm-cell-sub">${u.startedAt ? fmtDate(u.startedAt * 1000) : '—'}</td>
                    </tr>`).join('')}
              </tbody>
            </table>
          </div>
          <div class="adm-actions-end adm-actions-topgap">
            <button type="button" class="btn btn-ghost" data-close>Đóng</button>
          </div>
        `, {
          onMount(overlay, close) {
            overlay.querySelector('[data-close]').onclick = close;
          },
        });
      };
    });
  };

  await load();
}

/* ---------------- Users ---------------- */
async function renderUsers(host) {
  const d = await api('/api/admin/users');
  host.innerHTML = `
    <div class="panel">
      <div class="panel-title">${icon('users', { size: 15 })} Người dùng (${d.users.length})</div>
      <div class="table-wrap adm-table-wrap">
        <table class="adm-table">
          <thead><tr>
            <th scope="col">Email</th>
            <th scope="col">Họ tên</th>
            <th scope="col" class="adm-num">Số dư</th>
            <th scope="col" class="adm-num">Đơn</th>
            <th scope="col">Vai trò</th>
            <th scope="col">Trạng thái</th>
            <th scope="col">Thao tác</th>
          </tr></thead>
          <tbody>
            ${d.users.length === 0
              ? `<tr><td colspan="7" class="adm-empty">Chưa có người dùng</td></tr>`
              : d.users.map((u) => `
              <tr>
                <td class="adm-cell-main">${esc(u.email)}</td>
                <td class="adm-cell-strong">${esc(u.fullName || '—')}</td>
                <td class="adm-num"><strong class="text-green">${fmtVnd(u.balance)}</strong></td>
                <td class="adm-num">${u.orderCount}</td>
                <td><span class="pill ${u.role === 'admin' ? 'pill-red' : 'pill-gray'}">${esc(u.role)}</span></td>
                <td><span class="pill ${u.status === 'active' ? 'pill-green' : 'pill-red'}">${esc(u.status)}</span></td>
                <td>
                  <div class="adm-actions">
                    <button type="button" class="btn btn-ghost btn-sm" data-adj="${esc(u.id)}" data-email="${esc(u.email)}"
                      aria-label="Điều chỉnh số dư" title="Điều chỉnh số dư">${icon('wallet', { size: 14 })}</button>
                    <button type="button" class="btn btn-ghost btn-sm" data-lock="${esc(u.id)}"
                      aria-label="${u.status === 'active' ? 'Khoá tài khoản' : 'Mở khoá tài khoản'}"
                      title="${u.status === 'active' ? 'Khoá tài khoản' : 'Mở khoá tài khoản'}">${u.status === 'active' ? icon('lock', { size: 14 }) : icon('unlock', { size: 14 })}</button>
                  </div>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;

  host.querySelectorAll('[data-adj]').forEach((b) => {
    b.onclick = () => {
      openModal(`
        <div class="modal-title">Điều chỉnh số dư</div>
        <div class="modal-sub">${esc(b.dataset.email)}</div>
        <div class="field"><label class="label" for="adj-amount">Số tiền (âm để trừ)</label>
          <input class="input" id="adj-amount" type="number" placeholder="50000 hoặc -50000"></div>
        <div class="field"><label class="label" for="adj-reason">Lý do <span class="req">*</span></label>
          <input class="input" id="adj-reason" placeholder="Bồi thường, hoàn tiền..."></div>
        <div class="adm-actions-end">
          <button type="button" class="btn btn-ghost" data-cancel>Huỷ</button>
          <button type="button" class="btn btn-primary" data-ok>Xác nhận</button>
        </div>
      `, {
        onMount(overlay, close) {
          overlay.querySelector('[data-cancel]').onclick = close;
          overlay.querySelector('[data-ok]').onclick = async () => {
            const amount = Number(overlay.querySelector('#adj-amount').value);
            const reason = overlay.querySelector('#adj-reason').value.trim();
            if (!amount || !reason) { toast('Nhập đủ số tiền và lý do', 'error'); return; }
            try {
              await api('/api/admin/wallet/adjust', {
                method: 'POST',
                body: { userId: b.dataset.adj, amount, reason },
              });
              toast('Đã điều chỉnh số dư', 'success');
              close();
              renderUsers(host);
            } catch (e) { toast(e.message, 'error'); }
          };
        },
      });
    };
  });

  host.querySelectorAll('[data-lock]').forEach((b) => {
    b.onclick = async () => {
      try {
        const u = d.users.find((x) => x.id === b.dataset.lock);
        await api('/api/admin/users/' + u.id, {
          method: 'PATCH',
          body: { status: u.status === 'active' ? 'locked' : 'active' },
        });
        toast('Đã cập nhật trạng thái', 'success');
        renderUsers(host);
      } catch (e) { toast(e.message, 'error'); }
    };
  });
}

/* ---------------- Settings ---------------- */
async function renderSettings(host) {
  const d = await api('/api/admin/settings');
  const s = d.settings;
  host.innerHTML = `
    <div class="panel">
      <div class="panel-title">${icon('settings', { size: 15 })} Cài đặt hệ thống</div>
      <form id="settings-form">
        <div class="field"><label class="label" for="st-bank">Tên ngân hàng</label>
          <input class="input" id="st-bank" value="${esc(s.bank_name || '')}" placeholder="MB Bank"></div>
        <div class="field"><label class="label" for="st-acc">Số tài khoản</label>
          <input class="input" id="st-acc" value="${esc(s.bank_account || '')}"></div>
        <div class="field"><label class="label" for="st-owner">Chủ tài khoản</label>
          <input class="input adm-upper" id="st-owner" value="${esc(s.bank_owner || '')}"></div>
        <div class="adm-form-row">
          <div class="field"><label class="label" for="st-min">Nạp tối thiểu (₫)</label>
            <input class="input" id="st-min" type="number" value="${esc(s.topup_min || '20000')}"></div>
          <div class="field"><label class="label" for="st-max">Nạp tối đa (₫)</label>
            <input class="input" id="st-max" type="number" value="${esc(s.topup_max || '50000000')}"></div>
        </div>
        <div class="panel-title" style="margin-top:26px;font-size:14px">Cấu hình dùng thử</div>

        <div class="adm-form-row">
          <div class="field"><label class="label" for="st-t1h-en">Gói 1 giờ</label>
            <select class="select" id="st-t1h-en">
              <option value="1" ${s.trial1h_enabled !== '0' ? 'selected' : ''}>Bật</option>
              <option value="0" ${s.trial1h_enabled === '0' ? 'selected' : ''}>Tắt</option>
            </select></div>
          <div class="field"><label class="label" for="st-t1h-min">Số phút</label>
            <input class="input" id="st-t1h-min" type="number" value="${esc(s.trial1h_minutes || '60')}"></div>
          <div class="field"><label class="label" for="st-t1h-lim">Số lượt / thiết bị</label>
            <input class="input" id="st-t1h-lim" type="number" value="${esc(s.trial1h_limit || '10')}"></div>
        </div>

        <div class="adm-form-row">
          <div class="field"><label class="label" for="st-t3d-en">Gói 3 ngày</label>
            <select class="select" id="st-t3d-en">
              <option value="1" ${s.trial3d_enabled !== '0' ? 'selected' : ''}>Bật</option>
              <option value="0" ${s.trial3d_enabled === '0' ? 'selected' : ''}>Tắt</option>
            </select></div>
          <div class="field"><label class="label" for="st-t3d-days">Số ngày</label>
            <input class="input" id="st-t3d-days" type="number" value="${esc(s.trial3d_days || '3')}"></div>
          <div class="field"><label class="label" for="st-t3d-lim">Số lượt / thiết bị</label>
            <input class="input" id="st-t3d-lim" type="number" value="${esc(s.trial3d_limit || '10')}"></div>
        </div>

        <div class="adm-form-row">
          <div class="field"><label class="label" for="st-t-ip">Lượt / IP / ngày</label>
            <input class="input" id="st-t-ip" type="number" value="${esc(s.trial_max_per_ip || '100')}"></div>
          <div class="field"><label class="label" for="st-t-net">Lượt / mạng / 30 ngày</label>
            <input class="input" id="st-t-net" type="number" value="${esc(s.trial_max_per_net || '2000')}"></div>
          <div class="field"><label class="label" for="st-t-day">Lượt / ngày toàn hệ thống</label>
            <input class="input" id="st-t-day" type="number" value="${esc(s.trial_max_per_day || '5000')}"></div>
        </div>

        <button class="btn btn-primary" type="submit">${icon('check', { size: 14 })} Lưu cài đặt</button>
      </form>
      <div class="alert alert-info mt-2 adm-alert-last">
        <span class="ico">${icon('info', { size: 15 })}</span>
        <span>Thông tin ngân hàng dùng để tạo mã VietQR cho từng đơn hàng. Cần khớp với tài khoản đã kết nối webhook.</span>
      </div>

      <div class="adm-section">
        <div class="panel-title adm-panel-title-sm">${icon('link', { size: 14 })} Kết nối webhook tự động</div>
        <p class="adm-p">
          Dán URL bên dưới vào dashboard dịch vụ để tiền tự vào ví khi khách chuyển khoản.
          Không nối thì phải duyệt tay ở tab <strong>Chờ thanh toán</strong>.
        </p>

        <div id="wh-status" class="adm-wh-status">Đang kiểm tra...</div>

        <div class="adm-provider">
          <div class="adm-provider-head">${icon('bank', { size: 15 })} SePay / Casso</div>
          <div class="adm-kv">
            URL:
            <button type="button" class="mono adm-code" id="wh-sepay-url" title="Bấm để sao chép"
              aria-label="Sao chép URL webhook SePay">${esc(location.origin)}/api/webhooks/sepay</button>
          </div>
          <div class="adm-kv">
            Xác thực: <code class="mono adm-code-plain">Authorization: Apikey &lt;WEBHOOK_SECRET&gt;</code>
          </div>
        </div>

        <div class="adm-provider">
          <div class="adm-provider-head">${icon('card', { size: 15 })} payOS</div>
          <div class="adm-kv">
            URL:
            <button type="button" class="mono adm-code" id="wh-payos-url" title="Bấm để sao chép"
              aria-label="Sao chép URL webhook payOS">${esc(location.origin)}/api/webhooks/payos</button>
          </div>
          <div class="field">
            <label class="label" for="wh-payos-key">Checksum Key</label>
            <input class="input" id="wh-payos-key" type="password" placeholder="Dán checksum key từ my.payos.vn">
            <div class="form-hint">Lấy ở my.payos.vn, mục Kênh thanh toán, phần Checksum Key. Khuyến nghị dùng
              <code class="mono">wrangler secret put PAYOS_CHECKSUM_KEY</code> để bảo mật hơn.</div>
          </div>
          <div class="adm-actions">
            <button type="button" class="btn btn-primary btn-sm" id="wh-save-payos">Lưu checksum key</button>
            <button type="button" class="btn btn-ghost btn-sm" id="wh-clear-payos">Xoá</button>
          </div>
        </div>

        <div class="adm-provider">
          <div class="adm-provider-head">
            ${icon('send', { size: 15 })} Telegram
            <span id="tg-badge"></span>
          </div>
          <p class="adm-p adm-p-tight">
            Có tiền vào là báo ngay về điện thoại, kèm nút <strong>Duyệt</strong> và
            <strong>Từ chối</strong> — không cần mở web.
          </p>

          <div class="field">
            <label class="label" for="tg-token">Bot Token</label>
            <input class="input" id="tg-token" type="password" placeholder="123456789:ABCdefGHI...">
            <div class="form-hint">Tạo bot với <code class="mono">@BotFather</code> trên Telegram rồi sao chép token.</div>
          </div>
          <div class="field">
            <label class="label" for="tg-chat">Chat ID</label>
            <input class="input" id="tg-chat" placeholder="123456789">
            <div class="form-hint">
              Nhắn <code class="mono">/start</code> cho bot, hoặc thêm bot vào nhóm rồi nhắn
              <code class="mono">/id</code> — bot sẽ trả chat ID.
            </div>
          </div>

          <div class="adm-actions">
            <button type="button" class="btn btn-primary btn-sm" id="tg-save">Lưu</button>
            <button type="button" class="btn btn-ghost btn-sm" id="tg-test">${icon('send', { size: 13 })} Gửi tin thử</button>
            <button type="button" class="btn btn-ghost btn-sm" id="tg-clear">Xoá</button>
          </div>

          <div class="adm-subsection">
            <div class="adm-hint adm-hint-strong">
              <strong>Bắt buộc</strong> — dán URL này vào Telegram để nút bấm hoạt động:
            </div>
            <button type="button" class="mono adm-code adm-code-block" id="tg-webhook-url" title="Bấm để sao chép"
              aria-label="Sao chép URL webhook Telegram">${esc(location.origin)}/api/telegram/webhook</button>
            <div class="adm-hint">
              Cần đặt secret trước:
              <code class="mono">wrangler secret put TG_WEBHOOK_SECRET</code><br>
              Rồi gọi:<br>
              <code class="mono adm-code-plain adm-wrap">curl "https://api.telegram.org/bot&lt;TOKEN&gt;/setWebhook?url=https://xienhl.com/api/telegram/webhook&amp;secret_token=&lt;SECRET&gt;"</code>
            </div>
          </div>
        </div>
      </div>
    </div>`;

  host.querySelector('#settings-form').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api('/api/admin/settings', {
        method: 'POST',
        body: {
          bank_name: host.querySelector('#st-bank').value.trim(),
          bank_account: host.querySelector('#st-acc').value.trim(),
          bank_owner: host.querySelector('#st-owner').value.trim(),
          topup_min: Number(host.querySelector('#st-min').value),
          topup_max: Number(host.querySelector('#st-max').value),
          trial1h_enabled: host.querySelector('#st-t1h-en').value,
          trial1h_minutes: Number(host.querySelector('#st-t1h-min').value),
          trial1h_limit: Number(host.querySelector('#st-t1h-lim').value),
          trial3d_enabled: host.querySelector('#st-t3d-en').value,
          trial3d_days: Number(host.querySelector('#st-t3d-days').value),
          trial3d_limit: Number(host.querySelector('#st-t3d-lim').value),
          trial_max_per_ip: Number(host.querySelector('#st-t-ip').value),
          trial_max_per_net: Number(host.querySelector('#st-t-net').value),
          trial_max_per_day: Number(host.querySelector('#st-t-day').value),
        },
      });
      toast('Đã lưu cài đặt', 'success');
    } catch (err) { toast(err.message, 'error'); }
  };

  /* ---------- Webhook status ---------- */
  const loadWh = async () => {
    try {
      const h = await api('/api/webhooks/health');
      const badge = (c) => c
        ? `<span class="pill pill-green">${icon('check', { size: 11 })} Đã nối</span>`
        : `<span class="pill pill-yellow">${icon('alert', { size: 11 })} Chưa nối</span>`;
      host.querySelector('#wh-status').innerHTML = `
        <div class="adm-legend">
          <div class="adm-legend-item">
            SePay: ${badge(h.sepay?.configured)}
            ${h.sepay?.source !== 'none' ? `<span class="adm-legend-src">(${esc(h.sepay.source)})</span>` : ''}
          </div>
          <div class="adm-legend-item">
            payOS: ${badge(h.payos?.configured)}
            ${h.payos?.source !== 'none' ? `<span class="adm-legend-src">(${esc(h.payos.source)})</span>` : ''}
          </div>
        </div>`;
    } catch {
      host.querySelector('#wh-status').innerHTML =
        `<span class="pill pill-red">${icon('alert', { size: 11 })} Không kiểm tra được</span>`;
    }
  };
  await loadWh();

  // Copy URL khi bấm
  for (const id of ['wh-sepay-url', 'wh-payos-url']) {
    const el = host.querySelector('#' + id);
    if (el) {
      el.onclick = async () => {
        const okc = await copyText(el.textContent.trim());
        toast(okc ? 'Đã copy URL webhook' : 'Không copy được', okc ? 'success' : 'error');
      };
    }
  }

  // Lưu checksum key payOS
  const savePayos = host.querySelector('#wh-save-payos');
  if (savePayos) {
    savePayos.onclick = async () => {
      const key = host.querySelector('#wh-payos-key').value.trim();
      if (!key) { toast('Chưa nhập checksum key', 'error'); return; }
      try {
        await api('/api/admin/settings/payos', { method: 'POST', body: { checksumKey: key } });
        toast('Đã lưu checksum key payOS', 'success', 5000);
        host.querySelector('#wh-payos-key').value = '';
        await loadWh();
      } catch (err) { toast(err.message, 'error'); }
    };
  }

  const clearPayos = host.querySelector('#wh-clear-payos');
  if (clearPayos) {
    clearPayos.onclick = async () => {
      if (!await confirmDialog('Xoá checksum key payOS?', 'Webhook payOS sẽ ngừng hoạt động.', 'Xoá')) return;
      try {
        await api('/api/admin/settings/payos', { method: 'POST', body: { checksumKey: '' } });
        toast('Đã xoá', 'success');
        await loadWh();
      } catch (err) { toast(err.message, 'error'); }
    };
  }

  /* ---------- Telegram ---------- */
  const loadTg = async () => {
    const badge = host.querySelector('#tg-badge');
    if (!badge) return;
    try {
      const st = await api('/api/admin/telegram/status');
      badge.innerHTML = st.configured
        ? `<span class="pill pill-green">${icon('check', { size: 11 })} Đã nối</span>${st.source !== 'none' ? ` <span class="adm-legend-src">(${esc(st.source)})</span>` : ''}`
        : `<span class="pill pill-yellow">${icon('alert', { size: 11 })} Chưa nối</span>`;
      if (st.botTokenHint) host.querySelector('#tg-token').placeholder = st.botTokenHint;
      if (st.chatId) host.querySelector('#tg-chat').placeholder = st.chatId;
    } catch {
      badge.innerHTML = `<span class="pill pill-red">${icon('alert', { size: 11 })} Lỗi</span>`;
    }
  };
  await loadTg();

  const tgUrl = host.querySelector('#tg-webhook-url');
  if (tgUrl) {
    tgUrl.onclick = async () => {
      const okc = await copyText(tgUrl.textContent.trim());
      toast(okc ? 'Đã copy URL webhook Telegram' : 'Không copy được', okc ? 'success' : 'error');
    };
  }

  const tgSave = host.querySelector('#tg-save');
  if (tgSave) {
    tgSave.onclick = async () => {
      const botToken = host.querySelector('#tg-token').value.trim();
      const chatId = host.querySelector('#tg-chat').value.trim();
      if (!botToken && !chatId) { toast('Nhập ít nhất một trường', 'error'); return; }
      tgSave.disabled = true;
      try {
        await api('/api/admin/telegram/config', { method: 'POST', body: { botToken, chatId } });
        toast('Đã lưu cấu hình Telegram', 'success');
        host.querySelector('#tg-token').value = '';
        host.querySelector('#tg-chat').value = '';
        await loadTg();
      } catch (err) { toast(err.message, 'error'); }
      finally { tgSave.disabled = false; }
    };
  }

  const tgTest = host.querySelector('#tg-test');
  if (tgTest) {
    tgTest.onclick = async () => {
      tgTest.disabled = true;
      tgTest.textContent = 'Đang gửi...';
      try {
        await api('/api/admin/telegram/test', { method: 'POST', body: {} });
        toast('Đã gửi! Kiểm tra Telegram trên điện thoại.', 'success', 6000);
      } catch (err) { toast(err.message, 'error', 7000); }
      finally { tgTest.disabled = false; tgTest.innerHTML = icon('send', { size: 13 }) + ' Gửi tin thử'; }
    };
  }

  const tgClear = host.querySelector('#tg-clear');
  if (tgClear) {
    tgClear.onclick = async () => {
      if (!await confirmDialog('Xoá cấu hình Telegram?', 'Sẽ không còn thông báo nào được gửi.', 'Xoá')) return;
      try {
        await api('/api/admin/telegram/config', { method: 'POST', body: { botToken: '', chatId: '' } });
        toast('Đã xoá', 'success');
        await loadTg();
      } catch (err) { toast(err.message, 'error'); }
    };
  }
}

/* ---------------- Logs ---------------- */
async function renderLogs(host) {
  const d = await api('/api/admin/logs');
  host.innerHTML = `
    <div class="panel">
      <div class="panel-title">${icon('log', { size: 15 })} Nhật ký hoạt động (${d.logs.length})</div>
      <div class="table-wrap adm-table-wrap">
        <table class="adm-table">
          <thead><tr>
            <th scope="col">Hành động</th>
            <th scope="col">Người thực hiện</th>
            <th scope="col">Đối tượng</th>
            <th scope="col">Thời gian</th>
          </tr></thead>
          <tbody>
            ${d.logs.length === 0
              ? `<tr><td colspan="4" class="adm-empty">Chưa có nhật ký</td></tr>`
              : d.logs.map((l) => `
                <tr>
                  <td><span class="mono adm-mono-sm adm-code-inline">${esc(l.action)}</span></td>
                  <td class="adm-cell-main">${esc(l.actor)}</td>
                  <td class="mono adm-mono-sm">${esc(l.target || '—')}</td>
                  <td class="adm-cell-sub">${fmtDate(l.createdAt)}</td>
                </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}
