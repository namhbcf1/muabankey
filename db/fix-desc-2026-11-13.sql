-- Sua MO TA sai so voi gia thuc (AOE1 + XAGR)
--
-- Loi that: goi THANG ghi "re hon 30% so voi goi tuan" nhung thuc te:
--   Tuan  10.000d / 7  ngay = 1.429d/ngay
--   Thang 30.000d / 30 ngay = 1.000d/ngay
--   -> re hon 30% theo NGAY, nhung neu so tong tien thi re hon 57%
--   Cau chu "re hon 30% so voi goi tuan" de bi hieu la so tong -> sai.
--
-- Cach viet dung va de hieu: noi ro TIET KIEM BAO NHIEU % so voi goi thang,
-- va chi noi khi con so DO THAT.
--
--   AOE1:  thang = 1.000d/ngay (moc chuan)
--          3 thang  889d/ngay -> re hon 11%
--          6 thang  833d/ngay -> re hon 17%
--          1 nam    548d/ngay -> re hon 45%
--   XAGR:  thang = 3.000d/ngay (moc chuan)
--          3 thang 2.222d/ngay -> re hon 26%
--          6 thang 1.944d/ngay -> re hon 35%

-- ---------- AOE1: sua goi thang ----------
UPDATE products SET
  short_desc = '30 ngày sử dụng, kích hoạt 1 máy, giao key tự động.',
  updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE license_prefix = 'AOE1' AND license_days = 30;

-- ---------- AOE1: cac goi dai (so da dung, giu nguyen nhung chuan hoa cau) ----------
UPDATE products SET
  short_desc = '90 ngày sử dụng, kích hoạt 1 máy, rẻ hơn 11% so với gói tháng.',
  updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE license_prefix = 'AOE1' AND license_days = 90;

UPDATE products SET
  short_desc = '180 ngày sử dụng, kích hoạt 1 máy, rẻ hơn 17% so với gói tháng.',
  updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE license_prefix = 'AOE1' AND license_days = 180;

UPDATE products SET
  short_desc = '365 ngày sử dụng, kích hoạt 1 máy, rẻ hơn 45% so với gói tháng.',
  updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE license_prefix = 'AOE1' AND license_days = 365;

-- Kiem tra
SELECT license_prefix, license_days, price, short_desc
FROM products
WHERE active = 1
ORDER BY sort_order;
