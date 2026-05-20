# Constellation - Synozur Consulting Delivery Platform (SCDP)

## Overview
Constellation is a comprehensive platform for managing the entire consulting project lifecycle, from estimation and resource allocation to time tracking, expense management, and automated invoice generation. It aims to enhance efficiency, streamline operations, and support data-driven consulting practices through features like AI-powered narrative generation and automated expense calculations. The platform prioritizes improved file management, transparent quote displays, advanced resource capacity planning, and milestone-based invoice generation.

## Key Features Added
- **Weekly Digest Emails**: Scheduled HTML digest emails for each user with open assignments, pending approvals, RAIDD items, upcoming milestones, PM project health, and personal time/expense status. Users can enable/disable, set preferred day and time via Notification Preferences. "Send me a preview" button triggers an immediate digest. Admins can run digests manually and view delivery stats from the Scheduled Jobs page.
  - Schema: `digest_sends` table (idempotency + delivery tracking), `weekly_digest_enabled/day/time` columns on `users`
  - Service: `server/services/weekly-digest-service.ts` (builder + HTML email renderer + sender)
  - Scheduler: `server/services/weekly-digest-scheduler.ts` (node-cron per tenant, mirrors other schedulers)
  - Routes: `GET/PUT /api/me/digest-preferences`, `POST /api/me/digest/preview`, `GET /api/admin/digests/stats`, `POST /api/admin/weekly-digest/run`
  - UI: Weekly Digest card in `/notification-preferences`, Weekly Digest job card in `/scheduled-jobs`

## User Preferences
Preferred communication style: Simple, everyday language.
**STANDING INSTRUCTION — MERGED PRs**: Every time a task agent PR is merged into main, immediately inspect and integrate the incoming code with special attention to: (1) schema integrity — check for new/modified tables, columns, indexes, and foreign keys in `shared/schema.ts` and run `npm run db:push` if the schema changed; (2) database safety — verify all new queries enforce the tenant boundary (`tenantId` from session, never from client); (3) storage wiring — confirm new storage methods are added to `IStorage` and wired into `DatabaseStorage`; (4) route registration — confirm new route files are registered in `server/routes.ts`; (5) dependency conflicts — check `package.json` for version collisions. Report any issues found before considering the merge complete.
User management should be consolidated into a single, unified view (like Vega) rather than separate admin pages.
Prefer scope-based filtering over separate "Platform Users" vs "Tenant Users" pages.
Multi-tenant user model: A user in one tenant can be a client in another tenant, so NO separate client_contacts table. Use the existing users table for all people across tenants.
**CRITICAL**: `attached_assets/` is ONLY for temporary scratch files. NEVER store application assets (logos, images, etc.) there. All permanent assets must live in the source tree (e.g., `client/src/assets/logos/`) so they survive cleanup and are included in published builds.
**CRITICAL FONT RULE**: The ONLY font allowed in the application is the **Avenir Next Lt Pro** family. NEVER use Inter, system-ui, or any other font. Font files are in `client/public/fonts/`. The CSS `@font-face` declarations and Tailwind `fontFamily` config must always point to `'Avenir Next LT Pro'`.
**CRITICAL — TENANT DATA BOUNDARY PROTECTION**: Every database query that touches tenant-scoped data MUST include a `tenantId` filter derived from the server-side session (`req.user?.activeTenantId || req.user?.primaryTenantId || req.user?.tenantId`). NEVER trust a `tenantId` value supplied by the client in query parameters or request body for access-control decisions. Cross-tenant data leakage is a critical security vulnerability. When joining across tables, always verify the tenant boundary is enforced on the authoritative table (e.g., `projects.tenantId`, not a foreign-key join that could traverse tenant boundaries). New routes and storage methods must be reviewed against this rule before shipping.

## System Architecture

### Frontend
- **Framework**: React 18 with TypeScript and Vite.
- **UI**: Radix UI components with shadcn/ui design system, styled using Tailwind CSS.
- **UI/UX Decisions**: Refactored estimate tables, mobile optimization, responsive navigation, user persona-based navigation, prominent quote totals, dark/light mode, advanced project list/detail views, and standardized project selectors.
- **Theme System**: Modular CSS variable-based theming with Aurora, Night Sky, and Navigator's Chart themes.

### Backend
- **Runtime**: Node.js with Express.js.
- **Language**: TypeScript (ES modules).
- **API**: RESTful.
- **ORM**: Drizzle ORM.
- **Validation**: Zod schemas.

### Database
- **Type**: PostgreSQL.
- **Schema Management**: Drizzle Kit.
- **Key Entities**: Users, Clients, Projects, Estimates, Time entries, Expenses, Invoices, Payment Milestones, Rate overrides, Project Engagements.

### Project Structure
- **Monorepo**: Organized into `/client`, `/server`, and `/shared`.
- **Storage Layer**: Modularized into `server/storage/` with domain-focused modules:
  - `index.ts` - IStorage interface, DatabaseStorage class composition, resolveRatesForTimeEntry, singleton export
  - `helpers.ts` - Shared utility functions (normalizeAmount, round2, formatDateToYYYYMMDD, etc.)
  - `pdf-generation.ts` - Invoice and Sub-SOW PDF generation functions
  - Domain modules: `users.ts`, `projects.ts`, `estimates.ts`, `time-entries.ts`, `expenses.ts`, `invoicing.ts`, `admin.ts`, `documents.ts`, `planner.ts`, `tenant.ts`
  - `server/storage.ts` is a thin re-export barrel that preserves all existing import paths (`import { storage } from "../storage"`)

