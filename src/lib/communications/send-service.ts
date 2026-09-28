import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { HttpError } from "@/lib/http-error";
import { isEmergencyDisabled } from "@/lib/ops/system-control";
import { isFeatureEnabled } from "@/lib/ops/feature-flags";
import { maskEmail, maskPhone } from "@/lib/verification/otp";
import type { CommunicationFailureClass, CommunicationLog, DeliveryStatus, NotificationChannel, NotificationType } from "@prisma/client";
import { canSend, type BlockedCode, type CommunicationIntent, type PolicyDecision } from "@/lib/communications/policy-engine";
import { packContent, unpackContent } from "@/lib/communications/content";
import { containsProtectedString } from "@/lib/communications/secure-renderer";
import { eligibleFailoverChain, type ResolvedProvider } from "@/lib/communications/providers/registry";
import { recordProviderOutcome } from "@/lib/communications/provider-health";
import { addSuppression } from "@/lib/communications/suppression-service";
import type { OutboundMessage, SendResult } from "@/lib/communications/providers/types";

// Send + queue service. The lifecycle of one message:
//   communicate()  -> policy check -> (blocked: recorded or silently skipped) -> CommunicationLog(QUEUED, encrypted content)
//   deliverLog()   -> claim -> re-check policy -> provider chain (env guard, opt-in failover) -> SENT | retry(backoff) | dead letter
//   webhooks       -> later status (DELIVERED / READ / BOUNCED ...) from the provider only - NEVER inferred here
// The request that triggered a message never waits on an external provider beyond one bounded attempt, and a provider problem can
// never throw back into the caller (communicate() and deliverLog() do not throw for delivery problems).

export const MAX_ATTEMPTS_DEFAULT = 4;
export const RETRY_BASE_SECONDS_DEFAULT = 60;
const CLAIM_MS = 2 * 60_000;
const EXPIRE_AFTER_MS = 48 * 3_600_000;

// Routine, high-volume "not for this recipient" outcomes are skipped silently (exactly as the pre-STEP-25 code did) so a default-off SMS
// channel does not write a row per notification. Everything else is recorded as a blocked message and audited.
const SILENT_CODES: BlockedCode[] = ["BLOCKED_CHANNEL_DISABLED", "BLOCKED_CONSENT", "BLOCKED_NO_DESTINATION", "BLOCKED_NO_MARKETING_CONSENT", "BLOCKED_MARKETING_DISABLED", "BLOCKED_CHANNEL_NOT_ALLOWED_FOR_RECIPIENT"];

export function backoffSeconds(attempt: number, baseSeconds = RETRY_BASE_SECONDS_DEFAULT): number {
  // attempt is the number of attempts already made (1-based): 60s, 120s, 240s, 480s ... capped at 6h, plus a small deterministic spread.
  const exp = Math.min(baseSeconds * 2 ** Math.max(attempt - 1, 0), 6 * 3600);
  return exp + ((attempt * 7) % 13);
}

export function isRetryable(failureClass: CommunicationFailureClass | null | undefined): boolean {
  return failureClass === "RETRYABLE";
}

export interface CommunicateParams {
  intent: CommunicationIntent;
  body: string;
  subject?: string | null;
  html?: string | null;
  templateParams?: string[]; // positional parameters for provider-approved (WhatsApp) templates
  template?: { id: string; version: number } | null;
  communicationId?: string;
  campaignId?: string | null;
  threadId?: string | null;
  isTest?: boolean;
  protectedStrings?: readonly (string | null | undefined)[];
  createReviewTask?: boolean; // default true: raise a COMMUNICATION_REVIEW task when the policy says a human must look
  deliverNow?: boolean; // default true
}

export interface CommunicateResult {
  status: "QUEUED" | "SENT" | "BLOCKED" | "DEFERRED" | "FAILED";
  logId?: string;
  blockedCode?: BlockedCode;
  reasons: string[];
  reviewRequired: boolean;
  silent: boolean;
}

function profileIdOf(intent: CommunicationIntent): string | null {
  return intent.recipient.type === "PROFILE" ? intent.recipient.profileId : null;
}

