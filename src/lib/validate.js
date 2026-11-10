/** Kiểm tra & chuẩn hoá dữ liệu đầu vào. */
import { ApiError } from './http.js';

export function str(v, field, { min = 0, max = 1000, required = true, trim = true } = {}) {
  if (v === undefined || v === null) {
    if (required) throw new ApiError(400, `Thiếu trường "${field}"`, 'VALIDATION');
    return null;
  }
  if (typeof v !== 'string') throw new ApiError(400, `"${field}" phải là chuỗi`, 'VALIDATION');
  const s = trim ? v.trim() : v;
  if (s.length < min) throw new ApiError(400, `"${field}" phải có ít nhất ${min} ký tự`, 'VALIDATION');
  if (s.length > max) throw new ApiError(400, `"${field}" tối đa ${max} ký tự`, 'VALIDATION');
  return s;
}

export function email(v, field = 'email') {
  const s = str(v, field, { min: 5, max: 254 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(s)) {
    throw new ApiError(400, 'Email không hợp lệ', 'VALIDATION');
  }
  return s;
}

export function password(v) {
  const s = str(v, 'password', { min: 8, max: 128, trim: false });
  if (!/[A-Za-z]/.test(s) || !/[0-9]/.test(s)) {
    throw new ApiError(400, 'Mật khẩu phải có cả chữ và số', 'VALIDATION');
  }
  return s;
}

export function int(v, field, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const n = typeof v === 'string' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n) || !Number.isInteger(n)) {
    throw new ApiError(400, `"${field}" phải là số nguyên`, 'VALIDATION');
  }
  if (n < min || n > max) throw new ApiError(400, `"${field}" ngoài khoảng cho phép`, 'VALIDATION');
  return n;
}

export function enum_ok(v, allowed, field) {
  if (!allowed.includes(v)) {
    throw new ApiError(400, `"${field}" không hợp lệ`, 'VALIDATION');
  }
  return v;
}

export function bool(v, fallback = false) {
  if (v === undefined || v === null) return fallback;
  if (typeof v === 'boolean') return v;
  if (v === '1' || v === 1 || v === 'true') return true;
  if (v === '0' || v === 0 || v === 'false') return false;
  return fallback;
}

export function slugify(s) {
  return String(s)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'sp-' + Date.now();
}
