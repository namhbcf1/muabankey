/**
 * Đọc credential của người vận hành từ biến môi trường, KHÔNG hardcode.
 *
 * VÌ SAO: trước đây các script vận hành (`e2e.mjs`, `test-payment-risks.mjs`,
 * `status-now.mjs`…) nhúng thẳng token Cloudflare, token SePay và token bot
 * Telegram vào source. Những file đó được git TRACK, nên credential nằm trong
 * lịch sử repo và trong mọi bản clone. Token Cloudflare đó đọc được toàn bộ
 * 16 worker của tài khoản.
 *
 * Cách dùng:
 *   import { need } from './_env-required.mjs';
 *   const token = need('CLOUDFLARE_API_TOKEN');
 *
 * Thiếu biến thì báo lỗi rõ ràng ngay khi khởi động, thay vì gửi request với
 * chuỗi rỗng rồi thất bại khó hiểu ở giữa chừng.
 */
export function need(name) {
  const v = process.env[name];
  if (!v || !String(v).trim()) {
    throw new Error(
      `Thiếu biến môi trường ${name}. ` +
      `Đặt trước khi chạy, ví dụ PowerShell: $env:${name} = '<giá trị>'`,
    );
  }
  return String(v).trim();
}

/** Như need() nhưng trả null khi thiếu — dùng cho script không bắt buộc. */
export function optional(name) {
  const v = process.env[name];
  return v && String(v).trim() ? String(v).trim() : null;
}
