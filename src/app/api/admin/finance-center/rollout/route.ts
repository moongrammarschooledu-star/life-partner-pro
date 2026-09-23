import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { verifyStepUpToken } from "@/lib/step-up-token";
import { changeRolloutStage, getSandboxReadinessChecklist } from "@/lib/finance/rollout";
import { enforceApprovalGate, markApprovalExecuted } from "@/lib/approvals/gate";
import type { PaymentRolloutStage } from "@prisma/client";

// STEP 19 §17 — the payment rollout stage is a global singleton (one
// AppSettings row), not a per-record resource, so a fixed synthetic sourceId
// identifies it as a governed resource for the approval engine.
const ROLLOUT_SOURCE_ID = "global-payment-rollout";

export async function GET() {
  try {
    await requireAdmin("finance:rollout:view");
    const settings = await prisma.appSettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
    const checklist = await getSandboxReadinessChecklist();
    const recentEvents = await prisma.paymentRolloutEvent.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { actor: { select: { name: true } } },
    });
    return NextResponse.json({
      settings,
      sandboxReadinessChecklist: checklist,
      recentEvents,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

// Spec §83 — forward-only progression, no skipping (enforced by
// isValidRolloutTransition), plus the universal any-stage kill switch to
// DISABLED. Moving to PRODUCTION or using the kill switch both require a
// fresh password re-confirmation on top of the SUPER_ADMIN-only permission
// (spec §79/§85) — the highest-risk actions in this whole add-on.
export async function PATCH(req: Request) {
  try {
    const { toStage, reason, stepUpToken } = (await req.json()) as { toStage?: PaymentRolloutStage; reason?: string; stepUpToken?: string };
    if (!toStage) throw new ApiError(400, "A target rollout stage is required.");
    if (!reason?.trim()) throw new ApiError(400, "A reason is required for every rollout-stage change.");

    const permission = toStage === "DISABLED" ? "finance:rollout:disable" : "finance:rollout:enable";
    const admin = await requireAdmin(permission);

    const requiresReauth = toStage === "PRODUCTION" || toStage === "DISABLED";
    if (requiresReauth && !verifyStepUpToken(stepUpToken, "REAUTH", admin.id)) {
      throw new ApiError(403, "Please re-enter your password to confirm this rollout-stage change.");
    }

    const gate = await enforceApprovalGate({
      actionType: toStage === "DISABLED" ? "PAYMENT_DISABLE" : "PAYMENT_ROLLOUT",
      sourceType: "PAYMENT",
      sourceId: ROLLOUT_SOURCE_ID,
      actor: admin,
      reason: reason.trim(),
      requestedPayload: { toStage },
    });
    if (gate.requiresApproval && gate.status !== "READY_TO_EXECUTE") {
      return NextResponse.json({ approvalRequired: true, approvalCode: gate.approvalCode, status: gate.status }, { status: 202 });
    }

    try {
      const result = await changeRolloutStage({ toStage, reason: reason.trim(), actorId: admin.id });
      if (gate.requiresApproval) await markApprovalExecuted(gate.approvalRequestId, admin.id);
      return NextResponse.json(result);
    } catch (error) {
      throw new ApiError(400, error instanceof Error ? error.message : "Could not change the rollout stage.");
    }
  } catch (error) {
    return handleApiError(error);
  }
}
