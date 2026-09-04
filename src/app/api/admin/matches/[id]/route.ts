import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { writeAudit } from "@/lib/audit";
import type { MatchStatus, MatchRecommendation } from "@prisma/client";

const VALID_STATUSES: MatchStatus[] = ["SUGGESTED", "REVIEWED", "APPROVED", "REJECTED", "PROPOSAL_CREATED", "CLOSED"];
const VALID_RECOMMENDATIONS: MatchRecommendation[] = ["STRONG_MATCH", "GOOD_MATCH", "NEEDS_REVIEW", "NOT_RECOMMENDED"];

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("match:run");
    const { id } = await params;
    const { status, recommendation, note } = await req.json();

    if (status && !VALID_STATUSES.includes(status)) throw new ApiError(400, "Invalid status");
    if (recommendation && !VALID_RECOMMENDATIONS.includes(recommendation)) throw new ApiError(400, "Invalid recommendation");

    const match = await prisma.match.update({
      where: { id },
      data: {
        ...(status ? { status } : {}),
        ...(recommendation !== undefined ? { recommendation } : {}),
      },
    });

    if (typeof note === "string" && note.trim()) {
      await prisma.profileNote.create({
        data: { profileId: match.profileAId, matchId: match.id, adminId: admin.id, text: note.trim() },
      });
    }

    await writeAudit({
      action: "MATCH_STATUS_CHANGED",
      adminId: admin.id,
      targetProfileId: match.profileAId,
      meta: { matchId: id, status, recommendation },
    });

    return NextResponse.json({ id: match.id, status: match.status, recommendation: match.recommendation });
  } catch (error) {
    return handleApiError(error);
  }
}
