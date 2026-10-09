import type { Prisma, SocSettings } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/http-error";
import { socAudit } from "@/lib/soc/audit";

// STEP 32 — security configuration. One row of settings plus an immutable version row for EVERY change (what changed, from what, to what, who,
// why). Defaults are permissive where a stricter default would silently change how admins sign in (session idle timeout, session cap are
// OFF until an admin sets them), so deploying this changes nothing by itself.

export const SOC_SETTINGS_FIELDS = [
  "suppressionWindowMinutes", "escalateCriticalMinutes", "escalateHighMinutes", "escalateMediumMinutes", "sessionIdleMinutes",
  "maxConcurrentSessions", "stepUpForHighRisk", "enforceMfaPrivileged", "accessLogRetentionDays", "alertRetentionDays",
] as const;
export type SocSettingsField = (typeof SOC_SETTINGS_FIELDS)[number];

interface Bound { min: number; max: number; nullable?: boolean }
type BooleanField = "stepUpForHighRisk" | "enforceMfaPrivileged";
const BOUNDS: Record<Exclude<SocSettingsField, BooleanField>, Bound> = {
  suppressionWindowMinutes: { min: 0, max: 7 * 24 * 60 },
  escalateCriticalMinutes: { min: 0, max: 7 * 24 * 60 }, // 0 = never escalate this severity
  escalateHighMinutes: { min: 0, max: 7 * 24 * 60 },
  escalateMediumMinutes: { min: 0, max: 14 * 24 * 60 },
  sessionIdleMinutes: { min: 5, max: 24 * 60, nullable: true },
  maxConcurrentSessions: { min: 1, max: 20, nullable: true },
  accessLogRetentionDays: { min: 30, max: 3650 },
  alertRetentionDays: { min: 90, max: 3650 },
};

export type SettingsPatch = Partial<Record<SocSettingsField, number | boolean | null>>;

// Pure: returns only the fields that are valid AND different from the current value, or an error naming the first bad field.
export function validateSettingsPatch(current: Pick<SocSettings, SocSettingsField>, patch: Record<string, unknown>): { ok: true; changes: SettingsPatch } | { ok: false; error: string } {
  const changes: SettingsPatch = {};
  for (const [key, raw] of Object.entries(patch)) {
    if (!(SOC_SETTINGS_FIELDS as readonly string[]).includes(key)) return { ok: false, error: `Unknown setting: ${key}.` };
    const field = key as SocSettingsField;
    if (field === "stepUpForHighRisk" || field === "enforceMfaPrivileged") {
      if (typeof raw !== "boolean") return { ok: false, error: `${field} must be true or false.` };
      if (raw !== current[field]) changes[field] = raw;
      continue;
    }
    const b = BOUNDS[field];
    if (raw === null) {
      if (!b.nullable) return { ok: false, error: `${field} cannot be empty.` };
    } else if (typeof raw !== "number" || !Number.isInteger(raw) || raw < b.min || raw > b.max) {
      return { ok: false, error: `${field} must be a whole number from ${b.min} to ${b.max}${b.nullable ? " (or empty to switch it off)" : ""}.` };
    }
    if (raw !== current[field]) changes[field] = raw as number | null;
  }
  return { ok: true, changes };
}

export async function getSocSettings(): Promise<SocSettings> {
  return prisma.socSettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
}

export async function updateSocSettings(actorId: string, patch: Record<string, unknown>, reason: string): Promise<SocSettings> {
  if (reason.trim().length < 5) throw new HttpError(422, "Say why the configuration is changing (at least 5 characters).");
  const current = await getSocSettings();
  const v = validateSettingsPatch(current, patch);
  if (!v.ok) throw new HttpError(422, v.error);
  const keys = Object.keys(v.changes);
  if (keys.length === 0) throw new HttpError(422, "Nothing changed.");
  const diff = Object.fromEntries(keys.map((k) => [k, { from: current[k as SocSettingsField], to: v.changes[k as SocSettingsField] }]));
  const next = await prisma.socSettings.update({ where: { id: 1 }, data: { ...(v.changes as Prisma.SocSettingsUpdateInput), version: current.version + 1, updatedById: actorId } });
  const snapshot = Object.fromEntries(SOC_SETTINGS_FIELDS.map((f) => [f, next[f]]));
  await prisma.socConfigVersion.create({ data: { version: next.version, changes: diff as Prisma.InputJsonValue, snapshot: snapshot as Prisma.InputJsonValue, reason: reason.trim().slice(0, 300), authorId: actorId } });
  await socAudit({ action: "SOC_CONFIG_CHANGED", actorId, resource: "settings", resourceId: String(next.version), before: Object.fromEntries(keys.map((k) => [k, current[k as SocSettingsField]])), after: v.changes, reason });
  return next;
}

export async function listConfigVersions(limit = 50) {
  return prisma.socConfigVersion.findMany({ orderBy: { version: "desc" }, take: Math.min(limit, 200) });
}
