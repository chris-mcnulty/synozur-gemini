import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, decimal, timestamp, boolean, date, jsonb, uuid, uniqueIndex, index, unique } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Estimate status enum
export const estimateStatusEnum = z.enum(['draft', 'final', 'sent', 'approved', 'rejected']);
export type EstimateStatus = z.infer<typeof estimateStatusEnum>;

// Expense approval status enum
export const expenseApprovalStatusEnum = z.enum(['draft', 'submitted', 'approved', 'rejected', 'reimbursed']);
export type ExpenseApprovalStatus = z.infer<typeof expenseApprovalStatusEnum>;

// Plan status enum
export const planStatusEnum = z.enum(['active', 'trial', 'expired', 'cancelled', 'suspended']);
export type PlanStatus = z.infer<typeof planStatusEnum>;

// TenantBranding type for jsonb field
export type TenantBranding = {
  primaryColor?: string;
  secondaryColor?: string;
  accentColor?: string;
  fontFamily?: string;
  tagline?: string;
  reportHeaderText?: string;
  reportFooterText?: string;
};

export type M365SharePointConfig = {
  autoCreateProjectSubfolder?: boolean;
  docLibraryNaming?: 'channel_name' | 'project_code' | 'custom';
  docLibraryCustomPattern?: string;
  metadataColumns?: string[];
};

// ============================================================================
// MULTI-TENANCY TABLES (Phase 1 - Matches Vega Architecture)
// ============================================================================

// Service Plans (Subscription Tiers)
export const servicePlans = pgTable("service_plans", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  internalName: varchar("internal_name", { length: 100 }).notNull().unique(),
  displayName: varchar("display_name", { length: 255 }).notNull(),
  description: text("description"),
  
  // Plan type: trial, team, enterprise, unlimited
  planType: varchar("plan_type", { length: 50 }).notNull(),
  
  // Limits (null = unlimited)
  maxUsers: integer("max_users").default(5),
  maxProjects: integer("max_projects"),
  maxClients: integer("max_clients"),
  
  // Features
  aiEnabled: boolean("ai_enabled").default(true),
  sharePointEnabled: boolean("sharepoint_enabled").default(false),
  ssoEnabled: boolean("sso_enabled").default(false),
  customBrandingEnabled: boolean("custom_branding_enabled").default(false),
  coBrandingEnabled: boolean("co_branding_enabled").default(true),
  subdomainEnabled: boolean("subdomain_enabled").default(false),
  plannerEnabled: boolean("planner_enabled").default(false),
  
  // Trial settings
  trialDurationDays: integer("trial_duration_days"),
  
  // Pricing (internal billing for MVP)
  monthlyPriceCents: integer("monthly_price_cents"),
  annualPriceCents: integer("annual_price_cents"),
  billingCycle: varchar("billing_cycle", { length: 20 }), // monthly, annual, both
  
  // Status
  isActive: boolean("is_active").default(true),
  isDefault: boolean("is_default").default(false),
  displayOrder: integer("display_order").default(0),
  
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

// Tenants (Organizations) - Matches Vega structure
export const tenants = pgTable("tenants", {
  // Core identity
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull().unique(),
  slug: varchar("slug", { length: 100 }).notNull().unique(),
  
  // Branding
  color: text("color"),
  logoUrl: text("logo_url"),
  logoUrlDark: text("logo_url_dark"),
  faviconUrl: text("favicon_url"),
  customSubdomain: text("custom_subdomain"),
  branding: jsonb("branding").$type<TenantBranding>(),
  
  // Company Contact Info (for invoices/documents)
  companyAddress: text("company_address"),
  companyPhone: text("company_phone"),
  companyEmail: text("company_email"),
  companyWebsite: text("company_website"),
  paymentTerms: text("payment_terms"),
  
  // Domain & SSO
  allowedDomains: jsonb("allowed_domains").$type<string[]>(),
  azureTenantId: text("azure_tenant_id"),
  enforceSso: boolean("enforce_sso").default(false),
  allowLocalAuth: boolean("allow_local_auth").default(true),
  inviteOnly: boolean("invite_only").default(false),
  
  // M365 Connectors
  connectorSharePoint: boolean("connector_sharepoint").default(false),
  connectorOutlook: boolean("connector_outlook").default(false),
  connectorPlanner: boolean("connector_planner").default(false),
  adminConsentGranted: boolean("admin_consent_granted").default(false),
  adminConsentGrantedAt: timestamp("admin_consent_granted_at"),
  adminConsentGrantedBy: varchar("admin_consent_granted_by"),
  
  // Customization
  fiscalYearStartMonth: integer("fiscal_year_start_month").default(1),
  defaultTimezone: varchar("default_timezone", { length: 50 }).default("America/New_York"),
  vocabularyOverrides: jsonb("vocabulary_overrides").$type<Record<string, string>>(),
  
  // Service Plan / Licensing
  servicePlanId: varchar("service_plan_id").references(() => servicePlans.id),
  planStartedAt: timestamp("plan_started_at"),
  planExpiresAt: timestamp("plan_expires_at"),
  planStatus: text("plan_status").default("active"),
  
  // Signup metadata
  selfServiceSignup: boolean("self_service_signup").default(false),
  signupCompletedAt: timestamp("signup_completed_at"),
  organizationSize: text("organization_size"),
  industry: text("industry"),
  location: text("location"),
  
  // Invoice branding
  showConstellationFooter: boolean("show_constellation_footer").default(true), // Show "Generated by Constellation" footer on invoices
  
  // Email branding
  emailHeaderUrl: text("email_header_url"), // Optional email header image for outgoing emails
  
  // Financial Defaults (tenant-scoped, not system-wide)
  defaultBillingRate: decimal("default_billing_rate", { precision: 10, scale: 2 }).default('0'),
  defaultCostRate: decimal("default_cost_rate", { precision: 10, scale: 2 }).default('0'),
  mileageRate: decimal("mileage_rate", { precision: 10, scale: 4 }).default('0.70'),
  defaultTaxRate: decimal("default_tax_rate", { precision: 5, scale: 2 }).default('0'),
  invoiceDefaultDiscountType: text("invoice_default_discount_type").default('percent'),
  invoiceDefaultDiscountValue: decimal("invoice_default_discount_value", { precision: 10, scale: 2 }).default('0'),
  autoCreateInvoiceOnMilestoneInvoiced: boolean("auto_create_invoice_on_milestone_invoiced").notNull().default(true),

  // Feature Settings
  showChangelogOnLogin: boolean("show_changelog_on_login").default(true), // Show "What's New" modal to users on login

  // Notification Settings
  expenseRemindersEnabled: boolean("expense_reminders_enabled").default(false),
  expenseReminderTime: varchar("expense_reminder_time", { length: 5 }).default("08:00"),
  expenseReminderDay: integer("expense_reminder_day").default(1),
  requireTimeApproval: boolean("require_time_approval").default(false),
  digestDefaultDay: integer("digest_default_day").notNull().default(1), // 1=Monday … 7=Sunday
  digestDefaultTime: varchar("digest_default_time", { length: 5 }).notNull().default("08:00"), // HH:MM

  // Teams Proactive Alert Settings
  teamsAlertsEnabled: boolean("teams_alerts_enabled").default(false),
  teamsWebhookUrl: text("teams_webhook_url"),
  teamsAlertOnHealthChange: boolean("teams_alert_on_health_change").default(true),
  teamsAlertOnRaiddOverdue: boolean("teams_alert_on_raidd_overdue").default(true),
  teamsAlertOnStatusReportDue: boolean("teams_alert_on_status_report_due").default(true),
  // Structured channel routing: { default?: {teamId, channelId}, health?: {...}, raidd?: {...}, statusReport?: {...} }
  teamsNotificationChannels: jsonb("teams_notification_channels").$type<{
    default?: { teamId: string; channelId: string };
    health?: { teamId: string; channelId: string };
    raidd?: { teamId: string; channelId: string };
    statusReport?: { teamId: string; channelId: string };
  }>(),
  
  // Support Ticket Integrations
  supportPlannerEnabled: boolean("support_planner_enabled").default(false),
  supportPlannerPlanId: varchar("support_planner_plan_id", { length: 255 }),
  supportPlannerPlanTitle: text("support_planner_plan_title"),
  supportPlannerPlanWebUrl: text("support_planner_plan_web_url"),
  supportPlannerGroupId: varchar("support_planner_group_id", { length: 255 }),
  supportPlannerGroupName: text("support_planner_group_name"),
  supportPlannerBucketName: text("support_planner_bucket_name"),
  supportListsEnabled: boolean("support_lists_enabled").default(false),
  
  // GL Invoice Number Sequence
  nextGlInvoiceNumber: integer("next_gl_invoice_number").default(1000),

  // SharePoint Embedded (SPE) - Tenant-level container configuration
  speContainerIdDev: text("spe_container_id_dev"),
  speContainerIdProd: text("spe_container_id_prod"),
  speStorageEnabled: boolean("spe_storage_enabled").default(false),
  speMigrationStatus: text("spe_migration_status"),
  speMigrationStartedAt: timestamp("spe_migration_started_at"),

  // M365 Teams Integration Settings
  m365AutoProvisionTeams: boolean("m365_auto_provision_teams").default(false),
  m365DefaultTeamTemplate: text("m365_default_team_template").default("standard"),
  m365DefaultChannelFolders: jsonb("m365_default_channel_folders").$type<string[]>(),
  m365SharePointConfig: jsonb("m365_sharepoint_config").$type<M365SharePointConfig>(),
  m365DefaultPursuitTeamId: text("m365_default_pursuit_team_id"),
  m365DefaultPursuitTeamName: text("m365_default_pursuit_team_name"),

  // PPTX Slide Template File IDs (stored in SPE under /pptx_templates)
  pptxTitleTemplateFileId: text("pptx_title_template_file_id"),
  pptxTitleTemplateFileName: text("pptx_title_template_file_name"),
  pptxTitleTemplateUploadedAt: timestamp("pptx_title_template_uploaded_at"),
  pptxSectionTemplateFileId: text("pptx_section_template_file_id"),
  pptxSectionTemplateFileName: text("pptx_section_template_file_name"),
  pptxSectionTemplateUploadedAt: timestamp("pptx_section_template_uploaded_at"),
  pptxClosingTemplateFileId: text("pptx_closing_template_file_id"),
  pptxClosingTemplateFileName: text("pptx_closing_template_file_name"),
  pptxClosingTemplateUploadedAt: timestamp("pptx_closing_template_uploaded_at"),

  // Timestamps
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
});

// Blocked Email Domains (Platform-wide security)
export const blockedDomains = pgTable("blocked_domains", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  domain: varchar("domain", { length: 255 }).notNull().unique(),
  reason: text("reason"),
  blockedBy: varchar("blocked_by"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

// ============================================================================
// END MULTI-TENANCY CORE TABLES (tenant_users and consultant_access below users)
// ============================================================================

// Users and Authentication (Person metadata)
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").unique(), // Now optional for contractors
  name: text("name").notNull(),
  firstName: text("first_name"),
  lastName: text("last_name"),
  initials: text("initials"),
  title: text("title"), // Job title for the person
  role: text("role").notNull().default("employee"), // admin, billing-admin, pm, portfolio-manager, employee, executive
  canLogin: boolean("can_login").notNull().default(false), // Controls authentication access
  isAssignable: boolean("is_assignable").notNull().default(true), // Can be assigned to projects/estimates
  roleId: varchar("role_id").references(() => roles.id), // Optional reference to standard role
  customRole: text("custom_role"), // For non-standard roles
  defaultBillingRate: decimal("default_billing_rate", { precision: 10, scale: 2 }), // Default billing rate
  defaultCostRate: decimal("default_cost_rate", { precision: 10, scale: 2 }), // Default cost rate (internal)
  isSalaried: boolean("is_salaried").notNull().default(false), // Salaried resources don't contribute to direct project costs
  isActive: boolean("is_active").notNull().default(true),
  receiveTimeReminders: boolean("receive_time_reminders").notNull().default(true), // Opt-in for weekly time entry reminders
  receiveExpenseReminders: boolean("receive_expense_reminders").notNull().default(true), // Opt-in for weekly expense submission reminders
  // Contractor billing profile fields (for generating expense invoices)
  contractorBusinessName: text("contractor_business_name"), // Contractor's business/company name
  contractorBusinessAddress: text("contractor_business_address"), // Contractor's business address
  contractorBillingId: text("contractor_billing_id"), // Contractor's invoice/billing ID or tax ID
  contractorPhone: text("contractor_phone"), // Contractor's phone number
  contractorEmail: text("contractor_email"), // Contractor's billing email (may differ from login email)
  passwordHash: text("password_hash"),
  // Multi-tenancy fields
  primaryTenantId: varchar("primary_tenant_id").references(() => tenants.id), // User's primary/home tenant
  platformRole: varchar("platform_role", { length: 50 }).default("user"), // user, constellation_consultant, constellation_admin, global_admin
  lastDismissedChangelogVersion: varchar("last_dismissed_changelog_version", { length: 50 }),
  // SSO / Entra identity linking
  authProvider: varchar("auth_provider", { length: 50 }), // 'local' | 'entra'
  azureObjectId: varchar("azure_object_id", { length: 255 }), // Entra object ID (localAccountId)
  // Capacity profile fields (Advanced Resource Management)
  weeklyCapacityHours: decimal("weekly_capacity_hours", { precision: 5, scale: 2 }).default("40.00"),
  capacityNotes: text("capacity_notes"), // e.g., "Not available Wednesdays", "20hr/week contract"
  capacityEffectiveDate: date("capacity_effective_date"), // When this capacity setting takes effect
  // Calendar suggestions preferences
  calendarSuggestionsEnabled: boolean("calendar_suggestions_enabled").notNull().default(true),
  calendarSuggestionsDaysBack: integer("calendar_suggestions_days_back").notNull().default(0), // 0 = today only
  // Weekly digest preferences
  weeklyDigestEnabled: boolean("weekly_digest_enabled").notNull().default(true),
  weeklyDigestDay: integer("weekly_digest_day").notNull().default(1), // 1=Monday … 7=Sunday
  weeklyDigestTime: varchar("weekly_digest_time", { length: 5 }).notNull().default("08:00"), // HH:MM
  // Payroll enrollment: when non-null, an internal user is enrolled in payroll
  // and a linked payroll_employees row is provisioned automatically. Clearing
  // the value marks the linked employee 'terminated' (no cascade delete).
  payrollEmployeeType: varchar("payroll_employee_type", { length: 16 }), // 'w2' | '1099' | null
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

// ============================================================================
// MULTI-TENANCY USER TABLES (defined after users for FK references)
// ============================================================================

// User-Tenant Membership (many-to-many with roles)
export const tenantUsers = pgTable("tenant_users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  
  // Tenant-specific role (existing Constellation roles)
  role: varchar("role", { length: 50 }).notNull().default("employee"), // admin, billing-admin, pm, portfolio-manager, employee, executive, client
  
  // Client association (for stakeholder/client role users)
  clientId: varchar("client_id").references(() => clients.id, { onDelete: 'cascade' }),
  stakeholderTitle: varchar("stakeholder_title", { length: 100 }),
  
  // Status
  status: varchar("status", { length: 50 }).default("active"), // active, suspended, invited
  
  // Notification preferences (tenant-specific)
  receiveFinancialAlerts: boolean("receive_financial_alerts").notNull().default(false),
  
  // Invitation tracking
  invitedBy: varchar("invited_by").references(() => users.id),
  invitedAt: timestamp("invited_at"),
  joinedAt: timestamp("joined_at"),
  
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
}, (table) => ({
  uniqueUserTenantClient: uniqueIndex("unique_user_tenant_client").on(table.userId, table.tenantId, table.clientId),
  tenantIdx: index("idx_tenant_users_tenant").on(table.tenantId),
  userIdx: index("idx_tenant_users_user").on(table.userId),
  clientIdx: index("idx_tenant_users_client").on(table.clientId),
}));

// Consultant Access (for Synozur consultants accessing client tenants)
export const consultantAccess = pgTable("consultant_access", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  consultantUserId: varchar("consultant_user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  
  // Access configuration
  role: varchar("role", { length: 50 }).notNull(), // Their role in this tenant
  grantedBy: varchar("granted_by").references(() => users.id),
  grantedAt: timestamp("granted_at").notNull().default(sql`now()`),
  
  // Optional expiration
  expiresAt: timestamp("expires_at"),
  
  // Notes
  reason: text("reason"), // "Q1 2026 Implementation Project"
  
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
}, (table) => ({
  tenantIdx: index("idx_consultant_access_tenant").on(table.tenantId),
  consultantIdx: index("idx_consultant_access_consultant").on(table.consultantUserId),
}));

// ============================================================================
// END MULTI-TENANCY TABLES
// ============================================================================

// Clients
export const clients = pgTable("clients", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id), // Multi-tenancy: nullable during migration
  name: text("name").notNull(),
  shortName: text("short_name"), // Abbreviated name for display (e.g., "MSFT" for Microsoft)
  status: text("status").notNull().default("pending"), // pending, active, inactive, archived
  currency: text("currency").notNull().default("USD"),
  billingContact: text("billing_contact"),
  contactName: text("contact_name"),
  contactAddress: text("contact_address"),
  secondaryContactName: text("secondary_contact_name"),
  secondaryContactEmail: text("secondary_contact_email"),
  vocabularyOverrides: text("vocabulary_overrides"), // JSON string (DEPRECATED - kept for migration)
  // Vocabulary term selections (overrides organization defaults)
  epicTermId: varchar("epic_term_id").references(() => vocabularyCatalog.id),
  stageTermId: varchar("stage_term_id").references(() => vocabularyCatalog.id),
  workstreamTermId: varchar("workstream_term_id").references(() => vocabularyCatalog.id),
  milestoneTermId: varchar("milestone_term_id").references(() => vocabularyCatalog.id),
  activityTermId: varchar("activity_term_id").references(() => vocabularyCatalog.id),
  // MSA (Master Services Agreement) tracking
  msaDate: date("msa_date"), // Date MSA was signed
  msaDocument: text("msa_document"), // File path/name for uploaded MSA document
  hasMsa: boolean("has_msa").default(false), // Track if MSA exists
  sinceDate: date("since_date"), // Client relationship start date (editable, can be derived from MSA date)
  // NDA (Non-Disclosure Agreement) tracking
  ndaDate: date("nda_date"), // Date NDA was signed
  ndaDocument: text("nda_document"), // File path/name for uploaded NDA document
  hasNda: boolean("has_nda").default(false), // Track if NDA exists
  // Microsoft Teams integration
  microsoftTeamId: text("microsoft_team_id"), // Azure Group/Team ID for this client
  microsoftTeamName: text("microsoft_team_name"), // Display name of the Team
  microsoftTeamWebUrl: text("microsoft_team_web_url"), // Web URL to open the Team in Teams
  sharepointSiteUrl: text("sharepoint_site_url"), // Team's SharePoint site URL for status report publishing
  // Payment terms override (e.g., "Net 30", "Net 45", "Due Upon Receipt")
  paymentTerms: text("payment_terms"), // Overrides tenant default when set
  // Payment method for invoices (e.g., "ACH Transfer", "Check", "Wire Transfer")
  paymentMethod: text("payment_method").default("ACH Transfer"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
}, (table) => ({
  tenantIdx: index("idx_clients_tenant").on(table.tenantId),
}));

// Roles (for rate management)
export const roles = pgTable("roles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  tenantId: varchar("tenant_id").references(() => tenants.id),
  defaultRackRate: decimal("default_rack_rate", { precision: 10, scale: 2 }).notNull(),
  defaultCostRate: decimal("default_cost_rate", { precision: 10, scale: 2 }),
  isAlwaysSalaried: boolean("is_always_salaried").notNull().default(false),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
}, (table) => [
  unique().on(table.name, table.tenantId),
]);

// System Settings (configurable default values)
export const systemSettings = pgTable("system_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  settingKey: text("setting_key").notNull().unique(),
  settingValue: text("setting_value").notNull(),
  description: text("description"),
  settingType: text("setting_type").notNull().default("string"), // string, number, boolean, json
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
});

// Tenant-scoped settings — when present, these override the matching system_settings entry
// for the given tenant. Used for per-tenant configuration of platform features such as the
// Copilot Studio known-client-IDs allow list.
export const tenantSettings = pgTable("tenant_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  settingKey: text("setting_key").notNull(),
  settingValue: text("setting_value").notNull(),
  description: text("description"),
  settingType: text("setting_type").notNull().default("string"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
}, (table) => ({
  uniqueTenantKey: uniqueIndex("unique_tenant_setting_key").on(table.tenantId, table.settingKey),
  tenantIdx: index("idx_tenant_settings_tenant").on(table.tenantId),
}));

export type TenantSetting = typeof tenantSettings.$inferSelect;
export type InsertTenantSetting = typeof tenantSettings.$inferInsert;

// Airport Codes - IATA 3-letter airport codes (system-wide, no tenant scoping)
export const airportCodes = pgTable("airport_codes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  iataCode: varchar("iata_code", { length: 3 }).notNull().unique(), // 3-letter IATA code (e.g., "SEA", "JFK")
  name: text("name").notNull(), // Airport name
  municipality: text("municipality"), // City/town name
  isoCountry: varchar("iso_country", { length: 2 }), // Country code (e.g., "US", "CA")
  isoRegion: varchar("iso_region", { length: 10 }), // Region code (e.g., "US-WA", "US-NY")
  airportType: text("airport_type"), // e.g., "large_airport", "medium_airport", "small_airport"
  coordinates: text("coordinates"), // Lat/Long coordinates
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
}, (table) => ({
  iataCodeIdx: uniqueIndex("idx_airport_iata_code").on(table.iataCode),
  countryIdx: index("idx_airport_country").on(table.isoCountry),
  nameIdx: index("idx_airport_name").on(table.name),
}));

// OCONUS Per Diem Rates - Outside Continental US per diem rates (system-wide, no tenant scoping)
// Data uploaded annually from DoD OCONUS Per Diem files (no API available)
export const oconusPerDiemRates = pgTable("oconus_per_diem_rates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  country: text("country").notNull(), // Country or US territory name (e.g., "GERMANY", "ALASKA")
  location: text("location").notNull(), // City or location name (e.g., "BERLIN", "ANCHORAGE")
  seasonStart: varchar("season_start", { length: 5 }).notNull(), // MM/DD format (e.g., "01/01", "04/01")
  seasonEnd: varchar("season_end", { length: 5 }).notNull(), // MM/DD format (e.g., "12/31", "09/30")
  lodging: integer("lodging").notNull(), // Lodging rate in USD
  mie: integer("mie").notNull(), // Meals & Incidental Expenses (M&IE) rate in USD
  proportionalMeals: integer("proportional_meals"), // Proportional meal rate (for partial days)
  incidentals: integer("incidentals"), // Incidentals portion
  maxPerDiem: integer("max_per_diem").notNull(), // Total max per diem (lodging + M&IE)
  effectiveDate: varchar("effective_date", { length: 10 }), // MM/DD/YYYY format
  fiscalYear: integer("fiscal_year").notNull(), // Fiscal year for this rate (e.g., 2026)
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
}, (table) => ({
  countryLocationIdx: index("idx_oconus_country_location").on(table.country, table.location),
  countryIdx: index("idx_oconus_country").on(table.country),
  fiscalYearIdx: index("idx_oconus_fiscal_year").on(table.fiscalYear),
}));

// Vocabulary Catalog - Predefined term options
export const vocabularyCatalog = pgTable("vocabulary_catalog", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  termType: text("term_type").notNull(), // epic, stage, workstream, milestone, activity
  termValue: text("term_value").notNull(), // The actual term (e.g., "Epic", "Program", "Release")
  description: text("description"), // Optional description of the term
  isSystemDefault: boolean("is_system_default").notNull().default(false), // True for default terms
  isActive: boolean("is_active").notNull().default(true), // Can be deactivated but not deleted
  sortOrder: integer("sort_order").notNull().default(0), // Display order in dropdowns
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
}, (table) => ({
  uniqueTermTypeValue: uniqueIndex("unique_term_type_value").on(table.termType, table.termValue),
}));

// Organization Vocabulary Settings - Tenant-level vocabulary selections
export const organizationVocabulary = pgTable("organization_vocabulary", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id), // Multi-tenancy: nullable during migration
  epicTermId: varchar("epic_term_id").references(() => vocabularyCatalog.id), // Selected Epic term
  stageTermId: varchar("stage_term_id").references(() => vocabularyCatalog.id), // Selected Stage term
  workstreamTermId: varchar("workstream_term_id").references(() => vocabularyCatalog.id), // Selected Workstream term
  milestoneTermId: varchar("milestone_term_id").references(() => vocabularyCatalog.id), // Selected Milestone term
  activityTermId: varchar("activity_term_id").references(() => vocabularyCatalog.id), // Selected Activity term
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
}, (table) => ({
  tenantIdx: index("idx_organization_vocabulary_tenant").on(table.tenantId),
  uniqueTenant: uniqueIndex("unique_organization_vocabulary_tenant").on(table.tenantId), // Enforce one record per tenant
}));

// Client-to-Team mapping
export const clientTeams = pgTable("client_teams", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  clientId: varchar("client_id").notNull().references(() => clients.id, { onDelete: 'cascade' }),
  tenantId: varchar("tenant_id").references(() => tenants.id),
  teamId: varchar("team_id", { length: 255 }).notNull(),
  teamName: text("team_name"),
  teamWebUrl: text("team_web_url"),
  sharepointSiteId: varchar("sharepoint_site_id", { length: 255 }),
  sharepointSiteUrl: text("sharepoint_site_url"),
  createdBy: varchar("created_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
}, (table) => ({
  clientIdx: index("idx_client_teams_client").on(table.clientId),
  tenantIdx: index("idx_client_teams_tenant").on(table.tenantId),
  uniqueClient: unique("uq_client_teams_client").on(table.clientId),
}));

export const insertClientTeamSchema = createInsertSchema(clientTeams).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertClientTeam = z.infer<typeof insertClientTeamSchema>;
export type ClientTeam = typeof clientTeams.$inferSelect;

// Project-to-Channel mapping
export const projectChannels = pgTable("project_channels", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: 'cascade' }),
  tenantId: varchar("tenant_id").references(() => tenants.id),
  channelId: varchar("channel_id", { length: 255 }).notNull(),
  channelName: text("channel_name"),
  channelWebUrl: text("channel_web_url"),
  plannerPlanId: varchar("planner_plan_id", { length: 255 }),
  plannerPlanWebUrl: text("planner_plan_web_url"),
  createdBy: varchar("created_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
}, (table) => ({
  projectIdx: index("idx_project_channels_project").on(table.projectId),
  tenantIdx: index("idx_project_channels_tenant").on(table.tenantId),
  uniqueProject: unique("uq_project_channels_project").on(table.projectId),
}));

export const insertProjectChannelSchema = createInsertSchema(projectChannels).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertProjectChannel = z.infer<typeof insertProjectChannelSchema>;
export type ProjectChannel = typeof projectChannels.$inferSelect;

// Estimate-to-Channel mapping
export const estimateChannels = pgTable("estimate_channels", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  estimateId: varchar("estimate_id").notNull().references(() => estimates.id, { onDelete: 'cascade' }),
  tenantId: varchar("tenant_id").references(() => tenants.id),
  teamId: varchar("team_id", { length: 255 }).notNull(),
  teamName: text("team_name"),
  channelId: varchar("channel_id", { length: 255 }).notNull(),
  channelName: text("channel_name"),
  channelWebUrl: text("channel_web_url"),
  createdBy: varchar("created_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
}, (table) => ({
  estimateIdx: index("idx_estimate_channels_estimate").on(table.estimateId),
  tenantIdx: index("idx_estimate_channels_tenant").on(table.tenantId),
  uniqueEstimate: unique("uq_estimate_channels_estimate").on(table.estimateId),
}));

