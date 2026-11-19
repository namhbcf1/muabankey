-- ===========================================================================
-- CỜ KHOÁ MÁY CHO TỪNG LICENSE
--
-- BỐI CẢNH: sau khi đổi sang "đã mua thì theo TÀI KHOẢN", một key KHÔNG có
-- chủ tài khoản (admin tạo tay, hoặc bán lẻ không qua đơn hàng) sẽ không bị
-- khoá bởi bất cứ thứ gì — ai có key cũng dùng được, chia sẻ vô hạn.
--
-- CỘT NÀY GIẢI QUYẾT: quyết định key khoá theo MÁY hay theo TÀI KHOẢN.
--   bind_hwid = 1  -> khoá theo MÁY (giống dùng thử)
--   bind_hwid = 0  -> theo TÀI KHOẢN (key bán qua đơn hàng)
--   bind_hwid NULL -> dữ liệu cũ: giữ nguyên hành vi trước đây (theo tài khoản)
-- ===========================================================================

ALTER TABLE licenses ADD COLUMN bind_hwid INTEGER;
