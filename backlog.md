# Constellation Product Backlog

**Last Updated**: May 20, 2026
**Version**: 7.3 — Adds Washington state payroll seeds (PFML, Cares, SUTA, L&I stub), SSA EFW2 + IRS FIRE e-file generators, and a quarterly profit-distribution design doc covering owner pools (Michelle + Chris) and FTE bonus pools. Plus open production-readiness questions captured from the May 20 planning conversation.

---

## 🎯 Production Readiness — Top 10 (May 20, 2026)

Drawn from the May 20 planning conversation. Ordered by risk-to-ship.

1. ✅ **SSA EFW2 + IRS FIRE e-file** — first cut in `tax-forms-efile.ts` (May 20). Migration 0026 adds encrypted full SSN storage (`payroll_employees.ssn_enc`); BSO User ID + IRS TCC + software vendor code now live in tenant settings (`payroll.bso_user_id`, `payroll.irs_tcc`, `payroll.software_vendor_code`) surfaced via Payroll → Tax filing settings. EFW2 / FIRE routes pull SSN from the encrypted column and the filer info from tenant settings — `fullSsns` request-body workaround removed. EFW2 RO record added so Box 12 W (HSA) + DD (employer health) actually surface. Still pending: SSA AccuWage + IRS FIRE-test validation before any production submission.
2. ✅ **941 PDF via Puppeteer** — `/api/payroll/tax-forms/941?format=pdf` returns a Letter-size PDF rendered through the same puppeteer pipeline used by invoicing. HTML output preserved as the default.
3. **State withholding matrix — next 10 states** (TX, MA, IL, GA, NC, VA, OH, WA-PFML/Cares ✅, CO, MN, MI). Bracket data only; engine is ready.
4. ✅ **SUTA experience-rate tenant override UI** — new Payroll → SUTA / Jurisdictions admin page lets tenants override the seeded new-employer rate (and optionally wage base) per state. `POST /api/payroll/jurisdictions` upserts the tenant row; `DELETE /api/payroll/jurisdictions/:id` reverts to the platform default.
5. ✅ **Off-cycle / bonus payroll run UX** — run-create form now has a run-type picker; bonus runs surface a multi-select employee picklist. `payroll_runs.target_employee_ids` (jsonb) persists the subset, and `previewRun` honors it and bypasses the pay-schedule filter so cross-schedule bonus pools work.
6. **Per-diem accountable vs non-accountable split** — above-federal-rate spillover must flow to W-2 Box 1.
7. ✅ **HSA / Section 125 health reimbursement** — `payroll_deductions.box12_code` + `benefit_category` columns added; engine stamps the codes onto run-item breakdown lines; `taxTotals` aggregates per-employee Box 12 totals per year; W-2 CSV gains dedicated W / D / AA / DD columns; EFW2 RW record now emits Box 12 D/AA/E/G/S, and a new RO record carries W (HSA) and DD (employer health). UI exposes a "Benefit preset" picker on the deduction form that auto-fills tax wrapper + Box 12 code from the chosen category.
8. **Title III garnishment ordering** (federal tax → child support → student loans → consumer → state).
9. **QuickBooks Online integration** — #1 user-feedback request, Q2 priority.
10. **Codebase modularization** (`routes.ts` → 13 domain modules, `storage.ts` → 8). Easier to land before tax-forms work piles up.

Two items the conversation explicitly *did not* put in the top 10 but
need decisions soon:

- **Constellation ↔ Gemini app split**: the home/welcome screen still
  says Constellation and the nav still surfaces project-only features
  (time tracking, estimates) inside what's becoming a payroll product.
  Decision required: keep two surfaces, or refold payroll back into
  Constellation alongside the existing expense / contractor-invoice /
  exchange-rate modules. Tracked as a P0 product decision below.
