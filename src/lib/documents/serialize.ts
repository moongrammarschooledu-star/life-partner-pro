import type { Document } from "@prisma/client";

// The public shape of a Document — NEVER includes secureStorageReference/ivBase64/authTagBase64 (the raw
// blob key must never reach the client, spec §7) and never the file bytes themselves.
export function serializeDocument(d: Document) {
  return {
    id: d.id,
    documentCode: d.documentCode,
    ownerType: d.ownerType,
    typeKey: d.typeKey,
    categoryKey: d.categoryKey,
    classification: d.classification,
    status: d.status,
    currentVersion: d.currentVersion,
    mimeType: d.mimeType,
    originalFilename: d.originalFilename,
    sizeBytes: d.sizeBytes,
    verificationStatus: d.verificationStatus,
    verificationReason: d.verificationReason,
    verificationNotes: d.verificationNotes,
    reviewedAt: d.reviewedAt,
    expiresAt: d.expiresAt,
    archivedAt: d.archivedAt,
    contentAvailable: !d.bodyRedactedAt,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}
