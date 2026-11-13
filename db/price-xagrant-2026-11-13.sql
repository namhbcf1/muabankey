-- Gia XA THÊM TÀI NGUYÊN (XAGR) — chốt 2026-11-13
--
-- Chủ shop chốt:
--   Tuần     30.000đ   (cũ 10.000)
--   Tháng    90.000đ   (cũ 30.000)
--   3 tháng  200.000đ  (cũ 80.000)
--   6 tháng  350.000đ  (cũ 150.000)
--   1 năm    ẨN       (active = 0): để 6 tháng 350k rồi bán năm 200k
--                      thì khách chỉ mua gói năm -> lỗ.
--
-- Giá gạch = round(giá / 0.45) -> giữ đúng mức giảm 55% như 11 gói hiện tại.
--   Tuần     30.000 / 0.45 =  66.667 ->  66.000
--   Tháng    90.000 / 0.45 = 200.000 -> 200.000
--   3 tháng 200.000 / 0.45 = 444.444 -> 444.000
--   6 tháng 350.000 / 0.45 = 777.778 -> 778.000
--
-- short_desc: phần trăm tiết kiệm tính so với gói THÁNG (90.000đ / 30 ngày):
--   Tuần    : 30.000đ / 7 ngày   = 4.286đ/ngày  (đắt hơn theo ngày — hợp lý)
--   Tháng   : 90.000đ / 30 ngày  = 3.000đ/ngày  (mốc chuẩn)
--   3 tháng : 200.000đ / 90 ngày = 2.222đ/ngày  -> rẻ hơn 26%
--   6 tháng : 350.000đ / 180 ngày= 1.944đ/ngày  -> rẻ hơn 35%
--
-- Dùng WHERE theo (license_prefix, license_days) — KHÔNG theo id hay slug,
-- vì production có thể đã đổi id trong lần đổi tên sản phẩm trước đó.

-- ---------- Tuần: 30.000 ----------
UPDATE products SET
  price         = 30000,
  compare_price = 66000,
  badge         = 'RẺ',
  short_desc    = '7 ngày sử dụng, kích hoạt 1 máy, giao key tự động.',
  active        = 1,
  updated_at    = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE license_prefix = 'XAGR' AND license_days = 7;

-- ---------- Tháng: 90.000 ----------
UPDATE products SET
  price         = 90000,
  compare_price = 200000,
  badge         = 'HOT',
  short_desc    = '30 ngày sử dụng, kích hoạt 1 máy, giao key tự động.',
  active        = 1,
  updated_at    = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE license_prefix = 'XAGR' AND license_days = 30;

-- ---------- 3 tháng: 200.000 ----------
UPDATE products SET
  price         = 200000,
  compare_price = 444000,
  badge         = 'SALE',
  short_desc    = '90 ngày sử dụng, kích hoạt 1 máy, rẻ hơn 26% so với gói tháng.',
  active        = 1,
  updated_at    = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE license_prefix = 'XAGR' AND license_days = 90;

-- ---------- 6 tháng: 350.000 ----------
UPDATE products SET
  price         = 350000,
  compare_price = 778000,
  badge         = 'SALE',
  short_desc    = '180 ngày sử dụng, kích hoạt 1 máy, rẻ hơn 35% so với gói tháng.',
  active        = 1,
  updated_at    = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE license_prefix = 'XAGR' AND license_days = 180;

-- ---------- 1 năm: ẨN ----------
UPDATE products SET
  active     = 0,
  updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE license_prefix = 'XAGR' AND license_days = 365;

-- ---------- Kiểm tra ----------
SELECT license_days, price, compare_price, badge, active, short_desc
FROM products
WHERE license_prefix = 'XAGR'
ORDER BY license_days;
