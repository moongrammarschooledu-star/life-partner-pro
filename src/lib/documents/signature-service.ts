import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { HttpError } from "@/lib/http-error";
import { nextSequenceCode } from "@/lib/privacy/codes";
import type { SessionAdmin } from "@/lib/route-guard";
import type { Document, DocumentSignatureRequest, DocumentUploaderType } from "@prisma/client";
import { localSignatureProvider } from "@/lib/documents/providers/local-signature-provider";
import type { DocumentSignatureProvider } from "@/lib/documents/providers/types";

// DocumentSignatureService (spec §41-§43). Workflow: create -> send -> each recipient views, explicitly
// consents and types their full legal name -> once every recipient has signed, the request is SIGNED.
// Every step is recorded in DocumentSignatureEvent with the document's hash at that moment (tamper
// evidence). See providers/local-signature-provider.ts for why this is never represented as a
// cryptographic/legally-binding signature by default.

const PROVIDERS: Record<string, DocumentSignatureProvider> = { LOCAL: localSignatureProvider };

function providerFor(key: string): DocumentSignatureProvider {
  return PROVIDERS[key] ?? localSignatureProvider;
}

export interface CreateSignatureRequestInput {
  documentId: string;
  recipients: Array<{ recipientType: DocumentUploaderType; recipientId: string }>;
  message?: string;
  expiresAt?: Date | null;
}

async function loadDocument(id: string): Promise<Document> {
  const doc = await prisma.document.findUnique({ where: { id } });
  if (!doc) throw new HttpError(404, "Document not found.");
  return doc;
}

async function recordEvent(requestId: string, eventType: string, extra: { recipientType?: DocumentUploaderType | null; recipientId?: string | null; documentHash?: string | null } = {}) {
  await prisma.documentSignatureEvent.create({ data: { requestId, eventType, recipientType: extra.recipientType ?? null, recipientId: extra.recipientId ?? null, documentHash: extra.documentHash ?? null } });
}

export async function createSignatureRequest(actor: SessionAdmin, input: CreateSignatureRequestInput): Promise<DocumentSignatureRequest> {
  if (input.recipients.length === 0) throw new HttpError(422, "At least one signer is required.");
  const document = await loadDocument(input.documentId);
  if (document.status === "RESTRICTED" || document.softDeletedAt) throw new HttpError(409, "This document cannot be sent for signature.");

  const provider = providerFor("LOCAL");
  const created = await provider.createSignatureRequest({ documentId: document.id, signers: input.recipients.map((r) => ({ recipientType: r.recipientType, recipientId: r.recipientId })) });
  if (!created.ok) throw new HttpError(502, created.error ?? "Could not create the signature request.");

  const signCode = await nextSequenceCode("SIGN");
  const request = await prisma.documentSignatureRequest.create({
    data: { signCode, documentId: document.id, provider: provider.key, status: "SENT", requestedById: actor.id, message: input.message?.slice(0, 1000) ?? null, expiresAt: input.expiresAt ?? null },
  });
  await prisma.documentSignatureRecipient.createMany({ data: input.recipients.map((r, i) => ({ requestId: request.id, recipientType: r.recipientType, recipientId: r.recipientId, order: i + 1, status: "SENT" })) });
  await recordEvent(request.id, "SENT", { documentHash: document.fileHash });
  await writeAudit({ action: "DOCUMENT_SIGNATURE_REQUESTED", adminId: actor.id, targetProfileId: document.profileId ?? undefined, meta: { requestId: request.id, signCode, documentId: document.id } });

  for (const r of input.recipients) {
    if (r.recipientType === "PROFILE") {
      const { sendNotification } = await import("@/lib/notifications/notification-service");
      await sendNotification({ profileId: r.recipientId, type: "DOCUMENT_SIGNATURE_REQUEST", data: { relatedProfileId: r.recipientId } });
    }
  }
  return request;
}

async function loadRequest(id: string): Promise<DocumentSignatureRequest> {
  const req = await prisma.documentSignatureRequest.findUnique({ where: { id } });
  if (!req) throw new HttpError(404, "Signature request not found.");
  return req;
}

export async function markViewed(requestId: string, recipientType: DocumentUploaderType, recipientId: string): Promise<void> {
  const recipient = await prisma.documentSignatureRecipient.findFirst({ where: { requestId, recipientType, recipientId } });
  if (!recipient || recipient.status !== "SENT") return;
  await prisma.documentSignatureRecipient.update({ where: { id: recipient.id }, data: { status: "VIEWED", viewedAt: new Date() } });
  await prisma.documentSignatureRequest.updateMany({ where: { id: requestId, status: "SENT" }, data: { status: "VIEWED" } });
  await recordEvent(requestId, "VIEWED", { recipientType, recipientId });
}

export interface SignParams {
  requestId: string;
  recipientType: DocumentUploaderType;
  recipientId: string;
  typedFullName: string;
  consented: boolean;
  ipHash?: string;
}

