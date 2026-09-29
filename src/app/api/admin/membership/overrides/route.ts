import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { enforceApprovalGate, markApprovalExecuted } from "@/lib/approvals/gate";
import { grantOverride } from "@/lib/finance/entitlements";
import { assertKnownFeatureKey } from "@/lib/finance/catalog";

export async function GET(req: Request) {
  try {
    await requireAdmin("finance:entitlements:view");
    const { searchParams } = new URL(req.url);
    const profileId = searchParams.get("profileId");
    const where = profileId ? { profileId } : {};
    const items = await prisma.entitlementOverride.findMany({ where, orderBy: { createdAt: "desc" }, take: 200 });
    return NextResponse.json({ items });
  } catch (error) {
    return handleApiError(error);
  }
}

// STEP 27 §27 — a temporary entitlement override always requires a reason
// and a non-nullable expiry; grants are gated via the existing
// SUBSCRIPTION_OVERRIDE maker-checker entry (semantically "override a
// subscriber's entitlements", already FINANCE-domain).
export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("finance:entitlements:manage");
    const { profileId, featureKey, overrideType, limitValue, reason, expiresAt } = (await req.json()) as {
      profileId?: string; featureKey?: string; overrideType?: "GRANT" | "REVOKE" | "LIMIT_ADJUST"; limitValue?: number; reason?: string; expiresAt?: string;
    };
    if (!profileId || !featureKey || !overrideType) throw new ApiError(400, "A profile, feature key, and override type are required.");
    if (!reason?.trim()) throw new ApiError(400, "A reason is required.");
    if (!expiresAt) throw new ApiError(400, "An expiry date is required — overrides can never be permanent.");
    await assertKnownFeatureKey(featureKey);

    const gate = await enforceApprovalGate({
      actionType: "SUBSCRIPTION_OVERRIDE",
      sourceType: "PAYMENT",
      sourceId: profileId,
      actor: admin,
      reason: reason.trim(),
      requestedPayload: { profileId, featureKey, overrideType, limitValue, expiresAt },
    });
    if (gate.requiresApproval && gate.status !== "READY_TO_EXECUTE") return NextResponse.json({ approvalRequired: true, approvalCode: gate.approvalCode, status: gate.status }, { status: 202 });

    const created = await grantOverride(admin.id, { profileId, featureKey, overrideType, limitValue, reason: reason.trim(), expiresAt: new Date(expiresAt), approvedById: gate.requiresApproval ? admin.id : undefined });
    if (gate.requiresApproval) await markApprovalExecuted(gate.approvalRequestId, admin.id);
    return NextResponse.json({ approvalRequired: false, override: created });
  } catch (error) {
    return handleApiError(error);
  }
}
