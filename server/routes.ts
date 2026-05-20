import * as fsNode from "fs";
import * as pathNode from "path";
import * as osNode from "os";
import { execSync } from "child_process";
import type { Express, Request, Response, NextFunction } from "express";
import { storage, db, generateSubSOWPdf } from "./storage";
import { insertUserSchema, insertClientSchema, insertProjectSchema, insertRoleSchema, insertEstimateSchema, insertTimeEntrySchema, insertExpenseSchema, insertChangeOrderSchema, insertSowSchema, insertUserRateScheduleSchema, insertProjectRateOverrideSchema, insertSystemSettingSchema, insertInvoiceAdjustmentSchema, insertProjectMilestoneSchema, insertProjectAllocationSchema, updateInvoicePaymentSchema, vocabularyTermsSchema, updateOrganizationVocabularySchema, insertExpenseReportSchema, insertReimbursementBatchSchema, sows, timeEntries, expenses, users, projects, clients, projectMilestones, invoiceBatches, invoiceLines, projectAllocations, projectWorkstreams, projectEpics, projectStages, roles, estimateLineItems, estimateEpics, estimateStages, estimateActivities, expenseReports, reimbursementBatches, pendingReceipts, estimates, tenants, airportCodes, expenseAttachments, insertRaiddEntrySchema, raiddEntries, insertGroundingDocumentSchema, groundingDocCategoryEnum, GROUNDING_DOC_CATEGORY_LABELS, insertSupportTicketSchema, TICKET_CATEGORIES, TICKET_PRIORITIES, TICKET_STATUSES, supportTickets, supportTicketReplies, tenantUsers, projectChannels, projectBaselines, servicePlans, blockedDomains, pageViews } from "@shared/schema";
import { isPublicEmailDomain } from "@shared/publicDomains";
import { projectFiltersSchema } from "@shared/pagination";
import { eq, sql, inArray, max, and, gte, lte, isNull, desc, or } from "drizzle-orm";
import { z } from "zod";
import { fileTypeFromBuffer } from "file-type";
import rateLimit from "express-rate-limit";
import multer from "multer";
import { receiptStorage } from "./services/receipt-storage.js";
import { LocalFileStorage } from "./services/local-file-storage.js";
import { SharePointFileStorage } from "./services/sharepoint-file-storage.js";
import { emailService } from "./services/email-notification.js";
import { sharepointStorage, initSharePointStorage } from "./services/sharepoint-storage.js";
import { registerPlatformRoutes, enforcePlanStatus } from "./routes/platform.js";
import { registerSharePointContainerRoutes } from "./routes/sharepoint-containers.js";
import { registerExpenseRoutes } from "./routes/expenses.js";
import { registerEstimateRoutes, generateRetainerPaymentMilestones } from "./routes/estimates.js";
import { registerInvoiceRoutes } from "./routes/invoices.js";
import { registerHubSpotRoutes } from "./routes/hubspot.js";
import { registerTenantStorageRoutes } from "./routes/tenant-storage.js";
import { registerMcpRoutes } from "./routes/mcp.js";
import { registerMcpWriteRoutes } from "./routes/mcp-write.js";
import { registerA2ARoutes } from "./routes/a2a.js";
import { registerTeamsAppRoutes } from "./routes/teams-app.js";
import { createHubSpotDealNote, createHubSpotCompanyNote, getLinkedHubSpotCompanyId, isHubSpotConnected } from "./services/hubspot-client.js";
import { invalidateProviderCache, ReplitAIProvider, AzureFoundryProvider } from "./services/ai-provider.js";
import { AI_PROVIDERS, AI_FEATURES, AI_MODELS, AI_MODEL_INFO, insertAiConfigurationSchema } from "@shared/schema";
import { registerUserRoutes } from "./routes/users.js";
import { registerTenantRoutes } from "./routes/tenant.js";
import { registerReportsRoutes } from "./routes/reports.js";
import { registerPlannerRoutes } from "./routes/planner.js";
import { registerTeamsAutomationRoutes } from "./routes/teams-automation.js";
import { registerClientRoutes } from "./routes/clients.js";
import { registerTimeEntryRoutes } from "./routes/time-entries.js";
import { registerAiRoutes } from "./routes/ai.js";
import { registerProjectAgentRoutes } from "./routes/project-agent.js";
import { registerRaiddRoutes } from "./routes/raidd.js";
import { registerResourcePlanningRoutes } from "./routes/resource-planning.js";
import { registerSupportRoutes } from "./routes/support.js";
import { registerCopilotStudioRoutes } from "./routes/copilot-studio.js";
import { registerCalendarSuggestionsRoutes } from "./routes/calendar-suggestions.js";
import { registerJobRoutes } from "./routes/jobs.js";
import { registerNotificationRoutes } from "./routes/notifications.js";
import { registerPayrollRoutes } from "./routes/payroll.js";
import { registerDistributionRoutes } from "./routes/distribution.js";
import { registerWebhookRoutes } from "./routes/webhooks.js";
import { registerEmbedRoutes } from "./routes/embed.js";
import { registerSearchRoutes } from "./routes/search.js";
import { registerGalaxyV1Routes } from "./routes/galaxy/v1/index.js";
import { enqueueGalaxyEvent } from "./services/galaxy-webhook-delivery.js";

// Initialize SharePoint storage with database access
initSharePointStorage(storage);

function resolveChangelogPath(): string {
  try {
    const candidates = [
      pathNode.join(process.cwd(), "client", "public", "docs", "CHANGELOG.md"),
      pathNode.join(process.cwd(), "dist", "public", "docs", "CHANGELOG.md"),
      pathNode.join(process.cwd(), "docs", "CHANGELOG.md"),
    ];
    for (const p of candidates) {
      if (fsNode.existsSync(p)) return p;
    }
    return candidates[0];
  } catch {
    return "client/public/docs/CHANGELOG.md";
  }
}

function readChangelogContent(): string {
  try {
    const changelogPath = resolveChangelogPath();
    return fsNode.readFileSync(changelogPath, "utf-8");
  } catch {
    return "";
  }
}

// SharePoint functionality restored - using real GraphClient implementation

// SharePoint/Container validation schemas moved to server/routes/sharepoint-containers.ts

// Azure/SharePoint imports
import { msalInstance, authCodeRequest, tokenRequest } from "./auth/entra-config";
import { graphClient } from "./services/graph-client.js";
import type { InsertPendingReceipt } from "@shared/schema";
import { toPendingReceiptInsert, toDateString, toDecimalString, toExpenseInsert } from "./utils/storageMappers.js";
import { localFileStorage, type DocumentMetadata } from "./services/local-file-storage.js";
import { invoicePDFStorage } from "./services/invoice-pdf-storage.js";

// User type is now defined in session-store.ts with SSO properties


// Import auth module and shared session store
import { registerAuthRoutes } from "./auth-routes";
import { requireAuth, requireRole, requirePlatformAdmin, getAllSessions } from "./session-store";
import { checkAndRefreshToken, handleTokenRefresh, startTokenRefreshScheduler } from "./auth/sso-token-refresh";

// ─── A2A Agent Card ──────────────────────────────────────────────────────────
// Public discovery endpoint — no auth required.
// Spec: https://google.github.io/A2A/specification/#agent-card
// Skills and static metadata live in server/a2a/agent-card-data.ts (single
// source of truth). The static file at client/public/.well-known/agent.json
// is the production-URL snapshot — regenerate it with:
//   npx tsx scripts/gen-agent-card.ts
import { buildAgentCard } from "./a2a/agent-card-data.js";

