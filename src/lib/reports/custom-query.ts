import { prisma } from "@/lib/prisma";
import type { AdminRole } from "@/lib/permissions";
import { REPORT_DEFINITIONS, getReportColumns, type DataSource } from "@/lib/reports/columns";
import {
  buildProfileWhere,
  buildVerificationWhere,
  buildMatchWhere,
  buildProposalWhere,
  buildMeetingWhere,
  buildCommunicationWhere,
  buildFollowUpWhere,
} from "@/lib/reports/where-builders";
import type { ReportFilters } from "@/lib/reports/types";

function ageFromDob(dob: Date, now = new Date()): number {
  let age = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--;
  return age;
}

// Fetches rows for one whitelisted data source. Sensitive relations
// (contact/income/family/notes) are only included in the query at all when
// the caller's role can view sensitive columns — not just filtered out of
// the response afterward — mirroring src/lib/serializers.ts's
// query-layer-exclusion precedent as closely as a shared multi-source
// function reasonably can.
async function fetchRows(dataSource: DataSource, filters: ReportFilters, includeSensitive: boolean): Promise<Record<string, unknown>[]> {
  switch (dataSource) {
    case "Profiles": {
      const rows = await prisma.profile.findMany({
        where: buildProfileWhere(filters),
        include: includeSensitive ? { contact: true, profession: { select: { monthlyIncome: true } }, family: { select: { familyBackground: true } } } : {},
        orderBy: { createdAt: "desc" },
        take: 500,
      });
      return rows.map((p) => ({
        profileCode: p.profileCode,
        fullName: p.fullName,
        gender: p.gender,
        age: ageFromDob(p.dateOfBirth),
        city: p.city,
        area: p.area,
        maritalStatus: p.maritalStatus,
        status: p.status,
        verified: p.verified,
        profileCompletion: p.profileCompletion,
        createdAt: p.createdAt,
        ...(includeSensitive
          ? {
              mobileNumber: (p as unknown as { contact?: { mobileNumber?: string } }).contact?.mobileNumber,
              whatsappNumber: (p as unknown as { contact?: { whatsappNumber?: string } }).contact?.whatsappNumber,
              email: (p as unknown as { contact?: { email?: string } }).contact?.email,
              monthlyIncome: (p as unknown as { profession?: { monthlyIncome?: number } }).profession?.monthlyIncome,
              familyBackground: (p as unknown as { family?: { familyBackground?: string } }).family?.familyBackground,
            }
          : {}),
      }));
    }
    case "Verification": {
      const rows = await prisma.profileVerification.findMany({
        where: buildVerificationWhere(filters),
        include: { profile: { select: { profileCode: true } }, assignedTo: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
        take: 500,
      });
      return rows.map((v) => ({
        profileCode: v.profile.profileCode,
        status: v.status,
        phoneVerifiedAt: v.phoneVerifiedAt,
        emailVerifiedAt: v.emailVerifiedAt,
        assignedTo: v.assignedTo?.name ?? null,
        lastReviewedAt: v.lastReviewedAt,
        createdAt: v.createdAt,
      }));
    }
    case "Matches": {
      const rows = await prisma.match.findMany({
        where: buildMatchWhere(filters),
        include: { profileA: { select: { profileCode: true } }, profileB: { select: { profileCode: true } } },
        orderBy: { createdAt: "desc" },
        take: 500,
      });
      return rows.map((m) => ({
        profileACode: m.profileA.profileCode,
        profileBCode: m.profileB.profileCode,
        score: m.score,
        status: m.status,
        recommendation: m.recommendation,
        createdAt: m.createdAt,
      }));
    }
    case "Proposals": {
      const rows = await prisma.proposal.findMany({
        where: buildProposalWhere(filters),
        include: { profileA: { select: { profileCode: true } }, profileB: { select: { profileCode: true } } },
        orderBy: { createdAt: "desc" },
        take: 500,
      });
      return rows.map((p) => ({
        proposalCode: p.proposalCode,
        profileACode: p.profileA.profileCode,
        profileBCode: p.profileB.profileCode,
        status: p.status,
        priority: p.priority,
        matchScore: p.matchScore,
        createdAt: p.createdAt,
        finalizedAt: p.finalizedAt,
        marriedAt: p.marriedAt,
        ...(includeSensitive ? { internalRejectionNote: p.internalRejectionNote } : {}),
      }));
    }
    case "Meetings": {
      const rows = await prisma.meeting.findMany({
        where: buildMeetingWhere(filters),
        include: { proposal: { select: { proposalCode: true } } },
        orderBy: { scheduledAt: "desc" },
        take: 500,
      });
      return rows.map((m) => ({
        proposalCode: m.proposal.proposalCode,
        meetingType: m.meetingType,
        scheduledAt: m.scheduledAt,
        status: m.status,
        ...(includeSensitive ? { locationInfo: m.locationInfo, notes: m.notes } : {}),
      }));
    }
    case "Communications": {
      const rows = await prisma.communicationLog.findMany({
        where: buildCommunicationWhere(filters),
        include: { profile: { select: { profileCode: true } } },
        orderBy: { createdAt: "desc" },
        take: 500,
      });
      return rows.map((c) => ({
        profileCode: c.profile.profileCode,
        channel: c.channel,
        notificationType: c.notificationType,
        deliveryStatus: c.deliveryStatus,
        createdAt: c.createdAt,
        ...(includeSensitive ? { messageBody: c.messageBody } : {}),
      }));
    }
    case "FollowUps": {
      const rows = await prisma.followUp.findMany({
        where: buildFollowUpWhere(filters),
        include: { profile: { select: { profileCode: true } } },
        orderBy: { dueDate: "desc" },
        take: 500,
      });
      return rows.map((f) => ({
        profileCode: f.profile.profileCode,
        title: f.title,
        purpose: f.purpose,
        dueDate: f.dueDate,
        status: f.status,
        priority: f.priority,
        outcome: f.outcome,
        ...(includeSensitive ? { note: f.note } : {}),
      }));
    }
  }
}

export interface CustomReportResult {
  columns: { key: string; label: string }[];
  rows: Record<string, unknown>[];
  grouped?: { label: string; count: number }[];
  recordCount: number;
}

// The Custom Report Builder's single execution path (spec §22) — also
// reused by the export route so the on-screen table and every exported file
// see byte-identical, identically-redacted data (spec §23).
export async function runCustomReport(
  dataSource: DataSource,
  filters: ReportFilters,
  requestedColumns: string[],
  role: AdminRole,
  groupBy?: string,
  sortBy?: string
): Promise<CustomReportResult> {
  const definition = REPORT_DEFINITIONS[dataSource];
  const allowedColumns = getReportColumns(dataSource, role);
  const columns = allowedColumns.filter((c) => requestedColumns.length === 0 || requestedColumns.includes(c.key));
  const includeSensitive = columns.some((c) => c.sensitive);

  const allRows = await fetchRows(dataSource, filters, includeSensitive);
  const projectedRows = allRows.map((row) => Object.fromEntries(columns.map((c) => [c.key, row[c.key]])));

  if (groupBy && definition.groupByFields.includes(groupBy)) {
    const counts = new Map<string, number>();
    for (const row of allRows) {
      const label = String(row[groupBy] ?? "Unknown");
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    return {
      columns: columns.map((c) => ({ key: c.key, label: c.label })),
      rows: projectedRows,
      grouped: Array.from(counts.entries()).map(([label, count]) => ({ label, count })),
      recordCount: allRows.length,
    };
  }

  if (sortBy && definition.sortByFields.includes(sortBy)) {
    projectedRows.sort((a, b) => {
      const av = a[sortBy];
      const bv = b[sortBy];
      if (av == null || bv == null) return 0;
      if (av instanceof Date && bv instanceof Date) return bv.getTime() - av.getTime();
      if (typeof av === "number" && typeof bv === "number") return bv - av;
      return String(bv).localeCompare(String(av));
    });
  }

  return { columns: columns.map((c) => ({ key: c.key, label: c.label })), rows: projectedRows, recordCount: allRows.length };
}
