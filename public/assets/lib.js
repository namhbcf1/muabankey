/** Tiện ích dùng chung cho SPA: gọi API, định dạng, toast, router. */
import { icon } from './icons.js';

/* ---------- HTML an toàn: escape rồi bọc trong <strong> ---------- */
/**
 * In đậm một đoạn văn bản do người dùng nhập.
 *
 * `esc()` được áp dụng TRƯỚC nên không có đường nào để chèn HTML sống —
 * đây là lý do không dùng `.replace()` trực tiếp trên chuỗi thô trong template.
 */
export function bold(text) {
  return `<strong>${esc(text)}</strong>`;
}

/**
 * Gọi API JSON.
 *
 * ============================================================================
 * F12 — REQUEST PHẢI HUỶ ĐƯỢC KHI RỜI TRANG
 *
 * Bản cũ không hỗ trợ `signal`, nên mọi `await api(...)` trong `mount` của
 * trang vẫn chạy tiếp sau khi khách đã chuyển route. Hệ quả:
 *   • phản hồi về muộn ghi đè DOM của trang MỚI;
 *   • poll 4 giây của trang thanh toán tiếp tục chạy vô hạn;
 *   • mỗi lần bấm qua lại giữa hai trang là thêm một chuỗi request song song.
 *
 * Nay nhận `signal`. Bên gọi truyền `ctx.signal` (xem `routeContext()`).
 * Khi bị huỷ, ném `ApiClientError` với code `ABORTED` để trang phân biệt với
 * lỗi mạng thật (không hiện toast "kiểm tra mạng" khi khách chỉ vừa rời trang).
 * ============================================================================
 */
export async function api(path, {
  method = 'GET', body = null, silent = false, signal = null,
} = {}) {
  const opts = {
    method,
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  };
  if (signal) opts.signal = signal;
  if (body) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(path, opts);
  } catch (e) {
    // Huỷ chủ động KHÔNG phải lỗi mạng — trang đã đóng, không cần báo khách.
    if (e && (e.name === 'AbortError' || e.code === 20)) {
      throw new ApiClientError('Đã huỷ yêu cầu', 0, 'ABORTED');
    }
    throw new ApiClientError('Không kết nối được máy chủ. Kiểm tra mạng của bạn.', 0, 'NETWORK');
  }
  let data = null;
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    try { data = await res.json(); } catch { data = null; }
  }
  if (!res.ok) {
    const msg = (data && data.error) || `Lỗi ${res.status}`;
    throw new ApiClientError(msg, res.status, data && data.code, data && data.details);
  }
  return data;
}

/** Lỗi này có phải do khách rời trang giữa lúc gọi không? */
export function isAborted(err) {
  return !!err && (err.code === 'ABORTED' || err.name === 'AbortError');
}

/**
 * Ngữ cảnh sống theo một lần render route.
 *
 * Trang dùng `ctx.signal` cho mọi request, và `ctx.onCleanup()` cho mọi thứ
 * cần dọn (interval, listener trên window/document). Router gọi `dispose()`
 * ngay khi bắt đầu điều hướng mới.
 */
export function routeContext() {
  const controller = new AbortController();
  const cleanups = [];
  let disposed = false;

  return {
    signal: controller.signal,
    get disposed() { return disposed; },

    /** Đăng ký hàm dọn. Trả về chính nó để nối chuỗi. */
    onCleanup(fn) {
      if (typeof fn === 'function') cleanups.push(fn);
      return this;
    },

    /** setTimeout có thể huỷ. */
    setTimeout(fn, ms) {
      const id = setTimeout(() => { if (!disposed) fn(); }, ms);
      cleanups.push(() => clearTimeout(id));
      return id;
    },

    /** setInterval tự huỷ theo route — dùng cho poll trạng thái đơn. */
    setInterval(fn, ms) {
      const id = setInterval(() => { if (!disposed) fn(); }, ms);
      cleanups.push(() => clearInterval(id));
      return id;
    },

    /** addEventListener có thể gỡ. */
    listen(target, type, handler, options) {
      if (!target || typeof target.addEventListener !== 'function') return;
      target.addEventListener(type, handler, options);
      cleanups.push(() => target.removeEventListener(type, handler, options));
    },

    /** Dọn mọi thứ. Idempotent. */
    dispose() {
      if (disposed) return;
      disposed = true;
      try { controller.abort(); } catch { /* bỏ qua */ }
      for (const fn of cleanups) {
        try { fn(); } catch { /* một hàm lỗi không chặn phần còn lại */ }
      }
      cleanups.length = 0;
    },
  };
}

