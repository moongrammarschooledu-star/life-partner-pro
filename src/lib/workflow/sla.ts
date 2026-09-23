import { prisma } from "@/lib/prisma";
import type { AdminTaskType } from "@prisma/client";

// STEP 18 §20/§21 — mirrors src/lib/case-sla.ts's wall-clock-hours approach
// (no business-hours/holiday calendar exists anywhere in this codebase), but
// keyed per task TYPE via TaskSlaConfig rather than per fixed priority tier —
// with ~25 task types, flat AppSettings columns (Case's approach) would mean
// 50+ columns, which is worse, not simpler. A task type with no configured
// row, or with active=false, has no SLA — never blocks/escalates.
export interface TaskSlaDueDates {
  targetResponseAt: Date | null;
  targetResolutionAt: Date | null;
  warningAt: Date | null;
}

export async function computeTaskSlaDueDates(taskType: AdminTaskType, from: Date = new Date()): Promise<TaskSlaDueDates> {
  const config = await prisma.taskSlaConfig.findUnique({ where: { taskType } });
  if (!config || !config.active) {
    return { targetResponseAt: null, targetResolutionAt: null, warningAt: null };
  }
  const hours = (h: number | null) => (h == null ? null : new Date(from.getTime() + h * 60 * 60 * 1000));
  return {
    targetResponseAt: hours(config.targetResponseHours),
    targetResolutionAt: hours(config.targetResolutionHours),
    warningAt: hours(config.warningThresholdHours),
  };
}

export type TaskSlaBucket = "ON_TRACK" | "WARNING" | "DUE_SOON" | "OVERDUE" | "ESCALATED" | "PAUSED";

const DUE_SOON_WINDOW_MS = 4 * 60 * 60 * 1000; // fixed 4-hour window, same heuristic as case-sla.ts

// Pure classifier — no stored "SLA event" log (mirrors case-sla.ts's
// classifySla precedent, which also has no such table). `escalated`/`paused`
// are read from the task row itself (escalationStatus / a paused flag caller
// passes in), not derived here.
export function classifyTaskSla(params: {
  targetResolutionAt: Date | null;
  warningAt: Date | null;
  escalated: boolean;
  paused: boolean;
  now?: Date;
}): TaskSlaBucket | null {
  if (params.paused) return "PAUSED";
  if (params.escalated) return "ESCALATED";
  if (!params.targetResolutionAt) return null;
  const now = params.now ?? new Date();
  const remainingMs = params.targetResolutionAt.getTime() - now.getTime();
  if (remainingMs < 0) return "OVERDUE";
  if (remainingMs <= DUE_SOON_WINDOW_MS) return "DUE_SOON";
  if (params.warningAt && now.getTime() >= params.warningAt.getTime()) return "WARNING";
  return "ON_TRACK";
}
