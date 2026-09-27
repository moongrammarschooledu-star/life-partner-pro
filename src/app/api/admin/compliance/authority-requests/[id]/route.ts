import { NextResponse } from "next/server";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { getAuthorityRequest, recordLegalReview } from "@/lib/compliance/authority-requests";

const VALID_REVIEW_STATUSES = ["UNDER_REVIEW", "APPROVED", "REJECTED"] as const;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin("compliance:authority-requests:view");
    const { id } = await params;
    const request = await getAuthorityRequest(id);
    if (!request) throw new ApiError(404, "Authority request not found");
    return NextResponse.json(request);
  } catch (error) {
    return handleApiError(error);
  }
}

// The legal-review decision (independent of, and a precondition alongside,
// verification — see /verify). Never itself discloses anything.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("compliance:authority-requests:manage");
    const { id } = await params;
    const existing = await getAuthorityRequest(id);
    if (!existing) throw new ApiError(404, "Authority request not found");

    const body = (await req.json()) as { legalReviewStatus?: string; note?: string };
    if (!body.legalReviewStatus || !VALID_REVIEW_STATUSES.includes(body.legalReviewStatus as (typeof VALID_REVIEW_STATUSES)[number])) {
      throw new ApiError(400, `legalReviewStatus must be one of ${VALID_REVIEW_STATUSES.join(", ")}`);
    }
    if (!body.note?.trim()) throw new ApiError(400, "A note is required when recording a legal review decision.");

    const request = await recordLegalReview(id, body.legalReviewStatus as (typeof VALID_REVIEW_STATUSES)[number], admin, body.note.trim());
    return NextResponse.json(request);
  } catch (error) {
    return handleApiError(error);
  }
}
