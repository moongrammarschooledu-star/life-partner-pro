import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { writeAudit } from "@/lib/audit";
import { assertCanGrantPermissions } from "@/lib/role-management";
import type { Permission } from "@/lib/permissions";
import { ACCESS_LEVELS, type AccessLevel } from "@/lib/access-level";
import type { AssignmentResourceType } from "@prisma/client";

const RESOURCE_TYPES: AssignmentResourceType[] = ["PROPOSAL", "VERIFICATION", "SECURITY_FLAG", "FOLLOW_UP", "PROFILE", "CASE"];

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("admin:manage");
    const { id } = await params;
    const { name, description, active, permissions, allowedRecordTypes, defaultAccessLevel } = (await req.json()) as {
      name?: string;
      description?: string;
      active?: boolean;
      permissions?: string[];
      allowedRecordTypes?: AssignmentResourceType[];
      defaultAccessLevel?: AccessLevel | null;
    };

    const existing = await prisma.customRole.findUnique({ where: { id } });
    if (!existing) throw new ApiError(404, "Custom role not found");

    if (active === false && !admin.permissions.includes("roles:disable")) throw new ApiError(403, "You do not have permission to disable roles.");

    const permissionsChanged = Array.isArray(permissions);
    if (permissionsChanged) {
      if (!admin.permissions.includes("roles:edit")) throw new ApiError(403, "You do not have permission to edit role permissions.");
      // STEP 17 §39/§41 — a role can never be edited to hold permissions the
      // editor does not hold themselves.
      await assertCanGrantPermissions(admin, permissions as Permission[]);
    }
    if (allowedRecordTypes?.some((t) => !RESOURCE_TYPES.includes(t))) throw new ApiError(400, "Invalid record type in allowedRecordTypes.");
    if (defaultAccessLevel && !ACCESS_LEVELS.includes(defaultAccessLevel)) throw new ApiError(400, "Invalid defaultAccessLevel.");

    const role = await prisma.$transaction(async (tx) => {
      if (permissionsChanged) {
        await tx.customRolePermission.deleteMany({ where: { customRoleId: id } });
        await tx.customRolePermission.createMany({ data: permissions!.map((key) => ({ customRoleId: id, permissionKey: key })) });
      }
      return tx.customRole.update({
        where: { id },
        data: {
          ...(name !== undefined ? { name: name.trim() } : {}),
          ...(description !== undefined ? { description: description || null } : {}),
          ...(active !== undefined ? { active } : {}),
          ...(allowedRecordTypes !== undefined ? { allowedRecordTypes } : {}),
          ...(defaultAccessLevel !== undefined ? { defaultAccessLevel } : {}),
        },
      });
    });

    await writeAudit({
      action: permissionsChanged ? "CUSTOM_ROLE_PERMISSIONS_CHANGED" : "CUSTOM_ROLE_UPDATED",
      adminId: admin.id,
      meta: { roleId: id },
    });

    return NextResponse.json(role);
  } catch (error) {
    return handleApiError(error);
  }
}
