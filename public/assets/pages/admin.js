/**
 * Trang quản trị (admin).
 *
 * Toàn bộ giao diện dùng icon SVG (`icon()`) và class trong style.css. Chỉ
 * còn vài inline style cho giá trị động / độ lớn chữ của SỐ TIỀN (xem
 * AMT_BIG bên dưới) vì `style.css` không thuộc phạm vi sửa của việc này.
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
  ['accounts', 'ticket', 'Quyền tài khoản'],
  ['trial', 'gift', 'Dùng thử'],
  ['whitelist', 'star', 'Vô hạn'],
  ['users', 'users', 'Người dùng'],
  ['settings', 'settings', 'Cài đặt'],
  ['logs', 'log', 'Nhật ký'],
];

/**
 * Nhãn hiển thị cho trạng thái đơn. Giá trị dữ liệu vẫn là khoá tiếng Anh.
 *
 * PHẢI phủ HẾT các trạng thái backend thật sự ghi, nếu không cột trạng thái
 * sẽ in nguyên chuỗi tiếng Anh cho admin đọc (ví dụ "refund_pending_transfer").
 * Backend hiện dùng: pending, expired, processing, paid, delivered, cancelled,
 * refunding, refund_pending_transfer, refund_stuck, refunded.
 */
const ORDER_LABEL = {
  pending: 'Chờ xử lý',
  expired: 'Hết hạn',
  processing: 'Đang giao',
  paid: 'Đã thanh toán',
  delivered: 'Đã giao',
  cancelled: 'Đã huỷ',
  refunding: 'Đang hoàn',
  // Đã quyết định hoàn + đã thu hồi quyền, nhưng CHƯA chuyển tiền cho khách.
  refund_pending_transfer: 'Chờ chuyển tiền hoàn',
  // Cron đẩy sang khi worker chết giữa lúc hoàn — admin phải đối soát tay.
  refund_stuck: 'Hoàn bị kẹt',
  refunded: 'Đã hoàn',
};

/** Trạng thái đơn ĐÃ THANH TOÁN (có thể hoàn tiền). */
const REFUNDABLE = ['paid', 'delivered', 'processing'];

/** Trạng thái cần CHỐT chuyển tiền hoàn (tiền chưa rời tài khoản shop). */
const AWAITING_TRANSFER = ['refund_pending_transfer', 'refunding', 'refund_stuck'];

