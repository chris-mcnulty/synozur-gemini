/**
 * SSA EFW2 (W-2 e-file) and IRS FIRE 1099-NEC e-file generators.
 *
 * Output is fixed-width ASCII text — every record is a single line of an
 * exact length terminated by CR LF. Records are concatenated without any
 * blank lines between them.
 *
 *   - EFW2  (Specifications for Filing Forms W-2 Electronically): every
 *           record is 512 characters, CR LF terminator. Submitted via the
 *           SSA BSO (Business Services Online) portal.
 *   - FIRE  (Filing Information Returns Electronically): every record is
 *           750 characters, CR LF terminator. Submitted via the IRS FIRE
 *           system. 1099-NEC uses payment-amount code A (Box 1, NEC).
 *
 * This implementation produces files structured correctly per spec for the
 * majority of fields needed for a small filer. It is intended to be tested
 * first against the SSA AccuWage and IRS FIRE *test* systems before going
 * to production — there is no substitute for those validators catching the
 * remaining edge cases (state RS records, money-amount alignment quirks,
 * trailing-pad rules). Fields the filer must supply (BSO User ID, TCC, EIN)
 * are required inputs; we don't make up placeholders.
 */

const CRLF = '\r\n';

// --- low-level field formatters ---------------------------------------------

/** Right-pad ASCII text with spaces to exactly `width` chars. Truncates. */
function fText(value: string | null | undefined, width: number): string {
  const s = (value ?? '').replace(/[^\x20-\x7E]/g, ' ');
  if (s.length >= width) return s.slice(0, width);
  return s + ' '.repeat(width - s.length);
}

/** Left-pad numeric value with zeros. Negative numbers are zeroed (these
 *  formats can't carry sign in standard money-amount fields). */
function fNum(value: number | string | null | undefined, width: number): string {
  const n = typeof value === 'number' ? value : value == null ? 0 : Number(value);
  const v = Math.max(0, Math.floor(Math.abs(n)));
  const s = String(v);
  if (s.length >= width) return s.slice(-width); // overflow: take low digits (spec says zeros, but bigger problem to flag)
  return '0'.repeat(width - s.length) + s;
}

/** Money amount: integer cents, zero-padded to width. Pure cents, no decimal. */
const fMoney = (cents: number | null | undefined, width: number) => fNum(cents ?? 0, width);

/** Strip non-digits and zero-pad on the left for ID-style fields (SSN, EIN,
 *  ZIP, phone). SSA EFW2 and IRS FIRE require these as fixed-width digit
 *  strings, NOT space-padded — a phone or ZIP padded with spaces will fail
 *  AccuWage / FIRE validators. If the cleaned value is empty, returns an
 *  all-zero field of the requested width (still spec-compliant; absent ZIP
 *  Ext, for example, is "0000"). */
function fDigits(value: string | null | undefined, width: number): string {
  const d = String(value ?? '').replace(/\D/g, '');
  if (d.length >= width) return d.slice(0, width);
  return '0'.repeat(width - d.length) + d;
}

/** Optional-digit field: zero-pad when present, all spaces when truly
 *  absent. Use for fields like contact email or company-name-extension
 *  where a missing value should be blank rather than zero. */
function fOptDigits(value: string | null | undefined, width: number): string {
  const d = String(value ?? '').replace(/\D/g, '');
  if (d.length === 0) return ' '.repeat(width);
  if (d.length >= width) return d.slice(0, width);
  return '0'.repeat(width - d.length) + d;
}

/** 9-character ZIP for FIRE / EFW2 fields that pack ZIP5 + ZIP4 into one
 *  contiguous field. A bare 5-digit ZIP must occupy the first 5 chars; the
 *  remaining 4 are the +4 extension (zeros when absent). Using a generic
 *  zero-pad would shift a 5-digit ZIP to the right (e.g. "02139" →
 *  "000002139", turning the last four into the extension and corrupting
 *  the ZIP itself). */
function fZip9(zip: string | null | undefined): string {
  const d = String(zip ?? '').replace(/\D/g, '');
  if (d.length === 0) return ' '.repeat(9);
  const zip5 = d.slice(0, 5).padStart(5, '0');
  const ext = d.slice(5, 9);
  const ext4 = ext.length === 0 ? '0000' : ext.padEnd(4, '0');
  return zip5 + ext4;
}

