UPDATE settings SET value='20000' WHERE key='topup_min';
UPDATE settings SET value='50000000' WHERE key='topup_max';
SELECT key, value FROM settings WHERE key IN ('topup_min','topup_max');
