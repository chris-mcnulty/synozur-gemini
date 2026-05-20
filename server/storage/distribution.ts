/**
 * Storage layer for quarterly profit distribution.
 *
 * Pure DB operations; engine math lives in services/distribution-engine.ts.
 */

import { db } from "../db";
import { and, eq, desc } from "drizzle-orm";

// Drizzle's `tx` argument inside `db.transaction((tx) => ...)` is a
// PgTransaction, not the base NeonDatabase, but both expose the same
// update/insert/delete shape. We extract the callback param type so
// helpers can be called from inside or outside a transaction.
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
import {
  entityOwners, distributionPolicy, distributionRuns, distributionLines,
  users,
  type EntityOwner, type InsertEntityOwner,
  type DistributionPolicy, type InsertDistributionPolicy,
  type DistributionRun, type InsertDistributionRun,
  type DistributionLine, type InsertDistributionLine,
} from "@shared/schema";

export const distributionStorage = {
  // ---- Owners --------------------------------------------------------------
  async listOwners(tenantId: string): Promise<Array<EntityOwner & {
    user: { id: string; name: string | null; email: string | null } | null;
  }>> {
    const rows = await db.select({
      o: entityOwners,
      u: users,
    }).from(entityOwners)
      .leftJoin(users, eq(entityOwners.userId, users.id))
      .where(eq(entityOwners.tenantId, tenantId))
      .orderBy(desc(entityOwners.effectiveFrom));
    return rows.map(r => ({
      ...r.o,
      user: r.u ? { id: r.u.id, name: r.u.name, email: r.u.email } : null,
    }));
  },

  async createOwner(data: InsertEntityOwner): Promise<EntityOwner> {
    const [row] = await db.insert(entityOwners).values(data).returning();
    return row;
  },

  async updateOwner(tenantId: string, id: string, data: Partial<InsertEntityOwner>): Promise<EntityOwner> {
    const [row] = await db.update(entityOwners)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(entityOwners.tenantId, tenantId), eq(entityOwners.id, id)))
      .returning();
    if (!row) throw new Error('Owner not found');
    return row;
  },

  async retireOwner(tenantId: string, id: string, effectiveTo: string): Promise<void> {
    await db.update(entityOwners)
      .set({ effectiveTo, updatedAt: new Date() })
      .where(and(eq(entityOwners.tenantId, tenantId), eq(entityOwners.id, id)));
  },

  // ---- Policy --------------------------------------------------------------
  async getPolicy(tenantId: string): Promise<DistributionPolicy | undefined> {
    const rows = await db.select().from(distributionPolicy)
      .where(eq(distributionPolicy.tenantId, tenantId));
    return rows[0];
  },

  async upsertPolicy(tenantId: string, data: Partial<InsertDistributionPolicy>): Promise<DistributionPolicy> {
    const existing = await this.getPolicy(tenantId);
    if (existing) {
      const [row] = await db.update(distributionPolicy)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(distributionPolicy.tenantId, tenantId))
        .returning();
      return row;
    }
    const [row] = await db.insert(distributionPolicy)
      .values({ tenantId, ...data })
      .returning();
    return row;
  },

  // ---- Runs ----------------------------------------------------------------
  async listRuns(tenantId: string): Promise<DistributionRun[]> {
    return await db.select().from(distributionRuns)
      .where(eq(distributionRuns.tenantId, tenantId))
      .orderBy(desc(distributionRuns.periodEnd));
  },

  async getRun(tenantId: string, id: string): Promise<DistributionRun | undefined> {
    const rows = await db.select().from(distributionRuns)
      .where(and(eq(distributionRuns.tenantId, tenantId), eq(distributionRuns.id, id)));
    return rows[0];
  },

  async createRun(data: InsertDistributionRun): Promise<DistributionRun> {
    const [row] = await db.insert(distributionRuns).values(data).returning();
    return row;
  },

  async updateRun(tenantId: string, id: string, data: Partial<DistributionRun>): Promise<DistributionRun> {
    const [row] = await db.update(distributionRuns)
      .set(data)
      .where(and(eq(distributionRuns.tenantId, tenantId), eq(distributionRuns.id, id)))
      .returning();
    if (!row) throw new Error('Run not found');
    return row;
  },

  async listLines(tenantId: string, runId: string): Promise<Array<DistributionLine & {
    recipient: { id: string; name: string | null; email: string | null } | null;
  }>> {
    const rows = await db.select({
      l: distributionLines,
      u: users,
    }).from(distributionLines)
      .leftJoin(users, eq(distributionLines.recipientUserId, users.id))
      .where(and(eq(distributionLines.tenantId, tenantId), eq(distributionLines.runId, runId)))
      .orderBy(desc(distributionLines.amountCents));
    return rows.map(r => ({
      ...r.l,
      recipient: r.u ? { id: r.u.id, name: r.u.name, email: r.u.email } : null,
    }));
  },

  async replaceLines(
    tenantId: string,
    runId: string,
    newLines: Omit<InsertDistributionLine, 'tenantId' | 'runId'>[],
  ): Promise<void> {
    // Atomic delete + insert. A preview rerun rewrites the line set
    // entirely; wrapping the pair in a transaction prevents a crash mid-
    // replace from leaving the run with zero lines.
    await db.transaction(async (tx) => {
      await tx.delete(distributionLines)
        .where(and(eq(distributionLines.tenantId, tenantId), eq(distributionLines.runId, runId)));
      if (newLines.length > 0) {
        await tx.insert(distributionLines).values(
          newLines.map(l => ({ ...l, tenantId, runId })),
        );
      }
    });
  },

  /** Owner line moved to 'issued' once the NACHA file is emitted. Bank
   *  ACK or a manual confirm action flips it to 'paid' later — until then,
   *  the system has only generated a file, not settled money. */
  async markOwnerLineIssued(
    tx: Tx,
    tenantId: string,
    lineId: string,
    achTraceNumber: string,
  ): Promise<void> {
    await tx.update(distributionLines)
      .set({ status: 'issued', achTraceNumber })
      .where(and(eq(distributionLines.tenantId, tenantId), eq(distributionLines.id, lineId)));
  },

  /** FTE line links to its draft bonus payroll_run_item but stays
   *  'pending'. The downstream payroll run finalize is responsible for
   *  flipping the status to 'paid' once the bonus is actually disbursed. */
  async linkFteLine(
    tx: Tx,
    tenantId: string,
    lineId: string,
    payrollRunItemId: string,
  ): Promise<void> {
    await tx.update(distributionLines)
      .set({ payrollRunItemId })
      .where(and(eq(distributionLines.tenantId, tenantId), eq(distributionLines.id, lineId)));
  },
};
