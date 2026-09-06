import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { writeAudit } from "@/lib/audit";
import { profileDetailInclude, toDetailDto } from "@/lib/serializers";
import { thresholdsFromSettings, DEFAULT_THRESHOLDS, type MatchThresholds } from "@/lib/matching";
import type { MatchStatus, MatchRecommendation } from "@prisma/client";

const VALID_STATUSES: MatchStatus[] = ["SUGGESTED", "REVIEWED", "APPROVED", "REJECTED", "PROPOSAL_CREATED", "CLOSED"];
const VALID_RECOMMENDATIONS: MatchRecommendation[] = ["STRONG_MATCH", "GOOD_MATCH", "NEEDS_REVIEW", "NOT_RECOMMENDED"];

function tierFor(total: number, thresholds: MatchThresholds) {
  if (total >= thresholds.excellent) return { tier: "EXCELLENT", tierLabel: "Excellent Match" };
  if (total >= thresholds.veryGood) return { tier: "VERY_GOOD", tierLabel: "Very Good Match" };
  if (total >= thresholds.good) return { tier: "GOOD", tierLabel: "Good Match" };
  if (total >= thresholds.possible) return { tier: "POSSIBLE", tierLabel: "Possible Match" };
  return { tier: "LOW", tierLabel: "Low Compatibility" };
}

// Backs the Match Analysis permalink page — a full profile pair plus the
// persisted, versioned scoring record (spec §29/§32).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("match:run");
    const { id } = await params;

    const match = await prisma.match.findUnique({
      where: { id },
      include: {
        profileA: { include: profileDetailInclude },
        profileB: { include: profileDetailInclude },
        createdBy: { select: { name: true } },
      },
    });
    if (!match) throw new ApiError(404, "Match not found");

    const settings = await prisma.appSettings.findUnique({ where: { id: 1 } });
    const thresholds = settings ? thresholdsFromSettings(settings) : DEFAULT_THRESHOLDS;

    return NextResponse.json({
      id: match.id,
      status: match.status,
      recommendation: match.recommendation,
      score: match.score,
      ...tierFor(match.score, thresholds),
      direction: { aToB: match.directionAToB, bToA: match.directionBToA },
      breakdown: JSON.parse(match.breakdown),
      algorithmVersion: match.algorithmVersion,
      previousScore: match.previousScore,
      previousBreakdown: match.previousBreakdown ? JSON.parse(match.previousBreakdown) : null,
      recalculatedAt: match.recalculatedAt,
      createdAt: match.createdAt,
      createdByName: match.createdBy?.name ?? null,
      profileA: toDetailDto(match.profileA, admin.id, admin.permissions),
      profileB: toDetailDto(match.profileB, admin.id, admin.permissions),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

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
