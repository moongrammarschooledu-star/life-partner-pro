import { prisma } from "@/lib/prisma";
import { getRequestMeta } from "@/lib/observability/correlation";
import type { AuditAction } from "@prisma/client";

export async function writeAudit(params: {
  action: AuditAction;
  adminId?: string | null;
  targetProfileId?: string | null;
  meta?: Record<string, unknown>;
}) {
  // STEP 15 — correlation ID for every audit row; IP/user-agent only for
  // admin-attributed actions (applicant IPs are deliberately not stored here).
  const request = await getRequestMeta();
  await prisma.auditLog.create({
    data: {
      action: params.action,
      adminId: params.adminId ?? null,
      targetProfileId: params.targetProfileId ?? null,
      meta: params.meta ? JSON.stringify(params.meta) : null,
      correlationId: request.correlationId ?? null,
      ipAddress: params.adminId ? (request.ip ?? null) : null,
      userAgent: params.adminId ? (request.userAgent ?? null) : null,
    },
  });
}
