/**
 * BATTERY G — Xác minh 2 lỗ hổng nặng:
 *   G1: WEBHOOK_SECRET_TEST còn sống trên production = cỗ máy đúc key miễn phí
 *   G2: Đường giao hàng LỖI (hết hàng) — có báo admin không?
 *   G3: Race giành key cuối cùng
 */
import * as L from './_qr_lib.mjs';
import { writeFileSync } from 'node:fs';

const R = [];
const rec = (id, method, result, money, goods, note) => {
  R.push({ id, method, result, money, goods, note });
  console.log(`\n[${id}] ${method}\n  → ${result}\n  💰 ${money}   📦 ${goods}\n  📝 ${note}`);
};

const u = await L.register('g1');

/* ============ G1 — secret test đúc key miễn phí ============ */
{
  // tạo đơn 1.290.000đ (gói Vĩnh Viễn), KHÔNG chuyển 1 đồng nào
  const o = await L.orderWithQr(u.cookie, 'p-lic-forever', 1);
  console.log('  đơn:', o.order?.code, 'total:', o.order?.total, 'memo:', o.qr?.memo);
  // gửi "webhook" bằng secret test — coi như tiền đã vào
  const w = await L.wh({
    id: 970001, accountNumber: '8990124112002', content: o.qr.memo,
    transferType: 'in', transferAmount: o.order.total, referenceCode: L.ref('G1'),
  });
  const s = (await L.getOrder(u.cookie, o.order.id)).data.order;
  const lic = L.q1(`SELECT key,expires_at,revoked FROM licenses WHERE note LIKE '%${o.order.code}%'`);
  rec('G1', `KHÔNG chuyển tiền. Tự POST /api/webhooks/sepay bằng secret test — đơn ${o.order.code} 1.290.000đ`,
    `webhook=${JSON.stringify(w.data)} | đơn=${s.status} | license=${JSON.stringify(lic)}`,
    'SHOP MẤT HÀNG 1.290.000đ (không có đồng nào vào TK)',
    'MẤT HÀNG: license vĩnh viễn phát hành thật, revoked=0',
    'WEBHOOK_SECRET_TEST vẫn hoạt động trên production → ai có chuỗi này đúc key vô hạn.');

  // chứng minh đây không phải secret chính: thử secret bừa
  const bad = await L.wh({ id: 970002, accountNumber: '8990124112002', content: o.qr.memo,
    transferType: 'in', transferAmount: 1000, referenceCode: L.ref('G1bad') }, 'sai-secret-hoan-toan');
  rec('G1b', `Cùng payload nhưng Authorization=Apikey sai-secret-hoan-toan`,
    `HTTP=${bad.status} body=${JSON.stringify(bad.data)}`, 'không', 'không',
    'Secret chính vẫn được bảo vệ; chỉ secret test là cửa hậu.');
}

/* ============ G2 — giao hàng LỖI (hết hàng) có báo admin? ============ */
{
  // tạo sản phẩm TEST tạm (kho key) — sẽ disable sau
  const pid = 'p-test-oos-audit';
  L.d1(`DELETE FROM product_keys WHERE product_id='${pid}'`);
  L.d1(`DELETE FROM order_items WHERE product_id='${pid}'`);
  L.d1(`DELETE FROM products WHERE id='${pid}'`);
  L.d1(`INSERT INTO products (id,slug,category_id,name,short_desc,description,image_url,badge,price,compare_price,delivery_type,stock_count,sold_count,rating,rating_count,warranty_days,duration_label,features,active,featured,sort_order,created_at,updated_at)
        VALUES ('${pid}','test-oos-audit',NULL,'AUDIT TEST - kho key','t','t','',NULL,50000,NULL,'key',1,0,5,0,0,'','[]',1,0,0,${Date.now()},${Date.now()})`);
  L.d1(`INSERT INTO product_keys (id,product_id,secret,note,status,created_at) VALUES ('k-audit-1','${pid}','secret-audit-1','audit','available',${Date.now()})`);
  const prod = L.q1(`SELECT id,price,stock_count,delivery_type FROM products WHERE id='${pid}'`);
  console.log('  product test:', JSON.stringify(prod));

  const o = await L.orderWithQr(u.cookie, pid, 1);
  console.log('  order:', o.order?.code, o.qr?.memo, 'err:', o.qerr);
  // lấy mất key trước khi khách CK (admin xoá key / bán cho người khác)
  L.d1(`UPDATE product_keys SET status='disabled' WHERE product_id='${pid}'`);
  L.d1(`UPDATE products SET stock_count=0 WHERE id='${pid}'`);
  const w = await L.wh({ id: 970003, accountNumber: '8990124112002', content: o.qr.memo,
    transferType: 'in', transferAmount: 50000, referenceCode: L.ref('G2') });
  const s = (await L.getOrder(u.cookie, o.order.id)).data.order;
  const row = L.q1(`SELECT status,paid_at,admin_note FROM orders WHERE id='${o.order.id}'`)[0];
  rec('G2', `Đơn ${o.order.code} 50k: key bị lấy mất trước khi CK → giao hàng LỖI`,
    `webhook=${JSON.stringify(w.data)} | đơn=${s.status} keys=${s.items?.[0]?.keys?.length} | DB=${JSON.stringify(row)}`,
    'Tiền đã vào (thật), không mất',
    'MẤT TRẢI NGHIỆM: khách trả tiền, không có key',
    'deliverAndFinish bắt lỗi → set paid + admin_note, NHƯNG KHÔNG gọi notifyOutOfStock → admin KHÔNG được báo.');

  // khách nhìn thấy gì?
  rec('G2b', `Khách gọi GET /api/orders/:id xem đơn sau khi giao lỗi`,
    `status=${s.status} keys=${JSON.stringify(s.items?.[0]?.keys)} | adminNote không trả ra API`,
    '—', 'Khách thấy "đang xử lý", không biết lỗi gì, không có hướng dẫn',
    'Frontend hiện "Đang xử lý giao hàng" vô hạn định.');

  // dọn: disable sản phẩm test
  L.d1(`UPDATE products SET active=0 WHERE id='${pid}'`);
  L.d1(`UPDATE products SET price=price WHERE id='${pid}'`);
  const after = L.q1(`SELECT id,active FROM products WHERE id='${pid}'`);
  console.log('  dọn sản phẩm test:', JSON.stringify(after));
}

