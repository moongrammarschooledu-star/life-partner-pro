import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { writeAudit } from "@/lib/audit";
import { isValidPromotionLikeStatusTransition } from "@/lib/finance/status-transitions";
import type { PromotionLikeStatus } from "@prisma/client";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("referrals:manage");
    const { id } = await params;
    const { status } = (await req.json()) as { status?: PromotionLikeStatus };
    if (!status) throw new ApiError(400, "A target status is required.");

    const program = await prisma.referralProgram.findUnique({ where: { id } });
    if (!program) throw new ApiError(404, "Referral program not found.");
    if (!isValidPromotionLikeStatusTransition(program.status, status)) throw new ApiError(422, `Cannot move a referral program from ${program.status} to ${status}.`);

    const updated = await prisma.referralProgram.update({ where: { id }, data: { status } });
    await writeAudit({ action: "REFERRAL_PROGRAM_STATUS_CHANGED", adminId: admin.id, meta: { referralProgramId: id, from: program.status, to: status } });
    return NextResponse.json({ program: updated });
  } catch (error) {
    return handleApiError(error);
  }
}
