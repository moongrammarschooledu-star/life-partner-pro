import { writeAudit } from "@/lib/audit";
import type { AuditAction } from "@prisma/client";

// STEP 29 §48 — marketing audit entries. writeAudit() has no before/after/reason columns (and does not redact), so
// the convention — put them in `meta` — is applied here once, with a scrub so contact details, tokens and secrets can
// never be written into the audit trail by a careless caller.

const SENSITIVE_KEY = /(email|phone|mobile|whatsapp|token|secret|password|authorization|cookie|inquiry|address|fullname|ip(hash)?$)/i;
const MAX_VALUE = 300;

export function scrubForAudit(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (depth > 4) return "[truncated]";
  if (typeof value === "string") return value.length > MAX_VALUE ? `${value.slice(0, MAX_VALUE)}…` : value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => scrubForAudit(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = SENSITIVE_KEY.test(k) ? "[redacted]" : scrubForAudit(v, depth + 1);
    return out;
  }
  return String(value);
}

export interface MarketingAuditParams {
  action: AuditAction;
  actorId?: string | null;
  resource: string;
  resourceId: string;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  approvalId?: string | null;
  extra?: Record<string, unknown>;
}

export async function marketingAudit(p: MarketingAuditParams): Promise<void> {
  await writeAudit({
    action: p.action,
    adminId: p.actorId ?? null,
    meta: scrubForAudit({
      resource: p.resource,
      resourceId: p.resourceId,
      before: p.before,
      after: p.after,
      reason: p.reason ?? undefined,
      approvalId: p.approvalId ?? undefined,
      ...(p.extra ?? {}),
    }) as Record<string, unknown>,
  });
}
