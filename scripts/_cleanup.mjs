/**
 * CLEANUP — thu hồi license phát hành bằng secret test, ẩn sản phẩm test.
 * KHÔNG xoá đơn/payments (giữ làm bằng chứng).
 */
import * as L from './_qr_lib.mjs';

console.log('=== TRƯỚC ===');
console.log('license của đơn G1 (MBK-2S924V):',
  JSON.stringify(L.q1("SELECT key,revoked FROM licenses WHERE note LIKE '%MBK-2S924V%'")));

// 1. Thu hồi license phát hành miễn phí ở G1
L.d1("UPDATE licenses SET revoked = 1 WHERE note LIKE '%MBK-2S924V%'");
console.log('sau thu hồi:',
  JSON.stringify(L.q1("SELECT key,revoked FROM licenses WHERE note LIKE '%MBK-2S924V%'")));

// 2. Sản phẩm test: đặt active=0 (đã làm) + đổi tên để admin thấy rõ là rác audit
L.d1(`UPDATE products SET active = 0, name = 'AUDIT-TEST (xoa duoc)' WHERE id LIKE 'p-test-%-audit'`);
console.log('sản phẩm test:',
  JSON.stringify(L.q1("SELECT id,name,active FROM products WHERE id LIKE 'p-test-%-audit'")));

// 3. Xác nhận sản phẩm thật còn nguyên
console.log('\n=== SẢN PHẨM THẬT ===');
console.log(JSON.stringify(L.q1(
  "SELECT id,name,active,price,delivery_type,stock_count FROM products WHERE id LIKE 'p-lic-%' ORDER BY id"), null, 1));

// 4. Đếm rác audit để báo cáo
console.log('\n=== RÁC DO AUDIT TẠO ===');
console.log('users audit:', JSON.stringify(L.q1(
  "SELECT COUNT(1) AS n FROM users WHERE username LIKE 'aud%' OR username LIKE 'a1%' OR username LIKE 'a2%' OR username LIKE 'b1%' OR username LIKE 'c1%' OR username LIKE 'd1%' OR username LIKE 'e1%' OR username LIKE 'f30%' OR username LIKE 'f32%' OR username LIKE 'f34b%' OR username LIKE 'g1%' OR username LIKE 'g3a%' OR username LIKE 'g3b%' OR username LIKE 'g4%'")));
console.log('orders pending:', JSON.stringify(L.q1("SELECT COUNT(1) AS n FROM orders WHERE status='pending'")));
console.log('license tổng:', JSON.stringify(L.q1('SELECT COUNT(1) AS n, SUM(revoked) AS r FROM licenses')));