export const insertEstimateChannelSchema = createInsertSchema(estimateChannels).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertEstimateChannel = z.infer<typeof insertEstimateChannelSchema>;
export type EstimateChannel = typeof estimateChannels.$inferSelect;

// Teams folder templates - configurable folder structure for new channels
export const teamsFolderTemplates = pgTable("teams_folder_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id),
  folderName: text("folder_name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  scope: text("scope").notNull().default("system"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
}, (table) => ({
  tenantScopeIdx: index("idx_folder_templates_tenant_scope").on(table.tenantId, table.scope),
}));

export const insertTeamsFolderTemplateSchema = createInsertSchema(teamsFolderTemplates).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertTeamsFolderTemplate = z.infer<typeof insertTeamsFolderTemplateSchema>;
export type TeamsFolderTemplate = typeof teamsFolderTemplates.$inferSelect;

export const DEFAULT_FOLDER_TEMPLATES = [
  "Deliverables",
  "SOW & Contracts",
  "Meeting Notes",
  "Status Reports",
  "Working Documents",
];

export const DEFAULT_ESTIMATE_FOLDER_TEMPLATES = [
  "Proposals",
  "RFP Documents",
  "Client Correspondence",
  "Working Documents",
];

// Teams tab templates - configurable tab structure for new channels
export const teamsTabTemplates = pgTable("teams_tab_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id),
  tabType: text("tab_type").notNull(), // e.g. "planner", "constellation", "website", "custom"
  tabName: text("tab_name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
}, (table) => ({
  tenantIdx: index("idx_tab_templates_tenant").on(table.tenantId),
}));

export const insertTeamsTabTemplateSchema = createInsertSchema(teamsTabTemplates).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertTeamsTabTemplate = z.infer<typeof insertTeamsTabTemplateSchema>;
export type TeamsTabTemplate = typeof teamsTabTemplates.$inferSelect;

export const DEFAULT_TAB_TEMPLATES = [
  { tabType: "planner", tabName: "Planner" },
  { tabType: "constellation", tabName: "Constellation" },
];

// Projects
export const projects = pgTable("projects", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id), // Multi-tenancy: nullable during migration
  clientId: varchar("client_id").notNull().references(() => clients.id),
  name: text("name").notNull(),
  description: text("description"), // Vision statement/overview (paragraph length)
  code: text("code").notNull().unique(),
  pm: varchar("pm").references(() => users.id), // Project Manager - reference to users table
  startDate: date("start_date"),
  endDate: date("end_date"), // Can be null for open-ended projects
  commercialScheme: text("commercial_scheme").notNull(), // retainer, milestone, tm
  retainerBalance: decimal("retainer_balance", { precision: 10, scale: 2 }), // Current retainer balance
  retainerTotal: decimal("retainer_total", { precision: 10, scale: 2 }), // Total retainer value
  baselineBudget: decimal("baseline_budget", { precision: 10, scale: 2 }),
  sowValue: decimal("sow_value", { precision: 10, scale: 2 }), // SOW total value
  sowDate: date("sow_date"), // Date SOW was signed
  hasSow: boolean("has_sow").notNull().default(false), // Track if SOW exists
  status: text("status").notNull().default("active"), // active, on-hold, completed, archived
  // Financial tracking fields
  estimatedTotal: decimal("estimated_total", { precision: 12, scale: 2 }), // From original estimate
  sowTotal: decimal("sow_total", { precision: 12, scale: 2 }), // From signed contract  
  actualCost: decimal("actual_cost", { precision: 12, scale: 2 }), // Calculated from time/expenses
  billedTotal: decimal("billed_total", { precision: 12, scale: 2 }), // Total invoiced
  profitMargin: decimal("profit_margin", { precision: 12, scale: 2 }), // Calculated variance
  vocabularyOverrides: text("vocabulary_overrides"), // JSON string (DEPRECATED - kept for migration)
  // Vocabulary term selections (overrides client and organization defaults)
  epicTermId: varchar("epic_term_id").references(() => vocabularyCatalog.id),
  stageTermId: varchar("stage_term_id").references(() => vocabularyCatalog.id),
  workstreamTermId: varchar("workstream_term_id").references(() => vocabularyCatalog.id),
  milestoneTermId: varchar("milestone_term_id").references(() => vocabularyCatalog.id),
  activityTermId: varchar("activity_term_id").references(() => vocabularyCatalog.id),
  // Multi-currency: snapshot from the approved estimate
  quoteCurrency: varchar("quote_currency", { length: 3 }).notNull().default("USD"),
  costCurrency: varchar("cost_currency", { length: 3 }).notNull().default("USD"),
  exchangeRate: decimal("exchange_rate", { precision: 12, scale: 6 }), // costCurrency per 1 quoteCurrency
  exchangeRateLockedAt: timestamp("exchange_rate_locked_at"),
  exchangeRateSource: varchar("exchange_rate_source", { length: 20 }).default("live"), // 'live', 'locked', 'manual'
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
}, (table) => ({
  tenantIdx: index("idx_projects_tenant").on(table.tenantId),
}));

// Estimates
export const estimates = pgTable("estimates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id), // Multi-tenancy: nullable during migration
  name: text("name").notNull(),
  clientId: varchar("client_id").notNull().references(() => clients.id),
  projectId: varchar("project_id").references(() => projects.id), // Optional - can create estimate without project
  version: integer("version").notNull().default(1),
  status: text("status").notNull().default("draft"), // draft, final, approved, rejected
  estimateType: text("estimate_type").notNull().default("detailed"), // detailed, block, retainer, or program
  pricingType: text("pricing_type").notNull().default("hourly"), // hourly or fixed
  totalHours: decimal("total_hours", { precision: 10, scale: 2 }),
  totalFees: decimal("total_fees", { precision: 10, scale: 2 }),
  // Block estimate fields (for retainer/simple estimates)
  blockHours: decimal("block_hours", { precision: 10, scale: 2 }),
  blockDollars: decimal("block_dollars", { precision: 10, scale: 2 }),
  blockDescription: text("block_description"),
  // Fixed price field for block/retainer pricing
  fixedPrice: decimal("fixed_price", { precision: 10, scale: 2 }),
  // Output totals (customer-facing)
  presentedTotal: decimal("presented_total", { precision: 10, scale: 2 }), // Total presented to customer
  margin: decimal("margin", { precision: 5, scale: 2 }), // Margin percentage
  validUntil: date("valid_until"),
  estimateDate: date("estimate_date").notNull().default(sql`CURRENT_DATE`), // Backdateable estimate date
  potentialStartDate: date("potential_start_date"), // Expected project start date for portfolio timeline
  // Visible vocabulary customization (client can rename Epic/Stage/Activity)
  epicLabel: text("epic_label").default("Epic"),
  stageLabel: text("stage_label").default("Stage"),
  activityLabel: text("activity_label").default("Activity"),
  // Rack rate snapshot at time of estimate
  rackRateSnapshot: jsonb("rack_rate_snapshot"), // Stores rates at time of estimate creation
  // Factor multipliers (centralized values)
  sizeSmallMultiplier: decimal("size_small_multiplier", { precision: 4, scale: 2 }).default('1.00'),
  sizeMediumMultiplier: decimal("size_medium_multiplier", { precision: 4, scale: 2 }).default('1.05'),
  sizeLargeMultiplier: decimal("size_large_multiplier", { precision: 4, scale: 2 }).default('1.10'),
  complexitySmallMultiplier: decimal("complexity_small_multiplier", { precision: 4, scale: 2 }).default('1.00'),
  complexityMediumMultiplier: decimal("complexity_medium_multiplier", { precision: 4, scale: 2 }).default('1.05'),
  complexityLargeMultiplier: decimal("complexity_large_multiplier", { precision: 4, scale: 2 }).default('1.10'),
  confidenceHighMultiplier: decimal("confidence_high_multiplier", { precision: 4, scale: 2 }).default('1.00'),
  confidenceMediumMultiplier: decimal("confidence_medium_multiplier", { precision: 4, scale: 2 }).default('1.10'),
  confidenceLowMultiplier: decimal("confidence_low_multiplier", { precision: 4, scale: 2 }).default('1.20'),
  archived: boolean("archived").notNull().default(false), // Archive estimates to hide from default view
  marginOverrideActive: boolean("margin_override_active").notNull().default(false),
  marginOverridePercent: decimal("margin_override_percent", { precision: 5, scale: 2 }),
  originalRatesSnapshot: jsonb("original_rates_snapshot"), // { [lineItemId]: originalRate } - stored when margin override is first applied
  retainerConfig: jsonb("retainer_config"), // { monthCount, startMonth, rateTiers: [{name, rate, maxHours}] }
  // Referral fee tracking (paid to sellers/referrers)
  referralFeeType: text("referral_fee_type").default("none"), // 'none', 'percentage', 'flat'
  referralFeePercent: decimal("referral_fee_percent", { precision: 5, scale: 2 }), // Percentage of total fees
  referralFeeFlat: decimal("referral_fee_flat", { precision: 10, scale: 2 }), // Flat dollar amount
  referralFeeAmount: decimal("referral_fee_amount", { precision: 10, scale: 2 }), // Calculated fee amount
  referralFeePaidTo: text("referral_fee_paid_to"), // Name of seller/referrer
  netRevenue: decimal("net_revenue", { precision: 12, scale: 2 }), // Total fees minus referral fee
  // Multi-currency support
  quoteCurrency: varchar("quote_currency", { length: 3 }).notNull().default("USD"), // Currency shown to the client
  costCurrency: varchar("cost_currency", { length: 3 }).notNull().default("USD"),   // Tenant's base/cost currency
  exchangeRate: decimal("exchange_rate", { precision: 12, scale: 6 }),              // costCurrency per 1 quoteCurrency
  exchangeRateLockedAt: timestamp("exchange_rate_locked_at"),
  exchangeRateSource: varchar("exchange_rate_source", { length: 20 }).default("live"), // 'live', 'locked', 'manual'
  proposalNarrative: text("proposal_narrative"),
  proposalNarrativeGeneratedAt: timestamp("proposal_narrative_generated_at"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
}, (table) => ({
  tenantIdx: index("idx_estimates_tenant").on(table.tenantId),
}));

// Estimate Line Items (inputs) with factors
export const estimateLineItems = pgTable("estimate_line_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  estimateId: varchar("estimate_id").notNull().references(() => estimates.id, { onDelete: 'cascade' }),
  epicId: varchar("epic_id").references(() => estimateEpics.id), // Optional epic reference
  stageId: varchar("stage_id").references(() => estimateStages.id), // Optional stage reference
  description: text("description").notNull(),
  category: text("category"), // Optional category/phase
  workstream: text("workstream"), // Workstream name
  week: integer("week"), // Week number (also used as startWeek for program estimates)
  durationWeeks: integer("duration_weeks"), // Program estimates: how many weeks this block runs
  utilizationPercent: integer("utilization_percent"), // Program estimates: 20/40/60/80/100 (% of 40hr week)
  baseHours: decimal("base_hours", { precision: 10, scale: 2 }).notNull(),
  factor: decimal("factor", { precision: 10, scale: 2 }).notNull().default(sql`1`), // Multiplier (e.g., 4 interviews × 3 hours)
  rate: decimal("rate", { precision: 10, scale: 2 }).notNull().default(sql`0`), // Charge rate (customer-facing)
  costRate: decimal("cost_rate", { precision: 10, scale: 2 }), // Cost rate (internal cost)
  assignedUserId: varchar("assigned_user_id").references(() => users.id), // User assigned to this line item
  roleId: varchar("role_id").references(() => roles.id), // Generic role assigned (alternative to specific user)
  resourceName: text("resource_name"), // Name of assigned resource (denormalized for display)
  size: text("size").notNull().default("small"), // small, medium, large
  complexity: text("complexity").notNull().default("small"), // small, medium, large
  confidence: text("confidence").notNull().default("high"), // high, medium, low
  adjustedHours: decimal("adjusted_hours", { precision: 10, scale: 2 }).notNull(), // base_hours * factor * multipliers
  totalAmount: decimal("total_amount", { precision: 10, scale: 2 }).notNull(), // adjusted_hours * rate (charge amount)
  totalCost: decimal("total_cost", { precision: 10, scale: 2 }), // adjusted_hours * costRate (internal cost)
  margin: decimal("margin", { precision: 10, scale: 2 }), // totalAmount - totalCost
  marginPercent: decimal("margin_percent", { precision: 5, scale: 2 }), // (margin / totalAmount) * 100
  referralMarkup: decimal("referral_markup", { precision: 10, scale: 2 }), // Referral fee allocated to this line item (based on margin contribution)
  totalAmountWithReferral: decimal("total_amount_with_referral", { precision: 10, scale: 2 }), // totalAmount + referralMarkup (client-facing quoted price)
  comments: text("comments"), // Optional comments
  hasManualRateOverride: boolean("has_manual_rate_override").notNull().default(false), // Track manually edited rates
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

// Client Rate Overrides - Default rates for a client (applies to new estimates only)
export const clientRateOverrides = pgTable("client_rate_overrides", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id), // Multi-tenancy: nullable during migration
  clientId: varchar("client_id").notNull().references(() => clients.id, { onDelete: 'cascade' }),
  subjectType: text("subject_type").notNull(), // 'role' or 'person' (validated in application layer)
  subjectId: varchar("subject_id").notNull(), // roleId or userId
  billingRate: decimal("billing_rate", { precision: 10, scale: 2 }), // Override billing rate
  costRate: decimal("cost_rate", { precision: 10, scale: 2 }), // Override cost rate
  effectiveStart: date("effective_start").notNull().default(sql`CURRENT_DATE`),
  effectiveEnd: date("effective_end"), // null means ongoing
  notes: text("notes"), // Optional explanation for the override
  createdBy: varchar("created_by").references(() => users.id), // Who created this override
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
}, (table) => ({
  // Index for efficient lookups by client and subject
  clientSubjectIdx: index("client_rate_overrides_client_subject_idx")
    .on(table.clientId, table.subjectType, table.subjectId),
}));

// Estimate Rate Overrides - Custom rates for specific resources within an estimate
export const estimateRateOverrides = pgTable("estimate_rate_overrides", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  estimateId: varchar("estimate_id").notNull().references(() => estimates.id, { onDelete: 'cascade' }),
  lineItemIds: varchar("line_item_ids").array(), // Optional: specific line items this override applies to
  subjectType: text("subject_type").notNull(), // 'role' or 'person' (validated in application layer)
  subjectId: varchar("subject_id").notNull(), // roleId or userId
  billingRate: decimal("billing_rate", { precision: 10, scale: 2 }), // Override billing rate
  costRate: decimal("cost_rate", { precision: 10, scale: 2 }), // Override cost rate
  effectiveStart: date("effective_start").notNull().default(sql`CURRENT_DATE`),
  effectiveEnd: date("effective_end"), // null means ongoing
  notes: text("notes"), // Optional explanation for the override
  createdBy: varchar("created_by").references(() => users.id), // Who created this override
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
}, (table) => ({
  // Index for efficient lookups by estimate and subject
  estimateSubjectIdx: index("estimate_rate_overrides_estimate_subject_idx")
    .on(table.estimateId, table.subjectType, table.subjectId),
}));

// Estimate Milestone Payments (outputs)
export const estimateMilestones = pgTable("estimate_milestones", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  estimateId: varchar("estimate_id").notNull().references(() => estimates.id, { onDelete: 'cascade' }),
  name: text("name").notNull(), // e.g., "Phase 1 Delivery", "Project Kickoff"
  description: text("description"),
  amount: decimal("amount", { precision: 10, scale: 2 }), // Optional fixed amount
  dueDate: date("due_date"), // Optional due date
  percentage: decimal("percentage", { precision: 5, scale: 2 }), // Optional percentage of total
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

// Estimate Shares (read-only access grants)
export const estimateShares = pgTable("estimate_shares", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  estimateId: varchar("estimate_id").notNull().references(() => estimates.id, { onDelete: 'cascade' }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  grantedBy: varchar("granted_by").notNull().references(() => users.id),
  grantedAt: timestamp("granted_at").notNull().default(sql`now()`),
}, (table) => ({
  uniqueShare: index("estimate_shares_unique_idx").on(table.estimateId, table.userId),
}));

// Estimate hierarchy: Epic -> Stage -> Activity
export const estimateEpics = pgTable("estimate_epics", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  estimateId: varchar("estimate_id").notNull().references(() => estimates.id),
  name: text("name").notNull(),
  order: integer("order").notNull(),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

export const estimateStages = pgTable("estimate_stages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  epicId: varchar("epic_id").notNull().references(() => estimateEpics.id),
  name: text("name").notNull(),
  order: integer("order").notNull(),
  startDate: date("start_date"),
  endDate: date("end_date"),
  retainerMonthIndex: integer("retainer_month_index"),
  retainerMonthLabel: text("retainer_month_label"),
  retainerMaxHours: decimal("retainer_max_hours", { precision: 10, scale: 2 }),
  retainerStartDate: date("retainer_start_date"),
  retainerEndDate: date("retainer_end_date"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

export const estimateActivities = pgTable("estimate_activities", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  stageId: varchar("stage_id").notNull().references(() => estimateStages.id),
  name: text("name").notNull(),
  order: integer("order").notNull(),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

// Project Structure (copied from estimates when approved)
export const projectEpics = pgTable("project_epics", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: 'cascade' }),
  estimateEpicId: varchar("estimate_epic_id").references(() => estimateEpics.id), // Link to original estimate epic
  name: text("name").notNull(),
  description: text("description"),
  budgetHours: decimal("budget_hours", { precision: 10, scale: 2 }),
  actualHours: decimal("actual_hours", { precision: 10, scale: 2 }).default('0'),
  order: integer("order").notNull(),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

export const projectStages = pgTable("project_stages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  epicId: varchar("epic_id").notNull().references(() => projectEpics.id, { onDelete: 'cascade' }),
  name: text("name").notNull(),
  order: integer("order").notNull(),
  retainerMonthIndex: integer("retainer_month_index"),
  retainerMonthLabel: text("retainer_month_label"),
  retainerMaxHours: decimal("retainer_max_hours", { precision: 10, scale: 2 }),
  retainerRateTiers: jsonb("retainer_rate_tiers"), // Optional: [{name, rate, maxHours}] for multi-rate months
  retainerStartDate: date("retainer_start_date"),
  retainerEndDate: date("retainer_end_date"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

export const projectActivities = pgTable("project_activities", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  stageId: varchar("stage_id").notNull().references(() => projectStages.id, { onDelete: 'cascade' }),
  name: text("name").notNull(),
  order: integer("order").notNull(),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

export const projectWorkstreams = pgTable("project_workstreams", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: 'cascade' }),
  estimateWorkStreamId: varchar("estimate_workstream_id"), // Link to original estimate workstream if applicable
  name: text("name").notNull(),
  description: text("description"),
  budgetHours: decimal("budget_hours", { precision: 10, scale: 2 }),
  actualHours: decimal("actual_hours", { precision: 10, scale: 2 }).default('0'),
  order: integer("order").notNull(),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

// Unified Project Milestones (both delivery gates and payment milestones)
export const projectMilestones = pgTable("project_milestones", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: 'cascade' }),
  projectEpicId: varchar("project_epic_id").references(() => projectEpics.id, { onDelete: 'cascade' }), // Optional for delivery milestones
  estimateStageId: varchar("estimate_stage_id").references(() => estimateStages.id, { onDelete: 'set null' }), // Link to original estimate stage
  estimateMilestoneId: varchar("estimate_milestone_id").references(() => estimateMilestones.id, { onDelete: 'set null' }), // Link to original estimate milestone
  name: text("name").notNull(),
  description: text("description"),
  
  // Type indicator
  isPaymentMilestone: boolean("is_payment_milestone").notNull().default(false), // TRUE = payment due, FALSE = delivery gate
  
  // Timing fields
  startDate: date("start_date"), // For delivery milestones
  endDate: date("end_date"), // For delivery milestones
  targetDate: date("target_date"), // When milestone should be achieved (replaces dueDate)
  completedDate: date("completed_date"), // When actually completed
  
  // Payment fields (only used when isPaymentMilestone = true)
  amount: decimal("amount", { precision: 10, scale: 2 }), // Payment amount
  invoiceStatus: text("invoice_status"), // null, planned, invoiced, paid (replaces status for payment milestones)
  
  // Tracking fields
  status: text("status").notNull().default('not-started'), // not-started, in-progress, completed, cancelled
  budgetHours: decimal("budget_hours", { precision: 10, scale: 2 }),
  actualHours: decimal("actual_hours", { precision: 10, scale: 2 }).default('0'),
  
  // References
  sowId: varchar("sow_id").references(() => sows.id), // Reference to SOW/change order if edited
  retainerStageId: varchar("retainer_stage_id").references(() => projectStages.id, { onDelete: 'set null' }), // Link to retainer stage for auto-generated payment milestones
  sortOrder: integer("sort_order").notNull().default(0),
  
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
});

// NOTE: projectPaymentMilestones has been consolidated into projectMilestones table
// Use isPaymentMilestone flag to distinguish between delivery and payment milestones

// Project Resource Allocations - mirrors estimate allocations for actual project work
export const projectAllocations = pgTable("project_allocations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id), // Multi-tenancy: nullable during migration
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: 'cascade' }),
  projectActivityId: varchar("project_activity_id").references(() => projectActivities.id),
  projectMilestoneId: varchar("project_milestone_id").references(() => projectMilestones.id),
  projectWorkstreamId: varchar("project_workstream_id").references(() => projectWorkstreams.id),
  projectEpicId: varchar("project_epic_id").references(() => projectEpics.id, { onDelete: 'set null' }),
  projectStageId: varchar("project_stage_id").references(() => projectStages.id, { onDelete: 'set null' }),
  weekNumber: integer("week_number").notNull(), // Original week number from estimate
  plannedStartDate: date("planned_start_date"), // Calculated from kickoff date
  plannedEndDate: date("planned_end_date"), // End of week date
  roleId: varchar("role_id").references(() => roles.id), // Role-based assignment
  personId: varchar("person_id").references(() => users.id), // Person-based assignment
  resourceName: text("resource_name"), // For unmatched resources from estimate
  taskDescription: text("task_description"), // Description of the task/activity (copied from estimate or manually entered)
  hours: decimal("hours", { precision: 10, scale: 2 }).notNull(),
  pricingMode: text("pricing_mode").notNull(), // "role", "person", or "resource_name"
  rackRate: decimal("rack_rate", { precision: 10, scale: 2 }).notNull(), // Snapshot of rate at time of assignment
  billingRate: decimal("billing_rate", { precision: 10, scale: 2 }),
  costRate: decimal("cost_rate", { precision: 10, scale: 2 }),
  notes: text("notes"),
  estimateLineItemId: varchar("estimate_line_item_id").references(() => estimateLineItems.id), // Link to original estimate
  // Assignment tracking fields
  status: text("status").notNull().default('open'), // open, in_progress, completed, cancelled
  startedDate: date("started_date"), // Automatically set when status → in_progress
  completedDate: date("completed_date"), // Automatically set when status → completed
  roleInstanceLabel: text("role_instance_label"),
  isBaseline: boolean("is_baseline").notNull().default(false),
  baselineId: varchar("baseline_id"),
  // Cascade date shift audit fields
  priorPlannedStartDate: date("prior_planned_start_date"), // Preserved before a cascade shift
  priorPlannedEndDate: date("prior_planned_end_date"),     // Preserved before a cascade shift
  cascadeSourceMilestoneId: varchar("cascade_source_milestone_id"), // FK to the milestone that triggered the cascade
  // Task #126 — Planner LWW: track last human edit for conflict resolution
  // Updated only by interactive user edits, NOT by inbound sync writes.
  lastEditedAt: timestamp("last_edited_at"),
  lastEditedBy: varchar("last_edited_by").references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
}, (table) => ({
  tenantIdx: index("idx_project_allocations_tenant").on(table.tenantId),
  lastEditedIdx: index("idx_project_allocations_last_edited").on(table.lastEditedAt),
}));

export const projectBaselines = pgTable("project_baselines", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: 'cascade' }),
  name: text("name").notNull(),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  createdBy: varchar("created_by").references(() => users.id),
});

// Project Engagements - tracks a user's overall engagement status on a project
// Separate from individual allocations - tracks whether user is actively working on project
export const projectEngagements = pgTable("project_engagements", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id), // Multi-tenancy: nullable during migration
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: 'cascade' }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  status: text("status").notNull().default('active'), // active, complete
  completedAt: timestamp("completed_at"),
  completedBy: varchar("completed_by").references(() => users.id), // User who marked complete (self or admin/PM)
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
});

// User Role Capabilities (multi-role mapping with proficiency levels)
export const userRoleCapabilities = pgTable("user_role_capabilities", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  roleId: varchar("role_id").notNull().references(() => roles.id, { onDelete: 'cascade' }),
  proficiencyLevel: text("proficiency_level").notNull().default("primary"), // primary, secondary, learning
  customCostRate: decimal("custom_cost_rate", { precision: 10, scale: 2 }),
  customBillingRate: decimal("custom_billing_rate", { precision: 10, scale: 2 }),
  notes: text("notes"), // Certifications, experience notes
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
}, (table) => ({
  uniqueUserTenantRole: uniqueIndex("unique_user_tenant_role").on(table.tenantId, table.userId, table.roleId),
  tenantIdx: index("idx_user_role_caps_tenant").on(table.tenantId),
  userIdx: index("idx_user_role_caps_user").on(table.userId),
  roleIdx: index("idx_user_role_caps_role").on(table.roleId),
}));

// Weekly staffing allocations (Weekly Staffing Grid)
export const estimateAllocations = pgTable("estimate_allocations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  activityId: varchar("activity_id").notNull().references(() => estimateActivities.id),
  weekNumber: integer("week_number").notNull(), // Week is a number, not a date
  roleId: varchar("role_id").references(() => roles.id), // Can be either role or person
  personId: varchar("person_id").references(() => users.id),
  personEmail: text("person_email"), // Optional email for person
  hours: decimal("hours", { precision: 10, scale: 2 }).notNull(),
  pricingMode: text("pricing_mode").notNull(), // "role" or "person"
  rackRate: decimal("rack_rate", { precision: 10, scale: 2 }).notNull(), // Snapshot of rate at time of estimate
  notes: text("notes"), // Additional notes for the allocation
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

// Estimate Version Snapshots - immutable audit trail of estimate states
export const estimateVersions = pgTable("estimate_versions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  estimateId: varchar("estimate_id").notNull().references(() => estimates.id, { onDelete: 'cascade' }),
  tenantId: varchar("tenant_id").references(() => tenants.id),
  versionNumber: integer("version_number").notNull(),
  snapshotJson: jsonb("snapshot_json").notNull(), // { header, lineItems, multipliers, totals }
  triggerEvent: text("trigger_event").notNull().default("manual"), // manual, sent, approved, change-order
  notes: text("notes"),
  snapshottedAt: timestamp("snapshotted_at").notNull().default(sql`now()`),
  snapshottedBy: varchar("snapshotted_by").references(() => users.id),
}, (table) => ({
  estimateIdx: index("idx_estimate_versions_estimate").on(table.estimateId),
  uniqueVersion: unique("uq_estimate_versions_version").on(table.estimateId, table.versionNumber),
}));

