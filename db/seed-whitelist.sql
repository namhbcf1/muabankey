INSERT INTO trial_whitelist (scope, value, note, created_at, created_by) VALUES
  ('weak',   '8a93326396b6495abb98a71e2927a57e', 'May dev - ADMIN PC', strftime('%s','now'), 'setup'),
  ('hwid',   '775c3fd37c703a3e3a1069cb007ffb4e', 'May dev - ADMIN PC', strftime('%s','now'), 'setup'),
  ('ip',     '118.68.111.165', 'IP nha dev', strftime('%s','now'), 'setup')
ON CONFLICT(scope, value) DO NOTHING;
