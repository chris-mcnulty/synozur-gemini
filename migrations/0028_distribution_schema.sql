-- Quarterly profit distribution schema.
--
-- Four new tables + one column on payroll_employees:
--
--   entity_owners       — who shares in the owner pool, ownership %, payout method
--   distribution_policy — per-tenant pool split, reserves, FTE weights
--   distribution_runs   — one row per quarter, immutable once finalized
--   distribution_lines  — per recipient per run; FK to payroll_run_items for FTE
--                         lines, or carries non-payroll ACH metadata for owners
--   payroll_employees.is_owner — keeps owner-employees out of the FTE pool
--
-- Money is in integer cents to match payroll. Percent fields are stored as
-- numeric(7,4) so 50% reads as 50.0000 (matches existing tax-jurisdiction
-- rate convention).
--
-- FSM mirrors payroll_runs: draft → previewed → approved → finalized → reversed.

CREATE TABLE IF NOT EXISTS "entity_owners" (
  "id"                   varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"            varchar NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "user_id"              varchar NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "ownership_pct"        numeric(7,4) NOT NULL,
  "effective_from"       date NOT NULL,
  "effective_to"         date,
  "distribution_method"  varchar(16) NOT NULL DEFAULT 'k1', -- 'k1' | 'w2_bonus' | '1099_div'
  -- Bank routing/account for the non-payroll ACH file. Encrypted via the same
  -- AES-256-GCM envelope as payroll_employees.bank_account_number_enc.
  "bank_routing_number"  varchar(9),
  "bank_account_number_enc" varchar(256),
  "bank_account_type"    varchar(16), -- 'checking' | 'savings'
  "notes"                text,
  "created_at"           timestamp NOT NULL DEFAULT now(),
  "updated_at"           timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_entity_owners_tenant"
  ON "entity_owners"("tenant_id", "effective_from");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_entity_owners_active_per_user"
  ON "entity_owners"("tenant_id", "user_id")
  WHERE "effective_to" IS NULL;

CREATE TABLE IF NOT EXISTS "distribution_policy" (
  "id"                       varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"                varchar NOT NULL UNIQUE REFERENCES "tenants"("id") ON DELETE CASCADE,
  -- Pool split, must total 100. Defaults reflect a typical owner-heavy split.
  "owner_pool_pct"           numeric(7,4) NOT NULL DEFAULT 70.0000,
  "fte_pool_pct"             numeric(7,4) NOT NULL DEFAULT 30.0000,
  -- Reserves carved out before pool math.
  "tax_reserve_pct"          numeric(7,4) NOT NULL DEFAULT 25.0000,
  "operating_reserve_months" numeric(5,2) NOT NULL DEFAULT 3.00,
  -- WA B&O accrual rate, applied to revenue_collected when tenant home state = WA.
  -- 0 means "not applicable" (default for non-WA tenants).
  "wa_bo_rate_pct"           numeric(7,4) NOT NULL DEFAULT 0.0000,
  -- FTE pool weights; the engine normalizes per-employee weights to the pool.
  -- Stored as a jsonb so adding new factors later doesn't require a migration.
  "fte_weights"              jsonb NOT NULL DEFAULT
    '{"salary":60,"tenure":10,"performance":20,"hours":10}',
  "created_at"               timestamp NOT NULL DEFAULT now(),
  "updated_at"               timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "distribution_runs" (
  "id"                       varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"                varchar NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "quarter_label"            varchar(7) NOT NULL, -- '2026-Q3'
  "period_start"             date NOT NULL,
  "period_end"               date NOT NULL,
  "status"                   varchar(20) NOT NULL DEFAULT 'draft',
    -- draft | previewed | approved | finalized | reversed
  -- Numbers captured at preview/finalize so the audit trail survives
  -- subsequent policy edits.
  "available_funds_cents"    integer NOT NULL DEFAULT 0,
  "revenue_collected_cents"  integer NOT NULL DEFAULT 0,
  "operating_expense_cents"  integer NOT NULL DEFAULT 0,
  "payroll_burden_cents"     integer NOT NULL DEFAULT 0,
  "tax_reserve_cents"        integer NOT NULL DEFAULT 0,
  "operating_reserve_cents"  integer NOT NULL DEFAULT 0,
  "wa_bo_accrual_cents"      integer NOT NULL DEFAULT 0,
  "owner_pool_cents"         integer NOT NULL DEFAULT 0,
  "fte_pool_cents"           integer NOT NULL DEFAULT 0,
  -- Policy snapshot at preview time so reruns don't drift.
  "policy_snapshot"          jsonb,
  -- Linkage if FTE pool was paid via a supplemental payroll run.
  "fte_payroll_run_id"       varchar REFERENCES "payroll_runs"("id") ON DELETE SET NULL,
  -- Linkage to a reversal run (the one this run reverses).
  "reverses_run_id"          varchar,
  "created_by"               varchar REFERENCES "users"("id"),
  "approved_by"              varchar REFERENCES "users"("id"),
  "approved_at"              timestamp,
  "finalized_at"             timestamp,
  "notes"                    text,
  "created_at"               timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_distribution_runs_tenant"
  ON "distribution_runs"("tenant_id", "period_end");
-- One finalized run per (tenant, quarter). Reversed runs don't block a new
-- one because `status = 'reversed'` is excluded from the partial index.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_distribution_runs_finalized_quarter"
  ON "distribution_runs"("tenant_id", "quarter_label")
  WHERE "status" IN ('previewed','approved','finalized');

CREATE TABLE IF NOT EXISTS "distribution_lines" (
  "id"                       varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"                varchar NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "run_id"                   varchar NOT NULL REFERENCES "distribution_runs"("id") ON DELETE CASCADE,
  "recipient_user_id"        varchar NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "recipient_type"           varchar(16) NOT NULL, -- 'owner' | 'fte'
  "amount_cents"             integer NOT NULL DEFAULT 0,
  "weight"                   numeric(14,6) NOT NULL DEFAULT 0,
  "payout_method"            varchar(20) NOT NULL,
    -- 'ach_non_payroll' (owners) | 'payroll_bonus_run' (FTEs)
  -- For FTE lines: the payroll_run_items row that carried the bonus.
  "payroll_run_item_id"      varchar REFERENCES "payroll_run_items"("id") ON DELETE SET NULL,
  -- For owner lines: NACHA trace number once the ACH file was generated.
  "ach_trace_number"         varchar(15),
  "status"                   varchar(16) NOT NULL DEFAULT 'pending',
    -- pending | paid | reversed
  -- Breakdown of how the weight was computed (salary/tenure/perf/hours contribs).
  "breakdown"                jsonb,
  "created_at"               timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_distribution_lines_run"
  ON "distribution_lines"("run_id");
CREATE INDEX IF NOT EXISTS "idx_distribution_lines_recipient"
  ON "distribution_lines"("tenant_id", "recipient_user_id");

-- Owners-who-are-also-W-2-employees opt out of the FTE bonus pool.
ALTER TABLE "payroll_employees"
  ADD COLUMN IF NOT EXISTS "is_owner" boolean NOT NULL DEFAULT false;
