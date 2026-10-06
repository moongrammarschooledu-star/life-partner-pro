import { prisma } from "@/lib/prisma";
import { resolveEffectivePermissions } from "@/lib/effective-permissions";
import type { Viewer } from "@/lib/analytics/access";
import type { AdminRole } from "@/lib/permissions";

// STEP 31 - an admin's CURRENT access, read from the database (role, custom role, department, active flag). Scheduled deliveries,
// alert recipients and dashboard shares are all re-checked against this at the moment they happen, so losing access (a role change,
// a deactivation) takes effect immediately and never needs the person to log in again.

export interface DbViewer extends Viewer {
  role: AdminRole;
  departmentId: string | null;
  active: boolean;
}

export async function loadViewer(adminId: string): Promise<DbViewer | null> {
  const a = await prisma.adminUser.findUnique({ where: { id: adminId }, select: { id: true, role: true, customRoleId: true, departmentId: true, active: true } });
  if (!a) return null;
  const permissions = await resolveEffectivePermissions({ role: a.role as AdminRole, customRoleId: a.customRoleId ?? null });
  return { id: a.id, role: a.role as AdminRole, departmentId: a.departmentId ?? null, active: a.active, permissions };
}
