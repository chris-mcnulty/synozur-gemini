/**
 * Gemini Payroll API routes.
 *
 * Tenant boundary is derived server-side from the session
 * (req.user.activeTenantId || primaryTenantId || tenantId). The client may
 * never specify tenantId in the body or query for access-control purposes.
 *
 * Roles:
 *   - 'admin' or 'billing-admin' = Payroll Manager (write/run payroll)
 *   - all authenticated users can read their own employee record (TODO).
 */

import type { Express, Request, Response } from "express";
import { z } from "zod";
import { payrollStorage } from "../storage/payroll";
import {
  insertPayrollEmployeeSchema, insertPayrollCompensationSchema,
  insertPayrollPayScheduleSchema, insertPayrollDeductionSchema,
  insertPayrollRunSchema, insertPayrollTaxJurisdictionSchema,
  insertPayrollGlAccountSchema, insertPayrollAchOriginatorSchema,
} from "@shared/schema";
import { buildNachaFile, type NachaEntry } from "../services/nacha";
import { encryptString, decryptString, maskLast4 } from "../services/crypto";
import { render941Html, renderW2Csv, renderW3Csv, render1099NecCsv } from "../services/tax-forms";
import {
  buildEfw2File, buildFire1099NecFile,
  type Efw2Employee, type FirePayee,
} from "../services/tax-forms-efile";

interface PayrollRouteDeps {
  requireAuth: any;
  requireRole: (roles: string[]) => any;
}

function tenantOf(req: Request): string {
  const u: any = req.user;
  const tid = u?.activeTenantId || u?.primaryTenantId || u?.tenantId;
  if (!tid) throw new Error('No active tenant on session');
  return tid;
}

const PAYROLL_MANAGER = ['admin', 'billing-admin'];

