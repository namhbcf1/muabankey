-- ============================================================
-- Sáº£n pháº©m XAGrant â€” tool tÄƒng tÃ i nguyÃªn XArena
--
-- TÃ¡ch hoÃ n toÃ n khá»i No Fog:
--   category riÃªng:  cat-xagrant  (slug: tool-xarena-grant)
--   prefix key riÃªng: XAGR  -> key dáº¡ng XAGR-XXXX-XXXX-XXXX
--   delivery_type = 'license'  (dÃ¹ng chung cÆ¡ cháº¿ sinh key cá»§a shop)
--
-- Cháº¡y:
--   npx wrangler@4 d1 execute muabankey-db --remote --file=./db/seed-xagrant-products.sql --yes
--
-- An toÃ n khi cháº¡y láº¡i: ON CONFLICT DO NOTHING.
-- ============================================================

INSERT INTO categories (id, slug, name, description, icon, sort_order, active, created_at) VALUES
('cat-xagrant', 'tool-xarena-grant', 'Tool XArena â€” TÄƒng tÃ i nguyÃªn',
 'CÃ´ng cá»¥ bÆ¡m tÃ i nguyÃªn (thá»‹t/gá»—/Ä‘Ã¡/vÃ ng) trong AoE XArena. Cháº¡y báº±ng lá»‡nh CMD, khÃ´ng cáº§n Ä‘Äƒng nháº­p.',
 'âš¡', 8, 1, 1731200000000)
ON CONFLICT(id) DO NOTHING;

INSERT INTO products
  (id, slug, category_id, name, short_desc, description, image_url, badge, price, compare_price,
   delivery_type, stock_count, sold_count, rating, rating_count, warranty_days, duration_label,
   features, active, featured, sort_order, license_prefix, license_days, created_at, updated_at)
VALUES
('p-xg-week', 'xarena-grant-tuan', 'cat-xagrant',
 'XArena Grant â€” GÃ³i Tuáº§n',
 '7 ngÃ y sá»­ dá»¥ng, kÃ­ch hoáº¡t 1 mÃ¡y, cháº¡y báº±ng lá»‡nh CMD.',
 'License tool XArena Grant gÃ³i TUáº¦N (7 ngÃ y). BÆ¡m tÃ i nguyÃªn trong tráº­n Ä‘ang chÆ¡i: thá»‹t, gá»—, Ä‘Ã¡, vÃ ng. Cháº¡y hoÃ n toÃ n báº±ng lá»‡nh CMD â€” khÃ´ng cáº§n Ä‘Äƒng nháº­p tÃ i khoáº£n web, khÃ´ng cáº§n cÃ i app. Key gáº¯n 1 mÃ¡y (HWID), Ä‘á»•i mÃ¡y 1 láº§n miá»…n phÃ­.',
 '/img/license-xagrant.svg', null, 70000, 150000,
 'license', 0, 0, 5, 0, 7, '7 ngÃ y',
 '["BÆ¡m thá»‹t / gá»— / Ä‘Ã¡ / vÃ ng","Cháº¡y 100% báº±ng lá»‡nh CMD","KhÃ´ng cáº§n Ä‘Äƒng nháº­p tÃ i khoáº£n","KÃ­ch hoáº¡t 1 mÃ¡y (HWID)","Äá»•i mÃ¡y 1 láº§n miá»…n phÃ­","Giao key tá»± Ä‘á»™ng 24/7"]',
 1, 0, 30, 'XAGR', 7, 1731200000000, 1731200000000),

