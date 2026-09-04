import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { writeAudit } from "@/lib/audit";
import { matchableInclude, toMatchable } from "@/lib/match-adapter";
import {
  scoreMatchWithThresholds,
  weightsFromSettings,
  hardRequirementsFromSettings,
  thresholdsFromSettings,
  enabledCategoriesFromSettings,
  ALGORITHM_VERSION,
  DEFAULT_WEIGHTS,
  DEFAULT_THRESHOLDS,
  type MatchResult,
  type MatchCategory,
} from "@/lib/matching";

function categoryScores(result: MatchResult): Partial<Record<MatchCategory, number>> {
  const out: Partial<Record<MatchCategory, number>> = {};
  for (const part of result.breakdown) out[part.category] = Math.round(part.score * 100);
  return out;
}

const CATEGORY_LABELS: Record<MatchCategory, string> = {
  age: "Age",
  location: "Location",
  education: "Education",
  profession: "Profession",
  income: "Income",
  maritalStatus: "Marital Status",
  height: "Height",
  family: "Family",
  religious: "Religious Compatibility",
  lifestyle: "Lifestyle",
  languages: "Languages",
};

// Recomputes an existing Match's score against the profiles' *current* data
// and *current* admin settings, snapshotting the prior score/breakdown first
// so nothing is silently overwritten (spec §34).
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("match:run");
    const { id } = await params;

    const existing = await prisma.match.findUnique({ where: { id } });
    if (!existing) throw new ApiError(404, "Match not found");

    const [seekerRecord, candidateRecord] = await Promise.all([
      prisma.profile.findUnique({ where: { id: existing.profileAId }, include: matchableInclude }),
      prisma.profile.findUnique({ where: { id: existing.profileBId }, include: matchableInclude }),
    ]);
    if (!seekerRecord || !candidateRecord) throw new ApiError(404, "Profile not found");

    const settings = await prisma.appSettings.findUnique({ where: { id: 1 } });
    const weights = settings ? weightsFromSettings(settings) : DEFAULT_WEIGHTS;
    const hardRequirements = settings ? hardRequirementsFromSettings(settings) : {};
    const thresholds = settings ? thresholdsFromSettings(settings) : DEFAULT_THRESHOLDS;
    const enabled = settings ? enabledCategoriesFromSettings(settings) : {};

    const result = scoreMatchWithThresholds(toMatchable(seekerRecord), toMatchable(candidateRecord), weights, hardRequirements, thresholds, enabled);
    const scores = categoryScores(result);

    // Find the category with the largest score swing to explain the change.
    const oldBreakdown: { category: MatchCategory; score: number }[] = JSON.parse(existing.breakdown);
    let biggestDelta = 0;
    let reason = "No significant change detected.";
    for (const part of result.breakdown) {
      const old = oldBreakdown.find((p) => p.category === part.category);
      if (!old) continue;
      const oldPct = Math.round(old.score * 100);
      const newPct = Math.round(part.score * 100);
      const delta = Math.abs(newPct - oldPct);
      if (delta > biggestDelta) {
        biggestDelta = delta;
        reason = `${CATEGORY_LABELS[part.category]} score changed from ${oldPct}% to ${newPct}%.`;
      }
    }
    if (existing.score !== result.total) {
      reason += ` Overall score moved from ${existing.score}% to ${result.total}%.`;
    }

    const updated = await prisma.match.update({
      where: { id },
      data: {
        score: result.total,
        ageScore: scores.age ?? 0,
        locationScore: scores.location ?? 0,
        educationScore: scores.education ?? 0,
        professionScore: scores.profession ?? 0,
        incomeScore: scores.income ?? 0,
        maritalStatusScore: scores.maritalStatus ?? 0,
        heightScore: scores.height ?? 0,
        familyScore: scores.family ?? 0,
        religiousScore: scores.religious ?? 0,
        lifestyleScore: scores.lifestyle ?? 0,
        languagesScore: scores.languages ?? 0,
        directionAToB: result.direction.aToB,
        directionBToA: result.direction.bToA,
        breakdown: JSON.stringify(result.breakdown),
        algorithmVersion: ALGORITHM_VERSION,
        previousScore: existing.score,
        previousBreakdown: existing.breakdown,
        recalculatedAt: new Date(),
      },
    });

    await writeAudit({
      action: "MATCH_RECALCULATED",
      adminId: admin.id,
      targetProfileId: existing.profileAId,
      meta: { matchId: id, previousScore: existing.score, newScore: result.total },
    });

    return NextResponse.json({
      id: updated.id,
      score: updated.score,
      previousScore: updated.previousScore,
      reason,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
