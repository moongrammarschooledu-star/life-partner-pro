import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/http-error";
import { isValidTimeZone } from "@/lib/analytics/time";
import { analyticsAudit } from "@/lib/analytics/audit";
import { ENGAGEMENT_EVENT_TYPES } from "@/lib/engagement/constants";
import type { AnalyticsSettings } from "@prisma/client";

// STEP 31 — singleton analytics settings: business timezone, smallest group a breakdown may show, the (configurable) meaning of an
// "active" applicant, and how old the data mart may get before the dashboards call it stale.

// Default meaning of "active": the applicant did at least one of these things on the platform during the period. Editable in settings.
export const DEFAULT_ACTIVE_EVENTS = ["LOGIN", "PROFILE_COMPLETED", "PROFILE_SUBMITTED", "VERIFICATION_STARTED", "PROPOSAL_RESPONSE_RECEIVED", "SUPPORT_CASE_CREATED"];

export const ACTIVE_DEFINITION_TEXT = "Active = the applicant completed at least one qualifying platform action during the measurement period (the qualifying actions are set in analytics settings).";

export async function getAnalyticsSettings(): Promise<AnalyticsSettings> {
  const row = await prisma.analyticsSettings.findUnique({ where: { id: 1 } });
  if (row) return row;
  return prisma.analyticsSettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1, activeEvents: DEFAULT_ACTIVE_EVENTS } });
}

export function activeEventsOf(settings: Pick<AnalyticsSettings, "activeEvents">): string[] {
  const raw = settings.activeEvents;
  const list = Array.isArray(raw) ? (raw as unknown[]).filter((x): x is string => typeof x === "string") : [];
  const valid = list.filter((e) => (ENGAGEMENT_EVENT_TYPES as string[]).includes(e));
  return valid.length ? valid : DEFAULT_ACTIVE_EVENTS;
}

export interface SettingsPatch {
  timezone?: string;
  minGroupSize?: number;
  freshnessSlaHours?: number;
  activeEvents?: string[];
}

export function validateSettingsPatch(body: Record<string, unknown>): SettingsPatch {
  const out: SettingsPatch = {};
  const unknown = Object.keys(body).filter((k) => !["timezone", "minGroupSize", "freshnessSlaHours", "activeEvents"].includes(k));
  if (unknown.length) throw new HttpError(400, "Unknown settings field.");
  if (body.timezone !== undefined) {
    if (typeof body.timezone !== "string" || !isValidTimeZone(body.timezone)) throw new HttpError(400, "Unknown time zone.");
    out.timezone = body.timezone;
  }
  if (body.minGroupSize !== undefined) {
    const v = body.minGroupSize;
    if (typeof v !== "number" || !Number.isInteger(v) || v < 2 || v > 100) throw new HttpError(400, "The smallest group size must be a whole number from 2 to 100.");
    out.minGroupSize = v;
  }
  if (body.freshnessSlaHours !== undefined) {
    const v = body.freshnessSlaHours;
    if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 168) throw new HttpError(400, "The freshness window must be 1 to 168 hours.");
    out.freshnessSlaHours = v;
  }
  if (body.activeEvents !== undefined) {
    const v = body.activeEvents;
    if (!Array.isArray(v) || v.length < 1 || v.length > 20 || v.some((e) => typeof e !== "string" || !(ENGAGEMENT_EVENT_TYPES as string[]).includes(e))) throw new HttpError(400, "Choose 1 to 20 known platform actions for the 'active' definition.");
    out.activeEvents = [...new Set(v as string[])];
  }
  return out;
}

export async function updateAnalyticsSettings(actorId: string, body: Record<string, unknown>, reason: string): Promise<AnalyticsSettings> {
  if (reason.trim().length < 3) throw new HttpError(422, "A reason is required.");
  const patch = validateSettingsPatch(body);
  if (!Object.keys(patch).length) throw new HttpError(400, "Nothing to change.");
  const before = await getAnalyticsSettings();
  const row = await prisma.analyticsSettings.update({ where: { id: 1 }, data: { ...patch, activeEvents: patch.activeEvents ?? undefined, updatedById: actorId } });
  await analyticsAudit({ action: "ANALYTICS_SETTINGS_CHANGED", actorId, resource: "analytics_settings", resourceId: "1", before: { timezone: before.timezone, minGroupSize: before.minGroupSize }, after: patch, reason });
  return row;
}
