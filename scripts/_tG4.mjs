/**
 * G4 — Đường PHỤC HỒI của admin: đơn 'paid' do giao lỗi, admin nhập lại hàng
 * rồi bấm "Giao đơn" (POST /api/admin/orders/:id/deliver).
 * Khách có thật sự nhận được key không?
 */
import * as L from './_qr_lib.mjs';
import { writeFileSync } from 'node:fs';

const R = [];
const rec = (id, method, result, money, goods, note) => {
  R.push({ id, method, result, money, goods, note });
  console.log(`\n[${id}] ${method}\n  → ${result}\n  💰 ${money}   📦 ${goods}\n  📝 ${note}`);
};

const adm = await L.login('namhbcf', 'namhbcf123');
const u = await L.register('g4');
const pid = 'p-test-recv-audit';

L.d1(`DELETE FROM product_keys WHERE product_id='${pid}'`);
L.d1(`DELETE FROM order_items WHERE product_id='${pid}'`);
L.d1(`DELETE FROM products WHERE id='${pid}'`);
L.d1(`INSERT INTO products (id,slug,category_id,name,short_desc,description,image_url,badge,price,compare_price,delivery_type,stock_count,sold_count,rating,rating_count,warranty_days,duration_label,features,active,featured,sort_order,created_at,updated_at)
      VALUES ('${pid}','test-recv-audit',NULL,'AUDIT TEST - phuc hoi','t','t','',NULL,50000,NULL,'key',0,0,5,0,0,'','[]',1,0,0,${Date.now()},${Date.now()})`);

// Đơn 1 key nhưng kho trống NGAY -> tạo đơn thất bại, nên phải có 1 key lúc đặt
L.d1(`INSERT INTO product_keys (id,product_id,secret,note,status,created_at) VALUES ('k-recv-1','${pid}','secret-recv-1','audit','available',${Date.now()})`);
L.d1(`UPDATE products SET stock_count=1 WHERE id='${pid}'`);

const o = await L.orderWithQr(u.cookie, pid, 1);
console.log('order:', o.order?.code, o.qr?.memo);

// key bị mất trước khi CK
L.d1(`UPDATE product_keys SET status='disabled' WHERE product_id='${pid}'`);
L.d1(`UPDATE products SET stock_count=0 WHERE id='${pid}'`);

const w = await L.wh({ id: 980001, accountNumber: '8990124112002', content: o.qr.memo,
  transferType: 'in', transferAmount: 50000, referenceCode: L.ref('G4') });
let s = (await L.getOrder(u.cookie, o.order.id)).data.order;
rec('G4a', `CK xong nhưng kho trống → giao lỗi`,
  `webhook=${JSON.stringify(w.data)} | đơn=${s.status} keys=${s.items?.[0]?.keys?.length}`,
  'tiền đã vào', 'khách chưa có key', 'admin_note ghi lỗi, không báo Telegram.');

// admin NHẬP LẠI HÀNG
L.d1(`INSERT INTO product_keys (id,product_id,secret,note,status,created_at) VALUES ('k-recv-2','${pid}','secret-recv-2','audit','available',${Date.now()})`);
L.d1(`UPDATE products SET stock_count=1 WHERE id='${pid}'`);

// admin bấm "Giao đơn" (đường web admin)
const d = await L.http(`/api/admin/orders/${o.order.id}/deliver`, { method: 'POST', cookie: adm.cookie });
s = (await L.getOrder(u.cookie, o.order.id)).data.order;
const keys = s.items?.[0]?.keys || [];
const soldRows = L.q1(`SELECT id,status,order_id FROM product_keys WHERE product_id='${pid}'`);

rec('G4b', `Admin nhập lại hàng rồi bấm "Giao đơn" (POST /admin/orders/:id/deliver)`,
  `HTTP=${d.status} | đơn=${s.status} keys=${JSON.stringify(keys)} | product_keys=${JSON.stringify(soldRows)}`,
  'không (tiền đã thu)',
  keys.length === 0 ? 'MẤT HÀNG: đơn thành "delivered" nhưng KHÔNG cấp key' : 'ok',
  'adminDeliverManual CHỈ đổi status, KHÔNG gọi deliverOrderItems → khách thấy "đã giao" với 0 key, kho vẫn còn key.');

// khách thấy gì trên UI/API
rec('G4c', `Khách xem đơn sau khi admin bấm "Giao đơn"`,
  `status=${s.status} keys=${JSON.stringify(keys)}`,
  '—',
  keys.length === 0 ? 'Khách nhận 0 key dù đơn "delivered" → mất tiền thật' : 'ok',
  'Trạng thái delivered khiến UI hiện "đã giao" và KHÔNG cho admin/giao lại nữa.');

L.d1(`UPDATE products SET active=0 WHERE id='${pid}'`);
console.log('dọn:', JSON.stringify(L.q1(`SELECT id,active FROM products WHERE id='${pid}'`)));

writeFileSync('qa/results-G4.json', JSON.stringify(R, null, 1));
