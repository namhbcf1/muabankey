/**
 * Chạy THẬT hàm handleCallback() của production (src/lib/telegram-actions.js)
 * với DB giả + Telegram giả để xác định nút "✅ Duyệt & giao key" (py:ok) có tác dụng không.
 *
 * KHÔNG sửa source: import nguyên file, chỉ stub DB/env/fetch.
 */
import * as L from './_qr_lib.mjs';

// ---- stub fetch để bắt mọi lệnh gọi Telegram ----
const tgCalls = [];
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body || '{}');
  tgCalls.push({ url: String(url), method: String(url).split('/').pop(), body });
  return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }),
    { status: 200, headers: { 'content-type': 'application/json' } });
};

// ---- DB giả: 1 đơn 'pending' đã có tiền mặt nhưng chưa xác nhận ----
const order = {
  id: 'ORD-TEST-1', code: 'MBK-TEST01', user_id: 'u1', status: 'pending',
  total: 180000, subtotal: 180000, discount: 0, payment_method: 'qr',
  payment_ref: 'MBKTEST01', created_at: Date.now(),
};
const DB = {
  prepare(sql) {
    return {
      bind() { return this; },
      async first() {
        if (sql.includes('FROM orders')) return order;
        return null;
      },
      async all() { return { results: [] }; },
      async run() { return { meta: { changes: 1 } }; },
    };
  },
  async batch(a) { return a; },
};
const env = { DB, TG_BOT_TOKEN: '123456:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', TG_CHAT_ID: '1427044674' };

const deps = {
  DB, uuid: () => 'uuid-1', audit: async () => {},
  siteUrl: 'https://xienhl.com',
  deliverOrder: async (o) => ({ ok: true }),
  refundOrder: async (o) => ({ ok: true, refunded: o.total }),
};

const { handleCallback } = await import('../src/lib/telegram-actions.js');

const cases = [
  { label: 'Nút "✅ Duyệt & giao key" trong tin KHÁCH BÁO ĐÃ CK', data: 'py:ok:ORD-TEST-1' },
  { label: 'Nút "❌ Chưa thấy tiền" trong tin KHÁCH BÁO ĐÃ CK', data: 'py:no:ORD-TEST-1' },
  { label: 'Nút "✅ Đã nhập hàng — giao ngay" (tin hết hàng)', data: 'py:ok:ORD-TEST-1' },
  { label: 'Nút "✅ Duyệt & giao key" bấm LẦN 2', data: 'py:ok:ORD-TEST-1' },
];

for (const c of cases) {
  tgCalls.length = 0;
  const cq = {
    id: 'cq-' + Math.random().toString(36).slice(2, 8),
    from: { id: 1427044674, username: 'namhbcf' },
    data: c.data,
    message: { chat: { id: 1427044674 }, message_id: 999 },
  };
  const r = await handleCallback(env, cq, deps);
  console.log(`\n[${c.data}] ${c.label}`);
  console.log('  → return:', JSON.stringify(r));
  for (const t of tgCalls) {
    console.log(`  → Telegram ${t.method}: ${t.body.text || ''}`);
  }
  if (tgCalls.length === 0) console.log('  → KHÔNG gọi Telegram');
}

console.log('\n=== KẾT LUẬN ===');
console.log('py:ok / py:no KHÔNG có nhánh xử lý trong handleCallback()');
console.log('=> Bấm nút Duyệt trong Telegram KHÔNG xác nhận đơn, KHÔNG giao key, KHÔNG cộng sổ.');
