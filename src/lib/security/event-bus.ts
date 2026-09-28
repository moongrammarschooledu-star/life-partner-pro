import { createHmac } from "crypto";
import { prisma } from "@/lib/prisma";
import { getEffectiveRule } from "@/lib/risk/config";
import { redactPayload } from "@/lib/security/redact";
import type { SecurityEventType } from "@prisma/client";

// SecurityEventBus. One place where security-relevant facts enter the risk
// system. Design rules (spec §"SecurityEventBus" + privacy):
//   - normalize: only allow-listed event types; meta is redacted + size-capped;
//   - minimize: IP / user-agent are stored ONLY as salted HMACs, and only when
//     the corresponding rule is enabled (device/network are OFF by default);
//   - idempotent: an idempotencyKey makes webhook/retry replays a no-op;
//   - FAIL-OPEN: publishing must never break the caller's request — every path
//     returns instead of throwing, and real-time evaluation is time-bounded.

export interface SecurityEventInput {
  eventType: SecurityEventType;
  source?: string;
  profileId?: string | null;
  adminId?: string | null;
  familyMemberId?: string | null;
  // A raw pre-auth identifier (phone/e-mail) — stored only as a salted hash.
  subject?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  outcome?: string | null;
  meta?: Record<string, unknown>;
  idempotencyKey?: string | null;
  evaluate?: boolean; // default true
}

export interface PublishResult {
  recorded: boolean;
  id?: string;
  reason?: "DUPLICATE" | "INVALID" | "ERROR";
}

const ALLOWED_TYPES = new Set<string>([
  "ACCOUNT_CREATED", "LOGIN_SUCCESS", "LOGIN_FAILED", "OTP_REQUESTED", "OTP_FAILED", "PASSWORD_RESET", "PROFILE_UPDATED", "CONTACT_UPDATED",
  "VERIFICATION_STARTED", "VERIFICATION_FAILED", "DOCUMENT_UPLOADED", "PROPOSAL_CREATED", "CONTACT_REQUESTED", "FAMILY_INVITE_CREATED",
  "FAMILY_ACCESS_REQUESTED", "PAYMENT_FAILED", "ADMIN_SENSITIVE_ACCESS", "API_AUTH_FAILURE", "PERMISSION_DENIED", "CONTACT_BYPASS_ATTEMPT", "NEW_DEVICE_SESSION",
]);

// Events whose evaluation must not wait for the daily batch.
export const REALTIME_EVENT_TYPES = new Set<string>([
  "LOGIN_FAILED", "OTP_REQUESTED", "OTP_FAILED", "CONTACT_BYPASS_ATTEMPT", "PERMISSION_DENIED", "API_AUTH_FAILURE",
  "ADMIN_SENSITIVE_ACCESS", "FAMILY_INVITE_CREATED", "FAMILY_ACCESS_REQUESTED", "PROFILE_UPDATED", "CONTACT_UPDATED", "PAYMENT_FAILED", "VERIFICATION_FAILED",
]);

// Auth-related events need a network hash for the (expiring) IP-block control;
// everything else stores one only when the network rule is switched on.
const AUTH_TYPES = new Set<string>(["LOGIN_FAILED", "LOGIN_SUCCESS", "OTP_REQUESTED", "OTP_FAILED", "API_AUTH_FAILURE", "PASSWORD_RESET"]);

const EVALUATION_TIMEOUT_MS = 1500;
const MAX_META_BYTES = 1024;

function hashSecret(): string {
  return process.env.RISK_HASH_SALT ?? process.env.NEXTAUTH_SECRET ?? "lpp-dev-risk-salt";
}

// Salted HMAC: not reversible without the server secret, stable so counting works.
export function hashIdentifier(value: string): string {
  return createHmac("sha256", hashSecret()).update(value.trim().toLowerCase()).digest("hex").slice(0, 32);
}

export function sanitizeMeta(meta?: Record<string, unknown>): string | null {
  if (!meta) return null;
  let json = JSON.stringify(redactPayload(meta, 120));
  if (json.length > MAX_META_BYTES) json = JSON.stringify({ truncated: true });
  return json === "{}" ? null : json;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002";
}