export const insertEstimateVersionSchema = createInsertSchema(estimateVersions).omit({
  id: true,
  snapshottedAt: true,
});
export type InsertEstimateVersion = z.infer<typeof insertEstimateVersionSchema>;
export type EstimateVersion = typeof estimateVersions.$inferSelect;

// User Rate Schedules (time-based rate management)
export const userRateSchedules = pgTable("user_rate_schedules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  effectiveStart: date("effective_start").notNull(),
  effectiveEnd: date("effective_end"), // null means ongoing
  billingRate: decimal("billing_rate", { precision: 10, scale: 2 }),
  costRate: decimal("cost_rate", { precision: 10, scale: 2 }),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  createdBy: varchar("created_by").references(() => users.id),
});

// Project Rate Overrides
export const projectRateOverrides = pgTable("project_rate_overrides", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id),
  userId: varchar("user_id").notNull().references(() => users.id),
  effectiveStart: date("effective_start").notNull().default(sql`CURRENT_DATE`),
  effectiveEnd: date("effective_end"), // null means ongoing
  billingRate: decimal("billing_rate", { precision: 10, scale: 2 }),
  costRate: decimal("cost_rate", { precision: 10, scale: 2 }),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

// Rate overrides
export const rateOverrides = pgTable("rate_overrides", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id), // Multi-tenancy: nullable during migration
  scope: text("scope").notNull(), // "client" or "project"
  scopeId: varchar("scope_id").notNull(), // clientId or projectId
  subjectType: text("subject_type").notNull(), // "role" or "person"
  subjectId: varchar("subject_id").notNull(), // roleId or personId
  effectiveStart: date("effective_start").notNull(),
  effectiveEnd: date("effective_end"),
  rackRate: decimal("rack_rate", { precision: 10, scale: 2 }).notNull(),
  chargeRate: decimal("charge_rate", { precision: 10, scale: 2 }),
  precedence: integer("precedence").notNull().default(0), // Higher number = higher precedence
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

// Time entries
export const timeSubmissionStatusEnum = z.enum(['draft', 'submitted', 'approved', 'rejected']);
export type TimeSubmissionStatus = z.infer<typeof timeSubmissionStatusEnum>;

export const timeEntries = pgTable("time_entries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id), // Multi-tenancy: nullable during migration
  personId: varchar("person_id").notNull().references(() => users.id),
  projectId: varchar("project_id").notNull().references(() => projects.id),
  date: date("date").notNull(),
  hours: decimal("hours", { precision: 10, scale: 2 }).notNull(),
  phase: text("phase"),
  billable: boolean("billable").notNull().default(true),
  description: text("description"),
  billedFlag: boolean("billed_flag").notNull().default(false),
  statusReportedFlag: boolean("status_reported_flag").notNull().default(false),
  billingRate: decimal("billing_rate", { precision: 10, scale: 2 }), // Billing rate at time of entry
  costRate: decimal("cost_rate", { precision: 10, scale: 2 }), // Cost rate at time of entry
  milestoneId: varchar("milestone_id").references(() => projectMilestones.id), // Optional milestone reference
  workstreamId: varchar("workstream_id").references(() => projectWorkstreams.id), // Optional workstream reference
  projectStageId: varchar("project_stage_id").references(() => projectStages.id),
  allocationId: varchar("allocation_id").references(() => projectAllocations.id), // Optional link to project allocation/assignment
  // Invoice batch locking fields
  invoiceBatchId: text("invoice_batch_id").references(() => invoiceBatches.batchId),
  locked: boolean("locked").notNull().default(false),
  lockedAt: timestamp("locked_at"),
  // Calendar suggestion telemetry
  fromCalendarSuggestion: boolean("from_calendar_suggestion").notNull().default(false),
  calendarEventId: text("calendar_event_id"), // Outlook event ID this entry was created from
  // Approval workflow fields
  submissionStatus: text("submission_status").notNull().default("draft"), // draft, submitted, approved, rejected
  submittedAt: timestamp("submitted_at"),
  submittedBy: varchar("submitted_by").references(() => users.id),
  approvedBy: varchar("approved_by").references(() => users.id),
  approvedAt: timestamp("approved_at"),
  rejectionNote: text("rejection_note"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
}, (table) => ({
  tenantIdx: index("idx_time_entries_tenant").on(table.tenantId),
  submissionStatusIdx: index("idx_time_entries_submission_status").on(table.submissionStatus),
}));

// Expenses
export const expenses = pgTable("expenses", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id), // Multi-tenancy: nullable during migration
  personId: varchar("person_id").notNull().references(() => users.id),
  projectId: varchar("project_id").notNull().references(() => projects.id),
  projectResourceId: varchar("project_resource_id").references(() => users.id), // User assigned to this expense within the project
  date: date("date").notNull(),
  category: text("category").notNull(), // travel, hotel, meals, taxi, airfare, parking, entertainment, mileage, perdiem
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  quantity: decimal("quantity", { precision: 10, scale: 2 }), // Nullable, for tracking quantity (e.g., miles for mileage, days for per diem)
  unit: text("unit"), // Nullable, for tracking unit of measurement (e.g., "mile" for mileage, "day" for per diem)
  currency: text("currency").notNull().default("USD"),
  billable: boolean("billable").notNull().default(true),
  reimbursable: boolean("reimbursable").notNull().default(true),
  description: text("description"),
  vendor: text("vendor"), // Merchant/vendor name (e.g., Alaska Airlines, Starbucks, Hyatt)
  receiptUrl: text("receipt_url"),
  billedFlag: boolean("billed_flag").notNull().default(false),
  // Airfare specific fields
  departureAirport: text("departure_airport"), // Three-letter airport code (e.g., "SEA", "SFO")
  arrivalAirport: text("arrival_airport"), // Three-letter airport code (e.g., "LAX", "JFK")
  isRoundTrip: boolean("is_round_trip").default(false), // If true, shows both directions on invoice
  // Per Diem specific fields
  perDiemLocation: text("per_diem_location"), // Location string (e.g., "Washington, DC" or "ZIP 20001")
  perDiemMealsRate: decimal("per_diem_meals_rate", { precision: 10, scale: 2 }), // GSA M&IE rate
  perDiemLodgingRate: decimal("per_diem_lodging_rate", { precision: 10, scale: 2 }), // GSA lodging rate
  perDiemBreakdown: jsonb("per_diem_breakdown"), // Detailed breakdown: { fullDays: 2, partialDays: 1, mealsTotal: 148, lodgingTotal: 200 }
  // Per Diem day-by-day component selections (for meal deductions when client provides meals)
  // Format: [{ date: "2025-01-24", isClientEngagement: true, breakfast: true, lunch: false, dinner: true, incidentals: true }]
  perDiemDays: jsonb("per_diem_days"), // Array of day selections with meal component checkboxes
  // Approval workflow fields
  approvalStatus: text("approval_status").notNull().default("draft"), // draft, submitted, approved, rejected, reimbursed
  submittedAt: timestamp("submitted_at"),
  approvedAt: timestamp("approved_at"),
  approvedBy: varchar("approved_by").references(() => users.id),
  rejectedAt: timestamp("rejected_at"),
  rejectedBy: varchar("rejected_by").references(() => users.id),
  rejectionNote: text("rejection_note"),
  reimbursedAt: timestamp("reimbursed_at"),
  reimbursementBatchId: varchar("reimbursement_batch_id"), // Will reference reimbursementBatches
  // Payroll integration: when the reimbursement was paid via a payroll run
  // (Gemini), this points at the run item it rode in on. Mutually exclusive
  // with reimbursementBatchId in normal operation. ON DELETE SET NULL so a
  // reversed run releasing its items doesn't break the expense.
  payrollRunItemId: varchar("payroll_run_item_id").references(
    (): any => payrollRunItems.id,
    { onDelete: 'set null' },
  ),
  payrollReimbursedAt: timestamp("payroll_reimbursed_at"),
  clientPaidAt: timestamp("client_paid_at"), // When client paid for this expense via invoice batch
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
}, (table) => ({
  tenantIdx: index("idx_expenses_tenant").on(table.tenantId),
}));

// Expense Attachments (for SharePoint file integration)
export const expenseAttachments = pgTable("expense_attachments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  expenseId: varchar("expense_id").notNull().references(() => expenses.id),
  driveId: text("drive_id").notNull(), // SharePoint drive ID
  itemId: text("item_id").notNull(), // SharePoint item ID
  webUrl: text("web_url").notNull(), // SharePoint web URL
  fileName: text("file_name").notNull(), // Original filename
  contentType: text("content_type").notNull(), // MIME type
  size: integer("size").notNull(), // File size in bytes
  createdByUserId: varchar("created_by_user_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

// Pending Receipts (for bulk upload before expense assignment)
export const pendingReceipts = pgTable("pending_receipts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  // Local file information
  fileName: text("file_name").notNull(), // Stored filename
  originalName: text("original_name").notNull(), // Original uploaded filename  
  filePath: text("file_path").notNull(), // Local file system path
  contentType: text("content_type").notNull(), // MIME type
  size: integer("size").notNull(), // File size in bytes
  
  // Receipt metadata
  projectId: varchar("project_id").references(() => projects.id), // Optional project assignment
  uploadedBy: varchar("uploaded_by").notNull().references(() => users.id), // User who uploaded
  status: text("status").notNull().default("pending"), // pending, assigned, processed
  
  // Receipt details (extracted/assigned)
  receiptDate: date("receipt_date"), // Date from receipt
  amount: decimal("amount", { precision: 10, scale: 2 }), // Receipt amount
  currency: text("currency").default("USD"), // Currency
  category: text("category"), // Expense category
  vendor: text("vendor"), // Merchant/vendor name
  description: text("description"), // Receipt description
  isReimbursable: boolean("is_reimbursable").default(true), // Whether reimbursable
  tags: text("tags"), // Additional categorization tags
  
  // Conversion tracking
  expenseId: varchar("expense_id").references(() => expenses.id), // Set when converted to expense
  assignedAt: timestamp("assigned_at"), // When converted to expense
  assignedBy: varchar("assigned_by").references(() => users.id), // Who converted it
  
  // Timestamps
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
});

// Expense Reports - For grouping expenses into submission batches for approval
export const expenseReports = pgTable("expense_reports", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id), // Multi-tenancy: nullable during migration
  reportNumber: text("report_number").notNull().unique(), // Auto-generated report number (e.g., EXP-2025-10-001)
  submitterId: varchar("submitter_id").notNull().references(() => users.id),
  status: text("status").notNull().default("draft"), // draft, submitted, approved, rejected
  title: text("title").notNull(), // User-provided title for the report
  description: text("description"), // Optional description
  totalAmount: decimal("total_amount", { precision: 10, scale: 2 }).notNull().default("0"),
  currency: text("currency").notNull().default("USD"),
  // Workflow tracking
  submittedAt: timestamp("submitted_at"),
  approvedAt: timestamp("approved_at"),
  approvedBy: varchar("approved_by").references(() => users.id),
  rejectedAt: timestamp("rejected_at"),
  rejectedBy: varchar("rejected_by").references(() => users.id),
  rejectionNote: text("rejection_note"), // Admin's explanation for rejection
  // Contractor invoice payment path (independent of reimbursement batches)
  contractorInvoiceId: varchar("contractor_invoice_id"), // FK set after invoice is created (circular dep avoidance)
  reimbursementStatus: text("reimbursement_status").default("pending"), // pending, paid (when paid via contractor invoice)
  // Timestamps
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
}, (table) => ({
  submitterIdx: index("expense_reports_submitter_idx").on(table.submitterId),
  statusIdx: index("expense_reports_status_idx").on(table.status),
}));

// Expense Report Items - Links individual expenses to expense reports
export const expenseReportItems = pgTable("expense_report_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  reportId: varchar("report_id").notNull().references(() => expenseReports.id, { onDelete: 'cascade' }),
  expenseId: varchar("expense_id").notNull().references(() => expenses.id, { onDelete: 'cascade' }),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
}, (table) => ({
  reportIdx: index("expense_report_items_report_idx").on(table.reportId),
  expenseIdx: index("expense_report_items_expense_idx").on(table.expenseId),
  uniqueExpensePerReport: uniqueIndex("unique_expense_per_report").on(table.reportId, table.expenseId),
}));

// Reimbursement Batches - For processing approved expenses for reimbursement
export const reimbursementBatches = pgTable("reimbursement_batches", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id), // Multi-tenancy: nullable during migration
  batchNumber: text("batch_number").notNull().unique(), // Auto-generated batch number (e.g., REIMB-2025-10-001)
  status: text("status").notNull().default("pending"), // pending, under_review, processed
  totalAmount: decimal("total_amount", { precision: 10, scale: 2 }).notNull().default("0"),
  currency: text("currency").notNull().default("USD"),
  description: text("description"),
  requestedBy: varchar("requested_by").references(() => users.id), // Employee who requested (or admin who created on behalf)
  requestedForUserId: varchar("requested_for_user_id").references(() => users.id), // The employee being reimbursed
  paymentReferenceNumber: text("payment_reference_number"), // Reference number when processed
  // Approval tracking
  approvedAt: timestamp("approved_at"),
  approvedBy: varchar("approved_by").references(() => users.id),
  processedAt: timestamp("processed_at"), // When reimbursement was actually processed/paid
  processedBy: varchar("processed_by").references(() => users.id),
  // Timestamps
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
}, (table) => ({
  statusIdx: index("reimbursement_batches_status_idx").on(table.status),
}));

export const reimbursementLineItems = pgTable("reimbursement_line_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id),
  batchId: varchar("batch_id").notNull().references(() => reimbursementBatches.id),
  expenseId: varchar("expense_id").notNull().references(() => expenses.id),
  status: text("status").notNull().default("pending"), // pending, approved, declined
  reviewNote: text("review_note"), // Finance reviewer's note
  reviewedBy: varchar("reviewed_by").references(() => users.id),
  reviewedAt: timestamp("reviewed_at"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
}, (table) => ({
  batchIdx: index("reimbursement_line_items_batch_idx").on(table.batchId),
  expenseIdx: index("reimbursement_line_items_expense_idx").on(table.expenseId),
}));

// Contractor Invoices - Formal invoices submitted by contractors for approved expense reports
export const contractorInvoices = pgTable("contractor_invoices", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id),
  reportId: varchar("report_id").notNull().references(() => expenseReports.id, { onDelete: 'cascade' }),
  invoiceNumber: text("invoice_number").notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("USD"),
  contractorUserId: varchar("contractor_user_id").notNull().references(() => users.id),
  // Bill-to (recipient) fields
  billToName: text("bill_to_name").notNull(),
  billToAddress: text("bill_to_address"),
  billToContact: text("bill_to_contact"),
  // File storage reference for the PDF
  pdfFileId: text("pdf_file_id"),
  pdfFileName: text("pdf_file_name"),
  // Status lifecycle: submitted -> approved -> paid
  status: text("status").notNull().default("submitted"), // submitted, approved, paid
  submittedAt: timestamp("submitted_at").notNull().default(sql`now()`),
  approvedAt: timestamp("approved_at"),
  approvedBy: varchar("approved_by").references(() => users.id),
  paidAt: timestamp("paid_at"),
  paidBy: varchar("paid_by").references(() => users.id),
  paymentNote: text("payment_note"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
}, (table) => ({
  reportIdx: index("contractor_invoices_report_idx").on(table.reportId),
  contractorIdx: index("contractor_invoices_contractor_idx").on(table.contractorUserId),
  statusIdx: index("contractor_invoices_status_idx").on(table.status),
  tenantIdx: index("contractor_invoices_tenant_idx").on(table.tenantId),
}));

// Add unique constraint for project rate overrides
export const projectRateOverridesUniqueConstraint = sql`
  CREATE UNIQUE INDEX IF NOT EXISTS project_rate_overrides_unique_idx 
  ON project_rate_overrides(project_id, user_id, effective_start)
`;

// SOWs (Statements of Work) - One-to-many relationship with projects
export const sows = pgTable("sows", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id),
  type: text("type").notNull().default("initial"), // "initial" or "change_order"
  name: text("name").notNull(), // e.g., "Initial SOW", "Change Order #1"
  description: text("description"),
  value: decimal("value", { precision: 10, scale: 2 }).notNull(), // Dollar value in quoteCurrency
  hours: decimal("hours", { precision: 10, scale: 2 }), // Optional hour budget
  documentUrl: text("document_url"), // Link to uploaded document
  documentName: text("document_name"), // Original filename
  signedDate: date("signed_date"),
  effectiveDate: date("effective_date").notNull(),
  expirationDate: date("expiration_date"),
  status: text("status").notNull().default("draft"), // draft, pending, approved, rejected, expired
  approvedBy: varchar("approved_by").references(() => users.id),
  approvedAt: timestamp("approved_at"),
  notes: text("notes"),
  // Currency snapshot — inherited from linked project at creation time
  quoteCurrency: varchar("quote_currency", { length: 3 }).notNull().default("USD"),
  costCurrency: varchar("cost_currency", { length: 3 }).notNull().default("USD"),
  exchangeRate: decimal("exchange_rate", { precision: 12, scale: 6 }), // costCurrency per 1 quoteCurrency
  exchangeRateLockedAt: timestamp("exchange_rate_locked_at"),
  exchangeRateSource: varchar("exchange_rate_source", { length: 20 }).default("live"), // 'live', 'locked', 'manual'
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
}, (table) => ({
  // Ensure only one approved or pending initial SOW per project
  uniqueInitialSow: uniqueIndex("unique_initial_sow_per_project")
    .on(table.projectId)
    .where(sql`${table.type} = 'initial' AND ${table.status} IN ('approved', 'pending')`),
}));

// Keep change orders for backward compatibility but it will be replaced by SOWs with type="change_order"
export const changeOrders = pgTable("change_orders", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id),
  reason: text("reason").notNull(),
  approvedOn: timestamp("approved_on"),
  deltaHours: decimal("delta_hours", { precision: 10, scale: 2 }),
  deltaFees: decimal("delta_fees", { precision: 10, scale: 2 }),
  status: text("status").notNull().default("draft"), // draft, approved, rejected
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

// Project Budget History - Audit trail for budget changes
export const projectBudgetHistory = pgTable("project_budget_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id),
  changeType: text("change_type").notNull(), // "sow_approval", "change_order_approval", "manual_adjustment", "sow_rejection"
  fieldChanged: text("field_changed").notNull(), // "sowTotal", "baselineBudget", "sowValue"
  previousValue: decimal("previous_value", { precision: 12, scale: 2 }),
  newValue: decimal("new_value", { precision: 12, scale: 2 }),
  deltaValue: decimal("delta_value", { precision: 12, scale: 2 }), // Calculated: newValue - previousValue
  sowId: varchar("sow_id").references(() => sows.id), // Reference to SOW if this change was triggered by SOW
  changedBy: varchar("changed_by").notNull().references(() => users.id),
  reason: text("reason"), // Optional explanation for manual adjustments
  metadata: jsonb("metadata"), // Additional context (SOW name, type, etc.)
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

// Status Reports - Persisted status reports generated via AI
export const statusReports = pgTable("status_reports", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").references(() => projects.id),
  tenantId: varchar("tenant_id").references(() => tenants.id),
  title: text("title").notNull(),
  reportType: text("report_type").notNull().default("text"), // text, pptx, executive_narrative
  reportStyle: text("report_style").notNull().default("detailed_update"), // executive_brief, detailed_update, client_facing
  periodStart: date("period_start").notNull(),
  periodEnd: date("period_end").notNull(),
  reportContent: text("report_content"), // Markdown content for text reports
  status: text("status").notNull().default("draft"), // draft, final
  speFileId: text("spe_file_id"),
  speContainerId: text("spe_container_id"),
  metadata: jsonb("metadata"), // { totalHours, totalBillableHours, totalExpenses, teamMemberCount, raidd counts, etc. }
  generatedBy: varchar("generated_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
}, (table) => ({
  projectIdx: index("idx_status_reports_project").on(table.projectId),
  tenantIdx: index("idx_status_reports_tenant").on(table.tenantId),
}));

export const statusReportsRelations = relations(statusReports, ({ one }) => ({
  project: one(projects, { fields: [statusReports.projectId], references: [projects.id] }),
  tenant: one(tenants, { fields: [statusReports.tenantId], references: [tenants.id] }),
  generator: one(users, { fields: [statusReports.generatedBy], references: [users.id] }),
}));

export const insertStatusReportSchema = createInsertSchema(statusReports).omit({
  id: true,
  createdAt: true,
});
export type InsertStatusReport = z.infer<typeof insertStatusReportSchema>;
export type StatusReport = typeof statusReports.$inferSelect;

// Invoice batches
export const invoiceBatches = pgTable("invoice_batches", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id), // Multi-tenancy: nullable during migration
  batchId: text("batch_id").notNull().unique(),
  // Support custom date ranges instead of just month
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  // Keep month for backward compatibility
  month: date("month"),
  pricingSnapshotDate: date("pricing_snapshot_date").notNull(),
  discountPercent: decimal("discount_percent", { precision: 5, scale: 2 }),
  discountAmount: decimal("discount_amount", { precision: 10, scale: 2 }),
  totalAmount: decimal("total_amount", { precision: 10, scale: 2 }),
  aggregateAdjustmentTotal: decimal("aggregate_adjustment_total", { precision: 12, scale: 2 }), // Total of all aggregate adjustments
  // Tax fields (applied at batch level, not individual services/expenses)
  taxRate: decimal("tax_rate", { precision: 5, scale: 2 }).default('9.3'), // Tax rate percentage (default 9.3%)
  taxAmount: decimal("tax_amount", { precision: 10, scale: 2 }), // Calculated tax amount
  taxAmountOverride: decimal("tax_amount_override", { precision: 10, scale: 2 }), // Manual override for tax amount (bypasses calculation)
  // GL System integration
  glInvoiceNumber: text("gl_invoice_number"), // External GL system invoice number (e.g., QuickBooks, NetSuite)
  invoicingMode: text("invoicing_mode").notNull().default("client"), // "client" or "project"
  batchType: text("batch_type").notNull().default("mixed"), // "services", "expenses", or "mixed"
  paymentTerms: text("payment_terms"), // Optional payment terms override for this batch
  status: text("status").notNull().default("draft"), // draft, reviewed, finalized
  finalizedAt: timestamp("finalized_at"),
  finalizedBy: varchar("finalized_by").references(() => users.id),
  createdBy: varchar("created_by").references(() => users.id), // Track who created the batch
  // Payment milestone link - one invoice batch per payment milestone
  projectMilestoneId: varchar("project_milestone_id").references(() => projectMilestones.id), // Now references unified milestones table
  // Revenue recognition date tracking
  asOfDate: date("as_of_date"), // Date for revenue recognition (defaults to finalized date)
  asOfDateUpdatedBy: varchar("as_of_date_updated_by").references(() => users.id),
  asOfDateUpdatedAt: timestamp("as_of_date_updated_at"),
  notes: text("notes"), // For review comments
  exportedToQBO: boolean("exported_to_qbo").notNull().default(false),
  exportedAt: timestamp("exported_at"),
  // Invoice PDF storage
  pdfFileId: text("pdf_file_id"), // Object Storage file ID or local filesystem path
  // Payment tracking
  paymentStatus: text("payment_status").notNull().default("unpaid"), // unpaid, partial, paid
  paymentDate: date("payment_date"), // Date payment was received
  paymentAmount: decimal("payment_amount", { precision: 10, scale: 2 }), // Amount paid (for partial payments)
  paymentNotes: text("payment_notes"), // Notes about payment
  paymentUpdatedBy: varchar("payment_updated_by").references(() => users.id), // Who updated payment status
  paymentUpdatedAt: timestamp("payment_updated_at"), // When payment status was updated
  // Multi-currency: snapshot from the project at batch creation time
  quoteCurrency: varchar("quote_currency", { length: 3 }).notNull().default("USD"),
  costCurrency: varchar("cost_currency", { length: 3 }).notNull().default("USD"),
  exchangeRate: decimal("exchange_rate", { precision: 12, scale: 6 }), // costCurrency per 1 quoteCurrency
  exchangeRateLockedAt: timestamp("exchange_rate_locked_at"),
  exchangeRateSource: varchar("exchange_rate_source", { length: 20 }).default("live"), // 'live', 'locked', 'manual'
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
}, (table) => ({
  tenantIdx: index("idx_invoice_batches_tenant").on(table.tenantId),
  // One invoice batch per payment milestone — enforced as a partial unique
  // index so multiple non-milestone batches with NULL still coexist.
  uniqueProjectMilestone: uniqueIndex("idx_invoice_batches_project_milestone_unique")
    .on(table.projectMilestoneId)
    .where(sql`${table.projectMilestoneId} IS NOT NULL`),
}));

