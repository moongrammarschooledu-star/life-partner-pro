import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { HttpError } from "@/lib/http-error";
import { clientKeyFromRequest } from "@/lib/rate-limit";
import { enforcePersistentLimit, tooManyRequests } from "@/lib/ops/rate-limit-persistent";
import { hashIdentifier } from "@/lib/security/event-bus";
import { isControlActive } from "@/lib/risk/technical-controls";

// Configurable, persisted rate limiting. The call site supplies its CURRENT
// limit as the default, so with an empty RateLimitPolicy table behaviour is
// unchanged; an active policy row (versioned, audited) can tighten or relax it
// within hard bounds. Active technical controls (expiring IP-hash / subject
// throttles) are honoured here too.

export interface LimitDefaults {
  limit: number;
  windowMs: number;
}

// Registry of the limiter names in use, with their shipped defaults. Only
// registered names may be configured, and a configured limit may never exceed
// 10x the default nor fall below 1 (a tampered policy cannot switch limiting off).
export const KNOWN_LIMITS: Record<string, LimitDefaults> = {
  register: { limit: 5, windowMs: 60_000 },
  support: { limit: 5, windowMs: 60_000 },
  "update-request": { limit: 10, windowMs: 60_000 },
  "my-status": { limit: 10, windowMs: 60_000 },
  "otp-email-send": { limit: 5, windowMs: 60_000 },
  "otp-email-confirm": { limit: 10, windowMs: 60_000 },
  "otp-phone-send": { limit: 5, windowMs: 60_000 },
  "otp-phone-confirm": { limit: 10, windowMs: 60_000 },
  "family-login": { limit: 10, windowMs: 60_000 },
  "family-register": { limit: 10, windowMs: 60_000 },
  "my-account-reauth-confirm": { limit: 10, windowMs: 60_000 },
  "my-account-reauth-send": { limit: 5, windowMs: 60_000 },
  "my-billing-checkout": { limit: 10, windowMs: 60_000 },
  "assisted-matchmaking": { limit: 5, windowMs: 60_000 },
  "priority-support": { limit: 5, windowMs: 60_000 },
  "my-cases-create": { limit: 10, windowMs: 60_000 },
  "my-reports-create": { limit: 5, windowMs: 60_000 },
  "my-family-invitations": { limit: 10, windowMs: 60_000 },
  "my-family-invitations-resend": { limit: 10, windowMs: 60_000 },
  "my-privacy-requests": { limit: 10, windowMs: 60_000 },
  "my-profile-photo-upload": { limit: 10, windowMs: 60_000 },
  "my-proposals-respond": { limit: 20, windowMs: 60_000 },
  "my-proposals-contact-permission": { limit: 20, windowMs: 60_000 },
  "verification-doc-upload": { limit: 5, windowMs: 60_000 },
  "verification-session": { limit: 5, windowMs: 60_000 },
  "my-communications-reply": { limit: 20, windowMs: 60_000 },
  "my-documents-upload": { limit: 10, windowMs: 60_000 },
  "my-documents-share-request": { limit: 10, windowMs: 60_000 },
  "my-referrals-link": { limit: 5, windowMs: 60_000 },
  "my-coupons-validate": { limit: 20, windowMs: 60_000 },
  // STEP 29 — public marketing surface
  "marketing-form-submit": { limit: 5, windowMs: 60_000 },
  "marketing-form-submit-destination": { limit: 3, windowMs: 3_600_000 },
  "marketing-form-token": { limit: 30, windowMs: 60_000 },
  "marketing-events": { limit: 60, windowMs: 60_000 },
  "marketing-webhook": { limit: 600, windowMs: 60_000 },
  // STEP 30 - applicant-side engagement writes (feedback, announcement dismissal, preference changes)
  "engagement-feedback": { limit: 5, windowMs: 3_600_000 },
  "engagement-preferences": { limit: 30, windowMs: 3_600_000 },
};

const CACHE_TTL_MS = 30_000;
const cache = new Map<string, { at: number; limit: number; windowMs: number }>();
export function clearRateLimitPolicyCache(): void {
  cache.clear();
}

async function effectiveLimit(name: string, defaults: LimitDefaults): Promise<LimitDefaults> {
  const hit = cache.get(name);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return { limit: hit.limit, windowMs: hit.windowMs };
  let value = defaults;
  try {
    const row = await prisma.rateLimitPolicy.findFirst({ where: { policyKey: name, status: "ACTIVE", enabled: true }, orderBy: { version: "desc" } });
    if (row) value = { limit: Math.min(Math.max(row.limit, 1), defaults.limit * 10), windowMs: Math.min(Math.max(row.windowSeconds, 10), 86_400) * 1000 };
  } catch {
    // fall back to the shipped default
  }
  cache.set(name, { at: Date.now(), limit: value.limit, windowMs: value.windowMs });
  return value;
}

// Returns a 429 response when the caller is limited (by policy, by an active
// technical control, or by the persistent counter), otherwise null.
export async function enforceConfiguredLimit(req: Request, name: string, defaults: LimitDefaults, subject?: string): Promise<NextResponse | null> {
  try {
    if (await isControlActive("IP_BLOCK", "IP_HASH", hashIdentifier(clientKeyFromRequest(req)))) return tooManyRequests(300);
    if (subject && (await isControlActive("SUBJECT_THROTTLE", "SUBJECT_KEY", hashIdentifier(subject)))) return tooManyRequests(300);
  } catch {
    // controls are best-effort; the persistent limiter below still applies
  }
  const { limit, windowMs } = await effectiveLimit(name, defaults);
  return enforcePersistentLimit(req, name, limit, windowMs, subject);
}

export async function setRateLimitPolicy(params: { policyKey: string; limit: number; windowSeconds: number; actorId: string; reason: string }) {
  const defaults = KNOWN_LIMITS[params.policyKey];
  if (!defaults) throw new HttpError(404, "Unknown rate-limit policy.");
  if (!Number.isInteger(params.limit) || params.limit < 1 || params.limit > defaults.limit * 10) throw new HttpError(422, `The limit must be a whole number between 1 and ${defaults.limit * 10}.`);
  if (!Number.isInteger(params.windowSeconds) || params.windowSeconds < 10 || params.windowSeconds > 86_400) throw new HttpError(422, "The window must be between 10 and 86400 seconds.");
  const latest = await prisma.rateLimitPolicy.findFirst({ where: { policyKey: params.policyKey }, orderBy: { version: "desc" } });
  const version = (latest?.version ?? 0) + 1;
  const [, created] = await prisma.$transaction([
    prisma.rateLimitPolicy.updateMany({ where: { policyKey: params.policyKey, status: "ACTIVE" }, data: { status: "SUPERSEDED" } }),
    prisma.rateLimitPolicy.create({ data: { policyKey: params.policyKey, version, limit: params.limit, windowSeconds: params.windowSeconds, enabled: true, status: "ACTIVE", createdById: params.actorId } }),
  ]);
  clearRateLimitPolicyCache();
  await writeAudit({ action: "RISK_CONFIGURATION_CHANGED", adminId: params.actorId, meta: { policyKey: params.policyKey, version, limit: params.limit, windowSeconds: params.windowSeconds, reason: params.reason } });
  return created;
}
