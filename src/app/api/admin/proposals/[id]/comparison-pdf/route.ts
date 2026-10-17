import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { findMatchForPair, loadComparison, buildComparisonDownload } from "@/lib/match-comparison-download";

// Downloads the comparison sheet of a proposal for ONE of its two people (?for=A is the proposal's first profile, ?for=B the second): both names and the safe summary of
// both sides, never a photo or any contact detail. Only when both profiles are verified. Every download is audited as a sensitive export.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("proposal:create");
    const { id } = await params;
    const forB = new URL(req.url).searchParams.get("for") === "B";

    const proposal = await prisma.proposal.findUnique({ where: { id }, select: { id: true, matchId: true, profileAId: true, profileBId: true } });
    if (!proposal) throw new ApiError(404, "Proposal not found");
    const match = await findMatchForPair(proposal.matchId, proposal.profileAId, proposal.profileBId);
    if (!match) throw new ApiError(404, "No match analysis exists for these two profiles yet. Run the matching for them first.");

    const comparison = await loadComparison(admin, match, forB ? proposal.profileBId : proposal.profileAId);
    const { pdf, filename } = await buildComparisonDownload(admin, comparison, req.url, "PROPOSAL", proposal.id);

    return new NextResponse(new Uint8Array(pdf), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "no-store" },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
