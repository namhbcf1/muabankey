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
      <div class="auth-sub">Chỉ cần tài khoản và mật khẩu</div>
    </div>
    <form id="reg-form" novalidate>
      <div class="field">
        <label class="label" for="rg-user">Tài khoản <span class="req">*</span></label>
        <input class="input" id="rg-user" type="text" autocomplete="username"
          placeholder="Ví dụ: nam123" required autocapitalize="none" spellcheck="false">
        <div class="form-hint">Chữ, số, dấu chấm. Từ 3 ký tự.</div>
      </div>
      <div class="field">
        <label class="label" for="rg-pwd">Mật khẩu <span class="req">*</span></label>
        <input class="input" id="rg-pwd" type="password" autocomplete="new-password"
          placeholder="Ít nhất 6 ký tự" required>
        <div class="form-hint">Từ 6 ký tự. Không cần chữ hoa hay ký tự đặc biệt.</div>
      </div>
      <div class="field">
        <label class="label" for="rg-pwd2">Nhập lại mật khẩu <span class="req">*</span></label>
        <input class="input" id="rg-pwd2" type="password" autocomplete="new-password"
          placeholder="Nhập lại cho chắc" required>
      </div>
      <div id="reg-error" class="form-error mb-2" style="display:none"></div>
      <button class="btn btn-primary btn-block btn-lg" id="reg-submit" type="submit">Tạo tài khoản</button>
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

    const username = root.querySelector('#rg-user').value.trim().toLowerCase();
    const password = root.querySelector('#rg-pwd').value;
    const password2 = root.querySelector('#rg-pwd2').value;

    if (!/^[a-z0-9._-]{3,32}$/.test(username)) {
      return showErr('⚠️ Tài khoản 3-32 ký tự, chỉ dùng chữ, số, dấu chấm, gạch dưới');
    }
    if (password.length < 6) return showErr('⚠️ Mật khẩu phải có ít nhất 6 ký tự');
    if (password !== password2) return showErr('⚠️ Hai mật khẩu không giống nhau');

    btn.disabled = true;
    btn.textContent = 'Đang tạo...';
    try {
      const data = await api('/api/auth/register', {
        method: 'POST',
        body: { username, password },
      });
      state.user = data.user;
      notify();
      toast('Tạo tài khoản thành công! Chào mừng bạn 🎉', 'success');
      navigate(query.redirect || '/');
      window.dispatchEvent(new CustomEvent('app:refresh-header'));
    } catch (err) {
      showErr('⚠️ ' + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Tạo tài khoản';
    }
  };

  function showErr(msg) {
    errEl.textContent = msg;
    errEl.style.display = 'flex';
  }
}
