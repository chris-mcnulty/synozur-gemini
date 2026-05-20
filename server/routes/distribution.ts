/**
 * Quarterly profit distribution API routes.
 *
 * Mirrors the payroll routes pattern: tenant boundary derived server-side,
 * role-gated to PAYROLL_MANAGER (admin / billing-admin). Distribution data
 * is owner-class compensation — never expose it to non-finance roles.
 *
 * Lifecycle endpoints follow the same FSM as payroll runs:
 *   POST   /api/distributions/runs/:id/preview   draft → previewed
 *   POST   /api/distributions/runs/:id/approve   previewed → approved
 *   POST   /api/distributions/runs/:id/finalize  approved → finalized
 *                                                + creates owner ACH file
 *                                                + creates FTE bonus payroll run
 *   POST   /api/distributions/runs/:id/reverse   finalized → reversed
 */

import type { Express, Request } from "express";
import { z } from "zod";
import { distributionStorage } from "../storage/distribution";
import { payrollStorage } from "../storage/payroll";
import {
  computeAvailableFunds, allocateDistribution,
  fetchActiveOwners, fetchFteCandidates, fetchPolicy,
  quarterBounds,
} from "../services/distribution-engine";
import {
  buildNachaFile, validateRouting, type NachaEntry, type NachaOriginator,
} from "../services/nacha";
import { decryptString } from "../services/crypto";
import { db } from "../db";
import { eq, and, sql } from "drizzle-orm";
import {
  distributionRuns, distributionLines, payrollRuns, payrollRunItems,
  insertEntityOwnerSchema, insertDistributionPolicySchema,
} from "@shared/schema";

interface Deps {
  requireAuth: any;
  requireRole: (roles: string[]) => any;
}

function tenantOf(req: Request): string {
  const u: any = req.user;
  const tid = u?.activeTenantId || u?.primaryTenantId || u?.tenantId;
  if (!tid) throw new Error('No active tenant on session');
  return tid;
}

const ROLES = ['admin', 'billing-admin'];

