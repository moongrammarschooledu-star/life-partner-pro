import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/http-error";
import { isFeatureEnabled } from "@/lib/ops/feature-flags";
import { sendNotification } from "@/lib/notifications/notification-service";
import { analyticsAudit } from "@/lib/analytics/audit";
import { metricAccessible, type Viewer } from "@/lib/analytics/access";
import { getMetric } from "@/lib/analytics/metrics/registry";
import { reportDefinitionSchema } from "@/lib/analytics/report-service";
import { getAnalyticsSettings } from "@/lib/analytics/settings";
import { addDaysKey, dayKey, dayStartUtc, keyFromDbDate } from "@/lib/analytics/time";
import { loadViewer, type DbViewer } from "@/lib/analytics/viewers";
import type { ReportFrequency } from "@prisma/client";

// STEP 31 — scheduled reports. A schedule never sends data: it sends an in-app notice with a link, and the recipient opens the report
// and runs it AS THEMSELVES. Before every delivery each recipient's CURRENT access is re-read from the database; a recipient who is
// inactive or no longer holds the report's permissions is dropped, and when nobody is left the schedule pauses itself. So access
// removed today means nothing is delivered tomorrow, without anyone having to remember to edit the schedule.

const FREQS: ReportFrequency[] = ["DAILY", "WEEKLY", "MONTHLY"];

export function computeNextRun(frequency: ReportFrequency, dayOfWeek: number | null, dayOfMonth: number | null, hourLocal: number, from: Date, tz: string): Date {
  const today = dayKey(from, tz);
  const at = (key: string) => new Date(dayStartUtc(key, tz).getTime() + hourLocal * 3_600_000);
  for (let i = 0; i < 400; i++) {
    const key = addDaysKey(today, i);
    const candidate = at(key);
    if (candidate.getTime() <= from.getTime()) continue;
    if (frequency === "DAILY") return candidate;
    const [y, m, d] = key.split("-").map(Number);
    if (frequency === "WEEKLY" && new Date(Date.UTC(y, m - 1, d)).getUTCDay() === (dayOfWeek ?? 1)) return candidate;
    if (frequency === "MONTHLY" && d === (dayOfMonth ?? 1)) return candidate;
  }
  return new Date(from.getTime() + 86_400_000);
}

async function recipientHasAccess(r: DbViewer, metricKeys: string[]): Promise<boolean> {
  if (!r.active || !r.permissions.includes("analytics:reports:view")) return false;
  return metricKeys.every((k) => { const d = getMetric(k); return !!d && metricAccessible(r, d); });
}

export async function createSchedule(owner: DbViewer, reportId: string, input: { frequency: string; dayOfWeek?: number | null; dayOfMonth?: number | null; hourLocal?: number; recipientAdminIds: string[] }) {
  if (!owner.permissions.includes("analytics:reports:schedule")) throw new HttpError(403, "You cannot schedule reports.");
  if (!(FREQS as string[]).includes(input.frequency)) throw new HttpError(422, "Choose daily, weekly or monthly.");
  const report = await prisma.analyticsReport.findUnique({ where: { id: reportId } });
  if (!report || report.ownerId !== owner.id) throw new HttpError(404, "Report not found.");
  const version = await prisma.analyticsReportVersion.findUnique({ where: { reportId_version: { reportId, version: report.currentVersion } } });
  const def = reportDefinitionSchema.parse(version?.definition);
  const hourLocal = Math.min(Math.max(Math.trunc(input.hourLocal ?? 8), 0), 23);
  const dayOfWeek = input.frequency === "WEEKLY" ? Math.min(Math.max(Math.trunc(input.dayOfWeek ?? 1), 0), 6) : null;
  const dayOfMonth = input.frequency === "MONTHLY" ? Math.min(Math.max(Math.trunc(input.dayOfMonth ?? 1), 1), 28) : null;
  const wanted = [...new Set(input.recipientAdminIds)].slice(0, 25);
  if (!wanted.length) throw new HttpError(422, "Choose at least one recipient.");
  const accepted: string[] = [];
  const rejected: string[] = [];
  for (const id of wanted) {
    const v = await loadViewer(id);
    if (v && (await recipientHasAccess(v, def.query.metrics))) accepted.push(id);
    else rejected.push(id);
  }
  if (!accepted.length) throw new HttpError(422, "None of the chosen recipients has access to everything in this report.");
  const settings = await getAnalyticsSettings();
  const row = await prisma.analyticsReportSchedule.create({
    data: { reportId, frequency: input.frequency as ReportFrequency, dayOfWeek, dayOfMonth, hourLocal, recipientAdminIds: accepted as never, createdById: owner.id, nextRunAt: computeNextRun(input.frequency as ReportFrequency, dayOfWeek, dayOfMonth, hourLocal, new Date(), settings.timezone) },
  });
  await analyticsAudit({ action: "ANALYTICS_REPORT_SCHEDULED", actorId: owner.id, resource: "report_schedule", resourceId: row.id, after: { reportId, frequency: input.frequency, recipients: accepted.length, rejected: rejected.length } });
  return { schedule: row, rejected };
}

