-- QA teardown: remove ONLY the artefacts created by this QA session.
-- Scoped by exact usernames/txn_refs/order codes produced by qa/*.mjs.
PRAGMA foreign_keys = OFF;

DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE user_id IN (
  SELECT id FROM users WHERE username IN
  ('qae2e8ybhy','qbe2e8ybhy','qae2er40ka','qbe2er40ka','qawmcpoe','qp57yw2b')
));

DELETE FROM license_issues WHERE user_id IN (
  SELECT id FROM users WHERE username IN
  ('qae2e8ybhy','qbe2e8ybhy','qae2er40ka','qbe2er40ka','qawmcpoe','qp57yw2b')
);

DELETE FROM licenses WHERE key IN ('AOE1-QDA9-APVV-XEH9');

DELETE FROM refund_ledger WHERE order_id IN (SELECT id FROM orders WHERE user_id IN (
  SELECT id FROM users WHERE username IN
  ('qae2e8ybhy','qbe2e8ybhy','qae2er40ka','qbe2er40ka','qawmcpoe','qp57yw2b')
));

DELETE FROM payments WHERE txn_ref IN (
  'QAFIXWINDOW1','QAFIXUNMATCH1','QAFIXSHORT1','E2ER40KAE2E1',
  'QAFIXREPLAY1','QAFIXDEDUP1','QAWMCPOEAUTO1'
);

DELETE FROM orders WHERE user_id IN (
  SELECT id FROM users WHERE username IN
  ('qae2e8ybhy','qbe2e8ybhy','qae2er40ka','qbe2er40ka','qawmcpoe','qp57yw2b')
);

DELETE FROM sessions WHERE user_id IN (
  SELECT id FROM users WHERE username IN
  ('qae2e8ybhy','qbe2e8ybhy','qae2er40ka','qbe2er40ka','qawmcpoe','qp57yw2b')
);

DELETE FROM users WHERE username IN
  ('qae2e8ybhy','qbe2e8ybhy','qae2er40ka','qbe2er40ka','qawmcpoe','qp57yw2b');
