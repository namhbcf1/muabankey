SELECT COUNT(*) n, MIN(at) mn, MAX(at) mx FROM lic_events WHERE detail LIKE '%rollback%';
