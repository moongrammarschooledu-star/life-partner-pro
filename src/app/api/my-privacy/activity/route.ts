import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApplicantProfileId } from "@/lib/require-applicant";
import type { AuditAction } from "@prisma/client";

// Spec §9 "My Activity" tab — reuses AuditLog.targetProfileId (already an
// FK from Steps 1-12) filtered to user-safe action types, plus the new
// PrivacyAccessLog. Never surfaces internal/staff-only actions (e.g.
// staff-conduct case handling) to the user.
const USER_SAFE_ACTIONS: AuditAction[] = [
  "CONTACT_VIEWED",
  "CONTACT_SHARED",
  "CONTACT_SHARE_REVOKED",
  "PROPOSAL_CREATED",
  "PROPOSAL_STATUS_CHANGED",
  "PROFILE_VERIFIED",
  "PROFILE_STATUS_CHANGED",
  "CONSENT_GRANTED",
  "CONSENT_REVOKED",
  "PHOTO_VIEWED",
  "PROFILE_SESSION_REVOKED",
];

export async function GET() {
  const profileId = await requireApplicantProfileId();
  if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const [auditEvents, accessEvents] = await Promise.all([
    prisma.auditLog.findMany({
      where: { targetProfileId: profileId, action: { in: USER_SAFE_ACTIONS } },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { action: true, createdAt: true },
    }),
    prisma.privacyAccessLog.findMany({
      where: { targetProfileId: profileId },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { action: true, dataCategory: true, createdAt: true },
    }),
  ]);

  return NextResponse.json({ auditEvents, accessEvents });
}
