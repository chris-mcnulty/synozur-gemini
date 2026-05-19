/**
 * Provisions / unprovisions a payroll_employees row from an internal user.
 *
 * Invariant: at most one non-terminated payroll_employees row per (tenant, userId).
 * Called from server/routes/users.ts on POST and PATCH.
 *
 * Provisioning is best-effort: if the user lacks an email or tenant, sync is
 * skipped silently — the user record is the source of truth and payroll
 * enrollment is a separate concern. Errors are surfaced to the caller so the
 * admin sees them at the user-edit boundary, not buried in logs.
 */

import { db } from "../db";
import { and, eq, isNull } from "drizzle-orm";
import { payrollEmployees, type User } from "@shared/schema";
import { payrollStorage } from "../storage/payroll";

export type PayrollEmployeeType = 'w2' | '1099';

function nameParts(user: Pick<User, 'firstName' | 'lastName' | 'name'>): { firstName: string; lastName: string } {
  const first = (user.firstName || '').trim();
  const last = (user.lastName || '').trim();
  if (first || last) return { firstName: first || user.name.split(' ')[0] || 'Unknown', lastName: last || user.name.split(' ').slice(1).join(' ') || '-' };
  const parts = (user.name || '').trim().split(/\s+/);
  return { firstName: parts[0] || 'Unknown', lastName: parts.slice(1).join(' ') || '-' };
}

export async function findLinkedEmployee(tenantId: string, userId: string) {
  const [row] = await db.select().from(payrollEmployees)
    .where(and(
      eq(payrollEmployees.tenantId, tenantId),
      eq(payrollEmployees.userId, userId),
      isNull(payrollEmployees.deletedAt),
    ));
  return row;
}

/**
 * Reconcile a user's payroll enrollment within a SPECIFIC tenant.
 *
 * - When `payrollEmployeeType` is set and no active linked employee exists,
 *   create one (or rehire a previously-terminated one by clearing the
 *   termination date and restoring status='onboarding').
 * - When `payrollEmployeeType` is null and a linked active employee exists,
 *   mark it terminated (status='terminated', terminationDate=today). We do
 *   not soft-delete — that would hide the employee from payroll history.
 * - When the type changes (w2 ↔ 1099), update the linked employee in place.
 *
 * Tenant resolution: the caller MUST pass the request's tenant context
 * (typically `currentUser.activeTenantId || currentUser.tenantId`). The
 * user's `primaryTenantId` is only used as a fallback when the caller
 * doesn't have a tenant on the request — multi-tenant users could
 * otherwise mutate the wrong tenant's payroll record.
 */
export async function syncUserPayrollEnrollment(
  user: User,
  actorUserId: string | undefined,
  tenantIdFromRequest?: string,
): Promise<{ linkedEmployeeId: string | null }> {
  const tenantId = tenantIdFromRequest || user.primaryTenantId;
  if (!tenantId) return { linkedEmployeeId: null };

  const type = (user.payrollEmployeeType as PayrollEmployeeType | null) || null;
  const existing = await findLinkedEmployee(tenantId, user.id);

  if (type) {
    if (!user.email) {
      throw new Error('Cannot enroll user in payroll without an email address');
    }
    const { firstName, lastName } = nameParts(user);
    if (existing) {
      // Build a patch so we only write what's actually changing.
      const patch: Record<string, any> = {};
      if (existing.employeeType !== type) patch.employeeType = type;
      // Rehire path: a previously-terminated employee re-enrolls.
      if (existing.status === 'terminated') {
        patch.status = 'onboarding';
        patch.terminationDate = null;
      }
      if (existing.email !== user.email) patch.email = user.email;
      if (existing.firstName !== firstName) patch.firstName = firstName;
      if (existing.lastName !== lastName) patch.lastName = lastName;
      if (Object.keys(patch).length > 0) {
        const updated = await payrollStorage.updateEmployee(tenantId, existing.id, patch as any);
        await payrollStorage.appendAudit({
          tenantId, actorUserId,
          action: patch.status === 'onboarding' ? 'employee.rehire' : 'employee.update',
          entityType: 'employee', entityId: updated.id,
          details: { patch, viaUserSync: true, userId: user.id },
        });
      }
      return { linkedEmployeeId: existing.id };
    }
    const created = await payrollStorage.createEmployee({
      tenantId,
      userId: user.id,
      email: user.email,
      firstName, lastName,
      employeeType: type,
      status: 'onboarding',
    } as any);
    await payrollStorage.appendAudit({
      tenantId, actorUserId,
      action: 'employee.auto_provisioned', entityType: 'employee', entityId: created.id,
      details: { userId: user.id, employeeType: type },
    });
    return { linkedEmployeeId: created.id };
  }

  if (existing && existing.status !== 'terminated') {
    const today = new Date().toISOString().slice(0, 10);
    await payrollStorage.updateEmployee(tenantId, existing.id, {
      status: 'terminated',
      terminationDate: today,
    } as any);
    await payrollStorage.appendAudit({
      tenantId, actorUserId,
      action: 'employee.terminate', entityType: 'employee', entityId: existing.id,
      details: { reason: 'user_unenrolled', userId: user.id },
    });
  }
  return { linkedEmployeeId: existing?.id ?? null };
}
