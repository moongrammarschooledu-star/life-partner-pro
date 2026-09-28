import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { HttpError } from "@/lib/http-error";
import { hasBroadRecordAccess } from "@/lib/permissions";
import { assertProfileAssignmentAccess } from "@/lib/profile-assignment-access";
import type { SessionAdmin } from "@/lib/route-guard";
import type { CommunicationLog, DeliveryStatus, NotificationChannel, Prisma } from "@prisma/client";
import { readableText } from "@/lib/communications/content";
import { getPolicy, type PolicyKindKey } from "@/lib/communications/policy-config";
import { loadFollowUpRules } from "@/lib/communications/followup-automation";

// Communication history: search, detail and the effective policy view. The list NEVER contains message content or a full address
// (only the masked reference stored with the row). Content is returned only to staff with the sensitive-communication permission
// and every such read is audited. Row scope: broad-access roles search everything; anyone else must name a profile they are
// assigned to.

export interface LogSearch {
  channel?: NotificationChannel;
  status?: DeliveryStatus;
  purpose?: string;
  messageType?: string;
  profileId?: string;
  provider?: string;
  templateId?: string;
  campaignId?: string;
  blockedOnly?: boolean;
  from?: Date;
  to?: Date;
  take?: number;
  cursor?: string;
}

export function serializeLog(l: CommunicationLog) {
  return {
    id: l.id,
    communicationId: l.communicationId,
    profileId: l.profileId,
    proposalId: l.proposalId,
    channel: l.channel,
    notificationType: l.notificationType,
    purpose: l.purpose,
    messageType: l.messageType,
    recipientType: l.recipientType,
    recipientReference: l.recipientReference, // masked
    deliveryStatus: l.deliveryStatus,
    templateId: l.templateId,
    templateVersion: l.templateVersion,
    provider: l.provider,
    attempts: l.attempts,
    retryCount: l.retryCount,
    queuedAt: l.queuedAt,
    sentAt: l.sentAt,
    deliveredAt: l.deliveredAt,
    readAt: l.readAt,
    failedAt: l.failedAt,
    nextAttemptAt: l.nextAttemptAt,
    failureReason: l.failureReason,
    failureClass: l.failureClass,
    blockedReason: l.blockedReason,
    deadLetteredAt: l.deadLetteredAt,
    campaignId: l.campaignId,
    threadId: l.threadId,
    createdById: l.createdById,
    isTest: l.isTest,
    createdAt: l.createdAt,
    contentRetained: l.messageBody !== null && !l.bodyRedactedAt,
  };
}

export async function searchLogs(actor: SessionAdmin, f: LogSearch) {
  if (!f.profileId && !hasBroadRecordAccess(actor.role)) throw new HttpError(403, "Filter by a profile you are assigned to.");
  if (f.profileId) await assertProfileAssignmentAccess({ id: actor.id, role: actor.role }, f.profileId);
  const where: Prisma.CommunicationLogWhereInput = {
    ...(f.channel ? { channel: f.channel } : {}),
    ...(f.status ? { deliveryStatus: f.status } : {}),
    ...(f.purpose ? { purpose: f.purpose as never } : {}),
    ...(f.messageType ? { messageType: f.messageType as never } : {}),
    ...(f.profileId ? { profileId: f.profileId } : {}),
    ...(f.provider ? { provider: f.provider } : {}),
    ...(f.templateId ? { templateId: f.templateId } : {}),
    ...(f.campaignId ? { campaignId: f.campaignId } : {}),
    ...(f.blockedOnly ? { blockedReason: { not: null } } : {}),
    ...(f.from || f.to ? { createdAt: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) } } : {}),
  };
  const take = Math.min(f.take ?? 50, 100);
  const rows = await prisma.communicationLog.findMany({ where, orderBy: { createdAt: "desc" }, take: take + 1, ...(f.cursor ? { cursor: { id: f.cursor }, skip: 1 } : {}) });
  const page = rows.slice(0, take);
  return { items: page.map(serializeLog), nextCursor: rows.length > take ? page[page.length - 1].id : null };
}

export async function getLogDetail(actor: SessionAdmin, id: string) {
  const log = await prisma.communicationLog.findUnique({ where: { id }, include: { deliveryEvents: { orderBy: { occurredAt: "asc" }, take: 200 } } });
  if (!log) throw new HttpError(404, "Message not found.");
  await assertProfileAssignmentAccess({ id: actor.id, role: actor.role }, log.profileId);
  const canReadContent = actor.permissions.includes("sensitive:communication:view");
  let content: string | null = null;
  if (canReadContent) {
    content = readableText(log.messageBody, log.bodyEncrypted, log.bodyRedactedAt);
    await writeAudit({ action: "COMMUNICATION_LOG_VIEWED", adminId: actor.id, targetProfileId: log.profileId, meta: { logId: id, channel: log.channel, contentViewed: true } });
  }
  return {
    ...serializeLog(log),
    content, // null unless the viewer holds sensitive:communication:view (and the content is still retained)
    contentAccessible: canReadContent,
    events: log.deliveryEvents.map((e) => ({ id: e.id, eventType: e.eventType, source: e.source, provider: e.provider, detail: e.detail, occurredAt: e.occurredAt })),
  };
}

export async function effectivePolicies() {
  const kinds: PolicyKindKey[] = ["FREQUENCY", "QUIET_HOURS", "JURISDICTION_DEFAULTS", "ENVIRONMENT"];
  const out: Record<string, { config: unknown; version: number }> = {};
  for (const k of kinds) out[k] = await getPolicy(k);
  return { policies: out, followUpRules: await loadFollowUpRules() };
}
