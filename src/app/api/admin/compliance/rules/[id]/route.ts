import { NextResponse } from "next/server";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { getRule, updateDraftRule, submitRuleForReview } from "@/lib/compliance/rules";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin("compliance:rules:view");
    const { id } = await params;
    const rule = await getRule(id);
    if (!rule) throw new ApiError(404, "Compliance rule not found");
    return NextResponse.json(rule);
  } catch (error) {
    return handleApiError(error);
  }
}

// Editing a DRAFT/UNDER_REVIEW rule's fields, or submitting a DRAFT for
// review (`{ submit: true }`) — activation/approval/suspension each have
// their own gated endpoint below, never folded into this generic PATCH.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("compliance:rules:manage");
    const { id } = await params;
    const existing = await getRule(id);
    if (!existing) throw new ApiError(404, "Compliance rule not found");

    const body = (await req.json()) as { submit?: boolean } & Record<string, unknown>;

    if (body.submit) {
      if (existing.status !== "DRAFT") throw new ApiError(409, `Only a DRAFT rule may be submitted for review (current status: ${existing.status}).`);
      const rule = await submitRuleForReview(id, admin);
      return NextResponse.json(rule);
    }
    if (existing.status !== "DRAFT" && existing.status !== "UNDER_REVIEW") {
      throw new ApiError(409, `Cannot edit a rule in status ${existing.status} — supersede it with a new version instead.`);
    }

    const { subject, requirementType, description, sourceTitle, sourceAuthority, sourceReference, sourceUrl, sourcePublicationDate, internalReviewNote, effectiveFrom, effectiveTo, reviewDate, sourceType } = body as Record<string, string | undefined>;
    const rule = await updateDraftRule(
      id,
      {
        subject,
        requirementType,
        description,
        sourceType: sourceType as never,
        sourceTitle,
        sourceAuthority,
        sourceReference,
        sourceUrl,
        sourcePublicationDate: sourcePublicationDate ? new Date(sourcePublicationDate) : undefined,
        internalReviewNote,
        effectiveFrom: effectiveFrom ? new Date(effectiveFrom) : undefined,
        effectiveTo: effectiveTo ? new Date(effectiveTo) : undefined,
        reviewDate: reviewDate ? new Date(reviewDate) : undefined,
        configuration: body.configuration,
      },
      admin
    );
    return NextResponse.json(rule);
  } catch (error) {
    return handleApiError(error);
  }
}