export async function setScheduleStatus(owner: Viewer, scheduleId: string, status: "ACTIVE" | "PAUSED" | "ARCHIVED") {
  const s = await prisma.analyticsReportSchedule.findUnique({ where: { id: scheduleId }, include: { report: { select: { ownerId: true } } } });
  if (!s || s.report.ownerId !== owner.id) throw new HttpError(404, "Schedule not found.");
  const row = await prisma.analyticsReportSchedule.update({ where: { id: scheduleId }, data: { status, pausedReason: status === "PAUSED" ? "Paused by the owner" : null } });
  await analyticsAudit({ action: "ANALYTICS_REPORT_SCHEDULED", actorId: owner.id, resource: "report_schedule", resourceId: scheduleId, before: { status: s.status }, after: { status } });
  return row;
}

export interface SchedulerResult { due: number; delivered: number; skipped: number; paused: number }

export async function runDueSchedules(now: Date = new Date()): Promise<SchedulerResult> {
  const result: SchedulerResult = { due: 0, delivered: 0, skipped: 0, paused: 0 };
  if (!(await isFeatureEnabled("analytics.scheduled_reports.enabled"))) return result;
  const settings = await getAnalyticsSettings();
  const due = await prisma.analyticsReportSchedule.findMany({ where: { status: "ACTIVE", nextRunAt: { lte: now } }, include: { report: true }, take: 100 });
  result.due = due.length;
  for (const s of due) {
    const advance = (patch: Record<string, unknown> = {}) => prisma.analyticsReportSchedule.update({ where: { id: s.id }, data: { lastRunAt: now, nextRunAt: computeNextRun(s.frequency, s.dayOfWeek, s.dayOfMonth, s.hourLocal, now, settings.timezone), ...patch } });
    const pause = async (reason: string) => {
      await prisma.analyticsReportSchedule.update({ where: { id: s.id }, data: { status: "PAUSED", pausedReason: reason.slice(0, 200), nextRunAt: null } });
      await analyticsAudit({ action: "ANALYTICS_REPORT_SCHEDULED", actorId: null, resource: "report_schedule", resourceId: s.id, after: { status: "PAUSED", reason } });
      result.paused++;
    };
    const version = await prisma.analyticsReportVersion.findUnique({ where: { reportId_version: { reportId: s.reportId, version: s.report.currentVersion } } });
    const parsed = reportDefinitionSchema.safeParse(version?.definition);
    if (!parsed.success || s.report.status !== "ACTIVE") { await pause("The report is archived or no longer valid."); continue; }
    const owner = await loadViewer(s.report.ownerId);
    if (!owner || !(await recipientHasAccess(owner, parsed.data.query.metrics))) { await pause("The report owner no longer has access to everything in this report."); continue; }

    const recipients = Array.isArray(s.recipientAdminIds) ? (s.recipientAdminIds as unknown[]).filter((x): x is string => typeof x === "string") : [];
    const keep: string[] = [];
    for (const rid of recipients) {
      const v = await loadViewer(rid);
      if (!v || !v.active) {
        await prisma.analyticsReportDelivery.create({ data: { scheduleId: s.id, reportId: s.reportId, recipientId: rid, outcome: "SKIPPED_INACTIVE", reason: "The recipient account is inactive or removed." } });
        result.skipped++;
        continue;
      }
      if (!(await recipientHasAccess(v, parsed.data.query.metrics))) {
        await prisma.analyticsReportDelivery.create({ data: { scheduleId: s.id, reportId: s.reportId, recipientId: rid, outcome: "SKIPPED_NO_ACCESS", reason: "The recipient no longer has access to this report's data." } });
        result.skipped++;
        continue; // dropped from the list for good
      }
      keep.push(rid);
      await sendNotification({ adminId: rid, type: "ANALYTICS_REPORT_READY", data: {} });
      await prisma.analyticsReportDelivery.create({ data: { scheduleId: s.id, reportId: s.reportId, recipientId: rid, outcome: "SENT" } });
      await analyticsAudit({ action: "ANALYTICS_REPORT_DELIVERED", actorId: null, resource: "report_schedule", resourceId: s.id, after: { recipientId: rid } });
      result.delivered++;
    }
    if (keep.length === 0) { await pause("No recipient has access any more."); continue; }
    await advance(keep.length !== recipients.length ? { recipientAdminIds: keep as never } : {});
  }
  return result;
}

export async function listSchedules(owner: Viewer) {
  const rows = await prisma.analyticsReportSchedule.findMany({ where: { report: { ownerId: owner.id } }, orderBy: { createdAt: "desc" }, take: 100, include: { report: { select: { name: true, code: true } } } });
  return rows.map((s) => ({ id: s.id, reportId: s.reportId, reportName: s.report.name, reportCode: s.report.code, frequency: s.frequency, hourLocal: s.hourLocal, status: s.status, pausedReason: s.pausedReason, nextRunAt: s.nextRunAt, lastRunAt: s.lastRunAt, recipients: Array.isArray(s.recipientAdminIds) ? (s.recipientAdminIds as unknown[]).length : 0 }));
}

export { keyFromDbDate };
