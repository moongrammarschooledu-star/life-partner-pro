import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { ROLE_PERMISSIONS, SENSITIVE_PERMISSIONS, type AdminRole, type Permission } from "@/lib/permissions";
import type { SessionAdmin } from "@/lib/route-guard";
import { ApiError } from "@/lib/route-guard";

// STEP 17 §39/§41 — privilege-escalation prevention: an actor may only assign
// a role whose ENTIRE permission set the actor already holds. SUPER_ADMIN can
// always grant anything (it holds every permission by construction). Pure so
// it's exhaustively testable without touching the database.
export function canGrantRole(actorPermissions: Permission[], targetRole: AdminRole): boolean {
  if (actorPermissions.length === 0) return false;
  const held = new Set(actorPermissions);
  const targetPermissions = ROLE_PERMISSIONS[targetRole] ?? [];
  return targetPermissions.every((p) => held.has(p));
}

// Same rule, generalized to an arbitrary target permission set — used when
// assigning a CustomRole (spec §42) rather than one of the 13 system roles.
export function canGrantPermissions(actorPermissions: Permission[], targetPermissions: Permission[]): boolean {
  const held = new Set(actorPermissions);
  return targetPermissions.every((p) => held.has(p));
}

export function isSensitivePermission(permission: Permission): boolean {
  return (SENSITIVE_PERMISSIONS as string[]).includes(permission);
}

// Spec §52 — role/permission change audit events, actor + before/after +
// reason. Grant/removal is inferred by diffing the two permission sets so a
// single "role changed" call also produces the fine-grained sensitive-
// permission-specific events the spec asks for.
export async function auditRoleChange(params: {
  actorId: string;
  targetAdminId: string;
  previousRole: AdminRole | null;
  newRole: AdminRole | null;
  previousPermissions: Permission[];
  newPermissions: Permission[];
  reason: string;
}): Promise<void> {
  const { actorId, targetAdminId, previousRole, newRole, previousPermissions, newPermissions, reason } = params;
  const before = new Set(previousPermissions);
  const after = new Set(newPermissions);
  const granted = newPermissions.filter((p) => !before.has(p));
  const revoked = previousPermissions.filter((p) => !after.has(p));

  if (newRole && newRole !== previousRole) {
    // Initial assignment (no previous role, e.g. at admin creation) uses the new,
    // dedicated STEP 17 event; changing an EXISTING role reuses the event this
    // codebase has always used for it (ADMIN_USER_ROLE_CHANGED), not a duplicate.
    await writeAudit({
      action: previousRole ? "ADMIN_USER_ROLE_CHANGED" : "ADMIN_ROLE_ASSIGNED",
      adminId: actorId,
      meta: { targetAdminId, previousRole, newRole, reason },
    });
  } else if (previousRole && !newRole) {
    await writeAudit({ action: "ADMIN_ROLE_REMOVED", adminId: actorId, meta: { targetAdminId, previousRole, reason } });
  }

  const grantedSensitive = granted.filter(isSensitivePermission);
  const grantedOrdinary = granted.filter((p) => !isSensitivePermission(p));
  const revokedSensitive = revoked.filter(isSensitivePermission);
  const revokedOrdinary = revoked.filter((p) => !isSensitivePermission(p));

  if (grantedOrdinary.length) await writeAudit({ action: "ADMIN_PERMISSION_GRANTED", adminId: actorId, meta: { targetAdminId, permissions: grantedOrdinary, reason } });
  if (revokedOrdinary.length) await writeAudit({ action: "ADMIN_PERMISSION_REVOKED", adminId: actorId, meta: { targetAdminId, permissions: revokedOrdinary, reason } });
  if (grantedSensitive.length) await writeAudit({ action: "ADMIN_SENSITIVE_PERMISSION_GRANTED", adminId: actorId, meta: { targetAdminId, permissions: grantedSensitive, reason } });
  if (revokedSensitive.length) await writeAudit({ action: "ADMIN_SENSITIVE_PERMISSION_REVOKED", adminId: actorId, meta: { targetAdminId, permissions: revokedSensitive, reason } });
}

// Effective permissions for an arbitrary (role, customRoleId) pair without a
// DB round trip when there's no custom role — thin sync wrapper the async
// resolveEffectivePermissions() in effective-permissions.ts still owns the
// DB-backed path; this one is for the escalation check itself, which needs
// the ACTOR's current, already-known permission list (SessionAdmin.permissions),
// not a fresh resolve.
export async function assertCanGrantRole(actor: SessionAdmin, targetRole: AdminRole): Promise<void> {
  if (actor.role === "SUPER_ADMIN") return;
  if (!canGrantRole(actor.permissions, targetRole)) {
    throw new ApiError(403, "You cannot assign a role with permissions you do not hold yourself.");
  }
}

export async function assertCanGrantPermissions(actor: SessionAdmin, targetPermissions: Permission[]): Promise<void> {
  if (actor.role === "SUPER_ADMIN") return;
  if (!canGrantPermissions(actor.permissions, targetPermissions)) {
    throw new ApiError(403, "You cannot grant a permission you do not hold yourself.");
  }
}

// Convenience used by the admin-users route when changing an admin's role:
// resolves the target's CURRENT effective permissions (before the change) so
// auditRoleChange can compute an accurate grant/revoke diff.
export async function currentEffectivePermissions(adminId: string): Promise<{ role: AdminRole; permissions: Permission[] } | null> {
  const target = await prisma.adminUser.findUnique({ where: { id: adminId }, select: { role: true, customRoleId: true } });
  if (!target) return null;
  if (!target.customRoleId) return { role: target.role as AdminRole, permissions: ROLE_PERMISSIONS[target.role as AdminRole] ?? [] };
  const rows = await prisma.customRolePermission.findMany({ where: { customRoleId: target.customRoleId }, select: { permissionKey: true } });
  return { role: target.role as AdminRole, permissions: rows.map((r) => r.permissionKey as Permission) };
}
