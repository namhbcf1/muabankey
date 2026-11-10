/** Trang quản trị (admin). */
import { api, esc, fmtVnd, fmtNum, fmtDate, toast, navigate, openModal, confirmDialog, loadingBlock, debounce, copyText } from '../lib.js';
import { state } from '../state.js';

const NAV = [
  ['dashboard', '📊', 'Tổng quan'],
  ['orders', '📦', 'Đơn hàng'],
  ['topups', '💰', 'Nạp tiền'],
  ['products', '🛍️', 'Sản phẩm'],
  ['keys', '🔑', 'Kho key'],
  ['licenses', '🎫', 'License'],
  ['users', '👥', 'Người dùng'],
  ['settings', '⚙️', 'Cài đặt'],
  ['logs', '📜', 'Nhật ký'],
];

export function renderAdmin(query) {
  const tab = query.tab || 'dashboard';
  return `
  <div id="site-header"></div>
  <section class="section-sm">
    <div class="container container-wide">
      <div class="sec-head" style="margin-bottom:22px">
        <div>
          <h1 class="sec-title">⚙️ Quản trị hệ thống</h1>
          <p class="sec-desc">Quản lý đơn hàng, sản phẩm, kho key và người dùng</p>
        </div>
      </div>
      <div class="admin-layout">
        <nav class="admin-nav">
          ${NAV.map(([k, ico, label]) => `
            <button class="admin-nav-item ${tab === k ? 'active' : ''}" data-tab="${k}">
              <span class="ico">${ico}</span>${label}
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
      `<div class="empty-state"><div class="ico">🚫</div><div class="t">Không có quyền truy cập</div></div>`;
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
    else if (tab === 'users') await renderUsers(host);
    else if (tab === 'settings') await renderSettings(host);
    else if (tab === 'logs') await renderLogs(host);
  } catch (e) {
    host.innerHTML = `<div class="empty-state"><div class="ico">⚠️</div><div class="t">${esc(e.message)}</div></div>`;
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
        ['💰', fmtVnd(s.revenue), 'Tổng doanh thu', `+${fmtVnd(s.revenueToday)} hôm nay`],
        ['📦', fmtNum(s.orders), 'Tổng đơn hàng', `+${s.ordersToday} hôm nay`],
        ['👥', fmtNum(s.users), 'Người dùng', `+${s.usersToday} hôm nay`],
        ['⏳', fmtNum(s.pendingOrders), 'Đơn chờ xử lý', s.pendingOrders > 0 ? 'Cần xử lý' : 'Sạch'],
        ['⚠️', fmtNum(s.lowStock), 'Sản phẩm sắp hết', 'Dưới 5 key'],
        ['📈', fmtVnd(s.revenueMonth), 'Doanh thu 30 ngày', `Tuần: ${fmtVnd(s.revenueWeek)}`],
      ].map(([ico, v, l, d2]) => `
        <div class="stat-card">
          <div class="ico">${ico}</div>
          <div class="v">${v}</div>
          <div class="l">${l}</div>
          <div class="d">${d2}</div>
        </div>`).join('')}
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
      <div class="panel">
        <div class="panel-title">🏆 Top sản phẩm bán chạy</div>
        ${d.topProducts.length === 0
          ? `<div class="empty-state" style="padding:28px"><div class="t">Chưa có dữ liệu</div></div>`
          : `<div class="bar-chart">
              ${d.topProducts.map((p) => `
                <div class="bar-row">
                  <span style="font-weight:700;font-size:12.5px">${esc(p.name)}</span>
                  <span style="color:var(--text-mute);font-size:12px;font-variant-numeric:tabular-nums">${p.qty} · ${fmtVnd(p.revenue)}</span>
                  <div class="bar-track"><div class="bar-fill" style="width:${Math.round((p.revenue / maxRevenue) * 100)}%"></div></div>
                </div>`).join('')}
            </div>`}
      </div>

      <div class="panel">
        <div class="panel-title">📦 Đơn hàng gần đây</div>
        <div style="display:flex;flex-direction:column;gap:9px">
          ${d.recentOrders.map((o) => `
            <div class="flex justify-between items-center" style="padding:9px 11px;border-radius:10px;background:rgba(255,255,255,.032);border:1px solid var(--border)">
              <div>
                <div class="mono" style="font-size:12.5px;font-weight:700;color:#a99cff">${esc(o.code)}</div>
                <div style="font-size:11.5px;color:var(--text-mute)">${esc(o.email)}</div>
              </div>
              <div style="text-align:right">
                <div style="font-size:13px;font-weight:800">${fmtVnd(o.total)}</div>
                <div style="font-size:11px;color:var(--text-mute)">${esc(o.status)}</div>
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
        <div class="flex justify-between items-center mb-2" style="flex-wrap:wrap;gap:12px">
          <div class="panel-title" style="margin:0">📦 Đơn hàng (${d.orders.length})</div>
          <select class="select" id="order-status-filter">
            <option value="">Tất cả trạng thái</option>
            ${['pending', 'paid', 'delivered', 'cancelled', 'refunded'].map((s) =>
              `<option value="${s}"${statusFilter === s ? ' selected' : ''}>${s}</option>`).join('')}
          </select>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Mã đơn</th><th>Khách hàng</th><th>Tổng tiền</th><th>Trạng thái</th><th>Thời gian</th><th>Thao tác</th></tr></thead>
            <tbody>
              ${d.orders.length === 0
                ? `<tr><td colspan="6" style="text-align:center;padding:32px;color:var(--text-mute)">Không có đơn hàng</td></tr>`
                : d.orders.map((o) => `
                  <tr>
                    <td><span class="mono" style="color:#a99cff;font-weight:700">${esc(o.code)}</span></td>
                    <td><div style="font-size:13px">${esc(o.customer || '—')}</div><div style="font-size:11.5px;color:var(--text-mute)">${esc(o.email)}</div></td>
                    <td><strong>${fmtVnd(o.total)}</strong></td>
                    <td><span class="pill ${o.status === 'delivered' ? 'pill-green' : o.status === 'pending' ? 'pill-yellow' : o.status === 'refunded' ? 'pill-red' : 'pill-blue'}">${esc(o.status)}</span></td>
                    <td style="font-size:12px;color:var(--text-mute)">${fmtDate(o.createdAt)}</td>
                    <td>
                      <div class="flex gap-1">
                        ${o.status === 'paid' ? `<button class="btn btn-ghost btn-sm" data-deliver="${esc(o.id)}">Giao</button>` : ''}
                        ${['paid', 'delivered'].includes(o.status)
                          ? `<button class="btn btn-danger btn-sm" data-refund="${esc(o.id)}">Hoàn</button>`
                          : ''}
                      </div>
                    </td>
                  </tr>`).join('')}
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

/* ---------------- Topups (nạp tiền) ---------------- */
const TOPUP_STATUS = {
  pending: ['pill-yellow', '⏳ Chờ'],
  paid: ['pill-green', '✅ Đã nhận'],
  partial: ['pill-blue', '◐ Một phần'],
  expired: ['pill-gray', '✕ Hết hạn'],
  cancelled: ['pill-red', '⊘ Đã huỷ'],
};

async function renderTopups(host) {
  let filter = 'pending';
  const load = async () => {
    const d = await api('/api/admin/topups' + (filter ? '?status=' + filter : ''));
    const s = d.stats || {};

    host.innerHTML = `
      <div class="stat-grid">
        ${[
          ['📊', fmtNum(s.total || 0), 'Tổng lệnh nạp'],
          ['⏳', fmtNum(s.pending || 0), 'Chờ duyệt'],
          ['✅', fmtNum(s.paid || 0), 'Đã nhận'],
          ['💰', fmtVnd(s.totalAmount || 0), 'Tổng đã nạp'],
        ].map(([ico, v, l]) => `
          <div class="stat-card">
            <div class="ico">${ico}</div>
            <div class="v">${v}</div>
            <div class="l">${l}</div>
          </div>`).join('')}
      </div>

      ${s.pending > 0 ? `
      <div class="alert alert-warn">
        <span class="ico">⚠️</span>
        <span>Có <strong>${s.pending}</strong> lệnh nạp đang chờ.
        Mở app ngân hàng, đối chiếu nội dung <code class="mono">NAPxxxxx</code>,
        rồi bấm <strong>Duyệt</strong>.</span>
      </div>` : ''}

      <div class="panel">
        <div class="flex justify-between items-center mb-2" style="flex-wrap:wrap;gap:10px">
          <div class="panel-title" style="margin:0">💰 Lệnh nạp tiền (${d.topups.length})</div>
          <select class="select" id="tp-filter">
            <option value="">Tất cả</option>
            ${['pending', 'paid', 'partial', 'expired', 'cancelled'].map((k) =>
              `<option value="${k}"${filter === k ? ' selected' : ''}>${TOPUP_STATUS[k][1]}</option>`).join('')}
          </select>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Nội dung CK</th><th>Số tiền</th><th>Khách</th><th>Trạng thái</th><th>Tạo</th><th>Thao tác</th></tr></thead>
            <tbody>
              ${d.topups.length === 0
                ? `<tr><td colspan="6" style="text-align:center;padding:28px;color:var(--text-mute)">Không có lệnh nạp</td></tr>`
                : d.topups.map((t) => {
                  const [cls, label] = TOPUP_STATUS[t.status] || ['pill-gray', t.status];
                  return `<tr>
                    <td>
                      <span class="mono" style="font-weight:800;color:#fbbf24;cursor:pointer"
                        data-copy-memo="${esc(t.memo)}" title="Bấm để copy">${esc(t.memo)}</span>
                    </td>
                    <td><strong>${fmtVnd(t.amount)}</strong></td>
                    <td>
                      <div style="font-size:12.5px">${esc(t.customer || '—')}</div>
                      <div style="font-size:11px;color:var(--text-mute)">${esc(t.email || '')}</div>
                    </td>
                    <td><span class="pill ${cls}">${label}</span></td>
                    <td style="font-size:11.5px;color:var(--text-mute)">${fmtDate(t.createdAt)}</td>
                    <td>
                      <div class="flex gap-1" style="flex-wrap:wrap">
                        ${t.status !== 'paid'
                          ? `<button class="btn btn-primary btn-sm" data-approve="${esc(t.id)}" data-amt="${t.amount}">✓ Duyệt</button>` : ''}
                        ${['pending', 'expired'].includes(t.status)
                          ? `<button class="btn btn-ghost btn-sm" data-reject="${esc(t.id)}">Huỷ</button>` : ''}
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
            <label class="label">Số tiền cộng vào ví (₫)</label>
            <input class="input" id="ap-amt" type="number" value="${b.dataset.amt}">
            <div class="form-hint">Sửa nếu khách chuyển số khác.</div>
          </div>
          <div class="field">
            <label class="label">Ghi chú</label>
            <input class="input" id="ap-note" placeholder="VD: MB 1234 500k luc 18:30">
          </div>
          <div class="flex gap-1" style="justify-content:flex-end">
            <button class="btn btn-ghost" data-cancel>Huỷ</button>
            <button class="btn btn-primary" data-ok>✓ Xác nhận đã nhận tiền</button>
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
      <div class="flex justify-between items-center mb-2" style="flex-wrap:wrap;gap:12px">
        <div class="panel-title" style="margin:0">🛍️ Sản phẩm (${d.products.length})</div>
        <button class="btn btn-primary btn-sm" id="add-product">+ Thêm sản phẩm</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Sản phẩm</th><th>Giá</th><th>Tồn kho</th><th>Đã bán</th><th>Trạng thái</th><th>Thao tác</th></tr></thead>
          <tbody>
            ${d.products.map((p) => `
              <tr>
                <td>
                  <div style="font-size:13px;font-weight:700">${esc(p.name)}</div>
                  <div class="mono" style="font-size:11px;color:var(--text-mute)">${esc(p.slug)}</div>
                </td>
                <td><strong>${fmtVnd(p.price)}</strong>${p.comparePrice ? `<div style="font-size:11px;color:var(--text-mute);text-decoration:line-through">${fmtVnd(p.comparePrice)}</div>` : ''}</td>
                <td><span class="pill ${p.stock > 5 ? 'pill-green' : p.stock > 0 ? 'pill-yellow' : 'pill-red'}">${p.stock}</span></td>
                <td>${fmtNum(p.sold)}</td>
                <td><span class="pill ${p.active ? 'pill-green' : 'pill-gray'}">${p.active ? 'Đang bán' : 'Ẩn'}</span></td>
                <td>
                  <div class="flex gap-1">
                    <button class="btn btn-ghost btn-sm" data-keys="${esc(p.id)}">🔑 Key</button>
                    <button class="btn btn-ghost btn-sm" data-edit="${esc(p.id)}">Sửa</button>
                    <button class="btn btn-danger btn-sm" data-del="${esc(p.id)}">Ẩn</button>
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
    <div class="field"><label class="label">Tên sản phẩm <span class="req">*</span></label>
      <input class="input" id="ed-name" value="${esc(p ? p.name : '')}"></div>
    <div class="field"><label class="label">Danh mục</label>
      <select class="select" id="ed-cat" style="width:100%">${cats}</select></div>
    <div class="field"><label class="label">Mô tả ngắn</label>
      <input class="input" id="ed-short" value="${esc(p ? p.shortDesc || '' : '')}"></div>
    <div class="field"><label class="label">Mô tả chi tiết</label>
      <textarea class="textarea" id="ed-desc">${esc(p ? p.description || '' : '')}</textarea></div>
    <div class="field"><label class="label">URL hình ảnh</label>
      <input class="input" id="ed-img" value="${esc(p ? p.imageUrl || '' : '')}" placeholder="https://..."></div>
    <div class="flex gap-2">
      <div class="field" style="flex:1"><label class="label">Giá bán (₫) <span class="req">*</span></label>
        <input class="input" id="ed-price" type="number" value="${p ? p.price : 0}"></div>
      <div class="field" style="flex:1"><label class="label">Giá gốc (₫)</label>
        <input class="input" id="ed-cprice" type="number" value="${p && p.comparePrice ? p.comparePrice : ''}"></div>
    </div>
    <div class="flex gap-2">
      <div class="field" style="flex:1"><label class="label">Bảo hành (ngày)</label>
        <input class="input" id="ed-warranty" type="number" value="${p ? p.warrantyDays : 0}"></div>
      <div class="field" style="flex:1"><label class="label">Thời hạn</label>
        <input class="input" id="ed-duration" value="${esc(p ? p.durationLabel || '' : '')}" placeholder="1 năm"></div>
    </div>
    <div class="field"><label class="label">Nhãn (HOT/NEW/SALE)</label>
      <input class="input" id="ed-badge" value="${esc(p && p.badge ? p.badge : '')}"></div>
    <div class="field"><label class="label">Tính năng (mỗi dòng 1 mục)</label>
      <textarea class="textarea" id="ed-features">${esc(p && p.features ? p.features.join('\n') : '')}</textarea></div>
    <div class="flex gap-2 mb-3">
      <div class="field" style="flex:1"><label class="label">Kiểu giao hàng</label>
        <select class="select" id="ed-delivery" style="width:100%">
          ${[['key','Key có sẵn (kho)'],['account','Tài khoản (kho)'],['license','License sinh tự động'],['manual','Giao thủ công']]
            .map(([v,t]) => `<option value="${v}"${(p ? p.deliveryType : 'key') === v ? ' selected' : ''}>${t}</option>`).join('')}
        </select></div>
      <div class="field" style="flex:1"><label class="label">Tiền tố license</label>
        <input class="input" id="ed-licprefix" value="${esc(p && p.licensePrefix ? p.licensePrefix : 'AOE1')}" placeholder="AOE1"></div>
      <div class="field" style="flex:1"><label class="label">Số ngày (0=vĩnh viễn)</label>
        <input class="input" id="ed-licdays" type="number" value="${p && p.licenseDays !== undefined ? p.licenseDays : 30}"></div>
    </div>
    <div class="flex gap-2 mb-3">
      <label class="flex items-center gap-1" style="font-size:13px;cursor:pointer">
        <input type="checkbox" id="ed-active" ${!p || p.active ? 'checked' : ''}> Đang bán
      </label>
      <label class="flex items-center gap-1" style="font-size:13px;cursor:pointer">
        <input type="checkbox" id="ed-featured" ${p && p.featured ? 'checked' : ''}> Nổi bật
      </label>
    </div>
    <div class="flex gap-1" style="justify-content:flex-end">
      <button class="btn btn-ghost" data-cancel>Huỷ</button>
      <button class="btn btn-primary" data-save>${isEdit ? 'Lưu' : 'Tạo'}</button>
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
      <div class="panel-title">🔑 Quản lý kho key</div>
      <div class="field">
        <label class="label">Chọn sản phẩm</label>
        <select class="select" id="key-product" style="width:100%">
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
        <span class="ico">📊</span>
        <span>Tổng <strong>${d.keys.length}</strong> key ·
          Còn hàng: <strong class="text-green">${d.keys.filter((k) => k.status === 'available').length}</strong> ·
          Đã bán: <strong>${d.keys.filter((k) => k.status === 'sold').length}</strong></span>
      </div>
      <div class="panel" style="background:rgba(255,255,255,.022)">
        <div class="panel-title" style="font-size:14px">➕ Thêm key hàng loạt</div>
        <textarea class="textarea" id="new-keys" placeholder="Mỗi dòng 1 key...&#10;XXXXX-XXXXX-XXXXX&#10;YYYYY-YYYYY-YYYYY" style="min-height:110px"></textarea>
        <div class="flex gap-1 mt-1">
          <input class="input" id="key-note" placeholder="Ghi chú (loại key, lô...)" style="flex:1">
          <button class="btn btn-primary" id="btn-add-keys">Thêm key</button>
        </div>
      </div>
      <div class="table-wrap mt-2">
        <table>
          <thead><tr><th>Key (đã che)</th><th>Ghi chú</th><th>Trạng thái</th><th>Tạo</th><th></th></tr></thead>
          <tbody>
            ${d.keys.length === 0
              ? `<tr><td colspan="5" style="text-align:center;padding:28px;color:var(--text-mute)">Chưa có key nào</td></tr>`
              : d.keys.map((k) => `
                <tr>
                  <td><span class="mono" style="font-size:12px">${esc(k.masked)}</span></td>
                  <td style="font-size:12px;color:var(--text-mute)">${esc(k.note || '—')}</td>
                  <td><span class="pill ${k.status === 'available' ? 'pill-green' : k.status === 'sold' ? 'pill-blue' : 'pill-gray'}">${esc(k.status)}</span></td>
                  <td style="font-size:11.5px;color:var(--text-mute)">${fmtDate(k.created_at)}</td>
                  <td>${k.status === 'available' ? `<button class="btn btn-danger btn-sm" data-delkey="${esc(k.id)}">Xoá</button>` : ''}</td>
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
    listHost.innerHTML = `<div class="empty-state"><div class="t">${esc(e.message)}</div></div>`;
  }
}

/* ---------------- Licenses ---------------- */
const LIC_STATUS = {
  active: ['pill-green', 'Hoạt động'],
  forever: ['pill-green', 'Vĩnh viễn'],
  expiring: ['pill-yellow', 'Sắp hết'],
  unbound: ['pill-blue', 'Chưa kích hoạt'],
  expired: ['pill-red', 'Hết hạn'],
  revoked: ['pill-red', 'Thu hồi'],
  unknown: ['pill-gray', '?'],
};

async function renderLicenses(host) {
  let q = '';
  const load = async () => {
    const d = await api('/api/admin/licenses' + (q ? '?q=' + encodeURIComponent(q) : ''));
    if (!d.available) {
      host.innerHTML = `<div class="alert alert-warn"><span class="ico">⚠️</span>
        <span>Chưa cấu hình binding <code>LICENSE_DB</code>. Thêm D1 <code>xa_license</code> vào wrangler.toml rồi deploy lại.</span></div>`;
      return;
    }
    const s = d.stats || {};
    host.innerHTML = `
      <div class="stat-grid">
        ${[
          ['🎫', fmtNum(s.total || 0), 'Tổng license'],
          ['✅', fmtNum(s.active || 0), 'Đang hoạt động'],
          ['🔓', fmtNum(s.unbound || 0), 'Chưa kích hoạt'],
          ['♾️', fmtNum(s.forever || 0), 'Vĩnh viễn'],
          ['🚫', fmtNum(s.revoked || 0), 'Đã thu hồi'],
          ['⏳', fmtNum(s.expiring7d || 0), 'Hết hạn 7 ngày'],
        ].map(([ico, v, l]) => `<div class="stat-card"><div class="ico">${ico}</div><div class="v">${v}</div><div class="l">${l}</div></div>`).join('')}
      </div>

      <div class="panel mb-2">
        <div class="panel-title" style="font-size:14px">➕ Tạo license thủ công</div>
        <div class="flex gap-1" style="flex-wrap:wrap;align-items:flex-end">
          <div><label class="label">Số lượng</label><input class="input" id="lc-count" type="number" value="1" style="width:90px"></div>
          <div><label class="label">Số ngày</label><input class="input" id="lc-days" type="number" value="30" style="width:100px"></div>
          <div><label class="label">Tiền tố</label><input class="input" id="lc-prefix" value="AOE1" style="width:100px"></div>
          <div style="flex:1;min-width:160px"><label class="label">Ghi chú</label><input class="input" id="lc-note" placeholder="Tặng khách, bù lỗi..."></div>
          <button class="btn btn-primary" id="lc-create">Tạo</button>
        </div>
        <pre id="lc-out" class="mono" style="margin:12px 0 0;color:#6ee7a0;white-space:pre-wrap;font-size:12.5px"></pre>
      </div>

      <div class="panel">
        <div class="flex justify-between items-center mb-2" style="flex-wrap:wrap;gap:10px">
          <div class="panel-title" style="margin:0">🎫 Danh sách license (${d.licenses.length})</div>
          <div class="search-mini" style="width:240px">
            <span style="color:var(--text-mute)">🔍</span>
            <input id="lc-q" placeholder="Tìm key / ghi chú / HWID" value="${esc(q)}">
          </div>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Key</th><th>Trạng thái</th><th>Hết hạn</th><th>Máy</th><th>Ghi chú</th><th>Thao tác</th></tr></thead>
            <tbody>
              ${d.licenses.length === 0
                ? `<tr><td colspan="6" style="text-align:center;padding:28px;color:var(--text-mute)">Chưa có license</td></tr>`
                : d.licenses.map((l) => {
                  const [cls, label] = LIC_STATUS[l.status] || LIC_STATUS.unknown;
                  return `<tr>
                    <td><span class="mono" style="font-size:12px;color:#a99cff">${esc(l.key)}</span></td>
                    <td><span class="pill ${cls}">${label}</span></td>
                    <td style="font-size:11.5px;color:var(--text-mute)">${l.forever ? 'Vĩnh viễn' : l.expiresAt ? fmtDate(l.expiresAt * 1000) : '—'}</td>
                    <td class="mono" style="font-size:11px;color:var(--text-mute)">${l.bound ? esc(l.hwidMasked) : '—'}</td>
                    <td style="font-size:11.5px;color:var(--text-mute);max-width:180px;overflow:hidden;text-overflow:ellipsis">${esc(l.note || '')}</td>
                    <td>
                      <div class="flex gap-1" style="flex-wrap:wrap">
                        <button class="btn btn-ghost btn-sm" data-act="reset-hwid" data-key="${esc(l.key)}">Reset máy</button>
                        <button class="btn btn-ghost btn-sm" data-act="extend" data-key="${esc(l.key)}">+30d</button>
                        <button class="btn ${l.status === 'revoked' ? 'btn-ghost' : 'btn-danger'} btn-sm" data-act="${l.status === 'revoked' ? 'unrevoke' : 'revoke'}" data-key="${esc(l.key)}">${l.status === 'revoked' ? 'Mở' : 'Thu hồi'}</button>
                      </div>
                    </td>
                  </tr>`;
                }).join('')}
            </tbody>
          </table>
        </div>
      </div>`;

    const qInput = host.querySelector('#lc-q');
    qInput.onkeydown = (e) => { if (e.key === 'Enter') { q = qInput.value.trim(); load(); } };

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

/* ---------------- Users ---------------- */
async function renderUsers(host) {
  const d = await api('/api/admin/users');
  host.innerHTML = `
    <div class="panel">
      <div class="panel-title">👥 Người dùng (${d.users.length})</div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Email</th><th>Họ tên</th><th>Số dư</th><th>Đơn</th><th>Vai trò</th><th>Trạng thái</th><th></th></tr></thead>
          <tbody>
            ${d.users.map((u) => `
              <tr>
                <td style="font-size:12.5px">${esc(u.email)}</td>
                <td style="font-size:13px">${esc(u.fullName || '—')}</td>
                <td><strong class="text-green">${fmtVnd(u.balance)}</strong></td>
                <td>${u.orderCount}</td>
                <td><span class="pill ${u.role === 'admin' ? 'pill-red' : 'pill-gray'}">${esc(u.role)}</span></td>
                <td><span class="pill ${u.status === 'active' ? 'pill-green' : 'pill-red'}">${esc(u.status)}</span></td>
                <td>
                  <button class="btn btn-ghost btn-sm" data-adj="${esc(u.id)}" data-email="${esc(u.email)}">💰</button>
                  <button class="btn btn-ghost btn-sm" data-lock="${esc(u.id)}">${u.status === 'active' ? '🔒' : '🔓'}</button>
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
        <div class="field"><label class="label">Số tiền (âm để trừ)</label>
          <input class="input" id="adj-amount" type="number" placeholder="50000 hoặc -50000"></div>
        <div class="field"><label class="label">Lý do <span class="req">*</span></label>
          <input class="input" id="adj-reason" placeholder="Bồi thường, hoàn tiền..."></div>
        <div class="flex gap-1" style="justify-content:flex-end">
          <button class="btn btn-ghost" data-cancel>Huỷ</button>
          <button class="btn btn-primary" data-ok>Xác nhận</button>
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
      <div class="panel-title">⚙️ Cài đặt hệ thống</div>
      <form id="settings-form">
        <div class="field"><label class="label">Tên ngân hàng</label>
          <input class="input" id="st-bank" value="${esc(s.bank_name || '')}" placeholder="MB Bank"></div>
        <div class="field"><label class="label">Số tài khoản</label>
          <input class="input" id="st-acc" value="${esc(s.bank_account || '')}"></div>
        <div class="field"><label class="label">Chủ tài khoản</label>
          <input class="input" id="st-owner" value="${esc(s.bank_owner || '')}" style="text-transform:uppercase"></div>
        <div class="flex gap-2">
          <div class="field" style="flex:1"><label class="label">Nạp tối thiểu (₫)</label>
            <input class="input" id="st-min" type="number" value="${esc(s.topup_min || '20000')}"></div>
          <div class="field" style="flex:1"><label class="label">Nạp tối đa (₫)</label>
            <input class="input" id="st-max" type="number" value="${esc(s.topup_max || '50000000')}"></div>
        </div>
        <button class="btn btn-primary" type="submit">Lưu cài đặt</button>
      </form>
      <div class="alert alert-info mt-2" style="margin-bottom:0">
        <span class="ico">ℹ️</span>
        <span>Thông tin ngân hàng dùng để tạo mã VietQR cho khách nạp tiền. Cần khớp với tài khoản đã kết nối webhook.</span>
      </div>

      <div style="margin-top:26px;padding-top:26px;border-top:1px solid var(--border)">
        <div class="panel-title" style="margin-bottom:6px">🔗 Kết nối webhook tự động</div>
        <p style="font-size:13px;color:var(--text-mute);line-height:1.7;margin-bottom:16px">
          Dán URL bên dưới vào dashboard dịch vụ để tiền tự vào ví khi khách chuyển khoản.
          Không nối thì phải duyệt tay ở tab <strong>Nạp tiền</strong>.
        </p>

        <div id="wh-status" style="margin-bottom:18px">Đang kiểm tra...</div>

        <div style="padding:16px;border-radius:12px;background:rgba(124,92,255,.06);border:1px solid rgba(124,92,255,.24);margin-bottom:14px">
          <div style="font-size:13.5px;font-weight:800;margin-bottom:8px">SePay / Casso</div>
          <div style="font-size:12.5px;color:var(--text-mute);line-height:1.9">
            URL:
            <code class="mono" id="wh-sepay-url" style="background:rgba(0,0,0,.4);padding:3px 8px;border-radius:6px;cursor:pointer"
              title="Bấm để copy">${esc(location.origin)}/api/webhooks/sepay</code>
          </div>
          <div style="font-size:12.5px;color:var(--text-mute);line-height:1.9">
            Xác thực: <code class="mono">Authorization: Apikey &lt;WEBHOOK_SECRET&gt;</code>
          </div>
        </div>

        <div style="padding:16px;border-radius:12px;background:rgba(34,197,94,.06);border:1px solid rgba(34,197,94,.24)">
          <div style="font-size:13.5px;font-weight:800;margin-bottom:8px">payOS</div>
          <div style="font-size:12.5px;color:var(--text-mute);line-height:1.9;margin-bottom:10px">
            URL:
            <code class="mono" id="wh-payos-url" style="background:rgba(0,0,0,.4);padding:3px 8px;border-radius:6px;cursor:pointer"
              title="Bấm để copy">${esc(location.origin)}/api/webhooks/payos</code>
          </div>
          <div class="field" style="margin-bottom:10px">
            <label class="label">Checksum Key</label>
            <input class="input" id="wh-payos-key" type="password" placeholder="Dán checksum key từ my.payos.vn">
            <div class="form-hint">Lấy ở my.payos.vn → Kênh thanh toán → Checksum Key. Khuyến nghị dùng
              <code class="mono">wrangler secret put PAYOS_CHECKSUM_KEY</code> để bảo mật hơn.</div>
          </div>
          <button class="btn btn-primary btn-sm" id="wh-save-payos">Lưu checksum key</button>
          <button class="btn btn-ghost btn-sm" id="wh-clear-payos" style="margin-left:6px">Xoá</button>
        </div>

        <div style="padding:16px;border-radius:12px;background:rgba(34,211,238,.06);border:1px solid rgba(34,211,238,.24);margin-top:14px">
          <div class="flex items-center gap-1" style="margin-bottom:8px">
            <span style="font-size:13.5px;font-weight:800">📱 Telegram</span>
            <span id="tg-badge"></span>
          </div>
          <p style="font-size:12.5px;color:var(--text-mute);line-height:1.7;margin-bottom:12px">
            Có tiền vào là báo ngay về điện thoại, kèm nút <strong>Duyệt</strong> /
            <strong>Từ chối</strong> — không cần mở web.
          </p>

          <div class="field" style="margin-bottom:10px">
            <label class="label">Bot Token</label>
            <input class="input" id="tg-token" type="password" placeholder="123456789:ABCdefGHI...">
            <div class="form-hint">Tạo bot với <code class="mono">@BotFather</code> trên Telegram → copy token.</div>
          </div>
          <div class="field" style="margin-bottom:10px">
            <label class="label">Chat ID</label>
            <input class="input" id="tg-chat" placeholder="123456789">
            <div class="form-hint">
              Nhắn <code class="mono">/start</code> cho bot, hoặc thêm bot vào nhóm rồi nhắn
              <code class="mono">/id</code> — bot sẽ trả chat ID.
            </div>
          </div>

          <div class="flex gap-1" style="flex-wrap:wrap">
            <button class="btn btn-primary btn-sm" id="tg-save">Lưu</button>
            <button class="btn btn-ghost btn-sm" id="tg-test">📤 Gửi tin thử</button>
            <button class="btn btn-ghost btn-sm" id="tg-clear">Xoá</button>
          </div>

          <div style="margin-top:14px;padding-top:12px;border-top:1px solid rgba(255,255,255,.08)">
            <div style="font-size:12px;color:var(--text-mute);line-height:1.8;margin-bottom:8px">
              <strong>Bắt buộc</strong> — dán URL này vào Telegram để nút bấm hoạt động:
            </div>
            <code class="mono" id="tg-webhook-url" style="display:block;background:rgba(0,0,0,.4);padding:8px 10px;border-radius:6px;font-size:11.5px;word-break:break-all;cursor:pointer"
              title="Bấm để copy">${esc(location.origin)}/api/telegram/webhook</code>
            <div style="font-size:11.5px;color:var(--text-mute);line-height:1.7;margin-top:8px">
              Cần đặt secret trước:
              <code class="mono">wrangler secret put TG_WEBHOOK_SECRET</code><br>
              Rồi gọi:<br>
              <code class="mono" style="font-size:11px;word-break:break-all">curl "https://api.telegram.org/bot&lt;TOKEN&gt;/setWebhook?url=https://xienhl.com/api/telegram/webhook&amp;secret_token=&lt;SECRET&gt;"</code>
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
        ? '<span class="pill pill-green">✅ Đã nối</span>'
        : '<span class="pill pill-yellow">⚠️ Chưa nối</span>';
      host.querySelector('#wh-status').innerHTML = `
        <div class="flex gap-2" style="flex-wrap:wrap">
          <div style="display:flex;align-items:center;gap:8px;font-size:12.5px">
            SePay: ${badge(h.sepay?.configured)}
            ${h.sepay?.source !== 'none' ? `<span style="color:var(--text-mute)">(${esc(h.sepay.source)})</span>` : ''}
          </div>
          <div style="display:flex;align-items:center;gap:8px;font-size:12.5px">
            payOS: ${badge(h.payos?.configured)}
            ${h.payos?.source !== 'none' ? `<span style="color:var(--text-mute)">(${esc(h.payos.source)})</span>` : ''}
          </div>
        </div>`;
    } catch {
      host.querySelector('#wh-status').innerHTML =
        '<span class="pill pill-red">Không kiểm tra được</span>';
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
      const s = await api('/api/admin/telegram/status');
      badge.innerHTML = s.configured
        ? `<span class="pill pill-green">✅ Đã nối</span>${s.source !== 'none' ? ` <span style="color:var(--text-mute);font-size:11.5px">(${esc(s.source)})</span>` : ''}`
        : '<span class="pill pill-yellow">⚠️ Chưa nối</span>';
      if (s.botTokenHint) host.querySelector('#tg-token').placeholder = s.botTokenHint;
      if (s.chatId) host.querySelector('#tg-chat').placeholder = s.chatId;
    } catch {
      badge.innerHTML = '<span class="pill pill-red">Lỗi</span>';
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
      finally { tgTest.disabled = false; tgTest.textContent = '📤 Gửi tin thử'; }
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
      <div class="panel-title">📜 Nhật ký hoạt động (${d.logs.length})</div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Hành động</th><th>Người thực hiện</th><th>Đối tượng</th><th>Thời gian</th></tr></thead>
          <tbody>
            ${d.logs.length === 0
              ? `<tr><td colspan="4" style="text-align:center;padding:28px;color:var(--text-mute)">Chưa có nhật ký</td></tr>`
              : d.logs.map((l) => `
                <tr>
                  <td><span class="mono" style="font-size:12px;color:#a99cff">${esc(l.action)}</span></td>
                  <td style="font-size:12.5px">${esc(l.actor)}</td>
                  <td class="mono" style="font-size:11px;color:var(--text-mute)">${esc(l.target || '—')}</td>
                  <td style="font-size:11.5px;color:var(--text-mute)">${fmtDate(l.createdAt)}</td>
                </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}
