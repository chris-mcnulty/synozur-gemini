/**
 * State income tax reciprocity.
 *
 * When an employee's home and work state differ, "reciprocity" agreements
 * between certain states allow the employer to withhold tax for the
 * employee's HOME state instead of the WORK state. The employee files a
 * non-residency certificate (e.g., PA REV-419, NJ NJ-165) with the
 * employer. We model the agreements as a directed map: for a worker
 * commuting from `home` to `work`, if `home` is in the reciprocity set
 * for `work`, the home state withholds.
 *
 * Sources:
 *  - NJ / PA: mutual since 1977.
 *  - IL: IA, KY, MI, WI.
 *  - IN: KY, MI, OH, PA, WI.
 *  - KY: IL, IN, MI, OH, VA (commuter-only), WV, WI.
 *  - MD: DC, PA, VA, WV.
 *  - MI: IL, IN, KY, MN, OH, WI.
 *  - MN: MI, ND.
 *  - MT: ND.
 *  - ND: MN, MT.
 *  - OH: IN, KY, MI, PA, WV.
 *  - PA: IN, MD, NJ, OH, VA, WV.
 *  - VA: DC (commuter), KY, MD, PA, WV.
 *  - WV: KY, MD, OH, PA, VA.
 *  - WI: IL, IN, KY, MI.
 *  - DC: MD, VA (any non-resident).
 *
 * This is not exhaustive — California, New York, etc. have no reciprocity
 * and always tax non-resident wages at the work-state rate.
 */

const RECIPROCITY: Record<string, Set<string>> = {
  IL: new Set(['IA', 'KY', 'MI', 'WI']),
  IN: new Set(['KY', 'MI', 'OH', 'PA', 'WI']),
  KY: new Set(['IL', 'IN', 'MI', 'OH', 'VA', 'WV', 'WI']),
  MD: new Set(['DC', 'PA', 'VA', 'WV']),
  MI: new Set(['IL', 'IN', 'KY', 'MN', 'OH', 'WI']),
  MN: new Set(['MI', 'ND']),
  MT: new Set(['ND']),
  ND: new Set(['MN', 'MT']),
  NJ: new Set(['PA']),
  OH: new Set(['IN', 'KY', 'MI', 'PA', 'WV']),
  PA: new Set(['IN', 'MD', 'NJ', 'OH', 'VA', 'WV']),
  VA: new Set(['DC', 'KY', 'MD', 'PA', 'WV']),
  WV: new Set(['KY', 'MD', 'OH', 'PA', 'VA']),
  WI: new Set(['IL', 'IN', 'KY', 'MI']),
  DC: new Set(['MD', 'VA']),
};

/** True when an employee living in `home` working in `work` can elect home-state withholding. */
export function hasReciprocity(home: string, work: string): boolean {
  const allowed = RECIPROCITY[work];
  return !!allowed && allowed.has(home);
}

/**
 * Resolve which state's income tax should be withheld for an employee
 * given home + work state codes. Returns null when no state applies (e.g.,
 * states with no income tax like TX/FL/WA/NV; caller is expected to
 * simply skip state withholding in that case).
 */
export function resolveWithholdingState(home: string | null | undefined, work: string | null | undefined): string | null {
  if (!work && !home) return null;
  if (!work) return home ?? null;
  if (!home) return work;
  if (home === work) return work;
  return hasReciprocity(home, work) ? home : work;
}
