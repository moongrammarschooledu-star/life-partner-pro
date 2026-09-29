import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { nextSequenceCode } from "@/lib/privacy/codes";
import { HttpError } from "@/lib/http-error";
import { isValidPromotionLikeStatusTransition } from "@/lib/finance/status-transitions";
import type { PromotionType, PromotionLikeStatus, Prisma } from "@prisma/client";

// STEP 27 §44/§59 — promotion lifecycle. Activation of a large/high-cost
// promotion is gated by the calling admin route via enforceApprovalGate
// against APPROVAL_CATALOG's PROMOTION_APPROVAL entry, never here.

export interface CreatePromotionInput {
  name: string;
  promotionType: PromotionType;
  config: Record<string, unknown>;
  startDate?: Date;
  endDate?: Date;
  packageIds?: string[];
  rules?: Array<{ ruleType: string; ruleConfig: Record<string, unknown> }>;
}

export async function createPromotion(actorId: string, input: CreatePromotionInput) {
  const promotion = await prisma.promotion.create({
    data: {
      promotionCode: await nextSequenceCode("PROMO"),
      name: input.name,
      promotionType: input.promotionType,
      config: input.config as Prisma.InputJsonValue,
      status: "DRAFT",
      startDate: input.startDate,
      endDate: input.endDate,
      createdById: actorId,
      packages: input.packageIds ? { create: input.packageIds.map((packageId) => ({ packageId })) } : undefined,
      rules: input.rules ? { create: input.rules.map((r) => ({ ruleType: r.ruleType, ruleConfig: r.ruleConfig as Prisma.InputJsonValue })) } : undefined,
    },
  });
  await writeAudit({ action: "PROMOTION_CREATED", adminId: actorId, meta: { promotionId: promotion.id, promotionCode: promotion.promotionCode } });
  return promotion;
}

// The API route calling this activates through enforceApprovalGate first
// when the amount threshold is crossed; approvedById is set once that gate
// clears, never self-set by the requester.
export async function setPromotionStatus(actorId: string, promotionId: string, status: PromotionLikeStatus, approvedById?: string) {
  const promotion = await prisma.promotion.findUnique({ where: { id: promotionId } });
  if (!promotion) throw new HttpError(404, "Promotion not found.");
  if (!isValidPromotionLikeStatusTransition(promotion.status, status)) throw new HttpError(422, `Cannot move a promotion from ${promotion.status} to ${status}.`);

  const updated = await prisma.promotion.update({ where: { id: promotionId }, data: { status, approvedById: status === "ACTIVE" ? (approvedById ?? promotion.approvedById) : promotion.approvedById } });
  await writeAudit({ action: status === "ACTIVE" ? "PROMOTION_ACTIVATED" : "PROMOTION_STATUS_CHANGED", adminId: actorId, meta: { promotionId, from: promotion.status, to: status } });
  return updated;
}

export async function listPromotions() {
  return prisma.promotion.findMany({ orderBy: { createdAt: "desc" }, include: { packages: true, rules: true } });
}