export function registerDistributionRoutes(app: Express, deps: Deps) {
  const { requireAuth, requireRole } = deps;
  const PM = requireRole(ROLES);

  // ---- Owners --------------------------------------------------------------
  app.get('/api/distributions/owners', requireAuth, PM, async (req, res) => {
    try {
      res.json(await distributionStorage.listOwners(tenantOf(req)));
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.post('/api/distributions/owners', requireAuth, PM, async (req, res) => {
    try {
      const data = insertEntityOwnerSchema.parse({ ...req.body, tenantId: tenantOf(req) });
      res.json(await distributionStorage.createOwner(data));
    } catch (e: any) { res.status(400).json({ message: e.message }); }
  });

  app.patch('/api/distributions/owners/:id', requireAuth, PM, async (req, res) => {
    try {
      const tenantId = tenantOf(req);
      const data = insertEntityOwnerSchema.partial().parse(req.body);
      res.json(await distributionStorage.updateOwner(tenantId, req.params.id, data));
    } catch (e: any) { res.status(400).json({ message: e.message }); }
  });

  app.post('/api/distributions/owners/:id/retire', requireAuth, PM, async (req, res) => {
    try {
      const tenantId = tenantOf(req);
      const body = z.object({ effectiveTo: z.string() }).parse(req.body);
      await distributionStorage.retireOwner(tenantId, req.params.id, body.effectiveTo);
      res.json({ ok: true });
    } catch (e: any) { res.status(400).json({ message: e.message }); }
  });

  // ---- Policy --------------------------------------------------------------
  app.get('/api/distributions/policy', requireAuth, PM, async (req, res) => {
    try {
      const tenantId = tenantOf(req);
      const policy = await fetchPolicy(tenantId);
      res.json(policy);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.patch('/api/distributions/policy', requireAuth, PM, async (req, res) => {
    try {
      const tenantId = tenantOf(req);
      const data = insertDistributionPolicySchema.partial().omit({ tenantId: true }).parse(req.body);
      const policy = await distributionStorage.upsertPolicy(tenantId, data);
      res.json(policy);
    } catch (e: any) { res.status(400).json({ message: e.message }); }
  });

  // ---- Runs ----------------------------------------------------------------
  app.get('/api/distributions/runs', requireAuth, PM, async (req, res) => {
    try {
      res.json(await distributionStorage.listRuns(tenantOf(req)));
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.get('/api/distributions/runs/:id', requireAuth, PM, async (req, res) => {
    try {
      const tenantId = tenantOf(req);
      const run = await distributionStorage.getRun(tenantId, req.params.id);
      if (!run) return res.status(404).json({ message: 'Run not found' });
      const lines = await distributionStorage.listLines(tenantId, run.id);
      res.json({ run, lines });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // Create a draft run for a quarter (idempotent — returns existing draft).
  app.post('/api/distributions/runs', requireAuth, PM, async (req, res) => {
    try {
      const tenantId = tenantOf(req);
      const body = z.object({ quarterLabel: z.string().regex(/^\d{4}-Q[1-4]$/) }).parse(req.body);
      const bounds = quarterBounds(body.quarterLabel);
      // Reject if a non-reversed run already exists for this quarter.
      const existing = await db.select().from(distributionRuns).where(and(
        eq(distributionRuns.tenantId, tenantId),
        eq(distributionRuns.quarterLabel, body.quarterLabel),
      ));
      const live = existing.find(r => r.status !== 'reversed');
      if (live) return res.status(409).json({
        message: `A ${live.status} run already exists for ${body.quarterLabel}.`,
        runId: live.id,
      });
      const userId = (req.user as any)?.id ?? null;
      const run = await distributionStorage.createRun({
        tenantId,
        quarterLabel: body.quarterLabel,
        periodStart: bounds.start,
        periodEnd: bounds.end,
        status: 'draft',
        createdBy: userId,
      } as any);
      res.json(run);
    } catch (e: any) { res.status(400).json({ message: e.message }); }
  });

  // Preview: compute available funds, allocate, and write lines.
  // Re-runnable until status is approved/finalized.
  app.post('/api/distributions/runs/:id/preview', requireAuth, PM, async (req, res) => {
    try {
      const tenantId = tenantOf(req);
      const run = await distributionStorage.getRun(tenantId, req.params.id);
      if (!run) return res.status(404).json({ message: 'Run not found' });
      if (run.status !== 'draft' && run.status !== 'previewed') {
        return res.status(409).json({ message: `Cannot preview a ${run.status} run.` });
      }
      const policy = await fetchPolicy(tenantId);
      const funds = await computeAvailableFunds(tenantId, run.periodStart, run.periodEnd, policy);
      const owners = await fetchActiveOwners(tenantId);
      const candidates = await fetchFteCandidates(tenantId, run.periodEnd);
      const preview = allocateDistribution(funds, policy, owners, candidates);

      await distributionStorage.replaceLines(
        tenantId, run.id,
        preview.lines.map(l => ({
          recipientUserId: l.recipientUserId,
          recipientType: l.recipientType,
          amountCents: l.amountCents,
          weight: String(l.weight),
          payoutMethod: l.payoutMethod,
          status: 'pending',
          breakdown: l.breakdown,
        })),
      );
      const updated = await distributionStorage.updateRun(tenantId, run.id, {
        status: 'previewed',
        availableFundsCents: funds.availableFundsCents,
        revenueCollectedCents: funds.revenueCollectedCents,
        operatingExpenseCents: funds.operatingExpenseCents,
        payrollBurdenCents: funds.payrollBurdenCents,
        taxReserveCents: funds.taxReserveCents,
        operatingReserveCents: funds.operatingReserveCents,
        waBoAccrualCents: funds.waBoAccrualCents,
        ownerPoolCents: preview.ownerPoolCents,
        ftePoolCents: preview.ftePoolCents,
        policySnapshot: policy,
      });
      res.json({ run: updated, preview });
    } catch (e: any) {
      // eslint-disable-next-line no-console
      console.error('distribution preview failed', e);
      res.status(400).json({ message: e.message });
    }
  });

  // Approve: just an FSM transition + audit stamp. No money moves yet.
  app.post('/api/distributions/runs/:id/approve', requireAuth, PM, async (req, res) => {
    try {
      const tenantId = tenantOf(req);
      const run = await distributionStorage.getRun(tenantId, req.params.id);
      if (!run) return res.status(404).json({ message: 'Run not found' });
      if (run.status !== 'previewed') {
        return res.status(409).json({ message: `Cannot approve a ${run.status} run.` });
      }
      const userId = (req.user as any)?.id ?? null;
      const updated = await distributionStorage.updateRun(tenantId, run.id, {
        status: 'approved',
        approvedBy: userId,
        approvedAt: new Date(),
      });
      res.json(updated);
    } catch (e: any) { res.status(400).json({ message: e.message }); }
  });

  // Finalize: emits owner ACH file + creates supplemental payroll run for FTEs.
  // Returns the NACHA file body and the payroll run id.
  app.post('/api/distributions/runs/:id/finalize', requireAuth, PM, async (req, res) => {
    try {
      const tenantId = tenantOf(req);
      const run = await distributionStorage.getRun(tenantId, req.params.id);
      if (!run) return res.status(404).json({ message: 'Run not found' });
      if (run.status !== 'approved') {
        return res.status(409).json({ message: `Cannot finalize a ${run.status} run.` });
      }
      const lines = await distributionStorage.listLines(tenantId, run.id);

      // ---- Owner pool: build the non-payroll NACHA file ----------------
      const ownerLines = lines.filter(l => l.recipientType === 'owner' && l.amountCents > 0);
      let ownerAchFile: string | null = null;
      if (ownerLines.length > 0) {
        const ach = await payrollStorage.getAchOriginator(tenantId);
        if (!ach) {
          return res.status(400).json({
            message: 'No ACH originator profile on file. Configure under Payroll Settings before finalizing owner distributions.',
          });
        }
        // Resolve bank details from entity_owners (separate from payroll bank).
        const owners = await distributionStorage.listOwners(tenantId);
        const ownerByUser = new Map(owners.map(o => [o.userId, o]));
        const entries: NachaEntry[] = [];
        for (const l of ownerLines) {
          const o = ownerByUser.get(l.recipientUserId);
          if (!o) {
            return res.status(400).json({
              message: `Owner ${l.recipient?.name ?? l.recipientUserId} has a distribution line but no entity_owners record.`,
            });
          }
          if (!o.bankRoutingNumber || !o.bankAccountNumberEnc) {
            return res.status(400).json({
              message: `Owner ${l.recipient?.name ?? l.recipientUserId} is missing bank details.`,
            });
          }
          if (!validateRouting(o.bankRoutingNumber)) {
            return res.status(400).json({
              message: `Owner ${l.recipient?.name ?? l.recipientUserId} has an invalid routing number.`,
            });
          }
          let accountNumber: string | null = null;
          try {
            accountNumber = decryptString(o.bankAccountNumberEnc);
          } catch {
            // fall through
          }
          if (!accountNumber) {
            return res.status(500).json({
              message: 'Unable to decrypt an owner bank account. Check PAYROLL_ENCRYPTION_KEY.',
            });
          }
          entries.push({
            employeeName: l.recipient?.name ?? 'OWNER',
            employeeId: l.recipientUserId.slice(0, 15),
            routingNumber: o.bankRoutingNumber,
            accountNumber,
            accountType: (o.bankAccountType as 'checking' | 'savings') ?? 'checking',
            amountCents: l.amountCents,
          });
        }
        const originator: NachaOriginator = {
          companyName: ach.companyName,
          companyId: ach.companyId,
          originatingDfi: ach.originatingDfi,
          immediateOriginName: ach.immediateOriginName,
          immediateOrigin: ach.immediateOrigin,
          immediateDestinationName: ach.immediateDestinationName,
          immediateDestination: ach.immediateDestination,
        };
        // Effective date YYMMDD = today (caller can re-emit with a future date if needed).
        const today = new Date();
        const yymmdd = `${String(today.getUTCFullYear() % 100).padStart(2, '0')}${String(today.getUTCMonth() + 1).padStart(2, '0')}${String(today.getUTCDate()).padStart(2, '0')}`;
        ownerAchFile = buildNachaFile(originator, entries, yymmdd).content;
        // Stamp lines paid (trace numbers would come from the bank's
        // ACK file; for now we record an internal marker).
        for (const l of ownerLines) {
          await distributionStorage.markLinePaid(tenantId, l.id, {
            achTraceNumber: `DIST-${run.id.slice(0, 8)}`,
          });
        }
      }

      // ---- FTE pool: create a supplemental payroll run ------------------
      const fteLines = lines.filter(l => l.recipientType === 'fte' && l.amountCents > 0);
      let ftePayrollRunId: string | null = null;
      if (fteLines.length > 0) {
        // Map user_id → payroll_employee.id so the payroll run items link.
        const userIds = fteLines.map(l => l.recipientUserId);
        const emps = await payrollStorage.listEmployees(tenantId, false);
        const empByUser = new Map(emps.filter(e => e.userId).map(e => [e.userId!, e]));
        const missing = userIds.filter(u => !empByUser.has(u));
        if (missing.length > 0) {
          return res.status(400).json({
            message: `FTE lines reference users without payroll employee records: ${missing.join(', ')}`,
          });
        }
        const userId = (req.user as any)?.id ?? null;
        // Create the supplemental run. periodStart/end mirror the distribution
        // run's quarter; pay date defaults to today (admin can adjust).
        const today = new Date().toISOString().slice(0, 10);
        const [newRun] = await db.insert(payrollRuns).values({
          tenantId,
          periodStart: run.periodStart,
          periodEnd: run.periodEnd,
          payDate: today,
          runType: 'bonus',
          status: 'draft',
          createdBy: userId,
          notes: `FTE profit-sharing pool from distribution run ${run.id} (${run.quarterLabel}).`,
        }).returning();
        for (const l of fteLines) {
          const emp = empByUser.get(l.recipientUserId)!;
          const [item] = await db.insert(payrollRunItems).values({
            tenantId,
            runId: newRun.id,
            employeeId: emp.id,
            bonusCents: l.amountCents,
          }).returning();
          await distributionStorage.markLinePaid(tenantId, l.id, {
            payrollRunItemId: item.id,
          });
        }
        ftePayrollRunId = newRun.id;
      }

      const updated = await distributionStorage.updateRun(tenantId, run.id, {
        status: 'finalized',
        finalizedAt: new Date(),
        ftePayrollRunId: ftePayrollRunId ?? undefined,
      });

      res.json({
        run: updated,
        ownerAchFile,
        ftePayrollRunId,
        message: ftePayrollRunId
          ? 'Owner ACH file emitted; FTE bonus payroll run created in draft — preview and finalize it from /payroll/runs to actually disburse the bonuses.'
          : 'Owner ACH file emitted. No FTE bonus pool this quarter.',
      });
    } catch (e: any) {
      // eslint-disable-next-line no-console
      console.error('distribution finalize failed', e);
      res.status(500).json({ message: e.message });
    }
  });

  // Reverse: mark a finalized run as reversed. Does NOT auto-reverse the
  // FTE bonus payroll run (that has its own reversal endpoint) or claw back
  // owner ACH credits. The reverse status just frees the quarter for a
  // corrected run.
  app.post('/api/distributions/runs/:id/reverse', requireAuth, PM, async (req, res) => {
    try {
      const tenantId = tenantOf(req);
      const run = await distributionStorage.getRun(tenantId, req.params.id);
      if (!run) return res.status(404).json({ message: 'Run not found' });
      if (run.status !== 'finalized') {
        return res.status(409).json({ message: `Cannot reverse a ${run.status} run.` });
      }
      const updated = await distributionStorage.updateRun(tenantId, run.id, {
        status: 'reversed',
      });
      res.json({
        run: updated,
        note: 'Distribution run marked reversed. FTE bonus payroll run (if any) was NOT auto-reversed — reverse it separately from /payroll/runs if needed.',
      });
    } catch (e: any) { res.status(400).json({ message: e.message }); }
  });
}
