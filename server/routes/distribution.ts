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
import { allocateDistribution, quarterBounds } from "../services/distribution-engine";
import {
  computeAvailableFunds, fetchActiveOwners, fetchFteCandidates, fetchPolicy,
} from "../services/distribution-data";
import {
  buildNachaFile, validateRouting, type NachaEntry, type NachaOriginator,
} from "../services/nacha";
import { decryptString, encryptString } from "../services/crypto";
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

  // Owner create/update: the client sends plaintext `bankAccountNumber`
  // and we encrypt it server-side into `bankAccountNumberEnc` — plaintext
  // never touches storage. This mirrors the pattern in
  // /api/payroll/employees so the encryption boundary is consistent.
  // tenantId is set from the session, never the body.
  const ownerBodySchema = insertEntityOwnerSchema
    .omit({ tenantId: true, bankAccountNumberEnc: true })
    .extend({ bankAccountNumber: z.string().optional() });

  function encryptOwnerBank<T extends { bankAccountNumber?: string }>(
    body: T,
  ): Omit<T, 'bankAccountNumber'> & { bankAccountNumberEnc?: string } {
    const { bankAccountNumber, ...rest } = body;
    const out: any = { ...rest };
    if (bankAccountNumber !== undefined && bankAccountNumber !== '') {
      const enc = encryptString(bankAccountNumber);
      if (!enc) {
        throw new Error('PAYROLL_ENCRYPTION_KEY is unset; cannot encrypt owner bank account.');
      }
      out.bankAccountNumberEnc = enc;
    }
    return out;
  }

  app.post('/api/distributions/owners', requireAuth, PM, async (req, res) => {
    try {
      const parsed = ownerBodySchema.parse(req.body);
      const data = { ...encryptOwnerBank(parsed), tenantId: tenantOf(req) };
      res.json(await distributionStorage.createOwner(data as any));
    } catch (e: any) { res.status(400).json({ message: e.message }); }
  });

  app.patch('/api/distributions/owners/:id', requireAuth, PM, async (req, res) => {
    try {
      const tenantId = tenantOf(req);
      // PATCH explicitly forbids tenantId in the body; updates are scoped
      // by the session tenant + path id.
      const parsed = ownerBodySchema.partial().parse(req.body);
      const data = encryptOwnerBank(parsed);
      res.json(await distributionStorage.updateOwner(tenantId, req.params.id, data as any));
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

  // Create a draft run for a quarter. Truly idempotent for drafts: a
  // repeated POST returns the existing draft as 200 (so the UI can navigate
  // straight to it). Once a run has advanced to previewed/approved/finalized
  // the endpoint hard-rejects with 409 — those states represent owner-
  // visible state, so silently returning them would mask a workflow error.
  // Reversed runs do not block; a corrected run can be created after one.
  app.post('/api/distributions/runs', requireAuth, PM, async (req, res) => {
    try {
      const tenantId = tenantOf(req);
      const body = z.object({ quarterLabel: z.string().regex(/^\d{4}-Q[1-4]$/) }).parse(req.body);
      const bounds = quarterBounds(body.quarterLabel);
      const existing = await db.select().from(distributionRuns).where(and(
        eq(distributionRuns.tenantId, tenantId),
        eq(distributionRuns.quarterLabel, body.quarterLabel),
      ));
      const live = existing.find(r => r.status !== 'reversed');
      if (live?.status === 'draft') {
        return res.json(live);
      }
      if (live) {
        return res.status(409).json({
          message: `A ${live.status} run already exists for ${body.quarterLabel}. Reverse it first if you need to create a new one.`,
          runId: live.id,
        });
      }
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
      // Persist warnings on the run so the UI surfaces them even after a
      // refresh, and once the run has moved past 'previewed' (where the
      // user can no longer re-preview to regenerate them).
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
        warnings: preview.warnings,
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

  // Shared helper: produce the owner-pool NACHA file for a run. Used by
  // finalize (to validate before persisting) and by the streaming download
  // endpoint (to regenerate the file on demand without ever putting its
  // contents in a JSON response). Pure read + cryptography — never writes.
  // Throws on validation failures so the caller can map them to the right
  // HTTP status.
  async function buildOwnerAchForRun(
    tenantId: string,
    run: { id: string; nachaEffectiveDate: string | null },
    ownerLines: Awaited<ReturnType<typeof distributionStorage.listLines>>,
  ): Promise<{ content: string; effectiveDate: string; trace: string } | null> {
    if (ownerLines.length === 0) return null;
    const ach = await payrollStorage.getAchOriginator(tenantId);
    if (!ach) {
      throw Object.assign(new Error(
        'No ACH originator profile on file. Configure under Payroll Settings before generating owner distributions.',
      ), { httpStatus: 400 });
    }
    const owners = await distributionStorage.listOwners(tenantId);
    const ownerByUser = new Map(owners.map(o => [o.userId, o]));
    const entries: NachaEntry[] = [];
    for (const l of ownerLines) {
      const o = ownerByUser.get(l.recipientUserId);
      if (!o) {
        throw Object.assign(new Error(
          `Owner ${l.recipient?.name ?? l.recipientUserId} has a distribution line but no entity_owners record.`,
        ), { httpStatus: 400 });
      }
      if (!o.bankRoutingNumber || !o.bankAccountNumberEnc) {
        throw Object.assign(new Error(
          `Owner ${l.recipient?.name ?? l.recipientUserId} is missing bank details.`,
        ), { httpStatus: 400 });
      }
      if (!validateRouting(o.bankRoutingNumber)) {
        throw Object.assign(new Error(
          `Owner ${l.recipient?.name ?? l.recipientUserId} has an invalid routing number.`,
        ), { httpStatus: 400 });
      }
      let accountNumber: string | null = null;
      try {
        accountNumber = decryptString(o.bankAccountNumberEnc);
      } catch {
        // fall through
      }
      if (!accountNumber) {
        throw Object.assign(new Error(
          'Unable to decrypt an owner bank account. Check PAYROLL_ENCRYPTION_KEY.',
        ), { httpStatus: 500 });
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
    // Effective date: use the value captured at finalize time so re-downloads
    // produce byte-identical files. If finalize hasn't stamped one yet (i.e.
    // this is the finalize call itself), generate from today.
    let effectiveDate = run.nachaEffectiveDate ?? '';
    if (!effectiveDate) {
      const today = new Date();
      effectiveDate =
        String(today.getUTCFullYear() % 100).padStart(2, '0') +
        String(today.getUTCMonth() + 1).padStart(2, '0') +
        String(today.getUTCDate()).padStart(2, '0');
    }
    const content = buildNachaFile(originator, entries, effectiveDate).content;
    return { content, effectiveDate, trace: `DIST-${run.id.slice(0, 8)}` };
  }

  // Finalize: validates everything, emits the owner NACHA file once,
  // captures its effective date on the run, and creates a draft bonus
  // payroll run for FTE pool lines. The NACHA file body is NOT returned
  // in the JSON response — fetch it via GET /owner-ach to keep plaintext
  // routing/account numbers out of API logs and devtools history.
  //
  // Two-phase shape so partial failures don't strand state:
  //   Phase 1 (no writes): load lines, validate bank/employee data, decrypt
  //                        owner accounts, build the NACHA file body.
  //   Phase 2 (db.transaction): insert payroll_run + payroll_run_items,
  //                              stamp owner lines 'issued' + ACH trace,
  //                              link FTE lines to payroll items (status
  //                              stays 'pending' until the bonus payroll
  //                              run actually finalizes), update the
  //                              distribution run to 'finalized' and
  //                              stamp the NACHA effective date so the
  //                              download endpoint regenerates an
  //                              identical file.
  // If anything in phase 1 fails we 4xx without writes. If anything in
  // phase 2 fails the transaction rolls back atomically.
  //
  // Status semantics for distribution_lines:
  //   pending   — preview created the line, no money has moved
  //   issued    — owner: NACHA file emitted, bank settlement not confirmed
  //   paid      — bank ACK received (owner) or downstream payroll run
  //               finalized (FTE)
  //   reversed  — manually unwound
  app.post('/api/distributions/runs/:id/finalize', requireAuth, PM, async (req, res) => {
    try {
      const tenantId = tenantOf(req);
      const run = await distributionStorage.getRun(tenantId, req.params.id);
      if (!run) return res.status(404).json({ message: 'Run not found' });
      if (run.status !== 'approved') {
        return res.status(409).json({ message: `Cannot finalize a ${run.status} run.` });
      }
      const lines = await distributionStorage.listLines(tenantId, run.id);

      // ---- Phase 1: validate + build the NACHA file (no writes) ----------
      const ownerLines = lines.filter(l => l.recipientType === 'owner' && l.amountCents > 0);
      const fteLines = lines.filter(l => l.recipientType === 'fte' && l.amountCents > 0);

      let nachaResult: { content: string; effectiveDate: string; trace: string } | null = null;
      try {
        nachaResult = await buildOwnerAchForRun(tenantId, run, ownerLines);
      } catch (e: any) {
        return res.status(e.httpStatus ?? 500).json({ message: e.message });
      }

      // FTE: validate every line has a payroll_employee before we open the tx.
      const emps = await payrollStorage.listEmployees(tenantId, false);
      const empByUser = new Map(emps.filter(e => e.userId).map(e => [e.userId!, e]));
      if (fteLines.length > 0) {
        const missingFte = fteLines
          .filter(l => !empByUser.has(l.recipientUserId))
          .map(l => l.recipient?.name ?? l.recipientUserId);
        if (missingFte.length > 0) {
          return res.status(400).json({
            message: `FTE lines reference users without payroll employee records: ${missingFte.join(', ')}`,
          });
        }
      }

      // ---- Phase 2: single transaction for all writes ---------------------
      const userId = (req.user as any)?.id ?? null;
      const todayDate = new Date().toISOString().slice(0, 10);
      const { updatedRun, ftePayrollRunId } = await db.transaction(async (tx) => {
        let ftePayrollRunId: string | null = null;
        if (fteLines.length > 0) {
          const [newRun] = await tx.insert(payrollRuns).values({
            tenantId,
            periodStart: run.periodStart,
            periodEnd: run.periodEnd,
            payDate: todayDate,
            runType: 'bonus',
            status: 'draft',
            createdBy: userId,
            notes: `FTE profit-sharing pool from distribution run ${run.id} (${run.quarterLabel}).`,
          }).returning();
          for (const l of fteLines) {
            const emp = empByUser.get(l.recipientUserId)!;
            const [item] = await tx.insert(payrollRunItems).values({
              tenantId,
              runId: newRun.id,
              employeeId: emp.id,
              bonusCents: l.amountCents,
            }).returning();
            // status stays 'pending'; downstream payroll finalize flips to 'paid'.
            await distributionStorage.linkFteLine(tx, tenantId, l.id, item.id);
          }
          ftePayrollRunId = newRun.id;
        }
        if (nachaResult) {
          for (const l of ownerLines) {
            await distributionStorage.markOwnerLineIssued(tx, tenantId, l.id, nachaResult.trace);
          }
        }
        const [updatedRun] = await tx.update(distributionRuns)
          .set({
            status: 'finalized',
            finalizedAt: new Date(),
            ftePayrollRunId: ftePayrollRunId ?? undefined,
            nachaEffectiveDate: nachaResult?.effectiveDate,
          })
          .where(and(eq(distributionRuns.tenantId, tenantId), eq(distributionRuns.id, run.id)))
          .returning();
        return { updatedRun, ftePayrollRunId };
      });

      // Deliberately don't return the NACHA file body in this JSON
      // response — plaintext routing/account numbers belong only on the
      // streaming download endpoint (see GET /owner-ach below).
      res.json({
        run: updatedRun,
        ftePayrollRunId,
        ownerAchAvailable: nachaResult !== null,
        message: ftePayrollRunId
          ? 'Owner ACH file ready (download via /owner-ach); FTE bonus payroll run created in draft — preview and finalize it from /payroll/runs to disburse and flip FTE lines to paid.'
          : nachaResult
            ? 'Owner ACH file ready (download via /owner-ach). No FTE bonus pool this quarter.'
            : 'Run finalized. No owner pool and no FTE pool this quarter.',
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

  // Owner ACH download. Regenerates the NACHA file on demand using the
  // effective date captured at finalize, so re-downloads are byte-identical.
  // Streams as text/plain attachment — the file contents are never
  // serialized inside a JSON response or other middleware-friendly format,
  // which keeps plaintext routing/account numbers out of access logs,
  // gateway caches, and browser devtools history.
  app.get('/api/distributions/runs/:id/owner-ach', requireAuth, PM, async (req, res) => {
    try {
      const tenantId = tenantOf(req);
      const run = await distributionStorage.getRun(tenantId, req.params.id);
      if (!run) return res.status(404).json({ message: 'Run not found' });
      if (run.status !== 'finalized') {
        return res.status(409).json({
          message: `Owner ACH file is only available for finalized runs (this run is ${run.status}).`,
        });
      }
      const lines = await distributionStorage.listLines(tenantId, run.id);
      const ownerLines = lines.filter(l => l.recipientType === 'owner' && l.amountCents > 0);
      let result: { content: string; effectiveDate: string; trace: string } | null = null;
      try {
        result = await buildOwnerAchForRun(tenantId, run, ownerLines);
      } catch (e: any) {
        return res.status(e.httpStatus ?? 500).json({ message: e.message });
      }
      if (!result) {
        return res.status(404).json({ message: 'This run has no owner pool to disburse.' });
      }
      res.setHeader('Content-Type', 'text/plain; charset=ascii');
      // Prevent intermediaries from caching plaintext bank details.
      res.setHeader('Cache-Control', 'private, no-store, max-age=0');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="distribution-owner-ach-${run.quarterLabel}.txt"`,
      );
      res.send(result.content);
    } catch (e: any) {
      // eslint-disable-next-line no-console
      console.error('owner ACH download failed', e);
      res.status(500).json({ message: e.message });
    }
  });
}
