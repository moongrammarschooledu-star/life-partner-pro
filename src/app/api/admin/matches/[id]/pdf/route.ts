import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { loadComparison, buildComparisonDownload } from "@/lib/match-comparison-download";
import { profileDetailInclude } from "@/lib/serializers";

// Downloads the comparison of a match as a sheet for ONE of the two people (?for=A or ?for=B): the two profiles side by side and why they were matched, with no area,
// income, family details, photo or contact details for either side (the names are on it). Only for a pair of verified profiles. Every download is audited.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("match:run");
    const { id } = await params;
    const forB = new URL(req.url).searchParams.get("for") === "B";

    const match = await prisma.match.findUnique({ where: { id }, include: { profileA: { include: profileDetailInclude }, profileB: { include: profileDetailInclude } } });
    if (!match) throw new ApiError(404, "Match not found");

    const comparison = await loadComparison(admin, match, forB ? match.profileBId : match.profileAId);
    const { pdf, filename } = await buildComparisonDownload(admin, comparison, req.url, "MATCH", match.id);

    return new NextResponse(new Uint8Array(pdf), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "no-store" },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
