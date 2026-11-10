-- @q: count users
SELECT COUNT(*) n FROM users;
-- @q: count sessions
SELECT COUNT(*) n FROM sessions;
-- @q: count products
SELECT COUNT(*) n FROM products;
-- @q: count product_keys
SELECT COUNT(*) n FROM product_keys;
-- @q: count orders
SELECT COUNT(*) n FROM orders;
-- @q: count order_items
SELECT COUNT(*) n FROM order_items;
-- @q: count wallet_transactions
SELECT COUNT(*) n FROM wallet_transactions;
-- @q: count topups
SELECT COUNT(*) n FROM topups;
-- @q: count licenses
SELECT COUNT(*) n FROM licenses;
-- @q: count license_issues
SELECT COUNT(*) n FROM license_issues;
-- @q: count lic_events
SELECT COUNT(*) n FROM lic_events;
-- @q: count trial_grants
SELECT COUNT(*) n FROM trial_grants;
-- @q: count trial_attempts
SELECT COUNT(*) n FROM trial_attempts;
-- @q: count audit_logs
SELECT COUNT(*) n FROM audit_logs;
-- @q: count rate_limits
SELECT COUNT(*) n FROM rate_limits;
-- @q: count settings
SELECT COUNT(*) n FROM settings;
-- @q: count install_tokens
SELECT COUNT(*) n FROM install_tokens;
-- @q: count rebind_tokens
SELECT COUNT(*) n FROM rebind_tokens;
-- @q: count banned_devices
SELECT COUNT(*) n FROM banned_devices;
-- @q: count categories
SELECT COUNT(*) n FROM categories;
-- @q: count coupons
SELECT COUNT(*) n FROM coupons;
-- @q: count reviews
SELECT COUNT(*) n FROM reviews;

-- @q: orders — toàn bộ
SELECT id, code, user_id, status, subtotal, discount, total, coupon_code, payment_method, created_at, paid_at, delivered_at FROM orders ORDER BY created_at DESC;

-- @q: license_issues mồ côi — chi tiết
SELECT li.id, li.order_id, li.user_id, li.product_id, li.license_key, li.term_days, li.created_at
FROM license_issues li
WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.id = li.order_id)
ORDER BY li.created_at DESC LIMIT 50;

-- @q: licenses — tổng quan
SELECT key, plan, hwid IS NOT NULL AS bound, revoked, expires_at,
       CAST(strftime('%s','now') AS INTEGER) AS now_s,
       CASE WHEN expires_at=0 THEN 'forever' WHEN expires_at < CAST(strftime('%s','now') AS INTEGER) THEN 'expired' ELSE 'live' END AS st,
       note, created_at
FROM licenses ORDER BY created_at DESC LIMIT 60;

-- @q: licenses theo plan
SELECT plan, COUNT(*) n, SUM(revoked) revoked, SUM(CASE WHEN expires_at=0 THEN 1 ELSE 0 END) forever FROM licenses GROUP BY plan;

-- @q: product_keys có note LIKE 'Kho %'
SELECT COUNT(*) n FROM product_keys WHERE note LIKE 'Kho %';

-- @q: product_keys note mẫu
SELECT id, product_id, status, note, order_id, created_at FROM product_keys ORDER BY created_at DESC LIMIT 20;

-- @q: products tổng quan (license fields)
SELECT id, slug, name, delivery_type, price, stock_count, sold_count, active, license_prefix, license_days FROM products ORDER BY name;

-- @q: stock_count vs thực tế product_keys available
SELECT p.id, p.slug, p.stock_count, p.sold_count, p.delivery_type,
       (SELECT COUNT(*) FROM product_keys k WHERE k.product_id=p.id AND k.status='available') AS real_avail,
       (SELECT COUNT(*) FROM product_keys k WHERE k.product_id=p.id AND k.status='sold') AS real_sold
FROM products p ORDER BY p.slug;

-- @q: users — nhất quán số dư vs sổ cái
SELECT u.id, u.email, u.role, u.balance,
       COALESCE((SELECT SUM(amount) FROM wallet_transactions w WHERE w.user_id=u.id AND w.status='success'),0) AS ledger_sum,
       (SELECT COUNT(*) FROM wallet_transactions w WHERE w.user_id=u.id) AS n_tx,
       u.balance - COALESCE((SELECT SUM(amount) FROM wallet_transactions w WHERE w.user_id=u.id AND w.status='success'),0) AS diff
FROM users u ORDER BY ABS(u.balance - COALESCE((SELECT SUM(amount) FROM wallet_transactions w WHERE w.user_id=u.id AND w.status='success'),0)) DESC, u.balance DESC LIMIT 40;

