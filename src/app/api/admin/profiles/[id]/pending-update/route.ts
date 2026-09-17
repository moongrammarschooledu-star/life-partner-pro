import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { writeAudit } from "@/lib/audit";
import { setVerificationStatus } from "@/lib/verification/status";
import { notifyProfileUpdateDecision } from "@/lib/notifications/events";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("profile:edit");
    const { id } = await params;
    const { decision } = await req.json(); // "approve" | "reject"

    const pending = await prisma.pendingUpdate.findUnique({ where: { profileId: id } });
    if (!pending) throw new ApiError(404, "No pending update for this profile");

    if (decision === "approve") {
      // STEP 13 spec §23 — extended beyond contact/preference to cover
      // name/DOB (personal), education, profession, and family corrections.
      const payload = JSON.parse(pending.payload) as {
        contact?: Record<string, unknown>;
        preference?: Record<string, unknown>;
        personal?: { fullName?: string; dateOfBirth?: string };
        education?: Record<string, unknown>;
        profession?: Record<string, unknown>;
        family?: Record<string, unknown>;
      };

      await prisma.$transaction([
        ...(payload.contact ? [prisma.contactInfo.update({ where: { profileId: id }, data: payload.contact })] : []),
        ...(payload.preference ? [prisma.partnerPreference.update({ where: { profileId: id }, data: payload.preference })] : []),
        ...(payload.personal
          ? [
              prisma.profile.update({
                where: { id },
                data: {
                  ...(payload.personal.fullName ? { fullName: payload.personal.fullName } : {}),
                  ...(payload.personal.dateOfBirth ? { dateOfBirth: new Date(payload.personal.dateOfBirth) } : {}),
                },
              }),
            ]
          : []),
        ...(payload.education ? [prisma.educationInfo.update({ where: { profileId: id }, data: payload.education })] : []),
        ...(payload.profession ? [prisma.professionInfo.update({ where: { profileId: id }, data: payload.profession })] : []),
        ...(payload.family ? [prisma.familyInfo.update({ where: { profileId: id }, data: payload.family })] : []),
        prisma.pendingUpdate.delete({ where: { profileId: id } }),
      ]);

      await writeAudit({ action: "UPDATE_REQUEST_APPROVED", adminId: admin.id, targetProfileId: id });
      await notifyProfileUpdateDecision(id, true);

      // Contact/identity changes are the field groups STEP 8 §19's
      // change-monitoring rule watches — sensitive enough to warrant
      // re-verification, per STEP 13 spec §23's "sensitive changes may
      // trigger verification/admin review."
      if (payload.contact || payload.personal) {
        const settings = await prisma.appSettings.findUnique({ where: { id: 1 } });
        if (settings?.autoReVerificationOnKeyFieldChange ?? true) {
          await setVerificationStatus(id, "RE_VERIFICATION_REQUIRED", {
            adminId: admin.id,
            reVerificationReason: payload.contact ? "Contact information changed via an approved update request." : "Identity information changed via an approved update request.",
          });
        }
      }
    } else {
      await prisma.pendingUpdate.delete({ where: { profileId: id } });
      await writeAudit({ action: "UPDATE_REQUEST_REJECTED", adminId: admin.id, targetProfileId: id });
      await notifyProfileUpdateDecision(id, false);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
