/**
 * Gemini Payroll Engine — deterministic gross→net calculator.
 *
 * Design principles:
 *  - All amounts are integer cents. No floating-point arithmetic touches money.
 *  - Pure functions: same inputs always produce identical outputs.
 *  - Tax rules are interpreted from a structured `rule` jsonb on
 *    payroll_tax_jurisdictions, so federal / state / local can evolve
 *    independently without code changes (TODO: full state matrix).
 *  - Federal withholding here uses 2024 IRS Pub 15-T-style annualized
 *    bracket math, but with simplified brackets for the Phase 1 stub.
 *    DO NOT rely on this for real tax filings — see TODOs.
 */

import type {
  PayrollEmployee,
  PayrollCompensation,
  PayrollDeduction,
  PayrollPaySchedule,
  PayrollTaxJurisdiction,
} from "@shared/schema";
import { resolveWithholdingState } from "./reciprocity";

export interface PayrollEngineInputs {
  employee: PayrollEmployee;
  compensation: PayrollCompensation | null;
  schedule: PayrollPaySchedule;
  deductions: PayrollDeduction[];
  jurisdictions: PayrollTaxJurisdiction[];
  hoursWorked: number;
  overtimeHours: number;
  ptoHoursUsed: number;
  bonusCents: number;
  commissionCents: number;
  retroPayCents: number;
  // Accountable-plan expense reimbursements (Constellation expenses).
  // Added to net pay AFTER tax math; NEVER part of gross. Default 0.
  reimbursementCents?: number;
  // YTD accumulators (cents) — sums of taxable wages from finalized runs in
  // the same calendar year, EXCLUDING the current period. Used to apply true
  // YTD caps for SS wage base, additional Medicare threshold, and FUTA cap.
  // Default to 0 (treat as first run of the year) when omitted.
  ytdSsWagesCents?: number;
  ytdMedicareWagesCents?: number;
  ytdFutaWagesCents?: number;
}

export interface PayrollLine {
  category: string;
  label: string;
  amountCents: number;
  // W-2 Box 12 code stamped onto pre-tax / post-tax deduction lines whose
  // underlying payroll_deductions row carries one (W = HSA, D = 401(k)
  // traditional, AA = Roth 401(k), etc.). Lets `taxTotals` aggregate Box 12
  // totals per employee per year without re-loading deduction rows.
  box12Code?: string;
  benefitCategory?: string;
}

export interface PayrollEngineResult {
  grossCents: number;
  preTaxDeductionCents: number;
  taxableWagesCents: number;
  // Wages subject to FICA + FUTA (gross minus Section 125 deductions only —
  // 401(k) traditional deferrals are still FICA-taxable). Persisted on the
  // run item so YTD caps + W-2 Box 5 don't have to re-derive it.
  ficaTaxableWagesCents: number;
  employeeTaxCents: number;
  employerTaxCents: number;
  postTaxDeductionCents: number;
  netPayCents: number;
  lines: PayrollLine[];
}

const PERIODS_PER_YEAR: Record<string, number> = {
  weekly: 52,
  biweekly: 26,
  semimonthly: 24,
  monthly: 12,
};

// ---------------------------------------------------------------------------
// Stubbed federal withholding brackets (2024 single, annualized).
// TODO: replace with full IRS Pub 15-T tables (single, MFJ, HoH, multiple-jobs).
// ---------------------------------------------------------------------------
interface Bracket { upToCents: number | null; ratePct: number; baseCents: number; }

const FED_BRACKETS_SINGLE: Bracket[] = [
  { upToCents: 1160000,  ratePct: 10, baseCents: 0 },
  { upToCents: 4715000,  ratePct: 12, baseCents: 116000 },
  { upToCents: 10037500, ratePct: 22, baseCents: 542600 },
  { upToCents: 19167500, ratePct: 24, baseCents: 1713550 },
  { upToCents: 24372500, ratePct: 32, baseCents: 3904750 },
  { upToCents: 60937500, ratePct: 35, baseCents: 5570350 },
  { upToCents: null,     ratePct: 37, baseCents: 18367600 },
];

const FED_BRACKETS_MARRIED: Bracket[] = [
  { upToCents: 2320000,  ratePct: 10, baseCents: 0 },
  { upToCents: 9430000,  ratePct: 12, baseCents: 232000 },
  { upToCents: 20075000, ratePct: 22, baseCents: 1085200 },
  { upToCents: 38335000, ratePct: 24, baseCents: 3427100 },
  { upToCents: 48745000, ratePct: 32, baseCents: 7809500 },
  { upToCents: 73095000, ratePct: 35, baseCents: 11140700 },
  { upToCents: null,     ratePct: 37, baseCents: 19663200 },
];

