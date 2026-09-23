import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { requireReason } from "@/lib/ops/admin-route";
import { writeAudit } from "@/lib/audit";
import type { ApprovalLevel, ApprovalRiskLevel, AdminRole } from "@prisma/client";

// STEP 19 §9 — "Never allow ordinary staff to modify governance policies."
// approvals:policy:manage is granted only to SUPER_ADMIN (permissions.ts).
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("approvals:policy:manage");
    const { id } = await params;
    const body = (await req.json()) as {
      enabled?: boolean;
      riskLevel?: ApprovalRiskLevel;
      requiredLevel?: ApprovalLevel;
      minimumApprovers?: number;
      quorum?: number;
      allowedRoles?: AdminRole[];
      allowedDepartmentIds?: string[];
      makerCheckerRequired?: boolean;
      reauthRequired?: boolean;
      twoFactorRequired?: boolean;
      expirationMinutes?: number;
      emergencyOverrideAllowed?: boolean;
      reason?: string;
    };
    const reason = requireReason(body.reason, 10);

    const existing = await prisma.approvalPolicy.findUnique({ where: { id } });
    if (!existing) throw new ApiError(404, "Approval policy not found.");

    const updated = await prisma.approvalPolicy.update({
      where: { id },
      data: {
        enabled: body.enabled ?? existing.enabled,
        riskLevel: body.riskLevel ?? existing.riskLevel,
        requiredLevel: body.requiredLevel ?? existing.requiredLevel,
        minimumApprovers: body.minimumApprovers ?? existing.minimumApprovers,
        quorum: body.quorum ?? existing.quorum,
        allowedRoles: body.allowedRoles ?? existing.allowedRoles,
        allowedDepartmentIds: body.allowedDepartmentIds ?? existing.allowedDepartmentIds,
        makerCheckerRequired: body.makerCheckerRequired ?? existing.makerCheckerRequired,
        reauthRequired: body.reauthRequired ?? existing.reauthRequired,
        twoFactorRequired: body.twoFactorRequired ?? existing.twoFactorRequired,
        expirationMinutes: body.expirationMinutes ?? existing.expirationMinutes,
        emergencyOverrideAllowed: body.emergencyOverrideAllowed ?? existing.emergencyOverrideAllowed,
        updatedById: admin.id,
      },
    });

    await writeAudit({ action: "APPROVAL_POLICY_UPDATED", adminId: admin.id, meta: { policyId: id, actionType: existing.actionType, reason } });

    return NextResponse.json(updated);
  } catch (error) {
    return handleApiError(error);
  }
}