// Invoice lines
export const invoiceLines = pgTable("invoice_lines", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  batchId: text("batch_id").notNull().references(() => invoiceBatches.batchId),
  projectId: varchar("project_id").notNull().references(() => projects.id),
  clientId: varchar("client_id").notNull().references(() => clients.id), // Track client for grouping
  type: text("type").notNull(), // time, expense, milestone, discount, no-charge
  quantity: decimal("quantity", { precision: 10, scale: 2 }),
  rate: decimal("rate", { precision: 10, scale: 2 }),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  description: text("description"),
  // Adjustment tracking fields
  originalAmount: decimal("original_amount", { precision: 12, scale: 2 }), // Original calculated amount before adjustments
  billedAmount: decimal("billed_amount", { precision: 12, scale: 2 }), // Final amount being billed to client
  varianceAmount: decimal("variance_amount", { precision: 12, scale: 2 }), // Difference between original and billed
  originalRate: decimal("original_rate", { precision: 12, scale: 2 }), // Original rate before adjustment
  originalQuantity: decimal("original_quantity", { precision: 12, scale: 2 }), // Original quantity before adjustment
  adjustmentType: text("adjustment_type"), // 'line' | 'aggregate' | null
  adjustmentReason: text("adjustment_reason"), // Why the adjustment was made
  editedBy: varchar("edited_by").references(() => users.id), // Who made the adjustment
  editedAt: timestamp("edited_at"), // When the adjustment was made
  projectMilestoneId: varchar("project_milestone_id").references(() => projectMilestones.id), // Link to milestone
  isAdjustment: boolean("is_adjustment").notNull().default(false), // Flag for adjustment lines vs generated lines
  allocationGroupId: varchar("allocation_group_id"), // Groups related adjustment lines
  sowId: varchar("sow_id").references(() => sows.id), // Reference to SOW if applicable
  taxable: boolean("taxable").notNull().default(true), // Whether this line is subject to tax (expenses default to false)
  expenseCategory: text("expense_category"), // Category for expense lines (e.g., "Per Diem", "Hotel", "Travel"); null for service lines
  originalCurrency: text("original_currency"), // Original currency of expense (USD, CAD, EUR, GBP)
  originalCurrencyAmount: decimal("original_currency_amount", { precision: 12, scale: 2 }), // Amount in original currency
  exchangeRate: decimal("exchange_rate", { precision: 12, scale: 6 }), // Exchange rate used for conversion
  sourceExpenseId: varchar("source_expense_id").references(() => expenses.id), // Link back to source expense for traceability
  sourceTimeEntryId: varchar("source_time_entry_id").references(() => timeEntries.id), // Link back to source time entry for traceability
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

// Invoice adjustments
export const invoiceAdjustments = pgTable("invoice_adjustments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  batchId: text("batch_id").notNull().references(() => invoiceBatches.batchId),
  scope: text("scope").notNull(), // 'line' | 'aggregate'
  method: text("method").notNull(), // 'pro_rata_amount' | 'pro_rata_hours' | 'flat' | 'manual'
  targetAmount: decimal("target_amount", { precision: 12, scale: 2 }),
  reason: text("reason"),
  createdBy: varchar("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  metadata: jsonb("metadata"), // For storing allocation details
  sowId: varchar("sow_id").references(() => sows.id),
  projectId: varchar("project_id").references(() => projects.id)
});

// Relations
export const usersRelations = relations(users, ({ many }) => ({
  timeEntries: many(timeEntries),
  expenses: many(expenses),
  allocations: many(estimateAllocations),
  projectRateOverrides: many(projectRateOverrides),
}));

export const clientsRelations = relations(clients, ({ many }) => ({
  projects: many(projects),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  client: one(clients, {
    fields: [projects.clientId],
    references: [clients.id],
  }),
  pm: one(users, {
    fields: [projects.pm],
    references: [users.id],
  }),
  estimates: many(estimates),
  timeEntries: many(timeEntries),
  expenses: many(expenses),
  changeOrders: many(changeOrders),
  invoiceLines: many(invoiceLines),
  epics: many(projectEpics),
  workstreams: many(projectWorkstreams),
  rateOverrides: many(projectRateOverrides),
  engagements: many(projectEngagements),
}));

export const projectEngagementsRelations = relations(projectEngagements, ({ one }) => ({
  project: one(projects, {
    fields: [projectEngagements.projectId],
    references: [projects.id],
  }),
  user: one(users, {
    fields: [projectEngagements.userId],
    references: [users.id],
  }),
  completedByUser: one(users, {
    fields: [projectEngagements.completedBy],
    references: [users.id],
  }),
}));

export const estimatesRelations = relations(estimates, ({ one, many }) => ({
  project: one(projects, {
    fields: [estimates.projectId],
    references: [projects.id],
  }),
  client: one(clients, {
    fields: [estimates.clientId],
    references: [clients.id],
  }),
  channel: one(estimateChannels, {
    fields: [estimates.id],
    references: [estimateChannels.estimateId],
  }),
  epics: many(estimateEpics),
  lineItems: many(estimateLineItems),
  rateOverrides: many(estimateRateOverrides),
}));

export const estimateChannelsRelations = relations(estimateChannels, ({ one }) => ({
  estimate: one(estimates, {
    fields: [estimateChannels.estimateId],
    references: [estimates.id],
  }),
}));

export const estimateLineItemsRelations = relations(estimateLineItems, ({ one }) => ({
  estimate: one(estimates, {
    fields: [estimateLineItems.estimateId],
    references: [estimates.id],
  }),
  epic: one(estimateEpics, {
    fields: [estimateLineItems.epicId],
    references: [estimateEpics.id],
  }),
  stage: one(estimateStages, {
    fields: [estimateLineItems.stageId],
    references: [estimateStages.id],
  }),
}));

export const estimateRateOverridesRelations = relations(estimateRateOverrides, ({ one }) => ({
  estimate: one(estimates, {
    fields: [estimateRateOverrides.estimateId],
    references: [estimates.id],
  }),
  createdByUser: one(users, {
    fields: [estimateRateOverrides.createdBy],
    references: [users.id],
  }),
}));

export const estimateEpicsRelations = relations(estimateEpics, ({ one, many }) => ({
  estimate: one(estimates, {
    fields: [estimateEpics.estimateId],
    references: [estimates.id],
  }),
  stages: many(estimateStages),
}));

export const estimateStagesRelations = relations(estimateStages, ({ one, many }) => ({
  epic: one(estimateEpics, {
    fields: [estimateStages.epicId],
    references: [estimateEpics.id],
  }),
  activities: many(estimateActivities),
}));

export const estimateActivitiesRelations = relations(estimateActivities, ({ one, many }) => ({
  stage: one(estimateStages, {
    fields: [estimateActivities.stageId],
    references: [estimateStages.id],
  }),
  allocations: many(estimateAllocations),
}));

// Project structure relations
export const projectEpicsRelations = relations(projectEpics, ({ one, many }) => ({
  project: one(projects, {
    fields: [projectEpics.projectId],
    references: [projects.id],
  }),
  estimateEpic: one(estimateEpics, {
    fields: [projectEpics.estimateEpicId],
    references: [estimateEpics.id],
  }),
  stages: many(projectStages),
  milestones: many(projectMilestones),
}));

export const projectStagesRelations = relations(projectStages, ({ one, many }) => ({
  epic: one(projectEpics, {
    fields: [projectStages.epicId],
    references: [projectEpics.id],
  }),
  activities: many(projectActivities),
}));

export const projectActivitiesRelations = relations(projectActivities, ({ one }) => ({
  stage: one(projectStages, {
    fields: [projectActivities.stageId],
    references: [projectStages.id],
  }),
}));

export const projectWorkstreamsRelations = relations(projectWorkstreams, ({ one }) => ({
  project: one(projects, {
    fields: [projectWorkstreams.projectId],
    references: [projects.id],
  }),
}));

export const projectMilestonesRelations = relations(projectMilestones, ({ one }) => ({
  projectEpic: one(projectEpics, {
    fields: [projectMilestones.projectEpicId],
    references: [projectEpics.id],
  }),
  estimateStage: one(estimateStages, {
    fields: [projectMilestones.estimateStageId],
    references: [estimateStages.id],
  }),
}));

export const projectRateOverridesRelations = relations(projectRateOverrides, ({ one }) => ({
  project: one(projects, {
    fields: [projectRateOverrides.projectId],
    references: [projects.id],
  }),
  user: one(users, {
    fields: [projectRateOverrides.userId],
    references: [users.id],
  }),
}));

export const rolesRelations = relations(roles, ({ many }) => ({
  allocations: many(estimateAllocations),
}));

export const timeEntriesRelations = relations(timeEntries, ({ one }) => ({
  person: one(users, {
    fields: [timeEntries.personId],
    references: [users.id],
  }),
  project: one(projects, {
    fields: [timeEntries.projectId],
    references: [projects.id],
  }),
}));

export const expensesRelations = relations(expenses, ({ one, many }) => ({
  person: one(users, {
    fields: [expenses.personId],
    references: [users.id],
  }),
  project: one(projects, {
    fields: [expenses.projectId],
    references: [projects.id],
  }),
  attachments: many(expenseAttachments),
  reportItems: many(expenseReportItems),
  approver: one(users, {
    fields: [expenses.approvedBy],
    references: [users.id],
    relationName: "expenseApprovals",
  }),
  rejecter: one(users, {
    fields: [expenses.rejectedBy],
    references: [users.id],
    relationName: "expenseRejections",
  }),
}));

export const expenseAttachmentsRelations = relations(expenseAttachments, ({ one }) => ({
  expense: one(expenses, {
    fields: [expenseAttachments.expenseId],
    references: [expenses.id],
  }),
  createdByUser: one(users, {
    fields: [expenseAttachments.createdByUserId],
    references: [users.id],
  }),
}));

export const expenseReportsRelations = relations(expenseReports, ({ one, many }) => ({
  submitter: one(users, {
    fields: [expenseReports.submitterId],
    references: [users.id],
  }),
  approver: one(users, {
    fields: [expenseReports.approvedBy],
    references: [users.id],
    relationName: "expenseReportApprovals",
  }),
  rejecter: one(users, {
    fields: [expenseReports.rejectedBy],
    references: [users.id],
    relationName: "expenseReportRejections",
  }),
  items: many(expenseReportItems),
}));

export const expenseReportItemsRelations = relations(expenseReportItems, ({ one }) => ({
  report: one(expenseReports, {
    fields: [expenseReportItems.reportId],
    references: [expenseReports.id],
  }),
  expense: one(expenses, {
    fields: [expenseReportItems.expenseId],
    references: [expenses.id],
  }),
}));

export const reimbursementBatchesRelations = relations(reimbursementBatches, ({ one, many }) => ({
  approver: one(users, {
    fields: [reimbursementBatches.approvedBy],
    references: [users.id],
    relationName: "reimbursementBatchApprovals",
  }),
  processor: one(users, {
    fields: [reimbursementBatches.processedBy],
    references: [users.id],
    relationName: "reimbursementBatchProcessors",
  }),
  requester: one(users, {
    fields: [reimbursementBatches.requestedBy],
    references: [users.id],
    relationName: "reimbursementBatchRequesters",
  }),
  requestedForUser: one(users, {
    fields: [reimbursementBatches.requestedForUserId],
    references: [users.id],
    relationName: "reimbursementBatchRecipients",
  }),
  lineItems: many(reimbursementLineItems),
}));

export const reimbursementLineItemsRelations = relations(reimbursementLineItems, ({ one }) => ({
  batch: one(reimbursementBatches, {
    fields: [reimbursementLineItems.batchId],
    references: [reimbursementBatches.id],
  }),
  expense: one(expenses, {
    fields: [reimbursementLineItems.expenseId],
    references: [expenses.id],
  }),
  reviewer: one(users, {
    fields: [reimbursementLineItems.reviewedBy],
    references: [users.id],
  }),
}));

export const pendingReceiptsRelations = relations(pendingReceipts, ({ one }) => ({
  project: one(projects, {
    fields: [pendingReceipts.projectId],
    references: [projects.id],
  }),
  uploadedByUser: one(users, {
    fields: [pendingReceipts.uploadedBy],
    references: [users.id],
  }),
  assignedByUser: one(users, {
    fields: [pendingReceipts.assignedBy],
    references: [users.id],
  }),
  expense: one(expenses, {
    fields: [pendingReceipts.expenseId],
    references: [expenses.id],
  }),
}));

export const estimateAllocationsRelations = relations(estimateAllocations, ({ one }) => ({
  activity: one(estimateActivities, {
    fields: [estimateAllocations.activityId],
    references: [estimateActivities.id],
  }),
  role: one(roles, {
    fields: [estimateAllocations.roleId],
    references: [roles.id],
  }),
  person: one(users, {
    fields: [estimateAllocations.personId],
    references: [users.id],
  }),
}));

export const invoiceBatchesRelations = relations(invoiceBatches, ({ many, one }) => ({
  lines: many(invoiceLines),
  adjustments: many(invoiceAdjustments),
  finalizer: one(users, {
    fields: [invoiceBatches.finalizedBy],
    references: [users.id],
  }),
  creator: one(users, {
    fields: [invoiceBatches.createdBy],
    references: [users.id],
  }),
}));

export const invoiceLinesRelations = relations(invoiceLines, ({ one }) => ({
  batch: one(invoiceBatches, {
    fields: [invoiceLines.batchId],
    references: [invoiceBatches.batchId],
  }),
  project: one(projects, {
    fields: [invoiceLines.projectId],
    references: [projects.id],
  }),
  client: one(clients, {
    fields: [invoiceLines.clientId],
    references: [clients.id],
  }),
  editor: one(users, {
    fields: [invoiceLines.editedBy],
    references: [users.id],
  }),
  milestone: one(projectMilestones, {
    fields: [invoiceLines.projectMilestoneId],
    references: [projectMilestones.id],
  }),
  sow: one(sows, {
    fields: [invoiceLines.sowId],
    references: [sows.id],
  }),
  sourceExpense: one(expenses, {
    fields: [invoiceLines.sourceExpenseId],
    references: [expenses.id],
  }),
  sourceTimeEntry: one(timeEntries, {
    fields: [invoiceLines.sourceTimeEntryId],
    references: [timeEntries.id],
  }),
}));

export const invoiceAdjustmentsRelations = relations(invoiceAdjustments, ({ one }) => ({
  batch: one(invoiceBatches, {
    fields: [invoiceAdjustments.batchId],
    references: [invoiceBatches.batchId],
  }),
  creator: one(users, {
    fields: [invoiceAdjustments.createdBy],
    references: [users.id],
  }),
  project: one(projects, {
    fields: [invoiceAdjustments.projectId],
    references: [projects.id],
  }),
  sow: one(sows, {
    fields: [invoiceAdjustments.sowId],
    references: [sows.id],
  }),
}));

// ============================================================================
// Insert Schemas - Multi-Tenancy Tables
// ============================================================================

export const insertServicePlanSchema = createInsertSchema(servicePlans).omit({
  id: true,
  createdAt: true,
});

export const insertTenantSchema = createInsertSchema(tenants).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertBlockedDomainSchema = createInsertSchema(blockedDomains).omit({
  id: true,
  createdAt: true,
});

export const insertTenantUserSchema = createInsertSchema(tenantUsers).omit({
  id: true,
  createdAt: true,
});

export const insertConsultantAccessSchema = createInsertSchema(consultantAccess).omit({
  id: true,
  createdAt: true,
  grantedAt: true,
});

// ============================================================================
// Insert Schemas - Core Tables
// ============================================================================

export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
}).extend({
  email: z.string().email().optional().nullable(), // Email is now optional
});

export const insertClientSchema = createInsertSchema(clients).omit({
  id: true,
  createdAt: true,
}).extend({
  status: z.enum(["pending", "active", "inactive", "archived"]).default("pending"),
  msaDate: z.string().nullish(), // Date input as string or null
  sinceDate: z.string().nullish(), // Date input as string or null
  msaDocument: z.string().optional(), // File path/name
  hasMsa: z.boolean().default(false),
  ndaDate: z.string().nullish(), // Date input as string or null
  ndaDocument: z.string().optional(), // File path/name
  hasNda: z.boolean().default(false)
});

export const insertProjectSchema = createInsertSchema(projects).omit({
  id: true,
  createdAt: true,
});

// Project structure insert schemas
export const insertProjectEpicSchema = createInsertSchema(projectEpics).omit({
  id: true,
  createdAt: true,
});

export const insertProjectStageSchema = createInsertSchema(projectStages).omit({
  id: true,
  createdAt: true,
});

export const insertProjectActivitySchema = createInsertSchema(projectActivities).omit({
  id: true,
  createdAt: true,
});

export const insertProjectWorkstreamSchema = createInsertSchema(projectWorkstreams).omit({
  id: true,
  createdAt: true,
});

export const insertProjectMilestoneSchema = createInsertSchema(projectMilestones).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  actualHours: true,
  completedDate: true,
});

export const insertProjectAllocationSchema = createInsertSchema(projectAllocations).omit({
  id: true,
  createdAt: true,
}).extend({
  hours: z.union([z.string(), z.number()]).transform(val => String(val)),
  rackRate: z.union([z.string(), z.number()]).transform(val => String(val)),
});

export const insertProjectBaselineSchema = createInsertSchema(projectBaselines).omit({
  id: true,
  createdAt: true,
});

export const insertProjectEngagementSchema = createInsertSchema(projectEngagements).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertUserRoleCapabilitySchema = createInsertSchema(userRoleCapabilities).omit({
  id: true,
  createdAt: true,
}).extend({
  proficiencyLevel: z.enum(["primary", "secondary", "learning"]).default("primary"),
});

export const insertUserRateScheduleSchema = createInsertSchema(userRateSchedules).omit({
  id: true,
  createdAt: true,
  createdBy: true,
});

export const insertProjectRateOverrideSchema = createInsertSchema(projectRateOverrides).omit({
  id: true,
  createdAt: true,
  effectiveStart: true, // Will use default
}).extend({
  effectiveStart: z.string().optional(), // Allow optional, will default to today
});

export const insertRoleSchema = createInsertSchema(roles).omit({
  id: true,
  createdAt: true,
});

export const insertVocabularyCatalogSchema = createInsertSchema(vocabularyCatalog).omit({
  id: true,
  createdAt: true,
});

export const insertOrganizationVocabularySchema = createInsertSchema(organizationVocabulary).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Vocabulary selection update schema with validation
export const updateOrganizationVocabularySchema = z.object({
  epicTermId: z.string().uuid().optional().nullable(),
  stageTermId: z.string().uuid().optional().nullable(),
  activityTermId: z.string().uuid().optional().nullable(),
  workstreamTermId: z.string().uuid().optional().nullable(),
  milestoneTermId: z.string().uuid().optional().nullable(),
}).strict();

export const insertEstimateSchema = createInsertSchema(estimates).omit({
  id: true,
  createdAt: true,
}).extend({
  status: estimateStatusEnum.optional(), // Validate status using enum
});

export const insertEstimateLineItemSchema = createInsertSchema(estimateLineItems).omit({
  id: true,
  createdAt: true,
});

export const insertClientRateOverrideSchema = createInsertSchema(clientRateOverrides)
  .omit({
    id: true,
    createdAt: true,
  })
  .extend({
    subjectType: z.enum(['role', 'person']), // Validate subject type
  });

export const insertEstimateRateOverrideSchema = createInsertSchema(estimateRateOverrides)
  .omit({
    id: true,
    createdAt: true,
  })
  .extend({
    subjectType: z.enum(['role', 'person']), // Validate subject type
    effectiveStart: z.string().min(1, "Effective start date is required"), // Explicitly require date string
  });

export const insertEstimateMilestoneSchema = createInsertSchema(estimateMilestones).omit({
  id: true,
  createdAt: true,
});

export const insertEstimateShareSchema = createInsertSchema(estimateShares).omit({
  id: true,
  grantedAt: true,
});

export const insertTimeEntrySchema = createInsertSchema(timeEntries).omit({
  id: true,
  createdAt: true,
  billingRate: true,      // Calculated server-side
  costRate: true,         // Calculated server-side
  submissionStatus: true, // Managed by workflow
  submittedAt: true,
  submittedBy: true,
  approvedBy: true,
  approvedAt: true,
  rejectionNote: true,
}).extend({
  // Ensure projectId is a non-empty string (required for foreign key)
  projectId: z.string().trim().min(1, "Project is required"),
  // Ensure personId is a non-empty string (required for foreign key)
  personId: z.string().trim().min(1, "Person is required")
});

export const insertExpenseSchema = createInsertSchema(expenses).omit({
  id: true,
  createdAt: true,
  submittedAt: true,
  approvedAt: true,
  approvedBy: true,
  rejectedAt: true,
  rejectedBy: true,
  reimbursedAt: true,
  reimbursementBatchId: true,
  clientPaidAt: true,
});

export const insertExpenseAttachmentSchema = createInsertSchema(expenseAttachments).omit({
  id: true,
  createdAt: true,
});

export const insertPendingReceiptSchema = createInsertSchema(pendingReceipts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertExpenseReportSchema = createInsertSchema(expenseReports).omit({
  id: true,
  reportNumber: true, // Auto-generated in storage layer
  totalAmount: true, // Calculated from expenses
  createdAt: true,
  updatedAt: true,
  submittedAt: true,
  approvedAt: true,
  approvedBy: true,
  rejectedAt: true,
  rejectedBy: true,
});

export const insertExpenseReportItemSchema = createInsertSchema(expenseReportItems).omit({
  id: true,
  createdAt: true,
});

export const insertReimbursementBatchSchema = createInsertSchema(reimbursementBatches).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  approvedAt: true,
  approvedBy: true,
  processedAt: true,
  processedBy: true,
});

export const insertReimbursementLineItemSchema = createInsertSchema(reimbursementLineItems).omit({
  id: true,
  createdAt: true,
  reviewedAt: true,
  reviewedBy: true,
});

export const insertContractorInvoiceSchema = createInsertSchema(contractorInvoices).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  approvedAt: true,
  approvedBy: true,
  paidAt: true,
  paidBy: true,
  submittedAt: true,
});

export const insertSowSchema = createInsertSchema(sows).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  approvedBy: true,
  approvedAt: true,
});

export const insertChangeOrderSchema = createInsertSchema(changeOrders).omit({
  id: true,
  createdAt: true,
});

export const insertProjectBudgetHistorySchema = createInsertSchema(projectBudgetHistory).omit({
  id: true,
  createdAt: true,
});

export const insertSystemSettingSchema = createInsertSchema(systemSettings).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertAirportCodeSchema = createInsertSchema(airportCodes).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertOconusPerDiemRateSchema = createInsertSchema(oconusPerDiemRates).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Types
// ============================================================================
// Types - Multi-Tenancy Tables
// ============================================================================

export type ServicePlan = typeof servicePlans.$inferSelect;
export type InsertServicePlan = z.infer<typeof insertServicePlanSchema>;

export type Tenant = typeof tenants.$inferSelect;
export type InsertTenant = z.infer<typeof insertTenantSchema>;

export type BlockedDomain = typeof blockedDomains.$inferSelect;
export type InsertBlockedDomain = z.infer<typeof insertBlockedDomainSchema>;

export type TenantUser = typeof tenantUsers.$inferSelect;
export type InsertTenantUser = z.infer<typeof insertTenantUserSchema>;

export type ConsultantAccess = typeof consultantAccess.$inferSelect;
export type InsertConsultantAccess = z.infer<typeof insertConsultantAccessSchema>;

// ============================================================================
// Types - Core Tables
// ============================================================================

export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;

export type Client = typeof clients.$inferSelect;
export type InsertClient = z.infer<typeof insertClientSchema>;

export type Project = typeof projects.$inferSelect;
export type InsertProject = z.infer<typeof insertProjectSchema>;

export type Role = typeof roles.$inferSelect;
export type InsertRole = z.infer<typeof insertRoleSchema>;

export type SystemSetting = typeof systemSettings.$inferSelect;
export type InsertSystemSetting = z.infer<typeof insertSystemSettingSchema>;

export type AirportCode = typeof airportCodes.$inferSelect;
export type InsertAirportCode = z.infer<typeof insertAirportCodeSchema>;

export type OconusPerDiemRate = typeof oconusPerDiemRates.$inferSelect;
export type InsertOconusPerDiemRate = z.infer<typeof insertOconusPerDiemRateSchema>;

export type VocabularyCatalog = typeof vocabularyCatalog.$inferSelect;
export type InsertVocabularyCatalog = z.infer<typeof insertVocabularyCatalogSchema>;

export type OrganizationVocabulary = typeof organizationVocabulary.$inferSelect;
export type InsertOrganizationVocabulary = z.infer<typeof insertOrganizationVocabularySchema>;

export type Estimate = typeof estimates.$inferSelect;
export type InsertEstimate = z.infer<typeof insertEstimateSchema>;

export type EstimateLineItem = typeof estimateLineItems.$inferSelect;
export type InsertEstimateLineItem = z.infer<typeof insertEstimateLineItemSchema>;

export type EstimateLineItemWithJoins = EstimateLineItem & {
  assignedUser: User | null;
  role: Role | null;
};

export type ClientRateOverride = typeof clientRateOverrides.$inferSelect;
export type InsertClientRateOverride = z.infer<typeof insertClientRateOverrideSchema>;

export type EstimateRateOverride = typeof estimateRateOverrides.$inferSelect;
export type InsertEstimateRateOverride = z.infer<typeof insertEstimateRateOverrideSchema>;

export type EstimateMilestone = typeof estimateMilestones.$inferSelect;
export type InsertEstimateMilestone = z.infer<typeof insertEstimateMilestoneSchema>;

export type EstimateShare = typeof estimateShares.$inferSelect;
export type InsertEstimateShare = z.infer<typeof insertEstimateShareSchema>;

export type EstimateEpic = typeof estimateEpics.$inferSelect;
export type EstimateStage = typeof estimateStages.$inferSelect;
export type EstimateActivity = typeof estimateActivities.$inferSelect;
export type EstimateAllocation = typeof estimateAllocations.$inferSelect;

export type ProjectEpic = typeof projectEpics.$inferSelect;
export type InsertProjectEpic = z.infer<typeof insertProjectEpicSchema>;
export type ProjectStage = typeof projectStages.$inferSelect;
export type InsertProjectStage = z.infer<typeof insertProjectStageSchema>;
export type ProjectActivity = typeof projectActivities.$inferSelect;
export type InsertProjectActivity = z.infer<typeof insertProjectActivitySchema>;
export type ProjectWorkstream = typeof projectWorkstreams.$inferSelect;
export type InsertProjectWorkstream = z.infer<typeof insertProjectWorkstreamSchema>;
export type ProjectMilestone = typeof projectMilestones.$inferSelect;
export type InsertProjectMilestone = z.infer<typeof insertProjectMilestoneSchema>;
export type ProjectAllocation = typeof projectAllocations.$inferSelect;
export type InsertProjectAllocation = z.infer<typeof insertProjectAllocationSchema>;
export type ProjectBaseline = typeof projectBaselines.$inferSelect;
export type InsertProjectBaseline = z.infer<typeof insertProjectBaselineSchema>;
export type ProjectEngagement = typeof projectEngagements.$inferSelect;
export type InsertProjectEngagement = z.infer<typeof insertProjectEngagementSchema>;
export type ProjectRateOverride = typeof projectRateOverrides.$inferSelect;
export type InsertProjectRateOverride = z.infer<typeof insertProjectRateOverrideSchema>;
export type UserRateSchedule = typeof userRateSchedules.$inferSelect;
export type InsertUserRateSchedule = z.infer<typeof insertUserRateScheduleSchema>;
export type UserRoleCapability = typeof userRoleCapabilities.$inferSelect;
export type InsertUserRoleCapability = z.infer<typeof insertUserRoleCapabilitySchema>;

export type TimeEntry = typeof timeEntries.$inferSelect;
export type InsertTimeEntry = z.infer<typeof insertTimeEntrySchema>;

export type Expense = typeof expenses.$inferSelect;
export type InsertExpense = z.infer<typeof insertExpenseSchema>;

export type ExpenseAttachment = typeof expenseAttachments.$inferSelect;
export type InsertExpenseAttachment = z.infer<typeof insertExpenseAttachmentSchema>;

export type PendingReceipt = typeof pendingReceipts.$inferSelect;
export type InsertPendingReceipt = z.infer<typeof insertPendingReceiptSchema>;

export type ExpenseReport = typeof expenseReports.$inferSelect;
export type InsertExpenseReport = z.infer<typeof insertExpenseReportSchema>;

export type ExpenseReportItem = typeof expenseReportItems.$inferSelect;
export type InsertExpenseReportItem = z.infer<typeof insertExpenseReportItemSchema>;

export type ReimbursementBatch = typeof reimbursementBatches.$inferSelect;
export type InsertReimbursementBatch = z.infer<typeof insertReimbursementBatchSchema>;

export type ReimbursementLineItem = typeof reimbursementLineItems.$inferSelect;
export type InsertReimbursementLineItem = z.infer<typeof insertReimbursementLineItemSchema>;

export type ContractorInvoice = typeof contractorInvoices.$inferSelect;
export type InsertContractorInvoice = z.infer<typeof insertContractorInvoiceSchema>;

export type ChangeOrder = typeof changeOrders.$inferSelect;
export type InsertChangeOrder = z.infer<typeof insertChangeOrderSchema>;

export type Sow = typeof sows.$inferSelect;
export type InsertSow = z.infer<typeof insertSowSchema>;

export type ProjectBudgetHistory = typeof projectBudgetHistory.$inferSelect;
export type InsertProjectBudgetHistory = z.infer<typeof insertProjectBudgetHistorySchema>;

export type InvoiceBatch = typeof invoiceBatches.$inferSelect;
export type InvoiceLine = typeof invoiceLines.$inferSelect;
export type InvoiceAdjustment = typeof invoiceAdjustments.$inferSelect;
export type RateOverride = typeof rateOverrides.$inferSelect;

