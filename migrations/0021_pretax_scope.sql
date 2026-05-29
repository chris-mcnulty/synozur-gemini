-- Distinguish Section 125 (exempt from FICA + FUTA + federal income tax)
-- from 401(k) traditional (exempt from federal income tax only, FICA-taxable).
-- Pre-existing rows are backfilled to 'all' so the engine's prior FICA
-- treatment is preserved for in-progress runs; new rows default to
-- 'federal_only' which is the more conservative employer-side choice.

ALTER TABLE "payroll_deductions"
  ADD COLUMN IF NOT EXISTS "pre_tax_scope" varchar(20) DEFAULT 'federal_only';

UPDATE "payroll_deductions"
   SET "pre_tax_scope" = 'all'
 WHERE "deduction_type" = 'pre_tax' AND "pre_tax_scope" IS NULL;