export async function registerRoutes(app: Express): Promise<void> {
  // ── /.well-known/agent.json — A2A discovery (public, no auth) ──
  app.get("/.well-known/agent.json", (_req: Request, res: Response) => {
    const baseUrl =
      process.env.BASE_URL ||
      process.env.REPLIT_DEV_DOMAIN && `https://${process.env.REPLIT_DEV_DOMAIN}` ||
      "https://constellation.synozur.com";
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.json(buildAgentCard(baseUrl));
  });

  // Seed changelog version from CHANGELOG.md (non-blocking, non-critical)
  (async () => {
    try {
      const existing = await storage.getSystemSettingValue("CURRENT_CHANGELOG_VERSION", "");
      const content = readChangelogContent();
      if (!content) return;
      const match = content.match(/###\s+Version\s+([\d.]+)/);
      const fileVersion = match ? match[1] : "";
      if (fileVersion && fileVersion !== existing) {
        await storage.setSystemSetting(
          "CURRENT_CHANGELOG_VERSION",
          fileVersion,
          `Auto-detected from CHANGELOG.md at startup`,
          "string"
        );
        console.log(`[CHANGELOG] Seeded CURRENT_CHANGELOG_VERSION: ${fileVersion}`);
      }
    } catch (err: any) {
      console.error("[CHANGELOG] Failed to seed changelog version:", err.message);
    }
  })();

  // Register authentication routes first
  registerAuthRoutes(app);
  
  // Register platform admin routes
  registerPlatformRoutes(app, requireAuth);

  // Apply plan enforcement middleware globally for all subsequent API routes
  app.use("/api", enforcePlanStatus);
  
  // Start SSO token refresh scheduler
  startTokenRefreshScheduler();
  
  // Sessions are now managed in the shared session-store module

  // Check if Entra ID is configured  
  const isEntraConfigured = !!msalInstance;

  // SharePoint configuration
  const getSharePointConfig = async () => {
    try {
      const { getSharePointContainerConfig } = await import('./auth/entra-config.js');
      const containerConfig = getSharePointContainerConfig();

      let containerId = '';

      const isProduction = process.env.REPLIT_DEPLOYMENT === '1' || process.env.NODE_ENV === 'production';
      try {
        const { tenants } = await import('@shared/schema.js');
        const { eq } = await import('drizzle-orm');
        const { db } = await import('./db.js');
        const speEnabledTenants = await db.select({
          speContainerIdDev: tenants.speContainerIdDev,
          speContainerIdProd: tenants.speContainerIdProd,
          speStorageEnabled: tenants.speStorageEnabled,
        }).from(tenants).where(eq(tenants.speStorageEnabled, true));

        if (speEnabledTenants.length >= 1) {
          const t = speEnabledTenants[0];
          const tenantContainer = isProduction ? t.speContainerIdProd : t.speContainerIdDev;
          if (tenantContainer) {
            containerId = tenantContainer;
          }
        }
      } catch (dbErr) {
        console.warn('[getSharePointConfig] Failed to look up tenant SPE config:', dbErr instanceof Error ? dbErr.message : dbErr);
      }

      if (!containerId) {
        containerId = await storage.getSystemSettingValue('SHAREPOINT_CONTAINER_ID') || containerConfig.containerId || '';
      }

      if (!containerId) {
        containerId = await storage.getSystemSettingValue('SHAREPOINT_DRIVE_ID') || process.env.SHAREPOINT_DRIVE_ID || '';
      }

      const legacySiteId = await storage.getSystemSettingValue('SHAREPOINT_SITE_ID') || process.env.SHAREPOINT_SITE_ID;

      return {
        containerId,
        containerTypeId: containerConfig.containerTypeId,
        environment: containerConfig.environment,
        containerName: containerConfig.containerName,
        siteId: legacySiteId || 'legacy-not-used',
        driveId: containerId,
        configured: !!containerId
      };
    } catch (error) {
      let containerId = process.env.SHAREPOINT_CONTAINER_ID;

      if (!containerId) {
        containerId = process.env.SHAREPOINT_DRIVE_ID;
      }

      return {
        containerId,
        siteId: process.env.SHAREPOINT_SITE_ID || 'legacy-not-used',
        driveId: containerId,
        configured: !!containerId
      };
    }
  };

  // Register SharePoint + Container routes (extracted module)
  registerSharePointContainerRoutes(app, {
    requireAuth,
    requireRole,
    isEntraConfigured,
    getSharePointConfig,
  });

  // File storage instances used by remaining routes (SOW uploads)
  const sharePointFileStorage = new SharePointFileStorage();
  const localFileStorageInstance = new LocalFileStorage();
  const isProductionEnv = process.env.REPLIT_DEPLOYMENT === '1' || process.env.NODE_ENV === 'production';
  const smartFileStorage = {
    async isSpeEnabledForTenant(tenantId?: string): Promise<boolean> {
      if (!tenantId) return false;
      try {
        const speConfig = await storage.getTenantSpeConfig(tenantId);
        return speConfig?.speStorageEnabled === true;
      } catch { return false; }
    },
    async storeFile(
      buffer: Buffer, originalName: string, contentType: string,
      metadata: DocumentMetadata, uploadedBy: string, fileId?: string, tenantId?: string
    ) {
      const documentType = metadata.documentType;
      const speEnabled = await this.isSpeEnabledForTenant(tenantId);

      if (documentType === 'receipt' && !speEnabled) {
        const storedReceipt = await receiptStorage.storeReceipt(buffer, originalName, contentType, {
          documentType: 'receipt', projectId: metadata.projectId, effectiveDate: metadata.effectiveDate,
          amount: metadata.amount, tags: metadata.tags, createdByUserId: metadata.createdByUserId,
          metadataVersion: metadata.metadataVersion || 1
        });
        return {
          id: storedReceipt.fileId, fileName: storedReceipt.fileName, originalName: storedReceipt.originalName,
          size: storedReceipt.size, contentType: storedReceipt.contentType, filePath: storedReceipt.fileId,
          metadata: { ...storedReceipt.metadata, driveId: 'receipt-storage',
            tags: storedReceipt.metadata.tags ? `${storedReceipt.metadata.tags},RECEIPT_STORAGE` : 'RECEIPT_STORAGE' },
          uploadedAt: new Date(), uploadedBy: uploadedBy
        };
      }
      const businessDocTypes = ['invoice', 'contract', 'receipt'];
      const useLocalStorage = !isProductionEnv && !speEnabled && businessDocTypes.includes(documentType);
      if (useLocalStorage) {
        const result = await localFileStorageInstance.storeFile(buffer, originalName, contentType, metadata, uploadedBy, fileId);
        return { ...result, metadata: { ...result.metadata, tags: result.metadata.tags ? `${result.metadata.tags},LOCAL_STORAGE` : 'LOCAL_STORAGE' } };
      }
      const result = await sharePointFileStorage.storeFile(buffer, originalName, contentType, metadata, uploadedBy, fileId, tenantId);
      return { ...result, metadata: { ...result.metadata, tags: result.metadata.tags ? `${result.metadata.tags},SHAREPOINT_STORAGE` : 'SHAREPOINT_STORAGE' } };
    },
    async getFileContent(fileId: string, tenantId?: string) {
      try { const buffer = await receiptStorage.getReceipt(fileId); return { buffer, metadata: {} }; }
      catch { try { return await localFileStorageInstance.getFileContent(fileId); }
      catch { return await sharePointFileStorage.getFileContent(fileId, tenantId); } }
    },
    async downloadFileDirect(fileId: string, tenantId?: string): Promise<{ buffer: Buffer; fileName: string; mimeType: string } | null> {
      try {
        const buffer = await receiptStorage.getReceipt(fileId);
        return { buffer, fileName: fileId, mimeType: 'application/octet-stream' };
      } catch { /* not in receipt storage */ }
      try {
        const local = await localFileStorageInstance.getFileContent(fileId);
        if (local?.buffer) {
          const meta = local.metadata || {} as any;
          return { buffer: local.buffer, fileName: meta.originalName || meta.fileName || fileId, mimeType: meta.contentType || 'application/octet-stream' };
        }
      } catch { /* not in local storage */ }
      try {
        const { containerId, azureTenantId } = await sharePointFileStorage.getContainerForTenant(tenantId);
        if (!containerId) return null;
        const client = sharePointFileStorage.resolveGraphClient(azureTenantId);
        const result = await client.downloadFile(containerId, fileId);
        return { buffer: result.buffer, fileName: result.fileName, mimeType: result.mimeType };
      } catch (error) {
        console.error(`[SMART_STORAGE] downloadFileDirect failed for ${fileId}:`, error instanceof Error ? error.message : error);
        return null;
      }
    },
  };

  // Register expense routes (extracted module)
  registerExpenseRoutes(app, {
    requireAuth,
    requireRole,
    smartFileStorage,
  });

  // Estimate routes intentionally unregistered — Estimates module removed from product surface.
  // The route file (server/routes/estimates.ts) is retained only because it exports
  // `generateRetainerPaymentMilestones` used by projects routes.

  registerInvoiceRoutes(app, {
    requireAuth,
    requireRole,
    downloadFileDirect: smartFileStorage.downloadFileDirect.bind(smartFileStorage),
  });

  // Register HubSpot CRM routes (extracted module)
  registerHubSpotRoutes(app, {
    requireAuth,
    requireRole,
  });

  // Register tenant SPE storage routes
  registerTenantStorageRoutes(app, {
    requireAuth,
    requireRole,
  });

  registerMcpRoutes(app, {
    requireAuth,
    requireRole,
  });

  registerCopilotStudioRoutes(app, {
    requireAuth,
    requireRole,
  });

  registerCalendarSuggestionsRoutes(app, { requireAuth });

  // MCP v1 write endpoints — Copilot agent write activities (gated by
  // MCP_WRITES_ENABLED feature flag). See docs/MCP_CONNECTOR_SETUP.md.
  registerMcpWriteRoutes(app, {
    requireAuth,
    requireRole,
  });

  // A2A task lifecycle endpoints — full agent-to-agent protocol support.
  // POST /a2a/tasks/send  — accept A2A Message, dispatch tool, return Task
  // GET  /a2a/tasks/get   — retrieve stored task by id
  // Auth: Bearer (Azure AD JWT) via mcpBearerAuth (same as MCP endpoints).
  registerA2ARoutes(app);

  registerTeamsAppRoutes(app, {
    requireAuth,
    requireRole,
  });

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { 
      fileSize: 50 * 1024 * 1024
    },
    fileFilter: (req: any, file: any, cb: any) => {
      const allowedMimeTypes = [
        'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp',
        'application/pdf', 
        'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'text/plain', 'text/csv'
      ];
      
      if (allowedMimeTypes.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new Error(`File type ${file.mimetype} not allowed`));
      }
    }
  });

  // Serve files from object storage (public directory)
  app.get("/object-storage/*", async (req, res) => {
    try {
      const objectPath = (req.params as any)[0] as string;
      
      // Security: only allow access to public directory
      if (!objectPath.startsWith('public/')) {
        return res.status(403).json({ message: "Access denied" });
      }
      
      const publicObjectDir = process.env.PUBLIC_OBJECT_SEARCH_PATHS;
      if (!publicObjectDir) {
        return res.status(500).json({ message: "Object storage not configured" });
      }
      
      const firstPath = publicObjectDir.split(',')[0].trim();
      const pathParts = firstPath.split('/').filter((p: string) => p);
      const bucketName = pathParts[0];
      
      const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";
      
      // Initialize GCS client with Replit sidecar credentials
      const { Storage } = await import('@google-cloud/storage');
      const objectStorageClient = new Storage({
        credentials: {
          audience: "replit",
          subject_token_type: "access_token",
          token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
          type: "external_account",
          credential_source: {
            url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
            format: {
              type: "json",
              subject_token_field_name: "access_token",
            },
          },
          universe_domain: "googleapis.com",
        },
        projectId: "",
      });
      
      const bucket = objectStorageClient.bucket(bucketName);
      const file = bucket.file(objectPath);
      
      const [exists] = await file.exists();
      if (!exists) {
        return res.status(404).json({ message: "File not found" });
      }
      
      const [metadata] = await file.getMetadata();
      res.setHeader('Content-Type', metadata.contentType || 'application/octet-stream');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      
      file.createReadStream().pipe(res);
    } catch (error: any) {
      console.error("[OBJECT_STORAGE] Failed to serve file:", error);
      res.status(500).json({ message: "Failed to retrieve file" });
    }
  });

  // Environment info endpoint
  app.get("/api/environment", async (req, res) => {
    try {
      const isProduction = process.env.NODE_ENV === 'production' || process.env.REPLIT_DEPLOYMENT === '1';
      const environment = isProduction ? 'Production' : 'Development';

      res.json({
        environment,
        isProduction,
        nodeEnv: process.env.NODE_ENV,
        replitDeployment: process.env.REPLIT_DEPLOYMENT
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to get environment info" });
    }
  });


  // Health check endpoint
  app.get("/api/health", async (req, res) => {
    try {
      // Test database connection
      const dbTest = await storage.getUsers();

      const healthStatus = { 
        status: "healthy",
        database: "connected",
        userCount: dbTest.length,
        entraConfigured: !!isEntraConfigured,
        sharepoint: {
          configured: false,
          accessible: false,
          error: undefined as string | undefined
        },
        environment: process.env.NODE_ENV || "development"
      };

      // Test SharePoint connectivity if configured
      if (isEntraConfigured) {
        const sharePointConfig = await getSharePointConfig();
        healthStatus.sharepoint.configured = sharePointConfig.configured ? true : false;

        if (sharePointConfig.configured) {
          try {
            const connectivity = await graphClient.testConnectivity(
              sharePointConfig.siteId,
              sharePointConfig.containerId
            );

            healthStatus.sharepoint.accessible = Boolean(connectivity.authenticated && 
                                               connectivity.containerAccessible);

            if (connectivity.error) {
              healthStatus.sharepoint.error = connectivity.error;
            }
          } catch (error) {
            healthStatus.sharepoint.error = 'SharePoint connectivity test failed: ' + (error instanceof Error ? error.message : 'Unknown error');
          }
        }
      }

      res.json(healthStatus);
    } catch (error: any) {
      console.error("[HEALTH] Database connection error:", error);
      res.status(503).json({ 
        status: "unhealthy",
        database: "error",
        error: error.message || "Database connection failed",
        environment: process.env.NODE_ENV || "development"
      });
    }
  });

  // Auth middleware is now imported from session-store module

  // Compliance tracking endpoint
  app.get("/api/compliance", requireAuth, async (req, res) => {
    try {
      const clientId = req.query.clientId as string;
      const complianceData = await storage.getComplianceData(clientId || undefined);
      res.json(complianceData);
    } catch (error) {
      console.error("Error fetching compliance data:", error);
      res.status(500).json({ message: "Failed to fetch compliance data" });
    }
  });


    // ── Extracted domain-focused route modules ────────────────────────────
    registerUserRoutes(app, { requireAuth, requireRole });
    registerTenantRoutes(app, { requireAuth, requireRole, requirePlatformAdmin, sharePointFileStorage });
    registerReportsRoutes(app, { requireAuth, requireRole, sharePointFileStorage });
    registerPlannerRoutes(app, { requireAuth, requireRole });
    registerTeamsAutomationRoutes(app, { requireAuth, requireRole });
    registerClientRoutes(app, { requireAuth, requireRole, sharePointFileStorage });
    registerTimeEntryRoutes(app, { requireAuth, requireRole });
    registerAiRoutes(app, { requireAuth, requireRole, requirePlatformAdmin });
    registerProjectAgentRoutes(app, { requireAuth, requireRole });
    registerRaiddRoutes(app, { requireAuth, requireRole });
    registerSupportRoutes(app, { requireAuth, requireRole });
    registerResourcePlanningRoutes(app, { requireAuth, requireRole });
    registerJobRoutes(app, { requireAuth, requireRole });
    registerNotificationRoutes(app, { requireAuth });
    registerPayrollRoutes(app, { requireAuth, requireRole });
    registerDistributionRoutes(app, { requireAuth, requireRole });
    registerWebhookRoutes(app);
    registerEmbedRoutes(app, { requireAuth, requireRole });
    registerSearchRoutes(app, { requireAuth });
    registerGalaxyV1Routes(app, { requireAuth, requireRole });
    const { startGalaxyWebhookWorker } = await import("./services/galaxy-webhook-delivery.js");
    startGalaxyWebhookWorker();



  // Agent card health check (admin only)
  app.get("/api/admin/agent-card-health", requireAuth, requireRole(["admin"]), async (req, res) => {
    try {
      const { getLastHealthCheckResult } = await import('./services/agent-card-health-scheduler.js');
      const result = getLastHealthCheckResult();
      res.json({ result });
    } catch (error) {
      console.error("[ADMIN] Error fetching agent card health result:", error);
      res.status(500).json({ message: "Failed to fetch agent card health status" });
    }
  });

  app.post("/api/admin/agent-card-health/run", requireAuth, requireRole(["admin"]), async (req, res) => {
    try {
      const { runAgentCardHealthCheck } = await import('./services/agent-card-health-scheduler.js');
      const result = await runAgentCardHealthCheck('manual');
      res.json({ result });
    } catch (error) {
      console.error("[ADMIN] Error running agent card health check:", error);
      res.status(500).json({ message: "Failed to run agent card health check" });
    }
  });

  app.get("/api/admin/agent-card-health/history", requireAuth, requireRole(["admin"]), async (req, res) => {
    try {
      const limit = Math.min(parseInt(String(req.query.limit ?? '50'), 10) || 50, 200);
      const history = await storage.getAgentCardHealthHistory(limit);
      res.json({ history });
    } catch (error) {
      console.error("[ADMIN] Error fetching agent card health history:", error);
      res.status(500).json({ message: "Failed to fetch agent card health history" });
    }
  });

  // System Settings (read: admin, write: platform admin only)
  app.get("/api/settings", requireAuth, requireRole(["admin"]), async (req, res) => {
    try {
      const settings = await storage.getSystemSettings();
      res.json(settings);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch system settings" });
    }
  });

  app.get("/api/settings/:key", requireAuth, requireRole(["admin"]), async (req, res) => {
    try {
      const setting = await storage.getSystemSetting(req.params.key);
      if (!setting) {
        return res.status(404).json({ message: "System setting not found" });
      }
      res.json(setting);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch system setting" });
    }
  });

  app.post("/api/settings", requireAuth, requirePlatformAdmin, async (req, res) => {
    try {
      const validatedData = insertSystemSettingSchema.parse(req.body);
      const setting = await storage.setSystemSetting(
        validatedData.settingKey,
        validatedData.settingValue,
        validatedData.description || undefined,
        validatedData.settingType || 'string'
      );
      res.status(201).json(setting);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid setting data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to create/update system setting" });
    }
  });

  app.put("/api/settings/:id", requireAuth, requirePlatformAdmin, async (req, res) => {
    try {
      const validatedData = insertSystemSettingSchema.parse(req.body);
      const setting = await storage.updateSystemSetting(req.params.id, validatedData);
      res.json(setting);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid setting data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to update system setting" });
    }
  });

  app.delete("/api/settings/:id", requireAuth, requirePlatformAdmin, async (req, res) => {
    try {
      await storage.deleteSystemSetting(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting system setting:", error);
      res.status(400).json({ 
        message: error instanceof Error ? error.message : "Failed to delete system setting" 
      });
    }
  });

  // ============================================================================
  // "What's New" Changelog Modal API
  // ============================================================================

  function extractFallbackHighlights(markdown: string): Array<{ icon: string; title: string; description: string }> {
    const highlights: Array<{ icon: string; title: string; description: string }> = [];
    const featurePattern = /\*\*([^*]+)\*\*\n((?:- [^\n]+\n?)+)/g;
    let match;
    const icons = ["🚀", "💬", "📊", "📋", "🔧", "📚", "⚡", "🎯"];
    let iconIdx = 0;
    while ((match = featurePattern.exec(markdown)) !== null && highlights.length < 5) {
      const title = match[1].trim();
      if (title === "Release Date:" || title === "Status:" || title === "Codename:") continue;
      const bullets = match[2].split("\n").filter(l => l.trim().startsWith("- ")).map(l => l.replace(/^- /, "").trim());
      const description = bullets.slice(0, 2).join(". ");
      if (description) {
        highlights.push({ icon: icons[iconIdx % icons.length], title, description });
        iconIdx++;
      }
    }
    return highlights;
  }

  app.get("/api/changelog/whats-new", requireAuth, async (req, res) => {
    try {
      const user = req.user as any;
      const tenantId = user?.primaryTenantId;

      const currentVersion = await storage.getSystemSettingValue("CURRENT_CHANGELOG_VERSION", "");
      if (!currentVersion) {
        return res.json({ showModal: false });
      }

      if (tenantId) {
        const tenant = await storage.getTenant(tenantId);
        if (tenant && tenant.showChangelogOnLogin === false) {
          return res.json({ showModal: false });
        }
      }

      const userRecord = await storage.getUser(user.id);
      if (userRecord?.lastDismissedChangelogVersion === currentVersion) {
        return res.json({ showModal: false });
      }

      const cacheKey = `CHANGELOG_SUMMARY_${currentVersion}`;
      let cachedSummary = await storage.getSystemSettingValue(cacheKey, "");

      if (cachedSummary) {
        try {
          const parsed = JSON.parse(cachedSummary);
          return res.json({ showModal: true, version: currentVersion, ...parsed });
        } catch {
          return res.json({ showModal: true, version: currentVersion, summary: cachedSummary, highlights: [] });
        }
      }

      const changelogContent = readChangelogContent();

      if (!changelogContent) {
        return res.json({ showModal: true, version: currentVersion, summary: "New updates are available!", highlights: [] });
      }

      const twoWeeksAgo = new Date();
      twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

      const versionBlocks = changelogContent.split(/(?=###\s+Version\s+)/);
      const recentSections: string[] = [];
      for (const block of versionBlocks) {
        const dateMatch = block.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})\b/);
        if (dateMatch) {
          const blockDate = new Date(`${dateMatch[1]} ${dateMatch[2]}, ${dateMatch[3]}`);
          if (blockDate >= twoWeeksAgo) {
            recentSections.push(block.trim());
          }
        }
      }

      const relevantSection = recentSections.length > 0
        ? recentSections.join("\n\n").substring(0, 4000)
        : changelogContent.substring(0, 2000);

      try {
        const { aiService, buildGroundingContext } = await import("./services/ai-service.js");
        if (aiService.isConfigured()) {
          const clTenantId = (req.user as any)?.tenantId;
          const clGroundingDocs = clTenantId
            ? await storage.getActiveGroundingDocumentsForTenant(clTenantId)
            : await storage.getActiveGroundingDocuments();
          const clGroundingCtx = buildGroundingContext(clGroundingDocs, 'changelog');

          const result = await aiService.customPrompt(
            "You summarize software release notes into friendly, non-technical overviews for business users. Return valid JSON only.",
            `Summarize these release notes from the last two weeks into a friendly, non-technical overview. Combine all versions into a single cohesive summary. Group into 3-5 highlights with emoji icons. Format as JSON: { "summary": "brief overview sentence", "highlights": [{ "icon": "emoji", "title": "short title", "description": "1-2 sentence description" }] }\n\nRelease notes:\n${relevantSection}`,
            { temperature: 0.5, maxTokens: 1024, responseFormat: "json", groundingContext: clGroundingCtx, usageCtx: { tenantId: clTenantId, userId: (req.user as any)?.id, feature: 'other' as any } }
          );

          if (result.content && result.content.trim()) {
            try {
              const parsed = JSON.parse(result.content);
              if (parsed.highlights && parsed.highlights.length > 0) {
                await storage.setSystemSetting(cacheKey, result.content, `Cached AI summary for changelog version ${currentVersion}`, "json");
                return res.json({ showModal: true, version: currentVersion, ...parsed });
              }
            } catch {
              console.log("[CHANGELOG] AI returned non-JSON, falling through to structured fallback");
            }
          }
        }
      } catch (aiError: any) {
        console.error("[CHANGELOG] AI summary generation failed:", aiError.message);
      }

      const highlights = extractFallbackHighlights(relevantSection);
      const fallbackResult = { summary: "Here's what's new in the latest updates.", highlights };
      if (highlights.length > 0) {
        await storage.setSystemSetting(cacheKey, JSON.stringify(fallbackResult), `Structured changelog summary for ${currentVersion}`, "json");
      }
      return res.json({ showModal: true, version: currentVersion, ...fallbackResult });
    } catch (error: any) {
      console.error("[CHANGELOG] Failed to check changelog status:", error);
      res.status(500).json({ message: "Failed to check changelog status" });
    }
  });

  app.post("/api/changelog/dismiss", requireAuth, async (req, res) => {
    try {
      const user = req.user as any;
      const { version } = req.body;

      if (!version || typeof version !== "string") {
        return res.status(400).json({ message: "Version is required" });
      }

      await storage.updateUser(user.id, { lastDismissedChangelogVersion: version });
      res.json({ success: true });
    } catch (error: any) {
      console.error("[CHANGELOG] Failed to dismiss changelog:", error);
      res.status(500).json({ message: "Failed to dismiss changelog" });
    }
  });

  // Vocabulary System (admin only for org-level, auto-cascade for context)
  app.get("/api/vocabulary/organization", requireAuth, requireRole(["admin"]), async (req, res) => {
    try {
      const vocabulary = await storage.getOrganizationVocabulary();
      res.json(vocabulary);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch organization vocabulary" });
    }
  });

  app.put("/api/vocabulary/organization", requireAuth, requireRole(["admin"]), async (req, res) => {
    try {
      const validatedData = vocabularyTermsSchema.parse(req.body);
      const vocabulary = await storage.setOrganizationVocabulary(validatedData);
      res.json(vocabulary);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid vocabulary data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to update organization vocabulary" });
    }
  });

  // Get vocabulary for a specific context (with cascading: project -> client -> org)
  app.get("/api/vocabulary/context", requireAuth, async (req, res) => {
    try {
      const { projectId, clientId, estimateId } = req.query;
      const vocabulary = await storage.getVocabularyForContext({
        projectId: projectId as string | undefined,
        clientId: clientId as string | undefined,
        estimateId: estimateId as string | undefined,
      });
      res.json(vocabulary);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch vocabulary for context" });
    }
  });

  // Get all vocabularies (organization + all clients/projects with overrides)
  app.get("/api/vocabulary/all", requireAuth, requireRole(["admin"]), async (req, res) => {
    try {
      const vocabularies = await storage.getAllVocabularies();
      res.json(vocabularies);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch all vocabularies" });
    }
  });

  // New Vocabulary Catalog System (uses catalog table and FK references)
  // Get all vocabulary catalog options (predefined terms)
  app.get("/api/vocabulary/catalog", requireAuth, requireRole(["admin"]), async (req, res) => {
    try {
      const catalog = await storage.getVocabularyCatalog();
      res.json(catalog);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch vocabulary catalog" });
    }
  });

  // Get vocabulary catalog options by term type
  app.get("/api/vocabulary/catalog/:termType", requireAuth, requireRole(["admin"]), async (req, res) => {
    try {
      const catalog = await storage.getVocabularyCatalogByType(req.params.termType);
      res.json(catalog);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch vocabulary catalog for term type" });
    }
  });

  // Create new vocabulary term
  app.post("/api/vocabulary/catalog", requireAuth, requireRole(["admin"]), async (req, res) => {
    try {
      // Use Zod schema for validation
      const createVocabularyTermSchema = z.object({
        termType: z.enum(['epic', 'stage', 'activity', 'workstream', 'milestone']),
        termValue: z.string().min(1, "Term value is required"),
        description: z.string().optional(),
        sortOrder: z.number().int().optional()
      });
      
      const validatedData = createVocabularyTermSchema.parse(req.body);
      
      const newTerm = await storage.createVocabularyTerm({
        ...validatedData,
        sortOrder: validatedData.sortOrder !== undefined ? validatedData.sortOrder : 999,
        isActive: true,
        isSystemDefault: false
      });
      
      res.status(201).json(newTerm);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid vocabulary term data", errors: error.errors });
      }
      if (error?.code === '23505') { // Unique constraint violation
        return res.status(400).json({ message: "A term with this type and value already exists" });
      }
      console.error("Error creating vocabulary term:", error);
      res.status(500).json({ message: "Failed to create vocabulary term" });
    }
  });

  // Update vocabulary term
  app.patch("/api/vocabulary/catalog/:id", requireAuth, requireRole(["admin"]), async (req, res) => {
    try {
      const { id } = req.params;
      
      // Use Zod schema for validation
      const updateVocabularyTermSchema = z.object({
        termValue: z.string().min(1).optional(),
        description: z.string().optional(),
        sortOrder: z.number().int().optional(),
        isActive: z.boolean().optional()
      });
      
      const validatedData = updateVocabularyTermSchema.parse(req.body);
      
      const updated = await storage.updateVocabularyTerm(id, validatedData);
      res.json(updated);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid update data", errors: error.errors });
      }
      if (error?.message?.includes('not found')) {
        return res.status(404).json({ message: "Vocabulary term not found" });
      }
      console.error("Error updating vocabulary term:", error);
      res.status(500).json({ message: "Failed to update vocabulary term" });
    }
  });

  // Delete (soft delete) vocabulary term
  app.delete("/api/vocabulary/catalog/:id", requireAuth, requireRole(["admin"]), async (req, res) => {
    try {
      const { id } = req.params;
      
      // Check if term is being used in organization vocabulary
      const tenantId = req.user?.tenantId;
      if (!tenantId) {
        return res.status(400).json({ message: "Tenant context required for vocabulary operations" });
      }
      const orgVocab = await storage.getOrganizationVocabularySelections(tenantId);
      if (orgVocab) {
        const usedTermIds = [
          orgVocab.epicTermId,
          orgVocab.stageTermId,
          orgVocab.activityTermId,
          orgVocab.workstreamTermId,
          orgVocab.milestoneTermId
        ].filter(Boolean);
        
        if (usedTermIds.includes(id)) {
          return res.status(400).json({ message: "Cannot delete term that is currently selected as organization default" });
        }
      }
      
      await storage.deleteVocabularyTerm(id);
      res.json({ message: "Vocabulary term deleted successfully" });
    } catch (error) {
      console.error("Error deleting vocabulary term:", error);
      res.status(500).json({ message: "Failed to delete vocabulary term" });
    }
  });

  // Seed default vocabulary terms
  app.post("/api/vocabulary/catalog/seed", requireAuth, requireRole(["admin"]), async (req, res) => {
    try {
      await storage.seedDefaultVocabulary();
      res.json({ message: "Default vocabulary terms seeded successfully" });
    } catch (error) {
      console.error("Error seeding vocabulary terms:", error);
      res.status(500).json({ message: "Failed to seed vocabulary terms" });
    }
  });

  // Get organization vocabulary selections (with term details)
  app.get("/api/vocabulary/organization/selections", requireAuth, requireRole(["admin"]), async (req, res) => {
    try {
      const tenantId = req.user?.tenantId;
      if (!tenantId) {
        return res.status(400).json({ message: "Tenant context required for vocabulary access" });
      }
      const selections = await storage.getOrganizationVocabularySelections(tenantId);
      if (!selections) {
        return res.status(404).json({ message: "Organization vocabulary not configured" });
      }
      
      // Fetch the actual term details for each selection
      const epicTerm = selections.epicTermId ? await storage.getVocabularyTermById(selections.epicTermId) : null;
      const stageTerm = selections.stageTermId ? await storage.getVocabularyTermById(selections.stageTermId) : null;
      const activityTerm = selections.activityTermId ? await storage.getVocabularyTermById(selections.activityTermId) : null;
      const workstreamTerm = selections.workstreamTermId ? await storage.getVocabularyTermById(selections.workstreamTermId) : null;
      const milestoneTerm = selections.milestoneTermId ? await storage.getVocabularyTermById(selections.milestoneTermId) : null;
      
      res.json({
        ...selections,
        epicTerm,
        stageTerm,
        activityTerm,
        workstreamTerm,
        milestoneTerm
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch organization vocabulary selections" });
    }
  });

  // Update organization vocabulary selections
  app.put("/api/vocabulary/organization/selections", requireAuth, requireRole(["admin"]), async (req, res) => {
    try {
      const tenantId = req.user?.tenantId;
      if (!tenantId) {
        return res.status(400).json({ message: "Tenant context required for vocabulary updates" });
      }
      const validatedData = updateOrganizationVocabularySchema.parse(req.body);
      const updated = await storage.updateOrganizationVocabularySelections(validatedData, tenantId);
      res.json(updated);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid vocabulary selection data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to update organization vocabulary selections" });
    }
  });

  // Dashboard metrics
  app.get("/api/dashboard/metrics", requireAuth, async (req, res) => {
    try {
      const tenantId = req.user?.tenantId;
      const metrics = await storage.getDashboardMetrics(tenantId || undefined);
      res.json(metrics);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch dashboard metrics" });
    }
  });

  // =========================================================================
  // Slippage Analytics Endpoints
  // =========================================================================

  // Portfolio-level slippage summary
  app.get("/api/portfolio/slippage", requireAuth, requireRole(["admin", "billing-admin", "pm", "portfolio-manager", "executive"]), async (req, res) => {
    try {
      const { calculatePortfolioSlippage } = await import("./lib/slippage.js");
      const tenantId = req.user!.tenantId;
      if (!tenantId) return res.status(400).json({ message: "Tenant context required" });
      const summary = await calculatePortfolioSlippage(tenantId);
      res.json(summary);
    } catch (error) {
      console.error("Error calculating portfolio slippage:", error);
      res.status(500).json({ message: "Failed to calculate portfolio slippage" });
    }
  });

  // Single-project slippage metrics
  app.get("/api/projects/:id/slippage", requireAuth, requireRole(["admin", "billing-admin", "pm", "portfolio-manager", "executive"]), async (req, res) => {
    try {
      const { calculateProjectSlippage } = await import("./lib/slippage.js");
      const tenantId = req.user!.tenantId;
      if (!tenantId) return res.status(400).json({ message: "Tenant context required" });
      const metrics = await calculateProjectSlippage(req.params.id, tenantId);
      if (!metrics) return res.status(404).json({ message: "Project not found" });
      res.json(metrics);
    } catch (error) {
      console.error("Error calculating project slippage:", error);
      res.status(500).json({ message: "Failed to calculate project slippage" });
    }
  });

  // Hours summary — budgeted vs actual vs remaining for a single project
  app.get("/api/projects/:id/hours-summary", requireAuth, requireRole(["admin", "billing-admin", "pm", "portfolio-manager", "executive"]), async (req, res) => {
    try {
      const projectId = req.params.id;
      const tenantId = req.user?.tenantId;

      const project = await storage.getProject(projectId);
      if (!project) return res.status(404).json({ message: "Project not found" });

      if (tenantId && project.tenantId && project.tenantId !== tenantId) {
        return res.status(403).json({ message: "Access denied" });
      }

      const projectEstimates = await storage.getEstimatesByProject(projectId);
      let budgetedHours = 0;

      if (projectEstimates.length > 0) {
        const approvedEstimate = projectEstimates.find(e => e.status === "approved");
        const targetEstimate = approvedEstimate || projectEstimates[0];
        if (targetEstimate) {
          const lineItems = await storage.getEstimateLineItems(targetEstimate.id);
          budgetedHours = lineItems.reduce((sum, item) => sum + parseFloat(item.adjustedHours ?? "0"), 0);
        }
      }

      const projectTimeEntries = await storage.getTimeEntries({ projectId });
      const actualHours = projectTimeEntries.reduce((sum, entry) => sum + parseFloat(entry.hours ?? "0"), 0);

      const remainingHours = Math.max(0, budgetedHours - actualHours);
      const hoursVariance = actualHours - budgetedHours;
      const hoursConsumedPct = budgetedHours > 0 ? Math.round((actualHours / budgetedHours) * 100) : 0;

      console.log(`[hours-summary] project=${projectId} tenant=${tenantId} budgeted=${budgetedHours.toFixed(1)} actual=${actualHours.toFixed(1)} remaining=${remainingHours.toFixed(1)} consumedPct=${hoursConsumedPct}`);
      if (budgetedHours > 0 && remainingHours / budgetedHours < 0.10) {
        console.warn(`[hours-summary][alert] project=${projectId} is below 10% remaining hours (${hoursConsumedPct}% consumed) — consider alerting PM`);
      }

      res.json({
        budgetedHours: Math.round(budgetedHours * 10) / 10,
        actualHours: Math.round(actualHours * 10) / 10,
        remainingHours: Math.round(remainingHours * 10) / 10,
        hoursVariance: Math.round(hoursVariance * 10) / 10,
        hoursConsumedPct,
      });
    } catch (error) {
      console.error("Error getting project hours summary:", error);
      res.status(500).json({ message: "Failed to get project hours summary" });
    }
  });

  // Batch hours summary for all active projects — used by dashboard project list
  app.get("/api/projects/hours-summary-batch", requireAuth, requireRole(["admin", "billing-admin", "pm", "portfolio-manager", "executive"]), async (req, res) => {
    try {
      const tenantId = req.user?.tenantId;

      // Pull all estimates per project (id, status, budgetedHours from sum of line items)
      type EstRow = { project_id: string; estimate_id: string; status: string; budgeted_hours: string };
      const estRows = await db.execute<EstRow>(sql`
        SELECT
          e.project_id AS project_id,
          e.id AS estimate_id,
          e.status AS status,
          COALESCE(SUM(CAST(li.adjusted_hours AS NUMERIC)), 0) AS budgeted_hours
        FROM estimates e
        LEFT JOIN estimate_line_items li ON li.estimate_id = e.id
        WHERE e.project_id IS NOT NULL
          ${tenantId ? sql`AND e.tenant_id = ${tenantId}` : sql``}
        GROUP BY e.project_id, e.id, e.status, e.version
        ORDER BY e.project_id, (e.status = 'approved') DESC, e.version DESC
      `);

      const budgetedByProject = new Map<string, number>();
      for (const row of estRows.rows) {
        // First row per project wins (approved first, then most recent)
        if (!budgetedByProject.has(row.project_id)) {
          budgetedByProject.set(row.project_id, Number(row.budgeted_hours));
        }
      }

      // Actual hours per project from time entries
      type ActualRow = { project_id: string; actual_hours: string };
      const actualRows = await db.execute<ActualRow>(sql`
        SELECT te.project_id AS project_id,
               COALESCE(SUM(CAST(te.hours AS NUMERIC)), 0) AS actual_hours
        FROM time_entries te
        ${tenantId ? sql`JOIN projects p ON p.id = te.project_id AND p.tenant_id = ${tenantId}` : sql``}
        GROUP BY te.project_id
      `);

      const actualByProject = new Map<string, number>();
      for (const row of actualRows.rows) {
        actualByProject.set(row.project_id, Number(row.actual_hours));
      }

      const projectIdSet = new Set<string>();
      budgetedByProject.forEach((_v, k) => projectIdSet.add(k));
      actualByProject.forEach((_v, k) => projectIdSet.add(k));
      const summaries = Array.from(projectIdSet).map((projectId) => {
        const budgetedHours = budgetedByProject.get(projectId) ?? 0;
        const actualHours = actualByProject.get(projectId) ?? 0;
        const remainingHours = Math.max(0, budgetedHours - actualHours);
        const hoursVariance = actualHours - budgetedHours;
        const hoursConsumedPct = budgetedHours > 0 ? Math.round((actualHours / budgetedHours) * 100) : 0;
        return {
          projectId,
          budgetedHours: Math.round(budgetedHours * 10) / 10,
          actualHours: Math.round(actualHours * 10) / 10,
          remainingHours: Math.round(remainingHours * 10) / 10,
          hoursVariance: Math.round(hoursVariance * 10) / 10,
          hoursConsumedPct,
        };
      });

      res.json(summaries);
    } catch (error) {
      console.error("Error getting batch hours summary:", error);
      res.status(500).json({ message: "Failed to get batch hours summary" });
    }
  });

  // User-scoped slippage alerts (role-aware: team members see own alerts; PMs/portfolio see more)
  app.get("/api/dashboard/slippage-alerts", requireAuth, async (req, res) => {
    try {
      const { getUserSlippageAlerts } = await import("./lib/slippage.js");
      const tenantId = req.user!.tenantId;
      const userId = req.user!.id;
      if (!tenantId) return res.status(400).json({ message: "Tenant context required" });
      const alerts = await getUserSlippageAlerts(userId, tenantId);
      res.json(alerts);
    } catch (error) {
      console.error("Error calculating slippage alerts:", error);
      res.status(500).json({ message: "Failed to calculate slippage alerts" });
    }
  });

  // Projects
  app.get("/api/projects", requireAuth, async (req, res) => {
    try {
      const tenantId = (req.user as any)?.activeTenantId || (req.user as any)?.primaryTenantId || req.user?.tenantId;
      // Backward-compat: only paginate when caller explicitly passes limit or offset
      const hasPagination = req.query.limit !== undefined || req.query.offset !== undefined;
      console.log(`[GET /api/projects] tenantId=${tenantId} hasPagination=${hasPagination} query=`, req.query);
      if (!hasPagination) {
        const projects = await storage.getProjects(tenantId);
        return res.json(projects);
      }
      const parsed = projectFiltersSchema.parse(req.query);
      console.log(`[GET /api/projects] parsed:`, parsed);
      const result = await storage.getProjectsPaginated({
        tenantId,
        limit: parsed.limit,
        offset: parsed.offset,
        search: parsed.search,
        status: parsed.status,
        clientId: parsed.clientId,
        pmId: parsed.pmId,
        sortDir: parsed.sortDir,
        sortBy: parsed.sortBy,
      });
      console.log(`[GET /api/projects] result.total=${result.total} items=${result.items.length}`);
      return res.json({ ...result, limit: parsed.limit, offset: parsed.offset });
    } catch (error) {
      console.error("[GET /api/projects] error:", error);
      res.status(500).json({ message: "Failed to fetch projects", error: String(error) });
    }
  });

  app.get("/api/projects/:id", requireAuth, async (req, res) => {
    try {
      const project = await storage.getProject(req.params.id);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }
      res.json(project);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch project" });
    }
  });

  app.post("/api/projects", requireAuth, requireRole(["admin", "pm", "portfolio-manager", "executive"]), async (req, res) => {
    try {
      console.log("[DEBUG] Creating project with:", req.body);
      console.log("[DEBUG] User role:", req.user?.role);
      console.log("[DEBUG] Tenant context:", req.user?.tenantId);
      const validatedData = insertProjectSchema.parse(req.body);
      // Include tenant context in the project data (dual-write)
      const projectDataWithTenant = {
        ...validatedData,
        tenantId: req.user?.tenantId || null
      };
      console.log("[DEBUG] Validated project data with tenant:", projectDataWithTenant);
      const project = await storage.createProject(projectDataWithTenant);
      console.log("[DEBUG] Created project:", project.id, "tenantId:", project.tenantId);
      res.status(201).json(project);
    } catch (error: any) {
      console.error("[ERROR] Failed to create project:", error);
      if (error instanceof z.ZodError) {
        console.error("[ERROR] Project validation errors:", error.errors);
        return res.status(400).json({ message: "Invalid project data", errors: error.errors });
      }
      res.status(500).json({ 
        message: "Failed to create project",
        details: error.message || "Unknown error"
      });
    }
  });

  app.patch("/api/projects/:id", requireAuth, requireRole(["admin", "billing-admin", "pm", "portfolio-manager", "executive"]), async (req, res) => {
    try {
      // Get the project first to check it exists
      const project = await storage.getProject(req.params.id);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      console.log("[DEBUG] Updating project with:", req.body);
      const validatedData = insertProjectSchema.partial().parse(req.body);
      console.log("[DEBUG] Validated project update data:", validatedData);
      const updatedProject = await storage.updateProject(req.params.id, validatedData);
      console.log("[DEBUG] Updated project:", updatedProject.id);
      res.json(updatedProject);
    } catch (error: any) {
      console.error("[ERROR] Failed to update project:", error);
      if (error instanceof z.ZodError) {
        console.error("[ERROR] Project validation errors:", error.errors);
        return res.status(400).json({ message: "Invalid project data", errors: error.errors });
      }
      res.status(500).json({ 
        message: "Failed to update project", 
        error: error.message 
      });
    }
  });

  // Get Teams channel linked to a project
  app.get("/api/projects/:id/channel", requireAuth, async (req, res) => {
    try {
      const user = req.user as any;
      const tenantId = user?.primaryTenantId || user?.activeTenantId;
      const { id } = req.params;
      const [channel] = await db
        .select()
        .from(projectChannels)
        .where(and(eq(projectChannels.projectId, id), eq(projectChannels.tenantId, tenantId)))
        .limit(1);
      if (!channel) return res.json(null);
      res.json(channel);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to get project channel: " + error.message });
    }
  });

  // Project Milestones endpoints (Delivery Tracking)
  app.get("/api/projects/:projectId/milestones", requireAuth, async (req, res) => {
    try {
      const milestones = await storage.getProjectMilestones(req.params.projectId);
      res.json(milestones);
    } catch (error: any) {
      console.error("[ERROR] Failed to fetch project milestones:", error);
      res.status(500).json({ message: "Failed to fetch project milestones" });
    }
  });

  // Project Epics endpoints
  app.get("/api/projects/:projectId/epics", requireAuth, async (req, res) => {
    try {
      const epics = await storage.getProjectEpics(req.params.projectId);
      res.json(epics);
    } catch (error: any) {
      console.error("[ERROR] Failed to fetch project epics:", error);
      res.status(500).json({ message: "Failed to fetch project epics" });
    }
  });

  app.post("/api/projects/:projectId/epics", requireAuth, requireRole(["admin", "pm", "portfolio-manager", "executive"]), async (req, res) => {
    try {
      const { name, description } = req.body;
      if (!name) {
        return res.status(400).json({ message: "Epic name is required" });
      }
      
      const existingEpics = await storage.getProjectEpics(req.params.projectId);
      const maxOrder = existingEpics.length > 0 
        ? Math.max(...existingEpics.map(e => e.order ?? 0)) 
        : 0;
      
      const epic = await storage.createProjectEpic({
        projectId: req.params.projectId,
        name,
        description: description || null,
        order: maxOrder + 1
      });
      res.json(epic);
    } catch (error: any) {
      console.error("[ERROR] Failed to create project epic:", error);
      res.status(500).json({ message: "Failed to create project epic" });
    }
  });

  app.patch("/api/projects/:projectId/epics/:epicId", requireAuth, requireRole(["admin", "pm", "portfolio-manager", "executive"]), async (req, res) => {
    try {
      const { name, description, order } = req.body;
      if (!name && description === undefined && order === undefined) {
        return res.status(400).json({ message: "Epic name, description, or order is required" });
      }
      
      const updateData: { name?: string; description?: string | null; order?: number } = {};
      if (name) updateData.name = name;
      if (description !== undefined) updateData.description = description;
      if (order !== undefined) updateData.order = order;
      
      const epic = await storage.updateProjectEpic(req.params.epicId, updateData);
      res.json(epic);
    } catch (error: any) {
      console.error("[ERROR] Failed to update project epic:", error);
      res.status(500).json({ message: "Failed to update project epic" });
    }
  });

  app.delete("/api/projects/:projectId/epics/:epicId", requireAuth, requireRole(["admin", "pm", "portfolio-manager", "executive"]), async (req, res) => {
    try {
      await storage.deleteProjectEpic(req.params.epicId);
      res.json({ message: "Epic deleted successfully" });
    } catch (error: any) {
      console.error("[ERROR] Failed to delete project epic:", error);
      res.status(500).json({ message: "Failed to delete project epic" });
    }
  });

  // Project Stages endpoints
  app.get("/api/projects/:projectId/stages/:epicId", requireAuth, async (req, res) => {
    try {
      const stages = await storage.getProjectStages(req.params.epicId);
      res.json(stages);
    } catch (error: any) {
      console.error("[ERROR] Failed to fetch project stages:", error);
      res.status(500).json({ message: "Failed to fetch project stages" });
    }
  });

  // Get all stages for a project
  app.get("/api/projects/:projectId/stages", requireAuth, async (req, res) => {
    try {
      // First get all epics for the project
      const epics = await storage.getProjectEpics(req.params.projectId);
      // Then get all stages for each epic
      const stagesPromises = epics.map(epic => storage.getProjectStages(epic.id));
      const stagesArrays = await Promise.all(stagesPromises);
      // Flatten and add epic information to each stage
      const allStages = stagesArrays.flatMap((stages, index) => 
        stages.map(stage => ({ ...stage, epicId: epics[index].id }))
      );
      res.json(allStages);
    } catch (error: any) {
      console.error("[ERROR] Failed to fetch project stages:", error);
      res.status(500).json({ message: "Failed to fetch project stages" });
    }
  });

  // Project Allocations endpoints
  app.get("/api/projects/:projectId/allocations", requireAuth, async (req, res) => {
    try {
      const allocations = await storage.getProjectAllocations(req.params.projectId);
      const { personId } = req.query;
      if (personId && typeof personId === "string") {
        // Return only allocations directly assigned to this person
        const filtered = allocations.filter((a: any) => a.personId === personId);
        return res.json(filtered);
      }
      res.json(allocations);
    } catch (error: any) {
      console.error("[ERROR] Failed to fetch project allocations:", error);
      res.status(500).json({ message: "Failed to fetch project allocations" });
    }
  });

  app.post("/api/projects/:projectId/allocations", requireAuth, requireRole(["admin", "pm", "portfolio-manager"]), async (req, res) => {
    try {
      // Validate required hours
      const hours = typeof req.body.hours === 'string' ? parseFloat(req.body.hours) : req.body.hours;
      if (!hours || isNaN(hours) || hours <= 0) {
        return res.status(400).json({ message: "Hours is required and must be greater than 0" });
      }
      
      // Derive rack rate from role or person if not provided
      let rackRate = req.body.rackRate;
      let costRate = req.body.costRate;
      const pricingMode = req.body.pricingMode || 'role';
      
      if (!rackRate || rackRate === '0' || rackRate === 0) {
        if (pricingMode === 'person' && req.body.personId) {
          // Get rate from person
          const userRates = await storage.getUserRates(req.body.personId);
          rackRate = userRates.billingRate?.toString();
          costRate = costRate || userRates.costRate?.toString();
        } else if (pricingMode === 'role' && req.body.roleId) {
          // Get rate from role
          const role = await storage.getRole(req.body.roleId);
          if (role) {
            rackRate = role.defaultRackRate?.toString();
            costRate = costRate || role.defaultCostRate?.toString();
          }
        }
        
        // If still no rate and pricingMode is resource_name or derivation failed
        if (!rackRate || rackRate === '0') {
          // For resource_name mode or when role/person has no rate, require explicit rate
          if (pricingMode === 'resource_name') {
            return res.status(400).json({ 
              message: "Rack rate is required when using resource name pricing mode" 
            });
          }
          // Allow 0 rate for role/person modes when no rate is configured (billable assignments to be set later)
          rackRate = '0';
        }
      }
      
      const allocationData = {
        ...req.body,
        projectId: req.params.projectId,
        weekNumber: req.body.weekNumber ?? 0,
        hours: hours,
        rackRate: rackRate,
        costRate: costRate || null,
        pricingMode: pricingMode,
        tenantId: req.user?.tenantId || null // Multi-tenancy dual-write
      };
      const validatedData = insertProjectAllocationSchema.parse(allocationData);
      const created = await storage.createProjectAllocation(validatedData);
      
      // Auto-create or reactivate engagement when a person is assigned
      if (validatedData.personId) {
        await storage.ensureProjectEngagement(req.params.projectId, validatedData.personId);
      }
      
      res.status(201).json(created);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        console.error("[ERROR] Allocation validation errors:", error.errors);
        return res.status(400).json({ message: "Invalid allocation data", errors: error.errors });
      }
      console.error("[ERROR] Failed to create project allocation:", error);
      res.status(500).json({ message: "Failed to create project allocation" });
    }
  });

  app.put("/api/projects/:projectId/allocations/:id", requireAuth, async (req, res) => {
    try {
      const user = req.user!;
      const allocation = await storage.getProjectAllocation(req.params.id);
      
      if (!allocation) {
        return res.status(404).json({ message: "Allocation not found" });
      }
      
      // Check permissions: admin/pm can update any allocation,
      // regular users can only update status fields on their own assignments
      const isAdminOrPm = user.role === 'admin' || user.role === 'pm' || user.role === 'portfolio-manager' ||
                          user.role === 'global_admin' || user.role === 'constellation_admin';
      const isOwnAssignment = allocation.personId === user.id;
      
      if (!isAdminOrPm && !isOwnAssignment) {
        return res.status(403).json({ message: "Insufficient permissions" });
      }
      
      // If regular user updating their own assignment, only allow status-related fields
      let updateData = req.body;
      if (!isAdminOrPm && isOwnAssignment) {
        const allowedFields = ['status', 'startedDate', 'completedDate', 'notes'];
        updateData = {};
        for (const field of allowedFields) {
          if (req.body[field] !== undefined) {
            updateData[field] = req.body[field];
          }
        }
      }
      
      const updated = await storage.updateProjectAllocation(req.params.id, updateData);
      
      // Auto-create or reactivate engagement when a person is assigned
      if (req.body.personId) {
        await storage.ensureProjectEngagement(req.params.projectId, req.body.personId);
      }
      
      res.json(updated);
    } catch (error: any) {
      console.error("[ERROR] Failed to update project allocation:", error);
      res.status(500).json({ message: "Failed to update project allocation" });
    }
  });

  app.delete("/api/projects/:projectId/allocations/:id", requireAuth, requireRole(["admin", "pm", "portfolio-manager"]), async (req, res) => {
    try {
      await storage.deleteProjectAllocation(req.params.id);
      res.status(204).send();
    } catch (error: any) {
      console.error("[ERROR] Failed to delete project allocation:", error);
      res.status(500).json({ message: "Failed to delete project allocation" });
    }
  });

  app.post("/api/projects/:projectId/allocations/bulk-update", requireAuth, requireRole(["admin", "pm", "portfolio-manager"]), async (req, res) => {
    try {
      const updated = await storage.bulkUpdateProjectAllocations(req.params.projectId, req.body.allocations);
      
      // Auto-create or reactivate engagements for all assigned users
      const personIds = new Set<string>();
      for (const allocation of req.body.allocations) {
        if (allocation.personId) {
          personIds.add(allocation.personId);
        }
      }
      for (const personId of Array.from(personIds)) {
        await storage.ensureProjectEngagement(req.params.projectId, personId);
      }
      
      res.json(updated);
    } catch (error: any) {
      console.error("[ERROR] Failed to bulk update project allocations:", error);
      res.status(500).json({ message: "Failed to bulk update project allocations" });
    }
  });

  app.post("/api/projects/:projectId/allocations/reassign-role", requireAuth, requireRole(["admin", "pm", "portfolio-manager"]), async (req, res) => {
    try {
      const { projectId } = req.params;
      const { roleId, personId, roleInstanceLabel } = req.body;

      if (!roleId || !personId) {
        return res.status(400).json({ message: "roleId and personId are required" });
      }

      const allAllocations = await storage.getProjectAllocations(projectId);
      const matchingAllocations = allAllocations.filter((a: any) => {
        if (a.roleId !== roleId) return false;
        if (a.isBaseline) return false;
        if (roleInstanceLabel !== undefined && roleInstanceLabel !== null) {
          return (a.roleInstanceLabel || null) === (roleInstanceLabel || null);
        }
        return true;
      });

      if (matchingAllocations.length === 0) {
        return res.json({ updatedCount: 0, message: "No matching allocations found" });
      }

      const updatePromises = matchingAllocations.map((alloc: any) =>
        storage.updateProjectAllocation(alloc.id, {
          personId,
          pricingMode: "person",
        })
      );
      await Promise.all(updatePromises);

      await storage.ensureProjectEngagement(projectId, personId);

      res.json({ updatedCount: matchingAllocations.length });
    } catch (error: any) {
      console.error("[ERROR] Failed to reassign role:", error);
      res.status(500).json({ message: "Failed to reassign role allocations" });
    }
  });

  // Project Engagements - track user's overall engagement status on a project
  app.get("/api/projects/:projectId/engagements", requireAuth, async (req, res) => {
    try {
      const engagements = await storage.getProjectEngagements(req.params.projectId);
      res.json(engagements);
    } catch (error: any) {
      console.error("[ERROR] Failed to get project engagements:", error);
      res.status(500).json({ message: "Failed to get project engagements" });
    }
  });

  app.get("/api/projects/:projectId/engagements/:userId", requireAuth, async (req, res) => {
    try {
      const engagement = await storage.getProjectEngagement(req.params.projectId, req.params.userId);
      if (!engagement) {
        return res.status(404).json({ message: "Engagement not found" });
      }
      res.json(engagement);
    } catch (error: any) {
      console.error("[ERROR] Failed to get project engagement:", error);
      res.status(500).json({ message: "Failed to get project engagement" });
    }
  });

  app.post("/api/projects/:projectId/engagements", requireAuth, requireRole(["admin", "pm", "portfolio-manager"]), async (req, res) => {
    try {
      const { userId } = req.body;
      if (!userId) {
        return res.status(400).json({ message: "userId is required" });
      }
      const engagement = await storage.ensureProjectEngagement(req.params.projectId, userId);
      res.json(engagement);
    } catch (error: any) {
      console.error("[ERROR] Failed to create project engagement:", error);
      res.status(500).json({ message: "Failed to create project engagement" });
    }
  });

  app.patch("/api/projects/:projectId/engagements/:userId/complete", requireAuth, async (req, res) => {
    try {
      const user = req.user as any;
      const { projectId, userId } = req.params;
      const { notes, force } = req.body;
      
      // Check if user can complete this engagement (self, admin, PM, or portfolio-manager)
      const canComplete = user.id === userId || ['admin', 'pm', 'portfolio-manager'].includes(user.role);
      if (!canComplete) {
        return res.status(403).json({ message: "Not authorized to complete this engagement" });
      }
      
      // Check for active allocations unless force is true
      if (!force) {
        const hasActiveAllocations = await storage.checkUserHasActiveAllocations(projectId, userId);
        if (hasActiveAllocations) {
          return res.status(409).json({ 
            message: "User has active allocations", 
            hasActiveAllocations: true 
          });
        }
      }
      
      const engagement = await storage.markEngagementComplete(projectId, userId, user.id, notes);
      res.json(engagement);
    } catch (error: any) {
      console.error("[ERROR] Failed to complete engagement:", error);
      // Return specific error message if available
      const message = error.message === 'Engagement not found' 
        ? `No team membership found for this user on this project. The user may not be assigned to this project.`
        : error.message || "Failed to complete engagement";
      res.status(error.message === 'Engagement not found' ? 404 : 500).json({ message });
    }
  });

  app.patch("/api/projects/:projectId/engagements/:userId/reactivate", requireAuth, requireRole(["admin", "pm", "portfolio-manager"]), async (req, res) => {
    try {
      const engagement = await storage.ensureProjectEngagement(req.params.projectId, req.params.userId);
      res.json(engagement);
    } catch (error: any) {
      console.error("[ERROR] Failed to reactivate engagement:", error);
      res.status(500).json({ message: "Failed to reactivate engagement" });
    }
  });

  // Delete a team membership (for cleaning up erroneous entries like "Unknown User")
  app.delete("/api/projects/:projectId/engagements/:engagementId", requireAuth, requireRole(["admin", "pm", "portfolio-manager"]), async (req, res) => {
    try {
      await storage.deleteProjectEngagement(req.params.engagementId);
      res.status(204).send();
    } catch (error: any) {
      console.error("[ERROR] Failed to delete engagement:", error);
      res.status(500).json({ message: "Failed to delete team membership" });
    }
  });

  // Get user's active engagements (projects they're actively working on)
  app.get("/api/users/:userId/active-engagements", requireAuth, async (req, res) => {
    try {
      const engagements = await storage.getUserActiveEngagements(req.params.userId);
      res.json(engagements);
    } catch (error: any) {
      console.error("[ERROR] Failed to get user active engagements:", error);
      res.status(500).json({ message: "Failed to get user active engagements" });
    }
  });

  // Check if completing an allocation would leave a user with no active allocations
  app.get("/api/projects/:projectId/engagements/:userId/check-last-allocation", requireAuth, async (req, res) => {
    try {
      const { projectId, userId } = req.params;
      const { excludeAllocationId } = req.query;
      
      // Get active allocations for this user on this project
      const allocations = await storage.getProjectAllocations(projectId);
      const userActiveAllocations = allocations.filter((a: any) => 
        a.personId === userId && 
        ['open', 'in_progress'].includes(a.status) &&
        a.id !== excludeAllocationId
      );
      
      res.json({ 
        isLastAllocation: userActiveAllocations.length === 0,
        remainingAllocations: userActiveAllocations.length 
      });
    } catch (error: any) {
      console.error("[ERROR] Failed to check last allocation:", error);
      res.status(500).json({ message: "Failed to check last allocation" });
    }
  });

  // Generate AI-powered status report for a project
  app.post("/api/projects/:projectId/status-report", requireAuth, requireRole(["admin", "pm", "portfolio-manager", "executive"]), async (req, res) => {
    req.setTimeout(180000);
    res.setTimeout(180000);
    try {
      const { projectId } = req.params;
      const user = req.user as any;
      const { startDate, endDate, style } = req.body;

      if (!startDate || !endDate) {
        return res.status(400).json({ message: "startDate and endDate are required" });
      }

      const validStyles = ["executive_brief", "detailed_update", "client_facing"];
      const reportStyle = validStyles.includes(style) ? style : "detailed_update";

      const project = await storage.getProject(projectId);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      const [timeEntryData, expenseData, allocations, milestones, raiddData, deliverables] = await Promise.all([
        storage.getTimeEntries({ projectId, startDate, endDate }),
        storage.getExpenses({ projectId, startDate, endDate }),
        storage.getProjectAllocations(projectId),
        storage.getProjectMilestones(projectId),
        storage.getRaiddEntries(projectId, {}),
        storage.getProjectDeliverables(projectId),
      ]);

      const totalHours = timeEntryData.reduce((sum, te) => sum + Number(te.hours || 0), 0);
      const totalBillableHours = timeEntryData.filter(te => te.billable).reduce((sum, te) => sum + Number(te.hours || 0), 0);
      const totalExpenses = expenseData.reduce((sum, e) => sum + Number(e.amount || 0), 0);

      const teamMembers = new Map<string, { name: string; hours: number; activities: string[] }>();
      for (const te of timeEntryData) {
        const key = te.personId;
        const existing = teamMembers.get(key) || { name: te.person?.name || "Unknown", hours: 0, activities: [] };
        existing.hours += Number(te.hours || 0);
        if (te.description && !existing.activities.includes(te.description)) {
          existing.activities.push(te.description);
        }
        teamMembers.set(key, existing);
      }

      const teamSummary = Array.from(teamMembers.values())
        .sort((a, b) => b.hours - a.hours)
        .map(m => `- ${m.name}: ${m.hours.toFixed(1)} hours — ${m.activities.slice(0, 5).join("; ") || "No descriptions logged"}`)
        .join("\n");

      const expenseSummary = expenseData.length > 0
        ? expenseData.map(e => `- ${e.category}: $${Number(e.amount).toFixed(2)}${e.description ? ` (${e.description})` : ""}`).join("\n")
        : "No expenses recorded in this period.";

      const activeMilestones = milestones
        .filter(m => m.status !== "completed")
        .map(m => `- ${m.name} (${m.status})${m.dueDate ? ` — Due: ${m.dueDate}` : ""}`)
        .join("\n") || "No active milestones.";

      const completedMilestones = milestones
        .filter(m => m.status === "completed")
        .map(m => `- ${m.name} (completed)`)
        .join("\n") || "None completed in this period.";

      const activeTeamCount = allocations.filter((a: any) => a.status === "open" || a.status === "in_progress").length;
      const completedAllocations = allocations.filter((a: any) => a.status === "completed").length;

      const openStatuses = ["open", "in_progress"];
      const raiddByType = {
        risks: raiddData.filter(r => r.type === "risk"),
        issues: raiddData.filter(r => r.type === "issue"),
        decisions: raiddData.filter(r => r.type === "decision"),
        dependencies: raiddData.filter(r => r.type === "dependency"),
        actionItems: raiddData.filter(r => r.type === "action_item"),
      };

      const activeRisks = raiddByType.risks.filter(r => openStatuses.includes(r.status));
      const activeIssues = raiddByType.issues.filter(r => openStatuses.includes(r.status));
      const activeActionItems = raiddByType.actionItems.filter(r => openStatuses.includes(r.status));
      const activeDependencies = raiddByType.dependencies.filter(r => openStatuses.includes(r.status));
      const recentDecisions = raiddByType.decisions
        .filter(d => {
          const updatedAt = new Date(d.updatedAt);
          return updatedAt >= new Date(startDate) && updatedAt <= new Date(endDate + "T23:59:59");
        });

      const formatPriority = (p: string | null) => p ? ` [${p.toUpperCase()}]` : "";
      const formatOwner = (name?: string) => name ? ` — Owner: ${name}` : "";
      const formatDue = (d: string | null) => d ? ` — Due: ${d}` : "";

      const riskSummary = activeRisks.length > 0
        ? activeRisks.map(r => `- ${r.refNumber || ""} ${r.title}${formatPriority(r.priority)} (${r.status})${r.impact ? ` | Impact: ${r.impact}` : ""}${r.likelihood ? ` | Likelihood: ${r.likelihood}` : ""}${formatOwner(r.ownerName)}${r.mitigationPlan ? `\n  Mitigation: ${r.mitigationPlan}` : ""}`).join("\n")
        : "No active risks.";

      const issueSummary = activeIssues.length > 0
        ? activeIssues.map(r => `- ${r.refNumber || ""} ${r.title}${formatPriority(r.priority)} (${r.status})${formatOwner(r.ownerName)}${r.resolutionNotes ? `\n  Resolution notes: ${r.resolutionNotes}` : ""}`).join("\n")
        : "No active issues.";

      const actionItemSummary = activeActionItems.length > 0
        ? activeActionItems.map(r => `- ${r.refNumber || ""} ${r.title}${formatPriority(r.priority)} (${r.status})${formatOwner(r.assigneeName || r.ownerName)}${formatDue(r.dueDate)}`).join("\n")
        : "No open action items.";

      const dependencySummary = activeDependencies.length > 0
        ? activeDependencies.map(r => `- ${r.refNumber || ""} ${r.title}${formatPriority(r.priority)} (${r.status})${formatOwner(r.ownerName)}`).join("\n")
        : "No active dependencies.";

      const decisionSummary = recentDecisions.length > 0
        ? recentDecisions.map(r => `- ${r.refNumber || ""} ${r.title} (${r.status})${r.resolutionNotes ? ` — ${r.resolutionNotes}` : ""}`).join("\n")
        : "No decisions recorded in this period.";

      const raiddCounts = {
        openRisks: activeRisks.length,
        openIssues: activeIssues.length,
        openActionItems: activeActionItems.length,
        openDependencies: activeDependencies.length,
        recentDecisions: recentDecisions.length,
        totalEntries: raiddData.length,
        criticalItems: raiddData.filter(r => r.priority === "critical" && openStatuses.includes(r.status)).length,
        overdueActionItems: activeActionItems.filter(r => r.dueDate && new Date(r.dueDate) < new Date()).length,
      };

      // Build project plan context for AI
      const srEpics = await storage.getProjectEpics(projectId);
      const srEpicIds = srEpics.map(e => e.id);
      const srStagesMap = srEpicIds.length > 0 ? await storage.getProjectStagesByEpicIds(srEpicIds) : new Map();
      const srAllStages: Array<any> = [];
      for (const epic of srEpics) {
        const stages = srStagesMap.get(epic.id) || [];
        for (const stage of stages) {
          srAllStages.push({ ...stage, epicId: epic.id });
        }
      }

      const srStageDateMap = new Map<string, { startDate: string; endDate: string; assignees: string[] }>();
      for (const alloc of allocations) {
        const sid = (alloc as any).projectStageId;
        if (!sid || !(alloc as any).plannedStartDate) continue;
        const aStart = (alloc as any).plannedStartDate;
        const aEnd = (alloc as any).plannedEndDate || aStart;
        const existing = srStageDateMap.get(sid);
        const assigneeName = (alloc as any).userName || (alloc as any).user?.name || '';
        if (!existing) {
          srStageDateMap.set(sid, { startDate: aStart, endDate: aEnd, assignees: assigneeName ? [assigneeName] : [] });
        } else {
          if (aStart < existing.startDate) existing.startDate = aStart;
          if (aEnd > existing.endDate) existing.endDate = aEnd;
          if (assigneeName && !existing.assignees.includes(assigneeName)) existing.assignees.push(assigneeName);
        }
      }

      const srEpicStageMap = new Map<string, { epicName: string; epicOrder: number; stages: Array<{ name: string; order: number; startDate: string; endDate: string; assignees: string[] }> }>();
      for (const epic of srEpics) {
        srEpicStageMap.set(epic.id, { epicName: epic.name, epicOrder: epic.order, stages: [] });
      }
      for (const stage of srAllStages) {
        const epicEntry = srEpicStageMap.get(stage.epicId);
        if (epicEntry) {
          const dates = srStageDateMap.get(stage.id);
          epicEntry.stages.push({
            name: stage.name,
            order: stage.order,
            startDate: dates?.startDate || '',
            endDate: dates?.endDate || '',
            assignees: dates?.assignees || [],
          });
        }
      }
      srEpicStageMap.forEach(e => e.stages.sort((a, b) => a.order - b.order));

      const srPriorActivities: string[] = [];
      const srCurrentActivities: string[] = [];
      const srUpcomingActivities: string[] = [];
      for (const alloc of allocations) {
        const taskDesc = (alloc as any).taskDescription || (alloc as any).activity?.name || '';
        const epicName = (alloc as any).epic?.name || '';
        const stageName = (alloc as any).stage?.name || '';
        const personName = (alloc as any).person?.name || (alloc as any).resourceName || '';
        const roleName = (alloc as any).role?.name || '';
        const allocStatus = (alloc as any).status || 'open';
        const allocStart = (alloc as any).plannedStartDate || '';
        const allocEnd = (alloc as any).plannedEndDate || allocStart;
        const completedDate = (alloc as any).completedDate || '';

        if (!taskDesc && !epicName) continue;

        const taskLabel = taskDesc || `${epicName}${stageName ? ' > ' + stageName : ''}`;
        const who = personName ? ` (${personName}${roleName ? ', ' + roleName : ''})` : (roleName ? ` (${roleName})` : '');
        const dateInfo = allocStart ? ` [${allocStart} to ${allocEnd}]` : '';
        const context = epicName && taskDesc ? ` — ${epicName}${stageName ? ' > ' + stageName : ''}` : '';
        const label = `${taskLabel}${who}${context}${dateInfo}`;

        if (allocStatus === 'completed' || (completedDate && completedDate <= endDate)) {
          srPriorActivities.push(label);
        } else if (allocStatus === 'in_progress' || (allocStart && allocStart <= endDate && allocEnd >= startDate)) {
          srCurrentActivities.push(label);
        } else if (allocStart && allocStart > endDate) {
          srUpcomingActivities.push(label);
        } else if (allocStart && allocEnd < startDate) {
          srPriorActivities.push(label);
        }
      }

      const srSortedEpics = Array.from(srEpicStageMap.values()).sort((a, b) => a.epicOrder - b.epicOrder);

      const srProjectPlanSummary = srEpics.length > 0
        ? srSortedEpics.map(e => {
            const stageList = e.stages.map(s => {
              const dateRange = s.startDate ? ` [${s.startDate} to ${s.endDate}]` : ' [no dates]';
              const team = s.assignees.length > 0 ? ` — ${s.assignees.join(', ')}` : '';
              return `    - ${s.name}${dateRange}${team}`;
            }).join('\n');
            return `  ${e.epicName}:\n${stageList || '    (no stages)'}`;
          }).join('\n')
        : 'No project plan defined.';

      const styleInstructions: Record<string, string> = {
        executive_brief: "Write a concise executive summary (3-5 paragraphs). Focus on key accomplishments, risks, issues, and next steps. Use bullet points for highlights. Keep it to roughly 400-600 words. This is for senior leadership who want a quick overview. You MUST include a dedicated 'RAIDD Summary' section that lists all active Risks, Issues, open Action Items, active Dependencies, and recent Decisions from the RAIDD log data provided. Highlight any critical or high-priority items prominently. Do not omit or summarize away individual RAIDD entries — list each one.",
        detailed_update: "Write a comprehensive project status update with clear sections: Summary, Work Completed, Team Activity, Expenses, Milestones, and Next Steps. You MUST include a dedicated 'RAIDD Log' section with subsections for each category: Risks, Issues, Action Items, Dependencies, and Decisions. List every active entry from the RAIDD log data provided — include its reference number, title, priority, status, owner, and due date where available. Include mitigation plans for risks and resolution notes for issues. Do not omit or summarize away any RAIDD entries. This is for project managers and internal stakeholders. Target 600-1000 words.",
        client_facing: "Write a professional, polished status update suitable for sharing directly with the client. Focus on deliverables, progress, and value delivered. Avoid internal metrics like cost rates or margins. You MUST include a 'Risks, Issues & Key Decisions' section that covers all active Risks, Issues, and recent Decisions from the RAIDD log data provided. List each item with its title, priority, and status. Also include open Action Items and Dependencies that affect the client. Keep the tone positive and confident but do not omit RAIDD entries. Include sections for Progress Summary, Key Accomplishments, Risks Issues & Key Decisions, and Upcoming Activities. Target 500-700 words.",
      };

      const systemPrompt = `You are a professional consulting project manager writing a status report. ${styleInstructions[reportStyle]}

Format the output as clean markdown with headers (##), bullet points, and bold text for emphasis. Do not include a title header — the system will add the project name and period.

CRITICAL: The RAIDD log (Risks, Action Items, Issues, Decisions, Dependencies) section is mandatory. Always include every RAIDD entry provided in the data. Never skip, consolidate, or omit individual RAIDD items even if the rest of the report is brief.

CRITICAL: Use the COMPLETED TASKS, IN-PROGRESS TASKS, and UPCOMING TASKS data to populate accomplishments and upcoming activities. Each task listed is an individual assignment with a description, person, role, epic/stage context, and dates. Group related tasks into coherent narrative descriptions with business value. NEVER say "no accomplishments" or "no upcoming activities" when task data is available. Transform raw task names into professional, client-appropriate descriptions.`;

      const userMessage = `Generate a status report for the following project activity:

PROJECT: ${project.name}
CLIENT: ${project.client?.name || "Unknown"}
PERIOD: ${startDate} to ${endDate}
STATUS: ${project.status}
COMMERCIAL SCHEME: ${project.commercialScheme}
${project.description ? `DESCRIPTION: ${project.description}` : ""}

SUMMARY METRICS:
- Total Hours Logged: ${totalHours.toFixed(1)} (${totalBillableHours.toFixed(1)} billable)
- Total Expenses: $${totalExpenses.toFixed(2)}
- Active Assignments: ${activeTeamCount}
- Completed Assignments: ${completedAllocations}

TEAM ACTIVITY:
${teamSummary || "No time entries recorded in this period."}

EXPENSES:
${expenseSummary}

MILESTONES — Active:
${activeMilestones}

MILESTONES — Completed:
${completedMilestones}

PROJECT PLAN (Epics & Stages with scheduled dates):
${srProjectPlanSummary}

COMPLETED TASKS — finished before or during this period (${srPriorActivities.length}):
${srPriorActivities.length > 0 ? srPriorActivities.map(a => `- ${a}`).join('\n') : 'None.'}

IN-PROGRESS TASKS — active during this period (${srCurrentActivities.length}):
${srCurrentActivities.length > 0 ? srCurrentActivities.map(a => `- ${a}`).join('\n') : 'None.'}

UPCOMING TASKS — scheduled after this period (${srUpcomingActivities.length}):
${srUpcomingActivities.length > 0 ? srUpcomingActivities.map(a => `- ${a}`).join('\n') : 'None.'}

DELIVERABLES (${deliverables.length} total):
${deliverables.length > 0 ? deliverables.map(d => `- ${d.name} [${d.status}]${d.ownerName ? ` — Owner: ${d.ownerName}` : ''}${d.targetDate ? ` — Target: ${d.targetDate}` : ''}${d.deliveredDate ? ` — Delivered: ${d.deliveredDate}` : ''}`).join('\n') : 'No deliverables tracked.'}

RAIDD LOG — Active Risks (${activeRisks.length}):
${riskSummary}

RAIDD LOG — Active Issues (${activeIssues.length}):
${issueSummary}

RAIDD LOG — Open Action Items (${activeActionItems.length}):
${actionItemSummary}

RAIDD LOG — Active Dependencies (${activeDependencies.length}):
${dependencySummary}

RAIDD LOG — Decisions This Period (${recentDecisions.length}):
${decisionSummary}${raiddCounts.overdueActionItems > 0 ? `\n\n⚠️ OVERDUE ACTION ITEMS: ${raiddCounts.overdueActionItems} action item(s) are past their due date.` : ""}${raiddCounts.criticalItems > 0 ? `\n⚠️ CRITICAL ITEMS: ${raiddCounts.criticalItems} item(s) are flagged as critical priority.` : ""}`;

      const { aiService, buildGroundingContext } = await import("./services/ai-service.js");
      const srTenantId = (req.user as any)?.tenantId;
      const srGroundingDocs = srTenantId
        ? await storage.getActiveGroundingDocumentsForTenant(srTenantId)
        : await storage.getActiveGroundingDocuments();
      const srGroundingCtx = buildGroundingContext(srGroundingDocs, 'status_report');

      const maxTokensByStyle: Record<string, number> = {
        executive_brief: 4096,
        detailed_update: 8192,
        client_facing: 4096,
      };
      const result = await aiService.customPrompt(systemPrompt, userMessage, {
        temperature: 0.6,
        maxTokens: maxTokensByStyle[reportStyle] || 4096,
        groundingContext: srGroundingCtx,
        usageCtx: { tenantId: srTenantId, userId: (req.user as any)?.id, feature: 'status_report' as any },
      });

      const reportMetadata = {
        projectName: project.name,
        clientName: project.client?.name || "Unknown",
        startDate,
        endDate,
        style: reportStyle,
        totalHours,
        totalBillableHours,
        totalExpenses,
        teamMemberCount: teamMembers.size,
        generatedAt: new Date().toISOString(),
        generatedBy: user.name || user.email,
        raidd: raiddCounts,
      };

      const savedReport = await storage.createStatusReport({
        projectId,
        tenantId: user.tenantId || null,
        title: `${project.name} Status Report — ${startDate} to ${endDate}`,
        reportType: "text",
        reportStyle,
        periodStart: startDate,
        periodEnd: endDate,
        reportContent: result.content,
        status: "draft",
        metadata: reportMetadata,
        generatedBy: user.id,
      });

      res.json({
        report: result.content,
        savedReportId: savedReport.id,
        metadata: reportMetadata,
      });
    } catch (error: any) {
      console.error("[STATUS-REPORT] Failed to generate status report:", error);
      res.status(500).json({ message: "Failed to generate status report: " + error.message });
    }
  });

  // List saved status reports for a project
  app.get("/api/projects/:projectId/status-reports", requireAuth, async (req, res) => {
    try {
      const { projectId } = req.params;
      const user = req.user as any;
      const project = await storage.getProject(projectId);
      if (!project) return res.status(404).json({ message: "Project not found" });
      const tenantId = user.tenantId;
      if (tenantId && project.tenantId && project.tenantId !== tenantId) {
        return res.status(404).json({ message: "Project not found" });
      }
      const reports = await storage.getStatusReports(projectId, tenantId || project.tenantId || "");
      res.json(reports);
    } catch (error: any) {
      console.error("[STATUS-REPORTS] Failed to list status reports:", error);
      res.status(500).json({ message: "Failed to list status reports" });
    }
  });

  // Get a single saved status report
  app.get("/api/projects/:projectId/status-reports/:reportId", requireAuth, async (req, res) => {
    try {
      const { projectId, reportId } = req.params;
      const user = req.user as any;
      const report = await storage.getStatusReport(reportId);
      if (!report || report.projectId !== projectId) return res.status(404).json({ message: "Status report not found" });
      if (user.tenantId && report.tenantId && report.tenantId !== user.tenantId) {
        return res.status(404).json({ message: "Status report not found" });
      }
      res.json(report);
    } catch (error: any) {
      console.error("[STATUS-REPORTS] Failed to get status report:", error);
      res.status(500).json({ message: "Failed to get status report" });
    }
  });

  // Update a saved status report (e.g., mark as final, edit content)
  app.patch("/api/projects/:projectId/status-reports/:reportId", requireAuth, requireRole(["admin", "pm", "portfolio-manager", "executive"]), async (req, res) => {
    try {
      const { projectId, reportId } = req.params;
      const user = req.user as any;
      const existing = await storage.getStatusReport(reportId);
      if (!existing || existing.projectId !== projectId) return res.status(404).json({ message: "Status report not found" });
      if (user.tenantId && existing.tenantId && existing.tenantId !== user.tenantId) {
        return res.status(404).json({ message: "Status report not found" });
      }
      const { status, reportContent, title } = req.body;
      const updates: any = {};
      if (status) updates.status = status;
      if (reportContent !== undefined) updates.reportContent = reportContent;
      if (title) updates.title = title;
      const updated = await storage.updateStatusReport(reportId, updates);
      res.json(updated);
    } catch (error: any) {
      console.error("[STATUS-REPORTS] Failed to update status report:", error);
      res.status(500).json({ message: "Failed to update status report" });
    }
  });

  // Delete a saved status report
  app.delete("/api/projects/:projectId/status-reports/:reportId", requireAuth, requireRole(["admin", "pm", "portfolio-manager", "executive"]), async (req, res) => {
    try {
      const { projectId, reportId } = req.params;
      const user = req.user as any;
      const existing = await storage.getStatusReport(reportId);
      if (!existing || existing.projectId !== projectId) return res.status(404).json({ message: "Status report not found" });
      if (user.tenantId && existing.tenantId && existing.tenantId !== user.tenantId) {
        return res.status(404).json({ message: "Status report not found" });
      }
      await storage.deleteStatusReport(reportId);
      res.json({ success: true });
    } catch (error: any) {
      console.error("[STATUS-REPORTS] Failed to delete status report:", error);
      res.status(500).json({ message: "Failed to delete status report" });
    }
  });

  // Email a status report
  app.post("/api/projects/:projectId/status-report/email", requireAuth, requireRole(["admin", "pm", "portfolio-manager", "executive"]), async (req, res) => {
    try {
      const { projectId } = req.params;
      const user = req.user as any;
      const { recipientEmail, recipientName, subject, reportContent, projectName, periodLabel } = req.body;

      if (!recipientEmail || !reportContent) {
        return res.status(400).json({ message: "recipientEmail and reportContent are required" });
      }

      let tenantBranding: any = {};
      if (user.tenantId) {
        const tenant = await storage.getTenant(user.tenantId);
        if (tenant) {
          tenantBranding = {
            emailHeaderUrl: tenant.emailHeaderUrl,
            companyName: tenant.companyName,
          };
        }
      }

      const htmlContent = reportContent
        .replace(/^## (.*$)/gm, '<h2 style="color: #1a1a2e; margin-top: 20px; margin-bottom: 10px;">$1</h2>')
        .replace(/^### (.*$)/gm, '<h3 style="color: #333; margin-top: 16px; margin-bottom: 8px;">$1</h3>')
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/^- (.*$)/gm, '<li style="margin-bottom: 4px;">$1</li>')
        .replace(/(<li.*<\/li>\n?)+/g, '<ul style="margin: 8px 0; padding-left: 20px;">$&</ul>')
        .replace(/\n\n/g, '<br/><br/>')
        .replace(/\n/g, '<br/>');

      const emailBody = `
        <div style="font-family: Arial, sans-serif; max-width: 700px; margin: 0 auto;">
          <div style="background: #1a1a2e; color: white; padding: 20px; border-radius: 8px 8px 0 0;">
            <h1 style="margin: 0; font-size: 20px;">Project Status Report</h1>
            <p style="margin: 8px 0 0; opacity: 0.8;">${projectName || "Project"} — ${periodLabel || ""}</p>
          </div>
          <div style="padding: 24px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
            ${htmlContent}
            <hr style="margin: 24px 0; border: none; border-top: 1px solid #e5e7eb;" />
            <p style="color: #666; font-size: 12px;">
              Generated by ${user.name || user.email} via Constellation
            </p>
          </div>
        </div>
      `;

      await emailService.sendEmail({
        to: { email: recipientEmail, name: recipientName || recipientEmail },
        subject: subject || `Status Report: ${projectName || "Project"} — ${periodLabel || ""}`,
        body: emailBody,
      });

      res.json({ success: true, message: "Status report emailed successfully" });
    } catch (error: any) {
      console.error("[STATUS-REPORT] Failed to email status report:", error);
      res.status(500).json({ message: "Failed to email status report: " + error.message });
    }
  });

  // Create/connect project to Planner
  app.post("/api/projects/:projectId/planner-connection", requireAuth, requireRole(["admin", "pm", "portfolio-manager"]), async (req, res) => {
    try {
      const { projectId } = req.params;
      const { planId, planTitle, planWebUrl, groupId, groupName, channelId, channelName, syncDirection } = req.body;
      const user = req.user as any;
      
      if (!planId) {
        return res.status(400).json({ message: "planId is required" });
      }
      
      // Check if connection already exists
      const existing = await storage.getProjectPlannerConnection(projectId);
      if (existing) {
        return res.status(409).json({ message: "Project already has a Planner connection" });
      }
      
      const connection = await storage.createProjectPlannerConnection({
        projectId,
        planId,
        planTitle: planTitle || null,
        planWebUrl: planWebUrl || null,
        groupId: groupId || null,
        groupName: groupName || null,
        channelId: channelId || null,
        channelName: channelName || null,
        syncEnabled: true,
        syncDirection: syncDirection || 'bidirectional',
        connectedBy: user.id
      });
      
      res.json(connection);
    } catch (error: any) {
      console.error("[PLANNER] Failed to create connection:", error);
      res.status(500).json({ message: "Failed to connect to Planner: " + error.message });
    }
  });

  // Update Planner connection settings
  app.patch("/api/projects/:projectId/planner-connection", requireAuth, requireRole(["admin", "pm", "portfolio-manager"]), async (req, res) => {
    try {
      const connection = await storage.getProjectPlannerConnection(req.params.projectId);
      if (!connection) {
        return res.status(404).json({ message: "Planner connection not found" });
      }
      
      const { syncEnabled, syncDirection, autoAddMembers } = req.body;
      const updates: any = {};
      if (syncEnabled !== undefined) updates.syncEnabled = syncEnabled;
      if (syncDirection) updates.syncDirection = syncDirection;
      if (autoAddMembers !== undefined) updates.autoAddMembers = autoAddMembers;
      
      const updated = await storage.updateProjectPlannerConnection(connection.id, updates);
      res.json(updated);
    } catch (error: any) {
      console.error("[PLANNER] Failed to update connection:", error);
      res.status(500).json({ message: "Failed to update Planner connection" });
    }
  });

  // Disconnect project from Planner
  app.delete("/api/projects/:projectId/planner-connection", requireAuth, requireRole(["admin", "pm", "portfolio-manager"]), async (req, res) => {
    try {
      await storage.deleteProjectPlannerConnection(req.params.projectId);
      res.status(204).send();
    } catch (error: any) {
      console.error("[PLANNER] Failed to delete connection:", error);
      res.status(500).json({ message: "Failed to disconnect from Planner" });
    }
  });

  // Trigger sync for a project
  app.post("/api/projects/:projectId/planner-sync", requireAuth, requireRole(["admin", "pm", "portfolio-manager"]), async (req, res) => {
    try {
      const { plannerService } = await import('./services/planner-service');
      const { projectId } = req.params;
      
      const connection = await storage.getProjectPlannerConnection(projectId);
      if (!connection) {
        return res.status(404).json({ message: "Planner connection not found" });
      }
      
      if (!connection.syncEnabled) {
        return res.status(400).json({ message: "Sync is disabled for this connection" });
      }
      
      // Get project allocations
      const allocations = await storage.getProjectAllocations(projectId);
      const existingSyncs = await storage.getPlannerTaskSyncsByConnection(connection.id);
      
      // Get buckets for the plan
      const buckets = await plannerService.listBuckets(connection.planId);
      
      // Pre-create Planner buckets for all project stages so they appear even if no allocations reference them yet
      const projectEpicsList = await storage.getProjectEpics(projectId);
      for (const epic of projectEpicsList) {
        const stages = await storage.getProjectStages(epic.id);
        for (const stage of stages) {
          try {
            await plannerService.getOrCreateBucket(connection.planId, stage.name);
          } catch (bucketErr: any) {
            console.warn('[PLANNER] Failed to pre-create bucket for stage:', stage.name, bucketErr.message);
          }
        }
      }
      
      let created = 0;
      let updated = 0;
      let errors: string[] = [];
      
      for (const allocation of allocations) {
        try {
          // Find if we have a sync record for this allocation
          const syncRecord = existingSyncs.find(s => s.allocationId === allocation.id);
          
          // Build task title from allocation data
          let taskTitle = allocation.taskDescription || '';
          if (!taskTitle && allocation.workstream) {
            taskTitle = typeof allocation.workstream === 'string' ? allocation.workstream : allocation.workstream.name;
          }
          if (!taskTitle) {
            taskTitle = `Week ${allocation.weekNumber} Task`;
          }
          
          // Use Stage as bucket (or fallback to "Unassigned" if no stage)
          // First check if stage object is populated, if not but projectStageId exists, fetch it
          let stageName = 'Unassigned';
          if (allocation.stage?.name) {
            stageName = allocation.stage.name;
          } else if (allocation.projectStageId) {
            // Fallback: fetch stage directly if joined data is missing
            const stage = await storage.getProjectStage(allocation.projectStageId);
            if (stage?.name) {
              stageName = stage.name;
            }
          }
          console.log('[PLANNER] Allocation stage mapping:', {
            allocationId: allocation.id,
            projectStageId: allocation.projectStageId,
            stageObject: allocation.stage,
            stageName
          });
          const bucket = await plannerService.getOrCreateBucket(connection.planId, stageName);
          
          // Get Azure user ID if person is assigned - look up by email (case-insensitive)
          let assigneeIds: string[] = [];
          console.log('[PLANNER] Looking up Azure user for allocation:', {
            personId: allocation.personId,
            personEmail: allocation.person?.email,
            personName: allocation.person?.name
          });
          
          if (allocation.person?.email) {
            // First try to find Azure mapping by user email (case-insensitive)
            let azureMapping = await storage.getUserAzureMappingByEmail(allocation.person.email);
            
            if (!azureMapping && allocation.personId) {
              // Fallback to direct user ID mapping
              azureMapping = await storage.getUserAzureMapping(allocation.personId);
            }
            
            if (azureMapping) {
              console.log('[PLANNER] Found Azure mapping:', azureMapping.azureUserId);
              assigneeIds = [azureMapping.azureUserId];
            } else {
              // Auto-discover: Try to find Azure AD user by email and create mapping
              console.log('[PLANNER] No mapping found, attempting auto-discovery for:', allocation.person.email);
              try {
                const azureUser = await plannerService.findUserByEmail(allocation.person.email);
                if (azureUser && allocation.personId) {
                  console.log('[PLANNER] Found Azure AD user, creating mapping:', azureUser.id, azureUser.displayName);
                  await storage.createUserAzureMapping({
                    userId: allocation.personId,
                    azureUserId: azureUser.id,
                    azureUserPrincipalName: azureUser.userPrincipalName,
                    azureDisplayName: azureUser.displayName,
                    mappingMethod: 'auto_discovered',
                    verifiedAt: new Date()
                  });
                  assigneeIds = [azureUser.id];
                  
                  // Auto-add to Team if enabled and we have a groupId
                  if (connection.autoAddMembers && connection.groupId) {
                    console.log('[PLANNER] Auto-add enabled, adding user to Team:', azureUser.id);
                    const addResult = await plannerService.addUserToGroup(connection.groupId, azureUser.id);
                    if (addResult.success) {
                      console.log('[PLANNER] Successfully added user to Team');
                    } else {
                      console.warn('[PLANNER] Failed to add user to Team:', addResult.error);
                      errors.push(`Could not add ${azureUser.displayName} to Team: ${addResult.error}`);
                    }
                  }
                } else {
                  console.log('[PLANNER] Auto-discovery failed - no Azure AD user found for:', allocation.person.email);
                }
              } catch (discoverErr: any) {
                console.warn('[PLANNER] Auto-discovery error:', discoverErr.message);
              }
            }
          } else if (allocation.personId) {
            // No email on person object, try direct user mapping
            const azureMapping = await storage.getUserAzureMapping(allocation.personId);
            if (azureMapping) {
              console.log('[PLANNER] Found Azure mapping by personId:', azureMapping.azureUserId);
              assigneeIds = [azureMapping.azureUserId];
            } else {
              console.log('[PLANNER] No email on person and no Azure mapping found for personId:', allocation.personId);
            }
          } else {
            console.log('[PLANNER] No person assigned to allocation:', allocation.id);
          }
          
          // Get task notes with Constellation assignment link and hours
          const baseUrl = process.env.APP_PUBLIC_URL || 'https://constellation.synozur.com';
          // Link directly to the specific assignment in the delivery/assignments tab
          const assignmentLink = `${baseUrl}/projects/${projectId}?tab=delivery&assignmentId=${allocation.id}`;
          const originalNotes = allocation.notes || allocation.taskDescription || '';
          const hoursStr = allocation.hours ? `HOURS: ${allocation.hours}` : '';
          
          // Build task notes: Link, Hours, then original notes
          const notesParts = [
            `View in Constellation: ${assignmentLink}`,
            hoursStr,
            originalNotes
          ].filter(Boolean);
          const taskNotes = notesParts.join('\n\n').trim();
          
          // Determine completion status
          let percentComplete = 0;
          if (allocation.status === 'completed') {
            percentComplete = 100;
          } else if (allocation.status === 'in_progress') {
            percentComplete = 50;
          }
          
          if (syncRecord) {
            // Validate and prepare dates for Planner update
            let updateStartDateTime: string | null = allocation.plannedStartDate || null;
            let updateDueDateTime: string | null = allocation.plannedEndDate || null;
            
            // Validate dates: ensure due date is not before start date
            if (updateStartDateTime && updateDueDateTime) {
              const startDate = new Date(updateStartDateTime);
              const endDate = new Date(updateDueDateTime);
              if (endDate < startDate) {
                console.warn('[PLANNER] Due date before start date on update, swapping for allocation:', allocation.id);
                [updateStartDateTime, updateDueDateTime] = [updateDueDateTime, updateStartDateTime];
              }
            }
            
            // Update existing task
            const task = await plannerService.getTask(syncRecord.taskId);
            if (task) {
              // Guard: detect if Planner has been modified remotely since last sync.
              // If the ETag has changed and the remote percentComplete differs from what local
              // would push, treat the remote as authoritative for status and preserve it —
              // the inbound phase will reconcile the local record accordingly.
              // Also preserve remote if it is simply ahead (e.g. completed in Planner) even
              // without a tracked ETag.
              const remotePercentComplete = task.percentComplete ?? 0;
              const etagChanged = !!syncRecord.remoteEtag && task['@odata.etag'] !== syncRecord.remoteEtag;
              const remoteStatusDiffers = remotePercentComplete !== percentComplete;
              
              let outboundPercentComplete = percentComplete;
              if (etagChanged && remoteStatusDiffers) {
                // ETag changed and remote status differs — remote wins, preserve it
                console.log(
                  `[PLANNER] Remote change detected for allocation ${allocation.id}: ` +
                  `ETag changed, Planner has ${remotePercentComplete}% vs local ${percentComplete}%. ` +
                  `Preserving remote status; inbound phase will reconcile local.`
                );
                outboundPercentComplete = remotePercentComplete;
              } else if (!etagChanged && remotePercentComplete > percentComplete) {
                // No ETag tracking yet but Planner is ahead — still preserve remote
                console.log(
                  `[PLANNER] Planner is ahead for allocation ${allocation.id}: ` +
                  `${remotePercentComplete}% > local ${percentComplete}%. Preserving remote status.`
                );
                outboundPercentComplete = remotePercentComplete;
              }

              await plannerService.updateTask(syncRecord.taskId, task['@odata.etag'] || '', {
                title: taskTitle,
                bucketId: bucket.id,
                startDateTime: updateStartDateTime,
                dueDateTime: updateDueDateTime,
                percentComplete: outboundPercentComplete,
                assigneeIds
              });
              
              // Always update task notes/description (includes Constellation link)
              try {
                const taskDetails = await plannerService.getTaskDetails(syncRecord.taskId);
                if (taskDetails) {
                  await plannerService.updateTaskDetails(syncRecord.taskId, taskDetails['@odata.etag'] || '', taskNotes);
                }
              } catch (notesErr: any) {
                console.warn('[PLANNER] Failed to update task notes:', notesErr.message);
              }
              
              await storage.updatePlannerTaskSync(syncRecord.id, {
                taskTitle,
                bucketId: bucket.id,
                bucketName: stageName,
                lastSyncedAt: new Date(),
                syncStatus: 'synced',
                localVersion: syncRecord.localVersion + 1,
                remoteEtag: task['@odata.etag']
              });
              
              updated++;
            }
          } else {
            // Validate and prepare dates for Planner
            let startDateTime: string | undefined = allocation.plannedStartDate || undefined;
            let dueDateTime: string | undefined = allocation.plannedEndDate || undefined;
            
            // Validate dates: ensure due date is not before start date
            if (startDateTime && dueDateTime) {
              const startDate = new Date(startDateTime);
              const endDate = new Date(dueDateTime);
              if (endDate < startDate) {
                console.warn('[PLANNER] Due date before start date, swapping for allocation:', allocation.id);
                // Swap the dates
                [startDateTime, dueDateTime] = [dueDateTime, startDateTime];
              }
            }
            
            // Create new task
            const newTask = await plannerService.createTask({
              planId: connection.planId,
              bucketId: bucket.id,
              title: taskTitle,
              startDateTime,
              dueDateTime,
              assigneeIds,
              percentComplete
            });
            
            // Add task notes/description with Constellation link
            try {
              const taskDetails = await plannerService.getTaskDetails(newTask.id);
              if (taskDetails) {
                await plannerService.updateTaskDetails(newTask.id, taskDetails['@odata.etag'] || '', taskNotes);
              }
            } catch (notesErr: any) {
              console.warn('[PLANNER] Failed to add task notes:', notesErr.message);
            }
            
            await storage.createPlannerTaskSync({
              connectionId: connection.id,
              allocationId: allocation.id,
              taskId: newTask.id,
              taskTitle: taskTitle,
              bucketId: bucket.id,
              bucketName: stageName,
              syncStatus: 'synced',
              remoteEtag: newTask['@odata.etag']
            });
            
            created++;
          }
        } catch (err: any) {
          errors.push(`Allocation ${allocation.id}: ${err.message}`);
        }
      }
      
      // ============ INBOUND SYNC (Planner → SCDP) ============
      // Fetch current state of all synced tasks and update allocations accordingly
      let inboundUpdated = 0;
      let inboundDeleted = 0;
      const refreshedSyncs = await storage.getPlannerTaskSyncsByConnection(connection.id);
      
      console.log('[PLANNER] Inbound sync: checking', refreshedSyncs.length, 'synced tasks');
      
      for (const syncRecord of refreshedSyncs) {
        try {
          const task = await plannerService.getTask(syncRecord.taskId);
          
          if (!task) {
            // Task was deleted in Planner - mark sync record as deleted
            console.log('[PLANNER] Task deleted in Planner:', syncRecord.taskId);
            await storage.updatePlannerTaskSync(syncRecord.id, {
              syncStatus: 'deleted_remote',
              lastSyncedAt: new Date()
            });
            inboundDeleted++;
            continue;
          }
          
          // Check if task status changed in Planner
          const taskPercentComplete = task.percentComplete || 0;
          let newStatus: string | null = null;
          
          if (taskPercentComplete === 100) {
            newStatus = 'completed';
          } else if (taskPercentComplete > 0 && taskPercentComplete < 100) {
            // Any progress between 1-99% means in progress
            newStatus = 'in_progress';
          } else if (taskPercentComplete === 0) {
            newStatus = 'open';
          }
          
          console.log('[PLANNER] Task', syncRecord.taskId, 'percentComplete:', taskPercentComplete, '→ status:', newStatus);
          
          // Get current allocation to compare
          const allocation = allocations.find(a => a.id === syncRecord.allocationId);
          console.log('[PLANNER] Allocation', syncRecord.allocationId, 'current status:', allocation?.status, 'new status:', newStatus);
          
          if (allocation && newStatus && allocation.status !== newStatus) {
            // Update allocation status based on Planner task
            const updateData: any = { status: newStatus };
            
            // Set dates based on status change
            if (newStatus === 'in_progress' && !allocation.startedDate) {
              updateData.startedDate = new Date().toISOString().split('T')[0];
            }
            if (newStatus === 'completed' && !allocation.completedDate) {
              updateData.completedDate = new Date().toISOString().split('T')[0];
            }
            
            await storage.updateProjectAllocation(allocation.id, updateData);
            inboundUpdated++;
          }
          
          // Sync dates from Planner (including clearing dates if removed in Planner)
          if (allocation) {
            const taskStart = task.startDateTime ? task.startDateTime.split('T')[0] : null;
            const taskDue = task.dueDateTime ? task.dueDateTime.split('T')[0] : null;
            
            if (allocation.plannedStartDate !== taskStart) {
              await storage.updateProjectAllocation(allocation.id, {
                plannedStartDate: taskStart
              });
            }
            if (allocation.plannedEndDate !== taskDue) {
              await storage.updateProjectAllocation(allocation.id, {
                plannedEndDate: taskDue
              });
            }
          }
          
          // Sync assignment from Planner - if someone was assigned in Planner
          if (allocation && task.assignments) {
            const assigneeIds = Object.keys(task.assignments).filter(
              id => task.assignments![id]['@odata.type'] === '#microsoft.graph.plannerAssignment'
            );
            
            if (assigneeIds.length > 0 && !allocation.personId) {
              // Task has assignee in Planner but not in Constellation - sync it
              const plannerAssigneeId = assigneeIds[0]; // Take first assignee
              console.log('[PLANNER] Task has assignee in Planner:', plannerAssigneeId, 'but no personId in Constellation');
              
              // Check if we have an Azure mapping for this user
              let existingMapping = await storage.getUserAzureMappingByAzureId(plannerAssigneeId);
              
              if (existingMapping) {
                // We have a Constellation user for this Azure user - assign them
                console.log('[PLANNER] Found existing user mapping, assigning to allocation:', existingMapping.userId);
                await storage.updateProjectAllocation(allocation.id, {
                  personId: existingMapping.userId,
                  pricingMode: 'person'
                });
                inboundUpdated++;
              } else {
                // No mapping - try to look up user in Azure AD and match to existing Constellation user
                try {
                  const azureUser = await plannerService.findUserById(plannerAssigneeId);
                  if (azureUser) {
                    const email = azureUser.mail || azureUser.userPrincipalName;
                    console.log('[PLANNER] Looking up Azure user by email:', azureUser.displayName, email);
                    
                    // First check if user already exists in Constellation by email
                    const existingUser = await storage.getUserByEmail(email);
                    if (existingUser) {
                      console.log('[PLANNER] Found existing Constellation user by email:', existingUser.name);
                      
                      // Create Azure mapping for future syncs
                      await storage.createUserAzureMapping({
                        userId: existingUser.id,
                        azureUserId: azureUser.id,
                        azureUserPrincipalName: azureUser.userPrincipalName,
                        azureDisplayName: azureUser.displayName,
                        mappingMethod: 'auto_discovered_from_planner_sync',
                        verifiedAt: new Date()
                      });
                      
                      // Assign to allocation
                      await storage.updateProjectAllocation(allocation.id, {
                        personId: existingUser.id,
                        pricingMode: 'person'
                      });
                      inboundUpdated++;
                    } else if (connection.autoAddMembers) {
                      // No existing user - create as named resource
                      console.log('[PLANNER] Auto-creating named resource for Azure user:', azureUser.displayName);
                      const newUser = await storage.createUser({
                        email: email,
                        name: azureUser.displayName || 'Unknown User',
                        firstName: azureUser.displayName?.split(' ')[0] || '',
                        lastName: azureUser.displayName?.split(' ').slice(1).join(' ') || '',
                        role: 'employee',
                        canLogin: false, // Named resource - no login
                        isAssignable: true,
                        isActive: true
                      });
                      
                      // Create Azure mapping
                      await storage.createUserAzureMapping({
                        userId: newUser.id,
                        azureUserId: azureUser.id,
                        azureUserPrincipalName: azureUser.userPrincipalName,
                        azureDisplayName: azureUser.displayName,
                        mappingMethod: 'auto_created_from_planner',
                        verifiedAt: new Date()
                      });
                      
                      // Assign to allocation
                      await storage.updateProjectAllocation(allocation.id, {
                        personId: newUser.id,
                        pricingMode: 'person'
                      });
                      
                      console.log('[PLANNER] Created named resource and assigned:', newUser.id, newUser.name);
                      inboundUpdated++;
                    }
                  }
                } catch (lookupErr: any) {
                  console.warn('[PLANNER] Failed to lookup/create user from Planner:', lookupErr.message);
                  errors.push(`Could not match/create user from Planner assignee: ${lookupErr.message}`);
                }
              }
            }
          }
          
          // Update sync record with latest etag
          await storage.updatePlannerTaskSync(syncRecord.id, {
            remoteEtag: task['@odata.etag'],
            lastSyncedAt: new Date(),
            syncStatus: 'synced'
          });
          
        } catch (err: any) {
          errors.push(`Inbound sync for task ${syncRecord.taskId}: ${err.message}`);
        }
      }
      
      // ============ IMPORT NEW TASKS FROM PLANNER ============
      // Fetch all tasks from Planner plan and create allocations for tasks not yet synced
      let tasksImported = 0;
      let tasksSkipped = 0;
      
      if (connection.syncDirection === 'bidirectional' || connection.syncDirection === 'planner_to_constellation') {
        try {
          console.log('[PLANNER] Importing new tasks from Planner plan:', connection.planId);
          const planTasks = await plannerService.listTasks(connection.planId);
          
          // Fetch buckets upfront for bucket → stage mapping
          const planBuckets = await plannerService.listBuckets(connection.planId);
          const bucketMap = new Map<string, string>();
          for (const bucket of planBuckets) {
            bucketMap.set(bucket.id, bucket.name);
          }
          console.log('[PLANNER] Loaded buckets for stage mapping:', Array.from(bucketMap.entries()));
          
          // Get project details for allocation creation
          const project = await storage.getProject(projectId);
          if (!project) {
            errors.push('Project not found for task import');
          } else {
            // Pre-validate: ensure we have a fallback role for imported tasks (only used if person has no role)
            const roles = await storage.getRoles(req.user?.tenantId);
            // Prefer common consulting roles in order of preference
            const fallbackRole = roles.find(r => r.name === 'Consultant') || 
                                 roles.find(r => r.name === 'Senior Consultant') ||
                                 roles.find(r => r.name === 'Developer') ||
                                 roles.find(r => r.name === 'Analyst') ||
                                 roles[roles.length - 1]; // Last resort: last role in list
            
            if (!fallbackRole) {
              console.warn('[PLANNER] No fallback role available for task import - skipping imports');
              errors.push('No roles configured - cannot import Planner tasks. Please configure at least one role.');
            } else {
              console.log('[PLANNER] Fallback role for imports (if person has no role):', fallbackRole.name);
              
              for (const task of planTasks) {
                // Use getPlannerTaskSyncByTaskId to check if already synced (idempotent)
                const existingSync = await storage.getPlannerTaskSyncByTaskId(task.id);
                if (existingSync) {
                  continue; // Already synced, skip
                }
                
                // Skip completed tasks by default (don't import old done tasks)
                if (task.percentComplete === 100) {
                  console.log('[PLANNER] Skipping completed Planner task:', task.id, task.title);
                  tasksSkipped++;
                  continue;
                }
                
                console.log('[PLANNER] Importing new task from Planner:', task.id, task.title);
                
                try {
                  // Find Constellation user from Planner assignee
                  let personId: string | null = null;
                  let roleId: string | null = null; // Start with null - derive from person or fallback
                  let rackRate: string | null = null;
                  let costRate: string | null = null;
                  
                  if (task.assignments) {
                    const assigneeIds = Object.keys(task.assignments).filter(
                      id => task.assignments![id]['@odata.type'] === '#microsoft.graph.plannerAssignment'
                    );
                    
                    if (assigneeIds.length > 0) {
                      const azureAssigneeId = assigneeIds[0];
                      const mapping = await storage.getUserAzureMappingByAzureId(azureAssigneeId);
                      
                      if (mapping) {
                        personId = mapping.userId;
                        const user = await storage.getUser(mapping.userId);
                        console.log('[PLANNER] Found matching user via Azure mapping:', user?.name, 'roleId:', user?.roleId);
                        
                        // PRIORITY 1: Person's specific rates ALWAYS take precedence
                        const userRates = await storage.getUserRates(mapping.userId);
                        if (userRates.billingRate && userRates.billingRate > 0) {
                          rackRate = userRates.billingRate.toString();
                          console.log('[PLANNER] Using person-specific billing rate:', rackRate);
                        }
                        if (userRates.costRate && userRates.costRate > 0) {
                          costRate = userRates.costRate.toString();
                          console.log('[PLANNER] Using person-specific cost rate:', costRate);
                        }
                        
                        // PRIORITY 2: Person's assigned role
                        if (user?.roleId) {
                          roleId = user.roleId;
                          const userRole = roles.find(r => r.id === user.roleId);
                          console.log('[PLANNER] Using person role:', userRole?.name, 'for user:', user.name);
                          // Only use role rates if person doesn't have specific rates
                          if (!rackRate && userRole?.defaultRackRate) {
                            rackRate = userRole.defaultRackRate.toString();
                          }
                          if (!costRate && userRole?.defaultCostRate) {
                            costRate = userRole.defaultCostRate.toString();
                          }
                        }
                      } else {
                        // No Azure mapping - try to find user by email from Azure AD
                        console.log('[PLANNER] No Azure mapping for:', azureAssigneeId, '- attempting email match');
                        try {
                          const azureUser = await plannerService.findUserById(azureAssigneeId);
                          if (azureUser) {
                            const email = azureUser.mail || azureUser.userPrincipalName;
                            console.log('[PLANNER] Azure user email:', email);
                            
                            // Try to find existing Constellation user by email
                            const existingUser = await storage.getUserByEmail(email);
                            if (existingUser) {
                              console.log('[PLANNER] Found existing Constellation user by email:', existingUser.name);
                              personId = existingUser.id;
                              
                              // Create the Azure mapping for future syncs
                              await storage.createUserAzureMapping({
                                userId: existingUser.id,
                                azureUserId: azureUser.id,
                                azureUserPrincipalName: azureUser.userPrincipalName,
                                azureDisplayName: azureUser.displayName,
                                mappingMethod: 'auto_discovered_from_planner_import',
                                verifiedAt: new Date()
                              });
                              
                              // Get user's rates
                              const existingUserRates = await storage.getUserRates(existingUser.id);
                              if (existingUserRates.billingRate && existingUserRates.billingRate > 0) {
                                rackRate = existingUserRates.billingRate.toString();
                                console.log('[PLANNER] Using person-specific billing rate:', rackRate);
                              }
                              if (existingUserRates.costRate && existingUserRates.costRate > 0) {
                                costRate = existingUserRates.costRate.toString();
                              }
                              
                              // Get user's role
                              if (existingUser.roleId) {
                                roleId = existingUser.roleId;
                                const existingUserRole = roles.find(r => r.id === existingUser.roleId);
                                console.log('[PLANNER] Using person role:', existingUserRole?.name);
                                if (!rackRate && existingUserRole?.defaultRackRate) {
                                  rackRate = existingUserRole.defaultRackRate.toString();
                                }
                                if (!costRate && existingUserRole?.defaultCostRate) {
                                  costRate = existingUserRole.defaultCostRate.toString();
                                }
                              }
                            } else if (connection.autoAddMembers) {
                              // No existing user found - auto-create from Azure AD
                              console.log('[PLANNER] Auto-creating resource for Planner task assignee:', azureUser.displayName);
                              const newUser = await storage.createUser({
                                email: azureUser.mail || azureUser.userPrincipalName,
                                name: azureUser.displayName || 'Unknown User',
                                firstName: azureUser.displayName?.split(' ')[0] || '',
                                lastName: azureUser.displayName?.split(' ').slice(1).join(' ') || '',
                                role: 'employee',
                                canLogin: false,
                                isAssignable: true,
                                isActive: true
                              });
                              
                              await storage.createUserAzureMapping({
                                userId: newUser.id,
                                azureUserId: azureUser.id,
                                azureUserPrincipalName: azureUser.userPrincipalName,
                                azureDisplayName: azureUser.displayName,
                                mappingMethod: 'auto_created_from_planner_import',
                                verifiedAt: new Date()
                              });
                              
                              personId = newUser.id;
                              // New user - use fallback role
                              roleId = fallbackRole.id;
                              rackRate = fallbackRole.defaultRackRate?.toString() || '0';
                              costRate = fallbackRole.defaultCostRate?.toString() || null;
                            }
                          }
                        } catch (lookupErr: any) {
                          console.warn('[PLANNER] Failed to lookup/create user for task import:', lookupErr.message);
                        }
                      }
                    }
                  }
                  
                  // If no role derived from person, use fallback role
                  if (!roleId) {
                    roleId = fallbackRole.id;
                    rackRate = fallbackRole.defaultRackRate?.toString() || '0';
                    costRate = fallbackRole.defaultCostRate?.toString() || null;
                    console.log('[PLANNER] Using fallback role:', fallbackRole.name);
                  }
                  
                  // Determine task status from percentComplete
                  let status = 'open';
                  if (task.percentComplete > 0 && task.percentComplete < 100) {
                    status = 'in_progress';
                  }
                  
                  // Fetch task details to get the description field
                  let taskDescriptionText = task.title; // Fallback to title
                  try {
                    const taskDetails = await plannerService.getTaskDetails(task.id);
                    if (taskDetails?.description && taskDetails.description.trim()) {
                      taskDescriptionText = taskDetails.description.trim();
                      console.log('[PLANNER] Using task description:', taskDescriptionText);
                    } else {
                      console.log('[PLANNER] No description, using title:', task.title);
                    }
                  } catch (detailsErr: any) {
                    console.warn('[PLANNER] Could not fetch task details, using title:', detailsErr.message);
                  }
                  
                  // Map bucket to stage - bucket name → stage
                  let projectStageId: string | null = null;
                  if (task.bucketId) {
                    const bucketName = bucketMap.get(task.bucketId);
                    if (bucketName) {
                      console.log('[PLANNER] Looking for stage matching bucket:', bucketName);
                      // Find existing stage with matching name
                      const projectStages = await storage.getProjectStages(projectId);
                      const matchingStage = projectStages.find(s => 
                        s.name.toLowerCase() === bucketName.toLowerCase()
                      );
                      if (matchingStage) {
                        projectStageId = matchingStage.id;
                        console.log('[PLANNER] Mapped bucket to existing stage:', matchingStage.name);
                      } else {
                        // Create new stage based on bucket name
                        console.log('[PLANNER] Creating new stage from bucket:', bucketName);
                        const newStage = await storage.createProjectStage({
                          projectId,
                          name: bucketName,
                          description: `Imported from Planner bucket`,
                          sortOrder: projectStages.length + 1
                        });
                        projectStageId = newStage.id;
                      }
                    }
                  }
                  
                  // Create new allocation with properly derived rates
                  const allocationData = {
                    projectId,
                    taskDescription: taskDescriptionText,
                    personId,
                    roleId,
                    hours: '8', // Default 8 hours for imported tasks
                    rackRate,
                    costRate,
                    pricingMode: personId ? 'person' as const : 'role' as const,
                    status,
                    projectStageId, // Map bucket → stage
                    plannedStartDate: task.startDateTime ? task.startDateTime.split('T')[0] : null,
                    plannedEndDate: task.dueDateTime ? task.dueDateTime.split('T')[0] : null,
                    notes: `Imported from Microsoft Planner`,
                    weekNumber: 0
                  };
                  
                  const newAllocation = await storage.createProjectAllocation(allocationData);
                  
                  // Create sync record to prevent re-importing
                  const taskBucketName = task.bucketId ? bucketMap.get(task.bucketId) : null;
                  await storage.createPlannerTaskSync({
                    connectionId: connection.id,
                    allocationId: newAllocation.id,
                    taskId: task.id,
                    taskTitle: task.title,
                    bucketId: task.bucketId || null,
                    bucketName: taskBucketName || null,
                    syncStatus: 'synced',
                    remoteEtag: task['@odata.etag'] || null
                  });
                  
                  // Auto-create engagement if person is assigned
                  if (personId) {
                    await storage.ensureProjectEngagement(projectId, personId);
                  }
                  
                  tasksImported++;
                  console.log('[PLANNER] Successfully imported task:', task.title, '→ allocation:', newAllocation.id);
                } catch (importErr: any) {
                  console.error('[PLANNER] Failed to import task:', task.id, importErr.message);
                  errors.push(`Failed to import task "${task.title}": ${importErr.message}`);
                  
                  // Create sync record with null allocationId to mark this task as attempted
                  // This prevents retry spam on subsequent syncs
                  try {
                    const failedBucketName = task.bucketId ? bucketMap.get(task.bucketId) : null;
                    await storage.createPlannerTaskSync({
                      connectionId: connection.id,
                      allocationId: null, // No allocation - just tracking the failure
                      taskId: task.id,
                      taskTitle: task.title,
                      bucketId: task.bucketId || null,
                      bucketName: failedBucketName || null,
                      syncStatus: 'import_failed',
                      syncError: importErr.message,
                      remoteEtag: task['@odata.etag'] || null
                    });
                    console.log('[PLANNER] Recorded failed import for task:', task.id);
                  } catch (syncRecordErr: any) {
                    console.warn('[PLANNER] Could not record failed task:', syncRecordErr.message);
                  }
                }
              }
            }
          }
        } catch (importListErr: any) {
          console.error('[PLANNER] Failed to fetch tasks for import:', importListErr.message);
          errors.push(`Failed to fetch Planner tasks: ${importListErr.message}`);
        }
      }
      
      // Update connection sync status
      await storage.updateProjectPlannerConnection(connection.id, {
        lastSyncAt: new Date(),
        lastSyncStatus: errors.length > 0 ? 'partial' : 'success',
        lastSyncError: errors.length > 0 ? errors.join('; ') : null
      });
      
      res.json({ 
        success: true, 
        created, 
        updated, 
        inboundUpdated,
        inboundDeleted,
        tasksImported,
        errors: errors.length > 0 ? errors : undefined 
      });
    } catch (error: any) {
      console.error("[PLANNER] Sync failed:", error);
      res.status(500).json({ message: "Sync failed: " + error.message });
    }
  });

  // Get sync status for a project's allocations
  app.get("/api/projects/:projectId/planner-sync-status", requireAuth, async (req, res) => {
    try {
      const connection = await storage.getProjectPlannerConnection(req.params.projectId);
      if (!connection) {
        return res.json({ connected: false });
      }
      
      const syncs = await storage.getPlannerTaskSyncsByConnection(connection.id);
      
      res.json({
        connected: true,
        connection: {
          planId: connection.planId,
          planTitle: connection.planTitle,
          groupId: connection.groupId,
          groupName: connection.groupName,
          syncEnabled: connection.syncEnabled,
          syncDirection: connection.syncDirection,
          autoAddMembers: connection.autoAddMembers,
          lastSyncAt: connection.lastSyncAt,
          lastSyncStatus: connection.lastSyncStatus
        },
        syncedTasks: syncs.length,
        syncs: syncs.map(s => ({
          allocationId: s.allocationId,
          taskId: s.taskId,
          taskTitle: s.taskTitle,
          bucketName: s.bucketName,
          syncStatus: s.syncStatus,
          lastSyncedAt: s.lastSyncedAt
        }))
      });
    } catch (error: any) {
      console.error("[PLANNER] Failed to get sync status:", error);
      res.status(500).json({ message: "Failed to get sync status" });
    }
  });

  // User Azure AD mapping endpoints
  app.get("/api/users/:userId/azure-mapping", requireAuth, async (req, res) => {
    try {
      const mapping = await storage.getUserAzureMapping(req.params.userId);
      res.json(mapping || null);
    } catch (error: any) {
      console.error("[PLANNER] Failed to get Azure mapping:", error);
      res.status(500).json({ message: "Failed to get Azure mapping" });
    }
  });

  app.post("/api/users/:userId/azure-mapping", requireAuth, requireRole(["admin"]), async (req, res) => {
    try {
      const { azureUserId, azureUserPrincipalName, azureDisplayName, mappingMethod } = req.body;
      
      if (!azureUserId) {
        return res.status(400).json({ message: "azureUserId is required" });
      }
      
      // Check if mapping already exists
      const existing = await storage.getUserAzureMapping(req.params.userId);
      if (existing) {
        const updated = await storage.updateUserAzureMapping(existing.id, {
          azureUserId,
          azureUserPrincipalName,
          azureDisplayName,
          mappingMethod: mappingMethod || 'manual',
          verifiedAt: new Date()
        });
        return res.json(updated);
      }
      
      const mapping = await storage.createUserAzureMapping({
        userId: req.params.userId,
        azureUserId,
        azureUserPrincipalName,
        azureDisplayName,
        mappingMethod: mappingMethod || 'manual',
        verifiedAt: new Date()
      });
      
      res.json(mapping);
    } catch (error: any) {
      console.error("[PLANNER] Failed to create Azure mapping:", error);
      res.status(500).json({ message: "Failed to create Azure mapping" });
    }
  });

  // Auto-discover Azure AD user by email
  app.post("/api/users/:userId/azure-mapping/discover", requireAuth, requireRole(["admin"]), async (req, res) => {
    try {
      const { plannerService } = await import('./services/planner-service');
      
      const user = await storage.getUser(req.params.userId);
      if (!user || !user.email) {
        return res.status(404).json({ message: "User not found or has no email" });
      }
      
      const azureUser = await plannerService.findUserByEmail(user.email);
      if (!azureUser) {
        return res.status(404).json({ message: "Azure AD user not found for this email" });
      }
      
      // Check if mapping already exists
      const existing = await storage.getUserAzureMapping(req.params.userId);
      if (existing) {
        const updated = await storage.updateUserAzureMapping(existing.id, {
          azureUserId: azureUser.id,
          azureUserPrincipalName: azureUser.userPrincipalName,
          azureDisplayName: azureUser.displayName,
          mappingMethod: 'email',
          verifiedAt: new Date()
        });
        return res.json(updated);
      }
      
      const mapping = await storage.createUserAzureMapping({
        userId: req.params.userId,
        azureUserId: azureUser.id,
        azureUserPrincipalName: azureUser.userPrincipalName,
        azureDisplayName: azureUser.displayName,
        mappingMethod: 'email',
        verifiedAt: new Date()
      });
      
      res.json(mapping);
    } catch (error: any) {
      console.error("[PLANNER] Failed to discover Azure mapping:", error);
      res.status(500).json({ message: "Failed to discover Azure user: " + error.message });
    }
  });

  // Export project allocations to CSV (Planner-compatible format)
  app.get("/api/projects/:projectId/allocations/export", requireAuth, async (req, res) => {
    try {
      const allocations = await storage.getProjectAllocations(req.params.projectId);
      const project = await storage.getProject(req.params.projectId);
      
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      // Create CSV header with Epic, Stage, and Workstream columns
      const headers = [
        "Task Name",
        "Assigned To",
        "Epic",
        "Stage",
        "Workstream",
        "Start Date",
        "Due Date",
        "Labels",
        "Notes",
        "Bucket",
        "Progress",
        "Priority",
        "Description",
        "Hours"
      ];

      // Convert allocations to CSV rows
      const rows = allocations.map((allocation: any) => {
        // Task Name: Use taskDescription first (the actual task name)
        // Fall back to structured name only if no taskDescription exists
        let taskName = "";
        
        // Primary: use taskDescription (the actual task name entered by user)
        if (allocation.taskDescription) {
          taskName = allocation.taskDescription;
        }
        // Secondary: build from structure if no taskDescription
        else if (allocation.epic?.name && allocation.stage?.name) {
          const workstreamName = allocation.workstream?.name || allocation.workstream || "";
          taskName = workstreamName 
            ? `${allocation.epic.name} - ${allocation.stage.name}: ${workstreamName}`
            : `${allocation.epic.name} - ${allocation.stage.name}`;
        }
        // Fall back to workstream or activity
        else if (allocation.workstream?.name || allocation.workstream) {
          taskName = allocation.workstream?.name || allocation.workstream;
        }
        else if (allocation.activity?.name) {
          taskName = allocation.activity.name;
        }
        else {
          taskName = "Task";
        }

        // Determine assignee - use lowercase email for named resources
        let assignedTo = "";
        if (allocation.person?.email) {
          assignedTo = allocation.person.email.toLowerCase();
        } else if (allocation.resourceName) {
          assignedTo = allocation.resourceName;
        }

        // Format dates
        const startDate = allocation.plannedStartDate || allocation.startDate || "";
        const dueDate = allocation.plannedEndDate || allocation.endDate || "";

        // Create labels from role and status
        const labels = [];
        if (allocation.role?.name) {
          labels.push(allocation.role.name);
        }
        if (allocation.status) {
          labels.push(allocation.status.replace('_', ' ').replace(/\b\w/g, (l: string) => l.toUpperCase()));
        }
        if (allocation.weekNumber !== null && allocation.weekNumber !== undefined) {
          labels.push(`Week ${allocation.weekNumber}`);
        }

        // Notes - keep blank as requested
        const notes = "";

        // Use workstream as bucket
        const bucket = allocation.workstream?.name || allocation.workstream || "General";

        // Map status to progress
        const progressMap: Record<string, string> = {
          'open': 'Not Started',
          'in_progress': 'In Progress',
          'completed': 'Completed',
          'cancelled': 'Not Started'
        };
        const progress = progressMap[allocation.status || 'open'] || 'Not Started';

        // Description - use taskDescription if available
        const description = allocation.taskDescription || "";
        
        // Hours - separate column at the end
        const hours = allocation.hours || allocation.allocatedHours || 0;

        // Extract Epic, Stage, and Workstream as separate fields
        const epicName = allocation.epic?.name || "";
        const stageName = allocation.stage?.name || "";
        const workstreamName = allocation.workstream?.name || allocation.workstream || "";

        return [
          taskName,
          assignedTo,
          epicName,
          stageName,
          workstreamName,
          startDate,
          dueDate,
          labels.join("; "),
          notes,
          bucket,
          progress,
          "Medium", // Priority
          description,
          hours
        ];
      });

      // Generate CSV content
      const XLSX = await import('xlsx');
      const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
      const csv = XLSX.utils.sheet_to_csv(worksheet);

      // Send CSV file
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="project-${project.code}-assignments.csv"`);
      res.send(csv);
    } catch (error: any) {
      console.error("[ERROR] Failed to export project allocations:", error);
      res.status(500).json({ message: "Failed to export project allocations" });
    }
  });

  // Create new project allocation
  app.post("/api/project-allocations", requireAuth, requireRole(["admin", "pm", "portfolio-manager"]), async (req, res) => {
    try {
      const { insertProjectAllocationSchema } = await import("@shared/schema");
      const data = insertProjectAllocationSchema.parse(req.body);
      const allocation = await storage.createProjectAllocation(data);
      res.json(allocation);
    } catch (error: any) {
      console.error("[ERROR] Failed to create project allocation:", error);
      res.status(500).json({ message: "Failed to create project allocation" });
    }
  });

  // Import allocations from Excel/CSV
  app.post("/api/projects/:projectId/allocations/import", requireAuth, requireRole(["admin", "pm", "portfolio-manager"]), async (req, res) => {
    try {
      const xlsx = await import("xlsx");
      const { insertProjectAllocationSchema } = await import("@shared/schema");
      
      const projectId = req.params.projectId;
      
      // Parse base64 file data
      const fileData = req.body.file;
      const removeExisting = req.body.removeExisting === true;
      const saveBaseline = req.body.saveBaseline === true;
      const buffer = Buffer.from(fileData, "base64");
      
      const workbook = xlsx.read(buffer, { type: "buffer" });
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const data = xlsx.utils.sheet_to_json(worksheet, { header: 1 });
      
      // Get project data for validation
      const project = await storage.getProject(projectId);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }
      
      // Get lookup data
      const users = await storage.getUsers(req.user?.tenantId);
      const roles = await storage.getRoles(req.user?.tenantId);
      const workstreams = await storage.getProjectWorkStreams(projectId);
      const epics = await storage.getProjectEpics(projectId);
      // Get all stages for all epics in this project
      const epicIds = epics.map(e => e.id);
      const stagesMap = await storage.getProjectStagesByEpicIds(epicIds);
      const stages: any[] = [];
      for (const epic of epics) {
        const epicStages = stagesMap.get(epic.id) || [];
        stages.push(...epicStages);
      }
      
      // Create lookup maps (case-insensitive)
      // Support both email and name lookup for users
      const userEmailToId = new Map(users.filter((u: any) => u.email).map((u: any) => [u.email.toLowerCase(), u.id]));
      const userNameToId = new Map(users.map((u: any) => [u.name.toLowerCase(), u.id]));
      const roleNameToId = new Map(roles.map((r: any) => [r.name.toLowerCase(), r.id]));
      const workstreamNameToId = new Map(workstreams.map((w: any) => [w.name.toLowerCase(), w.id]));
      const epicNameToId = new Map(epics.map((e: any) => [e.name.toLowerCase(), e.id]));
      const stageNameToId = new Map(stages.map((s: any) => [s.name.toLowerCase(), s.id]));
      
      let baselineSaved = false;
      let baselineCount = 0;
      
      if (removeExisting) {
        if (saveBaseline) {
          const baseline = await storage.createProjectBaseline({
            projectId,
            tenantId: req.user?.tenantId || null,
            name: `Pre-import baseline ${new Date().toISOString().split('T')[0]}`,
            createdBy: req.user?.id || null,
          });
          baselineCount = await storage.baselineProjectAllocations(projectId, baseline.id);
          baselineSaved = true;
        }
        
        const existingAllocations = await storage.getProjectAllocations(projectId);
        const allocationIds = existingAllocations.map((a: any) => a.id);
        await storage.bulkDeleteProjectAllocations(allocationIds);
      }
      
      // Detect format based on header row
      const headerRow = data[0] as string[];
      const headerLower = headerRow.map((h: string) => (h || '').toString().toLowerCase().trim());
      
      // Check if this is Planner-style format (has "Task Name" and "Assigned To" columns)
      const isPlannerFormat = headerLower.includes('task name') && headerLower.includes('assigned to');
      
      // Build column index map for flexible column handling
      const colIndex: Record<string, number> = {};
      headerLower.forEach((h, i) => { colIndex[h] = i; });
      
      // Process data rows (skip header)
      const allocations = [];
      const errors = [];
      
      for (let i = 1; i < data.length; i++) {
        const row = data[i] as any[];
        
        // Get values based on format
        let personValue: any, hoursValue: any, epicValue: any, stageValue: any, workstreamValue: any;
        let startDateValue: any, endDateValue: any, notesValue: any, taskNameValue: any;
        let roleValue: any = null, pricingModeValue: any = null;
        
        if (isPlannerFormat) {
          // Planner format columns:
          // Task Name, Assigned To, Epic, Stage, Workstream, Start Date, Due Date, Labels, Notes, Bucket, Progress, Priority, Description, Hours
          personValue = row[colIndex['assigned to']];
          hoursValue = row[colIndex['hours']];
          epicValue = row[colIndex['epic']];
          stageValue = row[colIndex['stage']] || row[colIndex['bucket']]; // Stage from Stage or Bucket column
          workstreamValue = row[colIndex['workstream']];
          startDateValue = row[colIndex['start date']];
          endDateValue = row[colIndex['due date']];
          notesValue = row[colIndex['notes']];
          // Prefer Description column for task name (contains actual task info)
          // Fall back to Task Name column only if Description is empty
          const descriptionValue = row[colIndex['description']];
          const taskTitleValue = row[colIndex['task name']];
          taskNameValue = (descriptionValue && String(descriptionValue).trim()) 
            ? descriptionValue 
            : taskTitleValue;
        } else {
          // Standard format columns:
          // 0: Person Name, 1: Role Name, 2: Workstream, 3: Epic, 4: Stage,
          // 5: Hours, 6: Pricing Mode, 7: Start Date, 8: End Date, 9: Notes
          personValue = row[0];
          roleValue = row[1];
          workstreamValue = row[2];
          epicValue = row[3];
          stageValue = row[4];
          hoursValue = row[5];
          pricingModeValue = row[6];
          startDateValue = row[7];
          endDateValue = row[8];
          notesValue = row[9];
        }
        
        // Skip empty rows
        if (!personValue && !hoursValue) continue;
        
        // Validate required fields
        if (!personValue) {
          errors.push({ row: i + 1, message: "Person/Assigned To is required" });
          continue;
        }
        if (!hoursValue || isNaN(Number(hoursValue))) {
          errors.push({ row: i + 1, message: `Valid hours value is required (got: ${hoursValue})` });
          continue;
        }
        
        // Lookup person - try email first (lowercase), then name
        const personIdentifier = String(personValue).trim().toLowerCase();
        const personId = userEmailToId.get(personIdentifier) || userNameToId.get(personIdentifier);
        
        // If person not found, we'll create an unassigned allocation with the name stored
        const resourceName = personId ? null : String(personValue).trim();
        if (!personId) {
          // Log as info, not error - we'll still import the task as unassigned
          errors.push({ row: i + 1, message: `Person not found: ${personValue} - imported as unassigned` });
        }
        
        // Lookup optional fields
        const roleName = roleValue ? String(roleValue).trim().toLowerCase() : null;
        const roleId = roleName ? roleNameToId.get(roleName) : null;
        
        const workstreamName = workstreamValue ? String(workstreamValue).trim().toLowerCase() : null;
        const workstreamId = workstreamName ? workstreamNameToId.get(workstreamName) : null;
        
        const epicName = epicValue ? String(epicValue).trim().toLowerCase() : null;
        const epicId = epicName ? epicNameToId.get(epicName) : null;
        
        const stageName = stageValue ? String(stageValue).trim().toLowerCase() : null;
        const stageId = stageName ? stageNameToId.get(stageName) : null;
        
        // Parse pricing mode - if person not found, force to resource_name mode
        let pricingMode: "role" | "person" | "resource_name";
        if (!personId) {
          // No person found, use resource_name mode with the original name stored
          pricingMode = "resource_name";
        } else {
          const pricingModeStr = pricingModeValue ? String(pricingModeValue).toLowerCase() : "role";
          pricingMode = "role";
          if (pricingModeStr.includes("person")) pricingMode = "person";
          else if (pricingModeStr.includes("resource")) pricingMode = "resource_name";
        }
        
        // Parse dates (handle various formats)
        const parseDate = (dateValue: any): string | null => {
          if (!dateValue) return null;
          
          // Handle Excel date serial numbers (days since 1900-01-01, with Excel's leap year bug)
          if (typeof dateValue === 'number') {
            // Excel epoch is January 1, 1900, but Excel incorrectly treats 1900 as leap year
            // So we adjust: dates after Feb 28, 1900 need -1 day correction
            const excelEpoch = new Date(1899, 11, 30); // Dec 30, 1899 (Excel's day 0)
            const date = new Date(excelEpoch.getTime() + dateValue * 24 * 60 * 60 * 1000);
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
          }
          
          // Handle string dates
          const dateStr = String(dateValue).trim();
          if (!dateStr) return null;
          
          // Already in YYYY-MM-DD format
          if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
          
          // Handle M/D/YYYY or MM/DD/YYYY format (common in CSV exports)
          const slashMatch = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
          if (slashMatch) {
            const [, month, day, year] = slashMatch;
            return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
          }
          
          // Try parsing with Date constructor
          const parsedDate = new Date(dateStr);
          if (!isNaN(parsedDate.getTime())) {
            const year = parsedDate.getFullYear();
            const month = String(parsedDate.getMonth() + 1).padStart(2, '0');
            const day = String(parsedDate.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
          }
          
          return null;
        };
        
        // For Planner format, set task name to taskDescription field
        const taskDescription = isPlannerFormat && taskNameValue ? String(taskNameValue) : null;
        const finalNotes = notesValue ? String(notesValue) : null;
        
        // Parse dates first so we can calculate week number
        const parsedStartDate = parseDate(startDateValue);
        const parsedEndDate = parseDate(endDateValue);
        
        // Calculate ISO week number from start date
        const getISOWeekNumber = (dateStr: string | null): number => {
          if (!dateStr) return 1;
          const date = new Date(dateStr);
          if (isNaN(date.getTime())) return 1;
          
          // ISO week calculation
          const tempDate = new Date(date.valueOf());
          const dayNum = (date.getDay() + 6) % 7; // Make Monday = 0
          tempDate.setDate(tempDate.getDate() - dayNum + 3); // Set to nearest Thursday
          const firstThursday = tempDate.valueOf();
          tempDate.setMonth(0, 1); // Jan 1
          if (tempDate.getDay() !== 4) {
            tempDate.setMonth(0, 1 + ((4 - tempDate.getDay()) + 7) % 7);
          }
          return 1 + Math.ceil((firstThursday - tempDate.valueOf()) / 604800000);
        };
        
        const weekNumber = getISOWeekNumber(parsedStartDate);
        
        const allocation = {
          projectId,
          personId: personId || null, // null if person not found
          roleId: roleId || null,
          projectWorkstreamId: workstreamId || null,
          projectEpicId: epicId || null, // Epic from CSV
          projectStageId: stageId || null, // Stage from CSV
          projectActivityId: null, // We don't have activities in import yet
          projectMilestoneId: null, // We don't have milestones in import yet
          weekNumber, // Calculated from start date
          hours: String(hoursValue),
          pricingMode,
          rackRate: "0", // Default rack rate, will be calculated based on role/person
          plannedStartDate: parsedStartDate,
          plannedEndDate: parsedEndDate,
          resourceName, // Store person name if not found in system
          billingRate: null, // Will be calculated based on role/person
          costRate: null, // Will be calculated based on role/person
          taskDescription, // Task name from CSV goes here
          notes: finalNotes,
          estimateLineItemId: null, // No link to estimate when importing
          status: "open" as const,
          startedDate: null,
          completedDate: null
        };
        
        allocations.push(allocation);
      }
      
      // Bulk create allocations and ensure project engagements
      const createdAllocations = [];
      const engagementsCreated = new Set<string>(); // Track unique personIds for engagement creation
      
      for (const allocation of allocations) {
        try {
          const created = await storage.createProjectAllocation(allocation);
          createdAllocations.push(created);
          
          // Create project engagement for users with valid personId
          if (allocation.personId && !engagementsCreated.has(allocation.personId)) {
            try {
              await storage.ensureProjectEngagement(projectId, allocation.personId);
              engagementsCreated.add(allocation.personId);
            } catch (engErr: any) {
              console.warn(`[WARN] Failed to create engagement for person ${allocation.personId}:`, engErr.message);
            }
          }
        } catch (error: any) {
          errors.push({ 
            message: `Failed to create allocation for person ${allocation.personId}`,
            error: error.message 
          });
        }
      }
      
      res.json({
        success: true,
        itemsCreated: createdAllocations.length,
        membershipsCreated: engagementsCreated.size,
        mode: removeExisting ? "replaced" : "appended",
        baselineSaved,
        baselineCount,
        errors: errors.length > 0 ? errors : undefined
      });
      
    } catch (error: any) {
      console.error("[ERROR] Import allocations error:", error);
      res.status(500).json({ message: "Failed to import allocations file" });
    }
  });

  // Project Baselines
  app.get("/api/projects/:projectId/baselines", requireAuth, async (req, res) => {
    try {
      const project = await storage.getProject(req.params.projectId);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }
      if (req.user?.tenantId && project.tenantId && project.tenantId !== req.user.tenantId) {
        return res.status(403).json({ message: "Access denied" });
      }
      const baselines = await storage.getProjectBaselines(req.params.projectId);
      res.json(baselines);
    } catch (error: any) {
      console.error("[ERROR] Get baselines:", error);
      res.status(500).json({ message: "Failed to get baselines" });
    }
  });

  app.post("/api/projects/:projectId/baselines", requireAuth, requireRole(["admin", "pm", "portfolio-manager"]), async (req, res) => {
    try {
      const projectId = req.params.projectId;
      const { name } = req.body;
      
      const project = await storage.getProject(projectId);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }
      if (req.user?.tenantId && project.tenantId && project.tenantId !== req.user.tenantId) {
        return res.status(403).json({ message: "Access denied" });
      }

      const baseline = await storage.createProjectBaseline({
        projectId,
        tenantId: req.user?.tenantId || null,
        name: name || `Baseline ${new Date().toISOString().split('T')[0]}`,
        createdBy: req.user?.id || null,
      });

      const count = await storage.baselineProjectAllocations(projectId, baseline.id);

      res.json({ ...baseline, allocationCount: count });
    } catch (error: any) {
      console.error("[ERROR] Create baseline:", error);
      res.status(500).json({ message: "Failed to create baseline" });
    }
  });

  app.get("/api/projects/:projectId/baselines/:baselineId/allocations", requireAuth, async (req, res) => {
    try {
      const baselines = await storage.getProjectBaselines(req.params.projectId);
      const baseline = baselines.find(b => b.id === req.params.baselineId);
      if (!baseline) {
        return res.status(404).json({ message: "Baseline not found for this project" });
      }
      if (req.user?.tenantId && baseline.tenantId && baseline.tenantId !== req.user.tenantId) {
        return res.status(403).json({ message: "Access denied" });
      }
      const allocations = await storage.getBaselineAllocations(req.params.baselineId);
      res.json(allocations);
    } catch (error: any) {
      console.error("[ERROR] Get baseline allocations:", error);
      res.status(500).json({ message: "Failed to get baseline allocations" });
    }
  });

  // Get all assignments (for resource management)
  app.get("/api/assignments", requireAuth, requireRole(["admin", "pm", "portfolio-manager", "executive"]), async (req, res) => {
    try {
      const tenantId = req.user?.tenantId;
      console.log("[API] /api/assignments - Fetching allocations with epic and stage data for tenant:", tenantId);
      
      // Build query with tenant filtering
      let query = db
        .select({
          id: projectAllocations.id,
          projectId: projectAllocations.projectId,
          project: projects,
          client: clients,
          personId: projectAllocations.personId,
          person: users,
          workstreamId: projectAllocations.projectWorkstreamId,
          workstream: projectWorkstreams.name,
          epicId: projectAllocations.projectEpicId,
          epicName: projectEpics.name,
          stageId: projectAllocations.projectStageId,
          stageName: projectStages.name,
          roleId: projectAllocations.roleId,
          role: roles,
          hours: projectAllocations.hours,
          plannedStartDate: projectAllocations.plannedStartDate,
          plannedEndDate: projectAllocations.plannedEndDate,
          notes: projectAllocations.notes,
          status: projectAllocations.status,
          startedDate: projectAllocations.startedDate,
          completedDate: projectAllocations.completedDate,
          weekNumber: projectAllocations.weekNumber,
          taskDescription: projectAllocations.taskDescription
        })
        .from(projectAllocations)
        .innerJoin(projects, eq(projectAllocations.projectId, projects.id))
        .innerJoin(clients, eq(projects.clientId, clients.id))
        .leftJoin(users, eq(projectAllocations.personId, users.id))
        .leftJoin(projectWorkstreams, eq(projectAllocations.projectWorkstreamId, projectWorkstreams.id))
        .leftJoin(projectEpics, eq(projectAllocations.projectEpicId, projectEpics.id))
        .leftJoin(projectStages, eq(projectAllocations.projectStageId, projectStages.id))
        .leftJoin(roles, eq(projectAllocations.roleId, roles.id))
        .orderBy(desc(projectAllocations.plannedStartDate));
      
      const allocations = tenantId 
        ? await query.where(and(eq(projects.tenantId, tenantId), eq(projectAllocations.isBaseline, false)))
        : await query.where(eq(projectAllocations.isBaseline, false));
      
      console.log(`[API] /api/assignments - Found ${allocations.length} allocations`);
      
      // Format the response
      const formattedAllocations = allocations.map(row => ({
        id: row.id,
        projectId: row.projectId,
        project: {
          id: row.project.id,
          name: row.project.name,
          client: {
            id: row.client.id,
            name: row.client.name
          }
        },
        person: row.person ? {
          id: row.person.id,
          name: row.person.name,
          email: row.person.email
        } : null,
        workstream: row.workstream,
        epicId: row.epicId,
        epicName: row.epicName,
        stageId: row.stageId,
        stageName: row.stageName,
        role: row.role ? { id: row.role.id, name: row.role.name } : null,
        hours: row.hours,
        plannedStartDate: row.plannedStartDate,
        plannedEndDate: row.plannedEndDate,
        notes: row.notes,
        status: row.status,
        startedDate: row.startedDate,
        completedDate: row.completedDate,
        weekNumber: row.weekNumber,
        taskDescription: row.taskDescription
      }));
      
      res.json(formattedAllocations);
    } catch (error: any) {
      console.error("[ERROR] Failed to fetch assignments:", error);
      res.status(500).json({ message: "Failed to fetch assignments" });
    }
  });

  // Get current user's assignments - Enhanced with filtering, sorting, and grouping
  app.get("/api/my-assignments", requireAuth, async (req, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "User not found" });
      }

      const tenantId = req.user?.activeTenantId || req.user?.primaryTenantId || req.user?.tenantId;
      
      const {
        startDate,
        endDate,
        projectId,
        clientId,
        status,
        sortBy = 'startDate',
        sortOrder = 'desc',
        groupBy
      } = req.query;
      
      // Build query with dynamic filtering
      let allocationsQuery = db
        .select({
          id: projectAllocations.id,
          projectId: projectAllocations.projectId,
          project: projects,
          client: clients,
          workstreamId: projectAllocations.projectWorkstreamId,
          workstream: projectWorkstreams.name,
          epicId: projectAllocations.projectEpicId,
          epicName: projectEpics.name,
          stageId: projectAllocations.projectStageId,
          stageName: projectStages.name,
          roleId: projectAllocations.roleId,
          role: roles,
          hours: projectAllocations.hours,
          plannedStartDate: projectAllocations.plannedStartDate,
          plannedEndDate: projectAllocations.plannedEndDate,
          notes: projectAllocations.notes,
          status: projectAllocations.status,
          startedDate: projectAllocations.startedDate,
          completedDate: projectAllocations.completedDate,
          weekNumber: projectAllocations.weekNumber,
          taskDescription: projectAllocations.taskDescription,
          pricingMode: projectAllocations.pricingMode,
          // Include vocabulary overrides for cascading
          projectVocabulary: projects.vocabularyOverrides,
          clientVocabulary: clients.vocabularyOverrides
        })
        .from(projectAllocations)
        .innerJoin(projects, eq(projectAllocations.projectId, projects.id))
        .innerJoin(clients, eq(projects.clientId, clients.id))
        .leftJoin(projectWorkstreams, eq(projectAllocations.projectWorkstreamId, projectWorkstreams.id))
        .leftJoin(projectEpics, eq(projectAllocations.projectEpicId, projectEpics.id))
        .leftJoin(projectStages, eq(projectAllocations.projectStageId, projectStages.id))
        .leftJoin(roles, eq(projectAllocations.roleId, roles.id));

      const conditions: any[] = [
        eq(projectAllocations.personId, userId),
        eq(projectAllocations.isBaseline, false),
        // Scope via projects.tenantId — projectAllocations.tenantId is null on older records
        ...(tenantId ? [eq(projects.tenantId, tenantId)] : []),
      ];

      // Date range filter
      if (startDate && endDate) {
        conditions.push(
          and(
            sql`${projectAllocations.plannedEndDate} >= ${startDate}`,
            sql`${projectAllocations.plannedStartDate} <= ${endDate}`
          )
        );
      }

      // Project filter
      if (projectId) {
        conditions.push(eq(projects.id, projectId as string));
      }

      // Client filter
      if (clientId) {
        conditions.push(eq(clients.id, clientId as string));
      }

      // Status filter - "active" is a virtual status that matches "open" and "in_progress"
      if (status) {
        if (status === "active") {
          conditions.push(
            or(
              eq(projectAllocations.status, "open"),
              eq(projectAllocations.status, "in_progress")
            )
          );
        } else {
          conditions.push(eq(projectAllocations.status, status as string));
        }
      }

      const allocations = await allocationsQuery.where(and(...conditions));
      
      // Get organization vocabulary for cascading
      const orgVocab = await storage.getOrganizationVocabulary();

      // Format the response with vocabulary-aware labels
      const formattedAllocations = allocations.map(row => {
        // Parse vocabulary overrides
        let projectVocab: any = {};
        let clientVocab: any = {};
        
        try {
          if (row.projectVocabulary) {
            projectVocab = JSON.parse(row.projectVocabulary);
          }
        } catch {}
        
        try {
          if (row.clientVocabulary) {
            clientVocab = JSON.parse(row.clientVocabulary);
          }
        } catch {}

        // Cascade vocabulary: Project → Client → Organization → Default
        const vocabularyContext = {
          epic: projectVocab.epic || clientVocab.epic || orgVocab.epic || 'Epic',
          stage: projectVocab.stage || clientVocab.stage || orgVocab.stage || 'Stage',
          activity: projectVocab.activity || clientVocab.activity || orgVocab.activity || 'Activity',
          workstream: projectVocab.workstream || clientVocab.workstream || orgVocab.workstream || 'Workstream'
        };

        return {
          id: row.id,
          projectId: row.projectId,
          project: {
            id: row.project.id,
            name: row.project.name,
            code: row.project.code,
            status: row.project.status,
            client: {
              id: row.client.id,
              name: row.client.name
            }
          },
          workstream: row.workstream,
          epicId: row.epicId,
          epicName: row.epicName,
          stageId: row.stageId,
          stageName: row.stageName,
          role: row.role ? { id: row.role.id, name: row.role.name } : null,
          hours: row.hours,
          plannedStartDate: row.plannedStartDate,
          plannedEndDate: row.plannedEndDate,
          notes: row.notes,
          status: row.status,
          startedDate: row.startedDate,
          completedDate: row.completedDate,
          weekNumber: row.weekNumber,
          taskDescription: row.taskDescription,
          pricingMode: row.pricingMode,
          vocabularyContext
        };
      });

      // Sort assignments
      const sortedAllocations = [...formattedAllocations].sort((a, b) => {
        let comparison = 0;
        
        switch (sortBy) {
          case 'startDate':
            comparison = (a.plannedStartDate || '').localeCompare(b.plannedStartDate || '');
            break;
          case 'endDate':
            comparison = (a.plannedEndDate || '').localeCompare(b.plannedEndDate || '');
            break;
          case 'project':
            comparison = a.project.name.localeCompare(b.project.name);
            break;
          case 'client':
            comparison = a.project.client.name.localeCompare(b.project.client.name);
            break;
          case 'status':
            comparison = a.status.localeCompare(b.status);
            break;
          case 'hours':
            comparison = parseFloat(String(a.hours || 0)) - parseFloat(String(b.hours || 0));
            break;
          default:
            comparison = (a.plannedStartDate || '').localeCompare(b.plannedStartDate || '');
        }

        return sortOrder === 'desc' ? -comparison : comparison;
      });

      // Group assignments if requested
      let groupedAllocations: any = null;
      if (groupBy) {
        groupedAllocations = sortedAllocations.reduce((groups: any, allocation) => {
          let key: string;
          
          switch (groupBy) {
            case 'project':
              key = allocation.project.id;
              if (!groups[key]) {
                groups[key] = {
                  groupKey: key,
                  groupName: allocation.project.name,
                  groupType: 'project',
                  allocations: []
                };
              }
              break;
            case 'client':
              key = allocation.project.client.id;
              if (!groups[key]) {
                groups[key] = {
                  groupKey: key,
                  groupName: allocation.project.client.name,
                  groupType: 'client',
                  allocations: []
                };
              }
              break;
            case 'status':
              key = allocation.status;
              if (!groups[key]) {
                groups[key] = {
                  groupKey: key,
                  groupName: allocation.status,
                  groupType: 'status',
                  allocations: []
                };
              }
              break;
            case 'timeframe':
              // Group by month based on start date
              const date = new Date(allocation.plannedStartDate || '');
              key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
              if (!groups[key]) {
                groups[key] = {
                  groupKey: key,
                  groupName: date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
                  groupType: 'timeframe',
                  allocations: []
                };
              }
              break;
            case 'epic':
              key = allocation.epicId || 'none';
              if (!groups[key]) {
                groups[key] = {
                  groupKey: key,
                  groupName: allocation.epicId ? `${allocation.vocabularyContext.epic} ${allocation.epicId}` : `No ${allocation.vocabularyContext.epic}`,
                  groupType: 'epic',
                  allocations: []
                };
              }
              break;
            default:
              key = 'all';
              if (!groups[key]) {
                groups[key] = {
                  groupKey: key,
                  groupName: 'All Assignments',
                  groupType: 'all',
                  allocations: []
                };
              }
          }
          
          groups[key].allocations.push(allocation);
          return groups;
        }, {});
      }

      // Calculate summary metrics
      const totalHours = sortedAllocations.reduce((sum, a) => sum + parseFloat(String(a.hours || 0)), 0);
      const activeCount = sortedAllocations.filter(a => a.status === 'open' || a.status === 'in_progress').length;
      const completedCount = sortedAllocations.filter(a => a.status === 'completed').length;

      const response: any = {
        summary: {
          total: sortedAllocations.length,
          active: activeCount,
          completed: completedCount,
          totalHours,
          projectCount: new Set(sortedAllocations.map(a => a.project.id)).size,
          clientCount: new Set(sortedAllocations.map(a => a.project.client.id)).size
        },
        assignments: groupedAllocations ? Object.values(groupedAllocations) : sortedAllocations,
        filters: {
          startDate,
          endDate,
          projectId,
          clientId,
          status,
          sortBy,
          sortOrder,
          groupBy
        }
      };
      
      res.json(response);
    } catch (error: any) {
      console.error("[ERROR] Failed to fetch user assignments:", error);
      res.status(500).json({ message: "Failed to fetch assignments" });
    }
  });

  // Get capacity planning data (timeline view)
  app.get("/api/capacity/timeline", requireAuth, requireRole(["admin", "pm", "portfolio-manager", "executive"]), async (req, res) => {
    try {
      const { startDate, endDate, personId, utilizationThreshold } = req.query;
      const tenantId = req.user?.tenantId;
      
      // Get all active users (employees) - filtered by tenant
      const userConditions = tenantId 
        ? and(eq(users.role, 'employee'), eq(users.primaryTenantId, tenantId))
        : eq(users.role, 'employee');
      
      const allUsers = await db
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          role: users.role
        })
        .from(users)
        .where(userConditions);
      
      // Get all allocations with date filtering - filtered by tenant
      let allocationsQuery = db
        .select({
          id: projectAllocations.id,
          personId: projectAllocations.personId,
          projectId: projectAllocations.projectId,
          projectName: projects.name,
          clientName: clients.name,
          roleId: projectAllocations.roleId,
          roleName: roles.name,
          hours: projectAllocations.hours,
          plannedStartDate: projectAllocations.plannedStartDate,
          plannedEndDate: projectAllocations.plannedEndDate,
          status: projectAllocations.status,
          workstream: projectWorkstreams.name,
          weekNumber: projectAllocations.weekNumber,
          taskDescription: projectAllocations.taskDescription
        })
        .from(projectAllocations)
        .innerJoin(projects, eq(projectAllocations.projectId, projects.id))
        .innerJoin(clients, eq(projects.clientId, clients.id))
        .leftJoin(roles, eq(projectAllocations.roleId, roles.id))
        .leftJoin(projectWorkstreams, eq(projectAllocations.projectWorkstreamId, projectWorkstreams.id));
      
      const conditions: any[] = [eq(projectAllocations.isBaseline, false)];
      
      // Add tenant filter
      if (tenantId) {
        conditions.push(eq(projects.tenantId, tenantId));
      }
      
      if (startDate && endDate) {
        conditions.push(
          and(
            sql`${projectAllocations.plannedEndDate} >= ${startDate}`,
            sql`${projectAllocations.plannedStartDate} <= ${endDate}`
          )
        );
      }
      
      if (personId) {
        conditions.push(eq(projectAllocations.personId, personId as string));
      }
      
      const allocations = conditions.length > 0
        ? await allocationsQuery.where(and(...conditions))
        : await allocationsQuery;
      
      // Build capacity data by person
      const capacityByPerson = allUsers.map(user => {
        const userAllocations = allocations.filter(a => a.personId === user.id);
        
        // Calculate total allocated hours
        const totalAllocated = userAllocations.reduce((sum, a) => {
          return sum + (parseFloat(String(a.hours || 0)));
        }, 0);
        
        // Calculate weekly capacity (default 40 hours/week, 85% target utilization)
        const weeklyCapacity = 40;
        const targetUtilization = 0.85; // 85%
        const targetHours = weeklyCapacity * targetUtilization;
        
        // Calculate utilization percentage
        const utilizationRate = weeklyCapacity > 0 ? (totalAllocated / weeklyCapacity) * 100 : 0;
        
        // Determine utilization status
        let utilizationStatus: 'under' | 'optimal' | 'over' = 'optimal';
        if (utilizationRate < 70) utilizationStatus = 'under';
        else if (utilizationRate > 100) utilizationStatus = 'over';
        
        return {
          person: {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            targetUtilization: 85,
            weeklyCapacity: 40
          },
          allocations: userAllocations.map(a => ({
            id: a.id,
            projectId: a.projectId,
            projectName: a.projectName,
            clientName: a.clientName,
            role: a.roleName,
            hours: a.hours,
            plannedStartDate: a.plannedStartDate,
            plannedEndDate: a.plannedEndDate,
            status: a.status,
            workstream: a.workstream,
            weekNumber: a.weekNumber,
            taskDescription: a.taskDescription
          })),
          summary: {
            totalAllocated,
            weeklyCapacity,
            targetHours,
            availableHours: weeklyCapacity - totalAllocated,
            utilizationRate: Math.round(utilizationRate),
            utilizationStatus
          }
        };
      });
      
      // Filter by utilization threshold if provided
      const filteredCapacity = utilizationThreshold
        ? capacityByPerson.filter(p => p.summary.utilizationRate >= parseFloat(utilizationThreshold as string))
        : capacityByPerson;
      
      // Calculate aggregate metrics
      const totalCapacity = capacityByPerson.reduce((sum, p) => sum + p.summary.weeklyCapacity, 0);
      const totalAllocated = capacityByPerson.reduce((sum, p) => sum + p.summary.totalAllocated, 0);
      const totalAvailable = totalCapacity - totalAllocated;
      const overAllocatedCount = capacityByPerson.filter(p => p.summary.utilizationStatus === 'over').length;
      
      res.json({
        summary: {
          totalCapacity,
          totalAllocated,
          totalAvailable,
          overAllocatedCount,
          averageUtilization: totalCapacity > 0 ? Math.round((totalAllocated / totalCapacity) * 100) : 0
        },
        capacityByPerson: filteredCapacity
      });
    } catch (error: any) {
      console.error("[ERROR] Failed to fetch capacity timeline:", error);
      res.status(500).json({ message: "Failed to fetch capacity data" });
    }
  });

  // Get current user info
  app.get("/api/users/me", requireAuth, async (req, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "User not found" });
      }
      
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      
      res.json(user);
    } catch (error: any) {
      console.error("[ERROR] Failed to fetch current user:", error);
      res.status(500).json({ message: "Failed to fetch user info" });
    }
  });

  // Project Payment Milestones endpoints (Financial Schedule)
  app.get("/api/projects/:projectId/payment-milestones", requireAuth, async (req, res) => {
    try {
      // Get all milestones and filter for payment milestones
      const allMilestones = await storage.getProjectMilestones(req.params.projectId);
      const paymentMilestones = allMilestones.filter((m: any) => m.isPaymentMilestone === true);
      res.json(paymentMilestones);
    } catch (error: any) {
      console.error("[ERROR] Failed to fetch payment milestones:", error);
      res.status(500).json({ message: "Failed to fetch payment milestones" });
    }
  });

  // Get all payment milestones across all projects (for billing page)
  app.get("/api/payment-milestones/all", requireAuth, requireRole(["admin", "billing-admin"]), async (req, res) => {
    try {
      // Get all projects for this tenant
      const tenantId = req.user?.tenantId;
      const projects = await storage.getProjects(tenantId);
      
      // Batch fetch all milestones for all projects in a single query
      const projectIds = projects.map(p => p.id);
      const milestonesMap = await storage.getProjectMilestonesByProjectIds(projectIds);
      
      // Filter payment milestones and add project names
      const allPaymentMilestones = [];
      for (const project of projects) {
        const milestones = milestonesMap.get(project.id) || [];
        const paymentMilestones = milestones.filter((m: any) => m.isPaymentMilestone === true);
        
        // Add project name to each milestone for display
        for (const milestone of paymentMilestones) {
          allPaymentMilestones.push({
            ...milestone,
            projectName: project.name,
            projectId: project.id
          });
        }
      }
      
      res.json(allPaymentMilestones);
    } catch (error: any) {
      console.error("[ERROR] Failed to fetch all payment milestones:", error);
      res.status(500).json({ message: "Failed to fetch payment milestones" });
    }
  });
  
  // Generate invoice batch from payment milestone
  app.post("/api/payment-milestones/:milestoneId/generate-invoice", requireAuth, requireRole(["admin", "billing-admin"]), async (req, res) => {
    try {
      const { milestoneId } = req.params;
      
      // Validate request body
      const bodySchema = z.object({
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Start date must be in YYYY-MM-DD format"),
        endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "End date must be in YYYY-MM-DD format"),
      }).refine(data => data.startDate <= data.endDate, {
        message: "Start date must be before or equal to end date"
      });
      
      const validatedData = bodySchema.parse(req.body);
      const { startDate, endDate } = validatedData;
      const userId = req.user?.id;
      
      if (!userId) {
        return res.status(401).json({ message: "User ID not found" });
      }
      
      // Get the milestone (must be a payment milestone)
      const [milestone] = await db.select()
        .from(projectMilestones)
        .where(and(
          eq(projectMilestones.id, milestoneId),
          eq(projectMilestones.isPaymentMilestone, true)
        ));
      
      if (!milestone) {
        return res.status(404).json({ message: "Payment milestone not found" });
      }
      
      if (milestone.invoiceStatus !== 'planned') {
        return res.status(400).json({ message: `Cannot generate invoice for milestone with invoice status: ${milestone.invoiceStatus}` });
      }
      
      // Check for existing invoice batch linked to this milestone
      const [existingBatch] = await db.select()
        .from(invoiceBatches)
        .where(eq(invoiceBatches.projectMilestoneId, milestoneId));
      
      if (existingBatch) {
        return res.status(409).json({ 
          message: `Invoice batch ${existingBatch.batchId} is already linked to this milestone. Please use the existing batch or unlink it first.` 
        });
      }
      
      // Generate batch ID with INV prefix for payment milestone invoices
      const date = new Date(startDate);
      const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      const timestamp = Date.now().toString().slice(-4);
      let batchId = `INV-${dateStr}-${timestamp}`;
      
      // Ensure uniqueness
      const existing = await db.select({ batchId: invoiceBatches.batchId })
        .from(invoiceBatches)
        .where(eq(invoiceBatches.batchId, batchId));
      
      if (existing.length > 0) {
        const uniqueSuffix = Math.random().toString(36).substring(2, 6).toUpperCase();
        batchId = `${batchId}-${uniqueSuffix}`;
      }
      
      // Normalize month to first day of start month
      const startDateObj = new Date(startDate);
      const normalizedMonth = `${startDateObj.getFullYear()}-${String(startDateObj.getMonth() + 1).padStart(2, '0')}-01`;
      
      let glInvoiceNumber: string | null = null;
      const tenantId = req.user?.tenantId;
      if (tenantId) {
        try {
          glInvoiceNumber = await storage.getAndIncrementGlInvoiceNumber(tenantId);
        } catch (err) {
          console.warn("[INVOICE] Failed to auto-generate GL invoice number for milestone batch:", err);
        }
      }

      // Fetch project for currency snapshot and clientId
      const [project] = await db.select({
        clientId: projects.clientId,
        quoteCurrency: projects.quoteCurrency,
        costCurrency: projects.costCurrency,
        exchangeRate: projects.exchangeRate,
      }).from(projects).where(eq(projects.id, milestone.projectId));

      // Create invoice batch linked to milestone (snapshot currency from project)
      const batch = await storage.createInvoiceBatch({
        batchId,
        startDate,
        endDate,
        month: normalizedMonth,
        pricingSnapshotDate: new Date().toISOString().split('T')[0],
        discountPercent: null,
        discountAmount: null,
        totalAmount: milestone.amount || "0",
        invoicingMode: "project",
        batchType: "mixed",
        projectMilestoneId: milestoneId,
        exportedToQBO: false,
        createdBy: userId,
        tenantId: tenantId || null,
        glInvoiceNumber,
        quoteCurrency: project?.quoteCurrency || "USD",
        costCurrency: project?.costCurrency || "USD",
        exchangeRate: project?.exchangeRate ?? null,
      });
      
      // Automatically create an invoice line for the milestone amount
      // This allows milestone-based invoicing without time entries
      
      await db.insert(invoiceLines).values({
        batchId,
        projectId: milestone.projectId,
        clientId: project.clientId,
        description: `${milestone.name} - Payment Milestone`,
        amount: milestone.amount || "0",
        quantity: "1",
        rate: milestone.amount || "0",
        type: "milestone",
        projectMilestoneId: milestoneId,
        // Populate monetary tracking fields for invoice analytics
        originalAmount: milestone.amount || "0",
        billedAmount: milestone.amount || "0",
        varianceAmount: "0",
        originalRate: milestone.amount || "0",
        originalQuantity: "1"
      });
      
      // Recalculate tax after line insertion (taxRate defaults to 9.3% from schema)
      await storage.recalculateBatchTax(batchId);

      // NOTE: Milestone status will be updated to 'invoiced' when the batch is finalized
      // Do not update it here to avoid validation errors during finalization
      
      res.json({ batch, milestone });
    } catch (error: any) {
      console.error("[ERROR] Failed to generate invoice from milestone:", error);
      
      if (error instanceof z.ZodError) {
        return res.status(400).json({ 
          message: "Invalid request data", 
          errors: error.errors 
        });
      }
      
      res.status(500).json({ message: "Failed to generate invoice from milestone" });
    }
  });

  app.post("/api/payment-milestones", requireAuth, requireRole(["admin", "billing-admin", "pm"]), async (req, res) => {
    try {
      // Create a milestone with isPaymentMilestone flag set to true.
      // Default invoiceStatus to 'planned' so the milestone is immediately
      // eligible for billing batch creation (the billing UI filters on
      // invoiceStatus === 'planned'). Caller can override via req.body.
      const milestoneData = {
        invoiceStatus: 'planned',
        ...req.body,
        isPaymentMilestone: true
      };
      const milestone = await storage.createProjectMilestone(milestoneData);
      res.json(milestone);
    } catch (error: any) {
      console.error("[ERROR] Failed to create payment milestone:", error);
      res.status(500).json({ message: "Failed to create payment milestone" });
    }
  });

  app.patch("/api/payment-milestones/:id", requireAuth, requireRole(["admin", "billing-admin", "pm"]), async (req, res) => {
    try {
      // Update milestone, ensuring isPaymentMilestone stays true
      const updateData = {
        ...req.body,
        isPaymentMilestone: true
      };
      const milestone = await storage.updateProjectMilestone(req.params.id, updateData);
      res.json(milestone);
    } catch (error: any) {
      console.error("[ERROR] Failed to update payment milestone:", error);
      res.status(500).json({ message: "Failed to update payment milestone" });
    }
  });

  app.delete("/api/payment-milestones/:id", requireAuth, requireRole(["admin", "billing-admin", "pm"]), async (req, res) => {
    try {
      await storage.deleteProjectMilestone(req.params.id);
      res.json({ message: "Payment milestone deleted successfully" });
    } catch (error: any) {
      console.error("[ERROR] Failed to delete payment milestone:", error);
      res.status(500).json({ message: "Failed to delete payment milestone" });
    }
  });

  // Project Workstreams endpoints
  app.get("/api/projects/:projectId/workstreams", requireAuth, async (req, res) => {
    try {
      const workstreams = await storage.getProjectWorkStreams(req.params.projectId);
      res.json(workstreams);
    } catch (error: any) {
      console.error("[ERROR] Failed to fetch project workstreams:", error);
      res.status(500).json({ message: "Failed to fetch project workstreams" });
    }
  });

  app.post("/api/projects/:id/copy-estimate-structure", requireAuth, requireRole(["admin", "pm", "portfolio-manager", "executive"]), async (req, res) => {
    try {
      const { estimateId } = req.body;
      if (!estimateId) {
        return res.status(400).json({ message: "Estimate ID is required" });
      }

      // Verify project exists
      const project = await storage.getProject(req.params.id);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      // Verify estimate exists and is approved
      const estimate = await storage.getEstimate(estimateId);
      if (!estimate) {
        return res.status(404).json({ message: "Estimate not found" });
      }

      if (estimate.status !== 'approved') {
        return res.status(400).json({ message: "Only approved estimates can be copied to projects" });
      }

      await storage.copyEstimateStructureToProject(estimateId, req.params.id);
      // Also copy estimate milestones to project milestones
      await storage.copyEstimateMilestonesToProject(estimateId, req.params.id);
      res.json({ message: "Estimate structure copied to project successfully" });
    } catch (error: any) {
      console.error("[ERROR] Failed to copy estimate structure:", error);
      res.status(500).json({ 
        message: "Failed to copy estimate structure", 
        error: error.message 
      });
    }
  });

  app.get("/api/projects/:id/estimates", requireAuth, async (req, res) => {
    try {
      const estimates = await storage.getEstimatesByProject(req.params.id);
      res.json(estimates);
    } catch (error) {
      console.error("Error fetching project estimates:", error);
      res.status(500).json({ message: "Failed to fetch project estimates" });
    }
  });

  app.get("/api/projects/:id/analytics", requireAuth, async (req, res) => {
    try {
      // Verify project exists
      const project = await storage.getProject(req.params.id);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      const user = req.user!;
      const allowedRoles = ["admin", "billing-admin", "pm", "portfolio-manager", "executive"];
      const hasAllowedRole = allowedRoles.includes(user.role);
      const isProjectPM = project.pm === user.id;

      if (!hasAllowedRole && !isProjectPM) {
        const userAllocations = await storage.getProjectAllocations(req.params.id);
        const isAssigned = userAllocations.some((a: any) => a.personId === user.id);
        if (!isAssigned) {
          return res.status(403).json({ 
            message: "You don't have permission to view this project"
          });
        }
      }

      if (user.role === "pm" && !isProjectPM && user.role !== "portfolio-manager") {
        return res.status(403).json({ 
          message: "You can only view analytics for projects you manage" 
        });
      }

      // Get all analytics data in parallel, including PM name lookup (with error handling)
      const [monthlyMetrics, burnRate, teamHours, pmUser] = await Promise.all([
        storage.getProjectMonthlyMetrics(req.params.id),
        storage.getProjectBurnRate(req.params.id),
        storage.getProjectTeamHours(req.params.id),
        project.pm ? storage.getUser(project.pm).catch(() => null) : Promise.resolve(null)
      ]);

      // Enhance project with PM name
      const projectWithPmName = {
        ...project,
        pmName: pmUser?.name || null
      };

      res.json({
        project: projectWithPmName,
        monthlyMetrics,
        burnRate,
        teamHours
      });
    } catch (error: any) {
      console.error("[ERROR] Failed to fetch project analytics:", error);
      res.status(500).json({ 
        message: "Failed to fetch project analytics", 
        error: error.message 
      });
    }
  });

  app.get("/api/projects/:id/retainer-utilization", requireAuth, async (req, res) => {
    try {
      const project = await storage.getProject(req.params.id);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      const tenantId = req.user?.tenantId;
      if (tenantId && project.tenantId && project.tenantId !== tenantId) {
        return res.status(403).json({ message: "Access denied" });
      }

      const epics = await db.select().from(projectEpics).where(eq(projectEpics.projectId, req.params.id));
      const epicIds = epics.map(e => e.id);
      if (epicIds.length === 0) {
        return res.json({ months: [], config: null });
      }

      const stages = await db.select().from(projectStages).where(inArray(projectStages.epicId, epicIds));
      const retainerStages = stages.filter(s => s.retainerMonthIndex !== null);
      if (retainerStages.length === 0) {
        return res.json({ months: [], config: null });
      }

      const estimate = project.estimateId ? await storage.getEstimate(project.estimateId) : null;

      const timeEntryRows = await db.select({
        date: timeEntries.date,
        hours: timeEntries.hours,
        personId: timeEntries.personId,
      }).from(timeEntries).where(eq(timeEntries.projectId, req.params.id));

      const months = retainerStages
        .sort((a, b) => (a.retainerMonthIndex || 0) - (b.retainerMonthIndex || 0))
        .map(stage => {
          const startDate = stage.retainerStartDate;
          const endDate = stage.retainerEndDate;
          const maxHours = parseFloat(stage.retainerMaxHours || '0');

          const monthEntries = timeEntryRows.filter(te => {
            const d = te.date;
            return d && d >= (startDate || '') && d <= (endDate || '');
          });
          const usedHours = monthEntries.reduce((s, e) => s + parseFloat(e.hours || '0'), 0);

          return {
            monthIndex: stage.retainerMonthIndex,
            label: stage.retainerMonthLabel || `Month ${(stage.retainerMonthIndex || 0) + 1}`,
            startDate,
            endDate,
            maxHours,
            usedHours: Math.round(usedHours * 100) / 100,
            utilization: maxHours > 0 ? Math.round((usedHours / maxHours) * 100) : 0,
            remaining: Math.round((maxHours - usedHours) * 100) / 100,
          };
        });

      res.json({
        months,
        config: estimate?.retainerConfig || null,
        totalMaxHours: months.reduce((s, m) => s + m.maxHours, 0),
        totalUsedHours: months.reduce((s, m) => s + m.usedHours, 0),
      });
    } catch (error) {
      console.error("Error fetching retainer utilization:", error);
      res.status(500).json({ message: "Failed to fetch retainer utilization" });
    }
  });

  // ============================================================================
  // PROJECT RETAINER STAGE MANAGEMENT
  // ============================================================================

  // Get retainer stages for a project
  app.get("/api/projects/:id/retainer-stages", requireAuth, async (req, res) => {
    try {
      const project = await storage.getProject(req.params.id);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      const tenantId = req.user?.tenantId;
      if (tenantId && project.tenantId && project.tenantId !== tenantId) {
        return res.status(403).json({ message: "Access denied" });
      }

      const epics = await db.select().from(projectEpics).where(eq(projectEpics.projectId, req.params.id));
      const epicIds = epics.map(e => e.id);
      if (epicIds.length === 0) {
        return res.json([]);
      }

      const stages = await db.select().from(projectStages).where(inArray(projectStages.epicId, epicIds));
      const retainerStages = stages
        .filter(s => s.retainerMonthIndex !== null)
        .sort((a, b) => (a.retainerMonthIndex || 0) - (b.retainerMonthIndex || 0));

      res.json(retainerStages);
    } catch (error) {
      console.error("Error fetching retainer stages:", error);
      res.status(500).json({ message: "Failed to fetch retainer stages" });
    }
  });

  // Add a retainer month to a project (creates/reuses "Retainer" epic)
  app.post("/api/projects/:id/retainer-stages", requireAuth, requireRole(["admin", "billing-admin", "pm"]), async (req, res) => {
    try {
      const project = await storage.getProject(req.params.id);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      const tenantId = req.user?.tenantId;
      if (tenantId && project.tenantId && project.tenantId !== tenantId) {
        return res.status(403).json({ message: "Access denied" });
      }

      const { monthLabel, maxHours, startDate, endDate, rateTiers } = req.body;
      if (!monthLabel || !startDate || !endDate) {
        return res.status(400).json({ message: "monthLabel, startDate, and endDate are required" });
      }

      let effectiveMaxHours = maxHours;
      let validatedRateTiers = null;
      if (Array.isArray(rateTiers) && rateTiers.length > 0) {
        validatedRateTiers = rateTiers.map((t: any) => ({
          name: String(t.name || ''),
          rate: Number(t.rate) || 0,
          maxHours: Number(t.maxHours) || 0,
        })).filter((t: any) => t.rate > 0 && t.maxHours > 0);
        if (validatedRateTiers.length > 0) {
          effectiveMaxHours = validatedRateTiers.reduce((sum: number, t: any) => sum + t.maxHours, 0);
        } else {
          validatedRateTiers = null;
        }
      }
      if (!effectiveMaxHours) {
        return res.status(400).json({ message: "maxHours or rateTiers with hours are required" });
      }

      // Find or create a "Retainer" epic for this project
      const epics = await db.select().from(projectEpics).where(eq(projectEpics.projectId, req.params.id));
      let retainerEpic = epics.find(e => e.name === 'Retainer');
      
      if (!retainerEpic) {
        const maxOrder = epics.length > 0 ? Math.max(...epics.map(e => e.order)) : -1;
        const [created] = await db.insert(projectEpics).values({
          projectId: req.params.id,
          name: 'Retainer',
          order: maxOrder + 1,
        }).returning();
        retainerEpic = created;
      }

      // Get existing retainer stages to determine next monthIndex
      const existingStages = await db.select().from(projectStages).where(eq(projectStages.epicId, retainerEpic.id));
      const retainerStages = existingStages.filter(s => s.retainerMonthIndex !== null);
      const nextIndex = retainerStages.length > 0 
        ? Math.max(...retainerStages.map(s => s.retainerMonthIndex || 0)) + 1 
        : 0;
      const nextOrder = existingStages.length > 0 
        ? Math.max(...existingStages.map(s => s.order)) + 1 
        : 0;

      const [stage] = await db.insert(projectStages).values({
        epicId: retainerEpic.id,
        name: monthLabel,
        order: nextOrder,
        retainerMonthIndex: nextIndex,
        retainerMonthLabel: monthLabel,
        retainerMaxHours: String(effectiveMaxHours),
        retainerRateTiers: validatedRateTiers,
        retainerStartDate: startDate,
        retainerEndDate: endDate,
      }).returning();

      if (project.commercialScheme !== 'retainer') {
        await db.update(projects).set({ commercialScheme: 'retainer' }).where(eq(projects.id, req.params.id));
      }

      try {
        await generateRetainerPaymentMilestones(req.params.id, [stage]);
      } catch (milestoneError) {
        console.error("Error auto-generating payment milestone (non-fatal):", milestoneError);
      }

      res.status(201).json(stage);
    } catch (error) {
      console.error("Error creating retainer stage:", error);
      res.status(500).json({ message: "Failed to create retainer stage" });
    }
  });

  // Add multiple retainer months at once (extend retainer)
  app.post("/api/projects/:id/retainer-stages/extend", requireAuth, requireRole(["admin", "billing-admin", "pm"]), async (req, res) => {
    try {
      const project = await storage.getProject(req.params.id);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      const tenantId = req.user?.tenantId;
      if (tenantId && project.tenantId && project.tenantId !== tenantId) {
        return res.status(403).json({ message: "Access denied" });
      }

      const { monthCount, startMonth, hoursPerMonth, rateTiers } = req.body;
      
      let validatedRateTiers = null;
      let effectiveHoursPerMonth = hoursPerMonth;
      if (Array.isArray(rateTiers) && rateTiers.length > 0) {
        validatedRateTiers = rateTiers.map((t: any) => ({
          name: String(t.name || ''),
          rate: Number(t.rate) || 0,
          maxHours: Number(t.maxHours) || 0,
        })).filter((t: any) => t.rate > 0 && t.maxHours > 0);
        if (validatedRateTiers.length > 0) {
          effectiveHoursPerMonth = validatedRateTiers.reduce((sum: number, t: any) => sum + t.maxHours, 0);
        } else {
          validatedRateTiers = null;
        }
      }
      
      if (!monthCount || !startMonth || !effectiveHoursPerMonth) {
        return res.status(400).json({ message: "monthCount, startMonth, and hoursPerMonth (or rateTiers) are required" });
      }

      // Find or create a "Retainer" epic
      const epics = await db.select().from(projectEpics).where(eq(projectEpics.projectId, req.params.id));
      let retainerEpic = epics.find(e => e.name === 'Retainer');
      
      if (!retainerEpic) {
        const maxOrder = epics.length > 0 ? Math.max(...epics.map(e => e.order)) : -1;
        const [created] = await db.insert(projectEpics).values({
          projectId: req.params.id,
          name: 'Retainer',
          order: maxOrder + 1,
        }).returning();
        retainerEpic = created;
      }

      // Get existing retainer stages
      const existingStages = await db.select().from(projectStages).where(eq(projectStages.epicId, retainerEpic.id));
      const retainerStages = existingStages.filter(s => s.retainerMonthIndex !== null);
      let nextIndex = retainerStages.length > 0 
        ? Math.max(...retainerStages.map(s => s.retainerMonthIndex || 0)) + 1 
        : 0;
      let nextOrder = existingStages.length > 0 
        ? Math.max(...existingStages.map(s => s.order)) + 1 
        : 0;

      const newStages = [];
      const [startYear, startMonthNum] = startMonth.split('-').map(Number);

      for (let m = 0; m < Math.min(monthCount, 36); m++) {
        const monthDate = new Date(startYear, startMonthNum - 1 + m, 1);
        const monthEnd = new Date(startYear, startMonthNum - 1 + m + 1, 0);
        const label = monthDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

        const [stage] = await db.insert(projectStages).values({
          epicId: retainerEpic.id,
          name: label,
          order: nextOrder + m,
          retainerMonthIndex: nextIndex + m,
          retainerMonthLabel: label,
          retainerMaxHours: String(effectiveHoursPerMonth),
          retainerRateTiers: validatedRateTiers,
          retainerStartDate: monthDate.toISOString().split('T')[0],
          retainerEndDate: monthEnd.toISOString().split('T')[0],
        }).returning();
        newStages.push(stage);
      }

      // Ensure project commercial scheme is retainer
      if (project.commercialScheme !== 'retainer') {
        await db.update(projects).set({ commercialScheme: 'retainer' }).where(eq(projects.id, req.params.id));
      }

      try {
        await generateRetainerPaymentMilestones(req.params.id, newStages);
      } catch (milestoneError) {
        console.error("Error auto-generating payment milestones (non-fatal):", milestoneError);
      }

      res.status(201).json(newStages);
    } catch (error) {
      console.error("Error extending retainer:", error);
      res.status(500).json({ message: "Failed to extend retainer" });
    }
  });

  // Update a retainer stage
  app.patch("/api/projects/:id/retainer-stages/:stageId", requireAuth, requireRole(["admin", "billing-admin", "pm"]), async (req, res) => {
    try {
      const project = await storage.getProject(req.params.id);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      const tenantId = req.user?.tenantId;
      if (tenantId && project.tenantId && project.tenantId !== tenantId) {
        return res.status(403).json({ message: "Access denied" });
      }

      // Verify stage belongs to this project
      const [stage] = await db.select().from(projectStages).where(eq(projectStages.id, req.params.stageId));
      if (!stage || stage.retainerMonthIndex === null) {
        return res.status(404).json({ message: "Retainer stage not found" });
      }
      const epics = await db.select().from(projectEpics).where(eq(projectEpics.projectId, req.params.id));
      const epicIds = epics.map(e => e.id);
      if (!epicIds.includes(stage.epicId)) {
        return res.status(403).json({ message: "Stage does not belong to this project" });
      }

      const { monthLabel, maxHours, startDate, endDate, rateTiers } = req.body;
      const updates: any = {};
      if (monthLabel !== undefined) {
        updates.retainerMonthLabel = monthLabel;
        updates.name = monthLabel;
      }
      if (startDate !== undefined) {
        updates.retainerStartDate = startDate;
      }
      if (endDate !== undefined) {
        updates.retainerEndDate = endDate;
      }
      if (rateTiers !== undefined) {
        if (Array.isArray(rateTiers) && rateTiers.length > 0) {
          const validated = rateTiers.map((t: any) => ({
            name: String(t.name || ''),
            rate: Number(t.rate) || 0,
            maxHours: Number(t.maxHours) || 0,
          })).filter((t: any) => t.rate > 0 && t.maxHours > 0);
          if (validated.length > 0) {
            updates.retainerRateTiers = validated;
            updates.retainerMaxHours = String(validated.reduce((sum: number, t: any) => sum + t.maxHours, 0));
          } else {
            updates.retainerRateTiers = null;
            if (maxHours !== undefined) updates.retainerMaxHours = String(maxHours);
          }
        } else {
          updates.retainerRateTiers = null;
          if (maxHours !== undefined) updates.retainerMaxHours = String(maxHours);
        }
      } else if (maxHours !== undefined) {
        updates.retainerMaxHours = String(maxHours);
      }

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ message: "No valid fields to update" });
      }

      const [updated] = await db.update(projectStages)
        .set(updates)
        .where(eq(projectStages.id, req.params.stageId))
        .returning();

      res.json(updated);
    } catch (error) {
      console.error("Error updating retainer stage:", error);
      res.status(500).json({ message: "Failed to update retainer stage" });
    }
  });

  // Delete a retainer stage
  app.delete("/api/projects/:id/retainer-stages/:stageId", requireAuth, requireRole(["admin", "billing-admin", "pm"]), async (req, res) => {
    try {
      const project = await storage.getProject(req.params.id);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      const tenantId = req.user?.tenantId;
      if (tenantId && project.tenantId && project.tenantId !== tenantId) {
        return res.status(403).json({ message: "Access denied" });
      }

      // Verify stage belongs to this project
      const [stage] = await db.select().from(projectStages).where(eq(projectStages.id, req.params.stageId));
      if (!stage || stage.retainerMonthIndex === null) {
        return res.status(404).json({ message: "Retainer stage not found" });
      }
      const epics = await db.select().from(projectEpics).where(eq(projectEpics.projectId, req.params.id));
      const epicIds = epics.map(e => e.id);
      if (!epicIds.includes(stage.epicId)) {
        return res.status(403).json({ message: "Stage does not belong to this project" });
      }

      await db.delete(projectStages).where(eq(projectStages.id, req.params.stageId));
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting retainer stage:", error);
      res.status(500).json({ message: "Failed to delete retainer stage" });
    }
  });

  // Text export for project reporting - summary of project data for copy/paste
  app.get("/api/projects/:id/export-text", requireAuth, async (req, res) => {
    try {
      const project = await storage.getProject(req.params.id);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      // Check user permissions: admin, billing-admin, executives, portfolio-manager, or PM for this project
      const canViewProject = 
        req.user!.role === 'admin' ||
        req.user!.role === 'billing-admin' ||
        req.user!.role === 'executive' ||
        req.user!.role === 'portfolio-manager' ||
        (req.user!.role === 'pm' && project.pm === req.user!.id);

      if (!canViewProject) {
        return res.status(403).json({ 
          message: "You can only export projects you manage" 
        });
      }

      // Parse date range parameters
      const { startDate, endDate } = req.query;
      
      // Get project structure and data
      const [epics, milestones, workstreams, allocations, vocabulary, raiddEntries] = await Promise.all([
        storage.getProjectEpics(req.params.id),
        storage.getProjectMilestones(req.params.id),
        storage.getProjectWorkStreams(req.params.id),
        storage.getProjectAllocations(req.params.id),
        storage.getVocabularyForContext({
          projectId: req.params.id,
          clientId: project.clientId,
          estimateId: undefined
        }),
        storage.getRaiddEntries(req.params.id, {}),
      ]);

      // Get all stages for all epics in a single batch query
      const epicIds = epics.map(e => e.id);
      const stagesMap = await storage.getProjectStagesByEpicIds(epicIds);
      const allStages: any[] = [];
      for (const epic of epics) {
        const stages = stagesMap.get(epic.id) || [];
        allStages.push(...stages.map((s: any) => ({ ...s, epicId: epic.id })));
      }

      // Get time entries with date filtering
      const timeFilters: any = { projectId: req.params.id };
      if (startDate) timeFilters.startDate = startDate as string;
      if (endDate) timeFilters.endDate = endDate as string;
      const timeEntries = await storage.getTimeEntries(timeFilters);

      // Get expenses with date filtering
      const expenseFilters: any = { projectId: req.params.id };
      if (startDate) expenseFilters.startDate = startDate as string;
      if (endDate) expenseFilters.endDate = endDate as string;
      const expenses = await storage.getExpenses(expenseFilters);

      // Get invoice batches for the project's client
      const invoiceBatches = await storage.getInvoiceBatchesForClient(project.clientId);
      
      // Filter invoice batches by date if specified
      let filteredInvoices = invoiceBatches;
      if (startDate || endDate) {
        filteredInvoices = invoiceBatches.filter((batch: any) => {
          if (!batch.endDate) return false;
          const batchDate = new Date(batch.endDate);
          if (startDate && batchDate < new Date(startDate as string)) return false;
          if (endDate && batchDate > new Date(endDate as string)) return false;
          return true;
        });
      }

      // Get vocabulary labels
      const epicLabel = vocabulary.epic || "Epic";
      const stageLabel = vocabulary.stage || "Stage";
      const workstreamLabel = vocabulary.workstream || "Workstream";
      const milestoneLabel = "Milestone"; // Milestone is not part of vocabulary terms yet

      // Generate text output
      let textOutput = "";
      
      // Header
      textOutput += `PROJECT SUMMARY: ${project.name}\n`;
      textOutput += `CLIENT: ${project.client?.name || 'Unknown'}\n`;
      textOutput += `STATUS: ${project.status}\n`;
      if (project.description) {
        textOutput += `\nOVERVIEW/VISION:\n${project.description}\n`;
      }
      if (project.startDate) {
        textOutput += `\nSTART DATE: ${project.startDate}\n`;
      }
      if (project.endDate) {
        textOutput += `END DATE: ${project.endDate}\n`;
      }
      if (startDate || endDate) {
        textOutput += `\nREPORT DATE RANGE: ${startDate || 'Start'} to ${endDate || 'End'}\n`;
      }
      textOutput += `\n${"=".repeat(80)}\n\n`;

      // Team & Resources - Grouped by Month
      if (allocations && allocations.length > 0) {
        textOutput += `TEAM ASSIGNMENTS BY MONTH\n\n`;
        
        const activeAllocations = allocations.filter((a: any) => a.status !== 'cancelled');
        
        // Group allocations by month based on their date ranges
        const allocationsByMonth = new Map<string, any[]>();
        
        activeAllocations.forEach((allocation: any) => {
          const startDate = allocation.startDate ? new Date(allocation.startDate) : new Date(project.startDate || new Date());
          const endDate = allocation.endDate ? new Date(allocation.endDate) : new Date(project.endDate || new Date());
          
          // Generate all months in the allocation period
          const currentMonth = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
          const lastMonth = new Date(endDate.getFullYear(), endDate.getMonth(), 1);
          
          while (currentMonth <= lastMonth) {
            const monthKey = `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, '0')}`;
            const monthLabel = currentMonth.toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
            
            if (!allocationsByMonth.has(monthKey)) {
              allocationsByMonth.set(monthKey, []);
            }
            allocationsByMonth.get(monthKey)!.push({ ...allocation, monthLabel });
            
            currentMonth.setMonth(currentMonth.getMonth() + 1);
          }
        });

        // Sort months chronologically
        const sortedMonths = Array.from(allocationsByMonth.entries()).sort((a, b) => a[0].localeCompare(b[0]));
        
        sortedMonths.forEach(([monthKey, monthAllocations]) => {
          const monthLabel = monthAllocations[0].monthLabel;
          // Use allocation ID for deduplication to preserve all distinct assignments
          const uniqueAllocations = Array.from(new Map(monthAllocations.map(a => [a.id, a])).values());
          
          textOutput += `${monthLabel.toUpperCase()}\n`;
          textOutput += `${"-".repeat(80)}\n`;
          
          uniqueAllocations.forEach((allocation: any, index: number) => {
            const personName = allocation.person?.name || allocation.resourceName || 'Unassigned';
            textOutput += `${index + 1}. ${personName}`;
            if (allocation.role?.name) {
              textOutput += ` - ${allocation.role.name}`;
            }
            textOutput += `\n`;
            
            if (allocation.workstream?.name) {
              textOutput += `   ${workstreamLabel}: ${allocation.workstream.name}\n`;
            }
            if (allocation.taskDescription) {
              textOutput += `   Task: ${allocation.taskDescription}\n`;
            }
            if (allocation.hours) {
              textOutput += `   Allocated Hours: ${allocation.hours}\n`;
            }
            if (allocation.status) {
              textOutput += `   Status: ${allocation.status}\n`;
            }
            if (allocation.plannedStartDate || allocation.plannedEndDate) {
              textOutput += `   Period: ${allocation.plannedStartDate || 'Start'} to ${allocation.plannedEndDate || 'End'}\n`;
            }
            if (allocation.notes) {
              textOutput += `   Notes: ${allocation.notes}\n`;
            }
            textOutput += `\n`;
          });
        });
        
        textOutput += `${"=".repeat(80)}\n\n`;
      }

      // Project Structure
      if (epics.length > 0 || workstreams.length > 0) {
        textOutput += `PROJECT STRUCTURE\n\n`;

        // Epics and Stages
        if (epics.length > 0) {
          epics
            .sort((a: any, b: any) => (a.order || 0) - (b.order || 0))
            .forEach((epic: any, epicIndex: number) => {
              textOutput += `${epicLabel.toUpperCase()} ${epicIndex + 1}: ${epic.name}\n`;
              if (epic.description) {
                textOutput += `  ${epic.description}\n`;
              }
              textOutput += `${"-".repeat(80)}\n`;

              const epicStages = allStages.filter((s: any) => s.epicId === epic.id);
              if (epicStages.length > 0) {
                epicStages
                  .sort((a: any, b: any) => (a.order || 0) - (b.order || 0))
                  .forEach((stage: any, stageIndex: number) => {
                    textOutput += `\n  ${stageLabel} ${stageIndex + 1}: ${stage.name}\n`;
                    if (stage.description) {
                      textOutput += `    ${stage.description}\n`;
                    }
                  });
              }
              textOutput += `\n`;
            });
        }

        // Workstreams
        if (workstreams.length > 0) {
          textOutput += `\n${workstreamLabel.toUpperCase()}S\n`;
          textOutput += `${"-".repeat(80)}\n`;
          workstreams.forEach((ws: any, index: number) => {
            textOutput += `${index + 1}. ${ws.name}\n`;
            if (ws.description) {
              textOutput += `   ${ws.description}\n`;
            }
            if (ws.budgetHours) {
              textOutput += `   Budget Hours: ${ws.budgetHours}\n`;
            }
            textOutput += `\n`;
          });
        }

        textOutput += `${"=".repeat(80)}\n\n`;
      }

      // Milestones
      if (milestones && milestones.length > 0) {
        textOutput += `${milestoneLabel.toUpperCase()}S\n\n`;
        
        milestones
          .sort((a: any, b: any) => {
            if (a.targetDate && b.targetDate) {
              return new Date(a.targetDate).getTime() - new Date(b.targetDate).getTime();
            }
            return 0;
          })
          .forEach((milestone: any, index: number) => {
            textOutput += `${index + 1}. ${milestone.name}\n`;
            if (milestone.description) {
              textOutput += `   ${milestone.description}\n`;
            }
            if (milestone.targetDate) {
              textOutput += `   Target Date: ${milestone.targetDate}\n`;
            }
            if (milestone.actualDate) {
              textOutput += `   Actual Date: ${milestone.actualDate}\n`;
            }
            if (milestone.status) {
              textOutput += `   Status: ${milestone.status}\n`;
            }
            textOutput += `\n`;
          });
        
        textOutput += `${"=".repeat(80)}\n\n`;
      }

      // RAIDD Log
      if (raiddEntries && raiddEntries.length > 0) {
        textOutput += `RAIDD LOG (Risks, Action Items, Issues, Decisions, Dependencies)\n\n`;

        const openStatuses = ["open", "in_progress"];
        const raiddByType = {
          risks: raiddEntries.filter((r: any) => r.type === "risk"),
          issues: raiddEntries.filter((r: any) => r.type === "issue"),
          actionItems: raiddEntries.filter((r: any) => r.type === "action_item"),
          decisions: raiddEntries.filter((r: any) => r.type === "decision"),
          dependencies: raiddEntries.filter((r: any) => r.type === "dependency"),
        };

        const formatRaiddEntry = (entry: any) => {
          let line = `  ${entry.refNumber || "-"} ${entry.title}`;
          if (entry.priority) line += ` [${entry.priority.toUpperCase()}]`;
          line += ` (${entry.status})`;
          if (entry.ownerName) line += ` — Owner: ${entry.ownerName}`;
          if (entry.assigneeName && entry.assigneeName !== entry.ownerName) line += ` | Assignee: ${entry.assigneeName}`;
          if (entry.dueDate) line += ` | Due: ${entry.dueDate}`;
          if (entry.impact) line += ` | Impact: ${entry.impact}`;
          if (entry.likelihood) line += ` | Likelihood: ${entry.likelihood}`;
          line += `\n`;
          if (entry.description) line += `    Description: ${entry.description}\n`;
          if (entry.mitigationPlan) line += `    Mitigation: ${entry.mitigationPlan}\n`;
          if (entry.resolutionNotes) line += `    Resolution: ${entry.resolutionNotes}\n`;
          return line;
        };

        // Risks
        const activeRisks = raiddByType.risks.filter((r: any) => openStatuses.includes(r.status));
        const closedRisks = raiddByType.risks.filter((r: any) => !openStatuses.includes(r.status));
        textOutput += `RISKS (${activeRisks.length} active, ${closedRisks.length} closed)\n`;
        textOutput += `${"-".repeat(80)}\n`;
        if (activeRisks.length > 0) {
          activeRisks.forEach((r: any) => { textOutput += formatRaiddEntry(r); });
        } else {
          textOutput += `  No active risks.\n`;
        }
        if (closedRisks.length > 0) {
          textOutput += `\n  Closed/Mitigated:\n`;
          closedRisks.forEach((r: any) => { textOutput += formatRaiddEntry(r); });
        }
        textOutput += `\n`;

        // Issues
        const activeIssues = raiddByType.issues.filter((r: any) => openStatuses.includes(r.status));
        const closedIssues = raiddByType.issues.filter((r: any) => !openStatuses.includes(r.status));
        textOutput += `ISSUES (${activeIssues.length} active, ${closedIssues.length} closed)\n`;
        textOutput += `${"-".repeat(80)}\n`;
        if (activeIssues.length > 0) {
          activeIssues.forEach((r: any) => { textOutput += formatRaiddEntry(r); });
        } else {
          textOutput += `  No active issues.\n`;
        }
        if (closedIssues.length > 0) {
          textOutput += `\n  Resolved/Closed:\n`;
          closedIssues.forEach((r: any) => { textOutput += formatRaiddEntry(r); });
        }
        textOutput += `\n`;

        // Action Items
        const openActions = raiddByType.actionItems.filter((r: any) => openStatuses.includes(r.status));
        const closedActions = raiddByType.actionItems.filter((r: any) => !openStatuses.includes(r.status));
        const overdueActions = openActions.filter((r: any) => r.dueDate && new Date(r.dueDate) < new Date());
        textOutput += `ACTION ITEMS (${openActions.length} open, ${closedActions.length} closed`;
        if (overdueActions.length > 0) textOutput += `, ${overdueActions.length} OVERDUE`;
        textOutput += `)\n`;
        textOutput += `${"-".repeat(80)}\n`;
        if (openActions.length > 0) {
          openActions.forEach((r: any) => {
            const isOverdue = r.dueDate && new Date(r.dueDate) < new Date();
            textOutput += isOverdue ? `  ⚠️ OVERDUE: ` : `  `;
            textOutput += `${r.refNumber || "-"} ${r.title}`;
            if (r.priority) textOutput += ` [${r.priority.toUpperCase()}]`;
            textOutput += ` (${r.status})`;
            if (r.assigneeName || r.ownerName) textOutput += ` — Assigned: ${r.assigneeName || r.ownerName}`;
            if (r.dueDate) textOutput += ` | Due: ${r.dueDate}`;
            textOutput += `\n`;
            if (r.description) textOutput += `    Description: ${r.description}\n`;
          });
        } else {
          textOutput += `  No open action items.\n`;
        }
        if (closedActions.length > 0) {
          textOutput += `\n  Completed:\n`;
          closedActions.forEach((r: any) => { textOutput += formatRaiddEntry(r); });
        }
        textOutput += `\n`;

        // Decisions
        textOutput += `DECISIONS (${raiddByType.decisions.length} total)\n`;
        textOutput += `${"-".repeat(80)}\n`;
        if (raiddByType.decisions.length > 0) {
          raiddByType.decisions.forEach((r: any) => { textOutput += formatRaiddEntry(r); });
        } else {
          textOutput += `  No decisions recorded.\n`;
        }
        textOutput += `\n`;

        // Dependencies
        const activeDeps = raiddByType.dependencies.filter((r: any) => openStatuses.includes(r.status));
        const closedDeps = raiddByType.dependencies.filter((r: any) => !openStatuses.includes(r.status));
        textOutput += `DEPENDENCIES (${activeDeps.length} active, ${closedDeps.length} closed)\n`;
        textOutput += `${"-".repeat(80)}\n`;
        if (activeDeps.length > 0) {
          activeDeps.forEach((r: any) => { textOutput += formatRaiddEntry(r); });
        } else {
          textOutput += `  No active dependencies.\n`;
        }
        if (closedDeps.length > 0) {
          textOutput += `\n  Resolved/Closed:\n`;
          closedDeps.forEach((r: any) => { textOutput += formatRaiddEntry(r); });
        }
        textOutput += `\n`;

        textOutput += `${"=".repeat(80)}\n\n`;
      }

      // Time Entries - Grouped by Month
      if (timeEntries && timeEntries.length > 0) {
        textOutput += `TIME ENTRIES BY MONTH\n\n`;
        
        const totalHours = timeEntries.reduce((sum, entry) => sum + parseFloat(entry.hours || '0'), 0);
        const billableHours = timeEntries.filter(e => e.billable).reduce((sum, entry) => sum + parseFloat(entry.hours || '0'), 0);
        
        textOutput += `OVERALL SUMMARY\n`;
        textOutput += `Total Hours: ${totalHours.toFixed(2)}\n`;
        textOutput += `Billable Hours: ${billableHours.toFixed(2)}\n`;
        textOutput += `Non-Billable Hours: ${(totalHours - billableHours).toFixed(2)}\n`;
        textOutput += `Number of Entries: ${timeEntries.length}\n\n`;
        
        // Group by month
        const byMonth = new Map<string, any[]>();
        timeEntries.forEach(entry => {
          const date = new Date(entry.date);
          const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
          const monthLabel = date.toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
          
          if (!byMonth.has(monthKey)) {
            byMonth.set(monthKey, []);
          }
          byMonth.get(monthKey)!.push({ ...entry, monthLabel });
        });

        // Sort months chronologically
        const sortedMonths = Array.from(byMonth.entries()).sort((a, b) => a[0].localeCompare(b[0]));
        
        textOutput += `MONTHLY BREAKDOWN\n`;
        textOutput += `${"-".repeat(80)}\n\n`;
        
        sortedMonths.forEach(([monthKey, entries]) => {
          const monthLabel = entries[0].monthLabel;
          const monthHours = entries.reduce((sum, e) => sum + parseFloat(e.hours || '0'), 0);
          const monthBillable = entries.filter(e => e.billable).reduce((sum, e) => sum + parseFloat(e.hours || '0'), 0);
          
          textOutput += `${monthLabel.toUpperCase()}\n`;
          textOutput += `Total: ${monthHours.toFixed(2)} hours (${monthBillable.toFixed(2)} billable)\n`;
          textOutput += `Entries: ${entries.length}\n\n`;
          
          // Group by person within month
          const byPerson = new Map<string, any[]>();
          entries.forEach(entry => {
            const personName = entry.person?.name || 'Unknown';
            if (!byPerson.has(personName)) {
              byPerson.set(personName, []);
            }
            byPerson.get(personName)!.push(entry);
          });
          
          // Show each person's entries
          Array.from(byPerson.entries())
            .sort((a, b) => {
              const aHours = a[1].reduce((sum, e) => sum + parseFloat(e.hours || '0'), 0);
              const bHours = b[1].reduce((sum, e) => sum + parseFloat(e.hours || '0'), 0);
              return bHours - aHours;
            })
            .forEach(([person, personEntries]) => {
              const personHours = personEntries.reduce((sum, e) => sum + parseFloat(e.hours || '0'), 0);
              const personBillable = personEntries.filter(e => e.billable).reduce((sum, e) => sum + parseFloat(e.hours || '0'), 0);
              
              textOutput += `  ${person}: ${personHours.toFixed(2)} hours (${personBillable.toFixed(2)} billable)\n`;
              
              // Show individual entries
              personEntries
                .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
                .forEach(entry => {
                  const billableTag = entry.billable ? '[B]' : '[NB]';
                  textOutput += `    ${entry.date} ${billableTag} ${entry.hours}h`;
                  if (entry.description) {
                    textOutput += ` - ${entry.description}`;
                  }
                  textOutput += `\n`;
                });
              textOutput += `\n`;
            });
        });
        
        textOutput += `${"=".repeat(80)}\n\n`;
      }

      // Expenses Summary
      if (expenses && expenses.length > 0) {
        textOutput += `EXPENSES SUMMARY\n\n`;
        
        const totalExpenses = expenses.reduce((sum, exp) => sum + parseFloat(exp.amount || '0'), 0);
        const billableExpenses = expenses.filter(e => e.billable).reduce((sum, exp) => sum + parseFloat(exp.amount || '0'), 0);
        
        textOutput += `Total Expenses: $${totalExpenses.toFixed(2)}\n`;
        textOutput += `Billable Expenses: $${billableExpenses.toFixed(2)}\n`;
        textOutput += `Non-Billable Expenses: $${(totalExpenses - billableExpenses).toFixed(2)}\n`;
        textOutput += `Number of Expenses: ${expenses.length}\n\n`;
        
        // Group by category
        const byCategory = new Map<string, { amount: number; count: number }>();
        expenses.forEach(exp => {
          const category = exp.category || 'Uncategorized';
          const existing = byCategory.get(category) || { amount: 0, count: 0 };
          existing.amount += parseFloat(exp.amount || '0');
          existing.count += 1;
          byCategory.set(category, existing);
        });

        textOutput += `By Category:\n`;
        Array.from(byCategory.entries())
          .sort((a, b) => b[1].amount - a[1].amount)
          .forEach(([category, data]) => {
            textOutput += `  ${category}: $${data.amount.toFixed(2)} (${data.count} expenses)\n`;
          });
        
        textOutput += `\n${"=".repeat(80)}\n\n`;
      }

      // Invoices
      if (filteredInvoices && filteredInvoices.length > 0) {
        textOutput += `INVOICES\n\n`;
        
        filteredInvoices.forEach((batch: any, index: number) => {
          textOutput += `${index + 1}. Invoice Batch ${index + 1}\n`;
          if (batch.startDate && batch.endDate) {
            textOutput += `   Period: ${batch.startDate} to ${batch.endDate}\n`;
          }
          if (batch.status) {
            textOutput += `   Status: ${batch.status}\n`;
          }
          if (batch.totalAmount) {
            textOutput += `   Total: $${parseFloat(batch.totalAmount).toFixed(2)}\n`;
          }
          textOutput += `\n`;
        });
      }

      const filename = `${project.name.replace(/[^a-z0-9]/gi, '_')}-report${startDate ? `-${startDate}` : ''}${endDate ? `-${endDate}` : ''}.txt`;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(textOutput);
    } catch (error) {
      console.error("Project text export error:", error);
      res.status(500).json({ message: "Failed to export project summary" });
    }
  });

  // PowerPoint status report export with AI-generated narrative content
  app.post("/api/projects/:id/export-pptx", requireAuth, async (req, res) => {
    req.setTimeout(180000);
    res.setTimeout(180000);
    try {
      const project = await storage.getProject(req.params.id);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      const canViewProject = 
        req.user!.role === 'admin' ||
        req.user!.role === 'billing-admin' ||
        req.user!.role === 'executive' ||
        req.user!.role === 'portfolio-manager' ||
        (req.user!.role === 'pm' && project.pm === req.user!.id) ||
        req.user!.role === 'global_admin' ||
        req.user!.role === 'constellation_admin';

      if (!canViewProject) {
        return res.status(403).json({ message: "You can only export projects you manage" });
      }

      const { startDate, endDate, style, includeProjectPlan, projectPlanFilter, useBrandedSlides, templateSlots } = req.body;
      // templateSlots: per-slot opt-in from the dialog { title?: boolean, section?: boolean, closing?: boolean }
      // Fallback to legacy useBrandedSlides boolean for backward compatibility
      const resolvedSlots = templateSlots ?? (useBrandedSlides === false ? { title: false, section: false, closing: false } : { title: true, section: true, closing: true });
      const reportStyle = ["executive_brief", "detailed_update", "client_facing"].includes(style) ? style : "client_facing";

      const effectiveStartDate = startDate || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
      const effectiveEndDate = endDate || new Date().toISOString().split('T')[0];

      const tenantId = req.user!.tenantId || (project as any).tenantId;
      const [milestones, raiddEntries, allocations, tenant, timeEntries, expenseData, epics, pptxDeliverables] = await Promise.all([
        storage.getProjectMilestones(req.params.id),
        storage.getRaiddEntries(req.params.id, {}),
        storage.getProjectAllocations(req.params.id),
        tenantId ? storage.getTenant(tenantId) : Promise.resolve(null),
        storage.getTimeEntries({ projectId: req.params.id, startDate: effectiveStartDate, endDate: effectiveEndDate }),
        storage.getExpenses({ projectId: req.params.id, startDate: effectiveStartDate, endDate: effectiveEndDate }),
        storage.getProjectEpics(req.params.id),
        storage.getProjectDeliverables(req.params.id),
      ]);
      const epicIds = epics.map(e => e.id);
      const stagesMap = epicIds.length > 0 ? await storage.getProjectStagesByEpicIds(epicIds) : new Map();
      const allStages: Array<any> = [];
      for (const epic of epics) {
        const stages = stagesMap.get(epic.id) || [];
        for (const stage of stages) {
          allStages.push({ ...stage, epicId: epic.id });
        }
      }

      const pmUser = project.pm ? await storage.getUser(project.pm) : null;
      const branding = (tenant as any)?.branding || {};
      const primaryColor = branding.primaryColor || '#810FFB';
      const secondaryColor = branding.secondaryColor || '#E60CB3';

      const now = new Date();
      const reportDate = now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

      const totalHours = timeEntries.reduce((sum, te) => sum + Number(te.hours || 0), 0);
      const totalBillableHours = timeEntries.filter(te => te.billable).reduce((sum, te) => sum + Number(te.hours || 0), 0);
      const totalExpenses = expenseData.reduce((sum, e) => sum + Number(e.amount || 0), 0);

      const teamMembers = new Map<string, { name: string; hours: number; activities: string[] }>();
      const userNameCache = new Map<string, string>();
      for (const te of timeEntries) {
        const key = te.personId;
        if (!userNameCache.has(key)) {
          const personName = (te as any).person?.name || (te as any).personName;
          if (personName) {
            userNameCache.set(key, personName);
          } else {
            try {
              const personUser = await storage.getUser(key);
              userNameCache.set(key, personUser?.name || "Unknown");
            } catch {
              userNameCache.set(key, "Unknown");
            }
          }
        }
        const existing = teamMembers.get(key) || { name: userNameCache.get(key) || "Unknown", hours: 0, activities: [] };
        existing.hours += Number(te.hours || 0);
        if (te.description && !existing.activities.includes(te.description)) {
          existing.activities.push(te.description);
        }
        teamMembers.set(key, existing);
      }

      const teamSummary = Array.from(teamMembers.values())
        .sort((a, b) => b.hours - a.hours)
        .map(m => `- ${m.name}: ${m.hours.toFixed(1)} hours — ${m.activities.slice(0, 5).join("; ") || "No descriptions logged"}`)
        .join("\n");

      const expenseSummary = expenseData.length > 0
        ? expenseData.map(e => `- ${e.category}: $${Number(e.amount).toFixed(2)}${e.description ? ` (${e.description})` : ""}`).join("\n")
        : "No expenses recorded in this period.";

      const completedMilestones = milestones.filter((m: any) => m.status === 'completed');
      const inProgressMilestones = milestones.filter((m: any) => m.status === 'in-progress');
      const notStarted = milestones.filter((m: any) => m.status === 'not-started');

      const activeMilestones = milestones
        .filter(m => m.status !== "completed")
        .map(m => `- ${m.name} (${m.status})`)
        .join("\n") || "No active milestones.";

      const completedMilestonesSummary = completedMilestones
        .map(m => `- ${m.name} (completed)`)
        .join("\n") || "None completed in this period.";

      const activeTeamCount = allocations.filter((a: any) => a.status === "open" || a.status === "in_progress").length;
      const completedAllocationsCount = allocations.filter((a: any) => a.status === "completed").length;

      // Build project plan context for AI — categorize epics/stages by timing relative to report period
      const stageDateMap = new Map<string, { startDate: string; endDate: string; assignees: string[] }>();
      for (const alloc of allocations) {
        const sid = (alloc as any).projectStageId;
        if (!sid || !(alloc as any).plannedStartDate) continue;
        const aStart = (alloc as any).plannedStartDate;
        const aEnd = (alloc as any).plannedEndDate || aStart;
        const existing = stageDateMap.get(sid);
        const assigneeName = (alloc as any).userName || (alloc as any).user?.name || '';
        if (!existing) {
          stageDateMap.set(sid, { startDate: aStart, endDate: aEnd, assignees: assigneeName ? [assigneeName] : [] });
        } else {
          if (aStart < existing.startDate) existing.startDate = aStart;
          if (aEnd > existing.endDate) existing.endDate = aEnd;
          if (assigneeName && !existing.assignees.includes(assigneeName)) existing.assignees.push(assigneeName);
        }
      }

      const epicStageMap = new Map<string, { epicName: string; epicOrder: number; stages: Array<{ name: string; order: number; startDate: string; endDate: string; assignees: string[] }> }>();
      for (const epic of epics) {
        epicStageMap.set(epic.id, { epicName: epic.name, epicOrder: epic.order, stages: [] });
      }
      for (const stage of allStages) {
        const epicEntry = epicStageMap.get(stage.epicId);
        if (epicEntry) {
          const dates = stageDateMap.get(stage.id);
          epicEntry.stages.push({
            name: stage.name,
            order: stage.order,
            startDate: dates?.startDate || '',
            endDate: dates?.endDate || '',
            assignees: dates?.assignees || [],
          });
        }
      }
      epicStageMap.forEach(e => e.stages.sort((a, b) => a.order - b.order));

      const periodStart = effectiveStartDate;
      const periodEnd = effectiveEndDate;
      const priorActivities: string[] = [];
      const currentActivities: string[] = [];
      const upcomingActivities: string[] = [];

      for (const alloc of allocations) {
        const taskDesc = (alloc as any).taskDescription || (alloc as any).activity?.name || '';
        const epicName = (alloc as any).epic?.name || '';
        const stageName = (alloc as any).stage?.name || '';
        const personName = (alloc as any).person?.name || (alloc as any).resourceName || '';
        const roleName = (alloc as any).role?.name || '';
        const allocStatus = (alloc as any).status || 'open';
        const allocStart = (alloc as any).plannedStartDate || '';
        const allocEnd = (alloc as any).plannedEndDate || allocStart;
        const completedDate = (alloc as any).completedDate || '';

        if (!taskDesc && !epicName) continue;

        const taskLabel = taskDesc || `${epicName}${stageName ? ' > ' + stageName : ''}`;
        const who = personName ? ` (${personName}${roleName ? ', ' + roleName : ''})` : (roleName ? ` (${roleName})` : '');
        const dateInfo = allocStart ? ` [${allocStart} to ${allocEnd}]` : '';
        const context = epicName && taskDesc ? ` — ${epicName}${stageName ? ' > ' + stageName : ''}` : '';
        const label = `${taskLabel}${who}${context}${dateInfo}`;

        if (allocStatus === 'completed' || (completedDate && completedDate <= periodEnd)) {
          priorActivities.push(label);
        } else if (allocStatus === 'in_progress' || (allocStart && allocStart <= periodEnd && allocEnd >= periodStart)) {
          currentActivities.push(label);
        } else if (allocStart && allocStart > periodEnd) {
          upcomingActivities.push(label);
        } else if (allocStart && allocEnd < periodStart) {
          priorActivities.push(label);
        }
      }

      const sortedEpics = Array.from(epicStageMap.values()).sort((a, b) => a.epicOrder - b.epicOrder);

      const projectPlanSummary = epics.length > 0
        ? sortedEpics.map(e => {
            const stageList = e.stages.map(s => {
              const dateRange = s.startDate ? ` [${s.startDate} to ${s.endDate}]` : ' [no dates]';
              const team = s.assignees.length > 0 ? ` — ${s.assignees.join(', ')}` : '';
              return `    - ${s.name}${dateRange}${team}`;
            }).join('\n');
            return `  ${e.epicName}:\n${stageList || '    (no stages)'}`;
          }).join('\n')
        : 'No project plan defined.';

      const openStatuses = ["open", "in_progress"];
      const raiddByType = {
        risks: raiddEntries.filter(r => r.type === "risk"),
        issues: raiddEntries.filter(r => r.type === "issue"),
        decisions: raiddEntries.filter(r => r.type === "decision"),
        dependencies: raiddEntries.filter(r => r.type === "dependency"),
        actionItems: raiddEntries.filter(r => r.type === "action_item"),
      };

      const activeRisks = raiddByType.risks.filter(r => openStatuses.includes(r.status));
      const activeIssues = raiddByType.issues.filter(r => openStatuses.includes(r.status));
      const activeActionItems = raiddByType.actionItems.filter(r => openStatuses.includes(r.status));
      const activeDependencies = raiddByType.dependencies.filter(r => openStatuses.includes(r.status));
      const recentDecisions = raiddByType.decisions
        .filter(d => {
          const updatedAt = new Date(d.updatedAt);
          return updatedAt >= new Date(effectiveStartDate) && updatedAt <= new Date(effectiveEndDate + "T23:59:59");
        });

      const formatPriority = (p: string | null) => p ? ` [${p.toUpperCase()}]` : "";
      const formatOwner = (name?: string) => name ? ` — Owner: ${name}` : "";
      const formatDue = (d: string | null) => d ? ` — Due: ${d}` : "";

      const riskSummary = activeRisks.length > 0
        ? activeRisks.map(r => `- ${r.refNumber || ""} ${r.title}${formatPriority(r.priority)} (${r.status})${r.impact ? ` | Impact: ${r.impact}` : ""}${r.likelihood ? ` | Likelihood: ${r.likelihood}` : ""}${formatOwner(r.ownerName)}${r.mitigationPlan ? `\n  Mitigation: ${r.mitigationPlan}` : ""}`).join("\n")
        : "No active risks.";

      const issueSummary = activeIssues.length > 0
        ? activeIssues.map(r => `- ${r.refNumber || ""} ${r.title}${formatPriority(r.priority)} (${r.status})${formatOwner(r.ownerName)}${r.resolutionNotes ? `\n  Resolution notes: ${r.resolutionNotes}` : ""}`).join("\n")
        : "No active issues.";

      const actionItemSummary = activeActionItems.length > 0
        ? activeActionItems.map(r => `- ${r.refNumber || ""} ${r.title}${formatPriority(r.priority)} (${r.status})${formatOwner(r.assigneeName || r.ownerName)}${formatDue(r.dueDate)}`).join("\n")
        : "No open action items.";

      const dependencySummary = activeDependencies.length > 0
        ? activeDependencies.map(r => `- ${r.refNumber || ""} ${r.title}${formatPriority(r.priority)} (${r.status})${formatOwner(r.ownerName)}`).join("\n")
        : "No active dependencies.";

      const decisionSummary = recentDecisions.length > 0
        ? recentDecisions.map(r => `- ${r.refNumber || ""} ${r.title} (${r.status})${r.resolutionNotes ? ` — ${r.resolutionNotes}` : ""}`).join("\n")
        : "No decisions recorded in this period.";

      const raiddCounts = {
        overdueActionItems: activeActionItems.filter(r => r.dueDate && new Date(r.dueDate) < new Date()).length,
        criticalItems: raiddEntries.filter(r => r.priority === "critical" && openStatuses.includes(r.status)).length,
      };

      const pptxStyleInstructions: Record<string, string> = {
        executive_brief: `Write a concise executive status report for a branded PowerPoint presentation. Structure your response with these exact markdown headers:
## Progress Summary
(2-3 paragraphs summarizing the period's work, momentum, and overall status)

## Key Accomplishments
(3-6 bullet points with **bold titles** and 1-2 sentence descriptions explaining each accomplishment's value and impact)

## Risks, Issues & Key Decisions (RAIDD)
(Organized into subsections for Risks, Issues, Decisions, Action Items, and Dependencies. Include every RAIDD entry with reference numbers, priorities, statuses, owners, and mitigation plans.)

## Upcoming Activities
(4-8 bullet points with **bold titles** and 1-2 sentence descriptions of next steps, linking to action items and milestones)

Keep the tone executive-level, confident, and value-focused. Target 500-800 words.`,

        detailed_update: `Write a comprehensive project status report for a branded PowerPoint presentation. Structure your response with these exact markdown headers:
## Progress Summary
(2-4 paragraphs with detailed narrative on work completed, key themes, and project trajectory)

## Key Accomplishments
(4-8 bullet points with **bold titles** followed by detailed descriptions explaining what was done, why it matters, and its impact on the engagement)

## Risks, Issues & Key Decisions (RAIDD)
(Full detail with subsections for each RAIDD category. Include every entry with reference numbers, priorities, statuses, owners, mitigation plans, impact assessments, and due dates.)

## Upcoming Activities
(5-10 bullet points with **bold titles** and detailed descriptions linking to action items, dependencies, and milestones. Include specific next steps and expected outcomes.)

Be thorough and detailed. Target 800-1200 words.`,

        client_facing: `Write a professional client-facing status report for a branded PowerPoint presentation. Structure your response with these exact markdown headers:
## Progress Summary
(2-3 paragraphs summarizing the engagement progress, momentum, and key themes. Use confident, professional tone suitable for client stakeholders.)

## Key Accomplishments
(4-6 bullet points with **bold titles** and 1-2 sentence descriptions focusing on deliverables, value delivered, and business impact. Avoid internal metrics.)

## Risks, Issues & Key Decisions (RAIDD)
(Client-appropriate detail with subsections. Include active Risks with mitigation plans, Issues with resolution status, Decisions made, open Action Items with owners and due dates, and Dependencies.)

## Upcoming Activities
(4-8 bullet points with **bold titles** and descriptions of next steps. Link to action items and milestones. Focus on what the client can expect and what requires their input.)

Keep the tone positive, professional, and value-focused. Target 600-900 words.`,
      };

      const systemPrompt = `You are a professional consulting project manager writing a status report that will be exported as a branded PowerPoint presentation. ${pptxStyleInstructions[reportStyle]}

Format the output as clean markdown with headers (##), bullet points (- ), and **bold text** for emphasis. Each bullet point under Key Accomplishments and Upcoming Activities MUST have a **bold title** followed by a description.

CRITICAL: The RAIDD section is mandatory. Always include every RAIDD entry provided in the data. Never skip, consolidate, or omit individual RAIDD items. Use subsections (- Risks, - Issues, - Decisions, - Action Items, - Dependencies) within the RAIDD section.

CRITICAL: Use the COMPLETED TASKS, IN-PROGRESS TASKS, and UPCOMING TASKS data to populate Key Accomplishments and Upcoming Activities. Each task listed is an individual assignment with a description, person, role, epic/stage context, and dates. For Key Accomplishments, describe what was COMPLETED and what is currently IN PROGRESS — group related tasks into coherent narrative bullets with bold titles explaining the business value and work done. For Upcoming Activities, describe the UPCOMING TASKS that are scheduled after this period. NEVER say "no accomplishments" or "no upcoming activities" when task data is available. Transform raw task names into professional, client-appropriate descriptions.`;

      const buildCompactTaskList = (allocs: any[], statusFilter: (a: any) => boolean) => {
        const grouped = new Map<string, string[]>();
        for (const alloc of allocs) {
          const taskDesc = (alloc as any).taskDescription || (alloc as any).activity?.name || '';
          const epicName = (alloc as any).epic?.name || '';
          const stageName = (alloc as any).stage?.name || '';
          const personName = (alloc as any).person?.name || (alloc as any).resourceName || '';
          const allocStatus = (alloc as any).status || 'open';
          const allocStart = (alloc as any).plannedStartDate || '';
          const allocEnd = (alloc as any).plannedEndDate || allocStart;
          const completedDate = (alloc as any).completedDate || '';

          if (!taskDesc && !epicName) continue;
          if (!statusFilter({ allocStatus, allocStart, allocEnd, completedDate, periodStart, periodEnd: effectiveEndDate })) continue;

          const key = epicName || 'General';
          const task = taskDesc || stageName || 'Task';
          const person = personName ? ` (${personName.split(' ')[0]})` : '';
          if (!grouped.has(key)) grouped.set(key, []);
          grouped.get(key)!.push(`${task}${person}`);
        }
        if (grouped.size === 0) return 'None.';
        return Array.from(grouped.entries()).map(([epic, tasks]) =>
          `  ${epic}: ${tasks.join('; ')}`
        ).join('\n');
      };

      const compactCompleted = buildCompactTaskList(allocations, (a) =>
        a.allocStatus === 'completed' || (a.completedDate && a.completedDate <= a.periodEnd) || (a.allocStart && a.allocEnd < a.periodStart)
      );
      const compactInProgress = buildCompactTaskList(allocations, (a) =>
        a.allocStatus !== 'completed' && !(a.completedDate && a.completedDate <= a.periodEnd) &&
        (a.allocStatus === 'in_progress' || (a.allocStart && a.allocStart <= a.periodEnd && a.allocEnd >= a.periodStart))
      );
      const compactUpcoming = buildCompactTaskList(allocations, (a) =>
        a.allocStatus !== 'completed' && !(a.completedDate && a.completedDate <= a.periodEnd) &&
        a.allocStatus !== 'in_progress' && a.allocStart && a.allocStart > a.periodEnd
      );

      const userMessage = `Generate a status report for the following project activity:

PROJECT: ${project.name}
CLIENT: ${project.client?.name || "Unknown"}
PERIOD: ${effectiveStartDate} to ${effectiveEndDate}
STATUS: ${project.status}
${project.description ? `DESCRIPTION: ${project.description}` : ""}

SUMMARY METRICS:
- Total Hours Logged: ${totalHours.toFixed(1)} (${totalBillableHours.toFixed(1)} billable)
- Total Expenses: $${totalExpenses.toFixed(2)}
- Active Assignments: ${activeTeamCount}
- Completed Assignments: ${completedAllocationsCount}

TEAM ACTIVITY:
${teamSummary || "No time entries recorded in this period."}

MILESTONES — Active:
${activeMilestones}

MILESTONES — Completed:
${completedMilestonesSummary}

COMPLETED TASKS (${priorActivities.length} total, grouped by epic):
${compactCompleted}

IN-PROGRESS TASKS (${currentActivities.length} total, grouped by epic):
${compactInProgress}

UPCOMING TASKS (${upcomingActivities.length} total, grouped by epic):
${compactUpcoming}

DELIVERABLES (${pptxDeliverables.length} total):
${pptxDeliverables.length > 0 ? pptxDeliverables.map((d: any) => `- ${d.name} [${d.status}]${d.ownerName ? ` — ${d.ownerName}` : ''}`).join('\n') : 'No deliverables tracked.'}

RAIDD LOG — Active Risks (${activeRisks.length}):
${riskSummary}

RAIDD LOG — Active Issues (${activeIssues.length}):
${issueSummary}

RAIDD LOG — Open Action Items (${activeActionItems.length}):
${actionItemSummary}

RAIDD LOG — Active Dependencies (${activeDependencies.length}):
${dependencySummary}

RAIDD LOG — Decisions This Period (${recentDecisions.length}):
${decisionSummary}${raiddCounts.overdueActionItems > 0 ? `\n\n⚠️ OVERDUE ACTION ITEMS: ${raiddCounts.overdueActionItems} action item(s) are past their due date.` : ""}${raiddCounts.criticalItems > 0 ? `\n⚠️ CRITICAL ITEMS: ${raiddCounts.criticalItems} item(s) are flagged as critical priority.` : ""}`;

      let aiReport = "";
      try {
        const { aiService, buildGroundingContext } = await import("./services/ai-service.js");
        const pptxTenantId = (req.user as any)?.tenantId;
        const groundingDocs = pptxTenantId
          ? await storage.getActiveGroundingDocumentsForTenant(pptxTenantId)
          : await storage.getActiveGroundingDocuments();
        const groundingCtx = buildGroundingContext(groundingDocs, 'status_report');

        const maxTokensByStyle: Record<string, number> = {
          executive_brief: 8192,
          detailed_update: 16384,
          client_facing: 8192,
        };
        const result = await aiService.customPrompt(systemPrompt, userMessage, {
          temperature: 0.6,
          maxTokens: maxTokensByStyle[reportStyle] || 8192,
          groundingContext: groundingCtx,
          usageCtx: { tenantId: pptxTenantId, userId: (req.user as any)?.id, feature: 'pptx_report' as any },
        });
        aiReport = result.content;
        console.log(`[PPTX] AI report generated: ${aiReport.length} chars, first 200: ${aiReport.substring(0, 200)}`);
      } catch (aiError: any) {
        console.error("[PPTX] AI generation failed, using fallback:", aiError.message);
        console.error("[PPTX] AI error stack:", aiError.stack?.substring(0, 500));
      }

      if (!aiReport) {
        console.warn("[PPTX] aiReport is empty — PPTX will use task fallback rendering");
      } else {
        console.log(`[PPTX] aiReport ready for Python: ${aiReport.length} chars`);
      }

      const milestonePosture: Record<string, string[]> = {
        'Completed': completedMilestones.map((m: any) => m.name),
        'In Progress': inProgressMilestones.map((m: any) => m.name),
        'Not Yet Started': notStarted.map((m: any) => m.name),
      };

      const raiddData = {
        risks: raiddEntries.filter((r: any) => r.type === 'risk').map((r: any) => ({
          refNumber: r.refNumber || '', title: r.title, priority: r.priority,
          status: r.status, ownerName: r.ownerName || '', mitigationPlan: r.mitigationPlan || '',
          dueDate: r.dueDate || '', impact: r.impact || '', likelihood: r.likelihood || '',
        })),
        issues: raiddEntries.filter((r: any) => r.type === 'issue').map((r: any) => ({
          refNumber: r.refNumber || '', title: r.title, priority: r.priority,
          status: r.status, ownerName: r.ownerName || '', mitigationPlan: r.mitigationPlan || '',
          dueDate: r.dueDate || '',
        })),
        actionItems: raiddEntries.filter((r: any) => r.type === 'action_item').map((r: any) => ({
          refNumber: r.refNumber || '', title: r.title, priority: r.priority,
          status: r.status, ownerName: r.ownerName || r.assigneeName || '',
          mitigationPlan: r.description || '', dueDate: r.dueDate || '',
        })),
        decisions: raiddEntries.filter((r: any) => r.type === 'decision').map((r: any) => ({
          refNumber: r.refNumber || '', title: r.title, priority: r.priority,
          status: r.status, ownerName: r.ownerName || '', mitigationPlan: r.description || '',
          dueDate: r.dueDate || '',
        })),
        dependencies: raiddEntries.filter((r: any) => r.type === 'dependency').map((r: any) => ({
          refNumber: r.refNumber || '', title: r.title, priority: r.priority,
          status: r.status, ownerName: r.ownerName || '', mitigationPlan: r.mitigationPlan || '',
          dueDate: r.dueDate || '',
        })),
      };

      const projectActivities = {
        prior: priorActivities,
        current: currentActivities,
        upcoming: upcomingActivities,
      };

      let logoPath: string | null = null;
      const logoUrl = (tenant as any)?.logoUrl;
      if (logoUrl) {
        const possiblePaths = [
          pathNode.join(process.cwd(), 'client', 'public', logoUrl.replace(/^\//, '')),
          pathNode.join(process.cwd(), logoUrl.replace(/^\//, '')),
          pathNode.join(process.cwd(), 'client', 'src', 'assets', logoUrl.replace(/^.*\/assets\//, '')),
        ];
        for (const p of possiblePaths) {
          if (fsNode.existsSync(p)) {
            logoPath = p;
            break;
          }
        }
      }

      const pptxData = {
        projectName: project.name,
        clientName: (project as any).client?.name || '',
        reportDate,
        periodStart: effectiveStartDate,
        periodEnd: effectiveEndDate,
        pmName: pmUser?.name || '',
        projectStatus: project.status || 'active',
        projectDescription: project.description || '',
        primaryColor,
        secondaryColor,
        logoPath,
        aiReport,
        projectActivities,
        milestonePosture,
        milestones: milestones.map((m: any) => ({
          name: m.name,
          targetDate: m.targetDate || '',
          status: m.status || '',
          startDate: m.startDate || '',
          endDate: m.endDate || '',
        })),
        raidd: raiddData,
        deliverables: pptxDeliverables.map((d: any) => ({
          name: d.name,
          status: d.status || 'not-started',
          ownerName: d.ownerName || '',
          targetDate: d.targetDate || '',
          deliveredDate: d.deliveredDate || '',
          description: d.description || '',
        })),
        metrics: {
          totalHours: totalHours.toFixed(1),
          billableHours: totalBillableHours.toFixed(1),
          totalExpenses: totalExpenses.toFixed(2),
          teamMembers: teamMembers.size,
        },
        timeline: (() => {
          const stageDateMap = new Map<string, { startDate: string; endDate: string }>();
          for (const alloc of allocations) {
            const sid = (alloc as any).projectStageId;
            if (!sid || !(alloc as any).plannedStartDate) continue;
            const existing = stageDateMap.get(sid);
            const aStart = (alloc as any).plannedStartDate;
            const aEnd = (alloc as any).plannedEndDate || aStart;
            if (!existing) {
              stageDateMap.set(sid, { startDate: aStart, endDate: aEnd });
            } else {
              if (aStart < existing.startDate) existing.startDate = aStart;
              if (aEnd > existing.endDate) existing.endDate = aEnd;
            }
          }

          const epicMap = new Map<string, { name: string; order: number; stages: any[]; milestones: any[] }>();
          for (const epic of epics) {
            epicMap.set(epic.id, { name: epic.name, order: epic.order, stages: [], milestones: [] });
          }

          for (const stage of allStages) {
            const epicEntry = epicMap.get(stage.epicId);
            if (epicEntry) {
              const dates = stageDateMap.get(stage.id);
              epicEntry.stages.push({
                name: stage.name,
                order: stage.order,
                startDate: dates?.startDate || '',
                endDate: dates?.endDate || '',
              });
            }
          }

          const paymentMilestones: any[] = [];
          const unlinkedMilestones: any[] = [];
          for (const m of milestones) {
            const ms = {
              name: (m as any).name,
              targetDate: (m as any).targetDate || '',
              startDate: (m as any).startDate || '',
              endDate: (m as any).endDate || '',
              status: (m as any).status || '',
              isPayment: (m as any).isPaymentMilestone || false,
            };
            if (ms.isPayment) {
              paymentMilestones.push(ms);
              continue;
            }
            if (!ms.targetDate) continue;
            const epicEntry = (m as any).projectEpicId ? epicMap.get((m as any).projectEpicId) : null;
            if (epicEntry) {
              epicEntry.milestones.push(ms);
            } else {
              unlinkedMilestones.push(ms);
            }
          }

          const epicGroups = Array.from(epicMap.values())
            .filter(e => e.stages.length > 0 || e.milestones.length > 0)
            .sort((a, b) => a.order - b.order)
            .map(e => ({
              epicName: e.name,
              stages: e.stages.sort((a: any, b: any) => {
                if (a.startDate && b.startDate && a.startDate !== b.startDate) return a.startDate < b.startDate ? -1 : 1;
                return a.order - b.order;
              }),
              milestones: e.milestones,
            }));

          return { epicGroups, unlinkedMilestones, paymentMilestones };
        })(),
      };

      if (includeProjectPlan) {
        const planFilter = projectPlanFilter === 'all' ? 'all' : 'open';
        const filteredAllocations = planFilter === 'all'
          ? allocations
          : allocations.filter((a: any) => a.status === 'open' || a.status === 'in_progress');

        const userCache = new Map<string, string>();
        const roleCache = new Map<string, string>();
        for (const alloc of filteredAllocations) {
          const personId = (alloc as any).personId;
          const roleId = (alloc as any).roleId;
          if (personId && !userCache.has(personId)) {
            try {
              const u = await storage.getUser(personId);
              userCache.set(personId, u?.name || 'Unassigned');
            } catch { userCache.set(personId, 'Unassigned'); }
          }
          if (roleId && !roleCache.has(roleId)) {
            try {
              const r = await storage.getRole(roleId);
              roleCache.set(roleId, r?.name || 'Unknown Role');
            } catch { roleCache.set(roleId, 'Unknown Role'); }
          }
        }

        const epicStageMap = new Map<string, Map<string, any[]>>();
        const epicNameMap = new Map<string, { name: string; order: number }>();
        const stageNameMap = new Map<string, { name: string; order: number }>();

        for (const epic of epics) {
          epicNameMap.set(epic.id, { name: epic.name, order: epic.order });
        }
        for (const stage of allStages) {
          stageNameMap.set(stage.id, { name: stage.name, order: stage.order });
        }

        for (const alloc of filteredAllocations) {
          const epicId = (alloc as any).projectEpicId || '__none__';
          const stageId = (alloc as any).projectStageId || '__none__';

          if (!epicStageMap.has(epicId)) {
            epicStageMap.set(epicId, new Map());
          }
          const stageMap = epicStageMap.get(epicId)!;
          if (!stageMap.has(stageId)) {
            stageMap.set(stageId, []);
          }

          const personId = (alloc as any).personId;
          const roleId = (alloc as any).roleId;
          const assigneeName = personId ? userCache.get(personId) || 'Unassigned'
            : (alloc as any).resourceName || (roleId ? roleCache.get(roleId) || 'Unknown Role' : 'Unassigned');

          stageMap.get(stageId)!.push({
            assignee: assigneeName,
            task: (alloc as any).taskDescription || '',
            hours: Number((alloc as any).hours || 0),
            startDate: (alloc as any).plannedStartDate || '',
            endDate: (alloc as any).plannedEndDate || '',
            status: (alloc as any).status || 'open',
          });
        }

        const projectPlanGroups: any[] = [];
        const sortedEpicIds = Array.from(epicStageMap.keys()).sort((a, b) => {
          const orderA = epicNameMap.get(a)?.order ?? 999;
          const orderB = epicNameMap.get(b)?.order ?? 999;
          return orderA - orderB;
        });

        for (const epicId of sortedEpicIds) {
          const epicName = epicNameMap.get(epicId)?.name || 'Unlinked';
          const stageMap = epicStageMap.get(epicId)!;

          const sortedStageIds = Array.from(stageMap.keys()).sort((a, b) => {
            const orderA = stageNameMap.get(a)?.order ?? 999;
            const orderB = stageNameMap.get(b)?.order ?? 999;
            return orderA - orderB;
          });

          const stages: any[] = [];
          for (const stageId of sortedStageIds) {
            const stageName = stageNameMap.get(stageId)?.name || 'Unlinked';
            const assignments = stageMap.get(stageId)!.sort((a: any, b: any) => {
              if (a.startDate && b.startDate) return a.startDate < b.startDate ? -1 : 1;
              if (a.startDate) return -1;
              if (b.startDate) return 1;
              return 0;
            });
            stages.push({ stageName, assignments });
          }

          projectPlanGroups.push({ epicName, stages });
        }

        (pptxData as any).projectPlan = {
          filter: planFilter,
          groups: projectPlanGroups,
        };
      }

      // Download PPTX template files based on per-slot preferences from the dialog
      const templateTempFiles: string[] = [];
      if (tenant) {
        const t = tenant as any;
        const templateSlotDefs: Array<{ fileId: string | null; key: string; slotName: keyof typeof resolvedSlots }> = [
          { fileId: t.pptxTitleTemplateFileId, key: 'titleTemplatePath', slotName: 'title' },
          { fileId: t.pptxSectionTemplateFileId, key: 'sectionTemplatePath', slotName: 'section' },
          { fileId: t.pptxClosingTemplateFileId, key: 'closingTemplatePath', slotName: 'closing' },
        ];
        for (const slot of templateSlotDefs) {
          if (slot.fileId && resolvedSlots[slot.slotName] !== false) {
            try {
              const fileContent = await sharePointFileStorage.getFileContent(slot.fileId, tenantId);
              if (fileContent?.buffer) {
                const tmpTemplatePath = pathNode.join(osNode.tmpdir(), `pptx-template-${slot.key}-${Date.now()}.pptx`);
                fsNode.writeFileSync(tmpTemplatePath, fileContent.buffer);
                (pptxData as any)[slot.key] = tmpTemplatePath;
                templateTempFiles.push(tmpTemplatePath);
              }
            } catch (tmplErr: any) {
              console.warn(`[PPTX_TEMPLATE] Could not download template for ${slot.key}:`, tmplErr.message);
            }
          }
        }
      }

      const tmpFile = pathNode.join(osNode.tmpdir(), `status-report-${Date.now()}.pptx`);
      const scriptPath = pathNode.join(process.cwd(), 'server', 'scripts', 'generate_status_report_pptx.py');

      const cleanupTemplateFiles = () => {
        for (const f of templateTempFiles) {
          try { fsNode.unlinkSync(f); } catch {}
        }
      };

      try {
        const { spawnSync } = await import('child_process');
        const pyResult = spawnSync('python3', [scriptPath, tmpFile], {
          input: JSON.stringify(pptxData),
          timeout: 30000,
          maxBuffer: 10 * 1024 * 1024,
        });
        if (pyResult.stderr && pyResult.stderr.length > 0) {
          console.log(`[PPTX] Python stderr:\n${pyResult.stderr.toString().substring(0, 2000)}`);
        }
        if (pyResult.status !== 0) {
          throw new Error(`Python script exited with code ${pyResult.status}: ${pyResult.stderr?.toString().substring(0, 500)}`);
        }

        if (!fsNode.existsSync(tmpFile)) {
          throw new Error('PPTX file was not generated');
        }

        const filename = `${project.name.replace(/[^a-z0-9]/gi, '_')}-Status_Report-${now.toISOString().split('T')[0]}.pptx`;
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.presentationml.presentation");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

        // Fire-and-forget: log status report to HubSpot deal and company
        (async () => {
          try {
            const tenantId = (req as any).user?.tenantId;
            if (!tenantId) return;
            const connected = await isHubSpotConnected(tenantId);
            if (!connected) return;

            const noteBody = `<strong>Status Report Generated</strong><br/>` +
              `Project: ${project.name}<br/>` +
              `Period: ${effectiveStartDate} to ${effectiveEndDate}<br/>` +
              `Style: ${reportStyle}<br/>` +
              `Report exported as PowerPoint on ${new Date().toLocaleDateString()}`;

            const projectEstimates = await storage.getEstimatesByProject(project.id);
            for (const est of projectEstimates) {
              const mapping = await storage.getCrmObjectMappingByLocal(tenantId, "hubspot", "estimate", est.id);
              if (mapping) {
                await createHubSpotDealNote(tenantId, mapping.crmObjectId, noteBody);

                await storage.createCrmSyncLog({
                  tenantId,
                  crmProvider: "hubspot",
                  action: "status_report_logged",
                  status: "success",
                  localObjectType: "project",
                  localObjectId: project.id,
                  crmObjectType: "deal",
                  crmObjectId: mapping.crmObjectId,
                  requestPayload: {
                    projectName: project.name,
                    startDate: effectiveStartDate,
                    endDate: effectiveEndDate,
                    style: reportStyle,
                  } as any,
                });
                break;
              }
            }

            if (project.clientId) {
              const hubSpotCompanyId = await getLinkedHubSpotCompanyId(tenantId, project.clientId);
              if (hubSpotCompanyId) {
                await createHubSpotCompanyNote(tenantId, hubSpotCompanyId, noteBody);
                console.log(`[CRM-SYNC] Status report company note for company ${hubSpotCompanyId}`);
              }
            }
          } catch (e: any) {
            console.error('[CRM] Status report sync failed:', e.message);
          }
        })();

        try {
          await storage.createStatusReport({
            projectId: req.params.id,
            tenantId: tenantId || null,
            title: `${project.name} PPTX Report — ${effectiveStartDate} to ${effectiveEndDate}`,
            reportType: "pptx",
            reportStyle,
            periodStart: effectiveStartDate,
            periodEnd: effectiveEndDate,
            reportContent: aiReport || null,
            status: "final",
            metadata: {
              projectName: project.name,
              clientName: project.client?.name || "Unknown",
              startDate: effectiveStartDate,
              endDate: effectiveEndDate,
              style: reportStyle,
              generatedAt: new Date().toISOString(),
              generatedBy: req.user!.name || req.user!.email,
            },
            generatedBy: req.user!.id,
          });
        } catch (saveErr: any) {
          console.error("[PPTX] Failed to save report record to DB:", saveErr.message);
        }

        const fileStream = fsNode.createReadStream(tmpFile);
        fileStream.pipe(res);
        fileStream.on('end', () => {
          fsNode.unlink(tmpFile, () => {});
          cleanupTemplateFiles();
        });
        fileStream.on('error', () => {
          fsNode.unlink(tmpFile, () => {});
          cleanupTemplateFiles();
          if (!res.headersSent) {
            res.status(500).json({ message: "Failed to stream PPTX" });
          }
        });
      } catch (scriptError: any) {
        console.error("PPTX generation script error:", scriptError.message);
        if (fsNode.existsSync(tmpFile)) fsNode.unlinkSync(tmpFile);
        cleanupTemplateFiles();
        res.status(500).json({ message: "Failed to generate PowerPoint report" });
      }
    } catch (error) {
      console.error("PPTX export error:", error);
      res.status(500).json({ message: "Failed to export PowerPoint report" });
    }
  });

  app.delete("/api/projects/:id", requireAuth, async (req, res) => {
    try {
      // Get the project first to check permissions
      const project = await storage.getProject(req.params.id);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      // Check if user is admin or pm
      const user = req.user!;
      if (user.role !== "admin" && user.role !== "billing-admin" && user.role !== "pm") {
        return res.status(403).json({ message: "You don't have permission to delete this project" });
      }

      // Delete the project and all related data
      await storage.deleteProject(req.params.id);
      res.json({ message: "Project deleted successfully" });
    } catch (error) {
      console.error("Error deleting project:", error);
      const errorMessage = error instanceof Error ? error.message : "Failed to delete project";
      res.status(500).json({ 
        message: errorMessage,
        details: "Project may have related data that needs to be removed first"
      });
    }
  });

  // Get project progress (hours vs estimate)
  app.get("/api/projects/:id/progress", requireAuth, async (req, res) => {
    try {
      // Only PM, admin, billing-admin, and executive can see full project progress
      if (!["admin", "billing-admin", "pm", "executive"].includes(req.user!.role)) {
        return res.status(403).json({ message: "Insufficient permissions to view project progress" });
      }

      const projectId = req.params.id;

      // Get actual hours from time entries
      const timeEntries = await storage.getTimeEntries({ projectId });
      const actualHours = timeEntries.reduce((sum, entry) => sum + parseFloat(entry.hours), 0);

      // Get estimated hours from project estimates
      const projectEstimates = await storage.getEstimatesByProject(projectId);
      let estimatedHours = 0;

      if (projectEstimates.length > 0) {
        // Use the latest approved estimate, or the latest draft if no approved
        const approvedEstimate = projectEstimates.find(e => e.status === 'approved');
        const estimate = approvedEstimate || projectEstimates[0];

        if (estimate) {
          const lineItems = await storage.getEstimateLineItems(estimate.id);
          estimatedHours = lineItems.reduce((sum, item) => sum + parseFloat(item.adjustedHours), 0);
        }
      }

      // Get project budget info
      const project = await storage.getProject(projectId);

      res.json({
        actualHours,
        estimatedHours,
        percentComplete: estimatedHours > 0 ? Math.round((actualHours / estimatedHours) * 100) : 0,
        remainingHours: Math.max(0, estimatedHours - actualHours),
        budget: project?.baselineBudget,
        retainerBalance: project?.retainerBalance,
        retainerTotal: project?.retainerTotal
      });
    } catch (error) {
      console.error("Error getting project progress:", error);
      res.status(500).json({ message: "Failed to get project progress" });
    }
  });

  // Change Orders
  app.get("/api/projects/:id/change-orders", requireAuth, async (req, res) => {
    try {
      const changeOrders = await storage.getChangeOrders(req.params.id);
      res.json(changeOrders);
    } catch (error) {
      console.error("Error fetching change orders:", error);
      res.status(500).json({ message: "Failed to fetch change orders" });
    }
  });

  app.post("/api/projects/:id/change-orders", requireAuth, requireRole(["admin", "billing-admin", "pm", "portfolio-manager", "executive"]), async (req, res) => {
    try {
      const insertData = insertChangeOrderSchema.parse({
        ...req.body,
        projectId: req.params.id
      });
      const changeOrder = await storage.createChangeOrder(insertData);
      res.status(201).json(changeOrder);
    } catch (error: any) {
      console.error("Error creating change order:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid change order data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to create change order" });
    }
  });

  app.patch("/api/change-orders/:id", requireAuth, requireRole(["admin", "billing-admin", "pm", "portfolio-manager", "executive"]), async (req, res) => {
    try {
      const changeOrder = await storage.updateChangeOrder(req.params.id, req.body);
      res.json(changeOrder);
    } catch (error) {
      console.error("Error updating change order:", error);
      res.status(500).json({ message: "Failed to update change order" });
    }
  });

  app.delete("/api/change-orders/:id", requireAuth, requireRole(["admin", "billing-admin", "pm", "portfolio-manager", "executive"]), async (req, res) => {
    try {
      await storage.deleteChangeOrder(req.params.id);
      res.json({ message: "Change order deleted successfully" });
    } catch (error) {
      console.error("Error deleting change order:", error);
      res.status(500).json({ message: "Failed to delete change order" });
    }
  });

  // SOW/Change Order Document Upload
  app.post("/api/sows/:id/upload", requireAuth, requireRole(["admin", "billing-admin", "pm", "portfolio-manager", "executive"]), upload.single('file'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      const sow = await storage.getSow(req.params.id);
      if (!sow) {
        return res.status(404).json({ message: "SOW not found" });
      }

      // Get project for client info
      const project = await storage.getProject(sow.projectId);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      // Delete existing document if present
      const sowTenantId = (req as any).user?.primaryTenantId || (req as any).user?.tenantId;
      if (sow.documentUrl) {
        try {
          await sharePointFileStorage.deleteFile(sow.documentUrl, sowTenantId);
          console.log(`[SOW] Deleted previous document for SOW ${sow.id}`);
        } catch (error) {
          console.log(`[SOW] No previous document to delete`);
        }
      }

      // Save to SharePoint
      const savedFile = await sharePointFileStorage.storeFile(
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype,
        {
          documentType: sow.type === 'initial' ? 'statementOfWork' : 'changeOrder',
          clientId: project.clientId,
          clientName: project.client?.name,
          projectId: sow.projectId,
          projectCode: project.code,
          amount: parseFloat(sow.value),
          effectiveDate: sow.effectiveDate ? new Date(sow.effectiveDate) : undefined,
          createdByUserId: req.user!.id,
          metadataVersion: 1,
          tags: `${sow.type},sow,${project.code},${project.client?.name?.toLowerCase().replace(/\s+/g, '-')}`
        },
        req.user!.email,
        sow.id, // Use SOW ID as fileId for consistent lookup
        sowTenantId
      );

      // Update SOW with document info
      const updated = await storage.updateSow(sow.id, {
        documentUrl: savedFile.id, // Store SharePoint file ID
        documentName: req.file.originalname
      });

      res.json({
        message: "Document uploaded successfully",
        sow: updated,
        file: {
          id: savedFile.id,
          name: savedFile.fileName,
          size: savedFile.size
        }
      });
    } catch (error: any) {
      console.error("[SOW UPLOAD] Error:", error);
      res.status(500).json({ 
        message: error.message || "Failed to upload document" 
      });
    }
  });

  // Download SOW/Change Order Document
  app.get("/api/sows/:id/download", requireAuth, async (req, res) => {
    try {
      const sow = await storage.getSow(req.params.id);
      if (!sow) {
        return res.status(404).json({ message: "SOW not found" });
      }

      if (!sow.documentUrl) {
        return res.status(404).json({ message: "No document attached to this SOW" });
      }

      const dlTenantId = (req as any).user?.primaryTenantId || (req as any).user?.tenantId;
      const fileData = await sharePointFileStorage.getFileContent(sow.documentUrl, dlTenantId);
      if (!fileData) {
        return res.status(404).json({ message: "Document not found in storage" });
      }

      res.setHeader('Content-Type', fileData.metadata.contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${sow.documentName || 'document.pdf'}"`);
      res.send(fileData.buffer);
    } catch (error: any) {
      console.error("[SOW DOWNLOAD] Error:", error);
      res.status(500).json({ message: "Failed to download document" });
    }
  });

  // SOWs (Statements of Work)
  app.get("/api/projects/:id/sows", requireAuth, async (req, res) => {
    try {
      const sows = await storage.getSows(req.params.id);
      res.json(sows);
    } catch (error) {
      console.error("Error fetching SOWs:", error);
      res.status(500).json({ message: "Failed to fetch SOWs" });
    }
  });

  app.get("/api/sows/:id", requireAuth, async (req, res) => {
    try {
      const sow = await storage.getSow(req.params.id);
      if (!sow) {
        return res.status(404).json({ message: "SOW not found" });
      }
      res.json(sow);
    } catch (error) {
      console.error("Error fetching SOW:", error);
      res.status(500).json({ message: "Failed to fetch SOW" });
    }
  });

  app.post("/api/projects/:id/sows", requireAuth, requireRole(["admin", "billing-admin", "pm", "portfolio-manager", "executive"]), async (req, res) => {
    try {
      console.log("Creating SOW with data:", req.body);
      console.log("Project ID:", req.params.id);

      // Look up project to snapshot its currency at SOW creation time
      const project = await storage.getProject(req.params.id);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      const insertData = insertSowSchema.parse({
        ...req.body,
        projectId: req.params.id,
        // Currency snapshot from the project — not caller-supplied
        quoteCurrency: project.quoteCurrency ?? "USD",
        costCurrency: project.costCurrency ?? "USD",
        exchangeRate: project.exchangeRate ?? null,
      });

      // VALIDATION: Prevent multiple initial SOWs per project
      if (insertData.type === 'initial') {
        const existingSows = await storage.getSows(req.params.id);
        const hasInitialSow = existingSows.some(sow => 
          sow.type === 'initial' && 
          sow.status !== 'rejected' // Allow creating new initial SOW only if previous was rejected
        );
        
        if (hasInitialSow) {
          return res.status(400).json({ 
            message: "This project already has an initial SOW. Please create a change order instead." 
          });
        }
      }

      console.log("Parsed SOW data:", insertData);
      const sow = await storage.createSow(insertData);
      res.status(201).json(sow);
    } catch (error: any) {
      console.error("Error creating SOW - Full error:", error);
      console.error("Error stack:", error.stack);
      console.error("Request body:", req.body);

      if (error instanceof z.ZodError) {
        console.error("Zod validation errors:", error.errors);
        return res.status(400).json({ message: "Invalid SOW data", errors: error.errors });
      }

      res.status(500).json({ 
        message: "Failed to create SOW", 
        details: error.message || "Unknown error",
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  });

  app.patch("/api/sows/:id", requireAuth, requireRole(["admin", "billing-admin", "pm", "portfolio-manager", "executive"]), async (req, res) => {
    try {
      const currentSow = await storage.getSow(req.params.id);
      if (!currentSow) {
        return res.status(404).json({ message: "SOW not found" });
      }

      // VALIDATION: Prevent changing a SOW to initial type if project already has one
      if (req.body.type === 'initial' && currentSow.type !== 'initial') {
        const existingSows = await storage.getSows(currentSow.projectId);
        const hasInitialSow = existingSows.some(sow => 
          sow.type === 'initial' && 
          sow.status !== 'rejected' &&
          sow.id !== req.params.id
        );
        
        if (hasInitialSow) {
          return res.status(400).json({ 
            message: "This project already has an initial SOW. Cannot change this to an initial SOW." 
          });
        }
      }

      const sow = await storage.updateSow(req.params.id, req.body);
      res.json(sow);
    } catch (error: any) {
      console.error("Error updating SOW:", error);
      
      // Handle unique constraint violation from database
      if (error.code === '23505' && error.constraint === 'unique_initial_sow_per_project') {
        return res.status(400).json({ 
          message: "This project already has an approved or pending initial SOW." 
        });
      }
      
      res.status(500).json({ message: "Failed to update SOW" });
    }
  });

  app.delete("/api/sows/:id", requireAuth, requireRole(["admin", "billing-admin", "pm", "portfolio-manager", "executive"]), async (req, res) => {
    try {
      await storage.deleteSow(req.params.id);
      res.json({ message: "SOW deleted successfully" });
    } catch (error) {
      console.error("Error deleting SOW:", error);
      res.status(500).json({ message: "Failed to delete SOW" });
    }
  });


  // Time entries
  app.get("/api/airports", requireAuth, async (req, res) => {
    try {
      const { search, country, limit = "50" } = req.query;
      const maxLimit = Math.min(parseInt(limit as string) || 50, 200);
      
      let airports;
      
      if (search && typeof search === "string" && search.length >= 2) {
        airports = await storage.searchAirportCodes(search, maxLimit);
      } else if (country && typeof country === "string") {
        airports = await storage.getAirportCodesByCountry(country, maxLimit);
      } else {
        airports = await storage.getAllAirportCodes(maxLimit);
      }
      
      res.json(airports);
    } catch (error) {
      console.error("Error fetching airports:", error);
      res.status(500).json({ message: "Failed to fetch airports" });
    }
  });
  
  app.get("/api/airports/:iataCode", requireAuth, async (req, res) => {
    try {
      const { iataCode } = req.params;
      
      if (!iataCode || !/^[A-Z]{3}$/.test(iataCode.toUpperCase())) {
        return res.status(400).json({ message: "Invalid IATA code format" });
      }
      
      const airport = await storage.getAirportByCode(iataCode.toUpperCase());
      
      if (!airport) {
        return res.status(404).json({ message: "Airport not found" });
      }
      
      res.json(airport);
    } catch (error) {
      console.error("Error fetching airport:", error);
      res.status(500).json({ message: "Failed to fetch airport" });
    }
  });
  
  app.post("/api/airports/validate", requireAuth, async (req, res) => {
    try {
      const { codes } = req.body;
      
      if (!Array.isArray(codes)) {
        return res.status(400).json({ message: "codes must be an array" });
      }
      
      const results: Record<string, { valid: boolean; airport?: any }> = {};
      
      for (const code of codes) {
        if (typeof code === "string" && /^[A-Z]{3}$/.test(code.toUpperCase())) {
          const airport = await storage.getAirportByCode(code.toUpperCase());
          results[code.toUpperCase()] = {
            valid: !!airport,
            airport: airport || undefined
          };
        } else {
          results[code] = { valid: false };
        }
      }
      
      res.json(results);
    } catch (error) {
      console.error("Error validating airports:", error);
      res.status(500).json({ message: "Failed to validate airports" });
    }
  });
  
  app.get("/api/airports/stats/count", requireAuth, async (req, res) => {
    try {
      const result = await db.select({ count: sql<number>`count(*)` })
        .from(airportCodes)
        .where(eq(airportCodes.isActive, true));
      res.json({ count: result[0]?.count || 0 });
    } catch (error) {
      console.error("Error fetching airport count:", error);
      res.status(500).json({ message: "Failed to fetch airport count" });
    }
  });
  
  app.post("/api/platform/airports/upload", requireAuth, upload.single('file'), async (req, res) => {
    try {
      const user = (req as any).user;
      const platformRole = user?.platformRole;
      
      if (platformRole !== 'global_admin' && platformRole !== 'constellation_admin') {
        return res.status(403).json({ message: "Only platform admins can upload airport data" });
      }
      
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }
      
      const csvContent = req.file.buffer.toString('utf-8');
      const lines = csvContent.split('\n');
      
      if (lines.length < 2) {
        return res.status(400).json({ message: "CSV file is empty or has no data rows" });
      }
      
      const header = lines[0].toLowerCase();
      const iataCodePattern = /^[A-Z]{3}$/;
      
      let iataIndex = -1;
      let nameIndex = -1;
      let municipalityIndex = -1;
      let countryIndex = -1;
      let regionIndex = -1;
      let typeIndex = -1;
      let coordsIndex = -1;
      
      const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
      iataIndex = headers.findIndex(h => h.includes('iata') || h === 'code');
      nameIndex = headers.findIndex(h => h === 'name' || h.includes('airport'));
      municipalityIndex = headers.findIndex(h => h.includes('municipality') || h.includes('city'));
      countryIndex = headers.findIndex(h => h.includes('country') || h === 'iso_country');
      regionIndex = headers.findIndex(h => h.includes('region') || h === 'iso_region');
      typeIndex = headers.findIndex(h => h === 'type' || h.includes('airport_type'));
      coordsIndex = headers.findIndex(h => h.includes('coord') || h.includes('gps'));
      
      if (iataIndex === -1 || nameIndex === -1) {
        return res.status(400).json({ 
          message: "CSV must have columns for IATA code and airport name",
          headers: headers 
        });
      }
      
      const airports: Array<{
        iataCode: string;
        name: string;
        municipality: string | null;
        isoCountry: string | null;
        isoRegion: string | null;
        airportType: string | null;
        coordinates: string | null;
        isActive: boolean;
      }> = [];
      
      const seenCodes = new Set<string>();
      let skipped = 0;
      
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        
        const parts = parseCSVLine(line);
        const iataCode = (parts[iataIndex] || '').trim().toUpperCase();
        
        if (!iataCodePattern.test(iataCode)) {
          skipped++;
          continue;
        }
        
        if (seenCodes.has(iataCode)) {
          skipped++;
          continue;
        }
        
        seenCodes.add(iataCode);
        
        const name = (parts[nameIndex] || '').trim() || 'Unknown';
        const municipality = municipalityIndex >= 0 ? (parts[municipalityIndex] || '').trim() || null : null;
        const isoCountry = countryIndex >= 0 ? (parts[countryIndex] || '').trim() || null : null;
        const isoRegion = regionIndex >= 0 ? (parts[regionIndex] || '').trim() || null : null;
        const airportType = typeIndex >= 0 ? (parts[typeIndex] || '').trim() || null : null;
        const coordinates = coordsIndex >= 0 ? (parts[coordsIndex] || '').trim() || null : null;
        
        airports.push({
          iataCode,
          name: name === 'null' ? 'Unknown' : name,
          municipality: municipality === 'null' ? null : municipality,
          isoCountry: isoCountry === 'null' ? null : isoCountry,
          isoRegion: isoRegion === 'null' ? null : isoRegion,
          airportType: airportType === 'null' ? null : airportType,
          coordinates: coordinates === 'null' ? null : coordinates,
          isActive: true,
        });
      }
      
      if (airports.length === 0) {
        return res.status(400).json({ 
          message: "No valid 3-letter IATA codes found in the CSV",
          skipped 
        });
      }
      
      const inserted = await storage.bulkUpsertAirportCodes(airports);
      
      res.json({ 
        message: "Airport codes uploaded successfully",
        inserted,
        skipped,
        total: airports.length 
      });
    } catch (error) {
      console.error("Error uploading airport codes:", error);
      res.status(500).json({ message: "Failed to upload airport codes" });
    }
  });
  
  function parseCSVLine(line: string): string[] {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === "," && !inQuotes) {
        result.push(current);
        current = "";
      } else {
        current += char;
      }
    }
    result.push(current);
    
    return result;
  }

  // ============================================================================
  // OCONUS Per Diem Rate Endpoints (Outside Continental US)
  // ============================================================================

  app.get("/api/oconus/rates", requireAuth, async (req, res) => {
    try {
      const { search, country, fiscalYear, limit = "50" } = req.query;
      const maxLimit = Math.min(parseInt(limit as string) || 50, 200);
      const year = fiscalYear ? parseInt(fiscalYear as string) : undefined;
      
      let rates;
      
      if (search && typeof search === "string" && search.length >= 2) {
        rates = await storage.searchOconusRates(search, year, maxLimit);
      } else if (country && typeof country === "string") {
        rates = await storage.getOconusRatesByCountry(country, year, maxLimit);
      } else {
        rates = await storage.searchOconusRates("", year, maxLimit);
      }
      
      res.json(rates);
    } catch (error) {
      console.error("Error fetching OCONUS rates:", error);
      res.status(500).json({ message: "Failed to fetch OCONUS rates" });
    }
  });

  app.get("/api/oconus/rate", requireAuth, async (req, res) => {
    try {
      const { country, location, date, fiscalYear } = req.query;
      
      if (!country || !location) {
        return res.status(400).json({ message: "Country and location are required" });
      }
      
      const travelDate = date ? new Date(date as string) : new Date();
      const year = fiscalYear ? parseInt(fiscalYear as string) : undefined;
      
      const rate = await storage.getOconusRate(
        country as string,
        location as string,
        travelDate,
        year
      );
      
      if (!rate) {
        return res.status(404).json({ message: "OCONUS rate not found for this location" });
      }
      
      res.json(rate);
    } catch (error) {
      console.error("Error fetching OCONUS rate:", error);
      res.status(500).json({ message: "Failed to fetch OCONUS rate" });
    }
  });

  app.get("/api/oconus/countries", requireAuth, async (req, res) => {
    try {
      const { fiscalYear } = req.query;
      const year = fiscalYear ? parseInt(fiscalYear as string) : undefined;
      
      const countries = await storage.getOconusCountries(year);
      res.json(countries);
    } catch (error) {
      console.error("Error fetching OCONUS countries:", error);
      res.status(500).json({ message: "Failed to fetch OCONUS countries" });
    }
  });

  app.get("/api/oconus/locations/:country", requireAuth, async (req, res) => {
    try {
      const { country } = req.params;
      const { fiscalYear } = req.query;
      const year = fiscalYear ? parseInt(fiscalYear as string) : undefined;
      
      const locations = await storage.getOconusLocations(country, year);
      res.json(locations);
    } catch (error) {
      console.error("Error fetching OCONUS locations:", error);
      res.status(500).json({ message: "Failed to fetch OCONUS locations" });
    }
  });

  app.get("/api/oconus/stats/count", requireAuth, async (req, res) => {
    try {
      const { fiscalYear } = req.query;
      const year = fiscalYear ? parseInt(fiscalYear as string) : undefined;
      
      const count = await storage.getOconusRateCount(year);
      res.json({ count, fiscalYear: year || new Date().getFullYear() });
    } catch (error) {
      console.error("Error fetching OCONUS rate count:", error);
      res.status(500).json({ message: "Failed to fetch OCONUS rate count" });
    }
  });

  app.get("/api/oconus/stats/fiscal-years", requireAuth, async (req, res) => {
    try {
      const fiscalYears = await storage.getOconusFiscalYears();
      res.json({ fiscalYears });
    } catch (error) {
      console.error("Error fetching OCONUS fiscal years:", error);
      res.status(500).json({ message: "Failed to fetch OCONUS fiscal years" });
    }
  });

  app.post("/api/platform/oconus/upload", requireAuth, async (req, res) => {
    try {
      const user = (req as any).user;
      const platformRole = user?.platformRole;
      
      if (platformRole !== 'global_admin' && platformRole !== 'constellation_admin') {
        return res.status(403).json({ message: "Only platform admins can upload OCONUS data" });
      }
      
      // Use a custom multer configuration that accepts ZIP and TXT files
      const oconusUpload = multer({
        storage: multer.memoryStorage(),
        limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
        fileFilter: (req, file, cb) => {
          const allowedMimeTypes = [
            'application/zip',
            'application/x-zip-compressed',
            'application/x-zip',
            'text/plain',
            'application/octet-stream' // Some systems send ZIP as this
          ];
          if (allowedMimeTypes.includes(file.mimetype) || 
              file.originalname.endsWith('.zip') || 
              file.originalname.endsWith('.txt')) {
            cb(null, true);
          } else {
            cb(new Error(`File type ${file.mimetype} not allowed. Please upload a ZIP or TXT file.`));
          }
        }
      });
      
      // Handle the file upload
      await new Promise<void>((resolve, reject) => {
        oconusUpload.single('file')(req, res, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }
      
      const { fiscalYear } = req.body;
      const targetYear = fiscalYear ? parseInt(fiscalYear) : new Date().getFullYear();
      
      let content: string;
      const fileName = req.file.originalname?.toLowerCase() || '';
      const isZipFile = fileName.endsWith('.zip') || 
        (req.file.buffer[0] === 0x50 && req.file.buffer[1] === 0x4B);
      
      if (isZipFile) {
        const fs = await import('fs');
        const path = await import('path');
        const { execSync } = await import('child_process');
        
        const tempDir = `/tmp/oconus_upload_${Date.now()}`;
        const tempZipPath = path.default.join(tempDir, 'uploaded.zip');
        
        fs.default.mkdirSync(tempDir, { recursive: true });
        fs.default.writeFileSync(tempZipPath, req.file.buffer);
        
        try {
          execSync(`unzip -o "${tempZipPath}" -d "${tempDir}"`, { stdio: 'pipe' });
          
          const files = fs.default.readdirSync(tempDir);
          const oconusFile = files
            .filter((f: string) => f.endsWith('oconus.txt') && !f.includes('oconusnm'))
            .sort()
            .pop();
          
          if (!oconusFile) {
            fs.default.rmSync(tempDir, { recursive: true });
            return res.status(400).json({ 
              message: "No OCONUS data file found in ZIP. Expected a file ending with 'oconus.txt'" 
            });
          }
          
          content = fs.default.readFileSync(path.default.join(tempDir, oconusFile), 'utf-8');
          fs.default.rmSync(tempDir, { recursive: true });
        } catch (err) {
          if (fs.default.existsSync(tempDir)) {
            fs.default.rmSync(tempDir, { recursive: true });
          }
          throw err;
        }
      } else {
        content = req.file.buffer.toString('utf-8');
      }
      
      const lines = content.split('\n');
      
      const rates: Array<{
        country: string;
        location: string;
        seasonStart: string;
        seasonEnd: string;
        lodging: number;
        mie: number;
        proportionalMeals: number | null;
        incidentals: number | null;
        maxPerDiem: number;
        effectiveDate: string | null;
        fiscalYear: number;
        isActive: boolean;
      }> = [];
      
      const seenLocations = new Set<string>();
      let skipped = 0;
      
      for (const line of lines) {
        if (!line.trim()) continue;
        
        const parts = line.split(';');
        if (parts.length < 12) {
          skipped++;
          continue;
        }
        
        const country = parts[0]?.trim() || "";
        const location = parts[1]?.trim() || "";
        const seasonStart = parts[2]?.trim() || "";
        const seasonEnd = parts[3]?.trim() || "";
        const lodging = parseInt(parts[4]) || 0;
        const mie = parseInt(parts[5]) || 0;
        const proportionalMeals = parts[6] ? parseInt(parts[6]) : null;
        const incidentals = parts[7] ? parseInt(parts[7]) : null;
        const maxPerDiem = parseInt(parts[10]) || 0;
        const effectiveDate = parts[11]?.trim() || null;
        
        if (!country || !location || !seasonStart || !seasonEnd) {
          skipped++;
          continue;
        }
        
        const locationKey = `${country}|${location}|${seasonStart}|${seasonEnd}`;
        if (seenLocations.has(locationKey)) {
          skipped++;
          continue;
        }
        seenLocations.add(locationKey);
        
        rates.push({
          country,
          location,
          seasonStart,
          seasonEnd,
          lodging,
          mie,
          proportionalMeals,
          incidentals,
          maxPerDiem,
          effectiveDate,
          fiscalYear: targetYear,
          isActive: true,
        });
      }
      
      await storage.deleteOconusRatesByFiscalYear(targetYear);
      const inserted = await storage.bulkInsertOconusRates(rates);
      
      res.json({
        message: "OCONUS rates uploaded successfully",
        inserted,
        skipped,
        fiscalYear: targetYear
      });
    } catch (error) {
      console.error("Error uploading OCONUS rates:", error);
      res.status(500).json({ message: "Failed to upload OCONUS rates" });
    }
  });

  // Project milestones (these may already exist, but adding for completeness)
  app.get("/api/projects/:projectId/milestones", requireAuth, async (req, res) => {
    try {
      const { projectId } = req.params;

      const milestones = await storage.getProjectMilestones(projectId);
      res.json(milestones);
    } catch (error: any) {
      console.error("Failed to get project milestones:", error);
      res.status(500).json({ 
        message: "Failed to get project milestones" 
      });
    }
  });

  app.post("/api/projects/:projectId/milestones", requireAuth, requireRole(["admin", "pm", "portfolio-manager", "executive"]), async (req, res) => {
    try {
      const { projectId } = req.params;
      const milestoneData = {
        ...req.body,
        projectId,
        order: req.body.order ?? 0
      };
      const milestone = await storage.createProjectMilestone(milestoneData);
      res.json(milestone);
    } catch (error) {
      console.error("Error creating milestone:", error);
      res.status(500).json({ message: "Failed to create milestone" });
    }
  });

  // Update milestone
  app.patch("/api/milestones/:id", requireAuth, requireRole(["admin", "pm", "portfolio-manager", "executive"]), async (req, res) => {
    try {
      // Tenant scoping: storage.getProjectMilestone/updateProjectMilestone
      // query by milestone id only. Without this guard a user in tenant A
      // could PATCH a milestone in tenant B (and now trigger a Galaxy
      // webhook to tenant B's apps in their name). Resolve the milestone's
      // owning project, verify tenant match, and only then proceed.
      const before = await storage.getProjectMilestone(req.params.id);
      if (!before) return res.status(404).json({ message: "Milestone not found" });
      const project = await storage.getProject(before.projectId);
      if (!project) return res.status(404).json({ message: "Milestone not found" });
      const userTenantId = (req as any).user?.tenantId;
      if (userTenantId && project.tenantId && project.tenantId !== userTenantId) {
        // Mirror the 404 we use elsewhere for cross-tenant access — don't
        // leak whether the resource exists.
        return res.status(404).json({ message: "Milestone not found" });
      }

      const milestone = await storage.updateProjectMilestone(req.params.id, req.body);

      // Genuine open→completed transition only (not every PATCH that
      // happens to leave status="completed").
      if (
        milestone &&
        before.status !== "completed" &&
        milestone.status === "completed" &&
        project.clientId &&
        project.tenantId
      ) {
        enqueueGalaxyEvent({
          tenantId: project.tenantId,
          event: "milestone.completed",
          clientId: project.clientId,
          data: {
            milestoneId: milestone.id,
            projectId: milestone.projectId,
            name: milestone.name,
            completedDate: milestone.completedDate ?? null,
            isPaymentMilestone: !!(milestone as any).isPaymentMilestone,
          },
        }).catch((err) =>
          console.error("[GALAXY] milestone.completed enqueue failed:", err)
        );
      }

      res.json(milestone);
    } catch (error) {
      res.status(500).json({ message: "Failed to update milestone" });
    }
  });

  // Delete milestone
  app.delete("/api/milestones/:id", requireAuth, requireRole(["admin", "pm", "portfolio-manager", "executive"]), async (req, res) => {
    try {
      await storage.deleteProjectMilestone(req.params.id);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete milestone" });
    }
  });

  // Get workstreams for dropdown  
  app.get("/api/projects/:projectId/workstreams", requireAuth, async (req, res) => {
    try {
      const workstreams = await storage.getProjectWorkStreams(req.params.projectId);
      res.json(workstreams);
    } catch (error) {
      res.status(500).json({ message: "Failed to get project workstreams" });
    }
  });

  // Create workstream
  app.post("/api/projects/:projectId/workstreams", requireAuth, requireRole(["admin", "pm", "portfolio-manager", "executive"]), async (req, res) => {
    try {
      const workstreamData = {
        ...req.body,
        projectId: req.params.projectId,
        order: req.body.order || 0
      };
      const workstream = await storage.createProjectWorkStream(workstreamData);
      res.json(workstream);
    } catch (error) {
      res.status(500).json({ message: "Failed to create workstream" });
    }
  });

  // Update workstream
  app.patch("/api/workstreams/:id", requireAuth, requireRole(["admin", "pm", "portfolio-manager", "executive"]), async (req, res) => {
    try {
      const workstream = await storage.updateProjectWorkStream(req.params.id, req.body);
      res.json(workstream);
    } catch (error) {
      res.status(500).json({ message: "Failed to update workstream" });
    }
  });

  // Delete workstream
  app.delete("/api/workstreams/:id", requireAuth, requireRole(["admin", "pm", "portfolio-manager", "executive"]), async (req, res) => {
    try {
      await storage.deleteProjectWorkStream(req.params.id);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete workstream" });
    }
  });


  // ===================== PROFIT TRACKING ENDPOINTS =====================

  // Get project profit/margin calculations
  app.get("/api/projects/:projectId/profit", requireAuth, requireRole(["admin", "billing-admin", "executive"]), async (req, res) => {
    try {
      const profit = await storage.calculateProjectProfit(req.params.projectId);
      const margin = await storage.calculateProjectMargin(req.params.projectId);
      res.json({ ...profit, margin });
    } catch (error) {
      res.status(500).json({ message: "Failed to calculate project profit" });
    }
  });

  // SharePoint Container Admin routes are now in server/routes/sharepoint-containers.ts

  // Authentication endpoints are handled by auth-routes.ts with shared session store

  // SSO status endpoint
  app.get("/api/auth/sso/status", async (req, res) => {
    try {
      res.json({
        configured: isEntraConfigured,
        enabled: isEntraConfigured
      });
    } catch (error) {
      console.error("SSO status error:", error);
      res.status(500).json({ message: "Failed to get SSO status" });
    }
  });

  // SSO login endpoint - initiates auth flow (MUST be before middleware)
  app.get("/api/auth/sso/login", async (req, res) => {
    console.log("[SSO-LOGIN] Initiating SSO login flow");
    console.log("[SSO-LOGIN] Request headers:", {
      'x-session-id': req.headers['x-session-id'] ? 'present' : 'absent',
      'user-agent': req.headers['user-agent'],
      'referer': req.headers['referer']
    });
    
    try {
      if (!msalInstance) {
        console.error("[SSO-LOGIN] MSAL instance not configured");
        return res.status(503).json({ message: "SSO not configured" });
      }

      console.log("[SSO-LOGIN] Generating auth URL with redirect URI:", authCodeRequest.redirectUri);
      const authUrl = await msalInstance.getAuthCodeUrl(authCodeRequest);
      console.log("[SSO-LOGIN] Auth URL generated successfully");
      res.json({ authUrl });
    } catch (error: any) {
      console.error("[SSO-LOGIN] Failed to generate auth URL:", {
        error: error.message,
        errorCode: error.errorCode,
        stack: error.stack
      });
      res.status(500).json({ message: "Failed to initiate SSO login" });
    }
  });

  // SSO callback endpoint - handles Azure AD redirect (MUST be before middleware)
  app.get("/api/auth/callback", async (req, res) => {
    console.log("[SSO-CALLBACK] Processing Azure AD callback");
    console.log("[SSO-CALLBACK] Query params:", {
      hasCode: !!req.query.code,
      hasError: !!req.query.error,
      errorDescription: req.query.error_description
    });
    
    try {
      if (!msalInstance) {
        console.error("[SSO-CALLBACK] MSAL instance not configured");
        return res.redirect("/?error=sso_not_configured");
      }

      const { code, error, error_description } = req.query;
      
      // Handle Azure AD errors
      if (error) {
        console.error("[SSO-CALLBACK] Azure AD returned error:", {
          error,
          description: error_description
        });
        return res.redirect(`/?error=${error}`);
      }
      
      if (!code || typeof code !== 'string') {
        console.error("[SSO-CALLBACK] Missing or invalid authorization code");
        return res.redirect("/?error=missing_auth_code");
      }

      console.log("[SSO-CALLBACK] Exchanging auth code for tokens");
      // Exchange authorization code for tokens
      const tokenResponse = await msalInstance.acquireTokenByCode({
        ...authCodeRequest,
        code
      });

      if (!tokenResponse?.account) {
        console.error("[SSO-CALLBACK] No account in token response");
        return res.redirect("/?error=no_account");
      }

      const userEmail = tokenResponse.account.username;
      const azureAdTenantId = tokenResponse.account.tenantId;
      const azureAdObjectId = tokenResponse.account.localAccountId;
      console.log("[SSO-CALLBACK] Token exchange successful for user:", userEmail);
      console.log("[SSO-CALLBACK] Token details:", {
        hasAccessToken: !!tokenResponse.accessToken,
        hasRefreshToken: !!(tokenResponse as any).refreshToken,
        expiresOn: tokenResponse.expiresOn,
        scopes: tokenResponse.scopes,
        azureTenantId: azureAdTenantId
      });

      // Look up user in database by email (case-insensitive)
      const [foundUser] = await db.select()
        .from(users)
        .where(sql`LOWER(${users.email}) = LOWER(${userEmail})`);

      let activeUser = foundUser;

      if (!activeUser) {
        // ── JIT provisioning (Vega pattern) ─────────────────────────────────
        console.log("[SSO-CALLBACK] User not found, starting JIT provisioning for:", userEmail);
        const emailDomain = userEmail.split('@')[1]?.toLowerCase();
        if (!emailDomain) return res.redirect("/?error=invalid_email");

        // Find matching tenant: Azure tenant ID first, then email domain
        const allTenants = await db.select().from(tenants);
        let matchingTenant = allTenants.find(t => t.azureTenantId === azureAdTenantId) ?? null;
        const isPublicDomain = isPublicEmailDomain(userEmail);
        if (!matchingTenant && !isPublicDomain) {
          matchingTenant = allTenants.find(t => {
            const domains = (t.allowedDomains as string[] | null) ?? [];
            return domains.includes(emailDomain);
          }) ?? null;
        }

        let isNewTenant = false;
        let newUserRole = 'employee';

        if (!matchingTenant) {
          // Check domain block list
          const [blocked] = await db.select().from(blockedDomains)
            .where(eq(blockedDomains.domain, emailDomain));
          if (blocked) {
            console.log(`[SSO-CALLBACK] Domain ${emailDomain} is blocked`);
            return res.redirect("/?error=domain_blocked");
          }

          // Resolve default service plan
          const [defaultPlan] = await db.select().from(servicePlans)
            .where(and(eq(servicePlans.isDefault, true), eq(servicePlans.isActive, true)));
          const planId = defaultPlan?.id ?? null;
          const now = new Date();
          const planExpiresAt = defaultPlan?.trialDurationDays
            ? new Date(now.getTime() + defaultPlan.trialDurationDays * 24 * 60 * 60 * 1000)
            : null;

          const { randomUUID } = await import('crypto');

          if (isPublicDomain) {
            // Personal tenant — invite-only, no domain/Azure tenant claim
            const userName = userEmail.split('@')[0];
            const slug = `user-${randomUUID().substring(0, 8)}`;
            const [newTenant] = await db.insert(tenants).values({
              name: `${userName}'s Organization`,
              slug,
              allowedDomains: [],
              selfServiceSignup: true,
              signupCompletedAt: now,
              servicePlanId: planId,
              planStartedAt: now,
              planExpiresAt,
              planStatus: planExpiresAt ? 'trial' : 'active',
              inviteOnly: true,
              azureTenantId: null,
              allowLocalAuth: false,
            }).returning();
            matchingTenant = newTenant;
            console.log(`[SSO-CALLBACK] Created invite-only tenant for public-domain user: ${newTenant.id}`);
          } else {
            // Business tenant — claims the domain and links Azure tenant
            const companyName = emailDomain.split('.')[0];
            const capName = companyName.charAt(0).toUpperCase() + companyName.slice(1);
            let slug = emailDomain.replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
            const [existingSlug] = await db.select().from(tenants).where(eq(tenants.slug, slug));
            if (existingSlug) slug = `${slug}-${randomUUID().substring(0, 6)}`;
            const [newTenant] = await db.insert(tenants).values({
              name: `${capName} (${emailDomain})`,
              slug,
              allowedDomains: [emailDomain],
              selfServiceSignup: true,
              signupCompletedAt: now,
              servicePlanId: planId,
              planStartedAt: now,
              planExpiresAt,
              planStatus: planExpiresAt ? 'trial' : 'active',
              inviteOnly: false,
              azureTenantId: azureAdTenantId ?? null,
              allowLocalAuth: false,
            }).returning();
            matchingTenant = newTenant;
            console.log(`[SSO-CALLBACK] Created SSO tenant for ${emailDomain}: ${newTenant.id}`);
          }

          isNewTenant = true;
          newUserRole = 'admin'; // First user in a new tenant is admin

          // HubSpot CRM notification (non-blocking stub — extend when deal ID is available)
          try {
            const hubConnected = await isHubSpotConnected(matchingTenant.id);
            if (hubConnected) {
              console.log(`[SSO-JIT] HubSpot connected for new tenant ${matchingTenant.id}; deal creation deferred.`);
            }
          } catch { /* non-critical */ }

        } else {
          // Tenant found — enforce invite-only policy
          if (matchingTenant.inviteOnly === true) {
            console.log(`[SSO-CALLBACK] Tenant ${matchingTenant.name} is invite-only, blocking auto-join for ${userEmail}`);
            const tenantNameEncoded = encodeURIComponent(matchingTenant.name);
            return res.redirect(`/?error=invite_only&tenant_name=${tenantNameEncoded}`);
          }
          console.log(`[SSO-CALLBACK] Found tenant ${matchingTenant.name}, allowing JIT auto-join`);
        }

        // Infer display name from email local-part (e.g. john.smith → John Smith)
        const localPart = userEmail.split('@')[0];
        const nameParts = localPart.split(/[._-]/);
        const inferredName = nameParts.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
        const initials = nameParts.map(p => p[0]?.toUpperCase() ?? '').join('').substring(0, 2) || 'U';

        const [newUser] = await db.insert(users).values({
          email: userEmail.toLowerCase(),
          name: inferredName,
          initials,
          role: newUserRole,
          canLogin: true,
          isAssignable: true,
          isActive: true,
          primaryTenantId: matchingTenant.id,
          platformRole: 'user',
          authProvider: 'entra',
          azureObjectId: azureAdObjectId ?? null,
        }).returning();

        await db.insert(tenantUsers).values({
          userId: newUser.id,
          tenantId: matchingTenant.id,
          role: newUserRole,
          status: 'active',
          joinedAt: new Date(),
        });

        activeUser = newUser;
        console.log(`[SSO-CALLBACK] JIT provisioned ${userEmail} → tenant ${matchingTenant.id} (${isNewTenant ? 'new tenant' : 'existing tenant'}), role: ${newUserRole}`);

      } else {
        // Existing user — back-fill Azure linkage and auto-populate azureTenantId on tenant
        console.log("[SSO-CALLBACK] Found existing user:", { id: activeUser.id, email: activeUser.email, role: activeUser.role });

        if (azureAdObjectId && !activeUser.azureObjectId) {
          await db.update(users)
            .set({ azureObjectId: azureAdObjectId, authProvider: 'entra' })
            .where(eq(users.id, activeUser.id));
        }

        if (azureAdTenantId && activeUser.primaryTenantId) {
          const [userTenant] = await db.select().from(tenants)
            .where(eq(tenants.id, activeUser.primaryTenantId)).limit(1);
          if (userTenant && !userTenant.azureTenantId) {
            await db.update(tenants)
              .set({ azureTenantId: azureAdTenantId })
              .where(eq(tenants.id, userTenant.id));
            console.log(`[SSO-CALLBACK] Auto-populated azureTenantId=${azureAdTenantId} for tenant ${userTenant.slug}`);
          }
        }
      }

      // Create session with actual database user ID and SSO tokens
      const { createSession } = await import("./session-store.js");
      const crypto = await import('crypto');
      const sessionId = crypto.randomUUID();
      
      let extractedRefreshToken: string | null = null;
      try {
        const cacheContents = msalInstance.getTokenCache().serialize();
        const cacheJson = JSON.parse(cacheContents);
        const refreshTokens = cacheJson.RefreshToken || {};
        const rtKeys = Object.keys(refreshTokens);
        if (rtKeys.length > 0) {
          const homeAccountId = tokenResponse.account?.homeAccountId;
          const matchingKey = homeAccountId
            ? rtKeys.find(k => refreshTokens[k].home_account_id === homeAccountId)
            : rtKeys[rtKeys.length - 1];
          const rtEntry = refreshTokens[matchingKey || rtKeys[rtKeys.length - 1]];
          extractedRefreshToken = rtEntry?.secret || null;
          console.log("[SSO-CALLBACK] Refresh token extracted from MSAL cache:", !!extractedRefreshToken);
        }
      } catch (cacheErr: any) {
        console.log("[SSO-CALLBACK] Could not extract refresh token from MSAL cache:", cacheErr?.message);
      }

      const ssoData = {
        provider: 'azure-ad',
        accessToken: tokenResponse.accessToken,
        refreshToken: extractedRefreshToken,
        tokenExpiry: tokenResponse.expiresOn || new Date(Date.now() + 3600 * 1000)
      };
      
      console.log("[SSO-CALLBACK] Creating session:", {
        sessionId: sessionId.substring(0, 8) + '...',
        hasRefreshToken: !!ssoData.refreshToken,
        tokenExpiry: ssoData.tokenExpiry
      });
      
      await createSession(sessionId, {
        id: activeUser.id,
        email: activeUser.email,
        name: activeUser.name,
        role: activeUser.role,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent']
      }, ssoData);

      console.log("[SSO-CALLBACK] Session created successfully, redirecting user");
      // Redirect to app with session ID
      res.redirect(`/?sessionId=${sessionId}`);
    } catch (error: any) {
      console.error("[SSO-CALLBACK] Fatal error during callback processing:", {
        message: error.message,
        errorCode: error.errorCode,
        stack: error.stack,
        details: error
      });
      res.redirect("/?error=sso_failed");
    }
  });

  // SSO token refresh endpoint (requires auth)
  app.post("/api/auth/sso/refresh", requireAuth, handleTokenRefresh);
  
  // Apply token refresh check middleware to protected routes (AFTER SSO login/callback endpoints)
  app.use("/api/*", checkAndRefreshToken);

  // ── Public page analytics ────────────────────────────────────────────────
  // POST /api/analytics/pageview  — no auth (public pages)
  app.post("/api/analytics/pageview", async (req, res) => {
    try {
      const { path, sessionId, referrer } = req.body || {};
      if (!path || typeof path !== "string") return res.status(400).json({ message: "path required" });
      const allowedPaths = ["/", "/signup", "/login"];
      if (!allowedPaths.includes(path)) return res.status(400).json({ message: "path not tracked" });
      await db.insert(pageViews).values({
        path,
        sessionId: sessionId ? String(sessionId).slice(0, 128) : null,
        referrer: referrer ? String(referrer).slice(0, 512) : null,
        userAgent: req.headers["user-agent"]?.slice(0, 512) ?? null,
      });
      res.json({ ok: true });
    } catch (error: any) {
      console.error("[ANALYTICS] pageview record failed:", error);
      res.status(500).json({ message: "Failed to record pageview" });
    }
  });

  // GET /api/analytics/pageviews  — admin only
  app.get("/api/analytics/pageviews", requireAuth, requirePlatformAdmin, async (req, res) => {
    try {
      const days = Math.min(parseInt(String(req.query.days || "30")), 365);
      const since = new Date(Date.now() - days * 86400_000).toISOString();

      const rows = await db
        .select({
          path: pageViews.path,
          visits: sql<number>`cast(count(*) as integer)`,
          uniqueSessions: sql<number>`cast(count(distinct ${pageViews.sessionId}) as integer)`,
          lastSeen: sql<string>`max(${pageViews.createdAt})`,
        })
        .from(pageViews)
        .where(gte(pageViews.createdAt, new Date(since)))
        .groupBy(pageViews.path)
        .orderBy(desc(sql`count(*)`));

      res.json({ days, since, rows });
    } catch (error: any) {
      console.error("[ANALYTICS] pageviews summary failed:", error);
      res.status(500).json({ message: "Failed to fetch pageviews" });
    }
  });

}
