import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { readJson } from "@/lib/ops/admin-route";
import { enforcePersistentLimit } from "@/lib/ops/rate-limit-persistent";
import { evaluateProfileSafety } from "@/lib/risk/fraud-prevention-service";

// STEP 24 - server-side evaluation of ONE profile from persisted state. DELIBERATELY an admin route, not a
// public /api/security/risk/evaluate: an endpoint a client can call with its own "events" would be a
// score-manipulation vector. The body carries only a profileId - never events, signals or scores - so nothing a
// caller sends can influence the outcome. Evaluation only creates signals / an assessment / a review case; it
// cannot restrict or suspend anything.
export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("risk:investigate");
    const limited = await enforcePersistentLimit(req, "risk-evaluate", 30, 60_000, admin.id);
    if (limited) return limited;
    const { profileId } = await readJson<{ profileId?: unknown }>(req);
    if (typeof profileId !== "string" || !profileId) throw new ApiError(400, "profileId is required.");
    const profile = await prisma.profile.findUnique({ where: { id: profileId }, select: { id: true, softDeleted: true } });
    if (!profile || profile.softDeleted) throw new ApiError(404, "Profile not found.");
    return NextResponse.json(await evaluateProfileSafety(profile.id));
  } catch (error) {
    return handleApiError(error);
  }
}
