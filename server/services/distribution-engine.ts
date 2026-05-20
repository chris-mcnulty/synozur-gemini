/**
 * Quarterly profit distribution engine.
 *
 * Two responsibilities, kept in one module so the math stays auditable:
 *
 *   1. computeAvailableFunds — cash-basis aggregation for a quarter:
 *        revenue collected
 *        − operating expenses paid (non-reimbursable employee expenses)
 *        − payroll burden (gross + employer tax for finalized runs in window)
 *        − tax reserve  (configurable % of revenue collected)
 *        − operating reserve (configurable months of opex)
 *        − WA B&O accrual (if applicable to tenant)
 *      → available_funds
 *
 *   2. allocateDistribution — split available_funds into the owner + FTE
 *      pools per policy, then per-recipient amounts by:
 *        Owner pool : ownership_pct (entity_owners)
 *        FTE pool   : configurable salary/tenure/performance/hours weights
 *
 * The engine is pure: it takes already-fetched rows and returns a preview
 * object. Storage / route layers handle DB writes.
 *
 * See docs/design/quarterly-profit-distribution.md for the why behind
 * each calculation.
 */

import { db } from "../db";
import { and, eq, gte, lte, sql, inArray } from "drizzle-orm";
import {
  invoiceBatches, expenses, payrollRuns, payrollEmployees, payrollCompensation,
  timeEntries, entityOwners, distributionPolicy,
  type DistributionPolicy, type EntityOwner, type PayrollEmployee,
} from "@shared/schema";

const toCents = (decimal: string | number | null | undefined): number => {
  if (decimal == null) return 0;
  const n = typeof decimal === 'number' ? decimal : Number(decimal);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
};

const pct = (cents: number, pctValue: string | number): number => {
  const p = typeof pctValue === 'number' ? pctValue : Number(pctValue);
  return Math.round((cents * p) / 100);
};

/** Compute quarter start/end from a label like '2026-Q3'. */
export function quarterBounds(label: string): { start: string; end: string } {
  const m = /^(\d{4})-Q([1-4])$/.exec(label);
  if (!m) throw new Error(`Invalid quarter label: ${label}`);
  const year = Number(m[1]);
  const q = Number(m[2]);
  const startMonth = (q - 1) * 3 + 1;
  const endMonth = startMonth + 2;
  const endDay = new Date(Date.UTC(year, endMonth, 0)).getUTCDate();
  return {
    start: `${year}-${String(startMonth).padStart(2, '0')}-01`,
    end: `${year}-${String(endMonth).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`,
  };
}

export interface AvailableFundsBreakdown {
  revenueCollectedCents: number;
  operatingExpenseCents: number;
  payrollBurdenCents: number;
  taxReserveCents: number;
  operatingReserveCents: number;
  waBoAccrualCents: number;
  availableFundsCents: number;
}

/**
 * Pull the four raw inputs from the database and apply reserves.
 *
 * Note on definitions:
 *  - "revenue collected" uses invoice_batches.payment_amount where
 *    payment_date falls inside the window. We use the actual paid amount
 *    (not invoice total) because cash basis is what owners can distribute.
 *  - "operating expenses" excludes reimbursable employee expenses — those
 *    are pass-through to the employee/contractor, not company overhead.
 *  - "payroll burden" sums all finalized payroll runs in the window
 *    (gross + employer tax). This is the company's true labor cost.
 */
