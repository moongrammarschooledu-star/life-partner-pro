import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { nextSequenceCode } from "@/lib/privacy/codes";
import { subtractMoney } from "@/lib/finance/money";
import { getPaymentFeatureFlags } from "@/lib/finance/rollout";

// STEP 27 §28/§29 — service credits. Not cash unless explicitly configured
// (spec §28 — nothing here ever triggers a real-money payout; a credit only
// ever reduces a future checkout total or is adjusted/revoked by an admin).
// All arithmetic goes through src/lib/finance/money.ts exclusively.

export async function getBalance(profileId: string, currencyCode: string): Promise<number> {
  const credit = await prisma.membershipCredit.findUnique({ where: { profileId_currencyCode: { profileId, currencyCode } } });
  return credit?.balanceMinor ?? 0;
}

export interface GrantCreditInput {
  profileId: string;
  currencyCode: string;
  amountMinor: number;
  reason: string;
  referenceType?: string;
  referenceId?: string;
  createdById?: string;
}

export async function grantCredit(input: GrantCreditInput) {
  if (input.amountMinor <= 0) throw new Error("Credit amount must be positive.");
  return prisma.$transaction(async (tx) => {
    const credit = await tx.membershipCredit.upsert({
      where: { profileId_currencyCode: { profileId: input.profileId, currencyCode: input.currencyCode } },
      update: { balanceMinor: { increment: input.amountMinor } },
      create: { creditCode: await nextSequenceCode("CRED"), profileId: input.profileId, currencyCode: input.currencyCode, balanceMinor: input.amountMinor },
    });
    await tx.creditTransaction.create({
      data: { creditId: credit.id, type: "GRANTED", amountMinor: input.amountMinor, reason: input.reason, referenceType: input.referenceType, referenceId: input.referenceId, createdById: input.createdById },
    });
    await writeAudit({ action: "CREDIT_GRANTED", adminId: input.createdById, targetProfileId: input.profileId, meta: { amountMinor: input.amountMinor, currencyCode: input.currencyCode, reason: input.reason } });
    return credit;
  });
}

// Applied at checkout — capped at the available balance, never goes negative
// (subtractMoney floors at 0, per src/lib/finance/money.ts).
export async function useCredit(profileId: string, currencyCode: string, requestedMinor: number, referenceType: string, referenceId: string): Promise<number> {
  if (requestedMinor <= 0) return 0;
  // STEP 27 §61 — kill switch: an existing balance is untouched; only NEW
  // use at checkout is paused while disabled (admin grants/revokes still work).
  if (!(await getPaymentFeatureFlags()).creditsEnabled) return 0;
  return prisma.$transaction(async (tx) => {
    const credit = await tx.membershipCredit.findUnique({ where: { profileId_currencyCode: { profileId, currencyCode } } });
    if (!credit || credit.balanceMinor <= 0) return 0;

    const amountMinor = Math.min(requestedMinor, credit.balanceMinor);
    const result = await tx.membershipCredit.updateMany({ where: { id: credit.id, balanceMinor: { gte: amountMinor } }, data: { balanceMinor: { decrement: amountMinor } } });
    if (result.count === 0) return 0;

    await tx.creditTransaction.create({ data: { creditId: credit.id, type: "USED", amountMinor, reason: "Applied at checkout", referenceType, referenceId } });
    await writeAudit({ action: "CREDIT_USED", targetProfileId: profileId, meta: { amountMinor, currencyCode, referenceType, referenceId } });
    return amountMinor;
  });
}

export async function refundCredit(profileId: string, currencyCode: string, amountMinor: number, referenceType: string, referenceId: string) {
  return grantCredit({ profileId, currencyCode, amountMinor, reason: "Refunded", referenceType, referenceId });
}

export async function revokeCredit(actorId: string, profileId: string, currencyCode: string, amountMinor: number, reason: string) {
  return prisma.$transaction(async (tx) => {
    const credit = await tx.membershipCredit.findUnique({ where: { profileId_currencyCode: { profileId, currencyCode } } });
    if (!credit) return null;
    const newBalance = subtractMoney(credit.balanceMinor, amountMinor);
    const applied = credit.balanceMinor - newBalance;
    await tx.membershipCredit.update({ where: { id: credit.id }, data: { balanceMinor: newBalance } });
    await tx.creditTransaction.create({ data: { creditId: credit.id, type: "REVOKED", amountMinor: applied, reason, createdById: actorId } });
    await writeAudit({ action: "CREDIT_REVOKED", adminId: actorId, targetProfileId: profileId, meta: { amountMinor: applied, currencyCode, reason } });
    return credit;
  });
}

// Cron-driven — only relevant for a program that sets a credit expiry window
// (spec's own reward-expiry concept); with no expiry field on the credit
// itself today, this is a documented no-op hook kept for that future policy
// rather than guessing an arbitrary expiry period now.
export async function expireCredits(): Promise<number> {
  return 0;
}
