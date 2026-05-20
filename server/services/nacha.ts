/**
 * Minimal NACHA (ACH) file generator for payroll disbursement.
 *
 * Produces a PPD-format credit file with a single batch — one entry detail
 * record per employee net-pay credit. Output is a fixed-width text file (94
 * cols per line, CRLF) per NACHA Operating Rules.
 *
 * Limitations (TODO before production use):
 *   - Single batch; multiple companies / split deposits not supported.
 *   - No offsetting debit entry — assumes the ODFI offsets at the company
 *     account level (common for "credit-only" files; some banks require
 *     a balanced file with a 5/6/7 offset).
 *   - No prenotes; assumes accounts have been micro-deposit verified.
 *   - Account numbers must already be decrypted when passed in. The DB
 *     column is suffixed _enc to make production encryption a column-name
 *     migration rather than a schema migration.
 */

export interface NachaOriginator {
  companyName: string;        // 16 chars
  companyId: string;          // 10 chars (EIN with leading 1 typical)
  originatingDfi: string;     // 8 digits
  immediateOriginName: string;
  immediateOrigin: string;    // 10 digits
  immediateDestinationName: string;
  immediateDestination: string; // 10 digits
}

export interface NachaEntry {
  employeeName: string;        // 22 chars
  employeeId: string;          // up to 15 chars (External ref)
  routingNumber: string;       // 9 digits
  accountNumber: string;       // up to 17 chars
  accountType: 'checking' | 'savings';
  amountCents: number;         // positive
}

function pad(s: string, len: number, char = ' ', right = true): string {
  s = (s || '').toString();
  if (s.length >= len) return s.slice(0, len);
  return right ? s + char.repeat(len - s.length) : char.repeat(len - s.length) + s;
}
const padR = (s: string, len: number) => pad(s, len, ' ', true);
const padL0 = (s: string | number, len: number) => pad(String(s), len, '0', false);
// NACHA file-header routing fields are 10 chars but the routing number is
// 9 digits — the leading char is conventionally a space, not a zero.
// Zero-padding here can cause bank rejection on some ODFIs.
const padL_ = (s: string | number, len: number) => pad(String(s), len, ' ', false);

/** Compute the check digit for a 9-digit ABA routing number (modulo 10). */
function checkRoutingDigit(r8: string): string {
  const w = [3, 7, 1, 3, 7, 1, 3, 7];
  let sum = 0;
  for (let i = 0; i < 8; i++) sum += Number(r8[i]) * w[i];
  return String((10 - (sum % 10)) % 10);
}

export function validateRouting(routing: string): boolean {
  if (!/^\d{9}$/.test(routing)) return false;
  return checkRoutingDigit(routing.slice(0, 8)) === routing[8];
}

/**
 * Build a NACHA PPD credit file for a payroll run.
 * `effectiveDate` is the settlement date (YYMMDD); usually the pay date.
 */
export function buildNachaFile(
  originator: NachaOriginator,
  entries: NachaEntry[],
  effectiveDate: string, // YYMMDD
  fileIdModifier: string = 'A',
): { content: string; entryCount: number; totalCents: number } {
  if (entries.length === 0) throw new Error('No entries to build NACHA file');
  for (const e of entries) {
    if (!validateRouting(e.routingNumber)) {
      throw new Error(`Invalid routing number for ${e.employeeName}: ${e.routingNumber}`);
    }
  }

  const lines: string[] = [];
  const now = new Date();
  const yymmdd = now.toISOString().slice(2, 10).replace(/-/g, '');
  const hhmm = now.toISOString().slice(11, 16).replace(':', '');

  // ---- File Header (Record Type 1) ----
  lines.push([
    '1',
    '01',
    // immediate destination / origin are 10-char fields with a leading
    // space (or 1 for FedACH IAT, etc.) when the underlying routing number
    // is 9 digits. If the operator stored a literal 10-char value (already
    // including the leading char) we leave it; otherwise we left-pad with
    // a space so the file is accepted by ODFIs that reject leading zeros.
    padL_(originator.immediateDestination, 10),
    padL_(originator.immediateOrigin, 10),
    yymmdd,
    hhmm,
    fileIdModifier,
    '094',
    '10',
    '1',
    padR(originator.immediateDestinationName, 23),
    padR(originator.immediateOriginName, 23),
    padR('', 8),
  ].join(''));

  // ---- Batch Header (Record Type 5) ----
  lines.push([
    '5',
    '220',                              // service class code: credits only
    padR(originator.companyName, 16),
    padR('', 20),                       // discretionary data
    padR(originator.companyId, 10),
    'PPD',                              // standard entry class
    padR('PAYROLL', 10),
    // Company descriptive date: 6 chars, conventionally YYMMDD of the pay
    // date. The earlier "PAY DATE ${effectiveDate}" string was truncated to
    // "PAY DA" by the 6-char slice — losing the date entirely and surprising
    // bank tellers who expected a YYMMDD.
    effectiveDate,                      // descriptive date YYMMDD
    effectiveDate,                      // effective entry date YYMMDD
    '   ',                              // settlement date (filled by ACH operator)
    '1',                                // originator status code
    padR(originator.originatingDfi, 8),
    padL0(1, 7),                        // batch number
  ].join(''));

  let entryHash = 0;
  let totalCredit = 0;
  let seq = 1;

  // ---- Entry Detail (Record Type 6) ----
  for (const e of entries) {
    const txCode = e.accountType === 'savings' ? '32' : '22'; // 32=savings credit, 22=checking credit
    const r8 = e.routingNumber.slice(0, 8);
    entryHash += Number(r8);
    totalCredit += e.amountCents;
    lines.push([
      '6',
      txCode,
      r8,
      e.routingNumber[8],
      padR(e.accountNumber, 17),
      padL0(e.amountCents, 10),
      padR(e.employeeId, 15),
      padR(e.employeeName, 22),
      '  ',                               // discretionary data
      '0',                                // addenda record indicator
      padR(originator.originatingDfi, 8) + padL0(seq, 7),
    ].join(''));
    seq++;
  }

  const entryCount = entries.length;

  // ---- Batch Control (Record Type 8) ----
  lines.push([
    '8',
    '220',
    padL0(entryCount, 6),
    padL0(entryHash % 10_000_000_000, 10),
    padL0(0, 12),                       // total debit
    padL0(totalCredit, 12),
    padR(originator.companyId, 10),
    padR('', 19),                       // message auth code
    padR('', 6),
    padR(originator.originatingDfi, 8),
    padL0(1, 7),
  ].join(''));

  // ---- File Control (Record Type 9) ----
  // NACHA requires blocking factor 10; pad with 9999 lines so total line
  // count is a multiple of 10.
  const recordCount = lines.length + 1; // +1 for the file control we're about to add
  const blocks = Math.ceil((recordCount) / 10);
  lines.push([
    '9',
    padL0(1, 6),                        // batch count
    padL0(blocks, 6),
    padL0(entryCount, 8),
    padL0(entryHash % 10_000_000_000, 10),
    padL0(0, 12),                       // total debit
    padL0(totalCredit, 12),
    padR('', 39),
  ].join(''));

  // Pad with 9999... filler records to fill the last block.
  while (lines.length % 10 !== 0) lines.push('9'.repeat(94));

  return {
    content: lines.join('\r\n') + '\r\n',
    entryCount,
    totalCents: totalCredit,
  };
}