-- @q: users có số dư > 0 mà không có wallet_transaction
SELECT u.id, u.email, u.balance FROM users u
WHERE u.balance > 0
  AND NOT EXISTS (SELECT 1 FROM wallet_transactions w WHERE w.user_id=u.id);

-- @q: orders — total vs subtotal-discount
SELECT id, code, status, subtotal, discount, total, total-(subtotal-discount) AS diff FROM orders
WHERE total <> subtotal - discount;

-- @q: orders — total vs SUM(order_items.line_total)
SELECT o.id, o.code, o.status, o.subtotal, o.total,
       COALESCE((SELECT SUM(li.line_total) FROM order_items li WHERE li.order_id=o.id),0) AS items_sum,
       o.total - COALESCE((SELECT SUM(li.line_total) FROM order_items li WHERE li.order_id=o.id),0) AS diff
FROM orders o
WHERE o.total <> COALESCE((SELECT SUM(li.line_total) FROM order_items li WHERE li.order_id=o.id),0) - o.discount;

-- @q: order_items — line_total vs unit_price*quantity
SELECT id, order_id, product_id, unit_price, quantity, line_total, line_total - unit_price*quantity AS diff
FROM order_items WHERE line_total <> unit_price*quantity;

-- @q: orders không có order_items
SELECT o.id, o.code, o.status, o.total FROM orders o
WHERE NOT EXISTS (SELECT 1 FROM order_items li WHERE li.order_id=o.id);

-- @q: topups paid nhưng không có wallet_transaction khớp code
SELECT t.id, t.code, t.status, t.amount, t.paid_at, t.txn_ref,
       (SELECT COUNT(*) FROM wallet_transactions w WHERE w.reference = t.code) AS n_match
FROM topups t WHERE t.status='paid'
  AND NOT EXISTS (SELECT 1 FROM wallet_transactions w WHERE w.reference = t.code AND w.type IN ('topup'))
ORDER BY t.paid_at DESC;

-- @q: wallet_transactions theo type
SELECT type, COUNT(*) n, SUM(amount) total FROM wallet_transactions GROUP BY type;

-- @q: dedupe — product_keys trùng secret trong cùng product
SELECT product_id, secret, COUNT(*) n FROM product_keys GROUP BY product_id, secret HAVING n>1;

-- @q: products trùng slug / licenses trùng key (sanity)
SELECT 'products_dup_slug' k, COUNT(*) n FROM (SELECT slug FROM products GROUP BY slug HAVING COUNT(*)>1)
UNION ALL SELECT 'lic_dup_key', COUNT(*) FROM (SELECT key FROM licenses GROUP BY key HAVING COUNT(*)>1)
UNION ALL SELECT 'topup_dup_code', COUNT(*) FROM (SELECT code FROM topups GROUP BY code HAVING COUNT(*)>1)
UNION ALL SELECT 'order_dup_code', COUNT(*) FROM (SELECT code FROM orders GROUP BY code HAVING COUNT(*)>1)
UNION ALL SELECT 'users_dup_email', COUNT(*) FROM (SELECT email FROM users GROUP BY email HAVING COUNT(*)>1);

-- @q: settings (che giá trị nhạy cảm)
SELECT key, CASE WHEN key LIKE '%token%' OR key LIKE '%secret%' OR key LIKE '%key%' THEN '[REDACTED len=' || LENGTH(COALESCE(value,'')) || ']' ELSE value END AS value, updated_at
FROM settings ORDER BY key;

-- @q: rate_limits mẫu
SELECT COUNT(*) n, MIN(window_at) mn, MAX(window_at) mx FROM rate_limits;

-- @q: trial_grants tổng quan
SELECT weak_hwid, lic_key, ip_first, first_at, expires_at, resume_count, suspect, converted_key FROM trial_grants ORDER BY first_at DESC LIMIT 30;

-- @q: trial_attempts theo action
SELECT action, COUNT(*) n FROM trial_attempts GROUP BY action;

-- @q: audit_logs theo action
SELECT action, COUNT(*) n FROM audit_logs GROUP BY action ORDER BY n DESC;

-- @q: order_items.delivered_keys không null
SELECT order_id, product_id, quantity, delivered_keys FROM order_items WHERE delivered_keys IS NOT NULL AND delivered_keys <> '[]' LIMIT 20;

-- @q: users có username (cột thêm ngoài schema.sql)
SELECT COUNT(*) AS with_username, SUM(CASE WHEN username IS NULL THEN 1 ELSE 0 END) AS null_username FROM users;

-- @q: users theo role/status
SELECT role, status, COUNT(*) n FROM users GROUP BY role, status;
