import type { PlatformAnnouncementKind } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSystemControl } from "@/lib/ops/system-control";
import { isMaintenanceActive } from "@/lib/ops/system-state";
import { getSettingValues } from "@/lib/platform/settings";
import { isAnnouncementLive } from "@/lib/platform/announcement-rules";

// The public status payload (STEP 36 §59). It contains ONLY: an overall state, a short message, scheduled maintenance, and notices an administrator marked
// "show on the status page" (title, text, kind, dates). Never: internal addresses, infrastructure, security rules, private incidents, applicant data, the
// operational-state reason, who changed what, or any identifier. A pure builder so the shape is tested.

export type OverallState = "OPERATIONAL" | "SCHEDULED_MAINTENANCE" | "MAINTENANCE" | "READ_ONLY" | "DISRUPTION";

export interface PublicStatus {
  enabled: boolean;
  state: OverallState;
  headline: string;
  message: string;
  generatedAt: string;
  scheduledMaintenance: Array<{ title: string; message: string; startsAt: string | null; endsAt: string | null }>;
  notices: Array<{ kind: PlatformAnnouncementKind; title: string; message: string; startedAt: string; resolvedAt: string | null; resolved: boolean }>;
  contact: { email: string | null; hours: string | null };
  platformName: string;
  timezone: string;
}

const HEADLINE: Record<OverallState, string> = {
  OPERATIONAL: "All systems operational",
  SCHEDULED_MAINTENANCE: "Scheduled maintenance",
  MAINTENANCE: "Maintenance in progress",
  READ_ONLY: "Read-only mode",
  DISRUPTION: "Service disruption",
};

export interface StatusInputs {
  control: { operationalState: string; maintenanceMode: "OFF" | "ON" | "SCHEDULED"; maintenanceStartsAt: Date | null; maintenanceEndsAt: Date | null; maintenanceMessage: string | null; emergencyPublicAccessDisabled: boolean; readOnly: boolean };
  announcements: Array<{ kind: PlatformAnnouncementKind; title: string; body: string; status: string; showOnStatusPage: boolean; startsAt: Date | null; endsAt: Date | null; resolvedAt: Date | null; createdAt: Date }>;
  settings: Record<string, unknown>;
  now: Date;
}

const RESOLVED_VISIBLE_DAYS = 14;
const text = (v: unknown, fallback = "") => (typeof v === "string" ? v : fallback);

export function buildPublicStatus(i: StatusInputs): PublicStatus {
  const c = i.control;
  const maintenanceNow = isMaintenanceActive(c, i.now);
  let state: OverallState = "OPERATIONAL";
  if (c.emergencyPublicAccessDisabled || c.operationalState === "EMERGENCY") state = "DISRUPTION";
  else if (c.operationalState === "MAINTENANCE" || (c.maintenanceMode === "ON") ) state = "MAINTENANCE";
  else if (maintenanceNow) state = "MAINTENANCE";
  else if (c.readOnly) state = "READ_ONLY";

  const scheduled: PublicStatus["scheduledMaintenance"] = [];
  if (c.maintenanceMode === "SCHEDULED" && c.maintenanceStartsAt && !maintenanceNow && (!c.maintenanceEndsAt || c.maintenanceEndsAt.getTime() > i.now.getTime())) {
    scheduled.push({ title: "Planned maintenance", message: text(c.maintenanceMessage), startsAt: c.maintenanceStartsAt.toISOString(), endsAt: c.maintenanceEndsAt?.toISOString() ?? null });
    if (state === "OPERATIONAL") state = "SCHEDULED_MAINTENANCE";
  }

  const cutoff = i.now.getTime() - RESOLVED_VISIBLE_DAYS * 86_400_000;
  const notices = i.announcements
    .filter((a) => a.showOnStatusPage)
    .filter((a) => (a.status === "PUBLISHED" ? isAnnouncementLive(a, i.now) : a.status === "RESOLVED" && (a.resolvedAt?.getTime() ?? 0) >= cutoff))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 20)
    .map((a) => ({ kind: a.kind, title: a.title, message: a.body, startedAt: (a.startsAt ?? a.createdAt).toISOString(), resolvedAt: a.resolvedAt?.toISOString() ?? null, resolved: a.status === "RESOLVED" }));
  if (state === "OPERATIONAL" && notices.some((n) => !n.resolved && n.kind === "SERVICE_INTERRUPTION")) state = "DISRUPTION";

  const email = text(i.settings["contact.public_email"]);
  const hours = text(i.settings["contact.support_hours"]);
  return {
    enabled: i.settings["status.page_enabled"] !== false,
    state,
    headline: HEADLINE[state],
    message: text(i.settings["status.public_message"]) || (state === "MAINTENANCE" || state === "READ_ONLY" ? text(c.maintenanceMessage) : ""),
    generatedAt: i.now.toISOString(),
    scheduledMaintenance: scheduled,
    notices,
    contact: { email: email || null, hours: hours || null },
    platformName: text(i.settings["platform.name"], "Life Partner Pro"),
    timezone: text(i.settings["localization.timezone"], "Asia/Karachi"),
  };
}

export async function getPublicStatus(now: Date = new Date()): Promise<PublicStatus> {
  const [control, announcements, settings] = await Promise.all([
    getSystemControl(),
    prisma.platformAnnouncement.findMany({ where: { showOnStatusPage: true, status: { in: ["PUBLISHED", "RESOLVED"] } }, orderBy: { createdAt: "desc" }, take: 50 }),
    getSettingValues(),
  ]);
  return buildPublicStatus({ control, announcements, settings, now });
}