/** Pad a single line out to `width` if shorter; truncate if longer. */
function pad(line: string, width: number): string {
  if (line.length === width) return line;
  if (line.length < width) return line + ' '.repeat(width - line.length);
  return line.slice(0, width);
}

// --- EFW2 (W-2 / W-3 e-file to SSA) -----------------------------------------

export interface Efw2Submitter {
  /** SSA-issued BSO User ID (8 chars, starts with a letter). REQUIRED. */
  userId: string;
  /** Submitter EIN (9 digits, no hyphen). REQUIRED. */
  ein: string;
  name: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  stateCode: string;     // 2-letter
  zip: string;           // 5 digits, optional +4
  contactName: string;
  contactPhone: string;  // digits only, 10
  contactEmail?: string;
  /** SSA-assigned software vendor code (4 chars). Optional — blank when
   *  the filer is using their in-house software and has no vendor code. */
  softwareVendorCode?: string;
}

export interface Efw2Employer {
  ein: string;
  name: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  stateCode: string;
  zip: string;
}

export interface Efw2Employee {
  ssn: string;           // 9 digits, no hyphens
  firstName: string;
  middleName?: string;
  lastName: string;
  suffix?: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  stateCode: string;
  zip: string;
  wagesCents: number;          // Box 1
  fedIncomeTaxCents: number;   // Box 2
  ssWagesCents: number;        // Box 3
  ssTaxCents: number;          // Box 4
  medicareWagesCents: number;  // Box 5
  medicareTaxCents: number;    // Box 6
  /** Box 10 — dependent-care FSA total. Its own W-2 box, separate from
   *  Box 12. SSA EFW2 RW position 270-280 carries this amount and the
   *  RT total record sums it across all RWs. */
  dependentCareCents?: number;
  /** Optional Box 12 entries (e.g., D for 401(k), DD for employer health).
   *  Codes are 1-2 letters per IRS spec; do not pack non-Box-12 amounts
   *  (Box 10 dependent care, Box 11 nonqualified) into this array. */
  box12?: Array<{ code: string; amountCents: number }>;
}

/**
 * RA — Submitter Record. Identifies who is sending the file to SSA.
 * Positions are 1-indexed per spec; here we build them in order.
 */
function buildRa(s: Efw2Submitter, taxYear: number, resubmitTLCN?: string): string {
  const line =
    'RA' +                                  // 1-2
    fText(s.userId, 8) +                    // 3-10  User ID (BSO)
    fText(s.softwareVendorCode ?? '', 4) +  // 11-14 Software vendor code (assigned by SSA; blank if none)
    ' '.repeat(5) +                         // 15-19 Blank
    fText('', 1) +                          // 20    Resubmit indicator (0/1)
    fText(resubmitTLCN ?? '', 6) +          // 21-26 Resubmit WFID
    ' '.repeat(1) +                         // 27    Software code (1=in-house, 2=off-shelf)
    ' '.repeat(57) +                        // 28-84 Reserved / company name extension blanks
    fDigits(s.ein, 9) +                     // 85-93 Submitter EIN
    fText(s.name, 57) +                     // 94-150 Submitter name
    fText(s.addressLine1, 22) +             // 151-172
    fText(s.addressLine2 ?? '', 22) +       // 173-194
    fText(s.city, 22) +                     // 195-216
    fText(s.stateCode, 2) +                 // 217-218
    fDigits(s.zip, 5) +                     // 219-223 ZIP
    fText('', 4) +                          // 224-227 ZIP extension (4) — left blank
    ' '.repeat(5) +                         // 228-232 Blank
    fText(s.contactName, 27) +              // 233-259
    fDigits(s.contactPhone, 15) +           // 260-274 Contact phone
    ' '.repeat(5) +                         // 275-279 Phone ext
    fText(s.contactEmail ?? '', 40);        // 280-319 Contact email
  return pad(line, 512);
}

