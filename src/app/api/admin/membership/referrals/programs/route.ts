import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { writeAudit } from "@/lib/audit";
import { nextSequenceCode } from "@/lib/privacy/codes";
import { enforceApprovalGate, markApprovalExecuted } from "@/lib/approvals/gate";
import type { ReferralRewardType, ReferralQualifyingEvent, Prisma } from "@prisma/client";

export async function GET() {
  try {
    await requireAdmin("referrals:view");
    const items = await prisma.referralProgram.findMany({ orderBy: { createdAt: "desc" } });
    return NextResponse.json({ items });
  } catch (error) {
    return handleApiError(error);
  }
}

// STEP 27 §16 — creating/changing referral reward configuration is gated by
// the REFERRAL_REWARD_CONFIG maker-checker entry.
export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("referrals:manage");
    const { name, description, rewardType, rewardConfig, qualifyingEvent, qualifyingEventConfig, maxRewardsPerReferrer, maxReferralsPerPeriod, periodDays } = (await req.json()) as {
      name?: string; description?: string; rewardType?: ReferralRewardType; rewardConfig?: Record<string, unknown>; qualifyingEvent?: ReferralQualifyingEvent;
      qualifyingEventConfig?: Record<string, unknown>; maxRewardsPerReferrer?: number; maxReferralsPerPeriod?: number; periodDays?: number;
    };
    if (!name?.trim() || !rewardType || !qualifyingEvent) throw new ApiError(400, "A name, reward type, and qualifying event are required.");

    const gate = await enforceApprovalGate({ actionType: "REFERRAL_REWARD_CONFIG", sourceType: "PAYMENT", sourceId: "new-referral-program", actor: admin, reason: "Create referral program", requestedPayload: { name, rewardType, rewardConfig } });
    if (gate.requiresApproval && gate.status !== "READY_TO_EXECUTE") return NextResponse.json({ approvalRequired: true, approvalCode: gate.approvalCode, status: gate.status }, { status: 202 });

    const program = await prisma.referralProgram.create({
      data: {
        programCode: await nextSequenceCode("REFPR"),
        name: name.trim(),
        description,
        rewardType,
        rewardConfig: (rewardConfig ?? {}) as Prisma.InputJsonValue,
        qualifyingEvent,
        qualifyingEventConfig: qualifyingEventConfig as Prisma.InputJsonValue | undefined,
        maxRewardsPerReferrer,
        maxReferralsPerPeriod,
        periodDays,
        status: "DRAFT",
        createdById: admin.id,
      },
    });
    if (gate.requiresApproval) await markApprovalExecuted(gate.approvalRequestId, admin.id);
    await writeAudit({ action: "REFERRAL_PROGRAM_CREATED", adminId: admin.id, meta: { referralProgramId: program.id, programCode: program.programCode } });
    return NextResponse.json({ approvalRequired: false, program });
  } catch (error) {
    return handleApiError(error);
  }
}
