-- Phase 1 of payroll integration: link internal users to payroll_employees.
--
-- Adds users.payroll_employee_type. When set ('w2' | '1099'), the API layer
-- provisions a linked payroll_employees row (payroll_employees.user_id) on
-- create/update. Clearing the value marks the linked employee 'terminated'.
--
-- The user_id FK on payroll_employees already exists from the payroll module's
-- original migration; we only add a lookup index.

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "payroll_employee_type" varchar(16);

CREATE INDEX IF NOT EXISTS "idx_payroll_emp_user"
  ON "payroll_employees" ("user_id");