export async function computeAvailableFunds(
  tenantId: string,
  periodStart: string,
  periodEnd: string,
  policy: DistributionPolicy,
): Promise<AvailableFundsBreakdown> {
  // Revenue collected: paid invoice batches in window.
  const paidBatches = await db.select({
    paymentAmount: invoiceBatches.paymentAmount,
  }).from(invoiceBatches).where(and(
    eq(invoiceBatches.tenantId, tenantId),
    gte(invoiceBatches.paymentDate, periodStart),
    lte(invoiceBatches.paymentDate, periodEnd),
  ));
  const revenueCollectedCents = paidBatches.reduce(
    (s, b) => s + toCents(b.paymentAmount),
    0,
  );

  // Operating expenses: non-reimbursable expenses in window.
  // Reimbursable expenses are pass-through to the person, not company opex.
  const opexRows = await db.select({
    amount: expenses.amount,
  }).from(expenses).where(and(
    eq(expenses.tenantId, tenantId),
    eq(expenses.reimbursable, false),
    gte(expenses.date, periodStart),
    lte(expenses.date, periodEnd),
  ));
  const operatingExpenseCents = opexRows.reduce(
    (s, e) => s + toCents(e.amount),
    0,
  );

  // Payroll burden: finalized payroll runs in window.
  const payrollRows = await db.select({
    totalGrossCents: payrollRuns.totalGrossCents,
    totalEmployerTaxCents: payrollRuns.totalEmployerTaxCents,
  }).from(payrollRuns).where(and(
    eq(payrollRuns.tenantId, tenantId),
    eq(payrollRuns.status, 'finalized'),
    gte(payrollRuns.payDate, periodStart),
    lte(payrollRuns.payDate, periodEnd),
  ));
  const payrollBurdenCents = payrollRows.reduce(
    (s, r) => s + (r.totalGrossCents ?? 0) + (r.totalEmployerTaxCents ?? 0),
    0,
  );

  // Reserves are stacked on top of cash outflows: tax reserve scales with
  // revenue (estimated quarterly tax payment), operating reserve carves
  // out N months of opex run-rate.
  const taxReserveCents = pct(revenueCollectedCents, policy.taxReservePct);

  // Monthly run-rate from this quarter's opex × policy months.
  const months = Number(policy.operatingReserveMonths);
  const monthlyOpex = operatingExpenseCents / 3; // 3 months in a quarter
  const operatingReserveCents = Math.round(monthlyOpex * months);

  // WA B&O accrual: revenue × waBoRatePct. Zero for non-WA tenants by default.
  const waBoAccrualCents = pct(revenueCollectedCents, policy.waBoRatePct);

  const availableFundsCents = Math.max(
    0,
    revenueCollectedCents
      - operatingExpenseCents
      - payrollBurdenCents
      - taxReserveCents
      - operatingReserveCents
      - waBoAccrualCents,
  );

  return {
    revenueCollectedCents,
    operatingExpenseCents,
    payrollBurdenCents,
    taxReserveCents,
    operatingReserveCents,
    waBoAccrualCents,
    availableFundsCents,
  };
}

export interface DistributionPreviewLine {
  recipientUserId: string;
  recipientType: 'owner' | 'fte';
  recipientName: string;
  amountCents: number;
  weight: number;
  payoutMethod: 'ach_non_payroll' | 'payroll_bonus_run';
  breakdown: Record<string, any>;
}

export interface DistributionPreview {
  funds: AvailableFundsBreakdown;
  ownerPoolCents: number;
  ftePoolCents: number;
  lines: DistributionPreviewLine[];
  warnings: string[];
}

interface FtePoolCandidate {
  employee: PayrollEmployee;
  baseSalaryCents: number;
  tenureMonths: number;
  performanceScore: number; // 1..5, default 3
  hours: number;
}

/**
 * Allocate available funds into owner + FTE pools and produce per-recipient
 * lines. Caller supplies pre-fetched owners + FTE candidates so this stays
 * a pure function over data.
 */
