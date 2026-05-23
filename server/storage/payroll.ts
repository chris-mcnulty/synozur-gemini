/**
 * Gemini payroll storage module — tenant-scoped CRUD + payroll run lifecycle.
 *
 * SECURITY: Every method takes tenantId from the caller (route layer derives it
 * from req.user). All queries are filtered by tenant_id. NEVER trust client.
 */

import { db } from "../db";
import { and, eq, desc, gte, lte, isNull, isNotNull, inArray, sql, notInArray } from "drizzle-orm";
import {
  payrollEmployees, payrollCompensation, payrollPaySchedules, payrollDeductions,
  payrollRuns, payrollRunItems, payrollGlAccounts, payrollGlMappings,
  payrollAuditLog, payrollTaxJurisdictions, payrollPtoBalances, payrollAchOriginator,
  payrollReimbursementLines,
  users, tenantUsers, timeEntries, expenses,
  type PayrollEmployee, type InsertPayrollEmployee,
  type PayrollCompensation, type InsertPayrollCompensation,
  type PayrollPaySchedule, type InsertPayrollPaySchedule,
  type PayrollDeduction, type InsertPayrollDeduction,
  type PayrollRun, type InsertPayrollRun,
  type PayrollRunItem, type InsertPayrollRunItem,
  type PayrollGlAccount, type InsertPayrollGlAccount,
  type PayrollGlMapping, type InsertPayrollGlMapping,
  type PayrollTaxJurisdiction, type InsertPayrollTaxJurisdiction,
  type PayrollAuditLog, type InsertPayrollAuditLog,
  type PayrollPtoBalance,
  type PayrollAchOriginator, type InsertPayrollAchOriginator,
  type PayrollReimbursementLine,
} from "@shared/schema";
import { computePayroll, type PayrollEngineInputs } from "../services/payroll-engine";

