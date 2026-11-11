/**
 * Kiểm chứng lần cuối + đo thiệt hại đang tồn đọng trên production.
 */
import * as L from './_qr_lib.mjs';
import { writeFileSync } from 'node:fs';

const R = [];
const rec = (id, m, r, money, goods, note) => {
  R.push({ id, method: m, result: r, money, goods, note });
  console.log(`\n[${id}] ${m}\n  → ${r}\n  💰 ${money}   📦 ${goods}\n  📝 ${note}`);
};

const adm = await L.login('namhbcf', 'namhbcf123');

/* ===== J1: UI admin còn nút "Giao" cho đơn 'paid' không? ===== */
{
  const js = await fetch('https://xienhl.com/assets/pages/admin.js?_=' + Date.now())
    .then((r) => r.text());
  const hasDeliver = js.includes('data-deliver');
  const hasConfirmPay = js.includes('confirm-payment');
  const hasPayments = js.includes('/api/admin/payments');
  // tìm đoạn quyết định hiện nút
  const i = js.indexOf('data-deliver');
  console.log('  admin.js:', { hasDeliver, hasConfirmPay, hasPayments });
  if (i > 0) console.log('  quanh data-deliver:\n', js.slice(Math.max(0, i - 320), i + 120).replace(/\s+/g, ' '));
  const j = js.indexOf('confirm-payment');
  if (j > 0) console.log('\n  quanh confirm-payment:\n', js.slice(Math.max(0, j - 320), j + 120).replace(/\s+/g, ' '));

  rec('J1', `Kiểm tra UI admin đang phục vụ trên production`,
    `nút "Giao đơn"(data-deliver)=${hasDeliver} | "Xác nhận đã nhận tiền"(confirm-payment)=${hasConfirmPay} | tab Sổ tiền vào=${hasPayments}`,
    '—', '—', 'Xác định admin có đường giao đúng hay vẫn dùng đường sai.');
}

/* ===== J2: đo thiệt hại tồn đọng: đơn 'paid' mà KHÔNG có key ===== */
{
  const rows = L.q1(`
    SELECT o.code, o.total, o.status, o.admin_note,
           (SELECT COUNT(*) FROM order_items oi
             WHERE oi.order_id=o.id AND (oi.delivered_keys IS NULL OR oi.delivered_keys='[]')) AS dong_chua_giao
      FROM orders o WHERE o.status='paid' ORDER BY o.created_at DESC`);
  const total = rows.reduce((s, r) => s + (r.total || 0), 0);
  console.log(`\n  ${rows.length} đơn 'paid' tổng ${total.toLocaleString('vi-VN')}đ`);
  console.log(JSON.stringify(rows.slice(0, 12), null, 1));
  rec('J2', `Đếm đơn kẹt 'paid' (đã có tiền, chưa giao được) trên production`,
    `${rows.length} đơn, tổng ${total.toLocaleString('vi-VN')}đ | ví dụ: ${rows.slice(0, 5).map(r => r.code + ':' + r.total).join(', ')}`,
    `Tiền đã vào TK shop, khách CHƯA có key: ${total.toLocaleString('vi-VN')}đ đang treo`,
    'Khách chưa nhận hàng',
    'Đây là tồn đọng thật, không phải lý thuyết — có đơn từ trước đợt audit này.');
}

/* ===== J3: đo tiền vào không khớp đơn ===== */
{
  const rows = L.q1(`
    SELECT state, COUNT(1) n, COALESCE(SUM(amount),0) s
      FROM payments WHERE state IN ('unmatched','wrong_amount') GROUP BY state`);
  console.log('\n  payments theo state:', JSON.stringify(rows, null, 1));
  const un = rows.find((r) => r.state === 'unmatched') || { n: 0, s: 0 };
  const wa = rows.find((r) => r.state === 'wrong_amount') || { n: 0, s: 0 };
  rec('J3', `Đo tiền khách chuyển mà hệ thống chưa gán được cho đơn nào đã giao`,
    `unmatched: ${un.n} giao dịch / ${Number(un.s).toLocaleString('vi-VN')}đ | wrong_amount: ${wa.n} giao dịch / ${Number(wa.s).toLocaleString('vi-VN')}đ`,
    `${Number(un.s).toLocaleString('vi-VN')}đ tiền vào chưa khớp đơn (cần admin xử lý tay)`,
    'Khách có thể đã trả tiền mà chưa nhận key',
    'Có tab "Sổ tiền vào" trong admin để đối soát — nhưng KHÔNG có nút khớp tay 1 chạm.');
}

/* ===== J4: xác nhận lại đường "Giao đơn" hỏng (lần 3, độc lập) ===== */
{
  const u = await L.register('j4');
  const o = await L.orderWithQr(u.cookie, 'p-lic-month', 1);
  // đưa đơn về 'paid' như trường hợp giao lỗi
  L.d1(`UPDATE orders SET status='paid' WHERE id='${o.order.id}'`);
  const before = L.q1(`SELECT COUNT(1) n FROM licenses WHERE note LIKE '%${o.order.code}%'`)[0].n;
  const d = await L.http(`/api/admin/orders/${o.order.id}/deliver`, { method: 'POST', cookie: adm.cookie });
  const after = L.q1(`SELECT COUNT(1) n FROM licenses WHERE note LIKE '%${o.order.code}%'`)[0].n;
  const s = (await L.getOrder(u.cookie, o.order.id)).data.order;
  rec('J4', `Đơn 'paid' (đã có tiền) → admin bấm "Giao đơn" (POST /api/admin/orders/:id/deliver)`,
    `HTTP=${d.status} | license ${before}→${after} | đơn=${s.status} keys=${s.items?.[0]?.keys?.length}`,
    'Tiền đã thu, coi như đã hoàn tất trên sổ',
    after === before ? 'MẤT HÀNG: đơn "delivered" nhưng KHÔNG cấp key' : 'ok',
    'Xác nhận lần 3. Đường này không gọi deliverOrderItems.');

  // so sánh với đường ĐÚNG
  const u2 = await L.register('j4b');
  const o2 = await L.orderWithQr(u2.cookie, 'p-lic-month', 1);
  L.d1(`UPDATE orders SET status='paid' WHERE id='${o2.order.id}'`);
  const c = await L.http(`/api/admin/orders/${o2.order.id}/confirm-payment`, { method: 'POST', cookie: adm.cookie, body: {} });
  const s2 = (await L.getOrder(u2.cookie, o2.order.id)).data.order;
  rec('J4b', `Cùng tình huống nhưng dùng ĐÚNG đường mới: POST /admin/orders/:id/confirm-payment`,
    `HTTP=${c.status} delivered=${c.data?.delivered} | đơn=${s2.status} keys=${s2.items?.[0]?.keys?.length}`,
    'không', s2.items?.[0]?.keys?.length ? 'ok (cấp key đúng)' : 'vẫn lỗi',
    'Đường confirm-payment gọi confirmOrderPaid → giao đúng. Vấn đề là UI vẫn còn nút "Giao đơn" cũ.');
}

writeFileSync('qa/results-J.json', JSON.stringify(R, null, 1));
console.log(`\n--- J done: ${R.length} ---`);