export function allocateDistribution(
  funds: AvailableFundsBreakdown,
  policy: DistributionPolicy,
  owners: EntityOwner[],
  fteCandidates: FtePoolCandidate[],
): DistributionPreview {
  const warnings: string[] = [];
  const total = funds.availableFundsCents;

  // Pool split. Validate the two percentages add to ~100 (small floating
  // tolerance — they're decimals stored as strings).
  const ownerPct = Number(policy.ownerPoolPct);
  const ftePct = Number(policy.ftePoolPct);
  if (Math.abs(ownerPct + ftePct - 100) > 0.01) {
    warnings.push(`Owner + FTE pool percentages sum to ${(ownerPct + ftePct).toFixed(2)}, not 100. Pools will not cover full available funds.`);
  }
  const ownerPoolCents = Math.round((total * ownerPct) / 100);
  const ftePoolCents = Math.round((total * ftePct) / 100);

  const lines: DistributionPreviewLine[] = [];

  // ---- Owner pool ----------------------------------------------------------
  if (owners.length === 0 && ownerPoolCents > 0) {
    warnings.push('Owner pool > 0 but no active owners on file. Pool unallocated.');
  } else if (owners.length > 0) {
    const ownerPctSum = owners.reduce((s, o) => s + Number(o.ownershipPct), 0);
    if (Math.abs(ownerPctSum - 100) > 0.01) {
      warnings.push(`Owner ownership_pct rows sum to ${ownerPctSum.toFixed(2)}, not 100. Pool allocated proportionally to declared shares.`);
    }
    // Allocate proportionally, then sweep penny rounding into the largest
    // share so the lines exactly equal ownerPoolCents.
    let allocated = 0;
    const ownerAllocs = owners.map(o => {
      const share = ownerPctSum > 0 ? Number(o.ownershipPct) / ownerPctSum : 0;
      const amt = Math.round(ownerPoolCents * share);
      allocated += amt;
      return { owner: o, share, amountCents: amt };
    });
    if (ownerAllocs.length > 0) {
      const drift = ownerPoolCents - allocated;
      if (drift !== 0) {
        ownerAllocs.sort((a, b) => b.amountCents - a.amountCents);
        ownerAllocs[0].amountCents += drift;
      }
    }
    for (const a of ownerAllocs) {
      lines.push({
        recipientUserId: a.owner.userId,
        recipientType: 'owner',
        recipientName: '', // route layer joins user.name
        amountCents: a.amountCents,
        weight: a.share,
        payoutMethod: 'ach_non_payroll',
        breakdown: {
          ownershipPct: Number(a.owner.ownershipPct),
          ownerPoolCents,
          distributionMethod: a.owner.distributionMethod,
        },
      });
    }
  }

  // ---- FTE pool ------------------------------------------------------------
  if (fteCandidates.length === 0 && ftePoolCents > 0) {
    warnings.push('FTE pool > 0 but no eligible employees. Pool unallocated.');
  } else if (fteCandidates.length > 0) {
    const weights = (policy.fteWeights as any) ?? { salary: 60, tenure: 10, performance: 20, hours: 10 };
    const wSalary = Number(weights.salary ?? 0);
    const wTenure = Number(weights.tenure ?? 0);
    const wPerf   = Number(weights.performance ?? 0);
    const wHours  = Number(weights.hours ?? 0);
    const wTotal  = wSalary + wTenure + wPerf + wHours;
    if (wTotal <= 0) {
      warnings.push('FTE weights all zero; pool unallocated.');
    } else {
      // Normalize each factor across the candidate set before applying
      // weights — otherwise a single high-salary employee dominates.
      const maxSalary = Math.max(1, ...fteCandidates.map(c => c.baseSalaryCents));
      const maxTenure = Math.max(1, ...fteCandidates.map(c => c.tenureMonths));
      const maxPerf   = Math.max(1, ...fteCandidates.map(c => c.performanceScore));
      const maxHours  = Math.max(1, ...fteCandidates.map(c => c.hours));

      const scored = fteCandidates.map(c => {
        const sNorm = c.baseSalaryCents / maxSalary;
        const tNorm = c.tenureMonths / maxTenure;
        const pNorm = c.performanceScore / maxPerf;
        const hNorm = c.hours / maxHours;
        const score = (sNorm * wSalary) + (tNorm * wTenure) + (pNorm * wPerf) + (hNorm * wHours);
        return {
          candidate: c,
          score,
          contrib: {
            salary: sNorm * wSalary,
            tenure: tNorm * wTenure,
            performance: pNorm * wPerf,
            hours: hNorm * wHours,
          },
        };
      });
      const scoreSum = scored.reduce((s, x) => s + x.score, 0);
      if (scoreSum <= 0) {
        warnings.push('All FTE candidates scored zero; pool unallocated.');
      } else {
        let allocated = 0;
        const allocs = scored.map(x => {
          const share = x.score / scoreSum;
          const amt = Math.round(ftePoolCents * share);
          allocated += amt;
          return { ...x, share, amountCents: amt };
        });
        const drift = ftePoolCents - allocated;
        if (drift !== 0 && allocs.length > 0) {
          allocs.sort((a, b) => b.amountCents - a.amountCents);
          allocs[0].amountCents += drift;
        }
        for (const a of allocs) {
          if (!a.candidate.employee.userId) {
            warnings.push(`FTE ${a.candidate.employee.firstName} ${a.candidate.employee.lastName} has no linked user; skipped.`);
            continue;
          }
          lines.push({
            recipientUserId: a.candidate.employee.userId,
            recipientType: 'fte',
            recipientName: '',
            amountCents: a.amountCents,
            weight: a.share,
            payoutMethod: 'payroll_bonus_run',
            breakdown: {
              score: a.score,
              shareOfPool: a.share,
              contributions: a.contrib,
              baseSalaryCents: a.candidate.baseSalaryCents,
              tenureMonths: a.candidate.tenureMonths,
              performanceScore: a.candidate.performanceScore,
              hours: a.candidate.hours,
            },
          });
        }
      }
    }
  }

  return { funds, ownerPoolCents, ftePoolCents, lines, warnings };
}

