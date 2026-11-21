/**
 * payment-amount.test.mjs — Số tiền nhận được KHÔNG được suy từ giá đơn.
 *
 * Khoá lỗi P0-5. Trạng thái trước khi sửa (`src/routes/payments.js`):
 *
 *   const paid = ratify ? 0 : Math.floor(Number(amount) || expected);
 *
 * Toán tử `||` coi 0/NaN/'' là "không có giá trị" rồi thay bằng `expected`
 * (giá của đơn). Nghĩa là một webhook PayOS THIẾU `amount`, hoặc `amount = 0`,
 * trở thành "đã trả đủ tiền" -> `state='matched'` -> GIÀNH ĐƠN -> GIAO HÀNG
 * ĐẦY ĐỦ mà không có đồng nào vào tài khoản.
 *
 * Test dưới đây tái hiện đúng phép tính cũ và cho thấy nó sai, rồi kiểm mã
 * mới.
 */
import { Suite } from './harness.mjs';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const S = new Suite('Số tiền thanh toán');

/* ------------------------------------------------------------------ */
/* 1. TÁI HIỆN lỗi cũ                                                  */
/* ------------------------------------------------------------------ */

S.section('TÁI HIỆN: 0 đồng thành "đã trả đủ"');

const EXPECTED = 180_000; // giá đơn

/** Công thức CŨ, sao chép nguyên văn. */
function oldPaid(amount, expected) {
  return Math.floor(Number(amount) || expected);
}

S.eq(oldPaid(undefined, EXPECTED), EXPECTED, 'CŨ: amount undefined -> coi như trả đủ');
S.eq(oldPaid(0, EXPECTED), EXPECTED, 'CŨ: amount = 0 -> coi như trả đủ');
S.eq(oldPaid(null, EXPECTED), EXPECTED, 'CŨ: amount null -> coi như trả đủ');
S.eq(oldPaid('', EXPECTED), EXPECTED, "CŨ: amount '' -> coi như trả đủ");
S.eq(oldPaid(NaN, EXPECTED), EXPECTED, 'CŨ: amount NaN -> coi như trả đủ');

/*
 * Và đó chính là điều kiện để giành đơn: paid >= expected -> 'matched'.
 * Nghĩa là KHÔNG có đồng nào vào mà đơn vẫn được giao.
 */
S.ok(oldPaid(0, EXPECTED) >= EXPECTED, 'CŨ: 0 đồng làm state = matched -> GIAO HÀNG');

/* ------------------------------------------------------------------ */
/* 2. Công thức MỚI                                                     */
/* ------------------------------------------------------------------ */

S.section('MỚI: chỉ dùng số tiền thật, expected chỉ để so sánh');

/** Công thức MỚI, sao chép nguyên văn từ payments.js. */
function newPaid(amount, expected) {
  const amountNum = Number(amount);
  return Number.isFinite(amountNum) && amountNum > 0 ? Math.floor(amountNum) : 0;
}

S.eq(newPaid(undefined, EXPECTED), 0, 'MỚI: amount undefined -> 0 (KHÔNG suy từ giá)');
S.eq(newPaid(0, EXPECTED), 0, 'MỚI: amount = 0 -> 0');
S.eq(newPaid(null, EXPECTED), 0, 'MỚI: amount null -> 0');
S.eq(newPaid('', EXPECTED), 0, "MỚI: amount '' -> 0");
S.eq(newPaid(NaN, EXPECTED), 0, 'MỚI: amount NaN -> 0');
S.eq(newPaid(-500, EXPECTED), 0, 'MỚI: amount âm -> 0');
S.eq(newPaid('180000', EXPECTED), 180_000, "MỚI: chuỗi số hợp lệ -> dùng số đó");
S.eq(newPaid(180_000, EXPECTED), 180_000, 'MỚI: số hợp lệ giữ nguyên');
S.eq(newPaid(50_000, EXPECTED), 50_000, 'MỚI: trả thiếu thì ghi đúng số thiếu (không nâng lên)');

S.ok(newPaid(0, EXPECTED) < EXPECTED, 'MỚI: 0 đồng KHÔNG làm state = matched');

/* ------------------------------------------------------------------ */
/* 3. Mã nguồn thật không còn công thức cũ                              */
/* ------------------------------------------------------------------ */

S.section('Mã nguồn: không còn `|| expected`');

const paySrc = readFileSync(join(ROOT, 'src/routes/payments.js'), 'utf8');

/** Bóc comment: khối sửa lỗi cố ý trích lại công thức cũ để giải thích. */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/(^|[^:\\])\/\/.*$/gm, '$1');
}
const payCode = stripComments(paySrc);

S.ok(
  !/Number\(amount\)\s*\|\|\s*expected/.test(payCode),
  'payments.js: KHÔNG còn `Number(amount) || expected` trong mã',
);
S.ok(
  /Number\.isFinite\(amountNum\) && amountNum > 0/.test(payCode),
  'payments.js: số tiền phải là số hữu hạn và > 0',
);

/* ------------------------------------------------------------------ */
/* 4. PayOS phải kiểm mã kết quả                                        */
/* ------------------------------------------------------------------ */

S.section('PayOS: từ chối giao dịch không thành công');

S.ok(
  /reason: 'NOT_SUCCESS'/.test(payCode),
  'payments.js: có nhánh NOT_SUCCESS',
);
S.ok(
  /resultCode !== '' && resultCode !== '00'/.test(payCode),
  "payments.js: từ chối khi code khác '00'",
);
S.ok(
  /reason: 'ZERO_AMOUNT'/.test(payCode),
  'payments.js: có nhánh ZERO_AMOUNT (giữ nguyên từ trước)',
);

/* Mô phỏng quyết định của payosWebhook để chứng minh hành vi. */
function payosDecision(data, expected) {
  const amount = Math.floor(Number(data.amount) || 0);
  if (amount <= 0) return { action: 'IGNORE', reason: 'ZERO_AMOUNT' };
  const resultCode = data.code !== undefined && data.code !== null ? String(data.code) : '';
  if (resultCode !== '' && resultCode !== '00') {
    return { action: 'IGNORE', reason: 'NOT_SUCCESS', code: resultCode };
  }
  const paid = Math.floor(Number(amount) || 0);
  return { action: paid >= expected ? 'DELIVER' : 'WRONG_AMOUNT', paid };
}

S.eq(payosDecision({}, EXPECTED).reason, 'ZERO_AMOUNT', 'thiếu amount -> BỎ QUA');
S.eq(payosDecision({ amount: 0 }, EXPECTED).reason, 'ZERO_AMOUNT', 'amount 0 -> BỎ QUA');
S.eq(
  payosDecision({ amount: 180_000, code: '01' }, EXPECTED).reason,
  'NOT_SUCCESS',
  "code '01' (không thành công) -> BỎ QUA dù đủ tiền",
);
S.eq(
  payosDecision({ amount: 180_000, code: '00' }, EXPECTED).action,
  'DELIVER',
  "code '00' + đủ tiền -> GIAO HÀNG (đường đúng vẫn chạy)",
);
S.eq(
  payosDecision({ amount: 50_000, code: '00' }, EXPECTED).action,
  'WRONG_AMOUNT',
  'thiếu tiền -> ghi nhận sai số tiền, không giao',
);

process.exit(S.summary() ? 0 : 1);
