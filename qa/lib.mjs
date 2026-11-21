/**
 * lib.mjs — helper dùng chung cho script QA, ĐÃ QUA TARGET GUARD.
 *
 * ============================================================================
 * F15 — SỬA LỖI GỐC
 *
 * Bản cũ:
 *     import { Client, q, q1, BASE } from './q.mjs';
 *     export const SECRET = readFileSync('WEBHOOK_SECRET.txt', 'utf8').trim();
 *
 * Nghĩa là MỌI script QA đều: tạo user thật, tạo đơn thật, rồi gửi webhook
 * TỰ KÝ bằng secret thật vào domain production. Đó chính là cách một đơn
 * 1.290.000đ được giao license vĩnh viễn mà không có đồng nào vào ngân hàng
 * (qa/results-G.json G1).
 *
 * NAY:
 *   - Không đọc secret từ file. Secret chỉ lấy từ `QA_WEBHOOK_SECRET`.
 *   - Không có BASE hardcode. Mọi client đi qua target guard.
 *   - `newUser` / `makeOrder` / `getQr` / `hook` đều là thao tác GHI, nên
 *     chúng dùng `writeClient()` — tự chặn trên production.
 * ============================================================================
 */
import { writeClient, currentTarget, QAGuardError } from './q.mjs';

/**
 * Secret webhook của MÔI TRƯỜNG KIỂM THỬ.
 *
 * KHÔNG đọc từ WEBHOOK_SECRET.txt: file đó là secret production, dùng nó để
 * ký webhook nghĩa là tự đúc được "tiền vào" thật.
 */
export function webhookSecret() {
  const s = String(process.env.QA_WEBHOOK_SECRET || '').trim();
  if (!s) {
    throw new QAGuardError(
      'QA_WEBHOOK_SECRET_REQUIRED',
      'Thiếu QA_WEBHOOK_SECRET.\n'
      + 'Script QA không được dùng secret của production để tự ký webhook.\n'
      + 'Đặt secret RIÊNG cho môi trường kiểm thử (wrangler dev + .dev.vars).',
    );
  }
  return s;
}

export const R = []; // results
export function rec(id, name, pass, note = '') {
  R.push({ id, name, pass, note });
  console.log(`${pass ? 'PASS' : 'FAIL'} | ${id}. ${name}${note ? ' :: ' + note : ''}`);
}

/** Client GHI — ném lỗi ngay nếu target là production. */
export function client() {
  return writeClient({ what: 'QA client' });
}

export async function newUser(tag) {
  const c = client();
  const name = `qa${tag}${Date.now().toString(36).slice(-6)}`;
  const r = await c.req('/api/auth/register', {
    method: 'POST',
    body: { username: name, password: process.env.QA_TEST_PASSWORD || `Qa-${Date.now()}-Pass!` },
  });
  if (r.status !== 201) throw new Error(`register failed ${r.status} ${r.text}`);
  c.username = name;
  c.userId = r.json.user.id;
  return c;
}

/** Tạo đơn — thao tác GHI. */
export async function makeOrder(c, productId = 'p-lic-month', quantity = 1) {
  return c.req('/api/orders', {
    method: 'POST',
    body: { items: [{ productId, quantity }] },
  });
}

export async function getQr(c, orderId) {
  return c.req(`/api/orders/${orderId}/qr`, { method: 'POST' });
}

/**
 * Gửi webhook thử — CHỈ trên môi trường kiểm thử.
 *
 * Secret bắt buộc là `QA_WEBHOOK_SECRET`, không phải secret production.
 */
export async function hook(body, secret = null) {
  const t = currentTarget();
  if (t.isProduction) {
    throw new QAGuardError(
      'PRODUCTION_WEBHOOK',
      `TỪ CHỐI gửi webhook thử vào production (${t.base}).`,
    );
  }
  const s = secret || webhookSecret();
  const r = await fetch(t.base + '/api/webhooks/sepay', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Apikey ${s}` },
    body: JSON.stringify(body),
  });
  return { status: r.status, json: await r.json().catch(() => null) };
}

export function dump() {
  console.log('\n\n===== SUMMARY =====');
  let p = 0, f = 0;
  for (const r of R) { if (r.pass) p++; else f++; }
  console.log(`PASS=${p} FAIL=${f} TOTAL=${R.length}`);
  if (f) {
    console.log('\nFAILED:');
    for (const r of R) if (!r.pass) console.log(`  ${r.id}. ${r.name} :: ${r.note}`);
  }
}
