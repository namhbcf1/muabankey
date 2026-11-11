-- Chuyển 10 license từ xa_license sang muabankey-db
-- Giữ nguyên hwid / activated_at / expires_at / rebinds để khách không bị ảnh hưởng.

DELETE FROM licenses;

INSERT INTO licenses
  (key, hwid, plan, note, created_at, activated_at, expires_at,
   last_seen, last_ip, revoked, max_rebind, rebinds)
VALUES
(
  'AOE1TUAN', '251bc0f0192491ffa341f6896620f9dc', 'aoe1', 'goi TUAN',
  1794262129, 1794263322, 1794954522,
  1794263379, NULL, 0,
  1, 0
),
(
  'AOE1THANG', NULL, 'aoe1', 'goi THANG',
  1794262129, NULL, 1796941668,
  1794262598, NULL, 0,
  1, 0
),
(
  'AOE1NAM', 'reproAAAA000000000000000000000a', 'aoe1', 'goi NAM',
  1794262129, 1794266666, 1825889066,
  1794266666, NULL, 0,
  1, 0
),
(
  'AOE1VINHVIEN', NULL, 'aoe1', 'goi VINHVIEN',
  1794262129, NULL, 0,
  1794262146, NULL, 0,
  1, 0
),
(
  'AOE1-EAGN-NYJY-HL58', NULL, 'aoe1', 'Don MBK-U35W33 - XArena No Fog — Gói Tháng',
  1794266615, NULL, 1799537016,
  1794266616, NULL, 0,
  1, 0
),
(
  'TEST-JLB5-Y6FV-8PRV', 'e2eddddddddddddddddddddddddddddd', 'test', 'E2E test',
  1794266622, 1794266622, 1794957822,
  1794266622, NULL, 0,
  1, 0
),
(
  'TEST-7SXN-KZZA-Z78P', NULL, 'test', 'E2E test',
  1794266622, NULL, 1794957822,
  NULL, NULL, 0,
  1, 0
),
(
  'TEST-9G4Y-6QEB-YRL5', NULL, 'test', 'E2E test',
  1794266622, NULL, 1794957822,
  NULL, NULL, 0,
  1, 0
),
(
  'REPRO-0000-0000-0001', 'reproCCCC000000000000000000000c', 'aoe1', 'repro firstBind',
  1794266680, 1794266680, 1796945080,
  1794266680, NULL, 0,
  1, 0
),
(
  'TEST-INST-0001', NULL, 'aoe1', 'installer test',
  1794267125, NULL, 1796859125,
  NULL, NULL, 0,
  1, 0
);
