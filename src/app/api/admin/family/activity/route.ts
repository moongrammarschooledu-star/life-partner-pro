import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import type { AuditAction } from "@prisma/client";

// AuditAction is a Postgres enum — Prisma has no startsWith filter for enum
// columns, so the FAMILY_* subset is enumerated explicitly here.
const FAMILY_AUDIT_ACTIONS: AuditAction[] = [
  "FAMILY_INVITATION_CREATED",
  "FAMILY_INVITATION_RESENT",
  "FAMILY_INVITATION_ACCEPTED",
  "FAMILY_INVITATION_DECLINED",
  "FAMILY_INVITATION_REVOKED",
  "FAMILY_MEMBER_ADDED",
  "FAMILY_MEMBER_LOGIN",
  "FAMILY_PERMISSION_GRANTED",
  "FAMILY_PERMISSION_CHANGED",
  "FAMILY_PERMISSION_REVOKED",
  "FAMILY_ACCESS_REQUESTED",
  "FAMILY_ACCESS_APPROVED",
  "FAMILY_ACCESS_REJECTED",
  "FAMILY_PROPOSAL_VIEWED",
  "FAMILY_PROPOSAL_SHARED",
  "FAMILY_RESPONSE_SUBMITTED",
  "FAMILY_DECISION_CREATED",
  "FAMILY_DECISION_CONFIRMED",
  "FAMILY_CONTACT_REQUESTED",
  "FAMILY_ACCESS_EXPIRED",
  "FAMILY_MEMBER_REMOVED",
  "FAMILY_MEMBER_SUSPENDED",
  "FAMILY_COMMENT_ADDED",
  "FAMILY_MEETING_ACTION",
  "FAMILY_SESSION_REVOKED",
  "FAMILY_LOGIN_FAILED",
];

export async function GET(req: Request) {
  try {
    await requireAdmin("family:manage");
    const profileId = new URL(req.url).searchParams.get("profileId") ?? undefined;

    const items = await prisma.auditLog.findMany({
      where: {
        action: { in: FAMILY_AUDIT_ACTIONS },
        ...(profileId ? { targetProfileId: profileId } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: { action: true, targetProfileId: true, actorFamilyMemberId: true, adminId: true, createdAt: true, meta: true },
    });

    return NextResponse.json({ items });
  } catch (error) {
    return handleApiError(error);
  }
}
