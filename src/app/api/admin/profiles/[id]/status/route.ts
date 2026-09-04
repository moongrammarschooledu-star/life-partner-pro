import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { writeAudit } from "@/lib/audit";
import type { ProfileStatus } from "@prisma/client";

const VALID_STATUSES: ProfileStatus[] = [
  "NEW", "UNDER_REVIEW", "VERIFIED", "ACTIVE", "MATCHING", "PROPOSAL_SENT",
  "WAITING_FOR_RESPONSE", "INTERESTED", "NOT_INTERESTED", "MEETING_ARRANGED",
  "FINALIZED", "MARRIED", "REJECTED", "ARCHIVED",
];

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("profile:status");
    const { id } = await params;
    const { status } = await req.json();

    if (!VALID_STATUSES.includes(status)) throw new ApiError(400, "Invalid status");

    if (status === "ACTIVE") {
      const consent = await prisma.consentRecord.findUnique({ where: { profileId: id } });
      const hasFullConsent =
        !!consent?.privacyConsent && !!consent?.matchmakingConsent && !!consent?.contactSharingConsent && !!consent?.termsAccepted;
      if (!hasFullConsent) {
        throw new ApiError(400, "This profile cannot be activated until privacy, matchmaking, contact-sharing, and terms consent are all recorded.");
      }
    }

    const profile = await prisma.profile.update({
      where: { id },
      data: { status, verified: status === "VERIFIED" || status === "ACTIVE" ? true : undefined },
    });

    await writeAudit({ action: "PROFILE_STATUS_CHANGED", adminId: admin.id, targetProfileId: id, meta: { status } });

    return NextResponse.json({ status: profile.status });
  } catch (error) {
    return handleApiError(error);
  }
}
