ALTER TABLE orders ADD COLUMN coupon_released INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_orders_coupon_released ON orders(coupon_code, coupon_released);
