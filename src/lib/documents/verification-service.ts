import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { HttpError } from "@/lib/http-error";
import { enforceApprovalGate, markApprovalExecuted } from "@/lib/approvals/gate";
import type { SessionAdmin } from "@/lib/route-guard";
import type { Document } from "@prisma/client";
import { requireDocumentAccess } from "@/lib/documents/access-service";
import { logDocumentAccess } from "@/lib/documents/audit-log";

// Document review (spec §17-§19). Every decision is a human decision — no automated check (a provider
// status, an OCR result) is ever treated as sufficient on its own — and every one is recorded in
// DocumentVerificationEvent (the review history) whether it was gated or not.

export const REJECTION_REASONS = ["UNREADABLE", "INCOMPLETE", "EXPIRED", "MISMATCH", "UNSUPPORTED_DOCUMENT", "SECURITY_SCAN_FAILED", "INSUFFICIENT_INFORMATION", "VERIFICATION_FAILED", "OTHER"] as const;
export type RejectionReason = (typeof REJECTION_REASONS)[number];

export type ReviewAction = "APPROVE" | "REJECT" | "REQUEST_MORE_INFORMATION" | "REQUEST_REUPLOAD" | "MARK_REVERIFICATION_REQUIRED" | "ESCALATE" | "RESTRICT";

async function loadDocument(id: string): Promise<Document> {
  const doc = await prisma.document.findUnique({ where: { id } });
  if (!doc) throw new HttpError(404, "Document not found.");
  return doc;
}

async function recordEvent(documentId: string, action: string, params: { reasonKey?: string | null; note?: string | null; actorId: string; approvalId?: string | null }) {
  await prisma.documentVerificationEvent.create({ data: { documentId, action, reasonKey: params.reasonKey ?? null, note: params.note?.slice(0, 1000) ?? null, actorId: params.actorId, approvalId: params.approvalId ?? null } });
}

async function notifyOutcome(document: Document, type: "DOCUMENT_REVIEW_DECIDED" | "DOCUMENT_REVERIFICATION_REQUIRED") {
  if (!document.profileId) return;
  const { sendNotification } = await import("@/lib/notifications/notification-service");
  await sendNotification({ profileId: document.profileId, type, data: { relatedProfileId: document.profileId } });
}

export interface ReviewParams {
  documentId: string;
  action: ReviewAction;
  reasonKey?: RejectionReason | null;
  note?: string;
}

export type ReviewResult = { approvalRequired: false; document: Document } | { approvalRequired: true; approvalCode: string; status: string };

// RESTRICT is the only action here that goes through the STEP 19 gate (spec §18's "high-risk actions
// integrate with STEP 19 Maker-Checker"); the others are ordinary reviewer decisions, exactly like the
// STEP 8/23 verification-document PATCH route today.
const ACCESS_ACTION_FOR: Record<ReviewAction, "APPROVE" | "REJECT" | null> = {
  APPROVE: "APPROVE",
  REJECT: "REJECT",
  REQUEST_MORE_INFORMATION: null,
  REQUEST_REUPLOAD: null,
  MARK_REVERIFICATION_REQUIRED: null,
  ESCALATE: null,
  RESTRICT: null, // gated by the STEP 19 approval flow below, not a plain permission check
};

