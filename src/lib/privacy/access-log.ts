import { prisma } from "@/lib/prisma";
import { classify } from "@/lib/privacy/data-classification";

// Spec §30 — a focused, queryable-without-scanning-AuditLog access trail for
// high-sensitivity touchpoints, mirroring STEP 12's CaseAccessLog precedent.
// This exists for the "who accessed what, why, when" record; it is not a
// gate — actual access control runs through the existing/extended
// permission checks before this is ever called.
export async function logPrivacyAccess(params: {
  actorAdminId?: string | null;
  actorProfileId?: string | null;
  action: string;
  field: string; // looked up in data-classification.ts for the stored category
  targetProfileId?: string | null;
  reason?: string | null;
}) {
  await prisma.privacyAccessLog.create({
    data: {
      actorAdminId: params.actorAdminId ?? null,
      actorProfileId: params.actorProfileId ?? null,
      action: params.action,
      dataCategory: classify(params.field),
      targetProfileId: params.targetProfileId ?? null,
      reason: params.reason ?? null,
    },
  });
}