export class ApiClientError extends Error {
  constructor(message, status, code, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/* ---------- Định dạng ---------- */
export const fmtVnd = (n) =>
  new Intl.NumberFormat('vi-VN', { style: 'decimal', maximumFractionDigits: 0 }).format(Number(n) || 0) + '₫';

export const fmtNum = (n) => new Intl.NumberFormat('vi-VN').format(Number(n) || 0);

export function fmtDate(ts) {
  if (!ts) return '—';
  const d = new Date(Number(ts));
  return d.toLocaleString('vi-VN', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export function timeAgo(ts) {
  const diff = Date.now() - Number(ts);
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'vừa xong';
  if (m < 60) return `${m} phút trước`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} giờ trước`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} ngày trước`;
  return fmtDate(ts);
}

/* ---------- Chống XSS ---------- */
export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ---------- Toast ---------- */
let toastWrap = null;
export function toast(message, type = 'info', ms = 3600) {
  if (!toastWrap) {
    toastWrap = document.createElement('div');
    toastWrap.className = 'toast-wrap';
    toastWrap.setAttribute('role', 'status');
    toastWrap.setAttribute('aria-live', 'polite');
    document.body.appendChild(toastWrap);
  }
  const icons = {
    success: icon('checkCircle', { size: 16 }),
    error: icon('alert', { size: 16 }),
    info: icon('info', { size: 16 }),
  };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `${icons[type] || icons.info}<span>${esc(message)}</span>`;
  toastWrap.appendChild(el);
  // Giới hạn tối đa 3 toast để không che màn hình mobile
  while (toastWrap.children.length > 3) toastWrap.firstElementChild.remove();
  setTimeout(() => {
    el.classList.add('hide');
    setTimeout(() => el.remove(), 260);
  }, ms);
}

/* ---------- Modal ---------- */
/** Thứ tự đặt id cho tiêu đề modal (aria-labelledby cần một id thật). */
let modalSeq = 0;
/** Các modal đang mở, để đóng ĐÚNG CÁCH (gỡ listener + trả focus). */
const openModals = new Set();
/** Ngăn xếp overlay: modal mở sau cùng nhận focus. */
const modalStack = [];

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])',
  'select:not([disabled])', 'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/** Phần tử có thể nhận focus và đang thật sự nhìn thấy. */
function focusables(root) {
  return [...root.querySelectorAll(FOCUSABLE)]
    .filter((el) => !el.hasAttribute('hidden') && el.getAttribute('aria-hidden') !== 'true'
      && el.offsetWidth + el.offsetHeight + el.getBoundingClientRect().height > 0);
}

/**
 * Đóng MỌI modal đang mở bằng chính hàm close() của chúng.
 *
 * Dùng thay cho `document.querySelectorAll('.modal-overlay').forEach(el => el.remove())`:
 * xoá node trực tiếp bỏ sót listener Escape trên document (rò rỉ) và không trả
 * focus về nơi đã mở modal.
 */
export function closeAllModals() {
  for (const close of [...openModals]) {
    try { close(); } catch { /* ignore */ }
  }
}

/**
 * Mở một hộp thoại.
 *
 * @param {string} html
 * @param {object} [opts]
 * @param {(overlay:Element, close:Function)=>void} [opts.onMount]
 * @param {string} [opts.labelledBy]
 * @param {()=>void} [opts.onClose]  chạy khi modal đóng bằng BẤT KỲ đường nào
 *   (nút, Escape, click nền, closeAllModals). Cần cho các Promise phải luôn
 *   được giải quyết — xem confirmDialog.
 */
export function openModal(html, { onMount, labelledBy = null, onClose } = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.innerHTML = `<div class="modal">${html}</div>`;
  document.body.appendChild(overlay);

  const dialog = overlay.querySelector('.modal') || overlay;

  /*
   * aria-labelledby — TRƯỚC ĐÂY THIẾU.
   *
   * role="dialog" mà không có tên thì trình đọc màn hình chỉ đọc "hộp thoại",
   * khách không biết mình đang ở đâu. Lấy id của .modal-title; nếu tiêu đề
   * chưa có id thì sinh một cái (không sửa nội dung hiển thị).
   */
  let labelId = typeof labelledBy === 'string' && labelledBy ? labelledBy : '';
  if (!labelId) {
    const titleEl = dialog.querySelector('.modal-title, h1, h2');
    if (titleEl) {
      if (!titleEl.id) {
        modalSeq += 1;
        titleEl.id = `modal-title-${modalSeq}`;
      }
      labelId = titleEl.id;
    }
  }
  if (labelId) overlay.setAttribute('aria-labelledby', labelId);
  else overlay.setAttribute('aria-label', 'Hộp thoại');

  const prevFocus = document.activeElement;
  requestAnimationFrame(() => overlay.classList.add('open'));
  modalStack.push(overlay);

  // Khoá Tab trong modal: Tab ở phần tử cuối quay về đầu, Shift+Tab ngược lại.
  const trapTab = (e) => {
    if (e.key !== 'Tab') return;
    const items = focusables(dialog);
    if (!items.length) { e.preventDefault(); return; }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey) {
      if (active === first || !dialog.contains(active)) { e.preventDefault(); last.focus(); }
    } else if (active === last || !dialog.contains(active)) {
      e.preventDefault();
      first.focus();
    }
  };
  overlay.addEventListener('keydown', trapTab);