/** RE — Employer Record. */
function buildRe(e: Efw2Employer, taxYear: number): string {
  const line =
    'RE' +                                  // 1-2
    fNum(taxYear, 4) +                      // 3-6 tax year
    ' ' +                                   // 7 Agent indicator code
    fDigits(e.ein, 9) +                     // 8-16 EIN
    ' '.repeat(9) +                         // 17-25 Agent EIN
    ' ' +                                   // 26 Terminating business indicator
    fText('', 4) +                          // 27-30 Establishment number
    ' '.repeat(9) +                         // 31-39 Other EIN
    fText(e.name, 57) +                     // 40-96
    ' ' +                                   // 97 Location address indicator (blank = standard)
    fText(e.addressLine1, 22) +             // 98-119
    fText(e.addressLine2 ?? '', 22) +       // 120-141
    fText(e.city, 22) +                     // 142-163
    fText(e.stateCode, 2) +                 // 164-165
    fDigits(e.zip, 5) +                     // 166-170
    fText('', 4) +                          // 171-174 ZIP ext
    ' '.repeat(5) +                         // 175-179 Blank
    ' '.repeat(23) +                        // 180-202 Foreign-state / postal
    ' ' +                                   // 203 Employment code: R=regular, A=ag, H=household, M=Medicare, X=railroad, F=federal
    'R' +                                   // 204 (we always emit Regular)
    ' ' +                                   // 205 Tax jurisdiction code (W=Puerto Rico, V=Virgin Islands, etc; blank = US)
    ' ' +                                   // 206 Third-party sick pay indicator
    ' '.repeat(306);                        // 207-512 Filler
  return pad(line, 512);
}

/** RW — Employee Wage Record (federal totals). */
function buildRw(emp: Efw2Employee): string {
  // Look up Box 12 amounts by IRS code letter. emp.box12 is the per-employee
  // year aggregate produced by `taxTotals`, keyed by code (W = HSA,
  // D = 401(k) traditional, AA = Roth 401(k), DD = employer health, etc.).
  // Codes that don't have a dedicated SSA field slot (DD, W, etc. -- they
  // belong in RO record, not RW) are written via the RO Optional Record
  // built below. Box 10 dependent care has its own dedicated slot below
  // (270-280) and is sourced from emp.dependentCareCents — NOT a Box 12
  // code.
  const b12 = (code: string): number => emp.box12?.find(b => b.code === code)?.amountCents ?? 0;
  const line =
    'RW' +                                  // 1-2
    fDigits(emp.ssn, 9) +                   // 3-11 SSN
    fText(emp.firstName, 15) +              // 12-26 First name
    fText(emp.middleName ?? '', 15) +       // 27-41 Middle
    fText(emp.lastName, 20) +               // 42-61 Last name
    fText(emp.suffix ?? '', 4) +            // 62-65 Suffix
    fText(emp.addressLine1, 22) +           // 66-87
    fText(emp.addressLine2 ?? '', 22) +     // 88-109
    fText(emp.city, 22) +                   // 110-131
    fText(emp.stateCode, 2) +               // 132-133
    fDigits(emp.zip, 5) +                   // 134-138
    fText('', 4) +                          // 139-142 ZIP ext
    ' '.repeat(5) +                         // 143-147 Blank
    ' '.repeat(23) +                        // 148-170 Foreign country
    fMoney(emp.wagesCents, 11) +            // 171-181 Box 1 Wages
    fMoney(emp.fedIncomeTaxCents, 11) +     // 182-192 Box 2 Federal income tax withheld
    fMoney(emp.ssWagesCents, 11) +          // 193-203 Box 3 SS wages
    fMoney(emp.ssTaxCents, 11) +            // 204-214 Box 4 SS tax
    fMoney(emp.medicareWagesCents, 11) +    // 215-225 Box 5 Medicare wages
    fMoney(emp.medicareTaxCents, 11) +      // 226-236 Box 6 Medicare tax
    fMoney(0, 11) +                         // 237-247 Box 7 SS tips
    fMoney(0, 11) +                         // 248-258 Box 8 Allocated tips
    fMoney(0, 11) +                         // 259-269 Reserved (was advance EIC)
    fMoney(emp.dependentCareCents ?? 0, 11) + // 270-280 Box 10 Dependent care (NOT a Box 12 code)
    fMoney(0, 11) +                         // 281-291 Box 11 Nonqualified plans
    fMoney(b12('D'), 11) +                  // 292-302 Box 12 code D (401(k))
    fMoney(b12('E'), 11) +                  // 303-313 Box 12 code E (403(b))
    fMoney(b12('F'), 11) +                  // 314-324 Box 12 code F
    fMoney(b12('G'), 11) +                  // 325-335 Box 12 code G
    fMoney(b12('H'), 11) +                  // 336-346 Box 12 code H
    fMoney(b12('S'), 11) +                  // 347-357 Box 12 code S (SIMPLE)
    fMoney(b12('Y'), 11) +                  // 358-368 Box 12 code Y
    fMoney(b12('AA'), 11) +                 // 369-379 Box 12 code AA (Roth 401(k))
    fMoney(b12('BB'), 11) +                 // 380-390 Box 12 code BB (Roth 403(b))
    fMoney(b12('EE'), 11) +                 // 391-401 Box 12 code EE (Roth 457)
    fMoney(b12('GG'), 11) +                 // 402-412 Box 12 code GG
    fMoney(b12('HH'), 11) +                 // 413-423 Box 12 code HH
    ' '.repeat(89);                         // 424-512 Filler / box-13 checkboxes
  return pad(line, 512);
}

