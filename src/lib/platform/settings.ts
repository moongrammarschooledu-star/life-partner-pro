import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { ApiError, type SessionAdmin } from "@/lib/route-guard";
import { enforceApprovalGate, markApprovalExecuted } from "@/lib/approvals/gate";
import { currentEnvironment } from "@/lib/platform/environment";
import { validateValue } from "@/lib/platform/config-values";
import { findSettingDef, permissionForSetting, settingDefaults, SETTING_DEFS, type SettingDef } from "@/lib/platform/settings-registry";
import { recordConfigChange } from "@/lib/platform/config-change";
import { assertConfigChangeAllowed } from "@/lib/platform/guard";

// Platform settings: typed, validated, versioned, environment-aware (STEP 36 §4–§6). The value shown is the stored override for THIS environment, or the
// registry default. Every change goes through the change guard (environment named, reason, freeze), is versioned in the change log, audited, and (for a
// setting marked HIGH risk) goes through the approval gate. Secrets are never stored: a value that looks like one is refused.

export interface SettingView {
  def: SettingDef;
  value: unknown;
  version: number;
  isDefault: boolean;
  updatedAt: Date | null;
  updatedById: string | null;
}

const TTL_MS = 30_000;
let cache: { values: Record<string, unknown>; at: number } | null = null;
export function invalidatePlatformSettings(): void {
  cache = null;
}

export async function getPlatformSettings(): Promise<SettingView[]> {
  const env = currentEnvironment();
  const rows = await prisma.platformSetting.findMany({ where: { environment: env } });
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return SETTING_DEFS.map((def) => {
    const row = byKey.get(def.key);
    return { def, value: row ? row.value : def.default, version: row?.version ?? 0, isDefault: !row, updatedAt: row?.updatedAt ?? null, updatedById: row?.updatedById ?? null };
  });
}

/** For code that CONSUMES a setting (status page, contact page). Cached for 30 s; a database problem returns the registry default. */
export async function getSettingValues(): Promise<Record<string, unknown>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.values;
  const values = settingDefaults();
  try {
    for (const r of await prisma.platformSetting.findMany({ where: { environment: currentEnvironment() } })) {
      if (r.key in values) values[r.key] = r.value;
    }
  } catch {
    return settingDefaults();
  }
  cache = { values, at: Date.now() };
  return values;
}

export type SettingChangeResult = { approvalRequired: false; version: number; value: unknown } | { approvalRequired: true; approvalCode: string; status: string };

export async function setPlatformSetting(admin: SessionAdmin, input: { key: unknown; value: unknown; reason: unknown; environment: unknown; rolledBackFromId?: string }, opts: { approvalId?: string | null } = {}): Promise<SettingChangeResult> {
  const def = typeof input.key === "string" ? findSettingDef(input.key) : undefined;
  if (!def) throw new ApiError(400, "Unknown setting.");
  const permission = permissionForSetting(def);
  if (!admin.permissions.includes(permission)) throw new ApiError(403, "Forbidden: insufficient permissions");

  const parsed = validateValue(def, input.value);
  if (!parsed.ok) throw new ApiError(400, `${def.label}: ${parsed.error}`);

  const ctx = await assertConfigChangeAllowed({ admin, environment: input.environment, reason: input.reason, what: { kind: "SETTING", key: def.key } });

  const existing = await prisma.platformSetting.findUnique({ where: { key: def.key } });
  const before = existing && existing.environment === ctx.environment ? existing.value : def.default;
  if (JSON.stringify(before) === JSON.stringify(parsed.value)) throw new ApiError(409, "That is already the current value.");

  let approvalId: string | null = opts.approvalId ?? null; // a rollback has already been through its own approval
  let approvalToMark: string | null = null;
  if (def.risk === "HIGH" && !opts.approvalId) {
    const gate = await enforceApprovalGate({ actionType: "PLATFORM_SETTING_HIGH_RISK", sourceType: "PLATFORM_CONFIG", sourceId: `setting:${def.key}`, actor: admin, reason: ctx.reason, currentStatePayload: { key: def.key }, requestedPayload: { key: def.key } });
    if (gate.requiresApproval) {
      if (gate.status !== "READY_TO_EXECUTE") return { approvalRequired: true, approvalCode: gate.approvalCode, status: gate.status };
      approvalId = gate.approvalRequestId;
      approvalToMark = gate.approvalRequestId;
    }
  }

  const version = (existing?.environment === ctx.environment ? existing.version : 0) + 1;
  await prisma.platformSetting.upsert({
    where: { key: def.key },
    update: { value: parsed.value as never, type: def.type, environment: ctx.environment, version, updatedById: admin.id },
    create: { key: def.key, value: parsed.value as never, type: def.type, environment: ctx.environment, version, updatedById: admin.id },
  });
  invalidatePlatformSettings();
  await recordConfigChange({ kind: "SETTING", key: def.key, before, after: parsed.value, actor: admin, reason: ctx.reason, approvalId, environment: ctx.environment, rolledBackFromId: input.rolledBackFromId });
  await writeAudit({ action: "PLATFORM_SETTING_CHANGED", adminId: admin.id, meta: { key: def.key, version, via: ctx.via, environment: ctx.environment, reason: ctx.reason } });
  if (approvalToMark) await markApprovalExecuted(approvalToMark, admin.id);
  return { approvalRequired: false, version, value: parsed.value };
}
