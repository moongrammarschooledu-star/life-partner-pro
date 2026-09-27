import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import type { LegalDocumentType } from "@prisma/client";

// Versioned per document type + jurisdiction (plan §221 comment in schema.prisma);
// never overwritten in place, mirrors VerificationPolicy's own versioned-row
// pattern. contentReference is a storage/URL pointer, never the full document
// text (this table is metadata, not a document store).

export interface CreateDocumentVersionInput {
  documentType: LegalDocumentType;
  version: string;
  jurisdictionId?: string;
  effectiveDate?: Date;
  language?: string;
  contentReference: string;
}

export async function createDocumentVersion(input: CreateDocumentVersionInput, actorId: string) {
  const doc = await prisma.legalDocumentVersion.create({
    data: {
      documentType: input.documentType,
      version: input.version,
      jurisdictionId: input.jurisdictionId ?? null,
      effectiveDate: input.effectiveDate ?? new Date(),
      language: input.language ?? "EN",
      contentReference: input.contentReference,
      approvalStatus: "DRAFT",
      createdById: actorId,
    },
  });
  return doc;
}

// Publishing is the point at which a document version becomes the one
// recordConsent() may reference as `privacyNoticeVersionId` for new consent
// grants (spec §15) — approvalStatus flips DRAFT -> PUBLISHED, audited.
export async function publishDocumentVersion(documentId: string, actorId: string) {
  const doc = await prisma.legalDocumentVersion.update({
    where: { id: documentId },
    data: { approvalStatus: "PUBLISHED" },
  });

  await writeAudit({ action: "LEGAL_DOCUMENT_VERSION_PUBLISHED", adminId: actorId, meta: { documentId, documentType: doc.documentType, version: doc.version } });
  return doc;
}

export async function retireDocumentVersion(documentId: string, actorId: string) {
  const doc = await prisma.legalDocumentVersion.update({
    where: { id: documentId },
    data: { approvalStatus: "RETIRED", retirementDate: new Date() },
  });

  await writeAudit({ action: "LEGAL_DOCUMENT_VERSION_PUBLISHED", adminId: actorId, meta: { documentId, retired: true } });
  return doc;
}

// The version an applicant is currently expected to accept — the latest
// PUBLISHED version for a document type, preferring an exact jurisdiction
// match over a jurisdiction-less (global) version.
export async function getCurrentDocumentVersion(documentType: LegalDocumentType, jurisdictionId?: string, language: string = "EN") {
  if (jurisdictionId) {
    const scoped = await prisma.legalDocumentVersion.findFirst({
      where: { documentType, jurisdictionId, language, approvalStatus: "PUBLISHED" },
      orderBy: { effectiveDate: "desc" },
    });
    if (scoped) return scoped;
  }
  return prisma.legalDocumentVersion.findFirst({
    where: { documentType, jurisdictionId: null, language, approvalStatus: "PUBLISHED" },
    orderBy: { effectiveDate: "desc" },
  });
}

export async function listDocumentVersions(documentType?: LegalDocumentType) {
  return prisma.legalDocumentVersion.findMany({
    where: { ...(documentType && { documentType }) },
    orderBy: [{ documentType: "asc" }, { effectiveDate: "desc" }],
  });
}
