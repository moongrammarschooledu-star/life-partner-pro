import type { FeatureFlagState } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { ApiError, type SessionAdmin } from "@/lib/route-guard";
import { enforceApprovalGate, markApprovalExecuted } from "@/lib/approvals/gate";
import { FEATURE_FLAG_DEFAULTS, FEATURE_FLAG_DEFS, isKnownFeatureFlag } from "@/lib/ops/feature-flag-defs";
import { invalidateFeatureFlags } from "@/lib/ops/feature-flags";
import { currentEnvironment } from "@/lib/platform/environment";
import { enabledForEveryone, isActivation, validateFlagRule, type FlagTarget } from "@/lib/platform/flag-eval";
import { recordConfigChange } from "@/lib/platform/config-change";
import { assertConfigChangeAllowed } from "@/lib/platform/guard";

// Feature flag center service (STEP 36 §7–§9). One write path for the control center AND the older /api/admin/system/flags route, so history, the change
// freeze and the approval rule apply whichever screen is used:
//   * a reason is always required and audited,
//   * switching a flag OFF (or pausing it) is always allowed without approval (kill-switch semantics),
//   * switching a SENSITIVE flag ON in production goes through the approval gate (action PLATFORM_FEATURE_ACTIVATION; policy-controlled like every other approval).

/** The brief's flag names mapped to what the application really enforces. Anything not enforced is listed read-only rather than shipped as a dead switch. */
export const SPEC_FLAGS: Array<{ specKey: string; mapsTo?: string; emergencySwitch?: string; enforced: boolean; note: string }> = [
  { specKey: "registration.enabled", mapsTo: "registrations.enabled", enforced: true, note: "Registration form and API" },
  { specKey: "verification.enabled", mapsTo: "verification.enabled", enforced: true, note: "Verification actions" },
  { specKey: "matching.enabled", mapsTo: "matching.enabled", enforced: true, note: "Matching engine" },
  { specKey: "proposals.enabled", mapsTo: "proposals.enabled", enforced: true, note: "Proposal creation" },
  { specKey: "contact-sharing.enabled", emergencySwitch: "contactSharing", enforced: true, note: "Managed as the contact-sharing emergency switch (stops NEW shares; nothing is deleted)" },
  { specKey: "payments.enabled", mapsTo: "payments.enabled", enforced: true, note: "Read-only here: managed in the Finance Center rollout (approval required)" },
  { specKey: "subscriptions.enabled", mapsTo: "subscriptions.enabled", enforced: true, note: "Subscriptions" },
  { specKey: "whatsapp.enabled", mapsTo: "whatsapp.enabled", enforced: true, note: "WhatsApp channel" },
  { specKey: "sms.enabled", mapsTo: "sms.enabled", enforced: true, note: "SMS channel" },
  { specKey: "email.enabled", mapsTo: "email.enabled", enforced: true, note: "E-mail channel" },
  { specKey: "ai.enabled", mapsTo: "ai.enabled", enforced: true, note: "AI assistant" },
  { specKey: "marketing.enabled", mapsTo: "marketing.enabled", enforced: true, note: "Marketing centre" },
  { specKey: "crm.enabled", enforced: false, note: "Not enforced by the application yet: the CRM screens have no switch" },
  { specKey: "family.enabled", enforced: false, note: "Not enforced by the application yet: the family portal has no switch (invitations can be controlled per applicant)" },
  { specKey: "advanced-search.enabled", enforced: false, note: "Not enforced by the application yet: candidate search is controlled by permission only" },
  { specKey: "risk-automation.enabled", enforced: false, note: "Not enforced by the application yet: risk rules have their own versioned controls" },
  { specKey: "security-automation.enabled", enforced: false, note: "Not enforced by the application yet: automated containment is controlled in Security Operations" },
  { specKey: "pwa.enabled", enforced: false, note: "Not enforced by the application yet: the service worker is registered for every visitor in production" },
];

export interface FlagView {
  key: string;
  description: string;
  sensitive: boolean;
  managedElsewhere?: string;
  state: FeatureFlagState;
  rolloutPercent: number | null;
  targets: FlagTarget[];
  version: number;
  reason: string | null;
  updatedAt: Date | null;
  updatedById: string | null;
  isDefault: boolean;
}

function toTargets(value: unknown): FlagTarget[] {
  return Array.isArray(value) ? (value as FlagTarget[]).filter((t) => t && typeof t.type === "string") : [];
}

