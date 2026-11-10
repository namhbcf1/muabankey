UPDATE users SET role='admin', username='namhbcf' WHERE email='admin@muabankey.vn';
UPDATE users SET role='user', username='demo', balance=500000 WHERE email='demo@muabankey.vn';
UPDATE users SET role='staff', username='staff' WHERE email='staff@muabankey.vn';
UPDATE users SET role='user', username='user2' WHERE email='user2@muabankey.vn';
DELETE FROM sessions;