// 2024 head-of-household income tax brackets (annualized, cents).
const FED_BRACKETS_HOH: Bracket[] = [
  { upToCents: 1660000,  ratePct: 10, baseCents: 0 },
  { upToCents: 6320000,  ratePct: 12, baseCents: 166000 },
  { upToCents: 10050000, ratePct: 22, baseCents: 725200 },
  { upToCents: 19180000, ratePct: 24, baseCents: 1546800 },
  { upToCents: 24385000, ratePct: 32, baseCents: 3738000 },
  { upToCents: 60935000, ratePct: 35, baseCents: 5403600 },
  { upToCents: null,     ratePct: 37, baseCents: 18195100 },
];

// 2024 standard deductions (cents). Subtracted from annual wages before
// applying the income-tax brackets, matching IRS Pub 15-T Worksheet 1A.
// When W-4 Step 2(c) (multiple jobs / spouse works) is checked, only half
// the standard deduction applies because both jobs are sharing it.
const STD_DEDUCTION_CENTS: Record<string, number> = {
  single: 1460000,
  married_jointly: 2920000,
  head_of_household: 2190000,
};

// Social Security: 6.2% employee + 6.2% employer, wage base 2024 = $168,600.
const SS_RATE_PCT = 6.2;
const SS_WAGE_BASE_CENTS = 16860000;
// Medicare: 1.45% each side. Plus 0.9% additional employee surtax > $200k single.
const MEDICARE_RATE_PCT = 1.45;
const MEDICARE_ADDL_THRESHOLD_CENTS = 20000000;
const MEDICARE_ADDL_RATE_PCT = 0.9;

function pctOfCents(cents: number, pct: number): number {
  // Integer-cent percentage with banker-safe rounding (round half away from zero).
  const sign = cents < 0 ? -1 : 1;
  const v = Math.abs(cents) * pct;
  return sign * Math.round(v / 100);
}

function applyBrackets(annualTaxableCents: number, brackets: Bracket[]): number {
  if (annualTaxableCents <= 0) return 0;
  for (const b of brackets) {
    if (b.upToCents === null || annualTaxableCents <= b.upToCents) {
      const prev = brackets[brackets.indexOf(b) - 1];
      const prevCap = prev?.upToCents ?? 0;
      return b.baseCents + pctOfCents(annualTaxableCents - prevCap, b.ratePct);
    }
  }
  return 0;
}

function periodGrossFromComp(
  comp: PayrollCompensation | null,
  schedule: PayrollPaySchedule,
  hours: number,
  overtimeHours: number,
  ptoHours: number,
): number {
  if (!comp) return 0;
  const periods = PERIODS_PER_YEAR[schedule.frequency] ?? 26;
  if (comp.compType === 'salary') {
    // Salary periodized; PTO is paid at salary rate (no add'l).
    return Math.round(comp.amountCents / periods);
  }
  if (comp.compType === 'hourly') {
    const base = comp.amountCents * (hours + ptoHours);
    const ot = comp.amountCents * overtimeHours * 1.5;
    return Math.round(base + ot);
  }
  // commission/bonus baseline 0 — actual amounts come from per-run inputs.
  return 0;
}

