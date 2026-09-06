import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { writeAudit } from "@/lib/audit";

const VALID_ROLES = ["SUPER_ADMIN", "ADMIN", "STAFF", "VIEWER"];

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("admin:manage");
    const { id } = await params;
    const { role, active, departmentId, customRoleId, twoFactorEnabled } = await req.json();

    if (id === admin.id && active === false) {
      throw new ApiError(400, "You cannot deactivate your own account");
    }
    if (active === false) {
      // Deactivation goes through the dedicated endpoint (spec §21) so open
      // assignments get reassigned/queued first and a password step-up is
      // required (spec §16) — this plain toggle only ever reactivates.
      throw new ApiError(400, "Use the Deactivate action to disable an account — it handles reassigning open work first.");
    }
    if (role && !VALID_ROLES.includes(role)) throw new ApiError(400, "Invalid role");

    const updated = await prisma.adminUser.update({
      where: { id },
      data: {
        ...(role ? { role } : {}),
        ...(typeof active === "boolean" ? { active } : {}),
        ...(departmentId !== undefined ? { departmentId: departmentId || null } : {}),
        ...(customRoleId !== undefined ? { customRoleId: customRoleId || null } : {}),
        ...(typeof twoFactorEnabled === "boolean" ? { twoFactorEnabled } : {}),
      },
      select: { id: true, name: true, email: true, role: true, active: true, twoFactorEnabled: true },
    });

    if (role) {
      await writeAudit({ action: "ADMIN_USER_ROLE_CHANGED", adminId: admin.id, meta: { targetAdminId: id, role } });
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
