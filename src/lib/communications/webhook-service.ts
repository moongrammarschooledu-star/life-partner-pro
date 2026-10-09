import { createHash } from "crypto";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import type { CommunicationLog, DeliveryStatus, NotificationChannel } from "@prisma/client";
import { EmailProviderAdapter } from "@/lib/communications/providers/email-adapter";
import { SmsProviderAdapter } from "@/lib/communications/providers/sms-adapter";
import { WhatsAppProviderAdapter } from "@/lib/communications/providers/whatsapp-adapter";
import { SandboxProviderAdapter } from "@/lib/communications/providers/sandbox-adapter";
import { addDeliveryEvent } from "@/lib/communications/send-service";
import { addSuppression } from "@/lib/communications/suppression-service";
import { destinationFor } from "@/lib/communications/policy-engine";
import { recordProviderWebhook } from "@/lib/communications/provider-health";
import type { CommunicationProvider, EnvMap, ParsedWebhookEvent, WebhookRequestData } from "@/lib/communications/providers/types";

// Inbound provider webhooks (spec §41/§42). Every request must (1) carry a valid provider signature, (2) parse against the
// provider's schema, (3) be recent (where the provider gives a time), and (4) be new: the provider event id is a UNIQUE key in the
// webhook ledger, so the same event can never be processed twice - the permanent replay defence. A delivery state is only ever
// taken from the provider's own event; it is never inferred, and it only moves FORWARD.

const RANK: Partial<Record<DeliveryStatus, number>> = { QUEUED: 0, SENDING: 1, SENT: 2, DELIVERED: 3, READ: 4 };
const FAILURE: DeliveryStatus[] = ["FAILED", "BOUNCED", "REJECTED", "EXPIRED"];
export const STALE_EVENT_MS = 3 * 24 * 3_600_000; // providers retry for days; older than this is rejected as a replay
const FUTURE_SKEW_MS = 5 * 60_000;

export function nextStatus(current: DeliveryStatus, incoming: DeliveryStatus): DeliveryStatus | null {
  if (current === incoming) return null;
  const cur = RANK[current];
  const inc = RANK[incoming];
  if (FAILURE.includes(incoming)) {
    // A bounce / failure after SENT is normal; after DELIVERED / READ it contradicts the provider's earlier word, so ignore it.
    return current === "DELIVERED" || current === "READ" ? null : incoming;
  }
  if (inc === undefined) return incoming === "CANCELLED" && (current === "QUEUED" || current === "SENDING") ? incoming : null;
  if (FAILURE.includes(current) || current === "CANCELLED") return inc >= 3 ? incoming : null; // provider correction: it really was delivered
  if (cur === undefined) return incoming;
  return inc > cur ? incoming : null; // never move backwards (out-of-order delivery of events)
}

export function webhookAdapters(channel: NotificationChannel, env: EnvMap = process.env): CommunicationProvider[] {
  const real = channel === "EMAIL" ? new EmailProviderAdapter(env) : channel === "SMS" ? new SmsProviderAdapter(env) : channel === "WHATSAPP" ? new WhatsAppProviderAdapter(env) : null;
  // The sandbox verifier (server-derived secret) lets the admin "simulate webhook" tool exercise this exact pipeline.
  return [...(real ? [real] : []), new SandboxProviderAdapter(channel, env)];
}

export interface WebhookOutcome {
  httpStatus: number;
  body: { ok: boolean; processed?: number; duplicates?: number; unmatched?: number; rejected?: number; error?: string };
}

async function recordRejected(channel: NotificationChannel, providerKey: string, payloadHash: string, reason: string, signatureValid: boolean): Promise<void> {
  try {
    await prisma.webhookEvent.create({
      data: { provider: providerKey, eventType: "REJECTED", idempotencyKey: `rejected:${providerKey}:${payloadHash}:${Date.now()}`, payloadHash, status: "REJECTED", signatureValid, channel, failureReason: reason.slice(0, 200), processedAt: new Date() },
    });
  } catch {
    // the ledger row is best-effort; the audit entry below is what matters
  }
  await writeAudit({ action: "COMMUNICATION_WEBHOOK_REJECTED", meta: { channel, provider: providerKey, reason, payloadHash } });
}

function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";
}