async function raiseReview(intent: CommunicationIntent, code: BlockedCode, reason: string): Promise<void> {
  const profileId = profileIdOf(intent);
  try {
    const { createFromEvent } = await import("@/lib/workflow/engine");
    const { notifyAdmins } = await import("@/lib/notifications/notification-service");
    if (profileId) {
      await createFromEvent({
        eventName: "COMMUNICATION_REVIEW_REQUIRED",
        dedupKey: `COMM_REVIEW:${profileId}:${intent.channel}:${code}:${new Date().toISOString().slice(0, 10)}`, // one task per profile/channel/reason/day
        resourceType: "PROFILE",
        resourceId: profileId,
        taskType: "COMMUNICATION_REVIEW",
        title: "Communication held for review",
        description: `A ${intent.messageType.toLowerCase()} message on ${intent.channel.toLowerCase()} was not sent: ${reason}`,
      });
    }
    await notifyAdmins({ type: "COMMUNICATION_REVIEW_REQUIRED", data: { relatedProfileId: profileId ?? undefined }, roles: ["COMMUNICATION_MANAGER", "COMPLIANCE_MANAGER"] });
  } catch {
    // raising a review must never break the caller
  }
}

export async function communicate(params: CommunicateParams): Promise<CommunicateResult> {
  const { intent } = params;
  let decision: PolicyDecision;
  try {
    decision = await canSend(intent);
  } catch (error) {
    console.error("[communications] policy evaluation failed - message NOT sent", error instanceof Error ? error.message : "unknown");
    return { status: "BLOCKED", reasons: ["Policy evaluation failed"], reviewRequired: false, silent: true };
  }

  // Defence in depth: the content must not disclose another person's contact details (e.g. the other party of a proposal).
  if (decision.allowed && params.protectedStrings && (containsProtectedString(params.body, params.protectedStrings) || (params.subject && containsProtectedString(params.subject, params.protectedStrings)))) {
    decision = { ...decision, allowed: false, reviewRequired: true, blockedCode: "BLOCKED_JURISDICTION_REVIEW", reasons: ["The message would disclose protected contact details."] };
  }

  const profileId = profileIdOf(intent);
  if (!decision.allowed) {
    const code = decision.blockedCode as BlockedCode;
    const silent = SILENT_CODES.includes(code) && !decision.reviewRequired;
    let logId: string | undefined;
    if (!silent && profileId) {
      const row = await prisma.communicationLog.create({
        data: {
          profileId,
          proposalId: intent.proposalId ?? null,
          channel: intent.channel,
          notificationType: (intent.eventKey ?? "ADMIN_DIRECT_MESSAGE") as NotificationType,
          templateKey: intent.eventKey ?? null,
          deliveryStatus: "CANCELLED",
          failureReason: decision.reasons[0]?.slice(0, 200) ?? code,
          failureClass: "POLICY_BLOCKED",
          blockedReason: code,
          purpose: intent.purpose,
          messageType: intent.messageType,
          recipientType: "PROFILE",
          communicationId: params.communicationId ?? randomUUID(),
          campaignId: params.campaignId ?? null,
          isTest: params.isTest ?? false,
          queuedAt: new Date(),
          failedAt: new Date(),
        },
      });
      logId = row.id;
      await writeAudit({
        action: "COMMUNICATION_BLOCKED",
        adminId: intent.initiatedBy?.adminId ?? null,
        targetProfileId: profileId,
        meta: { logId, channel: intent.channel, purpose: intent.purpose, messageType: intent.messageType, code, template: params.template?.id ?? null },
      });
    }
    if (decision.reviewRequired && params.createReviewTask !== false) await raiseReview(intent, code, decision.reasons[0] ?? code);
    return { status: "BLOCKED", logId, blockedCode: code, reasons: decision.reasons, reviewRequired: decision.reviewRequired, silent };
  }

  // Recipients without a profile (family member, admin) only ever receive in-app messages, which the caller stores itself.
  if (!profileId) return { status: "SENT", reasons: [], reviewRequired: false, silent: true };

  const now = new Date();
  const masked = decision.destination ? (intent.channel === "EMAIL" ? maskEmail(decision.destination) : maskPhone(decision.destination)) : null;
  const row = await prisma.communicationLog.create({
    data: {
      profileId,
      proposalId: intent.proposalId ?? null,
      channel: intent.channel,
      notificationType: (intent.eventKey ?? "ADMIN_DIRECT_MESSAGE") as NotificationType,
      templateKey: intent.eventKey ?? null,
      recipientReference: masked,
      messageBody: packContent({ subject: params.subject ?? null, text: params.body, html: params.html ?? null, params: params.templateParams ?? [] }),
      bodyEncrypted: true,
      deliveryStatus: intent.channel === "IN_APP" ? "DELIVERED" : "QUEUED",
      sentAt: intent.channel === "IN_APP" ? now : null,
      deliveredAt: intent.channel === "IN_APP" ? now : null,
      createdById: intent.initiatedBy?.adminId ?? null,
      purpose: intent.purpose,
      messageType: intent.messageType,
      recipientType: "PROFILE",
      templateId: params.template?.id ?? null,
      templateVersion: params.template?.version ?? null,
      communicationId: params.communicationId ?? randomUUID(),
      campaignId: params.campaignId ?? null,
      threadId: params.threadId ?? null,
      isTest: params.isTest ?? false,
      queuedAt: now,
      nextAttemptAt: decision.deferUntil ?? null,
    },
  });
  await addDeliveryEvent(row.id, intent.channel === "IN_APP" ? "DELIVERED" : "QUEUED", { source: "SYSTEM", detail: decision.deferUntil ? `Deferred until ${decision.deferUntil.toISOString()} (quiet hours)` : undefined });

  if (intent.initiatedBy) {
    await writeAudit({
      action: "COMMUNICATION_SENT",
      adminId: intent.initiatedBy.adminId,
      targetProfileId: profileId,
      meta: { logId: row.id, channel: intent.channel, purpose: intent.purpose, messageType: intent.messageType, template: params.template?.id ?? null, templateVersion: params.template?.version ?? null, jurisdictionUnresolved: decision.jurisdictionUnresolved },
    });
  }

  if (intent.channel === "IN_APP") return { status: "SENT", logId: row.id, reasons: [], reviewRequired: false, silent: false };
  if (decision.deferUntil) return { status: "DEFERRED", logId: row.id, reasons: ["Quiet hours"], reviewRequired: false, silent: false };
  if (params.deliverNow === false) return { status: "QUEUED", logId: row.id, reasons: [], reviewRequired: false, silent: false };

  const delivered = await deliverLog(row.id);
  return { status: delivered === "SENT" ? "SENT" : delivered === "FAILED" ? "FAILED" : "QUEUED", logId: row.id, reasons: [], reviewRequired: false, silent: false };
}

