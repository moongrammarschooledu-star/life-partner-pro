import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { findMatchForPair, loadComparison, comparisonForScreen } from "@/lib/match-comparison-download";

// The comparison of the two people in a proposal, as rows for the proposal page: the same safe summary the shareable sheet carries (names, no area, income, family,
// photo or contact detail). Only when both profiles are verified; otherwise the page is told why nothing is shown.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("proposal:create");
    const { id } = await params;
    const proposal = await prisma.proposal.findUnique({ where: { id }, select: { matchId: true, profileAId: true, profileBId: true } });
    if (!proposal) throw new ApiError(404, "Proposal not found");

    const match = await findMatchForPair(proposal.matchId, proposal.profileAId, proposal.profileBId);
    if (!match) return NextResponse.json({ available: false, reason: "No match analysis exists for these two profiles yet. Run the matching for them first." });

    try {
      const comparison = await loadComparison(admin, match, proposal.profileAId);
      return NextResponse.json({ available: true, ...comparisonForScreen(comparison) });
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) return NextResponse.json({ available: false, reason: "Both profiles must be verified before the comparison can be shared." });
      throw error;
    }
  } catch (error) {
    return handleApiError(error);
  }
}