async function applyEvent(channel: NotificationChannel, providerKey: string, event: ParsedWebhookEvent, payloadHash: string, now: Date): Promise<"PROCESSED" | "DUPLICATE" | "UNMATCHED" | "REJECTED"> {
  if (event.occurredAt) {
    const age = now.getTime() - event.occurredAt.getTime();
    if (age > STALE_EVENT_MS || age < -FUTURE_SKEW_MS) return "REJECTED";
  }
  const key = `${providerKey}:${event.eventId}`;
  try {
    await prisma.webhookEvent.create({
      data: { provider: providerKey, eventType: event.status ?? "INFO", providerMessageId: event.providerMessageId, providerEventId: event.eventId, idempotencyKey: key, payloadHash, status: "RECEIVED", signatureValid: true, channel, attempts: 1 },
    });
  } catch (e) {
    if (isUniqueViolation(e)) return "DUPLICATE"; // replay / retry of an event we already have
    throw e;
  }

  const log: CommunicationLog | null = await prisma.communicationLog.findFirst({ where: { providerMessageId: event.providerMessageId } });
  if (!log) {
    await prisma.webhookEvent.update({ where: { idempotencyKey: key }, data: { status: "PROCESSED", processedAt: now, failureReason: "UNMATCHED_MESSAGE" } });
    return "UNMATCHED";
  }

  const target = event.status ? nextStatus(log.deliveryStatus, event.status) : null;
  if (target) {
    await prisma.communicationLog.update({
      where: { id: log.id },
      data: {
        deliveryStatus: target,
        ...(target === "DELIVERED" ? { deliveredAt: event.occurredAt ?? now } : {}),
        ...(target === "READ" ? { readAt: event.occurredAt ?? now, deliveredAt: log.deliveredAt ?? event.occurredAt ?? now } : {}),
        ...(FAILURE.includes(target) ? { failedAt: event.occurredAt ?? now, failureReason: event.failureReason ?? target, failureClass: "PERMANENT" } : {}),
        ...(target === "DELIVERED" || target === "READ" ? { failureReason: null, failureClass: null } : {}),
      },
    });
  }
  await addDeliveryEvent(log.id, event.status ?? "INFO", { provider: providerKey, providerEventId: event.eventId, source: "WEBHOOK", detail: target ? undefined : "No state change", occurredAt: event.occurredAt ?? now });

  if (event.suppress) {
    const contact = await prisma.contactInfo.findUnique({ where: { profileId: log.profileId }, select: { mobileNumber: true, whatsappNumber: true, email: true } });
    await addSuppression({
      channel,
      reason: event.suppress,
      scope: event.suppress === "UNSUBSCRIBED" ? "MARKETING" : "ALL",
      profileId: log.profileId,
      destination: destinationFor(channel, contact),
      note: `Automatic: provider reported ${event.suppress.toLowerCase()}.`,
    });
  }

  await prisma.webhookEvent.update({ where: { idempotencyKey: key }, data: { status: "PROCESSED", processedAt: now } });
  await recordProviderWebhook(log.provider ?? providerKey);
  return "PROCESSED";
}

// STEP 32 — a failed signature or a replayed delivery is a security event (counts and provider key only; fail-open).
async function reportWebhook(kind: "signature" | "replay-stale" | "replay-duplicate", provider: string, req: WebhookRequestData, reason: string, count = 1): Promise<void> {
  try {
    const events = await import("@/lib/soc/events");
    if (kind === "signature") await events.publishWebhookSignatureFailure({ provider, headers: req.headers, reason });
    else await events.publishWebhookReplay({ provider, headers: req.headers, kind: kind === "replay-stale" ? "STALE" : "DUPLICATE", count });
  } catch {
    /* fail-open */
  }
}

export async function handleProviderWebhook(channel: NotificationChannel, req: WebhookRequestData, env: EnvMap = process.env, now: Date = new Date()): Promise<WebhookOutcome> {
  const payloadHash = createHash("sha256").update(req.rawBody).digest("hex");
  const adapters = webhookAdapters(channel, env);
  const verified = adapters.find((a) => a.verifyWebhook(req).valid);
  const providerKey = verified ? (verified.external ? `${verified.adapterKey.toLowerCase()}` : `sandbox-${channel.toLowerCase()}`) : `unverified-${channel.toLowerCase()}`;

  if (!verified) {
    const reason = adapters[0]?.verifyWebhook(req).reason ?? "BAD_SIGNATURE";
    await recordRejected(channel, providerKey, payloadHash, reason, false);
    await reportWebhook("signature", channel.toLowerCase(), req, reason);
    return { httpStatus: 401, body: { ok: false, error: "Invalid signature" } };
  }
  const events = verified.parseWebhookEvent(req);
  if (!events) {
    await recordRejected(channel, providerKey, payloadHash, "INVALID_PAYLOAD", true);
    return { httpStatus: 400, body: { ok: false, error: "Invalid payload" } };
  }

  let processed = 0;
  let duplicates = 0;
  let unmatched = 0;
  let rejected = 0;
  for (const event of events) {
    try {
      const r = await applyEvent(channel, providerKey, event, payloadHash, now);
      if (r === "PROCESSED") processed++;
      else if (r === "DUPLICATE") duplicates++;
      else if (r === "UNMATCHED") unmatched++;
      else rejected++;
    } catch (error) {
      // One bad event must not lose the rest of the batch; a 500 lets the provider retry the whole delivery (idempotent).
      console.error("[communications] webhook event failed", error instanceof Error ? error.message : "unknown");
      return { httpStatus: 500, body: { ok: false, error: "Processing error" } };
    }
  }
  if (rejected > 0 && processed + duplicates + unmatched === 0) {
    await recordRejected(channel, providerKey, payloadHash, "STALE_EVENT", true);
    await reportWebhook("replay-stale", providerKey, req, "STALE_EVENT", rejected);
  } else if (duplicates > 0 && processed === 0) {
    await reportWebhook("replay-duplicate", providerKey, req, "DUPLICATE", duplicates);
  }
  return { httpStatus: 200, body: { ok: true, processed, duplicates, unmatched, rejected } };
}
