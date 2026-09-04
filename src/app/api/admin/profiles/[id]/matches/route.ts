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
  DEFAULT_WEIGHTS,
  DEFAULT_THRESHOLDS,
  type MatchWeights,
  type HardRequirements,
  type MatchThresholds,
  type MatchResult,
  type MatchCategory,
} from "@/lib/matching";
import { calculateAge } from "@/lib/utils";

async function getMatchConfig(): Promise<{ weights: MatchWeights; hardRequirements: HardRequirements; thresholds: MatchThresholds }> {
  const settings = await prisma.appSettings.findUnique({ where: { id: 1 } });
  if (!settings) return { weights: DEFAULT_WEIGHTS, hardRequirements: {}, thresholds: DEFAULT_THRESHOLDS };
  return {
    weights: weightsFromSettings(settings),
    hardRequirements: hardRequirementsFromSettings(settings),
    thresholds: thresholdsFromSettings(settings),
  };
}

// Extracts a 0-100 int score per category for the Match table's dedicated
// score columns (see spec §12) — the full explanation still lives in
// `breakdown` JSON, these columns just make the sub-scores queryable/sortable.
function categoryScores(result: MatchResult): Record<MatchCategory, number> {
  const out = {} as Record<MatchCategory, number>;
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
    const city = searchParams.get("city");
    const education = searchParams.get("education");
    const profession = searchParams.get("profession");
    const limit = Math.min(Number(searchParams.get("limit") ?? 20), 100);

    const seekerRecord = await prisma.profile.findUnique({ where: { id }, include: matchableInclude });
    if (!seekerRecord) throw new ApiError(404, "Profile not found");

    const oppositeGender = seekerRecord.gender === "MALE" ? "FEMALE" : "MALE";

    const candidates = await prisma.profile.findMany({
      where: {
        id: { not: id },
        gender: oppositeGender,
        softDeleted: false,
        status: activeOnly ? "ACTIVE" : { notIn: ["ARCHIVED", "REJECTED", "MARRIED"] },
        ...(verifiedOnly ? { verified: true } : {}),
        ...(city ? { city: { equals: city, mode: "insensitive" } } : {}),
        ...(education ? { education: { level: { equals: education, mode: "insensitive" } } } : {}),
        ...(profession ? { profession: { profession: { contains: profession, mode: "insensitive" } } } : {}),
      },
      include: matchableInclude,
    });

    const seeker = toMatchable(seekerRecord);
    const { weights, hardRequirements, thresholds } = await getMatchConfig();

    const results = candidates
      .map((candidateRecord) => {
        const candidate = toMatchable(candidateRecord);
        const result = scoreMatchWithThresholds(seeker, candidate, weights, hardRequirements, thresholds);
        return {
          profile: {
            id: candidateRecord.id,
            profileCode: candidateRecord.profileCode,
            fullName: candidateRecord.fullName,
            age: calculateAge(candidateRecord.dateOfBirth),
            city: candidateRecord.city,
            country: candidateRecord.country,
            education: candidateRecord.education?.level ?? null,
            profession: candidateRecord.profession?.profession ?? null,
            status: candidateRecord.status,
            verified: candidateRecord.verified,
            createdAt: candidateRecord.createdAt,
          },
          ...result,
        };
      })
      // A candidate failing an admin-marked hard requirement is excluded
      // entirely (spec §27) rather than just scored low.
      .filter((r) => !r.excludedByHardRequirement && r.total >= minScore)
      .sort((a, b) => b.total - a.total)
      .slice(0, limit);

    return NextResponse.json({
      results,
      isCompatibilitySuggestion: true,
      seeker: {
        id: seekerRecord.id,
        profileCode: seekerRecord.profileCode,
        fullName: seekerRecord.fullName,
        age: calculateAge(seekerRecord.dateOfBirth),
        gender: seekerRecord.gender,
        city: seekerRecord.city,
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

    const { weights, hardRequirements, thresholds } = await getMatchConfig();
    const result = scoreMatchWithThresholds(toMatchable(seekerRecord), toMatchable(candidateRecord), weights, hardRequirements, thresholds);
    const scores = categoryScores(result);

    const [profileAId, profileBId] = [id, candidateId].sort();
    const data = {
      score: result.total,
      ageScore: scores.age,
      locationScore: scores.location,
      educationScore: scores.education,
      professionScore: scores.profession,
      incomeScore: scores.income,
      maritalStatusScore: scores.maritalStatus,
      heightScore: scores.height,
      familyScore: scores.family,
      religiousScore: scores.religious,
      lifestyleScore: scores.lifestyle,
      breakdown: JSON.stringify(result.breakdown),
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
