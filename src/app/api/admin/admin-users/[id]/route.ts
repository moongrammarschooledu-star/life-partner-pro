import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { writeAudit } from "@/lib/audit";

const VALID_ROLES = ["SUPER_ADMIN", "ADMIN", "STAFF", "VIEWER"];

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("admin:manage");
    const { id } = await params;
    const { role, active } = await req.json();

    if (id === admin.id && active === false) {
      throw new ApiError(400, "You cannot deactivate your own account");
    }
    if (role && !VALID_ROLES.includes(role)) throw new ApiError(400, "Invalid role");

    const updated = await prisma.adminUser.update({
      where: { id },
      data: {
        ...(role ? { role } : {}),
        ...(typeof active === "boolean" ? { active } : {}),
      },
      select: { id: true, name: true, email: true, role: true, active: true },
    });

    if (role) {
      await writeAudit({ action: "ADMIN_USER_ROLE_CHANGED", adminId: admin.id, meta: { targetAdminId: id, role } });
    }
    if (typeof active === "boolean") {
      await writeAudit({ action: "ADMIN_USER_STATUS_CHANGED", adminId: admin.id, meta: { targetAdminId: id, active } });
    }

    return NextResponse.json(updated);
  } catch (error) {
    return handleApiError(error);
  }
}