  // Nếu focus thoát ra ngoài bằng đường khác (click trang nền, JS focus) thì kéo về.
  const keepFocusInside = (e) => {
    if (modalStack[modalStack.length - 1] !== overlay) return;
    if (overlay.contains(e.target)) return;
    const first = focusables(dialog)[0];
    if (first) first.focus();
  };
  document.addEventListener('focusin', keepFocusInside);

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    openModals.delete(close);
    const at = modalStack.lastIndexOf(overlay);
    if (at >= 0) modalStack.splice(at, 1);
    // GỠ listener TRƯỚC khi trả focus, nếu không sẽ bị kéo focus trở lại.
    document.removeEventListener('keydown', escHandler);
    document.removeEventListener('focusin', keepFocusInside);
    overlay.removeEventListener('keydown', trapTab);
    overlay.classList.remove('open');
    setTimeout(() => overlay.remove(), 260);
    /*
     * Báo cho bên gọi TRƯỚC khi trả focus: callback này có thể cần biết modal
     * đã đóng để giải quyết Promise (xem confirmDialog). Đặt trong try/catch
     * để một callback lỗi không chặn việc trả focus.
     */
    if (typeof onClose === 'function') {
      try { onClose(); } catch { /* không chặn dọn dẹp */ }
    }
    // Trả focus về nơi mở modal — bắt buộc cho người dùng bàn phím.
    if (prevFocus && typeof prevFocus.focus === 'function' && document.contains(prevFocus)) {
      prevFocus.focus();
    }
  };
  openModals.add(close);

  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  const escHandler = (e) => {
    if (e.key === 'Escape' && modalStack[modalStack.length - 1] === overlay) close();
  };
  document.addEventListener('keydown', escHandler);
  if (onMount) onMount(overlay, close);
  // Đưa focus vào phần tử đầu tiên có thể tương tác
  requestAnimationFrame(() => {
    const first = focusables(dialog)[0];
    if (first) first.focus();
  });
  return { el: overlay, close };
}

