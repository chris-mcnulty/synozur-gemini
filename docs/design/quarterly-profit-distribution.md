# Design: Quarterly Profit Distribution

**Status:** Draft (May 20, 2026)
**Author:** Production tax planning branch
**Targets:** Synozur owners (Michelle, Chris) quarterly distributions + FTE
profit-sharing bonus pool, integrated with the existing Gemini Payroll module
and Constellation financial reporting.

## 1. What this is

A quarterly run that takes "available funds" at quarter-end and splits them
between two pools — an **owner distribution pool** (for member-LLC owners)
and an **FTE bonus pool** (for W-2 employees) — and pays each pool out via
the appropriate rails:

- Owner distributions → non-payroll ACH (no withholding); reported on K-1
  at year-end for pass-through entities, or 1099-DIV / W-2 Box 1 if the
  entity elects C-corp / S-corp treatment with reasonable comp.
- FTE bonuses → a supplemental payroll run (`runType: 'bonus'`, already in
  schema) with the IRS 22% supplemental federal rate + applicable state
  supplemental rate.

Today Constellation has nothing for either pool: no `distribution_runs`
table, no `profit_pool` calc, no owner entity class on `payroll_employees`
(only `w2 | 1099`), no K-1 export. This doc proposes the minimum
implementation.

## 2. Inputs — what feeds "available funds"

