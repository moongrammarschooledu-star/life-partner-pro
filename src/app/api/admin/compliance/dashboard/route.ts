import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { listRulesDueForReview } from "@/lib/compliance/rules";
import { listProcessorsDueForReview } from "@/lib/compliance/processors";
import { listAuthorityRequestsAwaitingReview } from "@/lib/compliance/authority-requests";
import { listHoldsPendingRelease } from "@/lib/compliance/legal-hold";

// Compliance Center dashboard (plan Milestone 4/6) — KPI counts drawn
// straight from the new tables, no invented "compliance score."
export async function GET() {
  try {
    await requireAdmin("compliance:view");

    const [jurisdictionCount, activeRuleCount, rulesDueForReview, processorsDueForReview, authorityRequestsAwaitingReview, holdsPendingRelease, transfersReviewRequired] = await Promise.all([
      prisma.jurisdiction.count(),
      prisma.complianceRule.count({ where: { status: "ACTIVE" } }),
      listRulesDueForReview(),
      listProcessorsDueForReview(),
      listAuthorityRequestsAwaitingReview(),
      listHoldsPendingRelease(),
      prisma.dataTransferAssessment.count({ where: { status: "REVIEW_REQUIRED" } }),
    ]);

    return NextResponse.json({
      kpis: {
        jurisdictionCount,
        activeRuleCount,
        rulesDueForReview: rulesDueForReview.length,
        processorsDueForReview: processorsDueForReview.length,
        authorityRequestsAwaitingReview: authorityRequestsAwaitingReview.length,
        holdsPendingRelease: holdsPendingRelease.length,
        transfersReviewRequired,
      },
      rulesDueForReview,
      processorsDueForReview,
      authorityRequestsAwaitingReview,
      holdsPendingRelease,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