export async function addDeliveryEvent(logId: string, eventType: string, extra: { provider?: string | null; providerEventId?: string | null; source?: "SYSTEM" | "WEBHOOK" | "ADMIN"; detail?: string; occurredAt?: Date } = {}): Promise<void> {
  try {
    await prisma.communicationDeliveryEvent.create({
      data: { logId, eventType, provider: extra.provider ?? null, providerEventId: extra.providerEventId ?? null, source: extra.source ?? "SYSTEM", detail: extra.detail?.slice(0, 300) ?? null, occurredAt: extra.occurredAt ?? new Date() },
    });
  } catch {
    // the timeline is informative; it must never make a send fail
  }
}

async function externalDisabled(channel: NotificationChannel): Promise<boolean> {
  return (await isEmergencyDisabled("notifications")) || !(await isFeatureEnabled("notifications.enabled")) || (channel === "WHATSAPP" && !(await isFeatureEnabled("whatsapp.enabled")));
}

function outboundFor(log: CommunicationLog, destination: string, content: NonNullable<ReturnType<typeof unpackContent>>, language: string, sender?: string | null): OutboundMessage {
  return { to: destination, body: content.text, subject: content.subject ?? undefined, html: content.html ?? undefined, purpose: log.purpose ?? undefined, correlationId: log.communicationId ?? undefined, language, sender };
}

