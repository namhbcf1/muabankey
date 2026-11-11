-- ============================================================
-- Sản phẩm XAGrant — tool tăng tài nguyên XArena
--
-- Tách hoàn toàn khỏi No Fog:
--   category riêng:  cat-xagrant  (slug: tool-xarena-grant)
--   prefix key riêng: XAGR  -> key dạng XAGR-XXXX-XXXX-XXXX
--   delivery_type = 'license'  (dùng chung cơ chế sinh key của shop)
--
-- Chạy:
--   npx wrangler@4 d1 execute muabankey-db --remote --file=./db/seed-xagrant-products.sql --yes
--
-- An toàn khi chạy lại: ON CONFLICT DO NOTHING.
-- ============================================================

INSERT INTO categories (id, slug, name, description, icon, sort_order, active, created_at) VALUES
('cat-xagrant', 'tool-xarena-grant', 'Tool XArena — Tăng tài nguyên',
 'Công cụ bơm tài nguyên (thịt/gỗ/đá/vàng) trong AoE XArena. Chạy bằng lệnh CMD, không cần đăng nhập.',
 '⚡', 8, 1, 1731200000000)
ON CONFLICT(id) DO NOTHING;

INSERT INTO products
  (id, slug, category_id, name, short_desc, description, image_url, badge, price, compare_price,
   delivery_type, stock_count, sold_count, rating, rating_count, warranty_days, duration_label,
   features, active, featured, sort_order, license_prefix, license_days, created_at, updated_at)
VALUES
('p-xg-week', 'xarena-grant-tuan', 'cat-xagrant',
 'XArena Grant — Gói Tuần',
 '7 ngày sử dụng, kích hoạt 1 máy, chạy bằng lệnh CMD.',
 'License tool XArena Grant gói TUẦN (7 ngày). Bơm tài nguyên trong trận đang chơi: thịt, gỗ, đá, vàng. Chạy hoàn toàn bằng lệnh CMD — không cần đăng nhập tài khoản web, không cần cài app. Key gắn 1 máy (HWID), đổi máy 1 lần miễn phí.',
 '/img/license-xarena.svg', null, 70000, 150000,
 'license', 0, 0, 5, 0, 7, '7 ngày',
 '["Bơm thịt / gỗ / đá / vàng","Chạy 100% bằng lệnh CMD","Không cần đăng nhập tài khoản","Kích hoạt 1 máy (HWID)","Đổi máy 1 lần miễn phí","Giao key tự động 24/7"]',
 1, 0, 30, 'XAGR', 7, 1731200000000, 1731200000000),

('p-xg-month', 'xarena-grant-thang', 'cat-xagrant',
 'XArena Grant — Gói Tháng',
 '30 ngày sử dụng, kích hoạt 1 máy, tiết kiệm 40%.',
 'License tool XArena Grant gói THÁNG (30 ngày). Lựa chọn phổ biến nhất. Bơm tài nguyên không giới hạn số lần trong suốt thời hạn, chạy bằng lệnh CMD, kích hoạt theo máy.',
 '/img/license-xarena.svg', 'HOT', 180000, 300000,
 'license', 0, 0, 5, 0, 30, '30 ngày',
 '["Bơm thịt / gỗ / đá / vàng","Chạy 100% bằng lệnh CMD","Không cần đăng nhập tài khoản","Kích hoạt 1 máy (HWID)","Đổi máy 1 lần miễn phí","Giao key tự động 24/7"]',
 1, 1, 31, 'XAGR', 30, 1731200000000, 1731200000000),

('p-xg-year', 'xarena-grant-nam', 'cat-xagrant',
 'XArena Grant — Gói Năm',
 '365 ngày, tiết kiệm 60% so với gói tháng.',
 'License tool XArena Grant gói NĂM (365 ngày). Tiết kiệm nhất cho người dùng lâu dài. Bao gồm mọi bản cập nhật tool trong thời hạn.',
 '/img/license-xarena.svg', 'SALE', 590000, 1500000,
 'license', 0, 0, 5, 0, 365, '365 ngày',
 '["Bơm thịt / gỗ / đá / vàng","Chạy 100% bằng lệnh CMD","Không cần đăng nhập tài khoản","Kích hoạt 1 máy (HWID)","Đổi máy 1 lần miễn phí","Bao gồm cập nhật trong thời hạn"]',
 1, 0, 32, 'XAGR', 365, 1731200000000, 1731200000000),

('p-xg-forever', 'xarena-grant-vinh-vien', 'cat-xagrant',
 'XArena Grant — Vĩnh Viễn',
 'Không giới hạn thời gian, trọn đời cho 1 máy.',
 'License tool XArena Grant VĨNH VIỄN — không bao giờ hết hạn, gắn với 1 máy tính. Mua một lần dùng mãi mãi, bao gồm mọi bản cập nhật sau này.',
 '/img/license-xarena.svg', 'HOT', 1290000, 2900000,
 'license', 0, 0, 5, 0, 365, 'Vĩnh viễn',
 '["Không giới hạn thời gian","Bơm thịt / gỗ / đá / vàng","Chạy 100% bằng lệnh CMD","Kích hoạt 1 máy (HWID)","Đổi máy 1 lần miễn phí","Bao gồm cập nhật sau này"]',
 1, 1, 33, 'XAGR', 0, 1731200000000, 1731200000000)
ON CONFLICT(id) DO NOTHING;
