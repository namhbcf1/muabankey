-- ============================================================
-- ĐÁNH DẤU TOÀN BỘ GD TEST
--
-- Căn cứ: SePay API báo 0 giao dịch (chưa nối ngân hàng).
-- Mọi dòng trong `payments` đều do agent/script test tạo ra bằng
-- secret test, KHÔNG phải tiền thật vào ngân hàng.
--
-- Khi SePay được nối ngân hàng, GD thật sẽ có txn_ref do SePay
-- sinh (dạng số hoặc mã ngân hàng), không phải các pattern dưới.
-- ============================================================

-- Mọi GD sepay hiện có đều là test (SePay API = 0 giao dịch)
UPDATE payments SET is_test = 1
WHERE method IN ('sepay', 'payos', 'claim')
  AND COALESCE(is_test, 0) = 0;

-- GD thủ công của admin (duyệt tay) cũng không phải GD ngân hàng
UPDATE payments SET is_test = 1
WHERE confirmed_by IN ('admin', 'telegram', 'sepay-window')
  AND method = 'sepay'
  AND COALESCE(is_test, 0) = 0;

-- Xoá các dòng test hoàn toàn khỏi sổ (giữ lại dòng có order thật)
DELETE FROM payments
WHERE COALESCE(is_test, 0) = 1
  AND order_id IS NULL;

-- Thống kê sau khi dọn
SELECT
  CASE WHEN COALESCE(is_test,0)=1 THEN 'TEST' ELSE 'REAL' END AS loai,
  COUNT(*) AS so_dong,
  COALESCE(SUM(amount), 0) AS tong_tien
FROM payments
GROUP BY loai;
