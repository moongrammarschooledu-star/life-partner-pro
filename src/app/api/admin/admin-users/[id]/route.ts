import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { writeAudit } from "@/lib/audit";
import { requireReason, requireReauth } from "@/lib/ops/admin-route";
import { ADMIN_ROLES, hasBroadRecordAccess, ROLE_PERMISSIONS, type AdminRole, type Permission } from "@/lib/permissions";
import { assertCanGrantRole, assertCanGrantPermissions, auditRoleChange, currentEffectivePermissions } from "@/lib/role-management";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("admin:manage");
    const { id } = await params;
    const { role, active, departmentId, customRoleId, twoFactorEnabled, reason, stepUpToken } = (await req.json()) as {
      role?: AdminRole;
      active?: boolean;
      departmentId?: string | null;
      customRoleId?: string | null;
      twoFactorEnabled?: boolean;
      reason?: unknown;
      stepUpToken?: string;
    };

    if (id === admin.id && active === false) {
      throw new ApiError(400, "You cannot deactivate your own account");
    }
    if (active === false) {
      // Deactivation goes through the dedicated endpoint (spec §21) so open
      // assignments get reassigned/queued first and a password step-up is
      // required (spec §16) — this plain toggle only ever reactivates.
      throw new ApiError(400, "Use the Deactivate action to disable an account — it handles reassigning open work first.");
    }

    const roleOrCustomChanging = (role !== undefined) || (customRoleId !== undefined);
    let before: { role: AdminRole; permissions: Permission[] } | null = null;
    let reasonText = "";
    if (roleOrCustomChanging) {
      // STEP 17 §41 — a reason is required for every privileged (role/permission)
      // change, and self-role-change is never allowed (prevents an admin from
      // granting themselves more authority).
      if (id === admin.id) throw new ApiError(400, "You cannot change your own role.");
      reasonText = requireReason(reason);
      before = await currentEffectivePermissions(id);
      if (!before) throw new ApiError(404, "Admin not found.");

      if (role !== undefined) {
        if (!ADMIN_ROLES.includes(role)) throw new ApiError(400, "Invalid role");
        await assertCanGrantRole(admin, role);
        // Elevated roles (Super Admin or any manager-tier role) additionally
        // require a fresh password re-confirmation — spec §41 "sensitive roles
        // require elevated authorization".
        if (role === "SUPER_ADMIN" || hasBroadRecordAccess(role)) {
          requireReauth(admin, stepUpToken, "change this admin's role");
        }
      }
      if (customRoleId) {
        const customRole = await prisma.customRole.findUnique({ where: { id: customRoleId }, include: { permissions: { select: { permissionKey: true } } } });
        if (!customRole) throw new ApiError(400, "Custom role not found.");
        await assertCanGrantPermissions(admin, customRole.permissions.map((p) => p.permissionKey as Permission));
        requireReauth(admin, stepUpToken, "change this admin's custom role");
      }
    }

    const updated = await prisma.adminUser.update({
      where: { id },
      data: {
        ...(role ? { role } : {}),
        ...(typeof active === "boolean" ? { active } : {}),
        ...(departmentId !== undefined ? { departmentId: departmentId || null } : {}),
        ...(customRoleId !== undefined ? { customRoleId: customRoleId || null } : {}),
        ...(typeof twoFactorEnabled === "boolean" ? { twoFactorEnabled } : {}),
      },
      select: { id: true, name: true, email: true, role: true, active: true, twoFactorEnabled: true, customRoleId: true },
    });

    if (roleOrCustomChanging && before) {
      const after = customRoleId
        ? (await prisma.customRolePermission.findMany({ where: { customRoleId: updated.customRoleId ?? "" }, select: { permissionKey: true } })).map((p) => p.permissionKey as Permission)
        : ROLE_PERMISSIONS[updated.role as AdminRole] ?? [];
      await auditRoleChange({
        actorId: admin.id,
        targetAdminId: id,
        previousRole: before.role,
        newRole: role ?? before.role,
        previousPermissions: before.permissions,
        newPermissions: after,
        reason: reasonText,
      });
    }
    if (typeof active === "boolean") {
      await writeAudit({ action: "ADMIN_USER_STATUS_CHANGED", adminId: admin.id, meta: { targetAdminId: id, active } });
    }
    if (typeof twoFactorEnabled === "boolean") {
      await writeAudit({ action: twoFactorEnabled ? "TWO_FACTOR_ENABLED" : "TWO_FACTOR_DISABLED", adminId: admin.id, meta: { targetAdminId: id } });
    }

    return NextResponse.json(updated);
  } catch (error) {
    return handleApiError(error);
  }
}
