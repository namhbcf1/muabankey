-- ============================================================
-- FIX P0-1/P0-2/P0-3: mốc thời gian trạng thái + chống tiền giả
--
-- Vấn đề: cron dùng `created_at` để reset đơn kẹt. Đơn tạo > 10 phút
-- trước khi refund sẽ bị cron "hồi sinh" thành 'delivered', rồi admin
-- refund lại được -> hoàn tiền nhiều lần.
--
-- Giải pháp: thêm cột mốc riêng cho từng trạng thái, cron dùng cột đó.
-- ============================================================

-- Mốc bắt đầu refund / processing (không dùng created_at/paid_at)
ALTER TABLE orders ADD COLUMN refund_started_at INTEGER;
ALTER TABLE orders ADD COLUMN processing_started_at INTEGER;

-- Cột đánh dấu đơn đã ghi sổ ví chưa (chống trừ tiền mà không ghi sổ)
ALTER TABLE orders ADD COLUMN ledger_written INTEGER NOT NULL DEFAULT 0;

-- Index cho cron tìm đơn kẹt
CREATE INDEX IF NOT EXISTS idx_orders_refund_started
  ON orders(status, refund_started_at);
CREATE INDEX IF NOT EXISTS idx_orders_processing_started
  ON orders(status, processing_started_at);

-- Backfill: đơn đang refunding/processing lấy mốc hiện tại
UPDATE orders SET refund_started_at = created_at
  WHERE status = 'refunding' AND refund_started_at IS NULL;
UPDATE orders SET processing_started_at = created_at
  WHERE status = 'processing' AND processing_started_at IS NULL;

-- Backfill ledger_written cho đơn delivered đã có purchase tx
UPDATE orders SET ledger_written = 1
  WHERE status IN ('delivered', 'refunded')
    AND EXISTS (SELECT 1 FROM wallet_transactions wt
                WHERE wt.reference = orders.code AND wt.type = 'purchase');
