import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { HttpError } from "@/lib/http-error";
import { nextSequenceCode } from "@/lib/privacy/codes";
import type { SessionAdmin } from "@/lib/route-guard";
import type { DocumentRequest, DocumentUploaderType } from "@prisma/client";
import { getTypeConfig } from "@/lib/documents/catalog";

// Admin -> applicant document requests (spec §37/§38). Neutral, non-threatening copy only — the
// notification templates (default-templates.ts) carry the wording, this service only carries the data.

export interface CreateRequestInput {
  typeKey: string;
  purpose: string;
  requestedFromType: DocumentUploaderType;
  requestedFromId: string;
  dueDate?: Date | null;
  priority?: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  instructions?: string | null;
  assignedToId?: string | null;
}

export async function createRequest(actor: SessionAdmin, input: CreateRequestInput): Promise<DocumentRequest> {
  await getTypeConfig(input.typeKey); // validates the type exists and is active
  if (!input.purpose.trim()) throw new HttpError(422, "A purpose is required.");
  const requestCode = await nextSequenceCode("DREQ");
  const request = await prisma.documentRequest.create({
    data: {
      requestCode,
      typeKey: input.typeKey,
      purpose: input.purpose.trim().slice(0, 500),
      requestedFromType: input.requestedFromType,
      requestedFromId: input.requestedFromId,
      dueDate: input.dueDate ?? null,
      priority: input.priority ?? "NORMAL",
      instructions: input.instructions?.slice(0, 2000) ?? null,
      assignedToId: input.assignedToId ?? null,
      status: "SENT",
      createdById: actor.id,
    },
  });
  await prisma.documentRequestEvent.create({ data: { requestId: request.id, eventType: "SENT", actorType: "ADMIN", actorId: actor.id } });
  await writeAudit({ action: "DOCUMENT_REQUEST_CREATED", adminId: actor.id, targetProfileId: input.requestedFromType === "PROFILE" ? input.requestedFromId : undefined, meta: { requestId: request.id, requestCode, typeKey: input.typeKey } });

  if (input.requestedFromType === "PROFILE") {
    const { sendNotification } = await import("@/lib/notifications/notification-service");
    await sendNotification({ profileId: input.requestedFromId, type: "DOCUMENT_REQUESTED", data: { relatedProfileId: input.requestedFromId } });
  }
  return request;
}

async function loadRequest(id: string): Promise<DocumentRequest> {
  const req = await prisma.documentRequest.findUnique({ where: { id } });
  if (!req) throw new HttpError(404, "Document request not found.");
  return req;
}

export async function markViewed(requestId: string, viewerType: DocumentUploaderType, viewerId: string): Promise<void> {
  const req = await prisma.documentRequest.findUnique({ where: { id: requestId } });
  if (!req || req.requestedFromType !== viewerType || req.requestedFromId !== viewerId) return;
  if (req.status === "SENT") {
    await prisma.documentRequest.update({ where: { id: requestId }, data: { status: "VIEWED" } });
    await prisma.documentRequestEvent.create({ data: { requestId, eventType: "VIEWED", actorType: viewerType, actorId: viewerId } });
  }
}

// Called by document-service.createDocument via the caller once the resulting document exists
// (kept as an explicit two-step so a failed upload never silently marks a request complete).
export async function fulfillRequest(requestId: string, documentId: string, uploaderType: DocumentUploaderType, uploaderId: string): Promise<DocumentRequest> {
  const req = await loadRequest(requestId);
  if (req.requestedFromType !== uploaderType || req.requestedFromId !== uploaderId) throw new HttpError(403, "This request was not made of you.");
  if (!["SENT", "VIEWED"].includes(req.status)) throw new HttpError(409, "This request is no longer open.");
  const updated = await prisma.documentRequest.update({ where: { id: requestId }, data: { status: "UPLOADED", resultingDocumentId: documentId } });
  await prisma.documentRequestEvent.create({ data: { requestId, eventType: "UPLOADED", actorType: uploaderType, actorId: uploaderId } });
  return updated;
}

export async function markUnderReview(requestId: string): Promise<void> {
  await prisma.documentRequest.updateMany({ where: { id: requestId, status: "UPLOADED" }, data: { status: "UNDER_REVIEW" } });
}

export async function completeRequest(requestId: string): Promise<void> {
  const req = await prisma.documentRequest.update({ where: { id: requestId }, data: { status: "COMPLETED" } });
  await prisma.documentRequestEvent.create({ data: { requestId, eventType: "REVIEWED" } });
  void req;
}

export async function cancelRequest(actor: SessionAdmin, requestId: string, reason: string): Promise<DocumentRequest> {
  if (reason.trim().length < 5) throw new HttpError(422, "A reason is required.");
  const req = await loadRequest(requestId);
  if (["COMPLETED", "CANCELLED"].includes(req.status)) throw new HttpError(409, "This request has already finished.");
  const updated = await prisma.documentRequest.update({ where: { id: requestId }, data: { status: "CANCELLED" } });
  await prisma.documentRequestEvent.create({ data: { requestId, eventType: "CANCELLED", actorType: "ADMIN", actorId: actor.id, note: reason.trim().slice(0, 300) } });
  await writeAudit({ action: "DOCUMENT_REQUEST_CANCELLED", adminId: actor.id, meta: { requestId, reason: reason.trim().slice(0, 200) } });
  return updated;
}

// Overdue requests (daily tick) — remind once, then expire past a grace window.
export async function sweepOverdueRequests(now = new Date()): Promise<{ reminded: number; expired: number }> {
  const overdue = await prisma.documentRequest.findMany({ where: { status: { in: ["SENT", "VIEWED"] }, dueDate: { lt: now } }, take: 200 });
  let reminded = 0;
  let expired = 0;
  for (const req of overdue) {
    const graceMs = 14 * 86_400_000;
    if (req.dueDate && now.getTime() - req.dueDate.getTime() > graceMs) {
      await prisma.documentRequest.update({ where: { id: req.id }, data: { status: "EXPIRED" } });
      await prisma.documentRequestEvent.create({ data: { requestId: req.id, eventType: "EXPIRED" } });
      expired++;
      continue;
    }
    const { createFromEvent } = await import("@/lib/workflow/engine");
    const created = await createFromEvent({
      eventName: "DOCUMENT_REQUEST_FOLLOWUP",
      dedupKey: `DOCUMENT_REQUEST_FOLLOWUP:${req.id}:${now.toISOString().slice(0, 10)}`,
      resourceType: "DOCUMENT",
      resourceId: req.id,
      taskType: "DOCUMENT_REQUEST_FOLLOWUP",
      title: "A document request is overdue",
      description: `Request ${req.requestCode} is overdue.`,
      assignedToId: req.assignedToId ?? undefined,
    });
    if (created) reminded++;
  }
  return { reminded, expired };
}

export async function listRequests(filter: { status?: string; requestedFromId?: string; take?: number } = {}) {
  return prisma.documentRequest.findMany({
    where: { ...(filter.status ? { status: filter.status as never } : {}), ...(filter.requestedFromId ? { requestedFromId: filter.requestedFromId } : {}) },
    orderBy: { createdAt: "desc" },
    take: Math.min(filter.take ?? 100, 200),
  });
}
