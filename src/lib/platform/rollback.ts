import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { ApiError, type SessionAdmin } from "@/lib/route-guard";
import { requireReason } from "@/lib/ops/admin-route";
import { enforceApprovalGate, markApprovalExecuted } from "@/lib/approvals/gate";
import { assertEnvironmentMatches } from "@/lib/platform/environment";
import { getConfigChange } from "@/lib/platform/config-change";
import { setPlatformSetting } from "@/lib/platform/settings";
import { applyFlagChange, listFlagViews } from "@/lib/platform/flags";

// Configuration rollback (STEP 36 §52). Only SETTINGS and FEATURE FLAGS can be rolled back: those are the kinds whose "before" value is a complete, valid value
// that the same validated write path can restore. Maintenance, freeze and system-control changes are reversed by making the opposite change on purpose.
//
// A rollback is a NEW change (a new version, pointing at the one it reverses) written through the same service as any other change, so validation, the
// change freeze, the environment check and the audit all apply. History is never edited or deleted. It needs platform:configuration:rollback, a reason, a fresh
// password re-confirmation (checked by the route) and goes through the approval gate (action PLATFORM_CONFIG_ROLLBACK; policy-controlled).
// It is refused if the item has changed since: you cannot roll back an older change over a newer one.

export const ROLLBACK_KINDS = ["SETTING", "FEATURE_FLAG"] as const;

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export async function rollbackConfigChange(admin: SessionAdmin, input: { changeId: unknown; reason: unknown; environment: unknown }) {
  if (!admin.permissions.includes("platform:configuration:rollback")) throw new ApiError(403, "Forbidden: insufficient permissions");
  const environment = assertEnvironmentMatches(input.environment);
  const reason = requireReason(input.reason);
  if (typeof input.changeId !== "string" || input.changeId.length > 40) throw new ApiError(400, "Unknown change.");

  const change = await getConfigChange(input.changeId);
  if (!change) throw new ApiError(404, "Not found.");
  if (!(ROLLBACK_KINDS as readonly string[]).includes(change.kind)) throw new ApiError(400, "Only settings and feature flags can be rolled back.");
  if (change.environment !== environment) throw new ApiError(409, "That change was made in another environment.");
  if (change.before === null || change.before === undefined) throw new ApiError(409, "Nothing earlier to restore: this was the first value.");

  // The item must still be exactly as this change left it.
  const latest = await prisma.platformConfigChange.findFirst({ where: { kind: change.kind, key: change.key }, orderBy: { version: "desc" }, select: { id: true } });
  if (latest?.id !== change.id) throw new ApiError(409, "This item has been changed since. Roll back the most recent change instead.");

  const gate = await enforceApprovalGate({ actionType: "PLATFORM_CONFIG_ROLLBACK", sourceType: "PLATFORM_CONFIG", sourceId: `rollback:${change.id}`, actor: admin, reason, currentStatePayload: { kind: change.kind, key: change.key, version: change.version }, requestedPayload: { restoreVersionBefore: change.version } });
  let approvalId: string | null = null;
  if (gate.requiresApproval) {
    if (gate.status !== "READY_TO_EXECUTE") return { approvalRequired: true as const, approvalCode: gate.approvalCode, status: gate.status };
    approvalId = gate.approvalRequestId;
  }

  let version: number;
  if (change.kind === "SETTING") {
    const r = await setPlatformSetting(admin, { key: change.key, value: change.before, reason, environment, rolledBackFromId: change.id }, { approvalId });
    if (r.approvalRequired) throw new ApiError(409, "Unexpected approval requirement.");
    version = r.version;
  } else {
    const before = change.before as { state?: unknown; rolloutPercent?: unknown; targets?: unknown };
    const current = (await listFlagViews()).find((f) => f.key === change.key);
    if (!current || !same({ state: current.state, rolloutPercent: current.rolloutPercent, targets: current.targets }, change.after)) throw new ApiError(409, "This item has been changed since. Nothing was changed.");
    const r = await applyFlagChange(admin, { key: change.key, state: before.state, rolloutPercent: before.rolloutPercent, targets: before.targets, reason, environment, rolledBackFromId: change.id }, { checkPermission: false, approvalId });
    if (r.approvalRequired) throw new ApiError(409, "Unexpected approval requirement.");
    version = r.version;
  }

  await writeAudit({ action: "PLATFORM_CONFIG_ROLLED_BACK", adminId: admin.id, meta: { kind: change.kind, key: change.key, rolledBackVersion: change.version, newVersion: version, reason } });
  if (approvalId) await markApprovalExecuted(approvalId, admin.id);
  return { approvalRequired: false as const, kind: change.kind, key: change.key, version };
}