async function attempt(chainItem: ResolvedProvider, log: CommunicationLog, msg: OutboundMessage, params: string[]): Promise<SendResult> {
  const adapter = chainItem.adapter;
  try {
    if (log.channel === "WHATSAPP") {
      // Business-initiated WhatsApp needs a provider-approved template; a message without one is refused, not "tried".
      const tpl = log.templateId ? await prisma.communicationTemplate.findUnique({ where: { id: log.templateId } }) : null;
      if (!tpl || !tpl.providerTemplateName || !["APPROVED", "ACTIVE"].includes(tpl.providerStatus ?? "")) return { ok: false, failureClass: "PERMANENT", error: "WHATSAPP_REQUIRES_APPROVED_TEMPLATE" };
      if (chainItem.sandboxed || !adapter.external) return adapter.sendMessage(msg);
      return await adapter.sendTemplate({ ...msg, providerTemplateName: tpl.providerTemplateName, providerTemplateLanguage: tpl.language === "UR" ? "ur" : "en", templateParams: params });
    }
    if (log.purpose === "OTP") return await adapter.sendOTP(msg);
    return await adapter.sendTransactional(msg);
  } catch (error) {
    return { ok: false, failureClass: "RETRYABLE", error: error instanceof Error ? error.message.slice(0, 200) : "PROVIDER_EXCEPTION" };
  }
}

export type DeliverOutcome = "SENT" | "REQUEUED" | "FAILED" | "SKIPPED" | "CANCELLED";

