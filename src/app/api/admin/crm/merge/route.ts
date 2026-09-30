import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { requireReason } from "@/lib/ops/admin-route";
import { planDuplicateMerge } from "@/lib/risk/duplicate-cluster-service";

// STEP 28 §38/§39 — a CRM-lens wrapper over the EXISTING STEP 24 planning
// step (src/lib/risk/duplicate-cluster-service.ts's planDuplicateMerge, which
// raises the DUPLICATE_MERGE approval and never merges anything itself). The
// genuinely new part — actually executing the merge once approved — lives in
// /api/admin/crm/merge/[id]/approve, which calls executeMerge().
export async function GET(req: Request) {
  try {
    await requireAdmin("crm:merge:view");
    const clusters = await prisma.duplicateCluster.findMany({
      where: { status: { in: ["CONFIRMED", "RESOLVED"] } },
      include: { members: { select: { profileId: true } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return NextResponse.json({ items: clusters });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("crm:merge:request");
    const body = (await req.json()) as { clusterId?: string; reason?: unknown };
    if (!body.clusterId) throw new ApiError(400, "clusterId is required.");
    const reason = requireReason(body.reason);

    const plan = await planDuplicateMerge(body.clusterId, admin, reason);
    return NextResponse.json(plan);
  } catch (error) {
    return handleApiError(error);
  }
}
