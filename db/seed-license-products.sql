-- ============================================================
-- Sản phẩm license XArena (sinh key thật qua D1 xa_license)
-- Prefix AOE1 khớp với client xa_nofog_pro.py
-- ============================================================

INSERT INTO categories (id, slug, name, description, icon, sort_order, active, created_at) VALUES
('cat-license', 'license-xarena', 'License XArena', 'Key bản quyền tool XArena No Fog - kích hoạt theo máy, gói tuần/tháng/năm/vĩnh viễn.', '🎮', 7, 1, 1731000000000)
ON CONFLICT(id) DO NOTHING;

INSERT INTO products
  (id, slug, category_id, name, short_desc, description, image_url, badge, price, compare_price,
   delivery_type, stock_count, sold_count, rating, rating_count, warranty_days, duration_label,
   features, active, featured, sort_order, license_prefix, license_days, created_at, updated_at)
VALUES
('p-lic-week', 'license-xarena-tuan', 'cat-license',
 'XArena No Fog — Gói Tuần', '7 ngày sử dụng, kích hoạt 1 máy, giao key tự động.',
 'Key license XArena No Fog gói TUẦN (7 ngày). Key được sinh tự động ngay sau khi thanh toán, kích hoạt trực tiếp trong tool. Mỗi key gắn với 1 máy tính (HWID), hỗ trợ đổi máy 1 lần.',
 '/img/license-xarena.svg', null, 70000, 150000,
 'license', 0, 0, 5, 0, 7, '7 ngày',
 '["Kích hoạt 1 máy (HWID)","Đổi máy 1 lần miễn phí","Giao key tự động 24/7","Hạn tính từ lần kích hoạt đầu","Hỗ trợ offline grace 24 giờ"]',
 1, 0, 20, 'AOE1', 7, 1731000000000, 1731000000000),

('p-lic-month', 'license-xarena-thang', 'cat-license',
 'XArena No Fog — Gói Tháng', '30 ngày sử dụng, kích hoạt 1 máy, tiết kiệm 40%.',
 'Key license XArena No Fog gói THÁNG (30 ngày). Lựa chọn phổ biến nhất — chi phí thấp hơn gói tuần tính theo ngày. Key sinh tự động, kích hoạt trong tool.',
 '/img/license-xarena.svg', 'HOT', 180000, 300000,
 'license', 0, 0, 5, 0, 30, '30 ngày',
 '["Kích hoạt 1 máy (HWID)","Đổi máy 1 lần miễn phí","Giao key tự động 24/7","Hạn tính từ lần kích hoạt đầu","Hỗ trợ offline grace 24 giờ"]',
 1, 1, 21, 'AOE1', 30, 1731000000000, 1731000000000),

('p-lic-year', 'license-xarena-nam', 'cat-license',
 'XArena No Fog — Gói Năm', '365 ngày, tiết kiệm 60% so với gói tháng.',
 'Key license XArena No Fog gói NĂM (365 ngày). Tiết kiệm nhất cho người dùng lâu dài. Key sinh tự động, kích hoạt trong tool, hỗ trợ đổi máy.',
 '/img/license-xarena.svg', 'SALE', 590000, 1500000,
 'license', 0, 0, 5, 0, 365, '365 ngày',
 '["Kích hoạt 1 máy (HWID)","Đổi máy 1 lần miễn phí","Giao key tự động 24/7","Hạn tính từ lần kích hoạt đầu","Hỗ trợ offline grace 24 giờ"]',
 1, 0, 22, 'AOE1', 365, 1731000000000, 1731000000000),

('p-lic-forever', 'license-xarena-vinh-vien', 'cat-license',
 'XArena No Fog — Vĩnh Viễn', 'Không giới hạn thời gian, trọn đời cho 1 máy.',
 'Key license XArena No Fog VĨNH VIỄN — không bao giờ hết hạn, gắn với 1 máy tính. Mua một lần dùng mãi mãi, bao gồm mọi bản cập nhật sau này.',
 '/img/license-xarena.svg', 'HOT', 1290000, 2900000,
 'license', 0, 0, 5, 0, 365, 'Vĩnh viễn',
 '["Không giới hạn thời gian","Kích hoạt 1 máy (HWID)","Đổi máy 1 lần miễn phí","Giao key tự động 24/7","Bao gồm cập nhật sau này"]',
 1, 1, 23, 'AOE1', 0, 1731000000000, 1731000000000)
ON CONFLICT(id) DO NOTHING;
