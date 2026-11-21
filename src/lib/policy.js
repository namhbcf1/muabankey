/**
 * policy.js — BẢN SERVER của chính sách đang bán.
 *
 * Phải KHỚP với `public/assets/policy.js`. Test `test/policy.test.mjs` đọc cả
 * hai file và so sánh nên không thể lệch âm thầm.
 *
 * Mọi endpoint trả lời khách (app info, FAQ, bot, trial status) đọc từ đây
 * thay vì viết lại chuỗi.
 */

export const TRIAL_POLICY = {
  days: 1,
  requiresAccount: true,
  features: ['nofog', 'grant'],
  maxAccountsPerDevice: 3,
};

export const FEATURE_LABEL = {
  nofog: 'Map sáng',
  grant: 'Tài nguyên',
};

/**
 * Mô tả dùng thử cho client (app + web).
 * `days` đọc từ policy, KHÔNG hardcode ở nơi gọi.
 */
export function trialPolicyPayload() {
  return {
    days: TRIAL_POLICY.days,
    requires_account: TRIAL_POLICY.requiresAccount,
    features: [...TRIAL_POLICY.features],
    max_accounts_per_device: TRIAL_POLICY.maxAccountsPerDevice,
    starts_when: 'app_open',
    feature_labels: { ...FEATURE_LABEL },
  };
}

/** Câu giải thích chuẩn — dùng cho bot và FAQ động. */
export function trialPolicySentence() {
  return `Mỗi tài khoản được dùng thử ${TRIAL_POLICY.days} ngày cho cả hai tính năng `
    + '(map sáng và tài nguyên), cần tạo tài khoản miễn phí trong app. '
    + 'Đồng hồ bắt đầu từ lần đầu mở app.';
}
