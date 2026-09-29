import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { HttpError } from "@/lib/http-error";
import { nextSequenceCode } from "@/lib/privacy/codes";
import { publishSecurityEvent } from "@/lib/security/event-bus";
import { hasActiveRestriction } from "@/lib/profile-restrictions";
import type { Document, DocumentOwnerType, DocumentUploaderType } from "@prisma/client";
import { getTypeConfig } from "@/lib/documents/catalog";
import { saveDocumentBytes, readDocumentBytes, verifyIntegrity, DocumentUploadError } from "@/lib/documents/storage";
import { DocumentSecurityScanner } from "@/lib/documents/security-scanner";
import { requireDocumentAccess, type DocumentAccessActor } from "@/lib/documents/access-service";
import { logDocumentAccess } from "@/lib/documents/audit-log";

// The upload pipeline (spec §1): validate -> scan -> classify -> encrypt+store -> record. Never makes a
// document AVAILABLE before a clean (or at least non-blocking) scan result, and never skips the human
// review step the platform-wide "Human-Reviewed" requirement asks for — see the task creation below.

export interface CreateDocumentInput {
  ownerType: DocumentOwnerType;
  ownerId: string;
  profileId?: string | null;
  typeKey: string;
  uploaderType: DocumentUploaderType;
  uploaderId: string;
  file: Buffer;
  mimeType: string;
  filename?: string | null;
  expiresAt?: Date | null;
  caseId?: string | null;
  proposalId?: string | null;
  requestId?: string | null;
}

export interface CreateDocumentResult {
  document: Document;
  quarantined: boolean;
}

async function assertUploaderNotRestricted(uploaderType: DocumentUploaderType, uploaderId: string): Promise<void> {
  if (uploaderType !== "PROFILE") return;
  if ((await hasActiveRestriction(uploaderId, "DOCUMENT_ACCESS_RESTRICTED")) || (await hasActiveRestriction(uploaderId, "FULL_ACCOUNT_RESTRICTED"))) {
    throw new HttpError(403, "Uploads are currently restricted on this account.");
  }
}