/**
 * Hộp thoại xác nhận hai lựa chọn, trả Promise<boolean>.
 *
 * ============================================================================
 * F12 — PROMISE PHẢI ĐƯỢC GIẢI QUYẾT Ở MỌI ĐƯỜNG ĐÓNG
 *
 * Bản cũ chỉ `resolve` trong hai handler onclick của nút Huỷ / Xác nhận:
 *
 *     overlay.querySelector('[data-no]').onclick  = () => { closeFn(); resolve(false); };
 *     overlay.querySelector('[data-yes]').onclick = () => { closeFn(); resolve(true);  };
 *
 * Nhưng `openModal` còn ĐÓNG được bằng hai đường khác: phím Escape và bấm ra
 * vùng nền. Cả hai gọi `close()` mà KHÔNG resolve.
 *
 * Hệ quả thật: `await confirmDialog(...)` treo vĩnh viễn. Mọi chỗ dùng đều
 * hỏng theo kiểu im lặng — nút Hoàn tiền, nút Đổi máy, nút Xoá sản phẩm đều
 * `await` rồi mới làm việc tiếp, nên khách bấm Escape là thao tác đứng luôn,
 * không có phản hồi nào và không có lỗi nào trong console.
 *
 * NAY: đăng ký một callback `onClose` trên chính `close()`, nên mọi đường
 * đóng (nút, Escape, click nền, `closeAllModals()` khi chuyển route) đều giải
 * quyết Promise đúng một lần.
 * ============================================================================
 */
export function confirmDialog(title, message, confirmLabel = 'Xác nhận') {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const { close } = openModal(`
      <div class="modal-title">${esc(title)}</div>
      <div class="modal-sub">${esc(message)}</div>
      <div class="flex gap-1" style="justify-content:flex-end">
        <button class="btn btn-ghost" data-no>Huỷ</button>
        <button class="btn btn-danger" data-yes>${esc(confirmLabel)}</button>
      </div>
    `, {
      onMount(overlay, closeFn) {
        overlay.querySelector('[data-no]').onclick = () => { settle(false); closeFn(); };
        overlay.querySelector('[data-yes]').onclick = () => { settle(true); closeFn(); };
      },
      /*
       * Mọi đường đóng khác (Escape, click nền, chuyển route) -> coi như Huỷ.
       * An toàn: đóng mà không xác nhận KHÔNG được hiểu là đồng ý.
       */
      onClose: () => settle(false),
    });

    void close;
  });
}

/* ---------- LocalStorage an toàn ---------- */
export const store = {
  get(k, fallback = null) {
    try {
      const v = localStorage.getItem(k);
      return v === null ? fallback : JSON.parse(v);
    } catch { return fallback; }
  },
  set(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* quota */ }
  },
  del(k) {
    try { localStorage.removeItem(k); } catch { /* ignore */ }
  },
};

/* ---------- Router ---------- */
export function parseRoute() {
  const hash = location.hash.slice(1) || '/';
  // Tách fragment: "#/support#warranty" -> path "/support", anchor "warranty"
  const [beforeQuery, anchor = ''] = hash.split('#');
  const [pathPart, queryPart] = beforeQuery.split('?');
  const segments = pathPart.split('/').filter(Boolean);
  const query = Object.fromEntries(new URLSearchParams(queryPart || ''));
  return { path: '/' + segments.join('/'), segments, query, anchor, raw: hash };
}

