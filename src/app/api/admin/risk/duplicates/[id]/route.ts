import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { logPrivacyAccess } from "@/lib/privacy/access-log";

// STEP 24 - cluster detail for side-by-side review. Only AUTHORIZED fields are shown: identity fields need
// profile:view, and no contact detail, photo, document or sensitive trait is ever included here (contact data
// stays behind its own consent-gated route). The matching signals are shown by NAME, not value.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("duplicates:view");
    const { id } = await params;
    const cluster = await prisma.duplicateCluster.findUnique({ where: { id }, include: { members: true } });
    if (!cluster) throw new ApiError(404, "Duplicate cluster not found.");

    const memberIds = cluster.members.map((m) => m.profileId);
    const canSeeIdentity = admin.permissions.includes("profile:view");
    const [profiles, candidates, relationships] = await Promise.all([
      prisma.profile.findMany({ where: { id: { in: memberIds } }, select: { id: true, profileCode: true, fullName: true, status: true, verified: true, city: true, country: true, createdAt: true } }),
      prisma.duplicateCandidate.findMany({ where: { profileId: { in: memberIds }, candidateProfileId: { in: memberIds } }, select: { candidateCode: true, profileId: true, candidateProfileId: true, confidenceBand: true, matchingSignals: true, status: true, falsePositiveReason: true } }),
      prisma.accountRelationship.findMany({ where: { status: "ACTIVE", profileId: { in: memberIds }, relatedProfileId: { in: memberIds } }, select: { profileId: true, relatedProfileId: true, relationshipType: true, confidenceBand: true } }),
    ]);

    await logPrivacyAccess({ actorAdminId: admin.id, action: "DUPLICATE_CLUSTER_VIEWED", field: "duplicateCluster", targetProfileId: memberIds[0] ?? null, purpose: "FRAUD_PREVENTION" });

    return NextResponse.json({
      cluster: { id: cluster.id, status: cluster.status, confidenceBand: cluster.confidenceBand, memberCount: cluster.memberCount, createdAt: cluster.createdAt, resolvedAt: cluster.resolvedAt },
      members: profiles.map((p) => ({
        profileId: p.id,
        profileCode: p.profileCode,
        fullName: canSeeIdentity ? p.fullName : undefined,
        status: p.status,
        verified: p.verified,
        city: canSeeIdentity ? p.city : undefined,
        country: canSeeIdentity ? p.country : undefined,
        registeredAt: p.createdAt,
      })),
      candidates: candidates.map((c) => ({ ...c, matchingSignals: safeArray(c.matchingSignals) })),
      relationships,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

function safeArray(v: string): string[] {
  try {
    const parsed = JSON.parse(v);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}
