-- Siết lại ngưỡng chống lạm dụng về mức hợp lý.
-- Trước: 100/IP, 2000/net, 5000/ngày -> 1 người lấy 100 key/ngày
-- Nay: 20/IP/ngày (đủ cho quán net nhỏ + khách thật), 200/net, 500/ngày
INSERT INTO settings (key, value, updated_at) VALUES
  ('trial_max_per_ip',  '20',  0),
  ('trial_max_per_net', '200', 0),
  ('trial_max_per_day', '500', 0)
ON CONFLICT(key) DO UPDATE SET value = excluded.value;

-- Xoá whitelist IP khỏi production (ai cùng NAT với admin hưởng vô hạn).
-- Giữ hwid/weak của máy dev.
DELETE FROM trial_whitelist WHERE scope = 'ip';
