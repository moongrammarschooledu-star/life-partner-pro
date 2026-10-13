import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { ApiError, type SessionAdmin } from "@/lib/route-guard";
import { getSystemControl, invalidateSystemControl } from "@/lib/ops/system-control";
import { isMaintenanceActive } from "@/lib/ops/system-state";
import { validateValue } from "@/lib/platform/config-values";
import { recordConfigChange } from "@/lib/platform/config-change";
import { assertConfigChangeAllowed } from "@/lib/platform/guard";

// Maintenance modes (STEP 36 §11, §49), on top of the existing SystemControl state so there is ONE source of truth:
//   NORMAL                 maintenanceMode OFF, readOnly off
//   SCHEDULED_MAINTENANCE  maintenanceMode SCHEDULED with a start (and optional end); active only inside the window
//   EMERGENCY_MAINTENANCE  maintenanceMode ON (public traffic gets the maintenance page now)
//   READ_ONLY              readOnly on: pages stay viewable, applicant/family/public writes are refused
// The admin area, sign-in, webhooks, cron and health checks are always exempt, so administrators can always recover the platform.

export const MAINTENANCE_KINDS = ["NORMAL", "SCHEDULED_MAINTENANCE", "EMERGENCY_MAINTENANCE", "READ_ONLY"] as const;
export type MaintenanceKind = (typeof MAINTENANCE_KINDS)[number];

interface ControlLike {
  maintenanceMode: "OFF" | "ON" | "SCHEDULED";
  readOnly: boolean;
  maintenanceStartsAt: Date | null;
  maintenanceEndsAt: Date | null;
}

export function maintenanceKindOf(c: ControlLike): MaintenanceKind {
  if (c.maintenanceMode === "ON") return "EMERGENCY_MAINTENANCE";
  if (c.maintenanceMode === "SCHEDULED") return "SCHEDULED_MAINTENANCE";
  if (c.readOnly) return "READ_ONLY";
  return "NORMAL";
}

export const APPLICANT_BEHAVIOUR: Record<MaintenanceKind, string> = {
  NORMAL: "Everything works.",
  SCHEDULED_MAINTENANCE: "Applicants see the maintenance page during the scheduled window.",
  EMERGENCY_MAINTENANCE: "Applicants see the maintenance page now.",
  READ_ONLY: "Applicants can view pages but cannot save changes.",
};
export const API_BEHAVIOUR: Record<MaintenanceKind, string> = {
  NORMAL: "Normal.",
  SCHEDULED_MAINTENANCE: "Public and applicant API calls answer 503 during the window.",
  EMERGENCY_MAINTENANCE: "Public and applicant API calls answer 503.",
  READ_ONLY: "Reads work; writes answer 503. Sign-in, sign-out, admin, webhooks, cron and health checks are unaffected.",
};

export async function getMaintenanceView(now: Date = new Date()) {
  const c = await getSystemControl();
  const kind = maintenanceKindOf(c);
  return {
    kind,
    active: kind === "READ_ONLY" ? true : kind === "NORMAL" ? false : isMaintenanceActive(c, now),
    startsAt: c.maintenanceStartsAt,
    endsAt: c.maintenanceEndsAt,
    message: c.maintenanceMessage,
    operationalState: c.operationalState,
    adminAccess: "The admin area and recovery paths are never blocked by maintenance or read-only mode.",
    applicantBehaviour: APPLICANT_BEHAVIOUR[kind],
    apiBehaviour: API_BEHAVIOUR[kind],
  };
}

export async function setMaintenance(admin: SessionAdmin, input: { kind: unknown; startsAt?: unknown; endsAt?: unknown; message?: unknown; reason: unknown; environment: unknown }) {
  if (!admin.permissions.includes("platform:maintenance:manage")) throw new ApiError(403, "Forbidden: insufficient permissions");
  const kind = input.kind as MaintenanceKind;
  if (!MAINTENANCE_KINDS.includes(kind)) throw new ApiError(400, "Unknown maintenance mode.");

  let message: string | null = null;
  if (typeof input.message === "string" && input.message.trim()) {
    const parsed = validateValue({ type: "STRING", maxLength: 300 }, input.message);
    if (!parsed.ok) throw new ApiError(400, `Public message: ${parsed.error}`);
    message = parsed.value as string;
  }

  let startsAt: Date | null = null;
  let endsAt: Date | null = null;
  if (kind === "SCHEDULED_MAINTENANCE") {
    startsAt = new Date(String(input.startsAt ?? ""));
    if (Number.isNaN(startsAt.getTime())) throw new ApiError(400, "A scheduled maintenance window needs a start time.");
    if (input.endsAt) {
      endsAt = new Date(String(input.endsAt));
      if (Number.isNaN(endsAt.getTime()) || endsAt.getTime() <= startsAt.getTime()) throw new ApiError(400, "The end time must be after the start time.");
    }
  }

  const ctx = await assertConfigChangeAllowed({ admin, environment: input.environment, reason: input.reason, restrictive: kind !== "NORMAL", what: { kind: "MAINTENANCE", key: "mode" } });
  const before = await getSystemControl();
  const beforeKind = maintenanceKindOf(before);
  if (beforeKind === kind && kind === "NORMAL") throw new ApiError(409, "The platform is already in normal mode.");

  const data =
    kind === "NORMAL" ? { maintenanceMode: "OFF" as const, readOnly: false, maintenanceStartsAt: null, maintenanceEndsAt: null, maintenanceMessage: null }
    : kind === "READ_ONLY" ? { maintenanceMode: "OFF" as const, readOnly: true, maintenanceStartsAt: null, maintenanceEndsAt: null, maintenanceMessage: message }
    : kind === "EMERGENCY_MAINTENANCE" ? { maintenanceMode: "ON" as const, readOnly: false, maintenanceStartsAt: null, maintenanceEndsAt: null, maintenanceMessage: message }
    : { maintenanceMode: "SCHEDULED" as const, readOnly: false, maintenanceStartsAt: startsAt, maintenanceEndsAt: endsAt, maintenanceMessage: message };

  await prisma.systemControl.upsert({ where: { id: 1 }, update: { ...data, updatedById: admin.id }, create: { id: 1, ...data, updatedById: admin.id } });
  invalidateSystemControl();
  await recordConfigChange({
    kind: "MAINTENANCE",
    key: "mode",
    before: { kind: beforeKind, startsAt: before.maintenanceStartsAt?.toISOString() ?? null, endsAt: before.maintenanceEndsAt?.toISOString() ?? null },
    after: { kind, startsAt: startsAt?.toISOString() ?? null, endsAt: endsAt?.toISOString() ?? null },
    actor: admin,
    reason: ctx.reason,
    environment: ctx.environment,
  });
  await writeAudit({ action: kind === "NORMAL" ? "MAINTENANCE_DISABLED" : "MAINTENANCE_ENABLED", adminId: admin.id, meta: { kind, previous: beforeKind, via: ctx.via, reason: ctx.reason } });
  return getMaintenanceView();
}
