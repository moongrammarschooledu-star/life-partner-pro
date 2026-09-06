import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";

// Spec §13 — an admin sees their own sessions; a Super Admin can view (and
// revoke) any admin's.
export async function GET(req: Request) {
  try {
    const admin = await requireAdmin();
    const { searchParams } = new URL(req.url);
    const targetAdminId = searchParams.get("adminId");

    let adminId = admin.id;
    if (targetAdminId && targetAdminId !== admin.id) {
      if (!admin.permissions.includes("admin:manage")) throw new ApiError(403, "Only Super Admin can view another admin's sessions.");
      adminId = targetAdminId;
    }

    const sessions = await prisma.adminSession.findMany({
      where: { adminId, expiresAt: { gt: new Date() } },
      orderBy: { lastActiveAt: "desc" },
    });

    return NextResponse.json({
      items: sessions.map((s) => ({
        id: s.id,
        deviceInfo: s.deviceInfo,
        ipAddress: s.ipAddress,
        lastActiveAt: s.lastActiveAt,
        createdAt: s.createdAt,
        revoked: !!s.revokedAt,
        isCurrent: s.id === admin.sid,
      })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