// The actual "signature": an authenticated session + an explicit consent checkbox + the recipient's
// own typed full legal name, recorded against the document's CURRENT hash (spec §43/§44).
export async function signDocument(params: SignParams): Promise<DocumentSignatureRequest> {
  if (!params.consented) throw new HttpError(422, "Consent is required to sign.");
  if (params.typedFullName.trim().length < 2) throw new HttpError(422, "Please type your full legal name.");
  const request = await loadRequest(params.requestId);
  if (!["SENT", "VIEWED", "PARTIALLY_SIGNED"].includes(request.status)) throw new HttpError(409, "This signature request is no longer open.");
  if (request.expiresAt && request.expiresAt.getTime() < Date.now()) throw new HttpError(409, "This signature request has expired.");

  const recipient = await prisma.documentSignatureRecipient.findFirst({ where: { requestId: params.requestId, recipientType: params.recipientType, recipientId: params.recipientId } });
  if (!recipient) throw new HttpError(403, "You were not asked to sign this document.");
  if (recipient.status === "SIGNED") throw new HttpError(409, "You have already signed this document.");
  if (recipient.status === "DECLINED") throw new HttpError(409, "You have already declined this document.");

  const document = await loadDocument(request.documentId);
  await prisma.documentSignatureRecipient.update({ where: { id: recipient.id }, data: { status: "SIGNED", signedAt: new Date(), signedName: params.typedFullName.trim().slice(0, 200), ipHash: params.ipHash ?? null } });
  await recordEvent(request.id, "SIGNED", { recipientType: params.recipientType, recipientId: params.recipientId, documentHash: document.fileHash });

  const remaining = await prisma.documentSignatureRecipient.count({ where: { requestId: request.id, status: { not: "SIGNED" } } });
  let signedDocumentVersionId: string | undefined;
  if (remaining === 0) {
    const version = await prisma.documentVersion.findUnique({ where: { documentId_version: { documentId: document.id, version: document.currentVersion } } });
    signedDocumentVersionId = version?.id;
  }
  const updated = await prisma.documentSignatureRequest.update({
    where: { id: request.id },
    data: { status: remaining === 0 ? "SIGNED" : "PARTIALLY_SIGNED", ...(signedDocumentVersionId ? { signedDocumentVersionId } : {}) },
  });
  if (remaining === 0) await writeAudit({ action: "DOCUMENT_SIGNATURE_SIGNED", targetProfileId: document.profileId ?? undefined, meta: { requestId: request.id, documentId: document.id } });
  return updated;
}

export async function declineSignature(requestId: string, recipientType: DocumentUploaderType, recipientId: string, reason?: string): Promise<DocumentSignatureRequest> {
  const recipient = await prisma.documentSignatureRecipient.findFirst({ where: { requestId, recipientType, recipientId } });
  if (!recipient) throw new HttpError(403, "You were not asked to sign this document.");
  await prisma.documentSignatureRecipient.update({ where: { id: recipient.id }, data: { status: "DECLINED", declinedAt: new Date(), declineReason: reason?.slice(0, 300) ?? null } });
  await recordEvent(requestId, "DECLINED", { recipientType, recipientId });
  const updated = await prisma.documentSignatureRequest.update({ where: { id: requestId }, data: { status: "DECLINED" } });
  await writeAudit({ action: "DOCUMENT_SIGNATURE_DECLINED", meta: { requestId, recipientType, recipientId } });
  return updated;
}

export async function voidSignatureRequest(actor: SessionAdmin, requestId: string, reason: string): Promise<DocumentSignatureRequest> {
  if (reason.trim().length < 5) throw new HttpError(422, "A reason is required.");
  const request = await loadRequest(requestId);
  if (["SIGNED", "VOIDED", "DECLINED", "EXPIRED", "FAILED"].includes(request.status)) throw new HttpError(409, "This request can no longer be voided.");
  const provider = providerFor(request.provider);
  await provider.voidSignatureRequest(request.id, reason);
  const updated = await prisma.documentSignatureRequest.update({ where: { id: requestId }, data: { status: "VOIDED", voidedAt: new Date(), voidedById: actor.id, voidReason: reason.trim().slice(0, 300) } });
  await recordEvent(requestId, "VOIDED");
  await writeAudit({ action: "DOCUMENT_SIGNATURE_VOIDED", adminId: actor.id, meta: { requestId, reason: reason.trim().slice(0, 200) } });
  return updated;
}

export async function getSignatureRequest(requestId: string) {
  const request = await loadRequest(requestId);
  const recipients = await prisma.documentSignatureRecipient.findMany({ where: { requestId }, orderBy: { order: "asc" } });
  const events = await prisma.documentSignatureEvent.findMany({ where: { requestId }, orderBy: { createdAt: "asc" } });
  return { request, recipients, events };
}

export async function listSignatureRequestsForRecipient(recipientType: DocumentUploaderType, recipientId: string) {
  const recipients = await prisma.documentSignatureRecipient.findMany({ where: { recipientType, recipientId }, select: { requestId: true } });
  if (recipients.length === 0) return [];
  return prisma.documentSignatureRequest.findMany({ where: { id: { in: recipients.map((r) => r.requestId) } }, orderBy: { createdAt: "desc" } });
}

// Sweep expired signature requests (daily tick).
export async function sweepExpiredSignatureRequests(now = new Date()): Promise<number> {
  const result = await prisma.documentSignatureRequest.updateMany({ where: { status: { in: ["SENT", "VIEWED", "PARTIALLY_SIGNED"] }, expiresAt: { lte: now } }, data: { status: "EXPIRED" } });
  return result.count;
}