- **Inbound 1099 receipts (we receive a 1099 from a client)**: ruled
  out of Constellation in the May 20 conversation. Belongs in QBO sync
  (#9 above), not here.

---

## 🚦 P0 — Product Decision: Constellation vs. Gemini App Split

**Status:** Needs decision (May 20, 2026)
**Effort:** Medium (1-2 weeks regardless of direction)

The payroll module shipped as "Gemini Payroll" but inherited every
Constellation nav and the same splash/home screen. That's inconsistent
and confusing for anyone arriving at payroll without a project context.

Two paths, pick one before the next nav/branding pass:

- **(A) Refold into Constellation.** Drop the "Gemini" sub-brand; surface
  payroll as a top-level Constellation module alongside Expenses,
  Contractor Invoices, and Exchange Rates (all of which already live in
  Constellation). Pro: one product, one nav, one home screen, shared
  user/tenant model. Con: payroll-only customers (if any) see a busier
  product.
- **(B) Keep separate.** Build a real Gemini splash/home + chromeless
  payroll-only nav. Pro: payroll customers see a focused product. Con:
  duplicate user management, duplicate tenant pages, more code to keep
  consistent. The current state already shows the cost of this path
  (Constellation branding leaking into Gemini surfaces).

Open question, not yet answered.

---

## 🚧 In Progress — Payroll P1 Remediation (May 2026)

The payroll module shipped with full schema, calc engine, and run workflow
but several integration and correctness gaps blocked using it in production.
The current sweep closes the highest-impact gaps; remaining items below.

**Completed in this sweep:**
- [x] Users ↔ Payroll auto-provisioning (`users.payrollEmployeeType`)
- [x] Bi-directional UI surface (payroll badge on users page, linked-user pill on payroll page)
- [x] Payroll runs pull hours from approved/submitted time entries (FLSA OT split per ISO week)
- [x] True YTD accumulators for SS wage base, additional Medicare, FUTA cap
- [x] Head-of-household federal bracket table
- [x] NACHA / ACH PPD credit file export for approved/finalized runs
- [x] Per-tenant ACH originator profile
- [x] Bank routing/account/type capture on employee detail
- [x] Full W-4 capture UI (filing status, multi-jobs, dependents, deductions, extra withholding)
- [x] Tax totals endpoint (`/api/payroll/tax-totals?period=quarter|year|custom`)
- [x] PTO accrual + decrement hooked into `finalizeRun`
- [x] Employee self-service paystubs (`/me/paystubs` + `/me/paystubs/:runId`)
- [x] AES-256-GCM encryption of bank account numbers (envelope, `PAYROLL_ENCRYPTION_KEY`, fail-closed)
- [x] W-4 Step 2(c) multiple-jobs withholding adjustment (halve standard deduction per Pub 15-T)
- [x] Bracket-based state withholding (CA, NY, NJ, PA) + NYC and Philadelphia local taxes
- [x] SUTA per state (rule-driven, scoped to employee work state)
- [x] Section 125 vs 401(k) traditional FICA treatment (`pre_tax_scope` on deductions; FICA wage base persisted per run item)
- [x] Reversal runs (`POST /api/payroll/runs/:id/reverse`)
- [x] Multi-state reciprocity (15 reciprocal pairs; engine resolves home vs work state for withholding)
- [x] Garnishment split into its own GL category (`garnishment_liability`) in the GL export
- [x] Form 941 + Schedule B printable HTML; W-2 / W-3 / 1099-NEC CSVs (artifact-only, not e-file)

**Remaining P1 (in priority order):**
- [ ] **State withholding matrix beyond CA/NY/NJ/PA/WA** — bracket tables for the next ~10 states by headcount (TX has no state income tax; covers MA, IL, GA, NC, VA, OH, CO, MN, MI). Existing engine `kind: 'brackets'` is ready; just need data. WA seeded in 0023 (PFML + Cares as `wage_premium`).
- [ ] **State-specific SUTA experience rates** — platform seeds the new-employer rate per state; tenants need a UI to override with the experience-rated percentage their state assigned. SUTA-WA seeded in 0023.
- [x] **SSA EFW2 + IRS FIRE e-file (first cut)** — fixed-width file generators in `server/services/tax-forms-efile.ts`; routes `POST /api/payroll/tax-forms/w2-efw2` and `POST /api/payroll/tax-forms/1099-nec-fire`. **Validate against SSA AccuWage and IRS FIRE-test before production filing.** Open follow-ups:
  - [x] Full SSN storage — migration 0030 adds `payroll_employees.ssn_enc` (AES-256-GCM); employee detail UI now has a write-only "Full SSN" field; EFW2 + FIRE pull from the encrypted column.
  - [x] Tenant settings: BSO User ID, IRS TCC, software vendor code — `payroll.bso_user_id`, `payroll.irs_tcc`, `payroll.software_vendor_code` + filer name/address/contact under Payroll → Tax filing settings.
  - 1099-DIV variant for owner distributions if the entity elects C-corp.
- [ ] **Washington state coverage** — PFML, Cares, SUTA-WA, L&I stub seeded in migration 0027. Remaining: WA L&I hours-based premium engine (needs `risk_class_code` on payroll_employees + per-class rate table); WA B&O accrual on the AR side (see `docs/design/quarterly-profit-distribution.md` §7).
- [x] **941 PDF via Puppeteer** — `/api/payroll/tax-forms/941?format=pdf` returns a Letter-size PDF via the shared `htmlToPdf` helper.
- [x] **Off-cycle / bonus run UX** — bonus run type + employee multi-select picker live; `payroll_runs.target_employee_ids` persists the subset and bypasses the pay-schedule filter in `previewRun`.
- [ ] **Per-period accruals other than PTO** — sick leave, parental leave, jury duty caps.
- [ ] **Title III garnishment priority ordering** — current model treats each garnishment independently; multiple garnishments should follow IRS / DOL ordering (federal tax → child support → student loans → consumer creditors → state tax).
- [ ] **Payment cycle SLA monitoring** — alert when a scheduled run has not been previewed/approved within N days of pay date.
- [ ] **Audit log retention + export** — currently append-only with no retention policy or exportable evidence package.
- [ ] **Per diem accountable vs non-accountable split** — when per diem exceeds the federal rate, the spillover is taxable wages; current reimbursement path treats everything as accountable.
- [x] **HSA / health benefit reimbursements** — `payroll_deductions.box12_code` + `benefit_category` columns + engine pass-through + W-2 CSV / EFW2 RW+RO Box 12 emission + admin "Benefit preset" picker shipped (migration 0030).

---

## ✅ Recently Completed (v2.5 — May 2026)

### Galaxy Client Portal API ✅ COMPLETE
- [x] External `/api/galaxy/v1/*` API mounted alongside (and independent of) the internal A2A and MCP APIs
- [x] OAuth2 authorization-code (delegated) and client-credentials grants
- [x] Token issuance against Microsoft Entra with `tenantId` + `clientId` claims for automatic scoping
- [x] Per-app registration UI under Settings → Galaxy API (redirect URIs, webhook URL, allowed origins, scope ceiling)
- [x] Hashed storage of client secret + webhook signing secret with one-time display and rotation
- [x] Document download streaming through the portal (no direct SharePoint exposure)
- [x] Signed webhook delivery with retry/audit
- [x] Admin Galaxy page (`/admin/galaxy`)
- [x] Test suites for auth, scopes, routes, webhook delivery (Tasks #127, #142)
- [x] Schema migration `0009_galaxy_client_portal_api.sql`
- [x] `docs/galaxy-api.md`

### Notifications System ✅ COMPLETE
- [x] In-app notification center (bell, dropdown, full-page `/notifications`)
- [x] Per-user preferences page (`/notification-preferences`) with channel + per-type controls
- [x] Real-time unread count in browser tab title (Task #110)
- [x] Opt-in browser push notifications (Task #111)
- [x] Weekly digest emails via SendGrid (Task #101)
- [x] Per-tenant digest schedule configuration (Task #129)
- [x] Digest delivery stats on Scheduled Jobs page (Task #128)
- [x] SendGrid webhook open tracking (Task #130)
- [x] Notification hooks added to more platform events (Task #112)

### Multi-Currency Estimates & Invoicing ✅ COMPLETE
- [x] Quote currency separate from cost currency on estimates (Task #102)
- [x] Schema migration + SOW propagation
- [x] Quote-currency totals on invoice batches when they differ from cost currency
- [x] Client-currency amounts on estimate PDFs and Sub-SOW exports (Task #131)
- [x] Currency picker on expense edit form

### Excel-Like Time Grid 2.0 ✅ COMPLETE
- [x] Two-tab grid (current + prior week) with full keyboard nav (Task #125)
- [x] Drag-fill extends a series instead of just copying values
- [x] Virtualised rendering for large grids (Task #138)
- [x] Clipboard parser + row state machine unit tests (Task #137)
- [x] Project picker shows and searches by project code

### Estimate Version History ✅ COMPLETE
- [x] Backfill snapshots on first edit (Task #113)
- [x] Snapshot on every email/send (Task #115)
- [x] Who saved each snapshot in History panel (Task #114)
- [x] Side-by-side compare and restore from any prior version

### Client Portal Approvals & Sign-offs ✅ COMPLETE
- [x] Client Portal Approvals & Sign-offs (Task #104)
- [x] Sign-off status badges on estimates and milestone list views (Task #134)
- [x] Inline status report acknowledgement (Task #136)
- [x] Admin sign-offs audit log page (Task #135)
- [x] Payment milestones exposed to client portal users via Galaxy (Task #89)
- [x] Cascade allocation: shifted-from-milestone indicator (Task #91)
- [x] Cascade allocation: PM "undo" for applied date shift (Task #90)

### Payment Milestone Billing Automation ✅ COMPLETE
- [x] Auto-generate invoice batch when payment milestone marked Invoiced (Task #87)
- [x] Payment milestone billing status on portfolio dashboard (Task #88)
- [x] Hours budget status on project list dashboard table (Task #82)
- [x] Alert when project drops below 10% of budgeted hours (Task #83)
- [x] Empty-state callout for projects with no approved estimate hours (Task #84)

### AI Project Manager Agent ✅ COMPLETE
- [x] Conversational PM agent (Task #143) layered on v2.4 Copilot write infrastructure

### Planner Sync Robustness ✅ COMPLETE
- [x] Last-write-wins conflict resolution (Task #126)
- [x] Admin alerts on sync failures with actionable context
- [x] Improved retry/backoff on Graph throttling

### Operational & Performance Improvements ✅ COMPLETE
- [x] Persistent in-memory cache via startup warm-up loader (Task #106)
- [x] Invoice list speed-up via bulk-query approach (Task #105)
- [x] Server-side pagination on Users page (Task #116)
- [x] Auto-cleanup of old `background_jobs` rows (Task #121)
- [x] Background Jobs link in admin sidebar
- [x] Financial-comparison report rewritten to use SQL aggregation (Task #117)
- [x] Global deep-link search across projects, users, and time entries
- [x] Actionable data quality warnings with affected-item lists (Task #86)
- [x] Expandable event detail in calendar suggestions panel (Task #108)
- [x] "Visible to clients" toggle on RAIDD entries
- [x] Sync Copilot Studio client IDs to Azure manifest (Task #52)

### v2.5 Bug Fixes ✅ COMPLETE
- [x] Teams channel setup on project detail (3 bugs)
- [x] "Set Up Teams Channel" hidden on estimates that already have one
- [x] TimeGrid project picker shows and searches by project code

---

## 🆕 Previously In Progress — Copilot Agent Write Activities

**Status:** Phases 0–5 ✅ shipped (April 2026). Phase 6 (docs/rollout) partial — staging flag + USER_GUIDE write-up still open.
**Effort:** High (6 phases total, ~8–10 weeks to full scope)
**Design:** `/root/.claude/plans/recursive-squishing-tower.md` (planning artifact) + this backlog section

### Why
The MCP server and Copilot Studio agent are currently read-only. Users asking the agent "start an estimate for Acme Corp — block of 120 hours" get routed back to the web UI. Adding a narrow, safe write surface unlocks conversational productivity for the highest-frequency consulting workflow: estimation.

### Phase 0 — Write Infrastructure ✅ COMPLETE (April 12, 2026)
- [x] `mcp_write_audit` table (tenant, user, endpoint, idempotency key, request hash, response body, resource, dry-run flag, correlation ID)
- [x] `mcpWriteGuard` middleware: `MCP_WRITES_ENABLED` feature flag, `X-Idempotency-Key` header requirement with replay-cache, request-hash conflict detection, `?dryRun=true` universal short-circuit, envelope wrapper (`idempotent`, `auditId`, `correlationId`, `dryRun`)
- [x] New `/server/routes/mcp-write.ts` module, `/mcp/v1/*` namespace registered in `server/routes.ts`
- [x] Write role constants stricter than read (admin, pm, portfolio-manager only — dropped executive and billing-admin for writes)
- [x] `POST /mcp/v1/ping` diagnostic endpoint for the full write stack
- [x] OpenAPI spec updated to v1.1.0 with write paths and `X-Idempotency-Key` header
- [x] `MCP_CONNECTOR_SETUP.md` — removed READ-ONLY language; added Part 4 (write activities) covering feature flag, idempotency, dry-run, envelope, role policy, canonical agent flow

### Phase 1 — Client Discovery ✅ COMPLETE (April 12, 2026)
- [x] `GET /mcp/clients?search=&limit=` — case-insensitive substring match on name + shortName
- [x] Linkage signals in response: `hasHubspotLink` (from `crm_object_mappings`), `hasTeamsLink` (from `client_teams` or legacy `clients.microsoftTeamId`), `activeEstimateCount` (draft/sent/approved estimates)
- [x] Scoped to caller's tenant, role-gated via `ESTIMATE_ROLES`

### Phase 2 — Client Creation ✅ COMPLETE (April 12, 2026)
- [x] `POST /mcp/v1/clients` with Zod validation, tenant from auth context (body `tenantId` ignored)
- [x] Near-match duplicate detection (normalize + substring + Levenshtein) against existing clients in tenant — returns 409 with candidates unless `force: true`
- [x] Shared `insertClientSchema` validation consistent with `/api/clients`

### Phase 3 — Estimate Creation (3 variants) ✅ COMPLETE
**Effort:** Medium (2–3 weeks)
- [x] `POST /mcp/v1/estimates/from-narrative` — AI-generated 3–8 summary line items (hard cap)
- [x] `POST /mcp/v1/estimates/block-hours` — single line item, blended rate via role catalog lookup
- [x] `POST /mcp/v1/estimates/fixed-price` — `estimateType: fixed`, one line per phase
- [x] Uses existing `aiService.generateEstimateFromNarrative()` in `server/services/ai-service.ts`
- [x] Pre-create duplicate check for active estimates on the same client (409 unless `force: true`)
- [x] `createEstimateCore()` helper in `server/routes/mcp-write.ts`
- [x] Prompt-injection sanitization on the `narrative` field (`sanitizeNarrative()`)

### Phase 4 — HubSpot Linkage ✅ COMPLETE
**Effort:** Small-Medium (1–2 weeks)
- [x] `GET /mcp/v1/hubspot/search?type=company|deal&query=`
- [x] `POST /mcp/v1/clients/:clientId/hubspot-link` with `createIfMissing` flag — writes `crm_object_mappings`, uses `createHubSpotDeal()` / `createHubSpotCompany()` from `hubspot-client.ts`

### Phase 5 — Teams Team + Channel Linkage ✅ COMPLETE
**Effort:** Medium (2 weeks)
- [x] `POST /mcp/v1/clients/:clientId/teams-link` — ensures `client_teams` row (creates team via Graph when `createIfMissing`)
- [x] `POST /mcp/v1/projects/:projectId/teams-channel` — ensures `project_channels` row via `plannerService.createChannel()`
- [x] Partial-failure envelope: `warnings[]` preserved; no rollback of prior successful steps

### Phase 6 — Docs, Agent Instructions, Rollout
- [x] OpenAPI spec updated for each phase (bumped to v1.2.0 for Phase 3-5)
- [x] Connector setup doc updated with write-flow agent instructions (Phase 0)
- [ ] `USER_GUIDE.md` — new "Conversational Estimate Creation" section (gated on Phase 3)
- [ ] Enable `MCP_WRITES_ENABLED=true` in staging for pilot tenant(s) after Phase 3

### Explicit Non-Goals for v1
Estimate approval/status transitions, invoice generation, line-item-level edits (would defeat the agent metaphor), project creation (use existing approve-estimate flow), user/role management, expense submission.

---

## ✅ Recently Completed (March 15, 2026)

### Teams Custom Tab Integration ✅ COMPLETE
- [x] Embed routes (`/embed/*`) with chromeless layout
- [x] Tab deep-linking via `?tab=` for all project tabs
- [x] Read-only enforcement — all mutating actions hidden in embed mode
- [x] Teams SSO authentication with popup sign-in flow
- [x] Configurable tab setup page and embed dashboard
- [x] Teams app manifest (`teams/manifest.json`)
- [x] Three-app Entra architecture (SCDP-Content, MCP Connector, Copilot Agent)

### Navigation Reorganization ✅ COMPLETE
- [x] Sub-group labels in sidebar (Daily Work, Time & Expenses, Tracking, etc.)
- [x] Disambiguated menu labels (Dashboard → My Dashboard, Time → Timesheets, etc.)
- [x] Mobile navigation updated to match desktop
- [x] Reordered items for better workflow grouping

### Theme System ✅ COMPLETE
- [x] Modular CSS variable-based theme architecture
- [x] Aurora theme (warm earth tones)
- [x] Night Sky theme (deep navy with star navigation)
- [x] Navigator's Chart theme (clean professional teal)
- [x] Theme integration guide at `docs/SYNOZUR_THEME_GUIDE.md`

---

## ✅ Previously Completed (March 10, 2026)

### MCP Server & Constellation Copilot Agent ✅ COMPLETE
- [x] MCP server with ~24 read-only GET endpoints under `/mcp`
- [x] Bearer token authentication via JWKS (v1 + v2 Entra token issuers)
- [x] Multi-tenant support (Entra `common` authority)
- [x] RBAC-enforced access with tenant-scoped data isolation
- [x] Power Platform Custom Connector with OpenAPI spec import
- [x] Copilot Studio agent for conversational access through Teams and M365 Copilot
- [x] Teams channel deployment for chat and channel-based interactions
- [x] Connector setup guide (`docs/MCP_CONNECTOR_SETUP.md`)
- [x] Endpoint reference (`docs/MCP_README.md`)

### Persistent Status Reports ✅ COMPLETE
- [x] `status_reports` table migrated to database
- [x] AI-generated text reports auto-saved on generation
- [x] PPTX export creates "final" status report record
- [x] Status Reports tab on project detail page with list view
- [x] View report content, mark as final, delete reports
- [x] Full CRUD API at `/api/projects/:projectId/status-reports`
- [x] MCP endpoints for saved status reports (list + detail)
- [x] Project ownership and tenant isolation enforcement on all routes

### AI Model Upgrade ✅ COMPLETE
- [x] Azure AI Foundry integration with GPT-5.4 support
- [x] Multi-provider AI architecture (Replit AI + Azure AI Foundry)
- [x] Configurable model selection per request
- [x] Usage logging and cost tracking per tenant

### SharePoint Embedded Document Storage ✅ COMPLETE
- [x] Full SharePoint Embedded (SPE) integration as primary document storage tier
- [x] Per-tenant SPE container provisioning with Azure AD tenant isolation
- [x] Smart storage layer directing files based on tenant `speStorageEnabled` flag
- [x] Direct file download via Microsoft Graph API (`downloadFileDirect`)
- [x] File Repository page with document type inference from folder paths
- [x] Expandable metadata panel and file statistics dashboard
- [x] Reorganize Files endpoint to move files from nested to top-level SPE folders
- [x] End-to-end receipt download pipeline for SPE-stored files
- [x] Expense "View Receipt" and invoice receipt bundler using direct Graph API
- [x] Container management interface for administrators
- [x] Custom column support with SharePoint-safe naming conventions
- [x] File stats and document type breakdown fixes

### Program Estimate Type ✅ COMPLETE
- [x] New "Program" estimate type for large-scale engagements
- [x] Week-based staffing blocks (role x weeks x utilization %)
- [x] Gantt timeline view for program blocks
- [x] PM Wizard for guided block creation
- [x] Accordion-based block editor with compact data entry
- [x] Weekly subtotals and totals display
- [x] Auto-populate rates from role catalog
- [x] CSV/Excel import and export for program blocks
- [x] Three-factor contingency system (size, complexity, confidence)
- [x] Week 0 support for pre-project activities

### Portfolio Manager Role ✅ COMPLETE
- [x] New "portfolio-manager" role (6th tier in hierarchy)
- [x] PM-level access to ALL projects (not scoped to assigned projects)
- [x] View-only expense access
- [x] External resource cost rates hidden

### HubSpot CRM Integration ✅ COMPLETE
- [x] Per-tenant OAuth 2.0 connection
- [x] CRM Deals page with date range and deal stage filters
- [x] Estimate-to-deal linking with client names and stages
- [x] Won/Lost deal linking
- [x] Contact search and import from HubSpot
- [x] Company-to-client linking
- [x] Auto-refresh tokens with 5-minute buffer

### Estimate Bug Fixes ✅ COMPLETE
- [x] Cost rate resolution: full precedence chain (manual override → estimate → client → user → role default)
- [x] Copied estimates inherit tenant ID (fixes orphaned estimates)
- [x] Estimate name editing regardless of status
- [x] Stable sort order: week first, then sort order as tiebreaker

---

## ✅ Previously Completed (February 13, 2026)

### RAIDD Log ✅ COMPLETE
- [x] Dedicated RAIDD tab within project detail page
- [x] Five entry types: Risk, Issue, Action Item, Dependency, Decision
- [x] Full lifecycle management, governance rules, Excel export
- [x] AI integration in status reports

### Portfolio RAIDD Dashboard ✅ COMPLETE
- [x] Cross-project RAIDD view with summary cards, filters, grouping, XLSX export

### AI-Powered Project Status Reports ✅ COMPLETE
- [x] AI-generated narrative summaries, weekly/monthly periods, RAIDD integration, copy/download

### "What's New" Changelog Modal ✅ COMPLETE
- [x] AI-generated summaries on login, per-user dismiss tracking, tenant admin toggle, mobile responsive

### Per Diem & Expense Automation ✅ COMPLETE
- [x] GSA Per Diem API (CONUS), OCONUS DoD rates, airport codes, exchange rates, travel day calculations

### Invoice Report Enhancements ✅ COMPLETE
- [x] Client filter, three-year data, YoY comparison, batch type filtering

### Expense Report PDF Export ✅ COMPLETE (Quick Win)

---

## ✅ Previously Completed (January 2026)

### Multi-Tenancy Architecture ✅ COMPLETE (Phases 1-4, 6)
- [x] UUID-based tenant IDs, data isolation, service plans, self-service signup
- [x] Plan lifecycle enforcement, grace periods, scheduled expiration
- [x] Platform admin UI, tenant switcher, automatic assignment
- [ ] Phase 5: Subdomain routing — DEFERRED (needs custom DNS + wildcard SSL)
- [ ] Phase 7: Security audit, data retention enforcement — ONGOING

### Retainer Estimates & Rate Overrides ✅ COMPLETE
### Resource Management & Capacity Planning ✅ COMPLETE
### Financial Reporting ✅ COMPLETE
### Microsoft Planner Integration (Phase 1) ✅ COMPLETE
### Scheduled Jobs System ✅ COMPLETE
### Mobile Web Optimization ✅ COMPLETE
### AI Help Chat & In-App Docs ✅ COMPLETE

---

## 🚨 P1 - HIGH PRIORITY

### Estimate-Level Sharing (Read-Only ACL)
**Status:** Complete
**Effort:** Medium (2-3 days)

- [x] "Share" button on estimates for PMs to invite specific users with read-only access
- [x] New `estimate_shares` table (estimate_id, user_id, granted_by, granted_at)
- [x] Shared estimates appear in the user's estimate list (read-only badge)
- [x] API-level permission checks: shared users can GET estimate data but not POST/PATCH/DELETE
- [x] Cost/chargeback rate columns hidden from shared viewers (API response filtering)
- [x] Share management UI: grant, revoke, view current shares
- [x] Shared viewer sees estimate detail, line items, totals, and Gantt — but not cost rates or margin data
- [x] Read-only banner shown to shared viewers on estimate detail page

### Quarterly Profit Distribution (Owners + FTE Bonus Pool)
**Status:** Backend shipped May 20, 2026; UI pending. Design: `docs/design/quarterly-profit-distribution.md`
**Effort:** UI remaining (~1 week)

Synozur owners (Michelle, Chris) now have an in-product mechanism for
quarterly distributions plus an FTE profit-sharing pool. Backend covers
the entire run lifecycle (draft → previewed → approved → finalized →
reversed); UI surface is the only remaining gap.

- [x] Schema: `entity_owners`, `distribution_policy`, `distribution_runs`, `distribution_lines` (migration 0028)
- [x] `is_owner` flag on `payroll_employees` so owner-employees don't double-dip in FTE pool
- [x] Available-funds engine (cash-basis: revenue collected − non-reimbursable opex − payroll burden − tax reserve − operating reserve − WA B&O accrual)
- [x] Owner pool allocation by ownership percent (with penny-drift sweep into largest share)
- [x] FTE pool allocation by normalized salary/tenure/performance/hours weights (defaults: 60/10/20/10)
- [x] FSM: draft → previewed → approved → finalized → reversed (mirrors payroll runs)
- [x] Owner non-payroll NACHA file (reuses `buildNachaFile` with the tenant's existing ACH originator profile, separate from the payroll NACHA file)
- [x] FTE payout creates a draft supplemental payroll run (`runType: 'bonus'`), bonusCents per line — admin previews/finalizes through the existing payroll page
- [x] WA B&O accrual line in available-funds calc (configurable `wa_bo_rate_pct`)
- [x] Full REST API: `/api/distributions/owners`, `/policy`, `/runs`, `/runs/:id/{preview,approve,finalize,reverse}`
- [ ] Admin UI page `/distributions` mirroring `/payroll/runs`
- [ ] Performance review row per employee per quarter (today defaults to 3/5 mid)
- [ ] Owners' bank account capture UI (today the field exists but no form)
- [ ] Distribution-policy edit UI (today only via PATCH `/api/distributions/policy`)
- [ ] Open questions for owners (still): entity tax election, reserve percentages, FTE weighting, payout cadence, fixed-date vs approve-then-pay (see design §9)

### Inbound 1099 Receipts (We Receive a 1099 from a Client) — RULED OUT
**Status:** Out of scope for Constellation (May 20, 2026 decision)
**Rationale:** Bookkeeping/GL territory. Belongs in the QuickBooks Online
integration, not here. AR is already tracked via invoices/payments.

### QuickBooks Online Integration
**Status:** Planned — #1 user-requested feature (94 marketplace coins, Feb 2026 feedback)
**Effort:** High (8-12 weeks)

- [ ] OAuth2 authentication with QuickBooks Online
- [ ] Client → QBO Customer mapping interface
- [ ] Role/Service → QBO Items mapping
- [ ] Expense categories → QBO Account mappings
- [ ] Invoice Batch → QBO Invoice (Draft) creation
- [ ] Batch ID deduplication to prevent duplicates
- [ ] Webhook integration for sync status
- [ ] QBO sync dashboard with error reporting
- [ ] Retry mechanism for failed syncs

### Advanced Resource Management
**Status:** Complete — All 6 phases implemented (`docs/design/advanced-resource-management.md`)
**Effort:** High (~7-8 weeks, 6 phases)

- [x] Phase 1: Multi-role capability mapping & per-person capacity profiles
- [x] Phase 2: Planner sync protection for generic roles
- [x] Phase 3: Smart assignment suggestions with cost variance
- [x] Phase 4: Cross-project workload view & rebalancing dashboard
- [x] Phase 5: Capacity planning analytics & KPIs
- [x] Phase 6: Bulk import & polish

### Microsoft 365 Teams Integration
**Status:** Phase 2 complete — SharePoint provisioning, member sync, guest invitations
**Effort:** Medium (2-3 weeks remaining for bidirectional sync & project creation UI)

- [x] Planner one-way sync ✅
- [x] Database schema for Teams/Channels/Planner ✅
- [x] Automatic Team creation for new clients ✅
- [x] Channel creation for subsequent projects ✅
- [x] SharePoint site provisioning with Team ✅ (Phase 2)
- [x] Team member management (add/remove from assignments) ✅ (Phase 2)
- [x] Guest user invitation workflows ✅ (Phase 2)
- [x] Automation audit logging ✅ (Phase 2)
- [x] Planner sync robustness: last-write-wins + admin alerts ✅ (Task #126, v2.5)
- [ ] Planner Phase 2: Bidirectional sync via Graph webhooks (still polling-based)
- [ ] Planner Phase 2: Multitenant app registration
- [ ] Teams Phase 3: SharePoint Living Updates (on-demand + scheduled news posts)
- [ ] Project creation UI with M365 options

### Codebase Modularization
**Status:** Planned — Pattern established with `platform.ts` extraction
**Effort:** Medium (4-6 weeks)

- [ ] Phase 1: Route extraction (13 domain modules from routes.ts)
- [ ] Phase 2: Storage layer extraction (8 domain modules from storage.ts)
- [ ] Phase 3: Shared middleware & utilities extraction

---

## 📊 P2 - IMPORTANT FEATURES

### Advanced Financial Reporting
**Status:** Partially complete — YoY, client filter, and SQL-aggregation rewrite done
**Effort:** Medium (4-6 weeks)

- [x] Year-over-year revenue analysis ✅
- [x] Client filter on reports ✅
- [x] Financial-comparison report SQL aggregation rewrite (Task #117, v2.5) ✅
- [ ] Client contribution analysis and rankings
- [ ] Service line revenue breakdown
- [ ] Revenue forecasting based on pipeline
- [ ] Estimate vs Actual accuracy metrics (portfolio-wide)
- [ ] Variance analysis by project type, client, team member
- [ ] Interactive dashboard with drill-down

### Commercial Schemes: Milestone Fixed Fee
**Status:** Planned
**Effort:** Medium (3-4 weeks)

- [ ] Milestone definition with acceptance criteria
- [ ] Percentage complete tracking
- [ ] Milestone payment scheduling & partial billing
- [ ] Client acceptance workflow with digital sign-off
- [ ] Milestone variance reporting

### Commercial Schemes: Enhanced T&M
**Status:** Planned
**Effort:** Medium (2-3 weeks)

- [ ] Rate calculation at service date
- [ ] Not-to-exceed (NTE) budget tracking with alerts
- [ ] T&M profitability analysis
- [ ] Progress-to-budget real-time reporting

### Pricing Privacy & Rate Management
**Status:** Planned
**Effort:** Medium (2-3 weeks)

- [ ] Separate rack rates (internal) from charge rates (client-facing)
- [ ] Rate margin calculations and reporting
- [ ] Field-level security to hide cost data from non-admin roles
- [ ] Rate grandfathering for existing engagements

### Notifications System ✅ COMPLETE
**Status:** Complete (May 2026, v2.5) — see "Recently Completed" above. Previously deprioritized; delivered ahead of plan.
**Effort:** Medium (4-6 weeks) — actual

- [x] In-app notification center (bell icon, dropdown, full page)
- [x] Email notifications via SendGrid (weekly digest with per-tenant schedule, open tracking)
- [x] User preferences with granular per-type controls
- [x] Browser push notifications (opt-in)
- [x] Notification hooks for time entry reminders, expense approvals, budget alerts, deadline reminders, sign-offs, RAIDD updates

**Future Enhancements (not yet started):**
- [ ] Admin-broadcast notifications (tenant-wide announcements)
- [ ] Mobile push notifications (native apps)
- [ ] SMS channel via Twilio

### Estimate Adjustment Factors - System Defaults
**Status:** Planned
**Effort:** Low (1 week)

- [ ] Admin UI for default Size, Complexity, and Confidence factors
- [ ] Estimate-level override toggle (inherit vs custom)
- [ ] Impact preview before applying changes

### SharePoint Embedded UI ✅ COMPLETE
**Status:** Complete (March 10, 2026)
**Effort:** Medium (3-4 weeks)

- [x] Container management interface
- [x] Document metadata templates and custom columns
- [x] File Repository with document type inference and metadata panel
- [x] Document search with metadata filtering
- [x] File reorganization tools
- [ ] Permission management interface — DEFERRED
- [ ] Bulk document operations — DEFERRED
- [ ] Version history viewer — DEFERRED
- [ ] Document approval workflow — DEFERRED

### Document Management Enhancements
**Status:** Planned
**Effort:** Medium (3-4 weeks)

- [ ] MSA/NDA document tracking with expiration alerts
- [ ] Contract document repository with versioning
- [ ] Document templates library
- [ ] E-signature integration (DocuSign)

### Advanced Dashboard Features
**Status:** Planned
**Effort:** Medium (2-3 weeks)

- [ ] Customizable dashboard widgets
- [ ] Executive dashboard view
- [ ] Drill-down capabilities
- [ ] Scheduled dashboard emails

### Time Tracking UX Improvements
**Status:** Planned
**Effort:** Low (1-2 weeks)

- [ ] User-scoped default view (my time vs all time)
- [ ] Timer-based tracking with start/stop
- [ ] Missing entry detection
- [ ] Persist view preferences per user

### Orphaned Invoice PDF File Cleanup (Task #22)
**Status:** Planned
**Effort:** Low (2-3 days)

Invoice PDF files stored in SharePoint/object storage are never removed when a batch is deleted, and the regeneration path silently swallows delete errors — leaving orphaned and duplicate files accumulating in storage indefinitely.

- [ ] Delete stored PDF automatically when a batch is deleted (hook into `deleteInvoiceBatch()`)
- [ ] Admin endpoint `POST /api/admin/purge-orphan-invoice-pdfs` with `?dryRun=true` support — lists all stored files, cross-references against live `pdfFileId` values, deletes unmatched, returns summary
- [ ] Harden the "delete old version before regenerate" step: replace silent catch with a logged warning (batchId + file ID) so storage failures are visible in production logs
- [ ] Run purge against production after deploy to clear pre-existing orphans

---

## 🤖 P3 - AI & AUTOMATION

### AI-Enhanced Workflows
**Status:** Future
**Effort:** High (8-12 weeks)

- [ ] Receipt OCR with auto-extraction and category prediction
- [ ] Weekly time entry suggestions based on patterns
- [ ] Anomaly and duplicate detection
- [ ] Estimate intelligence: similar project suggestions, risk identification

### MCP Server (Model Context Protocol) ✅ COMPLETE
**Completed:** March 2026 (v1.7) — See "Recently Completed" section above.

### Persistent Status Reports ✅ COMPLETE
**Completed:** March 2026 (v1.7) — See "Recently Completed" section above.

**Future Enhancements (not yet started):**
- [ ] SPE file storage for PPTX reports (currently saved to DB only)
- [ ] Bulk delete option for cleaning up older drafts
- [ ] Auto-archive reports older than N months
- [ ] Scheduled automatic report generation and email delivery

---

## 🔗 P4 - PLATFORM CAPABILITIES (2026+)

### Accounts Payable (AP) - Contractor Payment Management
**Status:** Planned
**Effort:** Very High (8-13 weeks, 6 phases)

- [ ] Contractor invoice submission, matching, and payment tracking
- [ ] Finance menu restructure (AR + AP)
- [ ] PDF upload with SharePoint storage
- [ ] Split-view invoice matching interface
- [ ] Cost rate validation with variance alerts
- [ ] Approval and payment workflow
- [ ] AP reporting (payment history, pending invoices, aging)

### Cloud Deployment Migration: GCP → Azure
**Status:** Planned — Replit engineering task
**Effort:** Medium (coordination with Replit engineering)

- [ ] Migrate Constellation hosting from GCP to Azure infrastructure
- [ ] Coordinate with Replit engineering team for deployment target change
- [ ] Validate all environment variables and secrets transfer correctly
- [ ] Verify database connectivity and performance on Azure
- [ ] Test SharePoint Embedded and Microsoft Graph API latency improvements (same-cloud advantage)
- [ ] Validate AI Foundry endpoint connectivity from Azure-hosted environment
- [ ] Update deployment documentation and runbooks
- [ ] Smoke test all integrations (HubSpot, SendGrid, Outlook, SharePoint) post-migration

### SPE File Lifecycle & Orphan Cleanup
**Status:** Design Required
**Effort:** Medium (3-5 weeks)

- [ ] Design cleanup strategy for SharePoint Embedded files tied to draft or deleted invoices, deleted expenses, and other transient artifacts
- [ ] Identify and catalog all SPE file creation points (invoice PDFs, expense receipts, SOW documents, deliverable attachments, etc.)
- [ ] Define retention policies: which files should be soft-deleted, hard-deleted, or archived when their parent record is removed
- [ ] Build orphan detection service: find SPE files with no matching database record (e.g., invoice PDF exists but batch was deleted, receipt uploaded but expense was removed)
- [ ] Implement periodic cleanup job (scheduled task) to flag or remove orphaned files based on retention rules
- [ ] Consider discoverability impact: ensure deleted/draft artifacts are excluded from MCP and Copilot queries so AI assistants don't surface stale data
- [ ] Add admin UI for reviewing orphaned files before permanent deletion (safety net)
- [ ] Handle edge cases: files referenced by multiple records, files in tenant-specific vs shared containers, migration-era files with null tenantId

### Extended Integrations
**Status:** Future

- [ ] Salesforce CRM integration
- [ ] Xero / NetSuite accounting
- [ ] Slack notifications and commands
- [ ] Jira / Azure DevOps linking

### API Platform
**Status:** Future

- [ ] Public REST API v2 with OpenAPI docs
- [ ] API key management and rate limiting
- [ ] Webhook management
- [ ] Developer portal with SDKs

### Internationalization & Localization
**Status:** Future

- [ ] Multi-language support (Spanish, French, German)
- [ ] Multi-currency with real-time FX
- [ ] Regional compliance (GDPR, local tax)

### Advanced Security & Compliance
**Status:** Future

- [ ] SOC 2 Type II preparation
- [ ] Data retention policies and right-to-be-forgotten
- [ ] Passwordless / FIDO2 authentication

### Client Portal
**Status:** Deprioritized

- [ ] Client project dashboard, invoice viewing, document sharing
- [ ] Change request submission, secure messaging

---

## 📋 SUMMARY

### Active Backlog by Priority

| Priority | Items | Est. Effort |
|----------|-------|-------------|
| P1 - High | 3 active items (QBO, Teams Phase 3 + Planner Phase 2 webhook/multitenant, Codebase Modularization) | 18-24 weeks |
| P2 - Important | 9 active items | 18-28 weeks |
| P3 - AI/Automation | 2 items | 11-16 weeks |
| P4 - Platform | 7 items | 34+ weeks |

### Notes on Already Implemented Features (NOT in backlog)
- ✅ Expense bulk upload with CSV/Excel
- ✅ MFA via Azure Entra ID
- ✅ Project and estimate milestones
- ✅ Basic burn rate tracking
- ✅ Estimate accuracy reporting
- ✅ Portfolio metrics
- ✅ Time/expense import templates
- ✅ Change order management
- ✅ SOW management
- ✅ Invoice batch PDF generation
- ✅ Financial reports API endpoints
- ✅ Dashboard KPIs
- ✅ Program estimates with Gantt view
- ✅ HubSpot CRM integration
- ✅ Portfolio Manager role
- ✅ Per Diem (CONUS + OCONUS)
- ✅ "What's New" changelog modal
- ✅ AI status reports with RAIDD
- ✅ SharePoint Embedded document storage with File Repository
- ✅ Galaxy Client Portal API (OAuth2, scoped tokens, signed webhooks, document streaming)
- ✅ Notifications System (bell, push, weekly digests, SendGrid open tracking)
- ✅ Multi-currency estimates and Sub-SOW propagation
- ✅ Excel-like time grid 2.0 with virtualisation and series drag-fill
- ✅ Estimate version history with snapshot restore
- ✅ Client portal approvals & sign-offs with audit log
- ✅ Payment milestone billing automation
- ✅ AI Project Manager Agent
- ✅ Planner sync LWW + admin alerts
