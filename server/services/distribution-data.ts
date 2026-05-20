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
  invoiceBatches, expenses, payrollRuns, payrollEmployees,
  entityOwners, distributionPolicy,
  type DistributionPolicy, type EntityOwner,
} from "@shared/schema";
// Note: payrollCompensation and timeEntries are referenced by raw SQL below
// (DISTINCT ON + GROUP BY queries) rather than via the Drizzle table objects,
// so they intentionally aren't imported from the schema module.
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

  const empIds = employees.map(e => e.id);
  const userIds = employees.map(e => e.userId).filter((u): u is string => !!u);

  // One query for effective compensation: latest row per employee whose
  // effective_from is on or before periodEnd. DISTINCT ON gives us O(1)
  // rows per employee, ordered by effective_from desc.
  const compRows = await db.execute(sql`
    SELECT DISTINCT ON (employee_id)
      employee_id, comp_type, amount_cents, hours_per_week
    FROM payroll_compensation
    WHERE tenant_id = ${tenantId}
      AND employee_id IN (${sql.join(empIds.map(id => sql`${id}`), sql`, `)})
      AND effective_from <= ${periodEnd}::date
    ORDER BY employee_id, effective_from DESC
  `);
  const compByEmp = new Map<string, { compType: string; amountCents: number; hoursPerWeek: string | null }>();
  for (const r of compRows.rows as any[]) {
    compByEmp.set(r.employee_id, {
      compType: r.comp_type,
      amountCents: Number(r.amount_cents),
      hoursPerWeek: r.hours_per_week,
    });
  }

  // One query for hours across the quarter, grouped by personId.
  const hoursByUser = new Map<string, number>();
  if (userIds.length > 0) {
    const hoursRows = await db.execute(sql`
      SELECT person_id, COALESCE(SUM(hours), 0)::numeric AS total_hours
      FROM time_entries
      WHERE person_id IN (${sql.join(userIds.map(id => sql`${id}`), sql`, `)})
        AND date >= (${periodEnd}::date - interval '3 months')
        AND date <= ${periodEnd}::date
      GROUP BY person_id
    `);
    for (const r of hoursRows.rows as any[]) {
      hoursByUser.set(r.person_id, Number(r.total_hours ?? 0));
    }
  }

  return employees.map(emp => {
    const c = compByEmp.get(emp.id);
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
    const hours = emp.userId ? (hoursByUser.get(emp.userId) ?? 0) : 0;
    return {
      employee: emp, baseSalaryCents, tenureMonths,
      performanceScore: 3, // default until per-quarter reviews land
      hours,
    };
  });
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
