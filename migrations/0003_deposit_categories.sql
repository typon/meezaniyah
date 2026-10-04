-- Correct earlier automatic merchant-based classifications of incoming deposits.
-- User-selected categories, transfers, negative charges, notes and review state
-- are deliberately preserved. No bank synchronization is needed.
UPDATE transactions
SET category_id = 'income'
WHERE category_override = 0
  AND amount_cents > 0
  AND category_id <> 'transfer'
  AND lower(description) NOT LIKE '%refund%'
  AND lower(description) NOT LIKE '%reversal%'
  AND lower(description) NOT LIKE '%return%'
  AND (
    lower(trim(description)) LIKE 'electronic deposit%'
    OR lower(trim(description)) LIKE 'ach credit%'
    OR lower(trim(description)) LIKE 'direct dep%'
    OR lower(trim(description)) LIKE 'directdep%'
    OR lower(trim(description)) LIKE 'payroll%'
    OR lower(trim(description)) LIKE 'salary%'
  );