// One bounded delivery attempt for a QUEUED row. Safe to call concurrently: only one caller can claim the row.
export async function deliverLog(logId: string, now: Date = new Date()): Promise<DeliverOutcome> {
  const claimed = await prisma.communicationLog.updateMany({
    where: { id: logId, deliveryStatus: "QUEUED", OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }], AND: [{ OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] }] },
    data: { deliveryStatus: "SENDING", lockedUntil: new Date(now.getTime() + CLAIM_MS) },
  });
  if (claimed.count === 0) return "SKIPPED";
  const log = await prisma.communicationLog.findUnique({ where: { id: logId } });
  if (!log) return "SKIPPED";
  await addDeliveryEvent(logId, "SENDING", { source: "SYSTEM" });

  const finish = async (data: Record<string, unknown>) => {
    await prisma.communicationLog.update({ where: { id: logId }, data: { lockedUntil: null, ...data } });
  };

  // Kill switch / feature flags: hold the message (do not consume an attempt) and let it expire if it waits too long.
  if (await externalDisabled(log.channel)) {
    if (log.queuedAt && now.getTime() - log.queuedAt.getTime() > EXPIRE_AFTER_MS) {
      await finish({ deliveryStatus: "EXPIRED", failedAt: now, failureReason: "Expired while notifications were switched off" });
      await addDeliveryEvent(logId, "EXPIRED", { source: "SYSTEM" });
      return "FAILED";
    }
    await finish({ deliveryStatus: "QUEUED", nextAttemptAt: new Date(now.getTime() + 3_600_000), failureReason: "Notifications are temporarily disabled" });
    return "REQUEUED";
  }

  const intent: CommunicationIntent = {
    recipient: { type: "PROFILE", profileId: log.profileId },
    channel: log.channel,
    messageType: log.messageType ?? "TRANSACTIONAL",
    purpose: log.purpose ?? "ACCOUNT",
    eventKey: log.templateKey && !log.templateId ? (log.templateKey as NotificationType) : undefined,
    automated: !log.createdById,
    proposalId: log.proposalId,
    ignoreQuietHours: true,
    now,
  };
  // Re-check at SEND time: a suppression, a revoked consent or a suspended account that appeared while the message waited must win.
  const decision = await canSend(intent, { skipFrequency: true });
  if (!decision.allowed || !decision.destination) {
    await finish({ deliveryStatus: "CANCELLED", failedAt: now, failureReason: decision.reasons[0]?.slice(0, 200) ?? "Blocked at send time", failureClass: "POLICY_BLOCKED", blockedReason: decision.blockedCode ?? "BLOCKED_NO_DESTINATION" });
    await addDeliveryEvent(logId, "BLOCKED", { source: "SYSTEM", detail: decision.blockedCode });
    return "CANCELLED";
  }

  const content = unpackContent(log.messageBody, log.bodyEncrypted);
  if (!content) {
    await finish({ deliveryStatus: "FAILED", failedAt: now, failureReason: "Message content is unavailable", failureClass: "PERMANENT", deadLetteredAt: now });
    return "FAILED";
  }

  const chain = await eligibleFailoverChain(decision.chain);
  const msg = (item: ResolvedProvider) => outboundFor(log, decision.destination as string, content, decision.language, item.row?.senderIdentity ?? null);

  let last: SendResult = { ok: false, failureClass: "RETRYABLE", error: "NO_PROVIDER" };
  let used: ResolvedProvider | null = null;
  for (const item of chain) {
    used = item;
    last = await attempt(item, log, msg(item), content.params);
    await recordProviderOutcome(item.providerKey, { ok: last.ok, error: last.error });
    if (last.ok) break;
    // Fail over only on a provider-side problem (retryable / auth), never because the RECIPIENT is unreachable.
    if (last.rejected || (last.failureClass === "PERMANENT" && last.error !== "PROVIDER_AUTHENTICATION_FAILED")) break;
  }

  const attemptsMade = log.attempts + 1;
  if (last.ok) {
    await finish({ deliveryStatus: "SENT", sentAt: now, provider: used?.providerKey ?? null, providerMessageId: last.providerMessageId ?? null, attempts: attemptsMade, failureReason: null, failureClass: null, failedAt: null, nextAttemptAt: null });
    await addDeliveryEvent(logId, "SENT", { provider: used?.providerKey, providerEventId: last.providerMessageId, source: "SYSTEM", detail: used?.sandboxed ? "Handed to the sandbox provider (not delivered to a real recipient)" : undefined });
    return "SENT";
  }

  const maxAttempts = used?.row?.retryMaxAttempts ?? MAX_ATTEMPTS_DEFAULT;
  const baseSeconds = used?.row?.retryBaseSeconds ?? RETRY_BASE_SECONDS_DEFAULT;
  const failureClass: CommunicationFailureClass = last.failureClass === "PERMANENT" ? "PERMANENT" : "RETRYABLE";

  if (failureClass === "RETRYABLE" && attemptsMade < maxAttempts) {
    await finish({ deliveryStatus: "QUEUED", attempts: attemptsMade, provider: used?.providerKey ?? null, failureReason: last.error?.slice(0, 200) ?? "Delivery failed", failureClass, failedAt: now, nextAttemptAt: new Date(now.getTime() + backoffSeconds(attemptsMade, baseSeconds) * 1000) });
    await addDeliveryEvent(logId, "FAILED", { provider: used?.providerKey, source: "SYSTEM", detail: `Attempt ${attemptsMade} failed (${last.error}); retry scheduled` });
    return "REQUEUED";
  }

  // Permanent, or retries exhausted: dead letter (kept for staff to inspect / retry where appropriate).
  await finish({ deliveryStatus: last.rejected ? "REJECTED" : "FAILED", attempts: attemptsMade, provider: used?.providerKey ?? null, failureReason: last.error?.slice(0, 200) ?? "Delivery failed", failureClass, failedAt: now, nextAttemptAt: null, deadLetteredAt: now });
  await addDeliveryEvent(logId, last.rejected ? "REJECTED" : "FAILED", { provider: used?.providerKey, source: "SYSTEM", detail: last.error });
  await writeAudit({ action: "COMMUNICATION_DEAD_LETTERED", targetProfileId: log.profileId, meta: { logId, channel: log.channel, provider: used?.providerKey ?? null, failureClass, error: last.error?.slice(0, 120), attempts: attemptsMade } });

  // The provider (not our local format check) said this address can never receive: stop trying it.
  if (last.rejected && last.error && !last.error.startsWith("INVALID_RECIPIENT")) {
    await addSuppression({ channel: log.channel, reason: log.channel === "EMAIL" ? "BOUNCE" : "PROVIDER_BLOCK", scope: "ALL", profileId: log.profileId, destination: decision.destination, note: "Automatic: the provider rejected this address." }).catch(() => undefined);
  }
  return "FAILED";
}

export interface QueueSummary {
  attempted: number;
  sent: number;
  requeued: number;
  failed: number;
  skipped: number;
  cancelled: number;
  recovered: number;
  expired: number;
}