// Invoice schemas
export const insertInvoiceBatchSchema = createInsertSchema(invoiceBatches).omit({
  id: true,
  createdAt: true
});
export type InsertInvoiceBatch = z.infer<typeof insertInvoiceBatchSchema>;

// Payment status update schema
export const updateInvoicePaymentSchema = z.object({
  paymentStatus: z.enum(["unpaid", "partial", "paid"]),
  paymentDate: z.string().optional(),
  paymentAmount: z.string().optional(), // Decimal as string
  paymentNotes: z.string().optional(),
});
export type UpdateInvoicePayment = z.infer<typeof updateInvoicePaymentSchema>;

export const insertInvoiceLineSchema = createInsertSchema(invoiceLines).omit({
  id: true,
  createdAt: true,
  editedAt: true,
  varianceAmount: true, // Calculated field
});
export type InsertInvoiceLine = z.infer<typeof insertInvoiceLineSchema>;

export const insertInvoiceAdjustmentSchema = createInsertSchema(invoiceAdjustments).omit({
  id: true,
  createdAt: true
});
export type InsertInvoiceAdjustment = z.infer<typeof insertInvoiceAdjustmentSchema>;

// Billing API Response Types
// SharePoint Embedded Container Management
export const containerTypes = pgTable("container_types", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  containerTypeId: text("container_type_id").notNull().unique(), // SharePoint Container Type ID
  displayName: text("display_name").notNull(),
  description: text("description"),
  applicationId: text("application_id"), // Azure AD Application ID that owns this container type
  isBuiltIn: boolean("is_built_in").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
});

export const clientContainers = pgTable("client_containers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  clientId: varchar("client_id").notNull().references(() => clients.id),
  containerId: text("container_id").notNull().unique(), // SharePoint Container ID
  containerTypeId: text("container_type_id").notNull().references(() => containerTypes.containerTypeId),
  displayName: text("display_name").notNull(),
  description: text("description"),
  driveId: text("drive_id"), // Associated drive ID for backward compatibility
  webUrl: text("web_url"), // SharePoint web URL
  status: text("status").notNull().default("active"), // active, inactive
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
}, (table) => ({
  // Unique constraint: one active container per client/type combination
  uniqueClientContainerType: sql`UNIQUE (${table.clientId}, ${table.containerTypeId}) WHERE ${table.status} = 'active'`
}));

export const containerPermissions = pgTable("container_permissions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  containerId: text("container_id").notNull().references(() => clientContainers.containerId),
  userId: varchar("user_id").references(() => users.id), // Optional - for user-specific permissions
  principalType: text("principal_type").notNull(), // user, application, group
  principalId: text("principal_id").notNull(), // Azure AD principal ID
  roles: text("roles").array().notNull(), // SharePoint roles: reader, writer, owner, etc.
  grantedAt: timestamp("granted_at").notNull().default(sql`now()`),
  grantedBy: varchar("granted_by").references(() => users.id),
});

// Container Metadata Column Definitions
export const containerColumns = pgTable("container_columns", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  containerId: text("container_id").notNull().references(() => clientContainers.containerId),
  columnId: text("column_id").notNull(), // SharePoint column ID from Graph API
  name: text("name").notNull(), // Internal column name (Title, ProjectId, etc.)
  displayName: text("display_name").notNull(), // User-friendly display name
  description: text("description"),
  columnType: text("column_type").notNull(), // text, choice, dateTime, number, currency, boolean, personOrGroup
  isRequired: boolean("is_required").notNull().default(false),
  isIndexed: boolean("is_indexed").notNull().default(false),
  isHidden: boolean("is_hidden").notNull().default(false),
  isReadOnly: boolean("is_read_only").notNull().default(false),
  // Column type-specific configuration stored as JSON
  textConfig: jsonb("text_config"), // { maxLength: 255, allowMultipleLines: false, etc. }
  choiceConfig: jsonb("choice_config"), // { choices: ["option1", "option2"], allowFillInChoice: false }
  numberConfig: jsonb("number_config"), // { decimalPlaces: 2, min: 0, max: 999999 }
  dateTimeConfig: jsonb("date_time_config"), // { displayAs: "DateTime", includeTime: true }
  currencyConfig: jsonb("currency_config"), // { lcid: 1033 } - locale identifier
  booleanConfig: jsonb("boolean_config"), // Not used currently but for future extensibility
  // Validation rules
  validationRules: jsonb("validation_rules"), // Custom validation rules
  // Metadata for receipt workflow
  isReceiptMetadata: boolean("is_receipt_metadata").notNull().default(false), // Flag for receipt-specific columns
  receiptFieldType: text("receipt_field_type"), // "project_id", "expense_id", "amount", "status", etc.
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
}, (table) => ({
  // Unique constraint: one column name per container
  uniqueContainerColumn: sql`UNIQUE (${table.containerId}, ${table.name})`
}));

// Receipt Metadata Templates (predefined schemas for different content types)
export const metadataTemplates = pgTable("metadata_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull().unique(), // "receipt", "invoice", "contract", etc.
  displayName: text("display_name").notNull(),
  description: text("description"),
  contentType: text("content_type").notNull(), // MIME type or general category
  columnDefinitions: jsonb("column_definitions").notNull(), // Array of column configurations
  isBuiltIn: boolean("is_built_in").notNull().default(true),
  isActive: boolean("is_active").notNull().default(true),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
});

// Document Metadata Tracking (for caching and query optimization)
export const documentMetadata = pgTable("document_metadata", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  containerId: text("container_id").notNull().references(() => clientContainers.containerId),
  itemId: text("item_id").notNull(), // SharePoint item ID
  fileName: text("file_name").notNull(),
  projectId: text("project_id").references(() => projects.code), // Links to project
  expenseId: varchar("expense_id").references(() => expenses.id), // Links to expense when assigned
  uploadedBy: varchar("uploaded_by").references(() => users.id), // User who uploaded
  expenseCategory: text("expense_category"), // Expense category
  receiptDate: timestamp("receipt_date"), // Date from receipt
  amount: decimal("amount", { precision: 10, scale: 2 }), // Receipt amount
  currency: text("currency").default("USD"), // Currency code
  status: text("status").notNull().default("pending"), // pending, assigned, processed
  vendor: text("vendor"), // Merchant/vendor name
  description: text("description"), // Receipt description
  isReimbursable: boolean("is_reimbursable").default(true), // Whether it's reimbursable
  tags: text("tags").array(), // Additional tags for categorization
  // Raw metadata from SharePoint (for backup/sync)
  rawMetadata: jsonb("raw_metadata"), // Complete metadata from SharePoint
  lastSyncedAt: timestamp("last_synced_at").notNull().default(sql`now()`),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
}, (table) => ({
  // Unique constraint: one metadata record per container/item
  uniqueContainerItem: sql`UNIQUE (${table.containerId}, ${table.itemId})`
}));

export interface BatchSettings {
  prefix: string;
  useSequential: boolean;
  includeDate: boolean;
  dateFormat: string;
  sequencePadding: number;
  currentSequence?: number;
}

export interface BatchIdPreviewRequest {
  startDate: string;
  endDate: string;
}

export interface BatchIdPreviewResponse {
  batchId: string;
}

export interface UnbilledItemsFilters {
  personId?: string;
  projectId?: string;
  clientId?: string;
  startDate?: string;
  endDate?: string;
}

export interface EnrichedTimeEntry extends TimeEntry {
  person: User;
  project: Project & { client: Client };
  calculatedAmount: number;
  rateIssues?: string[];
}

export interface EnrichedExpense extends Expense {
  person: User;
  project: Project & { client: Client };
}

export interface UnbilledItemsResponse {
  timeEntries: EnrichedTimeEntry[];
  expenses: EnrichedExpense[];
  totals: {
    timeHours: number;
    timeAmount: number;
    expenseAmount: number;
    totalAmount: number;
  };
  rateValidation: {
    entriesWithMissingRates: number;
    entriesWithNullRates: number;
    issues: string[];
  };
}

// Container Management Types
export type ContainerType = typeof containerTypes.$inferSelect;
export type ClientContainer = typeof clientContainers.$inferSelect;
export type ContainerPermission = typeof containerPermissions.$inferSelect;
export type ContainerColumn = typeof containerColumns.$inferSelect;
export type MetadataTemplate = typeof metadataTemplates.$inferSelect;
export type DocumentMetadata = typeof documentMetadata.$inferSelect;

export type InsertContainerType = typeof containerTypes.$inferInsert;
export type InsertClientContainer = typeof clientContainers.$inferInsert;
export type InsertContainerPermission = typeof containerPermissions.$inferInsert;
export type InsertContainerColumn = typeof containerColumns.$inferInsert;
export type InsertMetadataTemplate = typeof metadataTemplates.$inferInsert;
export type InsertDocumentMetadata = typeof documentMetadata.$inferInsert;

// Container Management Zod Schemas
export const insertContainerTypeSchema = createInsertSchema(containerTypes).omit({
  id: true,
  createdAt: true,
  updatedAt: true
});

export const insertClientContainerSchema = createInsertSchema(clientContainers).omit({
  id: true,
  createdAt: true,
  updatedAt: true
});

export const insertContainerPermissionSchema = createInsertSchema(containerPermissions).omit({
  id: true,
  grantedAt: true
});

export const insertContainerColumnSchema = createInsertSchema(containerColumns).omit({
  id: true,
  createdAt: true,
  updatedAt: true
});

export const insertMetadataTemplateSchema = createInsertSchema(metadataTemplates).omit({
  id: true,
  createdAt: true,
  updatedAt: true
});

export const insertDocumentMetadataSchema = createInsertSchema(documentMetadata).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  lastSyncedAt: true
});

// Receipt Metadata Column Definitions (predefined schema)
export interface ReceiptMetadataSchema {
  projectId: {
    name: "ProjectId";
    displayName: "Project ID";
    columnType: "text";
    description: "Project code this receipt belongs to";
    isRequired: true;
    textConfig: { maxLength: 50; allowMultipleLines: false };
    receiptFieldType: "project_id";
  };
  expenseId: {
    name: "ExpenseId";
    displayName: "Expense ID";
    columnType: "text";
    description: "Expense ID when assigned to an expense";
    isRequired: false;
    textConfig: { maxLength: 50; allowMultipleLines: false };
    receiptFieldType: "expense_id";
  };
  uploadedBy: {
    name: "UploadedBy";
    displayName: "Uploaded By";
    columnType: "text";
    description: "User who uploaded this receipt";
    isRequired: true;
    textConfig: { maxLength: 255; allowMultipleLines: false };
    receiptFieldType: "uploaded_by";
  };
  expenseCategory: {
    name: "ExpenseCategory";
    displayName: "Expense Category";
    columnType: "choice";
    description: "Type of expense category";
    isRequired: true;
    choiceConfig: { 
      choices: ["Travel", "Meals", "Accommodation", "Equipment", "Supplies", "Software", "Training", "Other"];
      allowFillInChoice: false;
    };
    receiptFieldType: "expense_category";
  };
  receiptDate: {
    name: "ReceiptDate";
    displayName: "Receipt Date";
    columnType: "dateTime";
    description: "Date from the receipt";
    isRequired: true;
    dateTimeConfig: { displayAs: "DateTime"; includeTime: false };
    receiptFieldType: "receipt_date";
  };
  amount: {
    name: "Amount";
    displayName: "Amount";
    columnType: "currency";
    description: "Receipt amount";
    isRequired: true;
    currencyConfig: { lcid: 1033 }; // US locale
    receiptFieldType: "amount";
  };
  currency: {
    name: "Currency";
    displayName: "Currency";
    columnType: "choice";
    description: "Currency of the receipt";
    isRequired: true;
    choiceConfig: {
      choices: ["USD", "EUR", "GBP", "CAD", "AUD", "JPY"];
      allowFillInChoice: false;
    };
    receiptFieldType: "currency";
  };
  status: {
    name: "Status";
    displayName: "Status";
    columnType: "choice";
    description: "Processing status of the receipt";
    isRequired: true;
    choiceConfig: {
      choices: ["pending", "assigned", "processed"];
      allowFillInChoice: false;
    };
    receiptFieldType: "status";
  };
  vendor: {
    name: "Vendor";
    displayName: "Vendor";
    columnType: "text";
    description: "Merchant or vendor name";
    isRequired: false;
    textConfig: { maxLength: 255; allowMultipleLines: false };
    receiptFieldType: "vendor";
  };
  description: {
    name: "Description";
    displayName: "Description";
    columnType: "text";
    description: "Receipt description or notes";
    isRequired: false;
    textConfig: { maxLength: 500; allowMultipleLines: true };
    receiptFieldType: "description";
  };
  isReimbursable: {
    name: "IsReimbursable";
    displayName: "Reimbursable";
    columnType: "boolean";
    description: "Whether this receipt is reimbursable";
    isRequired: false;
    booleanConfig: {};
    receiptFieldType: "is_reimbursable";
  };
  tags: {
    name: "Tags";
    displayName: "Tags";
    columnType: "text";
    description: "Additional tags for categorization";
    isRequired: false;
    textConfig: { maxLength: 500; allowMultipleLines: false };
    receiptFieldType: "tags";
  };
}

// ============================================
// Vocabulary System Types
// ============================================

// Vocabulary terms that can be customized
export interface VocabularyTerms {
  epic?: string;      // Default: "Epic"
  stage?: string;     // Default: "Stage"
  activity?: string;  // Default: "Activity"
  workstream?: string; // Default: "Workstream"
}

// Default vocabulary (fallback when no overrides exist)
export const DEFAULT_VOCABULARY: Required<VocabularyTerms> = {
  epic: "Epic",
  stage: "Stage",
  activity: "Activity",
  workstream: "Workstream",
};

// ============================================
// Microsoft Planner Integration
// ============================================

// Tenant Microsoft 365 integration credentials - stores per-tenant Azure AD app credentials
// Supports both publisher multi-tenant app and bring-your-own-app (BYOA) scenarios
export const tenantMicrosoftIntegrations = pgTable("tenant_microsoft_integrations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  
  // Tenant identifier (null = system default for single-tenant mode)
  // Will be populated when multi-tenancy is activated
  tenantId: varchar("tenant_id", { length: 255 }),
  
  // Azure AD tenant info (the customer's Microsoft 365 tenant)
  azureTenantId: varchar("azure_tenant_id", { length: 255 }).notNull(),
  azureTenantName: text("azure_tenant_name"), // e.g., "contoso.onmicrosoft.com"
  
  // Integration type
  integrationType: text("integration_type").notNull().default('publisher_app'), // publisher_app, byoa (bring-your-own-app)
  
  // Azure app registration credentials
  // For publisher_app: uses system environment variables (PLANNER_CLIENT_ID, etc.)
  // For byoa: customer provides their own credentials (stored encrypted)
  clientId: varchar("client_id", { length: 255 }), // Only for BYOA
  clientSecretRef: text("client_secret_ref"), // Reference to secret storage (not the actual secret)
  
  // Permissions and consent status
  grantedScopes: text("granted_scopes").array(), // e.g., ['Tasks.ReadWrite.All', 'Group.Read.All']
  consentGrantedAt: timestamp("consent_granted_at"),
  consentGrantedBy: varchar("consent_granted_by", { length: 255 }), // Admin who granted consent
  
  // Status
  isActive: boolean("is_active").notNull().default(true),
  lastValidatedAt: timestamp("last_validated_at"),
  validationError: text("validation_error"),
  
  // Metadata
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
});

export const insertTenantMicrosoftIntegrationSchema = createInsertSchema(tenantMicrosoftIntegrations).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertTenantMicrosoftIntegration = z.infer<typeof insertTenantMicrosoftIntegrationSchema>;
export type TenantMicrosoftIntegration = typeof tenantMicrosoftIntegrations.$inferSelect;

// Project-to-Planner connection - links a Constellation project to a Microsoft Planner plan
export const projectPlannerConnections = pgTable("project_planner_connections", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: 'cascade' }),
  
  // Multi-tenancy support: link to tenant's Microsoft integration
  // Null = use system default (single-tenant mode or publisher app)
  integrationId: varchar("integration_id").references(() => tenantMicrosoftIntegrations.id, { onDelete: 'set null' }),
  
  // Planner plan details
  planId: varchar("plan_id", { length: 255 }).notNull(), // Microsoft Planner Plan ID
  planTitle: text("plan_title"), // Cached plan title
  planWebUrl: text("plan_web_url"), // URL to open in Planner
  
  // Group/Team context (optional - for plans in Teams)
  groupId: varchar("group_id", { length: 255 }), // Microsoft 365 Group ID (Team)
  groupName: text("group_name"), // Cached group/team name
  
  // Channel context (for plans in specific channels)
  channelId: varchar("channel_id", { length: 255 }), // Microsoft Teams Channel ID
  channelName: text("channel_name"), // Cached channel name
  
  // Connection settings
  syncEnabled: boolean("sync_enabled").notNull().default(true),
  syncDirection: text("sync_direction").notNull().default('bidirectional'), // bidirectional, outbound_only, inbound_only
  autoAddMembers: boolean("auto_add_members").notNull().default(false), // Auto-add missing users to the Team/Group
  lastSyncAt: timestamp("last_sync_at"),
  lastSyncStatus: text("last_sync_status"), // success, error, partial
  lastSyncError: text("last_sync_error"),

  // Task #126 — Sync robustness: connection-level error tracking & auto-suspend
  consecutiveErrors: integer("consecutive_errors").notNull().default(0),
  lastErrorCode: text("last_error_code"), // auth_expired, forbidden, plan_not_found, rate_limited, etag_mismatch, network, unknown
  lastAlertAt: timestamp("last_alert_at"), // Last time admin was alerted (for cooldown)
  syncSuspended: boolean("sync_suspended").notNull().default(false), // Manually suspend (e.g. after auth expired)
  syncSuspendedReason: text("sync_suspended_reason"),

  // Metadata
  connectedBy: varchar("connected_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
});

export const insertProjectPlannerConnectionSchema = createInsertSchema(projectPlannerConnections).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertProjectPlannerConnection = z.infer<typeof insertProjectPlannerConnectionSchema>;
export type ProjectPlannerConnection = typeof projectPlannerConnections.$inferSelect;

// Planner task sync tracking - maps Constellation allocations to Planner tasks
// allocationId is nullable to allow tracking failed imports without creating allocations
export const plannerTaskSync = pgTable("planner_task_sync", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  connectionId: varchar("connection_id").notNull().references(() => projectPlannerConnections.id, { onDelete: 'cascade' }),
  allocationId: varchar("allocation_id").references(() => projectAllocations.id, { onDelete: 'cascade' }), // Nullable for failed imports
  
  // Planner task details
  taskId: varchar("task_id", { length: 255 }).notNull(), // Microsoft Planner Task ID
  taskTitle: text("task_title"), // Cached task title
  bucketId: varchar("bucket_id", { length: 255 }), // Bucket/column in Planner
  bucketName: text("bucket_name"), // Cached bucket name (often week label)
  
  // Sync tracking
  lastSyncedAt: timestamp("last_synced_at").notNull().default(sql`now()`),
  syncStatus: text("sync_status").notNull().default('synced'), // synced, pending_outbound, pending_inbound, conflict, error, import_failed, suspended
  syncError: text("sync_error"),

  // Version tracking for conflict detection
  localVersion: integer("local_version").notNull().default(1),
  remoteEtag: text("remote_etag"), // Planner's etag for optimistic concurrency

  // Task #126 — Last-write-wins fields
  remoteLastModified: timestamp("remote_last_modified"), // Planner task.lastModifiedDateTime as of last sync
  lastConflictResolution: jsonb("last_conflict_resolution").$type<{
    at: string;
    winner: 'local' | 'remote' | 'equal';
    reason: string;
    localEditedAt: string | null;
    remoteModifiedAt: string | null;
    fields?: string[];
  } | null>(),
  // Per-task error tracking for resilience
  consecutiveErrors: integer("consecutive_errors").notNull().default(0),
  lastErrorAt: timestamp("last_error_at"),
  lastErrorCode: text("last_error_code"),

  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

export const insertPlannerTaskSyncSchema = createInsertSchema(plannerTaskSync).omit({
  id: true,
  createdAt: true,
});
export type InsertPlannerTaskSync = z.infer<typeof insertPlannerTaskSyncSchema>;
export type PlannerTaskSync = typeof plannerTaskSync.$inferSelect;

// Task #126 — Graph webhook subscriptions for inbound Planner changes.
// One row per active subscription on a Planner plan/group/task resource.
export const plannerSubscriptions = pgTable("planner_subscriptions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  connectionId: varchar("connection_id").notNull().references(() => projectPlannerConnections.id, { onDelete: 'cascade' }),
  tenantId: varchar("tenant_id").references(() => tenants.id, { onDelete: 'cascade' }),

  // Microsoft Graph subscription details
  subscriptionId: varchar("subscription_id", { length: 255 }).notNull(), // ID returned by Graph
  resource: text("resource").notNull(), // e.g. /planner/plans/{id} or /groups/{id}/planner/plans/{id}
  changeType: text("change_type").notNull().default('updated,deleted'),
  notificationUrl: text("notification_url").notNull(),
  clientState: text("client_state").notNull(), // Secret used to verify inbound notifications
  expirationDateTime: timestamp("expiration_date_time").notNull(),

  // Renewal/health tracking
  status: text("status").notNull().default('active'), // active, expired, error, removed
  lastRenewedAt: timestamp("last_renewed_at"),
  lastRenewalError: text("last_renewal_error"),
  consecutiveRenewalErrors: integer("consecutive_renewal_errors").notNull().default(0),

  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
}, (table) => ({
  uniqueSubId: uniqueIndex("idx_planner_subs_subscription_id").on(table.subscriptionId),
  connectionIdx: index("idx_planner_subs_connection").on(table.connectionId),
  expirationIdx: index("idx_planner_subs_expiration").on(table.expirationDateTime),
}));

export const insertPlannerSubscriptionSchema = createInsertSchema(plannerSubscriptions).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertPlannerSubscription = z.infer<typeof insertPlannerSubscriptionSchema>;
export type PlannerSubscription = typeof plannerSubscriptions.$inferSelect;

// Task #126 — Audit log for every Planner sync action (outbound write, inbound pull,
// conflict resolution, suspend, alert). Used by Sync Health UI.
export const plannerSyncAudit = pgTable("planner_sync_audit", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id, { onDelete: 'cascade' }),
  connectionId: varchar("connection_id").references(() => projectPlannerConnections.id, { onDelete: 'cascade' }),
  taskSyncId: varchar("task_sync_id").references(() => plannerTaskSync.id, { onDelete: 'set null' }),
  allocationId: varchar("allocation_id").references(() => projectAllocations.id, { onDelete: 'set null' }),
  plannerTaskId: varchar("planner_task_id", { length: 255 }),

  // Action: outbound_create, outbound_update, inbound_pull, conflict_resolved,
  // suspend, resume, alert_sent, webhook_received, subscription_created,
  // subscription_renewed, subscription_expired
  action: text("action").notNull(),
  outcome: text("outcome").notNull(), // success, error, skipped, conflict
  trigger: text("trigger"), // scheduled, manual, webhook, retry
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  details: jsonb("details").$type<Record<string, any> | null>(),

  createdAt: timestamp("created_at").notNull().default(sql`now()`),
}, (table) => ({
  tenantIdx: index("idx_planner_audit_tenant").on(table.tenantId),
  connectionIdx: index("idx_planner_audit_connection").on(table.connectionId),
  createdIdx: index("idx_planner_audit_created").on(table.createdAt),
  actionIdx: index("idx_planner_audit_action").on(table.action),
}));

export const insertPlannerSyncAuditSchema = createInsertSchema(plannerSyncAudit).omit({
  id: true,
  createdAt: true,
});
export type InsertPlannerSyncAudit = z.infer<typeof insertPlannerSyncAuditSchema>;
export type PlannerSyncAudit = typeof plannerSyncAudit.$inferSelect;

