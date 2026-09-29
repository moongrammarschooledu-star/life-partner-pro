import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { HttpError } from "@/lib/http-error";
import { enforceApprovalGate, markApprovalExecuted } from "@/lib/approvals/gate";
import type { SessionAdmin } from "@/lib/route-guard";
import type { Document, DocumentShare, DocumentShareRecipientType, DocumentShareScope } from "@prisma/client";
import { requireDocumentAccess, type DocumentAccessActor } from "@/lib/documents/access-service";

// DocumentSharingService (spec §28/§29). The rule the whole module exists to enforce: PROPOSAL ACCESS
// NEVER IMPLIES DOCUMENT ACCESS. Every share is its own explicit, expiring, purpose-carrying row, and
// sharing a document with ANOTHER applicant (the recipientType PROFILE case — e.g. the other party of a
// proposal) always goes through the STEP 19 approval gate, whoever requests it.

export interface RequestShareParams {
  documentId: string;
  recipientType: DocumentShareRecipientType;
  recipientId: string;
  scope?: DocumentShareScope;
  purpose: string;
  expiresAt?: Date | null;
}

export type ShareResult = { approvalRequired: false; share: DocumentShare } | { approvalRequired: true; approvalCode: string; status: string };

async function loadDocument(id: string): Promise<Document> {
  const doc = await prisma.document.findUnique({ where: { id } });
  if (!doc) throw new HttpError(404, "Document not found.");
  return doc;
}

export async function requestShare(actor: DocumentAccessActor & { permissions?: readonly string[] }, params: RequestShareParams): Promise<ShareResult> {
  if (!params.purpose.trim()) throw new HttpError(422, "A purpose is required.");
  const document = await loadDocument(params.documentId);
  await requireDocumentAccess(actor, document, "SHARE");
  if (document.status === "RESTRICTED") throw new HttpError(409, "This document is restricted and cannot be shared.");

  const scope = params.scope ?? "VIEW";
  const needsGate = params.recipientType === "PROFILE"; // sharing with another applicant is always the sensitive path

  const share = await prisma.documentShare.create({
    data: {
      documentId: document.id,
      recipientType: params.recipientType,
      recipientId: params.recipientId,
      scope,
      purpose: params.purpose.trim().slice(0, 300),
      requestedById: actor.id,
      expiresAt: params.expiresAt ?? null,
      status: needsGate ? "PENDING_APPROVAL" : "REQUESTED",
    },
  });

  if (needsGate) {
    const gate = await enforceApprovalGate({
      actionType: "DOCUMENT_SHARE_TO_PROPOSAL",
      sourceType: "DOCUMENT",
      sourceId: document.id,
      // enforceApprovalGate only ever reads actor.id (see src/lib/approvals/gate.ts) — a PROFILE-initiated
      // share request still needs to go through the same gate, so only the id is asserted here.
      actor: { id: actor.id } as unknown as SessionAdmin,
      reason: params.purpose,
      requestedPayload: { shareId: share.id, documentId: document.id, recipientType: params.recipientType, recipientId: params.recipientId },
    });
    if (gate.requiresApproval && gate.status !== "READY_TO_EXECUTE") {
      await prisma.documentShare.update({ where: { id: share.id }, data: { approvalId: gate.requiresApproval ? gate.approvalRequestId : null } });
      return { approvalRequired: true, approvalCode: gate.approvalCode, status: gate.status };
    }
    if (gate.requiresApproval) await markApprovalExecuted(gate.approvalRequestId, actor.id);
  }

  const active = await prisma.documentShare.update({ where: { id: share.id }, data: { status: "ACTIVE" } });
  await writeAudit({ action: needsGate ? "DOCUMENT_SHARE_APPROVED" : "DOCUMENT_SHARE_REQUESTED", adminId: actor.type === "ADMIN" ? actor.id : null, targetProfileId: document.profileId ?? undefined, meta: { shareId: share.id, documentId: document.id, recipientType: params.recipientType } });
  return { approvalRequired: false, share: active };
}

async function loadShare(id: string): Promise<DocumentShare> {
  const share = await prisma.documentShare.findUnique({ where: { id } });
  if (!share) throw new HttpError(404, "Share not found.");
  return share;
}

