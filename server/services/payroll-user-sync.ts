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
 * Reconcile a user's payroll enrollment.
 *
 * - When `payrollEmployeeType` is set and no active linked employee exists,
 *   create one (or revive a terminated one by reusing it).
 * - When `payrollEmployeeType` is null and a linked active employee exists,
 *   mark it terminated (status='terminated', terminationDate=today). We do not
 *   soft-delete — that would hide the employee from payroll history.
 * - When the type changes (w2 ↔ 1099), update the linked employee in place.
 */
export async function syncUserPayrollEnrollment(
  user: User,
  actorUserId: string | undefined,
): Promise<{ linkedEmployeeId: string | null }> {
  const tenantId = user.primaryTenantId;
  if (!tenantId) return { linkedEmployeeId: null };

  const type = (user.payrollEmployeeType as PayrollEmployeeType | null) || null;
  const existing = await findLinkedEmployee(tenantId, user.id);

  if (type) {
    if (!user.email) {
      throw new Error('Cannot enroll user in payroll without an email address');
    }
    const { firstName, lastName } = nameParts(user);
    if (existing) {
      if (existing.employeeType !== type) {
        const updated = await payrollStorage.updateEmployee(tenantId, existing.id, {
          employeeType: type,
          email: user.email,
          firstName, lastName,
        });
        await payrollStorage.appendAudit({
          tenantId, actorUserId,
          action: 'employee.type_change', entityType: 'employee', entityId: updated.id,
          details: { from: existing.employeeType, to: type, viaUserSync: true, userId: user.id },
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
