import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { requireReason } from "@/lib/ops/admin-route";
import { enforceApprovalGate, markApprovalExecuted } from "@/lib/approvals/gate";
import { writeAudit } from "@/lib/audit";
import { assertCanSeeCrmRecord } from "@/lib/crm/access";
import { assignRecord } from "@/lib/crm/assignment-service";
import { applyTag } from "@/lib/crm/crm-record-service";
import { transitionStage, InvalidLifecycleTransitionError } from "@/lib/crm/lifecycle-service";
import type { CrmLifecycleStage } from "@prisma/client";

type BulkAction = "assign" | "tag" | "lifecycle";

// A lifecycle-exit transition applied in bulk is the one high-risk action
// here (moving many applicants to SUSPENDED/ARCHIVED/etc. at once) — gated
// through STEP 19's approval engine exactly like tasks/bulk's own archive
// action; assign/tag are reversible, ungated, spec-§43-style bulk actions.
const HIGH_RISK_EXIT_STAGES: CrmLifecycleStage[] = ["SUSPENDED", "ARCHIVED", "DEACTIVATED", "REJECTED"];

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("crm:bulk");
    const body = (await req.json()) as {
      action?: BulkAction; crmRecordIds?: string[]; adminId?: string; tagId?: string; toStage?: CrmLifecycleStage; reason?: unknown;
    };
    const action = body.action;
    const crmRecordIds = Array.isArray(body.crmRecordIds) ? body.crmRecordIds.filter((id) => typeof id === "string") : [];
    if (!action) throw new ApiError(400, "action is required.");
    if (crmRecordIds.length === 0) throw new ApiError(400, "crmRecordIds must be a non-empty array.");
    if (crmRecordIds.length > 200) throw new ApiError(400, "Cannot bulk-act on more than 200 CRM records at once.");

    const isHighRisk = action === "lifecycle" && body.toStage && HIGH_RISK_EXIT_STAGES.includes(body.toStage);
    const reasonText = isHighRisk ? requireReason(body.reason) : undefined;

    let gate: Awaited<ReturnType<typeof enforceApprovalGate>> | null = null;
    if (isHighRisk) {
      const batchKey = [...crmRecordIds].sort().join(",").slice(0, 400);
      gate = await enforceApprovalGate({
        actionType: "CRM_BULK_HIGH_RISK_ACTION",
        sourceType: "CRM_RECORD",
        sourceId: `bulk-lifecycle:${batchKey}`,
        actor: admin,
        reason: reasonText!,
        context: { recordCount: crmRecordIds.length, toStage: body.toStage },
        requestedPayload: { action, crmRecordIds, toStage: body.toStage },
      });
      if (gate.requiresApproval && gate.status !== "READY_TO_EXECUTE") {
        return NextResponse.json({ approvalRequired: true, approvalCode: gate.approvalCode, status: gate.status, affectedRecordCount: crmRecordIds.length }, { status: 202 });
      }
    }

    const succeeded: string[] = [];
    const failed: Array<{ crmRecordId: string; reason: string }> = [];

    for (const crmRecordId of crmRecordIds) {
      try {
        const record = await prisma.crmRecord.findUnique({ where: { id: crmRecordId } });
        if (!record) throw new ApiError(404, "CRM record not found.");
        assertCanSeeCrmRecord(admin, record);

        switch (action) {
          case "assign": {
            if (!body.adminId) throw new ApiError(400, "adminId is required for a bulk assign.");
            await assignRecord("CRM_RECORD", crmRecordId, body.adminId, admin.id);
            break;
          }
          case "tag": {
            if (!body.tagId) throw new ApiError(400, "tagId is required for a bulk tag.");
            await applyTag(crmRecordId, body.tagId, admin.id);
            break;
          }
          case "lifecycle": {
            if (!body.toStage) throw new ApiError(400, "toStage is required for a bulk lifecycle transition.");
            try {
              await transitionStage({ crmRecordId, toStage: body.toStage, actorId: admin.id, reason: reasonText, triggeredBy: "MANUAL" });
            } catch (error) {
              if (error instanceof InvalidLifecycleTransitionError) throw new ApiError(409, error.message);
              throw error;
            }
            break;
          }
          default:
            throw new ApiError(400, `Unknown bulk action: ${action}`);
        }
        succeeded.push(crmRecordId);
      } catch (error) {
        failed.push({ crmRecordId, reason: error instanceof Error ? error.message : "Unknown error" });
      }
    }

    await writeAudit({ action: "CRM_BULK_ACTION", adminId: admin.id, meta: { action, requested: crmRecordIds.length, succeeded: succeeded.length, failed: failed.length } });
    if (gate?.requiresApproval) await markApprovalExecuted(gate.approvalRequestId, admin.id);

    return NextResponse.json({ succeeded, failed });
  } catch (error) {
    return handleApiError(error);
  }
}
