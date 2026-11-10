/** Trang đăng nhập / đăng ký. */
import { api, esc, toast, navigate } from '../lib.js';
import { state, notify, loadUser } from '../state.js';

function shell(inner) {
  return `<div id="site-header"></div>
  <div class="auth-wrap"><div class="auth-card">${inner}</div></div>`;
}

export function renderLogin(query) {
  return shell(`
    <div class="auth-head">
      <div class="auth-icon">🔑</div>
      <div class="auth-title">Đăng nhập</div>
      <div class="auth-sub">Chào mừng bạn trở lại MuaBanKey</div>
    </div>
    <form id="login-form" novalidate>
      <div class="field">
        <label class="label" for="lg-email">Tài khoản <span class="req">*</span></label>
        <input class="input" id="lg-email" type="text" autocomplete="username"
          placeholder="Email hoặc tên đăng nhập" required>
      </div>
      <div class="field">
        <label class="label" for="lg-pwd">Mật khẩu <span class="req">*</span></label>
        <input class="input" id="lg-pwd" type="password" autocomplete="current-password" placeholder="••••••••" required>
      </div>
      <div id="login-error" class="form-error mb-2" style="display:none"></div>
      <button class="btn btn-primary btn-block btn-lg" id="login-submit" type="submit">Đăng nhập</button>
    </form>
    <div class="auth-foot">
      Chưa có tài khoản? <a href="#/register">Đăng ký ngay</a>
    </div>
  `);
}

export function mountLogin(root, query) {
  const form = root.querySelector('#login-form');
  const errEl = root.querySelector('#login-error');
  const btn = root.querySelector('#login-submit');

  form.onsubmit = async (e) => {
    e.preventDefault();
    errEl.style.display = 'none';
    const account = root.querySelector('#lg-email').value.trim();
    const password = root.querySelector('#lg-pwd').value;

    if (!account || !password) {
      errEl.textContent = '⚠️ Vui lòng nhập đầy đủ tài khoản và mật khẩu';
      errEl.style.display = 'flex';
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Đang đăng nhập...';
    try {
      const data = await api('/api/auth/login', { method: 'POST', body: { email: account, password } });
      state.user = data.user;
      notify();
      await loadUser();
      toast(`Chào mừng ${data.user.fullName || data.user.username || data.user.email}!`, 'success');
      const redirect = query.redirect || (data.user.role === 'admin' ? '/admin' : '/');
      navigate(redirect.startsWith('/') ? redirect : '/');
      window.dispatchEvent(new CustomEvent('app:refresh-header'));
    } catch (err) {
      errEl.textContent = '⚠️ ' + err.message;
      errEl.style.display = 'flex';
    } finally {
      btn.disabled = false;
      btn.textContent = 'Đăng nhập';
    }
  };
}

export function renderRegister(query) {
  return shell(`
    <div class="auth-head">
      <div class="auth-icon">✨</div>
      <div class="auth-title">Tạo tài khoản</div>
      <div class="auth-sub">Bắt đầu mua sắm chỉ trong 30 giây</div>
    </div>
    <form id="reg-form" novalidate>
      <div class="field">
        <label class="label" for="rg-name">Họ và tên <span class="req">*</span></label>
        <input class="input" id="rg-name" type="text" autocomplete="name" placeholder="Nguyễn Văn An" required>
      </div>
      <div class="field">
        <label class="label" for="rg-email">Email <span class="req">*</span></label>
        <input class="input" id="rg-email" type="email" autocomplete="email" placeholder="you@example.com" required>
      </div>
      <div class="field">
        <label class="label" for="rg-phone">Số điện thoại</label>
        <input class="input" id="rg-phone" type="tel" autocomplete="tel" placeholder="0912345678">
      </div>
      <div class="field">
        <label class="label" for="rg-pwd">Mật khẩu <span class="req">*</span></label>
        <input class="input" id="rg-pwd" type="password" autocomplete="new-password" placeholder="Tối thiểu 8 ký tự, có chữ và số" required>
        <div class="form-hint">Mật khẩu phải có ít nhất 8 ký tự, bao gồm cả chữ và số</div>
      </div>
      <div id="reg-error" class="form-error mb-2" style="display:none"></div>
      <button class="btn btn-primary btn-block btn-lg" id="reg-submit" type="submit">Đăng ký</button>
    </form>
    <div class="auth-foot">
      Đã có tài khoản? <a href="#/login">Đăng nhập</a>
    </div>
  `);
}

export function mountRegister(root, query) {
  const form = root.querySelector('#reg-form');
  const errEl = root.querySelector('#reg-error');
  const btn = root.querySelector('#reg-submit');

  form.onsubmit = async (e) => {
    e.preventDefault();
    errEl.style.display = 'none';

    const fullName = root.querySelector('#rg-name').value.trim();
    const email = root.querySelector('#rg-email').value.trim();
    const phone = root.querySelector('#rg-phone').value.trim();
    const password = root.querySelector('#rg-pwd').value;

    if (fullName.length < 2) return showErr('⚠️ Vui lòng nhập họ tên');
    if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) return showErr('⚠️ Email không hợp lệ');
    if (password.length < 8) return showErr('⚠️ Mật khẩu phải có ít nhất 8 ký tự');
    if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
      return showErr('⚠️ Mật khẩu phải bao gồm cả chữ và số');
    }

    btn.disabled = true;
    btn.textContent = 'Đang tạo tài khoản...';
    try {
      const data = await api('/api/auth/register', {
        method: 'POST',
        body: { fullName, email, phone: phone || null, password },
      });
      state.user = data.user;
      notify();
      toast('Đăng ký thành công! Chào mừng bạn 🎉', 'success');
      navigate(query.redirect || '/');
      window.dispatchEvent(new CustomEvent('app:refresh-header'));
    } catch (err) {
      showErr('⚠️ ' + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Đăng ký';
    }
  };

  function showErr(msg) {
    errEl.textContent = msg;
    errEl.style.display = 'flex';
  }
}
