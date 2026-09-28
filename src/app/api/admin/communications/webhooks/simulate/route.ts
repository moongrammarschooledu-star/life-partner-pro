import { NextResponse } from "next/server";
import { createHmac } from "crypto";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { writeAudit } from "@/lib/audit";
import { handleProviderWebhook } from "@/lib/communications/webhook-service";
import { sandboxWebhookSecret } from "@/lib/communications/providers/sandbox-adapter";
import { signEnvelope } from "@/lib/communications/providers/shared";
import { EXTERNAL, oneOf, readJson, str } from "@/lib/communications/route-utils";

// Test-mode tool: feeds a SIGNED sandbox event through the real webhook pipeline (verification, idempotency, forward-only status),
// so the whole path can be exercised without a live provider. It cannot be used in production.
const TYPES = ["sent", "delivered", "read", "failed", "bounce", "complaint", "unsubscribe"] as const;

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("communications:providers:manage");
    if ((process.env.APP_ENV ?? process.env.VERCEL_ENV ?? process.env.NODE_ENV) === "production") throw new ApiError(403, "Webhook simulation is disabled in production.");
    const body = await readJson(req);
    const channel = oneOf(body.channel, EXTERNAL, "channel");
    const type = oneOf(body.type, TYPES, "type");
    const messageId = str(body.providerMessageId, "providerMessageId", { max: 200 });
    const eventId = str(body.eventId, "eventId", { max: 200, optional: true }) || createHmac("sha256", "simulate").update(messageId + type + Date.now()).digest("hex").slice(0, 24);
    const secret = sandboxWebhookSecret();
    if (!secret) throw new ApiError(503, "The sandbox webhook secret is not available.");
    const timestamp = Math.floor(Date.now() / 1000);
    const rawBody = JSON.stringify({ events: [{ eventId, messageId, type, timestamp }] });
    const outcome = await handleProviderWebhook(channel, { rawBody, url: req.url, headers: { "x-webhook-timestamp": String(timestamp), "x-webhook-signature": signEnvelope(secret, rawBody, timestamp) } });
    await writeAudit({ action: "WEBHOOK_SIMULATED", adminId: admin.id, meta: { channel, type, providerMessageId: messageId } });
    return NextResponse.json(outcome.body, { status: outcome.httpStatus });
  } catch (error) {
    return handleApiError(error);
  }
}
