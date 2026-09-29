import { NextResponse } from "next/server";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { resolveReferralReview } from "@/lib/referrals/referral-service";

// STEP 27 §39 — a human resolves a REFERRAL_REVIEW_REQUIRED case back to
// QUALIFIED (reward then dispatches) or to REJECTED. Never an automatic decision.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("referrals:review");
    const { id } = await params;
    const { decision } = (await req.json()) as { decision?: "QUALIFIED" | "REJECTED" };
    if (decision !== "QUALIFIED" && decision !== "REJECTED") throw new ApiError(400, "A decision of QUALIFIED or REJECTED is required.");

    const updated = await resolveReferralReview(admin.id, id, decision);
    return NextResponse.json({ referral: updated });
  } catch (error) {
    return handleApiError(error);
  }
}