// Used when the generic ApprovalRequest UI resumes a gated share (the approver is a different admin
// than the requester — enforced by the STEP 19 gate itself, never here).
export async function approveShare(actor: SessionAdmin, shareId: string): Promise<DocumentShare> {
  const share = await loadShare(shareId);
  if (share.status !== "PENDING_APPROVAL") throw new HttpError(409, "This share is not awaiting approval.");
  if (share.approvalId) await markApprovalExecuted(share.approvalId, actor.id).catch(() => undefined);
  const updated = await prisma.documentShare.update({ where: { id: shareId }, data: { status: "ACTIVE" } });
  await writeAudit({ action: "DOCUMENT_SHARE_APPROVED", adminId: actor.id, meta: { shareId } });
  return updated;
}

export async function rejectShare(actor: SessionAdmin, shareId: string, reason: string): Promise<DocumentShare> {
  if (reason.trim().length < 5) throw new HttpError(422, "A reason is required.");
  const share = await loadShare(shareId);
  if (!["REQUESTED", "PENDING_APPROVAL"].includes(share.status)) throw new HttpError(409, "This share cannot be rejected from its current state.");
  const updated = await prisma.documentShare.update({ where: { id: shareId }, data: { status: "REJECTED", revokedById: actor.id, revokeReason: reason.trim().slice(0, 300) } });
  await writeAudit({ action: "DOCUMENT_SHARE_REJECTED", adminId: actor.id, meta: { shareId, reason: reason.trim().slice(0, 200) } });
  return updated;
}

export async function revokeShare(actor: DocumentAccessActor, shareId: string, reason: string): Promise<DocumentShare> {
  if (reason.trim().length < 5) throw new HttpError(422, "A reason is required.");
  const share = await loadShare(shareId);
  if (share.status !== "ACTIVE") throw new HttpError(409, "Only an active share can be revoked.");
  if (actor.type === "ADMIN" && !(actor.permissions ?? []).includes("documents:revoke_share")) throw new HttpError(403, "Forbidden: insufficient permissions");
  if (actor.type === "PROFILE" && share.requestedById !== actor.id) throw new HttpError(403, "Forbidden: insufficient permissions");
  const updated = await prisma.documentShare.update({ where: { id: shareId }, data: { status: "REVOKED", revokedAt: new Date(), revokedById: actor.id, revokeReason: reason.trim().slice(0, 300) } });
  await writeAudit({ action: "DOCUMENT_SHARE_REVOKED", adminId: actor.type === "ADMIN" ? actor.id : null, meta: { shareId, reason: reason.trim().slice(0, 200) } });
  return updated;
}

export async function checkSharePermission(recipientType: DocumentShareRecipientType, recipientId: string, documentId: string, scope: DocumentShareScope): Promise<boolean> {
  const share = await prisma.documentShare.findFirst({ where: { documentId, recipientType, recipientId, status: "ACTIVE" } });
  if (!share || share.revokedAt) return false;
  if (share.expiresAt && share.expiresAt.getTime() <= Date.now()) return false;
  if (scope === "DOWNLOAD" && share.scope !== "DOWNLOAD") return false;
  return true;
}

export async function getSharedDocuments(recipientType: DocumentShareRecipientType, recipientId: string) {
  const shares = await prisma.documentShare.findMany({ where: { recipientType, recipientId, status: "ACTIVE" }, orderBy: { createdAt: "desc" } });
  const active = shares.filter((s) => !s.expiresAt || s.expiresAt.getTime() > Date.now());
  if (active.length === 0) return [];
  return prisma.document.findMany({ where: { id: { in: active.map((s) => s.documentId) }, softDeletedAt: null } });
}

// Expire shares whose time has come (daily tick) — never silently: the row is marked EXPIRED, not deleted.
export async function sweepExpiredShares(now = new Date()): Promise<number> {
  const result = await prisma.documentShare.updateMany({ where: { status: "ACTIVE", expiresAt: { lte: now } }, data: { status: "EXPIRED" } });
  return result.count;
}

export async function listSharesForDocument(documentId: string) {
  return prisma.documentShare.findMany({ where: { documentId }, orderBy: { createdAt: "desc" } });
}
