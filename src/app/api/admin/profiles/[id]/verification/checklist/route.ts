import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { assertVerificationAccess } from "@/lib/verification-access";
import { catalogEntry } from "@/lib/verification/checklist-catalog";
import { writeAudit } from "@/lib/audit";
import { recomputeStoredCompleteness } from "@/lib/verification/status";
import type { VerificationItemStatus } from "@prisma/client";

// The three contact items are normally completed by the person (a code to the phone / e-mail). When a code cannot reach them (no SMS provider, no way to verify a
// WhatsApp number), the team confirms by phone or WhatsApp and ticks the item: that must COUNT, so it also records the verification the level, the completeness and the
// confidence read. Taking the tick back clears it only when an administrator gave it, never a confirmation the person made themselves.
const CONTACT_ITEMS = { mobile_verified: "phoneVerifiedAt", whatsapp_verified: "whatsappVerifiedAt", email_verified: "emailVerifiedAt" } as const;

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

    const field = CONTACT_ITEMS[itemKey as keyof typeof CONTACT_ITEMS];
    const before = field ? await prisma.verificationItem.findUnique({ where: { profileVerificationId_itemKey: { profileVerificationId: verification.id, itemKey } } }) : null;

    const item = await prisma.verificationItem.update({
      where: { profileVerificationId_itemKey: { profileVerificationId: verification.id, itemKey } },
      data: {
        status,
        note: note ?? undefined,
        completedById: status === "COMPLETED" ? admin.id : undefined,
        completedAt: status === "COMPLETED" ? new Date() : status === "PENDING" ? null : undefined,
      },
    });

    if (field) {
      if (status === "COMPLETED") {
        if (!verification[field]) await prisma.profileVerification.update({ where: { id: verification.id }, data: { [field]: new Date() } });
      } else if (before?.status === "COMPLETED" && before.completedById && (status === "PENDING" || status === "FAILED")) {
        await prisma.profileVerification.update({ where: { id: verification.id }, data: { [field]: null } });
      }
      await writeAudit({ action: "PROFILE_EDITED", adminId: admin.id, targetProfileId: id, meta: { sections: ["verification-contact"], itemKey, status } });
      await recomputeStoredCompleteness(id);
    }

    return NextResponse.json({ itemKey: item.itemKey, status: item.status });
  } catch (error) {
    return handleApiError(error);
  }
}
