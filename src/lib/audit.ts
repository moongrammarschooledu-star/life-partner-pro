import { prisma } from "@/lib/prisma";
import type { AuditAction } from "@prisma/client";

export async function writeAudit(params: {
  action: AuditAction;
  adminId?: string | null;
  targetProfileId?: string | null;
  meta?: Record<string, unknown>;
}) {
  await prisma.auditLog.create({
    data: {
      action: params.action,
      adminId: params.adminId ?? null,
      targetProfileId: params.targetProfileId ?? null,
      meta: params.meta ? JSON.stringify(params.meta) : null,
    },
  });
}
