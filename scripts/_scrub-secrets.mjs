/**
 * Xoá credential nhúng cứng khỏi các script vận hành (chạy MỘT lần).
 *
 * Thay literal bằng đọc từ biến môi trường. Không đụng tới .env / .dev.vars
 * (những file đó đã nằm trong .gitignore và là nơi LƯU credential hợp lệ).
 *
 * Chạy: node scripts/_scrub-secrets.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const CF_TOKEN = 'cfut_36vwtVnGqd2KYb59ZWgI9faJGhStWQdeNIdEVWHba90694c6';
const CF_ACCT = '5b62d10947844251d23e0eac532531dd';
const SEPAY = 'H1RIWPEIYXVYVCAZ1BT9VNTLKG35XMZ0CY9FMKFEWHZFJH2LSNL6UUQGPV8OXBTA';
const TG_TOKEN = '9204549517:AAFrpYm_0By5c-oePkpxgyPcrW0DDT5gtnA';

/** Biến môi trường -> giá trị cũ. Thứ tự dài trước để không cắt ngắn nhầm. */
const REPLACEMENTS = [
  [CF_TOKEN, "process.env.CLOUDFLARE_API_TOKEN"],
  [CF_ACCT, "process.env.CLOUDFLARE_ACCOUNT_ID"],
  [SEPAY, "process.env.SEPAY_API_TOKEN"],
  [TG_TOKEN, "process.env.TELEGRAM_BOT_TOKEN"],
];

const FILES = [
  'qa/d1q.mjs',
  'scripts/diagnose-now.mjs',
  'scripts/e2e-qr-order.mjs',
  'scripts/find-1tr8.mjs',
  'scripts/fix-now.mjs',
  'scripts/status-now.mjs',
  'scripts/test-deliver-btn.mjs',
  'scripts/test-payment-risks.mjs',
  'scripts/trace-1tr8.mjs',
  'scripts/e2e.mjs',
  'scripts/e2e-tg-flow.mjs',
  'scripts/check-sepay-token.mjs',
];

let touched = 0;
for (const f of FILES) {
  if (!existsSync(f)) continue;
  const before = readFileSync(f, 'utf8');
  let after = before;

  for (const [secret, expr] of REPLACEMENTS) {
    // Chỉ thay khi literal đứng MỘT MÌNH trong dấu nháy, để không phá cú pháp.
    // Dạng "const X = '<secret>';" -> "const X = process.env...;"
    after = after.split(`'${secret}'`).join(expr);
    after = after.split(`"${secret}"`).join(expr);
  }

  if (after !== before) {
    writeFileSync(f, after, 'utf8');
    touched++;
    console.log(`scrubbed ${f}`);
  }
}
console.log(`\n${touched} file(s) scrubbed`);

// Kiểm tra lại: không còn literal nào trong cây làm việc
const leftovers = [];
for (const f of FILES) {
  if (!existsSync(f)) continue;
  const c = readFileSync(f, 'utf8');
  for (const [secret] of REPLACEMENTS) {
    if (c.includes(secret)) leftovers.push(f);
  }
}
console.log(leftovers.length === 0
  ? 'OK: không còn credential nhúng cứng trong các file đã xử lý'
  : `CÒN SÓT: ${[...new Set(leftovers)].join(', ')}`);
