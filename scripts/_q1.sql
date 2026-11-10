-- @q: Tổng hợp schema (sqlite_master)
SELECT type, name,
       tbl_name,
       REPLACE(REPLACE(COALESCE(sql,''),char(10),' '),char(9),' ') AS ddl
FROM sqlite_master
WHERE name NOT LIKE 'sqlite_%'
ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END, name;

-- @q: Danh sách cột mọi bảng
SELECT m.name AS tbl, p.cid, p.name AS col, p.type, p."notnull", p.dflt_value, p.pk
FROM sqlite_master m
JOIN pragma_table_info(m.name) p
WHERE m.type='table' AND m.name NOT LIKE 'sqlite_%'
ORDER BY m.name, p.cid;

-- @q: Index của mọi bảng (kèm cột)
SELECT m.name AS tbl, il.name AS idx, il."unique", il.origin, group_concat(ii.name, ',') AS cols, il.partial
FROM sqlite_master m
JOIN pragma_index_list(m.name) il
JOIN pragma_index_info(il.name) ii
WHERE m.type='table' AND m.name NOT LIKE 'sqlite_%'
GROUP BY m.name, il.name
ORDER BY m.name, il.name;

-- @q: Foreign key thực tế
SELECT m.name AS tbl, f."table" AS ref_tbl, f."from" AS col, f."to" AS ref_col, f.on_delete, f.on_update
FROM sqlite_master m
JOIN pragma_foreign_key_list(m.name) f
WHERE m.type='table' AND m.name NOT LIKE 'sqlite_%'
ORDER BY m.name, f.id;

-- @q: Đếm dòng từng bảng
SELECT 'users' t, COUNT(*) n FROM users
UNION ALL SELECT 'sessions', COUNT(*) FROM sessions
UNION ALL SELECT 'categories', COUNT(*) FROM categories
UNION ALL SELECT 'products', COUNT(*) FROM products
UNION ALL SELECT 'product_keys', COUNT(*) FROM product_keys
UNION ALL SELECT 'orders', COUNT(*) FROM orders
UNION ALL SELECT 'order_items', COUNT(*) FROM order_items
UNION ALL SELECT 'wallet_transactions', COUNT(*) FROM wallet_transactions
UNION ALL SELECT 'topups', COUNT(*) FROM topups
UNION ALL SELECT 'coupons', COUNT(*) FROM coupons
UNION ALL SELECT 'reviews', COUNT(*) FROM reviews
UNION ALL SELECT 'audit_logs', COUNT(*) FROM audit_logs
UNION ALL SELECT 'settings', COUNT(*) FROM settings
UNION ALL SELECT 'rate_limits', COUNT(*) FROM rate_limits
UNION ALL SELECT 'licenses', COUNT(*) FROM licenses
UNION ALL SELECT 'lic_events', COUNT(*) FROM lic_events
UNION ALL SELECT 'lic_attempts', COUNT(*) FROM lic_attempts
UNION ALL SELECT 'license_issues', COUNT(*) FROM license_issues
UNION ALL SELECT 'install_tokens', COUNT(*) FROM install_tokens
UNION ALL SELECT 'rebind_tokens', COUNT(*) FROM rebind_tokens
UNION ALL SELECT 'trial_grants', COUNT(*) FROM trial_grants
UNION ALL SELECT 'trial_attempts', COUNT(*) FROM trial_attempts
UNION ALL SELECT 'banned_devices', COUNT(*) FROM banned_devices;

-- @q: PRAGMA integrity + foreign_key_check
PRAGMA foreign_key_check;

-- @q: pragma compile options / version
SELECT sqlite_version() AS ver;

-- @q: journal mode + page info
PRAGMA journal_mode;

-- @q: Số trang + kích thước
PRAGMA page_count;

-- @q: Dữ liệu test còn sót
SELECT id, email, role, status, balance, created_at FROM users
WHERE email LIKE '%mailinator%' OR email LIKE '%test%' OR email LIKE '%example%'
   OR email LIKE '%@test.vn' OR email LIKE '%localhost%' OR email LIKE '%demo%'
ORDER BY created_at DESC LIMIT 100;

-- @q: User balance âm
SELECT id, email, balance FROM users WHERE balance < 0;

-- @q: Topup status lạ
SELECT status, COUNT(*) n FROM topups GROUP BY status ORDER BY n DESC;

-- @q: Order status lạ
SELECT status, COUNT(*) n FROM orders GROUP BY status ORDER BY n DESC;

-- @q: product_keys status
SELECT status, COUNT(*) n, SUM(CASE WHEN order_id IS NULL THEN 1 ELSE 0 END) no_order,
       SUM(CASE WHEN order_id IS NOT NULL THEN 1 ELSE 0 END) has_order
FROM product_keys GROUP BY status;

-- @q: license revoked=0 mà đã hết hạn (giây)
SELECT COUNT(*) AS expired_not_marked FROM licenses
WHERE revoked = 0 AND expires_at > 0 AND expires_at < CAST(strftime('%s','now') AS INTEGER);

-- @q: trial_grants mồ côi
SELECT COUNT(*) AS orphan_trial_grants FROM trial_grants g
WHERE NOT EXISTS (SELECT 1 FROM licenses l WHERE l.key = g.lic_key);

-- @q: license_issues trỏ order không tồn tại
SELECT COUNT(*) AS orphan_li_order FROM license_issues li
WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.id = li.order_id);

-- @q: license_issues trỏ license không tồn tại
SELECT COUNT(*) AS orphan_li_lic FROM license_issues li
WHERE NOT EXISTS (SELECT 1 FROM licenses l WHERE l.key = li.license_key);

-- @q: wallet_transactions mồ côi
SELECT COUNT(*) AS orphan_wt FROM wallet_transactions w
WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = w.user_id);

-- @q: session hết hạn chưa xoá (ms)
SELECT COUNT(*) AS expired_sessions FROM sessions
WHERE expires_at < CAST(strftime('%s','now') AS INTEGER) * 1000;

-- @q: install/rebind token hết hạn chưa xoá (giây)
SELECT (SELECT COUNT(*) FROM install_tokens WHERE expires_at < CAST(strftime('%s','now') AS INTEGER)) AS it_expired,
       (SELECT COUNT(*) FROM rebind_tokens WHERE expires_at < CAST(strftime('%s','now') AS INTEGER)) AS rt_expired,
       (SELECT COUNT(*) FROM rebind_tokens WHERE used = 1) AS rt_used;
