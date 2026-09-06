import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { emailProvider } from "@/lib/notifications/providers/email-provider";
import type { ReportFrequency } from "@prisma/client";

// Pure — computes the next UTC run time strictly after `from`. All times are
// UTC (the `hourUtc` field name is explicit about this) to avoid timezone
// ambiguity in a single-region deployment.
export function computeNextRunAt(freq: ReportFrequency, dayOfWeek: number | null, dayOfMonth: number | null, hourUtc: number, from: Date): Date {
  const candidate = new Date(from);
  candidate.setUTCHours(hourUtc, 0, 0, 0);

  if (freq === "DAILY") {
    if (candidate <= from) candidate.setUTCDate(candidate.getUTCDate() + 1);
    return candidate;
  }

  if (freq === "WEEKLY") {
    const targetDow = dayOfWeek ?? 1; // default Monday
    while (candidate.getUTCDay() !== targetDow || candidate <= from) {
      candidate.setUTCDate(candidate.getUTCDate() + 1);
    }
    return candidate;
  }

  // MONTHLY
  const targetDom = Math.min(Math.max(dayOfMonth ?? 1, 1), 28);
  candidate.setUTCDate(targetDom);
  if (candidate <= from) {
    candidate.setUTCMonth(candidate.getUTCMonth() + 1);
    candidate.setUTCDate(targetDom);
  }
  return candidate;
}

// Evaluated by the existing once-daily notifications cron tick (this Vercel
// account's Hobby plan rejects any more-frequent cron job) — see
// src/app/api/cron/notifications/route.ts. Idempotent: each due report's
// nextRunAt is advanced before/after sending, so a re-run of this same
// function mid-window never double-sends.
export async function runDueScheduledReports(): Promise<{ ran: number }> {
  const now = new Date();
  const due = await prisma.scheduledReport.findMany({
    where: { active: true, nextRunAt: { lte: now } },
  });

  for (const report of due) {
    try {
      const recipientIds = Array.isArray(report.recipientAdminIds) ? (report.recipientAdminIds as string[]) : [];
      const recipients = await prisma.adminUser.findMany({
        where: { id: { in: recipientIds }, active: true },
        select: { email: true, name: true },
      });

      const body = `Your scheduled report "${report.name}" (${report.frequency.toLowerCase()}) is ready. Please log in to Life Partner Pro's Reports & Analytics to view the latest data for this report's configured filters.`;
      for (const recipient of recipients) {
        await emailProvider.send(recipient.email, body, `Life Partner Pro — Scheduled Report: ${report.name}`);
      }

      await prisma.scheduledReport.update({
        where: { id: report.id },
        data: {
          lastRunAt: now,
          nextRunAt: computeNextRunAt(report.frequency, report.dayOfWeek, report.dayOfMonth, report.hourUtc, now),
        },
      });

      await writeAudit({ action: "SCHEDULED_REPORT_RUN", meta: { scheduledReportId: report.id, recipientCount: recipients.length } });
    } catch (error) {
      console.error("[reports] scheduled report run failed", report.id, error);
    }
  }

  return { ran: due.length };
}