// Drains due messages. Called right after a send, by the daily tick, and by the admin "process queue" action.
export async function processCommunicationQueue(opts: { limit?: number; budgetMs?: number; now?: Date } = {}): Promise<QueueSummary> {
  const now = opts.now ?? new Date();
  const started = Date.now();
  const summary: QueueSummary = { attempted: 0, sent: 0, requeued: 0, failed: 0, skipped: 0, cancelled: 0, recovered: 0, expired: 0 };

  // Crash recovery: a row stuck in SENDING past its claim window goes back to QUEUED.
  const stuck = await prisma.communicationLog.updateMany({ where: { deliveryStatus: "SENDING", lockedUntil: { lt: now } }, data: { deliveryStatus: "QUEUED", lockedUntil: null } });
  summary.recovered = stuck.count;

  const expired = await prisma.communicationLog.updateMany({ where: { deliveryStatus: "QUEUED", queuedAt: { lt: new Date(now.getTime() - EXPIRE_AFTER_MS) } }, data: { deliveryStatus: "EXPIRED", failedAt: now, failureReason: "Expired before it could be delivered" } });
  summary.expired = expired.count;

  const due = await prisma.communicationLog.findMany({
    where: { deliveryStatus: "QUEUED", channel: { not: "IN_APP" }, OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
    orderBy: { queuedAt: "asc" },
    take: opts.limit ?? 50,
    select: { id: true },
  });
  for (const row of due) {
    if (opts.budgetMs && Date.now() - started > opts.budgetMs) break;
    summary.attempted++;
    const outcome = await deliverLog(row.id, now);
    if (outcome === "SENT") summary.sent++;
    else if (outcome === "REQUEUED") summary.requeued++;
    else if (outcome === "FAILED") summary.failed++;
    else if (outcome === "CANCELLED") summary.cancelled++;
    else summary.skipped++;
  }
  return summary;
}

// ---------------------------------------------------------------- dead letter queue

export async function listDeadLetters(take = 100) {
  return prisma.communicationLog.findMany({
    where: { deadLetteredAt: { not: null }, deliveryStatus: { in: ["FAILED", "REJECTED", "BOUNCED", "EXPIRED"] } },
    orderBy: { deadLetteredAt: "desc" },
    take: Math.min(take, 200),
    select: { id: true, channel: true, provider: true, purpose: true, messageType: true, failureReason: true, failureClass: true, attempts: true, failedAt: true, deadLetteredAt: true, profileId: true, recipientReference: true, deliveryStatus: true },
  });
}

// Manual retry of a dead letter. A PERMANENT failure (invalid / rejected address) is not retried by ordinary staff - it would fail
// again and could annoy the recipient - only by someone who manages providers.
export async function retryDeadLetter(logId: string, actor: { id: string; permissions: readonly string[] }): Promise<{ status: DeliveryStatus }> {
  const log = await prisma.communicationLog.findUnique({ where: { id: logId } });
  if (!log) throw new HttpError(404, "Message not found.");
  if (!log.deadLetteredAt) throw new HttpError(409, "Only a dead-lettered message can be retried.");
  if (log.failureClass === "PERMANENT" && !actor.permissions.includes("communications:providers:manage")) throw new HttpError(403, "This message failed permanently; a provider manager must decide whether to retry it.");
  if (log.messageBody === null || log.bodyRedactedAt) throw new HttpError(409, "The message content is no longer retained, so it cannot be resent.");
  await prisma.communicationLog.update({ where: { id: logId }, data: { deliveryStatus: "QUEUED", attempts: 0, deadLetteredAt: null, nextAttemptAt: new Date(), lockedUntil: null, failureReason: null, retryCount: { increment: 1 } } });
  await writeAudit({ action: "COMMUNICATION_RETRIED", adminId: actor.id, targetProfileId: log.profileId, meta: { logId, channel: log.channel, previousFailure: log.failureReason?.slice(0, 100) } });
  await deliverLog(logId);
  const updated = await prisma.communicationLog.findUnique({ where: { id: logId }, select: { deliveryStatus: true } });
  return { status: updated?.deliveryStatus ?? "QUEUED" };
}

