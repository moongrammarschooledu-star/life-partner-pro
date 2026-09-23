import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { submitApprovalRequest } from "@/lib/approvals/engine";

// Only the maker may submit their own draft (spec §2's Maker step).
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("approvals:submit");
    const { id } = await params;
    const request = await prisma.approvalRequest.findUnique({ where: { id }, select: { makerId: true } });
    if (!request) throw new ApiError(404, "Approval request not found.");
    if (request.makerId !== admin.id) throw new ApiError(403, "Only the request's maker can submit it.");

    const updated = await submitApprovalRequest(id, admin.id);
    return NextResponse.json(updated);
  } catch (error) {
    return handleApiError(error);
  }
}
