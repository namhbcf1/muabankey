-- Seed cho D1 LOCAL. Dùng hash PBKDF2 thật để test được luồng login.
-- admin: namhbcf / namhbcf123   |   demo: demo / Demo@123456
-- Nếu hash mẫu không khớp, script mjs sẽ tự đăng ký user mới qua API.

DELETE FROM rate_limits;
DELETE FROM lic_attempts;
DELETE FROM trial_attempts;
DELETE FROM trial_grants;
DELETE FROM lic_events;
DELETE FROM licenses;
DELETE FROM license_issues;
DELETE FROM rebind_tokens;
DELETE FROM install_tokens;
DELETE FROM reviews;
DELETE FROM order_items;
DELETE FROM orders;
DELETE FROM product_keys;
DELETE FROM products;
DELETE FROM categories;
DELETE FROM coupons;
DELETE FROM wallet_transactions;
DELETE FROM topups;
DELETE FROM sessions;
DELETE FROM audit_logs;
DELETE FROM users;

INSERT INTO categories (id, slug, name, description, icon, sort_order, active, created_at) VALUES
('cat-win', 'windows-office', 'Windows & Office', 'Ban quyen Windows va Office', 'W', 1, 1, 1731000000000),
('cat-license', 'license-xarena', 'License XArena', 'License XArena No Fog', 'L', 7, 1, 1731000000000);

INSERT INTO products
  (id, slug, category_id, name, short_desc, description, image_url, badge, price, compare_price,
   delivery_type, stock_count, sold_count, rating, rating_count, warranty_days, duration_label,
   features, active, featured, sort_order, license_prefix, license_days, created_at, updated_at)
VALUES
('p-win11','windows-11-pro','cat-win','Windows 11 Pro Retail','Key retail vinh vien','Mo ta','/img/x.svg','HOT',
 450000, 900000, 'key', 50, 0, 5, 0, 365, 'Vinh vien', '[]', 1, 1, 1, NULL, 0, 1731000000000, 1731000000000),
('p-empty','san-pham-het-hang','cat-win','San pham het hang','Kho rong de test','Mo ta','/img/x.svg',NULL,
 100000, NULL, 'key', 0, 0, 5, 0, 30, '30 ngay', '[]', 1, 0, 2, NULL, 0, 1731000000000, 1731000000000),
('p-manual','san-pham-giao-tay','cat-win','San pham giao tay','Giao thu cong','Mo ta','/img/x.svg',NULL,
 200000, NULL, 'manual', 0, 0, 5, 0, 30, '30 ngay', '[]', 1, 0, 3, NULL, 0, 1731000000000, 1731000000000),
('p-lic-month','license-xarena-thang','cat-license','XArena No Fog - Goi Thang','30 ngay','Mo ta','/img/x.svg','HOT',
 180000, 300000, 'license', 0, 0, 5, 0, 30, '30 ngay', '[]', 1, 1, 21, 'AOE1', 30, 1731000000000, 1731000000000),
('p-lic-forever','license-xarena-vinh-vien','cat-license','XArena No Fog - Vinh Vien','Khong gioi han','Mo ta','/img/x.svg','HOT',
 1290000, 2900000, 'license', 0, 0, 5, 0, 365, 'Vinh vien', '[]', 1, 1, 23, 'AOE1', 0, 1731000000000, 1731000000000);

INSERT INTO product_keys (id, product_id, secret, note, status, created_at) VALUES
('k-w-01','p-win11','MTEwMDAwLTExMjIzMy00NDU1NjYtNzg4OTkw','K1','available',1731000000000),
('k-w-02','p-win11','MTEwMDAwLTExMjIzMy00NDU1NjctNzg4OTkx','K2','available',1731000000000),
('k-w-03','p-win11','MTEwMDAwLTExMjIzMy00NDU1NjgtNzg4OTky','K3','available',1731000000000),
('k-w-04','p-win11','MTEwMDAwLTExMjIzMy00NDU1NjktNzg4OTkz','K4','available',1731000000000),
('k-w-05','p-win11','MTEwMDAwLTExMjIzMy00NDU1NTcwLTc4ODk5NA==','K5','available',1731000000000);

UPDATE products SET stock_count = 5 WHERE id = 'p-win11';

INSERT INTO coupons (id,code,type,value,min_subtotal,max_discount,usage_limit,used_count,starts_at,expires_at,active,created_at) VALUES
('cp-10','GIAM10','percent',10,0,NULL,NULL,0,0,NULL,1,1731000000000),
('cp-limit1','ONELUOT','fixed',50000,0,NULL,1,0,0,NULL,1,1731000000000),
('cp-100','FREE100','percent',100,0,NULL,NULL,0,0,NULL,1,1731000000000),
('cp-big','BIGDISCOUNT','fixed',999999999,0,NULL,NULL,0,0,NULL,1,1731000000000);

INSERT INTO settings (key,value,updated_at) VALUES
('bank_name','MBBank',1731000000000),
('bank_account','8990124112002',1731000000000),
('bank_owner','NGUYEN THANH NAM',1731000000000),
('topup_min','20000',1731000000000),
('topup_max','50000000',1731000000000),
('trial_enabled','1',1731000000000),
('trial_days','3',1731000000000),
('trial_max_per_ip','3',1731000000000),
('trial_max_per_net','12',1731000000000),
('trial_max_per_day','200',1731000000000);
