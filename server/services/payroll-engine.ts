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
}

export interface PayrollLine {
  category: string;
  label: string;
  amountCents: number;
}

export interface PayrollEngineResult {
  grossCents: number;
  preTaxDeductionCents: number;
  taxableWagesCents: number;
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
      employeeTaxCents: 0,
      employerTaxCents: 0,
      postTaxDeductionCents: 0,
      netPayCents: grossCents,
      lines,
    };
  }

  // Pre-tax deductions reduce taxable wages (e.g., 401k, HSA, pre-tax health).
  let preTaxCents = 0;
  for (const d of inp.deductions.filter(x => x.isActive && x.deductionType === 'pre_tax')) {
    const amt = d.amountCents ?? (d.percentOfGross ? pctOfCents(grossCents, Number(d.percentOfGross)) : 0);
    if (amt > 0) {
      preTaxCents += amt;
      lines.push({ category: 'pre_tax_deduction', label: d.name, amountCents: -amt });
    }
  }
  const taxableWages = Math.max(0, grossCents - preTaxCents);

  // ---- Federal income tax withholding (annualized brackets) ----
  const periods = PERIODS_PER_YEAR[inp.schedule.frequency] ?? 26;
  const annualTaxable = taxableWages * periods - (inp.employee.w4DeductionsCents ?? 0);
  const brackets = inp.employee.filingStatus === 'married_jointly' ? FED_BRACKETS_MARRIED : FED_BRACKETS_SINGLE;
  const annualFed = Math.max(0, applyBrackets(annualTaxable, brackets) - (inp.employee.w4DependentsAmountCents ?? 0));
  const fedWithholding = Math.round(annualFed / periods) + (inp.employee.w4ExtraWithholdingCents ?? 0);
  if (fedWithholding > 0) lines.push({ category: 'employee_tax', label: 'Federal income tax', amountCents: -fedWithholding });

  // ---- FICA: Social Security + Medicare (employee side) ----
  const ssWageBasePerPeriod = Math.round(SS_WAGE_BASE_CENTS / periods);
  const ssWages = Math.min(taxableWages, ssWageBasePerPeriod);
  const employeeSS = pctOfCents(ssWages, SS_RATE_PCT);
  const employeeMedicare = pctOfCents(taxableWages, MEDICARE_RATE_PCT);
  const employeeAddlMedicare = taxableWages * periods > MEDICARE_ADDL_THRESHOLD_CENTS
    ? pctOfCents(taxableWages, MEDICARE_ADDL_RATE_PCT)
    : 0;
  if (employeeSS) lines.push({ category: 'employee_tax', label: 'Social Security', amountCents: -employeeSS });
  if (employeeMedicare) lines.push({ category: 'employee_tax', label: 'Medicare', amountCents: -employeeMedicare });
  if (employeeAddlMedicare) lines.push({ category: 'employee_tax', label: 'Add’l Medicare', amountCents: -employeeAddlMedicare });

  // ---- State / local tax (rule-driven, stubbed) ----
  let stateLocalEmployeeTax = 0;
  for (const j of inp.jurisdictions.filter(x => x.isActive && (x.level === 'state' || x.level === 'local'))) {
    const rule = j.rule || {};
    if (rule.kind === 'flat_percent' && typeof rule.employeePct === 'number') {
      const t = pctOfCents(taxableWages, rule.employeePct);
      if (t > 0) {
        stateLocalEmployeeTax += t;
        lines.push({ category: 'employee_tax', label: `${j.name} (${j.code})`, amountCents: -t });
      }
    }
    // TODO: implement bracket-based state withholding (CA DE-4, NY IT-2104, etc.)
    // TODO: implement local taxes (NYC, Philadelphia BIRT, school district taxes)
  }

  const employeeTaxCents = fedWithholding + employeeSS + employeeMedicare + employeeAddlMedicare + stateLocalEmployeeTax;

  // ---- Employer-side taxes (do not reduce net pay; tracked for liability/GL) ----
  const employerSS = pctOfCents(ssWages, SS_RATE_PCT);
  const employerMedicare = pctOfCents(taxableWages, MEDICARE_RATE_PCT);
  // FUTA: 6% on first $7,000 wages, but most employers get 5.4% credit → 0.6%.
  const futa = pctOfCents(Math.min(taxableWages, Math.round(700000 / periods)), 0.6);
  // TODO: state unemployment (SUTA) by jurisdiction.
  let employerStateLocal = 0;
  for (const j of inp.jurisdictions.filter(x => x.isActive)) {
    const rule = j.rule || {};
    if (rule.kind === 'flat_percent' && typeof rule.employerPct === 'number') {
      employerStateLocal += pctOfCents(taxableWages, rule.employerPct);
    }
  }
  const employerTaxCents = employerSS + employerMedicare + futa + employerStateLocal;
  if (employerSS) lines.push({ category: 'employer_tax', label: 'Employer SS', amountCents: employerSS });
  if (employerMedicare) lines.push({ category: 'employer_tax', label: 'Employer Medicare', amountCents: employerMedicare });
  if (futa) lines.push({ category: 'employer_tax', label: 'FUTA', amountCents: futa });
  if (employerStateLocal) lines.push({ category: 'employer_tax', label: 'Employer state/local', amountCents: employerStateLocal });

  // ---- Post-tax deductions and garnishments ----
  let postTaxCents = 0;
  for (const d of inp.deductions.filter(x => x.isActive && (x.deductionType === 'post_tax' || x.deductionType === 'garnishment'))) {
    const amt = d.amountCents ?? (d.percentOfGross ? pctOfCents(grossCents, Number(d.percentOfGross)) : 0);
    if (amt > 0) {
      postTaxCents += amt;
      lines.push({ category: d.deductionType, label: d.name, amountCents: -amt });
    }
  }

  // Employer-match deductions are tracked but don't affect employee net pay.
  for (const d of inp.deductions.filter(x => x.isActive && x.deductionType === 'employer_match')) {
    const amt = d.employerMatchCents ?? (d.employerMatchPercent ? pctOfCents(grossCents, Number(d.employerMatchPercent)) : 0);
    if (amt > 0) {
      lines.push({ category: 'employer_match', label: `Employer match: ${d.name}`, amountCents: amt });
    }
  }

  const netPayCents = Math.max(0, grossCents - preTaxCents - employeeTaxCents - postTaxCents);
  lines.push({ category: 'net_pay', label: 'Net pay', amountCents: netPayCents });

  return {
    grossCents,
    preTaxDeductionCents: preTaxCents,
    taxableWagesCents: taxableWages,
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
