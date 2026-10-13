import { ApiError, type SessionAdmin } from "@/lib/route-guard";
import { requireReason } from "@/lib/ops/admin-route";
import { assertEnvironmentMatches, type PlatformEnvironment } from "@/lib/platform/environment";
import { getActiveFreeze } from "@/lib/platform/freeze";
import { activeBreakGlassFor, noteBreakGlassUse } from "@/lib/platform/break-glass";
import { decideUnderFreeze } from "@/lib/platform/freeze-rules";

// The one gate every control-center configuration write goes through, AFTER the route has checked authentication and the specific permission:
//   1. the environment is named and is the one this deployment runs in,
//   2. a written reason (at least 5 characters),
//   3. the production change freeze (blocked, unless break-glass or a restrictive emergency action by a holder of platform:change_freeze).
// High-risk changes then also go through enforceApprovalGate (done by the caller, which knows the action type) and password re-confirmation (done by the route).

export interface ChangeContext {
  environment: PlatformEnvironment;
  reason: string;
  via: "NO_FREEZE" | "BREAK_GLASS" | "RESTRICTIVE_EMERGENCY";
}

export async function assertConfigChangeAllowed(params: {
  admin: SessionAdmin;
  environment: unknown;
  reason: unknown;
  /** The change only reduces what the platform does (switch something off, read-only on). Such a change is allowed in an emergency by a holder of platform:change_freeze. */
  restrictive?: boolean;
  what: { kind: string; key: string };
  minReason?: number;
}): Promise<ChangeContext> {
  const environment = assertEnvironmentMatches(params.environment);
  const reason = requireReason(params.reason, params.minReason ?? 5);
  const freeze = await getActiveFreeze();
  const breakGlass = freeze ? await activeBreakGlassFor(params.admin.id) : null;
  const decision = decideUnderFreeze({
    freeze: { active: !!freeze, reason: freeze?.reason, endsAt: freeze?.endsAt ?? null },
    restrictive: params.restrictive === true,
    hasActiveBreakGlass: !!breakGlass,
    holdsFreezePermission: params.admin.permissions.includes("platform:change_freeze"),
  });
  if (!decision.allowed) throw new ApiError(423, decision.error);
  if (decision.via === "BREAK_GLASS" && breakGlass) await noteBreakGlassUse(breakGlass.id, params.admin.id, params.what);
  return { environment, reason, via: decision.via };
}

/** For the older routes that already take their own reason and re-authentication (system control, flags): only the change-freeze rule is added. */
export async function assertNotFrozen(params: { admin: SessionAdmin; restrictive: boolean; what: { kind: string; key: string } }): Promise<"NO_FREEZE" | "BREAK_GLASS" | "RESTRICTIVE_EMERGENCY"> {
  const freeze = await getActiveFreeze();
  const breakGlass = freeze ? await activeBreakGlassFor(params.admin.id) : null;
  const decision = decideUnderFreeze({
    freeze: { active: !!freeze, reason: freeze?.reason, endsAt: freeze?.endsAt ?? null },
    restrictive: params.restrictive,
    hasActiveBreakGlass: !!breakGlass,
    holdsFreezePermission: params.admin.permissions.includes("platform:change_freeze"),
  });
  if (!decision.allowed) throw new ApiError(423, decision.error);
  if (decision.via === "BREAK_GLASS" && breakGlass) await noteBreakGlassUse(breakGlass.id, params.admin.id, params.what);
  return decision.via;
}