/** Trang tài khoản người dùng. */
import { api, esc, fmtVnd, fmtNum, fmtDate, toast, navigate, loadingBlock, copyText } from '../lib.js';
import { state, notify, loadUser } from '../state.js';

export function renderAccount() {
  return `
  <div id="site-header"></div>
  <section class="section-sm">
    <div class="container">
      <div class="pd-breadcrumb"><a href="#/">Trang chủ</a><span>/</span><span>Tài khoản</span></div>
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

  host.innerHTML = `
    <div class="checkout-grid">
      <div>
        <div class="panel">
          <div class="flex items-center gap-2 mb-3">
            <div style="width:62px;height:62px;border-radius:19px;display:grid;place-items:center;font-size:25px;font-weight:800;background:var(--grad-brand);color:#fff">
              ${esc((u.fullName || u.email)[0].toUpperCase())}
            </div>
            <div>
              <div style="font-size:19px;font-weight:800;letter-spacing:-.025em">${esc(u.fullName || 'Khách hàng')}</div>
              <div style="font-size:13.5px;color:var(--text-mute)">${esc(u.email)}</div>
              <div class="flex gap-1 mt-1">
                <span class="pill ${u.role === 'admin' ? 'pill-red' : 'pill-blue'}">${u.role === 'admin' ? '⚙️ Quản trị viên' : '👤 Thành viên'}</span>
              </div>
            </div>
          </div>

          <div class="stat-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:0">
            <div class="stat-card" style="padding:15px">
              <div class="ico">💰</div>
              <div class="v" style="font-size:18px;color:#4ade80">${fmtVnd(u.balance)}</div>
              <div class="l">Số dư ví</div>
            </div>
            <div class="stat-card" style="padding:15px">
              <div class="ico">📦</div>
              <div class="v" style="font-size:18px">${fmtNum(s.orders)}</div>
              <div class="l">Đơn hàng</div>
            </div>
            <div class="stat-card" style="padding:15px">
              <div class="ico">💎</div>
              <div class="v" style="font-size:18px">${fmtVnd(s.spent)}</div>
              <div class="l">Tổng chi tiêu</div>
            </div>
          </div>
        </div>

        <div class="panel mt-2">
          <div class="panel-title">👤 Thông tin cá nhân</div>
          <form id="profile-form">
            <div class="field">
              <label class="label" for="pf-name">Họ và tên</label>
              <input class="input" id="pf-name" value="${esc(u.fullName || '')}" required>
            </div>
            <div class="field">
              <label class="label" for="pf-phone">Số điện thoại</label>
              <input class="input" id="pf-phone" value="${esc(u.phone || '')}" placeholder="0912345678">
            </div>
            <div class="field">
              <label class="label">Email</label>
              <input class="input" value="${esc(u.email)}" disabled style="opacity:.6">
            </div>
            <button class="btn btn-primary" type="submit">Lưu thay đổi</button>
          </form>
        </div>

        <div class="panel mt-2">
          <div class="panel-title">🔒 Đổi mật khẩu</div>
          <form id="pwd-form">
            <div class="field">
              <label class="label" for="pw-cur">Mật khẩu hiện tại</label>
              <input class="input" id="pw-cur" type="password" autocomplete="current-password" required>
            </div>
            <div class="field">
              <label class="label" for="pw-new">Mật khẩu mới</label>
              <input class="input" id="pw-new" type="password" autocomplete="new-password" placeholder="Tối thiểu 8 ký tự, có chữ và số" required>
            </div>
            <div class="field">
              <label class="label" for="pw-confirm">Xác nhận mật khẩu mới</label>
              <input class="input" id="pw-confirm" type="password" autocomplete="new-password" required>
            </div>
            <button class="btn btn-primary" type="submit">Đổi mật khẩu</button>
          </form>
        </div>
      </div>

      <div>
        <div class="panel">
          <div class="panel-title">⚡ Thao tác nhanh</div>
          <div class="flex flex-col gap-1">
            <button class="btn btn-primary btn-block" data-go="/wallet">💰 Nạp tiền vào ví</button>
            <button class="btn btn-ghost btn-block" data-go="/orders">📦 Đơn hàng của tôi</button>
            <button class="btn btn-ghost btn-block" data-go="/licenses">🔑 License của tôi</button>
            <button class="btn btn-ghost btn-block" data-go="/products">🛍️ Tiếp tục mua sắm</button>
            ${u.role === 'admin' || u.role === 'staff'
              ? `<button class="btn btn-ghost btn-block" data-go="/admin">⚙️ Trang quản trị</button>` : ''}
          </div>
        </div>

        <div class="panel mt-2">
          <div class="panel-title">🛡️ Bảo mật tài khoản</div>
          <div style="font-size:13px;color:var(--text-dim);line-height:1.8">
            <div class="flex justify-between"><span>Mật khẩu</span><span class="text-green">Đã đặt ✓</span></div>
            <div class="flex justify-between mt-1"><span>Phiên đăng nhập</span><span>Cookie HttpOnly</span></div>
            <div class="flex justify-between mt-1"><span>Kết nối</span><span class="text-green">HTTPS ✓</span></div>
          </div>
        </div>
      </div>
    </div>
  `;

  host.querySelectorAll('[data-go]').forEach((b) => {
    b.onclick = () => navigate(b.dataset.go);
  });

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
      host.querySelector('#pw-form').reset();
    } catch (err) { toast(err.message, 'error'); }
  };
}
