import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { computeRiskAssessment } from "@/lib/risk/assessment";

// Explainable Risk Assessment (spec §18) — live-computed, never persisted.
export async function GET(_req: Request, { params }: { params: Promise<{ profileId: string }> }) {
  try {
    await requireAdmin("risk:view");
    const { profileId } = await params;

    const assessment = await computeRiskAssessment(profileId);
    return NextResponse.json(assessment);
  } catch (error) {
    return handleApiError(error);
  }
}
