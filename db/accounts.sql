-- Tài khoản khởi tạo (mật khẩu đã hash PBKDF2-SHA256)
DELETE FROM reviews;
DELETE FROM wallet_transactions;
DELETE FROM users WHERE email IN ('admin@muabankey.vn','demo@muabankey.vn');

INSERT INTO users (id,email,password_hash,password_salt,full_name,phone,role,status,balance,created_at,updated_at) VALUES
('u-admin','admin@muabankey.vn','8CWoc3ZpCK4Lq1sORFNj0NGpVb5Q3g5Ud2d48W6Gtks=','6DAXrxnRq8brfS4eJWGSXg==','Quản trị viên','0900000000','admin','active',0,1794265066719,1794265066719),
('u-demo','demo@muabankey.vn','v08viUULXyNsiDQ6v5VTUVK+ScNqVu0CwVaSb0aZFIM=','VsvdO3833vCyMv2zEnDfEQ==','Khách Demo','0912345678','user','active',500000,1794265066719,1794265066719);

-- Giao dịch ví khởi tạo cho tài khoản demo
INSERT INTO wallet_transactions (id,user_id,type,amount,balance_after,status,reference,description,created_at) VALUES
('wt-demo-1','u-demo','admin_credit',500000,500000,'success','SEED','Tặng 500.000₫ cho tài khoản demo',1794265066719);

-- Đánh giá mẫu
INSERT INTO reviews (id,product_id,user_id,rating,comment,created_at) VALUES
('r1','p-win11','u-demo',5,'Kích hoạt online trong 30 giây, key retail thật sự. Rất đáng tiền!',1793746666719),
('r2','p-chatgpt','u-demo',5,'Tài khoản dùng ổn định, có email riêng nên không lo. Shop hỗ trợ nhanh.',1793919466719),
('r3','p-netflix','u-demo',4,'4K nét, profile riêng ổn. Lâu lâu phải chờ đổi mới nhưng shop phản hồi nhanh.',1794092266719);
