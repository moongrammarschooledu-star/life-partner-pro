import { prisma } from "@/lib/prisma";
import type { CasePriority } from "@prisma/client";

// Elapsed wall-clock hours, not a business-hours/holiday calendar — no such
// infrastructure exists anywhere in this codebase (STEP 9's own cron
// reminders are naive UTC-hour based). The 8 underlying AppSettings fields
// are genuinely admin-configurable; only the calendar-awareness is deferred.
export interface SlaDueDates {
  firstResponseDueAt: Date;
  resolutionDueAt: Date;
}

export async function computeSlaDueDates(priority: CasePriority, from: Date = new Date()): Promise<SlaDueDates> {
  const settings = await prisma.appSettings.findUnique({ where: { id: 1 } });

  const hoursFor: Record<CasePriority, { firstResponse: number; resolution: number }> = {
    LOW: {
      firstResponse: settings?.caseSlaNormalFirstResponseHours ?? 24,
      resolution: settings?.caseSlaNormalResolutionHours ?? 72,
    },
    NORMAL: {
      firstResponse: settings?.caseSlaNormalFirstResponseHours ?? 24,
      resolution: settings?.caseSlaNormalResolutionHours ?? 72,
    },
    HIGH: {
      firstResponse: settings?.caseSlaHighFirstResponseHours ?? 8,
      resolution: settings?.caseSlaHighResolutionHours ?? 24,
    },
    URGENT: {
      firstResponse: settings?.caseSlaUrgentFirstResponseHours ?? 2,
      resolution: settings?.caseSlaUrgentResolutionHours ?? 8,
    },
    CRITICAL: {
      firstResponse: settings?.caseSlaCriticalFirstResponseHours ?? 1,
      resolution: settings?.caseSlaCriticalResolutionHours ?? 4,
    },
  };

  const { firstResponse, resolution } = hoursFor[priority];
  return {
    firstResponseDueAt: new Date(from.getTime() + firstResponse * 60 * 60 * 1000),
    resolutionDueAt: new Date(from.getTime() + resolution * 60 * 60 * 1000),
  };
}

export type SlaBucket = "ON_TIME" | "DUE_SOON" | "OVERDUE";

const DUE_SOON_WINDOW_MS = 4 * 60 * 60 * 1000; // fixed 4-hour window

// "Due soon" = due within a fixed 4-hour window from now — a simple,
// documented heuristic rather than a configurable second threshold (kept out
// of AppSettings to avoid over-engineering the SLA dashboard beyond what
// spec §21 actually asks for: On Time/Due Soon/Overdue).
export function classifySla(dueAt: Date | null, now: Date = new Date()): SlaBucket | null {
  if (!dueAt) return null;
  const remainingMs = dueAt.getTime() - now.getTime();
  if (remainingMs < 0) return "OVERDUE";
  if (remainingMs <= DUE_SOON_WINDOW_MS) return "DUE_SOON";
  return "ON_TIME";
}