/** RO — Optional employee wage record. Carries Box 12 codes that don't fit
 *  RW (notably W = HSA and DD = employer-sponsored health cost) plus a few
 *  other employee-specific items. Emitted only when the employee has at
 *  least one of those amounts, since RO is optional per spec. */
function buildRo(emp: Efw2Employee): string | null {
  const b12 = (code: string): number => emp.box12?.find(b => b.code === code)?.amountCents ?? 0;
  const w = b12('W');
  const dd = b12('DD');
  const t = b12('T');     // adoption benefits
  if (!w && !dd && !t) return null;
  const line =
    'RO' +                                  // 1-2
    ' '.repeat(9) +                         // 3-11 Reserved
    fMoney(0, 11) +                         // 12-22 Allocated tips (already in RW)
    fMoney(0, 11) +                         // 23-33 Uncollected employee SS tax on tips (code A)
    fMoney(0, 11) +                         // 34-44 Uncollected Medicare tax on tips (B)
    fMoney(0, 11) +                         // 45-55 Code M
    fMoney(0, 11) +                         // 56-66 Code N
    fMoney(0, 11) +                         // 67-77 Code P (moving)
    fMoney(0, 11) +                         // 78-88 Code Q (combat pay)
    fMoney(0, 11) +                         // 89-99 Code R (Archer MSA)
    fMoney(t, 11) +                         // 100-110 Code T (adoption benefits)
    fMoney(0, 11) +                         // 111-121 Code V (NQSO income)
    fMoney(w, 11) +                         // 122-132 Code W (HSA)
    fMoney(0, 11) +                         // 133-143 Code Y
    fMoney(0, 11) +                         // 144-154 Code Z
    fMoney(dd, 11) +                        // 155-165 Code DD (employer health)
    fMoney(0, 11) +                         // 166-176 Code FF (small-employer health reimb arrangement)
    ' '.repeat(336);                        // 177-512 Filler
  return pad(line, 512);
}

/** RT — Total Record. Sums every RW above this RE. The dependent-care
 *  and deferred-compensation totals must agree with the per-employee
 *  amounts on the RW lines or SSA AccuWage flags the file as
 *  inconsistent. */
