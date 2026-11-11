/** Quản lý state toàn cục. */
import { store, api, toast } from './lib.js';

export const state = {
  user: null,
  cart: store.get('mbk_cart', []),
  categories: [],
  aiOpen: false,
  aiHistory: [],
};

const listeners = new Set();
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function notify() {
  for (const fn of listeners) {
    try { fn(state); } catch (e) { console.error(e); }
  }
}

/* ---------- Giỏ hàng ---------- */
export function cartCount() {
  return state.cart.reduce((s, i) => s + i.quantity, 0);
}

export function cartSubtotal() {
  return state.cart.reduce((s, i) => s + i.price * i.quantity, 0);
}

export function saveCart() {
  store.set('mbk_cart', state.cart);
  notify();
  renderCartBadge();
}

export function addToCart(product, qty = 1) {
  // Sản phẩm hết hàng (kiểu key/account) thì không cho thêm vào giỏ
  if (!product.inStock && product.deliveryType !== 'license' && product.deliveryType !== 'manual') {
    toast('Sản phẩm đã hết hàng', 'error');
    return false;
  }

  const existing = state.cart.find((i) => i.productId === product.id);
  const isLicense = product.deliveryType === 'license';
  const maxQty = isLicense ? 10 : product.deliveryType === 'manual' ? 20 : Math.max(0, product.stock);
  if (maxQty < 1) {
    toast('Sản phẩm đã hết hàng', 'error');
    return false;
  }
  if (existing) {
    const next = Math.min(existing.quantity + qty, maxQty, 20);
    if (next === existing.quantity) {
      toast(`Chỉ còn ${maxQty} sản phẩm trong kho`, 'error');
      return false;
    }
    existing.quantity = next;
  } else {
    if (qty > maxQty) {
      toast(`Chỉ còn ${maxQty} sản phẩm trong kho`, 'error');
      return false;
    }
    state.cart.push({
      productId: product.id,
      slug: product.slug,
      name: product.name,
      price: product.price,
      imageUrl: product.imageUrl,
      quantity: qty,
      stock: product.stock,
      deliveryType: product.deliveryType,
    });
  }
  saveCart();
  toast(`Đã thêm "${product.name}" vào giỏ`, 'success');
  return true;
}

export function updateCartQty(productId, qty) {
  const item = state.cart.find((i) => i.productId === productId);
  if (!item) return;
  const max = item.deliveryType === 'license'
    ? 10
    : item.deliveryType === 'manual' ? 20 : Math.max(1, item.stock || 1);
  if (qty <= 0) {
    state.cart = state.cart.filter((i) => i.productId !== productId);
  } else {
    item.quantity = Math.min(qty, max);
  }
  saveCart();
}

export function removeFromCart(productId) {
  state.cart = state.cart.filter((i) => i.productId !== productId);
  saveCart();
}

export function clearCart() {
  state.cart = [];
  saveCart();
}

/* ---------- Badge ---------- */
export function renderCartBadge() {
  const badge = document.getElementById('cart-badge');
  if (!badge) return;
  const n = cartCount();
  badge.textContent = n > 99 ? '99+' : String(n);
  badge.style.display = n > 0 ? 'grid' : 'none';
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
  notify();
  return state.user;
}


export function updateBalanceChip() {
  // #balance-chip nằm trong nút ví ở header; chỉ cập nhật phần số, giữ nguyên icon.
  const el = document.getElementById('balance-chip');
  if (el && state.user) {
    el.textContent = `${new Intl.NumberFormat('vi-VN').format(state.user.balance)}₫`;
  }
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