### Authentication & Authorization
- **Production SSO**: Azure AD (Microsoft Entra ID).
- **Development Auth**: Local email/password.
- **Roles**: Six-tier hierarchy with feature-based permissions.

### Document Storage
- **Strategy**: Multi-tier using SharePoint Embedded (primary) and Replit Object Storage (legacy fallback) with smart routing based on tenant configuration.
- **Tenant SPE Opt-in**: Tenants can configure individual SharePoint Embedded containers, ensuring per-tenant Azure AD isolation.

### Core Features
- **AI Integration**: Multi-provider AI (Replit AI, Azure AI Foundry) with configurable models, usage logging, and cost tracking. Includes AI-powered narrative generation and structured estimate generation.
- **Estimate Management**: Supports Excel/CSV import/export, status-based locking, hierarchical rate precedence, and various estimate types. Includes full **Version History** system: auto-snapshots on Send/Approve, manual save, side-by-side diff comparison, and restore-as-draft. Powered by `estimate_versions` table and `EstimateVersionService`.
- **Invoice & Document Management**: Automated generation, PDF handling, milestone-based invoicing, and expense receipt inclusion.
- **Expense Approval Workflow**: Comprehensive system with finite state machine and role-based access.
- **Time Entry Approval Workflow**: Time entries follow a `draft → submitted → approved/rejected` lifecycle. When "Require time entry approval before billing" is enabled in Organization Settings (Financial tab), only approved entries appear in billing batches. Managers review submissions at `/approvals/time`. Email notifications sent on submit, approve, and reject. New schema fields: `submissionStatus`, `submittedAt`, `submittedBy`, `approvedBy`, `approvedAt`, `rejectionNote` on `time_entries`; `requireTimeApproval` on `tenants`.
- **Resource Management**: Dual List/Timeline views, capacity planning, and conflict detection.
- **Assignment Baselines**: Snapshot current assignments for future analysis, excluded from normal views.
- **Slippage Analytics Engine**: Composite slippage scoring per project based on weighted signals (Schedule Position, Assignment Health, Milestone Health, RAIDD Signals, Velocity Lag).
- **Microsoft Planner Integration**: Bidirectional synchronization of project assignments with Microsoft Planner tasks.
- **Scheduled Jobs**: Background system for reminders and Planner sync.
- **Financial Reporting**: Comprehensive reports on revenue, cost, profit, and margins.
- **Contractor Expense Invoices**: Contractors can generate invoices from expense reports.
- **Project Rate Overrides**: Project-level billing and cost rate overrides.
- **Bulk Role-to-Person Reassignment**: Facilitates bulk updates of assignments when changing roles.
- **Deliverable Tracking**: Management of project deliverables with status workflows and AI narrative extraction.
- **Persistent Status Reports**: AI-generated status reports (text + PPTX) saved and managed via CRUD API.
- **MCP Server (v0 — Read-Only)**: Read-only API surface under `/mcp` for Microsoft 365 Copilot / Copilot Studio integration, with session and OAuth bearer token authentication.
- **A2A Agent Card**: Agent discovery endpoint at `/.well-known/agent.json`. Skills and static metadata live in `server/a2a/agent-card-data.ts` (single source of truth). The static snapshot at `client/public/.well-known/agent.json` must be kept in sync by running `npx tsx scripts/gen-agent-card.ts [--base-url https://your-domain.com]` after any skill or metadata changes. Defaults to `https://constellation.synozur.com`.
- **Copilot Studio Agent**: Conversational AI agent for Teams and M365 Copilot, using Power Platform Custom Connector to access MCP endpoints.
- **Teams Custom Tab**: Embeddable, chromeless project detail pages for Microsoft Teams Custom Tab integration, with SSO authentication.
- **Teams App Package Self-Service**: Organization Settings feature to download or publish the Teams app manifest package dynamically.
- **Teams Tab Auto-Install**: Automated installation of project dashboard tabs in Teams channels upon creation.
- **M365 Channel Provisioning Defaults**: Tenant-level default folder list auto-created in a channel's SharePoint document library during channel provisioning.
- **SharePoint Site Configuration**: Tenant-level settings for future SharePoint provisioning enhancements.

### Multi-Tenancy
- **Architecture**: UUID-based tenant IDs, data isolation, service plans, and subdomain routing.
- **Automatic Tenant Assignment**: Users are auto-assigned to tenants on login.
- **Platform Roles**: `global_admin` and `constellation_admin` roles for managing all tenants.
- **Settings Separation**: Tenant-specific settings and platform-wide settings.
- **User Management**: Tenant-isolated user listings and platform admin tools for user membership across tenants.
- **Branding & Vocabulary**: Configurable tenant-level branding and vocabulary.
- **Multi-Tenant Identity**: Uses a global `users` table and `tenant_users` for tenant-specific access and roles.

## External Dependencies

- **Database Hosting**: Neon Database (PostgreSQL).
- **Frontend Build**: Vite.
- **UI Libraries**: Radix UI, Lucide React, Tailwind CSS.
- **Data Management**: TanStack Query, React Hook Form.
- **PDF Generation**: Puppeteer.
- **Document Storage**: Replit Object Storage, Microsoft SharePoint Online, Microsoft SharePoint Embedded.
- **Email Notifications**: Outlook/Microsoft 365 via Microsoft Graph Client.
- **AI Integration**: Replit AI (OpenAI GPT-5 compatible API), Azure OpenAI, Azure AI Foundry.
- **Per Diem Rates**: GSA Per Diem API (CONUS) and DoD OCONUS rates database.
- **Airport Codes**: IATA 3-letter code database.
- **Exchange Rates**: Open Exchange Rates API.
- **HubSpot CRM Integration**: HubSpot API for Deals, Companies, Contacts, and activity logging.