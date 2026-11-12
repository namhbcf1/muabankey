-- Repair rows written with SECONDS where the column convention is MILLISECONDS.
-- Bounded to values that are unambiguously seconds (1..9999999999).
-- orders.<ts> is MILLISECONDS (matches orders.created_at = Date.now()).
UPDATE orders SET paid_at = paid_at * 1000
  WHERE paid_at IS NOT NULL AND paid_at > 0 AND paid_at < 10000000000;

UPDATE orders SET delivered_at = delivered_at * 1000
  WHERE delivered_at IS NOT NULL AND delivered_at > 0 AND delivered_at < 10000000000;

UPDATE orders SET processing_started_at = processing_started_at * 1000
  WHERE processing_started_at IS NOT NULL AND processing_started_at > 0
    AND processing_started_at < 10000000000;

-- topups already use ms everywhere (created_at/expires_at/paid_at) -> verify only.
SELECT COUNT(*) AS remaining_sec_orders FROM orders
 WHERE (paid_at IS NOT NULL AND paid_at > 0 AND paid_at < 10000000000)
    OR (delivered_at IS NOT NULL AND delivered_at > 0 AND delivered_at < 10000000000)
    OR (processing_started_at IS NOT NULL AND processing_started_at > 0
        AND processing_started_at < 10000000000);
