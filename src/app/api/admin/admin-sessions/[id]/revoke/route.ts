import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { writeAudit } from "@/lib/audit";

// Spec §13 — an admin can revoke their own sessions; a Super Admin can
// revoke another admin's. Takes effect on that session's next API call
// (see route-guard.ts's requireAdmin) — not an instant cross-tab kill.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin();
    const { id } = await params;

    const target = await prisma.adminSession.findUnique({ where: { id } });
    if (!target) throw new ApiError(404, "Session not found");
    if (target.adminId !== admin.id && !admin.permissions.includes("admin:manage")) {
      throw new ApiError(403, "You can only revoke your own sessions.");
    }

    await prisma.adminSession.update({ where: { id }, data: { revokedAt: new Date(), revokedById: admin.id } });
    await writeAudit({ action: "ADMIN_SESSION_REVOKED", adminId: admin.id, meta: { sessionId: id, targetAdminId: target.adminId } });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
