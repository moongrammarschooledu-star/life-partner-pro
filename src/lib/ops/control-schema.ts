import { z } from "zod";

// Validation for SystemControl updates (spec §47/§48). Sections map 1:1 to the
// System Configuration tabs and to the permission each one needs. `.strict()`
// rejects unknown keys so a request can never write a field it wasn't meant to.

const int = (min: number, max: number) => z.number().int().min(min).max(max);

export const CONTROL_SECTIONS = ["thresholds", "backup", "session", "state", "maintenance", "emergency"] as const;
export type ControlSection = (typeof CONTROL_SECTIONS)[number];

const schemas = {
  thresholds: z
    .object({
      slowQueryThresholdMs: int(50, 60_000),
      apiLatencyWarnMs: int(100, 60_000),
      errorRateWarnPerHour: int(1, 100_000),
      failedLoginSpikeThreshold: int(1, 1000),
      paymentFailureSpikeThreshold: int(1, 1000),
      webhookFailureSpikeThreshold: int(1, 1000),
      queueBacklogThreshold: int(1, 100_000),
      permissionViolationThreshold: int(1, 100_000),
      dbStorageLimitMb: int(1, 10_000_000).nullable(),
      fileStorageLimitMb: int(1, 10_000_000).nullable(),
      capacityWarnPercent: int(50, 99),
      rpoMinutes: int(1, 525_600),
      rtoMinutes: int(1, 525_600),
      monitoringPeriodHours: int(1, 720),
      evidenceMaxAgeDays: int(1, 90),
    })
    .partial()
    .strict(),
  backup: z
    .object({
      backupsEnabled: z.boolean(),
      backupDailyKeep: int(1, 365),
      backupWeeklyKeep: int(0, 104),
      backupMonthlyKeep: int(0, 120),
      backupStaleAfterHours: int(1, 720),
      restoreTestStaleAfterDays: int(1, 365),
    })
    .partial()
    .strict(),
  session: z.object({ adminSessionMaxHours: int(1, 720) }).partial().strict(),
  state: z
    .object({
      operationalState: z.enum(["NORMAL", "DEGRADED", "MAINTENANCE", "RECOVERY", "EMERGENCY"]),
      operationalStateReason: z.string().trim().max(300).nullable(),
    })
    .partial()
    .strict(),
  maintenance: z
    .object({
      maintenanceMode: z.enum(["OFF", "ON", "SCHEDULED"]),
      maintenanceStartsAt: z.string().datetime().nullable(),
      maintenanceEndsAt: z.string().datetime().nullable(),
      maintenanceMessage: z.string().trim().max(300).nullable(),
    })
    .partial()
    .strict(),
  emergency: z
    .object({
      emergencyPaymentsDisabled: z.boolean(),
      emergencyRegistrationsDisabled: z.boolean(),
      emergencyProfileSubmissionsDisabled: z.boolean(),
      emergencyMatchingDisabled: z.boolean(),
      emergencyProposalsDisabled: z.boolean(),
      emergencyNotificationsDisabled: z.boolean(),
      emergencyUploadsDisabled: z.boolean(),
      emergencyPublicAccessDisabled: z.boolean(),
    })
    .partial()
    .strict(),
} as const;

export function parseControlUpdate(section: string, values: unknown): { ok: true; data: Record<string, unknown> } | { ok: false; error: string } {
  if (!(CONTROL_SECTIONS as readonly string[]).includes(section)) return { ok: false, error: "Unknown configuration section." };
  const parsed = schemas[section as ControlSection].safeParse(values);
  if (!parsed.success) return { ok: false, error: parsed.error.issues.map((i) => `${i.path.join(".") || "value"}: ${i.message}`).join("; ") };
  if (Object.keys(parsed.data).length === 0) return { ok: false, error: "No changes supplied." };
  return { ok: true, data: parsed.data as Record<string, unknown> };
}

// Sections that need a fresh password re-confirmation + a written reason
// (spec §48/§56/§58): they can take the site offline or weaken security.
export function sectionRequiresReauth(section: ControlSection, data: Record<string, unknown>): boolean {
  if (section === "state" || section === "emergency" || section === "session") return true;
  if (section === "maintenance") return data.maintenanceMode === "ON" || data.maintenanceMode === "SCHEDULED";
  return false;
}

export const SECTION_PERMISSION: Record<ControlSection, "system:config:manage" | "system:maintenance:manage" | "system:emergency:manage"> = {
  thresholds: "system:config:manage",
  backup: "system:config:manage",
  session: "system:config:manage",
  state: "system:maintenance:manage",
  maintenance: "system:maintenance:manage",
  emergency: "system:emergency:manage",
};
