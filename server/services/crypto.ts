/**
 * Envelope encryption for payroll PII (bank account numbers).
 *
 * AES-256-GCM with a single master key supplied via PAYROLL_ENCRYPTION_KEY
 * (base64 32-byte key). The ciphertext format is:
 *
 *   v1:<iv-b64>:<authTag-b64>:<ciphertext-b64>
 *
 * The version prefix lets us rotate to per-tenant data keys or KMS-backed
 * envelopes later without a destructive migration. `decryptString` returns
 * the input unchanged when it doesn't carry a known prefix, which makes
 * the rollout backwards compatible with existing plain-text rows — they
 * round-trip until an admin saves the employee again, at which point
 * the value gets encrypted.
 *
 * Operational notes:
 *   - Generate a key with: `openssl rand -base64 32` and set it as
 *     PAYROLL_ENCRYPTION_KEY in the runtime environment.
 *   - Without the env var, encryption is MANDATORY for new writes:
 *     `encryptString` throws so the API call fails closed instead of
 *     silently persisting plain text. Decryption of legacy plain-text
 *     rows still succeeds (they round-trip as-is), so existing data is
 *     readable while the key is being provisioned.
 *   - Never log decrypted account numbers. Mask to last 4 in any audit/UI.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGO = 'aes-256-gcm';
const VERSION = 'v1';

let cachedKey: Buffer | null | undefined; // undefined = not resolved yet

function getKey(): Buffer | null {
  if (cachedKey !== undefined) return cachedKey;
  const env = process.env.PAYROLL_ENCRYPTION_KEY;
  if (!env) { cachedKey = null; return null; }
  try {
    const k = Buffer.from(env, 'base64');
    if (k.length !== 32) {
      console.warn('[payroll-crypto] PAYROLL_ENCRYPTION_KEY must decode to 32 bytes; got ' + k.length + '. Encryption disabled.');
      cachedKey = null; return null;
    }
    cachedKey = k;
    return cachedKey;
  } catch {
    console.warn('[payroll-crypto] PAYROLL_ENCRYPTION_KEY is not valid base64. Encryption disabled.');
    cachedKey = null; return null;
  }
}

export function isEncryptionEnabled(): boolean {
  return getKey() !== null;
}

export class PayrollEncryptionUnavailableError extends Error {
  constructor() {
    super('PAYROLL_ENCRYPTION_KEY is not configured; cannot store payroll bank info without at-rest encryption.');
    this.name = 'PayrollEncryptionUnavailableError';
  }
}

export function encryptString(plain: string | null | undefined): string | null {
  if (plain === null || plain === undefined || plain === '') return null;
  // Idempotent: if already encrypted, don't re-encrypt.
  if (plain.startsWith(VERSION + ':')) return plain;
  const key = getKey();
  if (!key) {
    // Fail closed. We never want to silently persist a plain-text bank
    // account number to disk — the caller (a route) surfaces this as a
    // 400/500 so the operator knows to set the env var.
    throw new PayrollEncryptionUnavailableError();
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION}:${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;
}

export function decryptString(stored: string | null | undefined): string | null {
  if (stored === null || stored === undefined || stored === '') return null;
  if (!stored.startsWith(VERSION + ':')) return stored; // back-compat with plain rows
  const key = getKey();
  if (!key) throw new Error('Cannot decrypt: PAYROLL_ENCRYPTION_KEY is not set');
  const parts = stored.split(':');
  if (parts.length !== 4) throw new Error('Invalid encrypted payload format');
  const iv = Buffer.from(parts[1], 'base64');
  const tag = Buffer.from(parts[2], 'base64');
  const ct = Buffer.from(parts[3], 'base64');
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const out = Buffer.concat([decipher.update(ct), decipher.final()]);
  return out.toString('utf8');
}

/** Display helper: returns "•••• 1234" or null if no value. Never decrypts in logs. */
export function maskLast4(stored: string | null | undefined): string | null {
  if (!stored) return null;
  try {
    const plain = decryptString(stored);
    if (!plain) return null;
    const tail = plain.slice(-4);
    return tail.length === 4 ? `•••• ${tail}` : '••••';
  } catch {
    return '••••';
  }
}
