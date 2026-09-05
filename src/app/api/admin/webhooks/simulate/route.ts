import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { processWebhookEvent, type WebhookEventType } from "@/lib/notifications/webhook-processor";

const VALID_EVENT_TYPES: WebhookEventType[] = ["DELIVERED", "READ", "FAILED", "BOUNCED"];

// Admin-only test-mode action (spec §28/§32) — since no real provider exists
// to send a genuine webhook in this environment, this fires a synthetic
// event through the exact same processing pipeline as the real inbound
// route, so the whole delivery-status pipeline is actually verifiable live.
export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("communication:send");
    const { communicationLogId, eventType } = await req.json();

    if (!VALID_EVENT_TYPES.includes(eventType)) throw new ApiError(400, "Invalid eventType");
    if (!communicationLogId) throw new ApiError(400, "communicationLogId is required");

    const log = await prisma.communicationLog.findUnique({ where: { id: communicationLogId } });
    if (!log) throw new ApiError(404, "Communication log entry not found");
    if (!log.providerMessageId) throw new ApiError(400, "This entry has no providerMessageId to correlate against");

    const result = await processWebhookEvent({
      provider: "simulated",
      eventType,
      providerMessageId: log.providerMessageId,
      idempotencyKey: `simulated-${log.id}-${eventType}-${randomUUID()}`,
      auditAction: "WEBHOOK_SIMULATED",
      adminId: admin.id,
    });

    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
