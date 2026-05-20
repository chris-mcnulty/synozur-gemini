-- Washington state payroll tax seeds.
--
-- Washington has no state income tax but levies three payroll premiums and
-- one employer-only unemployment tax that the engine needs to compute:
--
--   1. PFML  (Paid Family & Medical Leave) — split employee + employer
--      Total premium 0.92% (2024). Employer portion 28.57% of premium for
--      employers with 50+ employees; employees pay the remainder. Small
--      employers (<50) are not required to pay the employer share but may
--      opt in; we seed the large-employer split as the default and let
--      tenants override with a per-tenant row carrying their actual rates.
--      Wage cap: $168,600 (mirrors federal SS wage base for 2024).
--
--   2. WA Cares Fund — employee-only 0.58% on all wages (no cap).
--      Long-term care insurance trust, enacted 2023.
--
--   3. WA L&I (Workers' Comp / Labor & Industries) — hours-based premium
--      that varies by industry risk classification. NOT a wage-percent tax;
--      seeded as a 'todo' placeholder. Engine currently skips 'todo' kinds.
--      Actual L&I premiums require risk-class assignment per employee and
--      a per-hour rate table; tracked separately for now.
--
--   4. SUTA-WA — employer-only unemployment insurance. New-employer rate
--      averages ~1.0% on the first $68,500 of wages (2024 wage base).
--      Experience-rated employers replace this with their assigned rate.
--
-- B&O (Business & Occupation gross-receipts tax) is NOT a payroll tax and
-- is intentionally not seeded here — it applies to gross services revenue
-- at invoice time, not to wages. See docs/design/quarterly-profit-distribution.md
-- for the B&O treatment plan on the AR side.
--
-- Rates effective 2024; refresh annually.

INSERT INTO "payroll_tax_jurisdictions" ("tenant_id", "code", "name", "level", "rule", "is_active")
VALUES
  -- WA PFML: employee 0.6573%, employer 0.2627% (~28.57% of 0.92% total).
  -- Both portions capped at federal SS wage base ($168,600 in 2024).
  (NULL, 'US-WA-PFML', 'Washington Paid Family & Medical Leave', 'state', '{
    "kind":"wage_premium",
    "parentState":"WA",
    "employeePct":0.6573,
    "employerPct":0.2627,
    "wageBaseCents":16860000,
    "note":"2024 rates. Employers <50 employees: set employerPct to 0 via tenant override."
  }'::jsonb, true),

  -- WA Cares Fund: employee-only 0.58%, no wage cap.
  (NULL, 'US-WA-CARES', 'Washington Cares Fund', 'state', '{
    "kind":"wage_premium",
    "parentState":"WA",
    "employeePct":0.58,
    "note":"Long-term care trust. Exempt employees (private LTC insurance attested before 2022) require per-employee opt-out flag — tenant must override to 0 for exempt workers."
  }'::jsonb, true),

  -- WA L&I: hours-based, not wage-based. Seeded as todo so the engine and
  -- form generators acknowledge it exists without computing a wrong number.
  (NULL, 'US-WA-LNI', 'Washington L&I (Workers'' Comp)', 'state', '{
    "kind":"todo",
    "parentState":"WA",
    "basis":"hours_worked",
    "note":"Hours-based premium per risk classification. Requires risk_class_code on payroll_employees and per-class rate table. Tracked in distribution design doc."
  }'::jsonb, true),

  -- SUTA-WA: employer-only unemployment, new-employer default rate.
  (NULL, 'SUTA-WA', 'Washington SUTA (new employer)', 'state', '{
    "kind":"suta",
    "ratePct":1.0,
    "wageBaseCents":6850000,
    "note":"2024 new-employer rate. Experience-rated employers override via tenant-scoped row."
  }'::jsonb, true)
ON CONFLICT DO NOTHING;
