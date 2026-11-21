-- ===========================================================================
-- 0003 — HỘP THƯ TIỀN VÀO BỀN VỮNG
--
-- Xem db/migrate-payment-inbox.sql để biết lý do đầy đủ.
-- Điểm cốt lõi: UNIQUE(provider, transaction_id) là lớp DUY NHẤT chặn được
-- hai webhook đồng thời cùng một giao dịch.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS payment_inbox (
  id              TEXT PRIMARY KEY,
  provider        TEXT NOT NULL,
  transaction_id  TEXT NOT NULL,
  account_number  TEXT,
  amount          INTEGER NOT NULL,
  content         TEXT,
  transfer_type   TEXT,
  is_test         INTEGER NOT NULL DEFAULT 0,
  state           TEXT NOT NULL DEFAULT 'received',
  order_id        TEXT,
  order_code      TEXT,
  deliver_state   TEXT NOT NULL DEFAULT 'none',
  raw             TEXT,
  received_at     INTEGER NOT NULL,
  processed_at    INTEGER,
  attempts        INTEGER NOT NULL DEFAULT 0,
  note            TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_payment_inbox_txn
  ON payment_inbox(provider, transaction_id);

CREATE INDEX IF NOT EXISTS idx_payment_inbox_state
  ON payment_inbox(state, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_inbox_order
  ON payment_inbox(order_id, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_inbox_unmatched
  ON payment_inbox(state, received_at DESC)
  WHERE state IN ('unmatched', 'wrong_amount', 'wrong_account');