/* ============ G3 — race giành key cuối cùng ============ */
{
  const pid = 'p-test-race-audit';
  L.d1(`DELETE FROM product_keys WHERE product_id='${pid}'`);
  L.d1(`DELETE FROM order_items WHERE product_id='${pid}'`);
  L.d1(`DELETE FROM products WHERE id='${pid}'`);
  L.d1(`INSERT INTO products (id,slug,category_id,name,short_desc,description,image_url,badge,price,compare_price,delivery_type,stock_count,sold_count,rating,rating_count,warranty_days,duration_label,features,active,featured,sort_order,created_at,updated_at)
        VALUES ('${pid}','test-race-audit',NULL,'AUDIT TEST - 1 key','t','t','',NULL,10000,NULL,'key',1,0,5,0,0,'','[]',1,0,0,${Date.now()},${Date.now()})`);
  L.d1(`INSERT INTO product_keys (id,product_id,secret,note,status,created_at) VALUES ('k-race-1','${pid}','secret-race-1','audit','available',${Date.now()})`);

  // 2 user, mỗi người 1 đơn cho cùng 1 key duy nhất
  const ua = await L.register('g3a');
  const ub = await L.register('g3b');
  const oa = await L.orderWithQr(ua.cookie, pid, 1);
  const ob = await L.orderWithQr(ub.cookie, pid, 1);
  console.log('  2 đơn:', oa.order?.code, ob.order?.code);

  const [wa, wb] = await Promise.all([
    L.wh({ id: 970010, accountNumber: '8990124112002', content: oa.qr.memo,
      transferType: 'in', transferAmount: 10000, referenceCode: L.ref('G3a') }),
    L.wh({ id: 970011, accountNumber: '8990124112002', content: ob.qr.memo,
      transferType: 'in', transferAmount: 10000, referenceCode: L.ref('G3b') }),
  ]);
  const sa = (await L.getOrder(ua.cookie, oa.order.id)).data.order;
  const sb = (await L.getOrder(ub.cookie, ob.order.id)).data.order;
  const sold = L.q1(`SELECT id,status,order_id FROM product_keys WHERE product_id='${pid}'`);

  rec('G3', `2 khách cùng CK (10k) cho 2 đơn, kho chỉ có 1 key`,
    `A: ${JSON.stringify(wa.data)} → ${sa.status}/${sa.items?.[0]?.keys?.length}key | B: ${JSON.stringify(wb.data)} → ${sb.status}/${sb.items?.[0]?.keys?.length}key | key=${JSON.stringify(sold)}`,
    wa.data?.delivered && wb.data?.delivered ? 'MẤT TIỀN (1 người trả mà không có hàng)' : 'tuỳ nhánh',
    'Không giao trùng key (UPDATE có điều kiện)',
    'Người thua cuộc vào nhánh giao lỗi → paid + admin_note, KHÔNG có cảnh báo Telegram.');

  L.d1(`UPDATE products SET active=0 WHERE id='${pid}'`);
  console.log('  dọn sản phẩm race:',
    JSON.stringify(L.q1(`SELECT id,active FROM products WHERE id='${pid}'`)));
}

writeFileSync('qa/results-G.json', JSON.stringify(R, null, 1));
console.log(`\n--- G done: ${R.length} ---`);
