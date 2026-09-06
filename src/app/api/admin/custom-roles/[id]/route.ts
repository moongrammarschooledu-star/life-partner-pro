import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { writeAudit } from "@/lib/audit";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("admin:manage");
    const { id } = await params;
    const { name, description, active, permissions } = (await req.json()) as {
      name?: string;
      description?: string;
      active?: boolean;
      permissions?: string[];
    };

    const existing = await prisma.customRole.findUnique({ where: { id } });
    if (!existing) throw new ApiError(404, "Custom role not found");

    const permissionsChanged = Array.isArray(permissions);

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
