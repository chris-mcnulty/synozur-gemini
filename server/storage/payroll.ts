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
  users, tenantUsers, timeEntries,
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
    if (row?.userId) {
      await db.update(users).set({ payrollEmployeeType: null as any }).where(eq(users.id, row.userId));
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

  /** Keep users.payroll_employee_type aligned when changes originate on the payroll side. */
  async syncUserEnrollmentFlag(userId: string, employeeType: string | null): Promise<void> {
    await db.update(users)
      .set({ payrollEmployeeType: employeeType as any })
      .where(eq(users.id, userId));
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
    let total = 0;
    for (const r of rows) total += (r.gross ?? 0) - (r.preTax ?? 0);
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

  async createRun(data: InsertPayrollRun): Promise<PayrollRun> {
    if (data.idempotencyKey) {
      const [existing] = await db.select().from(payrollRuns)
        .where(and(eq(payrollRuns.tenantId, data.tenantId), eq(payrollRuns.idempotencyKey, data.idempotencyKey)));
      if (existing) return existing;
    }
    const [row] = await db.insert(payrollRuns).values(data).returning();
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
    // Only draft and previewed runs may be (re)previewed. Once approved, the
    // calculation must not change without explicit revert (TODO: add revert).
    if (run.status !== 'draft' && run.status !== 'previewed') {
      throw new Error(`Cannot preview a ${run.status} run`);
    }
    if (!run.payScheduleId) throw new Error('Run has no pay schedule');
    const schedule = await this.getSchedule(tenantId, run.payScheduleId);
    if (!schedule) throw new Error('Schedule not found');

    const employees = await this.listEmployees(tenantId, false);
    const elig = employees.filter(e =>
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
      });
      const [item] = await db.insert(payrollRunItems).values({
        tenantId, runId,
        employeeId: emp.id,
        hoursWorked: String(finalHoursWorked),
        overtimeHours: String(finalOvertimeHours),
        ptoHoursUsed: String(overrides.ptoHoursUsed ?? 0),
        bonusCents: overrides.bonusCents ?? 0,
        commissionCents: overrides.commissionCents ?? 0,
        retroPayCents: overrides.retroPayCents ?? 0,
        grossCents: result.grossCents,
        employeeTaxCents: result.employeeTaxCents,
        employerTaxCents: result.employerTaxCents,
        preTaxDeductionCents: result.preTaxDeductionCents,
        postTaxDeductionCents: result.postTaxDeductionCents,
        netPayCents: result.netPayCents,
        breakdown: { lines: result.lines, taxableWagesCents: result.taxableWagesCents },
      }).returning();
      items.push(item);
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
    return row;
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

    let wages = 0, employerTax = 0, employeeTax = 0, preTax = 0, postTax = 0, net = 0;
    for (const it of items) {
      wages += it.grossCents;
      employerTax += it.employerTaxCents;
      employeeTax += it.employeeTaxCents;
      preTax += it.preTaxDeductionCents;
      postTax += it.postTaxDeductionCents;
      net += it.netPayCents;
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
    // Garnishments roll into post-tax bucket in engine but expose a dedicated
    // mapping slot so customers can route them to a separate liability acct.
    push('garnishment_liability', 0, 0); // placeholder; see TODO to split bucket
    push('net_pay_clearing', 0, net);
    // Employer tax liability mirrors employer tax expense.
    push('employer_tax_liability', 0, employerTax);
    return out;
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
      const taxableWages = r.grossCents - r.preTaxDeductionCents;
      const ssLine = lines.find((l: any) => l.label === 'Social Security');
      const medicareLine = lines.find((l: any) => l.label === 'Medicare');
      const employerSs = lines.filter((l: any) => l.label === 'Employer SS').reduce((s: number, l: any) => s + l.amountCents, 0);
      const employerMc = lines.filter((l: any) => l.label === 'Employer Medicare').reduce((s: number, l: any) => s + l.amountCents, 0);

      fedIncomeWithheld += fed;
      ssWagesTotal += ssLine ? Math.round(Math.abs(ssLine.amountCents) / 0.062) : 0;
      medicareWagesTotal += taxableWages;
      employerSsTotal += employerSs;
      employerMedicareTotal += employerMc;

      const e = byEmployee.get(r.employeeId) ?? {
        employeeId: r.employeeId, name: `${r.firstName} ${r.lastName}`, email: r.email,
        employeeType: r.employeeType,
        grossCents: 0, taxableWagesCents: 0, fedIncomeTaxCents: 0,
        ssWagesCents: 0, medicareWagesCents: 0, netPayCents: 0,
      };
      e.grossCents += r.grossCents;
      e.taxableWagesCents += taxableWages;
      e.fedIncomeTaxCents += fed;
      e.ssWagesCents += ssLine ? Math.round(Math.abs(ssLine.amountCents) / 0.062) : 0;
      e.medicareWagesCents += taxableWages;
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
