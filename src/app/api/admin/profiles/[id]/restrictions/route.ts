import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { applyRestriction, liftRestriction } from "@/lib/profile-restrictions";
import { notifyProfileRestricted } from "@/lib/notifications/events";
import type { RestrictionType } from "@prisma/client";

const VALID_TYPES: RestrictionType[] = ["CANNOT_MATCH", "CANNOT_RECEIVE_PROPOSAL", "CANNOT_CONTACT_SHARE", "CANNOT_SCHEDULE_MEETING", "CANNOT_UPDATE_FIELDS"];

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin("profile:restrict");
    const { id } = await params;
    const items = await prisma.profileRestriction.findMany({
      where: { profileId: id },
      include: { appliedBy: { select: { name: true } }, liftedBy: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ items });
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

    const restriction = await applyRestriction({
      profileId: id,
      restrictionType: restrictionType as RestrictionType,
      reason: reason.trim(),
      appliedById: admin.id,
      endDate: endDate ? new Date(endDate) : null,
      caseId: caseId || null,
    });
    await notifyProfileRestricted(id);

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
