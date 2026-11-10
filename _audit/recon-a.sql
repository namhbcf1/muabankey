-- A1: ledger vs users.balance
SELECT 'A1_ledger_mismatch' AS chk, COUNT(*) AS n FROM (
  SELECT u.id FROM users u
  LEFT JOIN wallet_transactions wt ON wt.user_id = u.id
  GROUP BY u.id, u.balance
  HAVING u.balance != COALESCE(SUM(wt.amount), 0)
);
-- A5: negative balances
SELECT 'A5_negative_balance' AS chk, COUNT(*) AS n, COALESCE(SUM(balance),0) AS total_neg FROM users WHERE balance < 0;
-- A3: topup tx vs topups paid
SELECT 'A3_sum_wt_topup' AS chk, COALESCE(SUM(amount),0) AS v FROM wallet_transactions WHERE type = 'topup';
SELECT 'A3_sum_topups_paid' AS chk, COALESCE(SUM(amount),0) AS v FROM topups WHERE status = 'paid';
SELECT 'A3_sum_topups_partial_crosscheck' AS chk, status, COUNT(*) n, COALESCE(SUM(amount),0) v FROM topups GROUP BY status;
