-- Widen payroll_employees.bank_account_number_enc from varchar(64) to
-- varchar(256). The AES-GCM envelope encryptString produces is
--   v1:<iv-b64>:<tag-b64>:<ciphertext-b64>
-- which runs ~70 characters for a 17-digit US account number and longer
-- for international ones, so the original varchar(64) would truncate or
-- reject encrypted writes once at-rest encryption is enabled.

ALTER TABLE "payroll_employees"
  ALTER COLUMN "bank_account_number_enc" TYPE varchar(256);