export function registerPayrollRoutes(app: Express, deps: PayrollRouteDeps) {
  const { requireAuth, requireRole } = deps;
  const PM = requireRole(PAYROLL_MANAGER);

  // ---- Dashboard ----
  // Note: every payroll read endpoint is gated to PAYROLL_MANAGER because the
  // payload contains employee PII and compensation. Self-service "view my own
  // paystub" endpoints will live under /api/me/payroll/* in a later phase.
  app.get('/api/payroll/summary', requireAuth, PM, async (req, res) => {
    try {
      const summary = await payrollStorage.dashboardSummary(tenantOf(req));
      res.json(summary);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // ---- Employees ----
  app.get('/api/payroll/employees', requireAuth, PM, async (req, res) => {
    try {
      const includeTerminated = req.query.includeTerminated === 'true';
      const list = await payrollStorage.listEmployees(tenantOf(req), includeTerminated);
      const enriched = await payrollStorage.enrichWithUsers(list);
      res.json(enriched);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // Candidate internal users (active, with email) that aren't yet linked to a
  // payroll employee — used to populate the "Add person" picker.
  app.get('/api/payroll/eligible-users', requireAuth, PM, async (req, res) => {
    try {
      res.json(await payrollStorage.listEligibleUsers(tenantOf(req)));
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.get('/api/payroll/employees/:id', requireAuth, PM, async (req, res) => {
    try {
      const tenantId = tenantOf(req);
      const emp = await payrollStorage.getEmployee(tenantId, req.params.id);
      if (!emp) return res.status(404).json({ message: 'Not found' });
      const [enriched] = await payrollStorage.enrichWithUsers([emp]);
      const compensation = await payrollStorage.listCompensation(tenantId, emp.id);
      const deductions = await payrollStorage.listDeductions(tenantId, emp.id);
      const pto = await payrollStorage.listPto(tenantId, emp.id);
      // Never echo the ciphertext or plain account number to the client;
      // send a masked display string and a boolean indicating whether one
      // is on file so the form knows whether to render "Replace" vs "Set".
      const safeEmployee = {
        ...enriched,
        bankAccountNumberEnc: undefined,
        bankAccountMasked: maskLast4(enriched.bankAccountNumberEnc),
        hasBankAccount: !!enriched.bankAccountNumberEnc,
      };
      res.json({ employee: safeEmployee, compensation, deductions, pto });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.post('/api/payroll/employees', requireAuth, PM, async (req, res) => {
    try {
      const tenantId = tenantOf(req);
      const body = insertPayrollEmployeeSchema.parse({ ...req.body, tenantId });
      // If linked to an internal user, prevent duplicate active payroll rows
      // for the same person.
      if (body.userId) {
        const existing = await payrollStorage.findEmployeeByUserId(tenantId, body.userId);
        if (existing) {
          return res.status(409).json({
            message: 'This user is already enrolled in payroll',
            payrollEmployeeId: existing.id,
          });
        }
      }
      // Encrypt bank account number at the API boundary so plain text never
      // touches storage. The column is named *Enc so the field stays valid
      // when encryption is enabled.
      if (body.bankAccountNumberEnc) {
        body.bankAccountNumberEnc = encryptString(body.bankAccountNumberEnc) as any;
      }
      const emp = await payrollStorage.createEmployee(body);
      // Keep the global users.payroll_employee_type flag aligned, but only
      // when this is the user's sole active payroll record across tenants
      // (the helper itself enforces that gate). Passing currentTenantId
      // excludes the row we just created from the "is another tenant
      // already enrolled?" check.
      if (emp.userId) {
        await payrollStorage.syncUserEnrollmentFlag(emp.userId, emp.employeeType, tenantId);
      }
      await payrollStorage.appendAudit({
        tenantId, actorUserId: (req.user as any)?.id,
        action: 'employee.create', entityType: 'employee', entityId: emp.id,
        details: { email: emp.email, userId: emp.userId }, ipAddress: req.ip,
      });
      res.json(emp);
    } catch (e: any) { res.status(400).json({ message: e.message }); }
  });

  app.patch('/api/payroll/employees/:id', requireAuth, PM, async (req, res) => {
    try {
      const tenantId = tenantOf(req);
      const body = insertPayrollEmployeeSchema.partial().parse({ ...req.body, tenantId });
      const { tenantId: _t, ...updates } = body;
      if ('bankAccountNumberEnc' in updates && updates.bankAccountNumberEnc) {
        updates.bankAccountNumberEnc = encryptString(updates.bankAccountNumberEnc) as any;
      }
      const emp = await payrollStorage.updateEmployee(tenantId, req.params.id, updates);
      await payrollStorage.appendAudit({
        tenantId, actorUserId: (req.user as any)?.id,
        action: 'employee.update', entityType: 'employee', entityId: emp.id,
        details: { updates }, ipAddress: req.ip,
      });
      res.json(emp);
    } catch (e: any) { res.status(400).json({ message: e.message }); }
  });

  app.delete('/api/payroll/employees/:id', requireAuth, PM, async (req, res) => {
    try {
      const tenantId = tenantOf(req);
      await payrollStorage.softDeleteEmployee(tenantId, req.params.id);
      await payrollStorage.appendAudit({
        tenantId, actorUserId: (req.user as any)?.id,
        action: 'employee.terminate', entityType: 'employee', entityId: req.params.id,
        ipAddress: req.ip,
      });
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // ---- Compensation ----
  app.post('/api/payroll/employees/:id/compensation', requireAuth, PM, async (req, res) => {
    try {
      const tenantId = tenantOf(req);
      // Tenant-ownership check: prevent attaching compensation to another tenant's employee.
      await payrollStorage.assertTenantOwns(tenantId, 'employee', req.params.id);
      const body = insertPayrollCompensationSchema.parse({ ...req.body, tenantId, employeeId: req.params.id });
      const row = await payrollStorage.createCompensation(body);
      await payrollStorage.appendAudit({
        tenantId, actorUserId: (req.user as any)?.id,
        action: 'compensation.create', entityType: 'employee', entityId: req.params.id,
        details: { compType: row.compType, amountCents: row.amountCents },
        ipAddress: req.ip,
      });
      res.json(row);
    } catch (e: any) { res.status(400).json({ message: e.message }); }
  });

  // ---- Deductions ----
  app.post('/api/payroll/employees/:id/deductions', requireAuth, PM, async (req, res) => {
    try {
      const tenantId = tenantOf(req);
      await payrollStorage.assertTenantOwns(tenantId, 'employee', req.params.id);
      const body = insertPayrollDeductionSchema.parse({ ...req.body, tenantId, employeeId: req.params.id });
      const row = await payrollStorage.createDeduction(body);
      await payrollStorage.appendAudit({
        tenantId, actorUserId: (req.user as any)?.id,
        action: 'deduction.create', entityType: 'employee', entityId: req.params.id,
        details: { name: row.name, type: row.deductionType }, ipAddress: req.ip,
      });
      res.json(row);
    } catch (e: any) { res.status(400).json({ message: e.message }); }
  });

  app.delete('/api/payroll/deductions/:id', requireAuth, PM, async (req, res) => {
    try {
      const tenantId = tenantOf(req);
      await payrollStorage.deleteDeduction(tenantId, req.params.id);
      await payrollStorage.appendAudit({
        tenantId, actorUserId: (req.user as any)?.id,
        action: 'deduction.delete', entityType: 'deduction', entityId: req.params.id,
        ipAddress: req.ip,
      });
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // ---- Pay Schedules ----
  app.get('/api/payroll/schedules', requireAuth, PM, async (req, res) => {
    try { res.json(await payrollStorage.listSchedules(tenantOf(req))); }
    catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.post('/api/payroll/schedules', requireAuth, PM, async (req, res) => {
    try {
      const tenantId = tenantOf(req);
      const body = insertPayrollPayScheduleSchema.parse({ ...req.body, tenantId });
      const row = await payrollStorage.createSchedule(body);
      await payrollStorage.appendAudit({
        tenantId, actorUserId: (req.user as any)?.id,
        action: 'schedule.create', entityType: 'schedule', entityId: row.id,
        details: { name: row.name, frequency: row.frequency }, ipAddress: req.ip,
      });
      res.json(row);
    } catch (e: any) { res.status(400).json({ message: e.message }); }
  });

  app.patch('/api/payroll/schedules/:id', requireAuth, PM, async (req, res) => {
    try {
      const tenantId = tenantOf(req);
      const body = insertPayrollPayScheduleSchema.partial().parse({ ...req.body, tenantId });
      const { tenantId: _t, ...updates } = body;
      res.json(await payrollStorage.updateSchedule(tenantId, req.params.id, updates));
    } catch (e: any) { res.status(400).json({ message: e.message }); }
  });

  // ---- Tax Jurisdictions ----
  app.get('/api/payroll/jurisdictions', requireAuth, PM, async (req, res) => {
    try { res.json(await payrollStorage.listJurisdictions(tenantOf(req))); }
    catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.post('/api/payroll/jurisdictions', requireAuth, PM, async (req, res) => {
    try {
      const tenantId = tenantOf(req);
      const body = insertPayrollTaxJurisdictionSchema.parse({ ...req.body, tenantId });
      res.json(await payrollStorage.createJurisdiction(body));
    } catch (e: any) { res.status(400).json({ message: e.message }); }
  });

  // ---- Payroll Runs ----
  app.get('/api/payroll/runs', requireAuth, PM, async (req, res) => {
    try { res.json(await payrollStorage.listRuns(tenantOf(req))); }
    catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.get('/api/payroll/runs/:id', requireAuth, PM, async (req, res) => {
    try {
      const tenantId = tenantOf(req);
      const run = await payrollStorage.getRun(tenantId, req.params.id);
      if (!run) return res.status(404).json({ message: 'Not found' });
      const items = await payrollStorage.listRunItems(tenantId, run.id);
      const reimbursements = await payrollStorage.listReimbursementsForRun(tenantId, run.id);
      res.json({ run, items, reimbursements });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.post('/api/payroll/runs', requireAuth, PM, async (req, res) => {
    try {
      const tenantId = tenantOf(req);
      const body = insertPayrollRunSchema.parse({ ...req.body, tenantId, createdBy: (req.user as any)?.id });
      // Tenant-ownership check: payScheduleId must belong to this tenant.
      if (body.payScheduleId) await payrollStorage.assertTenantOwns(tenantId, 'schedule', body.payScheduleId);
      const run = await payrollStorage.createRun(body);
      await payrollStorage.appendAudit({
        tenantId, actorUserId: (req.user as any)?.id,
        action: 'run.create', entityType: 'run', entityId: run.id,
        details: { periodStart: run.periodStart, periodEnd: run.periodEnd, payDate: run.payDate },
        ipAddress: req.ip,
      });
      res.json(run);
    } catch (e: any) { res.status(400).json({ message: e.message }); }
  });

  const previewBodySchema = z.object({
    overrides: z.record(z.string(), z.object({
      hoursWorked: z.number().optional(),
      overtimeHours: z.number().optional(),
      ptoHoursUsed: z.number().optional(),
      bonusCents: z.number().int().optional(),
      commissionCents: z.number().int().optional(),
      retroPayCents: z.number().int().optional(),
    })).optional(),
  });

  app.post('/api/payroll/runs/:id/preview', requireAuth, PM, async (req, res) => {
    try {
      const tenantId = tenantOf(req);
      const body = previewBodySchema.parse(req.body || {});
      const overrides = body.overrides ? new Map(Object.entries(body.overrides)) : undefined;
      const result = await payrollStorage.previewRun(tenantId, req.params.id, overrides as any);
      await payrollStorage.appendAudit({
        tenantId, actorUserId: (req.user as any)?.id,
        action: 'run.preview', entityType: 'run', entityId: req.params.id,
        details: { totalNetCents: result.run.totalNetCents, items: result.items.length },
        ipAddress: req.ip,
      });
      res.json(result);
    } catch (e: any) { res.status(400).json({ message: e.message }); }
  });

  app.post('/api/payroll/runs/:id/approve', requireAuth, PM, async (req, res) => {
    try {
      const tenantId = tenantOf(req);
      const userId = (req.user as any)?.id;
      const run = await payrollStorage.approveRun(tenantId, req.params.id, userId);
      await payrollStorage.appendAudit({
        tenantId, actorUserId: userId, action: 'run.approve',
        entityType: 'run', entityId: run.id, ipAddress: req.ip,
      });
      res.json(run);
    } catch (e: any) { res.status(400).json({ message: e.message }); }
  });

  app.post('/api/payroll/runs/:id/finalize', requireAuth, PM, async (req, res) => {
    try {
      const tenantId = tenantOf(req);
      const run = await payrollStorage.finalizeRun(tenantId, req.params.id);
      await payrollStorage.appendAudit({
        tenantId, actorUserId: (req.user as any)?.id, action: 'run.finalize',
        entityType: 'run', entityId: run.id, ipAddress: req.ip,
      });
      res.json(run);
    } catch (e: any) { res.status(400).json({ message: e.message }); }
  });

  // Create a reversal run that unwinds a finalized run. Result is a fresh
  // 'draft' run with negative items; admin still has to approve and finalize.
  app.post('/api/payroll/runs/:id/reverse', requireAuth, PM, async (req, res) => {
    try {
      const tenantId = tenantOf(req);
      const userId = (req.user as any)?.id;
      const reversal = await payrollStorage.createReversalRun(tenantId, req.params.id, userId);
      await payrollStorage.appendAudit({
        tenantId, actorUserId: userId, action: 'run.reverse',
        entityType: 'run', entityId: reversal.id,
        details: { reversesRunId: req.params.id }, ipAddress: req.ip,
      });
      res.json(reversal);
    } catch (e: any) { res.status(400).json({ message: e.message }); }
  });

  app.post('/api/payroll/runs/:id/void', requireAuth, PM, async (req, res) => {
    try {
      const tenantId = tenantOf(req);
      const run = await payrollStorage.voidRun(tenantId, req.params.id);
      await payrollStorage.appendAudit({
        tenantId, actorUserId: (req.user as any)?.id, action: 'run.void',
        entityType: 'run', entityId: run.id, ipAddress: req.ip,
      });
      res.json(run);
    } catch (e: any) { res.status(400).json({ message: e.message }); }
  });

  // ---- GL Accounts & Mappings ----
  app.get('/api/payroll/gl-accounts', requireAuth, PM, async (req, res) => {
    try { res.json(await payrollStorage.listGlAccounts(tenantOf(req))); }
    catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.post('/api/payroll/gl-accounts', requireAuth, PM, async (req, res) => {
    try {
      const tenantId = tenantOf(req);
      const body = insertPayrollGlAccountSchema.parse({ ...req.body, tenantId });
      res.json(await payrollStorage.createGlAccount(body));
    } catch (e: any) { res.status(400).json({ message: e.message }); }
  });

  app.get('/api/payroll/gl-mappings', requireAuth, PM, async (req, res) => {
    try { res.json(await payrollStorage.listGlMappings(tenantOf(req))); }
    catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.post('/api/payroll/gl-mappings', requireAuth, PM, async (req, res) => {
    try {
      const tenantId = tenantOf(req);
      const { category, glAccountId } = z.object({ category: z.string(), glAccountId: z.string() }).parse(req.body);
      // Tenant-ownership check: GL account must belong to this tenant.
      await payrollStorage.assertTenantOwns(tenantId, 'gl_account', glAccountId);
      const row = await payrollStorage.upsertGlMapping(tenantId, category, glAccountId);
      await payrollStorage.appendAudit({
        tenantId, actorUserId: (req.user as any)?.id,
        action: 'gl_mapping.upsert', entityType: 'gl_mapping', entityId: row.id,
        details: { category, glAccountId }, ipAddress: req.ip,
      });
      res.json(row);
    } catch (e: any) { res.status(400).json({ message: e.message }); }
  });

  app.get('/api/payroll/runs/:id/gl-export', requireAuth, PM, async (req, res) => {
    try {
      const tenantId = tenantOf(req);
      const rows = await payrollStorage.buildGlExport(tenantId, req.params.id);
      const format = (req.query.format as string) || 'json';
      if (format === 'csv') {
        const header = 'Account Number,Account Name,Debit,Credit,Memo';
        const lines = rows.map(r => `${r.accountNumber},"${r.accountName.replace(/"/g, '""')}",${(r.debitCents / 100).toFixed(2)},${(r.creditCents / 100).toFixed(2)},"${r.memo}"`);
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="payroll-gl-${req.params.id}.csv"`);
        return res.send([header, ...lines].join('\n'));
      }
      res.json(rows);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // ---- ACH / NACHA disbursement ----
  app.get('/api/payroll/ach-originator', requireAuth, PM, async (req, res) => {
    try { res.json(await payrollStorage.getAchOriginator(tenantOf(req)) || null); }
    catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.put('/api/payroll/ach-originator', requireAuth, PM, async (req, res) => {
    try {
      const tenantId = tenantOf(req);
      const body = insertPayrollAchOriginatorSchema.parse({ ...req.body, tenantId });
      const row = await payrollStorage.upsertAchOriginator(body);
      await payrollStorage.appendAudit({
        tenantId, actorUserId: (req.user as any)?.id,
        action: 'ach_originator.upsert', entityType: 'ach_originator', entityId: row.id,
        ipAddress: req.ip,
      });
      res.json(row);
    } catch (e: any) { res.status(400).json({ message: e.message }); }
  });

  app.get('/api/payroll/runs/:id/ach-export', requireAuth, PM, async (req, res) => {
    try {
      const tenantId = tenantOf(req);
      const run = await payrollStorage.getRun(tenantId, req.params.id);
      if (!run) return res.status(404).json({ message: 'Run not found' });
      if (run.status !== 'approved' && run.status !== 'finalized') {
        return res.status(400).json({ message: `Cannot export ACH for ${run.status} run; approve or finalize first` });
      }
      const originator = await payrollStorage.getAchOriginator(tenantId);
      if (!originator) {
        return res.status(400).json({ message: 'ACH originator profile not configured. Set company id, ODFI, and immediate origin/destination first.' });
      }
      const items = await payrollStorage.listRunItems(tenantId, run.id);
      const employees = await payrollStorage.listEmployees(tenantId, true);
      const byId = new Map(employees.map(e => [e.id, e]));
      const entries: NachaEntry[] = [];
      const skipped: Array<{ employeeId: string; reason: string }> = [];
      for (const it of items) {
        if (it.netPayCents <= 0) continue;
        const emp = byId.get(it.employeeId);
        if (!emp) { skipped.push({ employeeId: it.employeeId, reason: 'employee_not_found' }); continue; }
        if (!emp.bankRoutingNumber || !emp.bankAccountNumberEnc || !emp.bankAccountType) {
          skipped.push({ employeeId: it.employeeId, reason: 'missing_bank_info' });
          continue;
        }
        // Decrypt at the very last moment, only when actually emitting the
        // NACHA file. The decrypted value never escapes this scope.
        let accountNumber: string | null;
        try { accountNumber = decryptString(emp.bankAccountNumberEnc); }
        catch { skipped.push({ employeeId: it.employeeId, reason: 'decrypt_failed' }); continue; }
        if (!accountNumber) { skipped.push({ employeeId: it.employeeId, reason: 'missing_bank_info' }); continue; }
        entries.push({
          employeeName: `${emp.firstName} ${emp.lastName}`.toUpperCase(),
          employeeId: emp.externalEmployeeNumber || emp.id.slice(0, 15),
          routingNumber: emp.bankRoutingNumber,
          accountNumber,
          accountType: emp.bankAccountType === 'savings' ? 'savings' : 'checking',
          amountCents: it.netPayCents,
        });
      }
      if (entries.length === 0) {
        return res.status(400).json({ message: 'No employees with bank info on this run', skipped });
      }
      const effectiveDate = run.payDate.replace(/-/g, '').slice(2); // YYMMDD
      const file = buildNachaFile({
        companyName: originator.companyName,
        companyId: originator.companyId,
        originatingDfi: originator.originatingDfi,
        immediateOriginName: originator.immediateOriginName,
        immediateOrigin: originator.immediateOrigin,
        immediateDestinationName: originator.immediateDestinationName,
        immediateDestination: originator.immediateDestination,
      }, entries, effectiveDate);
      await payrollStorage.appendAudit({
        tenantId, actorUserId: (req.user as any)?.id,
        action: 'run.ach_export', entityType: 'run', entityId: run.id,
        details: { entryCount: file.entryCount, totalCents: file.totalCents, skipped },
        ipAddress: req.ip,
      });
      res.setHeader('Content-Type', 'text/plain');
      res.setHeader('Content-Disposition', `attachment; filename="payroll-ach-${run.id}.ach"`);
      res.setHeader('X-Ach-Entry-Count', String(file.entryCount));
      res.setHeader('X-Ach-Total-Cents', String(file.totalCents));
      res.send(file.content);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // ---- Tax-filing totals (drives 941 quarterly + W-2 / 1099 annual prep) ----
  app.get('/api/payroll/tax-totals', requireAuth, PM, async (req, res) => {
    try {
      const tenantId = tenantOf(req);
      const q = z.object({
        period: z.enum(['quarter', 'year', 'custom']).default('quarter'),
        year: z.coerce.number().int().optional(),
        quarter: z.coerce.number().int().min(1).max(4).optional(),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
      }).parse(req.query);
      let startDate: string, endDate: string;
      if (q.period === 'custom') {
        if (!q.startDate || !q.endDate) return res.status(400).json({ message: 'startDate and endDate required for custom period' });
        startDate = q.startDate; endDate = q.endDate;
      } else if (q.period === 'year') {
        const y = q.year ?? new Date().getUTCFullYear();
        startDate = `${y}-01-01`; endDate = `${y}-12-31`;
      } else {
        const y = q.year ?? new Date().getUTCFullYear();
        const qn = q.quarter ?? Math.floor(new Date().getUTCMonth() / 3) + 1;
        const startMonth = (qn - 1) * 3 + 1;
        const endMonth = startMonth + 2;
        const lastDay = new Date(Date.UTC(y, endMonth, 0)).getUTCDate();
        startDate = `${y}-${String(startMonth).padStart(2, '0')}-01`;
        endDate = `${y}-${String(endMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
      }
      res.json(await payrollStorage.taxTotals(tenantId, startDate, endDate));
    } catch (e: any) { res.status(400).json({ message: e.message }); }
  });

  // ---- Tax filing artifacts: 941, W-2, W-3, 1099-NEC ----
  // Each returns a printable HTML (941) or CSV (W-2/W-3/1099) suitable to
  // hand to an accountant or paste into filing software.
  app.get('/api/payroll/tax-forms/941', requireAuth, PM, async (req, res) => {
    try {
      const tenantId = tenantOf(req);
      const q = z.object({ year: z.coerce.number().int(), quarter: z.coerce.number().int().min(1).max(4) }).parse(req.query);
      const startMonth = (q.quarter - 1) * 3 + 1;
      const endMonth = startMonth + 2;
      const lastDay = new Date(Date.UTC(q.year, endMonth, 0)).getUTCDate();
      const startDate = `${q.year}-${String(startMonth).padStart(2, '0')}-01`;
      const endDate = `${q.year}-${String(endMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
      const totals = await payrollStorage.taxTotals(tenantId, startDate, endDate);
      const scheduleB = await payrollStorage.scheduleBLiabilities(tenantId, startDate, endDate);
      const html = render941Html({
        tenantName: (req.user as any)?.tenantName ?? 'Employer',
        ein: (req.query.ein as string) || undefined,
        year: q.year, quarter: q.quarter,
        totals: totals.totals,
        w2EmployeeCount: totals.w2Employees.length,
        scheduleB,
      });
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(html);
    } catch (e: any) { res.status(400).json({ message: e.message }); }
  });

  app.get('/api/payroll/tax-forms/w2', requireAuth, PM, async (req, res) => {
    try {
      const tenantId = tenantOf(req);
      const year = Number(req.query.year ?? new Date().getUTCFullYear());
      const totals = await payrollStorage.taxTotals(tenantId, `${year}-01-01`, `${year}-12-31`);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="w2-${year}.csv"`);
      res.send(renderW2Csv(totals as any));
    } catch (e: any) { res.status(400).json({ message: e.message }); }
  });

  app.get('/api/payroll/tax-forms/w3', requireAuth, PM, async (req, res) => {
    try {
      const tenantId = tenantOf(req);
      const year = Number(req.query.year ?? new Date().getUTCFullYear());
      const totals = await payrollStorage.taxTotals(tenantId, `${year}-01-01`, `${year}-12-31`);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="w3-${year}.csv"`);
      res.send(renderW3Csv(totals as any));
    } catch (e: any) { res.status(400).json({ message: e.message }); }
  });

  app.get('/api/payroll/tax-forms/1099-nec', requireAuth, PM, async (req, res) => {
    try {
      const tenantId = tenantOf(req);
      const year = Number(req.query.year ?? new Date().getUTCFullYear());
      const totals = await payrollStorage.taxTotals(tenantId, `${year}-01-01`, `${year}-12-31`);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="1099-nec-${year}.csv"`);
      res.send(render1099NecCsv(totals as any));
    } catch (e: any) { res.status(400).json({ message: e.message }); }
  });

  // ---- E-file: SSA EFW2 (W-2) ---------------------------------------------
  // Generates the fixed-width 512-char EFW2 file uploadable to SSA BSO.
  // The filer must supply their BSO User ID and EIN (not stored in schema
  // yet — passed in the POST body). Test against SSA AccuWage before
  // production submission.
  const efw2Body = z.object({
    year: z.coerce.number().int(),
    submitter: z.object({
      userId: z.string().min(8).max(8),
      ein: z.string(),
      name: z.string(),
      addressLine1: z.string(),
      addressLine2: z.string().optional(),
      city: z.string(),
      stateCode: z.string().length(2),
      zip: z.string(),
      contactName: z.string(),
      contactPhone: z.string(),
      contactEmail: z.string().optional(),
    }),
    employer: z.object({
      ein: z.string(),
      name: z.string(),
      addressLine1: z.string(),
      addressLine2: z.string().optional(),
      city: z.string(),
      stateCode: z.string().length(2),
      zip: z.string(),
    }).optional(),
  });

  app.post('/api/payroll/tax-forms/w2-efw2', requireAuth, PM, async (req, res) => {
    try {
      const tenantId = tenantOf(req);
      const body = efw2Body.parse(req.body);
      const totals = await payrollStorage.taxTotals(
        tenantId, `${body.year}-01-01`, `${body.year}-12-31`,
      );
      const employees = await payrollStorage.listEmployees(tenantId, true);
      const empById = new Map(employees.map(e => [e.id, e]));
      // Resolve full SSN for each W-2 employee. The schema only stores
      // last-4 today; production filing must source the full SSN from a
      // PII vault. The route accepts a `fullSsns` map keyed by employeeId
      // so the caller can wire that source in without changing the schema.
      // No full SSN → hard-fail; we will never synthesize one.
      const fullSsns: Record<string, string> = (req.body?.fullSsns ?? {}) as any;
      const missing: string[] = [];
      const efw2Employees: Efw2Employee[] = totals.w2Employees
        .map((t: any): Efw2Employee | null => {
          const emp = empById.get(t.employeeId);
          if (!emp) return null;
          const ssn = String(fullSsns[t.employeeId] ?? '').replace(/\D/g, '');
          if (!/^\d{9}$/.test(ssn)) {
            missing.push(`${emp.firstName} ${emp.lastName}`);
            return null;
          }
          return {
            ssn,
            firstName: emp.firstName,
            lastName: emp.lastName,
            addressLine1: emp.homeAddress ?? '',
            city: emp.homeCity ?? '',
            stateCode: emp.homeStateCode ?? '',
            zip: emp.homeZip ?? '',
            wagesCents: t.taxableWagesCents,
            fedIncomeTaxCents: t.fedIncomeTaxCents,
            ssWagesCents: t.ssWagesCents,
            // Box 4 / Box 6 reflect actual withholding from the run
            // breakdown — not a recomputation from wages, which would
            // miss SS cap behavior, rounding, and the 0.9% Add'l
            // Medicare threshold. Add'l Medicare folds into Box 6 per
            // IRS Pub 15 (it's still Medicare tax on the W-2).
            ssTaxCents: t.ssTaxCents,
            medicareWagesCents: t.medicareWagesCents,
            medicareTaxCents: t.medicareTaxCents + t.additionalMedicareTaxCents,
          };
        })
        .filter((e: Efw2Employee | null): e is Efw2Employee => e !== null);
      if (missing.length > 0) {
        return res.status(400).json({
          message:
            `Missing full 9-digit SSN for ${missing.length} W-2 employee(s): ${missing.join(', ')}. ` +
            `Supply them via the request body { fullSsns: { [employeeId]: "123456789" } }. ` +
            `EFW2 will not synthesize SSNs from stored last-4 values.`,
          missingEmployees: missing,
        });
      }
      if (efw2Employees.length === 0) {
        return res.status(400).json({
          message: 'No W-2 employees in scope for the requested year.',
        });
      }
      // Default employer info from the ACH originator profile if not supplied.
      const ach = await payrollStorage.getAchOriginator(tenantId);
      const employer = body.employer ?? (ach ? {
        ein: ach.companyId.replace(/^1/, ''), // ACH carries '1' + EIN
        name: ach.companyName,
        addressLine1: '',
        city: '',
        stateCode: '',
        zip: '',
      } : null);
      if (!employer) {
        return res.status(400).json({
          message: 'Employer info not provided and no ACH originator profile to fall back on.',
        });
      }
      const file = buildEfw2File({
        taxYear: body.year,
        submitter: body.submitter,
        employer,
        employees: efw2Employees,
      });
      res.setHeader('Content-Type', 'text/plain; charset=ascii');
      res.setHeader('Content-Disposition', `attachment; filename="W2REPORT.${body.year}.txt"`);
      res.send(file);
    } catch (e: any) { res.status(400).json({ message: e.message }); }
  });

  // ---- E-file: IRS FIRE 1099-NEC ------------------------------------------
  // Generates the fixed-width 750-char FIRE file for 1099-NEC. Requires
  // the filer's IRS-issued TCC (Transmitter Control Code).
  const fireBody = z.object({
    year: z.coerce.number().int(),
    transmitter: z.object({
      tcc: z.string().length(5),
      tin: z.string(),
      name: z.string(),
      addressLine1: z.string(),
      city: z.string(),
      stateCode: z.string().length(2),
      zip: z.string(),
      contactName: z.string(),
      contactPhone: z.string(),
      contactEmail: z.string().optional(),
      testFile: z.boolean().optional(),
    }),
    payer: z.object({
      tin: z.string(),
      nameControl: z.string().max(4).optional(),
      name: z.string(),
      addressLine1: z.string(),
      city: z.string(),
      stateCode: z.string().length(2),
      zip: z.string(),
      phone: z.string().optional(),
    }).optional(),
  });

  app.post('/api/payroll/tax-forms/1099-nec-fire', requireAuth, PM, async (req, res) => {
    try {
      const tenantId = tenantOf(req);
      const body = fireBody.parse(req.body);
      const totals = await payrollStorage.taxTotals(
        tenantId, `${body.year}-01-01`, `${body.year}-12-31`,
      );
      const employees = await payrollStorage.listEmployees(tenantId, true);
      const empById = new Map(employees.map(e => [e.id, e]));
      // Full TIN per contractor must come from their W-9 — the route
      // accepts a `tins` map keyed by employeeId so the caller wires in
      // whatever source of record holds the W-9 data. tinType: 1 = EIN,
      // 2 = SSN, 3 = unknown (don't use). Refuse to synthesize a TIN
      // from stored last-4; IRS FIRE rejects mismatches and penalties run
      // $310/return.
      const tins: Record<string, { tin: string; tinType: 1 | 2 | 3 }> =
        (req.body?.tins ?? {}) as any;
      const missing: string[] = [];
      const payees: FirePayee[] = totals.form1099Recipients
        .map((r: any): FirePayee | null => {
          const emp = empById.get(r.employeeId);
          if (!emp) return null;
          // 1099 thresholds: skip recipients under $600 NEC for the year.
          if (r.grossCents < 60000) return null;
          const supplied = tins[r.employeeId];
          const tin = String(supplied?.tin ?? '').replace(/\D/g, '');
          if (!/^\d{9}$/.test(tin) || !supplied?.tinType || supplied.tinType === 3) {
            missing.push(`${emp.firstName} ${emp.lastName}`);
            return null;
          }
          return {
            tin,
            tinType: supplied.tinType,
            name: `${emp.firstName} ${emp.lastName}`,
            addressLine1: emp.homeAddress ?? '',
            city: emp.homeCity ?? '',
            stateCode: emp.homeStateCode ?? '',
            zip: emp.homeZip ?? '',
            necCents: r.grossCents,
            fedTaxWithheldCents: 0, // backup withholding not modeled yet
          };
        })
        .filter((p: FirePayee | null): p is FirePayee => p !== null);
      if (missing.length > 0) {
        return res.status(400).json({
          message:
            `Missing W-9 TIN for ${missing.length} contractor(s) above the $600 threshold: ${missing.join(', ')}. ` +
            `Supply them via { tins: { [employeeId]: { tin: "123456789", tinType: 1|2 } } }. ` +
            `FIRE will not synthesize TINs from stored last-4 values.`,
          missingContractors: missing,
        });
      }
      if (payees.length === 0) {
        return res.status(400).json({
          message: 'No 1099-NEC recipients above the $600 reporting threshold.',
        });
      }
      const ach = await payrollStorage.getAchOriginator(tenantId);
      const payer = body.payer ?? (ach ? {
        tin: ach.companyId.replace(/^1/, ''),
        name: ach.companyName,
        addressLine1: '',
        city: '',
        stateCode: '',
        zip: '',
      } : null);
      if (!payer) {
        return res.status(400).json({
          message: 'Payer info not provided and no ACH originator profile to fall back on.',
        });
      }
      const file = buildFire1099NecFile({
        taxYear: body.year,
        transmitter: body.transmitter,
        payer,
        payees,
      });
      res.setHeader('Content-Type', 'text/plain; charset=ascii');
      res.setHeader('Content-Disposition', `attachment; filename="IRSTAX.${body.year}.txt"`);
      res.send(file);
    } catch (e: any) { res.status(400).json({ message: e.message }); }
  });

  // ---- Self-service: an employee can see their own finalized paystubs ----
  // No PAYROLL_MANAGER gate — any authenticated user with a linked payroll
  // record can see their own pay history. Tenant is derived from the session
  // and the only employees returned are those where payrollEmployees.userId
  // matches the requester. There is no path to view another person's data.
  app.get('/api/me/payroll/paystubs', requireAuth, async (req, res) => {
    try {
      const tenantId = tenantOf(req);
      const userId = (req.user as any).id;
      const emp = await payrollStorage.findEmployeeByUserId(tenantId, userId);
      if (!emp) return res.json({ employee: null, paystubs: [] });
      const paystubs = await payrollStorage.listPaystubsForEmployee(tenantId, emp.id);
      res.json({ employee: { id: emp.id, employeeType: emp.employeeType, status: emp.status }, paystubs });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.get('/api/me/payroll/paystubs/:runId', requireAuth, async (req, res) => {
    try {
      const tenantId = tenantOf(req);
      const userId = (req.user as any).id;
      const emp = await payrollStorage.findEmployeeByUserId(tenantId, userId);
      if (!emp) return res.status(404).json({ message: 'You are not enrolled in payroll' });
      const detail = await payrollStorage.getPaystubForEmployee(tenantId, emp.id, req.params.runId);
      if (!detail) return res.status(404).json({ message: 'Paystub not found' });
      const reimbursements = await payrollStorage.listReimbursementsForRunItem(tenantId, detail.item.id);
      res.json({ ...detail, reimbursements });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // ---- Audit Log ----
  app.get('/api/payroll/audit-log', requireAuth, requireRole(PAYROLL_MANAGER), async (req, res) => {
    try { res.json(await payrollStorage.listAudit(tenantOf(req), Number(req.query.limit) || 200)); }
    catch (e: any) { res.status(500).json({ message: e.message }); }
  });
}
