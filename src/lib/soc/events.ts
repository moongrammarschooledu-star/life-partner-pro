import { publishSecurityEvent } from "@/lib/security/event-bus";
import { recordRateLimitExceeded } from "@/lib/soc/light-events";

// STEP 32 — thin, FAIL-OPEN helpers that feed the existing SecurityEventBus. The bus already minimises what it keeps (IP and user-agent only
// as salted hashes, meta redacted and size-capped), so these helpers only decide WHICH facts become events and pass identifiers, never
// payloads: no request bodies, no prompts, no file names, no secrets. Every function swallows its own errors — monitoring must never change
// what the caller returns.

type HeaderBag = Headers | Record<string, string | undefined> | undefined | null;

function header(h: HeaderBag, name: string): string | null {
  if (!h) return null;
  if (typeof (h as Headers).get === "function") return (h as Headers).get(name);
  const bag = h as Record<string, string | undefined>;
  const hit = Object.keys(bag).find((k) => k.toLowerCase() === name);
  return hit ? bag[hit] ?? null : null;
}

// The caller's network address as seen by the platform proxy; only ever hashed by the bus.
export function networkOf(h: HeaderBag): string | null {
  const forwarded = header(h, "x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || header(h, "x-real-ip") || null;
}

async function safe(input: Parameters<typeof publishSecurityEvent>[0]): Promise<void> {
  try {
    await publishSecurityEvent({ evaluate: false, ...input });
  } catch {
    /* fail-open */
  }
}

// ---- webhooks ----
export async function publishWebhookSignatureFailure(p: { provider: string; headers?: HeaderBag; reason?: string }): Promise<void> {
  await safe({ eventType: "WEBHOOK_SIGNATURE_FAILURE", source: "webhook", subject: p.provider, ip: networkOf(p.headers), outcome: "REJECTED", meta: { provider: p.provider.slice(0, 40), reason: (p.reason ?? "BAD_SIGNATURE").slice(0, 40) } });
}

export async function publishWebhookReplay(p: { provider: string; headers?: HeaderBag; kind: "STALE" | "DUPLICATE"; count?: number }): Promise<void> {
  await safe({ eventType: "WEBHOOK_REPLAY_ATTEMPT", source: "webhook", subject: p.provider, ip: networkOf(p.headers), outcome: p.kind, meta: { provider: p.provider.slice(0, 40), kind: p.kind, count: p.count ?? 1 } });
}

// ---- rate limits ----
export async function publishRateLimitExceeded(p: { name: string; ip?: string | null; subject?: string | null }): Promise<void> {
  await recordRateLimitExceeded(p);
}

// ---- backups ----
export async function publishBackupFailure(p: { kind: string; reason: string }): Promise<void> {
  await safe({ eventType: "BACKUP_FAILED", source: "backup", subject: "backup-job", outcome: "FAILED", meta: { kind: p.kind.slice(0, 40), reason: p.reason.slice(0, 80) } });
}

export async function publishBackupDeletionAttempt(p: { adminId?: string | null; reason: string }): Promise<void> {
  await safe({ eventType: "BACKUP_DELETION_ATTEMPT", source: "backup", adminId: p.adminId ?? null, subject: p.adminId ? null : "backup-job", outcome: "BLOCKED", meta: { reason: p.reason.slice(0, 80) } });
}

// ---- AI (pattern codes only — never the text) ----
export async function publishAiInjection(p: { adminId?: string | null; profileId?: string | null; feature: string; pattern: string }): Promise<void> {
  if (!p.adminId && !p.profileId) return;
  await safe({ eventType: "AI_PROMPT_INJECTION_SUSPECTED", source: "ai", adminId: p.adminId ?? null, profileId: p.profileId ?? null, outcome: "FLAGGED", meta: { feature: p.feature.slice(0, 40), pattern: p.pattern.slice(0, 40) } });
}

export async function publishAiUnauthorizedAction(p: { adminId?: string | null; profileId?: string | null; feature: string; action: string }): Promise<void> {
  if (!p.adminId && !p.profileId) return;
  await safe({ eventType: "AI_UNAUTHORIZED_ACTION_ATTEMPT", source: "ai", adminId: p.adminId ?? null, profileId: p.profileId ?? null, outcome: "BLOCKED", meta: { feature: p.feature.slice(0, 40), action: p.action.slice(0, 40) } });
}

// ---- admin sessions ----
export async function publishAdminNewDevice(p: { adminId: string; ip?: string | null; userAgent?: string | null }): Promise<void> {
  await safe({ eventType: "NEW_DEVICE_SESSION", source: "admin-login", adminId: p.adminId, ip: p.ip ?? null, userAgent: p.userAgent ?? null, outcome: "NEW_DEVICE", meta: { scope: "ADMIN" } });
}

export async function publishSessionAnomaly(p: { adminId: string; reason: "IDLE_TIMEOUT" | "TOO_MANY_SESSIONS" | "REVOKED_USE"; ip?: string | null }): Promise<void> {
  await safe({ eventType: "ADMIN_SESSION_ANOMALY", source: "session-policy", adminId: p.adminId, ip: p.ip ?? null, outcome: p.reason, meta: { reason: p.reason } });
}

// ---- mirror of selected audit actions ----
// Lives in the light module (imported by the audit writer, which nearly every route uses); re-exported here for the screens and tests.
export { mirrorAuditAction, mirroredEventType } from "@/lib/soc/light-events";
