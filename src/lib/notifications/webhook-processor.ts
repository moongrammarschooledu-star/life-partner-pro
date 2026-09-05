import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";

export type WebhookEventType = "DELIVERED" | "READ" | "FAILED" | "BOUNCED";

const STATUS_FOR_EVENT: Record<WebhookEventType, "DELIVERED" | "READ" | "FAILED"> = {
  DELIVERED: "DELIVERED",
  READ: "READ",
  FAILED: "FAILED",
  BOUNCED: "FAILED",
};

// Idempotent — a duplicate idempotencyKey is a silent no-op (spec §28).
// Shared by the real inbound webhook route and the admin "Simulate Webhook"
// test-mode action so both exercise identical processing logic.
export async function processWebhookEvent(params: {
  provider: string;
  eventType: WebhookEventType;
  providerMessageId: string;
  idempotencyKey: string;
  payload?: unknown;
  auditAction: "WEBHOOK_PROCESSED" | "WEBHOOK_SIMULATED";
  adminId?: string;
}): Promise<{ ok: boolean; alreadyProcessed?: boolean }> {
  const existing = await prisma.webhookEvent.findUnique({ where: { idempotencyKey: params.idempotencyKey } });
  if (existing) return { ok: true, alreadyProcessed: true };

  await prisma.webhookEvent.create({
    data: {
      provider: params.provider,
      eventType: params.eventType,
      providerMessageId: params.providerMessageId,
      idempotencyKey: params.idempotencyKey,
      payload: params.payload ? (params.payload as never) : undefined,
      processedAt: new Date(),
    },
  });

  const log = await prisma.communicationLog.findFirst({ where: { providerMessageId: params.providerMessageId } });
  if (log) {
    const now = new Date();
    await prisma.communicationLog.update({
      where: { id: log.id },
      data: {
        deliveryStatus: STATUS_FOR_EVENT[params.eventType],
        ...(params.eventType === "DELIVERED" ? { deliveredAt: now } : {}),
        ...(params.eventType === "READ" ? { readAt: now } : {}),
        ...(params.eventType === "FAILED" || params.eventType === "BOUNCED" ? { failureReason: params.eventType } : {}),
      },
    });
  }

  await writeAudit({
    action: params.auditAction,
    adminId: params.adminId ?? null,
    meta: { provider: params.provider, eventType: params.eventType, providerMessageId: params.providerMessageId },
  });

  return { ok: true };
}