export function computePayroll(inp: PayrollEngineInputs): PayrollEngineResult {
  const lines: PayrollLine[] = [];

  const baseGross = periodGrossFromComp(
    inp.compensation, inp.schedule,
    inp.hoursWorked, inp.overtimeHours, inp.ptoHoursUsed,
  );
  const grossCents = baseGross + inp.bonusCents + inp.commissionCents + inp.retroPayCents;

  if (baseGross > 0) lines.push({ category: 'wages', label: 'Regular wages', amountCents: baseGross });
  if (inp.bonusCents) lines.push({ category: 'wages', label: 'Bonus', amountCents: inp.bonusCents });
  if (inp.commissionCents) lines.push({ category: 'wages', label: 'Commission', amountCents: inp.commissionCents });
  if (inp.retroPayCents) lines.push({ category: 'wages', label: 'Retro pay', amountCents: inp.retroPayCents });

  // 1099 contractors — no withholding, no employer tax. Just gross = net.
  if (inp.employee.employeeType === '1099') {
    lines.push({ category: 'net_pay', label: 'Net pay (1099)', amountCents: grossCents });
    return {
      grossCents,
      preTaxDeductionCents: 0,
      taxableWagesCents: grossCents,
      // 1099 wages are not FICA-taxable, so the FICA wage base is 0 even
      // though grossCents is the 1099 payment amount.
      ficaTaxableWagesCents: 0,
      employeeTaxCents: 0,
      employerTaxCents: 0,
      postTaxDeductionCents: 0,
      netPayCents: grossCents,
      lines,
    };
  }

  // Pre-tax deductions reduce taxable wages, but the SCOPE depends on the
  // tax wrapper. Section 125 cafeteria deductions (preTaxScope='all') are
  // exempt from federal income tax + FICA + FUTA. 401(k) traditional
  // (preTaxScope='federal_only') is exempt from federal income tax only;
  // FICA and FUTA still tax the deferral. We track both buckets so the
  // FICA wage base is computed correctly.
  let preTaxAllCents = 0;       // exempt from everything
  let preTaxFedOnlyCents = 0;   // exempt from federal income tax only
  for (const d of inp.deductions.filter(x => x.isActive && x.deductionType === 'pre_tax')) {
    const amt = d.amountCents ?? (d.percentOfGross ? pctOfCents(grossCents, Number(d.percentOfGross)) : 0);
    if (amt > 0) {
      // Default to 'all' for back-compat with rows that predate preTaxScope.
      const scope = (d as any).preTaxScope ?? 'all';
      if (scope === 'all') preTaxAllCents += amt;
      else preTaxFedOnlyCents += amt;
      lines.push({
        category: 'pre_tax_deduction',
        label: d.name,
        amountCents: -amt,
        box12Code: (d as any).box12Code ?? undefined,
        benefitCategory: (d as any).benefitCategory ?? undefined,
      });
    }
  }
  const preTaxCents = preTaxAllCents + preTaxFedOnlyCents;
  const federalTaxableWages = Math.max(0, grossCents - preTaxAllCents - preTaxFedOnlyCents);
  const ficaTaxableWages = Math.max(0, grossCents - preTaxAllCents);

  // ---- Federal income tax withholding (annualized brackets) ----
  const periods = PERIODS_PER_YEAR[inp.schedule.frequency] ?? 26;
  // Subtract the standard deduction for the filing status (halved when the
  // W-4 Step 2(c) multi-jobs checkbox is set — per IRS Pub 15-T).
  const stdDed = STD_DEDUCTION_CENTS[inp.employee.filingStatus ?? 'single'] ?? STD_DEDUCTION_CENTS.single;
  const effectiveStdDed = inp.employee.w4MultipleJobs ? Math.round(stdDed / 2) : stdDed;
  const annualWages = federalTaxableWages * periods + (inp.employee.w4OtherIncomeCents ?? 0);
  const annualTaxable = Math.max(
    0,
    annualWages - effectiveStdDed - (inp.employee.w4DeductionsCents ?? 0),
  );
  const brackets = inp.employee.filingStatus === 'married_jointly' ? FED_BRACKETS_MARRIED
    : inp.employee.filingStatus === 'head_of_household' ? FED_BRACKETS_HOH
    : FED_BRACKETS_SINGLE;
  const annualFed = Math.max(0, applyBrackets(annualTaxable, brackets) - (inp.employee.w4DependentsAmountCents ?? 0));
  const fedWithholding = Math.round(annualFed / periods) + (inp.employee.w4ExtraWithholdingCents ?? 0);
  if (fedWithholding > 0) lines.push({ category: 'employee_tax', label: 'Federal income tax', amountCents: -fedWithholding });

  // ---- FICA: Social Security + Medicare (employee side) ----
  // FICA wage base = gross minus Section 125 only (401(k) deferrals still
  // get FICA-taxed). YTD caps prevent double-charging when an employee
  // crosses a threshold mid-year.
  const ytdSs = inp.ytdSsWagesCents ?? 0;
  const ssRemaining = Math.max(0, SS_WAGE_BASE_CENTS - ytdSs);
  const ssWages = Math.min(ficaTaxableWages, ssRemaining);
  const employeeSS = pctOfCents(ssWages, SS_RATE_PCT);
  const employeeMedicare = pctOfCents(ficaTaxableWages, MEDICARE_RATE_PCT);
  const ytdMedicare = inp.ytdMedicareWagesCents ?? 0;
  const newMedicareYtd = ytdMedicare + ficaTaxableWages;
  const addlMedicareWages = newMedicareYtd > MEDICARE_ADDL_THRESHOLD_CENTS
    ? Math.min(ficaTaxableWages, newMedicareYtd - MEDICARE_ADDL_THRESHOLD_CENTS)
    : 0;
  const employeeAddlMedicare = addlMedicareWages > 0
    ? pctOfCents(addlMedicareWages, MEDICARE_ADDL_RATE_PCT)
    : 0;
  if (employeeSS) lines.push({ category: 'employee_tax', label: 'Social Security', amountCents: -employeeSS });
  if (employeeMedicare) lines.push({ category: 'employee_tax', label: 'Medicare', amountCents: -employeeMedicare });
  if (employeeAddlMedicare) lines.push({ category: 'employee_tax', label: 'Add’l Medicare', amountCents: -employeeAddlMedicare });

  // ---- State / local tax (rule-driven; flat + brackets) ----
  // State withholding bases on the federal taxable wage base, since most
  // states piggy-back on federal AGI conventions (CA, NY, etc.).
  //
  // Reciprocity: when an employee lives in one state and works in another,
  // apply the resolved state (home if reciprocity exists, work otherwise).
  // Locals (NYC, Philly) follow the work state irrespective of reciprocity
  // because municipal taxes are jurisdictional, not residency-based.
  const withholdingState = resolveWithholdingState(inp.employee.homeStateCode, inp.employee.workStateCode);
  let stateLocalEmployeeTax = 0;
  for (const j of inp.jurisdictions.filter(x => x.isActive && (x.level === 'state' || x.level === 'local'))) {
    if (j.level === 'state') {
      // No resolved state means no state tax applies. This guards against
      // accidentally applying every active state jurisdiction to an employee
      // whose home + work states are both blank.
      const stateParent = (j.rule as any)?.parentState;
      if (stateParent) {
        // Sub-state codes like US-WA-PFML, US-WA-CARES use parentState
        // for matching. Wage premiums (PFML, Cares) follow work state, not
        // the reciprocity-resolved withholding state — they're tied to
        // where the employer paid the wages, not where the worker lives.
        if (!inp.employee.workStateCode) continue;
        if (stateParent !== inp.employee.workStateCode) continue;
      } else {
        if (!withholdingState) continue;
        if (j.code !== `US-${withholdingState}`) continue;
      }
    }
    if (j.level === 'local') {
      // Locals require a work state (municipal taxes are jurisdictional,
      // not residency-based). Without one we skip locals entirely so
      // an unspecified-location employee doesn't pick up NYC/Philly tax.
      if (!inp.employee.workStateCode) continue;
      const parent = (j.rule as any)?.parentState;
      if (parent && parent !== inp.employee.workStateCode) continue;
    }
    const rule = j.rule || {};
    if (rule.kind === 'flat_percent' && typeof rule.employeePct === 'number') {
      const t = pctOfCents(federalTaxableWages, rule.employeePct);
      if (t > 0) {
        stateLocalEmployeeTax += t;
        lines.push({ category: 'employee_tax', label: `${j.name} (${j.code})`, amountCents: -t });
      }
    } else if (rule.kind === 'wage_premium' && typeof rule.employeePct === 'number') {
      // Wage-premium employee portion (WA PFML, WA Cares). Uses FICA-taxable
      // wages (not federal-taxable) because PFML/Cares follow gross-with-Section-125
      // semantics, and respects an optional per-premium wage cap.
      const cap = typeof rule.wageBaseCents === 'number' ? rule.wageBaseCents : Infinity;
      const ytd = inp.ytdFutaWagesCents ?? 0;
      const remaining = Math.max(0, cap - ytd);
      const basis = Math.min(ficaTaxableWages, remaining);
      const t = pctOfCents(basis, rule.employeePct);
      if (t > 0) {
        stateLocalEmployeeTax += t;
        lines.push({ category: 'employee_tax', label: `${j.name} (${j.code})`, amountCents: -t });
      }
    } else if (rule.kind === 'brackets' && Array.isArray(rule.brackets)) {
      // Bracket-based: rule.brackets is [{upToCents, ratePct, baseCents}, ...]
      // annualized; rule.stdDeductionCents optionally subtracted first.
      const annual = federalTaxableWages * periods - (rule.stdDeductionCents ?? 0);
      const annualState = applyBrackets(Math.max(0, annual), rule.brackets as Bracket[]);
      const periodState = Math.round(annualState / periods);
      if (periodState > 0) {
        stateLocalEmployeeTax += periodState;
        lines.push({ category: 'employee_tax', label: `${j.name} (${j.code})`, amountCents: -periodState });
      }
    }
  }

  const employeeTaxCents = fedWithholding + employeeSS + employeeMedicare + employeeAddlMedicare + stateLocalEmployeeTax;

  // ---- Employer-side taxes (do not reduce net pay; tracked for liability/GL) ----
  const employerSS = pctOfCents(ssWages, SS_RATE_PCT);
  const employerMedicare = pctOfCents(ficaTaxableWages, MEDICARE_RATE_PCT);
  // FUTA: 6% on first $7,000 wages per employee per year (less 5.4% state
  // credit = 0.6%). Wage base same as FICA — Section 125 exempt, 401(k) not.
  const ytdFuta = inp.ytdFutaWagesCents ?? 0;
  const futaRemaining = Math.max(0, 700000 - ytdFuta);
  const futa = pctOfCents(Math.min(ficaTaxableWages, futaRemaining), 0.6);
  // SUTA per state: rule.kind='suta', rule.ratePct, rule.wageBaseCents.
  // Employer-only and ONLY for the employee's work state — otherwise a
  // single worker would be charged every seeded state's unemployment
  // (e.g., both CA and NY SUTA at once).
  let suta = 0;
  if (inp.employee.workStateCode) {
    const expectedSutaCode = `SUTA-${inp.employee.workStateCode}`;
    for (const j of inp.jurisdictions.filter(x => x.isActive && x.level === 'state' && x.code === expectedSutaCode)) {
      const rule = j.rule || {};
      if (rule.kind === 'suta' && typeof rule.ratePct === 'number' && typeof rule.wageBaseCents === 'number') {
        const remaining = Math.max(0, rule.wageBaseCents - ytdFuta); // approximate: re-uses FUTA YTD
        const sutaWages = Math.min(ficaTaxableWages, remaining);
        const t = pctOfCents(sutaWages, rule.ratePct);
        if (t > 0) {
          suta += t;
          lines.push({ category: 'employer_tax', label: `${j.name} SUTA`, amountCents: t });
        }
      }
    }
  }
  // Employer-side state/local wage premiums. Two rule kinds are supported:
  //   - flat_percent with employerPct (legacy)
  //   - wage_premium with employerPct (WA PFML and similar split premiums)
  // Both are scoped to the employee's work state — without scoping, a single
  // jurisdiction's employer portion would apply to every employee regardless
  // of where they work. Locals follow parentState the same way income-tax
  // locals do (NYC, Philly). wage_premium also supports its own wageBaseCents
  // cap, independent of FICA/FUTA.
  let employerStateLocal = 0;
  for (const j of inp.jurisdictions.filter(x => x.isActive && (x.level === 'state' || x.level === 'local'))) {
    const rule = j.rule || {};
    const parent = (rule as any).parentState as string | undefined;
    if (j.level === 'state') {
      if (!inp.employee.workStateCode) continue;
      if (parent) {
        if (parent !== inp.employee.workStateCode) continue;
      } else if (j.code !== `US-${inp.employee.workStateCode}`) {
        continue;
      }
    } else {
      if (!inp.employee.workStateCode) continue;
      if (parent && parent !== inp.employee.workStateCode) continue;
    }
    if (rule.kind === 'flat_percent' && typeof rule.employerPct === 'number') {
      const t = pctOfCents(ficaTaxableWages, rule.employerPct);
      if (t > 0) {
        employerStateLocal += t;
        lines.push({ category: 'employer_tax', label: `${j.name} (employer)`, amountCents: t });
      }
    } else if (rule.kind === 'wage_premium' && typeof rule.employerPct === 'number') {
      const cap = typeof rule.wageBaseCents === 'number' ? rule.wageBaseCents : Infinity;
      const ytd = inp.ytdFutaWagesCents ?? 0; // approximate cap-tracking; refines once a per-premium YTD lands
      const remaining = Math.max(0, cap - ytd);
      const basis = Math.min(ficaTaxableWages, remaining);
      const t = pctOfCents(basis, rule.employerPct);
      if (t > 0) {
        employerStateLocal += t;
        lines.push({ category: 'employer_tax', label: `${j.name} (employer)`, amountCents: t });
      }
    }
  }
  const employerTaxCents = employerSS + employerMedicare + futa + suta + employerStateLocal;
  if (employerSS) lines.push({ category: 'employer_tax', label: 'Employer SS', amountCents: employerSS });
  if (employerMedicare) lines.push({ category: 'employer_tax', label: 'Employer Medicare', amountCents: employerMedicare });
  if (futa) lines.push({ category: 'employer_tax', label: 'FUTA', amountCents: futa });

  // ---- Post-tax deductions and garnishments ----
  let postTaxCents = 0;
  for (const d of inp.deductions.filter(x => x.isActive && (x.deductionType === 'post_tax' || x.deductionType === 'garnishment'))) {
    // Box 12 stamp still applies to Roth 401(k) (post-tax, code AA) and a
    // few other post-tax retirement codes. Engine doesn't care which
    // letter — it just carries it through to the breakdown.
    const amt = d.amountCents ?? (d.percentOfGross ? pctOfCents(grossCents, Number(d.percentOfGross)) : 0);
    if (amt > 0) {
      postTaxCents += amt;
      lines.push({
        category: d.deductionType,
        label: d.name,
        amountCents: -amt,
        box12Code: (d as any).box12Code ?? undefined,
        benefitCategory: (d as any).benefitCategory ?? undefined,
      });
    }
  }

  // Employer-match deductions are tracked but don't affect employee net pay.
  for (const d of inp.deductions.filter(x => x.isActive && x.deductionType === 'employer_match')) {
    const amt = d.employerMatchCents ?? (d.employerMatchPercent ? pctOfCents(grossCents, Number(d.employerMatchPercent)) : 0);
    if (amt > 0) {
      lines.push({ category: 'employer_match', label: `Employer match: ${d.name}`, amountCents: amt });
    }
  }

  // Wages portion of net pay — what's actually taxable / on the W-2.
  const wagesNetCents = Math.max(0, grossCents - preTaxCents - employeeTaxCents - postTaxCents);
  // Accountable-plan reimbursements ride along to deposit but are not wages
  // and never reduce the gross calc. Surface them as a distinct line so the
  // paystub and audit log can split the bank-credit amount from the W-2
  // taxable wages.
  const reimbursementCents = inp.reimbursementCents ?? 0;
  if (reimbursementCents > 0) {
    lines.push({ category: 'reimbursement', label: 'Expense reimbursement (non-taxable)', amountCents: reimbursementCents });
  }
  const netPayCents = wagesNetCents + reimbursementCents;
  lines.push({ category: 'net_pay', label: 'Net pay', amountCents: netPayCents });

  return {
    grossCents,
    preTaxDeductionCents: preTaxCents,
    taxableWagesCents: federalTaxableWages,
    ficaTaxableWagesCents: ficaTaxableWages,
    employeeTaxCents,
    employerTaxCents,
    postTaxDeductionCents: postTaxCents,
    netPayCents,
    lines,
  };
}

