import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { requireReason } from "@/lib/ops/admin-route";
import { recordDecision } from "@/lib/approvals/engine";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("crm:merge:approve");
    const { id: clusterId } = await params;
    const body = (await req.json()) as { reason?: unknown };
    const reason = requireReason(body.reason, 5);

    const approval = await prisma.approvalRequest.findFirst({
      where: { actionType: "DUPLICATE_MERGE", sourceType: "PROFILE", requestedPayload: { path: ["clusterId"], equals: clusterId } },
      orderBy: { createdAt: "desc" },
    });
    if (!approval) throw new ApiError(404, "No merge approval request exists for this cluster.");

    const updated = await recordDecision({ approvalRequestId: approval.id, actorId: admin.id, decision: "REJECT", reason });
    return NextResponse.json(updated);
  } catch (error) {
    return handleApiError(error);
  }
}