function buildRt(employees: Efw2Employee[]): string {
  const sum = (k: keyof Efw2Employee) =>
    employees.reduce((acc, e) => acc + (typeof e[k] === 'number' ? (e[k] as number) : 0), 0);
  // Sum Box 12 deferral codes (D = 401(k), E = 403(b), F = 408(k)(6),
  // G = 457, H = 501(c)(18)(D), S = SIMPLE, AA = Roth 401(k),
  // BB = Roth 403(b), EE = Roth 457) for the deferred-comp total field.
  const sumBox12 = (codes: readonly string[]) => employees.reduce((acc, e) => {
    const yr = e.box12 ?? [];
    return acc + codes.reduce((s, c) => s + (yr.find(b => b.code === c)?.amountCents ?? 0), 0);
  }, 0);
  const deferredCodes = ['D', 'E', 'F', 'G', 'H', 'S', 'AA', 'BB', 'EE'] as const;
  const line =
    'RT' +                                  // 1-2
    fNum(employees.length, 7) +             // 3-9 Number of RWs
    fMoney(sum('wagesCents'), 15) +         // 10-24
    fMoney(sum('fedIncomeTaxCents'), 15) +  // 25-39
    fMoney(sum('ssWagesCents'), 15) +       // 40-54
    fMoney(sum('ssTaxCents'), 15) +         // 55-69
    fMoney(sum('medicareWagesCents'), 15) + // 70-84
    fMoney(sum('medicareTaxCents'), 15) +   // 85-99
    fMoney(0, 15) +                         // 100-114 SS tips
    fMoney(0, 15) +                         // 115-129 Allocated tips
    fMoney(0, 15) +                         // 130-144 Reserved
    fMoney(sum('dependentCareCents'), 15) + // 145-159 Dependent care (sums RW Box 10)
    fMoney(0, 15) +                         // 160-174 Nonqualified plans
    fMoney(sumBox12(deferredCodes), 15) +   // 175-189 Deferred compensation total
    ' '.repeat(308);                        // 190-512 Filler
  return pad(line, 512);
}

/** RF — Final Record. Counts RWs across the whole file. */
function buildRf(totalEmployees: number): string {
  const line =
    'RF' +                                  // 1-2
    ' '.repeat(5) +                         // 3-7 Blank
    fNum(totalEmployees, 9) +               // 8-16 RW count
    ' '.repeat(496);                        // 17-512 Filler
  return pad(line, 512);
}

export interface Efw2FileInput {
  taxYear: number;
  submitter: Efw2Submitter;
  employer: Efw2Employer;
  employees: Efw2Employee[];
  resubmitTLCN?: string;
}

/**
 * Build a complete EFW2 file (RA · RE · RW… · RT · RF). The caller must
 * supply a BSO User ID (submitter.userId) and 9-digit EIN. Output is the
 * exact byte content to upload to SSA BSO.
 */
export function buildEfw2File(input: Efw2FileInput): string {
  if (!input.submitter.userId) {
    throw new Error('EFW2: submitter BSO User ID is required (8 chars).');
  }
  if (!/^\d{9}$/.test(input.submitter.ein.replace(/\D/g, ''))) {
    throw new Error('EFW2: submitter EIN must be 9 digits.');
  }
  if (!/^\d{9}$/.test(input.employer.ein.replace(/\D/g, ''))) {
    throw new Error('EFW2: employer EIN must be 9 digits.');
  }
  if (input.employees.length === 0) {
    throw new Error('EFW2: at least one employee record is required.');
  }
  // Per-employee SSN validation: must be a full 9-digit SSN. Refuse to
  // synthesize from a last-4 stub — a synthesized SSN would generate an
  // SSA-rejected file at best and a mis-filed return at worst.
  for (const e of input.employees) {
    const ssn = String(e.ssn ?? '').replace(/\D/g, '');
    if (!/^\d{9}$/.test(ssn)) {
      throw new Error(
        `EFW2: full 9-digit SSN required for ${e.firstName} ${e.lastName}. Got ${ssn.length} digit(s). ` +
        `Refusing to synthesize; supply the full SSN from your PII source before filing.`,
      );
    }
  }
  const records: string[] = [];
  records.push(buildRa(input.submitter, input.taxYear, input.resubmitTLCN));
  records.push(buildRe(input.employer, input.taxYear));
  for (const e of input.employees) {
    records.push(buildRw(e));
    const ro = buildRo(e);
    if (ro) records.push(ro);
  }
  records.push(buildRt(input.employees));
  records.push(buildRf(input.employees.length));
  return records.join(CRLF) + CRLF;
}

// --- IRS FIRE 1099-NEC ------------------------------------------------------

export interface FireTransmitter {
  /** IRS-issued Transmitter Control Code (5 chars). REQUIRED. */
  tcc: string;
  /** Transmitter TIN (9 digits, no hyphen). REQUIRED. */
  tin: string;
  name: string;
  addressLine1: string;
  city: string;
  stateCode: string;
  zip: string;
  contactName: string;
  contactPhone: string;
  contactEmail?: string;
  /** True if this is a test file going to IRS FIRE-test, not production. */
  testFile?: boolean;
}

