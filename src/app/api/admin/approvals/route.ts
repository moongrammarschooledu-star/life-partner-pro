import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { hasBroadRecordAccess } from "@/lib/permissions";
import { createApprovalRequest } from "@/lib/approvals/engine";
import { isKnownActionType } from "@/lib/approvals/catalog";
import { ACTIVE_APPROVAL_STATUSES } from "@/lib/approvals/status";
import { requireReason } from "@/lib/ops/admin-route";
import type { ApprovalStatus, ApprovalRiskLevel, AssignmentResourceType, Prisma } from "@prisma/client";

const APPROVE_PERMISSIONS = ["approvals:approve", "finance:approval:approve", "privacy:approval:approve", "security:approval:approve", "ai:approval:approve", "sensitive:approval:approve"] as const;

// STEP 19 §19 — the Approvals list. Tabs map to a `tab` query param scoped
// server-side from the caller's own id/role/permissions, never trusted from
// the request (mirrors src/app/api/admin/tasks/route.ts's scope handling).
export async function GET(req: Request) {
  try {
    const admin = await requireAdmin("approvals:view");
    const { searchParams } = new URL(req.url);
    const tab = searchParams.get("tab") ?? "my-requests";

    const where: Prisma.ApprovalRequestWhereInput = {};

    switch (tab) {
      case "my-requests":
        where.makerId = admin.id;
        break;
      case "pending-my-approval": {
        const canDecide = APPROVE_PERMISSIONS.some((p) => admin.permissions.includes(p));
        if (!canDecide && !hasBroadRecordAccess(admin.role)) throw new ApiError(403, "You do not have permission to approve requests.");
        where.status = { in: ["PENDING_REVIEW", "PENDING_APPROVAL", "PARTIALLY_APPROVED"] };
        where.makerId = { not: admin.id };
        break;
      }
      case "pending-review":
        where.status = { in: ["SUBMITTED", "PENDING_REVIEW"] };
        break;
      case "high-risk":
        where.riskLevel = "HIGH" as ApprovalRiskLevel;
        break;
      case "critical":
        where.riskLevel = "CRITICAL" as ApprovalRiskLevel;
        break;
      case "expiring-soon":
        where.status = { in: ACTIVE_APPROVAL_STATUSES };
        where.expiresAt = { gte: new Date(), lte: new Date(Date.now() + 24 * 60 * 60 * 1000) };
        break;
      case "rejected":
        where.status = "REJECTED" as ApprovalStatus;
        break;
      case "changes-requested":
        where.status = "CHANGES_REQUESTED" as ApprovalStatus;
        break;
      case "executed":
        where.status = "EXECUTED" as ApprovalStatus;
        break;
      case "failed":
        where.status = "EXECUTION_FAILED" as ApprovalStatus;
        break;
      case "archived":
        where.status = "ARCHIVED" as ApprovalStatus;
        break;
      default:
        if (!hasBroadRecordAccess(admin.role) && !admin.permissions.includes("approvals:bulk:view")) where.makerId = admin.id;
    }

    if (!hasBroadRecordAccess(admin.role) && tab !== "my-requests" && tab !== "pending-my-approval") {
      // Non-broad roles never see the org-wide queues beyond their own
      // requests/decisions unless separately permissioned for reporting.
      if (!admin.permissions.includes("tasks:view:all") && !admin.permissions.includes("approvals:audit:view")) {
        where.makerId = admin.id;
      }
    }

    const actionType = searchParams.get("actionType");
    if (actionType) where.actionType = actionType;
    const status = searchParams.get("status");
    if (status) where.status = status as ApprovalStatus;
    const risk = searchParams.get("risk");
    if (risk) where.riskLevel = risk as ApprovalRiskLevel;
    const sourceType = searchParams.get("sourceType");
    if (sourceType) where.sourceType = sourceType as AssignmentResourceType;
    const sourceId = searchParams.get("sourceId");
    if (sourceId) where.sourceId = sourceId;
    const maker = searchParams.get("maker");
    if (maker) where.makerId = maker;
    const search = searchParams.get("search");
    if (search?.trim()) where.approvalCode = { contains: search.trim(), mode: "insensitive" };

    const [items, total] = await Promise.all([
      prisma.approvalRequest.findMany({
        where,
        orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
        take: 200,
        include: { maker: { select: { id: true, name: true } }, assignedChecker: { select: { id: true, name: true } } },
      }),
      prisma.approvalRequest.count({ where }),
    ]);

    return NextResponse.json({ items, total });
  } catch (error) {
    return handleApiError(error);
  }
}

// Manual "New Request" (spec §2) — a maker creates a governed request
// directly (as opposed to one auto-created by src/lib/approvals/gate.ts from
// an existing route). Field validation only; actual eligibility/quorum/
// conflict rules are enforced entirely server-side later, at decision time.
export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("approvals:create");
    const body = (await req.json()) as {
      actionType?: string;
      sourceType?: AssignmentResourceType;
      sourceId?: string;
      reason?: string;
      priority?: "LOW" | "NORMAL" | "HIGH" | "URGENT" | "CRITICAL";
      requestedPayload?: unknown;
      currentStatePayload?: unknown;
      amountMinor?: number;
      currencyCode?: string;
    };

    if (!body.actionType || !isKnownActionType(body.actionType)) throw new ApiError(400, "A valid actionType is required.");
    if (!body.sourceType || !body.sourceId) throw new ApiError(400, "sourceType and sourceId are required.");
    const reason = requireReason(body.reason, 10);

    const request = await createApprovalRequest({
      actionType: body.actionType,
      sourceType: body.sourceType,
      sourceId: body.sourceId,
      makerId: admin.id,
      reason,
      priority: body.priority,
      requestedPayload: body.requestedPayload,
      currentStatePayload: body.currentStatePayload,
      context: body.amountMinor != null ? { amountMinor: body.amountMinor, currencyCode: body.currencyCode } : undefined,
    });

    return NextResponse.json(request);
  } catch (error) {
    return handleApiError(error);
  }
}
