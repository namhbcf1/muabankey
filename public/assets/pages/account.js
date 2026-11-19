/** Trang tài khoản người dùng. */
import { api, esc, fmtVnd, fmtNum, toast, navigate, loadingBlock } from '../lib.js';
import { icon } from '../icons.js';
import { state, notify, loadUser } from '../state.js';

export function renderAccount() {
  return `
  <div id="site-header"></div>
  <section class="section-sm">
    <div class="container">
      <nav class="pd-breadcrumb" aria-label="Đường dẫn">
        <a href="#/">Trang chủ</a><span>/</span><span>Tài khoản</span>
      </nav>
      <div class="page-head">
        <div>
          <h1 class="page-title">Tài khoản</h1>
          <p class="page-desc">Thông tin cá nhân, mật khẩu và lịch sử mua hàng của bạn.</p>
        </div>
      </div>
      <div id="account-content">${loadingBlock()}</div>
    </div>
  </section>
  <div id="site-footer"></div>`;
}

export async function mountAccount(root) {
  const host = root.querySelector('#account-content');
  if (!state.user) { navigate('/login?redirect=/account', { replace: true }); return; }

  let me;
  try {
    me = await api('/api/auth/me');
    state.user = me.user;
    notify();
  } catch (e) {
    toast(e.message, 'error');
    navigate('/login', { replace: true });
    return;
  }

  const u = me.user;
  const s = me.stats;
  const initial = esc((u.fullName || u.email || '?')[0].toUpperCase());

  // Huy hiệu vai trò chỉ là phần trình bày; quyền truy cập vẫn do server quyết định.
  const role = u.role === 'admin'
    ? { tone: 'pill-red', ico: 'shieldCheck', label: 'Quản trị viên' }
    : u.role === 'staff'
      ? { tone: 'pill-blue', ico: 'shield', label: 'Nhân viên' }
      : { tone: 'pill-gray', ico: 'user', label: 'Thành viên' };

  host.innerHTML = `
    <div class="checkout-grid">
      <div>
        <div class="panel">
          <div class="identity">
            <div class="avatar" aria-hidden="true">${initial}</div>
            <div class="identity-main">
              <div class="identity-name">${esc(u.fullName || 'Khách hàng')}</div>
              <div class="identity-mail">${esc(u.email)}</div>
              <div class="pill-row mt-1">
                <span class="pill ${role.tone}">${icon(role.ico, { size: 11 })} ${role.label}</span>
              </div>
            </div>
          </div>

          <div class="metric-row">
            <div class="metric">
              <div class="metric-val">${fmtNum(s.orders)}</div>
              <div class="metric-lbl">Đơn hàng</div>
            </div>
            <div class="metric">
              <div class="metric-val">${fmtVnd(s.spent)}</div>
              <div class="metric-lbl">Tổng chi tiêu</div>
            </div>
          </div>
        </div>

        <div class="panel mt-2">
          <h2 class="panel-title">${icon('user', { size: 15 })} Thông tin cá nhân</h2>
          <form id="profile-form">
            <div class="field">
              <label class="label" for="pf-name">Họ và tên <span class="req">*</span></label>
              <input class="input" id="pf-name" name="fullName" autocomplete="name"
                value="${esc(u.fullName || '')}" required>
            </div>
            <div class="field">
              <label class="label" for="pf-phone">Số điện thoại</label>
              <input class="input" id="pf-phone" name="phone" type="tel" autocomplete="tel"
                value="${esc(u.phone || '')}" placeholder="0912345678"
                aria-describedby="pf-phone-hint">
              <span class="form-hint" id="pf-phone-hint">Dùng để liên hệ khi cần hỗ trợ đơn hàng.</span>
            </div>
            <div class="field">
              <label class="label" for="pf-email">Email</label>
              <input class="input" id="pf-email" type="email" value="${esc(u.email)}" disabled
                aria-describedby="pf-email-hint">
              <span class="form-hint" id="pf-email-hint">Email đăng nhập không thể thay đổi.</span>
            </div>
            <button class="btn btn-primary" type="submit">${icon('check', { size: 14 })} Lưu thay đổi</button>
          </form>
        </div>

        <div class="panel mt-2">
          <h2 class="panel-title">${icon('lock', { size: 15 })} Đổi mật khẩu</h2>
          <form id="pwd-form">
            <div class="field">
              <label class="label" for="pw-cur">Mật khẩu hiện tại</label>
              <input class="input" id="pw-cur" type="password" autocomplete="current-password" required>
            </div>
            <div class="field">
              <label class="label" for="pw-new">Mật khẩu mới</label>
              <input class="input" id="pw-new" type="password" autocomplete="new-password"
                placeholder="Tối thiểu 8 ký tự" aria-describedby="pw-new-hint" required>
              <span class="form-hint" id="pw-new-hint">Tối thiểu 8 ký tự, nên có cả chữ và số.</span>
            </div>
            <div class="field">
              <label class="label" for="pw-confirm">Xác nhận mật khẩu mới</label>
              <input class="input" id="pw-confirm" type="password" autocomplete="new-password" required>
            </div>
            <button class="btn btn-primary" type="submit">${icon('shield', { size: 14 })} Đổi mật khẩu</button>
          </form>
        </div>
      </div>

      <div>
        <div class="panel" style="margin-bottom:12px">
          <h2 class="panel-title">${icon('shieldCheck', { size: 15 })} Bản quyền của bạn</h2>
          <div class="def-list" data-my-lic>
            <div class="def-row">
              <span class="def-k">Đang tải…</span>
              <span class="def-v"></span>
            </div>
          </div>
          <a class="btn btn-ghost btn-sm mt-1" href="#/licenses">
            Xem chi tiết ${icon('chevronRight', { size: 13 })}
          </a>
        </div>

        <div class="panel">
          <h2 class="panel-title">${icon('sliders', { size: 15 })} Thao tác nhanh</h2>
          <div class="action-list">
            <button class="action-item" data-go="/orders">
              ${icon('package', { size: 15 })} Đơn hàng của tôi ${icon('chevronRight', { size: 14, cls: 'chev' })}
            </button>
            <button class="action-item" data-go="/licenses">
              ${icon('checkCircle', { size: 15 })} License của tôi ${icon('chevronRight', { size: 14, cls: 'chev' })}
            </button>
            <button class="action-item" data-go="/products">
              ${icon('bag', { size: 15 })} Tiếp tục mua sắm ${icon('chevronRight', { size: 14, cls: 'chev' })}
            </button>
            ${u.role === 'admin' || u.role === 'staff'
              ? `<button class="action-item" data-go="/admin">
                   ${icon('settings', { size: 15 })} Trang quản trị ${icon('chevronRight', { size: 14, cls: 'chev' })}
                 </button>` : ''}
          </div>
        </div>

        <div class="panel mt-2">
          <h2 class="panel-title">${icon('shieldCheck', { size: 15 })} Bảo mật tài khoản</h2>
          <div class="def-list">
            <div class="def-row">
              <span class="k">Mật khẩu</span>
              <span class="v"><span class="pill pill-green">${icon('check', { size: 10 })} Đã đặt</span></span>
            </div>
            <div class="def-row">
              <span class="k">Phiên đăng nhập</span>
              <span class="v">Cookie HttpOnly</span>
            </div>
            <div class="def-row">
              <span class="k">Kết nối</span>
              <span class="v"><span class="pill pill-green">${icon('lock', { size: 10 })} HTTPS</span></span>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  host.querySelectorAll('[data-go]').forEach((b) => {
    b.onclick = () => navigate(b.dataset.go);
  });

  // ------------------------------------------------------------------
  // KHỐI "BẢN QUYỀN CỦA BẠN" — hiện NGAY hạn dùng.
  //
  // Chủ shop: "check cái thời gian của tài khoản ở đâu? không có trang đấy à?"
  // Trước đây trang Tài khoản không hiện hạn, phải bấm sang "License của tôi".
  // Nay hiện tại chỗ: mỗi sản phẩm một dòng, còn bao nhiêu ngày.
  // ------------------------------------------------------------------
  (async () => {
    const box = host.querySelector('[data-my-lic]');
    if (!box) return;
    const row = (name, l) => {
      if (!l) {
        return '<div class="def-row"><span class="def-k">' + esc(name)
          + '</span><span class="def-v" style="opacity:.6">Chưa có</span></div>';
      }
      let val;
      let tone = '';
      if (!l.active) {
        val = (l.revoked ? 'Đã thu hồi' : 'Đã hết hạn');
        tone = 'color:var(--danger)';
      } else if (l.forever || !l.expires_at) {
        val = 'Không giới hạn';
        tone = 'color:var(--ok)';
      } else {
        const d = Math.max(0, Math.ceil(
          (l.expires_at * 1000 - Date.now()) / 86400000));
        val = (d <= 0) ? 'Đã hết hạn' : ('Còn ' + d + ' ngày');
        tone = d <= 7 ? 'color:var(--warning)' : 'color:var(--ok)';
        if (d <= 0) tone = 'color:var(--danger)';
      }
      return '<div class="def-row"><span class="def-k">' + esc(name)
        + '</span><span class="def-v" style="' + tone + ';font-weight:600">'
        + esc(val) + '</span></div>';
    };
    try {
      const d = await api('/api/entitlement');
      const lics = (d && d.licenses) || [];
      // Bản đã mua đi theo TÀI KHOẢN (đổi máy nào cũng được) nên không lọc
      // theo máy nữa: chỉ cần licence còn hiệu lực là hiện.
      const pick = (pid) => lics.find((L) => {
        if (!L.active) return false;
        const p = String(L.pid || '').toLowerCase();
        return pid === 'xagrant' ? (p === 'xagrant') : (p !== 'xagrant');
      }) || lics.find((L) => {
        const p = String(L.pid || '').toLowerCase();
        return pid === 'xagrant' ? (p === 'xagrant') : (p !== 'xagrant');
      });
      box.innerHTML = row('Map sáng', pick('nofog'))
        + row('Tài nguyên', pick('xagrant'));
    } catch (e) {
      box.innerHTML = '<div class="def-row"><span class="def-k">'
        + 'Không tải được</span></div>';
    }
  })();

  host.querySelector('#profile-form').onsubmit = async (e) => {
    e.preventDefault();
    const fullName = host.querySelector('#pf-name').value.trim();
    const phone = host.querySelector('#pf-phone').value.trim();
    if (fullName.length < 2) { toast('Vui lòng nhập họ tên', 'error'); return; }
    try {
      await api('/api/auth/profile', { method: 'PATCH', body: { fullName, phone: phone || null } });
      await loadUser();
      toast('Đã cập nhật thông tin', 'success');
      window.dispatchEvent(new CustomEvent('app:refresh-header'));
    } catch (err) { toast(err.message, 'error'); }
  };

  host.querySelector('#pwd-form').onsubmit = async (e) => {
    e.preventDefault();
    const cur = host.querySelector('#pw-cur').value;
    const nw = host.querySelector('#pw-new').value;
    const cf = host.querySelector('#pw-confirm').value;
    if (nw !== cf) { toast('Mật khẩu xác nhận không khớp', 'error'); return; }
    if (nw.length < 8) { toast('Mật khẩu mới phải có ít nhất 8 ký tự', 'error'); return; }
    try {
      await api('/api/auth/change-password', {
        method: 'POST',
        body: { currentPassword: cur, newPassword: nw },
      });
      toast('Đã đổi mật khẩu. Các phiên khác đã bị đăng xuất.', 'success');
      host.querySelector('#pwd-form').reset();
    } catch (err) { toast(err.message, 'error'); }
  };
}
