/**
 * Task #142 — Galaxy + LWW regression suite entrypoint.
 *
 * Run with: `npm test` (or `npx tsx tests/run.ts`).
 *
 * All spec files register tests via the shared harness in `_harness.ts` at
 * module load. After every spec is imported we invoke `run()` once. The
 * harness sets `process.exitCode = 1` when any test fails, so a single
 * failing case in any suite causes `npm test` to exit non-zero — no suite
 * can mask a regression in another.
 */
import "./galaxy-auth.spec.js";
import "./galaxy-webhook-delivery.spec.js";
import "./galaxy-routes.spec.js";
import "./galaxy-enqueue.spec.js";
import "./planner-conflict.spec.js";
import "./payroll-engine.spec.js";
import { run } from "./_harness.js";

await run();

// Force a hard exit so lingering keep-alive sockets (e.g. HTTP test servers
// that may still hold timers) don't keep the process alive after results
// have been reported. process.exitCode is preserved by process.exit().
process.exit(process.exitCode ?? 0);
