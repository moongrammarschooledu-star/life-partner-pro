import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import type { DocumentAccessAction, AuditAction } from "@prisma/client";
import type { DocumentAccessActor, DocumentDenialReason } from "@/lib/documents/access-service";

// Per-document timeline (spec §56) — every entry ALSO goes to the global AuditLog (writeAudit) for the
// platform-wide feed, exactly like STEP 25's CommunicationDeliveryEvent + AuditLog pairing.

const ACTION_TO_AUDIT: Partial<Record<DocumentAccessAction, AuditAction>> = {
  VIEW: "DOCUMENT_VIEWED",
  PREVIEW: "DOCUMENT_PREVIEWED",
  DOWNLOAD: "DOCUMENT_DOWNLOADED",
  SHARE: "DOCUMENT_SHARE_REQUESTED",
  VERIFY: "DOCUMENT_APPROVED",
  APPROVE: "DOCUMENT_APPROVED",
  REJECT: "DOCUMENT_REJECTED",
  REDACT: "DOCUMENT_REDACTED",
  EXPORT: "DOCUMENT_EXPORTED",
  DELETE: "DOCUMENT_DELETED",
  RESTORE: "DOCUMENT_RESTORED",
};

export async function logDocumentAccess(
  documentId: string,
  action: DocumentAccessAction,
  actor: DocumentAccessActor,
  result: "ALLOWED" | "DENIED",
  extra: { purpose?: string; denialReason?: DocumentDenialReason; profileId?: string | null } = {}
): Promise<void> {
  try {
    await prisma.documentAccessLog.create({
      data: {
        documentId,
        action,
        actorType: actor.type,
        actorId: actor.id,
        purpose: extra.purpose?.slice(0, 300) ?? null,
        result,
        denialReason: extra.denialReason ?? null,
      },
    });
  } catch {
    // the per-document timeline is best-effort; it must never break the caller's request
  }
  const auditAction = ACTION_TO_AUDIT[action];
  if (auditAction && result === "ALLOWED") {
    await writeAudit({ action: auditAction, adminId: actor.type === "ADMIN" ? actor.id : null, targetProfileId: extra.profileId ?? undefined, meta: { documentId, actorType: actor.type, actorId: actor.id } });
  }
}
