import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";

// Spec §14 — never exposes unnecessary personal info beyond IP/UA already
// captured for security purposes; an admin sees their own history, a Super
// Admin can view any admin's.
export async function GET(req: Request) {
  try {
    const admin = await requireAdmin();
    const { searchParams } = new URL(req.url);
    const targetAdminId = searchParams.get("adminId");

    let adminId = admin.id;
    if (targetAdminId && targetAdminId !== admin.id) {
      if (!admin.permissions.includes("admin:manage")) throw new ApiError(403, "Only Super Admin can view another admin's login history.");
      adminId = targetAdminId;
    }

    const items = await prisma.adminLoginHistory.findMany({
      where: { adminId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    return NextResponse.json({ items });
  } catch (error) {
    return handleApiError(error);
  }
}