export interface FirePayer {
  tin: string;            // 9-digit EIN
  nameControl?: string;   // 4-char IRS name control (optional but recommended)
  name: string;
  addressLine1: string;
  city: string;
  stateCode: string;
  zip: string;
  phone?: string;
}

export interface FirePayee {
  tin: string;            // 9-digit SSN or EIN
  /** 1=EIN, 2=SSN, 3=unknown. */
  tinType: 1 | 2 | 3;
  name: string;
  secondaryName?: string;
  addressLine1: string;
  city: string;
  stateCode: string;
  zip: string;
  /** 1099-NEC Box 1 — nonemployee compensation. */
  necCents: number;
  /** Box 4 — federal income tax withheld. */
  fedTaxWithheldCents?: number;
}

/** T — Transmitter Record (750 chars). */
function buildT(t: FireTransmitter, taxYear: number): string {
  const line =
    'T' +                                   // 1
    fNum(taxYear, 4) +                      // 2-5
    ' ' +                                   // 6 Prior year indicator (P or blank)
    fDigits(t.tin, 9) +                     // 7-15 Transmitter TIN
    fText(t.tcc, 5) +                       // 16-20 Transmitter Control Code
    ' '.repeat(7) +                         // 21-27 Blank
    (t.testFile ? 'T' : ' ') +              // 28 Test file indicator
    ' ' +                                   // 29 Foreign-entity indicator
    fText(t.name, 80) +                     // 30-109 Transmitter name
    fText(t.name, 80) +                     // 110-189 Company name (line 2; same here)
    fText(t.addressLine1, 40) +             // 190-229 Company address
    fText(t.city, 40) +                     // 230-269 Company city
    fText(t.stateCode, 2) +                 // 270-271 State
    fZip9(t.zip) +                          // 272-280 ZIP (ZIP5+ZIP4 packed)
    ' '.repeat(15) +                        // 281-295 Blank
    fNum(0, 8) +                            // 296-303 Total payees (fill at end of file? IRS spec fills 0 here, recount on F record)
    fText(t.contactName, 40) +              // 304-343 Contact name
    fDigits(t.contactPhone, 15) +           // 344-358 Contact phone
    fText(t.contactEmail ?? '', 50) +       // 359-408 Contact email
    ' '.repeat(91) +                        // 409-499 Blank
    fNum(1, 8) +                            // 500-507 Record sequence number (1 for T)
    ' '.repeat(10) +                        // 508-517 Blank
    ' '.repeat(2) +                         // 518-519 Vendor indicator
    ' '.repeat(40) +                        // 520-559 Vendor name
    ' '.repeat(40) +                        // 560-599 Vendor address
    ' '.repeat(40) +                        // 600-639 Vendor city
    ' '.repeat(2) +                         // 640-641 Vendor state
    ' '.repeat(9) +                         // 642-650 Vendor zip
    ' '.repeat(40) +                        // 651-690 Vendor contact
    ' '.repeat(15) +                        // 691-705 Vendor phone
    ' '.repeat(45);                         // 706-750 Blank
  return pad(line, 750);
}

/** A — Payer Record. One per payer (single tenant -> single A record). */
function buildA(p: FirePayer, taxYear: number, sequenceNum: number): string {
  // 1099-NEC: Type-of-Return code is 'NE' (per IRS Pub 1220 §A). The amount
  // codes used in the B records for 1099-NEC are 1 (nonemployee comp) and 4
  // (federal income tax withheld). We always declare both amount codes in
  // case any payee has withholding.
  const line =
    'A' +                                   // 1
    fNum(taxYear, 4) +                      // 2-5
    ' ' +                                   // 6 Combined-Federal/State (blank=no)
    ' '.repeat(5) +                         // 7-11 Blank
    fDigits(p.tin, 9) +                     // 12-20 Payer TIN
    fText(p.nameControl ?? '', 4) +         // 21-24 Name control
    ' ' +                                   // 25 Last filing indicator (blank=will file again)
    'NE' +                                  // 26-27 Type of Return
    '14' +                                  // 28-43 Amount codes (just two digits used: 1 + 4 packed left)
    ' '.repeat(14) +                        // remaining of 28-43 padding
    ' '.repeat(8) +                         // 44-51 Blank
    ' ' +                                   // 52 Foreign entity indicator
    fText(p.name, 40) +                     // 53-92 Payer name 1
    fText('', 40) +                         // 93-132 Payer name 2 (blank)
    ' ' +                                   // 133 Transfer agent indicator
    fText(p.addressLine1, 40) +             // 134-173 Payer address
    fText(p.city, 40) +                     // 174-213 Payer city
    fText(p.stateCode, 2) +                 // 214-215
    fZip9(p.zip) +                          // 216-224 ZIP (ZIP5+ZIP4 packed)
    fDigits(p.phone ?? '', 15) +            // 225-239
    ' '.repeat(260) +                       // 240-499 Blank
    fNum(sequenceNum, 8) +                  // 500-507 Sequence
    ' '.repeat(243);                        // 508-750 Blank
  return pad(line, 750);
}

