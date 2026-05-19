# Constellation - Synozur Consulting Delivery Platform (SCDP)

## What This App Is
A comprehensive consulting project lifecycle platform: estimation, resource allocation, time tracking, expense management, and automated invoice generation. Multi-tenant SaaS for consulting firms.

## Tech Stack
- **Frontend**: React 18 + TypeScript + Vite, Radix UI / shadcn/ui, Tailwind CSS
- **Backend**: Node.js + Express.js + TypeScript (ES modules), RESTful API
- **ORM**: Drizzle ORM with Drizzle Kit for schema management
- **Validation**: Zod schemas
- **Database**: PostgreSQL (hosted on Neon)
- **PDF**: Puppeteer

## Project Structure
- Monorepo: `/client`, `/server`, `/shared`

## Critical Rules
- **FONT**: ONLY use **Avenir Next Lt Pro** family. NEVER use Inter, system-ui, or any other font. Font files in `client/public/fonts/`. CSS `@font-face` and Tailwind `fontFamily` must point to `'Avenir Next LT Pro'`.
- **Assets**: `attached_assets/` is ONLY for temporary scratch files. NEVER store permanent assets there. Use `client/src/assets/logos/` etc.
- **User Model**: Multi-tenant — a user in one tenant can be a client in another. NO separate client_contacts table. Use the existing `users` table for all people.
- **User Management UI**: Single unified view (like Vega), NOT separate admin pages. Scope-based filtering, not separate "Platform Users" vs "Tenant Users" pages.

## Auth
- **Production**: Azure AD (Microsoft Entra ID) SSO
- **Development**: Local email/password
- **Roles**: Six-tier hierarchy with feature-based permissions
- **Platform Roles**: `global_admin` and `constellation_admin` for cross-tenant management

## Multi-Tenancy
- UUID-based tenant IDs, data isolation, subdomain routing
- Global `users` table + `tenant_users` for tenant-specific access/roles
- Auto-assignment on login
- Tenant-specific settings, branding, and vocabulary

## Document Storage
- Multi-tier: SharePoint Embedded (primary) + Replit Object Storage (legacy fallback)
- Tenant opt-in via `speStorageEnabled` flag
- Per-tenant Azure AD isolation for file operations
- SPE billing to Synozur, not customers

## Key Features
- AI Integration: Multi-provider (Replit AI, Azure AI Foundry), usage logging/cost tracking, token budget alerts
- Estimate Management: Excel/CSV import/export, AI-driven text export, status-based locking, hierarchical rate precedence, multiple estimate types
- Invoice & Document Management: Automated generation, PDF, milestone-based invoicing
- Expense Approval Workflow: FSM + role-based access
- Resource Management: Dual List/Timeline views, capacity planning, conflict detection
- Microsoft Planner Integration: Bidirectional sync
- Financial Reporting: Revenue, cost, profit, margins
- Deliverable Tracking: Status workflows, AI narrative extraction
- Persistent Status Reports: AI-generated (text + PPTX), saved to DB, CRUD API
- MCP Server (v0 — Read-Only): ~24 GET endpoints under `/mcp` for M365 Copilot integration, supports session + OAuth bearer auth
- Copilot Studio Agent: Conversational AI for Teams/M365, uses Power Platform Custom Connector
- Teams Custom Tab: Embeddable project detail pages at `/embed/projects/:id`, chromeless layout, Teams SDK v2 SSO
- HubSpot CRM Integration: Per-tenant OAuth 2.0 for Deals, Companies, Contacts
- Contractor Expense Invoices, Project Rate Overrides, Scheduled Jobs (reminders, Planner sync)

## External Services
- Neon Database (PostgreSQL)
- Microsoft Graph (email notifications)
- GSA Per Diem API (CONUS) + DoD OCONUS rates
- IATA airport codes database
- Open Exchange Rates API
- HubSpot API

## Planning & Documentation Files (READ BEFORE PLANNING WORK)
When planning new features, enhancements, or prioritizing work, ALWAYS consult these files first:
- **`docs/USER_GUIDE.md`** — The canonical user guide (v1.7). Describes all features, workflows, roles, and integrations from the user's perspective. Use this to understand how features should behave and to keep new work consistent with documented behavior. Also mirrored at `client/public/docs/USER_GUIDE.md` for in-app access. Detailed guides in `docs/user-guide/`.
- **`backlog.md`** — The product backlog (v5.0). Lists completed items, in-progress work, and prioritized future items. Check this BEFORE starting any new feature to avoid duplicating work or conflicting with planned items. Update it when completing backlog items.
- **`docs/ROADMAP.md`** — The strategic product roadmap. Covers vision, quarterly priorities (Q1/Q2 2026), medium-term goals (H2 2026), and long-term vision (2027+). Use this to understand strategic direction and ensure new work aligns with product priorities.
- **`docs/CHANGELOG.md`** — Release history. Reference when tracking what shipped and when.

## Communication Style
Simple, everyday language.

## Pull Request Workflow (durable preference)
When you create a NEW pull request for this repo in any session:
1. Immediately call `mcp__github__subscribe_pr_activity` for that PR — do not wait to be asked.
2. Watch for review comments and CI events that arrive as `<github-webhook-activity>` messages.
3. For each actionable review comment, investigate, push a fix on the PR branch, and post a reply to that specific comment describing what changed (or, if it can't be actioned, why). Use `mcp__github__add_reply_to_pull_request_comment` so the resolution threads to the original — every comment should end up with a visible reply so it is obvious what is resolved vs. still open.
4. For CI failures, diagnose, push the fix, and let the next green CI event speak for itself — no need to comment on every kick.
5. Stop only when the user explicitly says to unsubscribe, or when the PR is merged/closed.
