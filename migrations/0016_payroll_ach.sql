-- Phase 4: ACH/NACHA disbursement export.
--
-- Adds direct-deposit columns on payroll_employees and a per-tenant ACH
-- originator profile (company id, ODFI, immediate origin/destination) used
-- to populate the NACHA file header.
--
-- Bank account numbers are stored in a column suffixed _enc so the
-- production deployment can adopt envelope encryption without a column
-- rename. The stubbed implementation stores plain text; do not rely on it
-- for a real payroll cycle until encryption-at-rest is wired up.

ALTER TABLE "payroll_employees"
  ADD COLUMN IF NOT EXISTS "bank_routing_number"   varchar(9),
  ADD COLUMN IF NOT EXISTS "bank_account_number_enc" varchar(64),
  ADD COLUMN IF NOT EXISTS "bank_account_type"    varchar(16);

CREATE TABLE IF NOT EXISTS "payroll_ach_originator" (
  "id"                          varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"                   varchar NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE UNIQUE,
  "company_name"                varchar(16) NOT NULL,
  "company_id"                  varchar(10) NOT NULL,
  "originating_dfi"             varchar(8)  NOT NULL,
  "immediate_origin_name"       varchar(23) NOT NULL,
  "immediate_origin"            varchar(10) NOT NULL,
  "immediate_destination_name"  varchar(23) NOT NULL,
  "immediate_destination"       varchar(10) NOT NULL,
  "created_at"                  timestamp NOT NULL DEFAULT now(),
  "updated_at"                  timestamp NOT NULL DEFAULT now()
);
