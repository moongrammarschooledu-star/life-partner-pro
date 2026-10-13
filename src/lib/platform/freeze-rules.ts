// Production change freeze and break-glass decision (STEP 36 §56–§57). Pure, so the rule is tested without a database.
//
// While a freeze is active, NORMAL configuration changes are blocked. Two ways through, both audited and both needing a reason:
//   1. an active (unexpired, not ended) break-glass grant held by the administrator making the change;
//   2. a RESTRICTIVE emergency action (switching something off, turning read-only mode on) by an administrator who holds the freeze permission.
// Restrictive actions only ever reduce what the platform does, so they are safe to allow in an emergency; enabling or widening anything is not.

export interface FreezeState {
  active: boolean;
  reason?: string;
  endsAt?: Date | null;
}

export interface FreezeDecisionInput {
  freeze: FreezeState;
  restrictive: boolean;
  hasActiveBreakGlass: boolean;
  holdsFreezePermission: boolean;
}

export type FreezeDecision =
  | { allowed: true; via: "NO_FREEZE" | "BREAK_GLASS" | "RESTRICTIVE_EMERGENCY" }
  | { allowed: false; error: string };

export function decideUnderFreeze(input: FreezeDecisionInput): FreezeDecision {
  if (!input.freeze.active) return { allowed: true, via: "NO_FREEZE" };
  if (input.hasActiveBreakGlass) return { allowed: true, via: "BREAK_GLASS" };
  if (input.restrictive && input.holdsFreezePermission) return { allowed: true, via: "RESTRICTIVE_EMERGENCY" };
  return {
    allowed: false,
    error: `A production change freeze is active${input.freeze.reason ? ` (${input.freeze.reason.slice(0, 120)})` : ""}. Configuration cannot be changed until it ends. In an emergency, use break-glass access.`,
  };
}

export const BREAK_GLASS_MIN_MINUTES = 5;
export const BREAK_GLASS_MAX_MINUTES = 60;
export const BREAK_GLASS_DEFAULT_MINUTES = 30;

export function clampBreakGlassMinutes(requested: unknown): number {
  const n = typeof requested === "number" && Number.isFinite(requested) ? Math.floor(requested) : BREAK_GLASS_DEFAULT_MINUTES;
  return Math.min(BREAK_GLASS_MAX_MINUTES, Math.max(BREAK_GLASS_MIN_MINUTES, n));
}

export function breakGlassActive(event: { expiresAt: Date; endedAt: Date | null } | null | undefined, now: Date = new Date()): boolean {
  return !!event && event.endedAt === null && event.expiresAt.getTime() > now.getTime();
}

/** A person never reviews their own break-glass use, and never before the access has ended or expired. */
export function canReviewBreakGlass(event: { adminId: string; expiresAt: Date; endedAt: Date | null; reviewedAt: Date | null }, reviewerId: string, now: Date = new Date()): { ok: true } | { ok: false; error: string } {
  if (event.reviewedAt) return { ok: false, error: "This break-glass use has already been reviewed." };
  if (event.adminId === reviewerId) return { ok: false, error: "You cannot review your own break-glass access." };
  if (breakGlassActive(event, now)) return { ok: false, error: "Wait until the access has ended or expired before reviewing it." };
  return { ok: true };
}
