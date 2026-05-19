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
      res.json({ employee: enriched, compensation, deductions, pto });
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
      const emp = await payrollStorage.createEmployee(body);
      // Keep the user row's payroll flag consistent so both sides agree.
      if (emp.userId) {
        await payrollStorage.syncUserEnrollmentFlag(emp.userId, emp.employeeType);
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
      res.json({ run, items });
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
        entries.push({
          employeeName: `${emp.firstName} ${emp.lastName}`.toUpperCase(),
          employeeId: emp.externalEmployeeNumber || emp.id.slice(0, 15),
          routingNumber: emp.bankRoutingNumber,
          accountNumber: emp.bankAccountNumberEnc, // TODO: decrypt
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

  // ---- Audit Log ----
  app.get('/api/payroll/audit-log', requireAuth, requireRole(PAYROLL_MANAGER), async (req, res) => {
    try { res.json(await payrollStorage.listAudit(tenantOf(req), Number(req.query.limit) || 200)); }
    catch (e: any) { res.status(500).json({ message: e.message }); }
  });
}
