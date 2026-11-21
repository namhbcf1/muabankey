/** Quản lý state toàn cục. */
import { api } from './lib.js';

export const state = {
  user: null,
  /**
   * false cho tới khi /api/auth/me trả lời lần đầu.
   *
   * app.js dùng cờ này để vẽ header ở trạng thái CHỜ (skeleton) thay vì nút
   * "Đăng nhập": khách đã đăng nhập không phải thấy "Đăng nhập" rồi nó biến
   * mất sau ~650ms (nhấp nháy trạng thái sai).
   */
  authReady: false,
  categories: [],
  aiHistory: [],
};

const listeners = new Set();

/**
 * Theo dõi thay đổi state.
 *
 * Ghi chú: hiện chỉ `loadUser`/`loadCategories` gọi `notify()`; header tự vẽ
 * lại qua sự kiện `app:refresh-header` (app.js). Hàm này giữ lại cho nơi khác
 * cần phản ứng với state mà không phải thêm sự kiện DOM.
 */
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function notify() {
  for (const fn of listeners) {
    try { fn(state); } catch (e) { console.error(e); }
  }
}

/* ---------- Auth ---------- */
export async function loadUser() {
  try {
    const data = await api('/api/auth/me');
    state.user = data.user;
    state.stats = data.stats;
  } catch (e) {
    state.user = null;
    if (e.status !== 401) console.warn('loadUser:', e.message);
  }
  // Đã có câu trả lời (kể cả 401) -> header thoát trạng thái skeleton.
  state.authReady = true;
  notify();
  return state.user;
}

export async function loadCategories() {
  try {
    const data = await api('/api/categories');
    state.categories = data.categories;
    notify();
  } catch (e) {
    console.warn('loadCategories:', e.message);
  }
}
