import { NextResponse } from "next/server";
import { verifyWebhookSignature } from "@/lib/notifications/webhook-verify";
import { processWebhookEvent, type WebhookEventType } from "@/lib/notifications/webhook-processor";
import { enforcePersistentLimit } from "@/lib/ops/rate-limit-persistent";

const VALID_EVENT_TYPES: WebhookEventType[] = ["DELIVERED", "READ", "FAILED", "BOUNCED"];

// Inbound provider webhook (spec §28) — no real Email/SMS/WhatsApp provider
// exists in this environment to send real webhooks, so NOTIFICATION_WEBHOOK_SECRET
// is unset; the admin "Simulate Webhook" action exercises this exact
// signature-check + idempotent-processing pipeline for live verification.
export async function POST(req: Request) {
  // STEP 15 §19 — persistent (cross-instance) rate limit.
  const limited = await enforcePersistentLimit(req, "webhook-notifications", 300, 60000);
  if (limited) return limited;
  const secret = process.env.NOTIFICATION_WEBHOOK_SECRET;
  const rawBody = await req.text();

  // Fails CLOSED: with no secret configured this endpoint accepts nothing, so nobody can fabricate a "delivered" / "read" status.
  // (The admin "Simulate Webhook" tool calls the processor directly and does not need this route.)
  if (!secret) return NextResponse.json({ error: "Webhook is not configured" }, { status: 503 });
  const signature = req.headers.get("x-webhook-signature");
  if (!verifyWebhookSignature(rawBody, signature, secret)) {
    // STEP 32 — a failed signature is a SOC signal (fail-open).
    await import("@/lib/soc/events").then((m) => m.publishWebhookSignatureFailure({ provider: "notifications", headers: req.headers, reason: "BAD_SIGNATURE" })).catch(() => undefined);
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let body: { provider?: string; eventType?: string; providerMessageId?: string; idempotencyKey?: string };
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  if (!body.provider || !body.eventType || !VALID_EVENT_TYPES.includes(body.eventType as WebhookEventType) || !body.providerMessageId || !body.idempotencyKey) {
    return NextResponse.json({ error: "provider, eventType, providerMessageId, and idempotencyKey are required" }, { status: 400 });
  }

  const result = await processWebhookEvent({
    provider: body.provider,
    eventType: body.eventType as WebhookEventType,
    providerMessageId: body.providerMessageId,
    idempotencyKey: body.idempotencyKey,
    payload: body,
    auditAction: "WEBHOOK_PROCESSED",
  });

  return NextResponse.json(result);
}
