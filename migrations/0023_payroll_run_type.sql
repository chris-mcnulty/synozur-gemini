-- Reversal and off-cycle (bonus) runs. Reversal runs reference the run
-- they undo via reverses_run_id; their run items carry negative amounts
-- so the YTD accumulators net them out automatically.

ALTER TABLE "payroll_runs"
  ADD COLUMN IF NOT EXISTS "run_type"          varchar(16) NOT NULL DEFAULT 'regular',
  ADD COLUMN IF NOT EXISTS "reverses_run_id"   varchar;

CREATE INDEX IF NOT EXISTS "idx_payroll_runs_reverses"
  ON "payroll_runs" ("reverses_run_id");
