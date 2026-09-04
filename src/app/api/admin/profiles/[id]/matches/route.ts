import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
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
  type MatchWeights,
  type HardRequirements,
  type MatchThresholds,
  type EnabledCategories,
  type MatchResult,
  type MatchCategory,
} from "@/lib/matching";
import { calculateAge } from "@/lib/utils";

interface MatchConfig {
  weights: MatchWeights;
  hardRequirements: HardRequirements;
  thresholds: MatchThresholds;
  enabled: EnabledCategories;
  maxMatchResults: number;
  excludeHardRequirementFailures: boolean;
}

async function getMatchConfig(): Promise<MatchConfig> {
  const settings = await prisma.appSettings.findUnique({ where: { id: 1 } });
  if (!settings) {
    return {
      weights: DEFAULT_WEIGHTS,
      hardRequirements: {},
      thresholds: DEFAULT_THRESHOLDS,
      enabled: {},
      maxMatchResults: 10,
      excludeHardRequirementFailures: false,
    };
  }
  return {
    weights: weightsFromSettings(settings),
    hardRequirements: hardRequirementsFromSettings(settings),
    thresholds: thresholdsFromSettings(settings),
    enabled: enabledCategoriesFromSettings(settings),
    maxMatchResults: settings.maxMatchResults,
    excludeHardRequirementFailures: settings.excludeHardRequirementFailures,
  };
}