export function renderAdmin(query) {
  const tab = query.tab || 'dashboard';
  return `
  <div id="site-header"></div>
  <section class="section-sm">
    <div class="container container-wide">
      <div class="page-head">
        <div>
          <h1 class="page-title">Quản trị hệ thống</h1>
          <p class="page-desc">Quản lý đơn hàng, sản phẩm, license và người dùng.</p>
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
    else if (tab === 'accounts') await renderAccounts(host);
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
                        ${REFUNDABLE.includes(o.status)
                          ? `<button type="button" class="btn btn-danger btn-sm" data-refund="${esc(o.id)}">${icon('undo', { size: 13 })} Hoàn</button>`
                          : ''}
                        ${AWAITING_TRANSFER.includes(o.status)
                          ? `<button type="button" class="btn btn-primary btn-sm" data-refund-done="${esc(o.id)}">${icon('bank', { size: 13 })} Đã chuyển tiền</button>`
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
        /*
         * LỜI HỨA PHẢI KHỚP HÀNH VI.
         *
         * Backend giờ TÁCH hai bước: quyết định hoàn (thu hồi quyền) và
         * chuyển tiền thật. Nút này chỉ làm bước MỘT. Nói rõ để admin không
         * tưởng khách đã nhận tiền ngay sau khi bấm.
         */
        const yes = await confirmDialog(
          'Hoàn tiền đơn hàng?',
          'Bước 1: thu hồi quyền/license của đơn này. '
          + 'TIỀN CHƯA được chuyển — sau khi chuyển khoản cho khách, '
          + 'bấm "Đã chuyển tiền" để chốt sổ.',
          'Thu hồi & ghi yêu cầu hoàn',
        );
        if (!yes) return;
        try {
          const r = await api(`/api/admin/orders/${b.dataset.refund}/refund`, {
            method: 'POST',
            body: {
              reason: 'admin_adjust',
              paidOut: false,
            },
          });
          const feats = (r.revoked && r.revoked.features) || [];
          toast(
            `Đã ghi yêu cầu hoàn ${fmtVnd(r.amount)}`
            + (feats.length ? ` · thu hồi: ${feats.join(', ')}` : '')
            + '. Còn bước chuyển tiền.',
            'success',
          );
          load();
        } catch (e) { toast(e.message, 'error'); }
      };
    });

    /*
     * CHỐT "ĐÃ CHUYỂN TIỀN" — bước còn thiếu khiến sổ không đối soát được.
     *
     * Trước đây bấm "Hoàn" là đơn thành 'refunded' ngay, dù tiền chưa hề rời
     * tài khoản shop. Dashboard báo "đã hoàn" trong khi khách chưa nhận được
     * đồng nào, và đơn đã ở 'refunded' thì không còn nút nào để quay lại.
     *
     * Nay phải nhập MÃ GIAO DỊCH NGÂN HÀNG — chứng từ thật — mới chốt được.
     */
    host.querySelectorAll('[data-refund-done]').forEach((b) => {
      b.onclick = async () => {
        const ref = window.prompt(
          'Nhập MÃ GIAO DỊCH chuyển khoản hoàn tiền cho khách\n'
          + '(ví dụ: FT26112... hoặc số bút toán trong app ngân hàng):',
          '',
        );
        if (ref === null) return;
        if (!String(ref).trim()) {
          toast('Cần mã giao dịch thật để chốt sổ hoàn tiền', 'error');
          return;
        }
        try {
          await api(`/api/admin/orders/${b.dataset.refundDone}/refund/complete`, {
            method: 'POST',
            body: { bankRef: String(ref).trim() },
          });
          toast('Đã chốt: tiền hoàn đã chuyển cho khách', 'success');
          load();
        } catch (e) { toast(e.message, 'error'); }
      };
    });
  };
  await load();
}

/*
 * SỐ TIỀN trong hai bảng "Đơn chờ thanh toán" và "Sổ tiền vào" là phần tử
 * TO NHẤT của dòng — chủ shop liếc là thấy tiền, không phải đọc chữ.
 *
 * Dùng inline style (không thêm class vào style.css) vì tệp CSS nằm ngoài
 * phạm vi sửa của việc này; hai hằng dưới đây gom một chỗ để dễ đổi.
 */
const AMT_BASE = 'font-size:19px;font-weight:700;letter-spacing:-.03em;line-height:1.2;'
  + 'font-variant-numeric:tabular-nums';
const AMT_BIG = `${AMT_BASE};color:var(--text)`;
const AMT_BIG_HOT = `${AMT_BASE};color:var(--danger)`;

/* ---------------- Đơn chờ thanh toán ---------------- */
const TOPUP_STATUS = {
  pending: ['pill-yellow', 'Chờ duyệt', 'clock'],
  paid: ['pill-green', 'Đã nhận', 'check'],
  partial: ['pill-blue', 'Một phần', 'progress'],
  expired: ['pill-gray', 'Hết hạn', 'x'],
  cancelled: ['pill-red', 'Đã huỷ', 'ban'],
};

async function renderTopups(host) {
  // Tab "Chờ thanh toán": đơn QR chờ tiền + sổ tiền vào.
  // Thay hệ ví cũ (bảng topups) — nay tiền vào gắn với ĐƠN.
  let stateFilter = '';

  const load = async () => {
    const [payData, orderData] = await Promise.all([
      api('/api/admin/payments' + (stateFilter ? '?state=' + stateFilter : '')),
      api('/api/admin/orders?status=pending'),
    ]);

    const st = payData.stats || {};
    const unmatched = (st.unmatched?.count || 0);
    const wrongAmt = (st.wrong_amount?.count || 0);
    const claimed = (st.claimed?.count || 0);
    const pendingOrders = (orderData.orders || []).length;

    const STATE_LABEL = {
      matched: ['pill-green', 'Khớp đơn', 'check'],
      unmatched: ['pill-red', 'Không khớp', 'alert'],
      wrong_amount: ['pill-yellow', 'Thiếu tiền', 'clock'],
      claimed: ['pill-blue', 'Khách báo đã CK', 'info'],
      duplicate: ['pill-gray', 'Trùng', 'help'],
    };

    host.innerHTML = `
      <div class="stat-grid">
        ${[
          ['clock', fmtNum(pendingOrders), 'Đơn chờ chuyển khoản'],
          ['info', fmtNum(claimed), 'Khách báo đã CK'],
          ['alert', fmtNum(unmatched), 'Tiền chưa gán đơn'],
          ['coins', fmtVnd(st.matched?.total || 0), 'Tổng đã khớp'],
        ].map(([ico, v, l]) => `
          <div class="stat-card">
            <div class="ico">${icon(ico, { size: 16 })}</div>
            <div class="v">${v}</div>
            <div class="l">${l}</div>
          </div>`).join('')}
      </div>

      ${unmatched > 0 ? `
      <div class="alert alert-error">
        <span class="ico">${icon('alert', { size: 15 })}</span>
        <span><strong>${unmatched} giao dịch KHÔNG KHỚP ĐƠN</strong>
        · ${fmtVnd(st.unmatched?.total || 0)} — kiểm tra sao kê, khớp tay.</span>
      </div>` : ''}

      ${wrongAmt > 0 ? `
      <div class="alert alert-warn">
        <span class="ico">${icon('clock', { size: 15 })}</span>
        <span><strong>${wrongAmt} đơn chuyển thiếu</strong>
        · ${fmtVnd(st.wrong_amount?.total || 0)} — khách chuyển bù sẽ tự giao.</span>
      </div>` : ''}

      <div class="panel">
        <div class="adm-panel-head">
          <div class="panel-title">${icon('coins', { size: 15 })} Đơn chờ thanh toán (${pendingOrders})</div>
        </div>
        <div class="table-wrap adm-table-wrap">
          <table class="adm-table">
            <thead><tr>
              <th scope="col">Số tiền</th>
              <th scope="col">Đơn · khách</th>
              <th scope="col"><span class="sr-only">Thao tác</span></th>
            </tr></thead>
            <tbody>
              ${pendingOrders === 0
                ? '<tr><td colspan="3" class="adm-empty">Không có đơn chờ</td></tr>'
                : (orderData.orders || []).map((o) => `
                  <tr>
                    <td><div style="${AMT_BIG}">${fmtVnd(o.total)}</div></td>
                    <td>
                      <div class="mono" style="font-size:13px;color:var(--text-bright)">${esc(o.code)}</div>
                      <div class="adm-cell-sub">${esc(o.customer || '—')} · ${fmtDate(o.createdAt)}</div>
                    </td>
                    <td class="adm-num">
                      <button type="button" class="btn btn-primary btn-sm"
                        data-confirm-pay="${esc(o.id)}" data-code="${esc(o.code)}"
                        data-amt="${esc(o.total)}">${icon('check', { size: 13 })} Đã nhận tiền</button>
                    </td>
                  </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <div class="panel">
        <div class="adm-panel-head">
          <div class="panel-title">${icon('chart', { size: 15 })} Sổ tiền vào (${(payData.payments || []).length})</div>
          <div class="adm-toolbar">
            <label class="sr-only" for="pay-filter">Lọc trạng thái</label>
            <select class="select" id="pay-filter">
              <option value="">Tất cả</option>
              ${['matched', 'unmatched', 'wrong_amount', 'claimed', 'duplicate'].map((k) =>
                `<option value="${k}"${stateFilter === k ? ' selected' : ''}>${STATE_LABEL[k][1]}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="table-wrap adm-table-wrap">
          <table class="adm-table">
            <thead><tr>
              <th scope="col">Số tiền</th>
              <th scope="col">Trạng thái</th>
              <th scope="col">Đơn · nội dung CK</th>
            </tr></thead>
            <tbody>
              ${(payData.payments || []).length === 0
                ? '<tr><td colspan="3" class="adm-empty">Chưa có giao dịch</td></tr>'
                : (payData.payments || []).map((p) => {
                  const [cls, label, icoName] = STATE_LABEL[p.state] || ['pill-gray', p.state, 'help'];
                  const hot = p.state === 'unmatched';
                  const short = p.expected && Number(p.expected) !== Number(p.amount);
                  return `<tr${hot ? ' style="background:var(--danger-dim)"' : ''}>
                    <td>
                      <div style="${hot ? AMT_BIG_HOT : AMT_BIG}">${fmtVnd(p.amount)}</div>
                      ${short ? `<div class="adm-cell-sub">cần ${fmtVnd(p.expected)}</div>` : ''}
                    </td>
                    <td><span class="pill ${cls}">${icon(icoName, { size: 11 })} ${esc(label)}</span></td>
                    <td>
                      <div class="mono adm-cell-sub">${p.orderCode
                        ? esc(p.orderCode)
                        : '<span style="color:var(--danger);font-weight:600">Không gán đơn</span>'}</div>
                      <div class="adm-cell-sub">${esc((p.content || '').slice(0, 40))}${
                        p.at ? ' · ' + fmtDate(p.at * 1000) : ''}</div>
                    </td>
                  </tr>`;
                }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;

    const sel = host.querySelector('#pay-filter');
    if (sel) {
      sel.onchange = () => { stateFilter = sel.value; load(); };
    }

    host.querySelectorAll('[data-confirm-pay]').forEach((b) => {
      b.onclick = async () => {
        const code = b.dataset.code;
        const amt = Number(b.dataset.amt) || 0;
        /*
         * confirmDialog(title, message, confirmLabel) — nhận 3 THAM SỐ CHUỖI.
         * Trước đây chỗ này truyền một OBJECT -> esc(object) ra "[object Object]"
         * và message rỗng, nên hộp thoại xác nhận giao key cho khách hiện
         * tiêu đề vô nghĩa, không có nội dung cảnh báo, và nút ghi "Xác nhận"
         * thay vì "Đã nhận tiền — giao key". Đây là thao tác không hoàn tác
         * được (giao hàng thật), nên cảnh báo phải đọc được.
         */
        if (!(await confirmDialog(
          'Xác nhận đã nhận tiền',
          `Đơn ${code} — ${fmtVnd(amt)}.\n\n`
            + 'Chỉ bấm khi bạn ĐÃ THẤY tiền trong app ngân hàng. '
            + 'Hệ thống sẽ giao key ngay cho khách.',
          'Đã nhận tiền — giao key',
        ))) return;

        b.disabled = true;
        try {
          const r = await api(`/api/admin/orders/${b.dataset.confirmPay}/confirm-payment`, {
            method: 'POST', body: {},
          });
          toast(r.delivered ? 'Đã xác nhận và giao key' : 'Đã xác nhận (chờ giao tay)',
            'success');
          load();
        } catch (e) {
          toast(e.message, 'error', 6000);
          b.disabled = false;
        }
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
          ${[['license', 'License sinh tự động'], ['manual', 'Giao thủ công']]
            .map(([v, t]) => `<option value="${v}"${(p ? p.deliveryType : 'license') === v ? ' selected' : ''}>${t}</option>`).join('')}
        </select></div>
      <div class="field"><label class="label" for="ed-licprefix">Tiền tố license</label>
        <input class="input" id="ed-licprefix" value="${esc(p && p.licensePrefix ? p.licensePrefix : 'AOE1')}" placeholder="AOE1"></div>
      <div class="field"><label class="label" for="ed-licdays">Số ngày (bắt buộc &ge; 1)</label>
        <input class="input" id="ed-licdays" type="number" min="1" step="1"
          value="${p && p.licenseDays !== undefined && p.licenseDays !== null ? p.licenseDays : 30}">
        <span class="hint">Bỏ trống là LỖI. Muốn bán vĩnh viễn thì nhập đúng số <b>0</b>.</span></div>
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
          /*
           * KHÔNG dùng `Number(...) || 0`: ô trống sẽ thành 0 và 0 = VĨNH VIỄN,
           * khiến một sản phẩm 30 ngày bị bán thành vĩnh viễn. Ô trống -> gửi
           * `undefined` để server trả lỗi rõ ràng (hoặc giữ nguyên giá trị cũ
           * khi đang sửa sản phẩm).
           */
          licenseDays: overlay.querySelector('#ed-licdays').value.trim() === ''
            ? undefined
            : Number(overlay.querySelector('#ed-licdays').value),
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


/* ---------------- QUYỀN THEO TÀI KHOẢN ---------------- */

/*
 * THAY THẾ HOÀN TOÀN TAB "LICENSE" CŨ.
 *
 * Tab cũ thao tác trên bảng `licenses` (mô hình key). Nhưng từ khi bỏ key,
 * app đọc quyền từ `account_entitlements` — nên license tạo ở tab cũ
 * KHÔNG có tác dụng gì với khách.
 *
 * Tab này làm đúng việc admin cần:
 *   - Xem tài khoản nào đang có quyền gì, hạn bao lâu
 *   - Cấp / gia hạn tay (bù lỗi, tặng khách)
 *   - Thu hồi quyền
 *   - Cấp lại lượt dùng thử 1 ngày
 */

/** Nhãn trạng thái quyền của một tính năng. */
function entStatus(e) {
  if (!e || !e.active) {
    if (e && e.expires_at > 0) return ['pill-red', 'Hết hạn'];
    return ['pill-gray', 'Chưa có'];
  }
  if (e.forever) return ['pill-green', 'Vĩnh viễn'];
  if (e.daysLeft <= 3) return ['pill-yellow', `Còn ${e.daysLeft} ngày`];
  return ['pill-green', `Còn ${e.daysLeft} ngày`];
}

/** Nguồn quyền -> nhãn dễ hiểu. */
const ENT_SOURCE = {
  purchase: 'Mua',
  trial: 'Dùng thử',
  admin: 'Admin cấp',
  grant: 'Tặng',
};

async function renderAccounts(host) {
  let q = '';
  let filter = 'all';

  const load = async () => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (filter && filter !== 'all') params.set('filter', filter);
    const qs = params.toString();
    const d = await api('/api/admin/accounts' + (qs ? '?' + qs : ''));
    const s = d.stats || {};

    host.innerHTML = `
      <div class="stat-grid">
        ${[
          ['users', fmtNum(s.total || 0), 'Tài khoản'],
          ['check', fmtNum(s.active || 0), 'Đang có quyền'],
          ['gift', fmtNum(s.trial || 0), 'Đang dùng thử'],
          ['layers', fmtNum(s.nofog || 0), 'Có map sáng'],
          ['coins', fmtNum(s.grant || 0), 'Có tài nguyên'],
        ].map(([ico, v, l]) => `
          <div class="stat-card">
            <div class="ico">${icon(ico, { size: 16 })}</div>
            <div class="v">${v}</div>
            <div class="l">${l}</div>
          </div>`).join('')}
      </div>

      <div class="panel mb-2">
        <div class="panel-title">${icon('plus', { size: 14 })} Cấp quyền thủ công</div>
        <p class="page-desc">Dùng khi khách khiếu nại, cần bù lỗi hoặc tặng gói.
          Nhập <strong>tên đăng nhập</strong> của khách.</p>
        <div class="adm-form-row">
          <div class="field adm-field-grow">
            <label class="label" for="ac-user">Tên đăng nhập</label>
            <input class="input" id="ac-user" placeholder="vd: khachhang01">
          </div>
          <div class="field adm-field-narrow">
            <label class="label" for="ac-feature">Tính năng</label>
            <select class="select" id="ac-feature">
              <option value="both">Cả hai</option>
              <option value="nofog">Map sáng</option>
              <option value="grant">Tài nguyên</option>
            </select>
          </div>
          <div class="field adm-field-narrow">
            <label class="label" for="ac-days">Số ngày</label>
            <input class="input" id="ac-days" type="number" value="30" min="0">
          </div>
          <div class="field adm-field-action">
            <button type="button" class="btn btn-primary" id="ac-grant">Cấp</button>
          </div>
        </div>
        <p class="note text-dim">Số ngày <code class="mono">0</code> = vĩnh viễn.
          Nếu khách còn hạn thì cộng dồn.</p>
      </div>

      <div class="panel">
        <div class="adm-panel-head">
          <div class="panel-title">${icon('ticket', { size: 15 })} Quyền tài khoản (${(d.accounts || []).length})</div>
          <div class="adm-toolbar">
            <label class="sr-only" for="ac-q">Tìm tài khoản</label>
            <input class="input adm-input-search" id="ac-q" placeholder="Tìm tên đăng nhập..."
              value="${esc(q)}">
            <select class="select adm-select-sm" id="ac-filter" aria-label="Lọc">
              ${[['all', 'Tất cả'], ['active', 'Đang có quyền'],
                 ['trial', 'Đang dùng thử'], ['expired', 'Đã hết hạn']]
                .map(([v, t]) => `<option value="${v}"${filter === v ? ' selected' : ''}>${t}</option>`)
                .join('')}
            </select>
            <button type="button" class="btn btn-ghost btn-sm" id="ac-reload"
              aria-label="Tải lại" title="Tải lại">${icon('refresh', { size: 14 })}</button>
          </div>
        </div>

        ${(d.accounts || []).length === 0 ? `
          <div class="empty-state adm-empty-sm">
            <div class="ico">${icon('inbox', { size: 26 })}</div>
            <div class="t">Không có tài khoản nào</div>
          </div>` : `
        <div class="table-wrap adm-table-wrap">
          <table class="adm-table">
            <thead>
              <tr>
                <th scope="col">Tài khoản</th>
                <th scope="col">Map sáng</th>
                <th scope="col">Tài nguyên</th>
                <th scope="col">Dùng thử</th>
                <th scope="col">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              ${(d.accounts || []).map((a) => {
                const [nCls, nTxt] = entStatus(a.nofog);
                const [gCls, gTxt] = entStatus(a.grant);
                let trialCell = '<span class="pill pill-gray">Chưa dùng</span>';
                if (a.trial) {
                  if (a.trial.state === 'active') {
                    const h = Math.floor(a.trial.leftSec / 3600);
                    const m = Math.floor((a.trial.leftSec % 3600) / 60);
                    trialCell = `<span class="pill pill-blue">Còn ${h}h${m}m</span>`;
                  } else {
                    trialCell = `<span class="pill pill-gray">Đã hết</span>`;
                  }
                }
                return `
                <tr>
                  <td>
                    <div class="adm-cell-main mono">${esc(a.username || a.id.slice(0, 8))}</div>
                    ${a.status !== 'active' ? `<span class="pill pill-red">${esc(a.status)}</span>` : ''}
                  </td>
                  <td>
                    <span class="pill ${nCls}">${nTxt}</span>
                    ${a.nofog.source ? `<div class="adm-cell-sub">${esc(ENT_SOURCE[a.nofog.source] || a.nofog.source)}</div>` : ''}
                  </td>
                  <td>
                    <span class="pill ${gCls}">${gTxt}</span>
                    ${a.grant.source ? `<div class="adm-cell-sub">${esc(ENT_SOURCE[a.grant.source] || a.grant.source)}</div>` : ''}
                  </td>
                  <td>${trialCell}</td>
                  <td>
                    <div class="adm-actions">
                      <button type="button" class="btn btn-ghost btn-sm"
                        data-grant="${esc(a.id)}" data-name="${esc(a.username || '')}"
                        title="Cấp / gia hạn">${icon('plus', { size: 13 })} Cấp</button>
                      ${(a.nofog.active || a.grant.active) ? `
                      <button type="button" class="btn btn-danger btn-sm"
                        data-revoke="${esc(a.id)}" data-name="${esc(a.username || '')}"
                        title="Thu hồi quyền">${icon('ban', { size: 13 })} Thu hồi</button>` : ''}
                    </div>
                  </td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>`}
      </div>`;

    // ---- Tìm / lọc ----
    const qEl = host.querySelector('#ac-q');
    if (qEl) {
      let t;
      qEl.oninput = () => {
        clearTimeout(t);
        t = setTimeout(() => { q = qEl.value.trim(); load(); }, 350);
      };
    }
    const fEl = host.querySelector('#ac-filter');
    if (fEl) fEl.onchange = () => { filter = fEl.value; load(); };
    const rEl = host.querySelector('#ac-reload');
    if (rEl) rEl.onclick = () => load();

    // ---- Cấp tay ----
    const btn = host.querySelector('#ac-grant');
    if (btn) {
      btn.onclick = async () => {
        const u = host.querySelector('#ac-user').value.trim();
        const feature = host.querySelector('#ac-feature').value;
        const days = Number(host.querySelector('#ac-days').value);
        if (!u) { toast('Nhập tên đăng nhập', 'error'); return; }
        if (!Number.isFinite(days) || days < 0) { toast('Số ngày không hợp lệ', 'error'); return; }

        // Tìm id từ danh sách đã tải; nếu không có thì hỏi server
        let target = (d.accounts || []).find((x) => (x.username || '').toLowerCase() === u.toLowerCase());
        if (!target) {
          try {
            const found = await api('/api/admin/accounts?q=' + encodeURIComponent(u));
            target = (found.accounts || []).find((x) => (x.username || '').toLowerCase() === u.toLowerCase());
          } catch { /* bỏ qua */ }
        }
        if (!target) { toast('Không tìm thấy tài khoản: ' + u, 'error'); return; }

        try {
          const r = await api('/api/admin/accounts/' + encodeURIComponent(target.id) + '/grant', {
            method: 'POST', body: { feature, days, note: 'Cấp tay từ trang quản trị' },
          });
          const txt = (r.granted || []).map((g) => g.forever
            ? `${g.feature}: vĩnh viễn`
            : `${g.feature}: đến ${fmtDate(g.expires_at * 1000)}`).join(' · ');
          toast('Đã cấp — ' + txt, 'success', 6000);
          host.querySelector('#ac-user').value = '';
          load();
        } catch (e) { toast(e.message, 'error'); }
      };
    }

    // ---- Cấp theo dòng ----
    host.querySelectorAll('[data-grant]').forEach((b) => {
      b.onclick = async () => {
        const days = Number(prompt(`Cấp bao nhiêu ngày cho "${b.dataset.name}"?\n(0 = vĩnh viễn)`, '30'));
        if (!Number.isFinite(days) || days < 0) return;
        const feature = prompt('Tính năng: both / nofog / grant', 'both');
        if (!['both', 'nofog', 'grant'].includes(feature)) return;
        try {
          const r = await api('/api/admin/accounts/' + encodeURIComponent(b.dataset.grant) + '/grant', {
            method: 'POST', body: { feature, days },
          });
          const txt = (r.granted || []).map((g) => g.forever
            ? `${g.feature}: vĩnh viễn`
            : `${g.feature}: đến ${fmtDate(g.expires_at * 1000)}`).join(' · ');
          toast('Đã cấp — ' + txt, 'success', 6000);
          load();
        } catch (e) { toast(e.message, 'error'); }
      };
    });

    // ---- Thu hồi ----
    host.querySelectorAll('[data-revoke]').forEach((b) => {
      b.onclick = async () => {
        if (!await confirmDialog(
          `Thu hồi toàn bộ quyền của "${b.dataset.name}"?`,
          'Khách sẽ mất quyền dùng ngay lần mở app kế tiếp.',
          'Thu hồi')) return;
        try {
          await api('/api/admin/accounts/' + encodeURIComponent(b.dataset.revoke) + '/revoke', {
            method: 'POST', body: { feature: 'both' },
          });
          toast('Đã thu hồi', 'success');
          load();
        } catch (e) { toast(e.message, 'error'); }
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
          <label class="label" for="wl-scope">Loại</label>
          <select class="select" id="wl-scope">
            <option value="weak">Weak HWID (máy — ổn định nhất)</option>
            <option value="hwid">HWID đầy đủ</option>
            <option value="device">Device ID (browser)</option>
            <option value="user">Tài khoản (username hoặc ID)</option>
            <option value="ip">Địa chỉ IP</option>
          </select>
        </div>

        <div class="field">
          <label class="label" for="wl-value">Giá trị</label>
          <input class="input mono" id="wl-value" placeholder="Dán giá trị vào đây"
                 aria-describedby="wl-hint">
          <div class="form-hint" id="wl-hint">
            Chạy <code>xa_arena.exe --status</code> để xem HWID máy.
          </div>
        </div>

        <div class="field">
          <label class="label" for="wl-note">Ghi chú</label>
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
                : 'Chạy <code>xa_arena.exe --status</code> để xem HWID máy';
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

/*
 * Dùng thử — MỖI TÀI KHOẢN 1 NGÀY, CẢ MAP SÁNG + TÀI NGUYÊN.
 *
 * Tab cũ hiển thị mô hình đã chết: 1 giờ / 3 ngày / 10 lượt mỗi loại. Số liệu
 * đó đọc từ bảng `trial_quota`, nay không còn dùng.
 *
 * Mô hình hiện hành (chủ shop chốt):
 *   - Tài khoản mới: dùng thử ĐÚNG 1 NGÀY
 *   - Trong 1 ngày đó bật CẢ map sáng và tài nguyên
 *   - Đồng hồ chạy từ lần đầu MỞ APP, không phải lúc đăng ký
 *   - Mỗi tài khoản 1 lần duy nhất; tối đa 3 tài khoản / máy
 *
 * Nguồn dữ liệu: /api/admin/trial/account-trials (bảng `trial_accounts`).
 */
async function renderTrial(host) {
  let filter = '';

  const load = async () => {
    const d = await api('/api/admin/trial/account-trials' +
      (filter ? '?q=' + encodeURIComponent(filter) : ''));
    const trials = d.trials || [];
    const now = Number(d.now || Math.floor(Date.now() / 1000));

    const active = trials.filter((t) => t.state === 'active');
    const ended = trials.filter((t) => t.state === 'ended');
    const usedToday = trials.filter((t) => (now - t.startedAt) < 86400).length;

    host.innerHTML = `
      <div class="stat-grid">
        ${[
          ['gift', fmtNum(trials.length), 'Tổng lượt dùng thử'],
          ['check', fmtNum(active.length), 'Đang dùng thử'],
          ['clock', fmtNum(usedToday), 'Bắt đầu 24h qua'],
          ['ban', fmtNum(ended.length), 'Đã kết thúc'],
        ].map(([ico, v, l]) => `
          <div class="stat-card">
            <div class="ico">${icon(ico, { size: 16 })}</div>
            <div class="v">${v}</div>
            <div class="l">${l}</div>
          </div>`).join('')}
      </div>

      <div class="alert alert-info mb-2">
        <span class="ico">${icon('info', { size: 15 })}</span>
        <span>Mỗi tài khoản mới được dùng thử <strong>1 NGÀY</strong>,
          bật cả <strong>map sáng</strong> và <strong>tài nguyên</strong>.
          Đồng hồ chạy từ lần đầu mở app. Tối đa 3 tài khoản / máy.</span>
      </div>

      <div class="panel">
        <div class="adm-panel-head">
          <div class="panel-title">${icon('gift', { size: 15 })} Lượt dùng thử (${trials.length})</div>
          <div class="adm-toolbar">
            <label class="sr-only" for="tq-search">Tìm tài khoản</label>
            <input class="input adm-input-search" id="tq-search" placeholder="Tìm tài khoản..."
              value="${esc(filter)}">
            <button type="button" class="btn btn-ghost btn-sm" id="tq-reload"
              aria-label="Tải lại" title="Tải lại">${icon('refresh', { size: 14 })}</button>
          </div>
        </div>

        ${trials.length === 0 ? `
          <div class="empty-state adm-empty-sm">
            <div class="ico">${icon('inbox', { size: 26 })}</div>
            <div class="t">Chưa có ai dùng thử</div>
          </div>` : `
        <div class="table-wrap adm-table-wrap">
          <table class="adm-table">
            <thead>
              <tr>
                <th scope="col">Tài khoản</th>
                <th scope="col">Trạng thái</th>
                <th scope="col">Bắt đầu</th>
                <th scope="col">Còn lại</th>
                <th scope="col">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              ${trials.map((t) => {
                const isActive = t.state === 'active';
                const leftH = Math.floor((t.leftSec || 0) / 3600);
                const leftM = Math.floor(((t.leftSec || 0) % 3600) / 60);
                const stPill = isActive
                  ? '<span class="pill pill-green">Đang dùng</span>'
                  : `<span class="pill pill-gray">${esc(
                      t.endReason === 'expired' ? 'Hết hạn'
                      : t.endReason === 'reset' ? 'Đã đặt lại'
                      : 'Đã kết thúc')}</span>`;
                return `
                <tr>
                  <td class="adm-cell-main mono">${esc(t.username || t.userId.slice(0, 8))}</td>
                  <td>${stPill}</td>
                  <td class="adm-cell-sub">${t.startedAt ? fmtDate(t.startedAt * 1000) : '—'}</td>
                  <td>${isActive
                    ? `<span class="pill pill-blue">${leftH}h${leftM}m</span>`
                    : '<span class="text-dim">—</span>'}</td>
                  <td>
                    <button type="button" class="btn btn-ghost btn-sm"
                      data-reset="${esc(t.userId)}" data-name="${esc(t.username || '')}"
                      title="Cấp lại 1 ngày">${icon('refresh', { size: 13 })} Cấp lại</button>
                  </td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>`}
      </div>`;

    // ---- Tìm ----
    const qEl = host.querySelector('#tq-search');
    if (qEl) {
      let t;
      qEl.oninput = () => {
        clearTimeout(t);
        t = setTimeout(() => { filter = qEl.value.trim(); load(); }, 350);
      };
    }
    const rEl = host.querySelector('#tq-reload');
    if (rEl) rEl.onclick = () => load();

    // ---- Cấp lại 1 ngày ----
    host.querySelectorAll('[data-reset]').forEach((b) => {
      b.onclick = async () => {
        if (!await confirmDialog(
          `Cấp lại 1 ngày dùng thử cho "${b.dataset.name}"?`,
          'Đồng hồ sẽ tính lại từ bây giờ. Dùng khi khách khiếu nại hợp lệ.',
          'Cấp lại')) return;
        try {
          const r = await api('/api/admin/trial/account-reset', {
            method: 'POST',
            body: { userId: b.dataset.reset, days: 1 },
          });
          toast(`Đã cấp lại ${r.days} ngày`, 'success');
          load();
        } catch (e) { toast(e.message, 'error'); }
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
            <th scope="col">Tên đăng nhập</th>
            <th scope="col">Họ tên</th>
            <th scope="col" class="adm-num">Đơn</th>
            <th scope="col">Vai trò</th>
            <th scope="col">Trạng thái</th>
            <th scope="col">Thao tác</th>
          </tr></thead>
          <tbody>
            ${d.users.length === 0
              ? `<tr><td colspan="6" class="adm-empty">Chưa có người dùng</td></tr>`
              : d.users.map((u) => `
              <tr>
                <td class="adm-cell-main mono">${esc(u.username || '—')}</td>
                <td class="adm-cell-strong">${esc(u.fullName || '—')}</td>
                <td class="adm-num">${u.orderCount}</td>
                <td><span class="pill ${u.role === 'admin' ? 'pill-red' : 'pill-gray'}">${esc(u.role)}</span></td>
                <td><span class="pill ${u.status === 'active' ? 'pill-green' : 'pill-red'}">${esc(u.status)}</span></td>
                <td>
                  <div class="adm-actions">
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
          <div class="field"><label class="label" for="st-min">Đơn hàng tối thiểu (₫)</label>
            <input class="input" id="st-min" type="number" value="${esc(s.topup_min || '20000')}"></div>
          <div class="field"><label class="label" for="st-max">Đơn hàng tối đa (₫)</label>
            <input class="input" id="st-max" type="number" value="${esc(s.topup_max || '50000000')}"></div>
        </div>
        <div class="panel-title" style="margin-top:26px;font-size:14px">Cửa sổ giờ tự động xác nhận</div>
      <p style="font-size:12.5px;color:var(--text-mute);margin:-4px 0 14px">
        Trong khung giờ này hệ thống tự giao key khi tiền vào. Ngoài khung giờ,
        tiền vẫn được ghi sổ và báo Telegram — admin duyệt tay ở tab Chờ thanh toán.
      </p>
      <div class="grid-3">
        <div class="field">
          <label class="label" for="st-auto-en">Chế độ</label>
          <select class="select" id="st-auto-en">
            <option value="1"${String(s.sepay_auto_enabled ?? '1') === '1' ? ' selected' : ''}>Bật — theo khung giờ</option>
            <option value="0"${String(s.sepay_auto_enabled) === '0' ? ' selected' : ''}>Tắt — duyệt tay 24/24</option>
          </select>
        </div>
        <div class="field">
          <label class="label" for="st-auto-from">Từ giờ (0–23)</label>
          <input class="input" id="st-auto-from" type="number" min="0" max="23"
            value="${esc(s.sepay_auto_from ?? 0)}">
        </div>
        <div class="field">
          <label class="label" for="st-auto-to">Đến giờ (0–23)</label>
          <input class="input" id="st-auto-to" type="number" min="0" max="23"
            value="${esc(s.sepay_auto_to ?? 12)}">
        </div>
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
          Dán URL bên dưới vào dashboard dịch vụ để đơn tự xác nhận khi khách chuyển khoản.
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

          <div class="field">
            <label class="label" for="tg-groups">Group nhận thông báo (không bắt buộc)</label>
            <input class="input" id="tg-groups"
              placeholder="-1001234567890 hoặc -1001234567890,-1009876543210">
            <div class="form-hint">
              Thêm bot vào group, gửi <code class="mono">/id</code> trong group để lấy ID
              (thường bắt đầu bằng <code class="mono">-100</code>). Nhiều group thì cách nhau dấu phẩy.
              <br>
              <strong>Group chỉ nhận thông báo</strong> — thành viên group
              <strong>KHÔNG bấm duyệt được</strong>; chỉ Chat ID ở trên mới duyệt được.
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
          sepay_auto_enabled: host.querySelector('#st-auto-en').value,
          sepay_auto_from: Number(host.querySelector('#st-auto-from').value),
          sepay_auto_to: Number(host.querySelector('#st-auto-to').value),
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
      const groupsEl = host.querySelector('#tg-groups');
      const notifyChatIds = groupsEl ? groupsEl.value.trim() : '';
      if (!botToken && !chatId && !notifyChatIds) {
        toast('Nhập ít nhất một trường', 'error');
        return;
      }
      tgSave.disabled = true;
      try {
        await api('/api/admin/telegram/config', {
          method: 'POST',
          body: { botToken, chatId, notifyChatIds },
        });
        toast(notifyChatIds
          ? 'Đã lưu. Thông báo sẽ gửi tới chat riêng VÀ group — chỉ bạn bấm duyệt được.'
          : 'Đã lưu cấu hình Telegram', 'success', 6000);
        host.querySelector('#tg-token').value = '';
        host.querySelector('#tg-chat').value = '';
        if (groupsEl) groupsEl.value = '';
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
