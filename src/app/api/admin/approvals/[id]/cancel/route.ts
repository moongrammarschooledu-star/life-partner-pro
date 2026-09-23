import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { hasBroadRecordAccess } from "@/lib/permissions";
import { cancelApprovalRequest } from "@/lib/approvals/engine";
import { requireReason } from "@/lib/ops/admin-route";

// Only the maker or a broad/governance role may withdraw a request.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("approvals:cancel");
    const { id } = await params;
    const body = (await req.json()) as { reason?: string };
    const reason = requireReason(body.reason, 5);

    const request = await prisma.approvalRequest.findUnique({ where: { id }, select: { makerId: true } });
    if (!request) throw new ApiError(404, "Approval request not found.");
    if (request.makerId !== admin.id && !hasBroadRecordAccess(admin.role)) {
      throw new ApiError(403, "Only the request's maker (or a governance role) can cancel it.");
    }

    const updated = await cancelApprovalRequest(id, admin.id, reason);
    return NextResponse.json(updated);
  } catch (error) {
    return handleApiError(error);
  }
}
