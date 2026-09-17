import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";

// Spec §31 — scoped narrowly to the two most sensitive existing gates
// (contact reveal, case/privacy-incident access), not a platform-wide
// bypass; no other gate in the app consults this. Fully audited,
// auto-expiring, lazy-checked at read time like ProfileRestriction — no
// cron sweep needed.
const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1 hour

export type BreakGlassRecordType = "CONTACT" | "CASE";

export async function grantBreakGlass(params: {
  adminId: string;
  reason: string;
  recordType: BreakGlassRecordType;
  recordId: string;
  ttlMs?: number;
}) {
  const grant = await prisma.breakGlassAccess.create({
    data: {
      adminId: params.adminId,
      reason: params.reason,
      recordType: params.recordType,
      recordId: params.recordId,
      expiresAt: new Date(Date.now() + (params.ttlMs ?? DEFAULT_TTL_MS)),
    },
  });
  await writeAudit({
    action: "BREAK_GLASS_GRANTED",
    adminId: params.adminId,
    meta: { grantId: grant.id, recordType: params.recordType, recordId: params.recordId, reason: params.reason },
  });
  return grant;
}

export async function hasActiveBreakGlass(adminId: string, recordType: BreakGlassRecordType, recordId: string): Promise<boolean> {
  const now = new Date();
  const grant = await prisma.breakGlassAccess.findFirst({
    where: { adminId, recordType, recordId, expiresAt: { gt: now } },
    orderBy: { grantedAt: "desc" },
  });
  if (!grant) return false;
  if (!grant.usedAt) {
    await prisma.breakGlassAccess.update({ where: { id: grant.id }, data: { usedAt: now } });
    await writeAudit({ action: "BREAK_GLASS_USED", adminId, meta: { grantId: grant.id, recordType, recordId } });
  }
  return true;
}