export const payrollStorage = {
  // ---- Audit ----
  async appendAudit(entry: InsertPayrollAuditLog): Promise<PayrollAuditLog> {
    const [row] = await db.insert(payrollAuditLog).values(entry).returning();
    return row;
  },

  async listAudit(tenantId: string, limit = 200): Promise<PayrollAuditLog[]> {
    return db.select().from(payrollAuditLog)
      .where(eq(payrollAuditLog.tenantId, tenantId))
      .orderBy(desc(payrollAuditLog.occurredAt))
      .limit(limit);
  },

  // ---- Employees ----
  async listEmployees(tenantId: string, includeTerminated = false): Promise<PayrollEmployee[]> {
    const conds = [eq(payrollEmployees.tenantId, tenantId), isNull(payrollEmployees.deletedAt)];
    if (!includeTerminated) {
      conds.push(sql`${payrollEmployees.status} != 'terminated'`);
    }
    return db.select().from(payrollEmployees).where(and(...conds)).orderBy(payrollEmployees.lastName);
  },

  async getEmployee(tenantId: string, id: string): Promise<PayrollEmployee | undefined> {
    const [row] = await db.select().from(payrollEmployees)
      .where(and(eq(payrollEmployees.tenantId, tenantId), eq(payrollEmployees.id, id)));
    return row;
  },

  async createEmployee(data: InsertPayrollEmployee): Promise<PayrollEmployee> {
    const [row] = await db.insert(payrollEmployees).values(data).returning();
    return row;
  },

  async updateEmployee(tenantId: string, id: string, data: Partial<InsertPayrollEmployee>): Promise<PayrollEmployee> {
    const [row] = await db.update(payrollEmployees)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(payrollEmployees.tenantId, tenantId), eq(payrollEmployees.id, id)))
      .returning();
    return row;
  },

  async softDeleteEmployee(tenantId: string, id: string): Promise<void> {
    const [row] = await db.update(payrollEmployees)
      .set({ deletedAt: new Date(), status: 'terminated' })
      .where(and(eq(payrollEmployees.tenantId, tenantId), eq(payrollEmployees.id, id)))
      .returning({ userId: payrollEmployees.userId });
    // users.payrollEmployeeType is GLOBAL but payroll_employees rows are
    // tenant-scoped. Only clear the global flag when the user has no
    // remaining active (non-soft-deleted, non-terminated) payroll record in
    // ANY tenant — otherwise terminating a user in tenant A would silently
    // un-enroll them in tenant B as well.
    if (row?.userId) {
      const remaining = await db.select({ id: payrollEmployees.id })
        .from(payrollEmployees)
        .where(and(
          eq(payrollEmployees.userId, row.userId),
          isNull(payrollEmployees.deletedAt),
          sql`${payrollEmployees.status} != 'terminated'`,
        ))
        .limit(1);
      if (remaining.length === 0) {
        await db.update(users).set({ payrollEmployeeType: null as any }).where(eq(users.id, row.userId));
      }
    }
  },

  /** Locate the active (non-soft-deleted) payroll record for a given user. */
  async findEmployeeByUserId(tenantId: string, userId: string): Promise<PayrollEmployee | undefined> {
    const [row] = await db.select().from(payrollEmployees)
      .where(and(
        eq(payrollEmployees.tenantId, tenantId),
        eq(payrollEmployees.userId, userId),
        isNull(payrollEmployees.deletedAt),
      ));
    return row;
  },

  /** Attach linked user info (id, name, email) to a list of employees. */
  async enrichWithUsers<T extends { userId: string | null }>(rows: T[]): Promise<Array<T & { linkedUser: { id: string; name: string; email: string | null } | null }>> {
    const ids = rows.map(r => r.userId).filter((x): x is string => !!x);
    if (ids.length === 0) return rows.map(r => ({ ...r, linkedUser: null }));
    const linked = await db.select({ id: users.id, name: users.name, email: users.email })
      .from(users).where(inArray(users.id, ids));
    const byId = new Map(linked.map(u => [u.id, u]));
    return rows.map(r => ({ ...r, linkedUser: r.userId ? (byId.get(r.userId) ?? null) : null }));
  },

  /**
   * Users in this tenant who are eligible to be enrolled in payroll:
   * active, have an email, are members of the tenant, and don't already have
   * an active payroll_employees row in this tenant.
   */
  async listEligibleUsers(tenantId: string): Promise<Array<{ id: string; name: string; email: string }>> {
    const alreadyLinked = await db.select({ userId: payrollEmployees.userId })
      .from(payrollEmployees)
      .where(and(
        eq(payrollEmployees.tenantId, tenantId),
        isNotNull(payrollEmployees.userId),
        isNull(payrollEmployees.deletedAt),
      ));
    const linkedIds = alreadyLinked.map(l => l.userId!).filter(Boolean);
    const conds = [
      eq(tenantUsers.tenantId, tenantId),
      eq(tenantUsers.status, 'active'),
      eq(users.isActive, true),
      isNotNull(users.email),
    ];
    if (linkedIds.length > 0) conds.push(notInArray(users.id, linkedIds));
    const rows = await db.select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .innerJoin(tenantUsers, eq(tenantUsers.userId, users.id))
      .where(and(...conds))
      .orderBy(users.name);
    return rows
      .filter(r => !!r.email)
      .map(r => ({ id: r.id, name: r.name, email: r.email as string }));
  },

  /**
   * Keep users.payroll_employee_type aligned when changes originate on the
   * payroll side, but only when it's safe to do so. The flag is global; the
   * payroll record is tenant-scoped. We only touch the global flag when the
   * user has no OTHER active payroll record in any other tenant — otherwise
   * setting it from tenant A would change tenant B's enrollment view too.
   *
   * Pass `currentTenantId` to exclude the tenant whose payroll record just
   * changed (so we don't mistake "the record we just modified" for "another
   * tenant's").
   */
  async syncUserEnrollmentFlag(
    userId: string,
    employeeType: string | null,
    currentTenantId?: string,
  ): Promise<void> {
    const otherActive = await db.select({ id: payrollEmployees.id })
      .from(payrollEmployees)
      .where(and(
        eq(payrollEmployees.userId, userId),
        isNull(payrollEmployees.deletedAt),
        sql`${payrollEmployees.status} != 'terminated'`,
        currentTenantId ? sql`${payrollEmployees.tenantId} != ${currentTenantId}` : sql`true`,
      ))
      .limit(1);
    if (otherActive.length > 0) {
      // Another tenant has an active payroll record for this user; touching
      // the global flag would clobber that tenant's enrollment state.
      return;
    }
    await db.update(users)
      .set({ payrollEmployeeType: employeeType as any })
      .where(eq(users.id, userId));
  },

  /**
   * Find Constellation expenses eligible to be bundled into a payroll run
   * for the given user.
   *
   * Criteria:
   *   1. expenses.reimbursable = true
   *   2. expenses.approvalStatus = 'approved'
   *   3. expenses.payrollRunItemId IS NULL (not already on a run)
   *   4. expenses.reimbursementBatchId IS NULL (not paid via legacy batch)
   *   5. expenses.date <= periodEnd
   *   6. currency = 'USD' (phase 1 limitation; multi-currency follows)
   *
   * Excludes are checked against (expenseId) — passing a set lets the admin
   * say "skip this one on this run" via the route layer.
   */
  async listReimbursableExpensesForUser(
    tenantId: string,
    userId: string,
    periodEnd: string,
    excludeExpenseIds: Set<string> = new Set(),
  ): Promise<Array<{ id: string; amountCents: number; category: string; description: string | null; date: string }>> {
    const rows = await db.select({
      id: expenses.id,
      amount: expenses.amount,
      category: expenses.category,
      description: expenses.description,
      date: expenses.date,
      currency: expenses.currency,
    })
      .from(expenses)
      .where(and(
        eq(expenses.tenantId, tenantId),
        eq(expenses.personId, userId),
        eq(expenses.reimbursable, true),
        eq(expenses.approvalStatus, 'approved'),
        isNull(expenses.payrollRunItemId),
        isNull(expenses.reimbursementBatchId),
        lte(expenses.date, periodEnd),
      ));
    return rows
      .filter(r => r.currency === 'USD' && !excludeExpenseIds.has(r.id))
      .map(r => ({
        id: r.id,
        amountCents: Math.round(Number(r.amount) * 100),
        category: r.category,
        description: r.description,
        date: r.date,
      }));
  },

  /**
   * Sum YTD taxable wages from FINALIZED payroll runs in the same calendar
   * year as `payDate`, EXCLUDING any run with payDate >= the run we're
   * previewing (so re-previewing an earlier period doesn't double-count later
   * finalized runs).
   *
   * For our simplified engine, SS / Medicare / FUTA wage bases are all equal
   * to "gross − pre-tax deductions" — Section 125 differences are not modeled.
   * Returns 0/0/0 when the employee has no prior finalized runs in the year.
   */
  async getYtdAccumulators(
    tenantId: string,
    employeeId: string,
    payDate: string,
  ): Promise<{ ytdSsWagesCents: number; ytdMedicareWagesCents: number; ytdFutaWagesCents: number }> {
    const year = payDate.slice(0, 4);
    const yearStart = `${year}-01-01`;
    const rows = await db.select({
      gross: payrollRunItems.grossCents,
      preTax: payrollRunItems.preTaxDeductionCents,
      ficaTaxable: payrollRunItems.ficaTaxableWagesCents,
    })
      .from(payrollRunItems)
      .innerJoin(payrollRuns, eq(payrollRunItems.runId, payrollRuns.id))
      .where(and(
        eq(payrollRunItems.tenantId, tenantId),
        eq(payrollRunItems.employeeId, employeeId),
        eq(payrollRuns.status, 'finalized'),
        gte(payrollRuns.payDate, yearStart),
        lte(payrollRuns.payDate, payDate),
      ));
    // Use the persisted FICA-taxable wages so 401(k) traditional deferrals
    // still hit the SS / FUTA / Additional Medicare wage bases. Legacy rows
    // pre-dating the column have 0 stored — fall back to gross - all pre-tax
    // (the prior behaviour) so a partial roll-out doesn't blow up totals.
    let total = 0;
    for (const r of rows) {
      const fica = (r.ficaTaxable ?? 0) > 0
        ? (r.ficaTaxable ?? 0)
        : Math.max(0, (r.gross ?? 0) - (r.preTax ?? 0));
      total += fica;
    }
    return { ytdSsWagesCents: total, ytdMedicareWagesCents: total, ytdFutaWagesCents: total };
  },

  /**
   * Sum approved/submitted time-tracking hours for a user within a pay period
   * and split into regular vs overtime by ISO-week (FLSA: hours > 40 in a week
   * are overtime). Returns 0/0 if the user has no time entries in the window.
   *
   * Only counts entries with submissionStatus in ('submitted','approved') so
   * draft/rejected entries don't accidentally enter payroll. Entries already
   * locked into an invoice batch are still counted — locking is a billing
   * concept, not a payroll one.
   */
  async sumApprovedHoursForUser(
    tenantId: string,
    userId: string,
    periodStart: string,
    periodEnd: string,
  ): Promise<{ regularHours: number; overtimeHours: number }> {
    const rows = await db.select({
      date: timeEntries.date,
      hours: timeEntries.hours,
    })
      .from(timeEntries)
      .where(and(
        eq(timeEntries.tenantId, tenantId),
        eq(timeEntries.personId, userId),
        gte(timeEntries.date, periodStart),
        lte(timeEntries.date, periodEnd),
        inArray(timeEntries.submissionStatus, ['submitted', 'approved']),
      ));
    if (rows.length === 0) return { regularHours: 0, overtimeHours: 0 };

    // Bucket by ISO week (Mon-Sun) to apply > 40h overtime within the period.
    const weekTotals = new Map<string, number>();
    for (const r of rows) {
      const d = new Date(r.date + 'T00:00:00Z');
      const day = d.getUTCDay() || 7; // 1=Mon..7=Sun
      const monday = new Date(d);
      monday.setUTCDate(d.getUTCDate() - (day - 1));
      const key = monday.toISOString().slice(0, 10);
      weekTotals.set(key, (weekTotals.get(key) ?? 0) + Number(r.hours));
    }
    let regular = 0, overtime = 0;
    for (const total of Array.from(weekTotals.values())) {
      if (total > 40) { regular += 40; overtime += total - 40; }
      else { regular += total; }
    }
    return { regularHours: Number(regular.toFixed(2)), overtimeHours: Number(overtime.toFixed(2)) };
  },

  // ---- Compensation ----
  async listCompensation(tenantId: string, employeeId: string): Promise<PayrollCompensation[]> {
    return db.select().from(payrollCompensation)
      .where(and(
        eq(payrollCompensation.tenantId, tenantId),
        eq(payrollCompensation.employeeId, employeeId),
      ))
      .orderBy(desc(payrollCompensation.effectiveFrom));
  },

  async createCompensation(data: InsertPayrollCompensation): Promise<PayrollCompensation> {
    const [row] = await db.insert(payrollCompensation).values(data).returning();
    return row;
  },

  /** Get the comp record effective as of a given date (or latest before). */
  async getEffectiveComp(tenantId: string, employeeId: string, asOf: string): Promise<PayrollCompensation | null> {
    const [row] = await db.select().from(payrollCompensation)
      .where(and(
        eq(payrollCompensation.tenantId, tenantId),
        eq(payrollCompensation.employeeId, employeeId),
        lte(payrollCompensation.effectiveFrom, asOf),
      ))
      .orderBy(desc(payrollCompensation.effectiveFrom))
      .limit(1);
    return row || null;
  },

  // ---- Pay Schedules ----
  async listSchedules(tenantId: string): Promise<PayrollPaySchedule[]> {
    return db.select().from(payrollPaySchedules)
      .where(eq(payrollPaySchedules.tenantId, tenantId))
      .orderBy(payrollPaySchedules.name);
  },

  async getSchedule(tenantId: string, id: string): Promise<PayrollPaySchedule | undefined> {
    const [row] = await db.select().from(payrollPaySchedules)
      .where(and(eq(payrollPaySchedules.tenantId, tenantId), eq(payrollPaySchedules.id, id)));
    return row;
  },

  async createSchedule(data: InsertPayrollPaySchedule): Promise<PayrollPaySchedule> {
    const [row] = await db.insert(payrollPaySchedules).values(data).returning();
    return row;
  },

  async updateSchedule(tenantId: string, id: string, data: Partial<InsertPayrollPaySchedule>): Promise<PayrollPaySchedule> {
    const [row] = await db.update(payrollPaySchedules).set(data)
      .where(and(eq(payrollPaySchedules.tenantId, tenantId), eq(payrollPaySchedules.id, id)))
      .returning();
    return row;
  },

  // ---- Deductions ----
  async listDeductions(tenantId: string, employeeId?: string): Promise<PayrollDeduction[]> {
    const conds = [eq(payrollDeductions.tenantId, tenantId)];
    if (employeeId) conds.push(eq(payrollDeductions.employeeId, employeeId));
    return db.select().from(payrollDeductions).where(and(...conds));
  },

  async createDeduction(data: InsertPayrollDeduction): Promise<PayrollDeduction> {
    const [row] = await db.insert(payrollDeductions).values(data).returning();
    return row;
  },

  async deleteDeduction(tenantId: string, id: string): Promise<void> {
    await db.delete(payrollDeductions)
      .where(and(eq(payrollDeductions.tenantId, tenantId), eq(payrollDeductions.id, id)));
  },

  // ---- Tax Jurisdictions ----
  async listJurisdictions(tenantId: string | null): Promise<PayrollTaxJurisdiction[]> {
    // Returns platform jurisdictions (tenant_id IS NULL) + tenant-specific overrides.
    return db.select().from(payrollTaxJurisdictions)
      .where(tenantId
        ? sql`(${payrollTaxJurisdictions.tenantId} = ${tenantId} OR ${payrollTaxJurisdictions.tenantId} IS NULL)`
        : isNull(payrollTaxJurisdictions.tenantId))
      .orderBy(payrollTaxJurisdictions.code);
  },

  async createJurisdiction(data: InsertPayrollTaxJurisdiction): Promise<PayrollTaxJurisdiction> {
    const [row] = await db.insert(payrollTaxJurisdictions).values(data).returning();
    return row;
  },

  /**
   * Tenant override for a single tax code. When a row already exists for
   * (tenantId, code) we update its rule/name/level in place; otherwise we
   * insert a fresh tenant-scoped row. The platform default (tenant_id IS
   * NULL) stays untouched so a tenant can roll back to default by deleting
   * their override. Required for SUTA experience-rate overrides per state.
   */
  async upsertTenantJurisdiction(data: InsertPayrollTaxJurisdiction): Promise<PayrollTaxJurisdiction> {
    if (!data.tenantId) {
      throw new Error('upsertTenantJurisdiction requires a tenantId — platform rows are seed-only.');
    }
    const [existing] = await db.select().from(payrollTaxJurisdictions)
      .where(and(
        eq(payrollTaxJurisdictions.tenantId, data.tenantId),
        eq(payrollTaxJurisdictions.code, data.code),
      ));
    if (existing) {
      const [updated] = await db.update(payrollTaxJurisdictions)
        .set({
          name: data.name,
          level: data.level,
          rule: data.rule,
          // Preserve the existing isActive flag when the caller didn't
          // explicitly send one; createInsertSchema defaults make
          // `undefined` indistinguishable from "not specified", so
          // falling back to `true` would silently re-activate a row
          // an admin had just deactivated.
          isActive: data.isActive ?? existing.isActive,
        })
        .where(eq(payrollTaxJurisdictions.id, existing.id))
        .returning();
      return updated;
    }
    const [row] = await db.insert(payrollTaxJurisdictions).values(data).returning();
    return row;
  },

  /**
   * Delete a tenant-scoped jurisdiction override. Refuses to touch
   * platform rows (tenant_id IS NULL) so a misclick can't blow up the
   * seeded defaults.
   */
  async deleteTenantJurisdiction(tenantId: string, id: string): Promise<void> {
    const [row] = await db.select().from(payrollTaxJurisdictions)
      .where(eq(payrollTaxJurisdictions.id, id));
    if (!row) throw new Error('Jurisdiction not found');
    if (row.tenantId === null) {
      throw new Error('Cannot delete a platform-default jurisdiction (tenant_id IS NULL). Insert a tenant override to change it.');
    }
    if (row.tenantId !== tenantId) throw new Error('Not your tenant');
    await db.delete(payrollTaxJurisdictions)
      .where(eq(payrollTaxJurisdictions.id, id));
  },

  // ---- Payroll Runs ----
  async listRuns(tenantId: string): Promise<PayrollRun[]> {
    return db.select().from(payrollRuns)
      .where(eq(payrollRuns.tenantId, tenantId))
      .orderBy(desc(payrollRuns.payDate));
  },

  async getRun(tenantId: string, id: string): Promise<PayrollRun | undefined> {
    const [row] = await db.select().from(payrollRuns)
      .where(and(eq(payrollRuns.tenantId, tenantId), eq(payrollRuns.id, id)));
    return row;
  },

  async listRunItems(tenantId: string, runId: string): Promise<PayrollRunItem[]> {
    return db.select().from(payrollRunItems)
      .where(and(eq(payrollRunItems.tenantId, tenantId), eq(payrollRunItems.runId, runId)));
  },

  /**
   * Return the per-expense reimbursement lines for a run, joined with the
   * employee and run-item id. Drives the run-detail "Reimbursements
   * bundled into this run" section.
   */
  async listReimbursementsForRun(tenantId: string, runId: string) {
    return db.select({
      id: payrollReimbursementLines.id,
      runItemId: payrollReimbursementLines.runItemId,
      employeeId: payrollRunItems.employeeId,
      expenseId: payrollReimbursementLines.expenseId,
      amountCents: payrollReimbursementLines.amountCents,
      category: payrollReimbursementLines.category,
      description: payrollReimbursementLines.description,
      employeeName: sql<string>`${payrollEmployees.firstName} || ' ' || ${payrollEmployees.lastName}`,
    })
      .from(payrollReimbursementLines)
      .innerJoin(payrollRunItems, eq(payrollReimbursementLines.runItemId, payrollRunItems.id))
      .innerJoin(payrollEmployees, eq(payrollRunItems.employeeId, payrollEmployees.id))
      .where(and(
        eq(payrollReimbursementLines.tenantId, tenantId),
        eq(payrollRunItems.runId, runId),
      ));
  },

  /**
   * Per-employee reimbursement detail for a single finalized run item.
   * Used by the self-service paystub view to itemize the non-taxable
   * portion of net pay.
   */
  async listReimbursementsForRunItem(tenantId: string, runItemId: string): Promise<PayrollReimbursementLine[]> {
    return db.select().from(payrollReimbursementLines)
      .where(and(
        eq(payrollReimbursementLines.tenantId, tenantId),
        eq(payrollReimbursementLines.runItemId, runItemId),
      ));
  },

  async createRun(data: InsertPayrollRun): Promise<PayrollRun> {
    if (data.idempotencyKey) {
      const [existing] = await db.select().from(payrollRuns)
        .where(and(eq(payrollRuns.tenantId, data.tenantId), eq(payrollRuns.idempotencyKey, data.idempotencyKey)));
      if (existing) return existing;
    }
    // Cast around drizzle-zod's tuple-inference on jsonb columns
    // (targetEmployeeIds). The runtime shape is correct; the type system
    // collapses jsonb arrays into a tuple union that breaks .values().
    const [row] = await db.insert(payrollRuns).values(data as any).returning();
    return row;
  },

  /**
   * Build (or rebuild) all run items for a draft/previewed run by computing
   * payroll for every active employee on the run's pay schedule.
   * Replaces existing items for the run. Caller is responsible for tenant check.
   */
  async previewRun(tenantId: string, runId: string, perEmployeeInputs?: Map<string, Partial<PayrollEngineInputs>>): Promise<{ run: PayrollRun; items: PayrollRunItem[] }> {
    const run = await this.getRun(tenantId, runId);
    if (!run) throw new Error('Run not found');
    // Only draft and previewed runs may be (re)previewed.
    if (run.status !== 'draft' && run.status !== 'previewed') {
      throw new Error(`Cannot preview a ${run.status} run`);
    }
    // Reversal runs have their items pre-built (negated) and must not be
    // recomputed against the engine — that would re-derive positive amounts
    // and defeat the reversal. Approve/finalize them as-is.
    if (run.runType === 'reversal') {
      throw new Error('Reversal runs are pre-built and cannot be previewed; approve and finalize as-is');
    }
    if (!run.payScheduleId) throw new Error('Run has no pay schedule');
    const schedule = await this.getSchedule(tenantId, run.payScheduleId);
    if (!schedule) throw new Error('Schedule not found');

    const employees = await this.listEmployees(tenantId, false);
    // Bonus / off-cycle runs persist a subset of payroll_employees.id in
    // targetEmployeeIds. When set, restrict the run to that subset and
    // SKIP the pay-schedule filter (a bonus run frequently pays people on
    // different schedules, e.g. the FTE profit-sharing pool). Regular
    // runs fall back to every active employee on the run's pay schedule.
    const targets = (run.targetEmployeeIds ?? null) as string[] | null;
    // Defensive fail-closed: a bonus run that somehow reached preview
    // without targets (legacy row, manual DB edit) would otherwise pay
    // the entire schedule. The schema's superRefine prevents this at
    // create time, but the engine guards the invariant too.
    if (run.runType === 'bonus' && (!targets || targets.length === 0)) {
      throw new Error('Bonus run has no targetEmployeeIds; refusing to pay all employees.');
    }
    const elig = (targets && targets.length > 0)
      ? employees.filter(e => targets.includes(e.id) && e.status !== 'terminated')
      : employees.filter(e =>
          e.defaultPayScheduleId === run.payScheduleId &&
          e.status !== 'terminated'
        );

    const jurisdictions = await this.listJurisdictions(tenantId);

    await db.delete(payrollRunItems).where(and(
      eq(payrollRunItems.tenantId, tenantId),
      eq(payrollRunItems.runId, runId),
    ));

    const items: PayrollRunItem[] = [];
    let totalGross = 0, totalEeTax = 0, totalErTax = 0, totalDed = 0, totalNet = 0;
    for (const emp of elig) {
      const overrides = perEmployeeInputs?.get(emp.id) || {};
      const comp = await this.getEffectiveComp(tenantId, emp.id, run.payDate);
      const deductions = await this.listDeductions(tenantId, emp.id);

      // Expense reimbursement feed: pick up approved Constellation
      // reimbursable expenses for this employee, sum them, and pass the
      // total into the engine. The engine adds them to net pay AFTER
      // tax math (accountable plan; never wages). We do this BEFORE
      // calling computePayroll so the line shows in the breakdown.
      let reimbursementCents = 0;
      let reimbursementExpenses: Array<{ id: string; amountCents: number; category: string; description: string | null }> = [];
      if (emp.userId && emp.employeeType === 'w2') {
        const candidates = await this.listReimbursableExpensesForUser(
          tenantId, emp.userId, run.periodEnd,
        );
        reimbursementExpenses = candidates;
        reimbursementCents = candidates.reduce((s, c) => s + c.amountCents, 0);
      }

      // Time-tracking feed: when the payroll employee is linked to an internal
      // user, sum their approved/submitted time entries across the pay period
      // as the default hours, split into regular vs overtime by week.
      let tsRegular = 0, tsOvertime = 0, sourcedFromTimesheets = false;
      if (emp.userId && overrides.hoursWorked === undefined && overrides.overtimeHours === undefined) {
        const sums = await this.sumApprovedHoursForUser(
          tenantId, emp.userId, run.periodStart, run.periodEnd,
        );
        tsRegular = sums.regularHours;
        tsOvertime = sums.overtimeHours;
        sourcedFromTimesheets = tsRegular > 0 || tsOvertime > 0;
      }

      const fallbackHoursPerWeek = comp?.compType === 'hourly' ? Number(comp.hoursPerWeek || 40) : 0;
      const fallbackPeriodMultiplier = schedule.frequency === 'weekly' ? 1 : schedule.frequency === 'biweekly' ? 2 : schedule.frequency === 'semimonthly' ? 2.16 : 4.33;
      const finalHoursWorked = overrides.hoursWorked
        ?? (sourcedFromTimesheets ? tsRegular : fallbackHoursPerWeek * fallbackPeriodMultiplier);
      const finalOvertimeHours = overrides.overtimeHours
        ?? (sourcedFromTimesheets ? tsOvertime : 0);

      const ytd = await this.getYtdAccumulators(tenantId, emp.id, run.payDate);
      const result = computePayroll({
        employee: emp,
        compensation: comp,
        schedule,
        deductions,
        jurisdictions,
        hoursWorked: finalHoursWorked,
        overtimeHours: finalOvertimeHours,
        ptoHoursUsed: overrides.ptoHoursUsed ?? 0,
        bonusCents: overrides.bonusCents ?? 0,
        commissionCents: overrides.commissionCents ?? 0,
        retroPayCents: overrides.retroPayCents ?? 0,
        ytdSsWagesCents: ytd.ytdSsWagesCents,
        ytdMedicareWagesCents: ytd.ytdMedicareWagesCents,
        ytdFutaWagesCents: ytd.ytdFutaWagesCents,
        reimbursementCents,
      });
      const [item] = await db.insert(payrollRunItems).values({
        tenantId, runId,
        employeeId: emp.id,
        hoursWorked: String(finalHoursWorked),
        overtimeHours: String(finalOvertimeHours),
        ptoHoursUsed: String(overrides.ptoHoursUsed ?? 0),
        reimbursementCents,
        bonusCents: overrides.bonusCents ?? 0,
        commissionCents: overrides.commissionCents ?? 0,
        retroPayCents: overrides.retroPayCents ?? 0,
        grossCents: result.grossCents,
        employeeTaxCents: result.employeeTaxCents,
        employerTaxCents: result.employerTaxCents,
        preTaxDeductionCents: result.preTaxDeductionCents,
        postTaxDeductionCents: result.postTaxDeductionCents,
        ficaTaxableWagesCents: result.ficaTaxableWagesCents,
        netPayCents: result.netPayCents,
        breakdown: { lines: result.lines, taxableWagesCents: result.taxableWagesCents, ficaTaxableWagesCents: result.ficaTaxableWagesCents },
      }).returning();
      items.push(item);

      // Record each bundled expense as a reimbursement line so the paystub
      // can itemize and finalize can stamp the expenses. We don't mark
      // them paid until finalize — preview can be replayed any number of
      // times without locking the expenses.
      if (reimbursementExpenses.length > 0) {
        await db.insert(payrollReimbursementLines).values(reimbursementExpenses.map(e => ({
          tenantId,
          runItemId: item.id,
          expenseId: e.id,
          amountCents: e.amountCents,
          category: e.category,
          description: e.description,
        })));
      }

      totalGross += result.grossCents;
      totalEeTax += result.employeeTaxCents;
      totalErTax += result.employerTaxCents;
      totalDed += result.preTaxDeductionCents + result.postTaxDeductionCents;
      totalNet += result.netPayCents;
    }

    const [updated] = await db.update(payrollRuns).set({
      status: 'previewed',
      totalGrossCents: totalGross,
      totalEmployeeTaxCents: totalEeTax,
      totalEmployerTaxCents: totalErTax,
      totalDeductionsCents: totalDed,
      totalNetCents: totalNet,
    }).where(and(eq(payrollRuns.tenantId, tenantId), eq(payrollRuns.id, runId))).returning();

    return { run: updated, items };
  },

  async approveRun(tenantId: string, runId: string, approvedBy: string): Promise<PayrollRun> {
    const run = await this.getRun(tenantId, runId);
    if (!run) throw new Error('Run not found');
    if (run.status !== 'previewed') throw new Error(`Cannot approve a ${run.status} run; preview first`);
    const [row] = await db.update(payrollRuns)
      .set({ status: 'approved', approvedBy, approvedAt: new Date() })
      .where(and(eq(payrollRuns.tenantId, tenantId), eq(payrollRuns.id, runId)))
      .returning();
    return row;
  },

  async finalizeRun(tenantId: string, runId: string): Promise<PayrollRun> {
    const run = await this.getRun(tenantId, runId);
    if (!run) throw new Error('Run not found');
    if (run.status !== 'approved') throw new Error(`Cannot finalize a ${run.status} run; approve first`);
    const [row] = await db.update(payrollRuns)
      .set({ status: 'finalized', finalizedAt: new Date() })
      .where(and(eq(payrollRuns.tenantId, tenantId), eq(payrollRuns.id, runId)))
      .returning();
    // Tie PTO accrual to finalize so previews / approvals can be replayed
    // without affecting balances. Errors here surface to the caller; the
    // alternative (silent failure) would let balances drift.
    await this.accruePtoForRun(tenantId, runId);
    // Stamp any bundled reimbursable expenses with the run item id and a
    // timestamp so they leave the candidate pool and the legacy
    // reimbursement-batch UI knows they're already paid.
    await this.stampReimbursedExpensesForRun(tenantId, runId);
    return row;
  },

  /**
   * After a regular run finalizes, mark every expense bundled into the run
   * as paid via payroll. Conversely, after a reversal run finalizes, clear
   * the stamps so the expenses re-enter the candidate pool.
   */
  async stampReimbursedExpensesForRun(tenantId: string, runId: string): Promise<void> {
    const run = await this.getRun(tenantId, runId);
    if (!run) return;
    const lines = await db.select().from(payrollReimbursementLines)
      .innerJoin(payrollRunItems, eq(payrollReimbursementLines.runItemId, payrollRunItems.id))
      .where(and(
        eq(payrollReimbursementLines.tenantId, tenantId),
        eq(payrollRunItems.runId, runId),
      ));
    if (lines.length === 0) return;
    const expenseIds = lines.map(l => l.payroll_reimbursement_lines.expenseId);
    if (run.runType === 'reversal') {
      await db.update(expenses)
        .set({ payrollRunItemId: null, payrollReimbursedAt: null })
        .where(and(
          eq(expenses.tenantId, tenantId),
          inArray(expenses.id, expenseIds),
        ));
    } else {
      // Map expense id -> the new run item id it sits on, so a single round
      // trip handles many employees.
      const byExpense = new Map(lines.map(l => [
        l.payroll_reimbursement_lines.expenseId,
        l.payroll_reimbursement_lines.runItemId,
      ]));
      for (const [expenseId, runItemId] of Array.from(byExpense.entries())) {
        await db.update(expenses)
          .set({ payrollRunItemId: runItemId, payrollReimbursedAt: new Date() })
          .where(and(
            eq(expenses.tenantId, tenantId),
            eq(expenses.id, expenseId),
          ));
      }
    }
  },

  /**
   * Create a reversal run for a finalized run. Copies each item with the
   * monetary fields negated so YTD accumulators net out, then leaves the
   * reversal in 'draft' state for the admin to preview/approve/finalize
   * just like any other run. The original finalized run is NOT modified —
   * a reversal is additional history, never a delete.
   */
  async createReversalRun(tenantId: string, originalRunId: string, actorUserId: string): Promise<PayrollRun> {
    const original = await this.getRun(tenantId, originalRunId);
    if (!original) throw new Error('Run not found');
    if (original.status !== 'finalized') {
      throw new Error('Only finalized runs can be reversed; void earlier runs instead');
    }
    if (original.runType === 'reversal') {
      throw new Error('A reversal cannot itself be reversed; create a regular correction run');
    }
    const [run] = await db.insert(payrollRuns).values({
      tenantId,
      payScheduleId: original.payScheduleId,
      periodStart: original.periodStart,
      periodEnd: original.periodEnd,
      payDate: new Date().toISOString().slice(0, 10),
      runType: 'reversal',
      reversesRunId: original.id,
      status: 'draft',
      createdBy: actorUserId,
      notes: `Reversal of run ${original.id}`,
      totalGrossCents: -original.totalGrossCents,
      totalEmployeeTaxCents: -original.totalEmployeeTaxCents,
      totalEmployerTaxCents: -original.totalEmployerTaxCents,
      totalDeductionsCents: -original.totalDeductionsCents,
      totalNetCents: -original.totalNetCents,
    } as any).returning();

    const items = await this.listRunItems(tenantId, original.id);
    if (items.length > 0) {
      const insertedItems = await db.insert(payrollRunItems).values(items.map(it => ({
        tenantId,
        runId: run.id,
        employeeId: it.employeeId,
        hoursWorked: String(-Number(it.hoursWorked ?? 0)),
        overtimeHours: String(-Number(it.overtimeHours ?? 0)),
        ptoHoursUsed: String(-Number(it.ptoHoursUsed ?? 0)),
        bonusCents: -it.bonusCents,
        commissionCents: -it.commissionCents,
        retroPayCents: -it.retroPayCents,
        grossCents: -it.grossCents,
        employeeTaxCents: -it.employeeTaxCents,
        employerTaxCents: -it.employerTaxCents,
        preTaxDeductionCents: -it.preTaxDeductionCents,
        postTaxDeductionCents: -it.postTaxDeductionCents,
        ficaTaxableWagesCents: -((it as any).ficaTaxableWagesCents ?? 0),
        reimbursementCents: -((it as any).reimbursementCents ?? 0),
        netPayCents: -it.netPayCents,
        breakdown: { reversalOf: original.id, original: it.breakdown },
      }))).returning();

      // Mirror reimbursement lines onto the reversal items so finalize can
      // release the underlying expenses back into the candidate pool.
      const itemByEmp = new Map(insertedItems.map(i => [i.employeeId, i.id]));
      const origLines = await db.select({
        runItemId: payrollReimbursementLines.runItemId,
        expenseId: payrollReimbursementLines.expenseId,
        amountCents: payrollReimbursementLines.amountCents,
        category: payrollReimbursementLines.category,
        description: payrollReimbursementLines.description,
        employeeId: payrollRunItems.employeeId,
      })
        .from(payrollReimbursementLines)
        .innerJoin(payrollRunItems, eq(payrollReimbursementLines.runItemId, payrollRunItems.id))
        .where(and(
          eq(payrollReimbursementLines.tenantId, tenantId),
          eq(payrollRunItems.runId, original.id),
        ));
      if (origLines.length > 0) {
        await db.insert(payrollReimbursementLines).values(
          origLines.map(l => ({
            tenantId,
            runItemId: itemByEmp.get(l.employeeId)!,
            expenseId: l.expenseId,
            amountCents: -l.amountCents,
            category: l.category,
            description: `Reversal: ${l.description ?? ''}`.trim(),
          })),
        );
      }
    }
    return run;
  },

  async voidRun(tenantId: string, runId: string): Promise<PayrollRun> {
    const run = await this.getRun(tenantId, runId);
    if (!run) throw new Error('Run not found');
    // Finalized runs are immutable for audit/tax-filing integrity. Void is
    // only allowed pre-finalization. To "void" a finalized run, issue a
    // negative reversal run (TODO: implement reversal helper).
    if (run.status === 'finalized') throw new Error('Cannot void a finalized run; issue a reversal run instead');
    if (run.status === 'voided') throw new Error('Run is already voided');
    const [row] = await db.update(payrollRuns).set({ status: 'voided' })
      .where(and(eq(payrollRuns.tenantId, tenantId), eq(payrollRuns.id, runId)))
      .returning();
    return row;
  },

  /** Verify a referenced child entity belongs to the same tenant. Throws if not. */
  async assertTenantOwns(tenantId: string, kind: 'employee' | 'schedule' | 'gl_account', id: string): Promise<void> {
    let exists: any[] = [];
    if (kind === 'employee') {
      exists = await db.select({ id: payrollEmployees.id }).from(payrollEmployees)
        .where(and(eq(payrollEmployees.tenantId, tenantId), eq(payrollEmployees.id, id))).limit(1);
    } else if (kind === 'schedule') {
      exists = await db.select({ id: payrollPaySchedules.id }).from(payrollPaySchedules)
        .where(and(eq(payrollPaySchedules.tenantId, tenantId), eq(payrollPaySchedules.id, id))).limit(1);
    } else if (kind === 'gl_account') {
      exists = await db.select({ id: payrollGlAccounts.id }).from(payrollGlAccounts)
        .where(and(eq(payrollGlAccounts.tenantId, tenantId), eq(payrollGlAccounts.id, id))).limit(1);
    }
    if (!exists.length) throw new Error(`Forbidden: ${kind} does not belong to tenant`);
  },

  // ---- GL Accounts & Mappings ----
  async listGlAccounts(tenantId: string): Promise<PayrollGlAccount[]> {
    return db.select().from(payrollGlAccounts)
      .where(eq(payrollGlAccounts.tenantId, tenantId))
      .orderBy(payrollGlAccounts.accountNumber);
  },

  async createGlAccount(data: InsertPayrollGlAccount): Promise<PayrollGlAccount> {
    const [row] = await db.insert(payrollGlAccounts).values(data).returning();
    return row;
  },

  async listGlMappings(tenantId: string): Promise<PayrollGlMapping[]> {
    return db.select().from(payrollGlMappings)
      .where(eq(payrollGlMappings.tenantId, tenantId));
  },

  async upsertGlMapping(tenantId: string, category: string, glAccountId: string): Promise<PayrollGlMapping> {
    const existing = await db.select().from(payrollGlMappings)
      .where(and(eq(payrollGlMappings.tenantId, tenantId), eq(payrollGlMappings.category, category)));
    if (existing.length) {
      const [row] = await db.update(payrollGlMappings).set({ glAccountId })
        .where(eq(payrollGlMappings.id, existing[0].id)).returning();
      return row;
    }
    const [row] = await db.insert(payrollGlMappings).values({ tenantId, category, glAccountId }).returning();
    return row;
  },

  /**
   * Aggregate a payroll run into GL journal entries by category.
   * Returns rows of { account, debit, credit } suitable for CSV/JSON export.
   */
  async buildGlExport(tenantId: string, runId: string): Promise<Array<{ accountNumber: string; accountName: string; debitCents: number; creditCents: number; memo: string }>> {
    const run = await this.getRun(tenantId, runId);
    if (!run) throw new Error('Run not found');
    const items = await this.listRunItems(tenantId, runId);
    const accounts = await this.listGlAccounts(tenantId);
    const mappings = await this.listGlMappings(tenantId);
    const accountById = new Map(accounts.map(a => [a.id, a]));
    const mapByCategory = new Map(mappings.map(m => [m.category, m]));

    function acct(category: string) {
      const m = mapByCategory.get(category);
      if (!m) return null;
      return accountById.get(m.glAccountId) || null;
    }

    // Walk each item's breakdown to split garnishments out from generic
    // post-tax deductions; the engine emits them with category='garnishment'.
    let wages = 0, employerTax = 0, employeeTax = 0, preTax = 0;
    let postTax = 0, garnishment = 0, reimbursement = 0, net = 0;
    for (const it of items) {
      wages += it.grossCents;
      employerTax += it.employerTaxCents;
      employeeTax += it.employeeTaxCents;
      preTax += it.preTaxDeductionCents;
      reimbursement += (it as any).reimbursementCents ?? 0;
      net += it.netPayCents;
      const lines = ((it.breakdown as any)?.lines ?? []) as Array<{ category: string; amountCents: number }>;
      let itemGarnishment = 0;
      for (const l of lines) {
        if (l.category === 'garnishment') itemGarnishment += Math.abs(l.amountCents);
      }
      garnishment += itemGarnishment;
      // post-tax stored on the item bundles garnishments; subtract them so
      // post_tax_deduction GL only captures non-garnishment post-tax (Roth
      // 401(k), union dues, etc.).
      postTax += (it.postTaxDeductionCents - itemGarnishment);
    }

    const memo = `Payroll run ${run.id} pay date ${run.payDate}`;
    const out: Array<{ accountNumber: string; accountName: string; debitCents: number; creditCents: number; memo: string }> = [];
    const push = (cat: string, debit: number, credit: number) => {
      const a = acct(cat);
      if (a && (debit || credit)) out.push({ accountNumber: a.accountNumber, accountName: a.accountName, debitCents: debit, creditCents: credit, memo });
    };
    push('wages', wages, 0);
    push('employer_tax', employerTax, 0);
    push('employee_tax_liability', 0, employeeTax);
    push('pre_tax_deduction', 0, preTax);
    push('post_tax_deduction', 0, postTax);
    push('garnishment_liability', 0, garnishment);
    // Reimbursements debited reduce the AP liability Constellation already
    // booked at expense approval time. If the tenant hasn't mapped
    // reimbursement_clearing they get one bigger net_pay_clearing credit
    // (functionally correct, harder to reconcile).
    push('reimbursement_clearing', reimbursement, 0);
    push('net_pay_clearing', 0, net);
    push('employer_tax_liability', 0, employerTax);
    return out;
  },

  /**
   * Daily tax-deposit liabilities for Schedule B: one entry per pay date
   * in the window, summing federal income tax withheld + 6.2% × SS wages
   * (employee + employer) + 1.45% × Medicare wages (employee + employer).
   */
  async scheduleBLiabilities(tenantId: string, startDate: string, endDate: string) {
    const rows = await db.select({
      payDate: payrollRuns.payDate,
      grossCents: payrollRunItems.grossCents,
      preTaxDeductionCents: payrollRunItems.preTaxDeductionCents,
      employeeTaxCents: payrollRunItems.employeeTaxCents,
      employerTaxCents: payrollRunItems.employerTaxCents,
      breakdown: payrollRunItems.breakdown,
    })
      .from(payrollRunItems)
      .innerJoin(payrollRuns, eq(payrollRunItems.runId, payrollRuns.id))
      .where(and(
        eq(payrollRunItems.tenantId, tenantId),
        eq(payrollRuns.status, 'finalized'),
        gte(payrollRuns.payDate, startDate),
        lte(payrollRuns.payDate, endDate),
      ));
    const byDate = new Map<string, number>();
    for (const r of rows) {
      const lines = ((r.breakdown as any)?.lines ?? []) as Array<{ label: string; amountCents: number }>;
      const fed = lines.filter(l => l.label === 'Federal income tax').reduce((s, l) => s + Math.abs(l.amountCents), 0);
      // FICA total = employee + employer halves.
      const ssEe = lines.find(l => l.label === 'Social Security');
      const ssEr = lines.find(l => l.label === 'Employer SS');
      const mcEe = lines.find(l => l.label === 'Medicare');
      const mcEr = lines.find(l => l.label === 'Employer Medicare');
      const fica = [ssEe, ssEr, mcEe, mcEr].reduce((s, l) => s + Math.abs(l?.amountCents ?? 0), 0);
      byDate.set(r.payDate, (byDate.get(r.payDate) ?? 0) + fed + fica);
    }
    return Array.from(byDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, liabilityCents]) => ({ date, liabilityCents }));
  },

  // ---- Tax-filing totals (quarterly 941 / annual W-2 + 1099) ----
  /**
   * Aggregate finalized-run totals for a date window. Drives 941 quarterly
   * filings (federal income tax withheld + FICA wages and tax) and the
   * annual W-2/1099 summary. Not a tax-form generator — accountants take
   * these totals into their filing software.
   */
  async taxTotals(tenantId: string, startDate: string, endDate: string) {
    const rows = await db.select({
      employeeId: payrollRunItems.employeeId,
      employeeType: payrollEmployees.employeeType,
      firstName: payrollEmployees.firstName,
      lastName: payrollEmployees.lastName,
      email: payrollEmployees.email,
      grossCents: payrollRunItems.grossCents,
      preTaxDeductionCents: payrollRunItems.preTaxDeductionCents,
      ficaTaxableWagesCents: payrollRunItems.ficaTaxableWagesCents,
      employeeTaxCents: payrollRunItems.employeeTaxCents,
      employerTaxCents: payrollRunItems.employerTaxCents,
      netPayCents: payrollRunItems.netPayCents,
      breakdown: payrollRunItems.breakdown,
      payDate: payrollRuns.payDate,
    })
      .from(payrollRunItems)
      .innerJoin(payrollRuns, eq(payrollRunItems.runId, payrollRuns.id))
      .innerJoin(payrollEmployees, eq(payrollRunItems.employeeId, payrollEmployees.id))
      .where(and(
        eq(payrollRunItems.tenantId, tenantId),
        eq(payrollRuns.status, 'finalized'),
        gte(payrollRuns.payDate, startDate),
        lte(payrollRuns.payDate, endDate),
      ));

    const byEmployee = new Map<string, any>();
    let fedIncomeWithheld = 0, ssWagesTotal = 0, medicareWagesTotal = 0;
    let employerSsTotal = 0, employerMedicareTotal = 0;

    for (const r of rows) {
      const lines = (r.breakdown as any)?.lines ?? [];
      const fed = lines.filter((l: any) => l.label === 'Federal income tax').reduce((s: number, l: any) => s + Math.abs(l.amountCents), 0);
      // Box 1 (federal taxable) wages: gross minus ALL pre-tax (Section 125
      // and 401(k) traditional both reduce Box 1).
      const federalTaxableWages = r.grossCents - r.preTaxDeductionCents;
      // Box 3 / Box 5 (FICA / Medicare) wages: gross minus Section 125 only;
      // 401(k) traditional is FICA-taxable. Fall back to the legacy
      // derivation when the column hasn't been populated yet on older rows.
      const ficaTaxableWages = (r.ficaTaxableWagesCents ?? 0) > 0
        ? (r.ficaTaxableWagesCents ?? 0)
        : federalTaxableWages;
      const ssLine = lines.find((l: any) => l.label === 'Social Security');
      // Employee-side SS / Medicare / Additional-Medicare withholdings,
      // pulled from the run breakdown so the EFW2 / W-2 Box 4 + 6 reflect
      // what was actually withheld (not a recomputation from wages, which
      // ignores SS cap behavior, rounding, and the 0.9% threshold).
      const employeeSs = Math.abs(ssLine?.amountCents ?? 0);
      const employeeMc = lines
        .filter((l: any) => l.label === 'Medicare')
        .reduce((s: number, l: any) => s + Math.abs(l.amountCents), 0);
      const employeeAddlMc = lines
        .filter((l: any) => l.label === 'Additional Medicare')
        .reduce((s: number, l: any) => s + Math.abs(l.amountCents), 0);
      const employerSs = lines.filter((l: any) => l.label === 'Employer SS').reduce((s: number, l: any) => s + l.amountCents, 0);
      const employerMc = lines.filter((l: any) => l.label === 'Employer Medicare').reduce((s: number, l: any) => s + l.amountCents, 0);

      // Aggregate totals (drive 941 + W-2/W-3) MUST exclude 1099 contractors.
      // 1099 pay is not subject to federal income tax withholding or FICA, so
      // including it would overstate Form 941 line 2 and W-3 Box 5 Medicare
      // wages. 1099 totals are still surfaced per-recipient via form1099Recipients
      // for 1099-NEC filing.
      const isW2 = r.employeeType === 'w2';
      if (isW2) {
        fedIncomeWithheld += fed;
        // Prefer the persisted FICA wage base over back-calculation from
        // ssLine, which can be capped mid-year and misrepresent the wage.
        ssWagesTotal += ficaTaxableWages;
        medicareWagesTotal += ficaTaxableWages;
        employerSsTotal += employerSs;
        employerMedicareTotal += employerMc;
      }

      const e = byEmployee.get(r.employeeId) ?? {
        employeeId: r.employeeId, name: `${r.firstName} ${r.lastName}`, email: r.email,
        employeeType: r.employeeType,
        grossCents: 0, taxableWagesCents: 0, fedIncomeTaxCents: 0,
        ssWagesCents: 0, ssTaxCents: 0,
        medicareWagesCents: 0, medicareTaxCents: 0, additionalMedicareTaxCents: 0,
        netPayCents: 0,
        // Box 10 (dependent-care FSA) — its own W-2 box, NOT a Box 12 code.
        // Sourced from deductions whose benefitCategory='fsa_dependent_care'
        // (engine stamps benefitCategory on each line alongside box12Code).
        dependentCareCents: 0,
        // Box 12 totals keyed by IRS code letter (W = HSA, D = 401(k), AA =
        // Roth 401(k), DD = aggregate employer health cost, etc.). Only
        // populated for w2 employees. Populated from `box12Code` stamped
        // on each deduction line by the payroll engine (server/services/payroll-engine.ts).
        box12: {} as Record<string, number>,
      };
      e.grossCents += r.grossCents;
      // Per-employee W-2 fields stay zero for 1099 rows so the W-2 CSV
      // export doesn't surface withholding/FICA columns for contractors.
      if (isW2) {
        e.taxableWagesCents += federalTaxableWages;
        e.fedIncomeTaxCents += fed;
        e.ssWagesCents += ficaTaxableWages;
        e.ssTaxCents += employeeSs;
        e.medicareWagesCents += ficaTaxableWages;
        e.medicareTaxCents += employeeMc;
        e.additionalMedicareTaxCents += employeeAddlMc;
        for (const l of lines) {
          const code = (l as any).box12Code;
          const cat = (l as any).benefitCategory;
          if (cat === 'fsa_dependent_care') {
            e.dependentCareCents += Math.abs(l.amountCents);
          }
          if (!code) continue;
          e.box12[code] = (e.box12[code] ?? 0) + Math.abs(l.amountCents);
        }
      }
      e.netPayCents += r.netPayCents;
      byEmployee.set(r.employeeId, e);
    }

    const employees = Array.from(byEmployee.values());
    return {
      window: { startDate, endDate },
      totals: {
        fedIncomeTaxWithheldCents: fedIncomeWithheld,
        ssWagesCents: ssWagesTotal,
        medicareWagesCents: medicareWagesTotal,
        employerSsCents: employerSsTotal,
        employerMedicareCents: employerMedicareTotal,
      },
      w2Employees: employees.filter(e => e.employeeType === 'w2'),
      form1099Recipients: employees.filter(e => e.employeeType === '1099'),
    };
  },

  // ---- PTO accrual on finalize ----
  /**
   * Accrue per-period PTO and decrement balances by hours used in the run.
   * Called from finalizeRun so accrual is tied to the audit-immutable point
   * (preview/approve can be re-run without affecting balances).
   */
  async accruePtoForRun(tenantId: string, runId: string): Promise<void> {
    const items = await this.listRunItems(tenantId, runId);
    for (const it of items) {
      const pto = await db.select().from(payrollPtoBalances)
        .where(and(eq(payrollPtoBalances.tenantId, tenantId), eq(payrollPtoBalances.employeeId, it.employeeId)));
      for (const p of pto) {
        const accrual = Number(p.accrualHoursPerPeriod);
        const used = Number(it.ptoHoursUsed ?? 0);
        const newBalance = Math.max(0, Number(p.balanceHours) + accrual - used);
        const newYtdUsed = Number(p.usedHoursYtd) + used;
        await db.update(payrollPtoBalances).set({
          balanceHours: String(newBalance),
          usedHoursYtd: String(newYtdUsed),
          updatedAt: new Date(),
        }).where(eq(payrollPtoBalances.id, p.id));
      }
    }
  },

  // ---- Self-service: an employee's own finalized paystubs ----
  /**
   * Return finalized run items for an employee, joined with run metadata,
   * newest first. Used by /api/me/payroll/paystubs.
   */
  async listPaystubsForEmployee(tenantId: string, employeeId: string) {
    return db.select({
      runId: payrollRuns.id,
      periodStart: payrollRuns.periodStart,
      periodEnd: payrollRuns.periodEnd,
      payDate: payrollRuns.payDate,
      status: payrollRuns.status,
      grossCents: payrollRunItems.grossCents,
      netPayCents: payrollRunItems.netPayCents,
      employeeTaxCents: payrollRunItems.employeeTaxCents,
      preTaxDeductionCents: payrollRunItems.preTaxDeductionCents,
      postTaxDeductionCents: payrollRunItems.postTaxDeductionCents,
      hoursWorked: payrollRunItems.hoursWorked,
      overtimeHours: payrollRunItems.overtimeHours,
    })
      .from(payrollRunItems)
      .innerJoin(payrollRuns, eq(payrollRunItems.runId, payrollRuns.id))
      .where(and(
        eq(payrollRunItems.tenantId, tenantId),
        eq(payrollRunItems.employeeId, employeeId),
        eq(payrollRuns.status, 'finalized'),
      ))
      .orderBy(desc(payrollRuns.payDate));
  },

  /**
   * Full paystub detail (line items / breakdown) for a single finalized run.
   * Returns null when the run isn't finalized or doesn't belong to the
   * employee — we never expose draft/previewed payroll to employees.
   */
  async getPaystubForEmployee(tenantId: string, employeeId: string, runId: string) {
    const [row] = await db.select({
      run: payrollRuns,
      item: payrollRunItems,
    })
      .from(payrollRunItems)
      .innerJoin(payrollRuns, eq(payrollRunItems.runId, payrollRuns.id))
      .where(and(
        eq(payrollRunItems.tenantId, tenantId),
        eq(payrollRunItems.employeeId, employeeId),
        eq(payrollRunItems.runId, runId),
        eq(payrollRuns.status, 'finalized'),
      ));
    if (!row) return null;
    return { run: row.run, item: row.item };
  },

  // ---- ACH originator (one row per tenant) ----
  async getAchOriginator(tenantId: string): Promise<PayrollAchOriginator | undefined> {
    const [row] = await db.select().from(payrollAchOriginator)
      .where(eq(payrollAchOriginator.tenantId, tenantId));
    return row;
  },

  async upsertAchOriginator(data: InsertPayrollAchOriginator): Promise<PayrollAchOriginator> {
    const existing = await this.getAchOriginator(data.tenantId);
    if (existing) {
      const [row] = await db.update(payrollAchOriginator)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(payrollAchOriginator.tenantId, data.tenantId))
        .returning();
      return row;
    }
    const [row] = await db.insert(payrollAchOriginator).values(data).returning();
    return row;
  },

  // ---- PTO ----
  async listPto(tenantId: string, employeeId: string): Promise<PayrollPtoBalance[]> {
    return db.select().from(payrollPtoBalances)
      .where(and(eq(payrollPtoBalances.tenantId, tenantId), eq(payrollPtoBalances.employeeId, employeeId)));
  },

  // ---- Dashboard summary ----
  async dashboardSummary(tenantId: string) {
    const [empCount] = await db.select({ count: sql<number>`count(*)::int` })
      .from(payrollEmployees)
      .where(and(eq(payrollEmployees.tenantId, tenantId), isNull(payrollEmployees.deletedAt), sql`${payrollEmployees.status} != 'terminated'`));
    const [last] = await db.select().from(payrollRuns)
      .where(eq(payrollRuns.tenantId, tenantId))
      .orderBy(desc(payrollRuns.payDate)).limit(1);
    const [ytdAgg] = await db.select({
      gross: sql<number>`COALESCE(SUM(${payrollRuns.totalGrossCents}),0)::bigint`,
      net: sql<number>`COALESCE(SUM(${payrollRuns.totalNetCents}),0)::bigint`,
      employerTax: sql<number>`COALESCE(SUM(${payrollRuns.totalEmployerTaxCents}),0)::bigint`,
    }).from(payrollRuns)
      .where(and(
        eq(payrollRuns.tenantId, tenantId),
        eq(payrollRuns.status, 'finalized'),
        gte(payrollRuns.payDate, `${new Date().getUTCFullYear()}-01-01`),
      ));
    return {
      activeEmployees: empCount?.count ?? 0,
      lastRun: last || null,
      ytdGrossCents: Number(ytdAgg?.gross ?? 0),
      ytdNetCents: Number(ytdAgg?.net ?? 0),
      ytdEmployerTaxCents: Number(ytdAgg?.employerTax ?? 0),
    };
  },
};

export type PayrollStorage = typeof payrollStorage;
