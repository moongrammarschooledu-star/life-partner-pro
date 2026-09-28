import { prisma } from "@/lib/prisma";

// Provider health. Counters live on the CommunicationProvider row (spec's communication_provider_health folded in); every send
// outcome and webhook updates them. Built-in default providers (no DB row) are simply not tracked here.

export function healthFromCounters(consecutiveFailures: number, lastSuccessAt: Date | null): "HEALTHY" | "DEGRADED" | "DOWN" | "UNKNOWN" {
  if (consecutiveFailures >= 5) return "DOWN";
  if (consecutiveFailures >= 2) return "DEGRADED";
  if (lastSuccessAt) return "HEALTHY";
  return "UNKNOWN";
}

export async function recordProviderOutcome(providerKey: string, outcome: { ok: boolean; error?: string }): Promise<void> {
  try {
    const row = await prisma.communicationProvider.findUnique({ where: { providerKey }, select: { id: true, consecutiveFailures: true, lastSuccessAt: true } });
    if (!row) return;
    const now = new Date();
    const consecutiveFailures = outcome.ok ? 0 : row.consecutiveFailures + 1;
    const lastSuccessAt = outcome.ok ? now : row.lastSuccessAt;
    await prisma.communicationProvider.update({
      where: { id: row.id },
      data: { consecutiveFailures, healthStatus: healthFromCounters(consecutiveFailures, lastSuccessAt), ...(outcome.ok ? { lastSuccessAt: now } : { lastFailureAt: now, lastError: (outcome.error ?? "error").slice(0, 200) }) },
    });
  } catch {
    // health tracking must never affect delivery
  }
}

export async function recordProviderWebhook(providerKey: string): Promise<void> {
  try {
    await prisma.communicationProvider.updateMany({ where: { providerKey }, data: { lastWebhookAt: new Date() } });
  } catch {
    // ignore
  }
}

export interface ProviderHealthRow {
  providerKey: string;
  name: string;
  channel: string;
  environment: string;
  active: boolean;
  healthStatus: string;
  successRate24h: number | null;
  failureRate24h: number | null;
  sent24h: number;
  failed24h: number;
  avgLatencySeconds: number | null; // queued -> sent, from real timestamps
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  lastWebhookAt: Date | null;
  lastError: string | null;
  quota: string; // not observable without a provider API; stated honestly
}

export async function getProviderHealth(now = new Date()): Promise<ProviderHealthRow[]> {
  const since = new Date(now.getTime() - 24 * 3_600_000);
  const [providers, logs] = await Promise.all([
    prisma.communicationProvider.findMany({ orderBy: [{ channel: "asc" }, { priority: "asc" }] }),
    prisma.communicationLog.findMany({ where: { createdAt: { gte: since }, provider: { not: null }, isTest: false }, select: { provider: true, deliveryStatus: true, queuedAt: true, sentAt: true }, take: 5000 }),
  ]);
  return providers.map((p) => {
    const mine = logs.filter((l) => l.provider === p.providerKey);
    const failed = mine.filter((l) => ["FAILED", "BOUNCED", "REJECTED"].includes(l.deliveryStatus)).length;
    const sent = mine.filter((l) => ["SENT", "DELIVERED", "READ"].includes(l.deliveryStatus)).length;
    const total = sent + failed;
    const latencies = mine.filter((l) => l.queuedAt && l.sentAt).map((l) => ((l.sentAt as Date).getTime() - (l.queuedAt as Date).getTime()) / 1000);
    return {
      providerKey: p.providerKey,
      name: p.name,
      channel: p.channel,
      environment: p.environment,
      active: p.active,
      healthStatus: p.healthStatus,
      successRate24h: total ? Math.round((sent / total) * 100) / 100 : null,
      failureRate24h: total ? Math.round((failed / total) * 100) / 100 : null,
      sent24h: sent,
      failed24h: failed,
      avgLatencySeconds: latencies.length ? Math.round((latencies.reduce((a, b) => a + b, 0) / latencies.length) * 10) / 10 : null,
      lastSuccessAt: p.lastSuccessAt,
      lastFailureAt: p.lastFailureAt,
      lastWebhookAt: p.lastWebhookAt,
      lastError: p.lastError,
      quota: "Not reported - the provider dashboard is the source for quota.",
    };
  });
}

// The alert conditions the spec lists. Pure: gets rows, returns codes.
export type ProviderAlertCode = "PROVIDER_DOWN" | "HIGH_FAILURE_RATE" | "WEBHOOK_FAILURE" | "QUOTA_WARNING" | "AUTHENTICATION_FAILURE";

export function providerAlerts(row: Pick<ProviderHealthRow, "active" | "healthStatus" | "failureRate24h" | "sent24h" | "failed24h" | "lastError" | "lastWebhookAt">, now = new Date()): ProviderAlertCode[] {
  if (!row.active) return [];
  const out: ProviderAlertCode[] = [];
  if (row.healthStatus === "DOWN") out.push("PROVIDER_DOWN");
  if (row.failureRate24h !== null && row.sent24h + row.failed24h >= 10 && row.failureRate24h >= 0.3) out.push("HIGH_FAILURE_RATE");
  if (row.lastError && /AUTHENTICATION/i.test(row.lastError)) out.push("AUTHENTICATION_FAILURE");
  if (row.lastError && /QUOTA|RATE_LIMIT|429/i.test(row.lastError)) out.push("QUOTA_WARNING");
  // A provider that sent traffic today but has never (or not recently) called back is worth a look.
  if (row.sent24h >= 20 && (!row.lastWebhookAt || now.getTime() - row.lastWebhookAt.getTime() > 48 * 3_600_000)) out.push("WEBHOOK_FAILURE");
  return out;
}
