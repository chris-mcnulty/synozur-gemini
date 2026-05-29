-- Fold Constellation expense reimbursements into payroll runs.
--
-- Adds:
--   - expenses.payroll_run_item_id + expenses.payroll_reimbursed_at: when a
--     reimbursable expense was paid via Gemini Payroll instead of the legacy
--     reimbursement-batch path.
--   - payroll_run_items.reimbursement_cents: per-employee reimbursement total
--     for the run; added to net pay AFTER tax math (accountable-plan, not
--     wages).
--   - payroll_reimbursement_lines: one row per included expense, supporting
--     itemized paystub display and auditor reconciliation back to receipts.

ALTER TABLE "expenses"
  ADD COLUMN IF NOT EXISTS "payroll_run_item_id"   varchar,
  ADD COLUMN IF NOT EXISTS "payroll_reimbursed_at" timestamp;

CREATE INDEX IF NOT EXISTS "idx_expenses_payroll_run_item"
  ON "expenses" ("payroll_run_item_id");

ALTER TABLE "payroll_run_items"
  ADD COLUMN IF NOT EXISTS "reimbursement_cents" integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "payroll_reimbursement_lines" (
  "id"           varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"    varchar NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "run_item_id"  varchar NOT NULL REFERENCES "payroll_run_items"("id") ON DELETE CASCADE,
  "expense_id"   varchar NOT NULL,
  "amount_cents" integer NOT NULL,
  "category"     text NOT NULL,
  "description"  text,
  "created_at"   timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_payroll_reim_lines_run_item"
  ON "payroll_reimbursement_lines" ("run_item_id");
CREATE INDEX IF NOT EXISTS "idx_payroll_reim_lines_expense"
  ON "payroll_reimbursement_lines" ("expense_id");

-- Optional FK to expenses(id). Done as a separate statement so the migration
-- still applies cleanly even if a tenant has dangling expense_id values from
-- a prior backfill.
DO $$ BEGIN
  ALTER TABLE "payroll_reimbursement_lines"
    ADD CONSTRAINT "payroll_reim_lines_expense_fk"
    FOREIGN KEY ("expense_id") REFERENCES "expenses"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
