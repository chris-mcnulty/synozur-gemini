-- Platform-level state and local tax jurisdictions for 2024.
-- tenant_id = NULL means "available to all tenants"; tenants can override
-- per their needs by inserting tenant-scoped rows with the same code.
--
-- Brackets are annualized taxable-income brackets in cents:
--   upToCents: top of bracket (null = open-ended)
--   ratePct:   marginal rate
--   baseCents: tax owed on income up to the prior bracket cap
--
-- SUTA rules carry an employer-paid percent and a per-employee wage base.
-- New employers typically get the state's default new-employer rate; once
-- established, the state assigns an experience rate. Customize the rate
-- per tenant by inserting a row with a tenant_id.

INSERT INTO "payroll_tax_jurisdictions" ("tenant_id", "code", "name", "level", "rule", "is_active")
VALUES
  -- California 2024 (single brackets, simplified). Includes SDI as part of
  -- the flat employee percentage (1.1%). DE-4 worksheet not yet implemented.
  (NULL, 'US-CA', 'California', 'state', '{
    "kind":"brackets",
    "stdDeductionCents":543600,
    "brackets":[
      {"upToCents":1009900,"ratePct":1.0,"baseCents":0},
      {"upToCents":2394200,"ratePct":2.0,"baseCents":10099},
      {"upToCents":3776300,"ratePct":4.0,"baseCents":37784},
      {"upToCents":5241000,"ratePct":6.0,"baseCents":93068},
      {"upToCents":6620600,"ratePct":8.0,"baseCents":180956},
      {"upToCents":33812900,"ratePct":9.3,"baseCents":291324},
      {"upToCents":40588600,"ratePct":10.3,"baseCents":2820189},
      {"upToCents":67647500,"ratePct":11.3,"baseCents":3517769},
      {"upToCents":null,"ratePct":12.3,"baseCents":6575030}
    ]
  }'::jsonb, true),
  -- New York 2024 single brackets, simplified.
  (NULL, 'US-NY', 'New York', 'state', '{
    "kind":"brackets",
    "stdDeductionCents":800000,
    "brackets":[
      {"upToCents":850000,"ratePct":4.0,"baseCents":0},
      {"upToCents":1170000,"ratePct":4.5,"baseCents":34000},
      {"upToCents":1380000,"ratePct":5.25,"baseCents":48400},
      {"upToCents":8035000,"ratePct":5.5,"baseCents":59425},
      {"upToCents":21568000,"ratePct":6.0,"baseCents":425450},
      {"upToCents":107651000,"ratePct":6.85,"baseCents":1237430},
      {"upToCents":2588951000,"ratePct":9.65,"baseCents":7134112},
      {"upToCents":5189188000,"ratePct":10.3,"baseCents":246735162},
      {"upToCents":null,"ratePct":10.9,"baseCents":514599600}
    ]
  }'::jsonb, true),
  -- New York City local (resident only; engine applies to work-state=NY).
  (NULL, 'US-NY-NYC', 'New York City', 'local', '{
    "kind":"brackets",
    "parentState":"NY",
    "brackets":[
      {"upToCents":1200000,"ratePct":3.078,"baseCents":0},
      {"upToCents":2500000,"ratePct":3.762,"baseCents":36936},
      {"upToCents":5000000,"ratePct":3.819,"baseCents":85842},
      {"upToCents":null,"ratePct":3.876,"baseCents":181317}
    ]
  }'::jsonb, true),
  -- Philadelphia wage tax (resident rate; non-residents 3.44% — single rate
  -- used for simplicity; tenants needing the distinction should override).
  (NULL, 'US-PA-PHL', 'Philadelphia City Wage', 'local', '{
    "kind":"flat_percent",
    "parentState":"PA",
    "employeePct":3.75
  }'::jsonb, true),
  -- Pennsylvania flat 3.07%.
  (NULL, 'US-PA', 'Pennsylvania', 'state', '{
    "kind":"flat_percent",
    "employeePct":3.07
  }'::jsonb, true),
  -- New Jersey 2024 single brackets, simplified (residents).
  (NULL, 'US-NJ', 'New Jersey', 'state', '{
    "kind":"brackets",
    "stdDeductionCents":0,
    "brackets":[
      {"upToCents":2000000,"ratePct":1.4,"baseCents":0},
      {"upToCents":3500000,"ratePct":1.75,"baseCents":28000},
      {"upToCents":4000000,"ratePct":3.5,"baseCents":54250},
      {"upToCents":7500000,"ratePct":5.525,"baseCents":71750},
      {"upToCents":50000000,"ratePct":6.37,"baseCents":265125},
      {"upToCents":100000000,"ratePct":8.97,"baseCents":2972750},
      {"upToCents":null,"ratePct":10.75,"baseCents":7457250}
    ]
  }'::jsonb, true),
  -- SUTA samples (employer-only; default new-employer rates 2024).
  -- Tenants insert their experience-rated overrides per state.
  (NULL, 'SUTA-CA', 'California SUTA (new employer)', 'state', '{
    "kind":"suta",
    "ratePct":3.4,
    "wageBaseCents":700000
  }'::jsonb, true),
  (NULL, 'SUTA-NY', 'New York SUTA (new employer)', 'state', '{
    "kind":"suta",
    "ratePct":4.025,
    "wageBaseCents":1230000
  }'::jsonb, true)
ON CONFLICT DO NOTHING;
