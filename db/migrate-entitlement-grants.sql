-- ===========================================================================
-- SỔ CẤP QUYỀN BẤT BIẾN (entitlement_grants)
--
-- VÌ SAO CẦN: `account_entitlements` chỉ là ẢNH CHỤP mới nhất (mỗi tài khoản
-- một dòng mỗi tính năng). Khi một đơn bị hoàn tiền, không có cách nào biết
-- đơn đó đã cộng bao nhiêu ngày, nên không thể thu hồi ĐÚNG PHẦN CỦA NÓ.
--
-- Hệ quả thật của việc thiếu sổ: hoàn đơn A trong khi khách đã mua A+B thì
-- hoặc không thu hồi được gì (giữ nguyên quyền A miễn phí), hoặc xoá cả dòng
-- (mất luôn quyền B khách đã trả tiền). Cả hai đều sai.
--
-- Bảng này ghi TỪNG LẦN cấp: ai, tính năng nào, cộng bao nhiêu ngày, từ đơn
-- nào, và hạn TRƯỚC/SAU lần cấp đó. Nhờ vậy:
--   * retry cùng một đơn  -> idempotency_key UNIQUE chặn cộng lần hai;
--   * hoàn tiền đơn A     -> trừ đúng days_added của A, không đụng B;
--   * đối soát            -> dựng lại được toàn bộ lịch sử quyền.
--
-- LƯU Ý: bảng APPEND-ONLY. Không sửa dòng cũ; thu hồi thì ghi revoked_at.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS entitlement_grants (
  grant_id        TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,
  feature         TEXT NOT NULL,                -- 'nofog' | 'grant'
  source_type     TEXT NOT NULL,                -- purchase | trial | admin
  source_id       TEXT,                         -- order_id / 'trial' / admin id
  days_added      INTEGER NOT NULL DEFAULT 0,   -- số ngày THỰC SỰ đã cộng
  prev_expires_at INTEGER NOT NULL DEFAULT 0,   -- hạn TRƯỚC khi cấp
  new_expires_at  INTEGER NOT NULL DEFAULT 0,   -- hạn SAU khi cấp (0 = vĩnh viễn)
  created_at      INTEGER NOT NULL,
  revoked_at      INTEGER,
  revoke_reason   TEXT,
  note            TEXT
);

-- Một đơn chỉ được cấp MỘT lần cho một tính năng. Đây là lớp chống cấp trùng
-- ở tầng DB, không dựa vào kiểm tra trong ứng dụng (vốn có khe đua).
CREATE UNIQUE INDEX IF NOT EXISTS ux_ent_grant_idem
  ON entitlement_grants(user_id, feature, source_type, source_id)
  WHERE source_id IS NOT NULL AND source_type = 'purchase';

CREATE INDEX IF NOT EXISTS idx_ent_grant_user ON entitlement_grants(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ent_grant_source ON entitlement_grants(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_ent_grant_open ON entitlement_grants(user_id, feature, revoked_at);
