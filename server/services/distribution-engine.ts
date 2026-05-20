/**
 * Quarterly profit distribution engine — pure math.
 *
 *   allocateDistribution — split available_funds into the owner + FTE
 *     pools per policy, then per-recipient amounts by:
 *       Owner pool : ownership_pct (entity_owners)
 *       FTE pool   : configurable salary/tenure/performance/hours weights
 *
 *   quarterBounds — '2026-Q3' → start/end dates
 *
 * This file deliberately has zero DB imports so the engine math can be
 * unit-tested without provisioning a database (see
 * tests/payroll-engine.spec.ts). The DB-bound helpers
 * (computeAvailableFunds, fetchFteCandidates, fetchActiveOwners,
 * fetchPolicy) live in `distribution-data.ts`.
 *
 * See docs/design/quarterly-profit-distribution.md for the why behind
 * each calculation.
 */

import type {
  DistributionPolicy, EntityOwner, PayrollEmployee,
} from "@shared/schema";

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

export interface FtePoolCandidate {
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
