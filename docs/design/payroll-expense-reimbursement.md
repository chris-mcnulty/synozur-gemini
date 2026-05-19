# Design: Employee Expense Reimbursement via Payroll

**Status:** Draft
**Author:** Gemini Payroll team
**Last Updated:** May 19, 2026
**Targets:** Constellation `expenses` + `reimbursement_batches` ↔ Gemini `payroll_runs`

## 1. Why integrate

Today Constellation tracks employee expenses end-to-end:

- `expenses` (rows per receipt, with `reimbursable`, `personId`, `amount`, `approvalStatus`)
- `expense_reports` (groupings of expenses with FSM `draft → submitted → approved → reimbursed`)
- `reimbursement_batches` + `reimbursement_line_items` (per-employee batches that Finance processes, currently with a free-form `paymentReferenceNumber`)

But payment of those batches is **out of band** — Finance writes a check, cuts an off-cycle ACH, or marks the batch `processed` after a manual bank transfer. That has three problems we now have the infrastructure to fix:

1. **Two ACH files per pay date.** Direct deposit comes out of Gemini; expense reimbursement comes out of a bank UI or a separate AP system. Employees see two transactions; Finance reconciles two batches against one bank statement.
2. **No single GL entry.** Wages and reimbursements hit GL on different days, sometimes different months. This complicates accruals and makes period close noisy.
3. **No audit trail tied to the pay event.** When an employee asks "where did this $147.32 come from?", we have to cross-reference an expense report ID against a bank memo. Gemini's payroll audit log doesn't see reimbursements at all.

Folding approved reimbursement batches into the next regular payroll run resolves all three at once.

## 2. User stories

- **Finance manager.** I want to approve an expense report and have the reimbursement automatically queued onto the next pay run. I want to override (delay) inclusion when cash flow requires.
- **Employee.** I want my reimbursement on the same ACH as my paycheck, and I want to see it on my paystub broken out from wages so I don't get confused about my withholding.
- **Accountant.** I want reimbursements coded to the right GL account (a *liability extinguishment*, not wages) and excluded from Box 1 W-2 wages.
- **CFO.** I want a single bank ACH file per pay date covering both wages and reimbursements.

## 3. Tax treatment — the only thing we cannot get wrong

Per IRS Publication 15 and Rev. Proc. 2009-16, business expense reimbursements fall into two regimes:

| Regime | Definition | Tax treatment |
|---|---|---|
| **Accountable plan** | Business connection + adequate substantiation + return of excess within 120 days | NOT wages. Not on W-2. Not subject to FIT, FICA, or FUTA. Reported in Box 12 of W-2 only if it includes mileage reimbursed above the federal rate. |
| **Non-accountable plan** | Anything that fails the accountable-plan tests (e.g., flat monthly stipend, no receipts) | Treated as wages. Goes on W-2 Box 1, 3, 5. Subject to FIT, FICA, FUTA. |

**Constellation already enforces the accountable-plan tests:**

- Business connection: every expense is tied to a `projectId` (line 1194 of `shared/schema.ts`).
- Substantiation: `expenseAttachments` table holds receipts; approval workflow requires them above category thresholds.
- Return of excess: not currently enforced, but expense submission is per-trip / per-month and approvals close out within 30 days of the period.

**Design decision:** treat all Constellation reimbursements as accountable-plan by default. Flag any expense category where the substantiation gate is configured as "no receipt required" (e.g., per diem under thresholds, mileage) as needing IRS rate review — those *might* spill into non-accountable territory if the rate exceeds federal.

For phase 1 we **explicitly do not support non-accountable reimbursements through payroll**. If a tenant wants a non-accountable plan (taxable stipends), they'll model that as recurring `payrollCompensation` of type `bonus`, not as expenses.

## 4. Data model

### 4a. New column: `expenses.payroll_run_item_id`

```ts
// shared/schema.ts (expenses table additions)
payrollRunItemId: varchar("payroll_run_item_id")
  .references(() => payrollRunItems.id, { onDelete: 'set null' }),
payrollReimbursedAt: timestamp("payroll_reimbursed_at"),
```

This is the only required schema change. It lets us:
- Query "which expenses have been reimbursed via payroll vs the legacy reimbursement batch path"
- Prevent double-payment (if `payrollRunItemId IS NOT NULL`, skip in the legacy batch UI)
- Surface a deep link on the employee paystub view

### 4b. New column: `payroll_run_items.reimbursementCents`

```ts
// adds to payrollRunItems
reimbursementCents: integer("reimbursement_cents").notNull().default(0),
```

