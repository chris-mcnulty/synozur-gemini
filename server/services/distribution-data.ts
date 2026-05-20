/**
 * DB-bound fetchers for the distribution engine.
 *
 * Kept separate from `distribution-engine.ts` so the pure math file can be
 * unit-tested without a database connection. Anything in here imports
 * `db` (and therefore requires DATABASE_URL); the engine file does not.
 */

import { db } from "../db";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import {
  invoiceBatches, expenses, payrollRuns, payrollEmployees, payrollCompensation,
  timeEntries, entityOwners, distributionPolicy,
  type DistributionPolicy, type EntityOwner,
} from "@shared/schema";
import type { AvailableFundsBreakdown, FtePoolCandidate } from "./distribution-engine";

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

/**
 * Pull the four raw inputs from the database and apply reserves.
 *
 * Definitions:
 *  - "revenue collected" uses invoice_batches.payment_amount where
 *    payment_date falls inside the window (cash basis — what owners can
 *    actually distribute).
 *  - "operating expenses" excludes reimbursable employee expenses —
 *    those are pass-through to the employee/contractor, not company overhead.
 *  - "payroll burden" sums finalized payroll runs in window (gross +
 *    employer tax).
 */
export async function computeAvailableFunds(
  tenantId: string,
  periodStart: string,
  periodEnd: string,
  policy: DistributionPolicy,
): Promise<AvailableFundsBreakdown> {
  const paidBatches = await db.select({
    paymentAmount: invoiceBatches.paymentAmount,
  }).from(invoiceBatches).where(and(
    eq(invoiceBatches.tenantId, tenantId),
    gte(invoiceBatches.paymentDate, periodStart),
    lte(invoiceBatches.paymentDate, periodEnd),
  ));
  const revenueCollectedCents = paidBatches.reduce(
    (s, b) => s + toCents(b.paymentAmount), 0,
  );

  const opexRows = await db.select({
    amount: expenses.amount,
  }).from(expenses).where(and(
    eq(expenses.tenantId, tenantId),
    eq(expenses.reimbursable, false),
    gte(expenses.date, periodStart),
    lte(expenses.date, periodEnd),
  ));
  const operatingExpenseCents = opexRows.reduce(
    (s, e) => s + toCents(e.amount), 0,
  );

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
    (s, r) => s + (r.totalGrossCents ?? 0) + (r.totalEmployerTaxCents ?? 0), 0,
  );

  const taxReserveCents = pct(revenueCollectedCents, policy.taxReservePct);
  const months = Number(policy.operatingReserveMonths);
  const monthlyOpex = operatingExpenseCents / 3;
  const operatingReserveCents = Math.round(monthlyOpex * months);
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
    revenueCollectedCents, operatingExpenseCents, payrollBurdenCents,
    taxReserveCents, operatingReserveCents, waBoAccrualCents,
    availableFundsCents,
  };
}

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
    // Annualize hourly comp so an hourly worker isn't penalized in the
    // salary-weighted score.
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
      employee: emp, baseSalaryCents, tenureMonths,
      performanceScore: 3, // default until per-quarter reviews land
      hours,
    });
  }
  return candidates;
}

export async function fetchActiveOwners(tenantId: string): Promise<EntityOwner[]> {
  return await db.select().from(entityOwners).where(and(
    eq(entityOwners.tenantId, tenantId),
    sql`${entityOwners.effectiveTo} IS NULL`,
  ));
}

export async function fetchPolicy(tenantId: string): Promise<DistributionPolicy> {
  const rows = await db.select().from(distributionPolicy).where(
    eq(distributionPolicy.tenantId, tenantId),
  );
  if (rows[0]) return rows[0];
  // Auto-create the default policy on first read so the UI doesn't need
  // a separate "initialize" call.
  const inserted = await db.insert(distributionPolicy).values({ tenantId }).returning();
  return inserted[0];
}
