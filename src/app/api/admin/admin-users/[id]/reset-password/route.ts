import { NextResponse } from "next/server";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { writeAudit } from "@/lib/audit";

// Spec §1's "reset access" — generates a new temporary password and forces
// a reset on the account's next successful login.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("admin:manage");
    const { id } = await params;

    const target = await prisma.adminUser.findUnique({ where: { id } });
    if (!target) throw new ApiError(404, "Admin not found");

    const tempPassword = crypto.randomBytes(9).toString("base64url");
    const passwordHash = await bcrypt.hash(tempPassword, 12);

    await prisma.adminUser.update({ where: { id }, data: { passwordHash, mustResetPassword: true } });
    await writeAudit({ action: "ADMIN_USER_PASSWORD_RESET", adminId: admin.id, meta: { targetAdminId: id } });

    return NextResponse.json({ tempPassword });
  } catch (error) {
    return handleApiError(error);
  }
}
