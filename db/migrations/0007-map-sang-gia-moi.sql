-- ===========================================================================
-- 0007 — Sua gia map sang theo yeu cau chu shop
--
-- Map sang: 1 tuan 10k, 1 thang 30k, 6 thang 150k
-- Bo: nam va vinh vien
-- Tai nguyen: giu nguyen gia cu
-- ===========================================================================

-- Map sang 1 tuan (7 ngay): 10.000đ
UPDATE products
   SET price = 10000,
       license_days = 7,
       updated_at = strftime('%s','now') * 1000
 WHERE slug = 'license-xarena-tuan';

-- Map sang 1 thang (30 ngay): 30.000đ
UPDATE products
   SET price = 30000,
       license_days = 30,
       updated_at = strftime('%s','now') * 1000
 WHERE slug = 'license-xarena-thang';

-- Map sang 6 thang (180 ngay): 150.000đ
UPDATE products
   SET price = 150000,
       license_days = 180,
       updated_at = strftime('%s','now') * 1000
 WHERE slug = 'license-xarena-6month';

-- Bo map sang vinh vien (an san pham)
UPDATE products
   SET active = 0,
       updated_at = strftime('%s','now') * 1000
 WHERE slug = 'license-xarena-vinh-vien';

-- Tai nguyen: giu nguyen gia cu, khong dong ao bat cu dong nao.
