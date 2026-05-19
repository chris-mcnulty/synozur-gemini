import type { Express } from "express";
import { z } from "zod";
import { storage, db } from "../storage";
import { insertUserSchema, tenantUsers, clients, userRoleCapabilities, users, roles, insertUserRoleCapabilitySchema, payrollEmployees } from "@shared/schema";
import { eq, and, inArray, isNull } from "drizzle-orm";
import { syncUserPayrollEnrollment } from "../services/payroll-user-sync";

// Enrich a list of users with a `payrollEmployeeId` field for any user who
// has an active (non-terminated, not-soft-deleted) linked payroll employee
// IN THE GIVEN TENANT. A global user can be a payroll employee in multiple
// tenants — without the tenant scope, the Users page in tenant A would
// surface payroll metadata from tenant B and let an admin deep-link into
// it, exposing cross-tenant data.
async function enrichWithPayrollLink(rows: any[], tenantId: string | undefined): Promise<any[]> {
  if (rows.length === 0) return rows;
  // Without a tenant scope we can't safely surface payroll links — return
  // the rows untouched rather than risk leaking another tenant's data.
  if (!tenantId) return rows.map(u => ({ ...u, payrollEmployeeId: null, payrollEmployeeStatus: null }));
  const userIds = rows.map(u => u.id);
  const links = await db.select({ userId: payrollEmployees.userId, id: payrollEmployees.id, status: payrollEmployees.status })
    .from(payrollEmployees)
    .where(and(
      inArray(payrollEmployees.userId, userIds),
      eq(payrollEmployees.tenantId, tenantId),
      isNull(payrollEmployees.deletedAt),
    ));
  const byUser = new Map<string, { id: string; status: string }>();
  for (const l of links) if (l.userId) byUser.set(l.userId, { id: l.id, status: l.status });
  return rows.map(u => {
    const link = byUser.get(u.id);
    return { ...u, payrollEmployeeId: link?.id ?? null, payrollEmployeeStatus: link?.status ?? null };
  });
}

interface UserRouteDeps {
  requireAuth: any;
  requireRole: (roles: string[]) => any;
}

