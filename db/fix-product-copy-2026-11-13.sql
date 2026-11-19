-- Sửa dữ liệu sản phẩm còn SAI so với thực tế.
--
-- Phát hiện khi audit giao diện:
--   1. AOE1 ghi "Hỗ trợ offline grace 24 giờ" — SAI. No Fog bắt buộc online
--      (license-server.js GRACE_HOURS = 0, client không đọc grace).
--   2. XAGR ghi "Chạy 100% bằng lệnh CMD" / "không cần cài app" — SAI. Nay
--      là bộ cài .exe có giao diện.
--   3. XAGR 90d/180d ghi "rẻ hơn 11% / 17% so với gói tháng" — đó là số của
--      AOE1. XAGR đúng là 26% / 35%.
--
-- Chỉ sửa CHU, không đổi giá.

-- ---------- 1. Bỏ "offline grace 24 giờ" của AOE1 ----------
UPDATE products SET
  features = replace(features, 'Hỗ trợ offline grace 24 giờ',
                     'Bắt buộc có mạng mỗi lần chạy'),
  updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE license_prefix = 'AOE1'
  AND features LIKE '%offline grace%';

-- ---------- 2. XAGR: bỏ "lệnh CMD", đổi sang bộ cài GUI ----------
UPDATE products SET features = replace(features, 'Chạy 100% bằng lệnh CMD',
                                       'Cài bằng bộ cài có giao diện'),
  updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE license_prefix = 'XAGR' AND features LIKE '%bằng lệnh CMD%';

UPDATE products SET features = replace(features, 'Chạy hoàn toàn bằng lệnh CMD',
                                       'Cài bằng bộ cài có giao diện'),
  updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE license_prefix = 'XAGR' AND features LIKE '%bằng lệnh CMD%';

UPDATE products SET
  description = replace(replace(description,
                    'Chạy hoàn toàn bằng lệnh CMD — không cần đăng nhập tài khoản web, không cần cài app.',
                    'Cài bằng bộ cài có giao diện: tải .exe, dán mã, bấm Cài đặt. Không cần CMD hay PowerShell.'),
                    'chạy bằng lệnh CMD, kích hoạt theo máy.',
                    'cài bằng bộ cài có giao diện, kích hoạt theo máy.'),
  updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE license_prefix = 'XAGR' AND description LIKE '%CMD%';

-- ---------- 3. XAGR 90d / 180d: sửa % tiết kiệm ----------
UPDATE products SET short_desc =
  '90 ngày sử dụng, kích hoạt 1 máy, rẻ hơn 26% so với gói tháng.',
  updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE license_prefix = 'XAGR' AND license_days = 90
  AND short_desc LIKE '%rẻ hơn 11%';

UPDATE products SET short_desc =
  '180 ngày sử dụng, kích hoạt 1 máy, rẻ hơn 35% so với gói tháng.',
  updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE license_prefix = 'XAGR' AND license_days = 180
  AND short_desc LIKE '%rẻ hơn 17%';

-- Kiểm tra
SELECT license_prefix, license_days, short_desc,
       CASE WHEN features LIKE '%CMD%' THEN 'CON CMD' ELSE 'ok' END AS feat_ok
FROM products WHERE active = 1
ORDER BY sort_order;
