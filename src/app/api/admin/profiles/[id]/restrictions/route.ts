import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { applyRestriction, liftRestriction } from "@/lib/profile-restrictions";
import { notifyProfileRestricted } from "@/lib/notifications/events";
import { enforceApprovalGate, markApprovalExecuted } from "@/lib/approvals/gate";
import type { RestrictionType } from "@prisma/client";

// STEP 24 — every enforced restriction type is now manually applicable (previously only 5 of 9 were, which
// left the STEP 23 types unreachable from the UI). The four broad risk-era types must be time-boxed here;
// an open-ended one is only possible through an approved PERMANENT_RESTRICTION on a risk case.
const VALID_TYPES: RestrictionType[] = [
  "CANNOT_MATCH", "CANNOT_RECEIVE_PROPOSAL", "CANNOT_CONTACT_SHARE", "CANNOT_SCHEDULE_MEETING", "CANNOT_UPDATE_FIELDS",
  "VERIFICATION_REQUIRED", "NO_NEW_PROPOSALS", "LOGIN_RESTRICTED", "NO_FAMILY_INVITATIONS",
  "COMMUNICATION_RESTRICTED", "PAYMENT_RESTRICTED", "FAMILY_ACCESS_RESTRICTED", "FULL_ACCOUNT_RESTRICTED",
];
const TIME_BOXED_ONLY: RestrictionType[] = ["COMMUNICATION_RESTRICTED", "PAYMENT_RESTRICTED", "FAMILY_ACCESS_RESTRICTED", "FULL_ACCOUNT_RESTRICTED"];

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin("profile:restrict");
    const { id } = await params;
    const [items, profile] = await Promise.all([
      prisma.profileRestriction.findMany({
        where: { profileId: id },
        include: { appliedBy: { select: { name: true } }, liftedBy: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
      }),
      prisma.profile.findUnique({ where: { id }, select: { accountStatus: true } }),
    ]);
    return NextResponse.json({ items, accountStatus: profile?.accountStatus ?? "ACTIVE" });
  } catch (error) {
    return handleApiError(error);
  }
}

// Spec §16 — a high-risk action requiring a reason (password/2FA
// confirmation is enforced at the UI/reauth level, matching STEP 11's
// existing step-up pattern for admin deactivation and security settings).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("profile:restrict");
    const { id } = await params;
    const { restrictionType, reason, endDate, caseId } = (await req.json()) as {
      restrictionType?: string; reason?: string; endDate?: string; caseId?: string;
    };
    if (!restrictionType || !VALID_TYPES.includes(restrictionType as RestrictionType)) throw new ApiError(400, "A valid restriction type is required.");
    if (!reason?.trim()) throw new ApiError(400, "A reason is required.");
    if (TIME_BOXED_ONLY.includes(restrictionType as RestrictionType) && !endDate) throw new ApiError(400, "This restriction type needs an end date. Open-ended restrictions require an approved permanent restriction on a risk case.");

    // STEP 19 §12 — maker-checker gate for high-risk profile restriction.
    const gate = await enforceApprovalGate({
      actionType: "PROFILE_RESTRICT",
      sourceType: "PROFILE",
      sourceId: id,
      actor: admin,
      reason: reason.trim(),
      requestedPayload: { restrictionType, endDate: endDate ?? null, caseId: caseId ?? null },
    });
    if (gate.requiresApproval && gate.status !== "READY_TO_EXECUTE") {
      return NextResponse.json({ approvalRequired: true, approvalCode: gate.approvalCode, status: gate.status }, { status: 202 });
    }

    const restriction = await applyRestriction({
      profileId: id,
      restrictionType: restrictionType as RestrictionType,
      reason: reason.trim(),
      appliedById: admin.id,
      endDate: endDate ? new Date(endDate) : null,
      caseId: caseId || null,
    });
    await notifyProfileRestricted(id);
    if (gate.requiresApproval) await markApprovalExecuted(gate.approvalRequestId, admin.id);

    return NextResponse.json(restriction);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(req: Request) {
  try {
    const admin = await requireAdmin("profile:restrict");
    const { restrictionId } = (await req.json()) as { restrictionId?: string };
    if (!restrictionId) throw new ApiError(400, "restrictionId is required.");

    const restriction = await liftRestriction(restrictionId, admin.id);
    return NextResponse.json(restriction);
  } catch (error) {
    return handleApiError(error);
  }
}
