/** Trang đăng nhập / đăng ký. */
import { api, toast, navigate } from '../lib.js';
import { icon } from '../icons.js';
import { state, notify, loadUser } from '../state.js';

function shell(inner) {
  return `<div id="site-header"></div>
  <div class="auth-wrap"><div class="auth-card">${inner}</div></div>`;
}

/**
 * Điều khiển ô lỗi của form.
 *
 * Tách hai phần: `.auth-err` chỉ để hiển thị (bật/tắt bằng `.hidden`), còn
 * `role="alert"` nằm ở một vùng `.sr-only` luôn có mặt trong DOM. Lý do: một
 * live region vừa được hiện ra rồi mới nhận nội dung thì không chắc được trình
 * đọc màn hình thông báo; vùng luôn hiện nhưng ẩn về thị giác thì luôn thông báo.
 *
 * Nội dung ghi bằng `textContent` — không có đường chèn HTML từ message của API.
 */
function errorBox(el) {
  // Vùng live nằm ngay sau ô lỗi trong template (xem renderLogin/renderRegister).
  const next = el.nextElementSibling;
  const live = next && next.getAttribute('role') === 'alert' ? next : null;
  const msg = el.querySelector('.fe-msg');
  return {
    clear() {
      el.classList.add('hidden');
      if (msg) msg.textContent = '';
      if (live) live.textContent = '';
    },
    show(text) {
      el.classList.remove('hidden');
      if (msg) msg.textContent = text;
      if (live) live.textContent = text;
    },
  };
}

export function renderLogin(query) {
  return shell(`
    <div class="auth-head">
      <div class="auth-icon">${icon('login', { size: 20 })}</div>
      <h1 class="auth-title">Đăng nhập</h1>
      <p class="auth-sub">Quản lý đơn hàng và bản quyền của bạn.</p>
    </div>
    <form id="login-form" novalidate>
      <div class="field">
        <label class="label" for="lg-email">Tài khoản <span class="req" aria-hidden="true">*</span></label>
        <input class="input" id="lg-email" type="text" name="username" autocomplete="username"
          placeholder="Tên đăng nhập" autocapitalize="none" spellcheck="false"
          required aria-required="true">
      </div>
      <div class="field">
        <label class="label" for="lg-pwd">Mật khẩu <span class="req" aria-hidden="true">*</span></label>
        <input class="input" id="lg-pwd" type="password" name="password" autocomplete="current-password"
          placeholder="••••••••" required aria-required="true">
      </div>
      <div id="login-error" class="form-error auth-err hidden">
        ${icon('alert', { size: 14 })}<span class="fe-msg"></span>
      </div>
      <div id="login-error-live" class="sr-only" role="alert"></div>
      <button class="btn btn-primary btn-block btn-lg" id="login-submit" type="submit">Đăng nhập</button>
    </form>
    <div class="auth-foot">
      Chưa có tài khoản? <a href="#/register">Tạo tài khoản</a>
    </div>
  `);
}

export function mountLogin(root, query) {
  const form = root.querySelector('#login-form');
  const errEl = root.querySelector('#login-error');
  const btn = root.querySelector('#login-submit');
  const err = errorBox(errEl);

  form.onsubmit = async (e) => {
    e.preventDefault();
    err.clear();
    const account = root.querySelector('#lg-email').value.trim();
    const password = root.querySelector('#lg-pwd').value;

    if (!account || !password) {
      err.show('Vui lòng nhập đầy đủ tài khoản và mật khẩu.');
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Đang đăng nhập...';
    try {
      const data = await api('/api/auth/login', { method: 'POST', body: { username: account, password } });
      state.user = data.user;
      notify();
      await loadUser();
      toast(`Chào mừng ${data.user.fullName || data.user.username}!`, 'success');
      const redirect = query.redirect || (data.user.role === 'admin' ? '/admin' : '/');
      navigate(redirect.startsWith('/') ? redirect : '/');
      window.dispatchEvent(new CustomEvent('app:refresh-header'));
    } catch (e2) {
      err.show(e2.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Đăng nhập';
    }
  };
}

export function renderRegister(query) {
  void query;
  return shell(`
    <div class="auth-head">
      <div class="auth-icon">${icon('user', { size: 20 })}</div>
      <h1 class="auth-title">Tạo tài khoản</h1>
      <p class="auth-sub">Chỉ cần tài khoản và mật khẩu, không cần email xác nhận.</p>
    </div>
    <form id="reg-form" novalidate>
      <div class="field">
        <label class="label" for="rg-user">Tài khoản <span class="req" aria-hidden="true">*</span></label>
        <input class="input" id="rg-user" type="text" name="username" autocomplete="username"
          placeholder="Ví dụ: nam123" autocapitalize="none" spellcheck="false"
          required aria-required="true" aria-describedby="rg-user-hint">
        <div class="form-hint" id="rg-user-hint">Chữ, số, dấu chấm. Từ 3 ký tự.</div>
      </div>
      <div class="field">
        <label class="label" for="rg-pwd">Mật khẩu <span class="req" aria-hidden="true">*</span></label>
        <input class="input" id="rg-pwd" type="password" name="password" autocomplete="new-password"
          placeholder="Ít nhất 6 ký tự" required aria-required="true" aria-describedby="rg-pwd-hint">
        <div class="form-hint" id="rg-pwd-hint">Từ 6 ký tự. Không cần chữ hoa hay ký tự đặc biệt.</div>
      </div>
      <div class="field">
        <label class="label" for="rg-pwd2">Nhập lại mật khẩu <span class="req" aria-hidden="true">*</span></label>
        <input class="input" id="rg-pwd2" type="password" name="password2" autocomplete="new-password"
          placeholder="Nhập lại mật khẩu" required aria-required="true">
      </div>
      <div id="reg-error" class="form-error auth-err hidden">
        ${icon('alert', { size: 14 })}<span class="fe-msg"></span>
      </div>
      <div id="reg-error-live" class="sr-only" role="alert"></div>
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
  const err = errorBox(errEl);

  form.onsubmit = async (e) => {
    e.preventDefault();
    err.clear();

    const username = root.querySelector('#rg-user').value.trim().toLowerCase();
    const password = root.querySelector('#rg-pwd').value;
    const password2 = root.querySelector('#rg-pwd2').value;

    if (!/^[a-z0-9._-]{3,32}$/.test(username)) {
      return showErr('Tài khoản phải có 3-32 ký tự, chỉ gồm chữ, số, dấu chấm, gạch dưới hoặc gạch ngang.');
    }
    if (password.length < 6) return showErr('Mật khẩu phải có ít nhất 6 ký tự.');
    if (password !== password2) return showErr('Hai mật khẩu không giống nhau.');

    btn.disabled = true;
    btn.textContent = 'Đang tạo...';
    try {
      const data = await api('/api/auth/register', {
        method: 'POST',
        body: { username, password },
      });
      state.user = data.user;
      notify();
      toast('Tạo tài khoản thành công. Chào mừng bạn đến với MuaBanKey!', 'success');
      navigate(query.redirect || '/');
      window.dispatchEvent(new CustomEvent('app:refresh-header'));
    } catch (e2) {
      showErr(e2.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Tạo tài khoản';
    }
  };

  function showErr(msg) {
    err.show(msg);
  }
}
