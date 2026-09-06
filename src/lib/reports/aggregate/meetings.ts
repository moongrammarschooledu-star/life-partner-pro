import { prisma } from "@/lib/prisma";
import { buildMeetingWhere } from "@/lib/reports/where-builders";
import { safeRate } from "@/lib/reports/sample-size";
import type { ReportFilters } from "@/lib/reports/types";

// Spec §15. "No response" isn't a distinct MeetingStatus value in this
// schema (REQUESTED/SCHEDULED/CONFIRMED/COMPLETED/RESCHEDULED/CANCELLED) —
// documented here rather than fabricated: REQUESTED meetings that are
// significantly overdue with no status change are the closest proxy, surfaced
// separately as `staleRequests` rather than mislabeled as a real status bucket.
export async function computeMeetingAnalytics(filters: ReportFilters) {
  const where = buildMeetingWhere(filters);
  const [grouped, staleRequests, acceptedProposalsWithMeeting] = await Promise.all([
    prisma.meeting.groupBy({ by: ["status"], where, _count: { status: true } }),
    prisma.meeting.count({
      where: { ...where, status: "REQUESTED", createdAt: { lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
    }),
    prisma.meeting.count({ where: { ...where, status: "COMPLETED", proposal: { is: { status: { in: ["ACCEPTED", "FINALIZED", "MARRIED"] } } } } }),
  ]);

  const counts = Object.fromEntries(grouped.map((g) => [g.status, g._count.status]));
  const total = grouped.reduce((sum, g) => sum + g._count.status, 0);
  const completed = counts.COMPLETED ?? 0;

  return {
    total,
    counts: {
      requested: counts.REQUESTED ?? 0,
      scheduled: counts.SCHEDULED ?? 0,
      confirmed: counts.CONFIRMED ?? 0,
      completed,
      cancelled: counts.CANCELLED ?? 0,
      rescheduled: counts.RESCHEDULED ?? 0,
      staleRequests,
    },
    completionRate: safeRate(completed, total),
    meetingToAcceptanceRate: safeRate(acceptedProposalsWithMeeting, completed),
  };
}