export async function reviewDocument(actor: SessionAdmin, params: ReviewParams): Promise<ReviewResult> {
  const document = await loadDocument(params.documentId);
  const accessAction = ACCESS_ACTION_FOR[params.action];
  if (accessAction) {
    await requireDocumentAccess({ type: "ADMIN", id: actor.id, permissions: actor.permissions }, document, accessAction);
  } else if (params.action !== "RESTRICT" && !actor.permissions.includes("documents:review")) {
    throw new HttpError(403, "Forbidden: insufficient permissions");
  }

  if (params.action === "REJECT" && !params.reasonKey) throw new HttpError(422, "A rejection reason is required.");
  if (params.reasonKey && !REJECTION_REASONS.includes(params.reasonKey)) throw new HttpError(422, "Unknown rejection reason.");

  let approvalId: string | null = null;
  if (params.action === "RESTRICT") {
    const gate = await enforceApprovalGate({ actionType: "DOCUMENT_RESTRICT", sourceType: "DOCUMENT", sourceId: document.id, actor, reason: params.note ?? "Restrict document", requestedPayload: { documentId: document.id } });
    if (gate.requiresApproval && gate.status !== "READY_TO_EXECUTE") return { approvalRequired: true, approvalCode: gate.approvalCode, status: gate.status };
    if (gate.requiresApproval) {
      await markApprovalExecuted(gate.approvalRequestId, actor.id);
      approvalId = gate.approvalRequestId;
    }
  }

  const statusFor: Record<ReviewAction, Document["status"]> = {
    APPROVE: "VERIFIED",
    REJECT: "REJECTED",
    REQUEST_MORE_INFORMATION: "UNDER_REVIEW",
    REQUEST_REUPLOAD: "REVERIFICATION_REQUIRED",
    MARK_REVERIFICATION_REQUIRED: "REVERIFICATION_REQUIRED",
    ESCALATE: "UNDER_REVIEW",
    RESTRICT: "RESTRICTED",
  };
  const verificationStatusFor: Record<ReviewAction, Document["verificationStatus"]> = {
    APPROVE: "VERIFIED",
    REJECT: "REJECTED",
    REQUEST_MORE_INFORMATION: "UNDER_REVIEW",
    REQUEST_REUPLOAD: "REVERIFICATION_REQUIRED",
    MARK_REVERIFICATION_REQUIRED: "REVERIFICATION_REQUIRED",
    ESCALATE: "UNDER_REVIEW",
    RESTRICT: document.verificationStatus,
  };

  const updated = await prisma.document.update({
    where: { id: document.id },
    data: {
      status: statusFor[params.action],
      verificationStatus: verificationStatusFor[params.action],
      verificationMethod: "MANUAL",
      reviewedById: actor.id,
      reviewedAt: new Date(),
      verificationReason: params.reasonKey ?? null,
      verificationNotes: params.note?.slice(0, 1000) ?? null,
      verificationVersion: { increment: 1 },
    },
  });

  await recordEvent(document.id, params.action, { reasonKey: params.reasonKey, note: params.note, actorId: actor.id, approvalId });
  await logDocumentAccess(document.id, params.action === "APPROVE" ? "APPROVE" : "REJECT", { type: "ADMIN", id: actor.id }, "ALLOWED", { profileId: document.profileId });
  await writeAudit({ action: params.action === "APPROVE" ? "DOCUMENT_APPROVED" : "DOCUMENT_REJECTED", adminId: actor.id, targetProfileId: document.profileId ?? undefined, meta: { documentId: document.id, action: params.action, reasonKey: params.reasonKey } });

  if (["APPROVE", "REJECT", "REQUEST_MORE_INFORMATION"].includes(params.action)) await notifyOutcome(updated, "DOCUMENT_REVIEW_DECIDED");
  if (["REQUEST_REUPLOAD", "MARK_REVERIFICATION_REQUIRED"].includes(params.action)) await notifyOutcome(updated, "DOCUMENT_REVERIFICATION_REQUIRED");
  if (["APPROVE", "REJECT"].includes(params.action) && updated.requestId) {
    const { completeRequest } = await import("@/lib/documents/request-service");
    await completeRequest(updated.requestId).catch(() => undefined);
  }

  return { approvalRequired: false, document: updated };
}

export async function getReviewHistory(documentId: string) {
  await loadDocument(documentId);
  return prisma.documentVerificationEvent.findMany({ where: { documentId }, orderBy: { createdAt: "asc" } });
}

export async function listPendingReview(take = 100) {
  return prisma.document.findMany({ where: { status: { in: ["AVAILABLE", "UNDER_REVIEW"] }, verificationStatus: { in: ["PENDING", "UNDER_REVIEW"] }, softDeletedAt: null }, orderBy: { createdAt: "asc" }, take: Math.min(take, 200) });
}
