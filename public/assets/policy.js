/**
 * policy.js — NGUỒN SỰ THẬT DUY NHẤT cho lời hứa với khách.
 *
 * ============================================================================
 * VÌ SAO CÓ FILE NÀY (F09 trong kế hoạch)
 *
 * Trước đây cùng một chính sách được viết lại ở 6 nơi với 3 phiên bản khác
 * nhau, và chúng mâu thuẫn thật:
 *
 *   • index.html:9          "Dùng thử miễn phí ngay khi mở app"
 *   • home.js:73,105,116    "1 giờ"  + "Không cần đăng ký"
 *   • licenses.js:7         "1 ngày"
 *   • src/index.js:114      "1 ngày"
 *   • support.js:29         không nêu thời lượng
 *
 * Khách đọc trang chủ thấy "1 giờ, không cần đăng ký" rồi mở app thấy yêu cầu
 * đăng nhập và hạn 1 ngày -> mất niềm tin đúng ở bước quyết định mua.
 *
 * Nay mọi chuỗi về chính sách lấy từ ĐÂY. Khi chủ shop đổi chính sách, chỉ
 * sửa một chỗ. Server có bản tương ứng ở `src/lib/policy.js` — hai bên phải
 * khớp, và có test so sánh.
 * ============================================================================
 */

/** Thời lượng và điều kiện dùng thử — ĐÚNG theo chính sách hiện hành. */
export const TRIAL = {
  days: 1,
  // App bật dùng thử khi mở lần đầu, KHÔNG phải lúc đăng ký.
  startsWhen: 'app_open',
  requiresAccount: true,
  features: ['nofog', 'grant'],
  /** Số tài khoản tối đa được dùng thử trên CÙNG một máy (chống farm). */
  maxAccountsPerDevice: 3,
};

/** Nhãn ngắn cho hai tính năng — dùng ở mọi nơi thay vì viết lại. */
export const FEATURE_LABEL = {
  nofog: 'Map sáng',
  grant: 'Tài nguyên',
};

/** Câu mô tả dùng thử, dùng lại được ở mọi chỗ. */
export const TRIAL_HEADLINE = `Dùng thử ${TRIAL.days} ngày`;
export const TRIAL_CONDITION = 'cần tài khoản';
export const TRIAL_START_NOTE = 'Đồng hồ bắt đầu từ lần đầu mở app';

/** Một dòng đầy đủ cho badge/hero. */
export const TRIAL_BADGE = `${TRIAL_HEADLINE} · ${TRIAL_CONDITION}`;
export const TRIAL_BADGE_LONG = `${TRIAL_HEADLINE} ${TRIAL.days === 1 ? 'miễn phí' : 'miễn phí'} · ${TRIAL_CONDITION}`;

/**
 * Câu trả lời chuẩn cho câu hỏi thường gặp về dùng thử.
 * Dùng chung cho trang chủ, trang hỗ trợ, FAQ và bot.
 */
export const TRIAL_FAQ = {
  q: 'Dùng thử được bao lâu, có cần đăng ký không?',
  a: `Mỗi tài khoản được dùng thử ${TRIAL.days} ngày cho cả hai tính năng `
    + '(map sáng và tài nguyên). Cần tạo tài khoản — miễn phí, làm ngay trong app. '
    + `${TRIAL_START_NOTE}, nên bạn đăng ký hôm nay rồi mai mới cài vẫn còn đủ ${TRIAL.days} ngày.`,
};

/** Điều khách phải biết trước khi mua — dùng ở checkout và trang tải. */
export const PURCHASE_TERMS = [
  'Quyền gắn với TÀI KHOẢN, không phải mã key. Đăng nhập là dùng được.',
  'Một tài khoản dùng trên một máy tại một thời điểm; đổi máy bằng cách đăng nhập lại.',
  'Cần internet mỗi lần chạy — app xác minh quyền với máy chủ định kỳ.',
  'Bảo hành 1 đổi 1; hoàn tiền theo quy trình có chứng từ chuyển khoản.',
];

/** Không hứa những điều không làm được. */
export const NO_PROMISES = [
  'Không hứa chạy offline dài hạn.',
  'Không hứa "không phải virus" chỉ vì chưa ký số — chỉ nêu nguồn và hash.',
  'Không hứa hoàn tiền tức thì; hoàn tiền cần xác nhận chuyển khoản.',
];

export const SITE_NAME = 'XA ARENA';
