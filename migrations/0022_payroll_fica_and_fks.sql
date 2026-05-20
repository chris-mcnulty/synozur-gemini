-- Persist FICA-taxable wages per run item.
-- Backfills set the value to gross - pre-tax for legacy rows so existing YTD
-- accumulators don't suddenly go to zero; new rows are populated by the
-- engine. NOT a perfect backfill (it doesn't know which legacy deductions
-- were Section 125 vs 401(k)), but it preserves the prior aggregate.

ALTER TABLE "payroll_run_items"
  ADD COLUMN IF NOT EXISTS "fica_taxable_wages_cents" integer NOT NULL DEFAULT 0;

UPDATE "payroll_run_items"
   SET "fica_taxable_wages_cents" = GREATEST(0, "gross_cents" - "pre_tax_deduction_cents")
 WHERE "fica_taxable_wages_cents" = 0
   AND "gross_cents" <> 0;

-- Promote previously-undeclared foreign key on expenses.payroll_run_item_id
-- to a real constraint so dropping a run item can't leave dangling refs.
-- ON DELETE SET NULL because expense lifecycles outlive payroll lifecycles.
DO $$ BEGIN
  ALTER TABLE "expenses"
    ADD CONSTRAINT "expenses_payroll_run_item_id_fk"
    FOREIGN KEY ("payroll_run_item_id") REFERENCES "payroll_run_items"("id")
    ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