export async function publishSecurityEvent(input: SecurityEventInput): Promise<PublishResult> {
  try {
    if (!ALLOWED_TYPES.has(input.eventType)) return { recorded: false, reason: "INVALID" };
    if (!input.profileId && !input.adminId && !input.familyMemberId && !input.subject && !input.ip) return { recorded: false, reason: "INVALID" };

    const [network, device] = await Promise.all([getEffectiveRule("unusual_network"), getEffectiveRule("shared_device")]);
    const keepIp = !!input.ip && (AUTH_TYPES.has(input.eventType) || network.config.enabled === true);
    const keepUa = !!input.userAgent && device.config.enabled === true;

    let created;
    try {
      created = await prisma.securityEvent.create({
        data: {
          eventType: input.eventType,
          source: input.source ?? "app",
          profileId: input.profileId ?? null,
          adminId: input.adminId ?? null,
          familyMemberId: input.familyMemberId ?? null,
          subjectKey: input.subject ? hashIdentifier(input.subject) : null,
          ipHash: keepIp ? hashIdentifier(input.ip as string) : null,
          userAgentHash: keepUa ? hashIdentifier(input.userAgent as string) : null,
          outcome: input.outcome ?? null,
          meta: sanitizeMeta(input.meta),
          idempotencyKey: input.idempotencyKey ?? null,
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) return { recorded: false, reason: "DUPLICATE" };
      throw error;
    }

    if (input.evaluate !== false && REALTIME_EVENT_TYPES.has(input.eventType)) {
      // Dynamic import: the rule engine depends on services that must not import the bus.
      const { RiskRuleEngine } = await import("@/lib/risk/rule-engine");
      await Promise.race([
        RiskRuleEngine.evaluateSecurityEvent(created).catch(() => undefined),
        new Promise<void>((resolve) => setTimeout(resolve, EVALUATION_TIMEOUT_MS)),
      ]);
    }
    return { recorded: true, id: created.id };
  } catch (error) {
    console.error("[security-event-bus] publish failed (fail-open)", error instanceof Error ? error.message : "unknown");
    return { recorded: false, reason: "ERROR" };
  }
}

// Retention: raw events are short-lived working data (they are evidence only
// once copied into RiskEvidence). Never deletes rows that belong to an open
// case's window or are under a legal hold — REVIEW_REQUIRED when unsure.
export async function sweepSecurityEvents(retentionDays = 90): Promise<{ deleted: number; skipped: number; reviewRequired: boolean }> {
  const cutoff = new Date(Date.now() - retentionDays * 86_400_000);
  const openCaseProfiles = await prisma.riskCase.findMany({
    where: { status: { in: ["OPEN", "ACKNOWLEDGED", "UNDER_INVESTIGATION", "INFORMATION_REQUESTED", "ESCALATED", "RESTRICTED", "SUSPENDED"] } },
    select: { subjectProfileId: true, subjectAdminId: true },
  });
  const protectedProfiles = openCaseProfiles.map((c) => c.subjectProfileId).filter((x): x is string => !!x);
  const protectedAdmins = openCaseProfiles.map((c) => c.subjectAdminId).filter((x): x is string => !!x);

  let holdProfiles: string[] = [];
  try {
    const holds = await prisma.dataHold.findMany({ where: { active: true }, select: { profileId: true, recordType: true } });
    // A hold with no profile scope could cover anything: don't delete, ask a human.
    if (holds.some((h) => !h.profileId && !h.recordType)) return { deleted: 0, skipped: 0, reviewRequired: true };
    holdProfiles = holds.map((h) => h.profileId).filter((x): x is string => !!x);
  } catch {
    // If holds cannot be read we cannot prove deletion is safe.
    return { deleted: 0, skipped: 0, reviewRequired: true };
  }

  const keepProfiles = [...new Set([...protectedProfiles, ...holdProfiles])];
  const result = await prisma.securityEvent.deleteMany({
    where: {
      createdAt: { lt: cutoff },
      ...(keepProfiles.length ? { OR: [{ profileId: null }, { profileId: { notIn: keepProfiles } }] } : {}),
      ...(protectedAdmins.length ? { AND: [{ OR: [{ adminId: null }, { adminId: { notIn: protectedAdmins } }] }] } : {}),
    },
  });
  return { deleted: result.count, skipped: keepProfiles.length + protectedAdmins.length, reviewRequired: false };
}
