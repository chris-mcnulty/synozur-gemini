/**
 * Tax filing artifact generators for Gemini Payroll.
 *
 * Produces HTML for printable forms (941 quarterly + Schedule B) and CSV
 * for annual filings (W-2 box totals, W-3 transmittal summary, 1099-NEC).
 * These are NOT IRS-filing-ready PDFs — they're accountant-input
 * artifacts. Accountants paste totals into their filing software (Drake,
 * Lacerte, CCH, ProSystem fx). For direct e-filing, see
 * `tax-forms-efile.ts` (SSA EFW2 for W-2/W-3, IRS FIRE for 1099-NEC).
 *
 * All cent inputs are integer cents; dollar formatting happens here.
 */

const usd = (cents: number) => (cents / 100).toFixed(2);

// Neutralize CSV cells against spreadsheet formula injection. Excel and
// Google Sheets treat values starting with =, +, -, @, or a leading TAB/CR
// as formulas. Prefixing with a single apostrophe (which the spreadsheet
// strips on render) defangs them while keeping the visible text intact.
const csvEsc = (v: any) => {
  let s = v == null ? '' : String(v);
  if (s.length > 0 && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// HTML-escape a value before interpolating it into the 941 template so
// tenant-supplied data (name, EIN) can't inject markup or scripts into
// the printable form opened in an admin's browser.
const htmlEsc = (v: any) => {
  const s = v == null ? '' : String(v);
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

export interface TaxTotalsInput {
  window: { startDate: string; endDate: string };
  totals: {
    fedIncomeTaxWithheldCents: number;
    ssWagesCents: number;
    medicareWagesCents: number;
    employerSsCents: number;
    employerMedicareCents: number;
  };
  w2Employees: Array<{
    employeeId: string;
    name: string;
    email: string | null;
    grossCents: number;
    taxableWagesCents: number;
    fedIncomeTaxCents: number;
    ssWagesCents: number;
    // Actual withheld amounts pulled from the run breakdown. ssTaxCents
    // and medicareTaxCents come from the 'Social Security' / 'Medicare'
    // lines on each run item; additionalMedicareTaxCents tracks the
    // 0.9% surcharge applied above the $200K single / $250K MFJ threshold.
    // Sourcing from the breakdown (instead of recomputing rate × wages)
    // keeps the totals consistent with what was actually deposited and
    // handles SS cap behavior + rounding correctly.
    ssTaxCents: number;
    medicareWagesCents: number;
    medicareTaxCents: number;
    additionalMedicareTaxCents: number;
    netPayCents: number;
    // Box 10 — dependent-care FSA total. Sourced from deductions tagged
    // with benefitCategory='fsa_dependent_care' in the run breakdown.
    // Box 10 is its own W-2 box, NOT a Box 12 code, so it lives on its
    // own field (and gets summed into the EFW2 RT total record).
    dependentCareCents?: number;
    // W-2 Box 12 totals for the year, keyed by IRS code letter (W = HSA,
    // D = 401(k), AA = Roth 401(k), DD = employer-sponsored health cost,
    // E = 403(b), G = 457, S = SIMPLE). Aggregated from box12Code stamped
    // on deduction lines in the run breakdown. Empty {} for legacy data
    // where deductions don't yet carry a code.
    box12?: Record<string, number>;
  }>;
  form1099Recipients: Array<{
    employeeId: string;
    name: string;
    email: string | null;
    grossCents: number;
  }>;
}

export interface ScheduleBDay {
  date: string;
  liabilityCents: number;
}

/**
 * Render the 941 quarterly return as a printable HTML page. Layout
 * follows the form's logical sections but doesn't try to match the IRS
 * PDF pixel-for-pixel — accountants take the numbers, not the page.
 */
export function render941Html(opts: {
  tenantName: string;
  ein?: string;
  quarter: number;
  year: number;
  totals: TaxTotalsInput['totals'];
  w2EmployeeCount: number;
  scheduleB?: ScheduleBDay[];
}): string {
  const { tenantName, ein, quarter, year, totals, w2EmployeeCount, scheduleB } = opts;
  // Form 941 line items (simplified mapping):
  //   2  Wages, tips, other comp     = ssWages (use Medicare wages for accuracy)
  //   3  Federal income tax withheld = fedIncomeTaxWithheldCents
  //   5a Taxable SS wages            * 12.4% (employee + employer combined)
  //   5c Taxable Medicare wages      * 2.9%
  //   6  Total taxes before adjust.  = 3 + 5a + 5c
  //   10 Total taxes after adjust.   = line 6 (no adjustments modeled)
  //   12 Total taxes after credits   = line 10
  //   13 Total deposits              = same as line 12 (assume fully paid)
  const ssTaxTotal = Math.round(totals.ssWagesCents * 0.124);
  const medicareTaxTotal = Math.round(totals.medicareWagesCents * 0.029);
  const totalTaxes = totals.fedIncomeTaxWithheldCents + ssTaxTotal + medicareTaxTotal;

  const safeTenant = htmlEsc(tenantName);
  const safeEin = ein ? htmlEsc(ein) : '';
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Form 941 ${year} Q${quarter} — ${safeTenant}</title>
<style>
  @page { size: letter; margin: 0.5in; }
  body { font-family: 'Avenir Next LT Pro', Arial, sans-serif; font-size: 11pt; color: #111; }
  h1 { font-size: 16pt; margin: 0 0 4px; }
  .meta { color: #666; margin-bottom: 18px; font-size: 9.5pt; }
  table.lines { border-collapse: collapse; width: 100%; margin-top: 12px; }
  table.lines th, table.lines td { border: 1px solid #ccc; padding: 6px 8px; }
  table.lines th { background: #f5f5f5; text-align: left; font-weight: 600; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  .totals { font-weight: 600; background: #fafafa; }
  .stamp { color: #b91c1c; font-size: 9pt; margin-top: 18px; }
  table.schb { border-collapse: collapse; width: 100%; margin-top: 18px; font-size: 9.5pt; }
  table.schb th, table.schb td { border: 1px solid #ddd; padding: 4px 6px; }
</style></head>
<body>
  <h1>Form 941 — Employer's Quarterly Federal Tax Return</h1>
  <div class="meta">${safeTenant}${safeEin ? ` · EIN ${safeEin}` : ''} · ${year} Quarter ${quarter}</div>

  <table class="lines">
    <tr><th>Line</th><th>Description</th><th class="num">Amount</th></tr>
    <tr><td>1</td><td>Number of employees</td><td class="num">${w2EmployeeCount}</td></tr>
    <tr><td>2</td><td>Wages, tips, and other compensation</td><td class="num">$${usd(totals.medicareWagesCents)}</td></tr>
    <tr><td>3</td><td>Federal income tax withheld</td><td class="num">$${usd(totals.fedIncomeTaxWithheldCents)}</td></tr>
    <tr><td>5a</td><td>Taxable Social Security wages × 12.4%</td><td class="num">$${usd(ssTaxTotal)}</td></tr>
    <tr><td>5c</td><td>Taxable Medicare wages × 2.9%</td><td class="num">$${usd(medicareTaxTotal)}</td></tr>
    <tr class="totals"><td>6</td><td>Total taxes before adjustments</td><td class="num">$${usd(totalTaxes)}</td></tr>
    <tr class="totals"><td>10</td><td>Total taxes after adjustments</td><td class="num">$${usd(totalTaxes)}</td></tr>
    <tr class="totals"><td>12</td><td>Total taxes after credits</td><td class="num">$${usd(totalTaxes)}</td></tr>
    <tr><td>13</td><td>Total deposits this quarter (assumed)</td><td class="num">$${usd(totalTaxes)}</td></tr>
  </table>

  ${scheduleB && scheduleB.length > 0 ? `
  <h2 style="font-size:13pt;margin-top:24px">Schedule B — Daily Tax Liability</h2>
  <table class="schb">
    <tr><th>Pay date</th><th class="num">Liability</th></tr>
    ${scheduleB.map(d => `<tr><td>${htmlEsc(d.date)}</td><td class="num">$${usd(d.liabilityCents)}</td></tr>`).join('')}
    <tr class="totals"><td>Quarter total</td><td class="num">$${usd(scheduleB.reduce((s, d) => s + d.liabilityCents, 0))}</td></tr>
  </table>
  ` : ''}

  <p class="stamp">DRAFT — totals derived from Gemini Payroll finalized runs. Verify against IRS publications and your bank deposit history before filing.</p>
</body></html>`;
}

// Box 12 codes that the W-2 CSV surfaces as dedicated columns. Picked to
// cover the codes the payroll engine can produce today (HSA, 401(k) family,
// employer-sponsored health aggregate). Any other Box 12 code on a
// deduction shows up in the 'Box 12 - other' column as code:amount pairs.
const BOX12_PRIMARY_CODES = ['W', 'D', 'AA', 'DD'] as const;

/** W-2 box totals as CSV. One row per W-2 employee for the calendar year.
 *  Box 4 / Box 6 come from the YTD actual withholdings stamped on each
 *  run-item breakdown — wages × 6.2% / 1.45% would miss the Social
 *  Security cap, rounding drift, and the 0.9% Additional Medicare
 *  surcharge (which folds into Box 6 per IRS Pub 15). Box 10 carries
 *  the year's dependent-care FSA total. */
export function renderW2Csv(input: TaxTotalsInput): string {
  const header = [
    'Employee ID', 'Name', 'Email',
    'Box 1 - Wages',
    'Box 2 - Fed Income Tax',
    'Box 3 - SS Wages',
    'Box 4 - SS Tax (actual)',
    'Box 5 - Medicare Wages',
    'Box 6 - Medicare Tax (actual + add\'l)',
    'Box 10 - Dependent Care',
    'Box 12 W - HSA',
    'Box 12 D - 401(k)',
    'Box 12 AA - Roth 401(k)',
    'Box 12 DD - Employer Health',
    'Box 12 - Other',
  ].join(',');
  const rows = input.w2Employees.map(e => {
    const b12 = e.box12 ?? {};
    const other = Object.entries(b12)
      .filter(([code]) => !BOX12_PRIMARY_CODES.includes(code as any))
      .map(([code, cents]) => `${code}:${usd(cents)}`)
      .join('; ');
    // Box 6 = regular Medicare + Additional Medicare (0.9% surcharge above
    // $200K single / $250K MFJ). Both come from the run breakdown.
    const box6 = e.medicareTaxCents + (e.additionalMedicareTaxCents ?? 0);
    return [
      e.employeeId, e.name, e.email ?? '',
      usd(e.taxableWagesCents),
      usd(e.fedIncomeTaxCents),
      usd(e.ssWagesCents),
      usd(e.ssTaxCents),
      usd(e.medicareWagesCents),
      usd(box6),
      usd(e.dependentCareCents ?? 0),
      usd(b12.W ?? 0),
      usd(b12.D ?? 0),
      usd(b12.AA ?? 0),
      usd(b12.DD ?? 0),
      other,
    ].map(csvEsc).join(',');
  });
  return [header, ...rows].join('\n');
}

/**
 * W-3 transmittal summary (one row). The W-3 totals across all W-2s for
 * the year; this is the data that goes on the cover sheet sent to SSA.
 * Tax totals come from the run-breakdown actuals — recomputing
 * wages × rate would miss the Social Security cap, rounding drift, and
 * the 0.9% Add'l Medicare surcharge, and would make W-3 disagree with
 * the underlying W-2 rows.
 */
export function renderW3Csv(input: TaxTotalsInput): string {
  const totals = input.w2Employees.reduce((acc, e) => ({
    box1: acc.box1 + e.taxableWagesCents,
    box2: acc.box2 + e.fedIncomeTaxCents,
    box3: acc.box3 + e.ssWagesCents,
    box4: acc.box4 + e.ssTaxCents,
    box5: acc.box5 + e.medicareWagesCents,
    // Box 6 includes Additional Medicare per IRS Pub 15 — it's still
    // Medicare tax on the W-2/W-3.
    box6: acc.box6 + e.medicareTaxCents + (e.additionalMedicareTaxCents ?? 0),
    count: acc.count + 1,
  }), { box1: 0, box2: 0, box3: 0, box4: 0, box5: 0, box6: 0, count: 0 });
  return [
    'Field,Amount',
    `Number of W-2s,${totals.count}`,
    `Box 1 - Total Wages,${usd(totals.box1)}`,
    `Box 2 - Total Fed Income Tax,${usd(totals.box2)}`,
    `Box 3 - Total SS Wages,${usd(totals.box3)}`,
    `Box 4 - Total SS Tax,${usd(totals.box4)}`,
    `Box 5 - Total Medicare Wages,${usd(totals.box5)}`,
    `Box 6 - Total Medicare Tax,${usd(totals.box6)}`,
  ].join('\n');
}

/** 1099-NEC box totals as CSV. One row per 1099 recipient for the year. */
export function render1099NecCsv(input: TaxTotalsInput): string {
  const header = ['Recipient ID', 'Name', 'Email', 'Box 1 - Nonemployee Compensation'].join(',');
  const rows = input.form1099Recipients.map(r => [
    r.employeeId, r.name, r.email ?? '', usd(r.grossCents),
  ].map(csvEsc).join(','));
  return [header, ...rows].join('\n');
}
