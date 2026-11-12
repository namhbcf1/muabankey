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

/**
 * Tên đăng nhập: chữ, số, gạch dưới, gạch ngang, dấu chấm. 3-32 ký tự.
 * Dùng khi khách đăng ký chỉ với tài khoản + mật khẩu (không cần email).
 */
export function username(v, field = 'username') {
  const s = str(v, field, { min: 3, max: 32 }).toLowerCase();
  if (!/^[a-z0-9._-]+$/.test(s)) {
    throw new ApiError(400,
      'Tên đăng nhập chỉ được dùng chữ, số, dấu chấm, gạch dưới, gạch ngang',
      'VALIDATION');
  }
  if (/^[._-]|[._-]$/.test(s)) {
    throw new ApiError(400, 'Tên đăng nhập không được bắt đầu/kết thúc bằng dấu',
      'VALIDATION');
  }
  return s;
}

/**
 * Chấp nhận cả email và username.
 * - Có '@' -> validate như email
 * - Không có '@' -> validate như username
 */
export function identifier(v, field = 'identifier') {
  const raw = str(v, field, { min: 3, max: 254 }).trim();
  if (raw.includes('@')) return email(raw, field);
  return username(raw, field);
}

export function password(v) {
  // Chỉ yêu cầu 6 ký tự, không bắt buộc chữ + số.
  // Chủ shop yêu cầu đăng ký đơn giản: tài khoản + mật khẩu là xong.
  const s = str(v, 'password', { min: 6, max: 128, trim: false });
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

/**
 * Đọc tham số phân trang từ query string.
 *
 * VÌ SAO KHÔNG DÙNG `Math.max(1, Number(x))`: `Number('abc')` là NaN, và
 * `Math.max(1, NaN)` vẫn là NaN (NaN lan truyền). NaN bind xuống D1 làm
 * câu SQL hỏng -> 500 INTERNAL. Đã tái hiện thật trên production:
 *   GET /api/products?page=NOT_A_NUMBER  ->  500
 * Đầu vào từ query string là dữ liệu của client, phải chặn ở biên.
 *
 * CẨN THẬN với `Number(null) === 0` và `Number('') === 0`: tham số VẮNG MẶT
 * (`url.searchParams.get()` trả `null`) cũng là số hữu hạn, nên nếu chỉ kiểm
 * `Number.isFinite` thì `perPage` vắng mặt sẽ bị kẹp thành 1 thay vì mặc định.
 * Phải loại giá trị rỗng trước khi ép số.
 */
export function pageNum(v, fallback = 1, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (v === null || v === undefined) return fallback;
  const s = String(v).trim();
  if (s === '') return fallback;
  const n = Number(s);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
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