export function navigate(to, { replace = false } = {}) {
  const target = to.startsWith('#') ? to : '#' + to;
  if (replace) {
    history.replaceState(null, '', target);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else if (location.hash === target) {
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else {
    location.hash = target;
  }
}

/* ---------- Ảnh sản phẩm: fallback không dùng inline handler ---------- */
/**
 * Gắn xử lý lỗi tải ảnh cho mọi <img data-img-fallback> trong `root`.
 *
 * CSP của site đặt `script-src 'self'` nên thuộc tính `onerror="..."` trong
 * HTML bị chặn — ảnh hỏng sẽ để lại khung vỡ thay vì ẩn đi. Gắn listener bằng
 * JS vừa hợp CSP vừa không cần nới lỏng chính sách bảo mật.
 */
export function bindImageFallbacks(root = document) {
  root.querySelectorAll('img[data-img-fallback]').forEach((img) => {
    if (img.dataset.fbBound === '1') return;
    img.dataset.fbBound = '1';
    const onFail = () => {
      if (img.dataset.fbApplied === '1') return;
      img.dataset.fbApplied = '1';
      const mode = img.dataset.imgFallback;
      if (mode === 'hide') img.style.opacity = '0';
      else img.classList.add('img-failed');
    };
    img.addEventListener('error', onFail);
    // Ảnh đã lỗi trước khi listener gắn xong
    if (img.complete && img.naturalWidth === 0) onFail();
  });
}

/* ---------- Dải cuộn ngang: báo hiệu còn nội dung ---------- */
/**
 * Theo dõi mọi .cat-scroll để bật/tắt class mép trái/phải.
 *
 * Danh mục trên mobile cuộn ngang nhưng ẩn scrollbar; không có tín hiệu nào
 * cho biết còn chip phía sau. Hàm này gắn class để CSS hiện dải mờ ở mép.
 */
export function bindScrollHints(root = document) {
  root.querySelectorAll('.cat-scroll').forEach((el) => {
    if (el.dataset.scrollHint === '1') return;
    el.dataset.scrollHint = '1';
    const update = () => {
      const maxScroll = el.scrollWidth - el.clientWidth;
      const atStart = el.scrollLeft <= 2;
      const atEnd = maxScroll <= 2 || el.scrollLeft >= maxScroll - 2;
      el.classList.toggle('at-start', !atStart && !atEnd);
      el.classList.toggle('at-end', atEnd);
    };
    el.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update, { passive: true });
    update();
  });
}

/* ---------- Skeleton helpers ---------- */
export function skeletonCards(n = 8) {
  return `<div class="grid-products">${Array.from({ length: n }, () => `
    <div class="skel-card">
      <div class="skel skel-thumb"></div>
      <div class="skel skel-line"></div>
      <div class="skel skel-line short"></div>
      <div class="skel skel-line" style="height:28px;margin-bottom:15px"></div>
    </div>`).join('')}</div>`;
}

export function loadingBlock(text = 'Đang tải...') {
  return `<div class="empty-state">
    <div class="ico">${icon('progress', { size: 26 })}</div>
    <div class="t">${esc(text)}</div>
  </div>`;
}

/** Khối trạng thái rỗng dùng chung cho mọi trang. */
export function emptyBlock({ ico = 'inbox', title, desc = '', action = '' }) {
  return `<div class="empty-state">
    <div class="ico">${icon(ico, { size: 28 })}</div>
    <div class="t">${esc(title)}</div>
    ${desc ? `<div class="d">${esc(desc)}</div>` : ''}
    ${action}
  </div>`;
}

/* ---------- Debounce ---------- */
/**
 * Gộp nhiều lần gọi liên tiếp thành một lần chạy sau `ms`.
 *
 * Trả về hàm có thêm hai phương thức:
 *   .cancel()  — huỷ lần chờ hiện tại (dùng khi bấm Enter để không chạy 2 lần)
 *   .flush()   — chạy NGAY lần chờ hiện tại (nếu có) rồi xoá hẹn giờ
 */
export function debounce(fn, ms = 300) {
  let t = null;
  let lastArgs = null;

  const wrapped = (...args) => {
    lastArgs = args;
    clearTimeout(t);
    t = setTimeout(() => {
      t = null;
      const a = lastArgs;
      lastArgs = null;
      fn(...a);
    }, ms);
  };

  wrapped.cancel = () => {
    clearTimeout(t);
    t = null;
    lastArgs = null;
  };

  wrapped.flush = () => {
    if (t === null) return;
    clearTimeout(t);
    t = null;
    const a = lastArgs || [];
    lastArgs = null;
    fn(...a);
  };

  /** Đang có lần chờ chưa chạy? */
  wrapped.pending = () => t !== null;

  return wrapped;
}

/* ---------- Copy to clipboard ---------- */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let okFlag = false;
    try { okFlag = document.execCommand('copy'); } catch { okFlag = false; }
    ta.remove();
    return okFlag;
  }
}