/**
 * Fetch FTE pool candidates: active W-2 employees who are NOT flagged as
 * owners, with their effective compensation, tenure, and quarter hours.
 * Performance score defaults to 3 (mid) until per-quarter reviews land.
 */
export async function fetchFteCandidates(
  tenantId: string,
  periodEnd: string,
): Promise<FtePoolCandidate[]> {
  const employees = await db.select().from(payrollEmployees).where(and(
    eq(payrollEmployees.tenantId, tenantId),
    eq(payrollEmployees.employeeType, 'w2'),
    eq(payrollEmployees.status, 'active'),
    eq(payrollEmployees.isOwner, false),
  ));
  if (employees.length === 0) return [];

  const candidates: FtePoolCandidate[] = [];
  for (const emp of employees) {
    const comp = await db.select().from(payrollCompensation).where(and(
      eq(payrollCompensation.tenantId, tenantId),
      eq(payrollCompensation.employeeId, emp.id),
      lte(payrollCompensation.effectiveFrom, periodEnd),
    )).orderBy(sql`effective_from desc`).limit(1);
    const c = comp[0];
    // Normalize comp to an annual figure. Hourly comp is annualized at the
    // employee's hoursPerWeek × 52 so an hourly worker isn't penalized in
    // the salary-weighted score.
    const baseSalaryCents = c
      ? (c.compType === 'hourly'
          ? Math.round(c.amountCents * Number(c.hoursPerWeek ?? 40) * 52)
          : c.amountCents)
      : 0;

    const tenureMonths = emp.hireDate
      ? Math.max(0, Math.round(
          (new Date(periodEnd).getTime() - new Date(emp.hireDate).getTime())
          / (1000 * 60 * 60 * 24 * 30.4375),
        ))
      : 0;

    // Quarter hours from approved time entries.
    let hours = 0;
    if (emp.userId) {
      const hoursRows = await db.select({
        hours: timeEntries.hours,
      }).from(timeEntries).where(and(
        eq(timeEntries.personId, emp.userId),
        gte(timeEntries.date, sql`(${periodEnd}::date - interval '3 months')`),
        lte(timeEntries.date, periodEnd),
      ));
      hours = hoursRows.reduce((s, r) => s + Number(r.hours ?? 0), 0);
    }

    candidates.push({
      employee: emp,
      baseSalaryCents,
      tenureMonths,
      performanceScore: 3, // default until reviews land
      hours,
    });
  }
  return candidates;
}

/** Fetch active owners for a tenant. */
export async function fetchActiveOwners(tenantId: string): Promise<EntityOwner[]> {
  return await db.select().from(entityOwners).where(and(
    eq(entityOwners.tenantId, tenantId),
    sql`${entityOwners.effectiveTo} IS NULL`,
  ));
}

/** Fetch or initialize the policy for a tenant. */
export async function fetchPolicy(tenantId: string): Promise<DistributionPolicy> {
  const rows = await db.select().from(distributionPolicy).where(
    eq(distributionPolicy.tenantId, tenantId),
  );
  if (rows[0]) return rows[0];
  // Auto-create the default policy on first read so the UI doesn't need
  // a separate "initialize" call.
  const inserted = await db.insert(distributionPolicy).values({
    tenantId,
  }).returning();
  return inserted[0];
}