/**
 * B — Payee Record. The amount fields are 12 chars each, zero-padded right-aligned
 * cents (no decimal). For 1099-NEC: amount code 1 -> NEC, code 4 -> fed tax withheld.
 */
function buildB(p: FirePayee, taxYear: number, sequenceNum: number): string {
  // Payment Amount 1 = NEC; Payment Amount 4 = fed tax withheld. The B record
  // carries 9 amount slots (1-9 + A/B/C/D/E) each 12 chars; we fill 1 and 4.
  const amt = (cents: number | undefined) => fMoney(cents ?? 0, 12);
  const line =
    'B' +                                   // 1
    fNum(taxYear, 4) +                      // 2-5
    ' ' +                                   // 6 Corrected return indicator
    fText('', 4) +                          // 7-10 Name control
    String(p.tinType) +                     // 11 TIN type (1=EIN,2=SSN,3=unknown)
    fDigits(p.tin, 9) +                     // 12-20 Payee TIN
    fText('', 20) +                         // 21-40 Payer's account number (blank)
    fText('', 4) +                          // 41-44 Payer's office code
    ' '.repeat(10) +                        // 45-54 Blank
    amt(p.necCents) +                       // 55-66  Payment Amount 1 (NEC)
    amt(0) +                                // 67-78  Payment Amount 2
    amt(0) +                                // 79-90  Payment Amount 3
    amt(p.fedTaxWithheldCents) +            // 91-102 Payment Amount 4 (Fed tax withheld)
    amt(0) +                                // 103-114
    amt(0) +                                // 115-126
    amt(0) +                                // 127-138
    amt(0) +                                // 139-150
    amt(0) +                                // 151-162
    amt(0) +                                // 163-174 Amount A
    amt(0) +                                // 175-186 Amount B
    amt(0) +                                // 187-198 Amount C
    amt(0) +                                // 199-210 Amount D
    amt(0) +                                // 211-222 Amount E
    ' ' +                                   // 223 Foreign-entity indicator
    fText(p.name, 40) +                     // 224-263 First payee name line
    fText(p.secondaryName ?? '', 40) +      // 264-303 Second payee name line
    ' ' +                                   // 304 Transfer agent indicator
    fText(p.addressLine1, 40) +             // 305-344
    fText(p.city, 40) +                     // 345-384
    fText(p.stateCode, 2) +                 // 385-386
    fZip9(p.zip) +                          // 387-395 ZIP (ZIP5+ZIP4 packed)
    ' ' +                                   // 396 Blank
    ' '.repeat(103) +                       // 397-499 Blank
    fNum(sequenceNum, 8) +                  // 500-507
    ' '.repeat(36) +                        // 508-543 Reserved
    ' ' +                                   // 544 Second TIN notice
    ' '.repeat(2) +                         // 545-546 Reserved
    ' '.repeat(2) +                         // 547-548 1099-NEC checkbox (none)
    ' '.repeat(72) +                        // 549-620 State income tax withheld etc.
    fNum(0, 12) +                           // 621-632 Special data (blank money)
    fNum(0, 12) +                           // 633-644
    ' '.repeat(2) +                         // 645-646 Combined Fed/State code
    ' '.repeat(104);                        // 647-750 Blank
  return pad(line, 750);
}

