-- ============================================================
-- Tối ưu index + sửa dữ liệu sai
-- ============================================================

-- product_keys: thêm created_at vào index để bỏ TEMP B-TREE khi lấy FIFO
DROP INDEX IF EXISTS idx_keys_product_status;
CREATE INDEX IF NOT EXISTS idx_keys_fifo ON product_keys(product_id, status, created_at);

-- orders: cover query dashboard (status + created_at + total)
CREATE INDEX IF NOT EXISTS idx_orders_status_created ON orders(status, created_at, total);

-- license_issues: tra cứu theo đơn khi refund
CREATE INDEX IF NOT EXISTS idx_li_order_key ON license_issues(order_id, license_key);
