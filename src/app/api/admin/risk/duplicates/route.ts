import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { listDuplicateClusters } from "@/lib/risk/duplicate-cluster-service";

// STEP 24 - duplicate clusters (connected components over open duplicate candidates and duplicate-type
// relationships). Members are shown by profile CODE only in the list; a cluster is a review queue item, never a finding.
export async function GET(req: Request) {
  try {
    await requireAdmin("duplicates:view");
    const status = new URL(req.url).searchParams.get("status") ?? undefined;
    const clusters = await listDuplicateClusters({ status, take: 100 });
    const ids = [...new Set(clusters.flatMap((c) => c.members.map((m) => m.profileId)))];
    const profiles = ids.length ? await prisma.profile.findMany({ where: { id: { in: ids } }, select: { id: true, profileCode: true } }) : [];
    const codeOf = new Map(profiles.map((p) => [p.id, p.profileCode]));
    return NextResponse.json({
      items: clusters.map((c) => ({
        id: c.id,
        status: c.status,
        confidenceBand: c.confidenceBand,
        memberCount: c.memberCount,
        members: c.members.map((m) => ({ profileId: m.profileId, profileCode: codeOf.get(m.profileId) ?? null })),
        createdAt: c.createdAt,
        resolvedAt: c.resolvedAt,
      })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
