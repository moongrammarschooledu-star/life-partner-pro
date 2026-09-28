import { prisma } from "@/lib/prisma";
import { publishSecurityEvent } from "@/lib/security/event-bus";
import { classify } from "@/lib/privacy/data-classification";
import type { DataProcessingPurpose } from "@prisma/client";

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
  // STEP 23 Add-on — purpose-limitation tagging (see
  // src/lib/compliance/purpose-mapping.ts's resolvePurposeForPermission()).
  // Optional and additive; omitting it changes nothing about this
  // function's existing, non-gating behavior.
  purpose?: DataProcessingPurpose | null;
}) {
  // STEP 24 — the single choke point for admin sensitive access also feeds the privileged-access
  // volume rule (distinct sensitive records per admin per window). Fail-open; admin-attributed only.
  if (params.actorAdminId && params.targetProfileId) {
    await publishSecurityEvent({ eventType: "ADMIN_SENSITIVE_ACCESS", adminId: params.actorAdminId, profileId: params.targetProfileId, source: "privacy-access-log", meta: { field: params.field } });
  }
  await prisma.privacyAccessLog.create({
    data: {
      actorAdminId: params.actorAdminId ?? null,
      actorProfileId: params.actorProfileId ?? null,
      action: params.action,
      dataCategory: classify(params.field),
      targetProfileId: params.targetProfileId ?? null,
      reason: params.reason ?? null,
      purpose: params.purpose ?? null,
    },
  });
}