This sits alongside `grossCents` / `bonusCents` and feeds into `netPayCents` **without** flowing through the tax engine. Distinct from `grossCents` so all the W-2 / 941 totals queries remain correct without filtering.

### 4c. New table: `payroll_reimbursement_lines`

```ts
export const payrollReimbursementLines = pgTable("payroll_reimbursement_lines", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id),
  runItemId: varchar("run_item_id").notNull().references(() => payrollRunItems.id, { onDelete: 'cascade' }),
  expenseId: varchar("expense_id").notNull().references(() => expenses.id, { onDelete: 'restrict' }),
  amountCents: integer("amount_cents").notNull(),
  category: text("category").notNull(), // mirrored from expenses.category
  description: text("description"),
});
```

One row per Constellation expense rolled into the run item. Lets the paystub itemize "what's in the $147.32" and lets the auditor reconcile to specific receipts.

## 5. Data flow — picking up reimbursable expenses

### 5a. Inclusion criteria

An expense becomes a payroll reimbursement candidate when ALL hold:

1. `expenses.reimbursable = true`
2. `expenses.approvalStatus = 'approved'`
3. `expenses.payrollRunItemId IS NULL` (not already on a run)
4. `expenses.reimbursementBatchId IS NULL` OR the batch's `status != 'processed'` (not paid out-of-band)
5. The owning user has an active `payroll_employees` row with `employeeType = 'w2'` (1099 reimbursements stay on the contractor invoice path)
6. `expenses.date <= payroll_runs.periodEnd` (don't reimburse expenses from future dates)

### 5b. `previewRun` extension

`server/storage/payroll.ts::previewRun` already loops over eligible employees. For each:

1. Query candidate expenses matching the inclusion criteria above for `emp.userId`.
2. Sum their `amount` (converting to integer cents).
3. Pass `reimbursementCents` into the engine call. The engine adds it to `netPayCents` AFTER tax math, never grossing it up:

```ts
// in payroll-engine.ts
const netPayCents = Math.max(
  0,
  grossCents - preTaxCents - employeeTaxCents - postTaxCents,
) + (inp.reimbursementCents ?? 0);
```

4. Insert one `payroll_reimbursement_lines` row per included expense, linked to the run item.
5. On `finalizeRun`, update each linked expense: `payrollRunItemId = item.id`, `payrollReimbursedAt = now()`.

### 5c. Engine output

The engine emits a `category: 'reimbursement'` line per included expense:

```
{ category: 'reimbursement', label: 'AA flight ORD→SFO 4/12', amountCents: 47832 }
```

The aggregate appears on the paystub between "Net pay (taxable)" and "Total deposited" so the employee sees the math.

## 6. ACH / NACHA changes

Today `buildNachaFile` emits one entry per employee with `amountCents = item.netPayCents`. Since we've folded reimbursement into `netPayCents`, **no NACHA changes are required**. The bank still gets one credit per employee; the increased amount is invisible at the file level.

The audit log entry for `run.ach_export` should record `totalReimbursementCents` so accountants can reconcile against expense reports without re-summing.

## 7. GL export changes

`buildGlExport` adds one new mapping category:

| Category | Debit/Credit | Source |
|---|---|---|
| `reimbursement_clearing` | Credit (reduces net_pay_clearing balance) | Sum of `reimbursementCents` across items |

The corresponding debit is the expense GL accounts that were already booked when the expense was *approved* in Constellation. Net effect: the AP liability that Constellation created at approval time is extinguished by the payroll run's net_pay clearing, leaving cash credit (the bank ACH) as the only new line.

If a tenant hasn't mapped `reimbursement_clearing`, default to `net_pay_clearing` — they get one big credit lump that's functionally correct but harder to reconcile.

## 8. UI changes

### 8a. Constellation expense detail page

Add a status pill: **"Will be reimbursed in next payroll run"** when inclusion criteria are met; **"Reimbursed via payroll run #..."** when already paid. Clicking the link opens the run detail with the reimbursement section scrolled into view.

### 8b. Payroll run detail page

New section between "Items" and "Totals":

```
Reimbursements bundled into this run
- Alex Morgan   $147.32  (AA flight 4/12)
- Jamie Patel    $63.50  (Uber 4/14 + lunch 4/15)
Total: $210.82
```

A row-level "Exclude" button moves the expense back to candidate status until the next run.

### 8c. Paystub (self-service)

Earnings card stays wages-only. New card:

```
Reimbursements (not taxable)
- AA flight 4/12 ORD→SFO    $478.32
- Cab to client 4/14         $45.00
- Lunch w/client 4/15        $52.10
Total                       $575.42
```

Net deposit line at the bottom shows the combined total so the employee can match against their bank statement.

### 8d. Finance "Reimbursement Batch" UI

Add a default behaviour: when a finance manager approves an expense report and the owner is enrolled in payroll, the system silently routes the reimbursement to the next run instead of creating a `reimbursement_batches` row. The legacy batch UI continues to work for:

- 1099 contractors (not enrolled in payroll)
- Termed employees who need a same-day check
- Tenants without Gemini Payroll enabled
- Explicit overrides ("pay via check this time")

A tenant setting `payrollReimbursementMode` ∈ `{auto, opt_in, off}` controls the default; `off` preserves today's behavior; `opt_in` requires per-batch admin confirmation; `auto` is the design above.

## 9. Edge cases

| Case | Handling |
|---|---|
| Expense report includes mixed reimbursable and non-reimbursable lines | Only `reimbursable=true` lines roll into payroll. Non-reimbursable (e.g., billable-only) stay on the expense report and never touch the run. |
| Expense in foreign currency | Constellation already stores `amountUsd` via the exchange-rate service. Use that. |
| Employee unenrolled from payroll between approval and pay date | Falls back to the legacy `reimbursement_batches` path automatically (criterion #5 fails at preview time). |
| Expense approved AFTER run is approved but before finalize | Re-running `preview` would pick it up but rebuild items — destructive. Disallow: candidate expenses are frozen at the moment `approve` is called on the run. |
| Reversal of a finalized run with reimbursements | The reversal item's `reimbursementCents` is negated. The linked expenses get `payrollRunItemId` cleared so they re-enter the candidate pool. Document in `payroll_audit_log` with `expensesReturned: [...ids]`. |
| Per diem above federal rate | Flagged at approval time in Constellation; the spillover portion is recorded on a separate row with `accountablePortion` and `nonAccountablePortion`. Phase 1 reimburses only `accountablePortion` via payroll; the rest stays on the report awaiting a decision (taxable stipend = bonus comp run, or owner repayment). |
| Expense paid via legacy batch THEN flagged for inclusion | Inclusion criterion #4 prevents this. Audit warning surfaced if state somehow inconsistent. |

## 10. Migration

```sql
-- 0020_payroll_expense_reimbursement.sql
ALTER TABLE expenses
  ADD COLUMN payroll_run_item_id varchar REFERENCES payroll_run_items(id) ON DELETE SET NULL,
  ADD COLUMN payroll_reimbursed_at timestamp;

CREATE INDEX idx_expenses_payroll_run_item ON expenses(payroll_run_item_id);

ALTER TABLE payroll_run_items
  ADD COLUMN reimbursement_cents integer NOT NULL DEFAULT 0;

CREATE TABLE payroll_reimbursement_lines (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id varchar NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  run_item_id varchar NOT NULL REFERENCES payroll_run_items(id) ON DELETE CASCADE,
  expense_id varchar NOT NULL REFERENCES expenses(id) ON DELETE RESTRICT,
  amount_cents integer NOT NULL,
  category text NOT NULL,
  description text,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX idx_payroll_reim_lines_run_item ON payroll_reimbursement_lines(run_item_id);
CREATE INDEX idx_payroll_reim_lines_expense ON payroll_reimbursement_lines(expense_id);
```

## 11. Rollout

Behind a tenant setting `payrollReimbursementMode`:

1. **Phase 1 (off by default).** Ship schema + endpoints. Tenants opt in via Settings → Payroll. Initial value `off` preserves current behavior.
2. **Phase 2.** Default to `opt_in` for new tenants. Existing tenants get an in-app prompt at next month-end close.
3. **Phase 3.** Promote to `auto` after 60 days of opt-in stability.

## 12. Open questions

1. **State income tax on reimbursements.** Even though federal treats accountable-plan reimbursements as non-wages, some states (CA, NJ) require reporting on the state's equivalent of Box 1. Need a per-state matrix; not blocking Phase 1.
2. **HSA / health benefit reimbursements.** Some tenants reimburse these via Constellation. These are pre-tax, not tax-free — they should reduce taxable wages. Out of scope for phase 1.
3. **Combined batches for 1099 contractors.** A 1099 contractor's reimbursements currently route to `contractor_invoices`. Phase 1 keeps that path. A future phase might fold them into a single contractor payment cycle that mirrors payroll.

## 13. Non-goals

- IRS-perfect mileage rate verification (we'll flag, not enforce).
- Multi-currency net pay (the underlying NACHA path is USD-only).
- Splitting one reimbursement across multiple payroll runs (admin can `Exclude` and re-include manually).
