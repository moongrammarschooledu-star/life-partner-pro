import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { writeAudit } from "@/lib/audit";
import { setVerificationStatus } from "@/lib/verification/status";

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

      // Contact info changing is the one field group STEP 8 §19's
      // change-monitoring rule can actually observe today — nothing else
      // is currently editable post-registration by anyone.
      if (payload.contact) {
        const settings = await prisma.appSettings.findUnique({ where: { id: 1 } });
        if (settings?.autoReVerificationOnKeyFieldChange ?? true) {
          await setVerificationStatus(id, "RE_VERIFICATION_REQUIRED", {
            adminId: admin.id,
            reVerificationReason: "Contact information changed via an approved update request.",
          });
        }
      }
    } else {
      await prisma.pendingUpdate.delete({ where: { profileId: id } });
      await writeAudit({ action: "UPDATE_REQUEST_REJECTED", adminId: admin.id, targetProfileId: id });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