// User-to-Azure AD mapping - maps Constellation users to Azure AD users for task assignment
export const userAzureMappings = pgTable("user_azure_mappings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  
  // Multi-tenancy support: link to tenant's Microsoft integration
  // Null = use system default (single-tenant mode)
  integrationId: varchar("integration_id").references(() => tenantMicrosoftIntegrations.id, { onDelete: 'cascade' }),
  
  azureUserId: varchar("azure_user_id", { length: 255 }).notNull(), // Azure AD Object ID
  azureUserPrincipalName: text("azure_upn"), // e.g., user@company.com
  azureDisplayName: text("azure_display_name"),
  mappingMethod: text("mapping_method").notNull().default('email'), // email, manual, sso
  verifiedAt: timestamp("verified_at"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

export const insertUserAzureMappingSchema = createInsertSchema(userAzureMappings).omit({
  id: true,
  createdAt: true,
});
export type InsertUserAzureMapping = z.infer<typeof insertUserAzureMappingSchema>;
export type UserAzureMapping = typeof userAzureMappings.$inferSelect;

// Sessions - for persistent session storage
export const sessions = pgTable("sessions", {
  id: varchar("id").primaryKey(), // Session ID (generated randomly)
  userId: varchar("user_id").notNull().references(() => users.id),
  email: text("email").notNull(),
  name: text("name").notNull(),
  role: text("role").notNull(),
  ssoProvider: text("sso_provider"), // 'azure-ad' or null for regular login
  ssoToken: text("sso_token"), // SSO access token (encrypted in production)
  ssoRefreshToken: text("sso_refresh_token"), // SSO refresh token (encrypted in production) 
  ssoTokenExpiry: timestamp("sso_token_expiry"), // When the SSO token expires
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  lastActivity: timestamp("last_activity").notNull().default(sql`now()`),
  expiresAt: timestamp("expires_at").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  activeTenantId: varchar("active_tenant_id").references(() => tenants.id),
}, (table) => ({
  userIdIdx: index("sessions_user_id_idx").on(table.userId),
  expiresAtIdx: index("sessions_expires_at_idx").on(table.expiresAt),
}));

// Session insert schema
export const insertSessionSchema = createInsertSchema(sessions).omit({
  createdAt: true,
  lastActivity: true
});
export type InsertSession = z.infer<typeof insertSessionSchema>;
export type Session = typeof sessions.$inferSelect;

// Scheduled Job Runs - for tracking scheduled job execution history
export const scheduledJobRuns = pgTable("scheduled_job_runs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id),
  jobType: text("job_type").notNull(), // 'expense_reminder', 'time_reminder', etc.
  status: text("status").notNull(), // 'running', 'completed', 'failed'
  startedAt: timestamp("started_at").notNull().default(sql`now()`),
  completedAt: timestamp("completed_at"),
  triggeredBy: text("triggered_by").notNull(), // 'scheduled', 'manual'
  triggeredByUserId: varchar("triggered_by_user_id").references(() => users.id),
  resultSummary: jsonb("result_summary"), // { sent: 5, skipped: 2, errors: 0 }
  errorMessage: text("error_message"),
}, (table) => ({
  tenantIdIdx: index("scheduled_job_runs_tenant_id_idx").on(table.tenantId),
  jobTypeIdx: index("scheduled_job_runs_job_type_idx").on(table.jobType),
  startedAtIdx: index("scheduled_job_runs_started_at_idx").on(table.startedAt),
}));

export const insertScheduledJobRunSchema = createInsertSchema(scheduledJobRuns).omit({
  id: true,
  startedAt: true,
});
export type InsertScheduledJobRun = z.infer<typeof insertScheduledJobRunSchema>;
export type ScheduledJobRun = typeof scheduledJobRuns.$inferSelect;

// ============================================================================
// RAIDD LOG TABLES (Risks, Action Items, Issues, Decisions, Dependencies)
// ============================================================================

export const raiddTypeEnum = z.enum(['risk', 'issue', 'decision', 'dependency', 'action_item']);
export type RaiddType = z.infer<typeof raiddTypeEnum>;

export const raiddStatusEnum = z.enum(['open', 'in_progress', 'mitigated', 'closed', 'deferred', 'superseded', 'resolved', 'accepted']);
export type RaiddStatus = z.infer<typeof raiddStatusEnum>;

export const raiddPriorityEnum = z.enum(['critical', 'high', 'medium', 'low']);
export type RaiddPriority = z.infer<typeof raiddPriorityEnum>;

export const raiddImpactEnum = z.enum(['critical', 'high', 'medium', 'low']);
export type RaiddImpact = z.infer<typeof raiddImpactEnum>;

export const raiddLikelihoodEnum = z.enum(['almost_certain', 'likely', 'possible', 'unlikely', 'rare']);
export type RaiddLikelihood = z.infer<typeof raiddLikelihoodEnum>;

export const raiddEntries = pgTable("raidd_entries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: 'cascade' }),
  type: varchar("type", { length: 20 }).notNull(),
  refNumber: varchar("ref_number", { length: 20 }),
  title: text("title").notNull(),
  description: text("description"),
  status: varchar("status", { length: 20 }).notNull().default('open'),
  priority: varchar("priority", { length: 20 }).notNull().default('medium'),
  impact: varchar("impact", { length: 20 }),
  likelihood: varchar("likelihood", { length: 20 }),
  ownerId: varchar("owner_id").references(() => users.id),
  assigneeId: varchar("assignee_id").references(() => users.id),
  dueDate: date("due_date"),
  closedAt: timestamp("closed_at"),
  category: varchar("category", { length: 100 }),
  mitigationPlan: text("mitigation_plan"),
  resolutionNotes: text("resolution_notes"),
  parentEntryId: varchar("parent_entry_id"),
  convertedFromId: varchar("converted_from_id"),
  supersededById: varchar("superseded_by_id"),
  tags: jsonb("tags").$type<string[]>(),
  // When true (default), this entry is exposed to client portal users via
  // the Galaxy API. Staff can flip this off to mark an entry internal-only.
  clientVisible: boolean("client_visible").notNull().default(true),
  createdBy: varchar("created_by").references(() => users.id),
  updatedBy: varchar("updated_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
}, (table) => ({
  tenantIdx: index("idx_raidd_entries_tenant").on(table.tenantId),
  projectIdx: index("idx_raidd_entries_project").on(table.projectId),
  typeIdx: index("idx_raidd_entries_type").on(table.type),
  statusIdx: index("idx_raidd_entries_status").on(table.status),
  parentIdx: index("idx_raidd_entries_parent").on(table.parentEntryId),
}));

export const raiddEntriesRelations = relations(raiddEntries, ({ one }) => ({
  project: one(projects, { fields: [raiddEntries.projectId], references: [projects.id] }),
  owner: one(users, { fields: [raiddEntries.ownerId], references: [users.id] }),
  assignee: one(users, { fields: [raiddEntries.assigneeId], references: [users.id] }),
  createdByUser: one(users, { fields: [raiddEntries.createdBy], references: [users.id] }),
  parentEntry: one(raiddEntries, { fields: [raiddEntries.parentEntryId], references: [raiddEntries.id] }),
  convertedFrom: one(raiddEntries, { fields: [raiddEntries.convertedFromId], references: [raiddEntries.id] }),
  supersededBy: one(raiddEntries, { fields: [raiddEntries.supersededById], references: [raiddEntries.id] }),
}));

export const insertRaiddEntrySchema = createInsertSchema(raiddEntries).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  refNumber: true,
  closedAt: true,
  supersededById: true,
  convertedFromId: true,
});
export type InsertRaiddEntry = z.infer<typeof insertRaiddEntrySchema>;
export type RaiddEntry = typeof raiddEntries.$inferSelect;

// ============================================================================
// GROUNDING DOCUMENTS (AI Knowledge Base - Following Vega Pattern)
// ============================================================================

export const groundingDocCategoryEnum = z.enum([
  'pm_methodology',
  'brand_voice',
  'raidd_guidance',
  'status_report',
  'estimate_narrative',
  'estimate_generation',
  'invoice_narrative',
  'general',
]);
export type GroundingDocCategory = z.infer<typeof groundingDocCategoryEnum>;

export const GROUNDING_DOC_CATEGORY_LABELS: Record<GroundingDocCategory, string> = {
  pm_methodology: "PM Methodology & Framework",
  brand_voice: "Brand Voice & Communication Style",
  raidd_guidance: "RAIDD Governance Guidelines",
  status_report: "Status Report Guidance",
  estimate_narrative: "Estimate & Proposal Narrative",
  estimate_generation: "Estimate Generation & WBS Methodology",
  invoice_narrative: "Invoice Narrative",
  general: "General Knowledge",
};

export const groundingDocuments = pgTable("grounding_documents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id, { onDelete: 'cascade' }),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  category: varchar("category", { length: 50 }).notNull().default('general'),
  content: text("content").notNull(),
  priority: integer("priority").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  isTenantBackground: boolean("is_tenant_background").notNull().default(false),
  createdBy: varchar("created_by").references(() => users.id),
  updatedBy: varchar("updated_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
}, (table) => ({
  tenantIdx: index("idx_grounding_docs_tenant").on(table.tenantId),
  categoryIdx: index("idx_grounding_docs_category").on(table.category),
  activeIdx: index("idx_grounding_docs_active").on(table.isActive),
}));

export const groundingDocumentsRelations = relations(groundingDocuments, ({ one }) => ({
  tenant: one(tenants, { fields: [groundingDocuments.tenantId], references: [tenants.id] }),
  createdByUser: one(users, { fields: [groundingDocuments.createdBy], references: [users.id] }),
  updatedByUser: one(users, { fields: [groundingDocuments.updatedBy], references: [users.id] }),
}));

export const insertGroundingDocumentSchema = createInsertSchema(groundingDocuments).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertGroundingDocument = z.infer<typeof insertGroundingDocumentSchema>;
export type GroundingDocument = typeof groundingDocuments.$inferSelect;

// ============================================================================
// SUPPORT TICKETS (Matches Vega table structure for future cross-app unification)
// ============================================================================

export const TICKET_CATEGORIES = ['bug', 'feature_request', 'question', 'feedback'] as const;
export const TICKET_PRIORITIES = ['low', 'medium', 'high'] as const;
export const TICKET_STATUSES = ['open', 'in_progress', 'resolved', 'closed'] as const;

export type TicketCategory = typeof TICKET_CATEGORIES[number];
export type TicketPriority = typeof TICKET_PRIORITIES[number];
export type TicketStatus = typeof TICKET_STATUSES[number];

export const supportTickets = pgTable("support_tickets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  ticketNumber: integer("ticket_number").notNull(),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  category: text("category").notNull(),
  subject: text("subject").notNull(),
  description: text("description").notNull(),
  priority: text("priority").notNull().default("medium"),
  status: text("status").notNull().default("open"),
  assignedTo: varchar("assigned_to").references(() => users.id, { onDelete: 'set null' }),
  metadata: jsonb("metadata"),
  applicationSource: text("application_source").notNull().default("Constellation"),
  createdAt: timestamp("created_at").default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`now()`).notNull(),
  resolvedAt: timestamp("resolved_at"),
  resolvedBy: varchar("resolved_by").references(() => users.id, { onDelete: 'set null' }),
});

export const insertSupportTicketSchema = createInsertSchema(supportTickets).omit({
  id: true,
  ticketNumber: true,
  createdAt: true,
  updatedAt: true,
  resolvedAt: true,
  resolvedBy: true,
});

export type InsertSupportTicket = z.infer<typeof insertSupportTicketSchema>;
export type SupportTicket = typeof supportTickets.$inferSelect;

export const supportTicketReplies = pgTable("support_ticket_replies", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  ticketId: varchar("ticket_id").notNull().references(() => supportTickets.id, { onDelete: 'cascade' }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  message: text("message").notNull(),
  isInternal: boolean("is_internal").default(false),
  createdAt: timestamp("created_at").default(sql`now()`).notNull(),
});

export const insertSupportTicketReplySchema = createInsertSchema(supportTicketReplies).omit({
  id: true,
  createdAt: true,
});

export type InsertSupportTicketReply = z.infer<typeof insertSupportTicketReplySchema>;
export type SupportTicketReply = typeof supportTicketReplies.$inferSelect;

// Support Ticket to Planner Task sync tracking
export const supportTicketPlannerSync = pgTable("support_ticket_planner_sync", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  ticketId: varchar("ticket_id").notNull().references(() => supportTickets.id, { onDelete: 'cascade' }),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  planId: varchar("plan_id", { length: 255 }).notNull(),
  taskId: varchar("task_id", { length: 255 }).notNull(),
  taskTitle: text("task_title"),
  bucketId: varchar("bucket_id", { length: 255 }),
  bucketName: text("bucket_name"),
  lastSyncedAt: timestamp("last_synced_at").notNull().default(sql`now()`),
  syncStatus: text("sync_status").notNull().default('synced'),
  syncError: text("sync_error"),
  remoteEtag: text("remote_etag"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

export const insertSupportTicketPlannerSyncSchema = createInsertSchema(supportTicketPlannerSync).omit({
  id: true,
  createdAt: true,
});
export type InsertSupportTicketPlannerSync = z.infer<typeof insertSupportTicketPlannerSyncSchema>;
export type SupportTicketPlannerSync = typeof supportTicketPlannerSync.$inferSelect;

// ============================================================================
// CRM INTEGRATION TABLES (Provider-agnostic, tenant-scoped)
// ============================================================================

export const crmProviderEnum = z.enum(['hubspot', 'salesforce']);
export type CrmProvider = z.infer<typeof crmProviderEnum>;

export const crmConnections = pgTable("crm_connections", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  crmProvider: varchar("crm_provider", { length: 50 }).notNull(),
  isEnabled: boolean("is_enabled").notNull().default(false),
  dealProbabilityThreshold: integer("deal_probability_threshold").notNull().default(40),
  dealStageFilter: text("deal_stage_filter"),
  autoCreateEstimate: boolean("auto_create_estimate").notNull().default(false),
  syncDirection: varchar("sync_direction", { length: 20 }).notNull().default("bidirectional"),
  lastSyncAt: timestamp("last_sync_at"),
  lastSyncStatus: varchar("last_sync_status", { length: 20 }),
  lastSyncError: text("last_sync_error"),
  settings: jsonb("settings").$type<Record<string, any>>(),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
}, (table) => ({
  tenantIdx: index("idx_crm_connections_tenant").on(table.tenantId),
  uniqueTenantProvider: uniqueIndex("unique_crm_tenant_provider").on(table.tenantId, table.crmProvider),
}));

export const insertCrmConnectionSchema = createInsertSchema(crmConnections, {
  settings: z.record(z.string(), z.any()).optional(),
}).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  lastSyncAt: true,
  lastSyncStatus: true,
  lastSyncError: true,
});
export type InsertCrmConnection = z.infer<typeof insertCrmConnectionSchema>;
export type CrmConnection = typeof crmConnections.$inferSelect;

export const crmObjectMappings = pgTable("crm_object_mappings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  crmProvider: varchar("crm_provider", { length: 50 }).notNull(),
  crmObjectType: varchar("crm_object_type", { length: 50 }).notNull(),
  crmObjectId: varchar("crm_object_id", { length: 255 }).notNull(),
  localObjectType: varchar("local_object_type", { length: 50 }).notNull(),
  localObjectId: varchar("local_object_id", { length: 255 }).notNull(),
  metadata: jsonb("metadata").$type<Record<string, any>>(),
  lastSyncAt: timestamp("last_sync_at").notNull().default(sql`now()`),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
}, (table) => ({
  tenantIdx: index("idx_crm_mappings_tenant").on(table.tenantId),
  crmObjectIdx: index("idx_crm_mappings_crm_object").on(table.crmProvider, table.crmObjectType, table.crmObjectId),
  localObjectIdx: index("idx_crm_mappings_local_object").on(table.localObjectType, table.localObjectId),
  uniqueMapping: uniqueIndex("unique_crm_object_mapping").on(table.tenantId, table.crmProvider, table.crmObjectType, table.crmObjectId, table.localObjectType, table.localObjectId),
}));

export const insertCrmObjectMappingSchema = createInsertSchema(crmObjectMappings).omit({
  id: true,
  createdAt: true,
  lastSyncAt: true,
});
export type InsertCrmObjectMapping = z.infer<typeof insertCrmObjectMappingSchema>;
export type CrmObjectMapping = typeof crmObjectMappings.$inferSelect;

export const crmSyncLog = pgTable("crm_sync_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  crmProvider: varchar("crm_provider", { length: 50 }).notNull(),
  action: varchar("action", { length: 50 }).notNull(),
  crmObjectType: varchar("crm_object_type", { length: 50 }),
  crmObjectId: varchar("crm_object_id", { length: 255 }),
  localObjectType: varchar("local_object_type", { length: 50 }),
  localObjectId: varchar("local_object_id", { length: 255 }),
  status: varchar("status", { length: 20 }).notNull(),
  errorMessage: text("error_message"),
  requestPayload: jsonb("request_payload"),
  responsePayload: jsonb("response_payload"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
}, (table) => ({
  tenantIdx: index("idx_crm_sync_log_tenant").on(table.tenantId),
  createdAtIdx: index("idx_crm_sync_log_created").on(table.createdAt),
}));

export const insertCrmSyncLogSchema = createInsertSchema(crmSyncLog).omit({
  id: true,
  createdAt: true,
});
export type InsertCrmSyncLog = z.infer<typeof insertCrmSyncLogSchema>;
export type CrmSyncLog = typeof crmSyncLog.$inferSelect;

// ============================================================================
// PROJECT DELIVERABLES
// ============================================================================

export const deliverableStatusEnum = z.enum(['not-started', 'in-progress', 'in-review', 'accepted', 'rejected']);
export type DeliverableStatus = z.infer<typeof deliverableStatusEnum>;

export const projectDeliverables = pgTable("project_deliverables", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: 'cascade' }),
  name: text("name").notNull(),
  description: text("description"),
  ownerUserId: varchar("owner_user_id").notNull().references(() => users.id),
  epicId: varchar("epic_id"),
  stageId: varchar("stage_id"),
  parentDeliverableId: varchar("parent_deliverable_id"), // set when this row was created by splitting another deliverable
  status: varchar("status", { length: 20 }).notNull().default('not-started'),
  targetDate: date("target_date"),
  deliveredDate: date("delivered_date"),
  acceptanceNotes: text("acceptance_notes"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdBy: varchar("created_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
}, (table) => ({
  tenantIdx: index("idx_project_deliverables_tenant").on(table.tenantId),
  projectIdx: index("idx_project_deliverables_project").on(table.projectId),
  statusIdx: index("idx_project_deliverables_status").on(table.status),
  parentIdx: index("idx_project_deliverables_parent").on(table.parentDeliverableId),
}));

export const projectDeliverablesRelations = relations(projectDeliverables, ({ one }) => ({
  project: one(projects, { fields: [projectDeliverables.projectId], references: [projects.id] }),
  tenant: one(tenants, { fields: [projectDeliverables.tenantId], references: [tenants.id] }),
  owner: one(users, { fields: [projectDeliverables.ownerUserId], references: [users.id] }),
  createdByUser: one(users, { fields: [projectDeliverables.createdBy], references: [users.id] }),
}));

export const insertProjectDeliverableSchema = createInsertSchema(projectDeliverables).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertProjectDeliverable = z.infer<typeof insertProjectDeliverableSchema>;
export type ProjectDeliverable = typeof projectDeliverables.$inferSelect;

export const deliverableStatusHistory = pgTable("deliverable_status_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  deliverableId: varchar("deliverable_id").notNull().references(() => projectDeliverables.id, { onDelete: 'cascade' }),
  oldStatus: varchar("old_status", { length: 20 }),
  newStatus: varchar("new_status", { length: 20 }).notNull(),
  changedBy: varchar("changed_by").references(() => users.id),
  changedAt: timestamp("changed_at").notNull().default(sql`now()`),
  comments: text("comments"),
}, (table) => ({
  deliverableIdx: index("idx_deliverable_status_history_deliverable").on(table.deliverableId),
}));

export const deliverableStatusHistoryRelations = relations(deliverableStatusHistory, ({ one }) => ({
  deliverable: one(projectDeliverables, { fields: [deliverableStatusHistory.deliverableId], references: [projectDeliverables.id] }),
  changedByUser: one(users, { fields: [deliverableStatusHistory.changedBy], references: [users.id] }),
}));

export const insertDeliverableStatusHistorySchema = createInsertSchema(deliverableStatusHistory).omit({
  id: true,
  changedAt: true,
});
export type InsertDeliverableStatusHistory = z.infer<typeof insertDeliverableStatusHistorySchema>;
export type DeliverableStatusHistory = typeof deliverableStatusHistory.$inferSelect;

// ============================================================================
// AI MODEL MANAGEMENT & USAGE TRACKING (Following Vega Pattern)
// ============================================================================

export const AI_PROVIDERS = {
  REPLIT: 'replit_ai',
  AZURE_OPENAI: 'azure_openai',
  AZURE_FOUNDRY: 'azure_foundry',
  OPENAI: 'openai',
  ANTHROPIC: 'anthropic',
} as const;

export type AIProvider = typeof AI_PROVIDERS[keyof typeof AI_PROVIDERS];

export const AI_FEATURES = {
  ESTIMATE_GENERATION: 'estimate_generation',
  ESTIMATE_NARRATIVE: 'estimate_narrative',
  ESTIMATE_FROM_NARRATIVE: 'estimate_from_narrative',
  INVOICE_NARRATIVE: 'invoice_narrative',
  STATUS_REPORT: 'status_report',
  PPTX_REPORT: 'pptx_report',
  DELIVERABLE_EXTRACTION: 'deliverable_extraction',
  HELP_CHAT: 'help_chat',
  REPORT_QUERY: 'report_query',
  RAIDD_ANALYSIS: 'raidd_analysis',
  SUB_SOW_NARRATIVE: 'sub_sow_narrative',
  EXECUTIVE_NARRATIVE: 'executive_narrative',
  TIME_ENTRY_REWRITE: 'time_entry_rewrite',
  CUSTOM: 'custom',
  OTHER: 'other',
  PROJECT_AGENT: 'project_agent',
} as const;

export type AIFeature = typeof AI_FEATURES[keyof typeof AI_FEATURES];

export const AI_MODELS: Record<string, readonly string[]> = {
  replit_ai: ['gpt-5', 'gpt-4o', 'gpt-4o-mini', 'claude-sonnet-4-5', 'claude-opus-4.7', 'claude-haiku-4-5'],
  azure_openai: ['gpt-5', 'gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-4'],
  azure_foundry: ['gpt-5.4', 'gpt-5.2', 'gpt-4o'],
  openai: ['gpt-5', 'gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'],
  anthropic: ['claude-sonnet-4-5', 'claude-opus-4.7', 'claude-haiku-4-5', 'claude-3.5-sonnet', 'claude-3-haiku'],
} as const;

export const AI_MODEL_INFO: Record<string, {
  name: string;
  description: string;
  costTier: 'free' | 'low' | 'medium' | 'high';
  providers: string[];
  contextWindow: number;
  costPer1kPrompt: number;
  costPer1kCompletion: number;
}> = {
  'gpt-5.4': { name: 'GPT-5.4', description: 'Latest and most capable OpenAI model', costTier: 'high', providers: ['azure_foundry'], contextWindow: 128000, costPer1kPrompt: 0.005, costPer1kCompletion: 0.015 },
  'gpt-5.2': { name: 'GPT-5.2', description: 'Advanced reasoning OpenAI model', costTier: 'high', providers: ['azure_foundry'], contextWindow: 128000, costPer1kPrompt: 0.005, costPer1kCompletion: 0.015 },
  'gpt-5': { name: 'GPT-5', description: 'Most capable OpenAI model', costTier: 'high', providers: ['replit_ai', 'openai', 'azure_openai', 'azure_foundry'], contextWindow: 128000, costPer1kPrompt: 0.005, costPer1kCompletion: 0.015 },
  'gpt-4o': { name: 'GPT-4o', description: 'Fast multimodal model', costTier: 'medium', providers: ['replit_ai', 'openai', 'azure_openai', 'azure_foundry'], contextWindow: 128000, costPer1kPrompt: 0.0025, costPer1kCompletion: 0.01 },
  'gpt-4o-mini': { name: 'GPT-4o Mini', description: 'Cost-effective for simple tasks', costTier: 'low', providers: ['replit_ai', 'openai', 'azure_openai', 'azure_foundry'], contextWindow: 128000, costPer1kPrompt: 0.00015, costPer1kCompletion: 0.0006 },
  'gpt-4-turbo': { name: 'GPT-4 Turbo', description: 'Enhanced GPT-4 with vision', costTier: 'medium', providers: ['openai', 'azure_openai'], contextWindow: 128000, costPer1kPrompt: 0.01, costPer1kCompletion: 0.03 },
  'gpt-4': { name: 'GPT-4', description: 'Original GPT-4 model', costTier: 'medium', providers: ['openai', 'azure_openai'], contextWindow: 8192, costPer1kPrompt: 0.03, costPer1kCompletion: 0.06 },
  'claude-sonnet-4-5': { name: 'Claude Sonnet 4.5', description: 'Fast balanced Anthropic model (current)', costTier: 'medium', providers: ['replit_ai', 'anthropic'], contextWindow: 200000, costPer1kPrompt: 0.003, costPer1kCompletion: 0.015 },
  'claude-opus-4.7': { name: 'Claude Opus 4.7', description: 'Most capable Anthropic model (current)', costTier: 'high', providers: ['replit_ai', 'anthropic'], contextWindow: 200000, costPer1kPrompt: 0.015, costPer1kCompletion: 0.075 },
  'claude-haiku-4-5': { name: 'Claude Haiku 4.5', description: 'Fast and cost-effective Anthropic model', costTier: 'low', providers: ['replit_ai', 'anthropic'], contextWindow: 200000, costPer1kPrompt: 0.001, costPer1kCompletion: 0.005 },
  'claude-3.5-sonnet': { name: 'Claude 3.5 Sonnet', description: 'Previous gen balanced model', costTier: 'medium', providers: ['anthropic'], contextWindow: 200000, costPer1kPrompt: 0.003, costPer1kCompletion: 0.015 },
  'claude-3-haiku': { name: 'Claude 3 Haiku', description: 'Fast and cost-effective', costTier: 'low', providers: ['anthropic'], contextWindow: 200000, costPer1kPrompt: 0.00025, costPer1kCompletion: 0.00125 },
};

export type AIProviderConfig = {
  azureFoundryEndpoint?: string;
  azureFoundryDeployment?: string;
  azureOpenAIEndpoint?: string;
  azureOpenAIDeployment?: string;
  customEndpoint?: string;
};

export const aiConfiguration = pgTable("ai_configuration", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  activeProvider: text("active_provider").notNull().default('replit_ai'),
  activeModel: text("active_model").notNull().default('gpt-5'),
  providerConfig: jsonb("provider_config").$type<AIProviderConfig>(),
  enableStreaming: boolean("enable_streaming").default(true),
  maxTokensPerRequest: integer("max_tokens_per_request").default(4096),
  monthlyTokenBudget: integer("monthly_token_budget"),
  alertThresholds: jsonb("alert_thresholds").$type<number[]>().default([75, 90, 100]),
  alertEnabled: boolean("alert_enabled").default(true),
  updatedBy: varchar("updated_by").references(() => users.id),
  updatedAt: timestamp("updated_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertAiConfigurationSchema = createInsertSchema(aiConfiguration).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertAiConfiguration = z.infer<typeof insertAiConfigurationSchema>;
export type AiConfiguration = typeof aiConfiguration.$inferSelect;

export const aiUsageLogs = pgTable("ai_usage_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id, { onDelete: 'cascade' }),
  userId: varchar("user_id").references(() => users.id, { onDelete: 'set null' }),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  modelVersion: text("model_version"),
  deploymentName: text("deployment_name"),
  feature: text("feature").notNull(),
  promptTokens: integer("prompt_tokens").notNull().default(0),
  completionTokens: integer("completion_tokens").notNull().default(0),
  totalTokens: integer("total_tokens").notNull().default(0),
  estimatedCostMicrodollars: integer("estimated_cost_microdollars"),
  latencyMs: integer("latency_ms"),
  wasStreaming: boolean("was_streaming").default(false),
  requestId: text("request_id"),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  tenantIdx: index("idx_ai_usage_tenant").on(table.tenantId),
  featureIdx: index("idx_ai_usage_feature").on(table.feature),
  createdIdx: index("idx_ai_usage_created").on(table.createdAt),
  providerIdx: index("idx_ai_usage_provider").on(table.provider),
}));

export const aiUsageLogsRelations = relations(aiUsageLogs, ({ one }) => ({
  tenant: one(tenants, { fields: [aiUsageLogs.tenantId], references: [tenants.id] }),
  user: one(users, { fields: [aiUsageLogs.userId], references: [users.id] }),
}));

export const insertAiUsageLogSchema = createInsertSchema(aiUsageLogs).omit({
  id: true,
  createdAt: true,
});
export type InsertAiUsageLog = z.infer<typeof insertAiUsageLogSchema>;
export type AiUsageLog = typeof aiUsageLogs.$inferSelect;

export const aiUsageSummaries = pgTable("ai_usage_summaries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id, { onDelete: 'cascade' }),
  periodType: text("period_type").notNull(),
  periodStart: timestamp("period_start").notNull(),
  periodEnd: timestamp("period_end").notNull(),
  totalRequests: integer("total_requests").notNull().default(0),
  totalPromptTokens: integer("total_prompt_tokens").notNull().default(0),
  totalCompletionTokens: integer("total_completion_tokens").notNull().default(0),
  totalTokens: integer("total_tokens").notNull().default(0),
  totalCostMicrodollars: integer("total_cost_microdollars").notNull().default(0),
  usageByModel: jsonb("usage_by_model").$type<Record<string, { requests: number; tokens: number; costMicrodollars: number }>>(),
  usageByFeature: jsonb("usage_by_feature").$type<Record<string, { requests: number; tokens: number; costMicrodollars: number }>>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  tenantIdx: index("idx_ai_summary_tenant").on(table.tenantId),
  periodIdx: index("idx_ai_summary_period").on(table.periodType, table.periodStart),
}));

export const aiUsageSummariesRelations = relations(aiUsageSummaries, ({ one }) => ({
  tenant: one(tenants, { fields: [aiUsageSummaries.tenantId], references: [tenants.id] }),
}));

export const insertAiUsageSummarySchema = createInsertSchema(aiUsageSummaries).omit({
  id: true,
  createdAt: true,
});
export type InsertAiUsageSummary = z.infer<typeof insertAiUsageSummarySchema>;
export type AiUsageSummary = typeof aiUsageSummaries.$inferSelect;

export const aiUsageAlerts = pgTable("ai_usage_alerts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  periodMonth: varchar("period_month", { length: 7 }).notNull(),
  thresholdPercent: integer("threshold_percent").notNull(),
  tokenUsageAtAlert: integer("token_usage_at_alert").notNull(),
  monthlyBudget: integer("monthly_budget").notNull(),
  alertedAt: timestamp("alerted_at").defaultNow().notNull(),
  notifiedEmails: jsonb("notified_emails").$type<string[]>(),
}, (table) => ({
  periodThresholdUnique: uniqueIndex("idx_ai_alert_period_threshold_unique").on(table.periodMonth, table.thresholdPercent),
}));