export async function listFlagViews(): Promise<FlagView[]> {
  const rows = await prisma.featureFlag.findMany();
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return FEATURE_FLAG_DEFS.map((d) => {
    const row = byKey.get(d.key);
    const defaultState: FeatureFlagState = FEATURE_FLAG_DEFAULTS[d.key] === false ? "DISABLED" : "ENABLED";
    return {
      key: d.key,
      description: d.description,
      sensitive: d.sensitive,
      managedElsewhere: d.managedElsewhere,
      state: row ? row.state : defaultState,
      rolloutPercent: row?.rolloutPercent ?? null,
      targets: toTargets(row?.targets),
      version: row?.version ?? 0,
      reason: row?.reason ?? null,
      updatedAt: row?.updatedAt ?? null,
      updatedById: row?.updatedById ?? null,
      isDefault: !row,
    };
  });
}

export type FlagChangeResult = { approvalRequired: false; state: FeatureFlagState; version: number } | { approvalRequired: true; approvalCode: string; status: string };

export async function applyFlagChange(
  admin: SessionAdmin,
  input: { key: unknown; state: unknown; rolloutPercent?: unknown; targets?: unknown; reason: unknown; environment: unknown; rolledBackFromId?: string },
  opts: { checkPermission: boolean; approvalId?: string | null } = { checkPermission: true },
): Promise<FlagChangeResult> {
  if (opts.checkPermission && !admin.permissions.includes("platform:features:manage")) throw new ApiError(403, "Forbidden: insufficient permissions");
  if (typeof input.key !== "string" || !isKnownFeatureFlag(input.key)) throw new ApiError(400, "Unknown or externally-managed feature flag.");
  const def = FEATURE_FLAG_DEFS.find((d) => d.key === input.key)!;

  const parsed = validateFlagRule({ state: input.state, rolloutPercent: input.rolloutPercent, targets: input.targets });
  if (!parsed.ok) throw new ApiError(400, parsed.error);
  const next = parsed.rule;

  const existing = await prisma.featureFlag.findUnique({ where: { key: def.key } });
  const previousState: FeatureFlagState = existing ? existing.state : FEATURE_FLAG_DEFAULTS[def.key] === false ? "DISABLED" : "ENABLED";
  const restrictive = next.state === "DISABLED" || next.state === "PAUSED" || next.state === "EMERGENCY_DISABLED";
  const ctx = await assertConfigChangeAllowed({ admin, environment: input.environment, reason: input.reason, restrictive, what: { kind: "FEATURE_FLAG", key: def.key } });

  const beforeView = { state: previousState, rolloutPercent: existing?.rolloutPercent ?? null, targets: toTargets(existing?.targets) };
  const afterView = { state: next.state, rolloutPercent: next.rolloutPercent, targets: next.targets };
  if (JSON.stringify(beforeView) === JSON.stringify(afterView)) throw new ApiError(409, "That is already the current state.");

  let approvalId: string | null = opts.approvalId ?? null; // a rollback has already been through its own approval
  if (def.sensitive && ctx.environment === "PRODUCTION" && isActivation(previousState, next.state) && !opts.approvalId) {
    const gate = await enforceApprovalGate({ actionType: "PLATFORM_FEATURE_ACTIVATION", sourceType: "PLATFORM_CONFIG", sourceId: `flag:${def.key}`, actor: admin, reason: ctx.reason, currentStatePayload: beforeView, requestedPayload: afterView });
    if (gate.requiresApproval) {
      if (gate.status !== "READY_TO_EXECUTE") return { approvalRequired: true, approvalCode: gate.approvalCode, status: gate.status };
      approvalId = gate.approvalRequestId;
    }
  }

  const version = (existing?.version ?? 0) + 1;
  const data = { state: next.state, enabled: enabledForEveryone(next.state), rolloutPercent: next.rolloutPercent, targets: next.targets as never, version, reason: ctx.reason.slice(0, 500), updatedById: admin.id };
  await prisma.featureFlag.upsert({ where: { key: def.key }, update: data, create: { key: def.key, description: def.description, ...data } });
  invalidateFeatureFlags();
  await recordConfigChange({ kind: "FEATURE_FLAG", key: def.key, before: beforeView, after: afterView, actor: admin, reason: ctx.reason, approvalId, environment: ctx.environment, rolledBackFromId: input.rolledBackFromId });
  await writeAudit({ action: "FEATURE_FLAG_CHANGED", adminId: admin.id, meta: { key: def.key, previous: previousState, new: next.state, version, via: ctx.via, environment: ctx.environment, reason: ctx.reason } });
  if (approvalId && !opts.approvalId) await markApprovalExecuted(approvalId, admin.id);
  return { approvalRequired: false, state: next.state, version };
}

/** The older boolean route: same write path, with the environment taken from the running deployment (it has always acted on this one). */
export async function applyLegacyFlagToggle(admin: SessionAdmin, key: string, enabled: boolean, reason: string) {
  return applyFlagChange(admin, { key, state: enabled ? "ENABLED" : "DISABLED", reason, environment: currentEnvironment() }, { checkPermission: false });
}
