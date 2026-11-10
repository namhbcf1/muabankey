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

export async function api(path, { method = 'GET', body = null, silent = false } = {}) {
  const opts = {
    method,
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  };
  if (body) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(path, opts);
  } catch {
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
export function openModal(html, { onMount } = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.innerHTML = `<div class="modal">${html}</div>`;
  document.body.appendChild(overlay);
  const prevFocus = document.activeElement;
  requestAnimationFrame(() => overlay.classList.add('open'));

  const close = () => {
    overlay.classList.remove('open');
    setTimeout(() => overlay.remove(), 260);
    document.removeEventListener('keydown', escHandler);
    // Trả focus về nơi mở modal — bắt buộc cho người dùng bàn phím.
    if (prevFocus && typeof prevFocus.focus === 'function') prevFocus.focus();
  };
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  const escHandler = (e) => {
    if (e.key === 'Escape') {
      close();
      document.removeEventListener('keydown', escHandler);
    }
  };
  document.addEventListener('keydown', escHandler);
  if (onMount) onMount(overlay, close);
  // Đưa focus vào phần tử đầu tiên có thể tương tác
  requestAnimationFrame(() => {
    const first = overlay.querySelector('button, [href], input, select, textarea');
    if (first) first.focus();
  });
  return { el: overlay, close };
}

export function confirmDialog(title, message, confirmLabel = 'Xác nhận') {
  return new Promise((resolve) => {
    const { el, close } = openModal(`
      <div class="modal-title">${esc(title)}</div>
      <div class="modal-sub">${esc(message)}</div>
      <div class="flex gap-1" style="justify-content:flex-end">
        <button class="btn btn-ghost" data-no>Huỷ</button>
        <button class="btn btn-danger" data-yes>${esc(confirmLabel)}</button>
      </div>
    `, {
      onMount(overlay, closeFn) {
        overlay.querySelector('[data-no]').onclick = () => { closeFn(); resolve(false); };
        overlay.querySelector('[data-yes]').onclick = () => { closeFn(); resolve(true); };
      },
    });
    void el;
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

/* ---------- Giải mã key giao cho khách ---------- */
/**
 * Giải mã key giao cho khách.
 *
 * Key thường lưu dạng base64; riêng key license là chuỗi thuần (AOE1-XXXX-...).
 * Trước đây chỉ kiểm tra ký tự in được nên chuỗi base64 vô nghĩa vẫn bị giải mã
 * thành mojibake (vd "KEY12345" -> "(F5Û~9"). Nay kiểm tra round-trip.
 */
export function decodeKey(raw) {
  const s = String(raw ?? '');
  // Dạng license thuần
  if (/^[A-Z0-9]+(-[A-Z0-9]+){1,4}$/i.test(s)) return s;
  // Không giống base64 -> trả nguyên
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(s) || s.length % 4 !== 0) return s;

  try {
    const dec = atob(s);
    // Round-trip: mã hoá lại phải khớp bản gốc (bỏ padding)
    if (btoa(dec).replace(/=+$/, '') !== s.replace(/=+$/, '')) return s;
    // Phải là text đọc được (không có ký tự điều khiển)
    if (/[\x00-\x1F\x7F]/.test(dec)) return s;
    // Chuỗi giải mã phải "giống key": chỉ chữ, số, dấu phân cách, khoảng trắng
    if (!/^[A-Za-z0-9@._:|\-+/=\s]{4,}$/.test(dec)) return s;
    return dec;
  } catch {
    return s;
  }
}

/* ---------- Debounce ---------- */
export function debounce(fn, ms = 300) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
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