('p-xg-month', 'xarena-grant-thang', 'cat-xagrant',
 'XArena Grant â€” GÃ³i ThÃ¡ng',
 '30 ngÃ y sá»­ dá»¥ng, kÃ­ch hoáº¡t 1 mÃ¡y, tiáº¿t kiá»‡m 40%.',
 'License tool XArena Grant gÃ³i THÃNG (30 ngÃ y). Lá»±a chá»n phá»• biáº¿n nháº¥t. BÆ¡m tÃ i nguyÃªn khÃ´ng giá»›i háº¡n sá»‘ láº§n trong suá»‘t thá»i háº¡n, cháº¡y báº±ng lá»‡nh CMD, kÃ­ch hoáº¡t theo mÃ¡y.',
 '/img/license-xagrant.svg', 'HOT', 180000, 300000,
 'license', 0, 0, 5, 0, 30, '30 ngÃ y',
 '["BÆ¡m thá»‹t / gá»— / Ä‘Ã¡ / vÃ ng","Cháº¡y 100% báº±ng lá»‡nh CMD","KhÃ´ng cáº§n Ä‘Äƒng nháº­p tÃ i khoáº£n","KÃ­ch hoáº¡t 1 mÃ¡y (HWID)","Äá»•i mÃ¡y 1 láº§n miá»…n phÃ­","Giao key tá»± Ä‘á»™ng 24/7"]',
 1, 1, 31, 'XAGR', 30, 1731200000000, 1731200000000),

('p-xg-year', 'xarena-grant-nam', 'cat-xagrant',
 'XArena Grant â€” GÃ³i NÄƒm',
 '365 ngÃ y, tiáº¿t kiá»‡m 60% so vá»›i gÃ³i thÃ¡ng.',
 'License tool XArena Grant gÃ³i NÄ‚M (365 ngÃ y). Tiáº¿t kiá»‡m nháº¥t cho ngÆ°á»i dÃ¹ng lÃ¢u dÃ i. Bao gá»“m má»i báº£n cáº­p nháº­t tool trong thá»i háº¡n.',
 '/img/license-xagrant.svg', 'SALE', 590000, 1500000,
 'license', 0, 0, 5, 0, 365, '365 ngÃ y',
 '["BÆ¡m thá»‹t / gá»— / Ä‘Ã¡ / vÃ ng","Cháº¡y 100% báº±ng lá»‡nh CMD","KhÃ´ng cáº§n Ä‘Äƒng nháº­p tÃ i khoáº£n","KÃ­ch hoáº¡t 1 mÃ¡y (HWID)","Äá»•i mÃ¡y 1 láº§n miá»…n phÃ­","Bao gá»“m cáº­p nháº­t trong thá»i háº¡n"]',
 1, 0, 32, 'XAGR', 365, 1731200000000, 1731200000000),

('p-xg-forever', 'xarena-grant-vinh-vien', 'cat-xagrant',
 'XArena Grant â€” VÄ©nh Viá»…n',
 'KhÃ´ng giá»›i háº¡n thá»i gian, trá»n Ä‘á»i cho 1 mÃ¡y.',
 'License tool XArena Grant VÄ¨NH VIá»„N â€” khÃ´ng bao giá» háº¿t háº¡n, gáº¯n vá»›i 1 mÃ¡y tÃ­nh. Mua má»™t láº§n dÃ¹ng mÃ£i mÃ£i, bao gá»“m má»i báº£n cáº­p nháº­t sau nÃ y.',
 '/img/license-xagrant.svg', 'HOT', 1290000, 2900000,
 'license', 0, 0, 5, 0, 365, 'VÄ©nh viá»…n',
 '["KhÃ´ng giá»›i háº¡n thá»i gian","BÆ¡m thá»‹t / gá»— / Ä‘Ã¡ / vÃ ng","Cháº¡y 100% báº±ng lá»‡nh CMD","KÃ­ch hoáº¡t 1 mÃ¡y (HWID)","Äá»•i mÃ¡y 1 láº§n miá»…n phÃ­","Bao gá»“m cáº­p nháº­t sau nÃ y"]',
 1, 1, 33, 'XAGR', 0, 1731200000000, 1731200000000)
ON CONFLICT(id) DO NOTHING;

