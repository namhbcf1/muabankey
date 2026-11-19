/**
 * pii.js — CHE DỮ LIỆU CÁ NHÂN / BÍ MẬT THEO VAI TRÒ (audit #12).
 *
 * ============================================================================
 * VẤN ĐỀ
 *
 * `requireAdmin()` cố tình cho CẢ `staff` đi qua, vì nhân viên hỗ trợ cần xem
 * đơn, trạng thái giao hàng, license còn hạn... Nhưng các route đó lại trả
 * NGUYÊN dữ liệu: email, số điện thoại, HWID của mọi khách, và TOÀN BỘ license
 * key của shop. Một tài khoản hỗ trợ (hoặc một phiên bị chiếm) vì thế đọc được
 * toàn bộ PII và toàn bộ key — đủ để bán lại hoặc chiếm license.
 *
 * ============================================================================
 * CÁCH SỬA
 *
 * Không bỏ quyền staff (họ cần các trường VẬN HÀNH: mã đơn, trạng thái, số
 * tiền, hạn dùng, quyền của key). Chỉ CHE các trường định danh/bí mật khi người
 * xem KHÔNG phải admin thật:
 *
 *   email  : a***@x.com          (giữ ký tự đầu + domain để còn đối chiếu)
 *   phone  : ***1234             (giữ 3 số cuối)
 *   hwid   : 775c3f…             (giữ 6 ký tự đầu — đủ để so khớp máy)
 *   key    : AOE1-****-****-7R2P (giữ tiền tố + nhóm cuối — đủ để khách đọc
 *                                  lại cho nhân viên kiểm tra)
 *
 * Che chỉ áp dụng cho ĐẦU RA API. Việc tra cứu (`?q=`) vẫn chạy trên dữ liệu
 * thật, nên staff vẫn tìm được theo email/hwid/key khi khách cung cấp.
 * ============================================================================
 */

/** Người xem có phải staff (không phải admin thật)? */
export function isStaffViewer(user) {
  return !!user && user.role === 'staff';
}

/** 'a***@x.com' — giữ ký tự đầu của phần local + nguyên domain. */
export function maskEmail(email) {
  if (typeof email !== 'string' || email.length === 0) return email;
  const at = email.lastIndexOf('@');
  if (at <= 0) {
    // Không phải email (username?) -> chỉ giữ ký tự đầu
    return email.slice(0, 1) + '***';
  }
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  return `${local.slice(0, 1)}***@${domain}`;
}

/** '***1234' — giữ 3 số cuối, đủ để khách đọc lại cho nhân viên. */
export function maskPhone(phone) {
  const s = String(phone ?? '').trim();
  if (!s) return s || null;
  return s.length <= 3 ? '***' : '***' + s.slice(-3);
}

/** '775c3f…' — giữ 6 ký tự đầu (đủ để so khớp máy), phần còn lại ẩn. */
export function maskHwid(hwid) {
  const s = String(hwid ?? '').trim();
  if (!s) return null;
  return s.slice(0, 6) + '…';
}

/**
 * 'AOE1-****-****-7R2P' — giữ nhóm đầu (tiền tố sản phẩm) và nhóm cuối.
 * Key không có dấu '-' (dữ liệu lạ) -> chỉ giữ 4 ký tự đầu.
 */
export function maskKey(key) {
  const s = String(key ?? '').trim();
  if (!s) return s;
  const parts = s.split('-');
  if (parts.length < 3) return s.slice(0, 4) + '****';
  const mid = parts.slice(1, -1).map(() => '****').join('-');
  return `${parts[0]}-${mid}-${parts[parts.length - 1]}`;
}

/**
 * Số tài khoản ngân hàng: '****4112' — giữ 4 số cuối.
 *
 * Vì sao che: số tài khoản nhận tiền là thứ DUY NHẤT cần để chuyển hướng dòng
 * tiền của shop. Staff cần biết "đã cấu hình tài khoản nào" (4 số cuối), không
 * cần thấy để đọc cho khách.
 */
export function maskAccount(acc) {
  const s = String(acc ?? '').trim();
  if (!s) return s;
  return s.length <= 4 ? '****' : '****' + s.slice(-4);
}

/** Tên chủ tài khoản: 'N***' — giữ ký tự đầu. */
export function maskName(name) {
  const s = String(name ?? '').trim();
  if (!s) return s;
  return s.slice(0, 1) + '***';
}
