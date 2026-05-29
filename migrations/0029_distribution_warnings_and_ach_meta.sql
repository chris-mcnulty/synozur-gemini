-- Follow-up to migration 0028 addressing two Copilot PR review comments:
--
--   1. Preview warnings were only held in React state, so a refresh or a
--      visit to an already-previewed run dropped them. Persist them on the
--      run so the UI can render the same warnings reviewed at preview time.
--
--   2. The owner NACHA file was returned inside the finalize JSON
--      response, which made plaintext routing/account numbers prone to
--      leaking through middleware logs, devtools history, and API
--      gateways. Storing the effective date on the run lets a separate
--      auth-gated download endpoint regenerate the file deterministically
--      without ever putting its contents in a JSON body.

ALTER TABLE "distribution_runs"
  ADD COLUMN IF NOT EXISTS "warnings" jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE "distribution_runs"
  ADD COLUMN IF NOT EXISTS "nacha_effective_date" varchar(6);