export const insertAiUsageAlertSchema = createInsertSchema(aiUsageAlerts).omit({
  id: true,
  alertedAt: true,
});
export type InsertAiUsageAlert = z.infer<typeof insertAiUsageAlertSchema>;
export type AiUsageAlert = typeof aiUsageAlerts.$inferSelect;

// Industry preset vocabularies
export const INDUSTRY_PRESETS: Record<string, Required<VocabularyTerms>> = {
  default: DEFAULT_VOCABULARY,
  consulting: {
    epic: "Program",
    stage: "Phase",
    activity: "Gate",
    workstream: "Category",
  },
  software: {
    epic: "Release",
    stage: "Sprint",
    activity: "Task",
    workstream: "Feature",
  },
  construction: {
    epic: "Phase",
    stage: "Milestone",
    activity: "Deliverable",
    workstream: "Trade",
  },
};

// Zod schema for vocabulary validation
export const vocabularyTermsSchema = z.object({
  epic: z.string().min(1).max(50).optional(),
  stage: z.string().min(1).max(50).optional(),
  activity: z.string().min(1).max(50).optional(),
  workstream: z.string().min(1).max(50).optional(),
}).strict();

export type VocabularyTermsInput = z.infer<typeof vocabularyTermsSchema>;

// Page view analytics (public-page visit tracking)
export const pageViews = pgTable("page_views", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  path: text("path").notNull(),          // e.g. "/", "/signup"
  sessionId: text("session_id"),         // anonymous session token from localStorage
  referrer: text("referrer"),            // document.referrer
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});
export type PageView = typeof pageViews.$inferSelect;

// ============================================================================
// TEAMS AUTOMATION (Phase 2) — Member sync, SharePoint provisioning, Guest invitations
// ============================================================================

// Automation action types
export const teamsAutomationActionEnum = z.enum([
  'member_added', 'member_removed', 'member_add_failed', 'member_remove_failed',
  'sharepoint_provisioned', 'sharepoint_provision_failed',
  'guest_invited', 'guest_invite_failed', 'guest_redeemed',
  'sync_started', 'sync_completed', 'sync_failed'
]);
export type TeamsAutomationAction = z.infer<typeof teamsAutomationActionEnum>;

// Teams Automation Logs — audit trail for all automated Teams operations
export const teamsAutomationLogs = pgTable("teams_automation_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id),
  projectId: varchar("project_id").references(() => projects.id, { onDelete: "set null" }),
  teamId: varchar("team_id", { length: 255 }),
  channelId: varchar("channel_id", { length: 255 }),
  action: text("action").notNull(), // TeamsAutomationAction values
  targetUserId: varchar("target_user_id").references(() => users.id, { onDelete: "set null" }),
  targetAzureUserId: varchar("target_azure_user_id", { length: 255 }),
  targetEmail: text("target_email"),
  details: jsonb("details").$type<Record<string, any>>(),
  success: boolean("success").notNull().default(true),
  errorMessage: text("error_message"),
  triggeredBy: varchar("triggered_by").references(() => users.id, { onDelete: "set null" }), // null = system/automatic
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
}, (table) => ({
  tenantCreatedIdx: index("idx_teams_auto_logs_tenant_created").on(table.tenantId, table.createdAt),
  projectCreatedIdx: index("idx_teams_auto_logs_project_created").on(table.projectId, table.createdAt),
  teamCreatedIdx: index("idx_teams_auto_logs_team_created").on(table.teamId, table.createdAt),
  actionCreatedIdx: index("idx_teams_auto_logs_action_created").on(table.action, table.createdAt),
}));

export const insertTeamsAutomationLogSchema = createInsertSchema(teamsAutomationLogs).omit({
  id: true,
  createdAt: true,
});
export type InsertTeamsAutomationLog = z.infer<typeof insertTeamsAutomationLogSchema>;
export type TeamsAutomationLog = typeof teamsAutomationLogs.$inferSelect;

// Guest Invitations — track Azure AD B2B guest invitations
export const guestInvitations = pgTable("guest_invitations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id),
  projectId: varchar("project_id").references(() => projects.id, { onDelete: "set null" }),
  teamId: varchar("team_id", { length: 255 }).notNull(),
  invitedEmail: text("invited_email").notNull(),
  invitedDisplayName: text("invited_display_name"),
  invitedUserId: varchar("invited_user_id").references(() => users.id, { onDelete: "set null" }), // Constellation user if exists
  azureGuestUserId: varchar("azure_guest_user_id", { length: 255 }), // Set after invitation accepted
  invitationId: varchar("invitation_id", { length: 255 }), // Azure AD invitation ID
  redemptionUrl: text("redemption_url"), // URL for guest to accept invitation
  status: text("status").notNull().default("pending"), // pending, sent, accepted, failed, expired
  role: text("role").notNull().default("member"), // member or owner
  sendInvitationMessage: boolean("send_invitation_message").notNull().default(true),
  customMessage: text("custom_message"),
  invitedBy: varchar("invited_by").references(() => users.id, { onDelete: "set null" }),
  sentAt: timestamp("sent_at"),
  acceptedAt: timestamp("accepted_at"),
  expiresAt: timestamp("expires_at"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
});

export const insertGuestInvitationSchema = createInsertSchema(guestInvitations).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertGuestInvitation = z.infer<typeof insertGuestInvitationSchema>;
export type GuestInvitation = typeof guestInvitations.$inferSelect;

// Teams Member Sync State — tracks per-project member sync configuration and status
export const teamsMemberSyncState = pgTable("teams_member_sync_state", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  teamId: varchar("team_id", { length: 255 }).notNull(),
  syncEnabled: boolean("sync_enabled").notNull().default(true),
  autoAddMembers: boolean("auto_add_members").notNull().default(true),
  autoRemoveMembers: boolean("auto_remove_members").notNull().default(false), // Conservative default
  inviteGuestsAutomatically: boolean("invite_guests_automatically").notNull().default(false),
  lastSyncAt: timestamp("last_sync_at"),
  lastSyncStatus: text("last_sync_status"), // success, error, partial
  lastSyncError: text("last_sync_error"),
  membersAdded: integer("members_added").notNull().default(0),
  membersRemoved: integer("members_removed").notNull().default(0),
  guestsInvited: integer("guests_invited").notNull().default(0),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").default(sql`now()`),
}, (table) => ({
  uniqueProject: unique("uq_teams_member_sync_state_project").on(table.projectId),
}));

export const insertTeamsMemberSyncStateSchema = createInsertSchema(teamsMemberSyncState).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertTeamsMemberSyncState = z.infer<typeof insertTeamsMemberSyncStateSchema>;
export type TeamsMemberSyncState = typeof teamsMemberSyncState.$inferSelect;

// ============================================================================
// MCP WRITE AUDIT (Phase 0 of Copilot Write Activities)
// ============================================================================
// Tracks every mutation that flows through /mcp/v1/* endpoints. Serves three
// purposes:
//   1. Idempotency replay: a POST with the same X-Idempotency-Key returns the
//      cached response instead of re-executing, so a retrying Copilot agent
//      never double-creates resources.
//   2. Audit trail: every write is attributable to a user + tenant + endpoint.
//   3. Forensics: requestHash lets us detect when a replayed key carries a
//      different payload (treated as a 409 conflict).

// ============================================================================
// PROJECT SHAREPOINT STATUS REPORTS
// ============================================================================

export const projectStatusReports = pgTable("project_status_reports", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: 'cascade' }),
  tenantId: varchar("tenant_id").references(() => tenants.id),
  reportPeriod: text("report_period").notNull(), // e.g. "2026-W16" or "Apr 14 – Apr 20, 2026"
  ragStatus: varchar("rag_status", { length: 10 }).notNull().default("green"), // green, amber, red
  accomplishments: text("accomplishments"),
  milestones: text("milestones"),
  risks: text("risks"),
  notes: text("notes"),
  sharepointPageId: text("sharepoint_page_id"),
  sharepointPageUrl: text("sharepoint_page_url"),
  publishedAt: timestamp("published_at").notNull().default(sql`now()`),
  publishedBy: varchar("published_by").references(() => users.id),
}, (table) => ({
  projectIdx: index("idx_project_status_reports_project").on(table.projectId),
  tenantIdx: index("idx_project_status_reports_tenant").on(table.tenantId),
}));

export const insertProjectStatusReportSchema = createInsertSchema(projectStatusReports).omit({
  id: true,
  publishedAt: true,
});
export type InsertProjectStatusReport = z.infer<typeof insertProjectStatusReportSchema>;
export type ProjectStatusReport = typeof projectStatusReports.$inferSelect;

export const mcpWriteAudit = pgTable("mcp_write_audit", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  userId: varchar("user_id").references(() => users.id).notNull(),
  endpoint: text("endpoint").notNull(),          // e.g. "POST /mcp/v1/clients"
  idempotencyKey: varchar("idempotency_key", { length: 255 }).notNull(),
  requestHash: varchar("request_hash", { length: 64 }).notNull(),  // sha256 hex
  responseStatus: integer("response_status").notNull(),
  responseBody: jsonb("response_body"),
  resourceType: varchar("resource_type", { length: 50 }),
  resourceId: varchar("resource_id", { length: 255 }),
  correlationId: varchar("correlation_id", { length: 64 }),
  dryRun: boolean("dry_run").notNull().default(false),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
}, (table) => ({
  uniqueTenantUserKey: uniqueIndex("uq_mcp_write_audit_tenant_user_key")
    .on(table.tenantId, table.userId, table.idempotencyKey),
  tenantIdx: index("idx_mcp_write_audit_tenant").on(table.tenantId),
  createdIdx: index("idx_mcp_write_audit_created").on(table.createdAt),
  resourceIdx: index("idx_mcp_write_audit_resource").on(table.resourceType, table.resourceId),
}));

export const insertMcpWriteAuditSchema = createInsertSchema(mcpWriteAudit).omit({
  id: true,
  createdAt: true,
});
export type InsertMcpWriteAudit = z.infer<typeof insertMcpWriteAuditSchema>;
export type McpWriteAudit = typeof mcpWriteAudit.$inferSelect;

// ============================================================================
// AGENT CARD HEALTH CHECKS
// ============================================================================

export const agentCardHealthChecks = pgTable("agent_card_health_checks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  status: varchar("status", { length: 20 }).notNull(), // 'ok' | 'invalid' | 'error'
  checkedAt: timestamp("checked_at").notNull(),
  skillCount: integer("skill_count"),
  errors: jsonb("errors").$type<string[]>(),
  message: text("message"),
  trigger: varchar("trigger", { length: 50 }).notNull().default("scheduled"), // 'scheduled' | 'startup' | 'admin-manual' | 'cron'
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
}, (table) => ({
  checkedAtIdx: index("idx_agent_card_health_checks_checked_at").on(table.checkedAt),
}));

export const insertAgentCardHealthCheckSchema = createInsertSchema(agentCardHealthChecks).omit({
  id: true,
  createdAt: true,
});
export type InsertAgentCardHealthCheck = z.infer<typeof insertAgentCardHealthCheckSchema>;
export type AgentCardHealthCheck = typeof agentCardHealthChecks.$inferSelect;

// ============================================================================
// TEAMS PROACTIVE ALERT LOG — deduplication and audit trail for Teams alerts
// ============================================================================

export const teamsAlertLog = pgTable("teams_alert_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  triggerType: varchar("trigger_type", { length: 50 }).notNull(), // 'health', 'raidd', 'status_report'
  projectId: varchar("project_id"),
  entryId: varchar("entry_id"),
  targetTeamId: varchar("target_team_id"),
  targetChannelId: varchar("target_channel_id"),
  alertedAt: timestamp("alerted_at").notNull().default(sql`now()`),
  details: jsonb("details"),
}, (table) => ({
  tenantIdx: index("idx_teams_alert_log_tenant").on(table.tenantId),
  tenantTriggerIdx: index("idx_teams_alert_log_tenant_trigger").on(table.tenantId, table.triggerType),
  alertedAtIdx: index("idx_teams_alert_log_alerted_at").on(table.alertedAt),
}));

export const insertTeamsAlertLogSchema = createInsertSchema(teamsAlertLog).omit({
  id: true,
  alertedAt: true,
});
export type InsertTeamsAlertLog = z.infer<typeof insertTeamsAlertLogSchema>;
export type TeamsAlertLog = typeof teamsAlertLog.$inferSelect;

// ============================================================================
// USER CALENDAR MAPPINGS — recurring Outlook event → project memory
// ============================================================================

export const userCalendarMappings = pgTable("user_calendar_mappings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  tenantId: varchar("tenant_id").references(() => tenants.id),
  // Key: hash of seriesMasterId (if recurring) or hash of subject+organiserEmail
  eventKey: varchar("event_key", { length: 255 }).notNull(),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: 'cascade' }),
  // Human-readable label (typically the event subject) shown in mapping management UI.
  label: varchar("label", { length: 500 }),
  lastUsedAt: timestamp("last_used_at").notNull().default(sql`now()`),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
}, (table) => ({
  userKeyIdx: uniqueIndex("idx_user_calendar_mappings_user_key").on(table.userId, table.eventKey),
  userIdx: index("idx_user_calendar_mappings_user").on(table.userId),
}));

export const insertUserCalendarMappingSchema = createInsertSchema(userCalendarMappings).omit({
  id: true,
  createdAt: true,
  lastUsedAt: true,
});
export type InsertUserCalendarMapping = z.infer<typeof insertUserCalendarMappingSchema>;
export type UserCalendarMapping = typeof userCalendarMappings.$inferSelect;

// ============================================================================
// BACKGROUND JOBS — persistent async job queue for PDF, AI, and Graph ops
// ============================================================================

export const backgroundJobs = pgTable("background_jobs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  type: varchar("type", { length: 100 }).notNull(),
  payload: jsonb("payload").$type<Record<string, any>>().notNull().default({}),
  status: varchar("status", { length: 20 }).notNull().default("queued"),
  attempts: integer("attempts").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(3),
  lastError: text("last_error"),
  runAfter: timestamp("run_after"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  startedAt: timestamp("started_at"),
  finishedAt: timestamp("finished_at"),
  result: jsonb("result").$type<Record<string, any>>(),
  tenantId: varchar("tenant_id").references(() => tenants.id, { onDelete: 'cascade' }),
  createdBy: varchar("created_by").references(() => users.id, { onDelete: 'set null' }),
}, (table) => ({
  statusIdx: index("idx_background_jobs_status").on(table.status),
  createdAtIdx: index("idx_background_jobs_created_at").on(table.createdAt),
  tenantIdx: index("idx_background_jobs_tenant").on(table.tenantId),
  typeIdx: index("idx_background_jobs_type").on(table.type),
  // Supports the prune query (status='succeeded'/'failed' AND finished_at < cutoff)
  statusFinishedAtIdx: index("idx_background_jobs_status_finished_at").on(table.status, table.finishedAt),
}));

export const insertBackgroundJobSchema = createInsertSchema(backgroundJobs).omit({
  id: true,
  createdAt: true,
});
export type InsertBackgroundJob = z.infer<typeof insertBackgroundJobSchema>;
export type BackgroundJob = typeof backgroundJobs.$inferSelect;

// ============================================================================
// IN-APP NOTIFICATION CENTER
// ============================================================================

export const notificationTypeEnum = z.enum([
  'expense_submitted',
  'expense_approval_needed',
  'expense_approved',
  'expense_rejected',
  'project_health_alert',
  'raidd_overdue',
  'status_report_due',
  'ai_budget_alert',
  'project_budget_alert',
  'time_reminder',
  'expense_reminder',
  'general',
  'client_signoff',
  'planner_sync_failure',
  'timesheet_submitted',
  'timesheet_approved',
  'timesheet_rejected',
  'invoice_sent',
  'invoice_paid',
  'raidd_assigned',
]);
export type NotificationType = z.infer<typeof notificationTypeEnum>;

export const notifications = pgTable("notifications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  type: varchar("type", { length: 100 }).notNull(),
  title: varchar("title", { length: 500 }).notNull(),
  body: text("body"),
  entityRef: varchar("entity_ref", { length: 100 }),
  link: text("link"),
  readAt: timestamp("read_at"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
}, (table) => ({
  userReadIdx: index("idx_notifications_user_read").on(table.userId, table.readAt, table.createdAt),
  tenantIdx: index("idx_notifications_tenant").on(table.tenantId),
  userIdx: index("idx_notifications_user").on(table.userId),
}));

export const insertNotificationSchema = createInsertSchema(notifications).omit({
  id: true,
  createdAt: true,
});
export type InsertNotification = z.infer<typeof insertNotificationSchema>;
export type Notification = typeof notifications.$inferSelect;

export const userNotificationPreferences = pgTable("user_notification_preferences", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  notificationType: varchar("notification_type", { length: 100 }).notNull(),
  inApp: boolean("in_app").notNull().default(true),
  email: boolean("email").notNull().default(true),
  teams: boolean("teams").notNull().default(false),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
}, (table) => ({
  userTypeIdx: uniqueIndex("idx_notif_prefs_user_type").on(table.userId, table.tenantId, table.notificationType),
}));

export const insertUserNotificationPreferenceSchema = createInsertSchema(userNotificationPreferences).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertUserNotificationPreference = z.infer<typeof insertUserNotificationPreferenceSchema>;
export type UserNotificationPreference = typeof userNotificationPreferences.$inferSelect;

// Web Push subscriptions for browser notifications
export const pushSubscriptions = pgTable("push_subscriptions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  endpoint: text("endpoint").notNull(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
}, (table) => ({
  // A single browser endpoint can be registered for the same user across
  // multiple tenants — the unique constraint scopes the endpoint to the
  // (user, tenant) pair so a multi-tenant user can opt in per workspace.
  endpointIdx: uniqueIndex("idx_push_subs_endpoint")
    .on(table.endpoint, table.userId, table.tenantId),
  userIdx: index("idx_push_subs_user").on(table.userId, table.tenantId),
}));

export const insertPushSubscriptionSchema = createInsertSchema(pushSubscriptions).omit({
  id: true,
  createdAt: true,
});
export type InsertPushSubscription = z.infer<typeof insertPushSubscriptionSchema>;
export type PushSubscriptionRow = typeof pushSubscriptions.$inferSelect;

// Server-only VAPID keypair store. Never exposed via any HTTP route.
export const vapidKeys = pgTable("vapid_keys", {
  id: varchar("id").primaryKey().default(sql`'singleton'`),
  publicKey: text("public_key").notNull(),
  privateKey: text("private_key").notNull(),
  subject: text("subject").notNull(),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});
export type VapidKeyRow = typeof vapidKeys.$inferSelect;

// ============================================================================
// A2A TASK PERSISTENCE — durable store for Google A2A task records
// ============================================================================

export const a2aTasks = pgTable("a2a_tasks", {
  id: varchar("id").primaryKey(),
  tenantId: varchar("tenant_id").references(() => tenants.id, { onDelete: 'cascade' }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  sessionId: varchar("session_id", { length: 255 }),
  state: varchar("state", { length: 30 }).notNull(),
  status: jsonb("status").$type<Record<string, any>>().notNull(),
  artifacts: jsonb("artifacts").$type<Record<string, any>[]>(),
  history: jsonb("history").$type<Record<string, any>[]>(),
  metadata: jsonb("metadata").$type<Record<string, any>>(),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
}, (table) => ({
  tenantIdx: index("idx_a2a_tasks_tenant").on(table.tenantId),
  userIdx: index("idx_a2a_tasks_user").on(table.userId),
  createdIdx: index("idx_a2a_tasks_created").on(table.createdAt),
}));

export const insertA2ATaskSchema = createInsertSchema(a2aTasks).omit({
  createdAt: true,
});
export type InsertA2ATask = z.infer<typeof insertA2ATaskSchema>;
export type A2ATaskRow = typeof a2aTasks.$inferSelect;

// ============================================================================
// DIGEST SENDS — idempotency record + delivery stats for weekly digests
// ============================================================================

export const digestSends = pgTable("digest_sends", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  weekLabel: varchar("week_label", { length: 10 }).notNull(), // ISO week e.g. "2025-W04"
  status: varchar("status", { length: 20 }).notNull().default("sent"), // sent | failed | skipped
  errorMessage: text("error_message"),
  sentAt: timestamp("sent_at").notNull().default(sql`now()`),
  sgMessageId: varchar("sg_message_id", { length: 255 }),
  openedAt: timestamp("opened_at"),
  openCount: integer("open_count").notNull().default(0),
}, (table) => ({
  uniqueUserWeek: uniqueIndex("uq_digest_sends_user_week").on(table.userId, table.tenantId, table.weekLabel),
  tenantWeekIdx: index("idx_digest_sends_tenant_week").on(table.tenantId, table.weekLabel),
  sentAtIdx: index("idx_digest_sends_sent_at").on(table.sentAt),
  sgMessageIdIdx: index("idx_digest_sends_sg_message_id").on(table.sgMessageId),
}));

export const insertDigestSendSchema = createInsertSchema(digestSends).omit({
  id: true,
  sentAt: true,
  openedAt: true,
  openCount: true,
});
export type InsertDigestSend = z.infer<typeof insertDigestSendSchema>;
export type DigestSend = typeof digestSends.$inferSelect;

// ============================================================================
// CLIENT SIGN-OFFS — formal approval / acceptance / acknowledgement records
// ============================================================================

export const clientSignoffs = pgTable("client_signoffs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  entityType: varchar("entity_type", { length: 50 }).notNull(), // 'estimate' | 'project_milestone' | 'status_report' | 'sow'
  entityId: varchar("entity_id", { length: 255 }).notNull(),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  action: varchar("action", { length: 50 }).notNull(), // 'approved' | 'changes_requested' | 'accepted' | 'rejected' | 'acknowledged'
  comment: text("comment"),
  clientUserName: text("client_user_name").notNull(),
  clientUserEmail: text("client_user_email"),
  ipAddress: varchar("ip_address", { length: 64 }),
  signedAt: timestamp("signed_at").notNull().default(sql`now()`),
}, (table) => ({
  entityIdx: index("idx_client_signoffs_entity").on(table.entityType, table.entityId),
  tenantSignedIdx: index("idx_client_signoffs_tenant_signed").on(table.tenantId, table.signedAt),
}));

export const insertClientSignoffSchema = createInsertSchema(clientSignoffs).omit({
  id: true,
  signedAt: true,
});
export type InsertClientSignoff = z.infer<typeof insertClientSignoffSchema>;
export type ClientSignoff = typeof clientSignoffs.$inferSelect;

// ============================================================================
// AI PROJECT MANAGER AGENT (Task #143)
// ============================================================================

export const agentConversations = pgTable("agent_conversations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: 'cascade' }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  title: text("title"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
}, (table) => ({
  projectIdx: index("idx_agent_conversations_project").on(table.projectId),
  userIdx: index("idx_agent_conversations_user").on(table.userId),
}));

export const agentMessages = pgTable("agent_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  conversationId: varchar("conversation_id").notNull().references(() => agentConversations.id, { onDelete: 'cascade' }),
  role: varchar("role", { length: 20 }).notNull(), // user | assistant | system | tool
  content: text("content").notNull(),
  toolCalls: jsonb("tool_calls").$type<Array<{ id: string; name: string; args: any }>>(),
  toolCallId: varchar("tool_call_id"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
}, (table) => ({
  conversationIdx: index("idx_agent_messages_conversation").on(table.conversationId),
}));

export const agentActions = pgTable("agent_actions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  conversationId: varchar("conversation_id").notNull().references(() => agentConversations.id, { onDelete: 'cascade' }),
  messageId: varchar("message_id").references(() => agentMessages.id, { onDelete: 'set null' }),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: 'cascade' }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  tool: varchar("tool", { length: 80 }).notNull(),
  userPrompt: text("user_prompt"), // originating user message text for audit
  args: jsonb("args").notNull().$type<Record<string, any>>(),
  previewDiff: jsonb("preview_diff").$type<Record<string, any>>(),
  status: varchar("status", { length: 20 }).notNull().default('proposed'), // proposed | applied | rejected | failed
  result: jsonb("result").$type<Record<string, any>>(),
  errorMessage: text("error_message"),
  appliedAt: timestamp("applied_at"),
  appliedBy: varchar("applied_by").references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
}, (table) => ({
  projectIdx: index("idx_agent_actions_project").on(table.projectId),
  conversationIdx: index("idx_agent_actions_conversation").on(table.conversationId),
  statusIdx: index("idx_agent_actions_status").on(table.status),
}));

export const insertAgentConversationSchema = createInsertSchema(agentConversations).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAgentConversation = z.infer<typeof insertAgentConversationSchema>;
export type AgentConversation = typeof agentConversations.$inferSelect;

export const insertAgentMessageSchema = createInsertSchema(agentMessages).omit({ id: true, createdAt: true }).extend({
  toolCalls: z.array(z.object({ id: z.string(), name: z.string(), args: z.any() })).nullable().optional(),
});
export type InsertAgentMessage = z.infer<typeof insertAgentMessageSchema>;
export type AgentMessage = typeof agentMessages.$inferSelect;

export const insertAgentActionSchema = createInsertSchema(agentActions).omit({ id: true, createdAt: true, appliedAt: true });
export type InsertAgentAction = z.infer<typeof insertAgentActionSchema>;
export type AgentAction = typeof agentActions.$inferSelect;

// ============================================================================
// GALAXY CLIENT PORTAL API
// ============================================================================
export * from "./galaxy-schema";

// ============================================================================
// GEMINI PAYROLL & WORKFORCE MANAGEMENT (Phase 1)
// All monetary amounts stored as integer cents to avoid floating-point drift.
// All payroll-relevant actions append to payroll_audit_log for SOC2 alignment.
// ============================================================================

export const payrollEmployeeTypeEnum = z.enum(['w2', '1099']);
export type PayrollEmployeeType = z.infer<typeof payrollEmployeeTypeEnum>;

export const payrollEmployeeStatusEnum = z.enum(['active', 'onboarding', 'terminated', 'on_leave']);
export type PayrollEmployeeStatus = z.infer<typeof payrollEmployeeStatusEnum>;

export const payrollCompTypeEnum = z.enum(['salary', 'hourly', 'commission', 'bonus']);
export type PayrollCompType = z.infer<typeof payrollCompTypeEnum>;

export const payrollScheduleFrequencyEnum = z.enum(['weekly', 'biweekly', 'semimonthly', 'monthly']);
export type PayrollScheduleFrequency = z.infer<typeof payrollScheduleFrequencyEnum>;

export const payrollRunStatusEnum = z.enum(['draft', 'previewed', 'approved', 'finalized', 'voided']);
export type PayrollRunStatus = z.infer<typeof payrollRunStatusEnum>;

export const payrollDeductionTypeEnum = z.enum(['pre_tax', 'post_tax', 'garnishment', 'employer_match']);
export type PayrollDeductionType = z.infer<typeof payrollDeductionTypeEnum>;

