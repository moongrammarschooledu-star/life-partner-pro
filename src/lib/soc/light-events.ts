import { prisma } from "@/lib/prisma";
import { hashIdentifier } from "@/lib/security/hash";
import { redactPayload } from "@/lib/security/redact";
import type { AuditAction, SecurityEventType } from "@prisma/client";

// STEP 32 — the LIGHT path into the security event ledger, for code that almost every route imports (the audit writer and the rate limiter).
// It writes one SecurityEvent row directly and imports nothing but the database client, a hash helper and the redaction helper — NOT the
// event bus, which brings the whole risk rule engine with it. A module imported by hundreds of routes must stay this small, otherwise every
// route's build graph grows (a structure test pins this module's imports). Same privacy rules as the bus: identifiers are salted hashes,
// notes are redacted and size-capped, and a failure is swallowed (monitoring never changes what a request returns).

const MAX_META_BYTES = 1024;

export interface LightEvent {
  eventType: SecurityEventType;
  source: string;
  adminId?: string | null;
  ip?: string | null;
  subject?: string | null;
  outcome?: string | null;
  meta?: Record<string, unknown>;
}

export async function recordLightEvent(e: LightEvent): Promise<void> {
  try {
    if (!e.adminId && !e.ip && !e.subject) return; // nothing to attribute or count
    let meta: string | null = null;
    if (e.meta) {
      const json = JSON.stringify(redactPayload(e.meta, 120));
      meta = json === "{}" ? null : json.length > MAX_META_BYTES ? JSON.stringify({ truncated: true }) : json;
    }
    await prisma.securityEvent.create({
      data: {
        eventType: e.eventType,
        source: e.source,
        adminId: e.adminId ?? null,
        subjectKey: e.subject ? hashIdentifier(e.subject) : null,
        ipHash: e.ip ? hashIdentifier(e.ip) : null,
        outcome: e.outcome ?? null,
        meta,
      },
    });
  } catch {
    /* fail-open */
  }
}

export async function recordRateLimitExceeded(p: { name: string; ip?: string | null; subject?: string | null }): Promise<void> {
  await recordLightEvent({ eventType: "RATE_LIMIT_EXCEEDED", source: "rate-limit", ip: p.ip ?? null, subject: p.subject ?? null, outcome: "BLOCKED", meta: { limit: p.name.slice(0, 60) } });
}

// ---- selected audit actions mirrored into the event feed ----
// One central place instead of a call in every export / role / search route: the audit writer already sees every one of these actions once,
// with the acting admin, so it forwards a minimal event. Only rare or high-signal actions are mirrored.
const MIRRORED: Partial<Record<AuditAction, SecurityEventType>> = {
  REPORT_EXPORTED: "BULK_EXPORT",
  SENSITIVE_DATA_EXPORTED: "BULK_EXPORT",
  FINANCIAL_REPORT_EXPORTED: "BULK_EXPORT",
  DATA_EXPORT_CREATED: "BULK_EXPORT",
  DOCUMENT_EXPORTED: "BULK_EXPORT",
  CRM_EXPORT: "BULK_EXPORT",
  MARKETING_LEAD_EXPORTED: "BULK_EXPORT",
  ENGAGEMENT_EXPORT: "BULK_EXPORT",
  ANALYTICS_REPORT_EXPORTED: "BULK_EXPORT",
  SEARCH_EXPORT_PERFORMED: "BULK_EXPORT",
  ADMIN_USER_CREATED: "ADMIN_PRIVILEGE_CHANGE",
  ADMIN_USER_ROLE_CHANGED: "ADMIN_PRIVILEGE_CHANGE",
  CUSTOM_ROLE_PERMISSIONS_CHANGED: "ADMIN_PRIVILEGE_CHANGE",
  ADMIN_ROLE_ASSIGNED: "ADMIN_PRIVILEGE_CHANGE",
  ADMIN_ROLE_REMOVED: "ADMIN_PRIVILEGE_CHANGE",
  ADMIN_PERMISSION_GRANTED: "ADMIN_PRIVILEGE_CHANGE",
  ADMIN_PERMISSION_REVOKED: "ADMIN_PRIVILEGE_CHANGE",
  ADMIN_SENSITIVE_PERMISSION_GRANTED: "ADMIN_PRIVILEGE_CHANGE",
  ADMIN_SENSITIVE_PERMISSION_REVOKED: "ADMIN_PRIVILEGE_CHANGE",
  BREAK_GLASS_USED: "BREAK_GLASS_USED",
  CONTACT_VIEWED: "SENSITIVE_RECORD_ACCESS",
  SENSITIVE_DATA_VIEWED: "SENSITIVE_RECORD_ACCESS",
  VERIFICATION_DOCUMENT_DOWNLOADED: "SENSITIVE_RECORD_ACCESS",
  DOCUMENT_DOWNLOADED: "SENSITIVE_RECORD_ACCESS",
  EVIDENCE_DOWNLOADED: "SENSITIVE_RECORD_ACCESS",
  MARKETING_LEAD_CONTACT_VIEWED: "SENSITIVE_RECORD_ACCESS",
  SEARCH_PERFORMED: "PROFILE_SEARCH",
  SENSITIVE_SEARCH_PERFORMED: "PROFILE_SEARCH",
  MUTUAL_MATCH_SEARCH_PERFORMED: "PROFILE_SEARCH",
  SECURITY_SETTINGS_CHANGED: "SECURITY_CONFIG_CHANGED",
  SOC_CONFIG_CHANGED: "SECURITY_CONFIG_CHANGED",
};

export function mirroredEventType(action: AuditAction): SecurityEventType | null {
  return MIRRORED[action] ?? null;
}

export async function mirrorAuditAction(action: AuditAction, adminId: string | null | undefined): Promise<void> {
  const eventType = mirroredEventType(action);
  if (!eventType || !adminId) return; // an event with no acting admin could not be attributed or counted per person
  await recordLightEvent({ eventType, source: "audit", adminId, outcome: "RECORDED", meta: { action } });
}
