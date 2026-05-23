-- Payroll P1 production-readiness sweep — top 10 items 1, 5, 7.
--
-- 1. SSA EFW2 follow-ups: store the full 9-digit SSN encrypted at rest so
--    EFW2 doesn't have to take it in a request body. Encryption envelope is
--    the same v1:<iv>:<tag>:<ciphertext> shape as bank_account_number_enc.
--    Pre-existing rows keep only ssn_last4 until the next admin save.
--
-- 5. Off-cycle / bonus payroll runs: persist the subset of employees a
--    bonus run targets so preview only computes for those people. NULL or
--    empty array means "every active employee on the schedule" (regular
--    behaviour for non-bonus runs).
--
-- 7. HSA / Section 125 health reimbursement: tag each deduction with a
--    W-2 Box 12 code and a benefit category so the W-2 / EFW2 generators
--    can emit Box 12 totals per employee per year (W = HSA, DD = employer
--    health cost, D = 401(k), etc.). pre_tax_scope already covers the FICA
--    treatment; this just unblocks the form-output side.

ALTER TABLE "payroll_employees"
  ADD COLUMN IF NOT EXISTS "ssn_enc" varchar(256);

ALTER TABLE "payroll_runs"
  ADD COLUMN IF NOT EXISTS "target_employee_ids" jsonb;

ALTER TABLE "payroll_deductions"
  ADD COLUMN IF NOT EXISTS "box12_code" varchar(2);

ALTER TABLE "payroll_deductions"
  ADD COLUMN IF NOT EXISTS "benefit_category" varchar(32);