export async function createDocument(input: CreateDocumentInput): Promise<CreateDocumentResult> {
  await assertUploaderNotRestricted(input.uploaderType, input.uploaderId);
  const type = await getTypeConfig(input.typeKey);

  let saved;
  try {
    saved = await saveDocumentBytes(input.file, input.mimeType, input.filename);
  } catch (error) {
    if (error instanceof DocumentUploadError) {
      await publishSecurityEvent({ eventType: "DOCUMENT_UPLOAD_REJECTED", profileId: input.profileId ?? undefined, meta: { reason: error.message.slice(0, 120), typeKey: input.typeKey } }).catch(() => undefined);
      throw new HttpError(400, error.message);
    }
    throw error;
  }

  const scan = await DocumentSecurityScanner.scanFile(input.file, saved.mimeType as never);
  const quarantined = scan.status === "INFECTED" || scan.status === "SUSPICIOUS" || scan.status === "SCAN_FAILED";
  if (scan.status === "INFECTED" || scan.status === "SUSPICIOUS") {
    await publishSecurityEvent({ eventType: "DOCUMENT_SCAN_SUSPICIOUS", profileId: input.profileId ?? undefined, meta: { typeKey: input.typeKey, findings: scan.findings.map((f) => f.code) } }).catch(() => undefined);
  }

  const documentCode = await nextSequenceCode("DOC");
  const document = await prisma.document.create({
    data: {
      documentCode,
      ownerType: input.ownerType,
      ownerId: input.ownerId,
      profileId: input.profileId ?? null,
      typeKey: type.key,
      categoryKey: type.categoryKey,
      classification: type.defaultClassification,
      status: quarantined ? "QUARANTINED" : "AVAILABLE",
      currentVersion: 1,
      secureStorageReference: saved.secureStorageReference,
      ivBase64: saved.ivBase64,
      authTagBase64: saved.authTagBase64,
      mimeType: saved.mimeType,
      originalFilename: saved.originalFilename,
      sizeBytes: saved.sizeBytes,
      fileHash: saved.fileHash,
      uploaderType: input.uploaderType,
      uploaderId: input.uploaderId,
      verificationStatus: quarantined ? "NOT_SUBMITTED" : "PENDING",
      expiresAt: input.expiresAt ?? null,
      proposalId: input.proposalId ?? null,
      caseId: input.caseId ?? null,
      requestId: input.requestId ?? null,
    },
  });

  await prisma.documentVersion.create({
    data: {
      documentId: document.id,
      version: 1,
      secureStorageReference: saved.secureStorageReference,
      ivBase64: saved.ivBase64,
      authTagBase64: saved.authTagBase64,
      mimeType: saved.mimeType,
      sizeBytes: saved.sizeBytes,
      fileHash: saved.fileHash,
      uploaderType: input.uploaderType,
      uploaderId: input.uploaderId,
      scanStatus: scan.status,
      verificationStatus: document.verificationStatus,
    },
  });
  await DocumentSecurityScanner.recordScan(document.id, 1, scan);

  await writeAudit({ action: "DOCUMENT_UPLOADED", targetProfileId: input.profileId ?? undefined, meta: { documentId: document.id, documentCode, typeKey: type.key, quarantined } });
  await publishSecurityEvent({ eventType: "DOCUMENT_UPLOADED", profileId: input.profileId ?? undefined, meta: { documentId: document.id, typeKey: type.key } }).catch(() => undefined);

  if (!quarantined) {
    const { createFromEvent } = await import("@/lib/workflow/engine");
    await createFromEvent({
      eventName: "DOCUMENT_REVIEW_TASK",
      dedupKey: `DOCUMENT_REVIEW:${document.id}`,
      resourceType: "DOCUMENT",
      resourceId: document.id,
      taskType: "DOCUMENT_REVIEW_TASK",
      title: "A document needs review",
      description: `${type.label} document ${documentCode} is waiting for review.`,
    });
  } else {
    const { createFromEvent } = await import("@/lib/workflow/engine");
    await createFromEvent({
      eventName: "DOCUMENT_SECURITY_TASK",
      dedupKey: `DOCUMENT_SECURITY:${document.id}`,
      resourceType: "DOCUMENT",
      resourceId: document.id,
      taskType: "DOCUMENT_SECURITY_TASK",
      title: "A document was quarantined",
      description: `${type.label} document ${documentCode} was quarantined by the security scan (${scan.findings.map((f) => f.code).join(", ") || scan.status}).`,
    });
  }

  if (input.requestId) {
    const { fulfillRequest } = await import("@/lib/documents/request-service");
    await fulfillRequest(input.requestId, document.id, input.uploaderType, input.uploaderId).catch(() => undefined); // a mismatched/closed request must never block the upload itself
  }

  return { document, quarantined };
}

export async function getDocumentOr404(documentId: string): Promise<Document> {
  const document = await prisma.document.findUnique({ where: { id: documentId } });
  if (!document) throw new HttpError(404, "Document not found.");
  return document;
}

export async function listDocumentsForOwner(ownerType: DocumentOwnerType, ownerId: string) {
  return prisma.document.findMany({ where: { ownerType, ownerId, softDeletedAt: null }, orderBy: { createdAt: "desc" }, take: 200 });
}

