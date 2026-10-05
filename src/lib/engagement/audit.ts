import { writeAudit } from "@/lib/audit";
import { scrubForAudit } from "@/lib/marketing/audit";
import type { AuditAction } from "@prisma/client";

// STEP 30 — engagement audit entries. Same convention as the marketing audit (before/after/reason live in `meta`), reusing
// its scrubber so contact details, tokens and secrets can never be written into the audit trail by a careless caller.

export interface EngagementAuditParams {
  action: AuditAction;
  actorId?: string | null;
  targetProfileId?: string | null;
  resource: string;
  resourceId: string;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  approvalId?: string | null;
  extra?: Record<string, unknown>;
}

export async function engagementAudit(p: EngagementAuditParams): Promise<void> {
  await writeAudit({
    action: p.action,
    adminId: p.actorId ?? null,
    targetProfileId: p.targetProfileId ?? undefined,
    meta: scrubForAudit({ resource: p.resource, resourceId: p.resourceId, before: p.before, after: p.after, reason: p.reason ?? undefined, approvalId: p.approvalId ?? undefined, ...(p.extra ?? {}) }) as Record<string, unknown>,
  });
}
