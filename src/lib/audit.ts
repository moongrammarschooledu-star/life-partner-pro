import { prisma } from "@/lib/prisma";
import { getRequestMeta } from "@/lib/observability/correlation";
import type { AuditAction } from "@prisma/client";

export async function writeAudit(params: {
  action: AuditAction;
  adminId?: string | null;
  targetProfileId?: string | null;
  // STEP 22 — distinguishes "a family member acted on this profile's data"
  // from "the profile owner acted on themselves" (still just adminId and
  // actorFamilyMemberId both omitted, by the pre-existing convention).
  actorFamilyMemberId?: string | null;
  meta?: Record<string, unknown>;
}) {
  // STEP 15 — correlation ID for every audit row; IP/user-agent only for
  // admin-attributed actions (applicant/family-member IPs are deliberately
  // not stored here).
  const request = await getRequestMeta();
  await prisma.auditLog.create({
    data: {
      action: params.action,
      adminId: params.adminId ?? null,
      targetProfileId: params.targetProfileId ?? null,
      actorFamilyMemberId: params.actorFamilyMemberId ?? null,
      meta: params.meta ? JSON.stringify(params.meta) : null,
      correlationId: request.correlationId ?? null,
      ipAddress: params.adminId ? (request.ip ?? null) : null,
      userAgent: params.adminId ? (request.userAgent ?? null) : null,
    },
  });
  // STEP 32 — selected high-signal actions (exports, privilege changes, break-glass, sensitive access, searches, security configuration)
  // are forwarded once, minimally, to the security event bus. Dynamic import: the bus must not be loaded for the ordinary audit write,
  // and it can never throw back into the caller.
  if (params.adminId && MIRROR_PREFILTER.has(params.action)) {
    try {
      const { mirrorAuditAction } = await import("@/lib/soc/events");
      await mirrorAuditAction(params.action, params.adminId);
    } catch {
      /* fail-open */
    }
  }
}

// Cheap pre-check so the common actions never touch the SOC module at all (kept in step with MIRRORED in soc/events.ts by a test).
const MIRROR_PREFILTER: ReadonlySet<AuditAction> = new Set<AuditAction>([
  "REPORT_EXPORTED", "SENSITIVE_DATA_EXPORTED", "FINANCIAL_REPORT_EXPORTED", "DATA_EXPORT_CREATED", "DOCUMENT_EXPORTED", "CRM_EXPORT",
  "MARKETING_LEAD_EXPORTED", "ENGAGEMENT_EXPORT", "ANALYTICS_REPORT_EXPORTED", "SEARCH_EXPORT_PERFORMED", "ADMIN_USER_CREATED",
  "ADMIN_USER_ROLE_CHANGED", "CUSTOM_ROLE_PERMISSIONS_CHANGED", "ADMIN_ROLE_ASSIGNED", "ADMIN_ROLE_REMOVED", "ADMIN_PERMISSION_GRANTED",
  "ADMIN_PERMISSION_REVOKED", "ADMIN_SENSITIVE_PERMISSION_GRANTED", "ADMIN_SENSITIVE_PERMISSION_REVOKED", "BREAK_GLASS_USED", "CONTACT_VIEWED",
  "SENSITIVE_DATA_VIEWED", "VERIFICATION_DOCUMENT_DOWNLOADED", "DOCUMENT_DOWNLOADED", "EVIDENCE_DOWNLOADED", "MARKETING_LEAD_CONTACT_VIEWED",
  "SEARCH_PERFORMED", "SENSITIVE_SEARCH_PERFORMED", "MUTUAL_MATCH_SEARCH_PERFORMED", "SECURITY_SETTINGS_CHANGED", "SOC_CONFIG_CHANGED",
]);