export async function listDocumentsForProfile(profileId: string, opts: { includeArchived?: boolean } = {}) {
  return prisma.document.findMany({
    where: { profileId, softDeletedAt: null, ...(opts.includeArchived ? {} : { archivedAt: null }) },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
}

// Streams the decrypted bytes ONLY after the caller has already checked access (route-level) — this
// function assumes that check has passed and just re-verifies the file's integrity (spec §44/§45).
export async function readDocumentForDelivery(document: Document): Promise<Buffer> {
  if (document.bodyRedactedAt) throw new HttpError(410, "This document's content was removed by the retention policy; only its metadata is retained.");
  const bytes = await readDocumentBytes(document.secureStorageReference, document.ivBase64, document.authTagBase64);
  if (!verifyIntegrity(bytes, document.fileHash)) {
    await publishSecurityEvent({ eventType: "DOCUMENT_TAMPER_DETECTED", profileId: document.profileId ?? undefined, meta: { documentId: document.id } }).catch(() => undefined);
    await prisma.documentAccessLog.create({ data: { documentId: document.id, action: "DOWNLOAD", actorType: "SYSTEM", actorId: "integrity-check", result: "DENIED", denialReason: "DOCUMENT_INTEGRITY_ERROR" } }).catch(() => undefined);
    throw new HttpError(409, "This document failed an integrity check and cannot be delivered. It has been flagged for review.");
  }
  return bytes;
}

// Convenience wrapper used by the streaming API routes: checks access, logs it, and returns bytes.
export async function fetchDocumentBytes(actor: DocumentAccessActor, documentId: string, action: "PREVIEW" | "DOWNLOAD"): Promise<{ document: Document; bytes: Buffer }> {
  const document = await getDocumentOr404(documentId);
  await requireDocumentAccess(actor, document, action);
  const bytes = await readDocumentForDelivery(document);
  await logDocumentAccess(document.id, action, actor, "ALLOWED");
  return { document, bytes };
}

// ---------------------------------------------------------------- versioning (spec §33/§34)

export interface ReplaceDocumentInput {
  documentId: string;
  uploaderType: DocumentUploaderType;
  uploaderId: string;
  uploaderPermissions?: readonly string[]; // ADMIN only
  file: Buffer;
  mimeType: string;
  filename?: string | null;
  changeReason: string;
}

function assertMayReplace(document: Document, input: ReplaceDocumentInput): void {
  if (input.uploaderType === "PROFILE") {
    const isOwner = document.profileId === input.uploaderId || (document.ownerType === "PROFILE" && document.ownerId === input.uploaderId);
    if (!isOwner) throw new HttpError(403, "Forbidden: insufficient permissions");
    return;
  }
  if (input.uploaderType === "ADMIN") {
    if (!(input.uploaderPermissions ?? []).includes("documents:upload") && !(input.uploaderPermissions ?? []).includes("documents:edit")) {
      throw new HttpError(403, "Forbidden: insufficient permissions");
    }
    return;
  }
  throw new HttpError(403, "Forbidden: insufficient permissions"); // family members and the system never replace a document's bytes
}

// A replacement is a NEW version — the previous one is kept (never overwritten) and history stays intact.
// The document goes back through scanning and review exactly like a first upload; only the version
// number and change history distinguish it.
export async function replaceDocument(input: ReplaceDocumentInput): Promise<CreateDocumentResult> {
  const document = await getDocumentOr404(input.documentId);
  if (document.softDeletedAt || document.status === "ARCHIVED") throw new HttpError(409, "This document cannot be replaced.");
  if (input.changeReason.trim().length < 3) throw new HttpError(422, "A reason for the change is required.");
  assertMayReplace(document, input);

  let saved;
  try {
    saved = await saveDocumentBytes(input.file, input.mimeType, input.filename ?? document.originalFilename);
  } catch (error) {
    if (error instanceof DocumentUploadError) throw new HttpError(400, error.message);
    throw error;
  }
  const scan = await DocumentSecurityScanner.scanFile(input.file, saved.mimeType as never);
  const quarantined = scan.status === "INFECTED" || scan.status === "SUSPICIOUS" || scan.status === "SCAN_FAILED";
  const nextVersion = document.currentVersion + 1;

  await prisma.documentVersion.create({
    data: {
      documentId: document.id,
      version: nextVersion,
      previousVersion: document.currentVersion,
      secureStorageReference: saved.secureStorageReference,
      ivBase64: saved.ivBase64,
      authTagBase64: saved.authTagBase64,
      mimeType: saved.mimeType,
      sizeBytes: saved.sizeBytes,
      fileHash: saved.fileHash,
      uploaderType: input.uploaderType,
      uploaderId: input.uploaderId,
      changeReason: input.changeReason.trim().slice(0, 500),
      scanStatus: scan.status,
      verificationStatus: quarantined ? "NOT_SUBMITTED" : "PENDING",
    },
  });
  await DocumentSecurityScanner.recordScan(document.id, nextVersion, scan);

  const updated = await prisma.document.update({
    where: { id: document.id },
    data: {
      currentVersion: nextVersion,
      secureStorageReference: saved.secureStorageReference,
      ivBase64: saved.ivBase64,
      authTagBase64: saved.authTagBase64,
      mimeType: saved.mimeType,
      originalFilename: saved.originalFilename,
      sizeBytes: saved.sizeBytes,
      fileHash: saved.fileHash,
      status: quarantined ? "QUARANTINED" : "AVAILABLE",
      verificationStatus: quarantined ? "NOT_SUBMITTED" : "PENDING",
      reviewedById: null,
      reviewedAt: null,
      verificationReason: null,
      verificationNotes: null,
      bodyRedactedAt: null,
    },
  });
  await writeAudit({ action: "DOCUMENT_VERSION_CREATED", targetProfileId: document.profileId ?? undefined, meta: { documentId: document.id, version: nextVersion, changeReason: input.changeReason.slice(0, 200) } });

  if (!quarantined) {
    const { createFromEvent } = await import("@/lib/workflow/engine");
    await createFromEvent({ eventName: "DOCUMENT_REVIEW_TASK", dedupKey: `DOCUMENT_REVIEW:${document.id}:v${nextVersion}`, resourceType: "DOCUMENT", resourceId: document.id, taskType: "DOCUMENT_REVIEW_TASK", title: "A replacement document needs review", description: `Document ${document.documentCode} v${nextVersion} is waiting for review.` });
  }
  return { document: updated, quarantined };
}

export async function listVersions(documentId: string) {
  await getDocumentOr404(documentId);
  return prisma.documentVersion.findMany({ where: { documentId }, orderBy: { version: "desc" } });
}

// ---------------------------------------------------------------- lifecycle (archive / restore / delete)

// Archiving is an admin action (spec §22's Archived tab / bulk archive) — a real permission of its own,
// checked directly rather than piggybacking on documents:delete.
export async function archiveDocument(actor: DocumentAccessActor, documentId: string): Promise<Document> {
  const document = await getDocumentOr404(documentId);
  if (actor.type !== "ADMIN" || !(actor.permissions ?? []).includes("documents:archive")) throw new HttpError(403, "Forbidden: insufficient permissions");
  const updated = await prisma.document.update({ where: { id: documentId }, data: { archivedAt: new Date(), status: "ARCHIVED" } });
  await logDocumentAccess(documentId, "DELETE", actor, "ALLOWED", { profileId: document.profileId, purpose: "ARCHIVE" });
  await writeAudit({ action: "DOCUMENT_ARCHIVED", adminId: actor.id, targetProfileId: document.profileId ?? undefined, meta: { documentId } });
  return updated;
}

export async function restoreDocument(actor: DocumentAccessActor, documentId: string): Promise<Document> {
  const document = await getDocumentOr404(documentId);
  await requireDocumentAccess(actor, document, "RESTORE");
  const updated = await prisma.document.update({ where: { id: documentId }, data: { archivedAt: null, softDeletedAt: null, status: "AVAILABLE" } });
  await writeAudit({ action: "DOCUMENT_RESTORED", adminId: actor.type === "ADMIN" ? actor.id : null, targetProfileId: document.profileId ?? undefined, meta: { documentId } });
  return updated;
}

// Soft delete: the row stays (retention/legal-hold apparatus needs it); DELETE access already refuses
// this when a legal hold is active (see access-service.ts).
export async function softDeleteDocument(actor: DocumentAccessActor, documentId: string, reason: string): Promise<Document> {
  if (reason.trim().length < 5) throw new HttpError(422, "A reason is required.");
  const document = await getDocumentOr404(documentId);
  await requireDocumentAccess(actor, document, "DELETE");
  const updated = await prisma.document.update({ where: { id: documentId }, data: { softDeletedAt: new Date(), status: "DELETED" } });
  await logDocumentAccess(documentId, "DELETE", actor, "ALLOWED", { profileId: document.profileId, purpose: reason });
  await writeAudit({ action: "DOCUMENT_DELETED", adminId: actor.type === "ADMIN" ? actor.id : null, targetProfileId: document.profileId ?? undefined, meta: { documentId, reason: reason.trim().slice(0, 200) } });
  return updated;
}
