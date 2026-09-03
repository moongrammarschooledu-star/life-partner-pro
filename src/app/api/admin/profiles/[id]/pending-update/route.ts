import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { writeAudit } from "@/lib/audit";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("profile:edit");
    const { id } = await params;
    const { decision } = await req.json(); // "approve" | "reject"

    const pending = await prisma.pendingUpdate.findUnique({ where: { profileId: id } });
    if (!pending) throw new ApiError(404, "No pending update for this profile");

    if (decision === "approve") {
      const payload = JSON.parse(pending.payload) as { contact?: Record<string, unknown>; preference?: Record<string, unknown> };

      await prisma.$transaction([
        ...(payload.contact
          ? [prisma.contactInfo.update({ where: { profileId: id }, data: payload.contact })]
          : []),
        ...(payload.preference
          ? [prisma.partnerPreference.update({ where: { profileId: id }, data: payload.preference })]
          : []),
        prisma.pendingUpdate.delete({ where: { profileId: id } }),
      ]);

      await writeAudit({ action: "UPDATE_REQUEST_APPROVED", adminId: admin.id, targetProfileId: id });
    } else {
      await prisma.pendingUpdate.delete({ where: { profileId: id } });
      await writeAudit({ action: "UPDATE_REQUEST_REJECTED", adminId: admin.id, targetProfileId: id });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
