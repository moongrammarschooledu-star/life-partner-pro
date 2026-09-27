import { NextResponse } from "next/server";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { getAuthorityRequest, discloseToAuthority } from "@/lib/compliance/authority-requests";

// STEP-19-gated (catalog: AUTHORITY_DISCLOSURE_APPROVAL, LEVEL_4/SUPER_ADMIN
// only). Existence and the two independent preconditions (verified + legal
// review approved) are checked here so a bad request maps to 404/409 instead
// of a generic 500 — discloseToAuthority() itself re-checks both regardless.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("compliance:authority-requests:manage");
    const { id } = await params;
    const existing = await getAuthorityRequest(id);
    if (!existing) throw new ApiError(404, "Authority request not found");
    if (existing.verificationStatus !== "VERIFIED") throw new ApiError(409, "Cannot disclose against an unverified authority request.");
    if (existing.legalReviewStatus !== "APPROVED") throw new ApiError(409, "Cannot disclose before legal review has approved this request.");

    const body = (await req.json()) as { approvedDisclosureScope?: string; disclosedData?: unknown; reason?: string };
    if (!body.approvedDisclosureScope?.trim()) throw new ApiError(400, "approvedDisclosureScope is required.");
    if (body.disclosedData === undefined) throw new ApiError(400, "disclosedData is required.");
    if (!body.reason?.trim()) throw new ApiError(400, "A reason is required to disclose to an authority.");

    const result = await discloseToAuthority(id, body.approvedDisclosureScope.trim(), body.disclosedData, admin, body.reason.trim());
    if (result.requiresApproval) {
      return NextResponse.json({ approvalRequired: true, approvalCode: result.approvalCode, status: result.status }, { status: 202 });
    }
    return NextResponse.json(result.request);
  } catch (error) {
    return handleApiError(error);
  }
}
