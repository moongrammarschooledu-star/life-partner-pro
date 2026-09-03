import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { matchableInclude, toMatchable } from "@/lib/match-adapter";
import { scoreMatch, weightsFromSettings, DEFAULT_WEIGHTS, type MatchWeights } from "@/lib/matching";
import { calculateAge } from "@/lib/utils";

async function getWeights(): Promise<MatchWeights> {
  const settings = await prisma.appSettings.findUnique({ where: { id: 1 } });
  return settings ? weightsFromSettings(settings) : DEFAULT_WEIGHTS;
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin("match:run");
    const { id } = await params;

    const seekerRecord = await prisma.profile.findUnique({ where: { id }, include: matchableInclude });
    if (!seekerRecord) throw new ApiError(404, "Profile not found");

    const oppositeGender = seekerRecord.gender === "MALE" ? "FEMALE" : "MALE";

    const candidates = await prisma.profile.findMany({
      where: {
        id: { not: id },
        gender: oppositeGender,
        softDeleted: false,
        status: { notIn: ["ARCHIVED", "REJECTED", "MARRIED"] },
      },
      include: matchableInclude,
    });

    const seeker = toMatchable(seekerRecord);
    const weights = await getWeights();

    const results = candidates
      .map((candidateRecord) => {
        const candidate = toMatchable(candidateRecord);
        const result = scoreMatch(seeker, candidate, weights);
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
          },
          ...result,
        };
      })
      .filter((r) => r.total >= 40)
      .sort((a, b) => b.total - a.total)
      .slice(0, 20);

    return NextResponse.json({ results });
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

    const weights = await getWeights();
    const result = scoreMatch(toMatchable(seekerRecord), toMatchable(candidateRecord), weights);

    const [profileAId, profileBId] = [id, candidateId].sort();
    const match = await prisma.match.upsert({
      where: { profileAId_profileBId: { profileAId, profileBId } },
      update: { score: result.total, breakdown: JSON.stringify(result.breakdown) },
      create: { profileAId, profileBId, score: result.total, breakdown: JSON.stringify(result.breakdown) },
    });

    const { writeAudit } = await import("@/lib/audit");
    await writeAudit({ action: "MATCH_CREATED", adminId: admin.id, targetProfileId: id, meta: { candidateId, score: result.total } });

    return NextResponse.json({ id: match.id, score: match.score });
  } catch (error) {
    return handleApiError(error);
  }
}