/** C — End of Payer Record. Totals all B records for the prior A. */
function buildC(payees: FirePayee[], sequenceNum: number): string {
  const totalNec = payees.reduce((s, p) => s + (p.necCents || 0), 0);
  const totalWith = payees.reduce((s, p) => s + (p.fedTaxWithheldCents || 0), 0);
  const total = (n: number) => fMoney(n, 18);
  const line =
    'C' +                                   // 1
    fNum(payees.length, 8) +                // 2-9 Number of payees
    ' '.repeat(6) +                         // 10-15 Blank
    total(totalNec) +                       // 16-33  Control Total 1 (NEC)
    total(0) +                              // 34-51  Control Total 2
    total(0) +                              // 52-69  Control Total 3
    total(totalWith) +                      // 70-87  Control Total 4 (fed tax withheld)
    total(0) +                              // 88-105
    total(0) +                              // 106-123
    total(0) +                              // 124-141
    total(0) +                              // 142-159
    total(0) +                              // 160-177
    total(0) +                              // 178-195 Amount A
    total(0) +                              // 196-213 Amount B
    total(0) +                              // 214-231 Amount C
    total(0) +                              // 232-249 Amount D
    total(0) +                              // 250-267 Amount E
    ' '.repeat(232) +                       // 268-499 Blank
    fNum(sequenceNum, 8) +                  // 500-507 Sequence
    ' '.repeat(243);                        // 508-750 Blank
  return pad(line, 750);
}

/** F — End of Transmission Record. Single per file. */
function buildF(totalPayees: number, totalAs: number, sequenceNum: number): string {
  const line =
    'F' +                                   // 1
    fNum(totalAs, 8) +                      // 2-9 Number of A records
    fNum(0, 21) +                           // 10-30 Zero
    ' '.repeat(469) +                       // 31-499 Blank
    fNum(sequenceNum, 8) +                  // 500-507 Sequence
    fNum(totalPayees, 8) +                  // 508-515 Total payees (informational)
    ' '.repeat(235);                        // 516-750 Blank
  return pad(line, 750);
}

export interface Fire1099NecFileInput {
  taxYear: number;
  transmitter: FireTransmitter;
  payer: FirePayer;
  payees: FirePayee[];
}

/**
 * Build a complete IRS FIRE 1099-NEC file (T · A · B… · C · F). Caller
 * must supply a TCC (transmitter.tcc) and a valid 9-digit EIN. Output is
 * the exact byte content to upload to IRS FIRE.
 */
export function buildFire1099NecFile(input: Fire1099NecFileInput): string {
  if (!/^\w{5}$/.test(input.transmitter.tcc)) {
    throw new Error('FIRE: transmitter TCC must be exactly 5 characters.');
  }
  if (!/^\d{9}$/.test(input.transmitter.tin.replace(/\D/g, ''))) {
    throw new Error('FIRE: transmitter TIN must be 9 digits.');
  }
  if (!/^\d{9}$/.test(input.payer.tin.replace(/\D/g, ''))) {
    throw new Error('FIRE: payer TIN must be 9 digits.');
  }
  if (input.payees.length === 0) {
    throw new Error('FIRE: at least one payee record is required.');
  }
  // Per-payee TIN validation: SSN or EIN must be a full 9 digits. Refuse to
  // synthesize from a last-4 stub — IRS FIRE rejects mismatched names/TINs
  // and back-payable penalties run $310/return.
  for (const p of input.payees) {
    const tin = String(p.tin ?? '').replace(/\D/g, '');
    if (!/^\d{9}$/.test(tin)) {
      throw new Error(
        `FIRE: full 9-digit TIN required for ${p.name}. Got ${tin.length} digit(s). ` +
        `Collect the contractor's W-9 (SSN or EIN) before generating the 1099-NEC file.`,
      );
    }
  }
  let seq = 1;
  const records: string[] = [];
  records.push(buildT(input.transmitter, input.taxYear)); seq++;
  records.push(buildA(input.payer, input.taxYear, seq)); seq++;
  for (const p of input.payees) { records.push(buildB(p, input.taxYear, seq)); seq++; }
  records.push(buildC(input.payees, seq)); seq++;
  records.push(buildF(input.payees.length, 1, seq));
  return records.join(CRLF) + CRLF;
}
