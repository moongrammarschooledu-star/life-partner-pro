import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { prisma } from "@/lib/prisma";

// Used both for a voluntary password change and to satisfy the forced
// reset flow after an admin's password was reset by a Super Admin (spec §1).
export async function POST(req: Request) {
  try {
    const admin = await requireAdmin();
    const { currentPassword, newPassword } = (await req.json()) as { currentPassword?: string; newPassword?: string };
    if (!currentPassword || !newPassword) throw new ApiError(400, "Current and new password are required.");

    const record = await prisma.adminUser.findUnique({ where: { id: admin.id } });
    if (!record) throw new ApiError(401, "Unauthorized");

    const valid = await bcrypt.compare(currentPassword, record.passwordHash);
    if (!valid) throw new ApiError(403, "Current password is incorrect.");

    const settings = await prisma.appSettings.findUnique({ where: { id: 1 } });
    const minLength = settings?.passwordMinLength ?? 8;
    if (newPassword.length < minLength) throw new ApiError(400, `New password must be at least ${minLength} characters.`);

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await prisma.adminUser.update({ where: { id: admin.id }, data: { passwordHash, mustResetPassword: false } });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