// Extracts a 0-100 int score per category for the Match table's dedicated
// score columns (see spec §12) — the full explanation still lives in
// `breakdown` JSON, these columns just make the sub-scores queryable/sortable.
function categoryScores(result: MatchResult): Partial<Record<MatchCategory, number>> {
  const out: Partial<Record<MatchCategory, number>> = {};
  for (const part of result.breakdown) {
    out[part.category] = Math.round(part.score * 100);
  }
  return out;
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin("match:run");
    const { id } = await params;
    const { searchParams } = new URL(req.url);
    const minScore = Number(searchParams.get("minScore") ?? 40);
    const verifiedOnly = searchParams.get("verifiedOnly") === "true";
    const activeOnly = searchParams.get("activeOnly") === "true";
    // Spec §2: by default only Verified + Active profiles are eligible
    // candidates. An admin can explicitly widen this back to the previous
    // broader "any non-archived/rejected/married" set.
    const includeAllEligible = searchParams.get("includeAllEligible") === "true";
    const city = searchParams.get("city");
    const education = searchParams.get("education");
    const profession = searchParams.get("profession");
    const minAge = searchParams.get("minAge") ? Number(searchParams.get("minAge")) : null;
    const maxAge = searchParams.get("maxAge") ? Number(searchParams.get("maxAge")) : null;
    const maritalStatus = searchParams.get("maritalStatus");
    const familyType = searchParams.get("familyType");
    const religion = searchParams.get("religion");
    const minCompleteness = searchParams.get("minCompleteness") ? Number(searchParams.get("minCompleteness")) : null;
    const limitParam = searchParams.get("limit");

    const seekerRecord = await prisma.profile.findUnique({ where: { id }, include: matchableInclude });
    if (!seekerRecord) throw new ApiError(404, "Profile not found");

    const oppositeGender = seekerRecord.gender === "MALE" ? "FEMALE" : "MALE";
    const { weights, hardRequirements, thresholds, enabled, maxMatchResults, excludeHardRequirementFailures } = await getMatchConfig();
    const limit = Math.min(Number(limitParam ?? maxMatchResults), 100);

    const eligibilityStatus: Prisma.ProfileWhereInput["status"] = includeAllEligible
      ? { notIn: ["ARCHIVED", "REJECTED", "MARRIED"] }
      : "ACTIVE";

    const candidates = await prisma.profile.findMany({
      where: {
        id: { not: id },
        gender: oppositeGender,
        softDeleted: false,
        status: activeOnly ? "ACTIVE" : eligibilityStatus,
        verified: includeAllEligible ? (verifiedOnly ? true : undefined) : true,
        ...(city ? { city: { equals: city, mode: "insensitive" } } : {}),
        ...(education ? { education: { level: { equals: education, mode: "insensitive" } } } : {}),
        ...(profession ? { profession: { profession: { contains: profession, mode: "insensitive" } } } : {}),
        ...(maritalStatus ? { maritalStatus: maritalStatus as never } : {}),
        ...(familyType ? { family: { is: { familyType: familyType as never } } } : {}),
        ...(religion ? { lifestyle: { is: { religion: { equals: religion, mode: "insensitive" } } } } : {}),
        ...(minCompleteness != null ? { profileCompletion: { gte: minCompleteness } } : {}),
      },
      include: matchableInclude,
    });

    const seeker = toMatchable(seekerRecord);

    const results = candidates
      .map((candidateRecord) => {
        const candidate = toMatchable(candidateRecord);
        const result = scoreMatchWithThresholds(seeker, candidate, weights, hardRequirements, thresholds, enabled);
        return {
          profile: {
            id: candidateRecord.id,
            profileCode: candidateRecord.profileCode,
            fullName: candidateRecord.fullName,
            age: calculateAge(candidateRecord.dateOfBirth),
            city: candidateRecord.city,
            area: candidateRecord.area,
            country: candidateRecord.country,
            education: candidateRecord.education?.level ?? null,
            profession: candidateRecord.profession?.profession ?? null,
            status: candidateRecord.status,
            verified: candidateRecord.verified,
            createdAt: candidateRecord.createdAt,
            updatedAt: candidateRecord.updatedAt,
            profileCompletion: candidateRecord.profileCompletion,
          },
          ...result,
        };
      })
      .filter((r) => (excludeHardRequirementFailures ? !r.excludedByHardRequirement : true))
      .filter((r) => r.total >= minScore)
      .filter((r) => (minAge != null ? r.profile.age >= minAge : true))
      .filter((r) => (maxAge != null ? r.profile.age <= maxAge : true))
      .sort((a, b) => {
        // Spec §25 ranking: mutual score, then verification, then activity
        // (updatedAt as the closest available proxy), then completeness.
        if (b.total !== a.total) return b.total - a.total;
        if (a.profile.verified !== b.profile.verified) return a.profile.verified ? -1 : 1;
        const activityDiff = new Date(b.profile.updatedAt).getTime() - new Date(a.profile.updatedAt).getTime();
        if (activityDiff !== 0) return activityDiff;
        return b.profile.profileCompletion - a.profile.profileCompletion;
      })
      .slice(0, limit);

    return NextResponse.json({
      results,
      isCompatibilitySuggestion: true,
      algorithmVersion: ALGORITHM_VERSION,
      seeker: {
        id: seekerRecord.id,
        profileCode: seekerRecord.profileCode,
        fullName: seekerRecord.fullName,
        age: calculateAge(seekerRecord.dateOfBirth),
        gender: seekerRecord.gender,
        city: seekerRecord.city,
        area: seekerRecord.area,
        country: seekerRecord.country,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("match:run");
    const { id } = await params;
    const { candidateId } = await req.json();

    const [seekerRecord, candidateRecord] = await Promise.all([
      prisma.profile.findUnique({ where: { id }, include: matchableInclude }),
      prisma.profile.findUnique({ where: { id: candidateId }, include: matchableInclude }),
    ]);
    if (!seekerRecord || !candidateRecord) throw new ApiError(404, "Profile not found");

    const { weights, hardRequirements, thresholds, enabled } = await getMatchConfig();
    const result = scoreMatchWithThresholds(toMatchable(seekerRecord), toMatchable(candidateRecord), weights, hardRequirements, thresholds, enabled);
    const scores = categoryScores(result);

    const [profileAId, profileBId] = [id, candidateId].sort();
    // result.direction is computed relative to (seeker, candidate) — the
    // Match table's profileA/profileB are sorted alphabetically by id
    // instead, which doesn't always agree with which one was the seeker.
    // Re-anchor the two direction values to profileA/profileB so a later
    // recalculation (which always scores profileA as "a") stores a
    // consistent, non-flipped pair.
    const seekerIsProfileA = id === profileAId;
    const directionAToB = seekerIsProfileA ? result.direction.aToB : result.direction.bToA;
    const directionBToA = seekerIsProfileA ? result.direction.bToA : result.direction.aToB;

    const data = {
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
      directionAToB,
      directionBToA,
      breakdown: JSON.stringify(result.breakdown),
      algorithmVersion: ALGORITHM_VERSION,
    };

    const match = await prisma.match.upsert({
      where: { profileAId_profileBId: { profileAId, profileBId } },
      update: data,
      create: { profileAId, profileBId, createdById: admin.id, ...data },
    });

    await writeAudit({ action: "MATCH_CREATED", adminId: admin.id, targetProfileId: id, meta: { candidateId, score: result.total } });

    return NextResponse.json({ id: match.id, score: match.score, status: match.status });
  } catch (error) {
    return handleApiError(error);
  }
}
