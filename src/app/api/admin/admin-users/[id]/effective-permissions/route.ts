import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { ROLE_PERMISSIONS, SENSITIVE_PERMISSIONS, hasBroadRecordAccess, type AdminRole, type Permission } from "@/lib/permissions";

// STEP 17 §43 — Admin User → Security → Effective Permissions. Shows exactly
// what this admin can do today: their resolved permission list (role or
// custom-role override — the same resolution requireAdmin() itself uses),
// which of those are sensitive permissions, and their current record
// assignments. Read-only; this never changes what the admin can do.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin("admin:manage");
    const { id } = await params;

    const target = await prisma.adminUser.findUnique({
      where: { id },
      select: { id: true, name: true, email: true, role: true, active: true, customRole: { select: { id: true, name: true } } },
    });
    if (!target) throw new ApiError(404, "Admin not found.");

    const permissions: Permission[] = target.customRole
      ? (await prisma.customRolePermission.findMany({ where: { customRoleId: target.customRole.id }, select: { permissionKey: true } })).map((p) => p.permissionKey as Permission)
      : ROLE_PERMISSIONS[target.role as AdminRole] ?? [];

    const sensitive = permissions.filter((p) => (SENSITIVE_PERMISSIONS as string[]).includes(p));
    const scoped = !hasBroadRecordAccess(target.role as AdminRole);

    const [profileAssignments, followUpAssignments, caseAssignments, proposals, verifications, securityFlags] = await Promise.all([
      prisma.adminAssignment.findMany({ where: { resourceType: "PROFILE", adminId: id, status: { not: "REASSIGNED" } }, select: { resourceId: true, accessLevel: true, expiresAt: true } }),
      prisma.adminAssignment.findMany({ where: { resourceType: "FOLLOW_UP", adminId: id, status: { not: "REASSIGNED" } }, select: { resourceId: true, accessLevel: true, expiresAt: true } }),
      prisma.adminAssignment.findMany({ where: { resourceType: "CASE", adminId: id, status: { not: "REASSIGNED" } }, select: { resourceId: true, accessLevel: true, expiresAt: true } }),
      prisma.proposal.count({ where: { assignedToId: id } }),
      prisma.profileVerification.count({ where: { assignedToId: id } }),
      prisma.securityFlag.count({ where: { assignedToId: id } }),
    ]);
    const now = new Date();
    const active = (rows: Array<{ expiresAt: Date | null }>) => rows.filter((r) => !r.expiresAt || r.expiresAt > now).length;

    return NextResponse.json({
      admin: { id: target.id, name: target.name, email: target.email, role: target.role, active: target.active, customRole: target.customRole },
      recordAccessIsAssignmentScoped: scoped,
      permissions,
      sensitivePermissions: sensitive,
      recordAssignments: {
        profiles: active(profileAssignments),
        followUps: active(followUpAssignments),
        cases: active(caseAssignments),
        proposals,
        verifications,
        securityFlags,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
