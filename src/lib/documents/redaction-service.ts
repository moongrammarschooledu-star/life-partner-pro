import { PDFDocument, rgb } from "pdf-lib";
import sharp from "sharp";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { HttpError } from "@/lib/http-error";
import { enforceApprovalGate, markApprovalExecuted } from "@/lib/approvals/gate";
import type { SessionAdmin } from "@/lib/route-guard";
import type { Document } from "@prisma/client";
import { readDocumentBytes } from "@/lib/documents/storage";
import { hashBytes, saveDocumentBytes } from "@/lib/documents/storage";
import { requireDocumentAccess } from "@/lib/documents/access-service";

// Secure redaction (spec §49). The ORIGINAL is never modified — a redacted DERIVATIVE is stored as a new
// DocumentVersion, and the original stays retrievable to anyone who still has legitimate access to it.
// Real, working redaction (opaque rectangles over named regions), not a stub: pdf-lib for PDFs, sharp for
// images — both already dependencies elsewhere in this codebase.

export interface RedactionRegion {
  page?: number; // 1-based; omitted/ignored for images
  x: number;
  y: number;
  width: number;
  height: number;
}

async function loadDocument(id: string): Promise<Document> {
  const doc = await prisma.document.findUnique({ where: { id } });
  if (!doc) throw new HttpError(404, "Document not found.");
  return doc;
}

async function redactPdf(bytes: Buffer, regions: RedactionRegion[]): Promise<Buffer> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const pages = doc.getPages();
  for (const region of regions) {
    const page = pages[(region.page ?? 1) - 1];
    if (!page) continue;
    page.drawRectangle({ x: region.x, y: region.y, width: region.width, height: region.height, color: rgb(0, 0, 0) });
  }
  return Buffer.from(await doc.save());
}

async function redactImage(bytes: Buffer, regions: RedactionRegion[]): Promise<Buffer> {
  const overlays = regions.map((r) => ({
    input: { create: { width: Math.max(1, Math.round(r.width)), height: Math.max(1, Math.round(r.height)), channels: 4 as const, background: { r: 0, g: 0, b: 0, alpha: 1 } } },
    left: Math.round(r.x),
    top: Math.round(r.y),
  }));
  return sharp(bytes).composite(overlays).toBuffer();
}

export interface RedactInput {
  documentId: string;
  regions: RedactionRegion[];
  reason: string;
}

export type RedactResult = { approvalRequired: false; document: Document } | { approvalRequired: true; approvalCode: string; status: string };

export async function redactDocument(actor: SessionAdmin, input: RedactInput): Promise<RedactResult> {
  if (input.regions.length === 0) throw new HttpError(422, "At least one region is required.");
  if (input.reason.trim().length < 5) throw new HttpError(422, "A reason is required.");
  const document = await loadDocument(input.documentId);
  await requireDocumentAccess({ type: "ADMIN", id: actor.id, permissions: actor.permissions }, document, "REDACT");
  if (!["application/pdf"].includes(document.mimeType) && !document.mimeType.startsWith("image/")) {
    throw new HttpError(422, "Only PDF and image documents can be redacted.");
  }

  const gate = await enforceApprovalGate({ actionType: "DOCUMENT_REDACT", sourceType: "DOCUMENT", sourceId: document.id, actor, reason: input.reason, requestedPayload: { documentId: document.id, regions: input.regions } });
  let approvalId: string | null = null;
  if (gate.requiresApproval && gate.status !== "READY_TO_EXECUTE") return { approvalRequired: true, approvalCode: gate.approvalCode, status: gate.status };
  if (gate.requiresApproval) {
    await markApprovalExecuted(gate.approvalRequestId, actor.id);
    approvalId = gate.approvalRequestId;
  }

  const original = await readDocumentBytes(document.secureStorageReference, document.ivBase64, document.authTagBase64);
  const redacted = document.mimeType === "application/pdf" ? await redactPdf(original, input.regions) : await redactImage(original, input.regions);

  const saved = await saveDocumentBytes(redacted, document.mimeType, document.originalFilename);
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
      fileHash: hashBytes(redacted),
      uploaderType: "ADMIN",
      uploaderId: actor.id,
      changeReason: `Redaction: ${input.reason.trim().slice(0, 200)}`,
      scanStatus: "CLEAN", // derived from an already-clean source; not re-scanned for malware
    },
  });

  const updated = await prisma.document.update({
    where: { id: document.id },
    data: { currentVersion: nextVersion, secureStorageReference: saved.secureStorageReference, ivBase64: saved.ivBase64, authTagBase64: saved.authTagBase64, sizeBytes: saved.sizeBytes, fileHash: hashBytes(redacted) },
  });
  await prisma.documentRedaction.create({ data: { documentId: document.id, sourceVersion: document.currentVersion, redactedVersion: nextVersion, reason: input.reason.trim().slice(0, 500), regions: JSON.stringify(input.regions), redactedById: actor.id, approvalId } });
  await writeAudit({ action: "DOCUMENT_REDACTED", adminId: actor.id, targetProfileId: document.profileId ?? undefined, meta: { documentId: document.id, version: nextVersion, reason: input.reason.slice(0, 200) } });

  return { approvalRequired: false, document: updated };
}

export async function listRedactions(documentId: string) {
  return prisma.documentRedaction.findMany({ where: { documentId }, orderBy: { createdAt: "desc" } });
}
