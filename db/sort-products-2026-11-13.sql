-- Sắp xếp lại sản phẩm cho GỌN: nhóm theo sản phẩm, trong nhóm theo thời hạn.
--
-- VẤN ĐỀ HIỆN TẠI (khách báo "xấu và lộn xộn"):
--   sort_order của 4 gói XAGR mới = 0, còn AOE1 = 20..23.
--   ORDER BY featured DESC, sort_order ASC nên 4 gói XAGR (sort=0) nhảy lên
--   đầu, chèn giữa các gói AOE1 -> hai sản phẩm trộn lẫn nhau.
--
-- THIẾT KẾ MỚI:
--   AOE1 (XARENA MAP SÁNG)   : sort_order 100..106
--   XAGR (XA THÊM TÀI NGUYÊN) : sort_order 200..204
--   -> Cách nhau 100, đủ rộng để sau này thêm gói mà không phải đánh lại số.
--
--   Trong mỗi nhóm: xếp theo THỜI HẠN TĂNG DẦN (7 -> 30 -> 90 -> 180 -> 365
--   -> vĩnh viễn). Khách đọc từ trên xuống thấy dãy thời hạn liền mạch.
--
--   featured = 1 CHỈ cho 2 gói đại diện (tháng của mỗi sản phẩm), không để
--   featured đẩy lộn xộn. featured DESC chỉ có tác dụng khi cùng sort_order.
--
-- Ghi chú: `featured` vẫn giữ cho trang chủ (getFeatured) nhưng ở trang danh
-- sách, sort_order quyết định thứ tự nên không bị nhảy.

-- ================= XARENA MAP SÁNG (AOE1) =================
-- Vĩnh viễn: đắt nhất, để cuối nhóm
UPDATE products SET sort_order = 106, featured = 0
WHERE license_prefix = 'AOE1' AND license_days = 0;

UPDATE products SET sort_order = 100, featured = 0
WHERE license_prefix = 'AOE1' AND license_days = 7;

UPDATE products SET sort_order = 101, featured = 1
WHERE license_prefix = 'AOE1' AND license_days = 30;

UPDATE products SET sort_order = 102, featured = 0
WHERE license_prefix = 'AOE1' AND license_days = 90;

UPDATE products SET sort_order = 103, featured = 0
WHERE license_prefix = 'AOE1' AND license_days = 180;

UPDATE products SET sort_order = 104, featured = 0
WHERE license_prefix = 'AOE1' AND license_days = 365;

-- ================= XA THÊM TÀI NGUYÊN (XAGR) =================
UPDATE products SET sort_order = 200, featured = 0
WHERE license_prefix = 'XAGR' AND license_days = 7;

UPDATE products SET sort_order = 201, featured = 1
WHERE license_prefix = 'XAGR' AND license_days = 30;

UPDATE products SET sort_order = 202, featured = 0
WHERE license_prefix = 'XAGR' AND license_days = 90;

UPDATE products SET sort_order = 203, featured = 0
WHERE license_prefix = 'XAGR' AND license_days = 180;

-- Gói năm đã ẩn nhưng vẫn đánh số để nếu bật lại thì đúng chỗ
UPDATE products SET sort_order = 204, featured = 0
WHERE license_prefix = 'XAGR' AND license_days = 365;

-- Kiểm tra
SELECT license_prefix, license_days, sort_order, featured, active, price
FROM products
WHERE active = 1
ORDER BY sort_order;