// Employees & contractors managed by the payroll module.
// Linked optionally to a platform user; tenant-scoped for isolation.
export const payrollEmployees = pgTable("payroll_employees", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  userId: varchar("user_id").references(() => users.id, { onDelete: 'set null' }),
  externalEmployeeNumber: varchar("external_employee_number", { length: 64 }),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: varchar("email", { length: 255 }).notNull(),
  employeeType: varchar("employee_type", { length: 16 }).notNull(), // w2 | 1099
  status: varchar("status", { length: 20 }).notNull().default('onboarding'),
  hireDate: date("hire_date"),
  terminationDate: date("termination_date"),
  // U.S. tax fields (stubbed; real PII would be tokenized in production)
  ssnLast4: varchar("ssn_last4", { length: 4 }),
  homeAddress: text("home_address"),
  homeCity: text("home_city"),
  homeStateCode: varchar("home_state_code", { length: 2 }),
  homeZip: varchar("home_zip", { length: 10 }),
  workStateCode: varchar("work_state_code", { length: 2 }),
  // W-4 inputs (post-2020 form)
  filingStatus: varchar("filing_status", { length: 20 }), // single | married_jointly | head_of_household
  w4MultipleJobs: boolean("w4_multiple_jobs").default(false),
  w4DependentsAmountCents: integer("w4_dependents_amount_cents").default(0),
  w4OtherIncomeCents: integer("w4_other_income_cents").default(0),
  w4DeductionsCents: integer("w4_deductions_cents").default(0),
  w4ExtraWithholdingCents: integer("w4_extra_withholding_cents").default(0),
  defaultPayScheduleId: varchar("default_pay_schedule_id"),
  // Direct deposit (for ACH/NACHA export). Production deployments must store
  // accountNumberEnc encrypted at rest — this column currently holds plain
  // text for the stubbed implementation. Routing is the 9-digit ABA number.
  bankRoutingNumber: varchar("bank_routing_number", { length: 9 }),
  // AES-256-GCM ciphertext envelope formatted as
  //   v1:<iv-b64(16)>:<tag-b64(24)>:<ciphertext-b64(...)>
  // New writes go through `encryptString` in server/services/crypto.ts and
  // fail closed when PAYROLL_ENCRYPTION_KEY is unset. Legacy rows that
  // pre-date encryption may still be plain text and round-trip as-is until
  // the next admin save, at which point they get encrypted. For a 17-digit
  // account number the envelope is ~70 characters; 256 chars leaves room
  // for longer account numbers and future version prefixes.
  bankAccountNumberEnc: varchar("bank_account_number_enc", { length: 256 }),
  bankAccountType: varchar("bank_account_type", { length: 16 }), // 'checking' | 'savings'
  // Owners-who-are-also-W-2-employees opt out of the FTE bonus pool.
  // Their distribution flows through entity_owners and the owner ACH file.
  isOwner: boolean("is_owner").notNull().default(false),
  // Soft delete for compliance
  deletedAt: timestamp("deleted_at"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
}, (t) => ({
  tenantIdx: index("idx_payroll_emp_tenant").on(t.tenantId),
  emailIdx: index("idx_payroll_emp_email").on(t.tenantId, t.email),
  userIdx: index("idx_payroll_emp_user").on(t.userId),
}));

export const insertPayrollEmployeeSchema = createInsertSchema(payrollEmployees).omit({
  id: true, createdAt: true, updatedAt: true, deletedAt: true,
});
export type InsertPayrollEmployee = z.infer<typeof insertPayrollEmployeeSchema>;
export type PayrollEmployee = typeof payrollEmployees.$inferSelect;

// Compensation history — immutable rows; effective-dated.
export const payrollCompensation = pgTable("payroll_compensation", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  employeeId: varchar("employee_id").notNull().references(() => payrollEmployees.id, { onDelete: 'cascade' }),
  compType: varchar("comp_type", { length: 20 }).notNull(), // salary | hourly | commission | bonus
  // For salary: annual amount. For hourly: per-hour rate. Commission/bonus: stored as paid amount.
  amountCents: integer("amount_cents").notNull(),
  hoursPerWeek: decimal("hours_per_week", { precision: 5, scale: 2 }), // for salary FTE conversion
  effectiveFrom: date("effective_from").notNull(),
  effectiveTo: date("effective_to"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
}, (t) => ({
  empIdx: index("idx_payroll_comp_emp").on(t.employeeId, t.effectiveFrom),
  tenantIdx: index("idx_payroll_comp_tenant").on(t.tenantId),
}));

export const insertPayrollCompensationSchema = createInsertSchema(payrollCompensation).omit({ id: true, createdAt: true });
export type InsertPayrollCompensation = z.infer<typeof insertPayrollCompensationSchema>;
export type PayrollCompensation = typeof payrollCompensation.$inferSelect;

// Per-tenant company info used to populate NACHA / ACH disbursement files.
// One row per tenant; created lazily when an admin first sets up direct deposit.
export const payrollAchOriginator = pgTable("payroll_ach_originator", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id, { onDelete: 'cascade' }).unique(),
  companyName: varchar("company_name", { length: 16 }).notNull(), // NACHA field is 16 chars
  companyId: varchar("company_id", { length: 10 }).notNull(), // EIN with leading 1, or DUNS
  originatingDfi: varchar("originating_dfi", { length: 8 }).notNull(), // 8-digit routing prefix
  immediateOriginName: varchar("immediate_origin_name", { length: 23 }).notNull(),
  immediateOrigin: varchar("immediate_origin", { length: 10 }).notNull(),
  immediateDestinationName: varchar("immediate_destination_name", { length: 23 }).notNull(),
  immediateDestination: varchar("immediate_destination", { length: 10 }).notNull(),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
});

export const insertPayrollAchOriginatorSchema = createInsertSchema(payrollAchOriginator).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPayrollAchOriginator = z.infer<typeof insertPayrollAchOriginatorSchema>;
export type PayrollAchOriginator = typeof payrollAchOriginator.$inferSelect;

// Pay schedules — define cadence, period boundaries, and pay date offset.
export const payrollPaySchedules = pgTable("payroll_pay_schedules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  name: text("name").notNull(),
  frequency: varchar("frequency", { length: 20 }).notNull(),
  // Anchor: first known period start to compute future periods deterministically.
  anchorPeriodStart: date("anchor_period_start").notNull(),
  // Days after period end when pay date occurs (e.g., 5 = pay 5 days after period close).
  payDateOffsetDays: integer("pay_date_offset_days").notNull().default(5),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
}, (t) => ({
  tenantIdx: index("idx_payroll_sched_tenant").on(t.tenantId),
}));

export const insertPayrollPayScheduleSchema = createInsertSchema(payrollPaySchedules).omit({ id: true, createdAt: true });
export type InsertPayrollPaySchedule = z.infer<typeof insertPayrollPayScheduleSchema>;
export type PayrollPaySchedule = typeof payrollPaySchedules.$inferSelect;

// Recurring deductions / benefits / garnishments (per employee).
export const payrollDeductions = pgTable("payroll_deductions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  employeeId: varchar("employee_id").notNull().references(() => payrollEmployees.id, { onDelete: 'cascade' }),
  name: text("name").notNull(), // e.g. "401(k)", "Health - Family"
  deductionType: varchar("deduction_type", { length: 20 }).notNull(),
  // Either amountCents (fixed) or percent of gross.
  amountCents: integer("amount_cents"),
  percentOfGross: decimal("percent_of_gross", { precision: 6, scale: 4 }),
  employerMatchCents: integer("employer_match_cents"),
  employerMatchPercent: decimal("employer_match_percent", { precision: 6, scale: 4 }),
  glAccountId: varchar("gl_account_id"),
  // Tax scope of the pre-tax deduction (only used when deductionType='pre_tax'):
  //   'all'           = Section 125 cafeteria (health/HSA/FSA) - exempt from
  //                     federal income tax AND FICA AND FUTA
  //   'federal_only'  = 401(k) traditional - exempt from federal income tax
  //                     only; FICA + FUTA still apply
  // Pre-existing rows are backfilled to 'all' (the engine's prior behaviour).
  preTaxScope: varchar("pre_tax_scope", { length: 20 }).default('federal_only'),
  effectiveFrom: date("effective_from").notNull(),
  effectiveTo: date("effective_to"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
}, (t) => ({
  empIdx: index("idx_payroll_ded_emp").on(t.employeeId),
  tenantIdx: index("idx_payroll_ded_tenant").on(t.tenantId),
}));

export const insertPayrollDeductionSchema = createInsertSchema(payrollDeductions).omit({ id: true, createdAt: true });
export type InsertPayrollDeduction = z.infer<typeof insertPayrollDeductionSchema>;
export type PayrollDeduction = typeof payrollDeductions.$inferSelect;

// PTO accrual & balances (lightweight per-employee bucket).
export const payrollPtoBalances = pgTable("payroll_pto_balances", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  employeeId: varchar("employee_id").notNull().references(() => payrollEmployees.id, { onDelete: 'cascade' }),
  policyName: text("policy_name").notNull().default('Vacation'),
  accrualHoursPerPeriod: decimal("accrual_hours_per_period", { precision: 6, scale: 2 }).notNull().default("0"),
  balanceHours: decimal("balance_hours", { precision: 8, scale: 2 }).notNull().default("0"),
  usedHoursYtd: decimal("used_hours_ytd", { precision: 8, scale: 2 }).notNull().default("0"),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
}, (t) => ({
  empIdx: uniqueIndex("uq_payroll_pto_emp_policy").on(t.employeeId, t.policyName),
}));

export const insertPayrollPtoBalanceSchema = createInsertSchema(payrollPtoBalances).omit({ id: true, updatedAt: true });
export type InsertPayrollPtoBalance = z.infer<typeof insertPayrollPtoBalanceSchema>;
export type PayrollPtoBalance = typeof payrollPtoBalances.$inferSelect;

// Tax jurisdictions — abstraction so federal / state / local rules are pluggable.
export const payrollTaxJurisdictions = pgTable("payroll_tax_jurisdictions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id, { onDelete: 'cascade' }), // null = platform-level
  code: varchar("code", { length: 32 }).notNull(), // 'US-FED' | 'US-CA' | 'US-NY-NYC'
  name: text("name").notNull(),
  level: varchar("level", { length: 20 }).notNull(), // federal | state | local
  // Rule definition — interpreted by payroll-engine. Supports flat_percent | brackets | none | todo.
  rule: jsonb("rule").$type<Record<string, any>>().notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
}, (t) => ({
  codeIdx: uniqueIndex("uq_payroll_jur_tenant_code").on(t.tenantId, t.code),
}));

export const insertPayrollTaxJurisdictionSchema = createInsertSchema(payrollTaxJurisdictions).omit({ id: true, createdAt: true });
export type InsertPayrollTaxJurisdiction = z.infer<typeof insertPayrollTaxJurisdictionSchema>;
export type PayrollTaxJurisdiction = typeof payrollTaxJurisdictions.$inferSelect;

// Payroll runs — immutable once finalized.
export const payrollRuns = pgTable("payroll_runs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  payScheduleId: varchar("pay_schedule_id").references(() => payrollPaySchedules.id, { onDelete: 'restrict' }),
  periodStart: date("period_start").notNull(),
  periodEnd: date("period_end").notNull(),
  payDate: date("pay_date").notNull(),
  // 'regular' (default), 'bonus' (off-cycle), or 'reversal' (unwinds a prior
  // finalized run; amounts on items are negative). Reversal runs link to the
  // run they undo via `reverses_run_id` so the YTD calc can pick them up.
  runType: varchar("run_type", { length: 16 }).notNull().default('regular'),
  reversesRunId: varchar("reverses_run_id"),
  status: varchar("status", { length: 20 }).notNull().default('draft'),
  // Totals (cached for reporting; recomputed from items on preview).
  totalGrossCents: integer("total_gross_cents").notNull().default(0),
  totalEmployeeTaxCents: integer("total_employee_tax_cents").notNull().default(0),
  totalEmployerTaxCents: integer("total_employer_tax_cents").notNull().default(0),
  totalDeductionsCents: integer("total_deductions_cents").notNull().default(0),
  totalNetCents: integer("total_net_cents").notNull().default(0),
  // Idempotency: client-supplied key prevents duplicate run creation.
  idempotencyKey: varchar("idempotency_key", { length: 128 }),
  createdBy: varchar("created_by").references(() => users.id),
  approvedBy: varchar("approved_by").references(() => users.id),
  approvedAt: timestamp("approved_at"),
  finalizedAt: timestamp("finalized_at"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
}, (t) => ({
  tenantIdx: index("idx_payroll_run_tenant").on(t.tenantId, t.payDate),
  idempotencyIdx: uniqueIndex("uq_payroll_run_idem").on(t.tenantId, t.idempotencyKey),
}));

export const insertPayrollRunSchema = createInsertSchema(payrollRuns).omit({
  id: true, createdAt: true, approvedAt: true, finalizedAt: true,
  totalGrossCents: true, totalEmployeeTaxCents: true, totalEmployerTaxCents: true,
  totalDeductionsCents: true, totalNetCents: true,
});
export type InsertPayrollRun = z.infer<typeof insertPayrollRunSchema>;
export type PayrollRun = typeof payrollRuns.$inferSelect;

// One row per (run, employee) — immutable after finalize.
export const payrollRunItems = pgTable("payroll_run_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  runId: varchar("run_id").notNull().references(() => payrollRuns.id, { onDelete: 'cascade' }),
  employeeId: varchar("employee_id").notNull().references(() => payrollEmployees.id, { onDelete: 'restrict' }),
  // Inputs
  hoursWorked: decimal("hours_worked", { precision: 8, scale: 2 }).default("0"),
  overtimeHours: decimal("overtime_hours", { precision: 8, scale: 2 }).default("0"),
  ptoHoursUsed: decimal("pto_hours_used", { precision: 8, scale: 2 }).default("0"),
  bonusCents: integer("bonus_cents").notNull().default(0),
  commissionCents: integer("commission_cents").notNull().default(0),
  retroPayCents: integer("retro_pay_cents").notNull().default(0),
  // Computed
  grossCents: integer("gross_cents").notNull().default(0),
  employeeTaxCents: integer("employee_tax_cents").notNull().default(0),
  employerTaxCents: integer("employer_tax_cents").notNull().default(0),
  preTaxDeductionCents: integer("pre_tax_deduction_cents").notNull().default(0),
  postTaxDeductionCents: integer("post_tax_deduction_cents").notNull().default(0),
  // Wages subject to FICA / FUTA this period (gross minus Section 125 only,
  // because 401(k) traditional deferrals are still FICA-taxable). Persisted
  // so YTD caps + Form 941 line 5c + W-2 Box 5 don't have to re-derive it
  // from preTaxDeductionCents (which mixes both scopes).
  ficaTaxableWagesCents: integer("fica_taxable_wages_cents").notNull().default(0),
  // Constellation expense reimbursements rolled into this run item. Added
  // to net pay AFTER tax math (accountable-plan, non-taxable). Not part of
  // grossCents and never reported on the W-2 / 941 totals.
  reimbursementCents: integer("reimbursement_cents").notNull().default(0),
  netPayCents: integer("net_pay_cents").notNull().default(0),
  // Detailed breakdown for audit (lines).
  breakdown: jsonb("breakdown").$type<Record<string, any>>(),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
}, (t) => ({
  runIdx: index("idx_payroll_run_item_run").on(t.runId),
  empIdx: index("idx_payroll_run_item_emp").on(t.employeeId),
  uniq: uniqueIndex("uq_payroll_run_item").on(t.runId, t.employeeId),
}));

export const insertPayrollRunItemSchema = createInsertSchema(payrollRunItems).omit({ id: true, createdAt: true });
export type InsertPayrollRunItem = z.infer<typeof insertPayrollRunItemSchema>;
export type PayrollRunItem = typeof payrollRunItems.$inferSelect;

// Per-expense itemization for reimbursements bundled into a payroll run item.
// One row per Constellation expense rolled in. Lets the paystub itemize what
// makes up the reimbursement total and supports auditor reconciliation back
// to specific receipts.
export const payrollReimbursementLines = pgTable("payroll_reimbursement_lines", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  runItemId: varchar("run_item_id").notNull().references(() => payrollRunItems.id, { onDelete: 'cascade' }),
  // Restrict on delete so an in-flight payroll reimbursement can't be
  // orphaned by deleting the underlying expense — finalize is the only
  // path that removes the link (by clearing payrollRunItemId on the
  // expense, not by deleting the line itself).
  expenseId: varchar("expense_id").notNull().references(() => expenses.id, { onDelete: 'restrict' }),
  amountCents: integer("amount_cents").notNull(),
  category: text("category").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
}, (t) => ({
  runItemIdx: index("idx_payroll_reim_lines_run_item").on(t.runItemId),
  expenseIdx: index("idx_payroll_reim_lines_expense").on(t.expenseId),
}));

export const insertPayrollReimbursementLineSchema = createInsertSchema(payrollReimbursementLines).omit({ id: true, createdAt: true });
export type InsertPayrollReimbursementLine = z.infer<typeof insertPayrollReimbursementLineSchema>;
export type PayrollReimbursementLine = typeof payrollReimbursementLines.$inferSelect;

// GL accounts & mappings — drive accounting export (CSV/JSON).
export const payrollGlAccounts = pgTable("payroll_gl_accounts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  accountNumber: varchar("account_number", { length: 32 }).notNull(),
  accountName: text("account_name").notNull(),
  accountType: varchar("account_type", { length: 32 }).notNull(), // expense | liability | asset
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
}, (t) => ({
  uniq: uniqueIndex("uq_payroll_gl_acct").on(t.tenantId, t.accountNumber),
}));

export const insertPayrollGlAccountSchema = createInsertSchema(payrollGlAccounts).omit({ id: true, createdAt: true });
export type InsertPayrollGlAccount = z.infer<typeof insertPayrollGlAccountSchema>;
export type PayrollGlAccount = typeof payrollGlAccounts.$inferSelect;

export const payrollGlMappings = pgTable("payroll_gl_mappings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  // Category being mapped: 'wages' | 'employer_tax' | 'employee_tax_liability' | 'pre_tax_deduction' | 'post_tax_deduction' | 'garnishment_liability' | 'net_pay_clearing'
  category: varchar("category", { length: 64 }).notNull(),
  glAccountId: varchar("gl_account_id").notNull().references(() => payrollGlAccounts.id, { onDelete: 'restrict' }),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
}, (t) => ({
  uniq: uniqueIndex("uq_payroll_gl_map").on(t.tenantId, t.category),
}));

export const insertPayrollGlMappingSchema = createInsertSchema(payrollGlMappings).omit({ id: true, createdAt: true });
export type InsertPayrollGlMapping = z.infer<typeof insertPayrollGlMappingSchema>;
export type PayrollGlMapping = typeof payrollGlMappings.$inferSelect;

// Append-only audit log of payroll-relevant actions.
export const payrollAuditLog = pgTable("payroll_audit_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  actorUserId: varchar("actor_user_id").references(() => users.id),
  action: varchar("action", { length: 64 }).notNull(),
  entityType: varchar("entity_type", { length: 64 }).notNull(),
  entityId: varchar("entity_id", { length: 128 }),
  details: jsonb("details").$type<Record<string, any>>(),
  ipAddress: varchar("ip_address", { length: 64 }),
  occurredAt: timestamp("occurred_at").notNull().default(sql`now()`),
}, (t) => ({
  tenantIdx: index("idx_payroll_audit_tenant").on(t.tenantId, t.occurredAt),
  entityIdx: index("idx_payroll_audit_entity").on(t.entityType, t.entityId),
}));

export const insertPayrollAuditLogSchema = createInsertSchema(payrollAuditLog).omit({ id: true, occurredAt: true });
export type InsertPayrollAuditLog = z.infer<typeof insertPayrollAuditLogSchema>;
export type PayrollAuditLog = typeof payrollAuditLog.$inferSelect;

// -------------------------------------------------------------------------
// Quarterly profit distribution (owners + FTE bonus pool).
// See docs/design/quarterly-profit-distribution.md.
// -------------------------------------------------------------------------

// Who shares in the owner pool. A single user can be an owner of multiple
// tenants (multi-tenant model); ownership_pct is per-tenant. Effective-dated
// so an ownership change doesn't rewrite history. Active rows have
// effective_to = NULL — one per (tenant, user) at a time.
export const entityOwners = pgTable("entity_owners", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'restrict' }),
  ownershipPct: decimal("ownership_pct", { precision: 7, scale: 4 }).notNull(),
  effectiveFrom: date("effective_from").notNull(),
  effectiveTo: date("effective_to"),
  distributionMethod: varchar("distribution_method", { length: 16 }).notNull().default('k1'),
  // Bank account for the non-payroll owner ACH file. Same encryption envelope
  // as payroll_employees.bank_account_number_enc.
  bankRoutingNumber: varchar("bank_routing_number", { length: 9 }),
  bankAccountNumberEnc: varchar("bank_account_number_enc", { length: 256 }),
  bankAccountType: varchar("bank_account_type", { length: 16 }),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
}, (t) => ({
  tenantIdx: index("idx_entity_owners_tenant").on(t.tenantId, t.effectiveFrom),
  // Mirror the partial unique index in migration 0024 so Drizzle sees the
  // same constraint as Postgres: at most one active (effective_to IS NULL)
  // owner row per (tenant, user). Prevents accidental duplicate active
  // owners from sneaking past app-layer checks.
  activePerUser: uniqueIndex("uq_entity_owners_active_per_user")
    .on(t.tenantId, t.userId)
    .where(sql`${t.effectiveTo} IS NULL`),
}));

export const insertEntityOwnerSchema = createInsertSchema(entityOwners).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type InsertEntityOwner = z.infer<typeof insertEntityOwnerSchema>;
export type EntityOwner = typeof entityOwners.$inferSelect;

// Per-tenant policy: pool split, reserves, FTE pool weighting.
export const distributionPolicy = pgTable("distribution_policy", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id, { onDelete: 'cascade' }).unique(),
  ownerPoolPct: decimal("owner_pool_pct", { precision: 7, scale: 4 }).notNull().default("70.0000"),
  ftePoolPct: decimal("fte_pool_pct", { precision: 7, scale: 4 }).notNull().default("30.0000"),
  taxReservePct: decimal("tax_reserve_pct", { precision: 7, scale: 4 }).notNull().default("25.0000"),
  operatingReserveMonths: decimal("operating_reserve_months", { precision: 5, scale: 2 }).notNull().default("3.00"),
  waBoRatePct: decimal("wa_bo_rate_pct", { precision: 7, scale: 4 }).notNull().default("0.0000"),
  fteWeights: jsonb("fte_weights").$type<{ salary: number; tenure: number; performance: number; hours: number }>()
    .notNull().default(sql`'{"salary":60,"tenure":10,"performance":20,"hours":10}'::jsonb`),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
});

export const insertDistributionPolicySchema = createInsertSchema(distributionPolicy).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type InsertDistributionPolicy = z.infer<typeof insertDistributionPolicySchema>;
export type DistributionPolicy = typeof distributionPolicy.$inferSelect;

// One row per quarterly run. Immutable once finalized.
export const distributionRuns = pgTable("distribution_runs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  quarterLabel: varchar("quarter_label", { length: 7 }).notNull(), // '2026-Q3'
  periodStart: date("period_start").notNull(),
  periodEnd: date("period_end").notNull(),
  status: varchar("status", { length: 20 }).notNull().default('draft'),
  // Funds breakdown captured at preview time so audit survives policy edits.
  availableFundsCents: integer("available_funds_cents").notNull().default(0),
  revenueCollectedCents: integer("revenue_collected_cents").notNull().default(0),
  operatingExpenseCents: integer("operating_expense_cents").notNull().default(0),
  payrollBurdenCents: integer("payroll_burden_cents").notNull().default(0),
  taxReserveCents: integer("tax_reserve_cents").notNull().default(0),
  operatingReserveCents: integer("operating_reserve_cents").notNull().default(0),
  waBoAccrualCents: integer("wa_bo_accrual_cents").notNull().default(0),
  ownerPoolCents: integer("owner_pool_cents").notNull().default(0),
  ftePoolCents: integer("fte_pool_cents").notNull().default(0),
  policySnapshot: jsonb("policy_snapshot").$type<Record<string, any>>(),
  ftePayrollRunId: varchar("fte_payroll_run_id").references(() => payrollRuns.id, { onDelete: 'set null' }),
  reversesRunId: varchar("reverses_run_id"),
  // Preview warnings persisted on the run so the UI surfaces the same
  // diagnostics that were visible at preview time, even after a refresh
  // or once the run has moved past 'previewed'.
  warnings: jsonb("warnings").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  // NACHA effective date (yymmdd) captured at finalize so the download
  // endpoint regenerates a byte-identical file every time it's served.
  // The owner ACH content is never stored in the DB — bank accounts stay
  // encrypted at rest in entity_owners; we re-decrypt on download.
  nachaEffectiveDate: varchar("nacha_effective_date", { length: 6 }),
  createdBy: varchar("created_by").references(() => users.id),
  approvedBy: varchar("approved_by").references(() => users.id),
  approvedAt: timestamp("approved_at"),
  finalizedAt: timestamp("finalized_at"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
}, (t) => ({
  tenantIdx: index("idx_distribution_runs_tenant").on(t.tenantId, t.periodEnd),
  // Mirror the partial unique index in migration 0024: only one live
  // (non-reversed, non-draft) run per quarter. Drafts are excluded so the
  // idempotent create endpoint can return an existing draft instead of
  // 409; reversed runs are excluded so a corrected run can be created
  // after an unwind.
  liveQuarter: uniqueIndex("uq_distribution_runs_finalized_quarter")
    .on(t.tenantId, t.quarterLabel)
    .where(sql`status IN ('previewed','approved','finalized')`),
}));

export const insertDistributionRunSchema = createInsertSchema(distributionRuns).omit({
  id: true, createdAt: true, approvedAt: true, finalizedAt: true,
  // `warnings` defaults to '[]' at the DB level. Omitted from the insert
  // schema so callers don't have to pass it (and so drizzle-zod's tuple
  // inference for $type<string[]>() doesn't fight the underlying
  // Drizzle insert type).
  warnings: true,
});
export type InsertDistributionRun = z.infer<typeof insertDistributionRunSchema>;
export type DistributionRun = typeof distributionRuns.$inferSelect;

// Per-recipient line within a run.
export const distributionLines = pgTable("distribution_lines", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  runId: varchar("run_id").notNull().references(() => distributionRuns.id, { onDelete: 'cascade' }),
  recipientUserId: varchar("recipient_user_id").notNull().references(() => users.id, { onDelete: 'restrict' }),
  recipientType: varchar("recipient_type", { length: 16 }).notNull(), // 'owner' | 'fte'
  amountCents: integer("amount_cents").notNull().default(0),
  weight: decimal("weight", { precision: 14, scale: 6 }).notNull().default("0"),
  payoutMethod: varchar("payout_method", { length: 20 }).notNull(),
  payrollRunItemId: varchar("payroll_run_item_id").references(() => payrollRunItems.id, { onDelete: 'set null' }),
  achTraceNumber: varchar("ach_trace_number", { length: 15 }),
  status: varchar("status", { length: 16 }).notNull().default('pending'),
  breakdown: jsonb("breakdown").$type<Record<string, any>>(),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
}, (t) => ({
  runIdx: index("idx_distribution_lines_run").on(t.runId),
  recipientIdx: index("idx_distribution_lines_recipient").on(t.tenantId, t.recipientUserId),
}));

export const insertDistributionLineSchema = createInsertSchema(distributionLines).omit({
  id: true, createdAt: true,
});
export type InsertDistributionLine = z.infer<typeof insertDistributionLineSchema>;
export type DistributionLine = typeof distributionLines.$inferSelect;
