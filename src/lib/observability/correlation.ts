// Correlation IDs (spec §15/§53). proxy.ts injects `x-correlation-id` on every
// request; server code reads it back here. Never throws — outside a request
// (cron, scripts) it simply returns undefined.

export async function getCorrelationId(): Promise<string | undefined> {
  try {
    const { headers } = await import("next/headers");
    const h = await headers();
    return h.get("x-correlation-id") ?? undefined;
  } catch {
    return undefined;
  }
}

export async function getRequestMeta(): Promise<{ ip?: string; userAgent?: string; correlationId?: string }> {
  try {
    const { headers } = await import("next/headers");
    const h = await headers();
    const forwarded = h.get("x-forwarded-for");
    return {
      ip: forwarded?.split(",")[0]?.trim() || undefined,
      userAgent: h.get("user-agent")?.slice(0, 300) || undefined,
      correlationId: h.get("x-correlation-id") ?? undefined,
    };
  } catch {
    return {};
  }
}

export function newCorrelationId(): string {
  return crypto.randomUUID();
}