/** Compute the next pay period for a schedule, given an anchor and frequency. */
export function nextPayPeriod(schedule: PayrollPaySchedule, after?: Date): { periodStart: Date; periodEnd: Date; payDate: Date } {
  const anchor = new Date(schedule.anchorPeriodStart + 'T00:00:00Z');
  const reference = after ? new Date(after.toISOString().slice(0, 10) + 'T00:00:00Z') : new Date();
  const day = 24 * 60 * 60 * 1000;

  let periodLengthDays = 14;
  if (schedule.frequency === 'weekly') periodLengthDays = 7;
  else if (schedule.frequency === 'biweekly') periodLengthDays = 14;
  else if (schedule.frequency === 'semimonthly') periodLengthDays = 15;
  else if (schedule.frequency === 'monthly') periodLengthDays = 30;

  const elapsed = Math.max(0, Math.floor((reference.getTime() - anchor.getTime()) / day));
  const periodsElapsed = Math.floor(elapsed / periodLengthDays);
  const periodStart = new Date(anchor.getTime() + periodsElapsed * periodLengthDays * day);
  const periodEnd = new Date(periodStart.getTime() + (periodLengthDays - 1) * day);
  const payDate = new Date(periodEnd.getTime() + (schedule.payDateOffsetDays || 0) * day);
  return { periodStart, periodEnd, payDate };
}