The math has to be defensible to a tax preparer and the two owners. Use
the same cash-basis aggregation that the financial-comparison report
already produces (rewritten in v2.5 as a SQL aggregation, Task #117):

```
available_funds = revenue_collected_quarter
                − operating_expenses_quarter
                − payroll_burden_quarter   (gross + employer tax + benefits)
                − tax_reserve              (federal estimated + WA B&O accrual)
                − operating_reserve        (configurable, default 3 months opex)
```

Each line is a tenant setting:

| Setting | Source | Default |
|---|---|---|
| `revenue_collected_quarter` | `payments.appliedAt` between quarter start/end, sum `paymentAmountCents` | derived |
| `operating_expenses_quarter` | `expenses.date` within quarter, `expenseCategory != reimbursable_to_employee` | derived |
| `payroll_burden_quarter` | `sum(payroll_run_items.grossCents + employerTaxCents)` for finalized runs in quarter | derived |
| `tax_reserve` | configurable `% of revenue_collected` | 25% |
| `operating_reserve_floor` | configurable USD; pool is whatever remains after this floor | 3 × monthly opex |

The "what's available" calc is a **preview** the owners review and approve
before the run finalizes. No automation can decide for them — the engine
shows the number and they accept / override.

## 3. Allocation model

Two pools with a tenant-configurable split. Default: 70% owner pool, 30%
FTE pool. Both percentages are stored on `distribution_policy` (new
table) and overridable per run.

### 3.1 Owner pool

Allocated by **ownership percent** held by each member. For Synozur today:

| Owner | Member-units | Pool share |
|---|---|---|
| Michelle | 50% | 50% of owner pool |
| Chris | 50% | 50% of owner pool |

Stored in a new `entity_owners` table per tenant:
```
entity_owners(
  id, tenant_id, user_id, ownership_pct numeric(7,4),
  effective_from date, effective_to date null,
  distribution_method varchar(16),  -- 'k1' | 'w2_bonus' | '1099_div'
  account_routing_enc, account_number_enc, account_type
)
```

A member can also be on payroll as a W-2 employee (Michelle and Chris
likely will be for reasonable-comp safe-harbor). Their owner distribution
is **separate from W-2 wages** and flows through its own ACH file
(non-payroll), not the payroll NACHA file.

### 3.2 FTE pool

Allocated to all active W-2 employees on the last day of the quarter,
weighted by a configurable formula:

```
weight_i  =  (base_salary_i × w_salary)
           + (tenure_months_i × w_tenure)
           + (performance_score_i × w_perf)
           + (billable_hours_i × w_hours)
```

Default weights: salary 60%, tenure 10%, performance 20%, hours 10%.
`performance_score_i` is a manager-supplied 1–5 captured per quarter on a
new `fte_performance_review` row. `billable_hours_i` comes from time
entries already in Constellation.

Owners-who-are-also-W-2-employees do **not** double-dip — they're
excluded from the FTE pool because their compensation flows through the
owner pool. A `payroll_employees.is_owner` flag (or join through
`entity_owners`) makes the exclusion explicit.

## 4. Run lifecycle (mirrors payroll runs)

```
distribution_runs (
  id, tenant_id, quarter_label varchar(7),  -- '2026-Q3'
  status varchar(20),  -- draft|previewed|approved|finalized|reversed
  available_funds_cents, owner_pool_cents, fte_pool_cents,
  reserve_pcts jsonb, allocation_weights jsonb,
  created_by, approved_by, approved_at, finalized_at, notes
)

distribution_lines (
  id, run_id, recipient_user_id, recipient_type varchar(16),
  -- 'owner' or 'fte'
  amount_cents, weight numeric, payout_method varchar(16),
  -- 'ach_non_payroll' (owners) or 'payroll_bonus_run' (FTEs)
  payroll_run_item_id null,  -- linked when FTE bonus finalizes through payroll
  ach_transfer_id null,
  status varchar(16),  -- 'pending'|'paid'|'reversed'
)
```

FSM matches payroll: `draft → previewed → approved → finalized`. Reversal
runs that unwind a finalized distribution use the same pattern already
implemented in the payroll module.

Idempotency: `(tenant_id, quarter_label)` is unique — you can't generate
two finalized runs for the same quarter without explicitly reversing
the first.

## 5. Payout rails

| Pool | Rail | Implementation |
|---|---|---|
| Owner | Non-payroll ACH | New NACHA file with class code `PPD` (consumer credit), generated by re-using `buildNachaFile` from the payroll module with a new originator-profile entry tagged `purpose='owner_distribution'`. Tax category on the GL export = `owner_distribution`, not `wages`. |
| FTE | Supplemental payroll run | Creates a `payroll_run` with `runType='bonus'`, `payDate = quarter_end + N days`, populated `payroll_run_items` with `bonusCents = fte_line.amount_cents`. Engine applies 22% federal supplemental + state supplemental + full FICA. Existing NACHA + tax-totals flow takes over. |

## 6. Tax artifacts at year-end

| Recipient type | Form | Source |
|---|---|---|
| Owner (member LLC default) | K-1 (1065) | New endpoint `/api/distribution/k1?year=X`; reads owner-pool lines + capital account ledger. **Not modeled in this design — accountant prepares K-1.** Engine just produces the line-item ledger. |
| Owner (S-corp election) | W-2 Box 1 (reasonable comp) + K-1 (1120-S) | W-2 flows through normal payroll; K-1 same as above. |
| Owner (C-corp election) | 1099-DIV Box 1a | Generate alongside existing 1099-NEC FIRE file by extending `tax-forms-efile.ts` with a `DIV` type-of-return. |
| FTE | W-2 (bonus rolls into Box 1) | Already handled by the existing `bonus` run type. |

## 7. Washington-specific concerns

WA B&O (Business & Occupation gross-receipts tax) is paid by the
business on services revenue, not on owner distributions or FTE wages:

- Service & Other Activities classification: **1.5%** on gross receipts
  (or 1.75% above $5M annually).
- Paid via WA DOR monthly/quarterly Excise Tax Return.

The tax reserve in §2 should include a B&O accrual line. Suggested
implementation:

1. Tenant setting `tenants.waBoRatePct` defaulting to 1.5 when state = WA.
2. `b_and_o_reserve_cents = revenue_collected_quarter × waBoRatePct`,
   added to `tax_reserve` for WA-domiciled tenants.
3. Future work: an Excise Tax Return artifact (HTML + CSV) under
   `/api/tax-forms/wa-bo` mirroring the 941 endpoint pattern.

WA L&I (workers' comp) is hours-based, not wage-based — handled separately
once risk classification is wired into `payroll_employees`. See the
`US-WA-LNI` jurisdiction seeded in migration 0023 (currently `kind: todo`).

## 8. Scope decisions

### In scope (Phase 1)

- `entity_owners` + `distribution_policy` + `distribution_runs` +
  `distribution_lines` tables (migration 0024).
- Preview endpoint that computes available funds + pool splits + per-line
  amounts.
- Approve / finalize endpoints (FSM same as payroll runs).
- Owner non-payroll ACH file (reuses `buildNachaFile`).
- FTE bonus pool flowing into a bonus payroll run via existing schema.
- WA B&O accrual line in the available-funds calc.
- Admin UI page `/distributions` (mirror of `/payroll/runs`).

### Out of scope (Phase 2+)

- K-1 PDF generation (accountant prepares).
- 1099-DIV FIRE file (extend later when a tenant elects C-corp).
- Multi-currency distributions (USD-only first cut).
- Owner capital account ledger (just per-run snapshots in Phase 1).
- L&I integration (separate work item — see `US-WA-LNI` seed).
- Automatic available-funds calc trigger (Phase 1 is manual preview).

## 9. Open questions for Michelle + Chris

1. **Entity tax election?** Default in this doc is partnership-LLC with
   K-1 reporting. If S-corp election is on the table, the reasonable-comp
   floor changes the W-2 / distribution split per quarter.
2. **Reserve percentages?** Default 25% tax + 3-month opex. Confirm or
   override.
3. **FTE weighting?** Default 60/10/20/10 (salary/tenure/perf/hours).
   Worth gut-checking against what other 5–10 person consultancies use.
4. **Quarterly cadence vs. annual?** Quarterly matches estimated tax
   payment cadence and gives the WA B&O monthly accrual a natural
   reconciliation point. Annual is simpler but bigger swings.
5. **Should owner draws happen on a fixed date (e.g., 15th of month
   following quarter close) or whenever the run is approved?** Fixed
   date simplifies cashflow planning.

Once §9 is settled, the schema + endpoints in §4–5 are about a week of
work. The UI is another week.
