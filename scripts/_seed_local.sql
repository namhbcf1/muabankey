-- Seed cho test race local: 1 user, 1 topup pending, 1 sản phẩm, 1 đơn
DELETE FROM wallet_transactions;
DELETE FROM topups;
DELETE FROM order_items;
DELETE FROM orders;
DELETE FROM product_keys;
DELETE FROM products;
DELETE FROM sessions;
DELETE FROM users;
DELETE FROM coupons;

INSERT INTO users (id,email,password_hash,password_salt,full_name,role,status,balance,created_at,updated_at)
VALUES ('u-race','race@local.vn','x','x','Race User','user','active',0,1,1);

INSERT INTO topups (id,code,user_id,amount,status,provider,created_at,expires_at)
VALUES ('tp-race-1','AAAAA','u-race',100000,'pending','sepay',1,9999999999999);

INSERT INTO topups (id,code,user_id,amount,status,provider,created_at,expires_at)
VALUES ('tp-race-2','BBBBB','u-race',100000,'pending','sepay',1,9999999999999);

-- topup đã partial (đã cộng 50k)
INSERT INTO topups (id,code,user_id,amount,status,provider,txn_ref,created_at,expires_at)
VALUES ('tp-race-partial','CCCCC','u-race',100000,'partial','sepay','FT-PARTIAL',1,9999999999999);
INSERT INTO wallet_transactions (id,user_id,type,amount,balance_after,status,reference,description,created_at)
VALUES ('wt-partial','u-race','topup',50000,50000,'success','FT-PARTIAL','Nạp một phần 50k/100k (CCCCC)',1);

-- coupon usage_limit=1 để test race
INSERT INTO coupons (id,code,type,value,min_subtotal,max_discount,usage_limit,used_count,starts_at,expires_at,active,created_at)
VALUES ('cp-race','RACE1','percent',50,0,NULL,1,0,NULL,NULL,1,1);

-- product license (kho vô hạn)
INSERT INTO categories (id,slug,name,sort_order,active,created_at)
VALUES ('cat-race','race-cat','Race Cat',0,1,1);

INSERT INTO products (id,slug,category_id,name,short_desc,description,image_url,badge,price,compare_price,
  delivery_type,stock_count,sold_count,rating,rating_count,warranty_days,duration_label,features,active,featured,
  sort_order,license_prefix,license_days,created_at,updated_at)
VALUES ('p-race-lic','race-lic','cat-race','Race License','','','',NULL,70000,NULL,'license',0,0,5,0,0,'7 ngày','[]',1,0,0,'RACET',7,1,1);