export function registerUserRoutes(app: Express, deps: UserRouteDeps) {

  app.get("/api/users", deps.requireAuth, deps.requireRole(["admin", "pm", "portfolio-manager", "billing-admin", "executive"]), async (req, res) => {
    try {
      const currentUser = (req as any).user;
      const tenantId = currentUser?.tenantId || undefined;

      // Backward-compat: only paginate when caller explicitly passes limit or offset
      if (req.query.limit === undefined && req.query.offset === undefined) {
        const includeInactive = req.query.includeInactive === 'true';
        const includeStakeholders = req.query.includeStakeholders === 'true';
        const usersList = await storage.getUsers(tenantId, { includeInactive, includeStakeholders });
        // Enrich with client memberships (full set — legacy behaviour)
        let enrichedUsers: any[] = usersList.map((u: any) => ({ ...u }));
        const userIds = usersList.map((u: any) => u.id);
        if (userIds.length > 0) {
          const membershipConditions: any[] = [
            eq(tenantUsers.status, 'active'),
            inArray(tenantUsers.userId, userIds),
          ];
          if (tenantId) membershipConditions.push(eq(tenantUsers.tenantId, tenantId));
          const memberships = await db.select({ userId: tenantUsers.userId, clientId: tenantUsers.clientId })
            .from(tenantUsers).where(and(...membershipConditions));
          const userClientMap = new Map<string, string[]>();
          for (const m of memberships) {
            if (m.clientId) {
              const arr = userClientMap.get(m.userId) || [];
              if (!arr.includes(m.clientId)) arr.push(m.clientId);
              userClientMap.set(m.userId, arr);
            }
          }
          const allClientIds = Array.from(new Set(memberships.filter(m => m.clientId).map(m => m.clientId!)));
          const clientNameMap = new Map<string, string>();
          if (allClientIds.length > 0) {
            const clientRows = await db.select({ id: clients.id, name: clients.name }).from(clients).where(inArray(clients.id, allClientIds));
            for (const c of clientRows) clientNameMap.set(c.id, c.name);
          }
          const capConditions: any[] = [inArray(userRoleCapabilities.userId, userIds)];
          if (tenantId) capConditions.push(eq(userRoleCapabilities.tenantId, tenantId));
          const allCapabilities = await db
            .select({ userId: userRoleCapabilities.userId, proficiencyLevel: userRoleCapabilities.proficiencyLevel, roleName: roles.name })
            .from(userRoleCapabilities).leftJoin(roles, eq(userRoleCapabilities.roleId, roles.id))
            .where(and(...capConditions));
          const userCapMap = new Map<string, any[]>();
          for (const cap of allCapabilities) {
            const arr = userCapMap.get(cap.userId) || [];
            arr.push({ roleName: cap.roleName || 'Unknown', proficiencyLevel: cap.proficiencyLevel });
            userCapMap.set(cap.userId, arr);
          }
          enrichedUsers = enrichedUsers.map((u: any) => {
            const clientIds = userClientMap.get(u.id) || [];
            return {
              ...u,
              clientIds,
              clientNames: clientIds.map(id => clientNameMap.get(id)).filter(Boolean),
              roleCapabilities: userCapMap.get(u.id) || [],
            };
          });
        }
        if (currentUser?.role === 'portfolio-manager') {
          enrichedUsers = enrichedUsers.map((u: any) => u.isSalaried ? u : { ...u, defaultCostRate: null });
        }
        enrichedUsers = await enrichWithPayrollLink(enrichedUsers, tenantId);
        return res.json(enrichedUsers);
      }

      const { userFiltersSchema } = await import("@shared/pagination");
      const parsed = userFiltersSchema.parse(req.query);

      const pagedResult = await storage.getUsersPaginated(tenantId, {
        includeInactive: parsed.includeInactive,
        includeStakeholders: parsed.includeStakeholders,
        search: parsed.search,
        role: parsed.role,
        status: parsed.status,
        limit: parsed.limit,
        offset: parsed.offset,
      });

      const userIds = pagedResult.items.map((u: any) => u.id);

      // Enrich only the page of users with client memberships
      let enrichedUsers: any[] = pagedResult.items.map((u: any) => ({ ...u }));
      if (userIds.length > 0) {
        const membershipConditions: any[] = [
          eq(tenantUsers.status, 'active'),
          inArray(tenantUsers.userId, userIds),
        ];
        if (tenantId) membershipConditions.push(eq(tenantUsers.tenantId, tenantId));

        const memberships = await db.select({
          userId: tenantUsers.userId,
          clientId: tenantUsers.clientId,
          tenantRole: tenantUsers.role,
        })
        .from(tenantUsers)
        .where(and(...membershipConditions));

        const userClientMap = new Map<string, string[]>();
        for (const m of memberships) {
          if (m.clientId) {
            const arr = userClientMap.get(m.userId) || [];
            if (!arr.includes(m.clientId)) arr.push(m.clientId);
            userClientMap.set(m.userId, arr);
          }
        }

        const allClientIds = Array.from(new Set(memberships.filter(m => m.clientId).map(m => m.clientId!)));
        const clientNameMap = new Map<string, string>();
        if (allClientIds.length > 0) {
          const clientRows = await db.select({ id: clients.id, name: clients.name })
            .from(clients)
            .where(inArray(clients.id, allClientIds));
          for (const c of clientRows) clientNameMap.set(c.id, c.name);
        }

        enrichedUsers = enrichedUsers.map((u: any) => {
          const clientIds = userClientMap.get(u.id) || [];
          const clientNames = clientIds.map(id => clientNameMap.get(id)).filter(Boolean);
          return { ...u, clientIds, clientNames };
        });

        // Enrich with role capabilities
        const capConditions: any[] = [inArray(userRoleCapabilities.userId, userIds)];
        if (tenantId) capConditions.push(eq(userRoleCapabilities.tenantId, tenantId));
        const allCapabilities = await db
          .select({
            userId: userRoleCapabilities.userId,
            roleId: userRoleCapabilities.roleId,
            proficiencyLevel: userRoleCapabilities.proficiencyLevel,
            roleName: roles.name,
          })
          .from(userRoleCapabilities)
          .leftJoin(roles, eq(userRoleCapabilities.roleId, roles.id))
          .where(and(...capConditions));

        const userCapMap = new Map<string, { roleName: string; proficiencyLevel: string }[]>();
        for (const cap of allCapabilities) {
          const arr = userCapMap.get(cap.userId) || [];
          arr.push({ roleName: cap.roleName || 'Unknown', proficiencyLevel: cap.proficiencyLevel });
          userCapMap.set(cap.userId, arr);
        }
        enrichedUsers = enrichedUsers.map((u: any) => ({
          ...u,
          roleCapabilities: userCapMap.get(u.id) || [],
        }));
      }

      if (currentUser?.role === 'portfolio-manager') {
        enrichedUsers = enrichedUsers.map((u: any) => u.isSalaried ? u : { ...u, defaultCostRate: null });
      }
      enrichedUsers = await enrichWithPayrollLink(enrichedUsers, tenantId);

      res.json({
        items: enrichedUsers,
        total: pagedResult.total,
        hasMore: pagedResult.hasMore,
        limit: parsed.limit,
        offset: parsed.offset,
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch users" });
    }
  });

  app.post("/api/users", deps.requireAuth, deps.requireRole(["admin"]), async (req, res) => {
    try {
      const validatedData = insertUserSchema.parse(req.body);
      if (validatedData.payrollEmployeeType && !validatedData.email) {
        return res.status(400).json({ message: "Email is required to enroll a user in payroll" });
      }
      const user = await storage.createUser(validatedData);
      const actor = (req as any).user?.id;
      // Sync happens against the REQUESTING admin's tenant, not the new
      // user's primaryTenantId — otherwise a global admin acting in
      // tenant A could accidentally enroll the user in tenant B.
      const requestTenantId = (req as any).user?.activeTenantId || (req as any).user?.tenantId;
      try {
        const { linkedEmployeeId } = await syncUserPayrollEnrollment(user, actor, requestTenantId);
        res.status(201).json({ ...user, payrollEmployeeId: linkedEmployeeId });
      } catch (syncErr: any) {
        // Sync failed after user was created — clear the enrollment flag so the
        // user row and payroll state stay consistent, then surface the error.
        await storage.updateUser(user.id, { payrollEmployeeType: null } as any);
        return res.status(400).json({ message: `User created but payroll enrollment failed: ${syncErr.message}` });
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid user data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to create user" });
    }
  });

  app.patch("/api/users/:id", deps.requireAuth, deps.requireRole(["admin"]), async (req, res) => {
    try {
      const currentUser = (req as any).user;
      const platformRole = currentUser?.platformRole;
      const isPlatformAdmin = platformRole === 'global_admin' || platformRole === 'constellation_admin';
      
      if (!isPlatformAdmin && currentUser?.tenantId) {
        const [membership] = await db.select({ id: tenantUsers.id })
          .from(tenantUsers)
          .where(and(
            eq(tenantUsers.userId, req.params.id),
            eq(tenantUsers.tenantId, currentUser.tenantId),
            eq(tenantUsers.status, 'active')
          ));
        
        if (!membership) {
          return res.status(403).json({ message: "You can only edit users within your organization" });
        }
      }

      const body = { ...req.body };
      if (body.defaultBillingRate === '' || body.defaultBillingRate === undefined) body.defaultBillingRate = null;
      if (body.defaultCostRate === '' || body.defaultCostRate === undefined) body.defaultCostRate = null;
      const allowedFields = ['name', 'firstName', 'lastName', 'initials', 'email', 'role', 'canLogin',
        'isAssignable', 'defaultBillingRate', 'defaultCostRate', 'isSalaried', 'isActive', 'title',
        'customRole', 'roleId', 'contractorBusinessName', 'contractorBusinessAddress',
        'contractorBillingId', 'contractorPhone', 'contractorEmail', 'platformRole',
        'receiveTimeReminders', 'receiveExpenseReminders', 'primaryTenantId',
        'weeklyCapacityHours', 'capacityNotes', 'capacityEffectiveDate',
        'payrollEmployeeType'];
      const safeBody = Object.fromEntries(Object.entries(body).filter(([k]) => allowedFields.includes(k)));
      if ('payrollEmployeeType' in safeBody) {
        const v = safeBody.payrollEmployeeType;
        if (v !== null && v !== undefined && v !== '' && v !== 'w2' && v !== '1099') {
          return res.status(400).json({ message: "payrollEmployeeType must be 'w2', '1099', or null" });
        }
        if (v === '' || v === undefined) safeBody.payrollEmployeeType = null;
      }

      const user = await storage.updateUser(req.params.id, safeBody as any);
      let linkedEmployeeId: string | null = null;
      if ('payrollEmployeeType' in safeBody) {
        // Sync into the REQUESTING admin's tenant context — multi-tenant
        // users would otherwise have their payroll state mutated in
        // whichever tenant happens to be primaryTenantId.
        const requestTenantId = (req as any).user?.activeTenantId || (req as any).user?.tenantId;
        try {
          ({ linkedEmployeeId } = await syncUserPayrollEnrollment(user, (req as any).user?.id, requestTenantId));
        } catch (syncErr: any) {
          // Roll back enrollment intent so user state matches payroll state.
          await storage.updateUser(user.id, { payrollEmployeeType: null } as any);
          return res.status(400).json({ message: `Payroll enrollment failed: ${syncErr.message}` });
        }
      }
      res.json({ ...user, ...(('payrollEmployeeType' in safeBody) ? { payrollEmployeeId: linkedEmployeeId } : {}) });
    } catch (error) {
      console.error("Error updating user:", error);
      res.status(500).json({ message: "Failed to update user", detail: error instanceof Error ? error.message : String(error) });
    }
  });

  app.delete("/api/users/:id", deps.requireAuth, deps.requireRole(["admin"]), async (req, res) => {
    try {
      const currentUser = (req as any).user;
      const platformRole = currentUser?.platformRole;
      const isPlatformAdmin = platformRole === 'global_admin' || platformRole === 'constellation_admin';
      
      if (!isPlatformAdmin && currentUser?.tenantId) {
        const [membership] = await db.select({ id: tenantUsers.id })
          .from(tenantUsers)
          .where(and(
            eq(tenantUsers.userId, req.params.id),
            eq(tenantUsers.tenantId, currentUser.tenantId),
            eq(tenantUsers.status, 'active')
          ));
        
        if (!membership) {
          return res.status(403).json({ message: "You can only delete users within your organization" });
        }
      }
      
      await storage.deleteUser(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting user:", error);
      res.status(400).json({ 
        message: error instanceof Error ? error.message : "Failed to delete user" 
      });
    }
  });

  app.patch("/api/users/:id/reminder-settings", deps.requireAuth, async (req, res) => {
    try {
      const userId = req.params.id;
      const currentUser = (req as any).user;
      
      if (currentUser.id !== userId && currentUser.role !== 'admin') {
        return res.status(403).json({ message: "You can only update your own reminder settings" });
      }
      
      const { receiveTimeReminders, receiveExpenseReminders } = req.body;
      
      const updates: any = {};
      if (typeof receiveTimeReminders === 'boolean') {
        updates.receiveTimeReminders = receiveTimeReminders;
      }
      if (typeof receiveExpenseReminders === 'boolean') {
        updates.receiveExpenseReminders = receiveExpenseReminders;
      }
      
      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ message: "At least one of receiveTimeReminders or receiveExpenseReminders must be provided as a boolean" });
      }
      
      const user = await storage.updateUser(userId, updates);
      res.json({ 
        receiveTimeReminders: user.receiveTimeReminders,
        receiveExpenseReminders: (user as any).receiveExpenseReminders ?? true
      });
    } catch (error) {
      console.error("Error updating reminder settings:", error);
      res.status(500).json({ message: "Failed to update reminder settings" });
    }
  });

  app.get("/api/users/:id/reminder-settings", deps.requireAuth, async (req, res) => {
    try {
      const userId = req.params.id;
      const currentUser = (req as any).user;
      
      if (currentUser.id !== userId && currentUser.role !== 'admin') {
        return res.status(403).json({ message: "You can only view your own reminder settings" });
      }
      
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      
      res.json({ 
        receiveTimeReminders: user.receiveTimeReminders,
        receiveExpenseReminders: (user as any).receiveExpenseReminders ?? true,
        calendarSuggestionsEnabled: user.calendarSuggestionsEnabled ?? true,
        calendarSuggestionsDaysBack: user.calendarSuggestionsDaysBack ?? 0,
      });
    } catch (error) {
      console.error("Error fetching reminder settings:", error);
      res.status(500).json({ message: "Failed to fetch reminder settings" });
    }
  });

  app.get("/api/users/:userId/active-engagements", deps.requireAuth, async (req, res) => {
    try {
      const engagements = await storage.getUserActiveEngagements(req.params.userId);
      res.json(engagements);
    } catch (error: any) {
      console.error("[ERROR] Failed to get user active engagements:", error);
      res.status(500).json({ message: "Failed to get user active engagements" });
    }
  });

  // ── Role Capabilities CRUD ──────────────────────────────────────────

  // GET /api/users/:id/role-capabilities — List a person's role capabilities
  app.get("/api/users/:id/role-capabilities", deps.requireAuth, async (req, res) => {
    try {
      const currentUser = (req as any).user;
      const tenantId = currentUser?.tenantId;
      const conditions: any[] = [eq(userRoleCapabilities.userId, req.params.id)];
      if (tenantId) {
        conditions.push(eq(userRoleCapabilities.tenantId, tenantId));
      }
      const capabilities = await db
        .select({
          id: userRoleCapabilities.id,
          tenantId: userRoleCapabilities.tenantId,
          userId: userRoleCapabilities.userId,
          roleId: userRoleCapabilities.roleId,
          proficiencyLevel: userRoleCapabilities.proficiencyLevel,
          customCostRate: userRoleCapabilities.customCostRate,
          customBillingRate: userRoleCapabilities.customBillingRate,
          notes: userRoleCapabilities.notes,
          createdAt: userRoleCapabilities.createdAt,
          roleName: roles.name,
          roleDefaultRackRate: roles.defaultRackRate,
          roleDefaultCostRate: roles.defaultCostRate,
        })
        .from(userRoleCapabilities)
        .leftJoin(roles, eq(userRoleCapabilities.roleId, roles.id))
        .where(and(...conditions));
      res.json(capabilities);
    } catch (error) {
      console.error("Error fetching role capabilities:", error);
      res.status(500).json({ message: "Failed to fetch role capabilities" });
    }
  });

  // POST /api/users/:id/role-capabilities — Add a role capability
  app.post("/api/users/:id/role-capabilities", deps.requireAuth, deps.requireRole(["admin", "pm"]), async (req, res) => {
    try {
      const currentUser = (req as any).user;
      const tenantId = currentUser?.tenantId;
      if (!tenantId) {
        return res.status(400).json({ message: "Tenant context required" });
      }

      const validatedData = insertUserRoleCapabilitySchema.parse({
        ...req.body,
        tenantId,
        userId: req.params.id,
      });

      const [tenantUser] = await db
        .select({ userId: tenantUsers.userId })
        .from(tenantUsers)
        .where(and(eq(tenantUsers.tenantId, tenantId), eq(tenantUsers.userId, req.params.id)))
        .limit(1);

      if (!tenantUser) {
        return res.status(404).json({ message: "User not found in tenant" });
      }

      const [role] = await db
        .select({ id: roles.id })
        .from(roles)
        .where(and(eq(roles.id, validatedData.roleId), eq(roles.tenantId, tenantId)))
        .limit(1);

      if (!role) {
        return res.status(400).json({ message: "Invalid role for tenant" });
      }
      const [capability] = await db.insert(userRoleCapabilities).values(validatedData).returning();
      res.status(201).json(capability);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid data", errors: error.errors });
      }
      if (error?.code === '23505') {
        return res.status(409).json({ message: "This user already has a capability mapping for this role" });
      }
      console.error("Error creating role capability:", error);
      res.status(500).json({ message: "Failed to create role capability" });
    }
  });

  // PATCH /api/users/:id/role-capabilities/:capId — Update proficiency or rates
  app.patch("/api/users/:id/role-capabilities/:capId", deps.requireAuth, deps.requireRole(["admin", "pm"]), async (req, res) => {
    try {
      const currentUser = (req as any).user;
      const tenantId = currentUser?.tenantId;
      const allowedFields = ['proficiencyLevel', 'customCostRate', 'customBillingRate', 'notes'];
      const safeBody: Record<string, any> = {};
      for (const [k, v] of Object.entries(req.body)) {
        if (allowedFields.includes(k)) {
          safeBody[k] = v === '' ? null : v;
        }
      }
      if (safeBody.proficiencyLevel && !['primary', 'secondary', 'learning'].includes(safeBody.proficiencyLevel)) {
        return res.status(400).json({ message: "proficiencyLevel must be primary, secondary, or learning" });
      }

      const conditions: any[] = [
        eq(userRoleCapabilities.id, req.params.capId),
        eq(userRoleCapabilities.userId, req.params.id),
      ];
      if (tenantId) {
        conditions.push(eq(userRoleCapabilities.tenantId, tenantId));
      }

      const [updated] = await db
        .update(userRoleCapabilities)
        .set(safeBody)
        .where(and(...conditions))
        .returning();

      if (!updated) {
        return res.status(404).json({ message: "Capability not found" });
      }
      res.json(updated);
    } catch (error) {
      console.error("Error updating role capability:", error);
      res.status(500).json({ message: "Failed to update role capability" });
    }
  });

  // DELETE /api/users/:id/role-capabilities/:capId — Remove a capability
  app.delete("/api/users/:id/role-capabilities/:capId", deps.requireAuth, deps.requireRole(["admin", "pm"]), async (req, res) => {
    try {
      const currentUser = (req as any).user;
      const tenantId = currentUser?.tenantId;
      const conditions: any[] = [
        eq(userRoleCapabilities.id, req.params.capId),
        eq(userRoleCapabilities.userId, req.params.id),
      ];
      if (tenantId) {
        conditions.push(eq(userRoleCapabilities.tenantId, tenantId));
      }
      const [deleted] = await db
        .delete(userRoleCapabilities)
        .where(and(...conditions))
        .returning();

      if (!deleted) {
        return res.status(404).json({ message: "Capability not found" });
      }
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting role capability:", error);
      res.status(500).json({ message: "Failed to delete role capability" });
    }
  });

  // GET /api/roles/:id/capable-users — Find all people who can fill a given role
  app.get("/api/roles/:id/capable-users", deps.requireAuth, deps.requireRole(["admin", "pm", "portfolio-manager", "executive"]), async (req, res) => {
    try {
      const currentUser = (req as any).user;
      const tenantId = currentUser?.tenantId;
      const conditions: any[] = [eq(userRoleCapabilities.roleId, req.params.id)];
      if (tenantId) {
        conditions.push(eq(userRoleCapabilities.tenantId, tenantId));
      }
      const capableUsers = await db
        .select({
          capabilityId: userRoleCapabilities.id,
          userId: userRoleCapabilities.userId,
          proficiencyLevel: userRoleCapabilities.proficiencyLevel,
          customCostRate: userRoleCapabilities.customCostRate,
          customBillingRate: userRoleCapabilities.customBillingRate,
          notes: userRoleCapabilities.notes,
          userName: users.name,
          userEmail: users.email,
          userTitle: users.title,
          isActive: users.isActive,
          isAssignable: users.isAssignable,
          isSalaried: users.isSalaried,
          defaultCostRate: users.defaultCostRate,
          defaultBillingRate: users.defaultBillingRate,
          weeklyCapacityHours: users.weeklyCapacityHours,
        })
        .from(userRoleCapabilities)
        .innerJoin(users, eq(userRoleCapabilities.userId, users.id))
        .where(and(...conditions));

      // Filter to active, assignable users only by default
      const includeInactive = req.query.includeInactive === 'true';
      const filtered = includeInactive
        ? capableUsers
        : capableUsers.filter(u => u.isActive && u.isAssignable);

      res.json(filtered);
    } catch (error) {
      console.error("Error fetching capable users:", error);
      res.status(500).json({ message: "Failed to fetch capable users for role" });
    }
  });

  app.get("/api/projects/:projectId/engagements/:userId/check-last-allocation", deps.requireAuth, async (req, res) => {
    try {
      const { projectId, userId } = req.params;
      const { excludeAllocationId } = req.query;
      
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

}
