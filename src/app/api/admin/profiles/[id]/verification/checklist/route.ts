import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { assertVerificationAccess } from "@/lib/verification-access";
import { catalogEntry } from "@/lib/verification/checklist-catalog";
import type { VerificationItemStatus } from "@prisma/client";

const VALID_STATUSES: VerificationItemStatus[] = ["PENDING", "COMPLETED", "FAILED", "NOT_APPLICABLE"];

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("verification:review");
    const { id } = await params;
    const { itemKey, status, note } = await req.json();

    if (!catalogEntry(itemKey)) throw new ApiError(400, "Unknown checklist item");
    if (!VALID_STATUSES.includes(status)) throw new ApiError(400, "Invalid status");

    const verification = await prisma.profileVerification.findUnique({ where: { profileId: id } });
    if (!verification) throw new ApiError(404, "Verification record not found");
    assertVerificationAccess(admin, verification);

    const item = await prisma.verificationItem.update({
      where: { profileVerificationId_itemKey: { profileVerificationId: verification.id, itemKey } },
      data: {
        status,
        note: note ?? undefined,
        completedById: status === "COMPLETED" ? admin.id : undefined,
        completedAt: status === "COMPLETED" ? new Date() : status === "PENDING" ? null : undefined,
      },
    });

    return NextResponse.json({ itemKey: item.itemKey, status: item.status });
  } catch (error) {
    return handleApiError(error);
  }
}
